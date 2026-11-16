# Demo plan: one moment for every app

How Mobius is shown. The demo used to be one story, a supplier email that becomes tasks and a meeting. That proves the
agent works across apps, but it shows three apps and gives nobody a reason to open the other twenty-five. The demo is
now a tour: **each app gets one moment that makes someone want to use that app.**

The orchestrator keeps this page. Each lead builds the moments in their column and changes a row's status in the same
pull request that makes it true. The order of work is in the [build plan](build-plan.md); the steps before sharing are
in the [launch checklist](../launch.md).

## What a moment is

- **One ask or one gesture, and something real on screen fast.** The first real thing appears within five seconds
  of the ask and the last within fifteen. A moment with several steps (Triage, Plan my day, Compare) may take up to
  thirty, as long as its results arrive one by one from the fifth second and never all at the end. If it needs
  explaining first, it is the wrong moment.
- **The result is a real thing in the app:** a draft, an event, a bassline, a chart, a cut. Never a paragraph of chat
  describing one.
- **It shows the app is good on its own, then that Mobius makes it better.** Two or three seconds of the app being
  used by hand come before the ask.
- **You stay in charge on screen.** What Mobius made is dashed until kept, and at least one of Keep, Discard, Try
  another or Rewind is seen in every moment.
- **Nothing is staged.** A moment is recorded from a build anyone can install, on the demo workspace below. If the app
  can't do it yet, the row says Gap and it is built, not faked.
- **Right every time.** A moment is Have only when its content is right in five runs in a row on one build, and each
  round in `demo/results.md` says how many of its runs were right. Keeping the quickest of several right takes is
  fine. Keeping the one right take among wrong ones is staging. What the app can count or check, it does itself:
  totals, limits and names come from what the tools did, not from the model's sums.

## What is shown, and where

| Piece | What it is | Used |
| --- | --- | --- |
| A clip per app | The app's moment, uncut, light theme, 1440 by 900, pointer visible. It runs from two or three seconds of the app used by hand to Keep: up to 20 seconds for a single step, up to 35 for Plan my day, Triage and Compare. | Beside each app in the README and the app guide; on its own when sharing. |
| The reel | Six to eight of the strongest clips cut together, 60 to 90 seconds, opening on Home and closing on Rewind. It cuts between moments, never inside one. | The top of the README, the release page, launch posts. |
| The cross-app run | The supplier email to tasks to a meeting. No longer the headline. | Mail's moment, and the end-to-end test (`apps/desktop/e2e/demo-workflow.spec.ts`) that every tester build must pass. |

## The demo workspace

Every moment runs on one seeded workspace, so clips agree with each other and anyone can replay them.

- **One made-up small team** with a few weeks of mail, a calendar, task lists, notes, documents, a budget sheet, a
  customer database, a deck, a design, an album, a song, footage, a code project, saved articles and a board. Names are
  invented and nothing is real personal data. The names already in the end-to-end test are reused so the test and the
  clips share one set.
- **It lives in the repo** under `demo/workspace/`, small enough to commit, with footage and audio kept short.
- **Open it in one step:** a "Demo workspace" profile that copies the seed to a fresh folder, so a run never dirties
  the seed and can be reset. *Builder.*
- **Mail and Calendar run on local seeded accounts** in the demo, with no sign-in. Real accounts are a launch step of
  their own.
- *Launch* writes the content. Each lead adds what their moments need and says so in the row.

## The moments

Status: **Have** (works on `main` today, meets the bar and is right five runs in a row), **Partly** (works, but not well enough to show), **Gap**
(has to be built). Rows with a time were last run with a real model on 14 and 15 November 2026 (`demo/results.md`); the
others are a first read that the owning lead corrects.

### First: the apps people open every day

| App | The moment | Needs in the demo workspace | Status | Owner |
| --- | --- | --- | --- | --- |
| Home | Open Mobius in the morning. The desk already shows the one thing worth a look in each app. Ask "Plan my day" and a day appears: mail answered in drafts, tasks given times, a free block held. | Unread mail, tasks due today, a half-full calendar. | Partly: Plan my day is right 4 of 5 at low effort (#472), Keep 13 to 18 s. Needs five in a row and a daytime run for the Focus hour and lunch. | Apps lead |
| Mail | Forty unread. Press Triage: mail is sorted, the three that need you are on top with replies drafted, and the supplier's email has become two tasks and a reply offering a time to meet. Nothing is booked without asking. Nothing is sent until you press Send. | The seeded inbox, with the supplier email. | **Have** (#469, #505): right 20 of 20 with replies drafted in parallel; Keep about 26 s, inside the 35 s clip. | Apps lead |
| Calendar | "Find an hour with Sam this week." Three dashed slots appear in the free time; keep one and it is an event with the invitation drafted. | Two people's calendars with a busy week. | Partly: Find a time with Sam is right, Keep 12.8 s on 0.1.10. Needs five in a row. | Apps lead |
| Tasks | Type "Call Sam tomorrow at 3pm, every week" and watch it become a timed, repeating task. Then Plan my day: today's tasks get times and show as blocks in Calendar. | A list of a dozen tasks, some overdue. | Partly: typed times and repeats work; Plan my day as for Home. | Apps lead |
| Notes | Record two minutes of a meeting. Stop, and the note has the summary, the decisions and a checklist of who does what; one press sends the checklist to Tasks. | A short recording, and a notebook of meeting notes. | Partly: summary and checklist right, Keep 12.6 s. Needs five in a row, and the recording step with a real model. | Apps lead |
| Docs | Select a rough paragraph and ask for it tighter. The new wording is dashed in place; Try another gives a second take; Keep. Then "Make the outline a one-page brief" from the same document. | A long, messy draft. | Partly: Shorter 12.1 s, Try another 8.4 s, brief 16.5 s; the wording fixes passed on 0.1.10 (#458). Needs five in a row. | Apps lead |
| Browser | With three product pages open, ask "Compare these." A table appears in a note, each cell linked to where on the page it came from. | Three saved pages, so the clip does not depend on a live site. | Partly: the table is right, Keep 24.4 s, and links reuse the tab (#490). Needs five in a row. | Apps lead |
| Files | A Downloads folder of sixty files. "Tidy this folder": the moves are shown dashed, by kind and by date; Keep all, then Undo to show nothing is lost. | The messy folder. | Partly: the moves are right, Keep 21 s, over the 15 s bar. Needs a speed pass, then five in a row. | Apps lead |

### Second: the apps that make people say "it does that too?"

| App | The moment | Needs in the demo workspace | Status | Owner |
| --- | --- | --- | --- | --- |
| Music | A four-bar chord loop is playing. Ask for "a bassline under this, and make the pad warmer": a dashed bass part appears and plays in time, and the pad's knobs move on screen. Try another gives a new line without stopping. | A song with drums, chords and a pad. | Partly: right 3 of 5 on 0.1.10, Keep 8 to 13 s. An out-of-key F# twice and a stray line in every reply. | Music |
| Sheets | Select a year of sales and ask "What stands out?" Mobius adds a total row, marks the two odd months and puts a chart beside the numbers, with the formulas it used visible in the cells. | The budget sheet with two odd months. | Partly: total, odd months and chart right, last change 12.5 s, first change over 5 s. Needs five in a row. | Apps lead |
| Slides | Open a document and ask "Make this a deck." Eight slides arrive with layouts chosen and notes written; press Play. | The brief from Docs. | Partly: a deck at Keep 16.8 s on 0.1.12, no rule in the reply (#488). Needs five in a row. | Apps lead |
| Code | A test is failing. Switch to Debug: Mobius runs it, finds the line, and the fix shows as removed and added lines you keep one by one; the test goes green in Glance. | A small project with one failing test. | Partly: right, Keep 8 s. Needs five in a row. | Apps lead |
| Research | Ask one hard question. Tabs open and are read in view, and a report builds with every claim linked to its source. | Nothing; this one uses the live web. A recorded fallback for offline. | Partly: Keep 29.2 s; the report lands at once instead of filling in view. | Apps lead |
| Photo | Open an album of ten photos from one walk and ask "Make these match." All ten change together; hold Show original to prove nothing was lost. | The Jasmund cliffs album: ten uneven photos. | **Have** (#434): right 6 of 6, Keep 5.4 to 6.1 s. | Apps lead |
| Design | Draw one rough frame and ask for "three takes on this." Three frames appear beside it, dashed; keep one and it is ordinary layers you can edit. | A design with one rough screen. | Partly: three takes at 17.3 s, over the bar, and it says it did not look at the frames (#421). The dark version passes on 0.1.12. | Apps lead |
| Video | Drop in five clips and ask for "a thirty-second cut." Shots land on the timeline, trimmed and in order; play it. | Five short clips. | Gap: clip lengths and a clip list are on `main`; a first cut waits on footage. | Apps lead |
| Database | Ask "Which customers haven't ordered since June?" in plain words. The SQL is written where you can read it, and the rows appear under it. | The customer database. | Partly: question, SQL and rows right, answer 6.1 s. Needs five in a row. | Apps lead |

### Third: the apps that show Mobius is safe and yours

| App | The moment | Needs in the demo workspace | Status | Owner |
| --- | --- | --- | --- | --- |
| Activity | After a morning of changes across six apps, press Rewind to here on the 9:00 line. Every app goes back at once. | Run after the other clips, on the same workspace. | Partly: Rewind to here takes 0.8 s on 0.1.10 and the Undo lasts 20 s (#495). Needs checking across six apps. | Builder |
| Review | Everything Mobius changed while you were away, in one list; open one, put one back. | The same run. | Have. | Apps lead |
| Agents | A "Morning brief" agent has run at 8:00 on its own. Its result is waiting to review, with what it was allowed to use listed beside it. | One agent with a schedule and a finished run. | Have. | Apps lead |
| Projects | In one project Mobius may apply changes in Notes but must ask in Mail. The same request does one and stops at the other. | A project with those rules. | Partly: needs checking that the difference is visible. | Apps lead |
| Settings | Change the model from a cloud one to one running on this computer in the middle of a chat, and the chat carries on. Usage shows what the morning cost. | A local model set up. | Have, needs checking. | Builder |
| Abilities | Add a connector and Mobius can use its tools at once, with no restart. Remove an app and its files stay. | One connector that runs offline. | Have (#252). | Apps lead |
| Comments | Press C, pin a comment on a cell, a paragraph and a layer; send one to Mobius and the change comes back with the thread resolved. | Any three documents. | Have, needs checking. | Builder |

### Fourth: small, honest moments for the early apps

| App | The moment | Status | Owner |
| --- | --- | --- | --- |
| Search | One box finds a phrase across mail, notes, tasks and documents; type a question instead and it becomes an ask. | Partly: mail and documents in results need checking. | Apps lead |
| Reader | Save a long article; ask for the five points and what they mean for the open project; the points link back to their paragraphs. | Partly. | Apps lead |
| Knowledge | Mobius builds a page about a customer from your notes and mail, every line with its source; Check against sources flags one that no longer holds. | Gap: Check against sources. | Apps lead |
| Views | "Make a view for the launch": a dashboard of live tiles from Tasks, Calendar, Mail and Sheets. | Gap: asking Mobius to make a view. | Apps lead |
| Canvas | Thirty stickies from a brainstorm; "Group these": they slide into named clusters, dashed until kept. | Gap: needs checking. | Apps lead |
| Terminal | Mobius asks before every command, shows exactly what it will run, and explains an error in plain words. | Have. | Apps lead |

## Order of work

1. **The demo workspace and its profile** (Launch for content, Builder for the profile). Nothing can be recorded
   without it.
2. **A pass over every row** by its owner: try the moment on `main`, correct the status, and list what is missing.
3. **The first group,** in table order. These also carry the cross-app run.
4. **Music, Sheets, Slides, Code and Activity,** the rest of the reel.
5. **Everything else,** strongest first. An app whose moment is still a Gap at launch is labelled "early" in the
   README and left out of the reel, not shown weak.

An app round that builds its moment comes before that app's other rounds on the [apps roadmap](apps-roadmap.md).

## Timing

Each moment is run with a real model on the demo workspace and timed; the runs are in `demo/results.md`. Three times
are written down for every run: the ask to the first real thing, to the last, and to Keep being offered. The first
run of every moment on 14 November 2026 was right in content far more often than in time: single-step moments took 15
to 23 seconds and the several-step ones 29 to 41, with nothing on screen until late. So speed is worked on in the
core before any moment is rewritten to hide it:

1. Know where a turn's time goes: the wait for the model's first words, each round, each tool call.
2. Show each change the moment it is proposed, while the turn carries on.
3. Make independent reads and writes in one round, not one after another.
4. Give the model only the open app's tools and guide, so each round is shorter.
5. Use the quick model for steps that only sort or read.

## Recording

- Clips are recorded from a release build on the demo workspace, uncut, with the pointer visible and no speed-up.
  Waiting is trimmed only by making the app faster.
- The driver ([driving the app](../developers/driving-the-app.md)) replays each moment as a script, so a clip can be
  retaken after any change and the same script is the moment's end-to-end test.
- *Launch* owns the scripts, the cut and where clips appear. Andrew records the final takes on his PC, or approves
  driver-recorded ones.
