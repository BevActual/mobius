# The demo workspace

The data every moment of the tour runs on ([demo plan](../docs/reference/demo-plan.md)): a made-up small team at
Northway Motors building the Kestrel P2. Names are invented and nothing here is real personal data.

Open it in Mobius from **Settings › Advanced › Profiles › Open the demo workspace**. Mobius starts again on a fresh
copy, so a run never changes these files; **Reset the demo workspace** in the same place starts it over. It ships with
every build, so it must stay small: keep footage and audio short.

## What goes where

- `workspace/` is copied as the profile's workspace, so it is laid out the way the apps keep things: `notes/<notebook>/<page>.md`,
  `docs/`, `slides/`, `tasks/`, `calendar/`, `studio/`, `designs/`, `video/`, `photos/`, `code/` and the rest (the
  short guide in `crates/mobius-host/src/workspace_guide.rs` lists each app's files). Make a thing in the app, then copy
  the file it wrote.
- In any text file there (`.md`, `.json`, `.csv`, `.ics`, `.txt`, `.html`, `.yaml`, `.sql`), `{{date:+N}}` and
  `{{date:-N}}` become the date N days from the day the demo is opened, as `YYYY-MM-DD` (as `YYYYMMDD` in an `.ics`
  file, so `DTSTART:{{date:+1}}T090000` works). Use them for due dates and events, so a busy week is always this week.
- `mail/` is one mail account kept on this computer, with no sign-in: `account.json` (`{"name", "email"}`), then
  `inbox/*.eml` and `sent/*.eml`, taken in file-name order. The messages are moved in time together, so the newest
  arrived ten minutes before opening and the rest keep their spacing; avoid naming weekdays in them, which do not
  move. `X-Mobius-Seen: yes` marks one as already read and `X-Mobius-Flagged: yes` flags it. Replies sent in the demo
  stay in its Sent; nothing leaves the computer.

The *Launch* thread writes the content; each lead adds what their app's moment needs.
