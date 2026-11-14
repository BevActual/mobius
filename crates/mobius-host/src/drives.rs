//! Drives: folders kept on a server the person already runs or pays for, opened from the Files app beside the
//! workspace. The first kind is **WebDAV**, which Nextcloud, ownCloud, Synology, QNAP, Fastmail Files, Apache and nginx
//! all speak. Other kinds (S3-style storage, network shares) are other implementations of [`Drive`].
//!
//! Nothing is copied or kept in step: each call goes to the server. A change is sent with the version (ETag) of the
//! file it was based on, so a file changed on the server since it was read is refused rather than overwritten, and a
//! new file never replaces one that appeared meanwhile.
//!
//! Accounts are kept in `drives.json` in the data folder; their passwords in the system's secret store.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::calendar_accounts::{Node, clean_name, new_id, same_site, server_url, xml};
use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

const MAX_DRIVES: usize = 20;
/// The largest file read or written in one go. Bigger files need chunked upload, which comes later.
pub const MAX_FILE: usize = 32 * 1024 * 1024;
const MAX_LISTING: u64 = 8 * 1024 * 1024;

/// Said when a file changed on the server since it was read; the window shows it as a conflict.
pub const CHANGED: &str = "That file changed on the server since you opened it.";
/// Said when something with that name appeared in the meantime.
pub const EXISTS: &str = "Something with that name is already there.";

/// One thing in a drive folder.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// From the drive's top, `/`-separated, without a leading or trailing slash.
    pub path: String,
    pub folder: bool,
    pub size: u64,
    /// As the server gave it (an HTTP date).
    pub modified: Option<String>,
    /// The version to send back with a change.
    pub etag: Option<String>,
    pub content_type: Option<String>,
}

/// A file read from a drive.
#[derive(Debug)]
pub struct File {
    pub bytes: Vec<u8>,
    pub etag: Option<String>,
    pub content_type: Option<String>,
}

/// A place files are kept. Paths are relative to the drive's top folder.
pub trait Drive: Send + Sync {
    /// The drive's top folder is there and the account may read it.
    fn check(&self) -> Res<()>;
    fn list(&self, folder: &str) -> Res<Vec<Entry>>;
    fn read(&self, path: &str) -> Res<File>;
    /// With `etag`, replaces the file only if it is still that version; without, makes a new file and never replaces
    /// one. Returns the new version when the server says it.
    fn write(&self, path: &str, bytes: &[u8], etag: Option<&str>) -> Res<Option<String>>;
    fn make_folder(&self, path: &str) -> Res<()>;
    /// Moves or renames; never replaces what is at `to`.
    fn rename(&self, from: &str, to: &str) -> Res<()>;
    /// With `etag`, only if it is still that version.
    fn delete(&self, path: &str, etag: Option<&str>) -> Res<()>;
}

/// A drive path split into its names. Empty, `.` and `..` names are refused so a path cannot leave the drive.
fn names(path: &str) -> Res<Vec<String>> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Ok(Vec::new());
    }
    path.split('/')
        .map(|n| {
            if n.is_empty() || n == "." || n == ".." || n.contains('\\') || n.chars().any(char::is_control) {
                Err(format!("\"{path}\" is not a path on the drive."))
            } else {
                Ok(n.to_owned())
            }
        })
        .collect()
}

fn decoded(path: &str) -> Vec<String> {
    path.split('/').filter(|s| !s.is_empty()).map(|s| percent_decode_str(s).decode_utf8_lossy().into_owned()).collect()
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .allow_non_standard_methods(true)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(300)))
        .user_agent("Mobius")
        .build()
        .into()
}

// ---- WebDAV ---------------------------------------------------------------------------------------------------------

struct Reply {
    status: u16,
    etag: Option<String>,
    content_type: Option<String>,
    body: Vec<u8>,
}

const PROPS: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:getcontenttype/></d:prop></d:propfind>"#;

pub struct WebDav {
    /// The drive's top folder; always ends in `/`.
    base: url::Url,
    username: String,
    password: String,
    http: ureq::Agent,
}

impl WebDav {
    pub fn new(base: url::Url, username: &str, password: &str) -> WebDav {
        WebDav::with_agent(base, username, password, http_agent())
    }

    fn with_agent(mut base: url::Url, username: &str, password: &str, http: ureq::Agent) -> WebDav {
        if !base.path().ends_with('/') {
            let path = format!("{}/", base.path());
            base.set_path(&path);
        }
        base.set_query(None);
        base.set_fragment(None);
        WebDav { base, username: username.to_owned(), password: password.to_owned(), http }
    }

    pub fn base(&self) -> &url::Url {
        &self.base
    }

    fn url_of(&self, path: &str, folder: bool) -> Res<url::Url> {
        let names = names(path)?;
        let mut url = self.base.clone();
        {
            let mut segments = url.path_segments_mut().map_err(|()| "That server address cannot hold files.".to_owned())?;
            segments.pop_if_empty();
            segments.extend(&names);
            if folder || names.is_empty() {
                segments.push("");
            }
        }
        Ok(url)
    }

    /// The drive path an answer's `href` names, or `None` when it is outside the drive.
    fn path_of(&self, href: &str) -> Option<String> {
        let url = self.base.join(href.trim()).ok()?;
        let (base, at) = (decoded(self.base.path()), decoded(url.path()));
        at.starts_with(&base).then(|| at[base.len()..].join("/"))
    }

    /// One request, following up to five redirects. The password goes only to the same site.
    fn send(&self, method: &str, url: &url::Url, headers: &[(&str, String)], body: &[u8], limit: usize) -> Res<Reply> {
        let mut at = url.clone();
        for _ in 0..6 {
            let mut builder = ureq::http::Request::builder().method(method).uri(at.as_str());
            if same_site(url, &at) {
                use base64::Engine;
                let pair = format!("{}:{}", self.username, self.password);
                builder = builder.header("Authorization", format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(pair)));
            }
            for (k, v) in headers {
                builder = builder.header(*k, v.as_str());
            }
            let request = builder.body(body.to_vec()).map_err(|e| e.to_string())?;
            let mut response = self.http.run(request).map_err(|e| format!("Could not reach {}: {e}", at.host_str().unwrap_or("the server")))?;
            let status = response.status().as_u16();
            let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
            let (etag, content_type, location) = (header("etag"), header("content-type"), header("location"));
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                let next = location.as_deref().and_then(|l| at.join(l).ok()).filter(|u| matches!(u.scheme(), "https" | "http"));
                at = next.ok_or("The server sent Mobius somewhere it could not follow.")?;
                continue;
            }
            let limit = u64::try_from(limit).unwrap_or(u64::MAX);
            let body = response.body_mut().with_config().limit(limit).read_to_vec().map_err(|e| match e {
                ureq::Error::BodyExceedsLimit(_) => format!("That file is bigger than {} MB, the most Mobius opens from a drive for now.", MAX_FILE / (1024 * 1024)),
                e => e.to_string(),
            })?;
            return Ok(Reply { status, etag, content_type, body });
        }
        Err("The server sent Mobius round in circles.".into())
    }

    fn propfind(&self, url: &url::Url, depth: &str) -> Res<(u16, Option<Node>)> {
        let headers = [("Depth", depth.to_owned()), ("Content-Type", "application/xml; charset=utf-8".to_owned())];
        let reply = self.send("PROPFIND", url, &headers, PROPS.as_bytes(), usize::try_from(MAX_LISTING).unwrap_or(usize::MAX))?;
        let doc = if reply.status == 207 { Some(xml(&String::from_utf8_lossy(&reply.body))?) } else { None };
        Ok((reply.status, doc))
    }

    fn entries(&self, doc: &Node) -> Vec<Entry> {
        let mut responses = Vec::new();
        doc.all("response", &mut responses);
        responses
            .into_iter()
            .filter_map(|r| {
                let path = self.path_of(&r.find("href")?.text)?;
                // Properties the server has come in a propstat whose status is 200; missing ones in a 404 one.
                let found: Vec<&Node> = r.children.iter().filter(|c| c.name == "propstat" && c.text_of("status").is_none_or(|s| s.contains(" 200"))).collect();
                let prop = |name: &str| found.iter().find_map(|p| p.text_of(name)).filter(|t| !t.is_empty());
                let folder = found.iter().any(|p| p.first("resourcetype").is_some_and(|t| t.find("collection").is_some()));
                Some(Entry {
                    name: path.rsplit('/').next().unwrap_or("").to_owned(),
                    size: prop("getcontentlength").and_then(|s| s.parse().ok()).unwrap_or(0),
                    modified: prop("getlastmodified"),
                    etag: prop("getetag"),
                    content_type: prop("getcontenttype").filter(|_| !folder),
                    folder,
                    path,
                })
            })
            .collect()
    }

    /// Why a request did not work, in the person's words.
    pub(crate) fn failed(status: u16, etag: Option<&str>) -> String {
        match status {
            401 => "The server did not accept the drive's name and password. Nextcloud and Fastmail need an app password, made in the account's security settings.".into(),
            403 => "The server does not let this account do that.".into(),
            404 => "That is not on the drive any more.".into(),
            409 => "The folder it goes in is not on the drive.".into(),
            412 if etag.is_some() => CHANGED.into(),
            412 => EXISTS.into(),
            413 => "The server refused a file that size.".into(),
            423 => "That file is locked on the server.".into(),
            507 => "The drive is full.".into(),
            s => format!("The server answered {s}."),
        }
    }

    fn version_of(&self, path: &str) -> Option<String> {
        let (_, doc) = self.propfind(&self.url_of(path, false).ok()?, "0").ok()?;
        self.entries(&doc?).into_iter().next().and_then(|e| e.etag)
    }
}

impl Drive for WebDav {
    fn check(&self) -> Res<()> {
        match self.propfind(&self.base, "0")? {
            (207, Some(doc)) if self.entries(&doc).iter().any(|e| e.path.is_empty() && e.folder) => Ok(()),
            (207, _) => Err("That address is a file, not a folder.".into()),
            (status, _) => Err(WebDav::failed(status, None)),
        }
    }

    fn list(&self, folder: &str) -> Res<Vec<Entry>> {
        let at = names(folder)?.join("/");
        match self.propfind(&self.url_of(folder, true)?, "1")? {
            (207, Some(doc)) => {
                let mut out: Vec<Entry> = self.entries(&doc).into_iter().filter(|e| e.path != at && e.path.rsplit_once('/').map_or("", |(p, _)| p) == at).collect();
                out.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
                Ok(out)
            }
            (status, _) => Err(WebDav::failed(status, None)),
        }
    }

    fn read(&self, path: &str) -> Res<File> {
        let url = self.url_of(path, false)?;
        if names(path)?.is_empty() {
            return Err("That is a folder.".into());
        }
        let reply = self.send("GET", &url, &[], &[], MAX_FILE)?;
        match reply.status {
            200 => Ok(File { bytes: reply.body, etag: reply.etag, content_type: reply.content_type }),
            s => Err(WebDav::failed(s, None)),
        }
    }

    fn write(&self, path: &str, bytes: &[u8], etag: Option<&str>) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("A file needs a name.".into());
        }
        if bytes.len() > MAX_FILE {
            return Err(format!("Files bigger than {} MB cannot be sent to a drive yet.", MAX_FILE / (1024 * 1024)));
        }
        let url = self.url_of(path, false)?;
        let condition = etag.map_or(("If-None-Match", "*".to_owned()), |e| ("If-Match", e.to_owned()));
        let reply = self.send("PUT", &url, &[condition, ("Content-Type", "application/octet-stream".to_owned())], bytes, 64 * 1024)?;
        match reply.status {
            200 | 201 | 204 => Ok(reply.etag.or_else(|| self.version_of(path))),
            s => Err(WebDav::failed(s, etag)),
        }
    }

    fn make_folder(&self, path: &str) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("A folder needs a name.".into());
        }
        let reply = self.send("MKCOL", &self.url_of(path, true)?, &[], &[], 64 * 1024)?;
        match reply.status {
            200 | 201 | 204 => Ok(()),
            405 => Err(EXISTS.into()),
            s => Err(WebDav::failed(s, None)),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Res<()> {
        if names(from)?.is_empty() || names(to)?.is_empty() {
            return Err("The drive's top folder cannot be moved.".into());
        }
        let destination = self.url_of(to, false)?;
        let headers = [("Destination", destination.to_string()), ("Overwrite", "F".to_owned())];
        let reply = self.send("MOVE", &self.url_of(from, false)?, &headers, &[], 64 * 1024)?;
        match reply.status {
            200 | 201 | 204 => Ok(()),
            s => Err(WebDav::failed(s, None)),
        }
    }

    fn delete(&self, path: &str, etag: Option<&str>) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("The drive's top folder cannot be deleted.".into());
        }
        let headers: Vec<(&str, String)> = etag.map(|e| ("If-Match", e.to_owned())).into_iter().collect();
        let reply = self.send("DELETE", &self.url_of(path, false)?, &headers, &[], 64 * 1024)?;
        match reply.status {
            200 | 202 | 204 => Ok(()),
            s => Err(WebDav::failed(s, etag)),
        }
    }
}

// ---- the person's drives --------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveAccount {
    pub id: String,
    /// `webdav`; later others.
    pub kind: String,
    pub name: String,
    /// The drive's top folder.
    pub url: String,
    pub username: String,
}

pub struct Drives {
    file: PathBuf,
    secrets: Arc<dyn Secrets>,
    state: Mutex<Vec<DriveAccount>>,
    http: ureq::Agent,
}

fn secret_name(id: &str) -> String {
    format!("drive:{id}")
}

impl Drives {
    pub fn new(data_dir: &Path, secrets: Arc<dyn Secrets>) -> Drives {
        let file = data_dir.join("drives.json");
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Drives { file, secrets, state: Mutex::new(state), http: http_agent() }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<DriveAccount>> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn save(&self, drives: &[DriveAccount]) {
        if let Ok(text) = serde_json::to_string_pretty(drives) {
            let _ = std::fs::create_dir_all(self.file.parent().unwrap_or(Path::new(".")));
            let _ = std::fs::write(&self.file, text);
        }
    }

    pub fn list(&self) -> Value {
        json!(self.lock().clone())
    }

    /// Where to look for the files of an account on a server given only by its address. Nextcloud and ownCloud keep
    /// them at `remote.php/dav/files/<user>/`.
    fn candidates(base: &url::Url, username: &str) -> Vec<url::Url> {
        let mut out = vec![base.clone()];
        if base.path() == "/" || base.path().is_empty() {
            let mut nextcloud = base.clone();
            if let Ok(mut segments) = nextcloud.path_segments_mut() {
                segments.clear().extend(["remote.php", "dav", "files", username, ""]);
            }
            out.push(nextcloud);
        }
        out
    }

    /// Checks the account can open the folder, then keeps it. The password is kept only once it worked.
    pub fn add(&self, name: &str, server: &str, username: &str, password: &str) -> Res<Value> {
        let base = server_url(server)?;
        let username = username.trim();
        if username.is_empty() || password.is_empty() {
            return Err("A drive needs the account name and a password (an app password for Nextcloud and Fastmail).".into());
        }
        if self.lock().len() >= MAX_DRIVES {
            return Err(format!("There can be at most {MAX_DRIVES} drives."));
        }
        let mut first_problem = None;
        let mut found = None;
        for url in Drives::candidates(&base, username) {
            let drive = WebDav::with_agent(url, username, password, self.http.clone());
            match drive.check() {
                Ok(()) => {
                    found = Some(drive);
                    break;
                }
                Err(e) if e.starts_with("The server did not accept") || e.starts_with("Could not reach") => return Err(e),
                Err(e) => {
                    first_problem.get_or_insert(e);
                }
            }
        }
        let Some(drive) = found else {
            return Err(match first_problem {
                Some(e) if e != WebDav::failed(404, None) => e,
                _ => "There is no WebDAV folder at that address. Nextcloud shows its address in Files, under Files settings, WebDAV.".into(),
            });
        };
        let name = Some(name.trim()).filter(|n| !n.is_empty()).and_then(clean_name).or_else(|| base.host_str().map(str::to_owned)).unwrap_or_else(|| "Drive".into());
        let account = DriveAccount { id: new_id(), kind: "webdav".into(), name, url: drive.base().to_string(), username: username.to_owned() };
        if !self.secrets.put(&secret_name(&account.id), password) {
            return Err("The password could not be kept in this computer's secret store.".into());
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
    }

    pub fn remove(&self, id: &str) -> Res<Value> {
        let mut all = self.lock();
        let before = all.len();
        all.retain(|a| a.id != id);
        if all.len() == before {
            return Err("That drive is gone.".into());
        }
        self.save(&all);
        drop(all);
        self.secrets.delete(&secret_name(id));
        Ok(json!({ "ok": true }))
    }

    pub fn open(&self, id: &str) -> Res<Box<dyn Drive>> {
        let account = self.lock().iter().find(|a| a.id == id).cloned().ok_or("That drive is gone.")?;
        let password = self.secrets.get(&secret_name(id)).ok_or("The drive's password is missing; remove the drive and add it again.")?;
        let url = url::Url::parse(&account.url).map_err(|e| e.to_string())?;
        match account.kind.as_str() {
            "webdav" => Ok(Box::new(WebDav::with_agent(url, &account.username, &password, self.http.clone()))),
            other => Err(format!("This version of Mobius cannot open {other} drives.")),
        }
    }
}

// ---- the agent's tools ----------------------------------------------------------------------------------------------

/// The longest text the agent reads from a drive file in one go.
const MAX_READ: usize = 200 * 1024;

/// The agent's drive tools. Reading needs `drives.read`; every change on a server is `drives.write`, a floor: the
/// person approves each one, whatever the mode, since nothing in Mobius can undo it there.
pub fn tool_descriptions() -> Vec<Value> {
    let drive = json!({ "type": "string", "description": "The drive's name, as drives.list gives it." });
    let path = |what: &str| json!({ "type": "string", "description": what });
    let version = json!({ "type": "string", "description": "The version drives.list or drives.read gave for the file. Needed to change or delete a file that is there; leave it out only for a new file." });
    vec![
        json!({ "name": "drives.list", "description": "The person's drives (folders on their own servers, such as Nextcloud), or what is in a folder of one: names, sizes, dates and versions.", "capability": "drives.read",
            "input_schema": { "type": "object", "properties": { "drive": drive, "folder": path("A folder on the drive, such as Projects/2026; the drive's top when left out.") } } }),
        json!({ "name": "drives.read", "description": "Read a text file on one of the person's drives, with its version. Other files are described; copy them into the workspace with drives.fetch to work on them.", "capability": "drives.read", "resource_arg": "path",
            "input_schema": { "type": "object", "properties": { "drive": drive, "path": path("The file on the drive.") }, "required": ["drive", "path"] } }),
        json!({ "name": "drives.fetch", "description": "Copy a file from one of the person's drives into the workspace, to read or change it there. It never replaces a workspace file.", "capability": "files.write", "resource_arg": "to",
            "input_schema": { "type": "object", "properties": { "drive": drive, "path": path("The file on the drive."), "to": path("Where in the workspace; the file's name at the workspace's top when left out.") }, "required": ["drive", "path"] } }),
        json!({ "name": "drives.write", "description": "Write a file on one of the person's drives: the text given, or a workspace file. A file that is there is replaced only at the version given, so a change made on the server meanwhile is never lost. Missing folders are made. The person approves each change.", "capability": "drives.write", "resource_arg": "path",
            "input_schema": { "type": "object", "properties": { "drive": drive, "path": path("The file on the drive."), "text": path("What the file holds."), "from": path("A workspace file to send instead of text."), "version": version }, "required": ["drive", "path"] } }),
        json!({ "name": "drives.move", "description": "Move or rename a file or folder on one of the person's drives. It never replaces anything. The person approves each change.", "capability": "drives.write", "resource_arg": "from",
            "input_schema": { "type": "object", "properties": { "drive": drive, "from": path("What to move."), "to": path("Its new path on the same drive.") }, "required": ["drive", "from", "to"] } }),
        json!({ "name": "drives.delete", "description": "Delete a file or folder on one of the person's drives. The server may keep it in its own trash; Mobius cannot bring it back. The person approves each one.", "capability": "drives.write", "resource_arg": "path",
            "input_schema": { "type": "object", "properties": { "drive": drive, "path": path("What to delete."), "version": version }, "required": ["drive", "path"] } }),
    ]
}

pub fn is_drive_tool(name: &str) -> bool {
    matches!(name, "drives.list" | "drives.read" | "drives.fetch" | "drives.write" | "drives.move" | "drives.delete")
}

fn kb(size: u64) -> String {
    match size {
        s if s < 1024 => format!("{s} bytes"),
        s if s < 1024 * 1024 => format!("{} KB", s.div_ceil(1024)),
        s => format!("{:.1} MB", s as f64 / (1024.0 * 1024.0)),
    }
}

fn looks_like_text(bytes: &[u8], content_type: Option<&str>) -> bool {
    let typed = content_type.is_some_and(|t| t.starts_with("text/") || ["json", "xml", "yaml", "csv", "javascript", "markdown"].iter().any(|k| t.contains(k)));
    std::str::from_utf8(bytes).is_ok() && (typed || !bytes.contains(&0))
}

impl Drives {
    /// A drive by its name (as the agent sees it) or its id.
    fn find(&self, name: &str) -> Res<DriveAccount> {
        let name = name.trim();
        let all = self.lock();
        all.iter()
            .find(|a| a.id == name)
            .or_else(|| all.iter().find(|a| a.name.eq_ignore_ascii_case(name)))
            .cloned()
            .ok_or_else(|| if all.is_empty() { "The person has no drives yet; they add one in Files.".to_owned() } else { format!("There is no drive named {name}. Drives: {}.", all.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")) })
    }

    /// Runs one of the agent's drive tools. Returns what to tell the agent and, for a change, the drive and paths
    /// changed (to announce).
    pub fn run(&self, tool: &str, args: &Value, workspace: &mobius_workspace::files::Workspace) -> Res<(String, Option<(String, Vec<String>)>)> {
        let arg = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let need = |k: &str| arg(k).ok_or_else(|| format!("{tool} needs {k}"));
        if tool == "drives.list" && arg("drive").is_none() {
            let all = self.lock().clone();
            if all.is_empty() {
                return Ok(("The person has no drives yet; they add one in Files.".into(), None));
            }
            let lines: Vec<String> = all.iter().map(|a| format!("- {} ({}, {})", a.name, a.kind, a.url)).collect();
            return Ok((format!("Drives:\n{}", lines.join("\n")), None));
        }
        let account = self.find(need("drive")?)?;
        let drive = self.open(&account.id)?;
        let changed = |paths: Vec<String>| Some((account.id.clone(), paths));
        match tool {
            "drives.list" => {
                let folder = arg("folder").unwrap_or("");
                let entries = drive.list(folder)?;
                if entries.is_empty() {
                    return Ok((format!("{} is empty.", if folder.is_empty() { account.name.clone() } else { folder.to_owned() }), None));
                }
                let lines: Vec<String> = entries
                    .iter()
                    .take(500)
                    .map(|e| {
                        if e.folder {
                            format!("- {}/", e.path)
                        } else {
                            format!("- {} ({}{}{})", e.path, kb(e.size), e.modified.as_deref().map(|m| format!(", changed {m}")).unwrap_or_default(), e.etag.as_deref().map(|v| format!(", version {v}")).unwrap_or_default())
                        }
                    })
                    .collect();
                let more = if entries.len() > 500 { format!("\n…and {} more.", entries.len() - 500) } else { String::new() };
                Ok((format!("In {}:\n{}{more}", if folder.is_empty() { account.name.clone() } else { format!("{} / {folder}", account.name) }, lines.join("\n")), None))
            }
            "drives.read" => {
                let path = need("path")?;
                let file = drive.read(path)?;
                let version = file.etag.as_deref().map(|v| format!("Version: {v}\n")).unwrap_or_default();
                if !looks_like_text(&file.bytes, file.content_type.as_deref()) {
                    let kind = file.content_type.as_deref().unwrap_or("file");
                    return Ok((format!("{path} is a {kind} of {}. {version}Copy it into the workspace with drives.fetch to work on it.", kb(file.bytes.len() as u64)), None));
                }
                let text = String::from_utf8_lossy(&file.bytes);
                let cut = if text.len() > MAX_READ { format!("{}\n…(cut at {} KB)", &text[..(0..=MAX_READ).rev().find(|i| text.is_char_boundary(*i)).unwrap_or(0)], MAX_READ / 1024) } else { text.into_owned() };
                Ok((format!("{version}\n{cut}"), None))
            }
            "drives.fetch" => {
                let path = need("path")?;
                let file = drive.read(path)?;
                let name = path.trim_matches('/').rsplit('/').next().unwrap_or(path);
                let to = arg("to").unwrap_or(name);
                workspace.add_file(to, &file.bytes)?;
                Ok((format!("Copied {path} from {} to {to} in the workspace ({}).", account.name, kb(file.bytes.len() as u64)), None))
            }
            "drives.write" => {
                let path = need("path")?;
                let bytes = match (arg("from"), args.get("text").and_then(Value::as_str)) {
                    (Some(from), _) => workspace.read_bytes(from, MAX_FILE)?,
                    (None, Some(text)) => text.as_bytes().to_vec(),
                    (None, None) => return Err("drives.write needs text or a workspace file (from)".into()),
                };
                let version = arg("version");
                let written = match drive.write(path, &bytes, version) {
                    // The folder it goes in is missing: make it (and any above it), then write.
                    Err(e) if e == WebDav::failed(409, None) => {
                        let names = names(path)?;
                        for depth in 1..names.len() {
                            match drive.make_folder(&names[..depth].join("/")) {
                                Ok(()) => {}
                                Err(e) if e == EXISTS => {}
                                Err(e) => return Err(e),
                            }
                        }
                        drive.write(path, &bytes, version)
                    }
                    other => other,
                };
                let etag = written.map_err(|e| if e == EXISTS { format!("{path} is already on the drive: read it (or list its folder) for its version, then write with that version to replace it.") } else if e == CHANGED { format!("{path} changed on the server since that version: read it again before changing it.") } else { e })?;
                Ok((format!("Wrote {path} on {} ({}).{}", account.name, kb(bytes.len() as u64), etag.map(|v| format!(" Its version is now {v}.")).unwrap_or_default()), changed(vec![path.to_owned()])))
            }
            "drives.move" => {
                let (from, to) = (need("from")?, need("to")?);
                drive.rename(from, to)?;
                Ok((format!("Moved {from} to {to} on {}.", account.name), changed(vec![from.to_owned(), to.to_owned()])))
            }
            "drives.delete" => {
                let path = need("path")?;
                drive.delete(path, arg("version")).map_err(|e| if e == CHANGED { format!("{path} changed on the server since that version: read it again first.") } else { e })?;
                Ok((format!("Deleted {path} on {}.", account.name), changed(vec![path.to_owned()])))
            }
            _ => Err(format!("unknown tool {tool}")),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use std::collections::BTreeMap;
    use std::io::{BufRead, BufReader, Read, Write};

    /// What the fake server holds: path → (bytes, version). Folders end in `/`.
    pub(crate) type Store = Arc<Mutex<BTreeMap<String, (Vec<u8>, u32)>>>;

    /// A small WebDAV server holding files in memory under `root` (such as `/` or `/remote.php/dav/files/ana/`), for
    /// user `ana` with password `app-pass`. It speaks enough of RFC 4918 for drives: PROPFIND, GET, PUT with
    /// If-Match / If-None-Match, MKCOL, MOVE with Overwrite, DELETE.
    pub(crate) fn server(root: &str) -> (String, Store) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let store: Store = Arc::default();
        store.lock().unwrap().insert(root.to_owned(), (Vec::new(), 1));
        let (s, root, host) = (store.clone(), root.to_owned(), base.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
                let path = percent_decode_str(&path).decode_utf8_lossy().into_owned();
                let mut headers = BTreeMap::new();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    headers.insert(k.to_ascii_lowercase(), v.trim().to_owned());
                }
                let length = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let header = |k: &str| headers.get(k).cloned().unwrap_or_default();
                let ok_auth = header("authorization") == format!("Basic {}", { use base64::Engine; base64::engine::general_purpose::STANDARD.encode("ana:app-pass") });
                let mut st = s.lock().unwrap();
                let key = |p: &str| if st.contains_key(&format!("{}/", p.trim_end_matches('/'))) { format!("{}/", p.trim_end_matches('/')) } else { p.trim_end_matches('/').to_owned() };
                let tag = |v: u32| format!("\"v{v}\"");
                let parent_of = |p: &str| format!("{}/", p.trim_end_matches('/').rsplit_once('/').map_or("", |(a, _)| a));
                let (status, extra, reply): (&str, String, Vec<u8>) = if !ok_auth {
                    ("401 Unauthorized", "WWW-Authenticate: Basic realm=\"x\"\r\n".into(), Vec::new())
                } else if !path.starts_with(&root) && path != root.trim_end_matches('/') {
                    ("404 Not Found", String::new(), Vec::new())
                } else {
                    let k = key(&path);
                    match method.as_str() {
                        "PROPFIND" => match st.get(&k) {
                            None => ("404 Not Found", String::new(), Vec::new()),
                            Some(_) => {
                                let depth1 = header("depth") == "1";
                                let enc = |p: &str| p.replace(' ', "%20");
                                let items: String = st
                                    .iter()
                                    .filter(|(p, _)| *p == &k || (depth1 && k.ends_with('/') && p.starts_with(&k) && !p[k.len()..].trim_end_matches('/').contains('/') && p.len() > k.len()))
                                    .map(|(p, (b, v))| {
                                        let kind = if p.ends_with('/') { "<d:collection/>" } else { "" };
                                        let length = if p.ends_with('/') { String::new() } else { format!("<d:getcontentlength>{}</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype>", b.len()) };
                                        format!("<d:response><d:href>{host}{}</d:href><d:propstat><d:prop><d:resourcetype>{kind}</d:resourcetype>{length}<d:getetag>{}</d:getetag><d:getlastmodified>Sat, 14 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:quota-used-bytes/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>", enc(p), tag(*v))
                                    })
                                    .collect();
                                ("207 Multi-Status", String::new(), format!(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">{items}</d:multistatus>"#).into_bytes())
                            }
                        },
                        "GET" => match st.get(&k) {
                            Some((b, v)) if !k.ends_with('/') => ("200 OK", format!("ETag: {}\r\n", tag(*v)), b.clone()),
                            _ => ("404 Not Found", String::new(), Vec::new()),
                        },
                        "PUT" => {
                            let current = st.get(&k).map(|(_, v)| tag(*v));
                            let (if_match, if_none) = (header("if-match"), header("if-none-match"));
                            if (!if_match.is_empty() && current.as_deref() != Some(if_match.as_str())) || (if_none == "*" && current.is_some()) {
                                ("412 Precondition Failed", String::new(), Vec::new())
                            } else if !st.contains_key(&parent_of(&k)) {
                                ("409 Conflict", String::new(), Vec::new())
                            } else {
                                let v = st.get(&k).map_or(1, |(_, v)| v + 1);
                                st.insert(k.clone(), (body, v));
                                ("201 Created", format!("ETag: {}\r\n", tag(v)), Vec::new())
                            }
                        }
                        "MKCOL" => {
                            let k = format!("{}/", path.trim_end_matches('/'));
                            if st.contains_key(&k) || st.contains_key(k.trim_end_matches('/')) {
                                ("405 Method Not Allowed", String::new(), Vec::new())
                            } else if !st.contains_key(&parent_of(&k)) {
                                ("409 Conflict", String::new(), Vec::new())
                            } else {
                                st.insert(k, (Vec::new(), 1));
                                ("201 Created", String::new(), Vec::new())
                            }
                        }
                        "MOVE" => {
                            let to = url::Url::parse(&header("destination")).map(|u| percent_decode_str(u.path()).decode_utf8_lossy().into_owned()).unwrap_or_default();
                            let folder = k.ends_with('/');
                            let to = if folder { format!("{}/", to.trim_end_matches('/')) } else { to.trim_end_matches('/').to_owned() };
                            if !st.contains_key(&k) {
                                ("404 Not Found", String::new(), Vec::new())
                            } else if st.contains_key(&to) || st.contains_key(&key(&to)) {
                                ("412 Precondition Failed", String::new(), Vec::new())
                            } else {
                                let moving: Vec<String> = st.keys().filter(|p| *p == &k || (folder && p.starts_with(&k))).cloned().collect();
                                for p in moving {
                                    let item = st.remove(&p).unwrap();
                                    st.insert(format!("{to}{}", &p[k.len()..]), item);
                                }
                                ("201 Created", String::new(), Vec::new())
                            }
                        }
                        "DELETE" => {
                            let if_match = header("if-match");
                            match st.get(&k).map(|(_, v)| tag(*v)) {
                                None => ("404 Not Found", String::new(), Vec::new()),
                                Some(t) if !if_match.is_empty() && t != if_match => ("412 Precondition Failed", String::new(), Vec::new()),
                                Some(_) => {
                                    st.retain(|p, _| !(p == &k || (k.ends_with('/') && p.starts_with(&k))));
                                    ("204 No Content", String::new(), Vec::new())
                                }
                            }
                        }
                        _ => ("405 Method Not Allowed", String::new(), Vec::new()),
                    }
                };
                drop(st);
                let _ = write!(stream, "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", reply.len());
                let _ = stream.write_all(&reply);
            }
        });
        (base, store)
    }

    #[test]
    fn paths_cannot_leave_the_drive() {
        assert_eq!(names("/Docs/Plans/a b.txt/").unwrap(), vec!["Docs", "Plans", "a b.txt"]);
        assert!(names("").unwrap().is_empty());
        for bad in ["../x", "a/../b", "a//b", "a\\b", "./a"] {
            assert!(names(bad).is_err(), "{bad}");
        }
        let drive = WebDav::new(url::Url::parse("https://cloud.example/remote.php/dav/files/ana").unwrap(), "ana", "p");
        assert_eq!(drive.url_of("Docs/a b#1.txt", false).unwrap().as_str(), "https://cloud.example/remote.php/dav/files/ana/Docs/a%20b%231.txt");
        assert_eq!(drive.url_of("", true).unwrap().as_str(), "https://cloud.example/remote.php/dav/files/ana/");
        assert_eq!(drive.url_of("Docs", true).unwrap().as_str(), "https://cloud.example/remote.php/dav/files/ana/Docs/");
        assert_eq!(drive.path_of("/remote.php/dav/files/ana/Docs/a%20b.txt").as_deref(), Some("Docs/a b.txt"));
        assert_eq!(drive.path_of("https://cloud.example/remote.php/dav/files/ana/").as_deref(), Some(""));
        assert_eq!(drive.path_of("/remote.php/dav/files/bo/x"), None, "another person's files are not this drive's");
    }

    #[test]
    fn a_nextcloud_drive_is_found_from_its_address_and_its_files_are_changed_safely() {
        let (base, store) = server("/remote.php/dav/files/ana/");
        let dir = tempfile::tempdir().unwrap();
        let drives = Drives::new(dir.path(), Arc::new(MemorySecrets::new(true)));

        let wrong = drives.add("Cloud", &base, "ana", "wrong").unwrap_err();
        assert!(wrong.contains("did not accept"), "{wrong}");
        let added = drives.add("Cloud", &base, "ana", "app-pass").unwrap();
        assert_eq!(added["url"], format!("{base}/remote.php/dav/files/ana/"));
        let id = added["id"].as_str().unwrap().to_owned();
        assert_eq!(Drives::new(dir.path(), Arc::new(MemorySecrets::new(true))).list()[0]["name"], "Cloud", "kept across runs");

        let drive = drives.open(&id).unwrap();
        drive.make_folder("Plans").unwrap();
        assert_eq!(drive.make_folder("Plans").unwrap_err(), EXISTS);
        let v1 = drive.write("Plans/road map.md", b"# Road map", None).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map.md", b"again", None).unwrap_err(), EXISTS, "a new file never replaces one");
        assert!(drive.write("Gone/a.md", b"x", None).unwrap_err().contains("folder it goes in"));

        let top = drive.list("").unwrap();
        assert_eq!(top.iter().map(|e| (e.name.as_str(), e.folder)).collect::<Vec<_>>(), vec![("Plans", true)]);
        let plans = drive.list("Plans").unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!((plans[0].path.as_str(), plans[0].size, plans[0].etag.as_deref()), ("Plans/road map.md", 10, Some(v1.as_str())));

        let file = drive.read("Plans/road map.md").unwrap();
        assert_eq!((file.bytes.as_slice(), file.etag.as_deref()), (b"# Road map".as_slice(), Some(v1.as_str())));

        // Someone changes it on the server: a change based on the old version is refused, not written over theirs.
        let v2 = drive.write("Plans/road map.md", b"# Road map v2", Some(&v1)).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map.md", b"mine", Some(&v1)).unwrap_err(), CHANGED);
        assert_eq!(drive.delete("Plans/road map.md", Some(&v1)).unwrap_err(), CHANGED);
        assert_eq!(store.lock().unwrap()["/remote.php/dav/files/ana/Plans/road map.md"].0, b"# Road map v2");

        drive.make_folder("Archive").unwrap();
        drive.rename("Plans/road map.md", "Archive/road map.md").unwrap();
        drive.write("Plans/road map.md", b"new", None).unwrap();
        assert_eq!(drive.rename("Plans/road map.md", "Archive/road map.md").unwrap_err(), EXISTS, "a move never replaces");
        drive.rename("Archive", "Old").unwrap();
        assert_eq!(drive.read("Old/road map.md").unwrap().etag.as_deref(), Some(v2.as_str()));
        drive.delete("Old", None).unwrap();
        assert_eq!(drive.list("").unwrap().iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["Plans"]);
        assert!(drive.read("Old/road map.md").unwrap_err().contains("not on the drive"));
        assert!(drive.read("../../bo/secret").is_err());

        drives.remove(&id).unwrap();
        assert!(drives.open(&id).is_err());
    }

    #[test]
    fn a_plain_webdav_folder_is_used_as_given_and_a_wrong_address_is_said() {
        let (base, _) = server("/files/");
        let dir = tempfile::tempdir().unwrap();
        let drives = Drives::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        let missing = drives.add("Home", &base, "ana", "app-pass").unwrap_err();
        assert!(missing.contains("no WebDAV folder"), "{missing}");
        let added = drives.add("", &format!("{base}/files"), "ana", "app-pass").unwrap();
        assert_eq!(added["url"], format!("{base}/files/"));
        assert_eq!(added["name"], "127.0.0.1", "named after the server when no name is given");
    }
    #[test]
    fn the_agent_reads_fetches_and_changes_drive_files_only_at_the_version_it_saw() {
        let (base, store) = server("/remote.php/dav/files/ana/");
        let dir = tempfile::tempdir().unwrap();
        let drives = Drives::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        let workspace = mobius_workspace::files::Workspace::new(dir.path().join("workspace"), dir.path().join("checkpoints"));
        std::fs::create_dir_all(dir.path().join("workspace")).unwrap();
        let run = |tool: &str, args: Value| drives.run(tool, &args, &workspace);

        assert!(run("drives.list", json!({})).unwrap().0.contains("no drives yet"));
        drives.add("Cloud", &base, "ana", "app-pass").unwrap();
        assert!(run("drives.list", json!({})).unwrap().0.contains("- Cloud (webdav,"));
        assert!(run("drives.read", json!({ "drive": "Nope", "path": "a" })).unwrap_err().contains("Drives: Cloud"));

        // A new file in folders that are not there yet: the folders are made.
        let (said, changed) = run("drives.write", json!({ "drive": "cloud", "path": "Trips/2026/plan.md", "text": "# Lisbon" })).unwrap();
        assert!(said.contains("Its version is now \"v1\""), "{said}");
        assert_eq!(changed.unwrap().1, vec!["Trips/2026/plan.md"]);
        let again = run("drives.write", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md", "text": "over" })).unwrap_err();
        assert!(again.contains("already on the drive"), "{again}");

        let listing = run("drives.list", json!({ "drive": "Cloud", "folder": "Trips/2026" })).unwrap().0;
        assert!(listing.contains("- Trips/2026/plan.md (8 bytes, changed Sat, 14 Nov 2026 10:00:00 GMT, version \"v1\")"), "{listing}");
        let read = run("drives.read", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md" })).unwrap().0;
        assert!(read.starts_with("Version: \"v1\"\n") && read.ends_with("# Lisbon"), "{read}");

        // Someone changes it on the server; the agent's change at the version it saw is refused.
        run("drives.write", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md", "text": "# Lisbon and Porto", "version": "\"v1\"" })).unwrap();
        let stale = run("drives.write", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md", "text": "mine", "version": "\"v1\"" })).unwrap_err();
        assert!(stale.contains("changed on the server"), "{stale}");
        assert!(run("drives.delete", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md", "version": "\"v1\"" })).unwrap_err().contains("changed on the server"));

        // Into the workspace and back.
        run("drives.fetch", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md" })).unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("workspace/plan.md")).unwrap(), "# Lisbon and Porto");
        assert!(run("drives.fetch", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md" })).unwrap_err().contains("already in the workspace"));
        std::fs::write(dir.path().join("workspace/plan.md"), [0u8, 159, 146, 150]).unwrap();
        run("drives.write", json!({ "drive": "Cloud", "path": "Trips/photo.bin", "from": "plan.md" })).unwrap();
        assert!(run("drives.read", json!({ "drive": "Cloud", "path": "Trips/photo.bin" })).unwrap().0.contains("drives.fetch"), "not text: described");
        assert!(run("drives.write", json!({ "drive": "Cloud", "path": "x", "from": "../../etc/passwd" })).is_err());

        let (_, moved) = run("drives.move", json!({ "drive": "Cloud", "from": "Trips/2026", "to": "Trips/Portugal" })).unwrap();
        assert_eq!(moved.unwrap().1, vec!["Trips/2026", "Trips/Portugal"]);
        run("drives.delete", json!({ "drive": "Cloud", "path": "Trips/photo.bin" })).unwrap();
        let left: Vec<String> = store.lock().unwrap().keys().cloned().collect();
        assert_eq!(left, vec!["/remote.php/dav/files/ana/", "/remote.php/dav/files/ana/Trips/", "/remote.php/dav/files/ana/Trips/Portugal/", "/remote.php/dav/files/ana/Trips/Portugal/plan.md"]);
    }
}
