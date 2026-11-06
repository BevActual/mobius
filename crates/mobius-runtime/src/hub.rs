//! Finding models on Hugging Face: searching, and listing the files of a repository.

use crate::fit::Candidate;
use crate::gguf::{FileKind, classify, params_from_name, parse_quant, parse_shard};
use serde_json::Value;
use std::io::Read;
use std::time::Duration;

const MAX_RESPONSE: usize = 8 * 1024 * 1024;
const MAX_LIMIT: u32 = 50;

#[derive(Debug, thiserror::Error)]
pub enum HubError {
    #[error("that is not a repository name")]
    BadRepo,
    #[error("the address is not allowed: {0}")]
    BadAddress(String),
    #[error("could not reach Hugging Face: {0}")]
    Network(String),
    #[error("Hugging Face answered with HTTP {0}")]
    Status(u16),
    #[error("the answer was too large")]
    TooLarge,
    #[error("the answer was not in the expected form: {0}")]
    Format(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sort {
    Downloads,
    Trending,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RepoSummary {
    pub id: String,
    pub downloads: u64,
    pub likes: u64,
    pub pipeline_tag: Option<String>,
    /// Needs an account and agreement to download. Mobius does not handle those.
    pub gated: bool,
}

impl RepoSummary {
    /// Language models, as opposed to speech, image and other kinds.
    pub fn is_text_model(&self) -> bool {
        match self.pipeline_tag.as_deref() {
            None => true,
            Some(tag) => matches!(tag, "text-generation" | "image-text-to-text" | "conversational" | "any-to-any" | "text2text-generation"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RepoFile {
    pub path: String,
    pub size: u64,
    pub sha256: Option<String>,
}

pub fn valid_repo_id(id: &str) -> bool {
    let ok_part = |part: &str| !part.is_empty() && part != "." && part != ".." && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if id.len() > 140 {
        return false;
    }
    let mut parts = id.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(a), Some(b), None) if ok_part(a) && ok_part(b))
}

pub fn safe_file_path(path: &str) -> bool {
    !path.is_empty() && !path.starts_with('/') && !path.contains(['\\', ':', '\0']) && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

pub(crate) fn percent_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn parse_search(json: &str) -> Result<Vec<RepoSummary>, HubError> {
    let value: Value = serde_json::from_str(json).map_err(|e| HubError::Format(e.to_string()))?;
    let items = value.as_array().ok_or_else(|| HubError::Format("a list was expected".into()))?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?;
            valid_repo_id(id).then(|| RepoSummary {
                id: id.to_owned(),
                downloads: item.get("downloads").and_then(Value::as_u64).unwrap_or(0),
                likes: item.get("likes").and_then(Value::as_u64).unwrap_or(0),
                pipeline_tag: item.get("pipeline_tag").and_then(Value::as_str).map(str::to_owned),
                gated: !matches!(item.get("gated"), None | Some(Value::Bool(false)) | Some(Value::Null)),
            })
        })
        .collect())
}

pub fn parse_tree(json: &str) -> Result<Vec<RepoFile>, HubError> {
    let value: Value = serde_json::from_str(json).map_err(|e| HubError::Format(e.to_string()))?;
    let items = value.as_array().ok_or_else(|| HubError::Format("a list was expected".into()))?;
    Ok(items
        .iter()
        .filter_map(|item| {
            if item.get("type")?.as_str()? != "file" {
                return None;
            }
            let path = item.get("path")?.as_str()?;
            if !safe_file_path(path) {
                return None;
            }
            let lfs = item.get("lfs");
            let size = lfs.and_then(|l| l.get("size")).and_then(Value::as_u64).or_else(|| item.get("size").and_then(Value::as_u64))?;
            Some(RepoFile { path: path.to_owned(), size, sha256: lfs.and_then(|l| l.get("oid")).and_then(Value::as_str).map(str::to_owned) })
        })
        .collect())
}

/// Removes the `-00001-of-00003` part from a name so the parts of one model share a key.
fn without_shard(path: &str) -> String {
    match path.find("-of-") {
        Some(at) if at >= 6 => format!("{}{}", &path[..at - 6], &path[(at + 10).min(path.len())..]),
        _ => path.to_owned(),
    }
}

/// The runnable models in a repository. A model split over several files counts once, when every part is there.
pub fn candidates_from(repo: &RepoSummary, files: &[RepoFile]) -> Vec<Candidate> {
    if repo.gated || !repo.is_text_model() {
        return Vec::new();
    }
    struct Group {
        total: u32,
        parts: Vec<(u32, String, u64)>,
    }
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, Group> = std::collections::HashMap::new();
    for file in files.iter().filter(|f| classify(&f.path) == FileKind::Model) {
        let (part, total) = parse_shard(&file.path).unwrap_or((1, 1));
        let key = without_shard(&file.path);
        let group = groups.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            Group { total, parts: Vec::new() }
        });
        group.parts.push((part, file.path.clone(), file.size));
    }
    let params_b = params_from_name(&repo.id);
    order
        .iter()
        .filter_map(|key| {
            let group = groups.get(key)?;
            let mut numbers: Vec<u32> = group.parts.iter().map(|p| p.0).collect();
            numbers.sort_unstable();
            numbers.dedup();
            if numbers != (1..=group.total).collect::<Vec<_>>() {
                return None;
            }
            let first = group.parts.iter().find(|p| p.0 == 1)?;
            Some(Candidate {
                repo: repo.id.clone(),
                file: first.1.clone(),
                quant: parse_quant(&first.1).unwrap_or_default(),
                size: group.parts.iter().map(|p| p.2).sum(),
                params_b,
                downloads: repo.downloads,
                likes: repo.likes,
            })
        })
        .collect()
}

/// The files that make up one chosen model: its parts, when it is split, and nothing else.
pub fn files_of_model(files: &[RepoFile], file: &str) -> Option<Vec<RepoFile>> {
    if classify(file) != FileKind::Model || !files.iter().any(|f| f.path == file) {
        return None;
    }
    let (part, total) = parse_shard(file).unwrap_or((1, 1));
    if part != 1 {
        return None;
    }
    let key = without_shard(file);
    let mut parts: Vec<(u32, &RepoFile)> = files.iter().filter(|f| classify(&f.path) == FileKind::Model && without_shard(&f.path) == key).map(|f| (parse_shard(&f.path).map_or(1, |s| s.0), f)).collect();
    parts.sort_by_key(|p| p.0);
    parts.dedup_by_key(|p| p.0);
    (parts.len() == total as usize && parts.iter().enumerate().all(|(i, p)| p.0 as usize == i + 1)).then(|| parts.into_iter().map(|p| p.1.clone()).collect())
}

pub struct HubClient {
    base: String,
    agent: ureq::Agent,
}

impl HubClient {
    /// `base` is `https://huggingface.co`. Plain http is accepted only for this computer, which is what tests use.
    pub fn new(base: &str) -> Result<Self, HubError> {
        let base = base.trim_end_matches('/').to_owned();
        let local = ["http://127.0.0.1", "http://localhost", "http://[::1]"].iter().any(|prefix| base.strip_prefix(prefix).is_some_and(|rest| rest.is_empty() || rest.starts_with(':')));
        if !(base.starts_with("https://") || local) {
            return Err(HubError::BadAddress(base));
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(30)))
            .user_agent("mobius")
            .build()
            .into();
        Ok(HubClient { base, agent })
    }

    pub(crate) fn base(&self) -> &str {
        &self.base
    }

    /// For big files: follows the redirect to the content server, but never to plain http when talking to the real site.
    pub(crate) fn download_agent(&self) -> ureq::Agent {
        ureq::Agent::config_builder()
            .max_redirects(5)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .https_only(self.base.starts_with("https://"))
            .timeout_connect(Some(Duration::from_secs(15)))
            .user_agent("mobius")
            .build()
            .into()
    }

    fn get(&self, path_and_query: &str) -> Result<String, HubError> {
        let response = self.agent.get(&format!("{}{path_and_query}", self.base)).call().map_err(|e| HubError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(HubError::Status(status));
        }
        let mut body = Vec::new();
        response.into_body().into_reader().take(MAX_RESPONSE as u64 + 1).read_to_end(&mut body).map_err(|e| HubError::Network(e.to_string()))?;
        if body.len() > MAX_RESPONSE {
            return Err(HubError::TooLarge);
        }
        String::from_utf8(body).map_err(|_| HubError::Format("not text".into()))
    }

    pub fn search(&self, query: &str, sort: Sort, limit: u32) -> Result<Vec<RepoSummary>, HubError> {
        let query: String = query.trim().chars().take(100).collect();
        let sort = match sort {
            Sort::Downloads => "downloads",
            Sort::Trending => "trendingScore",
        };
        let search = if query.is_empty() { String::new() } else { format!("search={}&", percent_encode(&query)) };
        parse_search(&self.get(&format!("/api/models?{search}filter=gguf&sort={sort}&direction=-1&limit={}", limit.clamp(1, MAX_LIMIT)))?)
    }

    pub fn files(&self, repo: &str) -> Result<Vec<RepoFile>, HubError> {
        if !valid_repo_id(repo) {
            return Err(HubError::BadRepo);
        }
        parse_tree(&self.get(&format!("/api/models/{repo}/tree/main?recursive=true"))?)
    }
}
