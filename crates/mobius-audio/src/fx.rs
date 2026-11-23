//! A track's effects, as studio-audio.ts `effectChain` and `deviceGraph` play them. Every effect is a device: parts
//! (gain, filter, delay, LFO, drive, compressor, reverb, pan, mix) joined by cables, where a cable into a setting adds
//! what comes down it to that setting. The four built-in effects are the devices song-format.ts `builtinDevice` makes.
//!
//! A device runs in pieces of at most 128 samples, the way Web Audio renders. A loop of cables passes through a delay,
//! and that delay's sound out is read before the piece is made (so it holds back at least 128 samples, as Web Audio
//! makes a delay in a loop do). Everything is made when the chain is made; `process` allocates nothing.

use crate::conv::Convolver;
use crate::voice::shape;
use serde_json::Value;
use std::f64::consts::{PI, TAU};

/// The most samples worked out at once.
pub const QUANTUM: usize = 128;
/// The longest a delay holds sound back, in seconds (as `createDelay(4)`).
const MAX_DELAY: f64 = 4.0;
/// A device's sound passes this ceiling on its way out (studio-audio.ts `softLimit`): unchanged up to 0.8, then
/// bending toward 0.95. Louder than 1 takes the curve's end, as a wave shaper does.
fn soft_limit(v: f64) -> f64 {
    let x = v.clamp(-1.0, 1.0);
    let a = x.abs();
    let y = if a <= 0.8 { a } else { 0.8 + 0.2 * ((a - 0.8) / 0.2).tanh() };
    y.copysign(x)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum FilterType {
    LowPass,
    HighPass,
    BandPass,
    LowShelf,
    HighShelf,
    Peaking,
    Notch,
    AllPass,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Wave {
    Sine,
    Triangle,
    Square,
    Saw,
}

/// A biquad's coefficients, divided through by a0: b0, b1, b2, a1, a2.
type Coefficients = [f64; 5];

/// The Web Audio `BiquadFilterNode`'s coefficients (the Audio EQ Cookbook, Q in dB for low- and high-pass).
fn biquad(kind: FilterType, freq: f64, q: f64, gain_db: f64, rate: f64) -> Coefficients {
    let w0 = TAU * (freq / rate).clamp(1e-5, 0.4999);
    let (sin, cos) = w0.sin_cos();
    let a = 10f64.powf(gain_db / 40.0);
    let q = q.max(1e-4);
    let (b0, b1, b2, a0, a1, a2) = match kind {
        FilterType::LowPass | FilterType::HighPass => {
            let alpha = sin / (2.0 * 10f64.powf(q.min(770.0) / 20.0));
            let s = if kind == FilterType::LowPass { 1.0 - cos } else { 1.0 + cos };
            let b1 = if kind == FilterType::LowPass { s } else { -s };
            (s / 2.0, b1, s / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        FilterType::BandPass => {
            let alpha = sin / (2.0 * q);
            (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        FilterType::Notch => {
            let alpha = sin / (2.0 * q);
            (1.0, -2.0 * cos, 1.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        FilterType::AllPass => {
            let alpha = sin / (2.0 * q);
            (1.0 - alpha, -2.0 * cos, 1.0 + alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        FilterType::Peaking => {
            let alpha = sin / (2.0 * q);
            (1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a)
        }
        FilterType::LowShelf | FilterType::HighShelf => {
            let alpha = sin / 2.0 * 2f64.sqrt();
            let k = 2.0 * a.sqrt() * alpha;
            if kind == FilterType::LowShelf {
                (a * ((a + 1.0) - (a - 1.0) * cos + k), 2.0 * a * ((a - 1.0) - (a + 1.0) * cos), a * ((a + 1.0) - (a - 1.0) * cos - k), (a + 1.0) + (a - 1.0) * cos + k, -2.0 * ((a - 1.0) + (a + 1.0) * cos), (a + 1.0) + (a - 1.0) * cos - k)
            } else {
                (a * ((a + 1.0) + (a - 1.0) * cos + k), -2.0 * a * ((a - 1.0) + (a + 1.0) * cos), a * ((a + 1.0) + (a - 1.0) * cos - k), (a + 1.0) - (a - 1.0) * cos + k, 2.0 * ((a - 1.0) - (a + 1.0) * cos), (a + 1.0) - (a - 1.0) * cos - k)
            }
        }
    };
    [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

/// The left and right gains of a `StereoPannerNode` at `x` (0 to 1).
fn sides(x: f64) -> (f64, f64) {
    ((x * PI / 2.0).cos(), (x * PI / 2.0).sin())
}

/// A `StereoPannerNode`: a mono input (`stereo` false) is placed by equal power; a stereo one has the far side moved over.
#[must_use]
pub fn pan(l: f64, r: f64, pan: f64, stereo: bool) -> (f64, f64) {
    let pan = pan.clamp(-1.0, 1.0);
    if !stereo {
        let (gl, gr) = sides((pan + 1.0) / 2.0);
        return (l * gl, l * gr);
    }
    if pan <= 0.0 {
        let (gl, gr) = sides(pan + 1.0);
        (l + r * gl, r * gr)
    } else {
        let (gl, gr) = sides(pan);
        (l * gl, r + l * gr)
    }
}

/// A track's pan, as Live's: each side keeps its own channel, by the constant-power law of [`crate::voice::pan_gains`]
/// (0 dB in the middle, +3 dB hard over), so a stereo sound panned hard is its near channel alone, not both folded in.
#[must_use]
pub fn balance(l: f64, r: f64, pan: f64) -> (f64, f64) {
    let (gl, gr) = crate::voice::pan_gains(pan);
    (l * gl, r * gr)
}

/// The window's reverb room: decaying noise, its highs softened more as it goes on (studio-audio.ts `impulse`).
fn room(rate: f64, size: f64, damp: f64, seed: &mut u32) -> [Vec<f32>; 2] {
    let length = ((rate * size).round() as usize).max(1);
    let mut channel = || {
        let mut low = 0.0f64;
        (0..length)
            .map(|i| {
                let fade = (1.0 - i as f64 / length as f64).powi(3);
                *seed ^= *seed << 13;
                *seed ^= *seed >> 17;
                *seed ^= *seed << 5;
                let white = f64::from(*seed) / f64::from(u32::MAX) * 2.0 - 1.0;
                let k = 1.0 - damp * (i as f64 / length as f64 + 0.2).min(0.95);
                low += k * (white - low);
                (low * fade) as f32
            })
            .collect::<Vec<f32>>()
    };
    let mut both = [channel(), channel()];
    // A convolver turns its response to a set loudness (Web Audio's `normalize`, as browsers work it out).
    let energy: f64 = both.iter().flatten().map(|x| f64::from(*x).powi(2)).sum();
    let power = (energy / (2.0 * length as f64)).sqrt();
    let power = if power.is_finite() && power >= 0.000_125 { power } else { 0.000_125 };
    let scale = (1.0 / power * 10f64.powf(-58.0 * 0.05) * 44_100.0 / rate) as f32;
    for x in both.iter_mut().flatten() {
        *x *= scale;
    }
    both
}

/// What a compressor or gate listens to (Live 12 manual, 29.9.1): its own sound, or another track's (raised by a gain,
/// in a share `mix` of the two), through the sidechain EQ when it has one so that only that band triggers it.
#[derive(Default)]
struct Trigger {
    side: Option<(f64, f64)>,
    eq: Option<(Coefficients, [f64; 2])>,
}

impl Trigger {
    /// The level it hears for a sample of its own sound and of the keying track's (as the louder side, with its sign).
    fn level(&mut self, l: f32, r: f32, key: f32) -> f64 {
        let own = f64::from(if l.abs() >= r.abs() { l } else { r });
        let Some((c, z)) = &mut self.eq else {
            return match self.side {
                Some((gain, mix)) => (1.0 - mix) * own.abs() + mix * gain * f64::from(key).abs(),
                None => own.abs(),
            };
        };
        let x = match self.side {
            Some((gain, mix)) => (1.0 - mix) * own + mix * gain * f64::from(key),
            None => own,
        };
        // Transposed direct form II; a tail far below hearing is let go, as a filter's is.
        let y = c[0] * x + z[0];
        z[0] = c[1] * x - c[3] * y + z[1];
        z[1] = c[2] * x - c[4] * y;
        if z[0].abs() < 1e-20 && z[1].abs() < 1e-20 {
            *z = [0.0; 2];
        }
        y.abs()
    }
}

/// A compressor as browsers make Web Audio's `DynamicsCompressorNode` (Chromium's kernel, which Firefox shares): a
/// static curve with a soft knee; a detector that follows the attenuation; a gain that slews down for attack at a
/// rate set by the deepest cut asked for, and back up for release along an adaptive curve (faster from deeper cuts),
/// updated every 32 samples; a 6 ms look-ahead; and the whole lifted by 0.6 of the gain it takes at full level.
struct Compressor {
    /// What triggers it.
    trigger: Trigger,
    threshold: f64,
    knee_db: f64,
    slope: f64,
    k: f64,
    knee_linear: f64,
    knee_out_db: f64,
    makeup: f64,
    attack_frames: f64,
    release: [f64; 5],
    sat_release_frames: f64,
    detector: f64,
    gain: f64,
    max_attack_diff_db: f64,
    envelope_rate: f64,
    scaled_desired: f64,
    /// Samples into the current 32-sample division.
    division: usize,
    ahead: Vec<(f32, f32)>,
    at: usize,
}

fn db(x: f64) -> f64 {
    20.0 * x.max(1e-12).log10()
}

fn linear(d: f64) -> f64 {
    10f64.powf(d / 20.0)
}

/// Samples between updates of the compressor's gain movement.
const DIVISION: usize = 32;

impl Compressor {
    fn new(threshold_db: f64, knee: f64, ratio: f64, attack: f64, release: f64, rate: f64) -> Compressor {
        let threshold = linear(threshold_db);
        let slope = 1.0 / ratio.max(1.0);
        let knee_curve = |x: f64, k: f64| if x < threshold { x } else { threshold + (1.0 - (-k * (x - threshold)).exp()) / k };
        // The knee's sharpness: the one whose slope (in dB) at the knee's top is 1 / ratio.
        let top = linear(threshold_db + knee);
        let slope_at = |k: f64| {
            let (x, x2) = (top, top * 1.001);
            (db(knee_curve(x2, k)) - db(knee_curve(x, k))) / (db(x2) - db(x))
        };
        let (mut lo, mut hi, mut k) = (0.1f64, 10_000.0f64, 5.0f64);
        for _ in 0..15 {
            if slope_at(k) < slope {
                hi = k;
            } else {
                lo = k;
            }
            k = (lo * hi).sqrt();
        }
        // The release curve through four points (release times 0.09, 0.16, 0.42 and 0.98 of `release`), as a quartic.
        let frames = release.max(0.0) * rate;
        let [y1, y2, y3, y4] = [0.09, 0.16, 0.42, 0.98].map(|z| frames * z);
        let release = [
            0.999_999_999_999_999_8 * y1 + 1.843_221_968_432_392_3e-16 * y2 - 1.937_339_435_167_642_3e-16 * y3 + 8.824_516_011_816_245e-18 * y4,
            -1.578_832_035_284_588_8 * y1 + 2.330_583_703_207_428_6 * y2 - 0.914_119_420_484_042_9 * y3 + 0.162_367_752_561_203_2 * y4,
            0.533_414_286_910_642_4 * y1 - 1.272_736_789_213_631 * y2 + 0.925_885_604_220_751_2 * y3 - 0.186_563_101_917_762_26 * y4,
            0.087_834_631_382_072_34 * y1 - 0.169_416_296_792_562_2 * y2 + 0.085_880_579_515_952_72 * y3 - 0.004_298_914_105_462_83 * y4,
            -0.042_416_883_008_123_074 * y1 + 0.111_569_382_798_760_2 * y2 - 0.097_646_763_252_658_72 * y3 + 0.028_494_263_462_021_576 * y4,
        ];
        let mut c = Compressor {
            trigger: Trigger::default(),
            threshold,
            knee_db: threshold_db + knee,
            slope,
            k,
            knee_linear: top,
            knee_out_db: db(knee_curve(top, k)),
            makeup: 1.0,
            attack_frames: attack.max(0.001) * rate,
            release,
            sat_release_frames: 0.0025 * rate,
            detector: 0.0,
            gain: 1.0,
            max_attack_diff_db: -1.0,
            envelope_rate: 1.0,
            scaled_desired: 0.0,
            division: 0,
            ahead: vec![(0.0, 0.0); ((0.006 * rate).round() as usize).max(1)],
            at: 0,
        };
        c.makeup = (1.0 / c.curve(1.0)).powf(0.6);
        c
    }

    /// The level out for a level in, both linear.
    fn curve(&self, x: f64) -> f64 {
        if x < self.threshold {
            x
        } else if x < self.knee_linear {
            self.threshold + (1.0 - (-self.k * (x - self.threshold)).exp()) / self.k
        } else {
            linear(self.knee_out_db + self.slope * (db(x) - self.knee_db))
        }
    }

    /// How fast the gain moves for the next division, from where the detector is.
    fn plan(&mut self) {
        let desired = self.detector.clamp(-1.0, 1.0);
        self.scaled_desired = desired.asin() / (PI / 2.0);
        let mut diff_db = db(self.gain / self.scaled_desired);
        if self.scaled_desired > self.gain {
            self.max_attack_diff_db = -1.0;
            if !diff_db.is_finite() {
                diff_db = -1.0;
            }
            let x = 0.25 * (diff_db.clamp(-12.0, 0.0) + 12.0);
            let [a, b, c, d, e] = self.release;
            let frames = a + b * x + c * x * x + d * x.powi(3) + e * x.powi(4);
            self.envelope_rate = linear(5.0 / frames);
        } else {
            if !diff_db.is_finite() || self.scaled_desired <= 0.0 {
                diff_db = 1.0;
            }
            if self.max_attack_diff_db == -1.0 || self.max_attack_diff_db < diff_db {
                self.max_attack_diff_db = diff_db;
            }
            let x = 0.25 / self.max_attack_diff_db.max(0.5);
            self.envelope_rate = 1.0 - x.powf(1.0 / self.attack_frames);
        }
    }

    /// Keys it to another track: its level is raised by `gain_db`, and `mix` (0 to 1) of what triggers it is that
    /// track's. Automatic makeup is off, as Live's is with a sidechain.
    fn key(&mut self, gain_db: f64, mix: f64) {
        self.trigger.side = Some((linear(gain_db.clamp(-70.0, 24.0)), mix.clamp(0.0, 1.0)));
        self.makeup = 1.0;
    }

    /// `key` is the keying track's sound now (the louder side) (0 when it isn't keyed).
    fn process(&mut self, l: f32, r: f32, key: f32) -> (f32, f32) {
        if self.division == 0 {
            self.plan();
        }
        self.division = (self.division + 1) % DIVISION;
        let level = self.trigger.level(l, r, key);
        let attenuation = if level <= 0.0001 { 1.0 } else { self.curve(level) / level };
        let sat_release = linear((-db(attenuation)).max(2.0) / self.sat_release_frames) - 1.0;
        let step = if attenuation > self.detector { sat_release } else { 1.0 };
        self.detector = (self.detector + (attenuation - self.detector) * step).min(1.0);
        if !self.detector.is_finite() {
            self.detector = 1.0;
        }
        if self.envelope_rate < 1.0 {
            self.gain += (self.scaled_desired - self.gain) * self.envelope_rate;
        } else {
            self.gain = (self.gain * self.envelope_rate).min(1.0);
        }
        let total = (self.makeup * (PI / 2.0 * self.gain).sin()) as f32;
        let (dl, dr) = std::mem::replace(&mut self.ahead[self.at], (l, r));
        self.at = (self.at + 1) % self.ahead.len();
        (dl * total, dr * total)
    }
}

/// A gate, as Live's: it opens when the level goes over `threshold` and closes when it falls `return` dB
/// under that, fading up over `attack`, staying open at least `hold`, and fading down over `release` to `floor`. Like
/// the compressor, it can be keyed by another track.
struct Gate {
    open_at: f64,
    close_at: f64,
    rise: f64,
    fall: f64,
    hold: usize,
    floor: f64,
    trigger: Trigger,
    open: bool,
    held: usize,
    gain: f64,
}

impl Gate {
    fn new(threshold_db: f64, return_db: f64, attack: f64, hold: f64, release: f64, floor_db: f64, rate: f64) -> Gate {
        let step = |seconds: f64| 1.0 / (seconds.max(0.0001) * rate);
        Gate {
            open_at: linear(threshold_db),
            close_at: linear(threshold_db - return_db.max(0.0)),
            rise: step(attack),
            fall: step(release),
            hold: (hold.max(0.0) * rate) as usize,
            floor: if floor_db <= -90.0 { 0.0 } else { linear(floor_db.min(0.0)) },
            trigger: Trigger::default(),
            open: false,
            held: 0,
            gain: 0.0,
        }
    }

    /// Keys it to another track, as [`Compressor::key`].
    fn key(&mut self, gain_db: f64, mix: f64) {
        self.trigger.side = Some((linear(gain_db.clamp(-70.0, 24.0)), mix.clamp(0.0, 1.0)));
    }

    fn process(&mut self, l: f32, r: f32, key: f32) -> (f32, f32) {
        let level = self.trigger.level(l, r, key);
        if level >= self.open_at {
            self.open = true;
            self.held = self.hold;
        } else if level < self.close_at {
            if self.held > 0 {
                self.held -= 1;
            } else {
                self.open = false;
            }
        }
        self.gain = if self.open { (self.gain + self.rise).min(1.0) } else { (self.gain - self.fall).max(0.0) };
        let g = (self.floor + (1.0 - self.floor) * self.gain) as f32;
        (l * g, r * g)
    }
}

/// A limiter: nothing goes over `ceiling`. It looks 1.5 ms ahead, so the gain is down before a peak arrives, holds it
/// that long, then lets go over `release`.
struct Limiter {
    ceiling: f64,
    recover: f64,
    ahead: Vec<(f32, f32)>,
    at: usize,
    gain: f64,
    held: usize,
}

impl Limiter {
    fn new(ceiling_db: f64, release: f64, rate: f64) -> Limiter {
        Limiter {
            ceiling: linear(ceiling_db.min(0.0)),
            recover: 1.0 - (-1.0 / (release.max(0.001) * rate)).exp(),
            ahead: vec![(0.0, 0.0); ((0.0015 * rate).round() as usize).max(1)],
            at: 0,
            gain: 1.0,
            held: 0,
        }
    }

    fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let peak = f64::from(l.abs().max(r.abs()));
        let wanted = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };
        if wanted < self.gain {
            self.gain = wanted;
            self.held = self.ahead.len();
        } else if self.held > 0 {
            self.held -= 1;
        } else {
            self.gain += (1.0 - self.gain) * self.recover;
        }
        let (dl, dr) = std::mem::replace(&mut self.ahead[self.at], (l, r));
        self.at = (self.at + 1) % self.ahead.len();
        let c = self.ceiling as f32;
        let g = self.gain as f32;
        ((dl * g).clamp(-c, c), (dr * g).clamp(-c, c))
    }
}

enum Kind {
    Input,
    Output,
    Gain,
    Filter { kind: FilterType, state: [[f64; 4]; 2], cached: Option<([f64; 3], Coefficients)> },
    Delay { ring: Vec<(f32, f32)>, at: usize, feedback: bool },
    Lfo { rate: f64, wave: Wave, phase: f64 },
    Drive { amount: f64 },
    Compressor(Box<Compressor>),
    Gate(Box<Gate>),
    Limiter(Box<Limiter>),
    Reverb(Box<[Convolver; 2]>),
    Pan { stereo_in: bool },
    Mix { amount: f64 },
}

/// Where a cable goes: a part's sound in (its first or second input), or one of its settings.
#[derive(Clone, Copy)]
enum End {
    Port(usize),
    Param(usize),
}

struct Part {
    kind: Kind,
    /// Settings a cable can move, where they rest: gain; cutoff, resonance, gain; time (seconds); pan.
    rest: [f64; 3],
    /// The sound it sends on, left and right, for the current piece.
    out: [[f32; QUANTUM]; 2],
    /// What has come in, by input (two for a mix), left and right.
    ins: [[[f32; QUANTUM]; 2]; 2],
    /// Its settings as moved by cables, sample by sample (only those with a cable).
    moved: [[f32; QUANTUM]; 3],
    has_cable: [bool; 3],
    stereo: bool,
}

/// One device, ready to run.
struct Device {
    parts: Vec<Part>,
    cables: Vec<(usize, usize, End)>,
    /// For each cable into a delay in a loop, whether it comes round the loop: Web Audio hears that one a piece
    /// (128 samples) late, so each time round a loop adds 128 samples.
    late: Vec<bool>,
    /// The order parts are worked out in. Delays in a loop come first and are fed at the end.
    order: Vec<usize>,
    input: usize,
    /// The part its sound leaves from, or none to pass the input straight through.
    output: Option<usize>,
    limit: bool,
    /// Its effect's id, as [`fx_key`] makes it: how the Workbench names the device it has open.
    key: u64,
    /// The track keying its compressors, by its place in the chain's [`Chain::sources`].
    side: Option<usize>,
    /// While the Workbench has it open: each part's sum of squares since its levels were last read, and over how
    /// many samples.
    watched: bool,
    energy: Vec<f64>,
    samples: usize,
}

/// An effect's id as a number the audio thread can compare without its text (FNV-1a).
#[must_use]
pub fn fx_key(id: &str) -> u64 {
    id.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

/// The ids of an effect's parts, in the order [`Chain::levels`] numbers them (a built-in effect's are the ones
/// song-format.ts `builtinDevice` gives it).
#[must_use]
pub fn part_ids(e: &Value) -> Vec<String> {
    let def = match e.get("kind").and_then(Value::as_str) {
        Some("device") => e.get("device").cloned(),
        _ => builtin(e),
    };
    def.as_ref()
        .and_then(|d| d.get("parts"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(24)
        .filter_map(|p| p.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

/// A level in dB from a sum of squares over `n` samples: their RMS, with silence at -90 (studio-audio.ts `rmsDb`).
fn rms_db(energy: f64, n: usize) -> f64 {
    let rms = (energy / n.max(1) as f64).sqrt();
    if rms > 0.0 { (20.0 * rms.log10()).max(-90.0) } else { -90.0 }
}

/// A filter's `type`, low-pass when it has none.
fn filter_type(o: &Value) -> FilterType {
    match o.get("type").and_then(Value::as_str).unwrap_or("lowpass") {
        "highpass" => FilterType::HighPass,
        "bandpass" => FilterType::BandPass,
        "lowshelf" => FilterType::LowShelf,
        "highshelf" => FilterType::HighShelf,
        "peaking" => FilterType::Peaking,
        "notch" => FilterType::Notch,
        "allpass" => FilterType::AllPass,
        _ => FilterType::LowPass,
    }
}

fn num(o: &Value, key: &str, fallback: f64) -> f64 {
    o.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(fallback)
}

impl Device {
    /// A device from its definition (device-format.ts `Device`), or None when it can't be played.
    fn new(def: &Value, rate: f64, seconds_per_beat: f64, limit: bool, stereo_in: bool, seed: &mut u32) -> Option<Device> {
        let list = def.get("parts")?.as_array()?;
        let mut ids: Vec<&str> = Vec::new();
        let mut parts = Vec::new();
        for p in list.iter().take(24) {
            let id = p.get("id")?.as_str()?;
            let kind = p.get("kind")?.as_str()?;
            let mut rest = [0.0; 3];
            let kind = match kind {
                "input" => Kind::Input,
                "output" => Kind::Output,
                "gain" => {
                    rest[0] = num(p, "gain", 1.0);
                    Kind::Gain
                }
                "filter" => {
                    let kind = filter_type(p);
                    // A shelf has no resonance in Web Audio, so it rests at the node's own 1.
                    let shelf = matches!(kind, FilterType::LowShelf | FilterType::HighShelf);
                    rest = [num(p, "cutoff", 1000.0), if shelf { 1.0 } else { num(p, "resonance", 1.0) }, num(p, "gain", 0.0)];
                    Kind::Filter { kind, state: [[0.0; 4]; 2], cached: None }
                }
                "delay" => {
                    // In beats, or in `seconds` when it has them (a chorus's few milliseconds, whatever the tempo).
                    rest[0] = p.get("seconds").and_then(Value::as_f64).filter(|s| s.is_finite()).unwrap_or_else(|| num(p, "time", 0.75) * seconds_per_beat).clamp(0.0, MAX_DELAY);
                    Kind::Delay { ring: vec![(0.0, 0.0); (MAX_DELAY * rate) as usize + 2 * QUANTUM + 2], at: 0, feedback: false }
                }
                "lfo" => {
                    let wave = match p.get("shape").and_then(Value::as_str).unwrap_or("sine") {
                        "triangle" => Wave::Triangle,
                        "square" => Wave::Square,
                        "sawtooth" => Wave::Saw,
                        _ => Wave::Sine,
                    };
                    rest[0] = num(p, "depth", 0.0);
                    Kind::Lfo { rate: num(p, "rate", 1.0).clamp(0.0, 40.0), wave, phase: num(p, "phase", 0.0).rem_euclid(1.0) }
                }
                "gate" => Kind::Gate(Box::new(Gate::new(num(p, "threshold", -40.0), num(p, "return", 3.0), num(p, "attack", 0.001), num(p, "hold", 0.01), num(p, "release", 0.1), num(p, "floor", -90.0), rate))),
                "limiter" => Kind::Limiter(Box::new(Limiter::new(num(p, "ceiling", -0.3), num(p, "release", 0.05), rate))),
                "drive" => Kind::Drive { amount: num(p, "amount", 0.3).clamp(0.0, 1.0) },
                "compressor" => Kind::Compressor(Box::new(Compressor::new(num(p, "threshold", -18.0), num(p, "knee", 6.0), num(p, "ratio", 4.0), num(p, "attack", 0.01), num(p, "release", 0.2), rate))),
                "reverb" => {
                    let [l, r] = room(rate, num(p, "size", 2.0).clamp(0.01, 8.0), num(p, "damp", 0.4).clamp(0.0, 1.0), seed);
                    Kind::Reverb(Box::new([Convolver::new(&l), Convolver::new(&r)]))
                }
                "pan" => {
                    rest[0] = num(p, "pan", 0.0);
                    Kind::Pan { stereo_in: false }
                }
                "mix" => Kind::Mix { amount: num(p, "amount", 0.25) },
                _ => return None,
            };
            ids.push(id);
            parts.push(Part { kind, rest, out: [[0.0; QUANTUM]; 2], ins: [[[0.0; QUANTUM]; 2]; 2], moved: [[0.0; QUANTUM]; 3], has_cable: [false; 3], stereo: false });
        }
        let find = |id: &str| ids.iter().position(|i| *i == id);
        let input = parts.iter().position(|p| matches!(p.kind, Kind::Input))?;
        let out_part = parts.iter().position(|p| matches!(p.kind, Kind::Output))?;
        let mut cables = Vec::new();
        for c in def.get("cables").and_then(Value::as_array).into_iter().flatten().take(48) {
            let (Some(from), Some(to)) = (c.get(0).and_then(Value::as_str), c.get(1).and_then(Value::as_str)) else { continue };
            let Some(from) = find(from) else { continue };
            let (to_id, port) = to.split_once('.').map_or((to, None), |(a, b)| (a, Some(b)));
            let Some(to) = find(to_id) else { continue };
            let end = match (&parts[to].kind, port) {
                (Kind::Input | Kind::Lfo { .. }, _) => continue,
                (Kind::Mix { .. }, Some("dry")) => End::Port(0),
                (Kind::Mix { .. }, Some("wet")) => End::Port(1),
                (Kind::Mix { .. }, _) => continue,
                (_, None) => End::Port(0),
                (Kind::Gain, Some("gain")) | (Kind::Delay { .. }, Some("time")) | (Kind::Pan { .. }, Some("pan")) | (Kind::Filter { .. }, Some("cutoff")) => End::Param(0),
                (Kind::Filter { .. }, Some("resonance")) => End::Param(1),
                (Kind::Filter { .. }, Some("gain")) => End::Param(2),
                _ => continue,
            };
            if let End::Param(i) = end {
                parts[to].has_cable[i] = true;
            }
            cables.push((from, to, end));
        }
        // The order: whatever has all it takes in worked out; when only loops are left, a delay in one goes first.
        let n = parts.len();
        let mut done = vec![false; n];
        let mut order = Vec::with_capacity(n);
        while order.len() < n {
            let ready = (0..n).find(|&p| !done[p] && cables.iter().all(|&(f, t, _)| t != p || done[f]));
            let next = match ready {
                Some(p) => p,
                None => {
                    let p = (0..n).find(|&p| !done[p] && matches!(parts[p].kind, Kind::Delay { .. }))?;
                    if let Kind::Delay { feedback, .. } = &mut parts[p].kind {
                        *feedback = true;
                    }
                    p
                }
            };
            done[next] = true;
            order.push(next);
        }
        // Feedback delays are read before anything else in a piece.
        order.sort_by_key(|&p| !matches!(parts[p].kind, Kind::Delay { feedback: true, .. }));
        // Which parts carry two channels: the input if the track does, a reverb, pan or compressor always, and whatever is
        // fed one.
        parts[input].stereo = stereo_in;
        for _ in 0..n {
            for &(f, t, end) in &cables {
                if matches!(end, End::Port(_)) && parts[f].stereo && !matches!(parts[t].kind, Kind::Lfo { .. }) {
                    parts[t].stereo = true;
                }
            }
            for p in &mut parts {
                // A compressor always sends two channels on, as browsers make it.
                if matches!(p.kind, Kind::Reverb(_) | Kind::Pan { .. } | Kind::Compressor(_) | Kind::Gate(_) | Kind::Limiter(_)) {
                    p.stereo = true;
                }
            }
        }
        for t in 0..n {
            let fed_stereo = cables.iter().any(|&(f, to, end)| to == t && matches!(end, End::Port(_)) && parts[f].stereo);
            if let Kind::Pan { stereo_in } = &mut parts[t].kind {
                *stereo_in = fed_stereo;
            }
        }
        let into_out = cables.iter().any(|&(_, t, _)| t == out_part);
        let late = cables
            .iter()
            .map(|&(from, to, _)| {
                if !matches!(parts[to].kind, Kind::Delay { feedback: true, .. }) {
                    return false;
                }
                // Whether `from` hears the delay: reachable from it along the cables.
                let mut seen = vec![false; n];
                let mut stack = vec![to];
                while let Some(at) = stack.pop() {
                    for &(f, t, _) in &cables {
                        if f == at && !seen[t] {
                            seen[t] = true;
                            stack.push(t);
                        }
                    }
                }
                seen[from]
            })
            .collect();
        let energy = vec![0.0; parts.len()];
        Some(Device { parts, cables, late, order, input, output: into_out.then_some(out_part), limit, key: 0, side: None, watched: false, energy, samples: 0 })
    }

    fn stereo_out(&self) -> bool {
        self.output.map_or(self.parts[self.input].stereo, |o| self.parts[o].stereo)
    }

    /// Runs `l` and `r` (at most `QUANTUM` long) through the device, in place.
    /// `key` is the keying track's level, sample by sample (empty when it isn't keyed).
    fn process(&mut self, l: &mut [f32], r: &mut [f32], rate: f64, key: &[f32]) {
        let n = l.len().min(r.len()).min(QUANTUM);
        let input = self.input;
        self.parts[input].out[0][..n].copy_from_slice(&l[..n]);
        self.parts[input].out[1][..n].copy_from_slice(&r[..n]);
        for step in 0..self.order.len() {
            let p = self.order[step];
            if p == input {
                continue;
            }
            let feedback_delay = matches!(self.parts[p].kind, Kind::Delay { feedback: true, .. });
            if !feedback_delay {
                self.gather(p, n);
            }
            self.run(p, n, rate, feedback_delay, key);
        }
        // Feedback delays take what has come in now that the piece is made.
        for step in 0..self.order.len() {
            let p = self.order[step];
            if let Kind::Delay { feedback: true, .. } = self.parts[p].kind {
                self.feed_delay(p, n);
            }
        }
        if self.watched {
            // What leaves each part, mixed down to one channel as an analyser hears it.
            for (part, sum) in self.parts.iter().zip(&mut self.energy) {
                let [a, b] = &part.out;
                *sum += if part.stereo {
                    a[..n].iter().zip(&b[..n]).map(|(x, y)| f64::from((x + y) * 0.5).powi(2)).sum::<f64>()
                } else {
                    a[..n].iter().map(|x| f64::from(*x).powi(2)).sum::<f64>()
                };
            }
            self.samples += n;
        }
        let from = self.output.unwrap_or(input);
        for i in 0..n {
            let (a, b) = (self.parts[from].out[0][i], self.parts[from].out[1][i]);
            (l[i], r[i]) = if self.limit { (soft_limit(f64::from(a)) as f32, soft_limit(f64::from(b)) as f32) } else { (a, b) };
        }
    }

    /// Adds up what comes into part `p` down its cables: sound to its inputs, movement to its settings.
    fn gather(&mut self, p: usize, n: usize) {
        let part = &mut self.parts[p];
        for port in &mut part.ins {
            for ch in port.iter_mut() {
                ch[..n].fill(0.0);
            }
        }
        for (i, moved) in part.moved.iter_mut().enumerate() {
            moved[..n].fill(part.rest[i] as f32);
        }
        for c in 0..self.cables.len() {
            let (from, to, end) = self.cables[c];
            if to != p {
                continue;
            }
            let (src_l, src_r) = (self.parts[from].out[0], self.parts[from].out[1]);
            let part = &mut self.parts[p];
            match end {
                End::Port(port) => {
                    for i in 0..n {
                        part.ins[port][0][i] += src_l[i];
                        part.ins[port][1][i] += src_r[i];
                    }
                }
                // A setting hears its cable mixed down to one channel.
                End::Param(k) => {
                    for i in 0..n {
                        part.moved[k][i] += (src_l[i] + src_r[i]) * 0.5;
                    }
                }
            }
        }
    }

    /// Feeds a delay in a loop what came in during this piece: what comes straight in now, what comes round the loop
    /// a piece (128 samples) later, as Web Audio hears it.
    fn feed_delay(&mut self, p: usize, n: usize) {
        let mut straight = [[0.0f32; QUANTUM]; 2];
        let mut round = [[0.0f32; QUANTUM]; 2];
        for (c, &(from, to, end)) in self.cables.iter().enumerate() {
            if to != p || !matches!(end, End::Port(_)) {
                continue;
            }
            let into = if self.late[c] { &mut round } else { &mut straight };
            for (sums, xs) in into.iter_mut().zip(&self.parts[from].out) {
                for (sum, x) in sums[..n].iter_mut().zip(&xs[..n]) {
                    *sum += x;
                }
            }
        }
        if let Kind::Delay { ring, at, .. } = &mut self.parts[p].kind {
            let len = ring.len();
            for i in 0..n {
                let now = &mut ring[(*at + i) % len];
                *now = (now.0 + straight[0][i], now.1 + straight[1][i]);
                ring[(*at + i + QUANTUM) % len] = (round[0][i], round[1][i]);
            }
            *at = (*at + n) % len;
        }
    }

    fn run(&mut self, p: usize, n: usize, rate: f64, feedback_delay: bool, key: &[f32]) {
        let part = &mut self.parts[p];
        let Part { kind, ins, out, moved, has_cable, rest, .. } = part;
        let param = |k: usize, i: usize| if has_cable[k] { f64::from(moved[k][i]) } else { rest[k] };
        match kind {
            Kind::Input => {}
            Kind::Output => {
                out[0][..n].copy_from_slice(&ins[0][0][..n]);
                out[1][..n].copy_from_slice(&ins[0][1][..n]);
            }
            Kind::Gain => {
                for i in 0..n {
                    let g = param(0, i) as f32;
                    out[0][i] = ins[0][0][i] * g;
                    out[1][i] = ins[0][1][i] * g;
                }
            }
            Kind::Filter { kind, state, cached } => {
                let moving = has_cable.iter().any(|c| *c);
                for i in 0..n {
                    let settings = [param(0, i).clamp(0.0, rate / 2.0), param(1, i), param(2, i)];
                    let c = match cached {
                        Some((was, c)) if !moving && *was == settings => *c,
                        _ => {
                            let c = biquad(*kind, settings[0], settings[1], settings[2], rate);
                            *cached = Some((settings, c));
                            c
                        }
                    };
                    for ch in 0..2 {
                        let [x1, x2, y1, y2] = &mut state[ch];
                        let x = f64::from(ins[0][ch][i]);
                        let y = c[0] * x + c[1] * *x1 + c[2] * *x2 - c[3] * *y1 - c[4] * *y2;
                        // A decaying tail is let go once it is far below hearing, so it never reaches denormal values.
                        let y = if y.abs() < 1e-20 { 0.0 } else { y };
                        (*x2, *x1, *y2, *y1) = (*x1, x, *y1, y);
                        out[ch][i] = y as f32;
                    }
                }
            }
            Kind::Delay { ring, at, feedback } => {
                let len = ring.len();
                let least = if *feedback { QUANTUM as f64 } else { 0.0 };
                for i in 0..n {
                    if !*feedback {
                        ring[(*at + i) % len] = (ins[0][0][i], ins[0][1][i]);
                    }
                    let back = (param(0, i).clamp(0.0, MAX_DELAY) * rate).max(least);
                    let whole = back.floor();
                    let frac = (back - whole) as f32;
                    let now = *at + i + len;
                    let a = ring[(now - whole as usize) % len];
                    let b = ring[(now - whole as usize - 1) % len];
                    out[0][i] = a.0 + (b.0 - a.0) * frac;
                    out[1][i] = a.1 + (b.1 - a.1) * frac;
                }
                if !feedback_delay {
                    *at = (*at + n) % len;
                }
            }
            Kind::Lfo { rate: hz, wave, phase } => {
                let [left, right] = out;
                for (l, r) in left[..n].iter_mut().zip(right[..n].iter_mut()) {
                    let p = *phase;
                    let y = match wave {
                        Wave::Sine => (TAU * p).sin(),
                        Wave::Square => if p < 0.5 { 1.0 } else { -1.0 },
                        Wave::Saw => if p < 0.5 { 2.0 * p } else { 2.0 * p - 2.0 },
                        Wave::Triangle => if p < 0.25 { 4.0 * p } else if p < 0.75 { 2.0 - 4.0 * p } else { 4.0 * p - 4.0 },
                    } * rest[0];
                    *phase = (p + *hz / rate).fract();
                    *l = y as f32;
                    *r = y as f32;
                }
            }
            Kind::Drive { amount } => {
                for ch in 0..2 {
                    for i in 0..n {
                        out[ch][i] = shape(f64::from(ins[0][ch][i]), *amount) as f32;
                    }
                }
            }
            Kind::Gate(g) => {
                for i in 0..n {
                    let (a, b) = g.process(ins[0][0][i], ins[0][1][i], key.get(i).copied().unwrap_or(0.0));
                    out[0][i] = a;
                    out[1][i] = b;
                }
            }
            Kind::Limiter(lim) => {
                for i in 0..n {
                    let (a, b) = lim.process(ins[0][0][i], ins[0][1][i]);
                    out[0][i] = a;
                    out[1][i] = b;
                }
            }
            Kind::Compressor(c) => {
                for i in 0..n {
                    let (a, b) = c.process(ins[0][0][i], ins[0][1][i], key.get(i).copied().unwrap_or(0.0));
                    out[0][i] = a;
                    out[1][i] = b;
                }
            }
            Kind::Reverb(conv) => {
                let [cl, cr] = conv.as_mut();
                for i in 0..n {
                    out[0][i] = cl.process(ins[0][0][i]);
                    out[1][i] = cr.process(ins[0][1][i]);
                }
            }
            Kind::Pan { stereo_in } => {
                for i in 0..n {
                    let (a, b) = pan(f64::from(ins[0][0][i]), f64::from(ins[0][1][i]), param(0, i), *stereo_in);
                    out[0][i] = a as f32;
                    out[1][i] = b as f32;
                }
            }
            Kind::Mix { amount } => {
                // A crossfade: all dry at 0, all wet at 1 (as Live's Dry/Wet).
                let (dry, wet) = ((1.0 - *amount) as f32, *amount as f32);
                for ch in 0..2 {
                    for i in 0..n {
                        out[ch][i] = ins[0][ch][i] * dry + ins[1][ch][i] * wet;
                    }
                }
            }
        }
    }
}

/// The device a built-in effect is (song-format.ts `builtinDevice`).
fn builtin(e: &Value) -> Option<Value> {
    let n = |k: &str, d: f64| num(e, k, d);
    let part = |id: &str, kind: &str, settings: Value| {
        let mut p = settings;
        p["id"] = Value::from(id);
        p["kind"] = Value::from(kind);
        p
    };
    let (parts, cables): (Vec<Value>, Vec<[&str; 2]>) = match e.get("kind")?.as_str()? {
        "eq" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("low", "filter", serde_json::json!({ "type": "lowshelf", "cutoff": n("lowFreq", 120.0), "gain": n("low", 0.0), "resonance": 0.7 })),
                part("mid", "filter", serde_json::json!({ "type": "peaking", "cutoff": n("midFreq", 1000.0), "resonance": n("midQ", 1.0), "gain": n("mid", 0.0) })),
                part("high", "filter", serde_json::json!({ "type": "highshelf", "cutoff": n("highFreq", 6000.0), "gain": n("high", 0.0), "resonance": 0.7 })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "low"], ["low", "mid"], ["mid", "high"], ["high", "out"]],
        ),
        "compressor" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("comp", "compressor", serde_json::json!({ "threshold": n("threshold", -18.0), "ratio": n("ratio", 4.0), "attack": n("attack", 0.01), "release": n("release", 0.2), "knee": 6 })),
                part("makeup", "gain", serde_json::json!({ "gain": 10f64.powf(n("makeup", 0.0) / 20.0) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "comp"], ["comp", "makeup"], ["makeup", "out"]],
        ),
        "delay" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("echo", "delay", serde_json::json!({ "time": n("time", 0.75) })),
                part("back", "gain", serde_json::json!({ "gain": n("feedback", 0.35) })),
                part("mix", "mix", serde_json::json!({ "amount": n("mix", 0.25) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "mix.dry"], ["in", "echo"], ["echo", "back"], ["back", "echo"], ["echo", "mix.wet"], ["mix", "out"]],
        ),
        "reverb" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("room", "reverb", serde_json::json!({ "size": n("size", 2.0), "damp": n("damp", 0.4) })),
                part("mix", "mix", serde_json::json!({ "amount": n("mix", 0.25) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "mix.dry"], ["in", "room"], ["room", "mix.wet"], ["mix", "out"]],
        ),
        // After Live 12's Gate, Limiter, Saturator, Auto Filter, Chorus and Phaser, as parts.
        "gate" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("gate", "gate", serde_json::json!({ "threshold": n("threshold", -40.0), "return": n("return", 3.0), "attack": n("attack", 0.001), "hold": n("hold", 0.01), "release": n("release", 0.1), "floor": n("floor", -90.0) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "gate"], ["gate", "out"]],
        ),
        "limiter" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("gain", "gain", serde_json::json!({ "gain": 10f64.powf(n("gain", 0.0) / 20.0) })),
                part("limit", "limiter", serde_json::json!({ "ceiling": n("ceiling", -0.3), "release": n("release", 0.05) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "gain"], ["gain", "limit"], ["limit", "out"]],
        ),
        "saturator" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("drive", "gain", serde_json::json!({ "gain": 10f64.powf(n("drive", 6.0) / 20.0) })),
                part("shape", "drive", serde_json::json!({ "amount": n("shape", 0.0) })),
                part("output", "gain", serde_json::json!({ "gain": 10f64.powf(n("output", 0.0) / 20.0) })),
                part("mix", "mix", serde_json::json!({ "amount": n("mix", 1.0) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "mix.dry"], ["in", "drive"], ["drive", "shape"], ["shape", "output"], ["output", "mix.wet"], ["mix", "out"]],
        ),
        "autofilter" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("f", "filter", serde_json::json!({ "type": e.get("filter").and_then(Value::as_str).unwrap_or("lowpass"), "cutoff": n("cutoff", 1000.0), "resonance": n("resonance", 3.0), "gain": 0 })),
                part("lfo", "lfo", serde_json::json!({ "rate": n("rate", 1.0), "depth": n("depth", 0.0), "shape": e.get("shape").and_then(Value::as_str).unwrap_or("sine") })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "f"], ["lfo", "f.cutoff"], ["f", "out"]],
        ),
        "chorus" => (
            vec![
                part("in", "input", serde_json::json!({})),
                part("voice", "delay", serde_json::json!({ "seconds": n("delay", 0.012) })),
                part("lfo", "lfo", serde_json::json!({ "rate": n("rate", 0.8), "depth": n("depth", 0.003) })),
                part("mix", "mix", serde_json::json!({ "amount": n("mix", 0.5) })),
                part("out", "output", serde_json::json!({})),
            ],
            vec![["in", "mix.dry"], ["in", "voice"], ["lfo", "voice.time"], ["voice", "mix.wet"], ["mix", "out"]],
        ),
        "phaser" => {
            let stage = |id: &str| part(id, "filter", serde_json::json!({ "type": "allpass", "cutoff": n("center", 800.0), "resonance": 0.7, "gain": 0 }));
            (
                vec![
                    part("in", "input", serde_json::json!({})),
                    stage("a1"),
                    stage("a2"),
                    stage("a3"),
                    stage("a4"),
                    part("lfo", "lfo", serde_json::json!({ "rate": n("rate", 0.5), "depth": n("depth", 600.0) })),
                    part("mix", "mix", serde_json::json!({ "amount": n("mix", 0.5) })),
                    part("out", "output", serde_json::json!({})),
                ],
                vec![["in", "mix.dry"], ["in", "a1"], ["a1", "a2"], ["a2", "a3"], ["a3", "a4"], ["a4", "mix.wet"], ["lfo", "a1.cutoff"], ["lfo", "a2.cutoff"], ["lfo", "a3.cutoff"], ["lfo", "a4.cutoff"], ["mix", "out"]],
            )
        }
        _ => return None,
    };
    Some(serde_json::json!({ "parts": parts, "cables": cables }))
}

/// A track's effects in order, the ones switched off left out.
pub struct Chain {
    devices: Vec<Device>,
    stereo_out: bool,
    /// The tracks keying its effects' compressors (by id), each once.
    sources: Vec<String>,
    /// Its stacks, and the order its devices and stacks run in.
    stacks: Vec<Stack>,
    order: Vec<Unit>,
}

/// A device or a stack of a chain, by its place in the chain's list of them.
#[derive(Clone, Copy)]
enum Unit {
    Device(usize),
    Stack(usize),
}

/// The most chains and macros a stack has, as Live's racks (16 macros in Live 12).
const MAX_STACK: usize = 16;

/// A stack of effects (Live 12's Audio Effect Rack): chains side by side, each hearing what comes in, through its own
/// effects, volume and pan, added together; and macros, each moving settings in the chains between their own ends.
struct Stack {
    key: u64,
    chains: Vec<StackChain>,
    macros: Vec<Macro>,
    dry: [[f32; QUANTUM]; 2],
    wet: [[f32; QUANTUM]; 2],
    sum: [[f32; QUANTUM]; 2],
}

struct StackChain {
    chain: Option<Chain>,
    /// What its chain was made from, to find settings in.
    fx: Vec<Value>,
    volume: f64,
    pan: f64,
    muted: bool,
}

struct Macro {
    value: f64,
    /// Each setting it moves (in a chain, by its place): from `min` with the macro at 0 to `max` at 1.
    maps: Vec<(usize, Aim, f64, f64)>,
}

impl Stack {
    fn new(e: &Value, rate: u32, seconds_per_beat: f64, stereo_in: bool) -> Stack {
        let chains: Vec<StackChain> = e
            .get("chains")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(MAX_STACK)
            .map(|c| {
                let fx: Vec<Value> = c.get("fx").and_then(Value::as_array).cloned().unwrap_or_default();
                StackChain {
                    chain: Chain::build(&fx, rate, seconds_per_beat, stereo_in, true),
                    fx,
                    volume: num(c, "volume", 1.0).max(0.0),
                    pan: num(c, "pan", 0.0).clamp(-1.0, 1.0),
                    muted: c.get("muted").and_then(Value::as_bool) == Some(true),
                }
            })
            .collect();
        let macros = e
            .get("macros")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(MAX_STACK)
            .map(|m| Macro {
                value: num(m, "value", 0.0).clamp(0.0, 1.0),
                maps: m
                    .get("maps")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|map| {
                        let (id, setting) = map.get("target")?.as_str()?.strip_prefix("fx:")?.split_once(':')?;
                        let (c, aim) = chains.iter().enumerate().find_map(|(c, sc)| Some((c, sc.chain.as_ref()?.aim(&sc.fx, id, setting, seconds_per_beat)?)))?;
                        Some((c, aim, num(map, "min", 0.0), num(map, "max", 1.0)))
                    })
                    .collect(),
            })
            .collect();
        let mut stack = Stack { key: fx_key(e.get("id").and_then(Value::as_str).unwrap_or_default()), chains, macros, dry: [[0.0; QUANTUM]; 2], wet: [[0.0; QUANTUM]; 2], sum: [[0.0; QUANTUM]; 2] };
        for k in 0..stack.macros.len() {
            stack.set_macro(k, stack.macros[k].value);
        }
        stack
    }

    /// Puts macro `k` at `value` (0 to 1), and the settings it moves with it.
    fn set_macro(&mut self, k: usize, value: f64) {
        let Some(m) = self.macros.get_mut(k) else { return };
        m.value = value.clamp(0.0, 1.0);
        for &(c, aim, min, max) in &m.maps {
            if let Some(chain) = self.chains.get_mut(c).and_then(|c| c.chain.as_mut()) {
                chain.set(aim, min + m.value * (max - min));
            }
        }
    }

    /// Runs `l` and `r` (at most `QUANTUM` long) through each chain and adds them up, in place.
    fn process(&mut self, l: &mut [f32], r: &mut [f32], rate: f64) {
        let n = l.len().min(r.len()).min(QUANTUM);
        let Stack { chains, dry, wet, sum, .. } = self;
        dry[0][..n].copy_from_slice(&l[..n]);
        dry[1][..n].copy_from_slice(&r[..n]);
        sum[0][..n].fill(0.0);
        sum[1][..n].fill(0.0);
        for c in chains.iter_mut().filter(|c| !c.muted) {
            let [wl, wr] = wet;
            wl[..n].copy_from_slice(&dry[0][..n]);
            wr[..n].copy_from_slice(&dry[1][..n]);
            if let Some(chain) = &mut c.chain {
                chain.process(&mut wl[..n], &mut wr[..n], rate);
            }
            for i in 0..n {
                let (a, b) = (f64::from(wl[i]) * c.volume, f64::from(wr[i]) * c.volume);
                let (a, b) = balance(a, b, c.pan);
                sum[0][i] += a as f32;
                sum[1][i] += b as f32;
            }
        }
        l[..n].copy_from_slice(&sum[0][..n]);
        r[..n].copy_from_slice(&sum[1][..n]);
    }
}

impl Chain {
    /// The chain for a track's `fx` list, or None when there is nothing to run. `stereo_in` says whether the track's
    /// sound comes in with two channels (a drum panned on its pad).
    #[must_use]
    pub fn new(fx: &[Value], rate: u32, seconds_per_beat: f64, stereo_in: bool) -> Option<Chain> {
        Chain::build(fx, rate, seconds_per_beat, stereo_in, false)
    }

    /// As [`Chain::new`]; a chain inside a stack (`nested`) holds no stacks of its own.
    fn build(fx: &[Value], sample_rate: u32, seconds_per_beat: f64, stereo_in: bool, nested: bool) -> Option<Chain> {
        let rate = f64::from(sample_rate);
        let mut stacks = Vec::new();
        let mut order = Vec::new();
        let mut seed = 0x2545_F491u32;
        let mut stereo = stereo_in;
        let mut devices = Vec::new();
        let mut sources: Vec<String> = Vec::new();
        for e in fx.iter().take(16) {
            if e.get("on").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            if e.get("kind").and_then(Value::as_str) == Some("stack") {
                if !nested {
                    order.push(Unit::Stack(stacks.len()));
                    stacks.push(Stack::new(e, sample_rate, seconds_per_beat, stereo));
                    stereo = true;
                }
                continue;
            }
            let device = match e.get("kind").and_then(Value::as_str) {
                Some("device") => e.get("device").and_then(|d| Device::new(d, rate, seconds_per_beat, true, stereo, &mut seed)),
                _ => builtin(e).and_then(|d| Device::new(&d, rate, seconds_per_beat, false, stereo, &mut seed)),
            };
            if let Some(mut d) = device {
                d.key = fx_key(e.get("id").and_then(Value::as_str).unwrap_or_default());
                // A sidechain from another track (29.9.1) keys every compressor in the effect.
                let side = e.get("sidechain").filter(|s| s.is_object());
                if let Some(track) = side.and_then(|s| s.get("track")).and_then(Value::as_str).filter(|t| !t.is_empty()) {
                    let side = side.unwrap_or(&Value::Null);
                    let (gain, mix) = (num(side, "gain", 0.0), num(side, "mix", 1.0));
                    let mut keyed = false;
                    for part in &mut d.parts {
                        match &mut part.kind {
                            Kind::Compressor(c) => c.key(gain, mix),
                            Kind::Gate(g) => g.key(gain, mix),
                            _ => continue,
                        }
                        keyed = true;
                    }
                    if keyed {
                        d.side = Some(sources.iter().position(|s| s == track).unwrap_or_else(|| {
                            sources.push(track.to_owned());
                            sources.len() - 1
                        }));
                    }
                }
                // The sidechain EQ, with or without another track: only its band of what triggers them counts.
                if let Some(eq) = side.and_then(|s| s.get("eq")).filter(|q| q.is_object() && q.get("on").and_then(Value::as_bool) != Some(false)) {
                    let c = biquad(filter_type(eq), num(eq, "freq", 100.0), num(eq, "q", 0.7), num(eq, "gain", 0.0), rate);
                    for part in &mut d.parts {
                        match &mut part.kind {
                            Kind::Compressor(k) => k.trigger.eq = Some((c, [0.0; 2])),
                            Kind::Gate(k) => k.trigger.eq = Some((c, [0.0; 2])),
                            _ => {}
                        }
                    }
                }
                stereo = d.stereo_out();
                order.push(Unit::Device(devices.len()));
                devices.push(d);
            }
        }
        (!order.is_empty()).then_some(Chain { devices, stereo_out: stereo, sources, stacks, order })
    }

    /// Whether what comes out has two channels (so the track's pan moves it as a stereo sound).
    #[must_use]
    pub fn stereo_out(&self) -> bool {
        self.stereo_out
    }

    /// Listens to the parts of the effect whose [`fx_key`] is `key` (and to no others), or to none.
    pub fn watch(&mut self, key: Option<u64>) {
        for d in &mut self.devices {
            let on = key == Some(d.key);
            if d.watched != on {
                d.watched = on;
                d.energy.fill(0.0);
                d.samples = 0;
            }
        }
    }

    /// The level of each part of the effect being listened to since this was last asked, in dB, by its place in
    /// [`part_ids`]: all but an LFO's (which sends no sound) and the output's (which is the effect's own sound).
    /// Nothing when nothing has played since.
    pub fn levels(&mut self, mut level: impl FnMut(usize, f64)) {
        for d in self.devices.iter_mut().filter(|d| d.watched && d.samples > 0) {
            for (i, (part, sum)) in d.parts.iter().zip(&mut d.energy).enumerate() {
                if !matches!(part.kind, Kind::Lfo { .. } | Kind::Output) {
                    level(i, rms_db(*sum, d.samples));
                }
                *sum = 0.0;
            }
            d.samples = 0;
        }
    }

    /// The tracks keying its compressors (by id): [`Chain::process_keyed`] takes their levels in this order.
    #[must_use]
    pub fn sources(&self) -> &[String] {
        &self.sources
    }

    /// Runs a block through every effect, in place.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], rate: f64) {
        self.process_keyed(left, right, rate, &[]);
    }

    /// Runs a block through every effect, in place, with the level of each of its [`Chain::sources`] for each sample
    /// of the block; a source left out is silent.
    pub fn process_keyed(&mut self, left: &mut [f32], right: &mut [f32], rate: f64, keys: &[&[f32]]) {
        const SILENT: [f32; QUANTUM] = [0.0; QUANTUM];
        let n = left.len().min(right.len());
        let mut done = 0;
        while done < n {
            let m = (n - done).min(QUANTUM);
            for &unit in &self.order {
                let (l, r) = (&mut left[done..done + m], &mut right[done..done + m]);
                match unit {
                    Unit::Device(i) => {
                        let d = &mut self.devices[i];
                        let key = match d.side {
                            Some(k) => keys.get(k).and_then(|k| k.get(done..done + m)).unwrap_or(&SILENT[..m]),
                            None => &[],
                        };
                        d.process(l, r, rate, key);
                    }
                    Unit::Stack(i) => self.stacks[i].process(l, r, rate),
                }
            }
            done += m;
        }
    }
}

/// One effect setting that automation moves (Live 12 manual, 25): which device and part of a [`Chain`] it is, and how
/// the song's value becomes the part's.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aim {
    /// Inside a stack: which (by its place in the chain's stacks) and which of its chains.
    stack: Option<(usize, usize)>,
    device: usize,
    part: usize,
    slot: Slot,
    scale: Scale,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Slot {
    /// One of the settings a cable can move (`Part::rest`).
    Rest(usize),
    /// A drive's or mix's amount.
    Amount,
    /// An LFO's rate in Hz.
    Rate,
    /// A stack's macro (its stack's chain is not used).
    Macro(usize),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Scale {
    Same,
    /// dB in the song, a gain in the part (the compressor's makeup).
    Db,
    /// Beats in the song, seconds in the part (a delay's time), at this many seconds a beat.
    Beats(f64),
}

impl Chain {
    /// Where the setting `setting` of the effect `id` in `fx` (the list this chain was made from) lives, or None when
    /// it is off, can't be moved while playing (a reverb's room, a compressor's curve) or isn't there. A built-in
    /// effect's settings are named as in its JSON (`"low"`, `"time"`, `"mix"`); a Workbench device's are
    /// `"<part id>.<setting>"`.
    #[must_use]
    pub fn aim(&self, fx: &[Value], id: &str, setting: &str, seconds_per_beat: f64) -> Option<Aim> {
        let key = fx_key(id);
        // A stack's macro ("macro1" to "macro16"), or a setting of an effect in one of its chains.
        if let Some(s) = self.stacks.iter().position(|s| s.key == key) {
            let k = setting.strip_prefix("macro")?.parse::<usize>().ok()?.checked_sub(1)?;
            return (k < self.stacks[s].macros.len()).then_some(Aim { stack: Some((s, 0)), device: 0, part: 0, slot: Slot::Macro(k), scale: Scale::Same });
        }
        let Some(device) = self.devices.iter().position(|d| d.key == key) else {
            return self.stacks.iter().enumerate().find_map(|(s, stack)| {
                stack.chains.iter().enumerate().find_map(|(c, sc)| Some(Aim { stack: Some((s, c)), ..sc.chain.as_ref()?.aim(&sc.fx, id, setting, seconds_per_beat)? }))
            });
        };
        let e = fx.iter().find(|e| e.get("id").and_then(Value::as_str) == Some(id))?;
        let (part_id, name, scale) = match e.get("kind").and_then(Value::as_str)? {
            "device" => {
                let (part, name) = setting.split_once('.')?;
                (part, name, Scale::Same)
            }
            kind => match (kind, setting) {
                ("eq", "low" | "mid" | "high") => (setting, "gain", Scale::Same),
                ("eq", "lowFreq") => ("low", "cutoff", Scale::Same),
                ("eq", "midFreq") => ("mid", "cutoff", Scale::Same),
                ("eq", "highFreq") => ("high", "cutoff", Scale::Same),
                ("eq", "midQ") => ("mid", "resonance", Scale::Same),
                ("compressor", "makeup") => ("makeup", "gain", Scale::Db),
                ("delay", "time") => ("echo", "time", Scale::Same),
                ("delay", "feedback") => ("back", "gain", Scale::Same),
                ("delay" | "reverb" | "saturator" | "chorus" | "phaser", "mix") => ("mix", "amount", Scale::Same),
                ("saturator", "drive") => ("drive", "gain", Scale::Db),
                ("saturator", "shape") => ("shape", "amount", Scale::Same),
                ("saturator", "output") | ("limiter", "gain") => (if kind == "limiter" { "gain" } else { "output" }, "gain", Scale::Db),
                ("autofilter", "cutoff") => ("f", "cutoff", Scale::Same),
                ("autofilter", "resonance") => ("f", "resonance", Scale::Same),
                ("autofilter" | "chorus" | "phaser", "rate") => ("lfo", "rate", Scale::Same),
                ("autofilter" | "chorus" | "phaser", "depth") => ("lfo", "depth", Scale::Same),
                _ => return None,
            },
        };
        let part = part_ids(e).iter().position(|p| p == part_id)?;
        let slot = match (&self.devices[device].parts.get(part)?.kind, name) {
            (Kind::Gain, "gain") | (Kind::Filter { .. }, "cutoff") | (Kind::Pan { .. }, "pan") | (Kind::Lfo { .. }, "depth") | (Kind::Delay { .. }, "time") => Slot::Rest(0),
            (Kind::Filter { kind, .. }, "resonance") if !matches!(kind, FilterType::LowShelf | FilterType::HighShelf) => Slot::Rest(1),
            (Kind::Filter { .. }, "gain") => Slot::Rest(2),
            (Kind::Drive { .. } | Kind::Mix { .. }, "amount") => Slot::Amount,
            (Kind::Lfo { .. }, "rate") => Slot::Rate,
            _ => return None,
        };
        let scale = if matches!(self.devices[device].parts[part].kind, Kind::Delay { .. }) { Scale::Beats(seconds_per_beat) } else { scale };
        Some(Aim { stack: None, device, part, slot, scale })
    }

    /// Where the setting `aim` names is now, as the song has it.
    #[must_use]
    pub fn get(&self, aim: Aim) -> f64 {
        if let Some((s, c)) = aim.stack {
            let Some(stack) = self.stacks.get(s) else { return 0.0 };
            return match aim.slot {
                Slot::Macro(k) => stack.macros.get(k).map_or(0.0, |m| m.value),
                _ => stack.chains.get(c).and_then(|c| c.chain.as_ref()).map_or(0.0, |chain| chain.get(Aim { stack: None, ..aim })),
            };
        }
        let Some(part) = self.devices.get(aim.device).and_then(|d| d.parts.get(aim.part)) else { return 0.0 };
        let value = match (aim.slot, &part.kind) {
            (Slot::Rest(k), _) => part.rest[k],
            (Slot::Amount, Kind::Drive { amount } | Kind::Mix { amount }) => *amount,
            (Slot::Rate, Kind::Lfo { rate, .. }) => *rate,
            _ => 0.0,
        };
        match aim.scale {
            Scale::Same => value,
            Scale::Db => db(value),
            Scale::Beats(spb) => value / spb,
        }
    }

    /// Puts the setting `aim` names at `value` (as the song has it), from the next sample on.
    pub fn set(&mut self, aim: Aim, value: f64) {
        if let Some((s, c)) = aim.stack {
            let Some(stack) = self.stacks.get_mut(s) else { return };
            match aim.slot {
                Slot::Macro(k) => stack.set_macro(k, value),
                _ => {
                    if let Some(chain) = stack.chains.get_mut(c).and_then(|c| c.chain.as_mut()) {
                        chain.set(Aim { stack: None, ..aim }, value);
                    }
                }
            }
            return;
        }
        let Some(part) = self.devices.get_mut(aim.device).and_then(|d| d.parts.get_mut(aim.part)) else { return };
        let value = match aim.scale {
            Scale::Same => value,
            Scale::Db => linear(value),
            Scale::Beats(spb) => (value * spb).clamp(0.0, MAX_DELAY),
        };
        match (aim.slot, &mut part.kind) {
            (Slot::Rest(k), _) => part.rest[k] = value,
            (Slot::Amount, Kind::Drive { amount }) => *amount = value.clamp(0.0, 1.0),
            (Slot::Amount, Kind::Mix { amount }) => *amount = value.clamp(0.0, 1.0),
            (Slot::Rate, Kind::Lfo { rate, .. }) => *rate = value.clamp(0.0, 40.0),
            _ => {}
        }
    }

    /// Puts the setting `aim` names back as `from` (a chain made from the same effects) has it: how a chain kept
    /// ringing through a change of song lets go of automation the song no longer has.
    pub fn copy_setting(&mut self, from: &Chain, aim: Aim) {
        if aim.stack.is_some() {
            self.set(aim, from.get(aim));
            return;
        }
        let (Some(to), Some(from)) = (self.devices.get_mut(aim.device).and_then(|d| d.parts.get_mut(aim.part)), from.devices.get(aim.device).and_then(|d| d.parts.get(aim.part))) else { return };
        match (aim.slot, &mut to.kind, &from.kind) {
            (Slot::Rest(k), _, _) => to.rest[k] = from.rest[k],
            (Slot::Amount, Kind::Drive { amount }, Kind::Drive { amount: was }) | (Slot::Amount, Kind::Mix { amount }, Kind::Mix { amount: was }) => *amount = *was,
            (Slot::Rate, Kind::Lfo { rate, .. }, Kind::Lfo { rate: was, .. }) => *rate = *was,
            _ => {}
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    const RATE: u32 = 48_000;

    /// A setting moved to `value` on a chain made with it at `base` sounds as a chain made with it at `value` does.
    fn moves_like_set(base: Value, setting: &str, value: f64, json_value: f64) {
        let input: Vec<f32> = (0..9_600).map(|i| ((i as f32) * 0.05).sin() * if i % 2_400 < 300 { 0.9 } else { 0.1 }).collect();
        let id = base["id"].as_str().unwrap().to_owned();
        let mut wanted = base.clone();
        match setting.split_once('.') {
            Some((part, name)) => {
                for p in wanted["device"]["parts"].as_array_mut().unwrap() {
                    if p["id"] == part {
                        p[name] = json!(json_value);
                    }
                }
            }
            None => wanted[setting] = json!(json_value),
        }
        let base = [base];
        let mut chain = Chain::new(&base, RATE, 0.5, false).unwrap();
        let aim = chain.aim(&base, &id, setting, 0.5).unwrap();
        chain.set(aim, value);
        let (mut l, mut r) = (input.clone(), input.clone());
        chain.process(&mut l, &mut r, f64::from(RATE));
        let mut made = Chain::new(&[wanted], RATE, 0.5, false).unwrap();
        let (mut l2, mut r2) = (input.clone(), input);
        made.process(&mut l2, &mut r2, f64::from(RATE));
        assert_eq!((l, r), (l2, r2), "{setting}");
    }

    #[test]
    fn automation_moves_each_setting_as_if_it_were_set_there() {
        let eq = json!({ "id": "e", "kind": "eq", "low": 0, "lowFreq": 120, "mid": 0, "midFreq": 1000, "midQ": 1, "high": 0, "highFreq": 6000 });
        for (setting, value) in [("low", -12.0), ("mid", 6.0), ("high", 3.0), ("lowFreq", 300.0), ("midFreq", 2_000.0), ("midQ", 4.0), ("highFreq", 9_000.0)] {
            moves_like_set(eq.clone(), setting, value, value);
        }
        let delay = json!({ "id": "d", "kind": "delay", "time": 0.75, "feedback": 0.35, "mix": 0.25 });
        for (setting, value) in [("time", 0.5), ("feedback", 0.7), ("mix", 0.9)] {
            moves_like_set(delay.clone(), setting, value, value);
        }
        moves_like_set(json!({ "id": "c", "kind": "compressor", "threshold": -20, "ratio": 4, "attack": 0.01, "release": 0.2, "makeup": 0 }), "makeup", 6.0, 6.0);
        moves_like_set(json!({ "id": "r", "kind": "reverb", "size": 1, "damp": 0.4, "mix": 0.25 }), "mix", 0.6, 0.6);
        let device = json!({ "id": "w", "kind": "device", "device": { "parts": [
            { "id": "in", "kind": "input" }, { "id": "f", "kind": "filter", "type": "lowpass", "cutoff": 800, "resonance": 0.7, "gain": 0 },
            { "id": "g", "kind": "gain", "gain": 1 }, { "id": "x", "kind": "drive", "amount": 0.2 }, { "id": "out", "kind": "output" }],
            "cables": [["in", "f"], ["f", "g"], ["g", "x"], ["x", "out"]] } });
        for (setting, value) in [("f.cutoff", 2_000.0), ("f.resonance", 3.0), ("g.gain", 0.5), ("x.amount", 0.8)] {
            moves_like_set(device.clone(), setting, value, value);
        }
        // What can't be moved while it plays, or isn't there, has no aim.
        let base = [json!({ "id": "r", "kind": "reverb", "size": 1, "damp": 0.4, "mix": 0.25 })];
        let chain = Chain::new(&base, RATE, 0.5, false).unwrap();
        assert_eq!(chain.aim(&base, "r", "size", 0.5), None);
        assert_eq!(chain.aim(&base, "nope", "mix", 0.5), None);
        // Letting go puts a moved setting back as a fresh chain has it.
        let mut moved = Chain::new(&base, RATE, 0.5, false).unwrap();
        let aim = moved.aim(&base, "r", "mix", 0.5).unwrap();
        moved.set(aim, 1.0);
        moved.copy_setting(&chain, aim);
        assert!(matches!(moved.devices[0].parts[aim.part].kind, Kind::Mix { amount } if (amount - 0.25).abs() < 1e-12));
    }

    /// `fx` run over a test sound in one go.
    fn through(fx: &Value) -> (Vec<f32>, Vec<f32>) {
        let input: Vec<f32> = (0..9_600).map(|i| ((i as f32) * 0.05).sin() * if i % 2_400 < 300 { 0.9 } else { 0.1 }).collect();
        match Chain::new(fx.as_array().unwrap(), RATE, 0.5, false) {
            Some(mut chain) => {
                let (mut l, mut r) = (input.clone(), input);
                chain.process(&mut l, &mut r, f64::from(RATE));
                (l, r)
            }
            None => (input.clone(), input),
        }
    }

    fn close(a: &[f32], b: &[f32]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5)
    }

    #[test]
    fn a_stack_adds_up_its_chains_each_through_its_own_effects() {
        let eq = json!({ "id": "e", "kind": "eq", "low": -12, "lowFreq": 300, "mid": 0, "midFreq": 1000, "midQ": 1, "high": 0, "highFreq": 6000 });
        let delay = json!({ "id": "d", "kind": "delay", "time": 0.25, "feedback": 0.3, "mix": 1 });
        let (dry, _) = through(&json!([]));
        let (eqd, _) = through(&json!([eq]));
        let (echo, _) = through(&json!([delay]));
        // Two empty chains at half volume: what comes in.
        let halves = through(&json!([{ "id": "s", "kind": "stack", "chains": [{ "fx": [], "volume": 0.5 }, { "fx": [], "volume": 0.5 }] }]));
        assert!(close(&halves.0, &dry));
        // An EQ'd chain and an echo chain side by side: the two added; a muted chain adds nothing.
        let (both, _) = through(&json!([{ "id": "s", "kind": "stack", "chains": [{ "fx": [eq] }, { "fx": [delay] }, { "fx": [], "muted": true }] }]));
        let sum: Vec<f32> = eqd.iter().zip(&echo).map(|(a, b)| a + b).collect();
        assert!(close(&both, &sum));
        // A chain panned hard right is heard only on the right.
        let (l, r) = through(&json!([{ "id": "s", "kind": "stack", "chains": [{ "fx": [], "pan": 1 }] }]));
        assert!(l.iter().all(|x| x.abs() < 1e-6) && r.iter().any(|x| x.abs() > 0.1));
        // A stack in a stack's chain is left out.
        let nested = through(&json!([{ "id": "s", "kind": "stack", "chains": [{ "fx": [{ "id": "t", "kind": "stack", "chains": [{ "fx": [], "volume": 0 }] }] }] }]));
        assert!(close(&nested.0, &dry));
    }

    #[test]
    fn a_macro_moves_its_settings_between_their_ends_and_can_be_aimed_at() {
        let stack = |low: f64, value: f64| json!([{ "id": "s", "kind": "stack",
            "chains": [{ "fx": [{ "id": "e", "kind": "eq", "low": low, "lowFreq": 300, "mid": 0, "midFreq": 1000, "midQ": 1, "high": 0, "highFreq": 6000 }] }],
            "macros": [{ "value": value, "maps": [{ "target": "fx:e:low", "min": -20, "max": 0 }] }] }]);
        // At 0.5 the macro puts the EQ's low at -10, whatever the EQ itself says.
        let plain = through(&json!([{ "id": "s", "kind": "stack", "chains": [{ "fx": [{ "id": "e", "kind": "eq", "low": -10, "lowFreq": 300, "mid": 0, "midFreq": 1000, "midQ": 1, "high": 0, "highFreq": 6000 }] }] }]));
        assert!(close(&through(&stack(0.0, 0.5)).0, &plain.0));
        // Aimed at by automation as "macro1", and an effect inside by its own id.
        let fx = stack(0.0, 0.0);
        let fx = fx.as_array().unwrap();
        let mut chain = Chain::new(fx, RATE, 0.5, false).unwrap();
        let aim = chain.aim(fx, "s", "macro1", 0.5).unwrap();
        assert_eq!(chain.get(aim), 0.0);
        chain.set(aim, 0.5);
        assert_eq!(chain.get(aim), 0.5);
        let low = chain.aim(fx, "e", "low", 0.5).unwrap();
        assert!((chain.get(low) + 10.0).abs() < 1e-9);
        assert_eq!(chain.aim(fx, "s", "macro2", 0.5), None);
        assert_eq!(chain.aim(fx, "s", "volume", 0.5), None);
    }

    fn run(fx: Value, input: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let mut chain = Chain::new(fx.as_array().unwrap(), RATE, 0.5, false).unwrap();
        let (mut l, mut r) = (input.to_vec(), input.to_vec());
        // In uneven blocks, as the audio thread asks.
        let mut at = 0;
        for size in [100, 333, 17, 4096].iter().cycle() {
            if at >= l.len() {
                break;
            }
            let end = (at + size).min(l.len());
            chain.process(&mut l[at..end], &mut r[at..end], f64::from(RATE));
            at = end;
        }
        (l, r)
    }

    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / s.len().max(1) as f64).sqrt()
    }

    fn sine(hz: f64, n: usize) -> Vec<f32> {
        (0..n).map(|i| (TAU * hz * i as f64 / f64::from(RATE)).sin() as f32 * 0.5).collect()
    }

    fn peak(s: &[f32]) -> f32 {
        s.iter().fold(0f32, |m, x| m.max(x.abs()))
    }

    #[test]
    fn a_gate_lets_through_only_what_is_loud_enough_or_what_its_key_opens() {
        // A loud second, then a quiet one: the gate at -20 dB passes the first and shuts on the second.
        let input: Vec<f32> = sine(440.0, 96_000).iter().enumerate().map(|(i, x)| if i < 48_000 { *x } else { x * 0.01 }).collect();
        let (l, _) = run(json!([{ "id": "g", "kind": "gate", "threshold": -20, "release": 0.01 }]), &input);
        assert!((rms(&l[4_800..44_000]) / rms(&input[4_800..44_000]) - 1.0).abs() < 0.01);
        assert!(peak(&l[60_000..]) < 1e-6);
        // A floor lets some through when shut.
        let (l, _) = run(json!([{ "id": "g", "kind": "gate", "threshold": -20, "release": 0.01, "floor": -20 }]), &input);
        assert!((rms(&l[60_000..]) / rms(&input[60_000..]) - 0.1).abs() < 0.01);
        // Keyed by a track that is silent, it stays shut however loud its own sound.
        let fx = json!([{ "id": "g", "kind": "gate", "threshold": -20, "sidechain": { "track": "k" } }]);
        let mut chain = Chain::new(fx.as_array().unwrap(), RATE, 0.5, false).unwrap();
        assert_eq!(chain.sources(), ["k"]);
        let (mut a, mut b) = (input.clone(), input);
        chain.process(&mut a, &mut b, f64::from(RATE));
        assert!(peak(&a) < 1e-6);
    }

    #[test]
    fn a_sidechain_eq_has_only_its_band_trigger_a_gate_or_compressor() {
        let low = sine(60.0, 48_000);
        let shut = |l: &[f32]| peak(&l[24_000..]) < 1e-6;
        // Its own loud low tone opens the gate, but not through a high-pass sidechain EQ.
        let (open, _) = run(json!([{ "id": "g", "kind": "gate", "threshold": -20 }]), &low);
        assert!(!shut(&open));
        let (l, _) = run(json!([{ "id": "g", "kind": "gate", "threshold": -20, "sidechain": { "eq": { "type": "highpass", "freq": 4000 } } }]), &low);
        assert!(shut(&l));
        // Switched off, the EQ is not there.
        let (l, _) = run(json!([{ "id": "g", "kind": "gate", "threshold": -20, "sidechain": { "eq": { "type": "highpass", "freq": 4000, "on": false } } }]), &low);
        assert_eq!(l, open);
        // Keyed by a track's low tone: a low-pass EQ lets it open the gate; a high-pass one does not.
        let quiet: Vec<f32> = sine(1_000.0, 48_000).iter().map(|x| x * 0.01).collect();
        let keyed = |eq: Value| {
            let fx = json!([{ "id": "g", "kind": "gate", "threshold": -20, "sidechain": { "track": "k", "eq": eq } }]);
            let mut chain = Chain::new(fx.as_array().unwrap(), RATE, 0.5, false).unwrap();
            let (mut a, mut b) = (quiet.clone(), quiet.clone());
            chain.process_keyed(&mut a, &mut b, f64::from(RATE), &[&low]);
            a
        };
        assert!(!shut(&keyed(json!({ "type": "lowpass", "freq": 200 }))));
        assert!(shut(&keyed(json!({ "type": "highpass", "freq": 4000 }))));
        // A compressor hears the same: a loud low tone is not turned down through a high-pass EQ.
        let loud: Vec<f32> = low.iter().map(|x| x * 0.9).collect();
        let (squashed, _) = run(json!([{ "id": "c", "kind": "compressor", "threshold": -30, "ratio": 8, "makeup": 0 }]), &loud);
        let (free, _) = run(json!([{ "id": "c", "kind": "compressor", "threshold": -30, "ratio": 8, "makeup": 0, "sidechain": { "eq": { "type": "highpass", "freq": 4000 } } }]), &loud);
        assert!(rms(&free[24_000..]) > 2.0 * rms(&squashed[24_000..]), "{} {}", rms(&free[24_000..]), rms(&squashed[24_000..]));
    }

    #[test]
    fn a_limiter_keeps_everything_under_its_ceiling() {
        let loud: Vec<f32> = sine(220.0, 48_000).iter().map(|x| x * 4.0).collect();
        let (l, r) = run(json!([{ "id": "m", "kind": "limiter", "ceiling": -1 }]), &loud);
        let ceiling = 10f32.powf(-1.0 / 20.0);
        assert!(peak(&l) <= ceiling + 1e-6 && peak(&r) <= ceiling + 1e-6);
        // Held near the ceiling once it has caught the level, not squashed far under it.
        assert!(peak(&l[24_000..]) > ceiling * 0.9);
        // Under its ceiling, it only delays.
        let quiet = sine(220.0, 4_800);
        let (l, _) = run(json!([{ "id": "m", "kind": "limiter", "ceiling": -1 }]), &quiet);
        assert!(l[72..].iter().zip(&quiet).all(|(a, b)| (a - b).abs() < 1e-6));
    }

    #[test]
    fn saturator_auto_filter_chorus_and_phaser_colour_the_sound_and_at_mix_0_pass_it() {
        let input = sine(330.0, 48_000);
        for kind in ["saturator", "chorus", "phaser"] {
            let (dry, _) = run(json!([{ "id": "x", "kind": kind, "mix": 0 }]), &input);
            assert!(dry.iter().zip(&input).all(|(a, b)| (a - b).abs() < 1e-6), "{kind}");
            let (wet, _) = run(json!([{ "id": "x", "kind": kind }]), &input);
            assert!(wet.iter().zip(&input).any(|(a, b)| (a - b).abs() > 1e-3), "{kind}");
            assert!(peak(&wet) < 2.0, "{kind}");
        }
        // The saturator rounds a loud sine off: its peaks come down relative to its body.
        let (sat, _) = run(json!([{ "id": "x", "kind": "saturator", "drive": 12, "output": -12, "mix": 1 }]), &input);
        assert!(f64::from(peak(&sat)) / rms(&sat) < f64::from(peak(&input)) / rms(&input));
        // The auto filter's LFO sweeps a low-pass over a 2 kHz tone: it comes and goes twice a second.
        let (swept, _) = run(json!([{ "id": "x", "kind": "autofilter", "cutoff": 1500, "depth": 1400, "rate": 2 }]), &sine(2_000.0, 48_000));
        let windows: Vec<f64> = (0..8).map(|k| rms(&swept[k * 6_000..(k + 1) * 6_000])).collect();
        let (lo, hi) = windows.iter().fold((f64::MAX, 0.0f64), |(a, b), x| (a.min(*x), b.max(*x)));
        assert!(hi > 3.0 * lo, "{windows:?}");
        // With no depth it is a plain low-pass.
        let (still, _) = run(json!([{ "id": "x", "kind": "autofilter", "cutoff": 500, "depth": 0 }]), &sine(4_000.0, 48_000));
        assert!(rms(&still[4_800..]) < 0.1 * rms(&sine(4_000.0, 48_000)));
        // Their settings can be moved.
        for (kind, setting) in [("saturator", "drive"), ("saturator", "shape"), ("saturator", "output"), ("autofilter", "cutoff"), ("autofilter", "depth"), ("chorus", "rate"), ("phaser", "mix"), ("limiter", "gain")] {
            let fx = [json!({ "id": "x", "kind": kind })];
            assert!(Chain::new(&fx, RATE, 0.5, false).unwrap().aim(&fx, "x", setting, 0.5).is_some(), "{kind} {setting}");
        }
    }

    #[test]
    fn filter_tails_fall_to_silence_without_denormals() {
        let mut input = sine(330.0, 48_000);
        input.resize(48_000 * 8, 0.0);
        for kind in ["phaser", "autofilter"] {
            let (l, r) = run(json!([{ "id": "x", "kind": kind }]), &input);
            assert!(l.iter().chain(&r).all(|x| !x.is_subnormal()), "{kind}");
            assert!(l[48_000 * 7..].iter().chain(&r[48_000 * 7..]).all(|x| *x == 0.0), "{kind}");
        }
    }

    #[test]
    fn a_delay_echoes_a_beat_later_each_quieter_and_switched_off_does_nothing() {
        let mut click = vec![0.0f32; 96_000];
        click[0] = 1.0;
        let fx = json!([{ "id": "fx1", "kind": "delay", "on": true, "time": 1, "feedback": 0.5, "mix": 1 }]);
        let (l, r) = run(fx, &click);
        assert_eq!(l, r);
        // No dry at mix 1 (all wet, as Live's Dry/Wet), the first echo one beat (0.5 s) later at full, the next at half.
        assert!(l[0].abs() < 1e-6);
        assert!((l[24_000] - 1.0).abs() < 1e-6, "{}", l[24_000]);
        // The second comes round the loop, so 128 samples later as Web Audio has it.
        assert!((l[48_128] - 0.5).abs() < 1e-6, "{}", l[48_128]);
        assert!((l[72_256] - 0.25).abs() < 1e-6, "{}", l[72_256]);
        assert!(l[1..24_000].iter().all(|x| x.abs() < 1e-9));
        let off = json!([{ "id": "fx1", "kind": "delay", "on": false, "time": 1, "feedback": 0.5, "mix": 1 }]);
        assert!(Chain::new(off.as_array().unwrap(), RATE, 0.5, false).is_none());
    }

    #[test]
    fn an_eq_cut_takes_the_lows_down_and_leaves_the_highs() {
        let fx = json!([{ "id": "fx1", "kind": "eq", "on": true, "low": -18, "lowFreq": 200, "mid": 0, "midFreq": 1000, "midQ": 1, "high": 0, "highFreq": 6000 }]);
        let low = run(fx.clone(), &sine(60.0, 48_000)).0;
        let high = run(fx, &sine(4000.0, 48_000)).0;
        let ratio_db = |s: &[f32]| 20.0 * (rms(&s[24_000..]) / rms(&sine(60.0, 48_000)[24_000..])).log10();
        assert!(ratio_db(&low) < -15.0, "{}", ratio_db(&low));
        assert!(ratio_db(&high).abs() < 1.0, "{}", ratio_db(&high));
    }

    #[test]
    fn a_compressor_turns_a_loud_sound_down_more_than_a_quiet_one() {
        let fx = json!([{ "id": "fx1", "kind": "compressor", "on": true, "threshold": -30, "ratio": 8, "attack": 0.003, "release": 0.25, "makeup": 0 }]);
        let loud = sine(200.0, 48_000);
        let quiet: Vec<f32> = loud.iter().map(|x| x * 0.01).collect();
        let gain = |input: &[f32]| rms(&run(fx.clone(), input).0[24_000..]) / rms(&input[24_000..]);
        assert!(gain(&loud) < 0.5 * gain(&quiet), "{} {}", gain(&loud), gain(&quiet));
    }

    #[test]
    fn a_reverb_rings_on_in_stereo_after_the_sound_stops() {
        let fx = json!([{ "id": "fx1", "kind": "reverb", "on": true, "size": 1, "damp": 0.4, "mix": 1 }]);
        let mut burst = sine(300.0, 96_000);
        burst[4800..].fill(0.0);
        let (l, r) = run(fx, &burst);
        assert!(rms(&l[24_000..30_000]) > 1e-3 && rms(&r[24_000..30_000]) > 1e-3);
        assert!(l != r, "the room is different left and right");
        assert!(rms(&l[60_000..]) < 1e-4, "gone after its size");
    }

    #[test]
    fn a_device_lfo_moves_a_filter_and_its_sound_passes_the_ceiling() {
        let device = json!({ "name": "Wah", "parts": [
            { "id": "in", "kind": "input" }, { "id": "f", "kind": "filter", "type": "lowpass", "cutoff": 800, "resonance": 0.7, "gain": 0 },
            { "id": "w", "kind": "lfo", "rate": 2, "depth": 700, "shape": "sine" }, { "id": "out", "kind": "output" }
        ], "cables": [["in", "f"], ["w", "f.cutoff"], ["f", "out"]], "controls": [] });
        let fx = json!([{ "id": "fx1", "kind": "device", "on": true, "device": device }]);
        let (l, _) = run(fx, &sine(1200.0, 48_000));
        // The cutoff swings 100 to 1500 Hz twice a second: the 1200 Hz tone comes and goes.
        let windows: Vec<f64> = (0..8).map(|k| rms(&l[k * 6000..(k + 1) * 6000])).collect();
        let (lo, hi) = windows.iter().fold((f64::MAX, 0.0f64), |(a, b), x| (a.min(*x), b.max(*x)));
        assert!(hi > 3.0 * lo, "{windows:?}");
        assert!(l.iter().all(|x| x.abs() <= 1.0));
    }

    #[test]
    fn a_tracks_pan_keeps_each_side_to_its_own_channel() {
        assert_eq!(balance(0.3, 0.7, 0.0), (0.3, 0.7));
        let (l, r) = balance(1.0, 1.0, 1.0);
        assert!(l.abs() < 1e-12 && (r - std::f64::consts::SQRT_2).abs() < 1e-12);
        let (l, r) = balance(1.0, 0.0, 1.0);
        assert!(l.abs() < 1e-12 && r.abs() < 1e-12, "the far channel is not folded in");
    }

    #[test]
    fn a_stereo_panner_moves_the_far_side_over() {
        assert_eq!(pan(1.0, 1.0, -1.0, true), (2.0, 0.0));
        let (l, r) = pan(1.0, 1.0, -1.0, false);
        assert!((l - 1.0).abs() < 1e-12 && r.abs() < 1e-12);
    }
}
