//! Models already on this computer.

use crate::gguf::{FileKind, classify, parse_quant, parse_shard};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use ts_rs::TS;

const MAX_DEPTH: usize = 3;
const MAX_FILES: usize = 5000;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct LocalModel {
    pub id: String,
    pub repo: Option<String>,
    pub file: String,
    #[ts(type = "string")]
    pub path: PathBuf,
    pub quant: Option<String>,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "string | null")]
    pub projector: Option<PathBuf>,
}

struct Found {
    path: PathBuf,
    rel: String,
    size: u64,
}

fn walk(dir: &Path, rel: &str, depth: usize, out: &mut Vec<Found>, skip_cache_folders: bool) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = fs::metadata(entry.path()) else { continue };
        let rel_path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if meta.is_dir() {
            if depth < MAX_DEPTH && !(skip_cache_folders && name.starts_with("models--")) {
                walk(&entry.path(), &rel_path, depth + 1, out, skip_cache_folders);
            }
        } else if meta.is_file() && meta.len() > 0 && classify(&name) != FileKind::Other {
            out.push(Found { path: entry.path(), rel: rel_path, size: meta.len() });
        }
    }
}

fn newest_snapshot(snapshots: &Path) -> Option<PathBuf> {
    fs::read_dir(snapshots)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let meta = fs::metadata(e.path()).ok()?;
            meta.is_dir().then(|| (meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), e.path()))
        })
        .max_by_key(|(time, _)| *time)
        .map(|(_, path)| path)
}

fn repo_of(folder: &str) -> Option<String> {
    let rest = folder.strip_prefix("models--")?;
    let (org, name) = rest.split_once("--")?;
    (!org.is_empty() && !name.is_empty()).then(|| format!("{org}/{name}"))
}

fn assemble(found: Vec<Found>, repo: Option<&str>, seen: &mut HashSet<PathBuf>, models: &mut Vec<LocalModel>) {
    let mut projectors: HashMap<PathBuf, Vec<&Found>> = HashMap::new();
    for f in found.iter().filter(|f| classify(&f.rel) == FileKind::Projector) {
        projectors.entry(f.path.parent().map(Path::to_path_buf).unwrap_or_default()).or_default().push(f);
    }
    // The parts of one split model share a key; a model is listed once, from its first part, when all parts are present.
    type Parts<'a> = Vec<(u32, u32, &'a Found)>;
    let mut groups: Vec<(PathBuf, Parts)> = Vec::new();
    for f in found.iter().filter(|f| classify(&f.rel) == FileKind::Model) {
        let (part, total) = parse_shard(&f.rel).unwrap_or((1, 1));
        let parent = f.path.parent().map(Path::to_path_buf).unwrap_or_default();
        let stem = f.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let key = parent.join(match stem.find("-of-") {
            Some(at) if total > 1 && at >= 6 => format!("{}{}", &stem[..at - 6], &stem[(at + 10).min(stem.len())..]),
            _ => stem,
        });
        match groups.iter_mut().find(|g| g.0 == key) {
            Some(g) => g.1.push((part, total, f)),
            None => groups.push((key, vec![(part, total, f)])),
        }
    }
    for (_, parts) in groups {
        let total = parts[0].1;
        let mut numbers: Vec<u32> = parts.iter().map(|p| p.0).collect();
        numbers.sort_unstable();
        numbers.dedup();
        if numbers != (1..=total).collect::<Vec<_>>() {
            continue;
        }
        let Some(first) = parts.iter().find(|p| p.0 == 1).map(|p| p.2) else { continue };
        let canonical = fs::canonicalize(&first.path).unwrap_or_else(|_| first.path.clone());
        if !seen.insert(canonical) {
            continue;
        }
        let file = first.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let projector = projectors.get(&first.path.parent().map(Path::to_path_buf).unwrap_or_default()).and_then(|list| {
            list.iter().find(|p| p.rel.to_ascii_lowercase().contains("f16")).or_else(|| list.first()).map(|p| p.path.clone())
        });
        models.push(LocalModel {
            id: match repo {
                Some(repo) => format!("{repo}/{file}"),
                None => first.path.to_string_lossy().into_owned(),
            },
            repo: repo.map(str::to_owned),
            file,
            path: first.path.clone(),
            quant: parse_quant(&first.rel),
            size: parts.iter().map(|p| p.2.size).sum(),
            projector,
        });
    }
}

/// Every model file under the given folders: the Hugging Face cache layout and ordinary folders alike.
pub fn scan(roots: &[PathBuf]) -> Vec<LocalModel> {
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else { continue };
        let mut names: Vec<_> = entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in names.iter().filter(|n| n.starts_with("models--")) {
            let Some(repo) = repo_of(name) else { continue };
            let Some(snapshot) = newest_snapshot(&root.join(name).join("snapshots")) else { continue };
            let mut found = Vec::new();
            walk(&snapshot, "", 1, &mut found, false);
            assemble(found, Some(&repo), &mut seen, &mut models);
        }
        let mut found = Vec::new();
        walk(root, "", 0, &mut found, true);
        assemble(found, None, &mut seen, &mut models);
    }
    models
}
