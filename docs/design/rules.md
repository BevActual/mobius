# Design rules

These are the rules every Mobius app follows, so the apps feel like one product. They come from the layout direction
Andrew adopted on 13 November 2026 ("One Mobius layout for every app"). That direction draws on Apple's Human Interface
Guidelines, Linear, Dia, Notion, Microsoft's agent guidance, VS Code and Ableton Live, and on design reviews of the real
app. Each review that settles a question adds or changes a rule here.

[Workspace layout](workspace-layout.md) describes the five zones of the window, the views and panels, and what each one
does. This page says how they must look and behave. Where the two disagree, this page wins.

Before you open a pull request for an app, check its screenshots against this page in light and dark, at full width
and in a narrow window.

> **While the new frame lands.** The Builder is building the shared frame (`AppFrame`, the app rail, the right panel,
> `AppSidebar`) and the new theme tokens. Until an app has moved into that frame, review its new work against these
> rules, but don't ask it to redraw the parts the frame will replace.

## Principles

Eight principles, in priority order. When two pull against each other, the higher one wins. Each one has a test a
reviewer can apply to a screenshot.

| # | Principle | What it means in Mobius | The test |
| --- | --- | --- | --- |
| 1 | **The work comes first.** | Controls sit around the content and stay quiet. One toolbar row. A dim sidebar. No help text in the frame. | Squint at the screen. Is the content the first thing you see? |
| 2 | **Same place in every app.** | The five zones. New, Search, the title, the ⋯ menu and the Mobius button never move. | Flip between two apps. Does anything in the frame jump? |
| 3 | **One obvious way.** | Each action has one home. Mobius has one button. No second toolbar, no duplicate New. | Can you find two controls that do the same thing? |
| 4 | **Familiar first. Spend the novelty on Mobius.** | Each app works the way its best rival does: the address bar is on top, mail is three panes. New ideas go into what only Mobius does. | Could a Gmail or Safari user work here in the first minute? |
| 5 | **The app shapes the tools. The frame holds.** | Apps differ in the toolbar middle, their places, their views and their panels. Nothing else. | Is the difference inside a zone, or did the app redraw the zone? |
| 6 | **Mobius is beside you, never in the way.** | Three sizes only: full (Home and the Agent app), beside (the right panel), and in place (verbs on a selection). Every app works fully with Mobius closed. | With Mobius open, can you still see and use everything you could before? |
| 7 | **You are the pilot.** | What Mobius is doing is always visible. What it changed is dashed until you Keep it. Why it did it is one click away. Undo always works. | Can you tell what Mobius did, why, and how to put it back? |
| 8 | **Plain and honest.** | The interface shows what is really there and what Mobius really did, drawn as simply as it can be. Nothing is decoration. | Can you remove it without losing meaning? If yes, remove it. |

One working rule follows from these: **fix it once, in the shell.** A problem seen in three apps is a missing shared
piece, not three app fixes. The design reviewer sends it to the Builder.

## The five zones

Every app has the same five zones. An app fills a zone; it never moves or redraws it.

| Zone | Its job | Always the same | Filled by the app |
| --- | --- | --- | --- |
| 1. App rail (far left, about 52px) | Get to any app, see what needs you | Home, Search, pinned apps, then Mobius, Activity with its badge, Settings and profile at the foot. Never folds away. | Nothing. Badges and dots only. |
| 2. Sidebar | Move around inside the app | One order: New, Search, the app's places in sections, From Mobius, then More (trash, archive). Same width, row styles and fold key. | The places: mailboxes, notebooks, folders, lists |
| 3. Toolbar (one row, top of the content) | Act on what is open | Leading: sidebar toggle, the title of what is open, one grey line. Trailing: Comments, Share where it applies, the ⋯ menu, the Mobius button. | The middle: the app's own controls |
| 4. Content | The work | A solid surface, the shared empty state, the shared review bar | Everything inside, as one or more views |
| 5. Right panel | Details and Mobius | One column, same width and card. Mobius docks here by default; other panels dock here as tabs. | Whether the app has an inspector |

- One window. Little Mobius is the Mobius panel popped out. Split view and Little Mobius live in the Window menu and
  their keys, not in the top right. Comments are the one exception: see the toolbar.
- **Narrow windows:** side by side when wide, one after another when narrow. Below 980px the sidebar folds and the right
  panel closes, and each comes back over the content from its toggle. The rail and the toolbar stay.

## App rail

- Single-weight line icons, no colour tiles. Colour tiles are only in the launcher.
- A badge (filled count) means "needs you", and only that. A dot means "Mobius changed something here" and has a tooltip
  that says so.
- People can reorder and pin apps between the fixed top and foot. The fixed points never move.

## Sidebar

- The sidebar is for places only, at most two levels deep. A document's outline, slide thumbnails or a mini month are
  the second level and sit in the sidebar under the item, not in the content.
- The head holds only the app's name and the fold button. Switching apps is the rail's job.
- Order, top to bottom: **New** (New note, New message…), then **Search**, then the places in sections, then **From
  Mobius**, then **More** (Trash, Archive). Profile is on the rail, not here.
- Section headers are sentence case, small, semibold and grey ("Notebooks", "Mailboxes"). No all-caps headers.
- Rows of a fixed kind (mailboxes, lists, settings panes) have a single-weight glyph. Rows of user content (notes,
  documents) have a title and one grey line under it. Colour on a row is the person's own (a calendar, a tag, a folder).
- A count is a plain grey number at the trailing edge. One mark per row: a row with a dot doesn't also carry a count.
- Search is the shared sidebar search field (`.side-search`): 28px tall, with a magnifier glyph. Don't draw your own.
- No help text, storage notes or explanations in the sidebar. Put them in Help, a tooltip or the empty state.
- The sidebar is dimmer than the content: quiet text, few separators, no coloured icons in the frame.

## Toolbar

- One row on top of the content. Don't add a second action row inside the content.
- Leading: the sidebar toggle, then the **title of what is open** (the page, the deck, the database, the mailbox) and
  one grey line about it. Never the app's name again. With nothing open, the toolbar shows the app's controls only.
- Middle: the app's own controls for what is open (Aa and insert in an editor; Day, Week, Month and Today in Calendar;
  back, forward, reload and the address bar in the Browser; Reply, Reply All and Forward in Mail; transport in Music).
- Trailing, always in this order: Comments, Share (where it applies), the ⋯ menu, the Mobius button.
- The Comments button earns its toolbar place because it shows live state: the count of open threads, and pressed
  while comment mode is on. With no open threads it shows the icon alone. It is also in View › Comments with the same
  key, so the menu and the launcher find it.
- Group actions that belong together, and leave a gap between groups. Every icon button has a tooltip and an accessible
  name. Don't mix text and icons inside one group.
- At most one primary (filled) action per view. Everything else is plain.
- When an action doesn't apply, hide the whole item. Never leave an empty or half-filled group.

## Views and panels

Complex apps are made of views and panels that people can show, hide, resize, rearrange and pop out.

| Term | What it is | Examples | What the person can do |
| --- | --- | --- | --- |
| View | What fills the content zone | Session or Arrange in Music. Library or Edit in Photo. Day, Week, Month in Calendar | Switch it in the toolbar |
| Panel | A named, self-contained piece around the view | Clip, Devices, Mixer, Inspector, Timeline, Filmstrip, Outline; also the sidebar and Mobius | Turn it on or off, resize it, dock it left, bottom or right, or pop it out |
| Layout | A saved arrangement of panels | Arranging, Mixing, Sound design | Pick one, save the current one, or reset |

- The rail and the toolbar never move. Only panels do.
- Every panel has the same header: its name, dock, pop out and close.
- Each app has one **Panels** menu that lists every panel with a tick, where it sits, and its key.
- Each app ships a sensible default layout. Simple apps (Mail, Notes) have two or three panels and use the same system.
- A docked panel changes between wide and tall to fit its side, where that makes sense.
- The content zone has a bottom dock for editors, timelines, filmstrips and terminals. Complex apps have a one-line info
  bar at the foot.
- Use a segmented control only to switch views, centred above what it switches.

## Controls

- **Choosing one of a few values:** a pop-up button that shows the value with up-and-down chevrons.
- **On or off:** a switch at the trailing edge of its row. No "On" or "Off" text next to it.
- **Settings rows:** a grouped card with inset hairlines. Title and grey description on the left, the control on the
  right, on the same row. Row controls share one width, so their right edges line up.
- **Active and selected state:** shown in ink, inverted (the active tool, mute, solo, the selected clip), not tinted
  with a colour. Selection in a list or menu is a soft neutral fill, not a border.
- **Saving:** changes are kept without a Save button in Settings, a popover or an inspector, either as you make them or
  when the popover closes. Esc puts back what was there. A sheet that creates something (New event) can have Cancel and
  an action button.
- **Text fields and search:** one soft focus ring on the field's own shape. Never an inner rectangle as well.
- **Destructive actions** (Delete, Remove, Clear) are never a one-click inline icon. They go in a context menu, on the
  Delete key with Undo, or as plain red text at the end of a sheet. Anything that can't be undone asks first.
- **Undo:** after a change that Ctrl+Z can take back (a delete, a put-back version, an edited cell), show the shared Undo
  pill (`ui/UndoToast`): one line saying what changed, an Undo button and a ×, opaque, centred at the bottom. It never
  covers content, and it doesn't take focus, so Ctrl+Z keeps working where you are.
- Use the shared controls in `apps/desktop/src/ui/` (menus, popovers, dialogs, switches, selects) instead of drawing
  your own.

## Menus, popovers and sheets

- A menu or popover grows out of the button or item that opened it, and its arrow points at that item.
- Context menus open on right-click, Shift+F10 and the Menu key. Their top items match the row's hover actions.
- Standard actions use the same words and the same icon in every app: Open, Copy, Duplicate, Rename, Pin, Share,
  Move to…, Delete. Show the key next to an item that has one. The same action has the same key in every app:
  Duplicate is Ctrl+D (Cmd+D on a Mac), Delete is the Delete key with Undo. In a menu, every item has an icon or none
  does.
- Sheets and dialogs look the same on every platform: Mobius's own typeface and controls, not the system's.
- Keyboard hints live in menus and tooltips, not in a footer under a list or a chip beside a button.

## Lists, grids and empty states

- Overlapping items in a grid (calendar events) sit side by side. One never covers the other.
- A grid of data is an ARIA grid: one Tab stop, arrow keys move the active cell, Enter or F2 edits, Escape cancels.
- Numbers are right-aligned, and a numeric column uses one number of decimals in the regional format.
- An empty view uses the shared empty state: an icon, a short bold title, one grey line, and the New action as a
  button. It stays quiet: no sample data, no wall of suggestions, no instructions such as "New deck in the sidebar".

## Editors

- Every text editor uses the toolbar middle: the **Aa** panel (paragraph styles, character formats, lists), then the
  few insert actions (checklist, table, link, picture), then history. Share and ⋯ are at the trailing end as in every
  app. Don't stack a second bar.
- Notes and Docs use the same Aa layout. The page font is Inter unless the person chooses a serif in ⋯, which changes
  body and headings together.
- Short notes show the word count in the meta line under the title. Long documents (Docs, Knowledge pages) keep a quiet
  footer with the count and the save state. It shows one count at a time.
- A document's outline is a panel (in the sidebar under the document by default), not a list drawn inside the page.
- Versions show the text as people read it (headings, bullets), never the stored Markdown.

## Mobius in every app

- Mobius has three sizes: **full** (Home and the Agent app), **beside** (the right panel) and **in place** (verbs on a
  selection, with the result dashed where it lands). There is no fourth.
- It opens in the right panel from the Mobius button at the trailing end of the toolbar, or from the rail. The sidebar
  never changes face. In the Agent app the right panel stays closed, and the Mobius button opens the conversation list.
- The message box says what Mobius would look at ("Ask about your mail"). With nothing in particular, it says "Message
  Mobius". The panel is the same Mobius in every app; only what it sees changes.
- What Mobius is doing is always visible while it works (the status line, Stop), and a turn shows what it read and
  changed. Never hide that to make the screen look simpler.
- Suggestions are pill buttons, the same on Home and in the panel. Don't use text links. The empty panel shows the mark,
  one short line and the suggestions.
- A proposal (a suggested reply, a changed page, a suggested event) has the dashed edge and Keep, Try another and
  Discard, with Keep as the primary button. It appears once, where the change is. Don't add a second banner that
  repeats it.
- The dashed edge marks only what Mobius made or changed that waits for you. Nothing else uses it. It comes first and
  indigo second, so it stays findable next to coloured content.

## Text, dates and numbers

- The interface typeface is Inter, and Inter Display for titles, the same on Windows, Mac and Linux.
- Dates and times go through `apps/desktop/src/dates.ts` (`timeLabel`, `dayLabel`, `longDateLabel`, `monthLabel`,
  `dateTimeLabel`, `weekdayLabel`, `nearDayLabel`, `formatWith`), which follows the computer's regional format. Don't
  call `toLocaleString` or build a date string by hand. A screen never mixes 13:00 with 1:00 PM, or "Nov 12" with
  "12 November".
- Plain words in full sentences, using the names people see in the app. Titles, buttons and menu items are sentence
  case ("Add a connector…", not "Add a Connector…").
- Don't show file formats or storage details (mcp.json, Markdown marks, package ids) where a person's word will do.

## Theme

The theme gets its character from type, spacing and restraint, which don't date, and not from this year's materials.
It changes rarely and doesn't follow each year's platform style. Liquid Glass is no longer the reference; Apple's
guidance on clarity, layout and motion still is.

- **Surfaces:** three flat surfaces: a neutral frame, paper for content, and raised. Hairlines separate them, not
  shadows or blur. Only floating things (menus, popovers, popped-out panels) cast a shadow. No blur or glass.
- **Colour:** the frame is neutral. Controls and state use ink. Indigo marks Mobius. Red is only for record, errors and
  deleting. Colour belongs to the person's content, and they choose it: calendars, labels, tags, folders, tracks and
  clips.
- **Themes:** a theme is a small set of neutral tokens. Light, Mid grey, Dark and Cool dark, with tone and contrast the
  person can adjust. Use the tokens in `tokens.css`; never a raw colour or pixel value.
- **Density:** comfortable (30px rows, 13px text) for Mail, Notes and other daily apps; compact (26px rows, 12.5px text)
  for Music, Video, Code and Sheets. Both come from the same tokens.
- **Shape:** 6 to 8px corners on controls and rows. Panels and sheets are a little rounder. Corners are concentric:
  inner radius = outer radius − inset.
- **Icons:** single-weight line icons in the frame. Colour tiles only in the launcher.
- Where content scrolls under a bar, fade it out with the scroll-edge mask. Don't draw a hard line.

## Motion

Motion shows what is live (the playhead, meters, Mobius working) and where something came from or went. It is never
decoration. If an animation does neither, remove it.

- Use the motion tokens: `--dur-fast` (120ms) for small changes, `--dur-med` (200ms) for panels and views, `--ease` to
  arrive, and `--dur-exit` (150ms) with `--ease-exit` to leave. React uses `spring` and `quick` from `motion.tsx`.
  Never write a duration by hand.
- Things leave the way they came, a little faster: a menu shrinks back into its button and a panel slides back to its
  edge.
- Mobius's changes settle with motion. Keep makes the proposal solid in place, and Discard fades it out.
- Moving through time or pages slides in the direction you moved (Calendar ‹ ›, Day, Week, Month).
- Only one thing loops at a time: the progress cue while Mobius works, or the playhead while something plays. Loading
  uses `--dur-loop` and `--dur-spin`.
- With Reduce Motion, slides and scales become a short fade (`--dur-fade`), and loops stop. Every keyframe and every
  `animate()` call follows this.

## Accessibility

- Every control can be reached and used from the keyboard, and shows the focus ring (`:focus-visible`).
- Text keeps a contrast of at least 4.5:1 on its background, and glyphs and icons at least 3:1, in every theme.
- Click targets are at least 28px. Row height is at least 26px in compact density and 30px in comfortable, and 44px for
  Home rows.
- With Increase Contrast or forced colours, hairlines get stronger and fills turn to outlines.
- Test with Reduce Motion, Increase Contrast and a narrow window.

## How these rules change

The design reviewer checks each app's pull request screenshots against this page and against the other apps, and
sends fixes to that app's thread. A problem in three apps goes to the Builder as a shared piece. When a review settles
something new, the rule goes here in a pull request to `main`.
