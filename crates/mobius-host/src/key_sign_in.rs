//! Sign in to a gateway that gives out an API key through its own sign-in page, so nobody has to copy and paste a key.
//! This is OpenRouter's documented OAuth PKCE flow (https://openrouter.ai/docs/use-cases/oauth-pkce):
//! 1. Open the service's sign-in page. Send it a callback address on this computer, the hash of a secret
//!    (the code challenge), and a random `state` value.
//! 2. The service sends the browser back to that address with a one-time code.
//! 3. Send the code and the secret to the service, which returns a key. The key then goes into the secret store,
//!    the same as a pasted one.
//!
//! The callback is a `loopback::Callback`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use crate::loopback::{Callback, challenge, random_text};

pub const OPENROUTER: &str = "https://openrouter.ai";
/// OpenRouter's codes are good for ten minutes.
const MAX_WAIT: Duration = Duration::from_secs(10 * 60);
const MAX_BODY: u64 = 64 * 1024;

/// How the sign-in ended: the key, or why not ("cancelled" when the person stopped it).
pub type Done = Arc<dyn Fn(Result<String, String>) + Send + Sync>;

#[derive(Default)]
struct State {
    pending: Option<(String, Arc<AtomicBool>)>,
    error: Option<String>,
}

pub struct KeySignIn {
    site: String,
    agent: ureq::Agent,
    state: Mutex<State>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl KeySignIn {
    /// `site` is `OPENROUTER` except in tests.
    pub fn new(site: &str) -> KeySignIn {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_connect(Some(Duration::from_secs(10))).timeout_global(Some(Duration::from_secs(20))).user_agent("Mobius").build().into();
        KeySignIn { site: site.trim_end_matches('/').to_owned(), agent, state: Mutex::default() }
    }

    /// What Settings shows: the page to finish on while waiting, and why the last try failed.
    pub fn status(&self) -> Value {
        let s = lock(&self.state);
        json!({ "pending": s.pending.as_ref().map(|(url, _)| url.clone()), "error": s.error.clone() })
    }

    /// Start listening for the callback and return the sign-in page to open. The wait runs on its own thread, and
    /// `done` hears how it ended. If a sign-in is already waiting, its page is returned again.
    pub fn start(self: &Arc<Self>, done: Done) -> Result<String, String> {
        if let Some((url, _)) = &lock(&self.state).pending {
            return Ok(url.clone());
        }
        let callback = Callback::listen("/callback")?;
        let verifier = random_text(32)?;
        let state = random_text(16)?;
        let mut url = url::Url::parse(&format!("{}/auth", self.site)).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("callback_url", &format!("http://localhost:{}/callback", callback.port()))
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state)
            .append_pair("key_label", "Mobius");
        let url = url.to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = lock(&self.state);
            s.pending = Some((url.clone(), cancel.clone()));
            s.error = None;
        }
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("OpenRouter", &state, &cancel, MAX_WAIT, |query| {
                let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 2048).ok_or("OpenRouter sent no sign-in code.")?;
                me.exchange(code, &verifier)
            });
            {
                let mut s = lock(&me.state);
                s.pending = None;
                s.error = result.as_ref().err().filter(|e| e.as_str() != "cancelled").cloned();
            }
            done(result);
        });
        Ok(url)
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = &lock(&self.state).pending {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    fn exchange(&self, code: &str, verifier: &str) -> Result<String, String> {
        use std::io::Read;
        let body = json!({ "code": code, "code_verifier": verifier, "code_challenge_method": "S256" }).to_string();
        let response = self.agent.post(&format!("{}/api/v1/auth/keys", self.site)).header("Content-Type", "application/json").send(body.as_bytes()).map_err(|e| format!("Could not reach OpenRouter: {e}"))?;
        let status = response.status().as_u16();
        let mut text = Vec::new();
        Read::read_to_end(&mut Read::take(response.into_body().into_reader(), MAX_BODY), &mut text).map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_slice(&text).unwrap_or(Value::Null);
        match status {
            200 | 201 => value.get("key").and_then(Value::as_str).map(str::trim).filter(|k| crate::providers::is_key_text(k)).map(str::to_owned).ok_or_else(|| "OpenRouter did not send a key.".into()),
            403 => Err("OpenRouter refused the sign-in, or it took too long. Try again.".into()),
            other => Err(format!("OpenRouter could not make a key (HTTP {other}).")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// A pretend OpenRouter: it gives a key only for the code "good-code" with the verifier that matches the challenge.
    fn fake_site(expected_challenge: Arc<Mutex<String>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0usize;
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
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
                let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let verifier = body["code_verifier"].as_str().unwrap_or("");
                let good = first.starts_with("POST /api/v1/auth/keys ") && body["code"] == "good-code" && body["code_challenge_method"] == "S256" && challenge(verifier) == *lock(&expected_challenge);
                let (status, reply) = if good { ("200 OK", r#"{"key":"sk-or-v1-from-sign-in"}"#) } else { ("403 Forbidden", r#"{"error":"bad"}"#) };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        address
    }

    fn get(url: &str) -> (u16, String) {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let response = agent.get(url).call().unwrap();
        let status = response.status().as_u16();
        (status, response.into_body().read_to_string().unwrap())
    }

    fn param(url: &str, name: &str) -> String {
        url::Url::parse(url).unwrap().query_pairs().find(|(k, _)| k == name).unwrap().1.into_owned()
    }

    #[test]
    fn a_sign_in_comes_back_with_a_key_and_ignores_strays() {
        let expected = Arc::new(Mutex::new(String::new()));
        let site = fake_site(expected.clone());
        let sign_in = Arc::new(KeySignIn::new(&site));
        let (tx, rx) = mpsc::channel();
        let url = sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert!(url.starts_with(&format!("{site}/auth?")));
        assert_eq!(param(&url, "code_challenge_method"), "S256");
        assert_eq!(sign_in.start(Arc::new(|_| {})).unwrap(), url, "a second start shows the same page");
        *lock(&expected) = param(&url, "code_challenge");
        let callback = param(&url, "callback_url");
        assert!(callback.starts_with("http://localhost:") && callback.ends_with("/callback"));
        let local = callback.replace("localhost", "127.0.0.1");
        let state = param(&url, "state");

        // Not the sign-in: other paths and the wrong state are turned away, and it keeps waiting.
        assert_eq!(get(&local.replace("/callback", "/favicon.ico")).0, 404);
        assert_eq!(get(&format!("{local}?code=good-code&state=wrong")).0, 400);
        assert!(sign_in.status()["pending"].is_string());

        let (status, body) = get(&format!("{local}?code=good-code&state={state}"));
        assert_eq!(status, 200);
        assert!(body.contains("signed in"));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Ok("sk-or-v1-from-sign-in".to_owned()));
        assert_eq!(sign_in.status(), json!({ "pending": null, "error": null }));
    }

    #[test]
    fn a_refused_code_is_an_error_and_cancel_stops_the_wait() {
        let expected = Arc::new(Mutex::new(String::new()));
        let site = fake_site(expected);
        let sign_in = Arc::new(KeySignIn::new(&site));
        let (tx, rx) = mpsc::channel();
        let url = sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        let local = param(&url, "callback_url").replace("localhost", "127.0.0.1");
        get(&format!("{local}?code=bad-code&state={}", param(&url, "state")));
        assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err().contains("refused"));
        assert!(sign_in.status()["error"].as_str().unwrap().contains("refused"));

        let (tx, rx) = mpsc::channel();
        sign_in.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        sign_in.cancel();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), Err("cancelled".to_owned()));
        assert_eq!(sign_in.status()["error"], Value::Null);
    }
}
