//! Will a model run here, and which ones are worth running.

use crate::gguf::{bits_per_weight, is_known_quant, quality_from_bits};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

const GIB: u64 = 1024 * 1024 * 1024;
/// What the GPU needs beyond the weights: buffers for working through the prompt.
const GPU_OVERHEAD: u64 = GIB;
/// How much of free memory a model may use before the computer starts to struggle.
const RAM_SHARE: f64 = 0.8;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Hardware {
    pub gpu_name: Option<String>,
    #[ts(type = "number")]
    pub vram_total: u64,
    #[ts(type = "number")]
    pub vram_free: u64,
    #[ts(type = "number")]
    pub ram_total: u64,
    #[ts(type = "number")]
    pub ram_free: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Fit {
    /// Everything fits in graphics memory: fast.
    Gpu,
    /// Part of it spills into ordinary memory: works, slower.
    Split,
    /// No usable GPU, but it fits in memory: slow.
    Cpu,
    TooBig,
}

impl Fit {
    pub fn rank(self) -> u8 {
        match self {
            Fit::Gpu => 0,
            Fit::Split => 1,
            Fit::Cpu => 2,
            Fit::TooBig => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Assessment {
    pub fit: Fit,
    /// Graphics memory wanted to run entirely on the GPU, weights plus working space.
    #[ts(type = "number")]
    pub needed: u64,
    /// The share of the model that can sit on the GPU (1 when all of it does).
    pub gpu_fraction: f64,
}

/// Memory beyond the weights: the conversation so far (the KV cache, at the default 16k tokens) and working buffers.
fn working_space(weights: u64) -> u64 {
    (GIB + GIB / 2).max(weights / 6)
}

pub fn assess(weights: u64, hardware: &Hardware) -> Assessment {
    let needed = weights.saturating_add(working_space(weights));
    let too_big = Assessment { fit: Fit::TooBig, needed, gpu_fraction: 0.0 };
    if weights == 0 {
        return too_big;
    }
    let ram_allowance = (hardware.ram_free as f64 * RAM_SHARE) as u64;
    if hardware.vram_total == 0 {
        let fits = needed <= ram_allowance;
        return Assessment { fit: if fits { Fit::Cpu } else { Fit::TooBig }, needed, gpu_fraction: 0.0 };
    }
    if needed <= hardware.vram_free {
        return Assessment { fit: Fit::Gpu, needed, gpu_fraction: 1.0 };
    }
    let on_gpu = hardware.vram_free.saturating_sub(GPU_OVERHEAD).min(weights);
    let on_cpu = weights - on_gpu;
    if on_cpu.saturating_add(GIB) <= ram_allowance {
        Assessment { fit: Fit::Split, needed, gpu_fraction: (on_gpu as f64 / weights as f64).min(0.95) }
    } else {
        too_big
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Candidate {
    pub repo: String,
    pub file: String,
    pub quant: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number | null")]
    pub params_b: Option<f64>,
    #[ts(type = "number")]
    pub downloads: u64,
    #[ts(type = "number")]
    pub likes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Recommendation {
    pub candidate: Candidate,
    pub assessment: Assessment,
    /// Billions of parameters, from the name or estimated from the file.
    pub params_b: f64,
    pub score: f64,
    /// 0 to 1, how much of the original model the quantisation keeps.
    pub quality: f64,
}

/// Billions of parameters and bits per weight, from the file where the name cannot be trusted. A repository
/// named for 27 billion parameters can hold a 3 GB helper file: the file's size says what it really is.
fn effective(candidate: &Candidate) -> (f64, f64) {
    let bits_of_file = |params: f64| candidate.size as f64 * 8.0 / (params * 1e9);
    let known = is_known_quant(&candidate.quant).then(|| bits_per_weight(&candidate.quant));
    match (candidate.params_b, known) {
        (Some(params), Some(bits)) => {
            let ratio = bits_of_file(params) / bits;
            if (0.67..=1.5).contains(&ratio) { (params, bits) } else { (candidate.size as f64 * 8.0 / bits / 1e9, bits) }
        }
        (Some(params), None) => (params, bits_of_file(params).clamp(1.0, 16.0)),
        (None, bits) => {
            let bits = bits.unwrap_or(4.5);
            (candidate.size as f64 * 8.0 / bits / 1e9, bits)
        }
    }
}

/// The models worth running here, best first. Each repository appears once, with the file that suits this
/// computer: the best quality that still fits as well as it can. Anything that cannot run is left out.
pub fn recommend(candidates: Vec<Candidate>, hardware: &Hardware, limit: usize) -> Vec<Recommendation> {
    let mut best: Vec<Recommendation> = Vec::new();
    for candidate in candidates {
        let assessment = assess(candidate.size, hardware);
        if assessment.fit == Fit::TooBig {
            continue;
        }
        let (params_b, bits) = effective(&candidate);
        let score = params_b * quality_from_bits(bits, candidate.quant.starts_with("UD-"));
        let quality = quality_from_bits(bits, candidate.quant.starts_with("UD-"));
        let entry = Recommendation { candidate, assessment, params_b, score, quality };
        match best.iter_mut().find(|existing| existing.candidate.repo == entry.candidate.repo) {
            None => best.push(entry),
            Some(existing) => {
                let better = (entry.assessment.fit.rank(), -entry.quality) < (existing.assessment.fit.rank(), -existing.quality);
                if better {
                    *existing = entry;
                }
            }
        }
    }
    best.sort_by(|a, b| {
        a.assessment
            .fit
            .rank()
            .cmp(&b.assessment.fit.rank())
            .then(b.score.total_cmp(&a.score))
            .then(b.candidate.downloads.cmp(&a.candidate.downloads))
            .then(a.candidate.repo.cmp(&b.candidate.repo))
    });
    best.truncate(limit);
    best
}
