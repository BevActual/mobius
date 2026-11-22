# Adding an app

What it takes to add an app to Mobius, from the first screen to the README picture. Whether something should be an
app at all is decided first, by the test in the build plan ([A new app, or part of one that
exists](../reference/build-plan.md)). This page starts once the answer is yes.

An app is spread over more places than its own file: the shell needs to know its name and icon, the agent needs to
know its folder and what it may touch, and Review, Rewind and Search need to know how to name its files. Reader
(`apps/desktop/src/Reader.tsx`, files in `reading/`) is a good small app to copy from. Search the code for `'reader'`
and `reading/` to see every place below in a working app.

## Before you start

- [ ] The new-app test is passed and recorded in the build plan, with a row in the
  [Apps roadmap](../reference/apps-roadmap.md).
- [ ] Shared data goes in the core, not in the app. If the app holds something another app also needs (people,
  messages, events), the store lives in a crate and the app is one view of it.
- [ ] It uses [Instrument](../design/instrument.md) from the first screen and only the [shared
  controls](shared-controls.md) from `src/ui`. A control the library lacks is added to the library, not built in the
  app.

## The app itself

| Step | Where |
| --- | --- |
| Add the id to `AppId` and an entry to `APPS` with its name, group and the other words it is found by (`also`) | `apps/desktop/src/apps.ts` |
| Leave it out of `DEFAULT_APPS`: a new app is added from Abilities. Add it to `COMPACT_APPS` if it is a pro app | `apps/desktop/src/apps.ts` |
| Its page and its sidebar, in one file named after the app | `apps/desktop/src/<App>.tsx` and `<app>.css` |
| Open it from `App.tsx`: the `in<App>` flag, the sidebar, the page in the content switch, and the window title and subtitle | `apps/desktop/src/App.tsx` |
| Its icon, drawn on the 20 px grid like the others | `ICONS` in `apps/desktop/src/Rail.tsx` |
| Its colour token, in every theme | `--app-<id>` in `apps/desktop/src/tokens.css` |
| The icon backgrounds in the launcher, hub, access list, review filter and search | `[data-app="<id>"]` rules in `apps/desktop/src/styles.css` |
| Its menu in the menu bar | `apps/desktop/src/menus.ts` |
| Its starts in the Mobius panel: two or three things to ask with something open, and one or two with nothing open | `apps/desktop/src/surface.ts` |
| Its own panels go in the inspector column, or the bottom dock if wide. Never as tabs beside Mobius | [Panel layouts](../design/panel-layouts.md) |

## Its files and the core

| Step | Where |
| --- | --- |
| A folder in the workspace (`reading/`, `photos/`). Plain files people can open elsewhere wherever possible | `crates/mobius-workspace` |
| The store and its calls on the bridge, and the event it sends when files change (`mobius:<app>-changed`), including changes made by another app or by Mobius | `crates/mobius-host/src/bridge.rs` |
| The calls in the shared types and the desktop bridge | `packages/shared/src/ipc.ts`, `apps/desktop/src/bridge/tauri.ts` |
| Tell the agent where its files live | `crates/mobius-host/src/workspace_guide.rs` |
| What Mobius may read and change in it, and the Settings row that turns that off or to ask | `crates/mobius-host/src/access.rs`, `apps/desktop/src/settings/sections.tsx` |
| New tools, if files alone are not enough (`db.query`, `tasks.write`): a tool namespace in the core, read and write tools kept apart so access can tell them apart | `crates/mobius-host` |
| Undo: changes go through checkpoints like every app, so Rewind and Keep work with no extra code. Check that a restore sends the app's changed event | `crates/mobius-host/src/bridge.rs` |
| Sync: a workspace folder synced with a drive includes the app's folder. Check large or binary files against [Drives](drives.md) | `crates/mobius-host/src/drive_sync.rs` |

## Where other parts of Mobius name it

These are small maps from a folder or a kind of file to the app. Missing one leaves the app's files nameless in
that place, so check each.

| Place | Where |
| --- | --- |
| Opening a file from a card, a link or Search | `actions.ts`, `search-hub.ts`, the open-target switch in `App.tsx` |
| Review and Keep | `review-view.ts`, `KeepScope`, `SCOPE_FOLDERS`, `NAMES` and `APP_IDS` in `ReviewStrip.tsx` |
| Rewind | the kind names in `Rewind.tsx` |
| Changed-file marks after a turn | the `add('<id>', turnMarks…)` list in `App.tsx` |
| Agents and Projects | `bot-view.ts`, `RULE_APPS` in `Projects.tsx` |
| New items from the plus menu | `createInList` and the new-item list in `App.tsx` |

## Tests, docs and pictures

- [ ] Unit tests beside any logic that is not drawing (`<app>.test.ts`).
- [ ] An end-to-end spec, `apps/desktop/e2e/<app>.spec.ts`, that opens the app, makes something, has Mobius change
  it, and keeps or discards the change. See [Testing](testing.md).
- [ ] Seed files for its demo moment in `demo/workspace/`.
- [ ] A section in the right page under `docs/apps/` (by its group), and a screenshot row in the README. Add it to
  the list in `apps/desktop/e2e/screens.spec.ts` so the light and dark pictures are made with the rest.
- [ ] A Learn lesson if it has something to teach (`apps/desktop/src/learn.ts`).

## Not built yet

- The "early" label the build plan asks for on a new app in Abilities does not exist in the code yet. The first new
  app adds it to `AppInfo` in `apps.ts` and shows it in the hub (`AppHub.tsx`).
