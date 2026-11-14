# Theme tokens: the timeless theme

Decided 2026-11-13. This page gives the exact values for the new Mobius theme, and how each one maps onto
`apps/desktop/src/tokens.css` as it is today. It is the spec for the change; `tokens.css` stays the one place the
values live once it lands. The frame these tokens paint is in [Panel layouts](panel-layouts.md).

## The rules the values come from

1. **The frame is neutral.** Three flat surfaces and hairlines. No glass, no blur, no gradients in the frame.
2. **Controls and state are ink.** A primary button is ink on paper, inverted. An active tool, a muted track or a
   selected clip is shown by inverting ink, not by a colour.
3. **Indigo is Mobius, and only Mobius.** Anything Mobius made or proposes has a dashed edge first and indigo second,
   so it still reads beside coloured content and for people who cannot tell the colours apart.
4. **Red means record, error or delete.** Nothing else.
5. **Colour belongs to the person's content.** Tracks, clips, calendars, labels and tags carry colours the person
   picks from one palette. The frame never competes with them.
6. **Motion shows live state or where something came from.** A playhead, a meter, progress, a panel sliding from its
   dock. Never decoration.
7. **Shadows only on things that float.** Menus, popovers, dialogs, popped-out panels. Docked surfaces are separated
   by hairlines.

## Surfaces, text and lines

Four themes ship from the same set of names. A theme is only these values; nothing else may change between themes.

| Token | Role | Light | Mid grey | Dark | Cool dark |
|---|---|---|---|---|---|
| `--frame` | Rail, sidebar, toolbar, panel headers, info bar | `#f4f3ef` | `#c6c6c3` | `#1a1a19` | `#171b21` |
| `--paper` | Content, panel bodies, fields | `#ffffff` | `#d9d9d6` | `#222221` | `#1e232b` |
| `--raised` | Menus, popovers, dialogs, popped-out panels | `#ffffff` | `#e2e2df` | `#2b2b29` | `#262d36` |
| `--ink` | Titles, icons, primary buttons, inverted state | `#1b1b1a` | `#121211` | `#ecebe6` | `#e6eaf0` |
| `--body` | Running text | `#2a2a28` | `#1f1f1d` | `#d8d7d1` | `#cfd5dd` |
| `--muted` | Secondary text, sublines, resting icons | `#6f6e69` | `#4f4f49` | `#a09f99` | `#97a1ae` |
| `--faint` | Disabled text, placeholders, tick marks | `#a3a29c` | `#7c7c76` | `#6f6e69` | `#667080` |
| `--on-ink` | Text and icons on an ink fill | `#ffffff` | `#d9d9d6` | `#1a1a19` | `#171b21` |
| `--line` | Hairline between zones and around controls | `#e3e1da` | `#aeaeaa` | `#353533` | `#303843` |
| `--line-soft` | Hairline between rows inside a surface | `#efede7` | `#c9c9c5` | `#2b2b29` | `#262d36` |
| `--sel` | Selected row, hovered control, pressed state | `#e9e7e0` | `#b6b6b2` | `#30302e` | `#2b333e` |
| `--mobius` | Mobius button, dashed proposal edge, Mobius text | `#4b48c8` | `#3a37b8` | `#9a98f5` | `#a3a1ff` |
| `--mobius-wash` | Fill behind a proposal | `#f0effb` | `#c9c8ea` | `#2a2946` | `#2a2c50` |
| `--on-mobius` | Text on a solid Mobius fill | `#ffffff` | `#ffffff` | `#12112e` | `#12112e` |
| `--red` | Record, error, delete | `#b3261e` | `#a3221b` | `#f08a80` | `#f08a80` |
| `--red-wash` | Fill behind an error | `#fbeceb` | `#e3c4c1` | `#3d1f1d` | `#3d2324` |

Notes:

- `--faint` does not meet 4.5:1 on purpose. Use it only for disabled text, placeholders and marks that carry no
  meaning on their own.
- Success and warning keep their meaning but lose their own hue in the frame: a finished job is an ink tick, a
  warning is ink text with a `!` mark. Keep `--success` and `--warning` only for content that needs them (a chart, a
  test result) and move them to the content palette below.
- Checked for all four themes: `--muted` on `--frame`, and `--mobius` and `--red` on `--paper` and `--frame`, all
  reach 4.5:1. Mid grey `--muted` is one step darker than in the mocks (`#55554f` gave 4.4:1). `--muted` on a
  `--sel` row is the tightest pair (about 4:1 in Light and Mid grey), so text on a selected row is `--ink`.
- `prefers-contrast: more` keeps working: `--muted` becomes `--body`, `--line` and `--line-soft` both become
  `--muted`, and `--sel` gains a 1px `--ink` outline.

## Choosing a theme

- Settings › Appearance: **Theme** (Light, Mid grey, Dark, Cool dark) and **Follow the system** (on by default:
  Light by day, Dark by night; the person can pick which two).
- Set on the root as `data-theme="light | mid | dark | cool"`. `prefers-color-scheme` only picks the default.
- Popped-out panels and Little Mobius use the same theme as the main window.
- A new theme is a new column in the table above. It may not add tokens.

## Content colours

One palette for anything the person colours: tracks, clips, calendars, labels, tags, chart series. The person picks;
the app only assigns the next unused colour to a new item.

| Token | Value | Name shown in the picker |
|---|---|---|
| `--c-amber` | `#e8a33d` | Amber |
| `--c-yellow` | `#e6c84a` | Yellow |
| `--c-green` | `#9ccf5a` | Green |
| `--c-teal` | `#4fb7a8` | Teal |
| `--c-blue` | `#5aa7e0` | Blue |
| `--c-violet` | `#b08ae6` | Violet |
| `--c-pink` | `#e58fb5` | Pink |
| `--c-coral` | `#e2705f` | Coral |
| `--c-stone` | `#a8a39a` | Stone |

- Text on a content colour is always `#1b1b1a`, in every theme. All nine pass 4.5:1 with it.
- A content colour is a fill for the item itself (a clip, an event, a tag dot). It is never a button, a selection or
  a toolbar.
- Violet is a content colour and Mobius is indigo. They are told apart by the dashed edge, which content never has.

## Mobius marks

| Thing | How it is drawn |
|---|---|
| Something Mobius proposes | 1px dashed `--mobius` edge (dash 4, gap 3), `--mobius-wash` fill |
| A proposed value on a control | A dashed `--mobius` tick on the slider or field; the person's value stays ink |
| A proposed region (mask, cut, range) | Dashed `--mobius` edge with a 45 degree hatch at 12% `--mobius` |
| Something Mobius made, once kept | No edge. A small `--mobius` trefoil in the row, and a line in Activity |
| The Mobius button | Trefoil in `--mobius`; when its panel is open, `--sel` fill like any open toggle |
| Mobius working | The dashed edge moves along its path (`--dur-loop`); still with Reduce Motion |

## Type

Inter for the interface and Inter Display from 17px up, bundled with the app so every platform looks the same.
Numbers that change in place (time, tempo, meters, table cells) use tabular figures.

| Token | Comfortable | Compact | Used for |
|---|---|---|---|
| `--fs-xs` | 11px | 10.5px | Tertiary labels, panel headers, key hints |
| `--fs-sm` | 12px | 11.5px | Sublines, sidebar section names, the info bar |
| `--fs-md` | 13px | 12.5px | Body, rows, controls |
| `--fs-lg` | 15px | 14px | A title inside content |
| `--fs-xl` | 17px | 17px | Page titles (Inter Display) |
| `--fs-2xl` | 22px | 22px | Home and empty-state headings (Inter Display) |

Weights stay `400`, `500`, `600`. Hierarchy comes from size, weight and space before colour. Line heights stay
`--lh-tight: 1.25` and `--lh-body: 1.5`.

## Density

Two densities from the same tokens. Set on the app's root as `data-density="comfortable | compact"`. Each app has a
default ([Panel layouts](panel-layouts.md) lists them) and the person can override it in View.

| Token | Comfortable | Compact |
|---|---|---|
| `--row-h` | 30px | 26px |
| `--control-h` | 28px | 24px |
| `--control-h-lg` | 36px | 30px |
| `--menu-row-h` | 30px | 26px |
| `--toolbar-h` | 44px | 40px |
| `--panel-head-h` | 30px | 26px |
| `--info-h` | 24px | 22px |
| `--rail-w` | 52px | 52px |
| `--sidebar-w` | 240px (180 to 360) | 220px (160 to 360) |
| `--panel-w` | 340px (280 to 560) | 320px (260 to 560) |
| `--dock-h` | 260px (120 to 70% of content) | 240px (120 to 70% of content) |

Spacing keeps the 4pt grid (`--sp-1` to `--sp-8`) unchanged.

## Shape, lines and shadows

| Token | Today | New | Used for |
|---|---|---|---|
| `--radius-small` | 4px | 3px | Clips, tags, meters, checkboxes |
| `--radius-control` | 8px | 6px | Buttons, fields, rows, menu rows |
| `--radius-group` | 10px | 6px | Grouped controls, cards |
| `--radius-panel` | 14px | 8px | Menus, popovers, popped-out panels |
| `--radius-sheet` | 18px | 8px | Dialogs |
| `--radius-pill` | 999px | 999px | Only for things that are round by nature: avatars, dots, toggles |
| `--hairline-w` | 0.5px | 1px | Every divider and outline |
| `--shadow-1` | soft drop | none | Docked surfaces have no shadow |
| `--shadow-2` | popover | `0 4px 16px rgba(0,0,0,.10), 0 0 0 1px var(--line)` | Menus, popovers |
| `--shadow-3` | dialog | `0 12px 40px rgba(0,0,0,.18), 0 0 0 1px var(--line)` | Dialogs, popped-out panels |

Capsule buttons go: a button is a 6px rectangle. Focus is a 2px `--ink` ring with a 1px `--paper` gap, in every theme.

## Motion

The names and lengths stay as they are (`--ease`, `--dur-fast: 120ms`, `--dur-med: 200ms`, `--dur-exit: 150ms`,
`--dur-loop`, `--dur-spin`, and the Reduce Motion block). What changes is what may move:

| May move | How |
|---|---|
| Live state: playhead, meters, progress, a running Mobius edge | Continuous, linear |
| A panel opening, closing or changing dock | Slides from its dock edge, `--dur-med` in, `--dur-exit` out |
| Something arriving from elsewhere (a kept proposal, a dropped file) | Moves from where it came from, `--dur-med` |
| Hover and press | Colour only, `--dur-fast` |

Nothing else animates. `--dur-slow` (600ms) is kept only for the welcome screen.

## Icons

- One set of single-weight line icons, 1.5px stroke on a 16px grid, drawn in `currentColor`.
- In the rail, sidebar and toolbar every icon is `--muted` at rest and `--ink` when current or hovered.
- The `--app-*` gradient tiles stay, but only in the launcher grid and on Home. They leave the rail and sidebar.

## How today's tokens map

Rename with aliases first, so no app breaks, then remove the old names as apps move over.

| Today | Becomes | Note |
|---|---|---|
| `--bg` | `--paper` | |
| `--panel` | `--paper` | Panel bodies are paper; their headers are frame |
| `--chrome`, `--shell`, `--sidebar` | `--frame` | Three near-identical greys become one |
| `--soft` | `--sel` | |
| `--toolbar` | `--frame` | Solid; the `color-mix` with transparent goes |
| `--field` | `--paper` with a 1px `--line` | |
| `--capsule` | removed | Buttons sit on the frame with no fill until hovered (`--sel`) |
| `--hairline` | `--line` | |
| `--line-strong` | `--muted` at 1px | Only where a control edge must meet 3:1 |
| `--ink`, `--muted`, `--line` | same names, new values | |
| `--accent` | `--ink` for primary buttons and the current place; `--mobius` for anything Mobius | Every use needs a look; this is the one mapping that is not mechanical |
| `--on-accent` | `--on-ink` or `--on-mobius` | Follows the row above |
| `--wash` | `--sel` for selection; `--mobius-wash` for proposals | |
| `--danger`, `--danger-wash` | `--red`, `--red-wash` | |
| `--success`, `--warning` and washes | content palette, or ink | See the note under the surface table |
| `--shadow-menu` | `--shadow-2` | |

## Suggested order of work

1. Add the new names and the four theme blocks to `tokens.css`, with the old names as aliases. Nothing looks
   different yet except the greys.
2. Split `--accent`: go through its uses and send each to `--ink` or `--mobius`.
3. Radii, hairlines, shadows, and remove blur and glass.
4. Bundle Inter and Inter Display; add the density attribute.
5. Add the Theme setting and the content palette picker.
6. Remove the aliases, and extend the raw-colour check so only `tokens.css` may hold a hex value.

## Mocks

The values above were tried on these screens, kept in the project files under `layout/`: `timeless-overview.png`
(Mail, Calendar, Browser, Music, Docs), `timeless-music-themes.png` (the four themes), `timeless-music-dense.png`,
`timeless-photo.png`, `timeless-video.png`, and their HTML sources.
