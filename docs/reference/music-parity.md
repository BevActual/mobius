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
| Clips are objects on a track: start, length, loop, offset, name, colour | Real clips in Arrange with name and mute; **loop and start marker in the format and played by the engine and the window player alike; Loop in a clip's menu, stretching a looped clip repeats it** | Clip View's Set buttons, the loop brace in the notes editor, colour | XL (format) |
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
| Transform tools (arpeggiate, chop, strum, ornament, connect, recombine, quantize, humanize) | A Transform menu: quantize, arpeggiate, strum, fit to key, chop, connect, reverse, humanize | Settings per tool, ornament, recombine | M |
| Generators (rhythm, seed, shape, stacks, Euclidean) | Mobius writes parts | Generators that run locally, next to Ask Mobius | L |
| Note probability, velocity range, chance | Velocity only | Per-note chance and range | M |
| Multi-clip editing | One track | Several tracks at once | M |
| MPE | None | Later | L |
| Groove pool (swing, feel) | None | Grooves | M |

### Instruments

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Sample playback (one-shot, slicing, classic) | Sampler track in the engine: Classic (polyphonic, the track's ADSR, optional loop) and One-Shot (monophonic, trigger or gate, fades), a region and a root note (Live 12 manual, 36.8 "Working with Samples") | Slicing; the window's Sampler track and file drop | M |
| A drum rack: a pad per sample, its own chain on each pad | Synth kit with pads; a pad can hold a sample, played at its own pitch with the pad's tune, level and pan (25.6.1 "Pad View") | A chain on each pad; instruments on pads | M |
| Wavetable, FM, granular, physical modelling synths | One subtractive voice | Morph synth (Next), FM, grain cloud, modelled | L each |
| Instrument racks with macros | In the engine: a track's `stack: { chains: [{ instrument, sound?, keys?: { low, high }, velocities?: { low, high }, volume?, pan?, muted? }] }`, up to 16 chains, each playing the notes in its key and velocity zones in place of the track's instrument, in songs and from a keyboard | The window; zone fades; macros; sampler and drum chains | M |

### Effects and modulation

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| About 40 audio effects | 13 built-in in the engine (EQ, compressor, delay, reverb, gate, limiter, saturator, auto filter, chorus, phaser, stack, Beat Repeat, Auto Pan-Tremolo), plus Workbench; the chorus as Live 12's Chorus-Ensemble (29.8) in Chorus and Vibrato `mode`, with `highpass` (Hz), `feedback` (0..0.95) and `invert`; the window has all but Auto Pan-Tremolo, Chorus-Ensemble with its Chorus/Vibrato modes, Feedback, Invert feedback and the high-pass (switch and frequency), Feedback and Dry/Wet resting in Vibrato as Live's do. Beat Repeat (29.5 "Beat Repeat"): `{ kind: "beatrepeat", interval, offset, gate, grid (sixteenths), chance, decay (0..1), volume (dB), mix: "mix" \| "insert" \| "gate" }`, on the song's beat; chance, decay and volume automate; in the window, Interval and Grid as note values and Mix, Insert or Gate. Auto Pan-Tremolo (29.3 "Auto Pan-Tremolo"): `{ kind: "autopan", mode: "panning" \| "tremolo", wave: "sine" \| "triangle" \| "sharktooth" \| "sawup" \| "sawdown" \| "square" \| "random" \| "wander" \| "sh", amount (0..1), rate (Hz) or sync (a cycle in sixteenths) with offset (degrees), phase (degrees, 180 by default) or spin (0..1), shape (-1..1), invert, harmonic, vintage }`; amount, rate and shape automate | Auto Pan-Tremolo in the window; Auto Pan-Tremolo's Attack Time and Dynamic Frequency Modulation; Chorus-Ensemble's Ensemble mode, width and warmth; Beat Repeat's variation, pitch and filter; flanger, multiband, utility, vocoder, shifter | M each |
| Sidechain on compressor and gate | Compressor and gate: in the engine, an effect's `sidechain: { track, gain?, mix? }` (dB, 0..1) keys it by that track after its volume and effects; `sidechain.eq: { type, freq, q?, gain?, on? }` has only that band trigger it, with or without a track | Sidechain input and EQ in the window | M |
| LFO, envelope follower, shaper on any parameter | LFOs inside Workbench devices; in the engine, a track's `mods` (LFO, shaper and envelope follower) on its volume, pan, sends and effect settings; a shaper draws one round as `points: [{ beat (0..1), value (-1..1), curve? }]`, up to 64, going round from the last to the first | Modulators on any setting | L |
| Automation of every parameter, clip envelopes | In the engine: Arrangement automation of volume, pan, sends, Main and effect settings (curves, overrides); clip envelopes of volume, pan, sends, effect settings (`fx:<effect id>:<setting>`, the setting itself while the clip plays, over its automation) and an audio clip's transposition (`transpose`, added to its own transpose, 27.2.2); unlinked envelopes (`unlinked: { <name>: { start, end } }`, each round its own loop from the clip's start) | The window: the Pitch control and the transposition envelope | M |
| Effect racks, parallel chains, macros | In the engine: an effect `{ kind: "stack", chains: [{ fx, volume?, pan?, muted? }], macros: [{ value, maps: [{ target: "fx:<id>:<setting>", min, max }] }] }`, up to 16 chains and macros, automated as `fx:<stack id>:macro<N>`; no stack in a stack | The window | M |

### Mixing

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Meters on every track and the master | None | `LevelMeter` in the library (have) | S to M |
| Master track with its own effects | The engine plays `main` (effects, then level; 0.8 when unset) | Main in the format and the Mixer | M (format) |
| Return tracks and sends | The engine plays `returns` (up to 12) and each track's post-fader `sends` | Returns and sends in the format and the Mixer | M (format) |
| A mixer view | None | Mixer, in Session and as a panel in Arrange | M (library `Mixer` exists) |
| Freeze and flatten | Freeze in the engine: a track's instrument, clips and effects rendered to Samples/Processed/Freeze and played in their place in Arrange, and each Session clip two times round (`<track> Freeze Clip <n>.wav`, kept as `frozen.slots` by slot) played in its place in Session, its volume, pan and sends still live (Live 12 manual, 38.1.4 "Track Freeze") | The window's Freeze/Unfreeze keeping `frozen.slots`; flatten | S |
| Latency compensation, track delay | Not needed yet | Comes with the engine | — |

### Audio

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| Audio tracks and clips | The engine plays audio clips in Arrange and Session from WAV files in the song's folder, with a 4 ms declick fade | The window: audio tracks, clips and their waveforms | XL |
| Recording audio from an input | The engine records the armed audio track's input while the song plays, to `Samples/Recorded/<track> <n>.wav` (32-bit float), taking off the round-trip latency; an armed audio track hears its input (Auto monitoring, straight out at the track's volume and pan) | Monitoring through the track's effects; the window's record button and take clips | XL (engine) |
| Warping: stretch to tempo, warp markers, modes | The engine warps clips by the file's tempo or its warp markers: Re-Pitch like a turntable, the other modes keeping pitch with a granular stretcher (Beats on a sixteenth-note grid, Tones short grains, Texture long ones), transposed by the clip's own transpose in semitones and cents (8.4.7) | Beats' transient detection, Texture's Flux, and a phase-vocoder Complex and Complex Pro for full mixes | L |
| Stem separation, audio to MIDI | None | Later, local models | L |
| Export stems, MP3 and FLAC | WAV of the whole song; stems in the engine: each heard track, return and Main post-fader, the same length, silent tracks left out (Live 12 manual, 5.1.3.1 "Selection Options") | The window's stems option; MP3 and FLAC; "Include Return and Main Effects" | S |

### Browser and workflow

| Live does | Music today | Gap | Size |
| --- | --- | --- | --- |
| A browser for sounds, samples, devices, clips and places, with tags, preview and similar-sound search | Five sounds in the sidebar | The Library panel, below | L |
| Hot-swap a device or sample in place | Swap instrument from a menu | Swap from the Library | S |
| Keyboard navigation of every part of the window | Partial | Kept with each round | — |
| Info view (what the pointer is over) | Key-hint bar (Next, shell) | Shell | — |
| Undo history, saved sets, templates | Undo; songs are files | Templates | S |

### The Library panel (moved up: right after the layout round)

Modelled on [the Live 12 Browser](https://help.ableton.com/hc/en-us/articles/12927340213660-The-Live-12-Browser),
which Andrew pointed to on 21 November. It is the left panel of the new layout, so it comes straight after the layout
round rather than in phase 6.

How Live lays it out, and what Music takes from it:

- **Sidebar, top to bottom.** Collections (up to seven colour tags), then Library categories (All, Sounds, Drums,
  Instruments, Audio Effects, MIDI Effects, Samples, Clips), then Places (folders). Music's Places are workspace
  folders, and songs are a Place too, so the Songs list moves in here.
- **Results.** Results list next to or under the sidebar, sorted by name, with a search field that filters within the
  chosen category. Back and forward step through where you have been.
- **Filters.** A filter bar of tag groups (for a sound: Bass, Keys, Pad, Lead, Drums; character: Warm, Bright, Dark,
  Short, Long). Filters combine with the category and the search. Saving a view (search, category and filters) makes
  it a label in the sidebar.
- **Preview.** A Preview toggle (auto-preview): with it on, Up and Down audition each result; Shift+Enter or Right
  previews one without it. Previews start on the next bar and loop while the song plays. Raw plays a sample at its own
  tempo, unlooped. Preview volume is its own knob.
- **Collections.** Keys 1 to 7 put the chosen item in a colour, 0 clears; an item can hold several colours.
- **Filters.** Ctrl-click picks several tags in a group; the results bar counts active filters and has Clear. `#tag`
  in the search field searches tags; several words must all match.
- **Similar sounds.** "Show similar files" (a row icon, the context menu, or Ctrl+Shift+F) fills the search with the
  file and sorts results most similar first.
- **Hot-swap.** Q, or the swap button in a device's title, links the device to the browser on its own kind and folder;
  Up and Down pick, Enter or double-click loads, Q or Esc leaves.
- **Use.** Drag onto a track, or below the last track to make a new one; a preset dropped on a device replaces it.
  Double-click adds to the chosen track, or makes a track when none is chosen.
- **Keys.** Ctrl+F goes to All and the search field; Down moves into results; Esc clears search and tags; Ctrl+[ and
  Ctrl+] go back and forward.

**Shipped in the first cut:**
- The Browser is one panel in the left dock (Ctrl+Alt+B), as in Live 12 ([Working with the Browser](https://www.ableton.com/en/live-manual/12/working-with-the-browser/)): search on top, then the sidebar (Collections, Library, Places) beside the results, and the preview strip with Similar sounds at the foot. Songs is a Place there, holding the songs list (the panel look, docs/design/panel-look.md); the place the person picks is remembered. Similar sounds lists the same kind with the same tags.
- The panel holds categories (All, Sounds, Drums, Instruments, Audio Effects) and seven collections. They sit in a
  select, since the dock is under 440 px.
- All-words and `#tag` search, and the tag filters.
- Seventeen built-in sounds and kits, plus the five instruments and four effects.
- Collections with 1 to 7 and 0, shown as up to three dots per row. Esc clears the search and tags.
- Preview on choosing, plus Up and Down while Preview is on. Shift+Enter or Right previews a row. The preview strip has
  a volume control.
- Enter or a double-click puts a sound on the chosen track when the kinds match, else on a new track, and adds an
  effect to the chosen track.

**Still to come from the plan below:** drag onto a track, Q from the Devices tab, Ctrl+[ and Ctrl+], workspace folders as
Places, Clips, and the side-by-side layout when the dock is wide.

**First cut as planned:**
- The panel in the left slot with search, categories (Sounds, Drums, Instruments, Audio Effects, Clips), Places
  (Songs and workspace folders) and Collections.
- Tag filters from built-in tags on Music's sounds and devices.
- Preview on choosing, with the Preview toggle on by default, starting on the next bar while the song plays.
- Collections with 1 to 7 and 0, and `#tag` and all-words search.
- Hot-swap with Q from the Devices tab, Enter or double-click from results, and drag onto a track or below the last
  one. Ctrl+F, Esc, and Ctrl+[ and Ctrl+].
- Layout (Design): the sidebar and the results side by side with a divider; under about 440 px the sidebar folds
  into a select above the search. A row shows up to three collection colours. The preview strip sits at the panel's
  foot: the Preview toggle, the chosen item's waveform to scrub, Raw, and a small volume knob (which moves to the
  master strip once that exists).
- Shared pieces from the library: tag chips are the existing `Chip` with `aria-pressed`; `FilterBar` (groups,
  Ctrl-click, the results bar with Clear, no per-tag counts) and `PreviewStrip` come from Design.

**Later:**
- Samples and Raw preview, once audio clips play (phase 3).
- Similar-sound search, from the same tags first and from analysis once the engine reads audio.
- Saved views as labels, a tag editor, and auto-tags on the user's own samples.
- MIDI Effects, once Music has them.

Sources: [The Live 12 Browser (help)](https://help.ableton.com/hc/en-us/articles/12927340213660-The-Live-12-Browser),
[Live 12 manual, 4. Working with the Browser](https://www.ableton.com/en/live-manual/12/working-with-the-browser/),
[3. Live Concepts](https://www.ableton.com/en/live-manual/12/live-concepts/) (sound similarity),
[23. Working with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/) (hot-swap).
Copied: the sidebar's order, preview keys, collections keys, hot-swap. Adapted: Places are workspace folders, and
Songs are a Place. Skipped: Packs, Cloud, Push, Splice, Max for Live, plug-ins and Cue outputs.

**How this plan is checked against Live.** Each row's round reads the matching chapter of the
[Live 12 manual](https://www.ableton.com/en/live-manual/12/) and the help articles for it first. The pull request says
what Live does, which pages were read, and what Music copies, adapts or skips, and the row gets a sources line here.

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
- **First milestone: it plays what Music plays today (done, 22 November).** The engine plays every built-in
  instrument and effect and sounds like the Web Audio version did. Rendered both ways, the test song was 0.23 dB apart
  on average every 100 ms (piano 0.00, the pad's reverb 0.35, drums about 1 dB from their noise), and Library previews
  and export matched on Andrew's PC. With no sound output the engine plays silently, so `studio-audio.ts` is retired:
  all of Music's sound comes from the engine.
- **Plug-ins** (VST3 or CLAP) become possible later. They stay out of scope until the engine is stable.

**What Live's manual says the engine should do**, and where Mobius's engine stands
([Audio Fact Sheet](https://www.ableton.com/en/manual/audio-fact-sheet/),
[MIDI Fact Sheet](https://www.ableton.com/en/live-manual/12/midi-fact-sheet/),
[Mixing](https://www.ableton.com/en/live-manual/12/mixing/),
[How to reduce latency](https://help.ableton.com/hc/en-us/articles/209072289-How-to-reduce-latency)):

| Live | Mobius's engine |
| --- | --- |
| 32-bit float inside; a track can go over 0 dB without clipping, only the main output and export clip | The same: float all the way, clipped only by the output |
| Volume automation is applied every sample | The same for every track's volume, pan and sends and for Main's volume, curves included (phase 4); the Session view plays none |
| Export matches playback when nothing non-neutral is applied; render at 32 bits, dither once at the end | Playback and export are the same code; WAV export is 32-bit float |
| Constant-power pan: 0 dB in the middle, +3 dB hard to one side | The same: constant power, 0 dB in the middle and +3 dB hard over (22 November); a stereo sound's pan keeps each side to its own channel, as a balance, for tracks, returns and stack chains (23 November) |
| A device's Dry/Wet: all dry at 0%, all wet at 100% | The same for delay, reverb and Workbench mix parts (23 November; before, the dry was only halved at 100%) |
| Devices' delays are compensated automatically | Every device today has no delay (the reverb is zero-latency), so nothing to compensate yet; needed with plug-ins or lookahead |
| MIDI in: latency is preferred to jitter, using the driver's timestamps | The plan for MIDI in: place each event by its timestamp a buffer late, never as soon as it comes |
| Clip start and end get a declick fade of up to 4 ms | Done for Arrange's audio clips |
| Latency is set by the buffer; smaller costs CPU | The engine reports its latency; a buffer-size setting comes with recording |

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
  main?: { volume: number; fx?: Effect[]; auto?: Record<string, AutoPoint[]>; autoOff?: string[] };   // the Main track (Live's name for the master); auto "volume"
  metronome?: { volume: number };          // 0..1, the metronome's own level apart from Main (0.8 if left out)
  scenes?: string[];
}
interface Track {
  id: string; name: string; instrument: Instrument; color: TrackColour;
  volume: number; pan: number; muted: boolean; solo: boolean; armed?: boolean;
  sound?: Sound; kit?: KitSound; pads?: Record<number, DrumPad>; fx?: Effect[]; instrumentOn?: false;
  kind?: "audio" | "sampler";              // none: notes on its instrument
  frozen?: { file: string };                // frozen: this file plays in Arrange in place of its notes, clips and effects
  sampler?: SamplerSound;                   // kind "sampler": its notes play this; pads may hold one as `sample`
  sends?: Record<string, number>;           // return id -> level 0..1
  clips: ArrangeClip[];                     // Arrange, in time order, never overlapping
  slots?: (Clip | null)[];                  // Session, one per scene
  auto?: Record<string, AutoPoint[]>;       // "volume", "pan", "send:<return id>", "fx:<id>:<setting>" -> points in song beats
                                            // fx: a built-in effect's settings by their JSON names (eq low..highFreq, delay time/feedback/mix,
                                            // compressor makeup, reverb mix); a Workbench device's "<part id>.<setting>"; moved every 128 samples.
                                            // Not movable while playing: a reverb's size and damp, a compressor's threshold, ratio, attack and release.
  mods?: { kind: "lfo" | "follow"; target: string; amount: number;   // target named as auto is; amount in its units,
           rate?: number; sync?: number; shape?: "sine" | "triangle" | "square" | "saw" | "ramp"; phase?: number;  // LFO: Hz, or beats a round
           attack?: number; release?: number; on?: false }[];   // follow: seconds; moves around the automated or set value
  autoOff?: string[];                       // overridden: moving an automated control adds its name, Re-Enable Automation clears it (25.4)
}
interface AutoPoint {
  beat: number; value: number;              // volume and sends 0..1, pan -1..1; flat before the first point and after the last
  curve?: number;                           // -1..1, how the segment to the next point bends (25.5.2); 0 or absent straight
}
interface SamplerSound {                    // a sampler track's sound, or a drum pad's `sample`
  file: string;                             // relative to the song's folder
  mode?: "classic" | "oneshot"; root?: number; gainDb?: number;   // root: the MIDI note at its own pitch, 60
  start?: number; end?: number;             // the region, in seconds of the file
  loop?: boolean; loopStart?: number;       // Classic: go round while held; ADSR is the track's sound
  gate?: boolean; fadeIn?: number; fadeOut?: number;               // One-Shot
}
interface ArrangeClip {
  id: string; start: number; length: number;   // song beats
  name?: string; color?: TrackColour; muted?: boolean;
  loop?: { start: number; end: number };       // beats in the clip's own time; repeats to fill `length`
  offset?: number;                             // where in its own time the clip starts playing
  notes: SongNote[];                           // starts in the clip's own time, from 0
  envelopes?: Record<string, AutoPoint[]>;     // clip envelopes (27), in its own time, going round its loop:
                                               // "volume" 0..1 a share of the track's, "pan" -1..1 added to it,
                                               // "send:<return id>" 0..1 a share of the send; "fx:<id>:<setting>" the
                                               // setting itself while the clip plays; Session clips have them too
  unlinked?: Record<string, { start: number; end: number }>;  // envelopes with a loop of their own (27), in beats
                                               // from the clip's start, not going round the clip's loop
}
interface Return { id: string; name: string; volume: number; fx: Effect[] }
```

- In version 1, `notes` is one list per track. On load, it becomes one clip per run of notes, cut where Arrange draws
  clips today (`clipsOf`). `volumeAuto` becomes `auto.volume`.
- Session's `Clip` keeps its shape (`name`, `bars`, `notes`). Dragging a Session clip into Arrange makes an
  `ArrangeClip` with the same notes.
- Audio (phase 3): a track with `kind: "audio"` (and `input?`, the input channel it records) has clips with
  `audio?: { file; gainDb?; transpose?; offset?; warp?; mode?; bpm?; markers?: { sample, beat }[] }` in place of `notes`. `file`
  is relative to the song's folder (recordings go in `Samples/Recorded`); `offset` is seconds into the file at the
  clip's first beat. Unwarped, a clip plays at its file's own speed; warped, `markers` (or else `bpm`) pin its beats.
  `transpose` is semitones (hundredths as cents, -48 to 48, 8.4.7), heard only when warped in a mode that keeps pitch.
  The window sends the song's page with `music.load` so the engine reads the files.
- Mobius writes clips too: its guide (`docs/agent/music.md`) changes in the same pull request as the format, with one
  Launch run on the PC before it merges.

## Phases

Each phase is a run of rounds: one pull request per round, as for every app. Gaps in controls go to the library
first. Phase 1 (the engine) and phase 2 (the format and the layout) run at the same time, owned by different leads.

1. **The engine** (Builder, about 3 to 4 weeks). It plays and renders what Music plays today, then adds meters, MIDI
   in, a master track and returns. Then `studio-audio.ts` retires (done, 22 November).
2. **Foundation in the UI and format** (Apps lead, in parallel with phase 1):
   - Real clips in Arrange, shared with Session, with a migration for existing songs.
   - The master track, return tracks and sends in the file.
   - Time signature, and tempo and metre changes.
   - The layout above.
   - Arm, count-in, follow and Capture.
   - The Mixer tab.
3. **Audio** (about 3 weeks, once the engine plays):
   - Audio clips and tracks, recording from an input with monitoring.
   - The Sampler, and drum pads that hold samples (engine done; the window next).
   - Warping, with a stretcher in the engine.
   - Freeze, and exporting stems (both in the engine done, Session clips frozen too).
4. **Devices and movement** (about 3 weeks):
   - Automation for every setting, and clip envelopes (automation of the mixer and of effect settings, and clip envelopes of volume, pan and sends, in the engine done).
   - Modulators and sidechain (the compressor's sidechain, LFO, shaper and envelope follower in the engine done).
   - Stacks with macros.
   - Six more effects.
5. **Notes tools** (about 2 weeks):
   - Transform and Generate.
   - Fold to scale, chance, grooves and editing many clips at once.
   - Follow actions and launch modes. Most of this needs no engine, so it can start early.
6. **Library and polish** (about 2 weeks):
   - The rest of the Library panel (its first cut moved up to follow the layout round; see above).
   - Templates, takes and groups.
   - More synths.

## What starts now

- **Builder:** the engine skeleton. That means cpal output, a clock, and one synth voice playing a song's notes from
  `song.json`.
- **Apps lead:** follow the playhead in Arrange and count-in before recording (both UI only), then real clips in the
  song format.
- **Design lead:** done: `LevelMeter` and the armed `LetterToggle` were already in the library, `TapTempo` (#722), and warp markers on `WaveformView` (`warp`, `WarpMarker`, `warpBeatAt`).

Sources for Live's features: [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12),
[All new features in Live 12](https://ableton.com/en/live/all-new-features) and
[Live 12.4 is out now](https://www.ableton.com/blog/live-12-4-is-out-now/). For latency in the window:
[Audio latency in browser-based DAWs (W3C workshop)](https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html).

### Sources: clip loops and start markers

Read on 2026-11-22: Live 12 manual, [Clip View](https://www.ableton.com/en/live-manual/12/clip-view/) (8.2.1 Clip and
Loop Region Settings, 8.8 Playing and Scrubbing Clips, 8.9 Looping Clips) and
[Arrangement View](https://www.ableton.com/en/live-manual/12/arrangement-view/) (6.6 The Arrangement Loop, 6.7 Moving
and Resizing Clips, 6.13 Consolidating Clips).

- **Copied:** a clip plays from its start marker; with Loop on, it plays to the loop's end and goes round the loop
  ("run into a loop"), and stretching a looped clip in Arrange adds passes. Turning Loop on makes the loop what the clip
  plays now, so it sounds the same until stretched. Shortening a looped clip keeps its contents.
- **Adapted:** Mobius's notes editor shows a whole track, not one clip, so it edits each clip's first pass in place and
  draws later passes faintly; a note written in a later pass goes into the loop, so it plays on every pass.
- **Then (#758):** the Clip toolbar shows the opened Arrange clip's Loop switch, Start (its start marker), and the
  loop's start and length, in beats of its own time; Ctrl+Up and Ctrl+Down on a looped clip double and halve its loop.
- **Not yet:** the Set buttons (set from the playhead), the loop brace drawn in the notes editor, and bars.beats.16ths
  readouts. Live's Ctrl+L is the Arrangement loop, which Music already has (L).

### Sources: Main and return tracks

Read for the Main and returns round (with the Builder's engine side, #763): Live 12 manual,
[Mixing](https://www.ableton.com/en/live-manual/12/mixing/) (return tracks, sends, and the Main track; Live 12 renamed
Master to Main).

- **Copied:** return tracks named by letter (A, B…), up to 12; a Send knob per return on each track, taken after the
  fader by default; returns sum into Main, whose effects and volume come last.
- **Adapted:** sends sit as a compact row of small knobs above pan, a letter before each, so every strip's fader lines up.
- **Not yet:** pre-fader sends, a return's own sends, effects on returns and Main from the Devices view, and removing or
  renaming a return (Undo takes one back for now).
