# Apps roadmap

Where every Mobius app stands and what its next rounds are. The apps lead keeps this page current: a line changes in
the same pull request as the round it describes. Music has its own, longer [Music roadmap](music-roadmap.md) because it
is where the shared component library is proven.

What "finished" means for an app is [the bar for each app](app-bar.md). How an app looks is
[Instrument](../design/instrument.md) and the [design rules](../design/rules.md).

## How a round runs

- **One app, one round, one pull request.** The branch is `app/<name>` (or `app/<name>-<n>` when that name was used
  before), cut from `main`. The title starts with the app's name, such as "Calendar: Week numbers".
- **Shared pieces only.** An app never hand-builds the Mobius panel, the composer, slots, cards, empty-state drawings,
  menus, dialogs, sliders, selects or date fields. They come from `apps/desktop/src/ui/` and the shell.
- **Gaps go up, not sideways.** A control the library lacks goes to the design lead, who adds it to the library. Shell
  or core work (state, tools, the panel) goes to the Builder. The app round waits for it or leaves that item for later.
- **Proof in the pull request.** Light and dark screenshots at 1440 by 900, unit tests for logic, and the app's e2e
  spec updated for anything a person does.
- **Docs move with the app.** The app's line here, its page under `docs/apps/` and its README screenshot change in the
  same pull request when what they show changes.

Status words: **Have** (on `main`), **Building** (in a pull request), **Next** (the coming round), **Later**, and
**Waiting** (needs the shell, the core or the library first, named in the line).

## Where every app stands

Every app has passed the Instrument round. Mobius's own panel is only for Mobius: no round adds an app's tab beside it. The second column is the newest round on `main`.

| App | Last round on `main` | Next round | Waiting on |
| --- | --- | --- | --- |
| Home | Instrument (#181), sidebar head and toolbar line (#213) | Conversations grouped by day | Builder: Home's reading column and row sizes |
| Mail | Triage in the panel (#251), and it switches the composer to Triage (#278) | Triage's own Glance and Result | |
| Calendar | Rest of today in Glance: still to come, next, free time (#272) | Find a time in Actions | |
| Tasks | Shared fields in Details (#248); overdue, due today and flagged in Glance (#271) | "+" on group heads; Plan my day in Actions | |
| Notes | Instrument (#152) | Review mode in the panel | |
| Docs | Instrument (#188) | Find and replace (Ctrl+F, Ctrl+H) | |
| Files | Drag to move (#206) | Actions in the panel (Tidy this folder, Find duplicates); preview pane | Preview pane: where app panels go |
| Browser | Instrument (#163) | One idea of "keep" (bookmark, pin, pinned tab); one New tab button | |
| Settings | Permission wording (#241) | Shared selects | |
| Agents | Permission wording and shared controls (#243); failed runs in red (Builder, #250) | | |
| Projects | Instrument round and Permission names (#186) | Projects in Ctrl+K; drag a conversation onto a project | |
| Sheets | Sum, average and count of the selection in Glance (#261) | Analyse mode reachable from the panel | |
| Slides | Instrument (#201) | Shared selects; Rehearse mode later | |
| Design | Instrument (#185) | Pen tool; Assets panel | Assets panel: where app panels go |
| Code | Instrument (#150) | Debug mode; failing tests in Glance | |
| Photo | Base layer row and shared select in Adjust, **Building** | Toolbar split so it folds into ⋯; Remove background later | Toolbar split: Builder, toolbar fit (#264) |
| Video | Instrument (#190) | Toolbar split so it folds into ⋯; track lanes with mute and solo (library `LetterToggle`); clip inspector sliders | Toolbar split: Builder, toolbar fit (#264) |
| Knowledge | Instrument (#194) | Check against sources; Rename and Delete with Undo on pages | |
| Reader | Instrument (#184) | Shared empty state for the list | |
| Database | Instrument (#187) | Analyse mode in the panel | |
| Activity | Instrument (#155) | Rows and sizes from the shell | Builder: row sizes for Activity |
| Views | Instrument (#191) | Sheets and Database tiles with charts; ask Mobius to make a view | |
| Abilities | Instrument (#160) | Connector on and off with its tool list; skills on and off | Builder: start and stop a connector live |
| Search, Research, Review, Terminal, Canvas | No round of their own yet | A first Instrument pass each | |
| Music | See the [Music roadmap](music-roadmap.md) | | |

## Rounds that cross apps

These are the same change made in many apps. Each still lands as one pull request per app.

| Round | What changes | Apps | Status |
| --- | --- | --- | --- |
| Permission wording | "Ask first, Propose, Act" and "Follow the mode" become the composer's Permission names: Ask each time, Review changes, Apply changes, Auto. | Settings, Agents, Projects | Have (#241, #243, #186) |
| Shared selects | Native `<select>` becomes the library's `Select` or `ChoiceMenu`. | Calendar, Tasks and Agents (Have); Photo (Building); Settings, Slides, Design, Knowledge, Projects, Canvas | Next |
| Shared date fields | Native date and time inputs become `DateField` and `TimeField`. | Calendar (#246), Tasks (#248) and Agents (#243) Have; Settings (Schedules) | Next |
| Actions in the panel | Each app puts its own actions in the panel's Actions slot with `AppAction`, as Mail does with Get to zero. | Calendar, Tasks, Files, Docs, Notes, then the rest | Next, one app at a time |
| App modes | Triage, Review, Analyse and Debug are in the composer (#239). Each app makes its mode reachable from its panel actions. Research, Schedule and Rehearse come later. | Mail (Have, #251, #278), then Docs and Notes, Sheets and Database, Code | Next |
| Glance and Result slots | What each app shows in the panel's Glance and Result slots. | Sheets (#261), Tasks (#271) and Calendar (#272) Have; then every app | Next |
| App panels out of the Mobius panel | The Mobius panel is just Mobius (Andrew, 14 November). Each app's own panel (Docs outline, Reader highlights, the Design, Photo, Video and Slides inspectors, Code and Sheets panels) moves out of the tabs beside Mobius to where the design lead's rule puts it. No app adds a tab beside Mobius meanwhile. | Docs, Reader, Design, Photo, Video, Slides, Code, Sheets | Waiting: the design lead's rule, then the Builder's shell change |

## Order

Rounds run on the apps that most need them, in this order of priority:

1. Anything blocking a pull request that is already open.
2. The launch demo's apps: Mail, Tasks, Calendar, then Home.
3. Wording and controls that no longer match the rest of Mobius (the Permission wording, shared selects and dates).
4. The daily apps' next features: Docs, Notes, Files, Browser.
5. Everything else, and the apps with no round yet.
