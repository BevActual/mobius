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
next, in that order.

- **One place:** View › Sort notes by, with Date edited, Date created and Title, the current one ticked. It applies
  to every notebook, as in Apple Notes. No sort control is drawn in the panel.
- **Pinned stays on top** in its own Pinned section whatever the sort, as now.
- **The row's grey date follows the sort:** the date edited, or the date created under Date created. Title keeps
  the date edited. Under a date sort the newest is first. Title sorts A to Z, ignoring case and a leading "The".

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

- **New from a template** is Notes › New note from template, a submenu under New note: Meeting and Project,
  then the person's own templates, then Edit templates…. The launcher finds the same ("meeting note"). The + in a
  notebook's heading stays a blank note, so the quick way stays quick.
- **A note from a template** opens with its title selected and the cursor ready, like any new note. The template's
  headings and empty checklists are ordinary text, never placeholders that look like fields.
- **Daily** is the Today’s note that already exists, not a second item: Today’s note uses the Daily template when
  there is one, titled with the day ("Tuesday 25 November"), and opening it again that day opens the same note.
- **Save as template…** is in the note's ⋯ and the Notes menu. It asks for a name in a small sheet (name field,
  Cancel and Save), and the Undo pill confirms it. Templates are notes in a Templates notebook at the end of the
  Notebooks panel, so they are edited like any note. Edit templates… opens that notebook.

## Meeting notes

- **The nudge** comes when a meeting on the calendar starts: the shared pill at the foot of the open app says
  "{Meeting} is starting", with Record and ×. It never takes focus and goes by itself after a minute. With Mobius in
  the background, it is a system notification with the same words and Record.
- **Record** opens the meeting's note (from the Meeting template, or the one already linked to the event) and
  starts recording. While it runs, the tool row shows the red Stop and the time, as now, and nothing else on screen
  changes.
- **What the person typed stays theirs.** When the meeting ends, Mobius fills in around their lines: under each line
  it adds what was said about it, and it fills the template's Actions with checklists. Everything Mobius added is
  dashed until kept, with the one Why · Discard · Keep bar. The person's own lines are never rewritten.
- **After the meeting** the note's grey line under the title adds the meeting's length and who was there, and
  Calendar's event links to the note.
