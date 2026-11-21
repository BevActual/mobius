# Music: the road to a full studio

Andrew, 21 November 2026: "Let's focus on getting Music to parity with Ableton." This page has three parts: what a
full studio does, measured against Ableton Live 12.4; where Music stands today; and a proposal for how Music should be
shaped to get there. The [Music roadmap](music-roadmap.md) keeps the line-by-line status. This page is the plan above it.

Parity means a producer who works in Live could make a whole track in Music without missing anything they rely on. It
does not mean a copy. Music keeps its own look (Instrument), its own device designs and its own names, and it keeps
what only Mobius has: a song is a file Mobius can read and change, and every change Mobius makes waits for Keep.

## Where Music stands (main, 21 November)

What works well already:

- **Two views.** Arrange shows the song from start to end. Session is a grid of clip slots, a column per track and a
  row per scene, launched from the next bar.
- **A detail area at the bottom.** It shows the chosen track's Notes (a piano roll or a step grid) or its Devices
  (instrument, then effects), and Shift+Tab switches between them.
- **Instruments.** A drum kit with pads (tune, decay, level and pan on each pad) and one synth voice with four
  starting points (bass, piano, pad, lead). The synth has an oscillator, a filter, an ADSR and vibrato.
- **Effects.** EQ, drawn EQ, compressor, delay and reverb, each with an on switch and the ability to fold. There are
  also Workbench devices, made of parts and cables, with LFOs.
- **Editing.** Draw mode, box select, Ctrl+D, Ctrl+E, Ctrl+J and Ctrl+L, quantize, a velocity lane, the song's key
  with out-of-key notes shown, and Undo for everything.
- **Playing.** The computer keyboard plays the chosen track, and Record writes notes in Arrange. There is a loop, a
  metronome, and volume automation in Arrange.
- **Out.** The whole song exports as WAV, rendered offline.
- **Mobius.** It can write a part or set a sound from words, and both arrive dashed until kept.

How it is built today:

- **Sound** runs in the window with Web Audio: a look-ahead scheduler on the main thread, the built-in nodes, and
  `OfflineAudioContext` for export.
- **The song file** (`song-format.ts`) has no clip objects in Arrange. A track holds one list of notes, and Arrange
  draws "clips" from where the notes sit. There is no audio anywhere in the format, no master track, no return tracks
  and no time signature. The only automation is track volume.

## The gap list

Each row compares one area of Live with Music. **Size**: S is under a day, M is a few days, L is a week or more,
and XL needs a new foundation first (named under "Shaping Music" below).

### Arrangement and clips

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Clips are objects on a track: start, length, loop, offset, name, colour | Notes per track; clips are drawn from them | Real clips in Arrange, shared with Session | XL (format) |
| Drag clips between Session and Arrange; record Session into Arrange | Separate | Comes with real clips | L |
| Time signature and tempo changes along the song | One tempo, 4/4 | Tempo and meter lanes | M |
| Locators and arrangement markers, sections to move as a whole | None | Markers, then sections | M |
| Group tracks, folding, a group's own level and effects | None | Groups | L |
| Take lanes and comping | None | After audio | L |
| Follow playhead, zoom to fit, "Insert time" / "Delete time" | Zoom only | Follow (Next), time edits | S to M |

### Session

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Launch modes (trigger, gate, toggle, repeat), launch quantize | Launch at the next bar | Modes and quantize per clip | M |
| Follow actions (play next, random, chance) | None | Follow actions | M |
| Scene tempo and meter | None | Per-scene tempo | S |
| Stop buttons, a mixer section under the grid | Stop squares; no mixer | Mixer strip in Session | M |
| Capture what was played without recording | None | Capture | M |

### Notes and MIDI

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| A MIDI keyboard and controllers | Computer keyboard | MIDI in through the engine (midir), then mapping | M |
| Count-in and an arm button per track | No count-in, no arm | Both | S |
| Scale awareness everywhere: fold to scale, highlight, devices follow the key | Key and out-of-key shown | Fold to scale, devices follow the key | M |
| Transform tools (arpeggiate, chop, strum, ornament, connect, recombine, quantize, humanize) | Quantize | A Transform panel in Notes | L |
| Generators (rhythm, seed, shape, stacks, Euclidean) | Mobius writes parts | Generators that run locally, next to Ask Mobius | L |
| Note probability, velocity range, chance | Velocity only | Per-note chance and range | M |
| Multi-clip editing | One track | Several tracks at once | M |
| MPE | None | Later | L |
| Groove pool (swing, feel) | None | Grooves | M |

### Instruments

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Sample playback (one-shot, slicing, classic) | None | Sampler | L (needs audio) |
| A drum rack: a pad per sample, its own chain on each pad | Synth kit with pads | Pads that hold samples or instruments | L |
| Wavetable, FM, granular, physical modelling synths | One subtractive voice | Morph synth (Next), FM, grain cloud, modelled | L each |
| Instrument racks with macros | None | Stacks with macro knobs | L |

### Effects and modulation

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| About 40 audio effects | 5 built-in, plus Workbench | Saturation, auto filter, chorus, phaser, flanger, gate, limiter, multiband, utility, beat repeat, vocoder, shifter | M each |
| Sidechain on compressor and gate | None | Sidechain input | M |
| LFO, envelope follower, shaper on any parameter | LFOs inside Workbench devices | Modulators on any setting | L |
| Automation of every parameter, clip envelopes | Track volume only | Any setting, in Arrange and in clips | L |
| Effect racks, parallel chains, macros | Serial chain | Stacks for effects | L |

### Mixing

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Meters on every track and the master | None | `LevelMeter` in the library (Next) | S to M |
| Master track with its own effects | None | Master | M (format) |
| Return tracks and sends | None | Returns and sends | M (format) |
| A mixer view | None | Mixer, in Session and as a panel in Arrange | M (library `Mixer` exists) |
| Freeze and flatten | None | Freeze to audio | M (needs audio) |
| Latency compensation, track delay | Not needed yet | Comes with the engine | — |

### Audio

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Audio tracks and clips | None | Audio clips in the format; drawn with the library `Waveform` | XL |
| Recording audio from an input | None | Input monitoring and recording | XL (engine) |
| Warping: stretch to tempo, warp markers, modes | None | Time-stretch in the engine | L |
| Stem separation, audio to MIDI | None | Later, local models | L |
| Export stems, MP3 and FLAC | WAV of the whole song | Stems first | S to M |

### Browser and workflow

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| A browser for sounds, samples, devices, clips and places, with tags, preview and similar-sound search | Five sounds in the sidebar | A Library panel: workspace samples, presets, tags, preview, drag in | L |
| Hot-swap a device or sample in place | Swap instrument from a menu | Swap from the Library | S |
| Keyboard navigation of every part of the window | Partial | Kept with each round | — |
| Info view (what the pointer is over) | Key-hint bar (Next, shell) | Shell | — |
| Undo history, saved sets, templates | Undo; songs are files | Templates | S |

### Not for Mobius (for now)

- Max for Live. Workbench devices are Music's answer: devices as files that Mobius can draft.
- VST3, AU and CLAP plug-ins. The native engine makes them possible; revisit once it is stable.
- Ableton Link, CV and hardware sync. Possible with the native engine; later, as they are rare for people new to Music.
- Push-style hardware integration. Generic MIDI mapping covers the common case.

## Shaping Music

There are two choices to make before the large work starts. The first is the one Andrew needs to decide.

### 1. Where the sound is made: a native engine (decided)

Andrew chose this on 21 November: **the native engine comes first.** Sound moves out of the window and into the Mobius
host, written in Rust. The window becomes the UI only.

- **Audio out and in** through cpal: WASAPI on Windows (shared mode, and exclusive mode for low latency), with ASIO
  later. There is a real audio thread with no allocation and no locks on it, and the UI talks to it through a
  lock-free queue.
- **MIDI in** through midir, so a keyboard reaches the audio thread without passing through the window.
- **The graph**: tracks, then devices, then returns, then the master, with sample-accurate scheduling, offline render
  for export and freeze, and meters sent back to the UI about 30 times a second.
- **The song file stays the contract.** The engine reads the same `song.json` the window shows, so Mobius, the UI and
  the engine never disagree about a song.
- **First milestone: it plays what Music plays today.** The engine plays every built-in instrument and effect, and
  sounds like today's Web Audio version, checked by rendering the demo songs both ways and comparing them
  (`node crates/mobius-audio/parity/compare.cjs <song.json>`, which prints how far apart each track is). Then
  `studio-audio.ts` retires.
- **Plug-ins** (VST3 or CLAP) become possible later. They stay out of scope until the engine is stable.

The engine is core work, so the Builder builds it in `crates/`. The Apps lead does the Music UI, the song format and
the note tools, and keeps that work moving while the engine is built.

### 2. How the window is laid out

This follows the new layout, checked with the Design lead against [panel layouts](../design/panel-layouts.md). Each app
owns its panels, and Mobius stays docked on the right.

- **Left: Library.** One panel. Songs come first, then Sounds, Samples (from the workspace), Devices, Clips and
  Places, with search, tags and preview. It folds away under 1200 px wide while Mobius is docked.
- **Centre: Session or Arrange.** Tab switches between them, but only while the focus is on the grid or the timeline
  (elsewhere Tab still moves the focus). Alt+1 and Alt+2 always switch. In Session, a mixer strip under the grid is
  part of the content.
- **Bottom: Detail** has two tabs. **Clip** shows the notes of a MIDI clip or the waveform (with warp markers) of an
  audio clip. **Devices** shows the chain. Shift+Tab switches between them. **Mixer** is a third tab in the same dock,
  with its own key.
- **Foot: the info bar** (`infoBar: true`). It shows key hints, and what a control does while the pointer is over it.
- **Top bar.** The tools start right after the title, in this order: the Session/Arrange switch, play, stop and
  record, tempo with tap, and metre. When the bar is narrow, count-in, follow, loop and the metronome fold into ⋯
  first. The transport and tempo never fold.

### 3. The song file, version 2

Both the engine and the UI read this, so it is settled before either builds on it. Version 1 files keep opening: they
are read as version 2 on load, and saved as version 2 when next changed.

```ts
interface Song {
  version: 2; tempo: number; key: string; bars: number;
  meter?: [number, number];                 // [4, 4] when absent
  changes?: { beat: number; tempo?: number; meter?: [number, number] }[];   // along the song
  tracks: Track[];
  returns?: Return[];                       // shared effects that tracks send to
  master?: { volume: number; fx?: Effect[] };
  scenes?: string[];
}
interface Track {
  id: string; name: string; instrument: Instrument; color: TrackColour;
  volume: number; pan: number; muted: boolean; solo: boolean; armed?: boolean;
  sound?: Sound; kit?: KitSound; pads?: Record<number, DrumPad>; fx?: Effect[]; instrumentOn?: false;
  sends?: Record<string, number>;           // return id -> level 0..1
  clips: ArrangeClip[];                     // Arrange, in time order, never overlapping
  slots?: (Clip | null)[];                  // Session, one per scene
  auto?: Record<string, AutoPoint[]>;       // "volume", "pan", "fx:<id>:<setting>" -> points in song beats
}
interface ArrangeClip {
  id: string; start: number; length: number;   // song beats
  name?: string; color?: TrackColour; muted?: boolean;
  loop?: { start: number; end: number };       // beats in the clip's own time; repeats to fill `length`
  offset?: number;                             // where in its own time the clip starts playing
  notes: SongNote[];                           // starts in the clip's own time, from 0
}
interface Return { id: string; name: string; volume: number; fx: Effect[] }
```

- In version 1, `notes` is one list per track. On load, it becomes one clip per run of notes, cut where Arrange draws
  clips today (`clipsOf`). `volumeAuto` becomes `auto.volume`.
- Session's `Clip` keeps its shape (`name`, `bars`, `notes`). Dragging a Session clip into Arrange makes an
  `ArrangeClip` with the same notes.
- Audio comes in phase 3 as `audio?: { file: string; warp?: WarpMarker[] }` on a clip, in place of `notes`.
- Mobius writes clips too: its guide (`docs/agent/music.md`) changes in the same pull request as the format, with one
  Launch run on the PC before it merges.

## Phases

Each phase is a run of rounds: one pull request per round, as for every app. Gaps in controls go to the library
first. Phase 1 (the engine) and phase 2 (the format and the layout) run at the same time, owned by different leads.

1. **The engine** (Builder, about 3 to 4 weeks). It plays and renders what Music plays today, then adds meters, MIDI
   in, a master track and returns. Then `studio-audio.ts` retires.
2. **Foundation in the UI and format** (Apps lead, in parallel with phase 1):
   - Real clips in Arrange, shared with Session, with a migration for existing songs.
   - The master track, return tracks and sends in the file.
   - Time signature, and tempo and metre changes.
   - The layout above.
   - Arm, count-in, follow and Capture.
   - The Mixer tab.
3. **Audio** (about 3 weeks, once the engine plays):
   - Audio clips and tracks, recording from an input with monitoring.
   - The Sampler, and drum pads that hold samples.
   - Warping, with a stretcher in the engine.
   - Freeze, and exporting stems.
4. **Devices and movement** (about 3 weeks):
   - Automation for every setting, and clip envelopes.
   - Modulators and sidechain.
   - Stacks with macros.
   - Six more effects.
5. **Notes tools** (about 2 weeks):
   - Transform and Generate.
   - Fold to scale, chance, grooves and editing many clips at once.
   - Follow actions and launch modes. Most of this needs no engine, so it can start early.
6. **Library and polish** (about 2 weeks):
   - The Library panel, with tags, preview and similar sounds.
   - Templates, takes and groups.
   - More synths.

## What starts now

- **Builder:** the engine skeleton. That means cpal output, a clock, and one synth voice playing a song's notes from
  `song.json`.
- **Apps lead:** follow the playhead in Arrange and count-in before recording (both UI only), then real clips in the
  song format.
- **Design lead:** `LevelMeter` (started), then tap tempo and an arm toggle for track headers.

Sources for Live's features: [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12),
[All new features in Live 12](https://ableton.com/en/live/all-new-features) and
[Live 12.4 is out now](https://www.ableton.com/blog/live-12-4-is-out-now/). For latency in the window:
[Audio latency in browser-based DAWs (W3C workshop)](https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html).
