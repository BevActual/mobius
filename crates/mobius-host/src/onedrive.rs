//! OneDrive and SharePoint as drives, through Microsoft Graph (docs/developers/drives.md, "OneDrive and SharePoint"):
//! the person signs in on Microsoft's page, and a folder in their OneDrive, or in a SharePoint library they can reach,
//! is a drive like any other in Files, with two-way sync.
//!
//! - Sign-in is OAuth with PKCE and no secret (a public client), back to `http://localhost:<any port>`, the address
//!   registered with Microsoft (it lets desktop apps use any port). It asks for `offline_access`, `User.Read` and
//!   `Files.ReadWrite.All`, which reaches SharePoint libraries too. Tokens last about an hour and are refreshed; they stay
//!   in the system secret store as the drive's "password".
//! - A SharePoint library or folder is added from its link (Share, Copy link, or the address bar), resolved through
//!   Graph's `/shares`, so no `Sites.*` permission is needed.
//! - A change carries the item's `eTag` as `If-Match`, so a file changed in OneDrive since is refused, never overwritten;
//!   a new file is sent with `conflictBehavior=fail`, so it never replaces one.
//!
//! The app's client id is built in from `MOBIUS_MICROSOFT_CLIENT_ID`. Until it is, OneDrive says it isn't set up.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use serde::Serialize;
use serde_json::{Value, json};

use crate::drives::{CHANGED, Drive, EXISTS, Entry, File, MAX_FILE};
use crate::dropbox::{Tokens, form, lock, now, read_body};
use crate::loopback::{Callback, challenge, random_text};
use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

pub const NOT_SET_UP: &str = "OneDrive and SharePoint aren't set up in this build of Mobius yet.";
pub(crate) const EXPIRED: &str = "The Microsoft sign-in has ended. Sign in again from the drive's menu in Files.";
const GONE: &str = "That is not on the drive any more.";
pub const SCOPES: &str = "offline_access User.Read Files.ReadWrite.All";
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 8 * 1024 * 1024;
/// Graph takes a file in one request up to 4 MB; bigger ones go up in an upload session.
const SIMPLE_UPLOAD: usize = 4 * 1024 * 1024;
/// Upload session pieces must be a multiple of 320 KiB: this is 32 of them, 10 MiB.
const PIECE: usize = 32 * 320 * 1024;

/// Characters left as they are in a path segment; everything else is percent-encoded.
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// Where Microsoft is. A pretend Graph in tests.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    /// Graph's address with its version: `https://graph.microsoft.com/v1.0`.
    pub graph: String,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints {
            auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
            token: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
            graph: "https://graph.microsoft.com/v1.0".into(),
        }
    }
}

/// The client id built into this copy of Mobius, if any.
pub fn built_in_client_id() -> Option<String> {
    option_env!("MOBIUS_MICROSOFT_CLIENT_ID").filter(|k| !k.is_empty()).map(str::to_owned)
}

/// The tokens of one Microsoft account, kept in the secret store and refreshed there. Microsoft may send a new refresh
/// token with each refresh; the newest is kept.
pub struct Account {
    client_id: String,
    scopes: &'static str,
    token_url: String,
    secrets: Arc<dyn Secrets>,
    secret: String,
    http: ureq::Agent,
    refreshing: Mutex<()>,
}

impl Account {
    fn tokens(&self) -> Res<Tokens> {
        self.secrets.get(&self.secret).and_then(|t| serde_json::from_str(&t).ok()).ok_or_else(|| EXPIRED.to_owned())
    }

    /// A token good for a few minutes more; `stale` refreshes it whatever its time says (Graph said 401).
    pub(crate) fn token(&self, stale: bool) -> Res<String> {
        let _one_at_a_time = lock(&self.refreshing);
        let tokens = self.tokens()?;
        if !stale && tokens.expires > now() + SKEW_SECONDS {
            return Ok(tokens.access);
        }
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let body = form(&[("client_id", &self.client_id), ("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("scope", self.scopes)]);
        let response = self.http.post(&self.token_url).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Microsoft: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        let fresh: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status == 400 && fresh.get("error").and_then(Value::as_str) == Some("invalid_grant") {
            return Err(EXPIRED.into());
        }
        if status != 200 {
            return Err(format!("Microsoft could not refresh the sign-in (HTTP {status}). Try again later."));
        }
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|a| !a.is_empty()).ok_or("Microsoft did not send a token.")?.to_owned();
        let refresh = fresh.get("refresh_token").and_then(Value::as_str).filter(|r| !r.is_empty()).map_or(tokens.refresh, str::to_owned);
        let expires = now() + fresh.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        let next = Tokens { access: access.clone(), refresh, expires };
        self.secrets.put(&self.secret, &serde_json::to_string(&next).map_err(|e| e.to_string())?);
        Ok(access)
    }
}

/// What a Graph request answered.
struct Reply {
    status: u16,
    body: Vec<u8>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

/// Graph's error code (`nameAlreadyExists`, `itemNotFound`).
fn code(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body).ok().and_then(|v| v.pointer("/error/code").and_then(Value::as_str).map(str::to_owned)).unwrap_or_default()
}

/// Why a request did not work, in the person's words. `versioned`: the change named the version it replaces.
fn failed(status: u16, body: &[u8], versioned: bool) -> String {
    let c = code(body);
    match status {
        401 => EXPIRED.into(),
        404 => GONE.into(),
        409 if c == "nameAlreadyExists" || !versioned => EXISTS.into(),
        409 | 412 => CHANGED.into(),
        423 => "That file is locked, most likely open in an Office app. Try again once it's closed.".into(),
        403 => "Microsoft does not let this account do that.".into(),
        400 if c == "invalidRequest" || c == "nameInvalid" => "OneDrive can't use that name.".into(),
        429 | 503 => "Microsoft is limiting requests right now. Try again in a minute.".into(),
        507 => "The OneDrive is full.".into(),
        s => format!("OneDrive answered HTTP {s}{}.", if c.is_empty() { String::new() } else { format!(" ({c})") }),
    }
}

/// A OneDrive or SharePoint library, or a folder in one, as a drive.
pub struct OneDrive {
    account: Arc<Account>,
    graph: String,
    drive: String,
    root: String,
}

impl OneDrive {
    /// The names of `path` under the drive's root folder. Empty, `.` and `..` names are refused.
    fn names(&self, path: &str) -> Res<Vec<String>> {
        let mut out: Vec<String> = self.root.split('/').filter(|n| !n.is_empty()).map(str::to_owned).collect();
        for n in path.split('/').filter(|n| !n.is_empty()) {
            if n == "." || n == ".." || n.contains('\\') || n.chars().any(char::is_control) {
                return Err(format!("\"{path}\" is not a path on the drive."));
            }
            out.push(n.to_owned());
        }
        Ok(out)
    }

    /// The item at `path` (under the root), with `then` after it: `""`, `/children`, `/content`.
    fn item(&self, path: &str, then: &str) -> Res<String> {
        let names = self.names(path)?;
        let base = format!("{}/drives/{}/root", self.graph, utf8_percent_encode(&self.drive, SEGMENT));
        if names.is_empty() {
            return Ok(format!("{base}{then}"));
        }
        let encoded: Vec<String> = names.iter().map(|n| utf8_percent_encode(n, SEGMENT).to_string()).collect();
        Ok(format!("{base}:/{}:{then}", encoded.join("/")))
    }

    /// One Graph request, with the token refreshed once if Graph says it has run out.
    fn call(&self, method: &str, url: &str, headers: &[(&str, &str)], body: Option<&[u8]>, limit: u64) -> Res<Reply> {
        let mut stale = false;
        loop {
            let token = self.account.token(stale)?;
            let auth = format!("Bearer {token}");
            let response = match body {
                Some(bytes) => {
                    let mut req = ureq::http::Request::builder().method(method).uri(url).header("Authorization", &auth);
                    for (k, v) in headers {
                        req = req.header(*k, *v);
                    }
                    let req = req.body(bytes.to_vec()).map_err(|e| e.to_string())?;
                    self.account.http.run(req)
                }
                None => {
                    let mut req = ureq::http::Request::builder().method(method).uri(url).header("Authorization", &auth);
                    for (k, v) in headers {
                        req = req.header(*k, *v);
                    }
                    let req = req.body(()).map_err(|e| e.to_string())?;
                    self.account.http.run(req)
                }
            }
            .map_err(|e| format!("Could not reach OneDrive: {e}"))?;
            let (status, _, body) = read_body(response, limit)?;
            if status == 401 && !stale {
                stale = true;
                continue;
            }
            return Ok(Reply { status, body });
        }
    }

    fn get_json(&self, url: &str) -> Res<Reply> {
        self.call("GET", url, &[], None, MAX_JSON)
    }

    fn entry(&self, folder: &str, e: &Value) -> Option<Entry> {
        let text = |k: &str| e.get(k).and_then(Value::as_str).map(str::to_owned);
        let name = text("name")?;
        let is_folder = e.get("folder").is_some();
        // A OneNote notebook is a package: no bytes to download, so it opens on the web.
        let package = e.get("package").is_some();
        let path = if folder.trim_matches('/').is_empty() { name.clone() } else { format!("{}/{name}", folder.trim_matches('/')) };
        Some(Entry {
            name,
            path,
            folder: is_folder,
            size: e.get("size").and_then(Value::as_u64).unwrap_or(0),
            modified: text("lastModifiedDateTime"),
            version: if is_folder { None } else { text("eTag") },
            content_type: e.pointer("/file/mimeType").and_then(Value::as_str).map(str::to_owned),
            id: text("id"),
            link: if package { text("webUrl") } else { None },
        })
    }

    /// A file of more than 4 MB, in an upload session of 10 MiB pieces. The version is checked when the session starts.
    fn upload_in_pieces(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        let behaviour = if version.is_some() { "replace" } else { "fail" };
        let body = json!({ "item": { "@microsoft.graph.conflictBehavior": behaviour } }).to_string();
        let mut headers = vec![("Content-Type", "application/json")];
        if let Some(v) = version {
            headers.push(("If-Match", v));
        }
        let reply = self.call("POST", &self.item(path, "/createUploadSession")?, &headers, Some(body.as_bytes()), MAX_JSON)?;
        if reply.status != 200 {
            return Err(failed(reply.status, &reply.body, version.is_some()));
        }
        let session = reply.json().get("uploadUrl").and_then(Value::as_str).ok_or("OneDrive did not start the upload.")?.to_owned();
        let total = bytes.len();
        let mut from = 0;
        loop {
            let to = (from + PIECE).min(total);
            let range = format!("bytes {from}-{}/{total}", to - 1);
            // The session's address carries its own permission: no token goes with the pieces.
            let req = ureq::http::Request::builder().method("PUT").uri(&session).header("Content-Range", &range).body(bytes[from..to].to_vec()).map_err(|e| e.to_string())?;
            let response = self.account.http.run(req).map_err(|e| format!("Could not reach OneDrive: {e}"))?;
            let (status, _, body) = read_body(response, MAX_JSON)?;
            match status {
                202 if to < total => from = to,
                200 | 201 => return Ok(serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("eTag").and_then(Value::as_str).map(str::to_owned))),
                s => {
                    let _ = self.account.http.delete(&session).call();
                    return Err(failed(s, &body, version.is_some()));
                }
            }
        }
    }
}

impl Drive for OneDrive {
    fn check(&self) -> Res<()> {
        let reply = self.get_json(&self.item("", "")?)?;
        match reply.status {
            200 if reply.json().get("folder").is_some() || reply.json().get("root").is_some() => Ok(()),
            200 => Err("That is a file, not a folder.".into()),
            s => Err(failed(s, &reply.body, false)),
        }
    }

    fn list(&self, folder: &str) -> Res<Vec<Entry>> {
        let mut url = format!("{}?$top=200", self.item(folder, "/children")?);
        let mut out = Vec::new();
        loop {
            let reply = self.get_json(&url)?;
            if reply.status != 200 {
                return Err(failed(reply.status, &reply.body, false));
            }
            let page = reply.json();
            out.extend(page.get("value").and_then(Value::as_array).into_iter().flatten().filter_map(|e| self.entry(folder, e)));
            match page.get("@odata.nextLink").and_then(Value::as_str) {
                // Only follow a next page on Graph itself, so the token never goes anywhere else.
                Some(next) if next.starts_with(&self.graph) => url = next.to_owned(),
                _ => break,
            }
        }
        out.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    fn read(&self, path: &str) -> Res<File> {
        if path.trim_matches('/').is_empty() {
            return Err("That is a folder.".into());
        }
        let reply = self.get_json(&self.item(path, "")?)?;
        if reply.status != 200 {
            return Err(failed(reply.status, &reply.body, false));
        }
        let meta = reply.json();
        if meta.get("folder").is_some() {
            return Err("That is a folder.".into());
        }
        // The version is read before the bytes: if the file changes in between, the next change is refused as stale
        // and the next sync round sees it, so nothing is overwritten.
        let version = meta.get("eTag").and_then(Value::as_str).map(str::to_owned);
        let content_type = meta.pointer("/file/mimeType").and_then(Value::as_str).map(str::to_owned);
        let download = meta.get("@microsoft.graph.downloadUrl").and_then(Value::as_str).map(str::to_owned);
        let (status, body) = match download {
            // A pre-signed address: no token goes with it.
            Some(url) => {
                let response = self.account.http.get(&url).call().map_err(|e| format!("Could not reach OneDrive: {e}"))?;
                let (status, _, body) = read_body(response, MAX_FILE as u64)?;
                (status, body)
            }
            None => {
                let reply = self.call("GET", &self.item(path, "/content")?, &[], None, MAX_FILE as u64)?;
                (reply.status, reply.body)
            }
        };
        if status != 200 {
            return Err(failed(status, &body, false));
        }
        Ok(File { bytes: body, version, content_type })
    }

    fn write(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        if path.trim_matches('/').is_empty() {
            return Err("A file needs a name.".into());
        }
        if bytes.len() > SIMPLE_UPLOAD {
            return self.upload_in_pieces(path, bytes, version);
        }
        let behaviour = if version.is_some() { "replace" } else { "fail" };
        let url = format!("{}?@microsoft.graph.conflictBehavior={behaviour}", self.item(path, "/content")?);
        let mut headers = vec![("Content-Type", "application/octet-stream")];
        if let Some(v) = version {
            headers.push(("If-Match", v));
        }
        let reply = self.call("PUT", &url, &headers, Some(bytes), MAX_JSON)?;
        match reply.status {
            200 | 201 => Ok(reply.json().get("eTag").and_then(Value::as_str).map(str::to_owned)),
            // A change to a file that was deleted meanwhile: someone changed it there.
            404 if version.is_some() => Err(CHANGED.into()),
            s => Err(failed(s, &reply.body, version.is_some())),
        }
    }

    fn make_folder(&self, path: &str) -> Res<()> {
        let names = self.names(path)?;
        let Some(last) = names.last().filter(|_| !path.trim_matches('/').is_empty()) else { return Err("A folder needs a name.".into()) };
        let parent = path.trim_matches('/').rsplit_once('/').map_or("", |(p, _)| p);
        let body = json!({ "name": last, "folder": {}, "@microsoft.graph.conflictBehavior": "fail" }).to_string();
        let reply = self.call("POST", &self.item(parent, "/children")?, &[("Content-Type", "application/json")], Some(body.as_bytes()), MAX_JSON)?;
        match reply.status {
            200 | 201 => Ok(()),
            s => Err(failed(s, &reply.body, false)),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Res<()> {
        if from.trim_matches('/').is_empty() || to.trim_matches('/').is_empty() {
            return Err("The drive's top folder cannot be moved.".into());
        }
        let (to_parent, to_name) = to.trim_matches('/').rsplit_once('/').unwrap_or(("", to.trim_matches('/')));
        self.names(to)?;
        // The destination folder by its id, which works the same on OneDrive and SharePoint.
        let parent = self.get_json(&self.item(to_parent, "")?)?;
        if parent.status != 200 {
            return Err(failed(parent.status, &parent.body, false));
        }
        let parent_id = parent.json().get("id").and_then(Value::as_str).ok_or("OneDrive did not say where that folder is.")?.to_owned();
        let body = json!({ "name": to_name, "parentReference": { "id": parent_id } }).to_string();
        let url = format!("{}?@microsoft.graph.conflictBehavior=fail", self.item(from, "")?);
        let reply = self.call("PATCH", &url, &[("Content-Type", "application/json")], Some(body.as_bytes()), MAX_JSON)?;
        match reply.status {
            200 => Ok(()),
            s => Err(failed(s, &reply.body, false)),
        }
    }

    fn delete(&self, path: &str, version: Option<&str>) -> Res<()> {
        if path.trim_matches('/').is_empty() {
            return Err("The drive's top folder cannot be deleted.".into());
        }
        let headers: Vec<(&str, &str)> = version.map(|v| ("If-Match", v)).into_iter().collect();
        let reply = self.call("DELETE", &self.item(path, "")?, &headers, None, MAX_JSON)?;
        match reply.status {
            204 | 200 => Ok(()),
            s => Err(failed(s, &reply.body, version.is_some())),
        }
    }
}

/// A sign-in waiting for the person in the browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
    pub url: String,
}

/// What a finished sign-in gives: the tokens, who signed in, and their own OneDrive's id.
pub struct SignedIn {
    pub tokens: Tokens,
    pub email: String,
    pub name: String,
    pub drive: String,
}

/// Where a shared link points: a drive and a folder in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub drive: String,
    pub folder: String,
    /// The folder's own name (the library's, for a whole library).
    pub name: String,
}

/// Microsoft sign-in for Drives: one at a time.
pub struct Service {
    pub client_id: Option<String>,
    pub at: Endpoints,
    /// What the sign-in asks for: OneDrive's files, or (Calendar's own sign-in) the calendars.
    scopes: &'static str,
    http: ureq::Agent,
    pending: Mutex<Option<(Pending, Arc<AtomicBool>)>>,
}

impl Service {
    pub fn new(client_id: Option<String>, at: Endpoints, http: ureq::Agent) -> Service {
        Service { client_id, at, scopes: SCOPES, http, pending: Mutex::new(None) }
    }

    /// The same sign-in, asking for `scopes` instead of OneDrive's.
    #[must_use]
    pub fn with_scopes(mut self, scopes: &'static str) -> Service {
        self.scopes = scopes;
        self
    }

    pub fn status(&self) -> Value {
        json!({ "setUp": self.client_id.is_some(), "pending": lock(&self.pending).as_ref().map(|(p, _)| p.url.clone()) })
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = lock(&self.pending).as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    pub(crate) fn account(&self, secrets: Arc<dyn Secrets>, secret: &str) -> Res<Arc<Account>> {
        let client_id = self.client_id.clone().ok_or_else(|| NOT_SET_UP.to_owned())?;
        Ok(Arc::new(Account { client_id, scopes: self.scopes, token_url: self.at.token.clone(), secrets, secret: secret.to_owned(), http: self.http.clone(), refreshing: Mutex::new(()) }))
    }

    /// The drive `drive` (an id from Graph), at `folder` in it, for the tokens kept under `secret`.
    pub fn open(&self, secrets: Arc<dyn Secrets>, secret: &str, drive: &str, folder: &str) -> Res<OneDrive> {
        Ok(OneDrive { account: self.account(secrets, secret)?, graph: self.at.graph.clone(), drive: drive.to_owned(), root: folder.trim_matches('/').to_owned() })
    }

    /// Where a SharePoint or OneDrive link to a folder or library points, with the tokens kept under `secret`.
    pub fn resolve(&self, secrets: Arc<dyn Secrets>, secret: &str, link: &str) -> Res<Place> {
        let link = link.trim();
        let parsed = url::Url::parse(link).map_err(|_| "That isn't a link. Copy the folder's or library's link from SharePoint or OneDrive.".to_owned())?;
        if parsed.scheme() != "https" {
            return Err("That isn't a SharePoint or OneDrive link.".into());
        }
        let id = format!("u!{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(link));
        let drive = OneDrive { account: self.account(secrets, secret)?, graph: self.at.graph.clone(), drive: String::new(), root: String::new() };
        let reply = drive.get_json(&format!("{}/shares/{id}/driveItem", self.at.graph))?;
        match reply.status {
            200 => {}
            403 | 404 => return Err("That link doesn't open for this account. Check it's a link to a folder or library you can reach.".into()),
            s => return Err(failed(s, &reply.body, false)),
        }
        let item = reply.json();
        if item.get("folder").is_none() && item.get("root").is_none() {
            return Err("That link is to a file. Use the link of a folder or a whole library.".into());
        }
        let drive_id = item.pointer("/parentReference/driveId").and_then(Value::as_str).ok_or("SharePoint did not say which library that is.")?.to_owned();
        let name = item.get("name").and_then(Value::as_str).unwrap_or("").to_owned();
        let folder = if item.get("root").is_some() {
            String::new()
        } else {
            let parent = item.pointer("/parentReference/path").and_then(Value::as_str).unwrap_or("");
            let under = parent.split_once("root:").map_or("", |(_, p)| p);
            let under = percent_decode_str(under).decode_utf8_lossy().trim_matches('/').to_owned();
            if under.is_empty() { name.clone() } else { format!("{under}/{name}") }
        };
        Ok(Place { drive: drive_id, folder, name })
    }

    /// Start a browser sign-in and return the page to open; `finish` gets the result on the sign-in's own thread.
    pub fn start(self: &Arc<Self>, finish: Arc<dyn Fn(Res<SignedIn>) + Send + Sync>) -> Res<Pending> {
        if let Some((p, _)) = lock(&self.pending).as_ref() {
            return Ok(p.clone());
        }
        let client_id = self.client_id.clone().ok_or_else(|| NOT_SET_UP.to_owned())?;
        let callback = Callback::listen("/")?;
        // Registered as `http://localhost`; Microsoft lets a desktop app add any port to it.
        let redirect = format!("http://localhost:{}", callback.port());
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&self.at.auth).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair("response_mode", "query")
            .append_pair("scope", self.scopes)
            .append_pair("state", &state)
            .append_pair("prompt", "select_account")
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256");
        let pending = Pending { url: url.to_string() };
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.pending) = Some((pending.clone(), cancel.clone()));
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Microsoft", &state, &cancel, MAX_WAIT, |query| me.exchange(&client_id, query, &verifier, &redirect));
            *lock(&me.pending) = None;
            finish(result);
        });
        Ok(pending)
    }

    fn exchange(&self, client_id: &str, query: &HashMap<String, String>, verifier: &str, redirect: &str) -> Res<SignedIn> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 8192).ok_or("Microsoft sent no sign-in code.")?;
        let body = form(&[("client_id", client_id), ("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirect), ("code_verifier", verifier), ("scope", self.scopes)]);
        let response = self.http.post(&self.at.token).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Microsoft: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        let tokens: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status != 200 {
            return Err(format!("Microsoft refused the sign-in (HTTP {status})."));
        }
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Microsoft did not send a token.")?.to_owned();
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        let expires = now() + tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        let get = |path: &str| -> Res<Value> {
            let response = self.http.get(&format!("{}{path}", self.at.graph)).header("Authorization", &format!("Bearer {access}")).call().map_err(|e| format!("Could not reach Microsoft: {e}"))?;
            let (status, _, body) = read_body(response, MAX_JSON)?;
            if status != 200 {
                return Err(format!("Microsoft did not answer {path} (HTTP {status})."));
            }
            Ok(serde_json::from_slice(&body).unwrap_or(Value::Null))
        };
        let me = get("/me")?;
        let email = me.get("mail").and_then(Value::as_str).filter(|m| !m.is_empty()).or_else(|| me.get("userPrincipalName").and_then(Value::as_str)).unwrap_or("").chars().take(200).collect();
        let name = me.get("displayName").and_then(Value::as_str).unwrap_or("").chars().take(100).collect();
        // A work account without a OneDrive yet has none to give; SharePoint links still work.
        let drive = get("/me/drive").ok().and_then(|d| d.get("id").and_then(Value::as_str).map(str::to_owned)).unwrap_or_default();
        Ok(SignedIn { tokens: Tokens { access, refresh, expires }, email, name, drive })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::{Read, Write};

    /// One item in the pretend Graph: the name as shown, the bytes (`None` for a folder), the eTag number and the id.
    #[derive(Clone)]
    pub(crate) struct Item {
        pub shown: String,
        pub bytes: Option<Vec<u8>>,
        pub tag: u64,
        pub id: String,
    }

    /// What the pretend Graph holds: `drive/path` (lowercase, as OneDrive compares) → item. Drives are `me-drive`, the
    /// signed-in person's OneDrive, and `team-drive`, a SharePoint library shared by link.
    pub(crate) type Store = Arc<Mutex<BTreeMap<String, Item>>>;

    fn reply(s: &mut std::net::TcpStream, status: u16, headers: &str, body: &[u8]) {
        let _ = write!(s, "HTTP/1.1 {status} X\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n", body.len());
        let _ = s.write_all(body);
    }

    fn error(code: &str) -> Vec<u8> {
        json!({ "error": { "code": code, "message": "..." } }).to_string().into_bytes()
    }

    pub(crate) const SHARED_LINK: &str = "https://contoso.sharepoint.com/:f:/s/Team/EabcDEF";

    /// A pretend Microsoft: the token endpoint (code `the-code`; refresh tokens rotate `refresh-N`), `/me`, `/me/drive`,
    /// `/shares` for one SharePoint link, and enough of `/drives/{id}/root…` for a drive, with pages of three and
    /// upload sessions. Tokens are `access-N`.
    pub(crate) fn server() -> (String, Store, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let store: Store = Arc::default();
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let (st, lg, base) = (store.clone(), log.clone(), url.clone());
        std::thread::spawn(move || {
            let mut tag = 100u64;
            let mut minted = 0;
            let mut refreshes = 1;
            let mut sessions: HashMap<String, (String, Option<u64>, Vec<u8>)> = HashMap::new();
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut data = Vec::new();
                let mut buf = [0u8; 65536];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if data.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let end = data.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(data.len());
                let head = String::from_utf8_lossy(&data[..end]).to_string();
                let body = data.get(end + 4..).unwrap_or_default().to_vec();
                let method = head.split_whitespace().next().unwrap_or("").to_owned();
                let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                let header = |name: &str| head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_owned())).unwrap_or_default();
                lg.lock().unwrap().push(format!("{method} {target}"));
                let text = String::from_utf8_lossy(&body).to_string();
                if target == "/token" {
                    let refresh = format!("refresh-{refreshes}");
                    if text.contains("grant_type=authorization_code") && text.contains("code=the-code") && text.contains("code_verifier=") && text.contains("client_id=client-id") && text.contains("offline_access") {
                        minted += 1;
                        reply(&mut s, 200, "", json!({ "access_token": format!("access-{minted}"), "refresh_token": refresh, "expires_in": 3600 }).to_string().as_bytes());
                    } else if text.contains(&format!("refresh_token={refresh}&")) {
                        minted += 1;
                        refreshes += 1;
                        reply(&mut s, 200, "", json!({ "access_token": format!("access-{minted}"), "refresh_token": format!("refresh-{refreshes}"), "expires_in": 3600 }).to_string().as_bytes());
                    } else {
                        reply(&mut s, 400, "", br#"{"error":"invalid_grant"}"#);
                    }
                    continue;
                }
                // Upload session pieces carry no token.
                if let Some(session) = target.strip_prefix("/upload/") {
                    let session = session.to_owned();
                    let Some((key, want, mut got)) = sessions.remove(&session) else {
                        reply(&mut s, 404, "", &error("itemNotFound"));
                        continue;
                    };
                    if method == "DELETE" {
                        reply(&mut s, 204, "", b"");
                        continue;
                    }
                    let range = header("content-range");
                    let total: usize = range.rsplit('/').next().and_then(|t| t.parse().ok()).unwrap_or(0);
                    got.extend_from_slice(&body);
                    if got.len() < total {
                        sessions.insert(session, (key, want, got));
                        reply(&mut s, 202, "", b"{}");
                        continue;
                    }
                    let mut st = st.lock().unwrap();
                    if want.is_some_and(|w| st.get(&key).map(|i| i.tag) != Some(w)) {
                        reply(&mut s, 412, "", &error("resourceModified"));
                        continue;
                    }
                    tag += 1;
                    let shown = key.split_once('/').map_or("", |(_, p)| p).to_owned();
                    let shown = st.get(&key).map_or(shown, |i| i.shown.clone());
                    st.insert(key.clone(), Item { shown: shown.clone(), bytes: Some(got.clone()), tag, id: format!("id-{tag}") });
                    reply(&mut s, 201, "", json!({ "name": shown.rsplit('/').next(), "eTag": format!("\"{{{tag}}},1\""), "size": got.len() }).to_string().as_bytes());
                    continue;
                }
                if let Some(path) = target.strip_prefix("/download/") {
                    let key = percent_decode_str(path).decode_utf8_lossy().to_string();
                    match st.lock().unwrap().get(&key) {
                        Some(Item { bytes: Some(b), .. }) => reply(&mut s, 200, "", b),
                        _ => reply(&mut s, 404, "", &error("itemNotFound")),
                    }
                    continue;
                }
                if !header("authorization").starts_with("Bearer access-") {
                    reply(&mut s, 401, "", &error("InvalidAuthenticationToken"));
                    continue;
                }
                let Some(rest) = target.strip_prefix("/v1.0") else {
                    reply(&mut s, 404, "", &error("itemNotFound"));
                    continue;
                };
                let (route, query) = rest.split_once('?').map_or((rest.to_owned(), String::new()), |(a, b)| (a.to_owned(), b.to_owned()));
                let query = percent_decode_str(&query).decode_utf8_lossy().to_string();
                let etag = |n: u64| format!("\"{{{n}}},1\"");
                let mut st = st.lock().unwrap();
                let meta = |key: &str, i: &Item| match &i.bytes {
                    Some(b) => json!({ "id": i.id, "name": i.shown.rsplit('/').next(), "size": b.len(), "eTag": etag(i.tag), "lastModifiedDateTime": "2026-11-16T10:00:00Z", "file": { "mimeType": "text/markdown" }, "@microsoft.graph.downloadUrl": format!("{base}/download/{}", utf8_percent_encode(key, SEGMENT)) }),
                    None => json!({ "id": i.id, "name": i.shown.rsplit('/').next(), "folder": { "childCount": 0 }, "eTag": etag(i.tag) }),
                };
                let (status, out): (u16, Vec<u8>) = if route == "/me" {
                    (200, json!({ "displayName": "Ana", "userPrincipalName": "ana@contoso.com", "mail": null }).to_string().into_bytes())
                } else if route == "/me/drive" {
                    (200, json!({ "id": "me-drive", "driveType": "business" }).to_string().into_bytes())
                } else if let Some(share) = route.strip_prefix("/shares/").and_then(|r| r.strip_suffix("/driveItem")) {
                    if share == format!("u!{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(SHARED_LINK)) {
                        let i = st.get("team-drive/projects").cloned();
                        match i {
                            Some(i) => (200, json!({ "id": i.id, "name": i.shown, "folder": {}, "parentReference": { "driveId": "team-drive", "path": "/drives/team-drive/root:" } }).to_string().into_bytes()),
                            None => (404, error("itemNotFound")),
                        }
                    } else {
                        (404, error("itemNotFound"))
                    }
                } else if let Some(at) = route.strip_prefix("/drives/") {
                    let (drive, after) = at.split_once("/root").unwrap_or((at, ""));
                    // `/root`, `/root/children`, or `/root:/a/b:` and a suffix.
                    let (path, suffix) = match after.strip_prefix(":/") {
                        Some(p) => {
                            let (p, suffix) = p.split_once(':').unwrap_or((p, ""));
                            (percent_decode_str(p).decode_utf8_lossy().to_string(), suffix.to_owned())
                        }
                        None => (String::new(), after.to_owned()),
                    };
                    let key = |p: &str| format!("{drive}/{}", p.to_lowercase());
                    let k = key(&path);
                    let exists = |st: &BTreeMap<String, Item>, k: &str| k.ends_with('/') || st.contains_key(k);
                    match (method.as_str(), suffix.as_str()) {
                        ("GET", "") => match st.get(&k) {
                            _ if path.is_empty() => (200, json!({ "id": format!("{drive}-root"), "name": "root", "root": {}, "folder": {} }).to_string().into_bytes()),
                            Some(i) => (200, meta(&k, i).to_string().into_bytes()),
                            None => (404, error("itemNotFound")),
                        },
                        ("GET", "/children") => {
                            if !exists(&st, &k) || st.get(&k).is_some_and(|i| i.bytes.is_some()) {
                                (404, error("itemNotFound"))
                            } else {
                                let prefix = if path.is_empty() { format!("{drive}/") } else { format!("{k}/") };
                                let all: Vec<Value> = st.iter().filter(|(kk, _)| kk.starts_with(&prefix) && !kk[prefix.len()..].contains('/')).map(|(kk, i)| meta(kk, i)).collect();
                                let skip: usize = query.split('&').find_map(|q| q.strip_prefix("skip=")).and_then(|n| n.parse().ok()).unwrap_or(0);
                                let page: Vec<Value> = all.iter().skip(skip).take(3).cloned().collect();
                                let mut out = json!({ "value": page });
                                if skip + 3 < all.len() {
                                    out["@odata.nextLink"] = json!(format!("{base}/v1.0{route}?$top=200&skip={}", skip + 3));
                                }
                                (200, out.to_string().into_bytes())
                            }
                        }
                        ("PUT", "/content") => {
                            let current = st.get(&k).map(|i| etag(i.tag));
                            let if_match = header("if-match");
                            if !if_match.is_empty() && current.as_deref() != Some(if_match.as_str()) {
                                (if current.is_none() { 404 } else { 412 }, error(if current.is_none() { "itemNotFound" } else { "resourceModified" }))
                            } else if query.contains("conflictBehavior=fail") && current.is_some() {
                                (409, error("nameAlreadyExists"))
                            } else {
                                // OneDrive makes the folders a file goes in.
                                let parts: Vec<&str> = path.split('/').collect();
                                for n in 1..parts.len() {
                                    let shown = parts[..n].join("/");
                                    st.entry(key(&shown)).or_insert(Item { shown, bytes: None, tag: 1, id: format!("folder-{}", parts[..n].join("-")) });
                                }
                                tag += 1;
                                let shown = st.get(&k).map_or(path.clone(), |i| i.shown.clone());
                                let item = Item { shown, bytes: Some(body.clone()), tag, id: format!("id-{tag}") };
                                let out = meta(&k, &item).to_string().into_bytes();
                                st.insert(k.clone(), item);
                                (201, out)
                            }
                        }
                        ("POST", "/createUploadSession") => {
                            let current = st.get(&k).map(|i| i.tag);
                            let if_match = header("if-match");
                            if !if_match.is_empty() && current.map(etag).as_deref() != Some(if_match.as_str()) {
                                (412, error("resourceModified"))
                            } else if text.contains("\"fail\"") && current.is_some() {
                                (409, error("nameAlreadyExists"))
                            } else {
                                let id = format!("s{}", sessions.len() + 1);
                                sessions.insert(id.clone(), (k.clone(), current.filter(|_| !if_match.is_empty()), Vec::new()));
                                if !st.contains_key(&k) {
                                    // A new file keeps the name it was given.
                                    sessions.get_mut(&id).unwrap().0 = k.clone();
                                }
                                (200, json!({ "uploadUrl": format!("{base}/upload/{id}") }).to_string().into_bytes())
                            }
                        }
                        ("POST", "/children") => {
                            let asked: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                            let name = asked["name"].as_str().unwrap_or("").to_owned();
                            if !path.is_empty() && !st.get(&k).is_some_and(|i| i.bytes.is_none()) {
                                (404, error("itemNotFound"))
                            } else {
                                let shown = if path.is_empty() { name.clone() } else { format!("{}/{name}", st.get(&k).map_or(path.clone(), |i| i.shown.clone())) };
                                if st.contains_key(&key(&shown)) {
                                    (409, error("nameAlreadyExists"))
                                } else {
                                    tag += 1;
                                    st.insert(key(&shown), Item { shown: shown.clone(), bytes: None, tag, id: format!("folder-{tag}") });
                                    (201, json!({ "id": format!("folder-{tag}"), "name": name, "folder": {} }).to_string().into_bytes())
                                }
                            }
                        }
                        ("PATCH", "") => {
                            let asked: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                            let name = asked["name"].as_str().unwrap_or("").to_owned();
                            let parent_id = asked.pointer("/parentReference/id").and_then(Value::as_str).unwrap_or("").to_owned();
                            let parent = if parent_id == format!("{drive}-root") { Some(String::new()) } else { st.values().find(|i| i.id == parent_id && i.bytes.is_none()).map(|i| i.shown.clone()) };
                            match (st.contains_key(&k), parent) {
                                (false, _) => (404, error("itemNotFound")),
                                (_, None) => (400, error("invalidRequest")),
                                (true, Some(parent)) => {
                                    let to = if parent.is_empty() { name.clone() } else { format!("{parent}/{name}") };
                                    if st.contains_key(&key(&to)) {
                                        (409, error("nameAlreadyExists"))
                                    } else {
                                        let moving: Vec<String> = st.keys().filter(|kk| **kk == k || kk.starts_with(&format!("{k}/"))).cloned().collect();
                                        for kk in moving {
                                            let mut i = st.remove(&kk).unwrap();
                                            i.shown = format!("{to}{}", &i.shown[path.len()..]);
                                            st.insert(key(&i.shown), i);
                                        }
                                        (200, b"{}".to_vec())
                                    }
                                }
                            }
                        }
                        ("DELETE", "") => match st.get(&k) {
                            None => (404, error("itemNotFound")),
                            Some(i) if !header("if-match").is_empty() && header("if-match") != etag(i.tag) => (412, error("resourceModified")),
                            Some(_) => {
                                let gone: Vec<String> = st.keys().filter(|kk| **kk == k || kk.starts_with(&format!("{k}/"))).cloned().collect();
                                for kk in gone {
                                    st.remove(&kk);
                                }
                                (204, Vec::new())
                            }
                        },
                        _ => (404, error("itemNotFound")),
                    }
                } else {
                    (404, error("itemNotFound"))
                };
                drop(st);
                reply(&mut s, status, "", &out);
            }
        });
        (url, store, log)
    }

    pub(crate) fn service(url: &str) -> Arc<Service> {
        let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).allow_non_standard_methods(true).build().into();
        Arc::new(Service::new(Some("client-id".into()), Endpoints { auth: format!("{url}/authorize"), token: format!("{url}/token"), graph: format!("{url}/v1.0") }, http))
    }

    /// Signs in as the browser would and returns the tokens.
    pub(crate) fn sign_in(service: &Arc<Service>) -> SignedIn {
        let (tx, rx) = std::sync::mpsc::channel();
        let pending = service.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        let page = url::Url::parse(&pending.url).unwrap();
        let param = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
        assert_eq!(param("scope"), SCOPES);
        assert_eq!(param("code_challenge_method"), "S256");
        let redirect = param("redirect_uri");
        assert!(redirect.starts_with("http://localhost:") && !redirect.ends_with('/'), "{redirect}");
        let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let port = redirect.rsplit(':').next().unwrap();
        http.get(&format!("http://127.0.0.1:{port}/?state={}&code=the-code", param("state"))).call().unwrap();
        rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap()
    }

    pub(crate) fn drive(url: &str, drive: &str, folder: &str) -> (OneDrive, Arc<crate::secrets::MemorySecrets>) {
        let service = service(url);
        let signed = sign_in(&service);
        let secrets = Arc::new(crate::secrets::MemorySecrets::new(true));
        secrets.put("drive:x", &serde_json::to_string(&signed.tokens).unwrap());
        (service.open(secrets.clone(), "drive:x", drive, folder).unwrap(), secrets)
    }

    #[test]
    fn a_onedrive_is_a_drive_whose_changes_never_overwrite_one_made_there() {
        let (url, store, log) = server();
        let (drive, secrets) = drive(&url, "me-drive", "");
        drive.check().unwrap();
        drive.make_folder("Plans").unwrap();
        assert_eq!(drive.make_folder("Plans").unwrap_err(), EXISTS);
        let v1 = drive.write("Plans/road map #1.md", b"# Road map", None).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map #1.md", b"again", None).unwrap_err(), EXISTS, "a new file never replaces one");
        let v2 = drive.write("Plans/road map #1.md", b"# Road map, v2", Some(&v1)).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map #1.md", b"stale", Some(&v1)).unwrap_err(), CHANGED);
        let file = drive.read("Plans/road map #1.md").unwrap();
        assert_eq!((file.bytes.as_slice(), file.version.as_deref()), (&b"# Road map, v2"[..], Some(v2.as_str())));
        assert_eq!(drive.delete("Plans/road map #1.md", Some(&v1)).unwrap_err(), CHANGED, "a delete of a version that changed is refused");

        // Pages of three are followed to the end.
        for n in 0..7 {
            drive.write(&format!("Plans/n{n}.md"), b"x", None).unwrap();
        }
        let names: Vec<String> = drive.list("Plans").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names.len(), 8, "{names:?}");

        drive.make_folder("Done").unwrap();
        drive.rename("Plans/n0.md", "Done/first.md").unwrap();
        assert_eq!(drive.rename("Plans/n1.md", "Done/first.md").unwrap_err(), EXISTS, "a move never replaces what is there");
        drive.rename("Done", "Archive").unwrap();
        assert_eq!(drive.read("Archive/first.md").unwrap().bytes, b"x");
        assert_eq!(drive.read("Plans/n0.md").unwrap_err(), GONE);
        drive.delete("Archive", None).unwrap();
        assert!(!lock(&store).keys().any(|k| k.starts_with("me-drive/archive")));

        // A file over 4 MB goes up in pieces, and still can't overwrite a change made there.
        let big = vec![7u8; SIMPLE_UPLOAD + PIECE + 5];
        let vb = drive.write("Plans/big.bin", &big, None).unwrap().unwrap();
        assert_eq!(lock(&store).get("me-drive/plans/big.bin").and_then(|i| i.bytes.clone()).map(|b| b.len()), Some(big.len()));
        assert!(lock(&log).iter().filter(|l| l.starts_with("PUT /upload/")).count() >= 2, "sent in pieces");
        drive.write("Plans/big.bin", b"small now", Some(&vb)).unwrap();
        assert_eq!(drive.write("Plans/big.bin", &big, Some(&vb)).unwrap_err(), CHANGED);

        // A token that has run out is refreshed, and the new refresh token is kept.
        let mut tokens: Tokens = serde_json::from_str(&secrets.get("drive:x").unwrap()).unwrap();
        tokens.expires = 0;
        secrets.put("drive:x", &serde_json::to_string(&tokens).unwrap());
        drive.check().unwrap();
        let kept: Tokens = serde_json::from_str(&secrets.get("drive:x").unwrap()).unwrap();
        assert_eq!(kept.refresh, "refresh-2");
        assert!(lock(&log).iter().all(|l| !l.contains("access-")), "a token never goes in an address");
    }

    #[test]
    fn a_sharepoint_library_is_found_from_its_link() {
        let (url, store, _log) = server();
        lock(&store).insert("team-drive/projects".into(), Item { shown: "Projects".into(), bytes: None, tag: 1, id: "projects".into() });
        let service = service(&url);
        let signed = sign_in(&service);
        assert_eq!((signed.email.as_str(), signed.name.as_str(), signed.drive.as_str()), ("ana@contoso.com", "Ana", "me-drive"));
        let secrets = Arc::new(crate::secrets::MemorySecrets::new(true));
        secrets.put("drive:t", &serde_json::to_string(&signed.tokens).unwrap());
        let place = service.resolve(secrets.clone(), "drive:t", SHARED_LINK).unwrap();
        assert_eq!(place, Place { drive: "team-drive".into(), folder: "Projects".into(), name: "Projects".into() });
        assert!(service.resolve(secrets.clone(), "drive:t", "https://contoso.sharepoint.com/elsewhere").is_err());
        assert!(service.resolve(secrets.clone(), "drive:t", "not a link").is_err());
        let drive = service.open(secrets, "drive:t", &place.drive, &place.folder).unwrap();
        drive.write("Brief.md", b"# Brief", None).unwrap();
        assert!(lock(&store).contains_key("team-drive/projects/brief.md"));
        assert_eq!(drive.list("").unwrap()[0].path, "Brief.md");
    }

    #[test]
    fn two_way_sync_with_a_onedrive_loses_nothing() {
        let (url, _store, _log) = server();
        let (drive, _) = drive(&url, "me-drive", "");
        let (other, _) = self::drive(&url, "me-drive", "");
        drive.make_folder("Notes").unwrap();
        let root = tempfile::tempdir().unwrap();
        let mut side = crate::drive_sync::tests::RealServer { drive: Box::new(other), remote: "Notes".into(), settle_ms: 0 };
        crate::drive_sync::tests::soak(&drive, root.path(), "Notes", &mut side, 80);
    }

    /// Drives keep a OneDrive folder, or a folder in a SharePoint library from its link, once the person allows it in
    /// the browser. A missing folder is made, and the drive opens again from what was kept.
    #[test]
    fn drives_keep_a_onedrive_folder_and_a_sharepoint_library_once_signed_in() {
        let (url, store, _log) = server();
        lock(&store).insert("team-drive/projects".into(), Item { shown: "Projects".into(), bytes: None, tag: 1, id: "projects".into() });
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(crate::secrets::MemorySecrets::new(true));
        let drives = Arc::new(crate::drives::Drives::new(dir.path(), secrets.clone()));
        let service = service(&url);
        drives.use_onedrive(Service::new(service.client_id.clone(), service.at.clone(), ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).build().into()));
        assert_eq!(drives.onedrive_status()["setUp"], true);
        let add = |folder: &str, link: &str| {
            let (tx, rx) = std::sync::mpsc::channel();
            let tx = Mutex::new(tx);
            let pending = drives.add_onedrive("", folder, link, None, Arc::new(move |r| lock(&tx).send(r).unwrap())).unwrap();
            let page = url::Url::parse(pending["url"].as_str().unwrap()).unwrap();
            let param = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
            let port = param("redirect_uri").rsplit(':').next().unwrap().to_owned();
            let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
            http.get(&format!("http://127.0.0.1:{port}/?state={}&code=the-code", param("state"))).call().unwrap();
            rx.recv_timeout(Duration::from_secs(10)).unwrap()
        };
        let mine = add("Work/Plans", "").unwrap();
        assert_eq!((mine["kind"].as_str(), mine["name"].as_str(), mine["url"].as_str(), mine["username"].as_str()), (Some("onedrive"), Some("Plans"), Some("onedrive:me-drive/Work/Plans"), Some("ana@contoso.com")));
        assert!(lock(&store).contains_key("me-drive/work/plans"), "the folder is made");
        let team = add("", SHARED_LINK).unwrap();
        assert_eq!((team["name"].as_str(), team["url"].as_str()), (Some("Projects"), Some("onedrive:team-drive/Projects")));
        assert!(add("", "https://contoso.sharepoint.com/nope").is_err());
        drives.open(team["id"].as_str().unwrap()).unwrap().write("idea.md", b"one", None).unwrap();
        assert!(lock(&store).contains_key("team-drive/projects/idea.md"));
        let kept = crate::drives::Drives::new(dir.path(), secrets).list();
        assert_eq!(kept.as_array().map(Vec::len), Some(2), "both drives are kept, the failed one isn't");
    }

    #[test]
    fn without_a_client_id_onedrive_is_not_set_up() {
        let http: ureq::Agent = ureq::Agent::config_builder().build().into();
        let service = Arc::new(Service::new(None, Endpoints::default(), http));
        assert_eq!(service.status()["setUp"], false);
        assert_eq!(service.start(Arc::new(|_| {})).unwrap_err(), NOT_SET_UP);
    }
}
