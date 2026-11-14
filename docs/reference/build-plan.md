# Build plan

The one plan above every other plan: what Mobius is working on now, in what order, who owns each part and what waits
on what. The orchestrator keeps this page. The public direction is the [Roadmap](../roadmap.md); the detail for each
app is the [Apps roadmap](apps-roadmap.md) and, for Music, the [Music roadmap](music-roadmap.md). When those pages and
this one disagree about order or ownership, this page wins and the other page gets corrected.

## Direction

- **Refine before adding.** No new apps for now. The apps that exist get good first.
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
- **Parked:** model-provider connections beyond what works today, the Copilot and Hugging Face sign-in test, a Messages
  app, the canvas.

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

| Item | Owner | Status | Unblocks |
| --- | --- | --- | --- |
| App panels out of the Mobius panel: the rule, in `docs/design/` | Design lead | Building | The shell change, then one round per app with a panel |
| App panels out of the Mobius panel: the shell | Builder | Next, ahead of the rest of the shell queue | Docs, Reader, Slides, Design, Photo, Video, Code, Sheets and Music moving their panels |
| The demo workspace and its profile | Launch, Builder | Next | Every clip in the [demo plan](demo-plan.md) |
| A pass over every app's moment in the demo plan | Every lead | Next | Knowing what is left to build |
| Projects Instrument round (#186) | Apps lead | Building | The last app without an Instrument round |
| Permission wording and shared selects: Settings, then Agents | Apps lead | Building | Old wording gone from the apps |
| Row sizes for Home and Activity (#245) | Builder | Building | Home's and Activity's next rounds |
| Glance and Result slots (#249) | Builder | Building | Sheets, Code, then every app |
| A failed state for runs (#250) | Builder | Building | Agents |
| `Chart` | Design lead | Building | Sheets' demo moment |
| Artifacts moved into `docs/` (#242) | Design lead | Building | Retiring the artifacts |
| Drum pads on the library's `StepGrid` and `PadGrid` | Music | Next | The first new instrument |
| README screenshots and launch checklist | Launch | Building | The launch list below |

## Shell queue

The Builder's order for the pieces apps wait on. Each row names what it lets the apps do.

| Order | Shell piece | Apps waiting | Status |
| --- | --- | --- | --- |
| 1 | App modes in the composer, with Mail's Triage as the first | Mail, then Notes and Docs (Review), Sheets and Database (Analyse), Code (Debug) | Have (#239) |
| 2 | Row sizes and the reading column from the shell for Home and Activity | Home, Activity | Building (#245) |
| 3 | The panel's Glance and Result slots | Sheets, Code, then every app | Building (#249) |
| 4 | A failed state for runs | Agents | Building (#250) |
| 5 | Start and stop a connector while Mobius runs | Abilities | Next |

App modes came first because they unblock the launch workflow's Mail round and four more apps. Home's sizes are second
because Home is in the launch workflow.

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
- **A stall is raised, not waited out.** A lead blocked for more than one round on another lead says so to the
  orchestrator, who reorders the queues above.

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
| Mail | Any provider over IMAP and SMTP, with ready-made settings for the common ones | Sign-in for Google and Microsoft accounts | Builder |
| Calendar | CalDAV (iCloud, Fastmail, Nextcloud, any server), subscribed links, its own files | Google and Microsoft sign-in | Builder, waiting on Andrew registering Mobius with each |
| Files | The workspace folder on this computer | WebDAV, which covers Nextcloud and most self-hosted drives; then S3-style storage and network shares | Builder for the connection, Apps lead for Files |
| Tasks | Its own files | Task lists over CalDAV, so tasks sync with the same servers as Calendar | Builder, Apps lead |
| Models | A dozen services, sign-in with ChatGPT or Claude, OpenRouter, local models, and any server that speaks the common chat format | Nothing scheduled | Builder |
| The agent | Connectors (MCP), started and stopped live | Connectors over HTTP with sign-in, so a team's own tools and data are one address away | Builder |
| People | Nothing: there is no address book | Contacts over CardDAV, shared by Mail and Calendar | Needs a decision: it is close to a new app |
| Notes, Docs, Sheets and the rest | Plain files in the workspace | They follow Files: once the workspace can live on WebDAV, so do they | |

This work starts after the first group of the [demo plan](demo-plan.md). WebDAV for Files is first because it opens the
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
