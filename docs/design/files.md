# Files: picking several, copy and duplicate

The Files round of 25 November 2026 (one app at a time to a refined state). It follows the [design guide](guide.md),
with Windows Explorer and Finder as the references. The second design pass's four asks for Files (columns giving way at
1024 wide, Space to preview, the path as a breadcrumb, list and grid) were already in; this round adds what people
coming from Explorer reach for next. Where this page and the guide disagree, the guide wins.

## Picking several

As Explorer and Finder do (Microsoft's "Keyboard shortcuts in Windows", the File Explorer part, and Apple's Finder
"Select items" help):

- **Ctrl+click** adds a row to what is picked, or takes it out. **Shift+click** picks every row from the last one
  clicked; with Ctrl it adds them. **Shift with the arrows, Home or End** grows the pick from the keyboard. **Ctrl+A**
  picks the whole folder (as shown, after a search). **Escape** goes back to just the row the keyboard is on.
- **What acts on all of them:** Delete (one toast, "Moved 3 items to the Trash", and one Undo), Cut, Copy, Duplicate,
  dragging any picked row onto a folder, and Ask Mobius about this. Open, Rename, Copy path, Show in Explorer and the
  sync items are for one row and leave the menu while several are picked.
- **The Info panel** shows how many are picked, how many are folders, and the files' size together.
- **Grid and list** pick the same way; the grid says so with `aria-multiselectable`.

## Copy, Paste and Duplicate

- **Copy (Ctrl+C), then Paste (Ctrl+V)** copies into the folder open, even an empty one. What was copied stays on the
  clipboard, so it can be pasted again; a Cut empties once pasted.
- **Duplicate (Ctrl+D)** copies beside the original.
- **Names** as Explorer gives them: the same name in another folder, else "Plan - Copy.md", then "Plan - Copy (2).md".
  A folder keeps its dots ("v1.2 - Copy"). A folder is copied with everything in it; links inside are left out, so a
  copy never reaches outside the workspace. Never into itself.
- **Undo** in the toast ("Copied 2 items to Work") moves the copies to the Trash: nothing the person had is lost.
- What was pasted or duplicated is picked afterwards, the keyboard on the first of it.

## Type to go to a name

As in Explorer and Finder: typing letters goes to the first name that starts with them, as long as each comes within a
second of the last. The same letter again goes on to the next name that starts with it, round to the first.

## Later

- Copying to and from a drive or a folder on this computer works as it did (dragging between them); Copy and Paste
  across them waits.
- A progress bar for big copies; for now a copy is quick enough inside the workspace.
