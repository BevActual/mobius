# Panel layouts: the frame and each app's panels

Decided 2026-11-17 (Andrew: the shared left sidebar and the app rail no longer fit Mobius; each app designs and
manages its own panels, with a default layout of its own; a button in the top bar opens Ctrl+K; the Mobius panel
stays as it is, docked). This replaces the five zones decided on 2026-11-13. The values the frame is painted with are
in [Theme tokens](theme-tokens.md); [Design rules](rules.md) gives the rules.

## The frame: three things

```
+------------------------------------------------------------------+
| [Go: icon Mail •] Title of what is open | app controls | Panels ⋯ M |   top bar
+---------+------------------------------------------+------+--------+
| App's   |                                          | App's| Mobius |
| left    | Content (the current view)               | right| (just  |
| panels  |                                          | panel| Mobius,|
|         +------------------------------------------+ s    | docked)|
|         | App's bottom panels                      |      |        |
+---------+------------------------------------------+------+--------+
```

The shell draws only the **top bar**, the **content** area and **Mobius** at the right edge. The top bar spans the
whole window, and every panel, Mobius included, starts below it (Andrew, 17 November 2026: it unifies the look and
keeps the apps modular; Ableton Live is the model: its control bar runs across the top and the browser, detail
view and devices sit below it). The Go button and title stay in the same place in every app, whatever panels it has, and on
Windows the window controls share the bar's row. Everything else is the
app's: which panels it has, which dock each sits in (left, right of the content, bottom), and which show the first
time it is opened. There is no app rail and no shared sidebar.

| Part | What is in it | Who owns it |
|---|---|---|
| Top bar | Leading: the **Go button** (the open app's icon and name; a dot while something waits anywhere), then the title of what is open with a grey subline. Middle: the app's controls and view switch. Trailing, always in this order: Panels, Comments and Share where they apply, ⋯, the Mobius button. | Shell; the app fills the middle |
| Content | The current view. | App |
| Left, right and bottom docks | The app's panels. A dock with nothing shown takes no space. The bottom dock runs under the content only. | App |
| Mobius | The Mobius panel and nothing else: the chat, its cards and the composer. Always the far right edge, docked (Andrew 2026-11-17: docked, not floating). Pop out makes it Little Mobius. | Shell |

### The top bar is almost a panel

Andrew, 2026-11-17: the frame should feel modular. The top bar is listed in the Panels menu like a panel and can be:

- **Hidden** (focus mode, from the Panels menu or Ctrl+Shift+F): it slides away, and moving the pointer to the top
  edge brings it back over the content. The window can still be dragged from that edge.
- **Customised**: right-click it to choose which of the app's commands sit in the middle and in what order, kept per
  app. The Go button, the title, Panels, ⋯ and Mobius are always there and cannot be removed.
- **Compact**: a shorter height, the default in compact apps.

It never moves to another dock and never closes without a way back: it holds the window's drag area and buttons, and
the Go button and Mobius stay in one place in every app.

### Tool panels

Where an app has a full set of tools, they are a panel like any other (shown, hidden, docked, popped out), and the
top bar's middle keeps only the few commands the app always needs.

| App | Tool panel | Starts |
|---|---|---|
| Design, Canvas, Photo | Tools: the tool palette | Left, shown; pops out as a floating strip |
| Docs, Notes | Format: the formatting bar | Under the top bar, shown; hidden in focus mode |
| Code | Run: run, tests, branch | Under the top bar, hidden |
| Sheets | Formula and Format: the formula bar and format tools | Under the top bar, shown |
| Video | Tools: blade, trim, titles | Left of the timeline, shown |

A panel docked "under the top bar" lays out in a row across the content, like the bottom dock but at the top.

## The Go button and Ctrl+K

The Go button opens the launcher (Ctrl+K), which now does everything the rail did. What it does in full, and the order to build it in, is in [launcher.md](launcher.md).

- **Nothing typed:** Ask Mobius first. Then the pinned apps in one row, each with a dot while it has something
  waiting; drag to reorder, right-click to pin or unpin. Then **Recent**: the things last open in any app (a note, a
  thread, a file, a song), newest first. At the foot: Home, Activity, Abilities, Settings.
- **Typing:** one search over apps, items in every app, commands and open tabs; Ask Mobius stays the first row, so a
  search with no match becomes an ask.
- **Keys:** Ctrl+K opens it from anywhere. Ctrl+1 to Ctrl+9 open the pinned apps in order, so switching apps is still
  one key. Ctrl+Tab goes back to the app used before.
- **Waiting:** the dot on the Go button replaces the rail's badges; the launcher shows which app it is.

Views keep their switch in the top bar's middle slot; their keys move to Alt+1 to Alt+9 to free Ctrl+1 to Ctrl+9.

## Panels

A panel is a named, self-contained piece of an app: a list of places, an outline, an inspector, a timeline.

| A panel can be | How |
|---|---|
| Shown or hidden | Panels menu, its key, or the close button in its header |
| Resized | Drag the edge beside it; double-click the edge for the default size |
| Moved to another dock | Drag its header, or the dock button in its header (left, right, bottom) |
| Tabbed with others | Dropped onto a dock that already holds a panel |
| Popped out | The pop-out button in its header: its own window, above the main one |

Every panel has the same header, `--panel-head-h` tall: its name (or the tabs), then dock, pop out and close. A
panel's own controls go in its body. The library keeps the pieces most list panels want (`SidebarSection`,
`SidebarRow`, `SidebarSearch`), but no app has to follow one order any more; an app's panel is designed for that app.

The Panels menu (top bar, also View › Panels) lists the open app's panels with a tick, where each one is, and its
key; then the app's Layouts, Save this layout…, and Reset layout. Layouts are kept per app, per profile. Once a person
moves a panel, their layout wins until Reset layout.

Shared keys: Ctrl+\\ the app's left dock, Ctrl+Alt+\\ its right dock, Ctrl+J the bottom dock, Ctrl+. Mobius.

Narrow windows:

| Window width | What happens |
|---|---|
| 1440px and up | Everything as placed |
| 980 to 1439px | The right dock and Mobius share one column: whichever was brought forward last shows |
| 720 to 979px | The left dock becomes an overlay, opened from its key or the Panels menu; Mobius slides over the content and closes when the content is clicked |
| Under 720px | One thing at a time: content, or one panel full width |

Folding for width never changes the saved layout.

## What an app declares

```ts
interface AppLayout {
  density: 'comfortable' | 'compact';
  views: { id: string; name: string }[];          // one entry: no switch shown
  panels: {
    id: string; name: string; key?: string;
    dock: 'left' | 'right' | 'bottom' | 'top';    // where it starts ('top': a tool row under the top bar)
    shown: boolean;                               // whether it starts open
    allow?: ('left' | 'right' | 'bottom' | 'window')[];  // default: all
  }[];
  infoBar?: boolean;
}
```

Mobius is added by the frame; no app can declare a panel into it.

## Default layout per app

A first pass, to be refined app by app (Andrew: "then we can design what panels each app needs and refine them").
Bracketed panels start hidden. Every app has Mobius at the right edge, closed until asked for, except Home.

### Everyday apps (comfortable)

| App | Left | Bottom | Right | Top bar middle |
|---|---|---|---|---|
| Home | Chats: conversations by day, Projects | none | none: the desk and the conversation are the content | Model, mode |
| Mail | Mailboxes: Inbox, Drafts, Sent, labels, accounts | none | (Contact) | Reply, Archive, Delete, Label |
| Calendar | Calendars: a small month, calendars with their colours | none | (Event) | Today, back, forward, view switch |
| Tasks | Lists: Today, Upcoming, lists | none | (Details) | Sort, Filter, view switch |
| Notes | Notebooks: notebooks, Pinned, Tags | none | (Outline), (Comments) | Save state, Share |
| Docs | Documents: Recent, folders | none | (Outline), (Comments) | Style, bold, italic, list, link, Insert |
| Files | Places: Recent, Made by Mobius, folders, drives | none | (Info) | Path, Sort, view switch |
| Browser | (Tabs: vertical tabs, Pinned, Bookmarks) | none | none | Back, forward, reload, address |
| Reader | Library: Later, Saved, Feeds | none | (Highlights) | Text size, Listen |
| Search | (Recent searches) | none | (Preview) | The search field, Filters |
| Research | Reports | none | Sources | Depth, Export |
| Knowledge | Pages: How I work, Memory, Journey, pages | none | (Links here) | Edit, History |
| Projects | Projects | none | none | Filter |
| Slides | Slides (thumbnails) | (Speaker notes) | Format | Insert, Theme, Present, view switch |

### Mobius's own apps (comfortable)

| App | Left | Bottom | Right | Top bar middle |
|---|---|---|---|---|
| Settings | Sections | none | none | Search settings |
| Abilities | Kinds: Apps, Skills, Connectors, Updates | none | (Details) | Search, view switch |
| Activity | (By app, by project) | none | (Details) | Filter, Stop all |
| Review | none: the changes are the content | none | none | Keep all, Discard all |
| Views | Dashboards | none | (Card settings) | Add card, Refresh |

### Make and data apps (compact, with an info bar)

| App | Left | Bottom | Right | Top bar middle |
|---|---|---|---|---|
| Sheets | (Sheets, Named ranges) | (Formula help) | (Format), (Chart) | Formula bar, Format, Insert |
| Database | Tables, Saved views | none | (Record), (Fields) | Filter, Sort, Group, view switch |
| Code | Explorer, (Search), (Source control) as tabs | (Terminal), (Problems), (Output) as tabs | (Outline) | Branch, Run, view switch |
| Terminal | (Sessions) | none | none | Shell, Split, Clear |
| Design | Layers, (Pages), (Assets) as tabs | none | Inspector | Tools, zoom, view switch |
| Canvas | (Boards) | none | (Inspector) | Tools, zoom |
| Photo | (Library and albums) | Filmstrip | Adjust, (Layers), (History) | Tools, zoom, view switch |
| Video | Media, (Titles), (Sound) as tabs | Timeline | Inspector, (Scopes) | Transport, timecode, view switch |
| Music | Sounds: instruments, effects, places | Clip (notes) and Devices, Shift+Tab switches; (Mixer), (Groove) | none | Transport, tempo, metre, view switch |

Notes:

- Where the right panel is the main way to work on one canvas (Slides, Design, Photo, Video), it starts shown, and
  opening Mobius puts Mobius beside it at the right edge.
- Music's devices run left to right in the bottom dock, beside the clip's notes (Andrew, 14 November).
- Home has no Mobius panel: the conversation is its content, and its Chats panel lists the conversations.
- When Mobius proposes something, the proposal shows in the content first (dashed); the Mobius panel carries the
  explanation and Keep, Discard, Try another.

## Where each app is now

Checked against the code on 19 November 2026. Every app's list is its left panel (#526 to #531), and the right
and bottom docks are now panels too (#542 onward), so each can be hidden, resized, moved and tabbed.

**The rule of thumb for each dock:**

- **Left** is what you choose from: lists, places, layers.
- **Right** is about the one thing that's open: details, outline, inspector, sources, a person. Mobius sits at the
  far right edge, and an app's right panel sits just inside it.
- **Bottom** is a second view of the work that needs the window's width: a timeline, devices, presenter notes, a
  query and its rows, a terminal.

| App | Panels now | Next |
|---|---|---|
| Home, Projects, Terminal, Search, Settings | As the table above | |
| Mail | Mailboxes; (Contact) right | |
| Messages | Channels; (Thread) and (Person) right, as tabs | |
| Calendar | Calendars; (Event) and (Person) right | |
| Tasks | Lists; (Details) right | |
| Notes | Notebooks; (Outline) right | Comments stay under the page for now; a right panel if they grow |
| Docs | Documents; (Outline) and (Comments) right | |
| Research | Reports; Sources right | |
| Reader | Library; (Highlights) right | |
| Knowledge | Pages; (Links here) right | |
| Files | Places; (Info) right | |
| Slides | Decks; Format right; Presenter notes bottom | Slide thumbnails as a left panel |
| Design | Designs; Layers and (Assets) left, as tabs; Inspector right | |
| Canvas | Boards; (Inspector) right | |
| Photo | Albums; Adjust right; Filmstrip bottom | |
| Video | Videos; Shot right; Timeline bottom | |
| Music | Songs; Clip and Devices bottom | (Mixer), (Groove) |
| Sheets | Sheets; Format right | |
| Database | Tables; (Record) right; (Query) bottom | |
| Code | Explorer; (Outline) right; Tests and (Console) bottom, as tabs | |
| Abilities, Activity, Views | Their lists | (Details) or (Card settings) right |

Bracketed panels start hidden.

## Build order

1. **Frame (Builder):** remove the rail and the shell's left sidebar; the Go button in the top bar; a left dock in
   `PanelLayout` beside right and bottom; Panels menu and keys as above; Ctrl+1 to 9 for pinned apps.
2. **Launcher (Design lead, Builder wires it):** pinned row with waiting dots, Recent across apps, the foot row.
3. **Apps (Apps lead):** each app moves its sidebar into its own left panel and declares its layout, in batches:
   Home, Mail, Calendar, Tasks, Notes, Docs, Files, Browser first; then the rest. Each round refines that app's
   panels, not just moves them.

## Shared pieces the frame needs

Candidates for `apps/desktop/src/ui/`, seen in more than one mock:

| Piece | Used by |
|---|---|
| `AppFrame`, `Toolbar`, `Dock`, `PanelHeader`, `PanelsMenu`, the Go button | Every app |
| `SidebarSection`, `SidebarRow`, `SidebarSearch` (list pieces for a left panel) | Apps whose left panel is a list of places |
| View switch (segmented, ink-inverted) | Every app with two or more views |
| Info bar (one line: what is under the pointer, selection, state) | Compact apps |
| Tool group with an ink-inverted active tool | Design, Canvas, Photo, Video |
| Slider with a centre zero and a proposed (dashed) tick | Photo, Video, Music |
| Inspector section (name, collapse, rows of label and control) | Slides, Design, Photo, Video |
| Timeline lane and clip | Music, Video |
| Proposal card (what, why, Keep, Discard, Try another) | The Mobius panel, in every app |

## Mocks

In the project files under `layout/`: `timeless-overview.png` (Mail, Calendar, Browser, Music, Docs),
`timeless-music-panels.png` (the Panels menu open, Devices popped out, Groove docked), `timeless-music-dense.png`,
`timeless-photo.png`, `timeless-video.png`, with HTML sources beside them.
