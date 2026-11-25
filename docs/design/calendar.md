# Calendar: what comes next

The look for the Calendar round of 25 November 2026 (one app at a time to a refined state, after Docs). The Apps lead
builds it in one pull request for the round; this page is what it should look like. It follows the
[design guide](guide.md), with Google Calendar and Fantastical as the references. Where this page and the guide
disagree, the guide wins.

## The Event panel keeps changes as they are made

The guide's one open item for Calendar.

- **An event in the Event panel** (More options from its popover) keeps each change a moment after the typing stops,
  as Google Calendar's event page and Fantastical do. There is no Save: a quiet grey Saved sits in the panel's action
  row once a change is kept, and Done closes the panel, keeping anything typed since.
- **A repeating event keeps Save**, because each change asks which times it is for, and asking on every keystroke
  would be worse than one Save.
- **A new event keeps Add**, because nothing exists until it is added.
- **The popover** is as before: a click elsewhere or Enter keeps the change, and Escape takes it back.
- **A kept change keeps the file's own form of the times**: a time in UTC (as Google writes) stays in UTC, and a time
  with a named zone (as Outlook writes) keeps its `TZID`, so other apps read the same moment.

## Alerts

As Google Calendar and Fantastical have them: one Alert row in the event, under Repeat.

- **The choices:** None, At the time, 5, 10, 15 or 30 minutes before, 1 hour before, 1 day before. An all-day event
  offers None, On the day (9:00) and The day before (9:00). A new event starts on None. An alert set in another app
  that is not among these shows in words ("2 hours before") until it is changed. Turning All day on or off sets it
  back to None, as the two lists differ.
- **Kept in the calendar file** as a standard `VALARM` with a `TRIGGER`, so other calendar apps ring the same alert;
  alarms Mobius does not show are kept as they were written.
- **When it comes**, the shared pill at the foot of the open app says "{Event} in 10 minutes" (or "{Event} is
  starting", or "{Event} is today" for an all-day event), with Open, which goes to its day in Calendar, and ×. Once per
  alert, for up to two minutes after its time, and gone by itself after a minute. A meeting's own "is starting" nudge
  takes its place when both say the same. Later: a system notification with the same words when Mobius is in the
  background.

## A calendar's own menu

As a notebook's in Notes: ⋯ at the trailing edge of a calendar's row in the Calendars panel, shown on hover or focus,
and the same menu on right-click, Shift F10 or the Menu key.

- **Only the person's own calendars** have it. The default calendar is always there, and an account's calendars
  (CalDAV, Google, Outlook, subscriptions) are managed in Settings, Calendar.
- **Rename** puts the name in a field in place, chosen, with a plain Rename button; Enter keeps it and Esc puts it
  back. The file is renamed with it, and the name inside it (`X-WR-CALNAME`) follows. A hidden calendar stays hidden.
- **Delete calendar** never asks: the calendar and its events go, kept aside, and the Undo pill says "Deleted “Work”
  and 12 events", with Undo.
- Later: a colour of the person's choosing, from the content palette; Unsubscribe in a subscribed calendar's menu.

## Done in this round

| Piece | State |
| --- | --- |
| The Event panel keeps changes as they are made | Built |
| Alerts | Built |
| A calendar's own menu: Rename, Delete with Undo | Built |
