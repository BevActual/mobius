//! Google Drive, for the files people pick (docs/reference/drive-sign-in.md, "Google"). Mobius asks only for
//! `drive.file`: it can reach the files the person opens with it through Google's own picker, and nothing else on
//! their Drive. So there is no folder browsing or sync here, only this:
//! - Sign in on Google's page with PKCE, coming back to a one-time page on 127.0.0.1 (`loopback`).
//! - "Open from Google Drive" serves Google's picker from that page; the picked files' ids come back to it.
//! - Each picked file is copied into the workspace and remembered as a link (its Drive id and version), so it can be
//!   saved back. A save back first checks the file's version on Drive, so a change made there is never overwritten.
//! - Google Docs, Sheets and Slides come in as Markdown, CSV and PDF copies, which are not saved back.
//!
//! The app's client ID, client secret and picker key are built in (Google says a desktop app's secret can't be kept
//! secret). Until they are, `status` says Google Drive is not set up. The tokens stay in the system secret store and
//! are only ever sent to Google.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mobius_agent::responses::jwt_claims;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::loopback::{Callback, challenge, random_text};
use crate::secrets::Secrets;

pub const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN: &str = "https://oauth2.googleapis.com/token";
pub const API: &str = "https://www.googleapis.com";
pub const REVOKE: &str = "https://oauth2.googleapis.com/revoke";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/drive.file";
const FILE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
pub const SECRET: &str = "account-google";
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 1024 * 1024;
/// The most files one pick brings in.
const MAX_PICKED: usize = 50;

const EXPIRED: &str = "The Google sign-in has ended. Sign in to Google again in Files. While Mobius is in Google's testing, a sign-in lasts 7 days.";
pub const NOT_SET_UP: &str = "Google Drive isn't set up in this build of Mobius yet.";
pub const CHANGED: &str = "That file changed on Google Drive since it was opened. Open it again to get the new version, or save yours as a new file.";

/// Mobius as registered with Google.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    pub client_id: String,
    pub client_secret: String,
    /// The picker's API key, limited to the Picker API.
    pub api_key: String,
}

impl App {
    /// The registration built into this copy of Mobius, if any (set when building, as `MOBIUS_GOOGLE_CLIENT_ID`,
    /// `MOBIUS_GOOGLE_CLIENT_SECRET` and `MOBIUS_GOOGLE_PICKER_KEY`).
    pub fn built_in() -> Option<App> {
        let (id, secret, key) = (option_env!("MOBIUS_GOOGLE_CLIENT_ID")?, option_env!("MOBIUS_GOOGLE_CLIENT_SECRET")?, option_env!("MOBIUS_GOOGLE_PICKER_KEY")?);
        (!id.is_empty() && !key.is_empty()).then(|| App { client_id: id.to_owned(), client_secret: secret.to_owned(), api_key: key.to_owned() })
    }

    /// The Cloud project's number, which the picker calls the app id. A client ID starts with it.
    pub fn project_number(&self) -> &str {
        self.client_id.split('-').next().unwrap_or("")
    }
}

/// Where requests go: Google's addresses, or a pretend Google in tests.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub api: String,
    pub revoke: String,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints { auth: AUTH.into(), token: TOKEN.into(), api: API.into(), revoke: REVOKE.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Tokens {
    access: String,
    refresh: String,
    /// When `access` runs out, in seconds since 1970.
    expires: u64,
    #[serde(default)]
    email: Option<String>,
}

/// A file picked on Google Drive and copied into the workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    /// The file's id on Drive.
    pub id: String,
    /// Its name on Drive.
    pub name: String,
    pub mime_type: String,
    /// Where the copy is, in the workspace.
    pub path: String,
    /// Drive's version of the file when it was copied in or last saved back.
    pub version: String,
    /// A copy of a Google Docs, Sheets or Slides file, which can't be saved back.
    pub exported: bool,
    pub link: Option<String>,
}

/// A file read from Drive: what it is, and its bytes.
#[derive(Debug, Clone)]
pub struct Fetched {
    pub id: String,
    /// Its name on Drive.
    pub name: String,
    /// The name for the workspace copy (with `.md`, `.csv` or `.pdf` for a Google file).
    pub file_name: String,
    pub mime_type: String,
    pub version: String,
    pub exported: bool,
    pub link: Option<String>,
    pub bytes: Vec<u8>,
}

/// A browser page waiting for the person: a sign-in or a pick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
    pub url: String,
    pub kind: &'static str,
}

#[derive(Default)]
struct State {
    pending: Option<(Pending, Arc<AtomicBool>)>,
    error: Option<String>,
}

pub type Done<T> = Arc<dyn Fn(Result<T, String>) + Send + Sync>;

pub struct GoogleDrive {
    app: Option<App>,
    at: Endpoints,
    secrets: Arc<dyn Secrets>,
    links_file: PathBuf,
    links: Mutex<()>,
    state: Mutex<State>,
    refreshing: Mutex<()>,
    agent: ureq::Agent,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>())).collect::<Vec<_>>().join("&")
}

fn read_body(response: ureq::http::Response<ureq::Body>, limit: u64) -> Result<(u16, Vec<u8>), String> {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), limit + 1), &mut body).map_err(|e| format!("The file did not arrive whole: {e}"))?;
    if body.len() as u64 > limit {
        return Err(format!("Files bigger than {} MB can't be opened from Google Drive yet.", crate::drives::MAX_FILE / (1024 * 1024)));
    }
    Ok((status, body))
}

fn read_json(response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value), String> {
    let (status, body) = read_body(response, MAX_JSON)?;
    Ok((status, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Why a Drive request did not work, in the person's words.
fn failed(status: u16, body: &Value) -> String {
    let reason = body.pointer("/error/errors/0/reason").and_then(Value::as_str).unwrap_or("");
    match status {
        401 => EXPIRED.into(),
        403 if reason.contains("RateLimit") || reason == "rateLimitExceeded" => "Google Drive is limiting requests right now. Try again in a minute.".into(),
        403 if reason == "storageQuotaExceeded" => "The Google Drive is full.".into(),
        403 => "Google Drive doesn't let this account change that file.".into(),
        404 => "That file isn't on Google Drive any more, or Mobius can no longer reach it. Open it from Google Drive again.".into(),
        429 => "Google Drive is limiting requests right now. Try again in a minute.".into(),
        s => format!("Google Drive answered {s}."),
    }
}

/// What a Google Docs, Sheets or Slides file comes in as: the type to ask for, and the name's ending.
fn export_as(mime: &str) -> Option<(&'static str, &'static str)> {
    match mime {
        "application/vnd.google-apps.document" => Some(("text/markdown", "md")),
        "application/vnd.google-apps.spreadsheet" => Some(("text/csv", "csv")),
        "application/vnd.google-apps.presentation" => Some(("application/pdf", "pdf")),
        "application/vnd.google-apps.drawing" => Some(("image/png", "png")),
        _ => None,
    }
}

/// A name safe for one file in the workspace.
fn file_name(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c }).collect();
    let clean = clean.trim().trim_matches('.').trim();
    if clean.is_empty() { "Untitled".into() } else { clean.chars().take(120).collect() }
}

/// Text that goes inside a `<script>` as a JSON string.
fn script_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026")
}

/// The page that shows Google's picker and sends the picked files' ids back to `back`.
fn picker_page(token: &str, app: &App, back: &str, state: &str) -> String {
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>Open from Google Drive</title>
<style>body{{font:15px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#222;background:#f5f5f7}}@media(prefers-color-scheme:dark){{body{{color:#eee;background:#1c1c1e}}}}</style></head>
<body><p id="m">Opening Google Drive…</p>
<script>
const c = {{ token: {token}, key: {key}, app: {app}, back: {back}, state: {state} }};
function done(q) {{ location.replace(c.back + "?state=" + encodeURIComponent(c.state) + "&" + q); }}
function start() {{
  gapi.load("picker", () => {{
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(google.picker.DocsViewMode.LIST);
    new google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(c.token).setDeveloperKey(c.key).setAppId(c.app)
      .setTitle("Open in Mobius")
      .setCallback((d) => {{
        if (d.action === google.picker.Action.PICKED) done("ids=" + encodeURIComponent(d.docs.map((x) => x.id).join(",")));
        else if (d.action === google.picker.Action.CANCEL) done("cancelled=1");
      }})
      .build().setVisible(true);
  }});
}}
function failed() {{ document.getElementById("m").textContent = "Google's picker didn't load. Check the connection and try again from Mobius."; }}
</script>
<script async src="https://apis.google.com/js/api.js" onload="start()" onerror="failed()"></script>
</body></html>"#,
        token = script_string(token),
        key = script_string(&app.api_key),
        app = script_string(app.project_number()),
        back = script_string(back),
        state = script_string(state),
    )
}

impl GoogleDrive {
    /// `links_file` keeps what was opened from Drive; `app` is `App::built_in()` except in tests.
    pub fn new(app: Option<App>, at: Endpoints, secrets: Arc<dyn Secrets>, links_file: &Path) -> GoogleDrive {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(120)))
            .user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let at = Endpoints { auth: at.auth, token: at.token, api: at.api.trim_end_matches('/').to_owned(), revoke: at.revoke };
        GoogleDrive { app, at, secrets, links_file: links_file.to_path_buf(), links: Mutex::new(()), state: Mutex::default(), refreshing: Mutex::new(()), agent }
    }

    fn app(&self) -> Result<&App, String> {
        self.app.as_ref().ok_or_else(|| NOT_SET_UP.to_owned())
    }

    fn tokens(&self) -> Option<Tokens> {
        serde_json::from_str(&self.secrets.get(SECRET)?).ok()
    }

    fn save(&self, tokens: &Tokens) -> Result<(), String> {
        let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        if self.secrets.put(SECRET, &text) { Ok(()) } else { Err("The sign-in could not be kept: this computer has no secret store.".into()) }
    }

    /// What Files shows.
    pub fn status(&self) -> Value {
        let tokens = self.tokens();
        let s = lock(&self.state);
        json!({
            "setUp": self.app.is_some(),
            "signedIn": tokens.is_some(),
            "account": tokens.and_then(|t| t.email),
            "pending": s.pending.as_ref().map(|(p, _)| json!(p)),
            "hint": s.error.clone().or_else(|| self.app.is_none().then(|| NOT_SET_UP.to_owned())),
        })
    }

    fn begin(&self, pending: &Pending) -> Result<Arc<AtomicBool>, String> {
        let mut s = lock(&self.state);
        if s.pending.is_some() {
            return Err("Finish or cancel the Google page that's already open first.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        s.pending = Some((pending.clone(), cancel.clone()));
        s.error = None;
        Ok(cancel)
    }

    fn end<T>(&self, result: &Result<T, String>) {
        let mut s = lock(&self.state);
        s.pending = None;
        s.error = result.as_ref().err().filter(|e| e.as_str() != "cancelled").cloned();
    }

    /// Start a browser sign-in and return the page to open. `done` hears how it ended.
    pub fn start_sign_in(self: &Arc<Self>, done: Done<()>) -> Result<Pending, String> {
        if let Some((p, _)) = lock(&self.state).pending.as_ref().filter(|(p, _)| p.kind == "signIn") {
            return Ok(p.clone());
        }
        let app = self.app()?.clone();
        let callback = Callback::listen("/google")?;
        let redirect = format!("http://127.0.0.1:{}/google", callback.port());
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&self.at.auth).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("client_id", &app.client_id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPES)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256");
        let pending = Pending { url: url.to_string(), kind: "signIn" };
        let cancel = self.begin(&pending)?;
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Google", &state, &cancel, MAX_WAIT, |query| me.finish_sign_in(&app, query, &verifier, &redirect));
            me.end(&result);
            done(result);
        });
        Ok(pending)
    }

    fn finish_sign_in(&self, app: &App, query: &HashMap<String, String>, verifier: &str, redirect: &str) -> Result<(), String> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("Google sent no sign-in code.")?;
        let body = form(&[("grant_type", "authorization_code"), ("client_id", &app.client_id), ("client_secret", &app.client_secret), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect)]);
        let response = self.agent.post(&self.at.token).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Google: {e}"))?;
        let (status, tokens) = read_json(response)?;
        if status != 200 {
            return Err(if tokens.get("error").and_then(Value::as_str) == Some("invalid_grant") { "The sign-in code had expired. Try again.".into() } else { format!("Google refused the sign-in (HTTP {status}).") });
        }
        // Google lets people untick what an app asks for; without file access there's nothing to open.
        let granted = tokens.get("scope").and_then(Value::as_str).unwrap_or("");
        if !granted.split_whitespace().any(|s| s == FILE_SCOPE) {
            return Err("Google didn't give Mobius access to the files you pick. Sign in again and leave that box ticked.".into());
        }
        // The ID token comes straight from Google's token endpoint over TLS, so its claims are checked, not its signature.
        let email = tokens.get("id_token").and_then(Value::as_str).and_then(jwt_claims).filter(|c| c.get("aud").and_then(Value::as_str) == Some(app.client_id.as_str())).and_then(|c| c.get("email").and_then(Value::as_str).map(str::to_owned)).filter(|e| e.len() <= 200);
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Google did not send a token.")?.to_owned();
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        let expires = now() + tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        self.save(&Tokens { access, refresh, expires, email })
    }

    /// A token good for at least a few minutes, refreshed if needed.
    fn access_token(&self) -> Result<String, String> {
        let app = self.app()?;
        let _one_at_a_time = lock(&self.refreshing);
        let tokens = self.tokens().ok_or("Sign in to Google first.")?;
        if tokens.expires > now() + SKEW_SECONDS {
            return Ok(tokens.access);
        }
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let body = form(&[("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("client_id", &app.client_id), ("client_secret", &app.client_secret)]);
        let response = self.agent.post(&self.at.token).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Google: {e}"))?;
        let (status, fresh) = read_json(response)?;
        match status {
            200 => {}
            400 | 401 if fresh.get("error").and_then(Value::as_str).is_some_and(|e| matches!(e, "invalid_grant" | "unauthorized_client")) => {
                self.secrets.delete(SECRET);
                return Err(EXPIRED.into());
            }
            other => return Err(format!("Google could not refresh the sign-in (HTTP {other}). Try again later.")),
        }
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Google did not send a token.")?.to_owned();
        let refresh = fresh.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map_or(tokens.refresh, str::to_owned);
        let expires = now() + fresh.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        self.save(&Tokens { access: access.clone(), refresh, expires, email: tokens.email })?;
        Ok(access)
    }

    /// Open Google's picker in the browser and return the page to open. `done` hears the picked files' ids (none
    /// when the person closed the picker).
    pub fn start_pick(self: &Arc<Self>, done: Done<Vec<String>>) -> Result<Pending, String> {
        if let Some((p, _)) = lock(&self.state).pending.as_ref().filter(|(p, _)| p.kind == "pick") {
            return Ok(p.clone());
        }
        let app = self.app()?.clone();
        let token = self.access_token()?;
        let mut callback = Callback::listen("/google/picked")?;
        let state = random_text(16)?;
        let page = format!("/google/pick-{}", random_text(16)?);
        callback.serve_page(page.clone(), picker_page(&token, &app, "/google/picked", &state));
        callback.finished_page("Back to Mobius", "You can close this tab. The files you picked are opening in Mobius.");
        let pending = Pending { url: format!("http://127.0.0.1:{}{page}", callback.port()), kind: "pick" };
        let cancel = self.begin(&pending)?;
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Google", &state, &cancel, MAX_WAIT, |query| {
                if query.contains_key("cancelled") {
                    return Ok(Vec::new());
                }
                let ids: Vec<String> = query.get("ids").map(|s| s.split(',').map(str::trim).filter(|i| !i.is_empty() && i.len() <= 200 && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(str::to_owned).collect()).unwrap_or_default();
                if ids.len() > MAX_PICKED { Err(format!("Pick at most {MAX_PICKED} files at a time.")) } else { Ok(ids) }
            });
            me.end(&result);
            done(result);
        });
        Ok(pending)
    }

    /// Stop waiting for the browser.
    pub fn cancel(&self) {
        if let Some((_, cancel)) = &lock(&self.state).pending {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    fn get(&self, url: &str) -> Result<ureq::http::Response<ureq::Body>, String> {
        let token = self.access_token()?;
        self.agent.get(url).header("Authorization", &format!("Bearer {token}")).call().map_err(|e| format!("Could not reach Google Drive: {e}"))
    }

    /// A file's details on Drive.
    fn about(&self, id: &str) -> Result<Value, String> {
        let (status, meta) = read_json(self.get(&format!("{}/drive/v3/files/{id}?fields=id,name,mimeType,version,trashed,webViewLink&supportsAllDrives=true", self.at.api))?)?;
        if status != 200 {
            return Err(failed(status, &meta));
        }
        if meta.get("trashed").and_then(Value::as_bool) == Some(true) {
            return Err("That file is in the Google Drive trash.".into());
        }
        Ok(meta)
    }

    /// Read a picked file: its details and bytes, as a Markdown, CSV or PDF copy for a Google file.
    pub fn fetch(&self, id: &str) -> Result<Fetched, String> {
        let meta = self.about(id)?;
        let text = |k: &str| meta.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
        let (name, mime) = (text("name"), text("mimeType"));
        let export = export_as(&mime);
        if export.is_none() && mime.starts_with("application/vnd.google-apps.") {
            return Err(format!("{name} is a kind of Google file Mobius can't open."));
        }
        let url = match export {
            Some((as_type, _)) => format!("{}/drive/v3/files/{id}/export?mimeType={}", self.at.api, url::form_urlencoded::byte_serialize(as_type.as_bytes()).collect::<String>()),
            None => format!("{}/drive/v3/files/{id}?alt=media&supportsAllDrives=true", self.at.api),
        };
        let (status, bytes) = read_body(self.get(&url)?, crate::drives::MAX_FILE as u64)?;
        if status != 200 {
            return Err(failed(status, &serde_json::from_slice(&bytes).unwrap_or(Value::Null)));
        }
        let file_name = match export {
            Some((_, ending)) => format!("{}.{ending}", file_name(&name)),
            None => file_name(&name),
        };
        Ok(Fetched { id: id.to_owned(), name, file_name, mime_type: mime, version: text("version"), exported: export.is_some(), link: meta.get("webViewLink").and_then(Value::as_str).map(str::to_owned), bytes })
    }

    /// Copy the picked files into the workspace `folder` (made when it's a missing top folder), never over anything,
    /// and remember each. Returns the links opened and, for the rest, `{ id, message }`.
    pub fn open_into(&self, workspace: &mobius_workspace::files::Workspace, folder: &str, ids: &[String]) -> (Vec<Value>, Vec<Value>) {
        let copy_in = |f: &Fetched| -> Result<String, String> {
            match workspace.add_file(folder, &f.file_name, &f.bytes) {
                Err(e) if e == "that folder is not there" && !folder.is_empty() && !folder.contains('/') => {
                    workspace.new_folder("", folder)?;
                    workspace.add_file(folder, &f.file_name, &f.bytes)
                }
                other => other,
            }
        };
        let (mut opened, mut failed) = (Vec::new(), Vec::new());
        for id in ids {
            match self.fetch(id).and_then(|f| copy_in(&f).and_then(|path| self.remember(&f, &path))) {
                Ok(link) => opened.push(json!(link)),
                Err(e) => failed.push(json!({ "id": id, "message": e })),
            }
        }
        (opened, failed)
    }

    /// What was opened from Drive.
    pub fn links(&self) -> Vec<Link> {
        std::fs::read(&self.links_file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write_links(&self, links: &[Link]) -> Result<(), String> {
        if let Some(dir) = self.links_file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let temp = self.links_file.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(links).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, &self.links_file).map_err(|e| e.to_string())
    }

    /// Remember a file copied into the workspace at `path`.
    pub fn remember(&self, fetched: &Fetched, path: &str) -> Result<Link, String> {
        let _one_at_a_time = lock(&self.links);
        let link = Link { id: fetched.id.clone(), name: fetched.name.clone(), mime_type: fetched.mime_type.clone(), path: path.to_owned(), version: fetched.version.clone(), exported: fetched.exported, link: fetched.link.clone() };
        let mut links: Vec<Link> = self.links().into_iter().filter(|l| l.path != path).collect();
        links.push(link.clone());
        self.write_links(&links)?;
        Ok(link)
    }

    /// The link for a workspace file, if it came from Drive.
    pub fn link_of(&self, path: &str) -> Option<Link> {
        self.links().into_iter().find(|l| l.path == path)
    }

    /// Forget where a workspace file came from (the files on both sides stay).
    pub fn forget(&self, path: &str) -> Result<(), String> {
        let _one_at_a_time = lock(&self.links);
        let links: Vec<Link> = self.links().into_iter().filter(|l| l.path != path).collect();
        self.write_links(&links)
    }

    /// A workspace file or folder moved: the links in it follow.
    pub fn moved(&self, from: &str, to: &str) -> Result<(), String> {
        let _one_at_a_time = lock(&self.links);
        let mut links = self.links();
        let mut changed = false;
        for l in &mut links {
            if l.path == from {
                l.path = to.to_owned();
                changed = true;
            } else if let Some(rest) = l.path.strip_prefix(&format!("{from}/")) {
                l.path = format!("{to}/{rest}");
                changed = true;
            }
        }
        if changed { self.write_links(&links) } else { Ok(()) }
    }

    /// Save the workspace copy at `path` back over its file on Drive, unless the file changed there since.
    pub fn save_back(&self, path: &str, bytes: &[u8]) -> Result<Link, String> {
        let link = self.link_of(path).ok_or("That file didn't come from Google Drive.")?;
        if link.exported {
            return Err(format!("{} is a Google file, so Mobius opened a copy of it. The copy can't be saved over it; upload it as a new file instead.", link.name));
        }
        if bytes.len() > crate::drives::MAX_FILE {
            return Err(format!("Files bigger than {} MB can't be saved to Google Drive yet.", crate::drives::MAX_FILE / (1024 * 1024)));
        }
        let now_there = self.about(&link.id)?;
        if now_there.get("version").and_then(Value::as_str).unwrap_or("") != link.version {
            return Err(CHANGED.into());
        }
        let token = self.access_token()?;
        let url = format!("{}/upload/drive/v3/files/{}?uploadType=media&fields=id,version&supportsAllDrives=true", self.at.api, link.id);
        let response = self
            .agent
            .patch(&url)
            .header("Authorization", &format!("Bearer {token}"))
            .header("Content-Type", if link.mime_type.is_empty() { "application/octet-stream" } else { link.mime_type.as_str() })
            .send(bytes)
            .map_err(|e| format!("Could not reach Google Drive: {e}"))?;
        let (status, saved) = read_json(response)?;
        if status != 200 {
            return Err(failed(status, &saved));
        }
        let version = saved.get("version").and_then(Value::as_str).unwrap_or("").to_owned();
        let _one_at_a_time = lock(&self.links);
        let mut links = self.links();
        let mut out = link;
        for l in &mut links {
            if l.path == path {
                l.version.clone_from(&version);
                out = l.clone();
            }
        }
        self.write_links(&links)?;
        Ok(out)
    }

    /// Forget the sign-in, and ask Google to end it. The links are kept, so signing in again can save back.
    pub fn sign_out(&self) {
        self.cancel();
        if let Some(tokens) = self.tokens() {
            let token = if tokens.refresh.is_empty() { tokens.access } else { tokens.refresh };
            let _ = self.agent.post(&self.at.revoke).header("Content-Type", "application/x-www-form-urlencoded").send(form(&[("token", &token)]).as_bytes());
        }
        self.secrets.delete(SECRET);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_google_file_comes_in_as_a_copy_with_an_ending() {
        assert_eq!(export_as("application/vnd.google-apps.document"), Some(("text/markdown", "md")));
        assert_eq!(export_as("application/vnd.google-apps.spreadsheet"), Some(("text/csv", "csv")));
        assert_eq!(export_as("text/plain"), None);
        assert_eq!(file_name("Q3: plan / draft?"), "Q3- plan - draft-");
        assert_eq!(file_name(" .. "), "Untitled");
    }

    #[test]
    fn the_picker_page_keeps_its_values_inside_the_script() {
        let app = App { client_id: "123456-abc.apps.googleusercontent.com".into(), client_secret: "s".into(), api_key: "key".into() };
        assert_eq!(app.project_number(), "123456");
        let page = picker_page("tok</script><script>alert(1)", &app, "/google/picked", "st");
        assert!(!page.contains("</script><script>alert"), "a value can't end the script");
        assert!(page.contains(r#"app: "123456""#));
    }
}
