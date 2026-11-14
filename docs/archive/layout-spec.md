# One Mobius layout for every app

> **Archived record.** Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Don't work from it: the source of truth is the [workspace layout](../design/workspace-layout.md) and [panel layouts](../design/panel-layouts.md).

Nov 12, 2026

**Recommendation: give every app the same five-zone window.** A slim app rail on the far left that never changes. The app's own sidebar next to it. One toolbar row on top of the content. The content itself. Mobius in a panel on the right, opened from the same place in every app.

Today each app builds its own top: some have a second action row inside the content, some put controls in the sidebar, and Mobius takes over the sidebar when you open it. So moving between apps feels like moving between products. The five zones fix where things live, and only what is inside them changes per app.

The layout rests on seven design principles, set out below with the research behind them. No code changes until Andrew decides. The decision is at the end.

## At a glance

&#91;embedded content: the Mobius window · five zones\]

The rail, the sidebar's order, the toolbar's ends and the right panel's place are fixed. The places, the toolbar middle, the content and the inspector are each app's own.

## What we saw in the build today

The apps share a theme, but not a structure. Checked against the 28 light screenshots of main at 82fffe9 and `App.tsx`.

| Area | What happens now | Where |
| --- | --- | --- |
| Top of the window | The toolbar row holds only the title and three window icons. The real controls sit in a second row inside the content, drawn by each app. | Docs format bar, Calendar Today and Day/Week/Month, Slides Add slide and Play, Reader paste bar |
| Title | The app name shows twice: in the sidebar head and as the toolbar title. | Code, Design, Canvas, Music, Photo, Projects, Files, Sheets |
| Top right | Little Mobius, split view and comments take the best spot in every app, though people use them rarely. | Every app |
| Sidebar head | Five things in about 170px: app icon, name with a menu, Mobius mark, Menu, fold. Switching apps is hidden behind the name. | Every app |
| Sidebar body | New, Search and sections come in different orders, or are missing. Some sidebars hold a paragraph of help text. | Mail, Calendar, Files, Photo, Video, Projects have no search. Code, Photo, Terminal explain themselves in the sidebar |
| Browser | Back, forward, reload and the address bar live in the sidebar. No other app puts its main controls there. | Browser |
| Second sidebars | Some apps draw a list inside the content as well. | Docs outline, Slides thumbnails, Calendar mini month |
| Right side | Slides has its own inspector inside the content. Mobius can also pin to the right. The two would fight for the same space. | Slides, Design, Photo |
| Mobius | Opening Mobius replaces the app's sidebar, so you lose your lists while you talk. The panel and the Agent app both say "What can I help with?" | Every app |

None of these is a bug on its own. Together they mean the eye has to find the controls again in each app.

## Design principles

Seven principles, in priority order, plus an eighth from Ableton Live below the table. When two pull apart, the higher one wins. Each comes from what the strongest products say about their own design, and each names a test a reviewer can apply to a screenshot.

| # | Principle | What it means in Mobius | The test | Where it comes from |
| --- | --- | --- | --- | --- |
| 1 | **The work comes first.** | Controls sit around the content and stay quiet. One toolbar row. A dimmer sidebar. No help text in the frame. | Squint at the screen. Is the content the first thing you see? | Apple: controls "elevate and distinguish the content beneath them". Linear: "Structure should be felt not seen". Fluent: "Built for focus" |
| 2 | **Same place in every app.** | The five zones. New, Search, the title, the ⋯ menu and Mobius never move. | Flip between two apps. Does anything in the frame jump? | Apple: layout "consistent with other apps and system experiences". Linear 2026: headers, navigation and view controls made the same across every area |
| 3 | **One obvious way.** | Each action has one home. Mobius has one button. No second toolbar, no duplicate New. | Can you find two controls that do the same thing? | Dia: "a single obvious way to accomplish any task". VS Code: "do not repeat existing functionality" |
| 4 | **Familiar first. Spend the novelty on Mobius.** | Each app works the way its best rival does: the address bar is on top, mail is three panes. New ideas go into what only Mobius has. | Could a Gmail or Safari user work here in the first minute? | Dia: "familiarity" and a "novelty budget" spent on chat, not on core browsing |
| 5 | **The app shapes the tools. The frame holds.** | Apps differ in the toolbar middle, the places and the inspector. Nothing else. | Is the difference inside a zone, or did the app redraw the zone? | VS Code: fixed containers that every extension fills. Mobius's own "one frame, a shape per app" |
| 6 | **Mobius is beside you, never in the way.** | Three sizes only: full (Home and the Agent app), beside (the right panel), and in place (verbs on a selection). Every app works fully with Mobius closed. | With Mobius open, can you still see and use everything you could before? | Microsoft: immersive, assistive and embedded. The assistive side bar works "without obstructing the main content area" |
| 7 | **You are the pilot.** | What Mobius is doing is always visible. What it changed is dashed until you Keep it. Why it did so is one click away. Undo always works. | Can you tell what Mobius did, why, and how to put it back? | Microsoft: "The human is the pilot". "Agent status ... is clearly visible at all times" |

### What Ableton Live adds

Andrew pointed to Eric Carl's talk notes, [Ableton Live and designing for authenticity](https://ericcarl.link/blog/ableton-live-and-designing-for-authenticity/). Live has looked like itself for over twenty years, so it is the best case study for a timeless design. Its ideas sharpen four of the principles and add one.

| Ableton's idea | In their words | What it changes for Mobius |
| --- | --- | --- |
| Authenticity | The design expresses the subject, not a style. A stylised look "would dictate too much" | New principle 8, below. The theme has no material or decoration of its own |
| Abstraction | "A slider is just a line, a dial is just a curved slider" | Controls are drawn as plainly as they can be. This backs the flat theme over glass |
| Two colours | Live was meant to use "primarily" a two-colour system | The frame stays neutral and indigo marks Mobius. Colour is kept for the person's own content, as Live keeps it for tracks and clips |
| One window | "Window management has nothing to do with being a musician" | Confirms one window. Little Mobius and split view stay secondary |
| Adjacent in space, stacked in time | Side by side suits large screens; one after another suits small ones | The rule for the five zones as the window narrows: wide windows show sidebar, content and panel together; narrow ones show one at a time |
| No tools, direct manipulation | One pointer, no tool switching | Act on the thing itself. Mobius works on what you select, in place. Avoid modes such as a separate comment mode |
| Emptiness and openness | New sets start empty, so the person makes the decisions | Empty states stay quiet. No sample data, no wall of suggestions |
| Honest representation | A prototype that hid the mixer misrepresented the signal flow, so it was put back | Never hide what Mobius read, changed or is doing to make the screen look simpler |
| Own dialogs | Dialogs look like Live, not like the operating system | Mobius looks the same on Windows, Mac and Linux: own typeface, own controls |
| Stability while evolving | Principles keep the product steady as it grows | Change the theme rarely. Do not follow each year's platform style |

**Principle 8: Plain and honest.** The interface shows what is really there and what Mobius really did, drawn as simply as it can be. Nothing is decoration. The test: can you remove it without losing meaning? If yes, remove it.

One rule for how we work follows from these: **fix it once, in the shell.** Linear's team found that design debt "is best to be paid in larger sweeps". A problem seen in three apps is a missing shared piece, not three app fixes.

These would replace the four principles at the top of `docs/design/rules.md`. The detailed rules there stay, re-sorted under the principle each one serves.

## What stays the same in every app

Each zone has one job, one place and one set of fixed parts. An app fills the zone; it never moves or redraws it.

| Zone | Its job | Always the same | Filled by the app |
| --- | --- | --- | --- |
| 1. App rail (far left, about 52px) | Get to any app, see what needs you | Home, Search, your pinned apps, then Mobius, Activity with its badge, Settings and profile at the foot. Never folds away. | Nothing. Badges and dots only. |
| 2. Sidebar | Move around inside the app | One order: New, Search, the app's places in sections, From Mobius, then More (trash, archive). Same width, same row styles, same fold key. | The places: mailboxes, notebooks, tabs, folders, lists |
| 3. Toolbar (one row, top of the content) | Act on what is open | Leading: sidebar toggle, then the title of what is open (never the app name again) and one grey line. Trailing: Share where it applies, the ⋯ menu, and the Mobius button. | The middle: the app's own controls. Format bar, Day/Week/Month, address bar, transport |
| 4. Content | The work | Solid surface, one empty state, one review bar for Keep, Try another and Discard. | Everything inside |
| 5. Right panel | Details and Mobius | One column on the right, same width and card. Mobius docks here by default. Other panels can dock here too, as tabs. See Views and panels. | Whether the app has an inspector |

Little Mobius, split view and comments move off the top right. They go to the View menu, the ⋯ menu and their keys, where the launcher also finds them.

## What changes per app

Apps differ in three ways only: what fills the toolbar middle, whether the sidebar starts open, and whether there is an inspector. Five kinds cover all 25 apps.

| Kind | Apps | Sidebar at start | Toolbar middle | Inspector on the right |
| --- | --- | --- | --- | --- |
| Organise | Mail, Tasks, Calendar, Files, Projects | Open | View switch (Day/Week/Month), Today, the main actions (Reply, Reply All, Forward) | No. Mail and Calendar open details in the content |
| Write | Notes, Docs, Knowledge, Reader | Open, folds on its own while typing | Aa, insert, history. The Docs outline moves into the sidebar under the document | No |
| Browse | Browser, Research, Search | Open | Back, forward, reload and the address bar | No |
| Data | Sheets, Database, Views | Open | Formula bar or query bar, then filter and sort | Optional (cell or column details) |
| Make | Slides, Design, Canvas, Photo, Video, Music, Code, Terminal | Folded, to give the canvas room | Tools and play or run (Add slide, Play, transport, crop) | Yes: Slides style, Design layers, Photo adjust, Music device |

The Agent app is the one special case. Its content is the conversation, so the right panel stays closed there and the Mobius button opens the conversation list instead.

## Past decisions to drop

Each of these made sense on the canvas. In daily use they work against the layout above.

| Decision | When | Why it hurts now | Replace with |
| --- | --- | --- | --- |
| Mobius morphs the left sidebar; no right panel unless pinned | 10 Nov | You lose your mailboxes or notes the moment you ask Mobius about them. Every strong rival puts the assistant beside the work. | Mobius opens in the right panel in every app. The sidebar never changes face |
| The sidebar head is the app switcher | 9 Nov | Switching apps, the most common move, is hidden behind a small name menu. The head is crowded with five controls. | The app rail. The sidebar head keeps only the app's name and fold |
| The sidebar folds into an icon rail that is also the switcher | 9 Nov | The rail only exists when the sidebar is hidden, so the way you switch apps changes shape. | One rail, always there. Folding hides only the app's sidebar |
| Browser controls live in the sidebar (Arc style) | 9 Nov | The Browser is the only app whose main controls are on the left. It breaks the rule for one app. | Address bar and back and forward in the toolbar middle, like every app's main controls |
| "The toolbar title is never empty", shown as the app name | Design rules | It repeats the name from the sidebar head. | The title names what is open. With nothing open, the toolbar shows the app's controls only |
| Window icons fixed at the top right | Mobius 2 shell | Three rarely used buttons sit where the eye goes for actions. | View menu, the ⋯ menu and keys |
| Each editor draws its own action row | App passes | The design rules already say one toolbar row, but the shell row has no slot for app controls, so apps add a second row. | A toolbar slot every app fills |

Also dropped, from the theme work below: Liquid Glass as the north star, so the sidebar becomes a flat panel, and any fixed place for an inspector. Kept on purpose: one theme system for every app, the dashed Mobius edge, Keep, Try another and Discard, and the launcher.

## How strong rivals do it

The products that hold many tools in one window all keep a fixed outer frame and let only the inside change. The assistant always opens on the right, from the same button.

| Product | What never changes | What changes per tool | Where the assistant sits |
| --- | --- | --- | --- |
| VS Code, Cursor | Activity bar on the far left, status bar at the foot | The side bar's contents, the editor | Secondary side bar on the right |
| Microsoft 365 (Teams, Outlook, Word) | App bar on the far left | The app's list pane and ribbon | Copilot pane on the right, same button in each app |
| Google Workspace | Top bar with search and the app grid | The app's sidebar and toolbar | Gemini side panel on the right, same button in each app |
| Notion | One sidebar for the whole workspace | The page and its top bar | Agent chats in their own sidebar tab; AI also works inline |
| Apple apps on macOS (Mail, Notes, Pages) | Sidebar, one unified toolbar, inspector on the right | The toolbar's items and the inspector | Apple Intelligence works inline on selected text |
| Arc, Dia | The sidebar is the whole browser | Only the page | Dia's chat is a sidebar beside the page |

Arc is the outlier, and it is a single app. Mobius took its sidebar-first idea while being a suite, which is where the apps started to feel different from each other.

## What the deeper research found

Eight sets of sources, read on 12 November 2026. Each one changed or confirmed a part of the proposal.

| Source | What they did or say | What Mobius takes from it |
| --- | --- | --- |
| [Linear, 2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) | One "inverted L" of global chrome, a sidebar plus a top bar, controls every view. Headers hold filters and display options. Side panels hold properties. | The rail, sidebar and toolbar are one frame. Properties go in a right panel, never in the content. |
| [Linear, March 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) | "Don't compete for attention you haven't earned." The sidebar got dimmer, icons smaller, separators fewer. Header actions were put in predictable places. | The sidebar and rail should be quieter than they are now. Fewer coloured icons in the frame. |
| [Dia's design strategy](https://browsercompany.substack.com/p/the-strategy-behind-dias-design) | The team that built Arc went back to a familiar browser. Novelty is a budget, spent on chat. Chat is a sidebar that uses the open page as context. | Move the Browser's controls back to the top. Keep Mobius's new ideas for the agent, not the frame. |
| [Notion 3.4](https://notion.com/releases/2026-03-26) and its [sidebar guide](https://www.notion.com/help/sidebar) | "The sidebar was getting far too crowded." It was split into four tabs: pages, agent chats, meetings, notifications. Two points are fixed; everything between is the user's to arrange. | A crowded sidebar head is a known failure. The rail keeps fixed points at its ends and lets people arrange their apps between them. |
| [Microsoft, UX for agents](https://microsoft.design/articles/ux-design-for-agents/) and [Copilot UX guidance](https://learn.microsoft.com/en-us/microsoft-cloud/dev/copilot/isv/ux-guidance) | Three ways to place an assistant: immersive (full canvas), assistive (a side bar), embedded (one entry point in place). Status is visible at all times. Show why it did what it did. | Mobius has exactly these three sizes. Morphing the sidebar is a fourth that no one else uses. |
| [Google Workspace, September 2026](https://9to5google.com/2026/09/09/gemini-workspace-side-panel-upgrade/) | The Gemini side panel now has the same features in Gmail, Drive, Docs, Slides and Chat, and works across apps from any of them. | The panel is the same Mobius in every app. Only what it sees changes. |
| [Apple HIG, sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) and [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) | Hierarchy, harmony, consistency. A sidebar is for moving between areas, two levels deep at most. Don't hide it by default. Nothing critical at its foot. | The sidebar is for places only. The Docs outline and Slides thumbnails are a second level and belong in it, not in the content. |
| [VS Code UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) | Fixed containers: activity bar, primary side bar, secondary side bar, panel. Each toolbar's actions are scoped to its container. "Do not overload toolbars." | An app fills slots. A toolbar holds actions for what is open in its zone, and nothing else. |

Three things stood out. First, two teams that once led with novel layouts, Arc's and Notion's, both moved back toward a familiar, calmer frame in the last 18 months. Second, nobody lets the assistant replace the navigation. Third, the products that feel most like one product (Linear, Workspace) got there by making headers and panels identical, not by making the theme identical. Mobius already has the theme.

## Theme: timeless over current

Andrew's direction on 12 November: work toward a more timeless design. The theme should get its character from type, spacing and restraint, which do not date, and not from this year's materials.

| Part | Today | Timeless |
| --- | --- | --- |
| Surfaces | Six cool greys, glass and blur on the sidebar, toolbar and panel | Three flat surfaces: a neutral frame, paper content, raised. Hairlines instead of shadows and blur. Only floating things (menus, popped-out panels) cast a shadow |
| Frame colour | Indigo for buttons, links, selection and Mobius | The frame is neutral. Controls and state use ink: the active tool, mute, solo and the selected clip are inverted, not tinted. Red only for record, errors and deleting |
| Content colour | Little, and set by the app | Colour belongs to the person's content and they choose it: tracks and clips, calendars, labels, tags, folders |
| Mobius | Indigo, shared with other uses | The dashed edge first, indigo second. It stays findable next to coloured content |
| Themes | Light and dark | A theme is a small set of neutral tokens. Ship several (Light, Mid grey, Dark, Cool dark) and let people adjust tone and contrast, as Live does |
| Density | One | Two from the same tokens: comfortable (30px rows, 13px text) for Mail and Notes; compact (26px rows, 12.5px text) for Music, Video, Code and Sheets |
| Type | The system font, so it differs per platform | Inter for the interface and Inter Display for titles, the same on Windows, Mac and Linux |
| Icons | A coloured gradient tile per app in the frame | Single-weight line icons in the rail. Colour tiles only in the launcher |
| Shape | Capsules and pills, 14 to 18px panels | 6 to 8px corners on controls and rows |
| Motion | Tokens exist; use varies | Motion shows what is live (playhead, meters, Mobius working) and where a panel came from. Never decoration |

This drops Liquid Glass as the north star. Apple's guidance on clarity, layout and motion stays. Mocks of Mail, Calendar, Browser, Docs, Music, Photo and Video in this theme are in the project files under `layout/`. The first, Docs beside today's build, is `layout/docs-today-vs-timeless.png`.

## Views and panels

Andrew's direction on 12 November, after the dense Music, Photo and Video mocks: complex apps are made of views and panels that people can show, hide, resize, rearrange and pop out. This replaces any fixed rule about where an inspector goes.

| Term | What it is | Examples | What the person can do |
| --- | --- | --- | --- |
| View | What fills the content zone | Session or Arrange in Music. Library or Edit in Photo. Day, Week, Month in Calendar | Switch it in the toolbar |
| Panel | A named, self-contained piece around the view | Clip, Devices, Groove, Mixer, Inspector, Timeline, Filmstrip, Outline. Also the app's sidebar and Mobius | Turn it on or off, resize it, dock it left, bottom or right, or pop it out into its own window |
| Layout | A saved arrangement of panels | Arranging, Mixing, Sound design | Pick one, save the current one, or reset |

Rules that keep it calm:

- The rail and the toolbar never move. Only panels do.
- Every panel has the same header: its name, dock, pop out, close.
- Each app has one Panels menu, listing every panel with a tick, where it sits, and its key.
- Each app ships a sensible default layout. Simple apps such as Mail and Notes have two or three panels and the same system.
- A docked panel changes between wide and tall to fit its side, where that makes sense.
- Little Mobius is the Mobius panel popped out. It stops being a special case.

What the dense screens showed: the content zone needs a bottom dock (clip editor, timeline, filmstrip, terminal), complex apps need a one-line info bar at the foot, and Mobius's proposals stay easy to find when it changes several things at once, because the dashed edge is used for nothing else. The mock with the Panels menu open and Devices popped out is `layout/timeless-music-panels.png`.

## Roll-out and the decision

The frame is shell work, so the Builder lands it first. App threads then move their controls into it, one small PR each.

1. **Shell (Builder).** An `AppFrame` in `apps/desktop/src/ui/` with four slots: sidebar, toolbar title, toolbar controls, inspector. The app rail, the right panel with Mobius, and the window icons moved to menus. Built on the approved Base UI controls.
2. **Sidebar skeleton (Builder).** A shared `AppSidebar` that enforces New, Search, sections, From Mobius, More.
3. **Apps adopt (app threads).** Each app moves its second row into the toolbar slot and its help text out of the sidebar. Daily apps first: Mail, Calendar, Tasks, Notes, Docs, Browser.
4. **Rules (Design reviewer).** `docs/design/rules.md` and `workspace-layout.md` rewritten around the five zones, so reviews check against them. The theme tokens (three surfaces, two densities, Inter) land with the frame. Panels come in three stages: show, hide and resize; then move between docks; then pop out into a window.

**Decision for Andrew:** adopt the eight principles, the five-zone layout with views and panels, and the timeless theme, with Mobius on the right by default?

- **Adopt it (recommended).** Builder starts the frame; apps follow.
- **Adopt it, but keep Mobius in the left sidebar.** Less change to the panel; you still lose your lists while talking to Mobius.
- **Keep today's shell** and only fix the listed inconsistencies app by app.
