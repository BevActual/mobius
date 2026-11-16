# Build plan

The one plan above every other plan: what Mobius is working on now, in what order, who owns each part and what waits
on what. The orchestrator keeps this page. The public direction is the [Roadmap](../roadmap.md); the detail for each
app is the [Apps roadmap](apps-roadmap.md) and, for Music, the [Music roadmap](music-roadmap.md). When those pages and
this one disagree about order or ownership, this page wins and the other page gets corrected.

## Direction

- **Add an app when it earns its place.** The apps that exist still come first, but a new app is welcome when it makes
  sense or is needed, and every idea is first checked against the apps that exist. See
  [A new app, or part of one that exists](#a-new-app-or-part-of-one-that-exists).
- **Connect to what people already run.** Each app works with the services and the infrastructure a person or a team
  already has, their own servers included, through open standards first. Mobius never requires a Mobius account or a
  Mobius server. See [Connections](#connections).
- **One look.** [Instrument](../design/instrument.md) and the [design rules](../design/rules.md) decide how everything
  looks. Apps never hand-build the panel, the composer, slots, cards, drawings or controls.
- **The Mobius panel is just Mobius.** It has no tabs and holds only Mobius: the chat, its cards and slots, and the
  composer. An app's own panels (Format, Device, Inspector, Outline, Highlights) live elsewhere in the frame.
- **One library.** Shared controls live in `apps/desktop/src/ui/`. A gap is fixed in the library, never patched in an
  app. Music is where the library is proven.
- **Everything in the repo.** Specs, mocks and screenshots live under `docs/` and in pull requests.
- **Parked:** model-provider connections beyond what works today, the Copilot and Hugging Face sign-in test, the
  canvas.

## Who owns what

| Lead | Owns | Does not do |
| --- | --- | --- |
| Builder | The shell, the core, CI, releases and every merge. | App rounds; library controls. |
| Design lead | Design review of every pull request with a screen, `docs/design/`, and the shared library in `apps/desktop/src/ui/`. | App code; shell state. |
| Apps lead | Every app except Music: the Apps roadmap and one pull request per app round. | Library controls; shell or core changes beyond small marked edits. |
| Music | The Music app and the Music roadmap. Finds what the library lacks by using it. | Library controls of its own. |
| Launch | The README, user docs, the demo, the launch checklist and release notes. | Product code. |

Only the Builder merges. App, shell, CI and docs pull requests merge without asking once they are green and, where
they show a screen, have passed design review. A release waits for Andrew.

## Priorities

Work is taken in this order. A lower line never holds up a higher one.

1. **Keep `main` green and the queue short.** An open pull request that is green and reviewed lands before new work
   starts. A flaky test is fixed, never skipped.
2. **The demo: one moment for every app.** Each app is shown by the one thing that makes someone want to use it,
   listed in the [demo plan](demo-plan.md). The round that builds an app's moment comes before that app's other
   rounds, in the demo plan's order: Home, Mail, Calendar, Tasks, Notes, Docs, Browser and Files first.
3. **One wording and one set of controls everywhere.** The Permission names, shared selects and shared date fields
   replace what is left of the old ones, in the apps and in the docs.
4. **The shell pieces apps are waiting on,** in the order under [Shell queue](#shell-queue).
5. **Music's next instruments and the library pieces they prove,** in the order under [Library queue](#library-queue).
6. **The daily apps' next features** (Docs, Notes, Files, Browser), then every other app, then the five apps with no
   round yet.

## Now

As of the evening of 14 November 2026, Pacific time. On `main` since the last refresh: the speed steps (calls run as
they are written, reads fetched ahead, one round for a suggestion, only the open apps' tools), WebDAV drives with the
Files screens, tools for Photo and Design, Music's folded round, the design for two-way sync, and the rule for
[a new app or part of one that exists](#a-new-app-or-part-of-one-that-exists).

Where the moments stand after real-model rounds 13 to 15: Code and Notes meet the bar, Plan my day meets the time,
and Triage is right in content but shows its first change at 25 seconds.

| Item | Owner | Status | Unblocks |
| --- | --- | --- | --- |
| Triage's first change within five seconds | Builder for the turn, Apps lead for Triage's instructions | Next: the second round writes for 24 s before anything shows | Mail's moment and the reel |
| Changes dashed in the app as they land | Apps lead | Notes and Photo on `main`; Tasks, Calendar, Mail, Docs, Sheets and Files to follow | Plan my day and Triage arriving one by one |
| Timing again, on today's `main`: Calendar, Docs, Slides, Browser, Files, Sheets | Launch | Next; these were last timed before the speed steps | Knowing which moments still need work |
| First real-model runs: Music, Photo, Design, Database, Research, Rewind | Launch, with each owner's script | Next | The rest of the reel |
| A daytime run of Plan my day, and the model on this computer | Launch | Scheduled for Sunday 15 November | Home's and Settings' moments |
| Content fixes from the runs (`demo/results.md`) | Apps lead | Building | Recording |
| A before and after hold | Design lead | Next | Photo's moment |
| Two-way sync of workspace folders; S3-style storage | Builder, then Apps lead for Files | Have: both on `main`; the soak test against real servers (Nextcloud, wsgidav) is #478 | Notes, Docs and the rest on a person's own server |
| Unstable tests: `database.spec` | Builder | Open | Every pull request |
| Clips and the reel | Launch | After a moment meets the bar | The README and launch |
| Meetings in Calendar and Notes, contacts in Mail and Calendar, the Messages app | Apps lead, Builder for the contacts store | The contacts store is building now; the rest after the demo moments, in that order | |

## Shell queue

The Builder's order. Earlier rows (app modes, row sizes, the slots, failed runs, live connectors, the demo profile,
`files.move`, finding a time) are on `main`.

| Order | Piece | Who waits | Status |
| --- | --- | --- | --- |
| 1 | Turn speed, in the demo plan's order: Triage's first change next | Every demo moment | Building |
| 2 | Tools for Photo and Design | Their demo moments | Building |
| 3 | Drives: two-way sync, then S3-style storage ([Drives](#drives)) | Files, and every app that keeps plain files | Have: WebDAV, sync and S3 on `main`. Sync soaks against Nextcloud and wsgidav nightly (#478) |
| 3a | The contacts store: one `.vcf` per contact, an index, CardDAV on the sync code, and bridge calls for Mail and Calendar | Contacts in Mail and Calendar | Building |
| 3b | Task lists over CalDAV | Tasks on the same servers as Calendar | Building: a CalDAV account's task lists show in Tasks and every change goes to the server first |
| 3c | Cloud drives (Dropbox, OneDrive, Google Drive) and Google and Microsoft sign-in for Mail and Calendar | Those services | Waiting on Andrew registering Mobius: the steps are in [Drive and calendar sign-in](drive-sign-in.md) |
| 4 | Video: clip lengths and a clip list, then a first cut | Video's demo moment | Building; the cut waits on footage |
| 5 | Unstable tests in [testing](../developers/testing.md): three sightings makes one a blocker | Every pull request | Ongoing |

## Library queue

The Design lead's order for library pieces. A piece is built when an app round is ready to use it, and lands before
that round's pull request.

| Order | Library piece | First user |
| --- | --- | --- |
| 1 | Anything an open pull request is waiting on | That pull request |
| 2 | `Chart` | Sheets' demo moment; Views tiles |
| 3 | A before and after hold | Photo's demo moment |
| 4 | Mixer strip built on `LevelMeter` | Music: mixer view |
| 5 | A folded `DeviceFrame` as a strip | Music: devices in the bottom dock |

`StepGrid`, `PadGrid`, `AutomationLane` and `LetterToggle` are already on `main`.

Music's note editor already exists inside Music. It moves into the library only when a second app needs it or Music's
next round has to change it; until then it is not a library task.

## A new app, or part of one that exists

Andrew replaced "no new apps for now" on 15 November 2026. A new app is added when it makes sense or is needed, and
the same question is asked the other way about what exists: does this belong inside another app? Any lead may propose
either. The proposal is a few lines in a pull request to this page, answering the questions below.

**Fold it into an app that exists when most of these are true:**

- It works on the same things that app already holds: the same messages, events, files or notes.
- A person would look for it there, and would reach it from that app's toolbar, sidebar or inspector.
- It fits as a view, a mode or a panel, and the app is still easy to explain in one sentence afterwards.
- It has no moment of its own: shown alone for ten seconds, it would not make anyone want it.

**Make it a new app when most of these are true:**

- It holds a kind of thing no app holds yet, with its own list, its own open document and its own settings.
- A person opens it on purpose, as a job in itself, and other apps would link to it more than contain it.
- Two or more apps need it equally, so putting it inside one would hide it from the other.
- It has a moment of its own that could stand in the [demo plan](demo-plan.md).
- Folding it in would make the host app harder to explain or crowd its toolbar.

**Either way:**

- Shared data goes in the core, not in an app, so the answer can change later without moving anyone's data.
- A new app starts in Abilities, not in the default set, and is labelled "early" until its moment is a Have.
- A new app arrives whole: Instrument from the first screen, library controls only, a section under `docs/apps/`, a
  row in the Apps roadmap and a moment in the demo plan.
- The same test runs on the apps that exist. An app that has no moment of its own and is mostly opened from another
  app is a candidate to fold in, and is proposed the same way.
- It does not jump the queue. A new app takes its place under [Priorities](#priorities); it never comes before a
  demo moment or holds up `main`.

The orchestrator decides the clear cases and places the work. Andrew decides when the answer changes what Mobius is
to a newcomer: a new app in the default set, an app removed or merged away, or a new kind of data Mobius keeps.

Waiting for this test now:

| Idea | The question | Who proposes |
| --- | --- | --- |
| Search, Research, Review, Terminal, Canvas, Reader, Knowledge, Views | Whether each keeps standing alone, checked when its first round comes up | Apps lead |

### Decided

The Apps lead proposed these and Andrew decided them on 15 November 2026, as proposed. The work is placed in the
[Apps roadmap](apps-roadmap.md) and under [Connections](#connections). The order is the demo moments and live marks
first, then Meetings (Notes' demo moment), then People once the core store is built, then Messages.

**People: an address book in the core, shown inside Mail and Calendar. No app for now.** Decided by Andrew, 15 November 2026.
- For: contacts are a new kind of thing, and Mail and Calendar need them equally.
- Against: nobody opens an address book as a job in itself, and ten seconds of a contact list impresses no one.
- The data lives in the core, synced over CardDAV with the person's own server (Nextcloud, Fastmail, iCloud). The
  Builder confirmed the core side:
  - one `.vcf` file per contact under `workspace/contacts/<book>/`, so checkpoints, Keep, Rewind and sync cover it;
  - a CardDAV account that shares most of its code with CalDAV;
  - `contacts.*` bridge calls, including a `byEmail` lookup, with saving behind the usual permission;
  - vCards that keep every field Mobius doesn't show;
  - about two or three Builder pull requests, roughly a day.
- It shows up where people already look:
  - names fill in as you address an email or invite someone;
  - a person card opens from a sender or an attendee, with recent mail and meetings together;
  - Mobius can use it ("email Priya the deck").
- A People app can follow if a moment of its own turns up, and nothing has to move when it does.

**Messages: its own app, early, in Abilities, after the demo.** Decided by Andrew, 15 November 2026.
- Chat is a new kind of thing: channels and threads that move in real time, with reactions and mentions. Putting it in
  Mail would crowd Mail's toolbar and make Mail harder to explain.
- People open chat on purpose, and it has a moment of its own: "catch me up" turns 300 messages across Slack, Discord
  and Telegram into five lines and two replies to send.
- Accounts use each service's official API, and only the person sends.
- Mail's Triage can read Messages later through the core, so one Triage could cover both.

**Meetings: fold it into Calendar and Notes. No app.** Decided by Andrew, 15 November 2026.
- A meeting is an event plus its notes, and both already exist. Recording is one more button.
- An event gets Record. The transcript and a summary land in a note linked to that event. Actions go to Tasks, waiting
  for Keep.
- Notes gets the same Record for a meeting that isn't in the calendar.
- No new kind of data: the audio is a file and the summary is a note.
- Its moment would be "after the call, notes and three tasks are waiting". That belongs to Calendar's or Notes' demo
  line rather than a new app's.

**The early apps** (Search, Research, Review, Terminal, Canvas, Reader, Knowledge, Views) each get the same test when
their first round comes up, with the answer added here.

## Rules that keep leads out of each other's way

- **Shared files have one owner.** `apps/desktop/src/ui/` is the Design lead's; the shell and the core are the
  Builder's. An app round may make a small marked edit to a shared file that serves only that app, and lists it in the
  pull request body.
- **Library first, then the app.** When a round needs a new control, the library pull request lands first and the app
  pull request is cut from `main` after it.
- **One round per app at a time.** A second round on the same app waits for the first to merge.
- **Cross-app rounds go one app per pull request,** so a failure in one app holds up only that app.
- **Docs move with the work.** A round updates its line in the Apps or Music roadmap, the app's page under `docs/apps/`
  and its README screenshot in the same pull request.
- **One push per pull request, after local checks.** Before pushing, run the type check, the unit tests and the
  end-to-end spec you touched. Fixes after review go up as one push, not several. Each push cancels the run before
  it, and a cancelled run shows red to Andrew.
- **No stacked pull requests.** A branch is cut from `main`. If it needs another pull request, it waits for that one
  to land.
- **Unstable tests come before features.** A test with three sightings in [testing](../developers/testing.md) is a
  blocker for its owner: nothing else of theirs starts until it is fixed, or has a named cause and a date.
- **The author tells the Builder when a pull request is opened,** and the Builder subscribes to it, so a green run
  wakes the Builder.
- **A stall is raised, not waited out.** A lead blocked for more than one round on another lead says so to the
  orchestrator, who reorders the queues above.

## Process health

The orchestrator and the Builder keep runs going smoothly as standing work. The Builder counts a day's Actions runs
by cause; the orchestrator changes the process when a cause shows up, and tells Andrew only when the picture changes.

| Day (UTC) | Runs | Cancelled | Failed | What the failures were |
| --- | --- | --- | --- | --- |
| 14 to 15 November 2026 | About 2,900 | 789: 290 on `main`, 499 on pull requests | 46 | 33 unstable end-to-end tests, 2 unstable Rust tests, 9 real bugs caught before merge, 2 guards in Checks. None from two pull requests that passed apart, from conflicts or from the runners. |
| 15 November 2026, 01:27 to 22:05 | 600 (the count stops there) | 58: 27 on `main`, all before the 04:28 change, 31 on pull requests (9 after 04:28) | 4 | 3 unstable tests: `server.rs:200` (fixed), `database.spec.ts:27` (fixed by #397), the device sign-in test (fixed by #449). 1 a pull request's own new test (app/music-demo). Passed only on retry: `shell.spec.ts:96`, `tasks.spec.ts:152` and one type check. No open blocker. |

What changed on 15 November 2026 (#415):

- `main` never cancels its own runs, so every merged commit is tested.
- Checks runs once per pull request, on the merge with `main`.
- A failed end-to-end test is retried once, and a test that passed only on its retry is listed in the run summary
  and counted as a sighting.
- The three rules above this section: one push per pull request, no stacked pull requests, unstable tests first.

Aims for the next count: no cancelled run on `main`, cancelled pull request runs under 100 a day, and no unstable
test open past three sightings. All three were met on 15 November after 04:28. Landing pull requests as a tested batch was considered and left out, because no
failure came from pull requests that passed apart; it comes back if one does.

## Docs that no longer match

| Page | What is out of date | Owner |
| --- | --- | --- |
| [Roadmap](../roadmap.md) | Says "three modes (Ask first, Propose, Act)" and names Apple's guidelines as the look. The composer now has Mode and Permission, and the look is Instrument. | Launch |
| [The bar for each app](app-bar.md) | Polish is described as "feels like an Apple app". It should point at Instrument. | Design lead, fixed in #242 |
| README and `docs/guide/` | Any use of the old mode names. | Launch |

## Launch

What has to be true before Mobius is shared widely. The Launch lead keeps the checklist; this is the order.

| Step | Owner | Waiting on |
| --- | --- | --- |
| The cross-app run works end to end on real accounts: mail in, tasks made, time blocked, drafts ready | Apps lead, Builder | App modes; the Mail, Tasks and Calendar rounds |
| README shows every app in the current look | Launch | Nothing |
| First run takes five minutes or less from install to a first answer | Builder, Launch | Nothing |
| A clip of each app's moment and a 60 to 90 second reel of the best ([demo plan](demo-plan.md)) | Launch | The demo workspace; each app's moment |
| Signed Windows installer | Builder | Andrew: the SignPath application |
| v0.1.0 published | Builder | Andrew: Publish on the draft release |
| Google and Microsoft calendar sign-in | Builder | Andrew: registering Mobius with each ([what it needs](calendar-sign-in.md)) |

## Connections

Mobius is the apps and the agent. The data can stay where it already lives: a mail provider, a company server, a
Nextcloud, a home machine. Open standards come before one-off integrations, so one piece of work reaches many services.

| App | Connects today | Next, in this order | Owner |
| --- | --- | --- | --- |
| Mail | Any provider over IMAP and SMTP, with ready-made settings for the common ones | Sign-in for Google and Microsoft accounts, waiting on Andrew registering Mobius ([steps](drive-sign-in.md)) | Builder |
| Calendar | CalDAV (iCloud, Fastmail, Nextcloud, any server), subscribed links, its own files | Google and Microsoft sign-in | Builder, waiting on Andrew registering Mobius with each ([steps](drive-sign-in.md)) |
| Files | The workspace folder on this computer; WebDAV and S3-style drives you browse, open from and copy to; two-way sync of chosen folders with either | See [Drives](#drives) below | Builder for the connection, Apps lead for Files |
| Tasks | Its own files | Task lists over CalDAV, so tasks sync with the same servers as Calendar (next after contacts) | Builder, Apps lead |
| Models | A dozen services, sign-in with ChatGPT or Claude, OpenRouter, local models, and any server that speaks the common chat format | Nothing scheduled | Builder |
| The agent | Connectors (MCP), started and stopped live | Connectors over HTTP with sign-in, so a team's own tools and data are one address away | Builder |
| People | Nothing: there is no address book | An address book in the core over CardDAV (one `.vcf` per contact in `workspace/contacts/`), shown inside Mail and Calendar; no People app for now ([decided](#decided)). Building | Builder for the core, Apps lead for Mail and Calendar |
| Messages | Nothing yet | Slack, Discord and Telegram on their official APIs, in a Messages app (early, in Abilities, after the demo; [decided](#decided)) | Builder for the accounts, Apps lead for the app |
| Notes, Docs, Sheets and the rest | Plain files in the workspace | They follow Files: once the workspace can live on WebDAV, so do they | |

### Drives

Every kind of drive sits behind one interface, so Files, Mobius's drive tools and sync work the same on all of them.
Mobius reads a drive freely and asks before every change on one. In order:

| Order | Drive | Needs | Status |
| --- | --- | --- | --- |
| 1 | WebDAV: Nextcloud, ownCloud, a NAS, Fastmail Files | A server address and an app password | Have |
| 2 | Two-way sync of chosen workspace folders with a drive, so Notes, Docs and the rest can live on a server. The local folder stays the working copy; a conflict keeps both. | Nothing | Have: on `main` since 15 November 2026, soaked nightly against Nextcloud and wsgidav |
| 3 | S3-style storage (Amazon S3, Backblaze B2, Cloudflare R2, MinIO) | Keys the person pastes; no registration | Have: browse, copy and sync, with multipart upload for big files |
| 4 | Dropbox | Andrew registering Mobius with Dropbox ([steps](drive-sign-in.md#dropbox)) | Waiting on the registration |
| 5 | OneDrive and SharePoint | Andrew registering Mobius with Microsoft, the same registration Calendar sign-in needs ([steps](drive-sign-in.md#microsoft)) | Waiting on the registration |
| 6 | Google Drive: the files people pick (`drive.file`, Andrew's choice on 16 November 2026), opened through Google's picker; no folder browsing or sync. Whole-Drive access is a later decision, because Google requires a paid security assessment every year for it | Andrew registering Mobius with Google ([steps](drive-sign-in.md#google)). Testing works now; publishing needs a domain | Waiting on the registration; the picker flow is built after the contacts store |
| 7 | Network shares (SMB) | Nothing | Later |

Cloud drives sign in on the service's own page and Mobius keeps only the token, in the system's secret store. Sync is
built against the drive interface, not WebDAV, so each drive added after it can sync too.

This work started after the first group of the [demo plan](demo-plan.md). WebDAV for Files is first because it opens the
most with one piece: every app that keeps plain files gains a server.

## Later

Not scheduled. Each needs a decision before it starts.

- The macOS release.
- Tauri v3, once it is released.
- The Chromium engine in the installer.
- Plugins in Abilities.
- Subagents.
- Sync between devices and a self-hosted Mobius server, the step from working with a Nextcloud to standing in for one.
- A first Instrument round for Search, Research, Review, Terminal and Canvas.

### Paying for Mobius, later

Andrew's direction on 16 November 2026. Not scheduled, and nothing is built for it yet.

- **Mobius stays MIT open source.** Anyone can use, change and share every app and the agent, with no account. Nothing
  that works today moves behind a payment.
- **Money comes from services around it**, sold on the Mobius website: sound packs and third-party plugins for Music,
  add-ons for other apps, and later a Mobius AI service as one more choice beside the model services people bring.
- **A store inside Mobius too.** It lives in Abilities, beside the apps, connectors and skills already there, and sells
  the same packs, plugins and add-ons as the website, which holds the account and the purchase.
- **What this asks of today's work:** the website Launch drafts leaves room for a store, accounts and sign-in later;
  the domain is chosen for the product, not one page; Plugins in Abilities (above) are designed so that free and paid
  plugins install the same way; a paid service is always optional and never the default.
- **Each piece needs a decision before it starts**, and comes after launch.
