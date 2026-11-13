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
| `AppSidebar`, `SidebarSearch`, `SidebarSection`, `SidebarRow` | `import { AppSidebar, … } from './ui'` | Your app's sidebar (zone 2), in the same order in every app: Search, your places in named sections, From Mobius, More. The shell draws the head above it (your app's name, New, Pinned). `AppSidebar` takes your own `className` and `data-*`; `SidebarSection` can be `foldable` (open or shut from its name); `SidebarRow` takes a `sub` line under the name (the row is still named by its label alone, so tests can find it by title) and a `trail` of extra controls after the row button (a hover Pin, an inline Confirm) |
| `PanelLayout` | `import { PanelLayout, type PanelSpec } from './ui'` | Your app's panels (stage 1: show, hide, resize). Wrap your page in it and pass `app` and `panels`: each has an `id`, `name`, `dock` (`'bottom'` under your content, or `'right'` beside it, before Mobius), whether it starts `shown`, optional `keys` (`'mod+shift+o'`) and `render`. The frame lists them in the toolbar's Panels menu with ticks and keys, Ctrl+J shows and hides the bottom dock, each dock's edge drags to resize (double-click for the default size), and what is shown and each dock's size are kept per app. Every panel gets the same header (its name, then close); put its controls in its body |
| `AppMenu` | `import { AppMenu } from './ui'` | Your app's own commands in the one ⋯ at the toolbar's end: `<AppMenu label="Message" entries={[…]} />` (the same `MenuEntry` rows as `Menu`), anywhere in your app. They go at the top of your app's menu there, and the ⋯ opens on it. Never draw a second ⋯ of your own in `ToolbarControls` |
| `AppFrame` | used by `App.tsx` only | The five zones every app sits in. Apps do not render it; they fill its parts with the pieces above |

Each row (`MenuEntry`) has a `label`, a `run`, and optionally an `icon`, `keys` (its shortcut), `danger`, `disabled`
and `separated` (a line before it), and `checked` for a row that is on or off (it then shows a tick). The chosen row runs after the menu has closed, so focus can go where the row sends it.

More controls (Popover, Dialog, Switch, Segmented, Select, Tabs) are added one at a time.

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
