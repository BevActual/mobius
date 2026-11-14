# Music roadmap

Where the Music app is going: its instruments, effects, note tools and studio features. Full desktop studios set the
bar for how much a song app can do. Music aims for that range in Mobius's own way, with its own designs and names, and
without copying any product's devices, names, layouts or look.

What makes it Mobius's own:

- **A song is notes in a JSON file.** Mobius reads and writes every part of a song, including each track's sound,
  effects and settings, so anything here is something you can ask Mobius to do, and review before you keep it.
- **Sound is made in the window** with Web Audio. Nothing is sent away to be played.
- **Every control comes from the shared component library** (`apps/desktop/src/ui/`). When Music needs a control the
  library lacks, the library gets it first, so every app benefits. Music is where the library is proven.

Status: **Have** (on main), **Building** (in a pull request), **Next**, **Later**, and **Not for Mobius**, with a
reason.

## How it works: habits from desktop studios

People who make music already know how a studio app behaves. Music takes on those habits, so the hands of someone who
knows Ableton Live already know what to do. It keeps Mobius's own look, controls and names. These are ways of working,
not designs to copy.

| Habit | In Music | Status |
| --- | --- | --- |
| Two views of a song | **Session** is a grid of clips, a column per track and a row per scene, for trying parts against each other live: a clip loops from the next bar when launched, and a scene launches its whole row. **Arrange** is the song from start to end. The switch is in the toolbar. | Building |
| One detail area for the chosen track | The bottom area shows the chosen track: its notes, or its devices in a row in signal order (instrument first, then effects). Shift+Tab switches between them, and double-clicking a track or clip opens it. | Building |
| The computer keyboard is an instrument | A S D F… play the white keys and W E T Y… the black ones. Z and X move an octave, and C and V change velocity. You hear the chosen track's own sound. | Building |
| Record what you play | Record writes what you play into the chosen track at the playhead, as notes, with count-in and the metronome. | Later, after the keyboard |
| Draw mode | B turns on drawing: drag along a row to write a note in each grid step, or start on a note to take notes out. Each stroke is one Undo. | Building |
| Devices fold and switch off | Each device folds to its title bar with the arrow in its head, and has its own on switch. | Have |
| Edit keys everyone knows | Ctrl+D duplicates, Ctrl+E splits at the playhead, Ctrl+J joins clips, Ctrl+L loops the selection, and 0 switches a note or clip off without deleting it. Delete removes, and every step undoes. | Next (Ctrl+D, Delete and undo Have) |
| Drag sounds in | Drag a sound from the sidebar onto empty space for a new track, or onto a track to swap its instrument and keep the notes. Clicking a sound plays a short preview. | Next |
| Track header controls | Every track header has a number, a name, on, solo, and (with recording) arm. Track rows fold and resize. | Partly (number, name, mute, solo Have) |
| Follow | The view keeps the playhead in sight while playing, and scrolling by hand stops following until Play is pressed again. | Next |
| Info on hover | A line at the foot names what the pointer is over and its key, so the app teaches itself. It's the key-hint bar every app shares. | Next (shell) |
| Tap tempo and nudge | Tap the tempo field in time to set it, and drag or arrow it like any number. | Next (library NumberField Have) |
| Everything is a value Mobius can set | Every knob, switch and note is in the song file, so asking Mobius for "a darker pad" or "double-time hats" changes the same settings you would, dashed until you keep it. | Have, kept with each change |

## Instruments

| Instrument | What it is | Status |
| --- | --- | --- |
| Drums | A kit of synthesised drums, with Tune, Decay and Tone for the whole kit. | Have |
| Bass, Piano, Pad, Lead | One synth voice with four starting points: Oscillator (Shape, Detune, Sub, Drive), Filter (Cutoff, Resonance, Sweep), Envelope (ADSR) and Motion (Vibrato, Rate). | Have |
| Drum pads | A pad for each drum, each with its own pitch, decay, level and pan, played or stepped in a step grid. | Building |
| Morph synth | A synth that blends between waves with an XY pad, for sounds that move. | Next |
| Sampler | Plays your own audio files from your workspace across the keys, with start, loop and envelope. One-shot mode for drum hits. | Next |
| Two-operator synth | One wave bending another's pitch, for bells, keys and metallic basses. | Later |
| Grain cloud | Slices a sample into tiny grains and scatters them, for textures and pads. | Later |
| Modelled instruments | Struck bars, plucked strings, tines and drum skins made by modelling, not samples. | Later |
| Stacks | Several instruments on one track, split by key or layered, with a few big controls that move many settings. | Later |
| Hardware synths and plug-ins | Sending notes to outside instruments, and hosting VST or AU plug-ins. | Not for Mobius: Music runs in the window and stays self-contained. |

## Effects on a track

Each track has a chain of effects after its instrument. Each one can be switched off, moved up or down and removed,
and Mobius can set them like anything else in the song (`fx`).

| Effect | What it does | Status |
| --- | --- | --- |
| EQ | Low, Mid (with its frequency) and High. | Have |
| Compressor | Threshold, Ratio, Attack, Release and Makeup. | Have |
| Delay | Echoes in step with the tempo, with Feedback and Mix. | Have |
| Reverb | A room from short to long, with Damp and Mix. | Have |
| Drawn EQ | Bands you drag on a curve: frequency, level and width. | Have |
| Saturation and lo-fi | Warmth, clipping, fewer bits and a lower sample rate. | Next |
| Moving filter | A filter that sweeps with the tempo or follows the level. | Next |
| Chorus, phaser and flanger | Thickening and swirling. | Next |
| Auto pan and tremolo | Movement across the stereo field and in level. | Later |
| Gate, limiter and multiband | Tighter control of level. | Later |
| Pitch and frequency shift | Moving a sound up or down without changing time. | Later |
| Beat repeat | Catching and repeating slices of a part in time. | Later |
| Vocoder | One sound speaking through another. | Later |
| Level tools | Gain, width, mono and a phase flip, with a meter. | Later |

## Note tools

Tools that change notes before they reach the instrument, or write them for you. Each one can also be applied to the
notes for good, so the file always shows what you hear.

| Tool | What it does | Status |
| --- | --- | --- |
| Snap and quantize | Notes to the grid, by any amount. | Have |
| Velocity lane | One bar per note for loudness. | Have |
| Keep to key | Moves stray notes into the song's key. | Next |
| Chords | Plays a chord from each note, by degree in the key. | Next |
| Arpeggio | Plays held chords as patterns in time. | Next |
| Step sequencer | Sixteen steps a bar: a row per drum, or a row per note of the key for any other instrument, with an octave and a step length. | Building |
| Strum and humanise | Small timing and loudness changes so parts feel played. | Later |
| Chance | Each note plays some of the time, for variation. | Later |
| Echo notes | Repeats each note, softer, in time. | Later |
| Rhythm makers | Spreads a number of hits evenly across a bar, for patterns. | Later |

## Movement over time

| Feature | What it does | Status |
| --- | --- | --- |
| Envelope and sweep | Each note's own shape and filter sweep. | Have |
| Vibrato | A wobble in pitch at a set rate. | Have |
| Automation lanes | Draw how any setting changes along the song. | Next |
| Wobblers | A slow wave that moves any setting, in time or free. | Later |
| Follow | One track's level moving another's setting (ducking). | Later |

## Writing and arranging

| Feature | What it does | Status |
| --- | --- | --- |
| Tracks and clips | Tracks of notes, clips drawn from where notes sit, zoom. | Have |
| Notes editor | Draw, move, stretch, box-select, copy, duplicate, paste. | Have |
| Loop and metronome | Loop some bars or the song; a click in time. | Have |
| Keys and scales | The song's key, with notes outside it shown. | Have |
| Undo everything | Every edit can be taken back. | Have |
| Mobius's parts | Parts Mobius writes are dashed until you keep them. | Have |
| Sections | Named parts of the song (verse, chorus) to move and repeat. | Next |
| Time signature and tempo changes | Changes partway through a song. | Next |
| Scenes | Short loops for each track that you start and stop live, to try ideas before arranging (the Session view). | Building |
| Session to song | Recording what you launch in Session into the Arrange view, and dragging clips between the two. | Next |
| Groups | Tracks folded into a group with one level. | Later |
| Edit many tracks | Editing notes on several tracks at once. | Later |
| Swing | A feel applied to any part. | Later |
| Other tunings | Scales beyond twelve equal notes. | Later |

## Mixing

| Feature | What it does | Status |
| --- | --- | --- |
| Volume, pan, mute and solo | Per track. | Have |
| Level meters | Per track and for the song. | Next (library `LevelMeter`) |
| Shared effects | One reverb or delay that many tracks send to. | Next |
| Mixer view | Every track's level, pan and sends side by side. | Later |
| Freeze | Turning a track to audio so it costs nothing to play. | Later |

## Recording and audio

| Feature | What it does | Status |
| --- | --- | --- |
| Play notes from a keyboard | The computer keys now; a MIDI keyboard next. | Building |
| Record notes | Recording what you play into a clip. | Next |
| Export | The song as an audio file in your workspace. | Next |
| Catch what you played | Getting back notes you played while not recording. | Later |
| Audio tracks | Recording and placing audio, stretched to the tempo. | Later |
| Takes | Several recordings of a part, choosing the best bits. | Later |
| Audio to notes | Turning a recorded melody, chords or beat into notes. | Later |
| Slices | Cutting a loop into slices played from notes. | Later |
| Sync with others | Tempo shared with apps and devices on the network. | Not for Mobius yet: needs a native audio engine. |
| Control voltage | Driving modular hardware. | Not for Mobius: hardware studio feature. |

## Working with Mobius

| Feature | What it does | Status |
| --- | --- | --- |
| Ask for a part | Mobius writes notes for a track; Keep, Discard or Try another. | Have |
| Ask for a sound | Mobius sets a track's sound, kit and effects from words like "warmer" or "more space". | Next |
| Explain a song | Mobius says what a song does: key, chords, sections. | Next |
| Sound library | Saved sounds and effects with tags, found by words or by being like another sound. | Later |
| Map controls | Moving any setting with a hardware knob. | Later |
| Screen readers | Every control named and reachable from the keyboard. | Have, kept with each change |
