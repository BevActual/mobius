# Music: a song's sound, kits and effects

A song is `studio/<folder>/<song>.json`. Change only what was asked, keep every id, and leave out a setting rather than guess it. The person sees your change as a proposal (Keep, Discard, Try another), and hears it while the song plays, so never say you can't play or hear it. A 4/4 bar is 4 beats.

## Making the change quickly
Change the song with `files.edit`, not by writing the whole file: it is much faster, and the person is listening. Make every edit of one ask in the same step.
- A sound: old is the track's whole `"sound":{...}` (or one effect's `{...}`) exactly as it is; new is the same with your values.
- A new track: old is the last note of the last track and everything after it to the end of the file; new is the same with `,` and the new track after the last track's `]}`.
- Write the whole file with `files.write` only for a new song, or when most of it changes.

## A track
`{"id","name","instrument":"piano|bass|pad|lead|drums","color","volume" 0-1,"pan" -1 (left) to 1,"notes":[...],"sound"?,"kit"?,"pads"?,"fx"?,"volumeAuto"?}`
- colours: blue, amber, green, violet, teal, pink, yellow, coral, stone.
- a note: `{"pitch" MIDI,"start" beat from 0,"length" beats,"velocity" 0-1}`. Drums use pitches 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 45 tom.
- `volumeAuto`: `[{"beat","value" 0-1}]`, sorted by beat; the volume follows the line.

## sound (every instrument but drums)
All 13 keys, each within its range: `shape` 0-1 (0 round and sine-like, 1 a bright saw), `detune` 0-50 cents (width), `sub` 0-1, `drive` 0-1 (grit), `cutoff` 80-12000 Hz, `resonance` 0-1, `envAmount` 0-1 (filter opens on each note), `attack` 0.001-2 s, `decay` 0.01-4 s, `sustain` 0-1, `release` 0.02-4 s, `vibrato` 0-50 cents, `rate` 0.1-12 Hz.
Starting points: piano shape 0.2 cutoff 5000 attack 0.005 decay 0.8 sustain 0.3 release 0.3; bass shape 1 cutoff 700 sustain 1 release 0.08; pad shape 1 detune 14 cutoff 1800 attack 0.25 release 0.5; lead shape 0.7 cutoff 5000. A track with no `sound` uses its instrument's; write all 13 keys when you add one.

## kit (drums)
`"kit":{"tune" -12 to 12 semitones,"decay" 0.5-2 (× how long each rings),"tone" 0 dark to 1 bright}`. One drum on its own: `"pads":{"38":{"tune","decay" 0.25-4,"level" 0-1,"pan"}}`.

## fx (in order, at most 8)
`[{"id":"fx1","kind","on":true,...}]`:
- `eq`: `low`/`mid`/`high` -18 to 18 dB, `lowFreq` 30-400, `midFreq` 200-8000, `midQ` 0.3-8, `highFreq` 2000-16000.
- `compressor`: `threshold` -60-0 dB, `ratio` 1-20, `attack` 0.001-0.5 s, `release` 0.02-1 s, `makeup` 0-24 dB.
- `delay`: `time` 0.25-2 beats, `feedback` 0-0.9, `mix` 0-1.
- `reverb`: `size` 0.3-8 s, `damp` 0-1 (darker tail), `mix` 0-1.
A new effect gets an id not on the track (`fx2`...).

## Words to moves (by about a quarter to a half of the range, never all the way)
- warmer, softer, darker: lower `cutoff` (often by half), a little less `resonance`, `shape` toward 0, a little `drive` for body; on drums, lower `tone`.
- brighter, sharper: raise `cutoff`, `shape` toward 1, a touch of `resonance`; drums: raise `tone`.
- wider, bigger: more `detune`; for a pad, a longer `attack` and `release`.
- more space, further away: add or raise a `reverb` (`mix` 0.3-0.45, `size` 2.5-4); echo: a `delay` of 0.75 beats.
- punchier, tighter: shorter `decay` and `release`; a `compressor` (ratio 4, threshold -20).
- dirtier, grittier: more `drive`.

## Writing a part
Stay in the song's `key`. A bassline sits around MIDI 33-52, on the chord roots of the other tracks on bar lines, with passing notes between; leave room for the kick. Make a new track for a new part (a new id, a free colour), and don't change the others' notes.

## Devices: an effect you design
When no built-in effect fits ("a tape delay that wobbles", "a filter that breathes with the beat"), add a device: `{"id":"fx3","kind":"device","on":true,"device":{...}}` in the track's `fx`. Its `device` is `{"name","about","parts":[...],"cables":[["from","to"]],"controls":[...]}`.
- **parts** `{"id","kind",...settings}`, at most 24. One `input` and one `output`. The others:
  - `gain`: `gain` 0-16 (1 leaves it as it is).
  - `filter`: `type` lowpass|highpass|bandpass|lowshelf|highshelf|peaking|notch, `cutoff` 20-20000 Hz, `resonance` 0.1-20, `gain` -24 to 24 dB (shelves and peaking).
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
