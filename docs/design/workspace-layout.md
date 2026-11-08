# Workspace layout: one adaptive surface

Owner direction (2026-11-07): an app in Mobius should not feel like a window into another application. The UI
morphs: the controls that exist change with what you are doing, inside one unified design, and the agent can be used
while you work in any app.

## The parts, the same in every app

| Part | What it is | How it adapts |
|---|---|---|
| Sidebar (left) | The apps by name, then the open app's own list (tabs, notebooks, lists, conversations). Folds to an icon rail. | The **Create** button follows the app (New tab / New note / New task / New conversation). Counts and dots show what is waiting and what the agent changed elsewhere. A narrow window folds it to the rail on its own. |
| Toolbar (top) | Where you are (title + one line about it), then the app's own controls, then the agent. | Browser: back, forward, address. Notes: notebook and save state. Tasks: how many to do, Clear completed. Agent: which model. |
| Work area | The app's content as one sheet on the window. | Only the content changes between apps; headers live in the toolbar, not in each page. |
| Agent | One conversation across all apps. | Three sizes: **Ask** in the toolbar when the panel is put away; the **panel** beside the work (the composer turns into a live status line while the agent works); the **Agent app** full size. On-canvas actions work on text selected in a note or on a web page. |
| App hub | Every app as a tile with a live status, ways to start something, apps still to come. | Opens from the sidebar; type to narrow it. |

## Rules taken from Apple's HIG (Sidebars, Toolbars) and Microsoft's 2026 Copilot redesign

- Do not hide the sidebar by default; let people hide it, and fold it when the window is narrow (macOS Mail).
- Sidebar icons use the accent colour; at most two levels of hierarchy; nothing critical at the bottom.
- One entry point for the agent that sits above the work and opens a side pane that works with the content, with
  clear signals of what it is doing (M365 Copilot, May 2026). Invoking it on the content itself comes after.
- Progressive disclosure: start clean, reveal controls in context, never every path at once.
- Glass only on the top layer (the app hub, menus); the sidebar and toolbar are solid.

## Mobius 2 shell

- One window. The sidebar runs edge to edge; one toolbar spans the work area; controls are capsules; indigo is the one
  accent. Glass stays on the top layer only, so Linux stays readable.
- **Split view**: the toolbar's split button (or Ctrl+\\) puts a second app beside the first. Each pane has a small header (choose
  its app, swap, close) outside the page view; the toolbar and sidebar follow the focused pane. Drag the divider, or
  focus it and use the arrow keys. Below 980 px the second pane folds away until the window is wide again. With the
  Agent app in a pane, the agent panel steps aside.
- **Beside the conversation**: when the agent writes a note, changes a task list or opens a web page while you are in the
  Agent app, it opens in the second pane, and typing stays in the conversation. A pane you chose for something else is never
  replaced; that app gets its dot in the sidebar instead.
- **Replies read as formatting**: headings, lists, quotes, code, bold and links (links open as tabs in Mobius). The
  reply is read into plain data, never HTML, and only web and mail links are followed.
- **Little Mobius**: a small window, kept above other apps, with the conversation and nothing else. It opens (Ctrl+Shift+M) from the
  toolbar, shares conversations with the main window, and closes with it.

- **On-canvas actions**: select text in a note and a capsule appears above it: Ask (the text joins the agent's message
  box as a Note chip), Rewrite (the agent changes it in the note), Summarise, and Make a task (added straight to the
  first list, no agent needed). On a web page, the toolbar's selection menu offers Ask, Summarise, Explain, Make a task and Save to Notes (quoted on a Clippings page, with a link back; "Save to another page…" picks a different page and keeps saving there)
  (the page is a native view, so its picture covers it while the menu is open).
- **Review and undo**: each agent turn begins with a checkpoint. When a turn ends having changed notes, task lists or
  files, a strip above the message box says so: Review lists each change with its own Undo; Undo all puts back only
  what that turn changed, so edits made since elsewhere are kept. A changed note says so above the page, with Show
  changes (the page line by line: added, removed, kept, with an Undo on each change) and Undo all; changed pages and lists carry a dot in their sidebars.
- **Your sidebar**: drag an app in the sidebar to reorder it (or Alt+Up/Down on a focused app), or right-click it to move it, hide it, or edit the list. Settings ›
  Appearance › Layout has the full list with a checkbox and order buttons for each. At least one app always stays,
  and hidden apps are still in All apps. Pin a note or a task list (the pin beside it), or a web page (the pin in the browser toolbar), and it stays under
  the apps, up to eight; drag pinned items (or Alt+Up/Down) to reorder them. A pinned page opens in its tab if one is open.

## Following the Mobius Agent design canvas

The Mobius Agent design canvas (Mobius 2 boards) is the reference for what follows. The one-window decision stands
(option B on the canvas: one window, split view, Little Mobius).

- **Mark and icon**: the whorl print from the Logo studies board, four open rings around a core, three below 32 px.
- **Menus**: File, Edit, View, Go, the app's own menu, Window, Help, from one definition (`menus.ts`). In the toolbar on
  Windows and Linux (one Menu button in a narrow window), in the system menu bar on macOS.
- **Launcher**: one search for apps, pages and every menu command, with Ask Mobius first once a model is set up.
- **Welcome**: the print draws in, then how much Mobius should do (the approval setting), then the model.
- **The Mobius panel**: "Sees:" names the apps Mobius has worked in; the conversation; proposals (dashed until kept);
  suggestions.
- **Plan first**: a turn that only proposes steps, each tagged with what your settings mean for its app (Asks first,
  Reads freely, Acts, Off); Start, Edit Plan, I'll Drive (the steps become a task list); while it runs, Take Over and Stop.
- **Keep or Discard**: what a turn changed waits as a dashed proposal (Cmd/Ctrl+Enter keeps, Cmd/Ctrl+Backspace
  discards), in the strip under the conversation and in a changed note's bar; kept across restarts.
- **Approvals in plain words**, and per app (browser, notes, tasks): Off, Ask first, Read or Act. Risky actions always ask.
- **Memory** (asked first), **past conversations** the agent can search, **schedules** (Settings › Schedules, or asked
  of the agent), and the Agent app's **Activity** tab (needs you, running, scheduled, done today).
- **Presence on the desktop**: the print in the menu bar or notification area shows idle, working, needs you, or done
  while away; its menu opens Mobius, asks, lists what is running, and stops it all.
- **Privacy report**: what Mobius read and changed in each app this week, and where requests are answered.
- **Accessibility**: glass turns solid with Reduce Transparency, Increase Contrast or forced colours.
- **Profiles**: separate sets of data (Personal, Work…), switched in Settings › Advanced › Profiles or File › Profiles…;
  models are shared. Each reply says what it was **based on**.

The apps on the canvas, each keeping its data as ordinary files other apps can open, with the agent beside it:

- **Calendar** (`calendar/*.ics`): day, week and month; subscribed links and CalDAV accounts (iCloud, Fastmail,
  Nextcloud) beside the person's own calendars; Mobius's suggestions dashed with Decline and Add. Google and Microsoft
  sign-in need app registrations (`docs/calendar-sign-in.md`).
- **Docs** (`docs/<folder>/*.md`): a page with formatting, an outline, writing tools, and the agent's changes as
  proposals in the page.
- **Sheets** (`sheets/<workbook>/*.csv`): formulas worked out in Rust for the window and the agent alike; cells the
  agent changed are marked until kept or discarded.
- **Mail** (mirrored to the data folder): app-password accounts, categories sorted here, a reader that loads nothing
  from the web, and suggested replies. Only the person sends.

- **Slides** (`slides/<folder>/*.md`): slides split by `---`, a navigator, Play with notes; changed slides dashed.
- **Journey** (`memory.md`): what Mobius remembers, by kind and where it was noticed; what it would like to remember
  waits here for Remember or Don't.
- **Code** (`code/<project>/`): a file tree and an editor; the agent's change as removed and added lines to keep or
  discard; tests run with a command only the person sets (`code-tests.json`, outside the workspace).
- **Design** (`designs/<folder>/*.json`): frames of rectangles, ellipses and text on a canvas, an inspector with colour
  styles and a contrast check; the agent's layers dashed.
- **Canvas** (`boards/<folder>/*.json`): a whiteboard of stickies, shapes, text, arrows joining them and pen lines,
  one item per line in the file; sorting into themes or a flowchart from Mobius shows dashed until kept.
- **Photo** (`photos/<album>/`): pictures never changed; adjustment layers to all or part of each, in
  `<photo>.edits.json`; Export writes a new picture.
- **Studio** (`studio/<folder>/*.json`): songs as tracks of notes, a piano roll, a small synthesiser; Mobius writes
  notes, never audio.
- **Video** (`video/<project>/`): clips never changed, `cut.json` of shots; the viewer plays clips from the shell's
  `media` address.

- **Earlier changes**: under the review strip, every earlier turn that changed something, with what was asked; each
  item put back as it was before its turn, asking first if it changed again since (`turn-history.json`).

- **Pictures**: a message carries up to four pictures (chosen, pasted, or one still of a window chosen in the system's
  picker: Look at a window, or one still from the camera: Show Mobius), sent to models that read pictures; Photo
  sends the photo itself with its edits.

Show Mobius on the phone, with the Camera Control, waits for the phone app.

## Linux

The shell layers the browser's page views over the interface view. On Linux, Tauri 2 (`tauri-runtime-wry`) packs every
child web view into the window's vertical `GtkBox`, so the page view took the whole height and the interface got one
pixel. `crates/mobius-shell/src/linux_views.rs` moves each view into one `GtkFixed` and places it there instead, and pages
open by navigating the web view directly, since the Chromium protocol is Windows-only. `linux_page.rs` does through
WebKitGTK what that protocol does on Windows: scripts in an isolated world (the agent's browser tools, find, the
selection menu), the page picture used as a cover under menus, and whether the page can go back or forward.

## Next

1. Try by hand what tests cannot reach: keeping a program download in WebView2's prompt on Windows, and the menu bar and
   tray on a Mac.
2. The canvas items not built yet (above).
