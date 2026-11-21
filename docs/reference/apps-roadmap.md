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

**Research the reference first (Andrew, 21 November).** Each app has a reference product, in the last column. Before a
round, read that product's official docs and help centre for the feature. The pull request says what the reference
does, which pages were read, and what Mobius copies, adapts or skips. A reference can change when a better one fits.

| App | Last round on `main` | Next round | Waiting on | Reference and sources |
| --- | --- | --- | --- | --- |
| Home | Chats newest first with day headings, quick starts above the message box (#679) | | | ChatGPT and Claude apps ([OpenAI help](https://help.openai.com), [Claude help](https://support.claude.com)) |
| Mail | Triage in the panel (#251), and it switches the composer to Triage (#278) | Triage's own Glance and Result | | Superhuman and Gmail ([Superhuman help](https://help.superhuman.com), [Gmail help](https://support.google.com/mail)) |
| Calendar | Rest of today in Glance (#272); Find a time with… in Actions | | | Google Calendar and Fantastical ([Calendar help](https://support.google.com/calendar), [Fantastical help](https://flexibits.com/fantastical/help)) |
| Tasks | "+" on group heads (a list in All, a day in Scheduled); Plan my day in Actions | | | Things and Todoist ([Things support](https://culturedcode.com/things/support/), [Todoist help](https://todoist.com/help)) |
| Notes | Review this in Actions, in Review mode | | | Apple Notes and Bear ([Notes guide](https://support.apple.com/guide/notes/welcome/mac), [Bear FAQ](https://bear.app/faq/)) |
| Docs | Find and replace (Ctrl+F, Ctrl+H); Review this in Actions, in Review mode | | | Google Docs and Word ([Docs help](https://support.google.com/docs), [Word help](https://support.microsoft.com/word)) |
| Files | Save Back to a drive: a copy goes back over its file while that is still the version copied | Copy folders; Actions in the panel; preview pane | Preview pane: where app panels go | File Explorer and Finder ([Windows help](https://support.microsoft.com/windows), [Mac help](https://support.apple.com/guide/mac-help/welcome/mac)) |
| Browser | One New tab button, in the top bar (Ctrl+T); Bookmark and Pin page kept together in the tab menu | One idea of "keep" (bookmark, pin, pinned tab): a product decision | | Arc and Safari ([Arc resources](https://resources.arc.net), [Safari guide](https://support.apple.com/guide/safari/welcome/mac)) |
| Settings | Shared selects (models, voice, effort, language, usage period, context size); a model list can group by gateway | The two model choices in Gateways' sign-in rows | | macOS System Settings and Windows Settings ([Mac help](https://support.apple.com/guide/mac-help/welcome/mac)) |
| Agents | Permission wording and shared controls (#243); failed runs in red (Builder, #250) | | | Zapier Agents ([Zapier help](https://help.zapier.com)) |
| Projects | Instrument round and Permission names (#186) | Projects in Ctrl+K; drag a conversation onto a project | | Claude Projects ([Claude help](https://support.claude.com)) |
| Sheets | Sum, average and count of the selection in Glance (#261); Analyse… in the panel (#540), its charts drawn in the reply | | | Excel ([Excel help](https://support.microsoft.com/excel)) |
| Slides | Instrument (#201) | Shared selects; Rehearse mode later | | Keynote and Google Slides ([Keynote guide](https://support.apple.com/guide/keynote/welcome/mac), [Slides help](https://support.google.com/docs)) |
| Design | Instrument (#185) | Pen tool; Assets panel | Assets panel: where app panels go | Figma ([Figma help](https://help.figma.com)) |
| Code | Instrument (#150) | Debug mode; failing tests in Glance | | VS Code ([VS Code docs](https://code.visualstudio.com/docs)) |
| Photo | Base layer row and shared select in Adjust, **Building** | Toolbar split so it folds into ⋯; Remove background later | Toolbar split: Builder, toolbar fit (#264) | Lightroom ([Lightroom guide](https://helpx.adobe.com/lightroom-cc/user-guide.html)) |
| Video | Instrument (#190) | Toolbar split so it folds into ⋯; track lanes with mute and solo (library `LetterToggle`); clip inspector sliders | Toolbar split: Builder, toolbar fit (#264) | Premiere Pro ([Premiere guide](https://helpx.adobe.com/premiere-pro/user-guide.html)) |
| Knowledge | Instrument (#194) | Check against sources; Rename and Delete with Undo on pages | | Notion ([Notion help](https://www.notion.com/help)) |
| Reader | Instrument (#184) | Shared empty state for the list | | Readwise Reader ([Reader docs](https://docs.readwise.io/reader)) |
| Database | Instrument (#187); Analyse… in the panel (#540), its charts drawn in the reply | | | Airtable ([Airtable support](https://support.airtable.com)) |
| Activity | Instrument (#155) | Rows and sizes from the shell | Builder: row sizes for Activity | Windows Task Manager and Activity Monitor |
| Views | Instrument (#191) | Sheets and Database tiles with charts; ask Mobius to make a view | | Notion views ([Notion help](https://www.notion.com/help)) |
| Abilities | Instrument (#160) | Connector on and off with its tool list; skills on and off | Builder: start and stop a connector live | Raycast Store ([Raycast manual](https://manual.raycast.com)) |
| Search, Research, Review, Terminal, Canvas | No round of their own yet | A first Instrument pass each | | Research: Perplexity ([Perplexity help](https://www.perplexity.ai/help-center)); the rest when their first round starts |
| Meetings (in Calendar and Notes) | Decided 15 November: no app of its own | Record on an event or in Notes; the transcript and a summary in a note linked to the event; actions to Tasks, waiting for Keep. Notes' demo moment | After the demo moments and live marks | Granola ([Granola docs](https://docs.granola.ai)) |
| People (in Mail and Calendar) | Decided 15 November: an address book in the core, no app for now | Names filled in as you address or invite; a person card from a sender or attendee; Mobius knows who "Priya" is | Builder: the contacts store and CardDAV account | Apple Contacts ([Contacts guide](https://support.apple.com/guide/contacts/welcome/mac)) |
| Messages (new, early) | Decided 15 November: its own app, in Abilities, labelled early | Accounts on official APIs; "catch me up" across channels; only the person sends. Arrives whole: Instrument, docs page, demo moment | After the demo, then People | Slack ([Slack help](https://slack.com/help)) |
| Music | See the [Music roadmap](music-roadmap.md) | | | Ableton Live 12 ([Live 12 manual](https://www.ableton.com/en/live-manual/12/), [Ableton help](https://help.ableton.com)) |

## Rounds that cross apps

These are the same change made in many apps. Each still lands as one pull request per app.

| Round | What changes | Apps | Status |
| --- | --- | --- | --- |
| Permission wording | "Ask first, Propose, Act" and "Follow the mode" become the composer's Permission names: Ask each time, Review changes, Apply changes, Auto. | Settings, Agents, Projects | Have (#241, #243, #186) |
| Shared selects | Native `<select>` becomes the library's `Select` or `ChoiceMenu`. | Calendar, Tasks, Agents and Settings (Have); Photo (Building); Slides, Design, Knowledge, Projects, Canvas | Next |
| Shared date fields | Native date and time inputs become `DateField` and `TimeField`. | Calendar (#246), Tasks (#248) and Agents (#243) Have; Settings (Schedules) | Next |
| Actions in the panel | Each app puts its own actions in the panel's Actions slot with `AppAction`, as Mail does with Get to zero. | Calendar, Tasks, Files, Docs, Notes, then the rest | Next, one app at a time |
| App modes | Triage, Review, Analyse and Debug are in the composer (#239). Each app makes its mode reachable from its panel actions. Research, Schedule and Rehearse come later. | Mail (Have, #251, #278), Sheets and Database (Have, #540), Docs and Notes (Have, Review this), then Code | Next |
| Glance and Result slots | What each app shows in the panel's Glance and Result slots. | Sheets (#261), Tasks (#271) and Calendar (#272) Have; then every app | Next |
| App panels out of the Mobius panel | The Mobius panel is just Mobius (Andrew, 14 November). Each app's own panel (Docs outline, Reader highlights, the Design, Photo, Video and Slides inspectors, Code and Sheets panels) moves out of the tabs beside Mobius to where the design lead's rule puts it. No app adds a tab beside Mobius meanwhile. | Docs, Reader, Design, Photo, Video, Slides, Code, Sheets | Waiting: the design lead's rule, then the Builder's shell change |

## Order

Rounds run on the apps that most need them, in this order of priority:

1. Anything blocking a pull request that is already open.
2. The launch demo's apps: Mail, Tasks, Calendar, then Home.
3. Wording and controls that no longer match the rest of Mobius (the Permission wording, shared selects and dates).
4. The daily apps' next features: Docs, Notes, Files, Browser.
5. Everything else, and the apps with no round yet.
