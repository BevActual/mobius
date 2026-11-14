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

All apps except Projects have passed the Instrument round. The second column is the newest round on `main`.

| App | Last round on `main` | Next round | Waiting on |
| --- | --- | --- | --- |
| Home | Instrument (#181), sidebar head and toolbar line (#213) | Conversations grouped by day | Builder: Home's reading column and row sizes |
| Mail | Instrument (#189), shared two-line rows (#212) | Triage mode in the panel | Builder: app modes in the composer |
| Calendar | Year view (#214, #219), timed tasks (#220) | Shared selects and date fields; one 12/24-hour clock everywhere | |
| Tasks | Instrument (#196) | Shared date field for due dates; "+" on group heads; Plan my day in Actions | |
| Notes | Instrument (#152) | Review mode | Builder: app modes |
| Docs | Instrument (#188) | Find and replace (Ctrl+F, Ctrl+H) | |
| Files | Drag to move (#206) | Actions in the panel (Tidy this folder, Find duplicates); preview pane | |
| Browser | Instrument (#163) | One idea of "keep" (bookmark, pin, pinned tab); one New tab button | |
| Settings | Instrument (#193) | Permission wording; shared selects | |
| Agents | Instrument (#70) | Permission wording; shared date field | Builder: a failed state for runs, shown in red |
| Projects | Instrument round, **Building** (#186) | Projects in Ctrl+K; drag a conversation onto a project | |
| Sheets | Instrument (#192) | Analyse mode: sum, average and count of the selection in Glance | Builder: app modes and the Glance slot |
| Slides | Instrument (#201) | Shared selects; Rehearse mode later | |
| Design | Instrument (#185) | Pen tool; Assets panel | |
| Code | Instrument (#150) | Debug mode; failing tests in Glance | Builder: app modes and the Glance slot |
| Photo | Instrument (#197) | Shared select in Adjust; Remove background later | |
| Video | Instrument (#190) | Track lanes with mute and solo (library `LetterToggle`); clip inspector sliders | |
| Knowledge | Instrument (#194) | Check against sources; Rename and Delete with Undo on pages | |
| Reader | Instrument (#184) | Shared empty state for the list | |
| Database | Instrument (#187) | Analyse mode | Builder: app modes |
| Activity | Instrument (#155) | Rows and sizes from the shell | Builder: row sizes for Activity |
| Views | Instrument (#191) | Sheets and Database tiles with charts; ask Mobius to make a view | |
| Abilities | Instrument (#160) | Connector on and off with its tool list; skills on and off | Builder: start and stop a connector live |
| Search, Research, Review, Terminal, Canvas | No round of their own yet | A first Instrument pass each | |
| Music | See the [Music roadmap](music-roadmap.md) | | |

## Rounds that cross apps

These are the same change made in many apps. Each still lands as one pull request per app.

| Round | What changes | Apps | Status |
| --- | --- | --- | --- |
| Permission wording | "Ask first, Propose, Act" and "Follow the mode" become the composer's Permission names: Ask each time, Review changes, Apply changes, Auto. | Settings, Agents, Projects | Next |
| Shared selects | Native `<select>` becomes the library's `Select` or `ChoiceMenu`. | Settings, Calendar, Tasks, Slides, Design, Photo, Knowledge, Projects, Agents, Canvas | Next |
| Shared date fields | Native date and time inputs become `DateField` and `TimeField`. | Tasks, Agents, Settings (Schedules) | Next |
| Actions in the panel | Each app puts its own actions in the panel's Actions slot with `AppAction`, as Mail does with Get to zero. | Calendar, Tasks, Files, Docs, Notes, then the rest | Next, one app at a time |
| App modes | Triage, Review, Analyse, Debug, Research, Schedule, Rehearse, each a preset. | Mail first, then Docs and Notes, Sheets and Database, Code | Waiting: Builder, app modes in the composer |
| Glance and Result slots | What each app shows in the panel's Glance and Result slots. | Every app | Waiting: Builder, the slots |

## Order

Rounds run on the apps that most need them, in this order of priority:

1. Anything blocking a pull request that is already open.
2. The launch demo's apps: Mail, Tasks, Calendar, then Home.
3. Wording and controls that no longer match the rest of Mobius (the Permission wording, shared selects and dates).
4. The daily apps' next features: Docs, Notes, Files, Browser.
5. Everything else, and the apps with no round yet.
