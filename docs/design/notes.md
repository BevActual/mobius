# Notes: what comes next

The look for the Notes work Andrew asked for on 25 November 2026 ("ok lets start getting notes to a a high level"):
managing notebooks, the Trash, Ctrl+O, note links and Mobius citing notes. The Apps lead builds them; this page is
what they should look like. It follows the [design guide](guide.md), with Apple Notes and Obsidian as the references.
Where the two disagree, the guide wins.

## Notebooks and notes in the Notebooks panel

As built in #887, with what is still to come marked Later.

- **A notebook's menu** opens from ⋯ in its heading, beside + (New note): Rename, then Move to Trash. Later:
  right-click and Shift F10 on the heading open the same menu.
- **A note's menu** (right-click, Shift F10 or the Menu key): Open, Pin, one Move to {notebook} item per other
  notebook, then Move to Trash. Later: Open beside, Duplicate (Ctrl D), and dragging a note onto a notebook, which
  then takes the `--sel` fill.
- **Rename** puts the name field at the top of the notebook's list, at the panel's control height, with the name
  selected and a plain Rename button beside it. Enter keeps the name and Esc puts it back. Later: clicking away keeps
  it, and a name that is taken shows the field's text in red until it is changed.
- **Move to Trash** never asks, because nothing is lost. The shared Undo pill says what went ("Moved “Work” to the
  Trash", Undo). Later: the Delete key does the same on a selected row, and the trash glyph on hover goes.

## The Trash

- **Where:** a folded section called Trash at the end of the Notebooks panel, shown only while something is in it.
  Its heading's action is Empty Trash (the trash glyph).
- **Its rows** are grey titles, with one grey line saying where each came from and how long it stays: "From Work ·
  12 days left", or "Notebook, 4 notes · Goes today". Items stay 30 days.
- **A row's menu** (click, right-click or Shift F10): Put back, then Delete forever in red. Put back returns the item
  to where it was.
- **What can't be undone asks first.** Empty Trash turns into a red Empty button in place, which empties the Trash
  when pressed and turns back when focus leaves or on Esc. Delete forever acts straight from its red menu item.
- **Later:** a note in the Trash opens read-only, with Put back as the only tool in the tool row.

## Ctrl+O: open a note

Ctrl+O opens the [launcher](launcher.md) already narrowed to Notes, rather than a second switcher. It is the
same window, with "Notes" as a token at the start of the box, so Backspace widens it to everything.

- **Empty box:** recent notes, most recent first. **Typing:** matches by title first, then by text.
- **A row:** the note's title, with the matched words in semibold, and its notebook as a grey word at the trailing
  edge. A match in the text adds one grey line with the words around it.
- **Keys:** Enter opens the note (later, Ctrl Enter opens it beside). With no match, the first row is New note “typed
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
