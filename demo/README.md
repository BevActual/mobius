# The demo workspace

One made-up small team, used for every demo clip and the reel, so they all agree with each other and anyone can replay
them. Which moment each app shows is in the [demo plan](../docs/reference/demo-plan.md). Nothing here is real
personal data: the people, companies and addresses are invented, and every domain ends in `.example`.

Open it in Mobius from **Settings › Advanced › Profiles › Open the demo workspace**. Mobius starts again on a fresh
copy, so a run never changes these files; **Reset the demo workspace** in the same place starts it over. It ships with
every build, so it must stay small.

## The story

**Northway Motors** is building **Kestrel P2**, its second electric prototype. Build week is the 23rd, at the
Northfield proving ground. You are **Andrew**, the build lead, the same person the
[end-to-end test](../apps/desktop/e2e/demo-workflow.spec.ts) writes as.

| Who | Role | Address |
| --- | --- | --- |
| Andrew | Build lead (you) | andrew@northway.example |
| Priya Shah | Programme manager, signs off the budget | priya@northway.example |
| Sam Okafor | Motor engineer | sam@northway.example |
| Dana Reyes | Workshop lead | dana@northway.example |
| Ana Ruiz | Hiring | ana@northway.example |

Suppliers: **Veltro Cells** (battery packs), **Ardent Cells** (the cheaper, slower packs), **Axion Motors** (the
150 kW motor), **Orbis Parts**, **Harlow Steel**, **Lumen Glass**, **Pike Fasteners**, **Brakes & Co**, and
**Northfield** (the proving ground and its sled).

## What goes where

- `workspace/` is copied as the profile's workspace, so it is laid out the way the apps keep things: `notes/<notebook>/<page>.md`,
  `docs/`, `slides/`, `tasks/`, `calendar/`, `studio/`, `designs/`, `video/`, `photos/`, `code/` and the rest (the
  short guide in `crates/mobius-host/src/workspace_guide.rs` lists each app's files). Make a thing in the app, then copy
  the file it wrote.
- In any text file there (`.md`, `.json`, `.csv`, `.ics`, `.txt`, `.html`, `.yaml`, `.sql`), `{{date:+N}}` and
  `{{date:-N}}` become the date N days from the day the demo is opened, as `YYYY-MM-DD` (as `YYYYMMDD` in an `.ics`
  file, so `DTSTART:{{date:+1}}T090000` works). Use them for due dates and events, so "overdue", "today" and "this
  week" stay true. `{{workday:+N}}` and `{{workday:-N}}` count working days instead (Monday to Friday, starting from
  the Monday after when the demo is opened on a weekend), so meetings and due dates never land on a Saturday.
- `mail/` is one mail account kept on this computer, with no sign-in: `account.json` (`{"name", "email"}`), then
  `inbox/*.eml` and `sent/*.eml`, taken in file-name order. The messages are moved in time together, so the newest
  arrived ten minutes before opening and the rest keep their spacing; avoid naming weekdays in them, which do not
  move. `X-Mobius-Seen: yes` marks one as already read and `X-Mobius-Flagged: yes` flags it. Replies sent in the demo
  stay in its Sent; nothing leaves the computer.

The *Launch* thread writes the content; each lead adds what their app's moment needs.

## What is here, by moment

| App | Files | For the moment |
| --- | --- | --- |
| Home | everything below | Unread mail, tasks due today, a half-full week. |
| Mail | `../mail/` | Forty unread, three that need you, newest first: Priya's two asks and a call tomorrow at 2 pm, Veltro's quote (the price holds until the end of the week), Sam's "find us an hour". |
| Calendar | `calendar/Work.ics`, `calendar/Home.ics`, `calendar/people/Sam Okafor.ics` | Andrew's busy week, and Sam's (read only for when he is busy), for "Find an hour with Sam this week". Their free time overlaps for an hour or two most days. |
| Tasks | `tasks/Kestrel P2.md`, `tasks/Home.md` | Sixteen tasks: three overdue, some due today with times, one repeating. |
| Notes | `notes/Meetings/`, `notes/P2 build/` | Meeting notes; `Kestrel P2 stand-up` is today's stand-up as it was said: three decisions, four actions with names and days. |
| Docs | `docs/P2 build/Build brief.md` | A long, wordy draft (about 1,500 words) to tighten, the source for the one-page brief and the deck. |
| Slides | `slides/Talks/P1 lessons.md` | An older deck; the new one is made from the brief in the clip. |
| Browser | `pages/` | Three saved battery pack pages to compare, so the clip needs no live site. |
| Files | `Downloads/` | Sixty untidy files to sort. |
| Sheets | `sheets/P2 budget/`, `sheets/Sales 2025/` | The P2 budget, and a year of sales with two odd months (April low, September high). |
| Database | `databases/Customers.sqlite` | Eighteen customers and their orders; a few haven't ordered since June. |
| Code | `code/kestrel-telemetry/` | A small Node project with one failing test (`pack temperature`, a sign error); `npm test` needs nothing installed. |
| Music | `studio/Songs/Demo.json` | Four bars at 96 bpm in A minor: drums, chords and a bright pad, and no bass, so Mobius can add one. From the Music lead. |
| Design | `designs/Kestrel app/Charging screen.json` | One rough phone screen to ask three takes on. |
| Canvas | `boards/Kestrel/P2 brainstorm.json` | Thirty stickies from a brainstorm, to group. |
| Reader | `reading/Saved/Why battery packs ship by sea.md` | A saved article to ask about. |
| Views | `views/Views/Today.json` | A starting dashboard. |

## Still to add

- **Photo:** twelve uneven photos from one shoot (an album "Chassis build"). Needs real, freely licensed photos.
- **Video:** five short clips for a thirty-second cut. Needs real footage, a few seconds each.
- **Notes:** a two-minute meeting recording.
- **Projects, Agents, Abilities and Settings:** a project with different rules for Notes and Mail, a "Morning brief"
  agent with a finished run, a connector that runs offline, and a local model. These live in the profile's settings
  rather than the workspace, so the Builder adds them to the profile.
- Whatever else the leads list in the demo plan's "Needs" column as they confirm their rows.

Keep it small: short footage and audio, no file over a few megabytes.

Every moment's real-model runs, with their times and what was weak, are in [results.md](results.md).
