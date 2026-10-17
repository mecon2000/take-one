// review-room/server.mjs : a local review room for the cuts of a film. Watch a cut, click on the picture, leave a note on that exact frame.
// Nothing leaves this computer: it only listens on 127.0.0.1.
// Usage: node server.mjs <folder with the exported .mp4 cuts> [port=4400]     then open http://localhost:4400
// Notes go to <folder>/review-notes/notes.json, a snapshot of each noted frame (pin drawn in) to <folder>/review-notes/shots/,
// and every press of "Send notes" adds a line starting SENT to <folder>/review-notes/sent.log (watch that file to be told).
// Save-to folders: <folder>/review-room.json {"saveDirs":[{"label":"Shared","path":"/abs/dir"}, ...]} prefills the "Save to" panel;
// any other folder can be typed (Windows paths like D:\x are mapped to /mnt/d/x under WSL). Only listed cuts are ever copied.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.argv[2]) { console.error('usage: node server.mjs <folder with the exported .mp4 cuts> [port]'); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.resolve(process.argv[2]), DIR = path.join(OUT, 'review-notes'), NOTES = path.join(DIR, 'notes.json'), SHOTS = path.join(DIR, 'shots'), LOG = path.join(DIR, 'sent.log'), PORT = Number(process.argv[3] || 4400);
fs.mkdirSync(SHOTS, { recursive: true });
const load = () => { try { return JSON.parse(fs.readFileSync(NOTES, 'utf8')); } catch { return { notes: [], sent: [] }; } };
const save = (d) => fs.writeFileSync(NOTES, JSON.stringify(d, null, 1));
// Cuts live in three places: <folder>/*.mp4 (working on), <folder>/final/ and <folder>/archive/. The page shows the working cuts in its
// main menu and the other two in their own menus. Names stay plain file names, so notes keep pointing at the right cut when a cut moves.
const GROUPS = [['current', ''], ['final', 'final'], ['archive', 'archive']];
const cuts = () => GROUPS.flatMap(([group, sub]) => { const d = path.join(OUT, sub); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /\.mp4$/i.test(f) && !/silent|small|draft-frames/.test(f))
    .map((f) => ({ name: f, group, mtime: fs.statSync(path.join(d, f)).mtimeMs })); }).sort((a, b) => b.mtime - a.mtime);   // newest first
const cutPath = (n) => { const c = cuts().find((x) => x.name === n); return c ? path.join(OUT, c.group === 'current' ? '' : c.group, n) : null; };
const body = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch { res({}); } }); });
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
function file(req, res, p, type) {
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(p).size, r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (r) { const a = r[1] ? Number(r[1]) : 0, b = r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    if (!size || a > b) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }   // empty or half-written file: no crash
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 }); return fs.createReadStream(p, { start: a, end: b }).pipe(res); }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
}
http.createServer(async (req, res) => {
  // the room answers only its own page: another website open in the same browser cannot read the notes or plant one
  // REVIEW_HOSTS="name.tailnet.ts.net:8444" also admits the room when it's published over Tailscale serve (tailnet only, HTTPS)
  const host = String(req.headers.host || ''), origin = req.headers.origin, extra = String(process.env.REVIEW_HOSTS || '').split(',').filter(Boolean);
  const okHost = /^(localhost|127\.0\.0\.1):\d+$/.test(host) || extra.includes(host);
  if (!okHost || (origin && origin !== 'http://' + host && origin !== 'https://' + host)) { res.writeHead(403); return res.end('forbidden'); }
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (p === '/') return file(req, res, path.join(HERE, 'index.html'), 'text/html; charset=utf-8');
  const LOGO = path.join(HERE, '..', '..', 'assets', 'logo');                                                  // the Take One mark and wordmark
  if (p === '/favicon.ico') return file(req, res, path.join(LOGO, 'take-one-mark.svg'), 'image/svg+xml');
  if (p.startsWith('/logo/') && /^[a-z0-9-]+\.svg$/.test(path.basename(p))) return file(req, res, path.join(LOGO, path.basename(p)), 'image/svg+xml');
  if (p === '/api/cuts') return json(res, 200, cuts());
  // chapters: <cut>.chapters.json next to the cut, [{"t": seconds, "label": "Act II"}, ...] -> markers and jump buttons
  if (p === '/api/chapters') { const cp = cutPath(path.basename(u.searchParams.get('cut') || '')); let ch = [];
    if (cp) try { ch = JSON.parse(fs.readFileSync(cp.replace(/\.mp4$/i, '.chapters.json'), 'utf8')); } catch {}
    return json(res, 200, Array.isArray(ch) ? ch : []); }
  if (p.startsWith('/video/')) { const n = path.basename(p), cp = cutPath(n); if (!cp) return json(res, 404, {});
    if (u.searchParams.has('dl')) res.setHeader('content-disposition', `attachment; filename="${n.replace(/"/g, '')}"`);
    return file(req, res, cp, 'video/mp4'); }
  if (p === '/api/dirs') { let c = {}; try { c = JSON.parse(fs.readFileSync(path.join(OUT, 'review-room.json'), 'utf8')); } catch {}
    return json(res, 200, (c.saveDirs || []).filter((d) => d && typeof d.path === 'string')); }
  if (p === '/api/save' && req.method === 'POST') { const b = await body(req), n = path.basename(String(b.cut || ''));
    const cp = cutPath(n); if (!cp) return json(res, 404, { error: 'no such cut' });
    let dir = String(b.dir || '').trim().replace(/^"|"$/g, '');
    const win = /^([A-Za-z]):[\\/](.*)$/.exec(dir); if (win) dir = `/mnt/${win[1].toLowerCase()}/${win[2].replace(/\\/g, '/')}`;
    if (!path.isAbsolute(dir)) return json(res, 400, { error: 'give a full folder path' });
    try { if (!fs.statSync(dir).isDirectory()) throw 0; } catch { return json(res, 400, { error: 'folder not found: ' + dir }); }
    const names = [n]; fs.copyFileSync(cp, path.join(dir, n));
    console.log(`SAVED ${names.join(', ')} -> ${dir}`); return json(res, 200, { ok: true, dir, files: names }); }
  if (p.startsWith('/shots/')) return file(req, res, path.join(SHOTS, path.basename(p)), 'image/jpeg');
  if (p === '/api/notes' && req.method === 'GET') return json(res, 200, load());
  if (p === '/api/notes' && req.method === 'POST') { const b = await body(req), d = load(), id = Date.now().toString(36);
    const n = { id, cut: String(b.cut || ''), t: typeof b.t === 'number' ? Math.round(b.t * 1000) / 1000 : null, frame: typeof b.t === 'number' ? Math.round(b.t * 30) : null,
      x: typeof b.x === 'number' ? Math.round(b.x * 1000) / 1000 : null, y: typeof b.y === 'number' ? Math.round(b.y * 1000) / 1000 : null, text: String(b.text || '').slice(0, 4000), at: new Date().toISOString(), done: false };
    if (typeof b.shot === 'string' && b.shot.startsWith('data:image/jpeg;base64,')) { fs.writeFileSync(path.join(SHOTS, id + '.jpg'), Buffer.from(b.shot.slice(23), 'base64')); n.shot = 'shots/' + id + '.jpg'; }
    d.notes.push(n); save(d); console.log(`NOTE ${n.cut} ${n.t ?? 'whole film'} ${n.text.slice(0, 80)}`); return json(res, 200, n); }
  const m = /^\/api\/notes\/([a-z0-9]+)$/.exec(p);
  if (m && req.method === 'POST') { const b = await body(req), d = load(), n = d.notes.find((x) => x.id === m[1]); if (!n) return json(res, 404, {}); if (typeof b.text === 'string') n.text = b.text.slice(0, 4000); if (typeof b.done === 'boolean') n.done = b.done; save(d); return json(res, 200, n); }
  if (m && req.method === 'DELETE') { const d = load(); d.notes = d.notes.filter((x) => x.id !== m[1]); save(d); const sf = path.join(SHOTS, m[1] + '.jpg'); if (fs.existsSync(sf)) fs.unlinkSync(sf); return json(res, 200, { ok: true }); }
  if (p === '/api/send' && req.method === 'POST') { const b = await body(req), d = load(); d.sent.push({ at: new Date().toISOString(), cut: String(b.cut || ''), open: d.notes.filter((n) => !n.done).length }); save(d);
    const line = `SENT ${d.notes.filter((n) => !n.done).length} open notes on ${b.cut || ''}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); return json(res, 200, { ok: true }); }
  res.writeHead(404); res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`Take One review room on http://localhost:${PORT}`));
