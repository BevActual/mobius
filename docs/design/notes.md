# Notes: what comes next

The look for the Notes work Andrew asked for on 25 November 2026 ("ok lets start getting notes to a a high level"):
managing notebooks, the Trash, Ctrl+O, note links and Mobius citing notes. Sorting, version history, templates and
meeting notes follow, after he asked to keep improving Notes. The Apps lead builds them; this page is
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

## Sorting

Andrew, 25 November 2026: "lets keep improving notes". Sorting, version history, templates and meeting notes come
next, in that order. Sorting is as built in #890.

- **One place:** View holds three items, Sort notes by date edited, Sort notes by date created and Sort notes by
  title, with the current one ticked. They show only in Notes, and the choice applies to every notebook, as in Apple
  Notes. No sort control is drawn in the panel. Later: one Sort notes by submenu, once menus have submenus.
- **Pinned stays on top:** the Pinned section keeps the chosen order, and pinned notes also come first in their
  notebook.
- **The row's grey date follows the sort:** the date created under date created, otherwise the date edited, and the
  tooltip says "Created" or "Edited" to match. Under a date sort the newest is first. Title sorts A to Z, ignoring
  case and a leading "The", with numbers in number order.

## Version history

History stays a view that takes the page's place, as now (History as a panel is on hold), opened from Notes ›
Version history… and the note's ⋯.

- **Its head** is 40px with no line under it: Back on the left, "History of {title}" and the count in grey, then
  Restore this version at the trailing end, the one primary button, shown once a version is chosen.
- **The versions** are a list down the left at the panel width, grouped under small grey day headings (Today,
  Yesterday, Monday 23 November). Each row is the time and one grey line saying why it was kept: "While you wrote",
  "Before Mobius changed it" or "Before you restored". The chosen row has the `--sel` fill, and arrows move.
- **The page** shows the chosen version as people read it, never its Markdown. A segmented control above it switches
  between Changes (what differs from the note now, with additions tinted and removals struck through in grey) and
  Version (the whole of it).
- **Restore** returns to the note, and the Undo pill says "Restored the version from {day, time}", with Undo, as now.

## Templates

As built in #892, with what is still to come marked Later.

- **New from a template** is in the Notes menu, after New notebook: New from Meeting, New from Project, then
  New from each of the person's own templates by name, then Save as template and Edit templates…. Menus have no
  submenus yet, so these are flat items, as in Docs. The + in a notebook's heading stays a blank note, so the quick
  way stays quick. Later: one New note from template submenu, and the launcher finding them ("meeting note").
- **A note from a template** opens in the notebook that is open, like any new note, with `{{date}}` filled in. The
  template's headings and empty checklists are ordinary text, never placeholders that look like fields.
- **Daily** is the Today’s note that already exists, not a second item: Today’s note uses a saved Daily template
  when there is one, under the day's own heading, and opening it again that day opens the same note. A saved Daily
  never shows as New from Daily. Later: the day's name as the title ("Tuesday 25 November").
- **Save as template** copies the open note, under its own title, into a Templates notebook, and a notice says so,
  in the same words as Docs. Templates are notes there, so they are edited like any note. Edit templates… opens that
  notebook, with Meeting and Project put in it to change. Later: a small sheet to name the template (name field,
  Cancel and Save), Save as template in the note's ⋯, Templates kept at the end of the panel, and the notice in
  shorter words ("Saved “Standup” as a template."), changed in Docs at the same time.

## Meeting notes

As built in #893, with what is still to come marked Later.

- **The nudge** comes when a meeting on the calendar starts (a timed event with people invited or a place to be),
  from a minute before its start to five minutes after: the shared pill at the foot of the open app says "{Meeting}
  is starting", with Record and ×. It never takes focus, goes by itself after a minute, and comes once per meeting.
  Later: a system notification with the same words and Record when Mobius is in the background.
- **Record** opens the meeting's note, or the one already linked to the event, and starts recording. While it runs,
  the tool row shows the red Stop and the time, as now, and nothing else on screen changes, so there is no headphones
  hint in the bar: Settings › Voice › Hear the other side of calls says it once. Where Mobius hears the computer's
  sound too (Windows, for now), what was said comes in turns under bold **You:** and **Others:** labels.
- **What the person typed stays theirs.** When the meeting ends, the note's bar says "The meeting is in this note."
  with Fill in my notes (the one primary button) and Done. Fill in my notes has Mobius add what was said under each
  of their lines, then the decisions and a checklist of who does what. It is a change to keep, dashed until kept,
  with the one Why · Discard · Keep bar, and the person's own lines are never reworded. The Meeting notes chip asks
  for the same.
- **Later:** after the meeting, the note's grey line under the title adds the meeting's length and who was there,
  and Calendar's event links to the note.
