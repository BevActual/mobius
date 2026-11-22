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
/// The largest file read into memory in one go: a drive file opened in an app, or sent from one.
pub const MAX_FILE: usize = 32 * 1024 * 1024;
/// The largest file sync sends or brings in, a piece at a time through a file on disk. Bigger ones are left alone.
pub const MAX_SYNC_FILE: u64 = 16 * 1024 * 1024 * 1024;
/// Nextcloud and ownCloud take files over this in pieces of this size (chunked upload v2), as their own apps do, so a
/// proxy's limit on one request (100 MB on Cloudflare) never stops a big file.
const CHUNK: u64 = 32 * 1024 * 1024;
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
    /// The version to send back with a change: an ETag on WebDAV and S3, a revision on Dropbox and Google Drive. Opaque;
    /// sent back exactly as given. The window knows it as `etag`.
    #[serde(rename = "etag")]
    pub version: Option<String>,
    pub content_type: Option<String>,
    /// The service's own id, where it has one (Google Drive, OneDrive): two files there can share a name in a folder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// A document that lives only in the service (a Google Doc) has no bytes to read: it opens at this address, and
    /// sync leaves it alone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// What changed on a drive since a cursor, from the service's own change feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changes {
    /// Files and folders that are new or changed (as they are now) and paths that are gone.
    pub changed: Vec<Entry>,
    pub removed: Vec<String>,
    /// Where to ask from next time.
    pub cursor: String,
}

/// A file read from a drive.
#[derive(Debug)]
pub struct File {
    pub bytes: Vec<u8>,
    pub version: Option<String>,
    pub content_type: Option<String>,
}

/// A place files are kept. Paths are relative to the drive's top folder.
pub trait Drive: Send + Sync {
    /// The drive's top folder is there and the account may read it.
    fn check(&self) -> Res<()>;
    fn list(&self, folder: &str) -> Res<Vec<Entry>>;
    fn read(&self, path: &str) -> Res<File>;
    /// With `version`, replaces the file only if it is still that version; without, makes a new file and never
    /// replaces one. Returns the new version when the server says it.
    fn write(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>>;
    fn make_folder(&self, path: &str) -> Res<()>;
    /// Moves or renames; never replaces what is at `to`.
    fn rename(&self, from: &str, to: &str) -> Res<()>;
    /// With `version`, only if it is still that version.
    fn delete(&self, path: &str, version: Option<&str>) -> Res<()>;
    /// Whether a write or delete given a version is refused when the file has changed since. Where it isn't, sync
    /// reads the version just before a change instead.
    fn guards_versions(&self) -> bool {
        true
    }
    /// What changed since `cursor` (none: from now), where the service keeps a change feed (Google Drive's changes,
    /// OneDrive's delta, Dropbox's cursor, Nextcloud's sync-collection). `None` when it has none: sync lists instead.
    fn changes(&self, _cursor: Option<&str>) -> Res<Option<Changes>> {
        Ok(None)
    }
    /// Saves the file at `path` into the local file `to`, a piece at a time where the drive can, so its size is not
    /// bounded by memory. Returns its version, as `read` does.
    fn read_into(&self, path: &str, to: &Path) -> Res<Option<String>> {
        let file = self.read(path)?;
        std::fs::write(to, &file.bytes).map_err(|e| e.to_string())?;
        Ok(file.version)
    }
    /// `write`, from the local file `from`, a piece at a time where the drive can.
    fn write_from(&self, path: &str, from: &Path, version: Option<&str>) -> Res<Option<String>> {
        let bytes = std::fs::read(from).map_err(|e| e.to_string())?;
        self.write(path, &bytes, version)
    }
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

/// An ETag as the HTTP headers give it. Some servers (wsgidav, a few NAS boxes) leave the quotes off `getetag` while
/// their `ETag` header has them, so the same version would look like a change and `If-Match` would never match.
fn entity_tag(tag: &str) -> String {
    let tag = tag.trim();
    if tag.starts_with('"') || tag.starts_with("W/") { tag.to_owned() } else { format!("\"{tag}\"") }
}

/// What a file is, for a PUT. CardDAV and CalDAV servers (iCloud among them) want a card or an event sent as one.
fn content_type_for(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".vcf") {
        "text/vcard; charset=utf-8"
    } else if lower.ends_with(".ics") {
        "text/calendar; charset=utf-8"
    } else {
        "application/octet-stream"
    }
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

const PROPS: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:getcontenttype/><oc:fileid/></d:prop></d:propfind>"#;

pub struct WebDav {
    /// The drive's top folder; always ends in `/`.
    base: url::Url,
    username: String,
    password: String,
    http: ureq::Agent,
    /// Files over this go up in pieces of this size, where the server takes them that way.
    chunk: u64,
}

/// What a request sends.
#[derive(Clone, Copy)]
enum Body<'a> {
    Bytes(&'a [u8]),
    /// A local file, a piece at a time.
    File(&'a Path),
}

/// Where an answer's body goes.
#[derive(Clone, Copy)]
enum Sink<'a> {
    /// Kept in memory, up to this many bytes.
    Memory(usize),
    /// A successful answer goes into this local file, a piece at a time; any other is kept in memory.
    File(&'a Path),
}

/// Time for a request carrying `bytes`: five minutes, and a second more for each 64 KB, so a big file on a slow line is
/// not cut off while a stalled small request still is.
fn time_for(bytes: u64) -> Duration {
    Duration::from_secs(300 + bytes / (64 * 1024))
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
        WebDav { base, username: username.to_owned(), password: password.to_owned(), http, chunk: CHUNK }
    }

    /// Where Nextcloud and ownCloud take chunked uploads for this account: `/remote.php/dav/uploads/<user>/`, beside
    /// the account's `/remote.php/dav/files/<user>/`. `None` on any other server, which gets one request per file.
    fn uploads(&self) -> Option<url::Url> {
        let path = self.base.path();
        let at = path.find("/remote.php/dav/files/")?;
        let user = path[at + "/remote.php/dav/files/".len()..].split('/').next().filter(|u| !u.is_empty())?;
        self.base.join(&format!("{}/remote.php/dav/uploads/{user}/", &path[..at])).ok()
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
        self.exchange(method, url, headers, Body::Bytes(body), Sink::Memory(limit))
    }

    /// `send`, with a body read from a file or an answer written to one.
    fn exchange(&self, method: &str, url: &url::Url, headers: &[(&str, String)], body: Body, sink: Sink) -> Res<Reply> {
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
            let unreachable = |e: ureq::Error| format!("Could not reach {}: {e}", at.host_str().unwrap_or("the server"));
            let mut response = match (body, sink) {
                (Body::Bytes(bytes), Sink::Memory(_)) => self.http.run(builder.body(bytes.to_vec()).map_err(|e| e.to_string())?).map_err(unreachable)?,
                (Body::Bytes(bytes), Sink::File(_)) => {
                    let request = self.http.configure_request(builder.body(bytes.to_vec()).map_err(|e| e.to_string())?).timeout_global(None).build();
                    self.http.run(request).map_err(unreachable)?
                }
                (Body::File(path), _) => {
                    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
                    let size = file.metadata().map_err(|e| e.to_string())?.len();
                    let request = self.http.configure_request(builder.body(file).map_err(|e| e.to_string())?).timeout_global(Some(time_for(size))).build();
                    self.http.run(request).map_err(unreachable)?
                }
            };
            let status = response.status().as_u16();
            let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
            let (etag, content_type, location) = (header("etag"), header("content-type"), header("location"));
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                let next = location.as_deref().and_then(|l| at.join(l).ok()).filter(|u| matches!(u.scheme(), "https" | "http"));
                at = next.ok_or("The server sent Mobius somewhere it could not follow.")?;
                continue;
            }
            let body = match sink {
                // Written to the file as it arrives; a dropped connection leaves a short file, which the caller checks.
                Sink::File(path) if (200..300).contains(&status) => {
                    let mut out = std::fs::File::create(path).map_err(|e| e.to_string())?;
                    let mut reader = response.body_mut().with_config().limit(MAX_SYNC_FILE).reader();
                    std::io::copy(&mut reader, &mut out).map_err(|e| e.to_string())?;
                    out.sync_all().map_err(|e| e.to_string())?;
                    Vec::new()
                }
                Sink::File(_) => response.body_mut().with_config().limit(64 * 1024).read_to_vec().unwrap_or_default(),
                Sink::Memory(limit) => {
                    let limit = u64::try_from(limit).unwrap_or(u64::MAX);
                    response.body_mut().with_config().limit(limit).read_to_vec().map_err(|e| match e {
                        ureq::Error::BodyExceedsLimit(_) => format!("That file is bigger than {} MB, the most Mobius opens from a drive for now.", MAX_FILE / (1024 * 1024)),
                        e => e.to_string(),
                    })?
                }
            };
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
                    version: prop("getetag").map(|e| entity_tag(&e)),
                    content_type: prop("getcontenttype").filter(|_| !folder),
                    // Nextcloud and ownCloud give each file an id that a move keeps.
                    id: prop("fileid"),
                    link: None,
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

    /// Why a PUT did not work. A new file (no version) cannot itself be missing, so a 404 means the folder it goes in
    /// is: Nextcloud answers that way where RFC 4918 says 409.
    fn put_failed(status: u16, etag: Option<&str>) -> String {
        WebDav::failed(if status == 404 && etag.is_none() { 409 } else { status }, etag)
    }

    fn version_of(&self, path: &str) -> Option<String> {
        let (_, doc) = self.propfind(&self.url_of(path, false).ok()?, "0").ok()?;
        self.entries(&doc?).into_iter().next().and_then(|e| e.version)
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
            200 => Ok(File { bytes: reply.body, version: reply.etag, content_type: reply.content_type }),
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
        let reply = self.send("PUT", &url, &[condition, ("Content-Type", content_type_for(path).to_owned())], bytes, 64 * 1024)?;
        match reply.status {
            200 | 201 | 204 => Ok(reply.etag.or_else(|| self.version_of(path))),
            s => Err(WebDav::put_failed(s, etag)),
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

    fn read_into(&self, path: &str, to: &Path) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("That is a folder.".into());
        }
        let reply = self.exchange("GET", &self.url_of(path, false)?, &[], Body::Bytes(&[]), Sink::File(to))?;
        match reply.status {
            200 => Ok(reply.etag),
            s => Err(WebDav::failed(s, None)),
        }
    }

    fn write_from(&self, path: &str, from: &Path, etag: Option<&str>) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("A file needs a name.".into());
        }
        let size = std::fs::metadata(from).map_err(|e| e.to_string())?.len();
        if size > MAX_SYNC_FILE {
            return Err(format!("Files bigger than {} GB are not sent to a drive.", MAX_SYNC_FILE / (1024 * 1024 * 1024)));
        }
        if size > self.chunk
            && let Some(uploads) = self.uploads()
        {
            return self.write_in_pieces(&uploads, path, from, size, etag);
        }
        let url = self.url_of(path, false)?;
        let condition = etag.map_or(("If-None-Match", "*".to_owned()), |e| ("If-Match", e.to_owned()));
        let reply = self.exchange("PUT", &url, &[condition, ("Content-Type", content_type_for(path).to_owned())], Body::File(from), Sink::Memory(64 * 1024))?;
        match reply.status {
            200 | 201 | 204 => Ok(reply.etag.or_else(|| self.version_of(path))),
            s => Err(WebDav::put_failed(s, etag)),
        }
    }
}

impl WebDav {
    /// Nextcloud's chunked upload (v2): a folder of pieces under `uploads`, each sent on its own, then joined into the
    /// file by moving the folder's `.file` onto it. The folder is removed if anything fails.
    ///
    /// The server compares no version on the join, so the file's version is checked just before it instead: a file
    /// changed on the server (or made there, for a new one) in the moments between is the one case not caught.
    fn write_in_pieces(&self, uploads: &url::Url, path: &str, from: &Path, size: u64, etag: Option<&str>) -> Res<Option<String>> {
        use std::io::Read;
        let destination = self.url_of(path, false)?.to_string();
        let folder = uploads.join(&format!("mobius-{}/", new_id())).map_err(|e| e.to_string())?;
        let headers = [("Destination", destination.clone()), ("OC-Total-Length", size.to_string())];
        let reply = self.send("MKCOL", &folder, &headers[..1], &[], 64 * 1024)?;
        if !matches!(reply.status, 200 | 201) {
            return Err(WebDav::failed(reply.status, None));
        }
        let sent = (|| -> Res<Option<String>> {
            let mut file = std::fs::File::open(from).map_err(|e| e.to_string())?;
            let mut piece = vec![0; usize::try_from(self.chunk).unwrap_or(usize::MAX)];
            for n in 1.. {
                let mut filled = 0;
                while filled < piece.len() {
                    match file.read(&mut piece[filled..]).map_err(|e| e.to_string())? {
                        0 => break,
                        k => filled += k,
                    }
                }
                if filled == 0 {
                    break;
                }
                let at = folder.join(&format!("{n:05}")).map_err(|e| e.to_string())?;
                let reply = self.exchange("PUT", &at, &headers, Body::Bytes(&piece[..filled]), Sink::Memory(64 * 1024))?;
                if !matches!(reply.status, 200 | 201 | 204) {
                    return Err(WebDav::failed(reply.status, None));
                }
            }
            match (etag, self.version_of(path)) {
                (Some(e), Some(now)) if now != e => return Err(CHANGED.into()),
                (Some(_), None) => return Err(CHANGED.into()),
                (None, Some(_)) => return Err(EXISTS.into()),
                _ => {}
            }
            let join = folder.join(".file").map_err(|e| e.to_string())?;
            let reply = self.exchange("MOVE", &join, &headers, Body::Bytes(&[]), Sink::Memory(64 * 1024))?;
            match reply.status {
                200 | 201 | 204 => Ok(reply.etag.or_else(|| self.version_of(path))),
                s => Err(WebDav::failed(s, etag)),
            }
        })();
        if sent.is_err() {
            let _ = self.send("DELETE", &folder, &[], &[], 64 * 1024);
        }
        sent
    }
}

// ---- the person's drives --------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriveAccount {
    pub id: String,
    /// `webdav`, `s3`, `dropbox`, `onedrive` (OneDrive and SharePoint) or `local` (a folder on this computer).
    pub kind: String,
    pub name: String,
    /// The drive's top folder. For S3, its path-style address: `https://host/bucket/folder/`; for Dropbox,
    /// `dropbox:` and the folder in it (`dropbox:/Notes`, or `dropbox:/` for the whole Dropbox); for OneDrive and
    /// SharePoint, `onedrive:`, Graph's id of the drive, and the folder (`onedrive:b!x7…/Projects`); for a folder on this
    /// computer, its full path.
    pub url: String,
    /// The account name; for S3, the access key id; for Dropbox, OneDrive and SharePoint, the account it signed in with.
    pub username: String,
    /// S3's region (`eu-west-2`, R2's `auto`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
}

pub struct Drives {
    file: PathBuf,
    secrets: Arc<dyn Secrets>,
    state: Mutex<Vec<DriveAccount>>,
    http: ureq::Agent,
    /// Dropbox sign-in, and opening a Dropbox drive with the tokens kept for it.
    dropbox: Mutex<Arc<crate::dropbox::Service>>,
    /// Microsoft sign-in, and opening a OneDrive or SharePoint drive with the tokens kept for it.
    onedrive: Mutex<Arc<crate::onedrive::Service>>,
}

fn secret_name(id: &str) -> String {
    format!("drive:{id}")
}

impl Drives {
    pub fn new(data_dir: &Path, secrets: Arc<dyn Secrets>) -> Drives {
        let file = data_dir.join("drives.json");
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let http = http_agent();
        let dropbox = Arc::new(crate::dropbox::Service::new(crate::dropbox::built_in_key(), crate::dropbox::Endpoints::default(), http.clone()));
        let onedrive = Arc::new(crate::onedrive::Service::new(crate::onedrive::built_in_client_id(), crate::onedrive::Endpoints::default(), http.clone()));
        Drives { file, secrets, state: Mutex::new(state), http, dropbox: Mutex::new(dropbox), onedrive: Mutex::new(onedrive) }
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

    /// The drive's name, as the person sees it.
    pub fn name(&self, id: &str) -> Option<String> {
        self.lock().iter().find(|a| a.id == id).map(|a| a.name.clone())
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

    /// An S3-style bucket (or a folder in one) as a drive: checked with the access key, then kept. The secret is kept
    /// only once it worked. `endpoint` is the service's address (`https://s3.eu-west-2.amazonaws.com`, an R2 account's,
    /// `http://nas:9000` for MinIO); `region` may be left empty where the address names it.
    #[allow(clippy::too_many_arguments)]
    pub fn add_s3(&self, name: &str, endpoint: &str, bucket: &str, folder: &str, region: &str, key_id: &str, secret: &str) -> Res<Value> {
        let mut base = server_url(endpoint)?;
        let bucket = bucket.trim();
        if !crate::s3::bucket_ok(bucket) {
            return Err("That is not a bucket name S3 accepts: 3 to 63 lowercase letters, digits, dots and hyphens.".into());
        }
        if key_id.trim().is_empty() || secret.is_empty() {
            return Err("A bucket needs its access key id and secret.".into());
        }
        if self.lock().len() >= MAX_DRIVES {
            return Err(format!("There can be at most {MAX_DRIVES} drives."));
        }
        let folder = names(folder)?;
        {
            let mut segments = base.path_segments_mut().map_err(|()| "That address cannot hold a bucket.".to_owned())?;
            segments.clear().push(bucket).extend(&folder).push("");
        }
        base.set_query(None);
        let drive = crate::s3::S3::new(&base, region, key_id, secret, self.http.clone())?;
        drive.check()?;
        let name = Some(name.trim()).filter(|n| !n.is_empty()).and_then(clean_name).unwrap_or_else(|| bucket.to_owned());
        let account = DriveAccount { id: new_id(), kind: "s3".into(), name, url: base.to_string(), username: key_id.trim().to_owned(), region: Some(drive.region().to_owned()) };
        if !self.secrets.put(&secret_name(&account.id), secret) {
            return Err("The secret could not be kept in this computer's secret store.".into());
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
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
        let account = DriveAccount { id: new_id(), kind: "webdav".into(), name, url: drive.base().to_string(), username: username.to_owned(), region: None };
        if !self.secrets.put(&secret_name(&account.id), password) {
            return Err("The password could not be kept in this computer's secret store.".into());
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
    }

    /// A new password for a drive whose sign-in stopped working: checked against the server first, then kept in place
    /// of the old one.
    pub fn sign_in(&self, id: &str, password: &str) -> Res<Value> {
        let account = self.lock().iter().find(|a| a.id == id).cloned().ok_or("That drive is gone.")?;
        if account.kind == "dropbox" || account.kind == "onedrive" {
            return Err("This drive signs in again in the browser, from the drive's menu.".into());
        }
        if password.is_empty() {
            return Err("Enter the password (an app password for Nextcloud and Fastmail).".into());
        }
        self.connect(&account, password)?.check()?;
        if !self.secrets.put(&secret_name(id), password) {
            return Err("The password could not be kept in this computer's secret store.".into());
        }
        Ok(json!({ "ok": true }))
    }

    fn dropbox(&self) -> Arc<crate::dropbox::Service> {
        self.dropbox.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// Use this Dropbox sign-in (a pretend Dropbox, in tests).
    pub fn use_dropbox(&self, service: crate::dropbox::Service) {
        *self.dropbox.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Arc::new(service);
    }

    /// Whether this build can sign in to Dropbox, and the sign-in page while one waits.
    pub fn dropbox_status(&self) -> Value {
        self.dropbox().status()
    }

    pub fn cancel_dropbox(&self) {
        self.dropbox().cancel();
    }

    /// Starts a Dropbox sign-in in the browser and returns the page to open. Once the person allows it, the drive is
    /// checked and kept: `folder` in their Dropbox (made if it isn't there; empty for the whole Dropbox), named
    /// `name`. With `again`, that Dropbox drive's sign-in is renewed instead. `done` gets the drive, or why not.
    pub fn add_dropbox(self: &Arc<Self>, name: &str, folder: &str, again: Option<&str>, done: Arc<dyn Fn(Res<Value>) + Send + Sync>) -> Res<Value> {
        let again = match again {
            Some(id) => Some(self.lock().iter().find(|a| a.id == id && a.kind == "dropbox").cloned().ok_or("That drive is gone.")?),
            None if self.lock().len() >= MAX_DRIVES => return Err(format!("There can be at most {MAX_DRIVES} drives.")),
            None => None,
        };
        let folder = names(folder)?.join("/");
        let name = Some(name.trim()).filter(|n| !n.is_empty()).and_then(clean_name).or_else(|| folder.rsplit('/').next().filter(|f| !f.is_empty()).and_then(clean_name)).unwrap_or_else(|| "Dropbox".into());
        let me = Arc::clone(self);
        let pending = self.dropbox().start(Arc::new(move |signed: Res<crate::dropbox::SignedIn>| done(signed.and_then(|signed| me.keep_dropbox(&name, &folder, again.as_ref(), &signed)))))?;
        Ok(json!(pending))
    }

    fn keep_dropbox(&self, name: &str, folder: &str, again: Option<&DriveAccount>, signed: &crate::dropbox::SignedIn) -> Res<Value> {
        let tokens = serde_json::to_string(&signed.tokens).map_err(|e| e.to_string())?;
        if let Some(account) = again {
            if !account.username.is_empty() && !signed.email.is_empty() && !account.username.eq_ignore_ascii_case(&signed.email) {
                return Err(format!("That drive is in the Dropbox of {}; sign in with that account.", account.username));
            }
            if !self.secrets.put(&secret_name(&account.id), &tokens) {
                return Err("The sign-in could not be kept in this computer's secret store.".into());
            }
            return Ok(json!(account));
        }
        let account = DriveAccount { id: new_id(), kind: "dropbox".into(), name: name.to_owned(), url: format!("dropbox:/{folder}"), username: signed.email.clone(), region: None };
        if !self.secrets.put(&secret_name(&account.id), &tokens) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let checked = (|| {
            let drive = self.dropbox().open(Arc::clone(&self.secrets), &secret_name(&account.id), folder)?;
            if !folder.is_empty() {
                let (parent, last) = folder.rsplit_once('/').unwrap_or(("", folder));
                let top = self.dropbox().open(Arc::clone(&self.secrets), &secret_name(&account.id), parent)?;
                match top.make_folder(last) {
                    Ok(()) => {}
                    Err(e) if e == EXISTS => {}
                    Err(e) => return Err(e),
                }
            }
            drive.check()
        })();
        if let Err(e) = checked {
            self.secrets.delete(&secret_name(&account.id));
            return Err(e);
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
    }

    fn onedrive(&self) -> Arc<crate::onedrive::Service> {
        self.onedrive.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// Use this Microsoft sign-in (a pretend Graph, in tests).
    pub fn use_onedrive(&self, service: crate::onedrive::Service) {
        *self.onedrive.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Arc::new(service);
    }

    /// Whether this build can sign in to Microsoft, and the sign-in page while one waits.
    pub fn onedrive_status(&self) -> Value {
        self.onedrive().status()
    }

    pub fn cancel_onedrive(&self) {
        self.onedrive().cancel();
    }

    /// Starts a Microsoft sign-in in the browser and returns the page to open. Once the person allows it, the drive is
    /// checked and kept: `folder` in their own OneDrive, or, with `link`, the SharePoint (or OneDrive) folder or library
    /// that link opens, and `folder` inside it. A missing folder is made. With `again`, that drive's sign-in is renewed
    /// instead. `done` gets the drive, or why not.
    pub fn add_onedrive(self: &Arc<Self>, name: &str, folder: &str, link: &str, again: Option<&str>, done: Arc<dyn Fn(Res<Value>) + Send + Sync>) -> Res<Value> {
        let again = match again {
            Some(id) => Some(self.lock().iter().find(|a| a.id == id && a.kind == "onedrive").cloned().ok_or("That drive is gone.")?),
            None if self.lock().len() >= MAX_DRIVES => return Err(format!("There can be at most {MAX_DRIVES} drives.")),
            None => None,
        };
        let folder = names(folder)?.join("/");
        let link = link.trim().to_owned();
        if !link.is_empty() && !link.starts_with("https://") {
            return Err("That isn't a link. Copy the folder's or library's link from SharePoint or OneDrive.".into());
        }
        let name = Some(name.trim()).filter(|n| !n.is_empty()).and_then(clean_name);
        let me = Arc::clone(self);
        let pending = self.onedrive().start(Arc::new(move |signed: Res<crate::onedrive::SignedIn>| done(signed.and_then(|signed| me.keep_onedrive(name.as_deref(), &folder, &link, again.as_ref(), &signed)))))?;
        Ok(json!(pending))
    }

    fn keep_onedrive(&self, name: Option<&str>, folder: &str, link: &str, again: Option<&DriveAccount>, signed: &crate::onedrive::SignedIn) -> Res<Value> {
        let tokens = serde_json::to_string(&signed.tokens).map_err(|e| e.to_string())?;
        if let Some(account) = again {
            if !account.username.is_empty() && !signed.email.is_empty() && !account.username.eq_ignore_ascii_case(&signed.email) {
                return Err(format!("That drive belongs to {}; sign in with that account.", account.username));
            }
            if !self.secrets.put(&secret_name(&account.id), &tokens) {
                return Err("The sign-in could not be kept in this computer's secret store.".into());
            }
            return Ok(json!(account));
        }
        let id = new_id();
        let secret = secret_name(&id);
        if !self.secrets.put(&secret, &tokens) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let service = self.onedrive();
        let found = (|| {
            let (drive, base, base_name) = if link.is_empty() {
                if signed.drive.is_empty() {
                    return Err("This account has no OneDrive yet. Add a SharePoint library by its link instead.".to_owned());
                }
                (signed.drive.clone(), String::new(), String::new())
            } else {
                let place = service.resolve(Arc::clone(&self.secrets), &secret, link)?;
                (place.drive, place.folder, place.name)
            };
            let full = [base.as_str(), folder].iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("/");
            // Graph makes one folder at a time, so each level of a new folder is made in turn.
            let at = service.open(Arc::clone(&self.secrets), &secret, &drive, &base)?;
            let mut made = String::new();
            for part in folder.split('/').filter(|p| !p.is_empty()) {
                made = if made.is_empty() { part.to_owned() } else { format!("{made}/{part}") };
                match at.make_folder(&made) {
                    Ok(()) => {}
                    Err(e) if e == EXISTS => {}
                    Err(e) => return Err(e),
                }
            }
            service.open(Arc::clone(&self.secrets), &secret, &drive, &full)?.check()?;
            let shown = folder.rsplit('/').next().filter(|f| !f.is_empty()).and_then(clean_name).or_else(|| clean_name(&base_name)).unwrap_or_else(|| if link.is_empty() { "OneDrive".into() } else { "SharePoint".into() });
            Ok((drive, full, shown))
        })();
        let (drive, full, shown) = match found {
            Ok(f) => f,
            Err(e) => {
                self.secrets.delete(&secret);
                return Err(e);
            }
        };
        let account = DriveAccount { id, kind: "onedrive".into(), name: name.map_or(shown, str::to_owned), url: format!("onedrive:{drive}/{full}"), username: signed.email.clone(), region: None };
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
    }

    /// A folder on this computer as a place in Files ("This computer"). Mobius reaches only the folders kept so.
    pub fn add_place(&self, path: &Path) -> Res<Value> {
        let folder = crate::local_drive::LocalFolder::new(path)?;
        drop(folder);
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let url = path.to_string_lossy().trim_start_matches(r"\\?\").to_owned();
        let mut all = self.lock();
        if let Some(there) = all.iter().find(|a| a.kind == "local" && a.url == url) {
            return Ok(json!(there));
        }
        if all.len() >= MAX_DRIVES {
            return Err(format!("There can be at most {MAX_DRIVES} drives and places."));
        }
        let name = path.file_name().map_or_else(|| url.clone(), |n| n.to_string_lossy().into_owned());
        let account = DriveAccount { id: new_id(), kind: "local".into(), name, url, username: String::new(), region: None };
        all.push(account.clone());
        self.save(&all);
        Ok(json!(account))
    }

    /// The first time Mobius runs with places: Desktop, Documents and Downloads are added. Removed later, they stay
    /// removed.
    pub fn seed_places(&self, data_dir: &Path) {
        let marker = data_dir.join("places-seeded");
        if marker.exists() {
            return;
        }
        for (name, path) in crate::local_drive::known_folders() {
            if let Ok(place) = self.add_place(&path) {
                // Its own name, as the system calls it, not the folder's (a redirected Documents may be "Documents - OneDrive").
                if let Some(id) = place.get("id").and_then(Value::as_str) {
                    let mut all = self.lock();
                    if let Some(a) = all.iter_mut().find(|a| a.id == id) {
                        name.clone_into(&mut a.name);
                    }
                    let snapshot = all.clone();
                    self.save(&snapshot);
                }
            }
        }
        let _ = std::fs::write(marker, "");
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
        if account.kind == "local" {
            return Ok(Box::new(crate::local_drive::LocalFolder::new(Path::new(&account.url))?));
        }
        let password = self.secrets.get(&secret_name(id)).ok_or("The drive's password is missing; remove the drive and add it again.")?;
        self.connect(&account, &password)
    }

    fn connect(&self, account: &DriveAccount, password: &str) -> Res<Box<dyn Drive>> {
        if account.kind == "dropbox" {
            let folder = account.url.strip_prefix("dropbox:").ok_or("The drive's address is not a Dropbox folder.")?;
            return Ok(Box::new(self.dropbox().open(Arc::clone(&self.secrets), &secret_name(&account.id), folder)?));
        }
        if account.kind == "onedrive" {
            let (drive, folder) = account.url.strip_prefix("onedrive:").and_then(|r| r.split_once('/')).ok_or("The drive's address is not a OneDrive folder.")?;
            return Ok(Box::new(self.onedrive().open(Arc::clone(&self.secrets), &secret_name(&account.id), drive, folder)?));
        }
        let url = url::Url::parse(&account.url).map_err(|e| e.to_string())?;
        match account.kind.as_str() {
            "webdav" => Ok(Box::new(WebDav::with_agent(url, &account.username, password, self.http.clone()))),
            "s3" => Ok(Box::new(crate::s3::S3::new(&url, account.region.as_deref().unwrap_or(""), &account.username, password, self.http.clone())?)),
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
                            format!("- {} ({}{}{})", e.path, kb(e.size), e.modified.as_deref().map(|m| format!(", changed {m}")).unwrap_or_default(), e.version.as_deref().map(|v| format!(", version {v}")).unwrap_or_default())
                        }
                    })
                    .collect();
                let more = if entries.len() > 500 { format!("\n…and {} more.", entries.len() - 500) } else { String::new() };
                Ok((format!("In {}:\n{}{more}", if folder.is_empty() { account.name.clone() } else { format!("{} / {folder}", account.name) }, lines.join("\n")), None))
            }
            "drives.read" => {
                let path = need("path")?;
                let file = drive.read(path)?;
                let version = file.version.as_deref().map(|v| format!("Version: {v}\n")).unwrap_or_default();
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
                let to = arg("to").unwrap_or(name).trim_matches('/');
                let (folder, file_name) = to.rsplit_once('/').unwrap_or(("", to));
                // Make the folders it goes in; one already there is fine.
                let mut parent = String::new();
                for part in folder.split('/').filter(|p| !p.is_empty()) {
                    let next = if parent.is_empty() { part.to_owned() } else { format!("{parent}/{part}") };
                    if !workspace.locate(&next).is_ok_and(|p| p.is_dir()) {
                        workspace.new_folder(&parent, part)?;
                    }
                    parent = next;
                }
                // Never over a workspace file: a taken name gets " 2", " 3".
                let landed = workspace.add_file(&parent, file_name, &file.bytes)?;
                Ok((format!("Copied {path} from {} to {landed} in the workspace ({}).", account.name, kb(file.bytes.len() as u64)), None))
            }
            "drives.write" => {
                let path = need("path")?;
                let bytes = match (arg("from"), args.get("text").and_then(Value::as_str)) {
                    (Some(from), _) => workspace.read_file(from, MAX_FILE)?,
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

    #[test]
    fn an_etag_a_listing_gives_without_quotes_matches_the_header() {
        assert_eq!(entity_tag("1028234-1794786647-3"), "\"1028234-1794786647-3\"");
        assert_eq!(entity_tag("\"abc\""), "\"abc\"");
        assert_eq!(entity_tag("W/\"abc\""), "W/\"abc\"");
    }

    /// What the fake server holds: path → (bytes, version). Folders end in `/`.
    pub(crate) type Store = Arc<Mutex<BTreeMap<String, (Vec<u8>, u32)>>>;

    /// A small WebDAV server holding files in memory under `root` (such as `/` or `/remote.php/dav/files/ana/`), for
    /// user `ana` with password `app-pass`. It speaks enough of RFC 4918 for drives: PROPFIND, GET, PUT with
    /// If-Match / If-None-Match, MKCOL, MOVE with Overwrite, DELETE.
    pub(crate) fn server(root: &str) -> (String, Store) {
        server_with(root, None)
    }

    /// `server`, refusing (413) any one PUT over `max_body` bytes outside the uploads folder, as a proxy in front
    /// of a server can. Under `/remote.php/dav/files/<user>/` it also takes Nextcloud's chunked uploads (v2) at
    /// `/remote.php/dav/uploads/<user>/`: a folder of pieces, joined by moving its `.file` onto the file.
    pub(crate) fn server_with(root: &str, max_body: Option<usize>) -> (String, Store) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let store: Store = Arc::default();
        store.lock().unwrap().insert(root.to_owned(), (Vec::new(), 1));
        let uploads = root.contains("/remote.php/dav/files/").then(|| root.replacen("/remote.php/dav/files/", "/remote.php/dav/uploads/", 1));
        if let Some(u) = &uploads {
            store.lock().unwrap().insert(u.clone(), (Vec::new(), 1));
        }
        let (s, root, host) = (store.clone(), root.to_owned(), base.clone());
        std::thread::spawn(move || {
            // The highest version each path has had: a file made again after a delete never gets an old version back,
            // as on a real server.
            let mut seen: BTreeMap<String, u32> = BTreeMap::new();
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
                } else if !path.starts_with(&root) && path != root.trim_end_matches('/') && !uploads.as_ref().is_some_and(|u| path.starts_with(u.as_str())) {
                    ("404 Not Found", String::new(), Vec::new())
                } else if method == "PUT" && max_body.is_some_and(|m| body.len() > m) && !uploads.as_ref().is_some_and(|u| path.starts_with(u.as_str())) {
                    ("413 Payload Too Large", String::new(), Vec::new())
                } else {
                    let k = key(&path);
                    match method.as_str() {
                        // Joining an upload's pieces, in order, into the file at Destination.
                        "MOVE" if k.ends_with("/.file") => {
                            let folder = k.trim_end_matches(".file").to_owned();
                            let to = url::Url::parse(&header("destination")).map(|u| percent_decode_str(u.path()).decode_utf8_lossy().into_owned()).unwrap_or_default();
                            let joined: Vec<u8> = st.iter().filter(|(p, _)| p.starts_with(&folder) && *p != &folder).flat_map(|(_, (b, _))| b.clone()).collect();
                            if !st.contains_key(&folder) {
                                ("404 Not Found", String::new(), Vec::new())
                            } else if header("oc-total-length").parse::<usize>().ok() != Some(joined.len()) {
                                ("400 Bad Request", String::new(), Vec::new())
                            } else {
                                st.retain(|p, _| !p.starts_with(&folder));
                                let v = st.get(&to).map_or_else(|| seen.get(&to).copied().unwrap_or(0) + 1, |(_, v)| v + 1);
                                seen.insert(to.clone(), v);
                                st.insert(to, (joined, v));
                                ("201 Created", format!("ETag: {}\r\n", tag(v)), Vec::new())
                            }
                        }
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
                                        format!("<d:response><d:href>{host}{}</d:href><d:propstat><d:prop><d:resourcetype>{kind}</d:resourcetype>{length}<d:getetag>{}</d:getetag><oc:fileid>{}</oc:fileid><d:getlastmodified>Sat, 14 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:quota-used-bytes/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>", enc(p), tag(*v), p.len())
                                    })
                                    .collect();
                                ("207 Multi-Status", String::new(), format!(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">{items}</d:multistatus>"#).into_bytes())
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
                                // Nextcloud answers a new file in a missing folder with 404, where RFC 4918 says 409.
                                if uploads.is_some() { ("404 Not Found", String::new(), Vec::new()) } else { ("409 Conflict", String::new(), Vec::new()) }
                            } else {
                                let v = st.get(&k).map_or_else(|| seen.get(&k).copied().unwrap_or(0) + 1, |(_, v)| v + 1);
                                seen.insert(k.clone(), v);
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
    fn big_files_go_to_nextcloud_in_pieces_and_come_back_a_piece_at_a_time() {
        // Behind a proxy that refuses any request over 64 bytes, a 230-byte file still goes up, in pieces of 50.
        let (base, store) = server_with("/remote.php/dav/files/ana/", Some(64));
        let mut drive = WebDav::new(url::Url::parse(&format!("{base}/remote.php/dav/files/ana/")).unwrap(), "ana", "app-pass");
        drive.chunk = 50;
        let dir = tempfile::tempdir().unwrap();
        let big: Vec<u8> = (0..230u32).map(|i| u8::try_from(i % 251).unwrap()).collect();
        let from = dir.path().join("big.bin");
        std::fs::write(&from, &big).unwrap();
        let pieces_left = |store: &Store| store.lock().unwrap().keys().any(|k| k.contains("/mobius-"));

        let v1 = drive.write_from("big.bin", &from, None).unwrap().unwrap();
        assert_eq!(store.lock().unwrap()["/remote.php/dav/files/ana/big.bin"].0, big);
        assert!(!pieces_left(&store), "the pieces are joined and gone");
        // The same rules as one request: a new file never replaces one, and a change is based on the version read.
        assert_eq!(drive.write_from("big.bin", &from, None).unwrap_err(), EXISTS);
        let v2 = drive.write_from("big.bin", &from, Some(&v1)).unwrap().unwrap();
        assert_ne!(v1, v2);
        assert_eq!(drive.write_from("big.bin", &from, Some(&v1)).unwrap_err(), CHANGED);
        assert!(!pieces_left(&store), "a refused upload leaves no pieces behind");

        // Read back into a file, a piece at a time.
        let back = dir.path().join("back.bin");
        assert_eq!(drive.read_into("big.bin", &back).unwrap().as_deref(), Some(v2.as_str()));
        assert_eq!(std::fs::read(&back).unwrap(), big);
        assert_eq!(drive.read_into("gone.bin", &back).unwrap_err(), WebDav::failed(404, None));

        // A small file is one request, and a server without chunked uploads gets one request whatever the size.
        std::fs::write(&from, b"small").unwrap();
        assert!(drive.write_from("small.bin", &from, None).is_ok());
        let (plain, _) = server_with("/dav/", Some(64));
        let mut plain = WebDav::new(url::Url::parse(&format!("{plain}/dav/")).unwrap(), "ana", "app-pass");
        plain.chunk = 50;
        std::fs::write(&from, &big).unwrap();
        assert_eq!(plain.write_from("big.bin", &from, None).unwrap_err(), WebDav::failed(413, None));
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
        // Signing in again checks the new password first; a wrong one leaves the kept one alone.
        assert!(drives.sign_in(&id, "wrong").unwrap_err().contains("did not accept"));
        assert!(drives.open(&id).unwrap().check().is_ok());
        assert_eq!(drives.sign_in(&id, "app-pass").unwrap()["ok"], true);
        assert_eq!(drives.sign_in("nope", "app-pass").unwrap_err(), "That drive is gone.");

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
        assert_eq!((plans[0].path.as_str(), plans[0].size, plans[0].version.as_deref()), ("Plans/road map.md", 10, Some(v1.as_str())));
        assert!(plans[0].id.is_some(), "Nextcloud's file id comes through as the entry's id");

        let file = drive.read("Plans/road map.md").unwrap();
        assert_eq!((file.bytes.as_slice(), file.version.as_deref()), (b"# Road map".as_slice(), Some(v1.as_str())));

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
        assert_eq!(drive.read("Old/road map.md").unwrap().version.as_deref(), Some(v2.as_str()));
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
        assert!(run("drives.fetch", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md" })).unwrap().0.contains("to plan 2.md"), "never over a workspace file");
        run("drives.fetch", json!({ "drive": "Cloud", "path": "Trips/2026/plan.md", "to": "Trips/Lisbon/plan.md" })).unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join("workspace/Trips/Lisbon/plan.md")).unwrap(), "# Lisbon and Porto");
        std::fs::write(dir.path().join("workspace/plan.md"), [0u8, 159, 146, 150]).unwrap();
        run("drives.write", json!({ "drive": "Cloud", "path": "Trips/photo.bin", "from": "plan.md" })).unwrap();
        assert!(run("drives.read", json!({ "drive": "Cloud", "path": "Trips/photo.bin" })).unwrap().0.contains("drives.fetch"), "not text: described");
        assert!(run("drives.write", json!({ "drive": "Cloud", "path": "x", "from": "../../etc/passwd" })).is_err());

        let (_, moved) = run("drives.move", json!({ "drive": "Cloud", "from": "Trips/2026", "to": "Trips/Portugal" })).unwrap();
        assert_eq!(moved.unwrap().1, vec!["Trips/2026", "Trips/Portugal"]);
        run("drives.delete", json!({ "drive": "Cloud", "path": "Trips/photo.bin" })).unwrap();
        let left: Vec<String> = store.lock().unwrap().keys().filter(|k| k.starts_with("/remote.php/dav/files/")).cloned().collect();
        assert_eq!(left, vec!["/remote.php/dav/files/ana/", "/remote.php/dav/files/ana/Trips/", "/remote.php/dav/files/ana/Trips/Portugal/", "/remote.php/dav/files/ana/Trips/Portugal/plan.md"]);
    }

    #[test]
    fn a_folder_on_this_computer_is_a_place_the_agent_and_files_open_like_a_drive() {
        let dir = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("todo.txt"), "milk").unwrap();
        let drives = Drives::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        let place = drives.add_place(folder.path()).unwrap();
        assert_eq!(place["kind"], "local");
        // The same folder twice is one place.
        assert_eq!(drives.add_place(folder.path()).unwrap()["id"], place["id"]);
        assert!(drives.add_place(&folder.path().join("missing")).is_err());
        let id = place["id"].as_str().unwrap();
        let d = drives.open(id).unwrap();
        assert_eq!(d.read("todo.txt").unwrap().bytes, b"milk");
        // The agent finds it by its name, as a drive.
        let name = place["name"].as_str().unwrap();
        let ws = mobius_workspace::files::Workspace::new(dir.path().join("ws"), dir.path().join("store"));
        let (said, _) = drives.run("drives.read", &serde_json::json!({ "drive": name, "path": "todo.txt" }), &ws).unwrap();
        assert!(said.contains("milk"), "{said}");
        // Removed, it is gone; its files are not touched.
        drives.remove(id).unwrap();
        assert!(drives.open(id).is_err());
        assert!(folder.path().join("todo.txt").is_file());
    }
}
