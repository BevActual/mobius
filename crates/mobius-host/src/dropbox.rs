//! Dropbox as a drive (docs/reference/drive-sign-in.md, "Dropbox"): the person signs in on Dropbox's page, and their
//! Dropbox (or a folder in it) is a drive like any other in Files, with two-way sync.
//!
//! - Sign-in is OAuth with PKCE and no secret, back to `http://127.0.0.1:47613/dropbox`, the one address registered with
//!   Dropbox. Tokens last four hours and are refreshed; they stay in the system secret store as the drive's "password".
//! - Files go through Dropbox's API v2. A change carries the file's revision (`rev`), so a file changed on Dropbox since
//!   is refused, never overwritten (`mode: update`), and a new file never replaces one (`mode: add`, no renaming).
//!
//! The app key is built in from `MOBIUS_DROPBOX_APP_KEY`. Until it is, Dropbox says it isn't set up.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::drives::{CHANGED, Drive, EXISTS, Entry, File, MAX_FILE};
use crate::loopback::{Callback, challenge, random_text};
use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

pub const NOT_SET_UP: &str = "Dropbox isn't set up in this build of Mobius yet.";
const EXPIRED: &str = "The Dropbox sign-in has ended. Sign in to Dropbox again from the drive's menu in Files.";
const GONE: &str = "That is not on the drive any more.";
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 8 * 1024 * 1024;
/// Dropbox takes one upload request up to 150 MB; bigger files need an upload session, which comes later.
const MAX_UPLOAD: u64 = 150 * 1024 * 1024;

/// Where Dropbox is, and the port its sign-in comes back to. A pretend Dropbox in tests.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub api: String,
    pub content: String,
    pub port: u16,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints { auth: "https://www.dropbox.com/oauth2/authorize".into(), api: "https://api.dropboxapi.com".into(), content: "https://content.dropboxapi.com".into(), port: 47613 }
    }
}

/// The app key built into this copy of Mobius, if any.
pub fn built_in_key() -> Option<String> {
    option_env!("MOBIUS_DROPBOX_APP_KEY").filter(|k| !k.is_empty()).map(str::to_owned)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    /// When `access` runs out, in seconds since 1970.
    pub expires: u64,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>())).collect::<Vec<_>>().join("&")
}

fn read_body(response: ureq::http::Response<ureq::Body>, limit: u64) -> Res<(u16, HashMap<String, String>, Vec<u8>)> {
    let status = response.status().as_u16();
    let headers = response.headers().iter().filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_ascii_lowercase(), v.to_owned()))).collect();
    let mut body = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), limit + 1), &mut body).map_err(|e| format!("The answer did not arrive whole: {e}"))?;
    if body.len() as u64 > limit {
        return Err(format!("Files bigger than {} MB can't be opened from a drive in one go.", limit / (1024 * 1024)));
    }
    Ok((status, headers, body))
}

/// JSON for an HTTP header: Dropbox wants anything past ASCII written as `\uXXXX`.
fn header_json(value: &Value) -> String {
    value.to_string().encode_utf16().map(|u| if u < 0x80 { char::from(u8::try_from(u).unwrap_or(b'?')).to_string() } else { format!("\\u{u:04x}") }).collect()
}

/// A drive path as Dropbox writes it, under `root` (`""` is the whole Dropbox; its top is `""`, not `/`).
fn dropbox_path(root: &str, path: &str) -> Res<String> {
    let mut names = Vec::new();
    for n in path.split('/').filter(|n| !n.is_empty()) {
        if n == "." || n == ".." || n.contains('\\') || n.chars().any(char::is_control) {
            return Err(format!("\"{path}\" is not a path on the drive."));
        }
        names.push(n);
    }
    let root = root.trim_matches('/');
    let mut out = String::new();
    for part in std::iter::once(root).filter(|r| !r.is_empty()).chain(names) {
        out.push('/');
        out.push_str(part);
    }
    Ok(out)
}

/// The tokens of one Dropbox drive, kept in the secret store and refreshed there.
pub struct Account {
    app_key: String,
    api: String,
    secrets: Arc<dyn Secrets>,
    secret: String,
    http: ureq::Agent,
    refreshing: Mutex<()>,
}

impl Account {
    fn tokens(&self) -> Res<Tokens> {
        self.secrets.get(&self.secret).and_then(|t| serde_json::from_str(&t).ok()).ok_or_else(|| EXPIRED.to_owned())
    }

    /// A token good for a few minutes more; `stale` refreshes it whatever its time says (Dropbox said 401).
    fn token(&self, stale: bool) -> Res<String> {
        let _one_at_a_time = lock(&self.refreshing);
        let tokens = self.tokens()?;
        if !stale && tokens.expires > now() + SKEW_SECONDS {
            return Ok(tokens.access);
        }
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let body = form(&[("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("client_id", &self.app_key)]);
        let response = self.http.post(&format!("{}/oauth2/token", self.api)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Dropbox: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        let fresh: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status == 400 && fresh.get("error").and_then(Value::as_str) == Some("invalid_grant") {
            return Err(EXPIRED.into());
        }
        if status != 200 {
            return Err(format!("Dropbox could not refresh the sign-in (HTTP {status}). Try again later."));
        }
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|a| !a.is_empty()).ok_or("Dropbox did not send a token.")?.to_owned();
        let expires = now() + fresh.get("expires_in").and_then(Value::as_u64).unwrap_or(4 * 3600);
        let next = Tokens { access: access.clone(), refresh: tokens.refresh, expires };
        self.secrets.put(&self.secret, &serde_json::to_string(&next).map_err(|e| e.to_string())?);
        Ok(access)
    }
}

/// A Dropbox, or a folder in one, as a drive.
pub struct Dropbox {
    account: Arc<Account>,
    api: String,
    content: String,
    root: String,
}

/// An error Dropbox gave, as its `error_summary` (`path/not_found/..`).
fn summary(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body).ok().and_then(|v| v.get("error_summary").and_then(Value::as_str).map(str::to_owned)).unwrap_or_default()
}

/// Why a request did not work, in the person's words. `versioned`: the change named the version it replaces.
fn failed(status: u16, body: &[u8], versioned: bool) -> String {
    let s = summary(body);
    match status {
        401 => EXPIRED.into(),
        409 if s.contains("not_found") => GONE.into(),
        409 if s.contains("conflict") && versioned => CHANGED.into(),
        409 if s.contains("conflict") => EXISTS.into(),
        409 if s.contains("insufficient_space") => "The Dropbox is full.".into(),
        409 if s.contains("no_write_permission") || s.contains("disallowed_name") => "Dropbox does not let this account do that.".into(),
        409 if s.contains("malformed_path") => "Dropbox can't use that name.".into(),
        429 => "Dropbox is limiting requests right now. Try again in a minute.".into(),
        507 => "The Dropbox is full.".into(),
        s => format!("Dropbox answered {s}."),
    }
}

impl Dropbox {
    fn path(&self, path: &str) -> Res<String> {
        dropbox_path(&self.root, path)
    }

    /// A drive path from Dropbox's: under the root, without a leading slash.
    fn relative(&self, display: &str) -> String {
        let root = self.root.trim_matches('/');
        let p = display.trim_start_matches('/');
        if root.is_empty() {
            return p.to_owned();
        }
        match p.get(..root.len()) {
            Some(head) if head.eq_ignore_ascii_case(root) => p[root.len()..].trim_start_matches('/').to_owned(),
            _ => p.to_owned(),
        }
    }

    /// An RPC call (JSON in, JSON out), with the token refreshed once if Dropbox says it has run out.
    fn rpc(&self, endpoint: &str, args: &Value) -> Res<(u16, Vec<u8>)> {
        let mut stale = false;
        loop {
            let token = self.account.token(stale)?;
            let response = self.account.http.post(&format!("{}/2/{endpoint}", self.api)).header("Authorization", &format!("Bearer {token}")).header("Content-Type", "application/json").send(args.to_string().as_bytes()).map_err(|e| format!("Could not reach Dropbox: {e}"))?;
            let (status, _, body) = read_body(response, MAX_JSON)?;
            if status == 401 && !stale {
                stale = true;
                continue;
            }
            return Ok((status, body));
        }
    }

    fn entry(&self, e: &Value) -> Option<Entry> {
        let tag = e.get(".tag").and_then(Value::as_str)?;
        if tag == "deleted" {
            return None;
        }
        let text = |k: &str| e.get(k).and_then(Value::as_str).map(str::to_owned);
        Some(Entry {
            name: text("name")?,
            path: self.relative(&text("path_display").or_else(|| text("path_lower"))?),
            folder: tag == "folder",
            size: e.get("size").and_then(Value::as_u64).unwrap_or(0),
            modified: text("server_modified"),
            version: text("rev"),
            content_type: None,
            id: text("id"),
            link: None,
        })
    }

    fn upload(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        if bytes.len() as u64 > MAX_UPLOAD {
            return Err(format!("Files bigger than {} MB can't be sent to Dropbox yet.", MAX_UPLOAD / (1024 * 1024)));
        }
        let mode = match version {
            Some(rev) => json!({ ".tag": "update", "update": rev }),
            None => json!("add"),
        };
        let arg = header_json(&json!({ "path": self.path(path)?, "mode": mode, "autorename": false, "mute": true }));
        let mut stale = false;
        loop {
            let token = self.account.token(stale)?;
            let response = self
                .account
                .http
                .post(&format!("{}/2/files/upload", self.content))
                .header("Authorization", &format!("Bearer {token}"))
                .header("Content-Type", "application/octet-stream")
                .header("Dropbox-API-Arg", &arg)
                .send(bytes)
                .map_err(|e| format!("Could not reach Dropbox: {e}"))?;
            let (status, _, body) = read_body(response, MAX_JSON)?;
            match status {
                401 if !stale => stale = true,
                200 => return Ok(serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("rev").and_then(Value::as_str).map(str::to_owned))),
                s => return Err(failed(s, &body, version.is_some())),
            }
        }
    }
}

impl Drive for Dropbox {
    fn check(&self) -> Res<()> {
        match self.rpc("files/list_folder", &json!({ "path": self.path("")?, "limit": 1 }))? {
            (200, _) => Ok(()),
            (409, body) if summary(&body).contains("not_folder") => Err("That is a file, not a folder.".into()),
            (status, body) => Err(failed(status, &body, false)),
        }
    }

    fn list(&self, folder: &str) -> Res<Vec<Entry>> {
        let (mut status, mut body) = self.rpc("files/list_folder", &json!({ "path": self.path(folder)?, "include_deleted": false, "limit": 2000 }))?;
        let mut out = Vec::new();
        loop {
            if status != 200 {
                return Err(failed(status, &body, false));
            }
            let page: Value = serde_json::from_slice(&body).map_err(|_| "Dropbox's answer could not be read.".to_owned())?;
            out.extend(page.get("entries").and_then(Value::as_array).into_iter().flatten().filter_map(|e| self.entry(e)));
            match (page.get("has_more").and_then(Value::as_bool), page.get("cursor").and_then(Value::as_str)) {
                (Some(true), Some(cursor)) => (status, body) = self.rpc("files/list_folder/continue", &json!({ "cursor": cursor }))?,
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
        let arg = header_json(&json!({ "path": self.path(path)? }));
        let mut stale = false;
        loop {
            let token = self.account.token(stale)?;
            let response = self.account.http.post(&format!("{}/2/files/download", self.content)).header("Authorization", &format!("Bearer {token}")).header("Dropbox-API-Arg", &arg).send(&[][..]).map_err(|e| format!("Could not reach Dropbox: {e}"))?;
            let (status, headers, body) = read_body(response, MAX_FILE as u64)?;
            match status {
                401 if !stale => stale = true,
                200 => {
                    let rev = headers.get("dropbox-api-result").and_then(|r| serde_json::from_str::<Value>(r).ok()).and_then(|v| v.get("rev").and_then(Value::as_str).map(str::to_owned));
                    return Ok(File { bytes: body, version: rev, content_type: None });
                }
                409 if summary(&body).contains("not_file") => return Err("That is a folder.".into()),
                s => return Err(failed(s, &body, false)),
            }
        }
    }

    fn write(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        if path.trim_matches('/').is_empty() {
            return Err("A file needs a name.".into());
        }
        self.upload(path, bytes, version)
    }

    fn make_folder(&self, path: &str) -> Res<()> {
        if path.trim_matches('/').is_empty() {
            return Err("A folder needs a name.".into());
        }
        match self.rpc("files/create_folder_v2", &json!({ "path": self.path(path)?, "autorename": false }))? {
            (200, _) => Ok(()),
            (status, body) => Err(failed(status, &body, false)),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Res<()> {
        if from.trim_matches('/').is_empty() || to.trim_matches('/').is_empty() {
            return Err("The drive's top folder cannot be moved.".into());
        }
        match self.rpc("files/move_v2", &json!({ "from_path": self.path(from)?, "to_path": self.path(to)?, "autorename": false, "allow_ownership_transfer": false }))? {
            (200, _) => Ok(()),
            (status, body) => Err(failed(status, &body, false)),
        }
    }

    fn delete(&self, path: &str, version: Option<&str>) -> Res<()> {
        if path.trim_matches('/').is_empty() {
            return Err("The drive's top folder cannot be deleted.".into());
        }
        let mut args = json!({ "path": self.path(path)? });
        if let Some(rev) = version {
            args["parent_rev"] = json!(rev);
        }
        match self.rpc("files/delete_v2", &args)? {
            (200, _) => Ok(()),
            (409, body) if version.is_some() && summary(&body).contains("mismatch") => Err(CHANGED.into()),
            (status, body) => Err(failed(status, &body, version.is_some())),
        }
    }
}

/// A sign-in waiting for the person in the browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
    pub url: String,
}

pub type Done = Arc<dyn Fn(Res<Value>) + Send + Sync>;

/// What a finished sign-in gives: the tokens and who signed in.
pub struct SignedIn {
    pub tokens: Tokens,
    pub email: String,
    pub name: String,
}

/// Dropbox sign-in for Drives: one at a time.
pub struct Service {
    pub app_key: Option<String>,
    pub at: Endpoints,
    http: ureq::Agent,
    pending: Mutex<Option<(Pending, Arc<AtomicBool>)>>,
}

impl Service {
    pub fn new(app_key: Option<String>, at: Endpoints, http: ureq::Agent) -> Service {
        Service { app_key, at, http, pending: Mutex::new(None) }
    }

    pub fn status(&self) -> Value {
        json!({ "setUp": self.app_key.is_some(), "pending": lock(&self.pending).as_ref().map(|(p, _)| p.url.clone()) })
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = lock(&self.pending).as_ref() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    /// The drive for an account's tokens kept under `secret`, at `root` in its Dropbox.
    pub fn open(&self, secrets: Arc<dyn Secrets>, secret: &str, root: &str) -> Res<Dropbox> {
        let app_key = self.app_key.clone().ok_or_else(|| NOT_SET_UP.to_owned())?;
        let account = Arc::new(Account { app_key, api: self.at.api.clone(), secrets, secret: secret.to_owned(), http: self.http.clone(), refreshing: Mutex::new(()) });
        Ok(Dropbox { account, api: self.at.api.clone(), content: self.at.content.clone(), root: root.trim_matches('/').to_owned() })
    }

    /// Start a browser sign-in and return the page to open; `finish` gets the result on the sign-in's own thread.
    pub fn start(self: &Arc<Self>, finish: Arc<dyn Fn(Res<SignedIn>) + Send + Sync>) -> Res<Pending> {
        if let Some((p, _)) = lock(&self.pending).as_ref() {
            return Ok(p.clone());
        }
        let app_key = self.app_key.clone().ok_or_else(|| NOT_SET_UP.to_owned())?;
        let callback = Callback::listen_on("/dropbox", self.at.port)?;
        let redirect = format!("http://127.0.0.1:{}/dropbox", callback.port());
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&self.at.auth).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("client_id", &app_key)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair("token_access_type", "offline")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256");
        let pending = Pending { url: url.to_string() };
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.pending) = Some((pending.clone(), cancel.clone()));
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Dropbox", &state, &cancel, MAX_WAIT, |query| me.exchange(&app_key, query, &verifier, &redirect));
            *lock(&me.pending) = None;
            finish(result);
        });
        Ok(pending)
    }

    fn exchange(&self, app_key: &str, query: &HashMap<String, String>, verifier: &str, redirect: &str) -> Res<SignedIn> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("Dropbox sent no sign-in code.")?;
        let body = form(&[("grant_type", "authorization_code"), ("code", code), ("client_id", app_key), ("code_verifier", verifier), ("redirect_uri", redirect)]);
        let response = self.http.post(&format!("{}/oauth2/token", self.at.api)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Dropbox: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        let tokens: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status != 200 {
            return Err(format!("Dropbox refused the sign-in (HTTP {status})."));
        }
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Dropbox did not send a token.")?.to_owned();
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        let expires = now() + tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(4 * 3600);
        let response = self.http.post(&format!("{}/2/users/get_current_account", self.at.api)).header("Authorization", &format!("Bearer {access}")).send(&[][..]).map_err(|e| format!("Could not reach Dropbox: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        let me: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if status != 200 {
            return Err(format!("Dropbox did not say who signed in (HTTP {status})."));
        }
        let email = me.get("email").and_then(Value::as_str).unwrap_or("").chars().take(200).collect();
        let name = me.pointer("/name/display_name").and_then(Value::as_str).unwrap_or("").chars().take(100).collect();
        Ok(SignedIn { tokens: Tokens { access, refresh, expires }, email, name })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::{Read, Write};

    /// What the pretend Dropbox holds: path (lowercase, as Dropbox compares) → (shown path, bytes, rev), with `None`
    /// bytes for a folder.
    pub(crate) type Store = Arc<Mutex<BTreeMap<String, (String, Option<Vec<u8>>, u64)>>>;

    fn reply(s: &mut std::net::TcpStream, status: u16, headers: &str, body: &[u8]) {
        let _ = write!(s, "HTTP/1.1 {status} X\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n", body.len());
        let _ = s.write_all(body);
    }

    fn error(tag: &str) -> Vec<u8> {
        json!({ "error_summary": format!("{tag}/..."), "error": {} }).to_string().into_bytes()
    }

    /// A pretend Dropbox: the token endpoint (code `the-code`, refresh `refresh-1`), the current account, and enough of
    /// files/* for a drive. Tokens are `access-N`; one is refused once `expire` holds it.
    pub(crate) fn server() -> (String, Store, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let store: Store = Arc::default();
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let (st, lg) = (store.clone(), log.clone());
        std::thread::spawn(move || {
            let mut rev = 100u64;
            let mut minted = 0;
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
                let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                let header = |name: &str| head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_owned())).unwrap_or_default();
                lg.lock().unwrap().push(target.clone());
                let text = String::from_utf8_lossy(&body).to_string();
                if target == "/oauth2/token" {
                    if text.contains("grant_type=authorization_code") && text.contains("code=the-code") && text.contains("code_verifier=") && text.contains("client_id=app-key") {
                        minted += 1;
                        reply(&mut s, 200, "", json!({ "access_token": format!("access-{minted}"), "refresh_token": "refresh-1", "expires_in": 14400 }).to_string().as_bytes());
                    } else if text.contains("refresh_token=refresh-1") {
                        minted += 1;
                        reply(&mut s, 200, "", json!({ "access_token": format!("access-{minted}"), "expires_in": 14400 }).to_string().as_bytes());
                    } else {
                        reply(&mut s, 400, "", br#"{"error":"invalid_grant"}"#);
                    }
                    continue;
                }
                if !header("authorization").starts_with("Bearer access-") || header("authorization") == "Bearer access-expired" {
                    reply(&mut s, 401, "", &error("expired_access_token"));
                    continue;
                }
                let arg: Value = serde_json::from_str(&header("dropbox-api-arg")).or_else(|_| serde_json::from_slice(&body)).unwrap_or(Value::Null);
                let key = |p: &str| p.to_lowercase();
                let path = arg.get("path").and_then(Value::as_str).unwrap_or("").to_owned();
                let parent_ok = |st: &BTreeMap<String, (String, Option<Vec<u8>>, u64)>, p: &str| {
                    let parent = p.rsplit_once('/').map_or("", |(a, _)| a);
                    parent.is_empty() || st.get(&key(parent)).is_some_and(|e| e.1.is_none())
                };
                let meta = |shown: &str, bytes: &Option<Vec<u8>>, rev: u64| match bytes {
                    Some(b) => json!({ ".tag": "file", "name": shown.rsplit('/').next(), "path_display": shown, "rev": format!("{rev:x}"), "size": b.len(), "id": format!("id:{rev}"), "server_modified": "2026-11-16T10:00:00Z" }),
                    None => json!({ ".tag": "folder", "name": shown.rsplit('/').next(), "path_display": shown, "id": format!("id:{shown}") }),
                };
                let mut st = st.lock().unwrap();
                let (status, extra, out): (u16, String, Vec<u8>) = match target.as_str() {
                    "/2/users/get_current_account" => (200, String::new(), json!({ "email": "ana@example.com", "name": { "display_name": "Ana" } }).to_string().into_bytes()),
                    "/2/files/list_folder" | "/2/files/list_folder/continue" => {
                        let (folder, from) = match arg.get("cursor").and_then(Value::as_str) {
                            Some(c) => (c.split_once('|').map_or("", |(f, _)| f).to_owned(), c.split_once('|').map_or(0, |(_, n)| n.parse().unwrap_or(0))),
                            None => (path.clone(), 0usize),
                        };
                        if !folder.is_empty() && !st.get(&key(&folder)).is_some_and(|e| e.1.is_none()) {
                            (409, String::new(), error(if st.contains_key(&key(&folder)) { "path/not_folder" } else { "path/not_found" }))
                        } else {
                            let prefix = format!("{}/", key(&folder));
                            let all: Vec<Value> = st.iter().filter(|(k, _)| k.starts_with(&prefix) && !k[prefix.len()..].contains('/')).map(|(_, (shown, b, r))| meta(shown, b, *r)).collect();
                            // Pages of three, so paging is exercised.
                            let page: Vec<Value> = all.iter().skip(from).take(3).cloned().collect();
                            let more = from + 3 < all.len();
                            (200, String::new(), json!({ "entries": page, "has_more": more, "cursor": format!("{folder}|{}", from + 3) }).to_string().into_bytes())
                        }
                    }
                    "/2/files/download" => match st.get(&key(&path)) {
                        Some((shown, Some(b), r)) => (200, format!("dropbox-api-result: {}\r\n", meta(shown, &Some(Vec::new()), *r)), b.clone()),
                        Some((_, None, _)) => (409, String::new(), error("path/not_file")),
                        None => (409, String::new(), error("path/not_found")),
                    },
                    "/2/files/upload" => {
                        let current = st.get(&key(&path)).map(|e| format!("{:x}", e.2));
                        let mode = &arg["mode"];
                        let wanted = mode.get("update").and_then(Value::as_str).map(str::to_owned);
                        let ok = match (mode.as_str(), &wanted) {
                            (Some("add"), _) => current.is_none(),
                            (_, Some(w)) => current.as_deref() == Some(w.as_str()),
                            _ => true,
                        };
                        if !ok {
                            (409, String::new(), error("path/conflict/file"))
                        } else if !parent_ok(&st, &path) {
                            // Dropbox makes the folders a file goes in.
                            let mut at = String::new();
                            for part in path.trim_start_matches('/').split('/').collect::<Vec<_>>().iter().rev().skip(1).rev() {
                                at = format!("{at}/{part}");
                                st.entry(key(&at)).or_insert((at.clone(), None, 0));
                            }
                            rev += 1;
                            st.insert(key(&path), (path.clone(), Some(body.clone()), rev));
                            (200, String::new(), meta(&path, &Some(body), rev).to_string().into_bytes())
                        } else {
                            rev += 1;
                            st.insert(key(&path), (path.clone(), Some(body.clone()), rev));
                            (200, String::new(), meta(&path, &Some(body), rev).to_string().into_bytes())
                        }
                    }
                    "/2/files/create_folder_v2" => {
                        if st.contains_key(&key(&path)) {
                            (409, String::new(), error("path/conflict/folder"))
                        } else {
                            let mut at = String::new();
                            for part in path.trim_start_matches('/').split('/') {
                                at = format!("{at}/{part}");
                                st.entry(key(&at)).or_insert((at.clone(), None, 0));
                            }
                            (200, String::new(), json!({ "metadata": meta(&path, &None, 0) }).to_string().into_bytes())
                        }
                    }
                    "/2/files/move_v2" => {
                        let (from, to) = (arg["from_path"].as_str().unwrap_or("").to_owned(), arg["to_path"].as_str().unwrap_or("").to_owned());
                        if !st.contains_key(&key(&from)) {
                            (409, String::new(), error("from_lookup/not_found"))
                        } else if st.contains_key(&key(&to)) {
                            (409, String::new(), error("to/conflict/file"))
                        } else {
                            let moving: Vec<String> = st.keys().filter(|k| **k == key(&from) || k.starts_with(&format!("{}/", key(&from)))).cloned().collect();
                            for k in moving {
                                let (shown, b, r) = st.remove(&k).unwrap();
                                let new_shown = format!("{to}{}", &shown[from.len()..]);
                                st.insert(key(&new_shown), (new_shown, b, r));
                            }
                            (200, String::new(), b"{}".to_vec())
                        }
                    }
                    "/2/files/delete_v2" => match st.get(&key(&path)) {
                        None => (409, String::new(), error("path_lookup/not_found")),
                        Some(e) if arg.get("parent_rev").and_then(Value::as_str).is_some_and(|w| w != format!("{:x}", e.2)) => (409, String::new(), error("path_lookup/mismatch")),
                        Some(_) => {
                            let gone: Vec<String> = st.keys().filter(|k| **k == key(&path) || k.starts_with(&format!("{}/", key(&path)))).cloned().collect();
                            for k in gone {
                                st.remove(&k);
                            }
                            (200, String::new(), b"{}".to_vec())
                        }
                    },
                    _ => (404, String::new(), Vec::new()),
                };
                drop(st);
                reply(&mut s, status, &extra, &out);
            }
        });
        (url, store, log)
    }

    pub(crate) fn service(url: &str) -> Arc<Service> {
        let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).build().into();
        Arc::new(Service::new(Some("app-key".into()), Endpoints { auth: format!("{url}/oauth2/authorize"), api: url.to_owned(), content: url.to_owned(), port: 0 }, http))
    }

    /// Signs in as the browser would and returns the tokens.
    pub(crate) fn sign_in(service: &Arc<Service>) -> SignedIn {
        let (tx, rx) = std::sync::mpsc::channel();
        let pending = service.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        let param = |k: &str| url::Url::parse(&pending.url).unwrap().query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
        assert_eq!(param("token_access_type"), "offline");
        assert_eq!(param("code_challenge_method"), "S256");
        let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        http.get(&format!("{}?state={}&code=the-code", param("redirect_uri"), param("state"))).call().unwrap();
        rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap()
    }

    pub(crate) fn drive(url: &str, root: &str) -> (Dropbox, Arc<crate::secrets::MemorySecrets>) {
        let service = service(url);
        let signed = sign_in(&service);
        let secrets = Arc::new(crate::secrets::MemorySecrets::new(true));
        secrets.put("drive:x", &serde_json::to_string(&signed.tokens).unwrap());
        (service.open(secrets.clone(), "drive:x", root).unwrap(), secrets)
    }

    #[test]
    fn a_dropbox_is_a_drive_whose_changes_never_overwrite_one_made_there() {
        let (url, store, _log) = server();
        let (drive, secrets) = drive(&url, "");
        drive.check().unwrap();
        drive.make_folder("Plans").unwrap();
        assert_eq!(drive.make_folder("Plans").unwrap_err(), EXISTS);
        let v1 = drive.write("Plans/road map.md", b"# Road map", None).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map.md", b"again", None).unwrap_err(), EXISTS, "a new file never replaces one");
        let v2 = drive.write("Plans/road map.md", b"# Road map, v2", Some(&v1)).unwrap().unwrap();
        assert_eq!(drive.write("Plans/road map.md", b"stale", Some(&v1)).unwrap_err(), CHANGED);
        let file = drive.read("Plans/road map.md").unwrap();
        assert_eq!((file.bytes.as_slice(), file.version.as_deref()), (b"# Road map, v2".as_slice(), Some(v2.as_str())));
        assert_eq!(drive.read("Plans/none.md").unwrap_err(), GONE);
        for n in 0..5 {
            drive.write(&format!("Plans/n{n}.md"), b"x", None).unwrap();
        }
        let listed = drive.list("Plans").unwrap();
        assert_eq!(listed.len(), 6, "every page of a listing");
        assert_eq!(listed[0].path, "Plans/n0.md");
        drive.rename("Plans/n0.md", "Plans/renamed.md").unwrap();
        assert_eq!(drive.rename("Plans/n1.md", "Plans/n2.md").unwrap_err(), EXISTS);
        assert_eq!(drive.delete("Plans/n1.md", Some("ffff")).unwrap_err(), CHANGED);
        drive.delete("Plans/n1.md", None).unwrap();
        assert!(!store.lock().unwrap().contains_key("/plans/n1.md"));
        // Names past ASCII travel in the header as \u escapes.
        drive.write("Plans/café ☕.md", b"ok", None).unwrap();
        assert_eq!(drive.read("Plans/café ☕.md").unwrap().bytes, b"ok");

        // An expired token is refreshed once and the request goes again.
        let mut tokens: Tokens = serde_json::from_str(&secrets.get("drive:x").unwrap()).unwrap();
        tokens.access = "access-expired".into();
        secrets.put("drive:x", &serde_json::to_string(&tokens).unwrap());
        drive.list("").unwrap();
        assert_ne!(serde_json::from_str::<Tokens>(&secrets.get("drive:x").unwrap()).unwrap().access, "access-expired");
        // A refresh Dropbox refuses ends the sign-in, with what to do.
        tokens.refresh = "gone".into();
        secrets.put("drive:x", &serde_json::to_string(&tokens).unwrap());
        assert_eq!(drive.list("").unwrap_err(), EXPIRED);
    }

    #[test]
    fn a_folder_in_the_dropbox_is_a_drive_of_its_own() {
        let (url, _store, _log) = server();
        let (whole, _) = drive(&url, "");
        whole.make_folder("Work/Mobius").unwrap();
        let (drive, _) = drive(&url, "/Work/Mobius/");
        drive.write("a.md", b"a", None).unwrap();
        assert_eq!(drive.list("").unwrap()[0].path, "a.md");
        assert_eq!(whole.list("Work/Mobius").unwrap()[0].path, "Work/Mobius/a.md");
        assert_eq!(dropbox_path("", "").unwrap(), "");
        assert!(dropbox_path("", "../x").is_err());
    }

    #[test]
    fn two_way_sync_with_a_dropbox_loses_nothing() {
        let (url, _store, _log) = server();
        let (drive, _) = drive(&url, "");
        let (other, _) = self::drive(&url, "");
        drive.make_folder("Notes").unwrap();
        let root = tempfile::tempdir().unwrap();
        let mut side = crate::drive_sync::tests::RealServer { drive: Box::new(other), remote: "Notes".into(), settle_ms: 0 };
        crate::drive_sync::tests::soak(&drive, root.path(), "Notes", &mut side, 80);
    }

    /// Drives keep a Dropbox folder once the person allows it in the browser: the folder is made if it isn't there,
    /// the drive opens with the kept tokens, and signing in again with another Dropbox account is refused.
    #[test]
    fn drives_keep_a_dropbox_folder_once_signed_in() {
        let (url, store, _log) = server();
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(crate::secrets::MemorySecrets::new(true));
        let drives = Arc::new(crate::drives::Drives::new(dir.path(), secrets.clone()));
        let service = service(&url);
        drives.use_dropbox(Service::new(service.app_key.clone(), service.at.clone(), ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).build().into()));
        assert_eq!(drives.dropbox_status()["setUp"], true);
        let (tx, rx) = std::sync::mpsc::channel();
        let tx = Mutex::new(tx);
        let pending = drives.add_dropbox("", "Work/Plans", None, Arc::new(move |r| lock(&tx).send(r).unwrap())).unwrap();
        let page = url::Url::parse(pending["url"].as_str().unwrap()).unwrap();
        let param = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
        let http: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        http.get(&format!("{}?state={}&code=the-code", param("redirect_uri"), param("state"))).call().unwrap();
        let kept = rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
        assert_eq!((kept["kind"].as_str(), kept["name"].as_str(), kept["url"].as_str()), (Some("dropbox"), Some("Plans"), Some("dropbox:/Work/Plans")));
        assert!(lock(&store).contains_key("/work/plans"), "the folder is made");
        let id = kept["id"].as_str().unwrap();
        let drive = drives.open(id).unwrap();
        drive.write("idea.md", b"one", None).unwrap();
        assert_eq!(lock(&store).get("/work/plans/idea.md").and_then(|f| f.1.clone()).as_deref(), Some(&b"one"[..]));
        assert!(drives.sign_in(id, "a password").is_err(), "a Dropbox drive signs in through the browser");
        assert_eq!(crate::drives::Drives::new(dir.path(), secrets).list()[0]["id"], id, "the drive is kept");
    }

    #[test]
    fn without_an_app_key_dropbox_is_not_set_up() {
        let http: ureq::Agent = ureq::Agent::config_builder().build().into();
        let service = Arc::new(Service::new(None, Endpoints::default(), http));
        assert_eq!(service.status()["setUp"], false);
        assert_eq!(service.start(Arc::new(|_| {})).unwrap_err(), NOT_SET_UP);
        assert_eq!(header_json(&json!({ "path": "/é" })), r#"{"path":"/\u00e9"}"#);
    }
}
