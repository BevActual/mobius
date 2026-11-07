//! The engine Mobius runs models with: the official `llama-server` from llama.cpp (MIT), built for this computer's
//! graphics card. Mobius picks the build, downloads it from the llama.cpp releases on GitHub, checks every file
//! against the SHA-256 GitHub publishes for it, unpacks it into its own folder, and asks it which devices it can use.
//! Nothing is installed system-wide and nothing else on the computer is used or changed.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::download::Progress;

/// Where releases are listed. The `latest` release is not used: the project tags builds `b<number>`, and other
/// tags have appeared there.
pub const RELEASES: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";
/// Files are only fetched from here.
pub const DOWNLOAD_PREFIX: &str = "https://github.com/ggml-org/llama.cpp/releases/download/";

const MAX_ASSET_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_LISTING_BYTES: u64 = 8 * 1024 * 1024;
const CHUNK: usize = 256 * 1024;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EngineError {
    #[error("Mobius can install the engine on 64-bit Windows for now; elsewhere, install llama-server and Mobius will find it")]
    Unsupported,
    #[error("no recent llama.cpp release has a build for this computer")]
    NoBuild,
    #[error("could not reach GitHub: {0}")]
    Network(String),
    #[error("GitHub answered with HTTP {0}")]
    Status(u16),
    #[error("the download is damaged: {0}")]
    Corrupt(String),
    #[error("not enough disk space: {needed} bytes needed, {available} available")]
    NoSpace { needed: u64, available: u64 },
    #[error("cancelled")]
    Cancelled,
    #[error("could not write the engine: {0}")]
    Io(String),
}

fn io(e: &std::io::Error) -> EngineError {
    EngineError::Io(e.to_string())
}

/// Which build of llama.cpp.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Backend {
    /// NVIDIA, driver 580 or newer.
    Cuda13,
    /// NVIDIA, driver 528 or newer.
    Cuda12,
    /// Any graphics card with Vulkan (AMD, Intel, older NVIDIA drivers).
    Vulkan,
    Cpu,
}

impl Backend {
    pub fn label(self) -> &'static str {
        match self {
            Backend::Cuda13 => "NVIDIA (CUDA 13)",
            Backend::Cuda12 => "NVIDIA (CUDA 12)",
            Backend::Vulkan => "Vulkan",
            Backend::Cpu => "Processor only",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Backend::Cuda13 => "cuda-13",
            Backend::Cuda12 => "cuda-12",
            Backend::Vulkan => "vulkan",
            Backend::Cpu => "cpu",
        }
    }

    /// Whether a build's kind (the part after `win-` in the file name, before `-x64`) is this backend.
    fn matches(self, kind: &str) -> bool {
        match self {
            Backend::Cuda13 => kind.starts_with("cuda-13."),
            Backend::Cuda12 => kind.starts_with("cuda-12."),
            Backend::Vulkan => kind == "vulkan",
            Backend::Cpu => kind == "cpu",
        }
    }

    fn needs_runtime(self) -> bool {
        matches!(self, Backend::Cuda13 | Backend::Cuda12)
    }
}

/// `nvidia-smi --query-gpu=driver_version --format=csv,noheader`, first card: "560.94" -> (560, 94).
pub fn parse_driver(output: &str) -> Option<(u32, u32)> {
    let line = output.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut parts = line.split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = parts.next().map_or(Some(0), |m| m.trim().parse().ok())?;
    Some((major, minor))
}

pub fn nvidia_driver() -> Option<(u32, u32)> {
    let mut command = Command::new("nvidia-smi");
    command.args(["--query-gpu=driver_version", "--format=csv,noheader"]);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000);
    let output = command.output().ok()?;
    output.status.success().then(|| parse_driver(&String::from_utf8_lossy(&output.stdout))).flatten()
}

/// The build for this computer: CUDA for an NVIDIA card whose driver can run it, otherwise Vulkan, which also falls
/// back to the processor when there is no card it can use.
pub fn pick_backend(nvidia_driver: Option<(u32, u32)>) -> Backend {
    match nvidia_driver {
        Some((major, _)) if major >= 580 => Backend::Cuda13,
        Some((major, _)) if major >= 528 => Backend::Cuda12,
        _ => Backend::Vulkan,
    }
}

/// The platform part of the file names, when Mobius knows how to install here.
pub fn platform() -> Option<&'static str> {
    (cfg!(windows) && cfg!(target_arch = "x86_64")).then_some("win")
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

/// What to install: one release, one build, every file it needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Plan {
    pub tag: String,
    pub backend: Backend,
    pub assets: Vec<Asset>,
}

impl Plan {
    pub fn size(&self) -> u64 {
        self.assets.iter().map(|a| a.size).sum()
    }
}

fn is_build_tag(tag: &str) -> bool {
    tag.len() > 1 && tag.len() <= 12 && tag.starts_with('b') && tag[1..].bytes().all(|b| b.is_ascii_digit())
}

fn checked(asset: &GithubAsset, tag: &str, prefix: &str) -> Option<Asset> {
    let sha = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    let ok = sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) && asset.size > 0 && asset.size <= MAX_ASSET_BYTES && asset.browser_download_url == format!("{prefix}{tag}/{}", asset.name);
    ok.then(|| Asset { name: asset.name.clone(), url: asset.browser_download_url.clone(), size: asset.size, sha256: sha.to_ascii_lowercase() })
}

/// The newest release that has this build with everything it needs, each file with a checksum and from `prefix`.
pub fn plan(releases: &[Release], platform: &str, backend: Backend, prefix: &str) -> Result<Plan, EngineError> {
    for release in releases.iter().filter(|r| is_build_tag(&r.tag_name)) {
        let tag = &release.tag_name;
        let head = format!("llama-{tag}-bin-{platform}-");
        let main = release.assets.iter().find_map(|a| {
            let kind = a.name.strip_prefix(&head)?.strip_suffix("-x64.zip")?;
            backend.matches(kind).then_some((kind, a))
        });
        let Some((kind, main)) = main else { continue };
        let Some(main) = checked(main, tag, prefix) else { continue };
        let mut assets = vec![main];
        if backend.needs_runtime() {
            let name = format!("cudart-llama-bin-{platform}-{kind}-x64.zip");
            let Some(runtime) = release.assets.iter().find(|a| a.name == name).and_then(|a| checked(a, tag, prefix)) else { continue };
            assets.push(runtime);
        }
        return Ok(Plan { tag: tag.clone(), backend, assets });
    }
    Err(EngineError::NoBuild)
}

/// For the release list: small, so the whole call is bounded.
fn listing_agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_connect(Some(Duration::from_secs(15))).timeout_global(Some(Duration::from_secs(30))).user_agent("Mobius").build().into()
}

/// For the builds: hundreds of megabytes, so no limit on the whole body (cancel stops it); GitHub redirects to its
/// file servers, and from the real site never to plain http.
fn download_agent(https: bool) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(5)
        .https_only(https)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .user_agent("Mobius")
        .build()
        .into()
}

/// Ask GitHub for recent releases. `url` is `RELEASES` except in tests.
pub fn fetch_releases(url: &str) -> Result<Vec<Release>, EngineError> {
    let response = listing_agent().get(url).header("Accept", "application/vnd.github+json").call().map_err(|e| EngineError::Network(e.to_string()))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(EngineError::Status(status));
    }
    let mut body = Vec::new();
    response.into_body().into_reader().take(MAX_LISTING_BYTES).read_to_end(&mut body).map_err(|e| EngineError::Network(e.to_string()))?;
    serde_json::from_slice(&body).map_err(|e| EngineError::Network(format!("the release list could not be read: {e}")))
}

/// The engine Mobius installed, as remembered in `current.json` in its folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Installed {
    pub tag: String,
    pub backend: Backend,
    /// `llama-server`, inside the engine folder.
    pub server: PathBuf,
    /// The devices it reported when installed. Empty: it runs on the processor.
    #[serde(default)]
    pub devices: Vec<String>,
}

const CURRENT: &str = "current.json";

fn server_name() -> &'static str {
    if cfg!(windows) { "llama-server.exe" } else { "llama-server" }
}

/// The installed engine, if its program is still there and inside `dir`.
pub fn installed(dir: &Path) -> Option<Installed> {
    let text = fs::read_to_string(dir.join(CURRENT)).ok()?;
    let found: Installed = serde_json::from_str(&text).ok()?;
    let root = fs::canonicalize(dir).ok()?;
    let server = fs::canonicalize(&found.server).ok()?;
    (server.starts_with(&root) && server.is_file() && server.file_name().is_some_and(|n| n == server_name())).then_some(Installed { server: found.server, ..found })
}

fn fetch(agent: &ureq::Agent, asset: &Asset, to: &Path, progress: &Progress, cancel: &AtomicBool) -> Result<(), EngineError> {
    let response = agent.get(&asset.url).call().map_err(|e| EngineError::Network(e.to_string()))?;
    let status = response.status().as_u16();
    if status != 200 {
        return Err(EngineError::Status(status));
    }
    let mut reader = response.into_body().into_reader();
    let mut out = File::create(to).map_err(|e| io(&e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    let mut written = 0u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(EngineError::Cancelled);
        }
        let n = reader.read(&mut buf).map_err(|e| EngineError::Network(e.to_string()))?;
        if n == 0 {
            break;
        }
        written += n as u64;
        if written > asset.size {
            return Err(EngineError::Corrupt(format!("{} is longer than GitHub said", asset.name)));
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| io(&e))?;
        progress.done.fetch_add(n as u64, Ordering::Relaxed);
    }
    out.flush().map_err(|e| io(&e))?;
    let sha: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if written != asset.size || sha != asset.sha256 {
        return Err(EngineError::Corrupt(format!("{} does not match its checksum", asset.name)));
    }
    Ok(())
}

/// Unpack a zip into `into`. Every entry must stay inside the folder; links and oversized archives are refused.
pub fn unpack(zip_path: &Path, into: &Path) -> Result<(), EngineError> {
    let bad = |m: &str| EngineError::Corrupt(m.to_owned());
    let mut archive = zip::ZipArchive::new(File::open(zip_path).map_err(|e| io(&e))?).map_err(|e| bad(&e.to_string()))?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| bad(&e.to_string()))?;
        let relative = entry.enclosed_name().ok_or_else(|| bad("an entry points outside the engine folder"))?;
        if entry.is_symlink() {
            return Err(bad("the archive contains a link"));
        }
        let path = into.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| io(&e))?;
            continue;
        }
        total += entry.size();
        if total > MAX_UNPACKED_BYTES {
            return Err(bad("the archive is too large"));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| io(&e))?;
        }
        let mut out = File::create(&path).map_err(|e| io(&e))?;
        let size = entry.size();
        let copied = std::io::copy(&mut (&mut entry).take(size + 1), &mut out).map_err(|e| io(&e))?;
        if copied != size {
            return Err(bad("an entry is not the size it says"));
        }
    }
    Ok(())
}

/// Where `llama-server` is in an unpacked build: at the top, or one folder down.
fn find_server(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join(server_name());
    if direct.is_file() {
        return Some(direct);
    }
    fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e| e.path().join(server_name())).find(|p| p.is_file())
}

fn free_space(path: &Path) -> Option<u64> {
    let path = fs::canonicalize(path).ok()?;
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks.iter().filter(|d| path.starts_with(d.mount_point())).max_by_key(|d| d.mount_point().as_os_str().len()).map(sysinfo::Disk::available_space)
}

/// Download, check and unpack `plan` into `dir`, then make it the engine Mobius uses. The engine in use until now
/// stays until the new one is complete; older ones are removed afterwards when nothing holds them.
pub fn install(plan: &Plan, dir: &Path, progress: &Progress, cancel: &AtomicBool, assume_space: Option<u64>) -> Result<Installed, EngineError> {
    fs::create_dir_all(dir).map_err(|e| io(&e))?;
    let needed = plan.size().saturating_mul(3);
    if let Some(available) = assume_space.or_else(|| free_space(dir))
        && needed > available
    {
        return Err(EngineError::NoSpace { needed, available });
    }
    progress.total.store(plan.size(), Ordering::Relaxed);
    progress.done.store(0, Ordering::Relaxed);
    let name = format!("{}-{}", plan.tag, plan.backend.id());
    let target = dir.join(&name);
    let staging = dir.join(format!("{name}.part"));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| io(&e))?;
    let result = (|| {
        let agent = download_agent(plan.assets.iter().all(|a| a.url.starts_with("https://")));
        for asset in &plan.assets {
            let zip = dir.join(format!("{}.download", asset.name));
            let fetched = fetch(&agent, asset, &zip, progress, cancel);
            let unpacked = fetched.and_then(|()| unpack(&zip, &staging));
            let _ = fs::remove_file(&zip);
            unpacked?;
        }
        if find_server(&staging).is_none() {
            return Err(EngineError::Corrupt("the build has no llama-server".into()));
        }
        let _ = fs::remove_dir_all(&target);
        fs::rename(&staging, &target).map_err(|e| io(&e))?;
        let server = find_server(&target).ok_or_else(|| EngineError::Corrupt("the build has no llama-server".into()))?;
        let devices = devices_within(&server, FIRST_START);
        let installed = Installed { tag: plan.tag.clone(), backend: plan.backend, server, devices };
        remember(dir, &installed)?;
        Ok(installed)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    } else {
        remove_old(dir, &name);
    }
    result
}

fn remember(dir: &Path, installed: &Installed) -> Result<(), EngineError> {
    let json = serde_json::to_string_pretty(installed).map_err(|e| EngineError::Io(e.to_string()))?;
    let tmp = dir.join(format!("{CURRENT}.tmp"));
    fs::write(&tmp, json).map_err(|e| io(&e))?;
    fs::rename(&tmp, dir.join(CURRENT)).map_err(|e| io(&e))
}

/// Ask the installed engine again which devices it can use, and remember the answer.
pub fn recheck(dir: &Path) -> Option<Installed> {
    let mut current = installed(dir)?;
    current.devices = devices_within(&current.server, FIRST_START);
    remember(dir, &current).ok()?;
    Some(current)
}

/// Remove engines other than `keep`. One that is running cannot be removed on Windows; it goes next time.
fn remove_old(dir: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != keep && entry.path().is_dir() && name.starts_with('b') && name.contains('-') {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// The devices an engine can use, as it reports them (`llama-server --list-devices`). Empty: processor only.
pub fn devices(server: &Path) -> Vec<String> {
    devices_within(server, Duration::from_secs(20))
}

/// The first start of a newly unpacked engine can be slow (the system scans the new files), so installing waits longer.
const FIRST_START: Duration = Duration::from_secs(120);

pub fn devices_within(server: &Path, limit: Duration) -> Vec<String> {
    let mut command = Command::new(server);
    command.arg("--list-devices").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000);
    let Ok(mut child) = command.spawn() else { return Vec::new() };
    let started = Instant::now();
    while matches!(child.try_wait(), Ok(None)) {
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Vec::new();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let mut text = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut text);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut text);
    }
    parse_devices(&text)
}

pub fn parse_devices(text: &str) -> Vec<String> {
    text.lines()
        .skip_while(|l| !l.trim_start().starts_with("Available devices"))
        .skip(1)
        .take_while(|l| l.starts_with(' ') || l.starts_with('\t'))
        .map(str::trim)
        .filter(|l| !l.is_empty() && *l != "(none)")
        .map(|l| l.chars().take(200).collect())
        .take(16)
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn asset(tag: &str, name: &str, digest: bool) -> GithubAsset {
        GithubAsset { name: name.into(), size: 1_000, browser_download_url: format!("{DOWNLOAD_PREFIX}{tag}/{name}"), digest: digest.then(|| format!("sha256:{}", "ab".repeat(32))) }
    }

    fn release(tag: &str, names: &[&str]) -> Release {
        Release { tag_name: tag.into(), assets: names.iter().map(|n| asset(tag, &n.replace("{tag}", tag), true)).collect() }
    }

    fn full(tag: &str) -> Release {
        release(tag, &["llama-{tag}-bin-win-cpu-x64.zip", "llama-{tag}-bin-win-vulkan-x64.zip", "llama-{tag}-bin-win-cuda-12.4-x64.zip", "llama-{tag}-bin-win-cuda-13.5-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-13.5-x64.zip", "llama-{tag}-bin-win-cuda-13.5-arm64.zip"])
    }

    #[test]
    fn the_driver_decides_the_build() {
        assert_eq!(parse_driver("560.94\n"), Some((560, 94)));
        assert_eq!(parse_driver("  581.15\n560.1\n"), Some((581, 15)));
        assert_eq!(parse_driver("NVIDIA-SMI has failed"), None);
        assert_eq!(pick_backend(Some((560, 94))), Backend::Cuda12);
        assert_eq!(pick_backend(Some((580, 0))), Backend::Cuda13);
        assert_eq!(pick_backend(Some((528, 0))), Backend::Cuda12);
        assert_eq!(pick_backend(Some((527, 99))), Backend::Vulkan, "too old for CUDA 12");
        assert_eq!(pick_backend(None), Backend::Vulkan);
    }

    #[test]
    fn the_newest_complete_build_is_chosen_with_its_cuda_runtime() {
        let releases = vec![Release { tag_name: "v0.9.0".into(), assets: vec![] }, full("b12180"), full("b12179")];
        let p = plan(&releases, "win", Backend::Cuda12, DOWNLOAD_PREFIX).unwrap();
        assert_eq!(p.tag, "b12180");
        assert_eq!(p.assets.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["llama-b12180-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip"]);
        let p = plan(&releases, "win", Backend::Cuda13, DOWNLOAD_PREFIX).unwrap();
        assert_eq!(p.assets[0].name, "llama-b12180-bin-win-cuda-13.5-x64.zip", "never the arm64 build");
        assert_eq!(p.assets[1].name, "cudart-llama-bin-win-cuda-13.5-x64.zip");
        let p = plan(&releases, "win", Backend::Vulkan, DOWNLOAD_PREFIX).unwrap();
        assert_eq!(p.assets.len(), 1, "Vulkan needs no CUDA runtime");
        assert_eq!(p.size(), 1_000);
    }

    #[test]
    fn a_build_without_a_checksum_its_runtime_or_from_elsewhere_is_skipped() {
        let mut no_digest = full("b12180");
        no_digest.assets.iter_mut().for_each(|a| a.digest = None);
        let mut no_runtime = full("b12179");
        no_runtime.assets.retain(|a| !a.name.starts_with("cudart"));
        let mut elsewhere = full("b12178");
        elsewhere.assets.iter_mut().for_each(|a| a.browser_download_url = a.browser_download_url.replace("github.com", "github.com.evil.example"));
        let mut too_big = full("b12177");
        too_big.assets.iter_mut().for_each(|a| a.size = MAX_ASSET_BYTES + 1);
        let good = full("b12100");
        let releases = vec![no_digest, no_runtime, elsewhere, too_big, good];
        assert_eq!(plan(&releases, "win", Backend::Cuda12, DOWNLOAD_PREFIX).unwrap().tag, "b12100");
        assert_eq!(plan(&releases[..4], "win", Backend::Cuda12, DOWNLOAD_PREFIX), Err(EngineError::NoBuild));
        assert_eq!(plan(&releases[..1], "win", Backend::Vulkan, DOWNLOAD_PREFIX), Err(EngineError::NoBuild), "a missing checksum is never accepted");
        assert_eq!(plan(&releases[..2], "win", Backend::Vulkan, DOWNLOAD_PREFIX).unwrap().tag, "b12179", "Vulkan needs no CUDA runtime");
    }

    #[test]
    fn devices_are_read_from_what_the_engine_prints() {
        let text = "ggml_cuda_init: found 1 CUDA devices\nAvailable devices:\n  CUDA0: NVIDIA GeForce RTX 4080 Laptop GPU (12281 MiB, 11000 MiB free)\n";
        assert_eq!(parse_devices(text), ["CUDA0: NVIDIA GeForce RTX 4080 Laptop GPU (12281 MiB, 11000 MiB free)"]);
        assert!(parse_devices("Available devices:\n  (none)\n").is_empty());
        assert!(parse_devices("nothing here").is_empty());
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> tempfile_like::Dir {
        let dir = tempfile_like::Dir::new();
        let file = File::create(dir.0.join("a.zip")).unwrap();
        let mut w = zip::ZipWriter::new(file);
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
        dir
    }

    #[test]
    fn unpacking_stays_inside_the_engine_folder() {
        let ok = zip_with(&[("llama-server.exe", b"x"), ("lib/ggml.dll", b"yy")]);
        let into = ok.0.join("out");
        unpack(&ok.0.join("a.zip"), &into).unwrap();
        assert_eq!(fs::read(into.join("lib/ggml.dll")).unwrap(), b"yy");
        for evil in ["../escape.txt", "/abs.txt", "C:/abs.txt"] {
            let bad = zip_with(&[(evil, b"x")]);
            let into = bad.0.join("out");
            assert!(matches!(unpack(&bad.0.join("a.zip"), &into), Err(EngineError::Corrupt(_))), "{evil}");
            assert!(!bad.0.join("escape.txt").exists());
        }
    }

    /// A temporary folder without another dependency.
    mod tempfile_like {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Dir {
                static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
                let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let d = std::env::temp_dir().join(format!("mobius-engine-{}-{n}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
                std::fs::create_dir_all(&d).unwrap();
                Dir(d)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}
