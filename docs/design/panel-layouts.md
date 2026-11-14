# Panel layouts: the frame, views and panels

Decided 2026-11-13. This page says what the frame is in every app, what a view and a panel are, and where each
app's panels sit when it is first opened. The values the frame is painted with are in
[Theme tokens](theme-tokens.md). [Workspace layout](workspace-layout.md) and [Design rules](rules.md) give the frame
and the rules; this page adds the detail the Builder needs.

## The five zones

```
+----+-----------+--------------------------------------+-----------+
|    |           | 3 Toolbar: title · app controls · ⋯ M |           |
| 1  | 2         +--------------------------------------+ 5a    | 5b      |
| R  | App       | 4 Content (the current view)         | Insp- | Mobius  |
| a  | sidebar   |                                      | ector | (just   |
| i  |           +--------------------------------------+ (app's| Mobius, |
| l  |           | 4b Bottom dock (if the app has one)  | panels| no tabs)|
+----+-----------+--------------------------------------+-------+---------+
|      Info bar (compact apps only)                                 |
+-------------------------------------------------------------------+
```

| Zone | What is in it | Moves? |
|---|---|---|
| 1 Rail | Home, Search, the pinned apps, the launcher grid; Mobius, Activity and Settings at the foot. Icons only, name on hover. | Never |
| 2 App sidebar | Always in this order: New, Search, the app's places in named sections, From Mobius, More. | A panel: hide, resize |
| 3 Toolbar | One row. Leading: the title of what is open with a grey subline. Middle: the app's controls, the view switch and Panels. Trailing, always in this order: Comments, Share (where it applies), ⋯, the Mobius button. | Never |
| 4 Content | The current view. May have a bottom dock under it (4b). | The view changes; the zone does not |
| 5a Inspector | The app's own panels (Format, Inspector, Adjust, Outline, Details), as tabs among themselves. Absent in apps without one. | A dock: hide, resize |
| 5b Mobius | The Mobius panel and nothing else: the chat, its cards and the composer. No tabs. Always the far right edge. | Hide, resize, pop out; never takes another panel |

Rules that hold in every app:

- The toolbar title is what is open ("Q3 plan"), never the app's name. The rail already shows the app.
- No second action row inside content. If controls do not fit the toolbar, they go in ⋯ or in a panel.
- The Mobius button is always the last thing in the toolbar and always opens the Mobius panel at the right edge.
  Mobius no longer takes over the sidebar.
- **The Mobius panel is just Mobius** (Andrew, 14 November 2026). No app panel tabs with it or docks inside it. An
  app's panels go in the inspector (5a) or, when they are wide or long, the bottom dock (4b).
- Browser controls (back, forward, address) are in the toolbar's middle slot, not the sidebar.
- Comments stays a toolbar button, because it shows live state: how many threads are open and whether comment mode
  is on. It is also in View › Comments.
- Split view and Little Mobius leave the fixed icons at the top right and are in the Window menu. Little Mobius is
  also "Pop out" on the Mobius panel once stage 3 lands.

## Views

A view is what fills the content zone. An app with more than one view shows a segmented switch in the toolbar's
middle slot (ink-inverted for the current one) and lists them at the top of the View menu with keys Ctrl+1 to
Ctrl+9. Switching views never moves a panel.

## Panels

A panel is a named, self-contained piece of an app. The app sidebar and Mobius are panels too.

| A panel can be | How |
|---|---|
| Shown or hidden | Panels menu, its key, or the close button in its header |
| Resized | Drag the edge beside it; double-click the edge to return to the default size |
| Moved to another dock | Drag its header, or the dock button in its header (left, bottom, inspector) |
| Tabbed with others | Dropped onto a dock that already holds a panel; the dock shows one tab per panel |
| Popped out | The pop-out button in its header: its own window, always above the main one, closes with it |

Every panel has the same header, `--panel-head-h` tall, on `--frame`: its name (or the tabs), then dock, pop out and
close at the trailing end. The Mobius panel's header is its plain title, then new chat, history, pop out and close. Nothing else lives in the header; a panel's own controls go in its body.

Docks:

- **Left**: the app sidebar. Other panels may tab here.
- **Bottom**: under the content, across the content's width only (it does not run under the sidebar or right dock).
- **Inspector**: the app's own panels, between the content and Mobius. It holds any panel the person moves there,
  except Mobius.
- **Mobius**: the right edge, for the Mobius panel only. Nothing can be dropped into it or tabbed with it.
- A dock with no shown panel takes no space. A dock is never narrower or shorter than the minimum in
  [Theme tokens](theme-tokens.md).
- Vertical or horizontal follows the dock: a panel on the bottom lays out in a row, the same panel on the right
  lays out in a column. A panel that cannot do both says which docks it allows.

The Panels menu (toolbar, at the end of the middle slot; also View › Panels) lists every panel of the app: a tick if shown, where it is,
and its key. Below them: **Layouts** (the app's own, then ones the person saved), **Save this layout…** and **Reset
layout**. Layouts are kept per app, per profile.

Narrow windows: adjacent in space on wide windows, stacked in time on narrow ones.

| Window width | What happens |
|---|---|
| 1280px and up | Everything as placed |
| 1280 to 1439px | With both the inspector and Mobius open, Mobius overlays the inspector instead of pushing the content; closing Mobius uncovers it |
| 980 to 1279px | The inspector and Mobius overlay the content instead of pushing it, one at a time |
| 720 to 979px | The sidebar becomes an overlay too, opened from a button at the start of the toolbar; the bottom dock stays |
| Under 720px | One thing at a time: content, or one panel full width. The rail stays |

Folding for width never changes the saved layout.

## Build stages

1. **Show, hide, resize.** The frame (`AppFrame`), the docks at fixed places, the panel header without its dock
   button, the Panels menu with ticks and keys, Reset layout. Layout kept per app.
2. **Move.** The dock button and dragging a header between docks, tabs in a dock, saved Layouts.
3. **Pop out.** A panel in its own window. Little Mobius becomes the Mobius panel popped out, and its own window
   code goes.

App threads adopt after stage 1. Nothing an app declares has to change for stages 2 and 3.

## What an app declares

One description per app, read by the frame. The names here are a suggestion; the Builder owns the final shape.

```ts
interface AppLayout {
  density: 'comfortable' | 'compact';
  views: { id: string; name: string }[];          // one entry means no switch is shown
  panels: {
    id: string; name: string; key?: string;
    dock: 'left' | 'bottom' | 'right';            // where it starts
    shown: boolean;                               // whether it starts open
    allow?: ('left' | 'bottom' | 'right' | 'window')[];  // default: all
  }[];
  infoBar?: boolean;
}
```

`dock: 'right'` puts a panel in the inspector. The sidebar (`left`, shown) and Mobius (always the right edge) are
added by the frame and do not need declaring; no app can declare a panel into Mobius. Shared keys:
Ctrl+\ sidebar, Ctrl+J bottom dock, Ctrl+. Mobius.

## Default layout per app

Every app except Home has the Mobius panel at the right edge, closed until asked for. The Inspector column lists the
app's own panels there; "none" means the app has no inspector. A panel in brackets starts hidden.

### Everyday apps (comfortable)

| App | Views | Sidebar places | Bottom dock | Inspector | Toolbar middle |
|---|---|---|---|---|---|
| Home | Home | Conversations by day, Projects | none | none: the conversation is the content | Model, mode (Ask first, Propose, Act) |
| Mail | Inbox, Conversation | Inbox, Drafts, Sent, labels | none | none | Reply, Archive, Delete, Label |
| Calendar | Day, Week, Month, Agenda | Mini month, calendars with their colours | none | (Event) | Today, back, forward, view switch |
| Tasks | List, Board | Today, Upcoming, lists | none | (Details) | Sort, Filter, view switch |
| Notes | Note | Notebooks, Pinned, Tags | none | (Outline) | Save state, Share |
| Docs | Page | Recent, folders | none | (Outline), (Comments) | Style, bold, italic, list, link, Insert |
| Files | List, Grid | Recent, Made by Mobius, folders | none | (Preview) | Path, Sort, view switch |
| Browser | Page | Tabs, Pinned, Bookmarks | none | none | Back, forward, reload, address |
| Reader | Article | Later, Saved, Feeds | none | (Highlights) | Text size, Listen |
| Search | Results | Recent searches, Scopes | none | (Preview) | The search field, Filters |
| Research | Report | Reports, Sources | none | Sources (shown) | Depth, Export |
| Knowledge | Page | How I work, Memory, Journey, pages | none | (Links here) | Edit, History |
| Projects | Overview, Threads | Projects, Archived | none | none | Filter |
| Slides | Slide, Grid, Present | Slides (thumbnails) | (Speaker notes) | Format (shown) | Insert, Theme, Present, view switch |

### Mobius's own apps (comfortable)

| App | Views | Sidebar places | Bottom dock | Inspector | Toolbar middle |
|---|---|---|---|---|---|
| Settings | Page | The settings sections | none | none | Search settings |
| Abilities | Added, Catalogue | Apps, Skills, Connectors, Updates | none | (Details) | Search, view switch |
| Activity | Needs you, Running, Scheduled, Done | By app, by project | none | (Details) | Filter, Stop all |
| Review | Changes | Waiting, Kept, Discarded | none | none | Keep all, Discard all |
| Views | Board | Dashboards | none | (Card settings) | Add card, Refresh |

### Make and data apps (compact, with an info bar)

| App | Views | Sidebar places | Bottom dock | Inspector | Toolbar middle |
|---|---|---|---|---|---|
| Sheets | Grid | Sheets, Named ranges | (Formula help) | (Format), (Chart) | Formula bar, Format, Insert |
| Database | Table, Board, Gallery, Form | Tables, Saved views | none | (Record), (Fields) | Filter, Sort, Group, view switch |
| Code | Editor, Diff | Explorer, Search, Source control | Terminal (shown), (Problems), (Output) as tabs | (Outline) | Branch, Run, view switch |
| Terminal | Terminal | Sessions | none | none | Shell, Split, Clear |
| Design | Canvas, Prototype | Pages, Layers, Assets | none | Inspector (shown) | Tools, zoom, view switch |
| Canvas | Board | Boards | none | (Inspector) | Tools, zoom |
| Photo | Edit, Compare | Library, Albums | Filmstrip (shown) | Adjust (shown); (Layers), (History) | Tools, zoom, view switch |
| Video | Edit, Viewer | Media, Titles, Sound | Timeline (shown) | Inspector (shown); (Scopes) | Transport, timecode, view switch |
| Music | Arrangement, Session | Sounds, Instruments, Effects, Places | Clip (notes) and Devices (shown), Shift+Tab switches; (Mixer), (Groove) | none | Transport, tempo, metre, view switch |

Notes on the table:

- Where an app's inspector is the main way to work on one canvas (Slides, Design, Photo, Video), it starts shown, and
  opening Mobius puts Mobius beside it at the right edge. Everywhere else the inspector starts hidden or the app has
  none.
- Music has no inspector: its devices run left to right in the bottom dock, the instrument first and then the effects,
  beside the clip's notes (Andrew chose this on 14 November). Shift+Tab switches between notes and devices.
- Home has no Mobius panel: the conversation is its content. The Mobius button in the rail goes to Home.
- When Mobius proposes something, the proposal shows in the content first (dashed), and the panel carries the
  explanation and Keep, Discard, Try another. The panel opens by itself only when the person asked Mobius something.
- These are starting places. Once a person moves a panel, their layout wins until they choose Reset layout.

## Shared pieces the frame needs

Candidates for `apps/desktop/src/ui/`, seen in more than one mock:

| Piece | Used by |
|---|---|
| `AppFrame`, `AppSidebar`, `Toolbar`, `Dock`, `PanelHeader`, `PanelsMenu` | Every app |
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
