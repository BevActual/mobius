# Tasks: what comes next

The look for the Tasks round of 25 November 2026 (one app at a time to a refined state, after Docs and Calendar). The
Apps lead builds it in one pull request for the round; this page is what it should look like. It follows the
[design guide](guide.md), with Things 3 and Todoist as the references, and Part B of Design's panel-look review of
Tasks. Where this page and the guide disagree, the guide wins.

## When and Deadline

As Things has them: **When** is the day you plan to do a task, **Deadline** is the day it is due. Most tasks need only
one, and they can differ ("plan it Monday, due Friday").

- **When** is a day, or **Someday** (put off, out of the way until you look). Without one a task is **Anytime**.
- **Deadline** is the date the list already had, with its time and repeat as before. A date typed at the end of a new
  task ("Pay rent by fri", "Call Sam tomorrow at 3pm") sets the deadline, as in Todoist's Quick Add.
- **Kept in the list file** after the words: `(when 2026-11-20)` or `(when someday)` beside `(due 2026-11-28)`, so a
  list stays plain Markdown. A ticked-off task keeps the day it was done, `(done 2026-11-25)`, for the Logbook.
- **On a CalDAV list** When is the task's `DTSTART` (Someday is `X-MOBIUS-WHEN:SOMEDAY`, which other apps ignore) and the
  done day is `COMPLETED`.
- **A repeating task** planned for a day with no deadline moves its When to the next day when ticked off.
- **Mobius** can set When too (`tasks.add` and `tasks.update` take `when`).

## The views

The Lists panel's views across every list, in Things' order, then Flagged:

- **Today**: planned for today or before, and anything with a deadline today or past (overdue in red). A task typed here
  is planned for today.
- **Upcoming** (was Scheduled): what is after today, day by day for the week, then by month, each task on the day it is
  planned for, else on its deadline. A day's + adds a task planned for that day.
- **Anytime** (was All): every open task not planned for later and not Someday, list by list.
- **Someday**: what was put off, list by list. A task typed here goes to Someday.
- **Flagged**: as before.
- **Logbook** (was Completed): what was done, the latest first, under the day it was done (Today, Yesterday, the date;
  Earlier for tasks done before the day was kept).

The views keep their old ids, so tiles in Views and the menus still open them. **Your day** in the Mobius panel counts
Overdue, the rest of Today, and Flagged.

## Setting them

- **A row** shows its When in grey beside the deadline ("Fri", "Someday") in lists, Anytime and Flagged; Today, Upcoming
  and Someday say it already.
- **Details** has a When row (a date field, with Today, Tomorrow, Next week, Someday and Anytime) above the Deadline row
  (the date field, its time and repeat, and No deadline).
- **Right-click** a task: Do today, Do tomorrow, Do next week, Someday, Anytime; then Deadline today, tomorrow, next week
  and No deadline.
- **Keyboard** on a selected task, as in Things: Ctrl+T (⌘T) Today, Ctrl+R Anytime, Ctrl+O Someday, Ctrl+Shift+D the
  deadline, Ctrl+↑ and Ctrl+↓ move it within its list (with its subtasks). Space, Enter, Ctrl+I and Delete are as before.
- **Ticking off** shows "Completed “…”" with Undo, as before; Ctrl+Z works too.

## Later

From Design's review, not in this round: Quick Entry from anywhere (B1, with the launcher's "task …"), This Evening in
Today (B3), "every … after done" repeats (B4), projects with headings and progress (B5), saved filters and labels (B6),
the Board view (B7), calendar events greyed above each day in Upcoming (B2), and Assign to Mobius (B10, a seam only, not
approved).

## Done in this round

| Piece | State |
| --- | --- |
| When (a day or Someday) beside Deadline, the done day | Built |
| Today, Upcoming, Anytime, Someday, Logbook | Built |
| Details, the menu and the keyboard for When and Deadline | Built |
