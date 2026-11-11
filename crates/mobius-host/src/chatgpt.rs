//! Using a ChatGPT plan through OpenAI's "Sign in with ChatGPT" for open-source apps
//! (https://developers.openai.com/siwc/token-sharing-open-source). Here is how it works:
//! - The first sign-in registers Mobius as a client for this person (`dynamic_agent_client`). OpenAI then gives a
//!   `client_id`, which is kept and reused, along with a stable, anonymous id for this computer (`ext_agent_host_id`).
//! - Sign-in happens in the browser with PKCE, and returns to a one-time page on 127.0.0.1 (`loopback`).
//! - Tokens are good for an hour and are refreshed before they run out. The refresh token rotates.
//! - Requests go to the public Responses API at api.openai.com, with `store: false` and `stream: true`.
//!
//! The tokens stay in the system secret store and are only ever sent to OpenAI.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mobius_agent::responses::jwt_claims;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::loopback::{Callback, challenge, random_text, uuid};
use crate::secrets::Secrets;

pub const ISSUER: &str = "https://auth.openai.com";
/// The API the plan is used through, and the `resource` the tokens are for.
pub const API: &str = "https://api.openai.com/v1";
/// Asked for on the first sign-in only. It registers Mobius and is never used for tokens.
const REGISTER: &str = "dynamic_agent_client";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The scope that lets requests use the ChatGPT plan.
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const SECRET: &str = "account-chatgpt";
/// The client OpenAI registered and this computer's id. Kept when signing out, so signing in again reuses them.
pub const REGISTRATION: &str = "account-chatgpt-registration";
/// Where usage limits are seen and changed.
pub const MANAGE_USAGE: &str = "https://chatgpt.com/#settings/Usage";
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
    /// The client these tokens were issued to. Tokens from the old sign-in have none and are not used.
    #[serde(default)]
    pub client_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registration {
    #[serde(default)]
    pub client_id: Option<String>,
    pub host_id: String,
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

/// A sign-in waiting for the person to finish it in the browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pending {
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
    api: String,
    secrets: Arc<dyn Secrets>,
    state: Mutex<State>,
    /// Refreshing is done by one caller at a time, so a rotated refresh token is never used twice.
    refreshing: Mutex<()>,
    agent: ureq::Agent,
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

/// Refresh errors that mean the sign-in is over; anything else (the network, OpenAI being down) keeps it.
fn sign_in_is_over(body: &Value) -> bool {
    let code = body.get("error").and_then(|e| e.as_str().or_else(|| e.get("code").and_then(Value::as_str))).unwrap_or("");
    matches!(code, "invalid_grant" | "invalid_refresh_token" | "token_expired" | "refresh_token_expired" | "refresh_token_invalidated" | "refresh_token_reused")
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>())).collect::<Vec<_>>().join("&")
}

const EXPIRED: &str = "The ChatGPT sign-in has expired. Sign in again in Settings.";

impl ChatGpt {
    /// `issuer` and `api` are `ISSUER` and `API` except in tests.
    pub fn new(issuer: &str, api: &str, secrets: Arc<dyn Secrets>) -> ChatGpt {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_connect(Some(Duration::from_secs(10))).timeout_global(Some(Duration::from_secs(20))).user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION"))).build().into();
        ChatGpt { issuer: issuer.trim_end_matches('/').to_owned(), api: api.trim_end_matches('/').to_owned(), secrets, state: Mutex::default(), refreshing: Mutex::new(()), agent }
    }

    /// Tokens from this sign-in. Tokens kept by the old sign-in, which borrowed another app's client, are not used.
    fn tokens(&self) -> Option<Tokens> {
        serde_json::from_str::<Tokens>(&self.secrets.get(SECRET)?).ok().filter(|t| !t.client_id.is_empty())
    }

    fn save(&self, tokens: &Tokens) -> Result<(), String> {
        let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        if self.secrets.put(SECRET, &text) { Ok(()) } else { Err("the sign-in could not be kept: this computer has no secret store".into()) }
    }

    pub fn registration(&self) -> Option<Registration> {
        serde_json::from_str(&self.secrets.get(REGISTRATION)?).ok()
    }

    fn save_registration(&self, registration: &Registration) {
        if let Ok(text) = serde_json::to_string(registration) {
            self.secrets.put(REGISTRATION, &text);
        }
    }

    /// This computer's id, made once. It says nothing about the person.
    fn host_id(&self) -> Result<String, String> {
        if let Some(r) = self.registration() {
            return Ok(r.host_id);
        }
        let registration = Registration { client_id: None, host_id: format!("urn:uuid:{}", uuid()?) };
        self.save_registration(&registration);
        Ok(registration.host_id)
    }

    /// What Settings shows.
    pub fn status(&self) -> Value {
        let tokens = self.tokens();
        let old = tokens.is_none() && self.secrets.get(SECRET).is_some();
        let s = lock(&self.state);
        json!({
            "installed": true,
            "signedIn": tokens.is_some(),
            "account": tokens.as_ref().and_then(email_of),
            "pending": s.pending.as_ref().map(|(p, _)| json!(p)),
            "hint": s.error.clone().or_else(|| old.then(|| "Mobius now uses OpenAI's official Sign in with ChatGPT. Sign in again to keep using your plan.".to_owned())),
            "manageUsage": MANAGE_USAGE,
        })
    }

    /// Start a browser sign-in and return the page to open. The wait for the browser to come back runs on its own
    /// thread; `done` hears how it ended. A second start while one is waiting gives the same page.
    pub fn start_sign_in(self: &Arc<Self>, done: Done) -> Result<Pending, String> {
        if let Some((p, _)) = &lock(&self.state).pending {
            return Ok(p.clone());
        }
        let host_id = self.host_id()?;
        let client_id = self.registration().and_then(|r| r.client_id);
        let callback = Callback::listen("/auth/callback")?;
        let redirect = format!("http://127.0.0.1:{}/auth/callback", callback.port());
        let (verifier, state, nonce) = (random_text(32)?, random_text(16)?, random_text(16)?);
        let mut url = url::Url::parse(&format!("{}/api/accounts/authorize", self.issuer)).map_err(|e| e.to_string())?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("client_id", client_id.as_deref().unwrap_or(REGISTER));
            if client_id.is_none() {
                q.append_pair("agent_name_hint", "Mobius");
            }
            q.append_pair("ext_agent_host_id", &host_id)
                .append_pair("response_type", "code")
                .append_pair("redirect_uri", &redirect)
                .append_pair("scope", SCOPES)
                .append_pair("resource", API)
                .append_pair("state", &state)
                .append_pair("nonce", &nonce)
                .append_pair("code_challenge", &challenge(&verifier))
                .append_pair("code_challenge_method", "S256");
        }
        let pending = Pending { url: url.to_string() };
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut s = lock(&self.state);
            s.pending = Some((pending.clone(), cancel.clone()));
            s.error = None;
        }
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("ChatGPT", &state, &cancel, MAX_WAIT, |query| me.finish_sign_in(query, client_id.as_deref(), &host_id, &verifier, &redirect, &nonce));
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

    fn finish_sign_in(&self, query: &HashMap<String, String>, known: Option<&str>, host_id: &str, verifier: &str, redirect: &str, nonce: &str) -> Result<(), String> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("ChatGPT sent no sign-in code.")?;
        let given = query.get("client_id").map(String::as_str).filter(|c| !c.is_empty());
        let client_id = match (known, given) {
            (Some(k), Some(g)) if k != g => return Err("ChatGPT answered for a different app. Try again.".into()),
            (Some(k), _) => k.to_owned(),
            (None, Some(g)) if g != REGISTER && g.len() <= 200 => g.to_owned(),
            _ => return Err("ChatGPT did not register Mobius. Try again.".into()),
        };
        let body = form(&[("grant_type", "authorization_code"), ("client_id", &client_id), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect), ("resource", API)]);
        let response = self.agent.post(&format!("{}/api/accounts/oauth/token", self.issuer)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach OpenAI: {e}"))?;
        let (status, tokens) = read_json(response)?;
        if status != 200 {
            return Err(if sign_in_is_over(&tokens) { "The sign-in code had expired. Try again.".into() } else { format!("OpenAI refused the sign-in (HTTP {status}).") });
        }
        // The ID token comes straight from OpenAI's token endpoint over TLS, so its claims are checked, not its signature.
        let id_token = tokens.get("id_token").and_then(Value::as_str).ok_or("OpenAI did not say who signed in.")?;
        let claims = jwt_claims(id_token).ok_or("OpenAI's sign-in could not be read.")?;
        let audience_ok = match claims.get("aud") {
            Some(Value::String(a)) => a == &client_id,
            Some(Value::Array(list)) => list.iter().any(|a| a.as_str() == Some(client_id.as_str())),
            _ => false,
        };
        let fresh = claims.get("exp").and_then(Value::as_u64).is_some_and(|exp| exp > now());
        if claims.get("iss").and_then(Value::as_str) != Some(self.issuer.as_str()) || !audience_ok || !fresh || claims.get("nonce").and_then(Value::as_str) != Some(nonce) {
            return Err("OpenAI's sign-in did not match the one Mobius started. Try again.".into());
        }
        let granted = tokens.get("scope").and_then(Value::as_str).unwrap_or("");
        if !granted.split_whitespace().any(|s| s == PLAN_SCOPE) {
            return Err("ChatGPT did not allow Mobius to use your plan. Sign in again and allow it, or use an OpenAI API key.".into());
        }
        let access = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("OpenAI did not send a token.")?.to_owned();
        let refresh = tokens.get("refresh_token").and_then(Value::as_str).unwrap_or("").to_owned();
        self.save_registration(&Registration { client_id: Some(client_id.clone()), host_id: host_id.to_owned() });
        self.save(&Tokens { access, refresh, id_token: Some(id_token.to_owned()), client_id })
    }

    /// A token that is good for at least a few minutes, refreshed if needed. `None` when not signed in.
    pub fn access_token(&self) -> Result<Option<String>, String> {
        let _one_at_a_time = lock(&self.refreshing);
        let Some(tokens) = self.tokens() else { return Ok(None) };
        if expires_at(&tokens.access).is_some_and(|exp| exp > now() + SKEW_SECONDS) {
            return Ok(Some(tokens.access));
        }
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let body = form(&[("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh), ("client_id", &tokens.client_id), ("resource", API)]);
        let response = self.agent.post(&format!("{}/api/accounts/oauth/token", self.issuer)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach OpenAI: {e}"))?;
        let (status, fresh) = read_json(response)?;
        match status {
            200 => {}
            429 => return Err("OpenAI is limiting requests right now. Try again later.".into()),
            _ if sign_in_is_over(&fresh) => {
                self.secrets.delete(SECRET);
                return Err(EXPIRED.into());
            }
            other => return Err(format!("OpenAI could not refresh the sign-in (HTTP {other}). Try again later.")),
        }
        let access = fresh.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("OpenAI did not send a token.")?.to_owned();
        // The refresh token rotates: the old one no longer works once a new one is given.
        let refresh = fresh.get("refresh_token").and_then(Value::as_str).filter(|s| !s.is_empty()).map_or(tokens.refresh, str::to_owned);
        let next = Tokens { access: access.clone(), refresh, id_token: fresh.get("id_token").and_then(Value::as_str).map(str::to_owned).or(tokens.id_token), client_id: tokens.client_id };
        self.save(&next)?;
        Ok(Some(access))
    }

    /// Whether the token runs out soon (and should be refreshed and handed to the agent again).
    pub fn needs_refresh(&self) -> bool {
        self.tokens().is_some_and(|t| expires_at(&t.access).is_none_or(|exp| exp <= now() + 2 * SKEW_SECONDS))
    }

    /// The models this account can use, as OpenAI lists them for it.
    pub fn models(&self) -> Result<Vec<String>, String> {
        let token = self.access_token()?.ok_or("Sign in to ChatGPT first.")?;
        let response = self.agent.get(&format!("{}/models", self.api)).header("Authorization", &format!("Bearer {token}")).call().map_err(|e| format!("Could not reach OpenAI: {e}"))?;
        let (status, body) = read_json(response)?;
        if status != 200 {
            return Err(format!("OpenAI did not list the models (HTTP {status})."));
        }
        let list = body.get("models").or_else(|| body.get("data")).and_then(Value::as_array).cloned().unwrap_or_default();
        let models: Vec<String> = list
            .iter()
            .filter(|m| m.get("visibility").and_then(Value::as_str).is_none_or(|v| v == "list"))
            .filter_map(|m| m.get("slug").or_else(|| m.get("id")).and_then(Value::as_str).map(str::to_owned))
            .collect();
        if models.is_empty() { Err("OpenAI listed no models for this account.".into()) } else { Ok(models) }
    }

    /// Forget the sign-in, and tell OpenAI to stop the refresh token when it can be reached. The registration is
    /// kept, so signing in again is the same app.
    pub fn sign_out(&self) {
        self.cancel_sign_in();
        if let Some(tokens) = self.tokens().filter(|t| !t.refresh.is_empty()) {
            let revoke = self
                .agent
                .get(&format!("{}/.well-known/openid-configuration", self.issuer))
                .call()
                .ok()
                .and_then(|r| read_json(r).ok())
                .and_then(|(_, v)| v.get("revocation_endpoint").and_then(Value::as_str).map(str::to_owned))
                .filter(|u| u.starts_with(&self.issuer) || u.starts_with("https://"));
            if let Some(endpoint) = revoke {
                let _ = self.agent.post(&endpoint).header("Content-Type", "application/x-www-form-urlencoded").send(form(&[("token", &tokens.refresh), ("token_type_hint", "refresh_token"), ("client_id", &tokens.client_id)]).as_bytes());
            }
        }
        self.secrets.delete(SECRET);
    }
}
