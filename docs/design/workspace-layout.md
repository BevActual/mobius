# Workspace layout: one frame, a shape per app

Owner direction (adopted 2026-11-13, "One Mobius layout for every app"): every app has the same five-zone window. Only
what is inside the zones changes per app, so moving between apps never feels like moving between products. Mobius sits
beside the work in a right panel, opened from the same place in every app. The theme is timeless: flat surfaces, type,
spacing and restraint, not this year's materials. [Design rules](rules.md) says how each part must look and behave.

## The five zones

```
┌──────┬────────────┬──────────────────────────────────────────┬──────────────┐
│ Rail │  Sidebar   │ Toolbar: ☰ Title · line │ app controls │ Share ⋯ ✦ │
│      │            ├──────────────────────────────────────────┤  Right panel │
│ Home │ New        │                                          │  (Mobius, or │
│ Find │ Search     │                 Content                  │  inspector,  │
│ Apps │ Places     │            (one or more views)           │  as tabs)    │
│  …   │ From Mobius│                                          │              │
│ ⚙ 👤 │ More       ├──────────────── bottom dock ─────────────┤              │
└──────┴────────────┴──────────────────────────────────────────┴──────────────┘
```

| Zone | Its job | Always the same | Filled by the app |
| --- | --- | --- | --- |
| 1. App rail (far left, about 52px) | Get to any app, see what needs you | Home, Search, pinned apps, then Mobius, Activity with its badge, Settings and profile at the foot. Never folds away. | Nothing. Badges and dots only. |
| 2. Sidebar | Move around inside the app | New, Search, the app's places in sections, From Mobius, More (trash, archive). Same width, row styles and fold key. | The places: mailboxes, notebooks, folders, lists |
| 3. Toolbar (one row) | Act on what is open | Leading: sidebar toggle, the title of what is open, one grey line. Trailing: Share, the ⋯ menu, the Mobius button. | The middle: the app's own controls |
| 4. Content | The work | A solid surface, the shared empty state, the shared review bar | One or more views, and a bottom dock |
| 5. Right panel | Details and Mobius | One column, same width and card. Mobius docks here by default; other panels dock here as tabs. | Whether the app has an inspector |

Little Mobius, split view and comments are in the View menu, the ⋯ menu and their keys, where the launcher also finds
them. Below 980px the sidebar folds and the right panel closes; each comes back over the content from its toggle.

## What changes per app

Apps differ in three ways only: what fills the toolbar middle, whether the sidebar starts open, and which panels they
have. Five kinds cover every app.

| Kind | Apps | Sidebar at start | Toolbar middle | Inspector on the right |
| --- | --- | --- | --- | --- |
| Organise | Mail, Tasks, Calendar, Files, Projects | Open | View switch (Day, Week, Month), Today, the main actions (Reply, Reply All, Forward) | No. Mail and Calendar open details in the content |
| Write | Notes, Docs, Knowledge, Reader | Open, folds on its own while typing | Aa, insert, history. The Docs outline moves into the sidebar under the document | No |
| Browse | Browser, Research, Search | Open | Back, forward, reload and the address bar | No |
| Data | Sheets, Database, Views | Open | Formula or query bar, then filter and sort | Optional (cell or column details) |
| Make | Slides, Design, Canvas, Photo, Video, Music, Code, Terminal | Folded, to give the canvas room | Tools and play or run (Add slide, Play, transport, crop) | Yes: Slides style, Design layers, Photo adjust, Music device |

The Agent app is the one special case. Its content is the conversation, so the right panel stays closed there and the
Mobius button opens the conversation list instead.

## Views and panels

Complex apps are made of views and panels that people can show, hide, resize, rearrange and pop out.

- A **view** fills the content zone and is switched in the toolbar (Session or Arrange in Music; Library or Edit in
  Photo; Day, Week, Month in Calendar).
- A **panel** is a named piece around the view (Clip, Devices, Mixer, Inspector, Timeline, Filmstrip, Outline, and also
  the sidebar and Mobius). It can be turned on or off, resized, docked left, bottom or right, or popped out into its own
  window. Little Mobius is the Mobius panel popped out.
- A **layout** is a saved arrangement of panels (Arranging, Mixing, Sound design), picked, saved or reset from the
  app's Panels menu.

Every panel has the same header (name, dock, pop out, close), and each app has one Panels menu. Panels arrive in three
stages: show, hide and resize; then move between docks; then pop out into a window.

## Mobius's three sizes

- **Full**: Home and the Agent app, where the conversation is the content.
- **Beside**: the right panel in every other app, opened from the Mobius button or the rail. The sidebar never changes
  face, so you keep your lists while you talk.
- **In place**: verbs on a selection (Ask, Rewrite, Summarise, Make a task), with the result dashed where it lands.

## The theme

Three flat surfaces (a neutral frame, paper content, raised) separated by hairlines; shadows only on floating things;
no blur or glass. The frame is neutral and uses ink for state; indigo marks Mobius; colour belongs to the person's
content. Inter for the interface and Inter Display for titles on every platform. Two densities from the same tokens:
comfortable for daily apps, compact for Music, Video, Code and Sheets. Several themes (Light, Mid grey, Dark, Cool
dark). Single-weight line icons in the frame; colour tiles only in the launcher. Details are in
[Design rules](rules.md#theme).

## Roll-out

1. **Shell (Builder):** an `AppFrame` in `apps/desktop/src/ui/` with slots for the sidebar, toolbar title, toolbar
   controls and inspector; the app rail; the right panel with Mobius; the window icons moved to menus; the theme tokens
   (three surfaces, two densities, Inter).
2. **Sidebar skeleton (Builder):** a shared `AppSidebar` that enforces New, Search, sections, From Mobius, More.
3. **Apps adopt (app threads):** each app moves its second row into the toolbar slot and its help text out of the
   sidebar, one small PR each. Daily apps first: Mail, Calendar, Tasks, Notes, Docs, Browser.

## Shell features

- **Split view**: View › Split view (or Ctrl+\\) puts a second app beside the first. Each pane has a small header
  (choose its app, swap, close); the toolbar and sidebar follow the focused pane. Drag the divider, or focus it and use
  the arrow keys. Below 980 px the second pane folds away until the window is wide again.
- **Beside the conversation**: when the agent writes a note, changes a task list or opens a web page while you are in the
  Agent app, it opens in the second pane, and typing stays in the conversation. A pane you chose for something else is
  never replaced; that app gets its dot on the rail instead.
- **Replies read as formatting**: headings, lists, quotes, code, bold and links (links open as tabs in Mobius). The
  reply is read into plain data, never HTML, and only web and mail links are followed.
- **Little Mobius**: the Mobius panel popped out into a small window kept above other apps (Ctrl+Shift+M). It shares
  conversations with the main window and closes with it.
- **On-canvas actions**: select text in a note and a capsule appears above it: Ask (the text joins the agent's message
  box as a Note chip), Rewrite (the agent changes it in the note), Summarise, and Make a task (added straight to the
  first list, no agent needed). On a web page, the selection menu offers Ask, Summarise, Explain, Make a task and Save
  to Notes (quoted on a Clippings page, with a link back).
- **Review and undo**: each agent turn begins with a checkpoint. When a turn ends having changed notes, task lists or
  files, a strip above the message box says so: Review lists each change with its own Undo; Undo all puts back only
  what that turn changed, so edits made since elsewhere are kept. A changed note says so above the page, with Show
  changes and Undo all; changed pages and lists carry a dot in their sidebars.
- **Your rail**: drag an app on the rail to reorder it (or Alt+Up/Down on a focused app), or right-click it to move it,
  hide it, or edit the list. Settings › Appearance › Layout has the full list. Hidden apps are still in the launcher.
  Pin a note, a task list or a web page, and it stays in its app's sidebar.

## What the shell and apps hold

These came from the Mobius Agent design canvas (Mobius 2 boards), which is now history. The one-window decision stands.

- **Mark and icon**: the thin trefoil from the Logo board (V10), one ribbon knotted three times with rounded cuts, filled in the current colour at every size; the glossy coloured ring is the app icon only.
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
- **Accessibility**: with Increase Contrast or forced colours, hairlines get stronger and fills turn to outlines.
- **Profiles**: separate sets of data (Personal, Work…), switched in Settings › Advanced › Profiles or File › Profiles…;
  models are shared. Each reply says what it was **based on**.

The apps on the canvas, each keeping its data as ordinary files other apps can open, with the agent beside it:

- **Calendar** (`calendar/*.ics`): day, week and month; subscribed links and CalDAV accounts (iCloud, Fastmail,
  Nextcloud) beside the person's own calendars; Mobius's suggestions dashed with Decline and Add. Google and Microsoft
  sign-in need app registrations ([calendar sign-in](../reference/calendar-sign-in.md)).
- **Notes** format bar: Aa (styles and marks in one panel), a checklist, a table or a link at the cursor, Record (up
  to ten minutes, turned into words by the speech model and kept as a section), and in the ⋯ menu Clip a web page (a
  page's first paragraphs quoted with its link) and the Markdown view.
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
- **Research** (`research/<folder>/*.md`): a question Mobius looks into with `web.search` and `web.read`, answered as a
  report with web facts marked and a Sources list shown beside it; follow-ups go with the report attached.
- **Reader** (`reading/<list>/*.md`): pages saved to read later as just their words (from a link, the open tab or
  the Browser menu), with where each came from, an Aa panel for text size, typeface and page colour, minutes left
  and the place you stopped kept per article, and Done reading moving it to Archive.
- **Database** (`databases/<name>.sqlite`): CSV files imported as tables, any SQL statement of the person's with the
  rows in a grid; Mobius reads with `db.query` on a read-only connection and changes data only with `db.execute`.
- **Terminal**: the person's commands in a folder of the workspace, one line at a time, `cd` kept inside it, history
  on the arrow keys, and commands that keep running listed with their output and a Stop. Mobius has no tool for it; it
  explains output when asked, with the last output attached.
- **Canvas** (`boards/<folder>/*.json`): a whiteboard of stickies, shapes, text, arrows joining them and pen lines,
  one item per line in the file; sorting into themes or a flowchart from Mobius shows dashed until kept.
- **Photo** (`photos/<album>/`): pictures never changed; adjustment layers to all or part of each, in
  `<photo>.edits.json`; Export writes a new picture.
- **Music** (`studio/<folder>/*.json`): songs as tracks of notes, a piano roll, a small synthesiser; Mobius writes
  notes, never audio.
- **Video** (`video/<project>/`): clips never changed, `cut.json` of shots; the viewer plays clips from the shell's
  `media` address.

- **Review**: everything Mobius changed in every app, from every recent conversation, by day and turn with what was
  asked; filtered by app; each file opens in its app or is put back as it was before its turn; and the conversations
  waiting for the person.
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
