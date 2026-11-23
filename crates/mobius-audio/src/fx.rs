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

/// A compressor as browsers make Web Audio's `DynamicsCompressorNode` (Chromium's kernel, which Firefox shares): a
/// static curve with a soft knee; a detector that follows the attenuation; a gain that slews down for attack at a
/// rate set by the deepest cut asked for, and back up for release along an adaptive curve (faster from deeper cuts),
/// updated every 32 samples; a 6 ms look-ahead; and the whole lifted by 0.6 of the gain it takes at full level.
struct Compressor {
    /// Keyed by another track (Live 12 manual, 29.9.1): that track's level, raised by `gain`, triggers it in the share
    /// `mix` of the sidechain to its own sound.
    side: Option<(f64, f64)>,
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
            side: None,
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
        self.side = Some((linear(gain_db.clamp(-70.0, 24.0)), mix.clamp(0.0, 1.0)));
        self.makeup = 1.0;
    }

    /// `key` is the keying track's level now (0 when it isn't keyed).
    fn process(&mut self, l: f32, r: f32, key: f32) -> (f32, f32) {
        if self.division == 0 {
            self.plan();
        }
        self.division = (self.division + 1) % DIVISION;
        let own = f64::from(l.abs().max(r.abs()));
        let level = match self.side {
            Some((gain, mix)) => (1.0 - mix) * own + mix * gain * f64::from(key),
            None => own,
        };
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

enum Kind {
    Input,
    Output,
    Gain,
    Filter { kind: FilterType, state: [[f64; 4]; 2], cached: Option<([f64; 3], Coefficients)> },
    Delay { ring: Vec<(f32, f32)>, at: usize, feedback: bool },
    Lfo { rate: f64, wave: Wave, phase: f64 },
    Drive { amount: f64 },
    Compressor(Box<Compressor>),
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
                    let kind = match p.get("type").and_then(Value::as_str).unwrap_or("lowpass") {
                        "highpass" => FilterType::HighPass,
                        "bandpass" => FilterType::BandPass,
                        "lowshelf" => FilterType::LowShelf,
                        "highshelf" => FilterType::HighShelf,
                        "peaking" => FilterType::Peaking,
                        "notch" => FilterType::Notch,
                        _ => FilterType::LowPass,
                    };
                    // A shelf has no resonance in Web Audio, so it rests at the node's own 1.
                    let shelf = matches!(kind, FilterType::LowShelf | FilterType::HighShelf);
                    rest = [num(p, "cutoff", 1000.0), if shelf { 1.0 } else { num(p, "resonance", 1.0) }, num(p, "gain", 0.0)];
                    Kind::Filter { kind, state: [[0.0; 4]; 2], cached: None }
                }
                "delay" => {
                    rest[0] = (num(p, "time", 0.75) * seconds_per_beat).clamp(0.0, MAX_DELAY);
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
                    Kind::Lfo { rate: num(p, "rate", 1.0).clamp(0.0, 40.0), wave, phase: 0.0 }
                }
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
                if matches!(p.kind, Kind::Reverb(_) | Kind::Pan { .. } | Kind::Compressor(_)) {
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
                let (dry, wet) = ((1.0 - *amount * 0.5) as f32, *amount as f32);
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
}

impl Chain {
    /// The chain for a track's `fx` list, or None when there is nothing to run. `stereo_in` says whether the track's
    /// sound comes in with two channels (a drum panned on its pad).
    #[must_use]
    pub fn new(fx: &[Value], rate: u32, seconds_per_beat: f64, stereo_in: bool) -> Option<Chain> {
        let rate = f64::from(rate);
        let mut seed = 0x2545_F491u32;
        let mut stereo = stereo_in;
        let mut devices = Vec::new();
        let mut sources: Vec<String> = Vec::new();
        for e in fx.iter().take(16) {
            if e.get("on").and_then(Value::as_bool) == Some(false) {
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
                        if let Kind::Compressor(c) = &mut part.kind {
                            c.key(gain, mix);
                            keyed = true;
                        }
                    }
                    if keyed {
                        d.side = Some(sources.iter().position(|s| s == track).unwrap_or_else(|| {
                            sources.push(track.to_owned());
                            sources.len() - 1
                        }));
                    }
                }
                stereo = d.stereo_out();
                devices.push(d);
            }
        }
        (!devices.is_empty()).then_some(Chain { devices, stereo_out: stereo, sources })
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
            for d in &mut self.devices {
                let key = match d.side {
                    Some(k) => keys.get(k).and_then(|k| k.get(done..done + m)).unwrap_or(&SILENT[..m]),
                    None => &[],
                };
                d.process(&mut left[done..done + m], &mut right[done..done + m], rate, key);
            }
            done += m;
        }
    }
}

/// One effect setting that automation moves (Live 12 manual, 25): which device and part of a [`Chain`] it is, and how
/// the song's value becomes the part's.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aim {
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
        let device = self.devices.iter().position(|d| d.key == key)?;
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
                ("delay" | "reverb", "mix") => ("mix", "amount", Scale::Same),
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
        Some(Aim { device, part, slot, scale })
    }

    /// Puts the setting `aim` names at `value` (as the song has it), from the next sample on.
    pub fn set(&mut self, aim: Aim, value: f64) {
        let Some(part) = self.devices.get_mut(aim.device).and_then(|d| d.parts.get_mut(aim.part)) else { return };
        let value = match aim.scale {
            Scale::Same => value,
            Scale::Db => linear(value),
            Scale::Beats(spb) => (value * spb).clamp(0.0, MAX_DELAY),
        };
        match (aim.slot, &mut part.kind) {
            (Slot::Rest(k), _) => part.rest[k] = value,
            (Slot::Amount, Kind::Drive { amount }) => *amount = value.clamp(0.0, 1.0),
            (Slot::Amount, Kind::Mix { amount }) => *amount = value,
            (Slot::Rate, Kind::Lfo { rate, .. }) => *rate = value.clamp(0.0, 40.0),
            _ => {}
        }
    }

    /// Puts the setting `aim` names back as `from` (a chain made from the same effects) has it: how a chain kept
    /// ringing through a change of song lets go of automation the song no longer has.
    pub fn copy_setting(&mut self, from: &Chain, aim: Aim) {
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

    #[test]
    fn a_delay_echoes_a_beat_later_each_quieter_and_switched_off_does_nothing() {
        let mut click = vec![0.0f32; 96_000];
        click[0] = 1.0;
        let fx = json!([{ "id": "fx1", "kind": "delay", "on": true, "time": 1, "feedback": 0.5, "mix": 1 }]);
        let (l, r) = run(fx, &click);
        assert_eq!(l, r);
        // Dry at half (1 - mix / 2), the first echo one beat (0.5 s) later at full, the next at half that.
        assert!((l[0] - 0.5).abs() < 1e-6);
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
    fn a_stereo_panner_moves_the_far_side_over() {
        assert_eq!(pan(1.0, 1.0, -1.0, true), (2.0, 0.0));
        let (l, r) = pan(1.0, 1.0, -1.0, false);
        assert!((l - 1.0).abs() < 1e-12 && r.abs() < 1e-12);
    }
}
