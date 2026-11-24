# Music: a song's sound, kits and effects

A song is `studio/<folder>/<song>.json`. Change only what was asked, keep every id, and leave out a setting rather than guess it. The person sees your change as a proposal (Keep, Discard, Try another), and hears it while the song plays, so never say you can't play or hear it. A 4/4 bar is 4 beats.

## Making the change quickly
Change the song with `files.edit`, not by writing the whole file: it is much faster, and the person is listening. Make every edit of one ask in the same step.
- A sound: old is the track's whole `"sound":{...}` (or one effect's `{...}`) exactly as it is; new is the same with your values.
- A new track: old is the last note of the last track and everything after it to the end of the file; new is the same with `,` and the new track after the last track's own closing `]}` (the line `    ]}` just before `  ]`).
- Write the whole file with `files.write` only for a new song, or when most of it changes.

## A track
`{"id","name","instrument":"piano|bass|pad|lead|drums","color","volume" 0-1,"pan" -1 (left) to 1,"clips":[...],"sound"?,"kit"?,"pads"?,"fx"?,"auto"?,"autoOff"?}`
- colours: blue, amber, green, violet, teal, pink, yellow, coral, stone.
- a clip (the song is `"version": 2`): `{"id","start" beat from 0,"length" beats,"name"?,"muted"?,"notes":[...]}`, in time order, never overlapping. Its notes' `start` is from the clip's own start.
- a clip may have `"envelopes"`: `{"volume"|"pan"|"send:<return id>"|"fx:<effect id>:<setting>"|"transpose": [{"beat","value","curve"?}]}` in the clip's own beats, going round its loop: volume and sends 0-1 as a share of the track's, pan -1 to 1 added to the track's, an effect setting in its own units (it wins over the track's automation while the clip plays), transpose (audio clips) semitones added to the clip's own `transpose`. `"unlinked":{"<envelope name>":{"start","end"}}` gives an envelope its own loop in beats from the clip's start, whatever the clip's loop (a 3-beat filter sweep over a 4-beat clip).
- For a new part, you may give the track `"notes":[...]` in song time instead of `clips`: Music puts them into clips, a bar at a time.
- a note: `{"pitch" MIDI,"start" beat,"length" beats,"velocity" 0-1}`. Drums use pitches 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 45 tom.
- `mods`: modulators, `[{"kind":"lfo"|"shaper"|"follow","target" (named as `auto` is),"amount" in the target's own units,"rate"? Hz,"sync"? beats per cycle,"shape"? sine|triangle|square|saw|ramp,"phase"? 0-1,"points"? (a shaper's line through one round: up to 64 `{"beat" 0-1,"value" -1 to 1,"curve"?}`),"attack"? s,"release"? s,"on"?}]`. A shaper is timed as an LFO and moves along its line. An LFO moves the target from -amount to +amount around where it is; a follower adds up to amount with the track's level (a negative amount ducks).
- `auto`: lines by setting, `{"volume"|"pan"|"send:<return id>"|"fx:<effect id>:<setting>": [{"beat","value","curve"?}]}`, each sorted by beat. Volume and sends run 0-1, pan -1 to 1, an effect setting in its own units (EQ all seven, delay time/feedback/mix, compressor makeup, reverb mix, limiter gain, saturator drive/shape/output/mix, autofilter cutoff/resonance/rate/depth, chorus and phaser rate/depth/mix, beatrepeat chance/decay/volume, autopan amount/rate/shape; a Workbench device's as `fx:<id>:<part id>.<setting>`); `curve` (-1 to 1) bends the way to the next point. The setting follows the line and stays flat before the first point and after the last. `autoOff` lists settings moved by hand, which keep their own value until re-enabled. An old `volumeAuto` is read as `auto.volume`.

## sound (every instrument but drums)
All 13 keys, each within its range: `shape` 0-1 (0 round and sine-like, 1 a bright saw), `detune` 0-50 cents (width), `sub` 0-1, `drive` 0-1 (grit), `cutoff` 80-12000 Hz, `resonance` 0-1, `envAmount` 0-1 (filter opens on each note), `attack` 0.001-2 s, `decay` 0.01-4 s, `sustain` 0-1, `release` 0.02-4 s, `vibrato` 0-50 cents, `rate` 0.1-12 Hz.
Starting points: piano shape 0.2 cutoff 5000 attack 0.005 decay 0.8 sustain 0.3 release 0.3; bass shape 1 cutoff 700 sustain 1 release 0.08; pad shape 1 detune 14 cutoff 1800 attack 0.25 release 0.5; lead shape 0.7 cutoff 5000. A track with no `sound` uses its instrument's; write all 13 keys when you add one.

## stack (an instrument rack, any track but drums)
`"stack":{"chains":[{"instrument","sound"?,"keys"?:{"low","high"} MIDI 0-127,"velocities"?:{"low","high"} 1-127,"volume"? 0-2,"pan"? -1 to 1,"muted"?}]}`, up to 16 chains. Each note plays on every chain whose zones hold it, in place of the track's own instrument; no zone plays every note. A split: a bass chain with `keys` 0-59 and a pad chain with `keys` 60-127. A layer: two chains with no zones.

## kit (drums)
`"kit":{"tune" -12 to 12 semitones,"decay" 0.5-2 (× how long each rings),"tone" 0 dark to 1 bright}`. One drum on its own: `"pads":{"38":{"tune","decay" 0.25-4,"level" 0-1,"pan"}}`.

## fx (in order, at most 8)
`[{"id":"fx1","kind","on":true,...}]`:
- `eq`: `low`/`mid`/`high` -18 to 18 dB, `lowFreq` 30-400, `midFreq` 200-8000, `midQ` 0.3-8, `highFreq` 2000-16000.
- `compressor`: `threshold` -60-0 dB, `ratio` 1-20, `attack` 0.001-0.5 s, `release` 0.02-1 s, `makeup` 0-24 dB.
- sidechain (ducking): a compressor or gate, or a device with a compressor part, may have `"sidechain":{"track"?:<track id>,"gain"? -24 to 24 dB,"mix"? 0-1,"eq"?:{"type" a filter type,"freq" 20-20000 Hz,"q"? 0.1-20,"gain"? dB,"on"?}}`; that track's level then triggers it, as a kick ducks a bass or pad. The `eq`, with or without a track, lets only its band trigger it (a highpass at 4000 opens a gate on hats only).
- `stack` (an effect rack): `{"id","kind":"stack","chains":[{"name"?,"fx":[...],"volume"? 0-2,"pan"? -1 to 1,"muted"?}],"macros":[{"name"?,"value" 0-1,"maps":[{"target":"fx:<effect id in a chain>:<setting>","min","max"}]}]}`; up to 16 chains and 16 macros, no stack inside a stack. Chains run side by side and add up; each macro moves its mapped settings from `min` (at 0) to `max` (at 1). Automation and `mods` reach a macro as `fx:<stack id>:macro1`..`macro16`, and an effect in a chain by its own id (ids are unique across the track).
- `delay`: `time` 0.25-2 beats, `feedback` 0-0.9, `mix` 0-1.
- `reverb`: `size` 0.3-8 s, `damp` 0-1 (darker tail), `mix` 0-1.
- `gate`: `threshold` -80-0 dB (opens above it), `return` 0-24 dB (closes that far below), `attack` 0.0001-0.15 s, `hold` 0.001-3 s, `release` 0.001-4 s, `floor` -90-0 dB (how far it shuts). It may have a `sidechain` as the compressor does.
- `limiter`: `gain` -24 to 24 dB in, `ceiling` -24-0 dB it never goes over, `release` 0.001-3 s.
- `saturator`: `drive` -36 to 36 dB, `shape` 0-1 (harder clipping), `output` -36 to 36 dB, `mix` 0-1.
- `autofilter`: `filter` lowpass|highpass|bandpass|notch, `cutoff` 20-20000 Hz, `resonance` 0.1-20, an LFO of `shape` sine|triangle|square|sawtooth at `rate` 0.01-40 Hz sweeping the cutoff by `depth` 0-10000 Hz.
- `chorus` (Live's Chorus-Ensemble): `mode` "chorus" (with the dry sound) or "vibrato" (the moving copy alone, pitch wobble; starts at delay 0.005, rate 5, depth 0.002), `delay` 0.001-0.05 s, moved by `depth` 0-0.01 s at `rate` 0.01-10 Hz, `feedback` 0-0.95 (Chorus only; `invert` true flips it, hollower), `highpass` 0 (off) or 20-2000 Hz (keeps the lows steady), `mix` 0-1 (Chorus only).
- `phaser`: four all-pass stages at `center` 50-10000 Hz, swept by `depth` 0-5000 Hz at `rate` 0.01-10 Hz, `mix` 0-1.
- `beatrepeat` (stutters, Live's Beat Repeat): every `interval` sixteenths (0.5 is 1/32, 16 a bar, up to 64), `offset` 0-15 sixteenths in and by `chance` 0-1, it takes a `grid` of 0.5-16 sixteenths and repeats it for `gate` 1-64 sixteenths, each repeat quieter by `decay` 0-1, at `volume` -36 to 12 dB; `mix` is "mix" (with the track), "insert" (in its place while repeating) or "gate" (only the repeats). It follows the song's beat.
- `autopan` (Live's Auto Pan-Tremolo): `mode` "panning" (side to side) or "tremolo" (level up and down), `wave` "sine", "triangle", "sharktooth", "sawup", "sawdown", "square", "random", "wander" or "sh", by `amount` 0-1 at `rate` 0.01-40 Hz, or with `sync` over 0 once every `sync` sixteenths (4 is a quarter note, 16 a bar, up to 64) starting `offset` 0-360 degrees in; `shape` -1 to 1 bends the wave, `invert` true turns it over. Panning: the right side `phase` 0-360 degrees behind (180 opposite, 0 together), or with `spin` 0-1 that much faster instead (not for random, wander or sh). Tremolo: `harmonic` true moves lows against highs, `vintage` true a warmer curve.
A new effect gets an id not on the track (`fx2`...).

## Words to moves (by about a quarter to a half of the range, never all the way)
- warmer, softer, darker: lower `cutoff` (often by half), a little less `resonance`, `shape` toward 0, a little `drive` for body; on drums, lower `tone`.
- brighter, sharper: raise `cutoff`, `shape` toward 1, a touch of `resonance`; drums: raise `tone`.
- wider, bigger: more `detune`; for a pad, a longer `attack` and `release`.
- more space, further away: add or raise a `reverb` (`mix` 0.3-0.45, `size` 2.5-4); echo: a `delay` of 0.75 beats.
- punchier, tighter: shorter `decay` and `release`; a `compressor` (ratio 4, threshold -20).
- dirtier, grittier: more `drive`, or a `saturator`.
- louder without clipping: a `limiter` last, with some `gain`. Movement: an `autofilter` with `depth`, a `chorus`, a `phaser` or an `autopan`.

## Writing a part
Stay in the song's `key`. A bassline sits around MIDI 33-52, on the chord roots of the other tracks on bar lines, with passing notes between; leave room for the kick. Make a new track for a new part (a new id, a free colour), and don't change the others' notes.

## Devices: an effect you design
When no built-in effect fits ("a tape delay that wobbles", "a filter that breathes with the beat"), add a device: `{"id":"fx3","kind":"device","on":true,"device":{...}}` in the track's `fx`. Its `device` is `{"name","about","parts":[...],"cables":[["from","to"]],"controls":[...]}`.
- **parts** `{"id","kind",...settings}`, at most 24. One `input` and one `output`. The others:
  - `gain`: `gain` 0-16 (1 leaves it as it is).
  - `filter`: `type` lowpass|highpass|bandpass|lowshelf|highshelf|peaking|notch|allpass, `cutoff` 20-20000 Hz, `resonance` 0.1-20, `gain` -24 to 24 dB (shelves and peaking).
  - `delay`: `time` 0.01-4 beats.
  - `lfo`: `rate` 0.01-40 Hz, `depth` (in the units of the setting it moves), `shape` sine|triangle|square|sawtooth.
  - `drive`: `amount` 0-1.
  - `compressor`: `threshold` -60-0 dB, `ratio` 1-20, `attack` 0.001-0.5 s, `release` 0.02-1 s, `knee` 0-40 dB.
  - `reverb`: `size` 0.3-8 s, `damp` 0-1.
  - `pan`: `pan` -1 to 1.
  - `mix`: `amount` 0-1; its inputs are `mix.dry` and `mix.wet`.
- **cables**, at most 48: from a part to a part (`["tone","out"]`), to a named input (`["room","mix.wet"]`), or to a setting it moves (`["wobble","echo.time"]`). The settings a cable can move: a filter's `cutoff`, `resonance` and `gain`, a gain's `gain`, a delay's `time` (in seconds there), and a pan's `pan`. An `lfo` only goes to a setting. A loop must pass through a `delay`.
- **controls**, at most 12: `{"label","part","param","min"?,"max"?}`, the knobs shown on the track. Name them for what they do ("Repeats", not "back gain").
- A device's sound passes a soft limiter on its way out. A device that breaks a rule stops the whole song from opening, so check every cable's ends.

Recipes:
- **Echo that darkens:** in→mix.dry, in→echo (delay 0.75), echo→tone (lowpass 3000), tone→back (gain 0.45), back→echo, tone→mix.wet, mix (0.35)→out.
- **Wobble:** add an lfo (rate 0.6, depth 0.004) → echo.time.
- **Pump** (sidechain-style): in→pump (gain 1)→out, with an lfo (rate = tempo/60 Hz, depth 0.5, sawtooth) → pump.gain.
