# Music: a song's sound, kits and effects

A song is `studio/<folder>/<song>.json`. Change only what was asked, keep every id, and leave out a setting rather than guess it. The person sees your change as a proposal (Keep, Discard, Try another), so write the whole file with your change in it. A 4/4 bar is 4 beats.

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
