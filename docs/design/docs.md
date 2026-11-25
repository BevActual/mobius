# Docs: what comes next

The look for the Docs round of 25 November 2026 (one app at a time to a refined state: Settings and Notes are done,
then Voice, Docs and Calendar). The Apps lead builds it in one pull request for the round; this page is what it
should look like. It follows the [design guide](guide.md), with Google Docs and Word as the references and
[Notes](notes.md) as the sister app: where the two editors do the same thing, they do it the same way. Where this
page and the guide disagree, the guide wins.

## The Documents panel

As Notes' Notebooks panel, on the same shared list (`NotesSidebar`), so the two never drift apart.

- **Folders** are headings with ⋯ (Rename, then Move to Trash) and + (New document) at their trailing edge. Rename
  puts the name field at the top of the folder's list, with the name chosen; Enter keeps it and Esc puts it back.
- **A document's menu** (right-click, Shift F10 or the Menu key): Open, one Move to {folder} item per other folder,
  then Move to Trash.
- **Move to Trash never asks**, because nothing is lost. The shared Undo pill says what went ("Moved “Brief” to the
  Trash", Undo).
- **The Trash** is a folded section at the end of the panel, shown only while something is in it, as in Notes:
  grey rows saying where each came from and how long it stays (30 days), Put back and Delete forever in each row's
  menu, and Empty Trash at its heading, which turns into a red Empty button in place before it acts.
- **Each row** is the document's title with the day it was edited in grey at the trailing edge, one line high.

## The Outline

- **The Outline is a panel in the right dock**, named Outline, as in Notes and Code, never a column drawn beside
  the page. It lists the headings under the title, the one in view marked with the grey selected fill, sub-headings
  one step in; clicking one moves the page there.
- **It starts hidden.** The window's ⋯ has Show the outline (and Hide the outline), and the View menu lists it by
  name with its tick. Once shown, it stays shown for that person.
- **Comments** are the Outline's neighbour in the right dock, as now.

## Editing, Suggesting and Viewing

As Google Docs has the three modes, in the tool row's trailing end as one small menu that names the mode.

- **Editing** is as now.
- **Suggesting:** what the person types is kept as a suggestion: added words underlined in ink with a faint fill,
  removed words struck through in grey, each with Accept and Reject on hover. It is the person's own suggestion, so it
  is never indigo or dashed; those stay Mobius's.
- **Viewing:** the page reads only, the tool row's writing tools go, and the selection bar keeps Comment and Copy.
- **Later:** Mobius's suggestions in Suggesting mode, using the same marks with its dashed indigo edge.

## Page setup

- **Docs › Page setup…** opens a small sheet: paper (Letter or A4), orientation, and margins (Normal, Narrow, Wide).
  The page in the window follows it, at 816px for Letter, and Print or save as PDF uses it.
- It is kept per document, beside it, so the Markdown file stays plain.

## Done in this round

| Piece | State |
| --- | --- |
| Documents panel on the shared list: Move to, Trash with Undo, folder Rename | Built |
| Outline as the right dock's panel | Built |
| Editing, Suggesting and Viewing | Next |
| Page setup | Next |
