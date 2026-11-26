# Projects: status, target day, progress and updates

Projects follow Linear's projects (linear.app/docs/projects, "Project status", "Project progress", "Target dates"):
each project says where the work stands, when it should be done, and how far it has come, set in place on its page.

## Status

Linear's project statuses, in its order: **Backlog**, **Planned**, **In progress**, **Paused**, **Completed** and
**Canceled**, or none. Each has Linear's mark: a dashed ring (Backlog, and no status), a ring (Planned), a half-filled
ring (In progress), two bars (Paused), a filled tick (Completed) and a cross (Canceled), grey except In progress and
Completed in ink. The status chip under the project's line opens a menu with the six, the current one ticked;
choosing it again clears it. A project with a status shows its mark in the Projects panel in place of the app's.

## Target day

A chip with the day in words ("Today", "Tomorrow", "Dec 4", "Jan 15, 2027" in another year) opens the system's date
picker. It turns red once the day has passed while the project is still open (not Completed or Canceled), as Linear
marks a late target. A small × clears it.

## Progress from a Tasks list

Linear counts a project's progress from its issues; in Mobius a project's work is a Tasks list. **Link a task list**
picks one; then the chip names the list (a click opens it in Tasks), with a bar and "3 of 8 done · 38%" beside it, the
list's done tasks out of all. The arrow beside it changes or unlinks the list. Progress follows the list as it changes.

## The Projects panel by status

While no project has a status the panel is one "Projects" list. Once one has, it is grouped as Linear's projects list:
In progress, Planned, Paused, Backlog, then No status, then Completed and Canceled; empty groups are left out.

## Kept

In `projects.json` with the project: `status`, `target` (YYYY-MM-DD) and `list` (the list's name). The core checks
each (one of the six statuses, a real day, a list name without a slash); an empty value clears one
(`projects.setDetails`).

## Updates

As Linear's project updates (linear.app/docs/initiative-and-project-updates: "Create Initiative and Project updates",
"Progress reports", "Project staleness", "Agent assisted updates"):

- **Health**: On track (green dot), At risk (amber) or Off track (red), picked with three radio chips over the words.
  The latest update's health is a chip beside the project's properties; a click goes to Updates.
- **Write an update** opens the form at the top of the Updates card: health, the words (Ctrl+Enter posts), Cancel and
  **Post update**. It starts on the last update's health.
- **What changed since** the last update is added by itself, as Linear's progress report: the status, the target day,
  and the progress when it moved by more than 2 points. It is listed under the form before posting and under each
  posted update after.
- **Write with Mobius** (Linear's "Write with agent") asks Mobius, read-only, with where the project stands, what
  changed, its threads, what side threads reported and the last update. Its draft is dashed with Mobius's mark, its
  health on the first line, and the change bar under it: Discard, Try another, **Keep and edit** (it goes into the
  form to change before posting). Mobius never posts. The conversation it was asked in is deleted once the draft is
  kept or dropped, so it never shows as a thread.
- **The list**: the latest update first, with the earlier ones folded under "Show N earlier updates". Each has its
  health, when (and "edited"), its words and its changes; its ⋯ has Edit update and Delete update (which asks first).
- **Due**: work In progress is due an update a week after the last, or when it has none, as Linear's reminders and
  "Update missing". A quiet amber line says so at the top of Updates.

Kept in `projects.json` under `updates`, oldest first (at most 100): `id`, `at`, `health`, `text`, `edited`, and where
the project stood when it was posted (`status`, `target`, `done`, `total`) so the next one can say what changed. The
core checks the health and that there are words (`projects.addUpdate`, `editUpdate`, `removeUpdate`).

## Later

- Reminders as notifications, and comments on an update.
