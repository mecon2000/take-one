# The review room

What it is: a local page where the person watches a cut, clicks on the picture and leaves a note on that exact frame. The maker reads the notes from a file. It replaces "watch it and type what you think" and screenshots. Notes pinned to a frame are far more exact than notes typed from memory.

## Files
`scripts/review-room/server.mjs` and `scripts/review-room/index.html`. No dependencies beyond Node. The page carries the Take One logo from `assets/logo/` (header, tab icon, title), so keep that folder beside `scripts/` when the skill is copied.

## Run
```
node <skill>/scripts/review-room/server.mjs <folder with the exported .mp4 cuts> [port=4400]
```
Then open http://localhost:4400. It only listens on 127.0.0.1; nothing is uploaded. Run it in the background and leave it running for the whole project.

## What the person can do
- Pick a cut (newest first), play, step frame by frame.
- Click on the picture: a pinned note on that frame. Also a note on the frame with no pin, or on the whole film.
- Play a second cut next to the first, in sync, to compare.
- Press "Send notes" when done.
- **Download** (the browser's own save) or **Save to…**, which copies the cut, and its `-sfx-only` twin, straight into a folder. Browsers can't preset their Save dialog's folder, so Save to… is the way to land files in the right place. The panel is prefilled from `<cuts folder>/review-room.json`: `{"saveDirs":[{"label":"Shared","path":"/abs/dir"}]}`. List the shared folder and the shoot folder the photos came from there. Any typed path works too; Windows paths like `D:\x` map to `/mnt/d/x` under WSL.

## What the maker reads
- `<cuts folder>/review-notes/notes.json`: every note with `cut`, `t` (seconds), `frame`, `x` and `y` (0 to 1), `text`, `done`.
- `<cuts folder>/review-notes/shots/<id>.jpg`: the noted frame with the pin drawn in. Open these as images; the pin shows what the note points at.
- `<cuts folder>/review-notes/sent.log`: one line starting `SENT` each time the button is pressed. Watch this file (a background monitor, 30 minutes at most, re-arm it) so the person does not have to come back and type "done".

## The loop
1. Export the cut, run the quality gate, then say one line: the cut is in the review room.
2. Arm the watch on `sent.log`.
3. When notes arrive: read every note AND its snapshot. Copy the person's words into the project record before changing anything.
4. Answer note by note in the next cut. Mark a note done (`POST /api/notes/<id>` with `{"done":true}`) only when the new cut really answers it. A note the maker disagrees with stays open and is raised in words.
5. Notes that are about taste or direction (not a fix) are the person's decision: ask, do not guess.

## Limits
- The page assumes 30 frames a second for the frame counter (`FPS=30` in `index.html`).
- The player box takes the cut's own shape (9:16 stays 9:16), so pins and snapshots are measured on the picture itself. Notes saved before 2026-10-14 were measured on a 16:9 box.
- Files with `silent` or `small` in the name are hidden from the list (working files).
- One reviewer at a time; notes carry no name.

**Long films (added 2026-10-17):**
- For cuts of 1 minute or more, the room shows speed buttons: forward 1×/1.5×/2×/4× and reverse ◀ 1×/1.5×/2×/4×, plus J/K/L shuttle keys.
- Write `<cut>.chapters.json` next to the cut as `[{"t": seconds, "label": "Act II"}, …]`. It shows as ticks on the seek bar: hover to see the name, click to jump there; dragging the knob within ~8 px of a tick snaps onto it.
- Encode review cuts with `-g <fps>` (one keyframe per second) so reverse play stays smooth.
