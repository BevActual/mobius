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
| A MIDI keyboard and controllers | Computer keyboard | Web MIDI input, then mapping | M |
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
| Warping: stretch to tempo, warp markers, modes | None | Time-stretch (a Wasm stretcher) | L |
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
- VST3, AU and CLAP plug-ins. These would need the native engine (option B below). Revisit after phase 3.
- Ableton Link, CV and hardware sync. They need the native engine and are rare for people new to Music.
- Push-style hardware integration. Generic MIDI mapping covers the common case.

## Shaping Music

There are two choices to make before the large work starts. The first is the one Andrew needs to decide.

### 1. Where the sound is made

Real parity needs audio clips, audio recording, low latency from a MIDI keyboard, and many tracks at once. Today's
engine is Web Audio on the main thread. There are three ways forward:

- **A. Stay in the window, made stronger.** Move the scheduler and synth voices into an AudioWorklet, add Web MIDI and
  `getUserMedia` input, and use a Wasm time-stretcher for warping. This works on WebView2 today, with no new process.
  Its limits: input latency is roughly 20 to 40 ms, depending on the device, there is no ASIO, and there are no
  plug-ins ever. Fastest: every phase below can start now.
- **B. A native engine in the Mobius host (Rust).** cpal for audio (WASAPI exclusive mode or ASIO on Windows), a real
  audio thread, and the window becomes only the UI. This gives the lowest latency, many tracks, and plug-ins
  possible later. Its cost: a new engine to build and keep up (several weeks before it plays what Music plays today),
  and the Builder owns it, since it is core.
- **C. Both, in order (recommended).** Build phases 1 to 3 in the window (option A), behind one engine interface
  (`play`, `render`, `record`, `meter`). The song file stays the contract. Start the native engine as its own track
  once phase 2 has proved what Music needs, and switch over when it plays every song the same way. Nothing built in
  the meantime is thrown away: the UI, the format and the devices' settings carry over.

### 2. How the window is laid out

This follows the new layout: each app owns its own panels, and Mobius stays docked on the right. Music takes the shape
producers already know:

- **Left: Library.** Songs at the top, then Sounds, Samples (from the workspace), Devices, Clips and Places. Search,
  tags and preview. It replaces today's sidebar.
- **Centre: Session or Arrange.** Toggled with Tab, the same key as Live. Session has a mixer strip under its grid.
- **Bottom: Detail.** Notes, Audio (a waveform with warp markers) or Devices for the chosen clip or track, switched
  with Shift+Tab. Wide devices live here, never beside Mobius.
- **Optional bottom-right: Mixer**, as its own panel, for Arrange.
- **Foot: the key-hint bar** as the info line.
- **Top bar:** transport, tempo with tap, meter, count-in, follow, the loop and the metronome. It folds into ⋯ when
  narrow (the toolbar-fit work).

The Design lead owns the layout rule for app panels. This proposal goes to them as Music's input, and Music is where
it is tried first.

## Phases

Each phase is a run of rounds: one pull request per round, as every app does. Gaps in controls go to the library
first.

1. **Foundation** (about 2 to 3 weeks)
   - Real clips in Arrange, shared with Session, including a migration of existing songs.
   - Master track, return tracks and sends.
   - Meters (library `LevelMeter`).
   - Time signature, plus tempo and meter changes.
   - Scheduler and voices in an AudioWorklet.
   - Web MIDI input, an arm button, count-in, and Capture.
   - A mixer strip in Session.
2. **Audio** (about 3 weeks)
   - Audio clips and audio tracks.
   - Importing samples from the workspace.
   - The Sampler, and drum pads that hold samples.
   - Warping with a Wasm stretcher.
   - Recording from an input.
   - Freeze, and exporting stems.
3. **Devices and movement** (about 3 weeks)
   - Automation for every setting, and clip envelopes.
   - Modulators (LFO, envelope follower) and sidechain.
   - Stacks with macros, for instruments and effects.
   - Six more effects: saturation, auto filter, chorus, phaser, limiter and utility.
4. **Notes tools** (about 2 weeks)
   - Transform tools and Generators, Live 12's biggest step, done locally next to Ask Mobius.
   - Fold to scale, devices that follow the key, chance, grooves, and editing many clips at once.
   - Follow actions and launch modes.
5. **Library and polish** (about 2 weeks)
   - The Library panel: tags, preview, similar sounds, hot-swap.
   - Templates, takes and comping, groups.
   - More synths: the morph synth, FM and grain cloud.

**The native engine** (option C) starts after phase 2 as the Builder's work, in parallel with phases 3 to 5.

## What starts now

These are small and fit today's engine and format, so they start without waiting for the decision:

- Count-in, and an arm button in the track header (the Music roadmap lists both as Next).
- Web MIDI input: a MIDI keyboard plays and records the armed track.
- Follow the playhead in Arrange.
- Tap tempo.
- `LevelMeter` in the library (Design lead), then meters on tracks.

Sources for Live's features: [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12),
[All new features in Live 12](https://ableton.com/en/live/all-new-features) and
[Live 12.4 is out now](https://www.ableton.com/blog/live-12-4-is-out-now/). For latency in the window:
[Audio latency in browser-based DAWs (W3C workshop)](https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html).
