# Notes: what comes next

The look for the Notes work Andrew asked for on 25 November 2026 ("ok lets start getting notes to a a high level"):
managing notebooks, the Trash, Ctrl+O, note links and Mobius citing notes. The Apps lead builds them; this page is
what they should look like. It follows the [design guide](guide.md), with Apple Notes and Obsidian as the references.
Where the two disagree, the guide wins.

## Notebooks and notes in the Notebooks panel

- **One menu per row.** Right-click, Shift F10 or the Menu key opens it; its top items match the row's hover actions.
  Every item has the guide's standard word and key.
- **A notebook's menu:** New note, Rename, then Delete. **A note's menu:** Open beside, Pin, Duplicate (Ctrl D),
  Move to…, then Delete.
- **Rename** edits the name in the row itself, at the same 28px height: the name is selected, Enter keeps it, Esc
  puts it back, and clicking away keeps it. A name that is taken shows the row's text in red until it is changed.
- **Move to…** opens a menu of notebooks under the row, with the current one ticked and dimmed. Dragging a note onto
  a notebook does the same; the notebook under the pointer takes the `--sel` fill.
- **Delete** never asks, because nothing is lost: the note or notebook goes to the Trash, and the shared Undo pill
  says what went ("Moved “Work” and 12 notes to the Trash", Undo). The Delete key does the same on a selected row.
  The trash glyph on hover goes, since Delete is in the menu and on the key.

## The Trash

- **Where:** the last row of the Notebooks panel, after the notebooks and New notebook, with the outline trash glyph
  and a grey count at its trailing edge. Empty, it shows no count. It has no section heading and no help line; its
  tooltip says how long deleted notes are kept.
- **Inside:** the Trash opens like a notebook. Its notes show their title and one grey line, "Deleted 3 days ago",
  newest first.
- **A note in the Trash** opens read-only. The tool row holds only **Put back** (a word button, the one action there),
  and ⋯ holds Delete now…. The page has no banner.
- **Put back** returns the note to its notebook, or to Notes if that notebook is gone, and the Undo pill says where.
- **What can't be undone asks first:** Delete now… and Empty Trash… (the Trash row's menu) open a sheet that names
  what goes ("Delete 4 notes now? This can't be undone.") with Cancel and a red Delete button.

## Ctrl+O: open a note

Ctrl+O opens the [launcher](launcher.md) already narrowed to Notes, rather than a second switcher. It is the
same window, with "Notes" as a token at the start of the box, so Backspace widens it to everything.

- **Empty box:** recent notes, most recent first. **Typing:** matches by title first, then by text.
- **A row:** the note's title, with the matched words in semibold, and its notebook as a grey word at the trailing
  edge. A match in the text adds one grey line with the words around it.
- **Keys:** Enter opens the note and Ctrl Enter opens it beside. With no match, the first row is New note “typed
  words”.

## Note links

- **Typing `[[`** opens the link menu under the words, as now: title in medium, notebook in grey, the first match
  chosen, and New note “typed words” as the last row.
- **A link to a note** is ink with a faint hairline underline that turns ink on hover. It is never blue.
- **A link to a note that is gone** is muted with a dashed underline; clicking it offers New note with that name.
- **Linked from:** the quiet line at the end of the page stays, "Linked from 3". Opened, each row is the linking
  note's title and one grey line with the sentence the link sits in, at the 44px reading row. Clicking a row opens
  that note scrolled to the link.

## Mobius citing notes

- **In Mobius's answer**, a claim that comes from a note carries a superscript number in `--fs-xs` muted. The
  Sources card under the answer lists those notes as real rows: the Notes glyph, the title, and the notebook in grey,
  numbered to match.
- **Opening a source** opens the note scrolled to the passage, which takes a soft `--sel` tint that fades after a
  moment. It is not indigo and not dashed, because Mobius only read it and changed nothing.
- **In the Notebooks panel** a cited note shows no mark. A dot still means only that Mobius changed something.
