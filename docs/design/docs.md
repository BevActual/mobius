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

As Google Docs has the three modes: one small menu in the tool row, before Share, that names the mode (muted while
Editing, ink otherwise), each mode with one line saying what it does.

- **Editing** is as before.
- **Suggesting:** what the person types is kept as a suggestion: added words in ink, underlined, on a faint fill;
  removed words stay in the page, struck through in grey. Deleting one's own suggested words takes them out for good.
  It is the person's own suggestion, so it is never dashed; those stay Mobius's.
- **Accept or reject** one suggestion from the page's right-click menu (Accept the addition, Reject the removal), or
  all of them from the Docs menu (Accept all suggestions, with the count, and Reject all suggestions), in one step to
  undo.
- **Kept in the file** in the open [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit) notation,
  `{++added++}` and `{--removed--}`, so the document stays plain Markdown that other tools and Mobius read as it is.
- **Viewing:** the page reads only, and the writing tools leave the tool row and its ⋯; Share stays.
- **Later:** a deletion across paragraphs kept as a suggestion (it is made as it is for now); Accept and Reject on
  hover; Mobius's suggestions in Suggesting mode, with the same marks and its dashed Mobius edge; the selection bar's
  Comment while Viewing.

## Page setup

- **Docs › Page setup…** opens a small sheet with three choices: Paper (Letter or A4), Orientation (Portrait or
  Landscape) and Margins (Narrow, Normal or Wide, as Word names them: half an inch, an inch, and two inches at the
  sides), with Done. A choice applies as it is made.
- **The page in the window is as wide as the paper's text**: Letter with Normal margins is the guide's 816px page,
  so 624px of text. Print or save as PDF uses the same paper and margins.
- **It starts on Letter** where Letter is the custom (the United States, Canada, Mexico and the Philippines) and A4
  everywhere else, as Google Docs does.
- **Kept on this device for every document**, so the Markdown files stay plain. Later: a document's own page setup,
  kept beside it.

## Done in this round

| Piece | State |
| --- | --- |
| Documents panel on the shared list: Move to, Trash with Undo, folder Rename | Built |
| Outline as the right dock's panel | Built |
| Editing, Suggesting and Viewing | Built |
| Page setup | Built |
