# Mobius: from the canvas to the app

> **Archived record.** Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Don't work from it: the source of truth is the [roadmap](../roadmap.md).

> **Archived on 12 November 2026. Don't work from this page.** It is the build history from 10 November. The source of truth is now the [docs folder in the repo](../README.md): the [roadmap](../roadmap.md) for where Mobius stands, and the design rules for how apps look. The canvas stays as a reference.

10 November 2026 · build order for bringing the app on `mobius-2-shell` to where the canvas (now v172) is.

**Update, 10 November evening:** Andrew moved the focus to the real app. The app is now the source of truth. Canvas work has stopped, and the canvas stays as it is, at v172, for reference.

## Status

Steps 1 to 7 are in the app as of 10 November, on branch `claude/project-thread-upbgu0` ([PR #2](https://github.com/BevActual/mobius/pull/2)). Each change was checked in the browser preview and in the Windows tests, which run both in CI and on Andrew's computer again now that Smart App Control is off.

| Step | State | What is in the app |
| --- | --- | --- |
| 1. Sidebar per app | Done | The sidebar belongs to the open app. Its head shows the app and switches the column to the list of apps. |
| 2. Nothing on top | Done | Menus fold into one button in the sidebar's head. The browser's buttons and address sit under the app's name. Only the page's title row remains. |
| 3. Mobius in the sidebar | Done | A Mobius button in the head turns the column into the conversation. Show beside puts it back beside the page, which is still the default. |
| 4. Home desk | Done | With no conversation open, Agent shows the desk: Now (Allow, Stop, Open), In your apps, Next from schedules, message box at the bottom centre. |
| 5. Propose and one review bar | Done | Three modes, Ask first, Propose (the default) and Act, with Shift+Tab. Per app: Follow the mode, Always ask or Off. Every app answers Mobius with one shared Keep / Discard / Try another bar and a Why this line. Sign-in once per task is designed (canvas v168) and being built. |
| 6. App passes | Done | Notes, Mail, Calendar, Tasks, Docs, Sheets, Design, Code, Studio: + New first with Mobius's starts, Mobius's changes dashed until kept, the shared review bar. |
| 7. Mobius's own apps | Done | Bots, Activity and Settings sit in the switcher under your apps. Being built next: Rewind to here in Activity, Needs you when Act stops a risky step, and the Bots app's How it starts and What it may touch. |

Tests: the full Windows end-to-end run and the Linux checks passed on 5f86c96 (10 November, 12:39 UTC). Since steps 1 to 7, the app has also gained Rewind to here, Needs you in every mode, the Bots app, sign-in once per task, From Mobius and Linked from, Extensions, and Files with Made by Mobius. Prompt-injection defence (read content is wrapped as data with its source, and a send, pay, delete, run or open-a-site that came from read text always asks and says where it came from) and Take over mid-task (Mobius pauses at a safe point, with Hand back and Stop) are in too, and each browser tab now shows whether Mobius is driving it, reading it, or it is yours after you take over.

Still different from the canvas after steps 1 to 4: Profile, All apps and Settings stay at the foot of the sidebar, and the narrow icon rail keeps the old toolbar.

## Where everything is

| What | Role | State |
| --- | --- | --- |
| [Mobius canvas](../design/canvas-v172/README.md) | The design prototype of the shell and every app. It led the code until 10 November; now the app leads. | Paused at v172 (agent panel in an Apple, HIG-inspired style), kept for reference |
| This document | The build plan and its status. | Current |
| [Rival agents and target apps](../reference/rival-agents.md) | Which apps to measure Mobius against (Mail, Browser, Studio deep) and lessons from Hermes, Claude, ChatGPT/Atlas, Copilot, Comet and Manus. | Research, 10 November |
| [Apps: the bar for each, and the order](../reference/app-bar.md) | The five-part bar every app has to meet, and the order to bring them up to it, Notes first. | Current, 10 November. The app-by-app work follows it. |
| [ElevenLabs ideas](../reference/elevenlabs-ideas.md) | Voice for Mobius: talking in the panel, Listen in every app, and a Meetings app first. | Research, 10 November. Not on the canvas yet. |
| [Recommendation and improvements](../reference/market-research-2026-11.md) | The first recommendation from 8 November, with the market research. | Superseded by the shell direction, kept for the research |
| [PR #2](https://github.com/BevActual/mobius/pull/2) | The code for steps 1 to 7. | Open |

The Design thread keeps this list up to date, and each change to an artifact is noted here. The old Mobius Agent canvas has been deleted.

## Build order

Each step is one pull request into `mobius-2-shell`, small enough to review, and checked in the browser preview against the canvas.

1. **The sidebar.** The rail becomes the per-app sidebar: head with the app icon (opens the switcher in place), search, + New as the first row, sections that fold, More last. The app list leaves the rail and lives in the switcher. Files: `Rail.tsx`, `App.tsx`, `AppHub.tsx`, `styles.css`.
2. **The top strip goes.** Each app's tools become a row at the top of its content; the comment button sits at the end of that row. Menus stay in the native menu bar on macOS and fold into the switcher face on Windows.
3. **Mobius in the sidebar.** The panel is closed by default. The mark in the head morphs the sidebar into the conversation; Pin beside puts it back on the right. Files: `ChatPanel.tsx`, `App.tsx`.
4. **Home as a desk.** A new home view replaces the Agent app's empty start: Since you left, Now (bots), In your apps (rows with Open and Keep), Artifacts, Next. Chat sits behind it.
5. **Propose, and one Keep.** Add the Propose mode to the agent and one review row everywhere (Keep / Discard / Try another), with dashed indigo as the only mark of something Mobius made. Touches the Rust agent crates as well as the UI.
6. **App passes.** One app at a time, in the canvas's order: Notes, Mail, Calendar, Tasks, Docs, Sheets, then Design, Code, Studio. Each gets From Mobius in its sidebar, the Linked from card, and + New with three starts.
7. **Mobius's own apps.** Settings as an app, then Activity with Rewind, Bots, Files, Extensions, Wiki.

## Things to decide along the way

- **Apps the code has and the canvas does not:** Slides, Database, Research, Reader, Photo, Video, Terminal, Canvas, Review, Journey, Search. I would keep them all in the switcher and leave them as they are until the frame is done.
- **End-to-end tests.** They run in CI on every push (about 25 minutes) and on Andrew's computer. A new push cancels a running one, so pushes come at most every 30 minutes.

## What is already in place

- **The mark** (pull request 2, still open): the trefoil in the app and the glossy ring as the icon.
- **A browser preview** (added to the same pull request): `npm run dev -w @mobius/desktop` now opens the interface in a plain browser with a little sample data, so every step can be compared with the canvas without building the shell.
