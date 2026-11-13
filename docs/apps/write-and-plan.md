# Write and plan

## Notes

Quick pages, saved as you type.

![The Notes app in Mobius](../readme/apps/notes.png)

- **Notebooks** in the sidebar, newest pages first, each row showing when it was edited and how it starts, with search, **Pinned** pages at the top and a **Tags** section
  built from every `#tag` you write.
- **Formatted as you write**: headings, lists, checklists you tick, tables, pictures, links between notes, and
  recordings (up to ten minutes). As in Apple Notes, **Aa** opens the text styles (Title, Heading, Subheading, Body),
  bold, italic, strikethrough, code, lists and quote; the bar keeps Checklist, Table and Link at hand. The **⋯** menu
  clips a web page into the note and shows the Markdown file itself.
- **History** lists earlier versions by day, compares one with the page now, and **Restore** puts it back (and can be
  undone the same way).
- **Share** copies the page, exports it as a web page or Markdown, or prints it.
- Select text for Mobius's actions right where it is. A page Mobius changed shows its edits to keep or discard, line by
  line if you like, and is never overwritten while you type.

**Kept in:** `workspace/notes/<notebook>/`, each page a Markdown file that opens in any editor.

## Docs

Longer documents, with an outline and comments.

![The Docs app in Mobius](../readme/apps/docs.png)

- **The sidebar** lists **Recent** documents, then each folder with its documents. Right-click a document to open or
  delete it (Delete asks once more). **New folder** is at the foot of the folders.
- **A page to write on**: headings, lists, checklists, tables, pictures and links to other documents, kept as Markdown.
  The format bar is the window's toolbar, beside the document's name and whether it is saved. **Aa** holds the styles,
  bold, italic and lists, as in Notes; checklist, link and **Insert** (table, picture, divider, code) sit beside it,
  and **Table** appears while you are in one, for its rows and columns. **Document options** shows the outline and the
  margin's comments, opens earlier versions and switches the page between the sans-serif font and a serif one.
- **The outline** of headings sits beside the page and marks the part you are looking at as you scroll. It folds away
  when the window is narrow; hide it in Document options if you prefer. A document opens at its top.
- **The count** at the foot shows words; click it for characters or reading time. Select some text to see its words.
- **Comments** in the margin. **Ask Mobius** on a comment and its answer comes back in the thread; open comments are
  sent along with the document when you ask Mobius about it.
- **Mobius's writing tools** work on the selection or the whole document. What Mobius changes is marked in the page
  where it is, as tracked changes are: new words tinted, and a note above them with the words taken out, struck
  through. Each change has its own **Keep** and **Discard**; the bar above the page keeps or discards them all.
- **Earlier versions** (in Document options) puts one back, and **Undo** in the note at the foot takes it back again. **Share** copies, exports as a web page or Markdown, or prints and saves as
  PDF.

**Kept in:** `workspace/docs/`, each document a Markdown file.

## Tasks

Lists of things to do, as in Apple's Reminders.

![The Tasks app in Mobius](../readme/apps/tasks.png)

- **The sidebar** has Search, New list, the **Smart lists** (Today, Scheduled, All, Flagged and Completed), then
  **My lists** with how many are open. Hover a list to pin it or open its menu (Rename, Delete).
  **Scheduled** sorts tasks under day headings: Overdue, Today, Tomorrow, each day of the coming week, then by month.
- **Right-click a task** to show its details, set it due today, tomorrow or next week, flag it, move it to another
  list or delete it.
- **Keyboard**: the up and down arrows move between tasks (down from the add field reaches the first one), Space ticks
  the selected task, Enter renames it, Ctrl+I (⌘I on a Mac) shows its details and Delete deletes it.
- **Completing a task** fills its check and leaves the row for a moment, so a second click takes it back. Completed
  tasks fold away under the list; **Clear N completed** in the toolbar removes them.
- **Deleting** a task or a list shows **Undo** at the bottom of the page (Ctrl+Z works too).
- **The inspector** beside the list holds a task's notes, when it is due (today, tomorrow, next Monday or any date,
  picked from the date button), its flag, its list and its subtasks. Dates are written in your computer's regional
  format. Drag tasks to reorder them or move them between lists.
- Tasks Mobius added are dashed until kept. **Discard** puts the list back as it was before that turn.

**Kept in:** `workspace/tasks/`, each list a Markdown file of checkbox lines.

## Calendar

Your calendars by day, week or month.

![The Calendar app in Mobius](../readme/apps/calendar.png)

- **Calendars it works with**: its own (`.ics` files in the workspace), subscribed links (`webcal://` or `https://…ics`,
  read only), and CalDAV accounts with an app password, such as iCloud, Fastmail and Nextcloud. Google and Outlook can
  be subscribed to through their private iCal address; signing in to them directly needs app registrations (see
  [calendar sign-in](../reference/calendar-sign-in.md)).
- **Make an event** by sweeping across the hours, double-clicking a time, right-clicking empty time, or with New event.
  Drag an event to move it, in any view.
- **Open an event** with a click: it edits in a popover beside it. Changes are kept when you click elsewhere or press
  Enter; Escape leaves it as it was. Delete Event is at the popover's foot.
- **The event you clicked stays picked out.** Press Delete to remove it, Enter to open it or Ctrl+D to duplicate it;
  each change can be undone. Right-click an event for Open, Duplicate, Move to another calendar and Delete.
- **The current time** is a red line across the week, with the time written in the hour column. Times follow your
  computer's clock, 24-hour or with AM and PM.
- **What Mobius adds or changes** in a turn is drawn dashed, and Calendar opens on the week of the first change with a
  bar to **Keep** or **Discard** it, as Tasks does for a list. **Show** goes back to it.
- **Suggestions from Mobius** are drawn dashed. Open one to see why, then **Keep** (add it), **Discard** (decline it) or
  **Try another**.

**Kept in:** `workspace/calendar/`, as `.ics` files that other calendar apps can open.

## Sheets

Spreadsheets with formulas.

![The Sheets app in Mobius](../readme/apps/sheets.png)

- Type in the cell or the formula bar. Formulas such as `=SUM(B2:B4)`, `=D2/People!B1` and `=IF(A1>0,"yes","no")` work
  across sheets, with a hint for the function you are in.
- Columns size themselves to fit, and a first row of words over numbers reads as a header. A last row that adds up
  the rows above reads as the total, in bold with a rule above it.
- Each column letter has a menu (hover it for the chevron) to sort by that column, add or delete columns and fit the
  width. Sorting keeps the header and total rows where they are.
- **Number formats**: show a column's numbers as Number (1,234.50), Currency or Percentage from the % button or the
  column's menu. Currency and grouping follow the computer's region. The CSV keeps the plain number.
- **Find** with Ctrl+F: matching cells are tinted, and Enter (or Shift+Enter) moves from one to the next.
- Sheets are tabs below the grid. Insert and remove rows and columns; Ctrl+Z undoes any step.

**Kept in:** `workspace/sheets/`, each workbook a folder and each sheet a CSV file that any spreadsheet app can open.

## Database

SQLite databases you can browse without writing SQL, or query with it. Make one, or import a CSV file or a sheet from
Sheets, and each table opens with three views:

- **Data** shows the rows, 100 to a page. Click a column's heading to sort by it (again for high to low, a third time
  for no order), and type in **Filter rows** to keep the rows where any column holds those words.
  In a table you can change, double-click a cell to type a new value (Enter keeps it, Escape puts it back), and
  **Add row** adds an empty row and opens its first cell. Right-click a cell to edit it, copy its value, set it to
  NULL or delete its row. The last change shows **Undo** at the bottom. From the keyboard the grid is one Tab stop:
  the arrow keys move between cells (Home, End, Ctrl+Home and Ctrl+End jump), Enter or F2 types into a cell, Delete
  sets it to NULL, Ctrl+Delete deletes the row, Ctrl+C copies the value, Ctrl+Z undoes and Shift+F10 opens the menu. A view, or a table made WITHOUT ROWID, is
  shown read-only: change it in SQL.
- **Structure** lists the columns with their types, which ones need a value, defaults and the key, and the statement
  that made the table.
- **SQL** runs any statement and shows what it gave. **History** brings back an earlier one, and **Copy as CSV** copies
  the result.

**Search** at the top of the sidebar finds a database or table by name. Right-click a table, press Shift+F10 on it, or
use its **⋯** button, to open it, copy all of it as CSV, rename it or delete it. Right-click a
database to import a CSV file into it or delete it. Deleting asks first, as it can't be undone.

![The Database app in Mobius](../readme/apps/database.png)

Mobius reads databases through a read-only connection, so a query it writes cannot change anything. Changing data is a
separate tool that asks like any change, and **Keep** or **Discard** applies to the whole file.

**Kept in:** `workspace/databases/`, as SQLite files.

## Projects

A place for one piece of work.

![The Projects app in Mobius](../readme/apps/projects.png)

- **Rules**: how much Mobius may do in each app inside the project (Ask first, Propose or Act). Paying, sending,
  deleting and running commands always ask, whatever a project says.
- **Threads**: the project's conversations. Move an existing conversation in and the project's rules apply to it.
  Right-click a thread and choose **Remove from project** to take it out again: the conversation is kept, and the
  project's rules no longer count in it.
- **Memory**: the project's page in [Knowledge](#knowledge). What Mobius proposes in its threads waits dashed until
  kept.
- **Files**: the project's folder in Files, and a list of what its threads made or changed, newest first.
- **Ask a bot** sends one of your [Agents](assistant.md#agents) off to do something on the side.

The page opens with one line about the project (its threads, what they made, what waits on you and when it last
moved), **New thread**, and **More** (⋯): Rename, Show the folder in Files, Open memory in Knowledge and Delete
project. Right-click a project in the sidebar for the same Rename and Delete, or double-click it to rename. Each part is a grouped list: a thread
shows how many messages it has and when it last moved, and something made shows its app's icon.

Renaming a project renames its folder and its memory page too. Deleting a project asks first, and keeps its threads,
its folder and its memory page: only the project and its rules go. **Rules** lists the apps you have added from
Abilities, plus any other app that already has a rule of its own.

## Knowledge

What Mobius knows: your private **How I work** page, grouped by kind with what Mobius learned waiting on top, and
shared pages such as each project's memory, listed by folder in the sidebar. Lines offered to a shared page wait under
**Suggested changes**. See [Memory and Knowledge](../guide/memory-and-knowledge.md).


![The Knowledge app in Mobius](../readme/apps/knowledge.png)
