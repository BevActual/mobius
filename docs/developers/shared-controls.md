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

Each row (`MenuEntry`) has a `label`, a `run`, and optionally an `icon`, `keys` (its shortcut), `danger`, `disabled`
and `separated` (a line before it). The chosen row runs after the menu has closed, so focus can go where the row sends it.

More controls (Popover, Dialog, Switch, Segmented, Select, Tabs) are added one at a time.

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
