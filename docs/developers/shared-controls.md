# Shared controls

Every app uses the same menus, and over time the same dialogs, popovers, switches and pickers, from
`apps/desktop/src/ui/`. They behave alike everywhere (keyboard, focus, screen readers, staying inside the window) and
look like one product.

## The stack

| Part | Used for |
| --- | --- |
| React and TypeScript | The interface |
| [Base UI](https://base-ui.com) (`@base-ui/react`) | Behaviour of menus and other controls: focus, keys, typeahead, ARIA, placement. It draws nothing itself |
| Plain CSS with `tokens.css` | The look. `src/ui/ui.css` styles the shared controls by Base UI's data attributes (`[data-highlighted]`, `[data-disabled]`, `[data-open]`) |
| Motion | Movement. Menus grow out of what opened them and go back there when they close (`growFrom` and `morphOut` in `motion.tsx`) |

There is no Tailwind. Colours, sizes, spaces and timings come only from `tokens.css`.

## What is there now

| Control | Import | Use it for |
| --- | --- | --- |
| `Menu` | `import { Menu } from './ui'` | A menu that opens from a button. Pass the button as `trigger` and the rows as `entries` |
| `PointMenu` | `import { PointMenu } from './ui'` | A menu at a point, such as a right-click. It is open while mounted and calls `onClose` when it has gone |
| `ContextMenu` | `import { ContextMenu } from './ContextMenu'` | A row's context menu, with the standard action icons and labels. It is built on `PointMenu` |
| `UndoToast` | `import { UndoToast } from './ui'` | The offer to take back what just happened: one line on what changed, Undo and ×. Bottom-centre of the app's page, opaque, never takes focus (so Ctrl+Z keeps working where the person is). Render it inside the page's positioned box while there is something to undo |
| `ToolbarControls` | `import { ToolbarControls } from './ui'` | Your app's own controls in the toolbar's middle (zone 3), written in your app's file. They show while your app is on screen. Keep to what is used often; the rest goes in your app's menu (⋯) |
| `ViewSwitch` | `import { ViewSwitch } from './ui'` | Your app's views (Day, Week, Month) as a segmented switch, the current one ink-inverted. Put it inside `ToolbarControls`. One view shows nothing |
| `AppSidebar`, `SidebarSearch`, `SidebarSection`, `SidebarRow` | `import { AppSidebar, … } from './ui'` | Your app's sidebar (zone 2), in the same order in every app: Search, your places in named sections, From Mobius, More. The shell draws the head above it (your app's name, New, Pinned). `AppSidebar` takes your own `className` and `data-*`; `SidebarSection` can be `foldable` (open or shut from its name); `SidebarRow` takes a `sub` line under the name (the row is still named by its label alone, so tests can find it by title) and a `trail` of extra controls after the row button (a hover Pin, an inline Confirm, a "to review" note); the hover and current fill cover the whole row, trail included |
| `PanelLayout` | `import { PanelLayout, type PanelSpec } from './ui'` | Your app's panels (stage 1: show, hide, resize). Wrap your page in it and pass `app` and `panels`: each has an `id`, `name`, `dock` (`'bottom'` under your content, or `'right'` beside it, before Mobius), whether it starts `shown`, optional `keys` (`'mod+shift+o'`), an optional starting `size` for its dock in pixels (until the person resizes it) and `render`. The frame lists them in the toolbar's Panels menu with ticks and keys, Ctrl+J shows and hides the bottom dock, each dock's edge drags to resize (double-click for the default size), and what is shown and each dock's size are kept per app. Every panel gets the same header (its name, then close); put its controls in its body |
| `PanelTab` | `import { PanelTab } from './ui'` | One of your app's panels as a tab in the right panel, before Mobius (Photo's Adjust, Music's Device, Docs' Outline). Render `<PanelTab id="adjust" name="Adjust">…</PanelTab>` anywhere in your app; it shows while your app is on screen and the right panel is open. Your tabs come first, Mobius is always last, and the panel opens again on the tab last used in your app (your first tab until one is chosen). The tab row has the close; put the panel's controls in its body. To bring a tab forward from your own controls (Photo's Adjust, Filters and Crop), call the function from `useShowPanelTab()` with its id (or `'mobius'`); it opens the right panel first when it is shut. When the person asks Mobius something (a start from your sidebar, `onAsk`, the Mobius button), or Mobius is waiting for their answer to a step, the shell brings Mobius in front of your tab for you |
| `AppMenu` | `import { AppMenu } from './ui'` | Your app's own commands in the one ⋯ at the toolbar's end: `<AppMenu label="Message" entries={[…]} />` (the same `MenuEntry` rows as `Menu`), anywhere in your app. They go at the top of your app's menu there, and the ⋯ opens on it. Never draw a second ⋯ of your own in `ToolbarControls` |
| `KeyCaps` | `import { KeyCaps } from './ui'` | A shortcut drawn as key caps (`<KeyCaps keys="Ctrl+Shift+N" />`), as menus, tooltips and the New button show them. Menus draw their `keys` this way already |
| Tooltips | nothing to import | Every control's `title` shows as the shared ink tooltip. End the title with its shortcut in brackets (`title="Undo (Ctrl+Z)"`) and the shortcut is drawn as key caps after the name. An icon-only button always has a title |
| `KeyHintBar` | `import { KeyHintBar } from './ui'` | The key-hint bar for a list view: `<KeyHintBar id="mail" hints={[{ keys: 'E', label: 'Archive' }]} />` as the last child of the scrolling list. Up to five keys; it hides itself after the keys have been used a dozen times, and never shows when Key hints is off in Settings › Appearance. Mail uses it |
| `AppFrame` | used by `App.tsx` only | The five zones every app sits in. Apps do not render it; they fill its parts with the pieces above |

Each row (`MenuEntry`) has a `label`, a `run`, and optionally an `icon`, `keys` (its shortcut), `danger`, `disabled`
and `separated` (a line before it), and `checked` for a row that is on or off (it then shows a tick). The chosen row runs at once as the menu goes (a copy of it fades out in place), so focus goes where the row sends it and keys typed straight after land there, not in the menu.

### Controls

Instrument's "Controls" and "Pro app readouts" ([Instrument](../design/instrument.md)), all from `./ui`. Sizes follow the
density: the window's, or compact for pro apps (the frame sets it). Values use tabular figures; readouts use the mono face.

| Control | Use it for |
| --- | --- |
| `Button` | `kind="primary"` (solid ink, one per view at most), `"secondary"` (the default: paper with a hairline) or `"quiet"` (text only: toolbars, rows, and Discard and Try another beside one primary Keep). Optional `icon`, `keys` (added to the tooltip), `pressed` for a toggle, `danger` for red text |
| `IconButton` | A line icon with no border. `label` is required: it is the accessible name and the tooltip, with `keys` after it. `primary` makes the one ink icon button of an area (the composer's Send) |
| `TextField` | A field with its `label` above (or `hideLabel`), a grey `unit` or key hint at the trailing end, and `error`: one plain sentence under it with a red dot. `onChange` gets the text |
| `Select` | A pop-up: a field with up and down chevrons that opens the shared menu, the chosen row ticked. Pass `choices` (`{ value, label }`) |
| `Segmented` | A small set of choices all worth seeing: a grey track, the chosen one on paper. `iconOnly` for icons (the label becomes the tooltip), `wide` to fill a panel's width. Arrow keys move it. The toolbar's views keep using `ViewSwitch` |
| `Switch` | On and off at the trailing end of its row, the label leading, an optional grey `detail` line. Use it in settings lists and Adjust cards |
| `Checkbox` | A rounded square, ink when checked; `indeterminate` for "some of them". Tasks keeps its round circles |
| `Slider` | Photo's slider: a grey track filled in ink from the `origin` (zero, or `min`) to the value, a slim tick, the value grey until it moves. `format` for units, `scale="log"` for Hz and times, `ends={['Shorter', 'Longer']}` to name the ends, `remake` for an Adjust control that makes the result again when let go (it shows the Mobius mark). `onChange` runs as it moves, `onCommit` once when let go. Shift+arrows nudge further; double-click goes back to `reset` |
| `ParamCell`, `ParamGrid` | Pro app readouts: a small all-caps label, the value large in mono with its `unit`, a thin slider under it, and an optional `keyHint` letter in the corner. Same props as `Slider`. `ParamGrid` puts them two to a row |
| `Meter`, `Progress` | A level set elsewhere (storage, a track's level), `threshold` makes only the part past it red (clipping, nearly full); and known progress as a thin ink line. No spinners in content |
| `Chip` | A label or tag: outlined pill, a content-colour dot, grey text. `onRemove` adds ×, `onClick` makes it a filter (`pressed` when on) |
| `Dot`, `CONTENT_COLORS` | A content colour as a small dot (the one palette of eight plus stone), or `red` for overdue or failed |
| `Count` | A plain grey tabular number at a row's end. Nothing for zero; never a badge |
| `StatusLetter` | A grey mono letter with its meaning as the tooltip (Code's M, A, D); `tone="red"` for a conflict |
| `StatusText` | "Connected", "Key saved": grey, no dot. `problem` shows a red dot and one plain sentence. Never a green dot |
| `Avatar` | A grey circle with initials (from a name or an address), or `src` for a photo. `size="large"` for a person's card |
| `ListRow` | A row in a content list, inside `<ul role="list" className="ui-list">`: `lead` (a Checkbox, Avatar or icon), `title`, `meta` (date or size, trailing, tabular), and `detail` for the two-line row beside a reading pane (Mail, Notes). `unread` is a semibold title, `current` the grey fill, `proposed` the dashed Mobius edge, `trail` controls inside the row's fill |

```tsx
<Slider label="Length" value={length} onChange={setLength} onCommit={remakeDraft} ends={['Shorter', 'Longer']} remake hideValue />
<ParamGrid label="Device">
  <ParamCell label="Cutoff" unit="Hz" min={20} max={20000} scale="log" value={cutoff} onChange={setCutoff} keyHint="C" />
</ParamGrid>
<ul role="list" className="ui-list">
  <ListRow lead={<Avatar name={m.from} />} title={m.subject} meta={time(m.at)} detail={m.preview} unread={!m.read} current={m.id === open} onSelect={() => show(m.id)} />
</ul>
```

**The reference sheet.** Every control above, in its states, is on one dev-only page: run `npm run dev -w @mobius/desktop`
and open `http://127.0.0.1:5180/ui-sheet.html` (add `?density=compact` or `?theme=mid`; dark follows the system). It is
not part of the built app. Add each new control to it (`src/ui-sheet/Sheet.tsx`).

### Shared objects

A task, an event, an email, a file and a person look the same in every app (Instrument, "One app, not twenty"). Pass
the data as a `Thing` (`{ kind: 'task', title, due, … }`) and pick the form. Never draw your own row or card for these.
Dates and times come in already formatted from `dates.ts`, so they follow the person's clock setting. `byMobius` gives
the dashed indigo edge in every form.

| Form | Import | Use it for |
| --- | --- | --- |
| One-line row | `<ObjectRow thing={t} onOpen={…} />` | Full-width lists and results: the kind's mark (a round check, a calendar-colour bar, an unread dot, a kind icon, initials), the title, one grey detail, the date or count at the end |
| Two-line row | `<ObjectRow thing={t} lines={2} onOpen={…} />` | A list beside a reading pane (Mail, Notes). The detail goes to the second line |
| Card | `<ObjectCard thing={t} onOpen={…} />` | Mobius panel results and Sources, Views, a peek on Space. A kind line with Open, the title, then label and value lines |
| Chip | `<ObjectChip thing={t} onOpen={…} />` | Inside text: the composer, answers, notes. No selected look |

A task's check ticks it from any row when you pass `onToggle`. Rows go in `<ul role="list" className="ui-list">`.
`ListRow` underneath also takes `lines={1}` (the detail sits grey after the title), `metaTone="red"` (overdue only) and
`done` (a grey title).

### Two-axis pad

`XYPad` sets two values with one point (Music's Dark to Bright and Calm to Busy, any Adjust card). Values run 0 to 1 on
each axis. Name both ends of both axes in words; `start` is where Mobius first put the point, shown as a hollow mark and
where Home and double-click return. `onChange` runs as it moves; `onCommit` runs once on release, for a remake. Arrows
nudge by `step` and Shift+arrows by ten steps. Each axis can `format` its readout.

```tsx
<XYPad label="Feel" x={{ name: 'Bright', ends: ['Dark', 'Bright'] }} y={{ name: 'Busy', ends: ['Calm', 'Busy'] }}
  value={feel} start={mobiusFeel} onChange={setFeel} onCommit={remakePart} />
```

### Popover and choice menus

| Control | Use it for |
| --- | --- |
| `Popover` | A small floating panel of controls opened from a button: the composer's plus menu (switches, a row or two, a link onward). Pass `trigger`, `label` and the content; `side="top"` opens it upward. `PopoverTitle` is its sentence-case heading; `PopoverLink` is the way out at the bottom ("Manage in Abilities": a row with a hairline above and an arrow) |
| `ChoiceMenu` | Pick one of a few choices from a button (Mode, Permission, model). `choices` are `{ value, label, meaning?, keys? }`: the current one has a check, keys show as caps, and a `meaning` makes a two-line row (name, then a grey line on what it means). `side` is `'top'` by default, for the composer. `footer` adds plain rows after a line ("Manage in Abilities") |

```tsx
<ChoiceMenu label="Permission" value={permission} onChange={setPermission} trigger={<Button kind="quiet">{name}</Button>}
  choices={[{ value: 'review', label: 'Review changes', meaning: 'Changes show dashed until you keep them' }, …]} />
```

### Dialogs and content tabs

| Control | Use it for |
| --- | --- |
| `Dialog` | A small form or choice over a dimmed window (rename, export, a few settings): `open`, `onOpenChange`, `title`, one short `description`, the fields as children, and `actions` (buttons, primary last). Focus stays inside; Escape or a click outside closes it |
| `Confirm` | Only for paying, sending, deleting for good and running commands. `action` names the button ("Delete 3 files"), `permanent` adds "This can’t be undone.", `onConfirm` and `onCancel`. A click outside does not close it; Cancel and Escape do |
| `ContentTabs` | Apps that open several things at once (Browser, Code, Files): plain text tabs, the open one ink with an ink underline, a close on hover. `unsaved` shows a dot in place of the close, `byMobius` a dashed underline. Arrows move, Delete or Ctrl+W closes, middle-click closes. Give the content `role="tabpanel"` and `aria-labelledby={tabId(id)}` |

Popovers that stay in place, toasts other than the undo pill, and date pickers are not shared yet; ask the library
thread before building one in an app.

## Adopting the frame

The frame is the five zones in [Panel layouts](../design/panel-layouts.md): the rail, your app's sidebar, one toolbar
row, your content, and Mobius in the right dock. The shell draws the rail, the sidebar's head and the toolbar's two
ends; your app fills the rest from its own files:

1. **Sidebar.** Build it from `AppSidebar` with `aria-label="<App> sidebar"`, then `SidebarSearch`, your places in
   `SidebarSection`s of `SidebarRow`s, then From Mobius. No New button of your own unless your list starts with one
   (then add your app to `createInList` in `App.tsx`, a marked one-line edit).
2. **Toolbar.** Move your controls out of any action row inside your content into `ToolbarControls`. Views go in a
   `ViewSwitch` there. No second action row inside content.
3. **Content.** Nothing above your content but the toolbar. Mobius's proposals show in your content first (dashed), with
   the explanation in the Mobius panel.

```tsx
<AppSidebar label="Tasks sidebar">
  <SidebarSearch label="Search tasks" value={query} onChange={setQuery} />
  <SidebarSection title="Lists" action={<button type="button" aria-label="New list" onClick={newList}>+</button>}>
    {lists.map((l) => <SidebarRow key={l.name} label={l.name} count={l.open} current={l.name === open} onSelect={() => show(l.name)} />)}
  </SidebarSection>
</AppSidebar>

<ToolbarControls label="Calendar">
  <ViewSwitch label="View" views={[{ id: 'day', name: 'Day' }, { id: 'week', name: 'Week' }]} value={view} onChange={setView} />
</ToolbarControls>
```

```tsx
{deleted && <UndoToast text={`Deleted “${deleted.title}”`} onUndo={restore} onDismiss={() => setDeleted(null)} />}
```

## Guards

`src/ui/guards.test.ts` runs with the unit tests:

- **No new hand-drawn menus.** A file outside `src/ui` with `role="menu"` fails the test, unless it is on the list of
  files that still have their own menu. That list only shrinks. When you move a file to `ui/Menu`, take it off the list.
  Each kind of control joins this guard once `src/ui` offers it.
- **Only tokens in `src/ui`.** The style sheets in `src/ui` may not name a colour (`#hex`, `rgb()`, `hsl()`) or a pixel
  size of their own. Add a token to `tokens.css` instead.
