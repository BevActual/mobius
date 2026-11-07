//! Signing in with a ChatGPT plan, the way the Codex CLI does: OpenAI's device-code sign-in, then a short-lived
//! token refreshed before it runs out. The tokens stay in the system secret store and only ever travel to OpenAI.
//!
//! Flow after Hermes Agent's `hermes_cli/auth_codex.py` (MIT). It uses the public client id of OpenAI's Codex CLI,
//! as Hermes does; OpenAI's terms for doing so from another app are the person's to accept.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mobius_agent::responses::jwt_claims;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::secrets::Secrets;

pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const ISSUER: &str = "https://auth.openai.com";
pub const SECRET: &str = "account-chatgpt";
/// Refresh a token this long before it runs out.
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_BODY: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    #[serde(default)]
    pub id_token: Option<String>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// When a token runs out, from its `exp` claim.
pub fn expires_at(token: &str) -> Option<u64> {
    jwt_claims(token)?.get("exp")?.as_u64()
}

/// The account's email, for showing who is signed in.
pub fn email_of(tokens: &Tokens) -> Option<String> {
    let from = |t: &str| jwt_claims(t).and_then(|c| c.get("email").or_else(|| c.pointer("/https:~1~1api.openai.com~1profile/email")).and_then(Value::as_str).map(str::to_owned));
    tokens.id_token.as_deref().and_then(from).or_else(|| from(&tokens.access)).filter(|e| e.len() <= 200)
}

/// A sign-in waiting for the person to enter the code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
    pub code: String,
    pub url: String,
}

#[derive(Default)]
struct State {
    pending: Option<(Pending, Arc<AtomicBool>)>,
    error: Option<String>,
}

pub type Done = Arc<dyn Fn(Result<(), String>) + Send + Sync>;

pub struct ChatGpt {
    issuer: String,
    secrets: Arc<dyn Secrets>,
    state: Mutex<State>,
    /// Refreshing is done by one caller at a time, so a rotated refresh token is never used twice.
    refreshing: Mutex<()>,
    agent: ureq::Agent,
    poll: Duration,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn read_json(response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value), String> {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), MAX_BODY), &mut body).map_err(|e| e.to_string())?;
    Ok((status, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

impl ChatGpt {
    /// `issuer` is `ISSUER` except in tests.
    pub fn new(issuer: &str, secrets: Arc<dyn Secrets>) -> ChatGpt {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_connect(Some(Duration::from_secs(10))).timeout_global(Some(Duration::from_secs(20))).user_agent("Mobius").build().into();
        ChatGpt { issuer: issuer.trim_end_matches('/').to_owned(), secrets, state: Mutex::default(), refreshing: Mutex::new(()), agent, poll: Duration::from_secs(5) }
    }

    pub fn with_poll(mut self, poll: Duration) -> ChatGpt {
        self.poll = poll;
        self
    }

    fn tokens(&self) -> Option<Tokens> {
        serde_json::from_str(&self.secrets.get(SECRET)?).ok()
    }

    fn save(&self, tokens: &Tokens) -> Result<(), String> {
        let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        if self.secrets.put(SECRET, &text) { Ok(()) } else { Err("the sign-in could not be kept: this computer has no secret store".into()) }
    }

    /// What Settings shows.
    pub fn status(&self) -> Value {
        let tokens = self.tokens();
        let s = lock(&self.state);
        json!({
            "installed": true,
            "signedIn": tokens.is_some(),
            "account": tokens.as_ref().and_then(email_of),
            "pending": s.pending.as_ref().map(|(p, _)| json!(p)),
            "hint": s.error.clone(),
        })
    }

    /// Ask OpenAI for a code, and wait for the person to enter it (on a thread). `done` hears how it ended.
    pub fn start_sign_in(self: &Arc<Self>, done: Done) -> Result<Pending, String> {
        if let Some((p, _)) = &lock(&self.state).pending {
            return Ok(p.clone());
        }
        let response = self.agent.post(&format!("{}/api/accounts/deviceauth/usercode", self.issuer)).header("Content-Type", "application/json").send(json!({ "client_id": CLIENT_ID }).to_string().as_bytes()).map_err(|e| format!("Could not reach OpenAI: {e}"))?;
        let (status, body) = read_json(response)?;
        if status == 429 {
            return Err("OpenAI is limiting sign-in attempts right now. Try again in a few minutes.".into());
        }
        let (Some(code), Some(device)) = (body.get("user_code").and_then(Value::as_str), body.get("device_auth_id").and_then(Value::as_str)) else {
            return Err(format!("OpenAI did not give a sign-in code (HTTP {status})."));
        };
        let interval = body.get("interval").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(5).clamp(1, 30);
        let pending = Pending { code: code.to_owned(), url: format!("{}/codex/device", self.issuer) };
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = lock(&self.state);
            s.pending = Some((pending.clone(), cancel.clone()));
            s.error = None;
        }
        let me = Arc::clone(self);
        let (code, device) = (code.to_owned(), device.to_owned());
        let wait = if self.poll < Duration::from_secs(1) { self.poll } else { Duration::from_secs(interval) };
        std::thread::spawn(move || {
            let result = me.wait_for_sign_in(&device, &code, wait, &cancel);
            {
                let mut s = lock(&me.state);
                s.pending = None;
                s.error = result.as_ref().err().filter(|e| e.as_str() != "cancelled").cloned();
            }
            done(result);
        });
        Ok(pending)
    }

    pub fn cancel_sign_in(&self) {
        if let Some((_, cancel)) = &lock(&self.state).pending {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    fn wait_for_sign_in(&self, device: &str, code: &str, wait: Duration, cancel: &AtomicBool) -> Result<(), String> {
        let started = Instant::now();
        let granted = loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            if started.elapsed() > MAX_WAIT {
                return Err("The sign-in timed out after 15 minutes.".into());
            }
            std::thread::sleep(wait);
            let Ok(response) = self.agent.post(&format!("{}/api/accounts/deviceauth/token", self.issuer)).header("Content-Type", "application/json").send(json!({ "device_auth_id": device, "user_code": code }).to_string().as_bytes()) else { continue };
            let (status, body) = read_json(response)?;
            match status {
                200 => break body,
                403 | 404 => {}
                other => return Err(format!("OpenAI refused the sign-in (HTTP {other}).")),
            }
        };
        let (Some(auth_code), Some(verifier)) = (granted.get("authorization_code").and_then(Value::as_str), granted.get("code_verifier").and_then(Value::as_str)) else {
            return Err("OpenAI's answer was missing the sign-in code.".into());
        };
        let form = [("grant_type", "authorization_code"), ("code", auth_code), ("redirect_uri", &format!("{}/deviceauth/callback", self.issuer)), ("client_id", CLIENT_ID), ("code_verifier", verifier)];
        let tokens = self.token_request(&form)?;
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("OpenAI did not send a token.")?.to_owned();
        self.save(&Tokens { access, refresh, id_token: tokens.get("id_token").and_then(Value::as_str).map(str::to_owned) })
    }

    fn token_request(&self, form: &[(&str, &str)]) -> Result<Value, String> {
        let body: String = form.iter().map(|(k, v)| format!("{k}={}", url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>())).collect::<Vec<_>>().join("&");
        let response = self.agent.post(&format!("{}/oauth/token", self.issuer)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach OpenAI: {e}"))?;
        let (status, value) = read_json(response)?;
        match status {
            200 => Ok(value),
            429 => Err("OpenAI is limiting requests right now. Try again later.".into()),
            400 | 401 => Err("The ChatGPT sign-in has expired. Sign in again in Settings.".into()),
            other => Err(format!("OpenAI refused the token (HTTP {other}).")),
        }
    }

    /// A token that is good for at least a few minutes, refreshed if needed. `None` when not signed in.
    pub fn access_token(&self) -> Result<Option<String>, String> {
        let _one_at_a_time = lock(&self.refreshing);
        let Some(tokens) = self.tokens() else { return Ok(None) };
        if expires_at(&tokens.access).is_some_and(|exp| exp > now() + SKEW_SECONDS) {
            return Ok(Some(tokens.access));
        }
        if tokens.refresh.is_empty() {
            return Err("The ChatGPT sign-in has expired. Sign in again in Settings.".into());
        }
        let fresh = self.token_request(&[("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("client_id", CLIENT_ID)])?;
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("OpenAI did not send a token.")?.to_owned();
        // OpenAI may hand out a new refresh token; the old one then no longer works.
        let refresh = fresh.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map_or(tokens.refresh, str::to_owned);
        let next = Tokens { access: access.clone(), refresh, id_token: fresh.get("id_token").and_then(Value::as_str).map(str::to_owned).or(tokens.id_token) };
        self.save(&next)?;
        Ok(Some(access))
    }

    /// Whether the token runs out soon (and should be refreshed and handed to the agent again).
    pub fn needs_refresh(&self) -> bool {
        self.tokens().is_some_and(|t| expires_at(&t.access).is_none_or(|exp| exp <= now() + 2 * SKEW_SECONDS))
    }

    pub fn sign_out(&self) {
        self.cancel_sign_in();
        self.secrets.delete(SECRET);
    }
}
