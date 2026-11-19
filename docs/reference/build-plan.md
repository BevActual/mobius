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
| Design lead | Design review of every pull request with a screen, `docs/design/`, the shared library in `apps/desktop/src/ui/`, and the findings that start each app's polish pass. | App code; shell state. |
| Apps lead | Every app, Music included (folded in by Andrew, 17 November 2026): the Apps roadmap and one pull request per app round. | Library controls; shell or core changes beyond small marked edits. |
| Launch | Andrew's PC (installs, checks a change to what is sent to the model), signing, the site, the demo at launch and release notes. | Product code. |
| Docs lead | The README and `docs/` outside the plans: clear, current and tidy. | Product code. |

### How work flows between threads

Set 19 November 2026, to keep the threads lean.

- **Leads talk to each other directly** about the work between them: the author tells the Builder a pull request is
  up; the Builder tells Launch which commit to install; the Design lead sends its findings straight to the Apps lead.
  Nothing goes through the orchestrator unless it changes the plan or needs a decision.
- **The orchestrator hears results and decisions only:** a piece of the Now list done, a blocker, or a choice that
  changes the plan. Progress belongs in each thread's own checklist.
- **Andrew hears only real decisions** and the daily summary, through the coordinator.
- **The daily CI count is one line when every aim is met,** and a table only when one is missed.
- **Every lead keeps its next item queued.** When one item lands, the next starts without asking, from this plan.
- **A thread whose work is done or folded is resolved,** not left idle: Music (folded into the Apps lead) and Azure
  setup (waiting on Microsoft, now Launch's to watch).

Only the Builder merges. App, shell, CI and docs pull requests merge without asking once they are green and, where
they show a screen, have passed design review. A release waits for Andrew.

## Priorities

Work is taken in this order. A lower line never holds up a higher one.

1. **Keep `main` green and the queue short.** An open pull request that is green and reviewed lands before new work
   starts. A flaky test is fixed, never skipped.
2. **Build the product.** Finishing apps, the shell and connections comes first (Andrew, 18 November 2026: "focus on
   getting it done instead of constantly running a demo"). Each app's [demo moment](demo-plan.md) is a feature like
   any other: it is built, covered by unit and end-to-end tests, and lands on its tests. There are no real-model
   reliability rounds while building; Launch runs each moment once on a real model just before recording, at launch.
3. **One wording and one set of controls everywhere.** The Permission names, shared selects and shared date fields
   replace what is left of the old ones, in the apps and in the docs.
4. **The shell pieces apps are waiting on,** in the order under [Shell queue](#shell-queue).
5. **Music's next instruments and the library pieces they prove,** in the order under [Library queue](#library-queue).
6. **The daily apps' next features** (Docs, Notes, Files, Browser), then every other app, then the five apps with no
   round yet.

## Now

As of 19 November 2026. Building comes first; demo runs are stopped until recording.

On `main` since 18 November: apps own their panels and the rail is gone (#520, #526 to #531), the launcher from
anywhere with each app's finds and commands (#566 to #574, #581, #582), first run (#577), Meetings (#533, #535),
contacts in Mail and Calendar (#530, #565), the Messages app with Slack, Matrix (encrypted rooms and bridges),
Teams chats and Telegram (#537, #548, #583 to #591), the tray (#589), an installer that waits for Mobius to close
(#579) and the prompt-injection guard (#592, #593).

| Item | Owner | Status |
| --- | --- | --- |
| Polish each app's UI and UX, one app at a time: the Design lead reviews the app on `main` and sends findings, the Apps lead fixes them in one pull request, then the next app. Order: Home, Mail, Calendar, Tasks, Notes, Docs, Files, Browser, Messages, then the rest | Design lead, Apps lead | Starting with Home |
| Fixes from Andrew using the installed build every day | Apps lead, Builder for the shell | Ongoing, ahead of the polish pass |
| The Builder's queue below: updates while in the tray, then agents that run from the tray | Builder | Next |
| Launcher step 7, and the first-run screens' look | Design lead | Building |
| Design and Research weak points, Database's Analyse mode | Apps lead | Next |
| Sign-in for Google, Microsoft (with Teams chats) and Dropbox; Telegram keys | Builder | Built; waits on Andrew ([drive sign-in](drive-sign-in.md), [messages sign-in](messages-sign-in.md)) |
| Clips and the reel | Launch | At launch, after one real-model run of each moment |

## Shell queue

The Builder's order. Everything in earlier versions of this table (turn speed, tools for Photo and Design, drives
and sync, contacts, CalDAV task lists, the cloud drives) is on `main`.

| Order | Piece | Who waits | Status |
| --- | --- | --- | --- |
| 1 | Updates in the app: Mobius checks, downloads and verifies signed updates itself, and Settings › About has Check for Updates (`updater.rs`). Left: since closing the window keeps Mobius in the tray, a waiting update installs at the next start with Windows, and the tray menu says Restart to update | Everyone who installs Mobius | Have; the tray gap is next |
| 2 | Agents that run on their schedule from the tray while the window is closed, with a notice when a result waits to review | Agents, Home's desk | After 1 |
| 3 | Take over beside Stop: the person steps into a running turn, edits the next step or finishes it by hand | Every app | After 2 |
| 4 | Video: a first cut | Video's moment | Waits on footage |
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
- **Merge when ready, and keep branches few** (Andrew, 17 November 2026). A pull request lands as soon as it is green
  and its result is in; a draft waiting on a test run says so in its first line. Each lead has at most two open
  pull requests at a time. A branch lives only as long as its pull request: the branch cleanup workflow deletes it
  and its `ci-screens/` branch when the pull request closes, and a closed one can be restored from its page.
  Superseded drafts are closed, not left open. Long-lived branches are `main` and the demo recording branch only.
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
| The name: Mobius Workspace at mobiusworkspace.com ([below](#the-name)) | Launch | Andrew: registering the domain; a trademark attorney's clearance before any filing or branding spend |
| Signed Windows installer | Builder | Andrew: the SignPath application |
| v0.1.0 published | Builder | Andrew: Publish on the draft release |
| Google and Microsoft calendar sign-in | Builder | Both built, tested against a pretend Google and a pretend Microsoft Graph. Both wait on Andrew registering Mobius ([what it needs](calendar-sign-in.md)) |

### The name

Settled by Andrew on 16 November 2026: **no rename.** The product stays Mobius, its public name is **Mobius
Workspace**, and its home on the web is **mobiusworkspace.com**, which Andrew registers himself.

- The app keeps calling itself and its agent Mobius. "Mobius Workspace" is used where the full name helps a newcomer:
  the website, the README title, the installer and store listings.
- Rocket Software holds live MOBIUS trademarks for software. The longer name sets Mobius Workspace apart, but a
  trademark attorney's clearance comes before any trademark filing or spending on the brand.
- Launch points `site/` at mobiusworkspace.com once Andrew owns it. The Builder's rename sizing
  (`/mnt/project-files/builder/rename-sizing.md`) is kept in case the name is ever revisited.

## Connections

Mobius is the apps and the agent. The data can stay where it already lives: a mail provider, a company server, a
Nextcloud, a home machine. Open standards come before one-off integrations, so one piece of work reaches many services.

| App | Connects today | Next, in this order | Owner |
| --- | --- | --- | --- |
| Mail | Any provider over IMAP and SMTP, with ready-made settings for the common ones | Sign-in for Google and Microsoft accounts, waiting on Andrew registering Mobius ([steps](drive-sign-in.md)) | Builder |
| Calendar | CalDAV (iCloud, Fastmail, Nextcloud, any server), subscribed links, its own files | Google and Microsoft sign-in | Builder, waiting on Andrew registering Mobius with each ([steps](drive-sign-in.md)) |
| Files | The workspace folder on this computer; WebDAV, S3-style, Dropbox, OneDrive and SharePoint drives you browse, open from and copy to; two-way sync of chosen folders with any of them. Dropbox, OneDrive and SharePoint work once Andrew registers Mobius with each | See [Drives](#drives) below | Builder for the connection, Apps lead for Files |
| Tasks | Its own files | Task lists over CalDAV, so tasks sync with the same servers as Calendar (next after contacts) | Builder, Apps lead |
| Models | A dozen services, sign-in with ChatGPT or Claude, OpenRouter, local models, and any server that speaks the common chat format | Nothing scheduled | Builder |
| The agent | Connectors (MCP), started and stopped live: programs on this computer, and servers at an address (Streamable HTTP), added by address in Abilities, with a key or a sign-in (OAuth, as MCP describes it) | Nothing scheduled | Builder |
| People | Nothing: there is no address book | An address book in the core over CardDAV (one `.vcf` per contact in `workspace/contacts/`), shown inside Mail and Calendar; no People app for now ([decided](#decided)). Building | Builder for the core, Apps lead for Mail and Calendar |
| Messages | Slack, Matrix (encrypted rooms, bridges), Teams chats; Telegram (grammers) built, waiting on its api_id and api_hash | Slack, Matrix, Teams chats via Graph, then Telegram (grammers, pure Rust); Discord, WhatsApp and Signal through the person's own Matrix bridges ([decided](#decided)) | Builder for the accounts, Apps lead for the app |
| Notes, Docs, Sheets and the rest | Plain files in the workspace | They follow Files: once the workspace can live on WebDAV, so do they | |

### Drives

Every kind of drive sits behind one interface, so Files, Mobius's drive tools and sync work the same on all of them.
Mobius reads a drive freely and asks before every change on one. In order:

| Order | Drive | Needs | Status |
| --- | --- | --- | --- |
| 1 | WebDAV: Nextcloud, ownCloud, a NAS, Fastmail Files | A server address and an app password | Have |
| 2 | Two-way sync of chosen workspace folders with a drive, so Notes, Docs and the rest can live on a server. The local folder stays the working copy; a conflict keeps both. | Nothing | Have: on `main` since 15 November 2026, soaked nightly against Nextcloud and wsgidav |
| 3 | S3-style storage (Amazon S3, Backblaze B2, Cloudflare R2, MinIO) | Keys the person pastes; no registration | Have: browse, copy and sync, with multipart upload for big files |
| 4 | Dropbox | Andrew registering Mobius with Dropbox ([steps](drive-sign-in.md#dropbox)) | Built: browse, copy and sync, tested against a pretend Dropbox. Says it isn't set up until the app key is in the build |
| 5 | OneDrive and SharePoint | Andrew registering Mobius with Microsoft, the same registration Calendar sign-in needs ([steps](drive-sign-in.md#microsoft)) | Built: browse, copy and sync, SharePoint libraries from their link, tested against a pretend Microsoft Graph. Says it isn't set up until the client id is in the build |
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
