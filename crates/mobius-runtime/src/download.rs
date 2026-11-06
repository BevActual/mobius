//! Downloading a model: resumable, checked against Hugging Face's hash, and stored where the local scan finds it.

use crate::hub::{HubClient, RepoFile, percent_encode, safe_file_path, valid_repo_id};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

const CHUNK: usize = 256 * 1024;
const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("that is not a file Mobius will download")]
    BadName,
    #[error("there is nothing to download")]
    Empty,
    #[error("not enough disk space: {needed} bytes needed, {available} available")]
    NoSpace { needed: u64, available: u64 },
    #[error("Hugging Face answered with HTTP {0}")]
    Status(u16),
    #[error("could not download: {0}")]
    Network(String),
    #[error("the downloaded file is damaged: {0}")]
    Corrupt(String),
    #[error("cancelled")]
    Cancelled,
    #[error("could not write the file: {0}")]
    Io(String),
}

/// How far a download has got. Shared with whoever is watching.
#[derive(Debug, Default)]
pub struct Progress {
    done: AtomicU64,
    total: AtomicU64,
}
impl Progress {
    pub fn done(&self) -> u64 {
        self.done.load(Ordering::Relaxed)
    }
    pub fn total(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Free space to assume instead of asking the disk (tests use this).
    pub available_space: Option<u64>,
}

fn io(error: &std::io::Error) -> DownloadError {
    DownloadError::Io(error.to_string())
}

fn free_space(path: &Path) -> Option<u64> {
    let path = fs::canonicalize(path).ok()?;
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks.iter().filter(|d| path.starts_with(d.mount_point())).max_by_key(|d| d.mount_point().as_os_str().len()).map(sysinfo::Disk::available_space)
}

fn sha256_of(path: &Path) -> Result<String, DownloadError> {
    let mut file = File::open(path).map_err(|e| io(&e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buf).map_err(|e| io(&e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn part_path(final_path: &Path) -> PathBuf {
    let mut name = final_path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    final_path.with_file_name(name)
}

/// Fetches the files of one model (every part, when split) into `dest_root`, in the layout Hugging Face's own tools use.
pub fn download(client: &HubClient, repo: &str, files: &[RepoFile], dest_root: &Path, progress: &Progress, cancel: &AtomicBool, options: &Options) -> Result<Vec<PathBuf>, DownloadError> {
    if !valid_repo_id(repo) || files.iter().any(|f| !safe_file_path(&f.path) || !f.path.to_ascii_lowercase().ends_with(".gguf")) {
        return Err(DownloadError::BadName);
    }
    if files.is_empty() {
        return Err(DownloadError::Empty);
    }
    let folder = dest_root.join(format!("models--{}", repo.replace('/', "--"))).join("snapshots").join("main");
    let target = |file: &RepoFile| folder.join(&file.path);

    let total: u64 = files.iter().map(|f| f.size).sum();
    let mut already = 0u64;
    for file in files {
        let final_path = target(file);
        already += match fs::metadata(&final_path) {
            Ok(meta) if meta.len() == file.size => file.size,
            _ => fs::metadata(part_path(&final_path)).map(|m| m.len().min(file.size)).unwrap_or(0),
        };
    }
    progress.total.store(total, Ordering::Relaxed);
    progress.done.store(already, Ordering::Relaxed);
    let needed = total - already;
    fs::create_dir_all(&folder).map_err(|e| io(&e))?;
    let (available, margin) = match options.available_space {
        Some(space) => (Some(space), 0),
        None => (free_space(&folder), GIB),
    };
    if let Some(available) = available
        && needed.saturating_add(margin) > available
    {
        return Err(DownloadError::NoSpace { needed, available });
    }

    let agent = client.download_agent();
    let mut paths = Vec::new();
    for file in files {
        let final_path = target(file);
        if fs::metadata(&final_path).is_ok_and(|m| m.len() == file.size) {
            paths.push(final_path);
            continue;
        }
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent).map_err(|e| io(&e))?;
        }
        fetch_one(&agent, client.base(), repo, file, &final_path, progress, cancel)?;
        paths.push(final_path);
    }
    Ok(paths)
}

fn fetch_one(agent: &ureq::Agent, base: &str, repo: &str, file: &RepoFile, final_path: &Path, progress: &Progress, cancel: &AtomicBool) -> Result<(), DownloadError> {
    let part = part_path(final_path);
    let encoded: Vec<String> = file.path.split('/').map(percent_encode).collect();
    let url = format!("{base}/{repo}/resolve/main/{}", encoded.join("/"));
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > file.size {
        fs::remove_file(&part).ok();
        progress.done.fetch_sub(file.size.min(progress.done()), Ordering::Relaxed);
        have = 0;
    }
    if cancel.load(Ordering::SeqCst) {
        return Err(DownloadError::Cancelled);
    }
    if have < file.size {
        let mut request = agent.get(&url);
        if have > 0 {
            request = request.header("Range", format!("bytes={have}-"));
        }
        let response = request.call().map_err(|e| DownloadError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        let append = match status {
            206 => true,
            200 => false,
            other => return Err(DownloadError::Status(other)),
        };
        if !append && have > 0 {
            // The server sent everything again: start over rather than gluing a whole file onto a piece.
            progress.done.fetch_sub(have.min(progress.done()), Ordering::Relaxed);
        }
        let mut out = OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(&part).map_err(|e| io(&e))?;
        let mut reader = response.into_body().into_reader();
        let mut buf = vec![0u8; CHUNK];
        let mut written = if append { have } else { 0 };
        loop {
            if cancel.load(Ordering::SeqCst) {
                out.flush().ok();
                return Err(DownloadError::Cancelled);
            }
            let n = reader.read(&mut buf).map_err(|e| DownloadError::Network(e.to_string()))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > file.size {
                drop(out);
                fs::remove_file(&part).ok();
                return Err(DownloadError::Corrupt("the file is longer than expected".into()));
            }
            out.write_all(&buf[..n]).map_err(|e| io(&e))?;
            progress.done.fetch_add(n as u64, Ordering::Relaxed);
        }
        out.flush().map_err(|e| io(&e))?;
    }
    let length = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if length != file.size {
        fs::remove_file(&part).ok();
        return Err(DownloadError::Corrupt(format!("expected {} bytes, got {length}", file.size)));
    }
    if let Some(expected) = &file.sha256 {
        let actual = sha256_of(&part)?;
        if !actual.eq_ignore_ascii_case(expected) {
            fs::remove_file(&part).ok();
            return Err(DownloadError::Corrupt("the checksum does not match".into()));
        }
    }
    fs::rename(&part, final_path).map_err(|e| io(&e))
}
