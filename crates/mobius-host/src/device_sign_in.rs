//! Sign in to a gateway with the OAuth device flow (RFC 8628), for services that let a desktop app sign in with only
//! its public client id: Hugging Face (https://huggingface.co/docs/hub/en/oauth). Here is how it works:
//! 1. Ask the service for a device code. It answers with a short code for the person and the page to enter it on.
//! 2. The person opens that page (the code is usually already filled in) and approves Mobius.
//! 3. Meanwhile Mobius asks the service, every few seconds, whether the code was approved. When it is, the service
//!    answers with an access token, which goes into the secret store like a pasted key.
//!
//! No secret is kept in the app, and nothing listens on this computer.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

pub const HUGGING_FACE: &str = "https://huggingface.co";
/// Mobius's public client id at Hugging Face. Empty until the app is registered: then there is no sign-in button.
pub const HUGGING_FACE_CLIENT_ID: &str = "";
pub const HUGGING_FACE_SCOPES: &str = "openid profile inference-api";
pub const GITHUB: &str = "https://github.com";
/// Mobius's public client id for its GitHub OAuth app (device flow on). Public by design: no secret goes with it.
pub const GITHUB_CLIENT_ID: &str = "Ov23li0bZT09BJ8e5zDi";
pub const GITHUB_SCOPES: &str = "read:user";
const MAX_BODY: u64 = 64 * 1024;
/// The longest the service may ask Mobius to wait, whatever it says.
const LONGEST_WAIT: Duration = Duration::from_secs(15 * 60);

/// How the sign-in ended: the token, or why not ("cancelled" when the person stopped it).
pub type Done = Arc<dyn Fn(Result<String, String>) + Send + Sync>;

/// What to show while waiting: the page to open and the code to enter there.
#[derive(Clone)]
struct Pending {
    url: String,
    code: String,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct State {
    pending: Option<Pending>,
    error: Option<String>,
}

pub struct DeviceSignIn {
    name: &'static str,
    site: String,
    client_id: String,
    scopes: &'static str,
    /// Where to ask for a code, and where to ask whether it was approved.
    paths: (&'static str, &'static str),
    agent: ureq::Agent,
    state: Mutex<State>,
    /// How often to ask; the service can only make it slower. Shorter in tests.
    poll: Duration,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn form(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish()
}

impl DeviceSignIn {
    pub fn new(name: &'static str, site: &str, client_id: &str, scopes: &'static str) -> DeviceSignIn {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_connect(Some(Duration::from_secs(10))).timeout_global(Some(Duration::from_secs(20))).build().into();
        DeviceSignIn { name, site: site.trim_end_matches('/').to_owned(), client_id: client_id.to_owned(), scopes, paths: ("/oauth/device", "/oauth/token"), agent, state: Mutex::default(), poll: Duration::from_secs(5) }
    }

    pub fn hugging_face() -> DeviceSignIn {
        DeviceSignIn::new("Hugging Face", HUGGING_FACE, HUGGING_FACE_CLIENT_ID, HUGGING_FACE_SCOPES)
    }

    /// GitHub's device flow, at `site` (github.com except in tests).
    pub fn github(site: &str, client_id: &str) -> DeviceSignIn {
        let mut d = DeviceSignIn::new("GitHub", site, client_id, GITHUB_SCOPES);
        d.paths = ("/login/device/code", "/login/oauth/access_token");
        d
    }

    /// Ask more often (for tests against a pretend service).
    pub fn polling_every(mut self, poll: Duration) -> DeviceSignIn {
        self.poll = poll;
        self
    }

    /// Whether this sign-in can be offered (Mobius has a client id for it).
    pub fn available(&self) -> bool {
        !self.client_id.is_empty()
    }

    /// What Settings shows: the page and code while waiting, and why the last try failed.
    pub fn status(&self) -> Value {
        let s = lock(&self.state);
        json!({ "pending": s.pending.as_ref().map(|p| p.url.clone()), "code": s.pending.as_ref().map(|p| p.code.clone()), "error": s.error.clone() })
    }

    fn post(&self, path: &str, body: &str) -> Result<(u16, Value), String> {
        use std::io::Read;
        let response = self.agent.post(&format!("{}{path}", self.site)).header("Content-Type", "application/x-www-form-urlencoded").header("Accept", "application/json").send(body.as_bytes()).map_err(|e| format!("Could not reach {}: {e}", self.name))?;
        let status = response.status().as_u16();
        let mut text = Vec::new();
        Read::read_to_end(&mut Read::take(response.into_body().into_reader(), MAX_BODY), &mut text).map_err(|e| e.to_string())?;
        Ok((status, serde_json::from_slice(&text).unwrap_or(Value::Null)))
    }

    /// Ask for a code and start waiting for the person to approve it. Answers with the page to open and the code. The
    /// wait runs on its own thread, and `done` hears how it ended. If a sign-in is already waiting, it is shown again.
    pub fn start(self: &Arc<Self>, done: Done) -> Result<(String, String), String> {
        if !self.available() {
            return Err(format!("Signing in to {} is not set up in this version. Add a key instead.", self.name));
        }
        if let Some(p) = &lock(&self.state).pending {
            return Ok((p.url.clone(), p.code.clone()));
        }
        let (status, answer) = self.post(self.paths.0, &form(&[("client_id", &self.client_id), ("scope", self.scopes)]))?;
        if status != 200 {
            return Err(format!("{} could not start the sign-in (HTTP {status}).", self.name));
        }
        let text = |name: &str| answer.get(name).and_then(Value::as_str).map(str::to_owned);
        let device = text("device_code").filter(|c| !c.is_empty() && c.len() <= 2048).ok_or(format!("{} did not send a sign-in code.", self.name))?;
        let code = text("user_code").filter(|c| !c.is_empty() && c.len() <= 64).ok_or(format!("{} did not send a sign-in code.", self.name))?;
        // Only ever open the service's own pages.
        let url = text("verification_uri_complete").or_else(|| text("verification_uri")).filter(|u| u.starts_with(&format!("{}/", self.site))).ok_or(format!("{} sent a sign-in page Mobius will not open.", self.name))?;
        let lasts = answer.get("expires_in").and_then(Value::as_u64).map_or(LONGEST_WAIT, |s| Duration::from_secs(s).min(LONGEST_WAIT));
        let mut every = answer.get("interval").and_then(Value::as_u64).map_or(self.poll, |s| Duration::from_secs(s).max(self.poll)).min(Duration::from_secs(60));
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = lock(&self.state);
            s.pending = Some(Pending { url: url.clone(), code: code.clone(), cancel: cancel.clone() });
            s.error = None;
        }
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let until = Instant::now() + lasts;
            let result = loop {
                let started = Instant::now();
                while started.elapsed() < every {
                    if cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50).min(every));
                }
                if cancel.load(Ordering::SeqCst) {
                    break Err("cancelled".to_owned());
                }
                if Instant::now() > until {
                    break Err(format!("The sign-in code ran out. Sign in to {} again.", me.name));
                }
                let asked = me.post(me.paths.1, &form(&[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("device_code", &device), ("client_id", &me.client_id)]));
                let (status, answer) = match asked {
                    Ok(x) => x,
                    // A dropped connection is retried at the next turn.
                    Err(_) => continue,
                };
                match (status, answer.get("error").and_then(Value::as_str)) {
                    (200, None) => {
                        break answer.get("access_token").and_then(Value::as_str).map(str::trim).filter(|t| crate::providers::is_key_text(t)).map(str::to_owned).ok_or_else(|| format!("{} did not send a token.", me.name));
                    }
                    (_, Some("authorization_pending")) => {}
                    (_, Some("slow_down")) => every = (every + Duration::from_secs(5)).min(Duration::from_secs(60)),
                    (_, Some("access_denied")) => break Err(format!("The sign-in was turned down on {}.", me.name)),
                    (_, Some("expired_token")) => break Err(format!("The sign-in code ran out. Sign in to {} again.", me.name)),
                    (status, _) => break Err(format!("{} could not finish the sign-in (HTTP {status}).", me.name)),
                }
            };
            {
                let mut s = lock(&me.state);
                s.pending = None;
                s.error = result.as_ref().err().filter(|e| e.as_str() != "cancelled").cloned();
            }
            done(result);
        });
        Ok((url, code))
    }

    pub fn cancel(&self) {
        if let Some(p) = &lock(&self.state).pending {
            p.cancel.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;

    /// A pretend service: the code is approved on the third time Mobius asks, unless `deny` is set.
    fn fake_site(deny: bool) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (log, site) = (seen.clone(), address.clone());
        let asked = Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body = String::from_utf8(body).unwrap();
                lock(&log).push(format!("{} {body}", first.split_whitespace().nth(1).unwrap_or("")));
                let (status, reply) = if first.starts_with("POST /oauth/device ") {
                    ("200 OK", format!(r#"{{"device_code":"dev-1","user_code":"ABCD-1234","verification_uri":"{site}/device","verification_uri_complete":"{site}/device?user_code=ABCD-1234","expires_in":600,"interval":0}}"#))
                } else if deny {
                    ("400 Bad Request", r#"{"error":"access_denied"}"#.to_owned())
                } else if asked.fetch_add(1, Ordering::SeqCst) < 2 {
                    ("400 Bad Request", r#"{"error":"authorization_pending"}"#.to_owned())
                } else {
                    ("200 OK", r#"{"access_token":"hf_oauth_from_sign_in","token_type":"bearer"}"#.to_owned())
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        (address, seen)
    }

    fn sign_in(site: &str) -> Arc<DeviceSignIn> {
        Arc::new(DeviceSignIn::new("Hugging Face", site, "mobius-client", HUGGING_FACE_SCOPES).polling_every(Duration::from_millis(20)))
    }

    #[test]
    fn the_code_is_shown_and_the_token_arrives_once_it_is_approved() {
        let (site, seen) = fake_site(false);
        let sign_in = sign_in(&site);
        let (tx, rx) = mpsc::channel();
        let (url, code) = sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert_eq!(url, format!("{site}/device?user_code=ABCD-1234"));
        assert_eq!(code, "ABCD-1234");
        assert_eq!(sign_in.status()["code"], "ABCD-1234");
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Ok("hf_oauth_from_sign_in".to_owned()));
        assert_eq!(sign_in.status(), json!({ "pending": null, "code": null, "error": null }));
        let seen = lock(&seen).clone();
        assert!(seen[0].starts_with("/oauth/device ") && seen[0].contains("client_id=mobius-client") && seen[0].contains("scope=openid+profile+inference-api"));
        assert!(seen.iter().skip(1).all(|s| s.starts_with("/oauth/token ") && s.contains("device_code=dev-1") && !s.contains("secret")));
    }

    #[test]
    fn a_turned_down_sign_in_is_an_error_cancel_stops_it_and_no_client_id_means_no_sign_in() {
        let (site, _) = fake_site(true);
        let sign_in = sign_in(&site);
        let (tx, rx) = mpsc::channel();
        sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err().contains("turned down"));
        assert!(sign_in.status()["error"].as_str().unwrap().contains("turned down"));

        let slow = Arc::new(DeviceSignIn::new("Hugging Face", &site, "mobius-client", HUGGING_FACE_SCOPES).polling_every(Duration::from_secs(30)));
        let (tx, rx) = mpsc::channel();
        slow.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        slow.cancel();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Err("cancelled".to_owned()));

        let none = Arc::new(DeviceSignIn::new("Hugging Face", &site, "", HUGGING_FACE_SCOPES));
        assert!(!none.available());
        assert!(none.start(Arc::new(|_| {})).is_err());
    }

    /// GitHub answers "not yet" with HTTP 200 and an error field, at its own paths.
    #[test]
    fn github_s_device_flow_waits_through_its_pending_answers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let site = format!("http://{}", listener.local_addr().unwrap());
        let page = site.clone();
        let asked = Arc::new(AtomicUsize::new(0));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = header.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let reply = if first.starts_with("POST /login/device/code ") {
                    format!(r#"{{"device_code":"g1","user_code":"WDJB-MJHT","verification_uri":"{page}/login/device","interval":0}}"#)
                } else if first.starts_with("POST /login/oauth/access_token ") && asked.fetch_add(1, Ordering::SeqCst) < 2 {
                    r#"{"error":"authorization_pending"}"#.to_owned()
                } else if first.starts_with("POST /login/oauth/access_token ") {
                    r#"{"access_token":"gho_from_github","token_type":"bearer","scope":"read:user"}"#.to_owned()
                } else {
                    r#"{"error":"not_found"}"#.to_owned()
                };
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        let sign_in = Arc::new(DeviceSignIn::github(&site, "gh-client").polling_every(Duration::from_millis(20)));
        let (tx, rx) = mpsc::channel();
        let (url, code) = sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert_eq!((url, code.as_str()), (format!("{site}/login/device"), "WDJB-MJHT"));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Ok("gho_from_github".to_owned()));
    }

    #[test]
    fn a_page_off_the_service_is_never_opened() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let site = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    line.clear();
                }
                let reply = r#"{"device_code":"d","user_code":"C","verification_uri":"https://evil.example/device"}"#;
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        assert!(sign_in(&site).start(Arc::new(|_| {})).unwrap_err().contains("will not open"));
    }
}
