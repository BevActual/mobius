# Build plan

The one plan above every other plan: what Mobius is working on now, in what order, who owns each part and what waits
on what. The orchestrator keeps this page. The public direction is the [Roadmap](../roadmap.md); the detail for each
app is the [Apps roadmap](apps-roadmap.md) and, for Music, the [Music roadmap](music-roadmap.md). When those pages and
this one disagree about order or ownership, this page wins and the other page gets corrected.

## Direction

- **Refine before adding.** No new apps for now. The apps that exist get good first.
- **One look.** [Instrument](../design/instrument.md) and the [design rules](../design/rules.md) decide how everything
  looks. Apps never hand-build the panel, the composer, slots, cards, drawings or controls.
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
2. **The launch workflow: Mail, Tasks, Calendar, then Home.** One real job across those apps is what Mobius is shown
   with, so their rounds and the shell pieces they need go first.
3. **One wording and one set of controls everywhere.** The Permission names, shared selects and shared date fields
   replace what is left of the old ones, in the apps and in the docs.
4. **The shell pieces apps are waiting on,** in the order under [Shell queue](#shell-queue).
5. **Music's next instruments and the library pieces they prove,** in the order under [Library queue](#library-queue).
6. **The daily apps' next features** (Docs, Notes, Files, Browser), then every other app, then the five apps with no
   round yet.

## Now

| Item | Owner | Status | Unblocks |
| --- | --- | --- | --- |
| Apps roadmap (#237) | Apps lead, Builder merges | Building | Every link to it, including this page's |
| Projects Instrument round (#186) | Apps lead | Building | The last app without an Instrument round |
| Music: knobs, drawn graphs, device chain (#235) | Music | Building | Drum pads and the step grid |
| Design rules from the app rounds (#203) | Design lead | Building, open longest | Rules the app rounds are held to |
| Artifacts moved into `docs/` | Design lead | Building | Retiring the artifacts |
| README screenshots and launch checklist | Launch | Building | The launch list below |
| Permission wording and shared selects: Settings, then Agents | Apps lead | Next | Old wording gone from the apps |

## Shell queue

The Builder's order for the pieces apps wait on. Each row names what it lets the apps do.

| Order | Shell piece | Apps waiting |
| --- | --- | --- |
| 1 | App modes in the composer, with Mail's Triage as the first | Mail, then Notes and Docs (Review), Sheets and Database (Analyse), Code (Debug) |
| 2 | Row sizes and the reading column from the shell for Home and Activity | Home, Activity |
| 3 | The panel's Glance and Result slots | Sheets, Code, then every app |
| 4 | A failed state for runs | Agents |
| 5 | Start and stop a connector while Mobius runs | Abilities |

App modes come first because they unblock the launch workflow's Mail round and four more apps. Home's sizes come second
because Home is in the launch workflow.

## Library queue

The Design lead's order for library pieces. A piece is built when an app round is ready to use it, and lands before
that round's pull request.

| Order | Library piece | First user |
| --- | --- | --- |
| 1 | Anything an open pull request is waiting on | That pull request |
| 2 | `StepGrid` | Music: drum pads and step patterns |
| 3 | `LetterToggle` (mute, solo and the like) | Video: track lanes; Music: tracks |
| 4 | Automation lane | Music: movement over time |
| 5 | Mixer strip built on `LevelMeter` | Music: mixer view |

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
| [The bar for each app](app-bar.md) | Polish is described as "feels like an Apple app". It should point at Instrument. | Design lead |
| README and `docs/guide/` | Any use of the old mode names. | Launch |

## Launch

What has to be true before Mobius is shared widely. The Launch lead keeps the checklist; this is the order.

| Step | Owner | Waiting on |
| --- | --- | --- |
| The launch workflow works end to end on real accounts: mail in, tasks made, time blocked, drafts ready | Apps lead, Builder | App modes; the Mail, Tasks and Calendar rounds |
| README shows every app in the current look | Launch | Nothing |
| First run takes five minutes or less from install to a first answer | Builder, Launch | Nothing |
| A 60 to 90 second uncut video of the launch workflow | Launch | The first step |
| Signed Windows installer | Builder | Andrew: the SignPath application |
| v0.1.0 published | Builder | Andrew: Publish on the draft release |
| Google and Microsoft calendar sign-in | Builder | Andrew: registering Mobius with each ([what it needs](calendar-sign-in.md)) |

## Later

Not scheduled. Each needs a decision before it starts.

- The macOS release.
- Tauri v3, once it is released.
- The Chromium engine in the installer.
- Plugins in Abilities.
- Subagents.
- A first Instrument round for Search, Research, Review, Terminal and Canvas.
