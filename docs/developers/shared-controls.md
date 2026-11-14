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
and `separated` (a line before it), `checked` for a row that is on or off (it then shows a tick), and `detail` for a grey
line under the label on what it does ("Echo: Repeats that fade"). Use `Menu` for commands; `ChoiceMenu` is for a setting
that stays chosen. The chosen row runs at once as the menu goes (a copy of it fades out in place), so focus goes where the row sends it and keys typed straight after land there, not in the menu.

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
| `ParamCell`, `ParamGrid` | Pro app readouts: a small all-caps label, the value large in mono with its `unit`, a thin slider under it, and an optional `keyHint` letter in the corner. Same props as `Slider`. `ParamGrid` puts them two to a row. `size="compact"` is for a dense pro panel (Music's Device): the name in sentence case, small and grey, and the value at body size |
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

Music asked for these, and they work everywhere:

- `Select inline` puts the name beside the box, for toolbars and bars.
- `Select quiet` is text with chevrons, with a grey fill on hover and while open, for a toolbar's sub line.
- `ParamGrid columns={1}` takes a lone cell such as Volume. `columns={3}` also works, `columns={4}` sets knobs four across (a 340-wide side panel), and a `wide` ParamCell spans its row.
- On a log scale (Cutoff, Attack, Release), the arrows move a twelfth of an octave and Shift+arrows half an octave, always at least one `step`.
- `Swatches` picks a content colour: round swatches in a radio group, a ring on the chosen one, names as tooltips, and arrows to move. Use it for track, list and calendar colours.

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

### Waveform view

`WaveformView` draws an audio file for trimming and looping (Music's sampler, which plays the person's own files). Pass `peaks` from `peaksOf(channelData, slices)`, the `duration` in seconds, and a `value` of `{ start, end, loop: { start, end } | null }`.
- The file's shape is in ink. What's trimmed off greys out.
- Start and end are full-height edges with a tab at the foot. The loop sits in a strip along the top, and its two edges drag.
- Pressing the strip when there's no loop adds one, which you can drag to size.
- Each edge only moves as far as its neighbours allow: start ≤ loop start < loop end ≤ end.
- Every edge is a slider: arrows move it 10 ms, Shift 100 ms, and Home and End go as far as it can reach.
- `playhead` draws where it's playing. `onCommit` runs once a drag is let go. `sampleTime` formats times as "0:01.250".

```tsx
<WaveformView label="Sample" peaks={peaksOf(buffer.getChannelData(0), 400)} duration={buffer.duration} value={range} onChange={setRange} playhead={position} />
### Pad grid

`PadGrid` is a drum kit's pads, four to a row (`columns` changes that). Each `Pad` is `{ id, name, color?, key?, empty?, proposed? }`.
- Pressing a pad calls `onChoose(i)` and `onPlay(i, velocity)`. Higher on the pad plays louder, as on a hardware pad. `onRelease` runs when the press ends.
- `lit` pads flash in ink as they sound, so a playing pattern shows on the pads.
- The chosen pad has an ink ring, and its settings (`children`) show under the grid with its name.
- Keys: arrows move between pads, Space or Enter plays, and a pad's own `key`, shown in its corner, plays it from anywhere in the grid.
- An empty pad has a plain edge and says Empty. A pad Mobius changed has the dashed indigo edge.

```tsx
<PadGrid label="Drum kit" pads={pads} chosen={chosen} lit={sounding} onChoose={setChosen} onPlay={(i, v) => kit.play(i, v)}>
  <ParamGrid>…the chosen drum's Tune, Decay, Tone…</ParamGrid>
</PadGrid>
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

### Date and time fields

| Control | Use it for |
| --- | --- |
| `DateField` | Any day to pick (due dates, event days, snooze). Shows the day in words ("Thu 20 Nov") and opens a 280px popover downward: a line to type into ("tomorrow", "fri 3pm", "20 nov"), the quick picks Today (T), Tomorrow (M), Next week (W) and No date (Backspace) with the day each means in grey, then the month. Arrows move by day, Page Up and Down by month, Home and End to the week's ends, T to today, Enter picks. `onChange(day, time)` gets the time too when one was typed. `proposed` gives the dashed edge; `quick` swaps the quick picks |
| `TimeField` | A time of day, as minutes since midnight. Takes typing ("9:30", "3pm", "noon") and lists quarter hours scrolled to the time, or to now. With `from` (an end time) the list starts after the start and shows each time's length in grey |
| `TimeRange` | A start and an end side by side. Moving the start moves the end with it, keeping the length |
| `MonthPicker` | The month on its own, for a sidebar or a panel |

Read typed text with `parseDate(text, now)` and `parseTime(text)` from the same module, so apps and the agent read
dates the same way. Week start, day and month order, and the 12 or 24 hour clock come from `dates.ts` (`weekStart`,
`dayMonthOrder`, `uses12Hour`); never set them per app.

### Pro controls

Music uses these first, and then Video, Photo, Design and Code. Live values use the mono face with tabular figures, so they never jitter.

| Control | Use it for |
| --- | --- |
| `NumberField` | A number you can type, nudge or scrub: tempo, bars, transpose, frame, size. Arrows nudge it, Shift+arrows by ten, Page Up and Down by ten, Home and End to the ends. Drag up or down to scrub, with Shift for fine control. Enter or a typed figure opens it for typing and Escape cancels. Double-click goes back to `reset`. Out-of-range values are clamped, and the tooltip says so. Props: `min`, `max`, `step`, `unit` (grey), `signed` and `decimals`. `onCommit` fires once per drag, key or typed value, for undo |
| `Readout` | A read-only live value at a fixed width ("12 . 3 . 2"). With more than one entry in `formats`, a click switches between them (Bars and Time). With `copy`, a click copies it. `size="lg"` for the transport position. Use `barsLabel(beats)` and `clockLabel(seconds)` to write the text |
| `LetterToggle` | M (mute), S (solo) and R (record) on a track, and lock and hide on a layer. `label` is its full name ("Mute Drums"). `armed` turns an R red while it is on. `dimmed` greys the letter of a track that another track's solo silences |
| `Transport` | Play/Pause, Stop, then the latching Record, Loop and Metronome. The app binds the keys itself, so pass `keys` to make the tooltips match (Space, Enter, R, L and K by default) |
| `LevelMeter` | A vertical level meter per track and on the master, stereo by default, from -60 to +6 dB. Feed it through a ref, with `ref.current.set(leftDb, rightDb)` about 30 times a second. It writes straight to the bars, so nothing re-renders. The peak holds for 1.5 seconds and then falls. Only the part over 0 dB is red, and the clip light stays lit until it is clicked (or `reset()` is called) |
| `LevelMeter` threshold | Give a compressor's or gate's input meter `threshold` (dB) with `onThreshold` and `onThresholdCommit`. It draws an ink line across the bars, edged in paper so it shows over a full bar, and a tab at the right to drag. Up and Down move it 1 dB, and Shift moves it 6. Home, or two quick presses, puts it back to `thresholdReset`. It is a vertical slider for screen readers ("−18 dB"). `decibelLabel` writes the figure with a true minus |
| `GainReductionMeter` | How much a compressor, limiter or gate is turning the sound down: one bar from 0 dB at the top down to `range` (24 dB by default), fed through a ref with `ref.current.set(dbTakenOff)`. A line holds the most it took off for 1.5 seconds, and underneath, the most so far reads in mono ("−6.4"). A click on that figure clears it (`readout={false}` hides it). Set it beside the input meter that shows the threshold |

A step grid and the timeline pieces (ruler, playhead, clip, lane) come next, shaped by what Music needs.

Popovers that stay in place and toasts other than the undo pill are not shared yet; ask the library thread before
building one in an app.

### Instrument controls

What a synth's or drum kit's Device panel draws. Music uses them first; Video's audio and any sound preview can use them later. They follow the same keys as the sliders. Arrows nudge, moving a twelfth of an octave on a log scale, and Shift nudges more. Double-click or Home puts a value back to `reset`. `onCommit` runs once when a drag or a key is let go.

| Control | Use it for |
| --- | --- |
| `Knob` | A `ParamCell` drawn as a dial, with the same props (`label`, `value`, `min`, `max`, `step`, `scale`, `origin`, `reset`, `format`, `unit`), so swapping between them is one line. Use it for a dense row, such as pan or sends, where a slider is too wide. Drag up or down to turn it, with Shift for fine control. The arc fills from the origin. `panLabel` formats pan as "L 40", "C" and "R 40" |
| `EnvelopeGraph` | Attack, decay, sustain and release drawn as one shape. It has three handles: the peak sets attack, the decay corner sets decay across and sustain up (Up and Down on the keyboard), and the end sets release. The four values read underneath, grey until they move from `reset`. `ranges` defaults to Music's: attack 1 ms to 2 s, decay 10 ms to 4 s and release 20 ms to 4 s, all log |
| `FilterGraph` | A two-pole filter's curve across `min` to `max` Hz (log), with one point: across is cutoff, up is resonance, and the point sits on the curve's peak. `type` is `'lowpass'` (default), `'highpass'` or `'bandpass'`. `q` maps resonance (0 to 1) to Q, using Music's `musicQ` unless given. `envAmount` and `envOctaves` add a thin muted curve (solid: dashes mean Mobius made something) where a note's envelope opens it to. Pass `onEnvAmount` (and optionally `onEnvAmountCommit` and `envAmountReset`, both 0 to 1) to make the envelope amount editable: the readout then shows Sweep as a drag-number field (0 to 100%) between Resonance and Opens to, so no separate knob is needed |
| `StepGrid` | Drum rows by steps. `cells[row][step]` is 0 for off, otherwise the velocity (0 to 1), drawn as an ink fill to that height, so every hit reads as on and an accent is a full cell. Click switches a step on or off, Shift+click sets an accent, and dragging across paints. With the keyboard, arrows move, Space or Enter switches, Shift+Enter sets an accent, and + and − change velocity. The grid takes one Tab stop. `now` outlines the playing step, and every other beat is shaded |

```tsx
<EnvelopeGraph value={sound.env} reset={base.env} onChange={(env) => set({ env })} />
<FilterGraph value={{ cutoff, resonance }} min={80} max={12000} envAmount={sound.filterEnv} onEnvAmount={setFilterEnv} envAmountReset={0.35} onChange={setFilter} />
<StepGrid label="Drums" rows={DRUM_ROWS} cells={pattern} now={playingStep} onChange={setStep} />
```

### Devices

Instruments and effects sit in devices, and devices sit in a chain in signal order.

| Control | Use it for |
| --- | --- |
| `DeviceChain` | The row of devices: `label`, `count` and `onMove(from, to)`. It scrolls sideways when the devices don't fit. `orientation="vertical"` stacks them top to bottom for a narrow side panel: it fills the panel's width, grips drag up and down, and scrolls down when they don't fit. In a narrow panel the EQ's values go two to a row |
| `DeviceFrame` | One device. The head has a grip, an on/off `Switch`, the title, optional `actions` and a fold. To move a device, drag its grip along the chain, or focus the grip and use the arrow keys (Home and End go to the ends). Off dims the controls but keeps them editable, as a bypass does. `collapsed` shows the head alone. `proposed` gives the dashed indigo edge for a device Mobius added that waits for Keep |
| `EqGraph` | Three or four bands (`{ type: 'lowshelf' \| 'peak' \| 'highshelf', freq, gain, q, on? }`) over 20 Hz to 20 kHz and ±18 dB. Each band has a numbered dot: across is frequency and up is gain (a shelf's dot sits halfway up its step). The wheel or Alt+drag sets Q, and on a focused dot Alt+Up and Alt+Down do. The chosen band's own shape shows faintly under the whole curve, and every band's values read in a column underneath. `bandLevel` and `eqLevel` give the curve in dB, the same way Web Audio's BiquadFilter computes it |

```tsx
<DeviceChain label="Bass effects" count={devices.length} onMove={moveDevice}>
  {devices.map((d, i) => (
    <DeviceFrame key={d.id} title={d.name} index={i} on={d.on} onToggle={(on) => setOn(d.id, on)} collapsed={d.folded} onCollapse={(f) => fold(d.id, f)}>
      {d.kind === 'eq' && <EqGraph bands={d.bands} onChange={(i, band) => setBand(d.id, i, band)} />}
    </DeviceFrame>
  ))}
</DeviceChain>
```

More controls are added one at a time.

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
