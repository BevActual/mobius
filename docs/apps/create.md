# Create

## Slides

Presentations, played as Keynote plays them.

![The Slides app in Mobius](../readme/apps/slides.png)

- **Slides** down the side, the chosen one at 16:9 to edit, its presenter notes, and a **Format** inspector with two
  panes: **Slide** (its style and layout) and **Deck** (how long it runs, Play from the start, and Ask Mobius). New
  slides start from a menu of layouts. Bullets keep their dots while you type them.
- **Keys:** ↑ ↓ pick a slide, Alt+↑ ↓ moves it, Ctrl+D duplicates, Delete removes, and Ctrl+Enter plays from the
  picked slide. The same keys show in each slide's right-click menu and the toolbar's tooltips.
- **Play** shows each slide full screen. Arrows, Space or a click go on (a click on the left third goes back), a
  number and Return jumps, **B** blacks the screen, **P** shows the presenter view with the next slide, notes and the
  clock, and **Esc** stops.
- **Ask Mobius** about the deck; what it changes comes back as dashed slides, and **Keep** keeps every slide it changed.

**Kept in:** `workspace/slides/`, each deck a Markdown file with slides split by `---`.

## Design

Frames on a canvas, as in Sketch and Figma.

![The Design app in Mobius](../readme/apps/design.png)

- Draw with a tool (**V** move, **F** frame, **R** rectangle, **O** oval, **T** text) or add from the toolbar.
- Pick with a click, Shift-click or a box. Move with smart guides, size from any edge, line layers up from the
  inspector, copy and duplicate. Double-click a text layer to type on the canvas.
- Rename layers and frames in the layer list. Each layer row has **Lock** and **Hide** buttons (or Ctrl+Shift+L and
  Ctrl+Shift+H): a hidden layer is not drawn, and a locked one stays put while you work around it.
- Right-click a layer, a frame or the canvas for cut, copy, paste, duplicate, rename, bring to front, send to back,
  hide, lock and delete, each with its shortcut. **Shift+1** fits everything, **Shift+2** zooms to what is picked.
- Give a frame or shape a **Border** from the inspector (colour or style, and width). Drag layers up or down the layer
  list to change what is in front, or onto another frame to move them there.
- **Export** a frame as a PNG at 1×, 2× or 3× from the inspector (or right-click › Export as PNG). It is saved in
  Photo, in a **Design exports** album.
- **Components**: pick layers and choose **Create component** (Ctrl+Alt+K). They move to a component frame, marked in
  purple, and a copy takes their place. Insert more copies from the component's inspector. Change the component and
  every copy follows; a copy can still have its own text and colours. **Go to main** selects the component, and
  **Detach** turns a copy back into plain layers.
- Mobius's changes are dashed to keep or discard. It can also make pictures with your
  [Images model](../guide/models-and-gateways.md#a-model-for-each-job).

**Kept in:** `workspace/designs/`, each design a JSON file.

## Photo

Your pictures, with edits you can always take back.

![The Photo app in Mobius](../readme/apps/photo.png)

- **Albums** are folders in `workspace/photos/`, shown as a grid. Your original files are never changed. The slider in
  the toolbar (or **−** and **+**) makes the pictures bigger or smaller. Right-click a picture to open, rename (**F2**),
  export, move it to another album or delete it; you can also drag it onto an album in the sidebar. Right-click an
  album to rename or delete it.
- **Recently Deleted** keeps deleted photos, with their edits, until you empty it; right-click one to put it back in
  its album. Deleting an album moves its photos there.
- **Adjust** (exposure, highlights, shadows, contrast, saturation, warmth and more), **Filters** and **Crop** (turn,
  flip, straighten). An adjustment can apply to all of the picture or to part of it. Light, Color, Effects and Where
  each fold away, and each has its own reset once you change it.
- Keys: **←** and **→** step through the album, hold **M** to see the original, **Z** zooms, **Esc** goes back. In
  Crop, **R** rotates and **Enter** is Done.
- Edits are kept beside each photo in a small file, so every change can be put back. **Export** writes a new file next
  to the photo.
- Pictures made with your Images model are saved here.

**Kept in:** `workspace/photos/<album>/`, your original files untouched, with edits beside each in `<photo>.edits.json`.

## Music

A small studio for writing songs as notes.

![The Music app in Mobius](../readme/apps/music.png)

- **Tracks** laid out by bar, each with an instrument (Piano, Bass, Pad, Lead or Drums), volume, mute and solo.
- **The piano roll** for the chosen track: draw, move and stretch notes, select with a box, snap to the grid. Drums
  get a tall row per drum, named in full.
- **Velocity lane** under the roll: one bar per note. Drag a bar up to make the note louder, down to make it softer;
  picked notes move together.
- **The divider** between the tracks and the roll: the track list fits its tracks, and dragging the divider (or
  Up and Down on it) gives more room to either side. Home fits it to the tracks again.
- **Transport** to play, with the song's tempo and key. Loop goes round the whole song, or drag along the top of the
  ruler to loop some bars. Right-click the ruler (or press its top twice quickly) to loop the whole song again.
- **Add Track** opens a menu of instruments. Right-click a track's header to duplicate, mute, solo or delete it.
- Mobius writes songs as notes, never audio. A song is a JSON file it can read and write like a score.

**Kept in:** `workspace/studio/`, each song a JSON file of notes.

## Video

Cut footage into a short film.

![The Video app in Mobius](../readme/apps/video.png)

- **Projects** in the sidebar, each with its footage. Add a clip to the cut or drag it into the timeline.
- **The timeline** shows each shot as a filmstrip. Trim from either end, split, duplicate, move and remove shots.
  Right-click a shot for its menu, or a clip in Footage to add it or show its folder.
- **The viewer** plays the shots in order, and full screen with F. The chosen shot's details sit beside it, with In
  and Out as timecode (type `0:02.5`, or plain seconds).
- **Keys** as in other editors: Space plays, S splits, I and O set the shot's start and end at the playhead,
  Ctrl+D (⌘D on a Mac) duplicates, the arrows step a frame and Up and Down jump between edits.

- **Export** saves the film, titles and sound included, as a video file in the project's `Exports` folder (MP4
  where the window can make it, otherwise WebM). It plays the cut through once while it is made, so a two-minute film
  takes two minutes; Stop ends it early.

**Kept in:** `workspace/video/<project>/`, the cut as `cut.json` and exported films in `Exports/`. Your clips are never
changed.

## Code

A code editor for projects in your workspace.

![The Code app in Mobius](../readme/apps/code.png)

- **The sidebar** lists your **Projects** as rows, then **Changes** (the branch, each changed file, and quiet **Commit…** and **Push**), then the open project's **Files** as a tree.
- **Projects** keep their files as a tree. Files Mobius changed in its last turn have the same dot as in every app.
- **The editor** types like a text field and reads like code, as in Xcode: the current line is lit, brackets and quotes
  close themselves, Tab and Shift+Tab indent, Ctrl+/ comments lines, Ctrl+F finds and Ctrl+G goes to a line. Every
  change can be undone with Ctrl+Z.
- **Review Mobius's change** as removed and added lines, keeping or putting back each one.
- **Source control**: the branch, each file changed since the last commit with git's mark (M modified, A added,
  D deleted, R renamed, ? not tracked yet, C in conflict) in the list and in the file tree, **Commit** and **Push**.
  Mobius asks before either.
- **With no file open**, a start page shows the project, the files you opened lately, and Open a file, New file and
  Run tests.
- **Shortcuts** show as your computer writes them: Ctrl on Windows and Linux, ⌘ on a Mac.
- **Console**: Mobius can run a command in the project's folder (it asks every time, and stops after five minutes)
  beside your own.

**Kept in:** `workspace/code/<project>/`, ordinary folders that git and other editors can use.

## Terminal

Run commands in a folder of your workspace.

![The Terminal app in Mobius](../readme/apps/terminal.png)

- `cd` never goes past the workspace.
- Long-running commands are listed in the sidebar so you can come back to them.
- When Mobius wants to run a command, it asks every time.

## Canvas

A whiteboard for thinking out loud.

![The Canvas app in Mobius](../readme/apps/canvas.png)

- Stickies, shapes, text, arrows between them and pen lines, on a board you pan and zoom.
- Copy items between boards.
- Mobius's additions are dashed until kept, and the change bar says what it added and took away.

**Kept in:** `workspace/boards/`, each board a JSON file.
