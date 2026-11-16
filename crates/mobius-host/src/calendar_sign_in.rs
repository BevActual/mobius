//! Signing in to Google Calendar (docs/reference/calendar-sign-in.md). Google takes no app password for calendars, so
//! the person signs in on Google's own page and Mobius keeps the tokens it gets back:
//!
//! - The sign-in uses PKCE and comes back to a one-time page on 127.0.0.1 (`loopback`), as Google Drive's does, but
//!   asks for the calendar scope instead of `drive.file`. The two sign-ins are kept apart so that either can be
//!   removed without the other.
//! - The account's calendars are found with Google's Calendar API (its calendar list), then read and changed through
//!   Google's CalDAV endpoint with the access token, so `calendar_accounts` mirrors them with the code CalDAV
//!   accounts already use.
//! - The tokens stay in the system secret store and are only ever sent to Google. A token about to run out is
//!   refreshed; a refresh Google refuses means the person signs in again, which keeps the account and its calendars.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mobius_agent::responses::jwt_claims;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::dropbox::{form, lock, now, read_body};
use crate::loopback::{Callback, challenge, random_text};

type Res<T> = Result<T, String>;

pub const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN: &str = "https://oauth2.googleapis.com/token";
pub const API: &str = "https://www.googleapis.com";
pub const CALDAV: &str = "https://apidata.googleusercontent.com/caldav/v2";
/// Google's CalDAV endpoint takes only the whole calendar scope.
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar";
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 4 * 1024 * 1024;
/// The most calendars one account brings in.
pub const MAX_CALENDARS: usize = 30;
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

pub const NOT_SET_UP: &str = "Google Calendar isn't set up in this build of Mobius yet. Until it is, a Google calendar can be subscribed to with its secret address in iCal format, from the calendar's settings on Google.";
pub const EXPIRED: &str = "The Google sign-in has ended. Choose Sign in again. While Mobius is in Google's testing, a sign-in lasts 7 days.";

/// Mobius as registered with Google: the desktop client Google Drive uses too.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Google {
    pub client_id: String,
    /// Google calls it a secret but says a desktop app can't keep one; its token endpoint still asks for it.
    pub client_secret: String,
}

impl Google {
    /// The registration built into this copy of Mobius, if any (`MOBIUS_GOOGLE_CLIENT_ID` and
    /// `MOBIUS_GOOGLE_CLIENT_SECRET` when building).
    pub fn built_in() -> Option<Google> {
        let id = option_env!("MOBIUS_GOOGLE_CLIENT_ID").filter(|k| !k.is_empty())?;
        Some(Google { client_id: id.to_owned(), client_secret: option_env!("MOBIUS_GOOGLE_CLIENT_SECRET").unwrap_or("").to_owned() })
    }
}

/// Where requests go: Google's addresses, or a pretend Google in tests.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub token: String,
    pub api: String,
    pub caldav: String,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints { auth: AUTH.into(), token: TOKEN.into(), api: API.into(), caldav: CALDAV.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    /// When `access` runs out, in seconds since 1970.
    pub expires: u64,
    #[serde(default)]
    pub email: Option<String>,
}

impl Tokens {
    /// Good for a few minutes more.
    pub fn fresh(&self) -> bool {
        self.expires > now() + SKEW_SECONDS
    }
}

/// A calendar on the account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// Where its events are, over CalDAV.
    pub href: String,
    pub name: String,
    /// Shared with the person to read only, such as holidays.
    pub read_only: bool,
}

pub struct SignIn {
    google: Option<Google>,
    at: Endpoints,
    pending: Mutex<Option<(String, Arc<AtomicBool>)>>,
    refreshing: Mutex<()>,
    http: ureq::Agent,
}

fn read_json(response: ureq::http::Response<ureq::Body>) -> Res<(u16, Value)> {
    let (status, _, body) = read_body(response, MAX_JSON)?;
    Ok((status, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

impl SignIn {
    /// `google` is `Google::built_in()` except in tests.
    pub fn new(google: Option<Google>, at: Endpoints) -> SignIn {
        let http: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(60)))
            .user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let trim = |s: String| s.trim_end_matches('/').to_owned();
        let at = Endpoints { auth: at.auth, token: at.token, api: trim(at.api), caldav: trim(at.caldav) };
        SignIn { google, at, pending: Mutex::new(None), refreshing: Mutex::new(()), http }
    }

    fn google(&self) -> Res<&Google> {
        self.google.as_ref().ok_or_else(|| NOT_SET_UP.to_owned())
    }

    /// What Settings shows before the person starts.
    pub fn status(&self) -> Value {
        json!({ "setUp": self.google.is_some(), "pending": lock(&self.pending).as_ref().map(|(url, _)| url.clone()), "hint": self.google.is_none().then_some(NOT_SET_UP) })
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = lock(&self.pending).take() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Start a browser sign-in and return the page to open. `done` hears the tokens, or why not.
    pub fn start(self: &Arc<Self>, done: Arc<dyn Fn(Res<Tokens>) + Send + Sync>) -> Res<String> {
        let google = self.google()?.clone();
        if let Some((url, _)) = lock(&self.pending).as_ref() {
            return Ok(url.clone());
        }
        let callback = Callback::listen("/google-calendar")?;
        let redirect = format!("http://127.0.0.1:{}/google-calendar", callback.port());
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&self.at.auth).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("client_id", &google.client_id)
            .append_pair("redirect_uri", &redirect)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPES)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256");
        let url = url.to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.pending) = Some((url.clone(), cancel.clone()));
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Google", &state, &cancel, MAX_WAIT, |query| me.exchange(&google, query, &verifier, &redirect));
            let mut pending = lock(&me.pending);
            if pending.as_ref().is_some_and(|(_, c)| Arc::ptr_eq(c, &cancel)) {
                *pending = None;
            }
            drop(pending);
            if result.as_ref().err().is_none_or(|e| e != "cancelled") {
                done(result);
            }
        });
        Ok(url)
    }

    fn exchange(&self, google: &Google, query: &HashMap<String, String>, verifier: &str, redirect: &str) -> Res<Tokens> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("Google sent no sign-in code.")?;
        let body = form(&[("grant_type", "authorization_code"), ("client_id", &google.client_id), ("client_secret", &google.client_secret), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect)]);
        let response = self.http.post(&self.at.token).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Google: {e}"))?;
        let (status, tokens) = read_json(response)?;
        if status != 200 {
            return Err(if tokens.get("error").and_then(Value::as_str) == Some("invalid_grant") { "The sign-in code had expired. Try again.".into() } else { format!("Google refused the sign-in (HTTP {status}).") });
        }
        // Google lets people untick what an app asks for; without the calendars there is nothing to show.
        let granted = tokens.get("scope").and_then(Value::as_str).unwrap_or("");
        if !granted.split_whitespace().any(|s| s == CALENDAR_SCOPE) {
            return Err("Google didn't give Mobius access to your calendars. Sign in again and leave that box ticked.".into());
        }
        // The ID token comes straight from Google's token endpoint over TLS, so its claims are checked, not its signature.
        let email = tokens.get("id_token").and_then(Value::as_str).and_then(jwt_claims).filter(|c| c.get("aud").and_then(Value::as_str) == Some(google.client_id.as_str())).and_then(|c| c.get("email").and_then(Value::as_str).map(str::to_owned)).filter(|e| e.len() <= 200);
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Google did not send a token.")?.to_owned();
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        let expires = now() + tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        Ok(Tokens { access, refresh, expires, email })
    }

    /// Fresh tokens for stale ones. `EXPIRED` when Google won't refresh them: the person signs in again.
    pub fn refresh(&self, tokens: &Tokens) -> Res<Tokens> {
        let google = self.google()?;
        let _one_at_a_time = lock(&self.refreshing);
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let body = form(&[("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("client_id", &google.client_id), ("client_secret", &google.client_secret)]);
        let response = self.http.post(&self.at.token).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Google: {e}"))?;
        let (status, fresh) = read_json(response)?;
        match status {
            200 => {}
            400 | 401 if fresh.get("error").and_then(Value::as_str).is_some_and(|e| matches!(e, "invalid_grant" | "unauthorized_client")) => return Err(EXPIRED.into()),
            other => return Err(format!("Google could not refresh the sign-in (HTTP {other}). Mobius tries again later.")),
        }
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Google did not send a token.")?.to_owned();
        let refresh = fresh.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map_or_else(|| tokens.refresh.clone(), str::to_owned);
        let expires = now() + fresh.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        Ok(Tokens { access, refresh, expires, email: tokens.email.clone() })
    }

    /// Where Google's CalDAV endpoint starts, for the account's address.
    pub fn caldav(&self) -> &str {
        &self.at.caldav
    }

    /// The account's calendars, from Google's calendar list: the person's own first, as Google orders them.
    pub fn calendars(&self, access: &str) -> Res<Vec<Found>> {
        let url = format!("{}/calendar/v3/users/me/calendarList?maxResults=250&showHidden=false", self.at.api);
        let response = self.http.get(&url).header("Authorization", &format!("Bearer {access}")).call().map_err(|e| format!("Could not reach Google: {e}"))?;
        let (status, list) = read_json(response)?;
        match status {
            200 => {}
            401 => return Err(EXPIRED.into()),
            403 => return Err("Google did not let Mobius list your calendars. If Mobius is in Google's testing, your account has to be one of its test users.".into()),
            s => return Err(format!("Google answered {s} when Mobius asked for your calendars.")),
        }
        let mut found: Vec<(bool, Found)> = list
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|c| {
                let id = c.get("id").and_then(Value::as_str).filter(|i| !i.is_empty() && i.len() <= 400)?;
                let name = c.get("summaryOverride").or_else(|| c.get("summary")).and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or(id);
                let role = c.get("accessRole").and_then(Value::as_str).unwrap_or("reader");
                // freeBusyReader shows only busy times, which CalDAV can't read.
                (role != "freeBusyReader").then(|| {
                    let primary = c.get("primary").and_then(Value::as_bool).unwrap_or(false);
                    (primary, Found { href: format!("{}/{}/events/", self.at.caldav, utf8_percent_encode(id, SEGMENT)), name: name.to_owned(), read_only: !matches!(role, "owner" | "writer") })
                })
            })
            .collect();
        found.sort_by_key(|(primary, _)| !primary);
        Ok(found.into_iter().map(|(_, f)| f).take(MAX_CALENDARS).collect())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
pub(crate) mod tests {
    use super::*;
    use base64::Engine;
    use std::io::{BufRead, BufReader, Read, Write};

    /// A pretend Google: the token endpoint and the calendar list. `refused` makes every refresh fail as an ended
    /// sign-in. Answers its address.
    pub(crate) fn google(refused: Arc<AtomicBool>, refreshed: Arc<Mutex<u32>>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let (mut length, mut auth) = (0usize, String::new());
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let lower = h.to_ascii_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                    if lower.starts_with("authorization:") {
                        auth = h.trim()["authorization:".len()..].trim().to_owned();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body = String::from_utf8_lossy(&body).to_string();
                let path = line.split_whitespace().nth(1).unwrap_or("").to_owned();
                let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"aud":"client","email":"ana@example.com"}"#);
                let (status, reply) = if path == "/token" && body.contains("grant_type=authorization_code") {
                    (200, json!({ "access_token": "a1", "refresh_token": "r1", "expires_in": 3600, "scope": format!("openid email {CALENDAR_SCOPE}"), "id_token": format!("x.{claims}.y") }))
                } else if path == "/token" && refused.load(Ordering::SeqCst) {
                    (400, json!({ "error": "invalid_grant" }))
                } else if path == "/token" {
                    *refreshed.lock().unwrap() += 1;
                    (200, json!({ "access_token": "a2", "expires_in": 3600 }))
                } else if path.starts_with("/calendar/v3/users/me/calendarList") && auth.starts_with("Bearer a") {
                    (200, json!({ "items": [
                        { "id": "en.usa#holiday@group.v.calendar.google.com", "summary": "Holidays", "accessRole": "reader" },
                        { "id": "ana@example.com", "summary": "ana@example.com", "summaryOverride": "Ana", "accessRole": "owner", "primary": true },
                        { "id": "busy@example.com", "summary": "Busy", "accessRole": "freeBusyReader" },
                    ] }))
                } else {
                    (401, json!({ "error": "unauthorized" }))
                };
                let text = reply.to_string();
                let _ = write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
            }
        });
        base
    }

    pub(crate) fn endpoints(base: &str, caldav: &str) -> Endpoints {
        Endpoints { auth: format!("{base}/auth"), token: format!("{base}/token"), api: base.to_owned(), caldav: caldav.to_owned() }
    }

    pub(crate) fn app() -> Option<Google> {
        Some(Google { client_id: "client".into(), client_secret: "not-secret".into() })
    }

    /// Goes through the browser part of a sign-in: follows the page `start` gave back to Mobius's loopback address,
    /// as Google would after the person agreed.
    pub(crate) fn agree(page: &str) {
        let page = url::Url::parse(page).unwrap();
        let query: HashMap<String, String> = page.query_pairs().into_owned().collect();
        let back = format!("{}?code=c1&state={}", query["redirect_uri"], query["state"]);
        let back = url::Url::parse(&back).unwrap();
        // Microsoft's goes back to `localhost`, which is 127.0.0.1 here.
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", back.port().unwrap())).unwrap();
        write!(stream, "GET {}?{} HTTP/1.1\r\nHost: x\r\n\r\n", back.path(), back.query().unwrap()).unwrap();
        let mut answer = String::new();
        let _ = stream.read_to_string(&mut answer);
    }

    #[test]
    fn a_sign_in_gets_tokens_and_the_calendars_that_can_be_shown() {
        let base = google(Arc::default(), Arc::default());
        let sign_in = Arc::new(SignIn::new(app(), endpoints(&base, "https://dav.example/caldav/v2/")));
        let (tx, rx) = std::sync::mpsc::channel();
        let page = sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert!(page.contains("code_challenge_method=S256") && page.contains("access_type=offline"));
        assert_eq!(sign_in.start(Arc::new(|_| {})).unwrap(), page, "a second start shows the same page");
        agree(&page);
        let tokens = rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
        assert_eq!((tokens.access.as_str(), tokens.refresh.as_str(), tokens.email.as_deref()), ("a1", "r1", Some("ana@example.com")));
        assert!(tokens.fresh());
        let found = sign_in.calendars(&tokens.access).unwrap();
        assert_eq!(found.len(), 2, "a free/busy calendar can't be read");
        assert_eq!(found[0], Found { href: "https://dav.example/caldav/v2/ana%40example.com/events/".into(), name: "Ana".into(), read_only: false });
        assert_eq!(found[1].href, "https://dav.example/caldav/v2/en.usa%23holiday%40group.v.calendar.google.com/events/");
        assert!(found[1].read_only);
    }

    #[test]
    fn a_refused_refresh_means_signing_in_again() {
        let refused = Arc::new(AtomicBool::new(false));
        let base = google(refused.clone(), Arc::default());
        let sign_in = SignIn::new(app(), endpoints(&base, CALDAV));
        let stale = Tokens { access: "a1".into(), refresh: "r1".into(), expires: 0, email: Some("ana@example.com".into()) };
        assert!(!stale.fresh());
        let fresh = sign_in.refresh(&stale).unwrap();
        assert_eq!((fresh.access.as_str(), fresh.refresh.as_str()), ("a2", "r1"), "Google keeps the refresh token");
        refused.store(true, Ordering::SeqCst);
        assert_eq!(sign_in.refresh(&stale).unwrap_err(), EXPIRED);
        assert_eq!(sign_in.calendars("wrong").unwrap_err(), EXPIRED);
    }

    #[test]
    fn without_a_registration_it_says_so() {
        let sign_in = Arc::new(SignIn::new(None, Endpoints::default()));
        assert_eq!(sign_in.status()["setUp"], false);
        assert_eq!(sign_in.start(Arc::new(|_| {})).unwrap_err(), NOT_SET_UP);
    }
}
