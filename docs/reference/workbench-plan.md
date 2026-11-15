# Workbench plan

Workbench lets people, and Mobius, build their own devices in Music: a device is a small file of parts and cables, and
Workbench is the view that shows and edits it. Ableton's Max for Live is the bar for what this makes possible; the
names, format and look here are Mobius's own.

Andrew asked for this on 15 November 2026 ("go ahead"). It was checked against the build plan's test in
[A new app, or part of one that exists](build-plan.md#a-new-app-or-part-of-one-that-exists): Workbench works on what
Music holds (a track's devices), is reached from the device itself, fits as a view beside Session and Arrange, and has
no moment without a song playing through it. So it is a view in Music, not an app. Only its canvas of boxes and
cables goes to the shared component library.

Work starts after Music's demo moments and live marks are done.

## Why build it

- **Mobius can make sounds, not only set them.** "A tape delay that wobbles and gets darker each repeat" becomes a
  device Mobius drafts, dashed until kept, with each part saying why it is there. Today Mobius can only turn the knobs
  of the four effects Music ships.
- **New devices are cheap.** Each effect is hand-written in `studio-audio.ts` today. As files, a new effect is mostly
  a file, and one set of tests checks them all.
- **It proves a shared canvas.** Boxes, ports and cables that are fast, exact and usable from the keyboard. Agents and
  automations can take the canvas up later for their steps.

## What a device is

A device is a JSON file, kept two ways:

- **In the song**, as the track's effect: `{ "id": "fx3", "kind": "device", "on": true, "device": { ... } }`. The full
  definition is copied in, so a song still plays when it is sent to someone or the library copy changes.
- **In the library**, as `workspace/studio/Devices/<Name>.json`, so it can be put on any track. The sidebar's Sounds
  section lists them under Devices.

The definition:

```json
{
  "name": "Tape Delay",
  "about": "Echoes that wobble and get darker each time round",
  "parts": [
    { "id": "in", "kind": "input" },
    { "id": "echo", "kind": "delay", "time": 0.75, "sync": true },
    { "id": "tone", "kind": "filter", "type": "lowpass", "cutoff": 3000, "resonance": 0.1 },
    { "id": "back", "kind": "gain", "gain": 0.45 },
    { "id": "wobble", "kind": "lfo", "rate": 0.6, "depth": 0.004, "shape": "sine" },
    { "id": "mix", "kind": "mix", "amount": 0.35 },
    { "id": "out", "kind": "output" }
  ],
  "cables": [
    ["in", "mix.dry"], ["in", "echo"], ["echo", "tone"], ["tone", "back"], ["back", "echo"],
    ["tone", "mix.wet"], ["mix", "out"], ["wobble", "echo.time"]
  ],
  "controls": [
    { "label": "Time", "part": "echo", "param": "time" },
    { "label": "Repeats", "part": "back", "param": "gain", "max": 0.9 },
    { "label": "Tone", "part": "tone", "param": "cutoff" },
    { "label": "Wobble", "part": "wobble", "param": "depth" },
    { "label": "Mix", "part": "mix", "param": "amount" }
  ]
}
```

- **Parts** are Web Audio building blocks with fixed kinds and ranges: `input`, `output`, `gain`, `filter`, `delay`,
  `lfo`, `envelope` (follows the track's notes), `drive`, `compressor`, `reverb`, `pan`, `mix`, `split`. Each kind's
  settings and ranges live in `song-format.ts` beside today's `EFFECT_PARAMS`, so the format, the panel and the agent
  guide share one table.
- **Cables** go from a part to a part's input, or to one of its settings (`echo.time`), which is how an LFO moves a
  filter or a delay. A loop must pass through a `delay`, as Web Audio requires.
- **Controls** are the knobs the device shows on the track. Everything else stays inside, and is seen in Workbench.
- **Limits:** at most 24 parts and 48 cables; every output passes a soft limiter so a bad patch cannot hurt ears or
  speakers. A file that breaks a rule is refused with a line saying which, as songs are today.

The four built-in effects (EQ, Compressor, Delay, Reverb) become device files shipped with Music. Songs that use
`"kind": "delay"` and the rest keep working unchanged: the kinds name the built-in files.

## The Workbench view

Double-click a device's head (or choose Edit device in its menu) and the bottom area becomes the canvas:

- **The parts** are boxes in the Instrument style, left to right in the order the sound goes. Each box shows its kind,
  its settings as small knobs, and its ports.
- **Cables** are drawn in the track's colour. While the song plays, each carries a thin level line, so you can see
  where the sound goes and where it stops.
- **Left:** the parts to drag in, by kind. **Right:** the device's panel as it will look on the track; drag a setting
  there to make it a control, and name it.
- **Keyboard:** Tab moves between parts, arrows between ports; Enter on a port starts a cable and Enter on another ends
  it; Delete takes out a part or cable. Every change is one Undo step, and is heard at once (the live update #285
  added).
- **Done** puts the device back on the track; **Save to library** keeps a copy in Devices.

## Mobius building devices

`docs/agent/music.md` gains a section on device files: the part kinds and their ranges, the cable rules, and a few
recipes (an echo, a wobble, a sidechain-style pump). Mobius writes the device into the track's `fx`. The change bar
says what it made ("Mobius added Tape Delay to Keys: 7 parts"), Workbench opens on it with the new parts dashed, and
each part has its reason one tap away. Try another drafts a different patch for the same ask.

This is the moment for the demo plan once it works: "make the keys sound like an old tape" while the loop plays.

## Rounds

One Music PR at a time, as always.

1. **Device files.** The format, its checks and tests; the four built-in effects moved onto it with no change heard;
   `kind: "device"` played and rendered on export; the agent guide's section. No new view yet.
2. **Workbench, looking.** The canvas shows any device read-only, with live levels on the cables. The Design lead
   builds the shared canvas (boxes, ports, cables, keyboard paths) in this round.
3. **Workbench, editing.** Add, wire and take out parts; choose the controls; Save to library; the Devices list in the
   sidebar.
4. **Mobius drafts devices.** Dashed parts with reasons, Try another, and the demo moment.

Later, not planned yet: instruments built in Workbench (a part per note, which needs voice handling), sharing devices
through Abilities, and Agents taking up the canvas for its steps.

## Open questions

- Whether instruments come into Workbench in round 3 or wait. They need the parts to run once per note.
- Whether the library copy and the song copy should stay linked (change one, offer to change the other), or stay
  separate as planned here.
- The canvas's name in the shared library, settled with the Design lead in round 2.
