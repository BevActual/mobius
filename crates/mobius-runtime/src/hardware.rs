//! What this computer has to run a model with.

use crate::fit::Hardware;
use std::process::Command;

#[derive(Debug, Clone, PartialEq)]
pub struct GpuInfo {
    pub name: String,
    pub total: u64,
    pub free: u64,
}

const MIB: u64 = 1024 * 1024;

/// Reads `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits`.
/// With several GPUs the one with the most free memory is used. Lines that do not fit are skipped.
pub fn parse_nvidia_smi(output: &str) -> Option<GpuInfo> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().rsplitn(3, ',');
            let free: u64 = parts.next()?.trim().parse().ok()?;
            let total: u64 = parts.next()?.trim().parse().ok()?;
            let name = parts.next()?.trim();
            (!name.is_empty() && total > 0 && free <= total).then(|| GpuInfo { name: name.to_owned(), total: total * MIB, free: free * MIB })
        })
        .max_by_key(|gpu| gpu.free)
}

fn read_gpu() -> Option<GpuInfo> {
    let output = Command::new("nvidia-smi").args(["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"]).output().ok()?;
    output.status.success().then(|| parse_nvidia_smi(&String::from_utf8_lossy(&output.stdout))).flatten()
}

/// Looks at this computer now. Free memory changes, so ask again before relying on it.
pub fn detect() -> Hardware {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let gpu = read_gpu();
    Hardware {
        gpu_name: gpu.as_ref().map(|g| g.name.clone()),
        vram_total: gpu.as_ref().map_or(0, |g| g.total),
        vram_free: gpu.as_ref().map_or(0, |g| g.free),
        ram_total: system.total_memory(),
        ram_free: system.available_memory(),
    }
}
