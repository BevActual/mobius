# Projects: status, target day and progress

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

## Kept

In `projects.json` with the project: `status`, `target` (YYYY-MM-DD) and `list` (the list's name). The core checks
each (one of the six statuses, a real day, a list name without a slash); an empty value clears one
(`projects.setDetails`).

## Later

- Project updates with health (On track, At risk, Off track), as Linear's, drafted by Mobius from the threads.
- Group the Projects panel by status.
