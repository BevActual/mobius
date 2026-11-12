# Design rules

These are the rules every Mobius app follows, so the apps look and behave as one. They come from Apple's Human Interface
Guidelines and Liquid Glass, and from design reviews of the real app. Each review that settles a question adds or
changes a rule here.

[Workspace layout](workspace-layout.md) describes the parts of the window and what each one does. This page says how
those parts must look and behave. Where the two disagree, this page wins.

Before you open a pull request for an app, check its screenshots against this page in light and dark, at full width
and in a narrow window.

## Principles

- **Content first.** Controls sit around the content and stay quiet. Everything a person writes or reads is solid and
  sharp.
- **One way to do each thing.** If an action already has a home (a toolbar button, a menu, a key), don't add a second
  button for it somewhere else.
- **The same thing looks the same everywhere.** A count, a search field, a section header or a suggestion looks the
  same in every app. Reuse the shared component instead of styling a new one.
- **Show what Mobius did.** Anything Mobius made or changed that is waiting for you has the dashed indigo edge, until you
  Keep it or Discard it. Nothing else uses that edge.

## Window and layout

- One window: the floating sidebar on the left, then the toolbar row and the content. Mobius takes over the sidebar
  when you open it. "Pin beside" moves it to the right only when the person asks.
- The sidebar and a pinned Mobius panel are floating cards with the same inset (`--panel-inset`, 8px), corner radius
  (`--panel-radius`, 18px) and shadow.
- When nothing is open, the toolbar title names the app or the section ("Docs", "Inbox"). It is never empty.
- Below 980px the sidebar folds to a rail. Every control on the full sidebar, including the Mobius mark, is still
  reachable from the rail.

## Sidebar

- Order, top to bottom: the app switcher head, then **New** (New note, New message…), then **Search**, then the
  sections. Profile sits at the bottom.
- Section headers, in sidebars and inspectors alike, are sentence case, small, semibold and grey ("Notebooks", "In
  your apps", "Trim"). No all-caps headers.
- Rows of a fixed kind (mailboxes, lists, settings panes) have a glyph or a tinted icon. Rows of user content (notes,
  documents) have a title and one grey line under it.
- A count is a plain grey number at the trailing edge. A filled badge means "needs you", and only that.
- One mark per row. The dot means "Mobius changed this" and has a tooltip that says so. A row with a dot doesn't also
  carry a count.
- Search is the shared sidebar search field (`.side-search`): 28px tall, with a magnifier glyph. Don't draw your own.
- Notes about how files are stored on disk don't belong in the sidebar. Put them in Help or a tooltip.

## Toolbar

- The toolbar row holds the app's actions for what is open. Don't put a row of action icons inside the content.
- Group actions that belong together in one capsule, and leave a gap between groups. For example: back, Today and
  forward; Reply, Reply All and Forward; the window controls (Little Mobius, split view, comments).
- Every icon button has a tooltip and an accessible name. Don't mix text and icons inside one capsule.
- At most one tinted (filled accent) action per view. Everything else is plain.
- When an action doesn't apply, hide the whole item. Never leave an empty or half-filled capsule.

## Controls

- **Choosing one of a few values:** a pop-up button that shows the value with up-and-down chevrons. Use a segmented
  control only to switch views (Day, Week, Month; Listening, Speaking), centred above what it switches.
- **On or off:** a switch at the trailing edge of its row, tinted with the accent when on. No "On" or "Off" text next
  to it.
- **Settings rows:** a grouped card with inset hairlines. Title and grey description on the left, the control on the
  right, on the same row. Row controls share one width, so their right edges line up.
- **Saving:** changes are kept without a Save button in Settings, a popover or an inspector, either as you make them or
  when the popover closes. Esc puts back what was there. A sheet that creates something (New event) can have Cancel and an action button.
- **Text fields and search:** one soft focus ring on the field's own shape. Never an inner rectangle as well.
- **Destructive actions** (Delete, Remove, Clear) are never a one-click inline icon. They go in a context menu, on the
  Delete key with Undo, or as plain red text at the end of a sheet. Anything that can't be undone asks first.

## Menus, popovers and sheets

- A menu or popover grows out of the button or item that opened it, and its arrow points at that item.
- Context menus open on right-click and Shift+F10. Their top items match the row's hover actions.
- Standard actions use the same words and the same icon in every app: Open, Copy, Duplicate, Rename, Pin, Share,
  Move to…, Delete. Show the key next to an item that has one. The same action has the same key in every app:
  Duplicate is Ctrl+D (Cmd+D on a Mac), Delete is the Delete key with Undo.
- Selection in a menu or list is a soft accent fill, not a border.
- Sheets and dialogs have a larger corner radius than the controls inside them (`--radius-sheet`, 18px).
- Keyboard hints live in menus and tooltips, not in a footer under a list.

## Lists and empty states

- Overlapping items in a grid (calendar events) sit side by side. One never covers the other.
- An empty view uses the shared empty state: an icon, a short bold title, one grey line, and the New action as a
  button. Don't write instructions such as "New deck in the sidebar".

## Editors

- Every text editor has one toolbar row: the **Aa** panel (paragraph styles, character formats, lists), then the few
  insert actions (checklist, table, link), then history, share and ⋯ at the trailing end. Don't stack a second bar for
  Versions or a document's own controls; pass them into the same row.
- Notes and Docs use the same Aa layout. The page font is the app's sans unless the person chooses a serif in ⋯, which
  changes body and headings together.
- Short notes show the word count in the meta line under the title. Long documents (Docs, Knowledge pages) keep a
  quiet footer with the count and the save state, so both stay in view while scrolling. It shows one count at a time.

## Mobius in every app

- You reach Mobius in two ways: the mark in the sidebar head (or on the rail) and the launcher. Don't add a third.
- The message box says what Mobius would look at ("Ask about your mail"). With nothing in particular, it says "Message
  Mobius".
- Suggestions are pill buttons, the same on Home and in the panel. Don't use text links.
- The empty Mobius panel shows the mark, one short line and the suggestions. The approval mode is already in the
  message box, so don't explain it again there.
- A proposal (a suggested reply, a changed page, a suggested event) has the dashed indigo edge and Keep, Try another and
  Discard, with Keep as the dark button. It appears once, where the change is. Don't add a second banner that repeats it.

## Text, dates and numbers

- Dates and times go through the shared formatter, which follows the system locale. A screen never mixes 13:00 with
  1:00 PM, or "Nov 12" with "12 November".
- Plain words in full sentences, using the names people see in the app. Titles are sentence case.

## Liquid Glass

Glass is the layer of controls that floats over the content. Use it there and nowhere else.

- **Glass:** the sidebar, a pinned Mobius panel, toolbar capsules, menus, popovers, the launcher and the message box.
  Use the shared glass tokens (`--glass-tint`, `--glass-filter`, `--glass-edge`) and the `.glass` class. Don't write
  your own blur.
- **Solid:** the content, and everything inside it. That includes notes, messages, rows, cards, proposals and the
  calendar grid.
- No glass on glass. Don't put a glass card inside the glass sidebar or a glass capsule inside a glass bar.
- Use clear glass (`--glass-clear-*`) only over pictures and video.
- Corners are concentric: inner radius = outer radius − inset. A row inside the 18px panel at an 8px inset is 10px.
- Where content scrolls under a bar, fade it out with the scroll-edge mask. Don't draw a hard line.
- With Reduce Transparency, Increase Contrast, forced colours or Windows "Transparency effects" off, glass turns solid.

## Motion

Every animation has a job: it shows where something came from or went, confirms that something worked, or shows that
one thing changed shape. If an animation does none of these, remove it.

- Use the motion tokens: `--dur-fast` (120ms) for small changes, `--dur-med` (200ms) for panels and views, `--ease` to
  arrive, and `--dur-exit` (150ms) with `--ease-exit` to leave. React uses `spring` and `quick` from `motion.tsx`.
  Never write a duration by hand.
- Things leave the way they came, a little faster: a menu shrinks back into its button and a panel slides back to its
  edge.
- Mobius's changes settle with motion. Keep makes the proposal solid in place, and Discard fades it out.
- Moving through time or pages slides in the direction you moved (Calendar ‹ ›, Day, Week, Month).
- Only one thing loops at a time, the progress cue while Mobius works. Loading uses `--dur-loop` and `--dur-spin`.
- With Reduce Motion, slides and scales become a short fade (`--dur-fade`), and loops stop. Every keyframe and every
  `animate()` call follows this.

## Accessibility

- Every control can be reached and used from the keyboard, and shows the focus ring.
- Text keeps a contrast of at least 4.5:1 on its background, in light, dark and through glass.
- Click targets are at least 28px. Row height in lists is at least 32px, and 44px for Home rows.
- Test with Reduce Motion, Reduce Transparency and Increase Contrast on.

## How these rules change

The design reviewer checks each app's pull request screenshots against this page and against the other apps, and
sends fixes to that app's thread. When a review settles something new, the rule goes here in a pull request to `main`.
