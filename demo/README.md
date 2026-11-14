# The demo workspace

One made-up small team, used for every demo clip and the reel, so they all agree with each other and anyone can replay
them. Which moment each app shows is in the [demo plan](../docs/reference/demo-plan.md). Nothing here is real
personal data: the people, companies and addresses are invented, and every domain ends in `.example`.

How it is opened, reset and laid out (`workspace/`, `mail/`, and the `{{date:+N}}` dates) is described by the
Builder's demo profile; this page is the content.

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

## Dates

Everything is dated from the day the demo is opened, with `{{date:+N}}` and `{{date:-N}}`, so "overdue", "today" and
"this week" stay true. The mail moves with it, so no message names a weekday.

## What is here, by moment

| App | Files | For the moment |
| --- | --- | --- |
| Home | everything below | Unread mail, tasks due today, a half-full week. |
| Mail | `../mail/` | Forty unread, three that need you: Priya's brake kit review, Veltro's quote (the price holds until the end of the week), Sam's "find us an hour". |
| Calendar | `calendar/Work.ics`, `calendar/Home.ics`, `calendar/Sam Okafor.ics` | Andrew's busy week and Sam's, for "Find an hour with Sam this week". |
| Tasks | `tasks/Kestrel P2.md`, `tasks/Home.md` | Sixteen tasks: three overdue, some due today with times, one repeating. |
| Notes | `notes/Meetings/`, `notes/P2 build/` | A notebook of meeting notes. |
| Docs | `docs/P2 build/Build brief.md` | A long, wordy draft to tighten, and the source for the deck. |
| Slides | `slides/Talks/P1 lessons.md` | An older deck; the new one is made from the brief in the clip. |
| Browser | `pages/` | Three saved battery pack pages to compare, so the clip needs no live site. |
| Files | `Downloads/` | Sixty untidy files to sort. |
| Sheets | `sheets/P2 budget/`, `sheets/Sales 2025/` | The P2 budget, and a year of sales with two odd months (April low, September high). |
| Database | `databases/Customers.sqlite` | Eighteen customers and their orders; a few haven't ordered since June. |
| Code | `code/kestrel-telemetry/` | A small Python project with one failing test (`test_pack_temperature`). |
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
  rather than the workspace, so they come with the Builder's profile.
- Whatever else the leads list in the demo plan's "Needs" column as they confirm their rows.

Keep it small: short footage and audio, no file over a few megabytes.
