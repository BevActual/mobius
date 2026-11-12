# Create

## Slides

Presentations, played as Keynote plays them.

- **Slides** down the side, the chosen one at 16:9 to edit, its presenter notes, and a **Format** inspector. New slides
  start from a menu of layouts.
- **Play** shows each slide full screen. Arrows, Space or a click go on (a click on the left third goes back), a
  number and Return jumps, **B** blacks the screen, **P** shows the presenter view with the next slide, notes and the
  clock, and **Esc** stops.
- **Ask Mobius** about the deck; what it changes comes back as dashed slides, and **Keep** keeps every slide it changed.

## Design

Frames on a canvas, as in Sketch and Figma.

- Draw with a tool (**V** move, **F** frame, **R** rectangle, **O** oval, **T** text) or add from the toolbar.
- Pick with a click, Shift-click or a box. Move with smart guides, size from any edge, line layers up from the
  inspector, copy and duplicate. Double-click a text layer to type on the canvas.
- Rename layers and frames in the layer list.
- Mobius's changes are dashed to keep or discard. It can also make pictures with your
  [Images model](../guide/models-and-gateways.md#a-model-for-each-job).

## Photo

Your pictures, with edits you can always take back.

- **Albums** are folders in `workspace/photos/`, shown as a grid. Your original files are never changed.
- **Adjust** (exposure, highlights, shadows, contrast, saturation, warmth and more), **Filters** and **Crop** (turn,
  flip, straighten). An adjustment can apply to all of the picture or to part of it.
- Edits are kept beside each photo in a small file, so every change can be put back. **Export** writes a new file next
  to the photo.
- Pictures made with your Images model are saved here.

## Music

A small studio for writing songs as notes.

- **Tracks** laid out by bar, each with an instrument (Piano, Bass, Pad, Lead or Drums), volume, mute and solo.
- **The piano roll** for the chosen track: draw, move and stretch notes, select with a box, snap to the grid. Drums
  get a lane per drum.
- **Transport** to play, with the song's tempo and key.
- Mobius writes songs as notes, never audio. A song is a JSON file it can read and write like a score.

## Video

Cut footage into a short film.

- **Projects** in the sidebar, each with its footage. Add a clip to the cut or drag it into the timeline.
- **The timeline** shows each shot as a filmstrip. Trim from either end, split, move and remove shots.
- **The viewer** plays the shots in order, and the chosen shot's details sit beside it.

## Code

A code editor for projects in your workspace.

- **Projects** with their files as a tree. Files Mobius changed in its last turn are marked.
- **The editor** types like a text field and reads like code, as in Xcode: the current line is lit, brackets and quotes
  close themselves, Tab and Shift+Tab indent, Ctrl+/ comments lines, Ctrl+F finds and Ctrl+G goes to a line. Every
  change can be undone with Ctrl+Z.
- **Review Mobius's change** as removed and added lines, keeping or putting back each one.
- **Source control**: the branch, what changed since the last commit, **Commit** and **Push**. Mobius asks before
  either.
- **Console**: Mobius can run a command in the project's folder (it asks every time, and stops after five minutes)
  beside your own.

## Terminal

Run commands in a folder of your workspace. `cd` never goes past the workspace. Long-running commands are listed in the
sidebar so you can come back to them. When Mobius wants to run a command, it asks every time.

## Canvas

A whiteboard: stickies, shapes, text, arrows between them and pen lines, on a board you pan and zoom. Copy items between
boards. Mobius's additions are dashed until kept, and the change bar says what it added and took away.
