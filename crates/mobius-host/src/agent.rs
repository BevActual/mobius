//! The agent as the interface sees it: model settings and keys, the conversation, and what is shown from the core.
//! Everything the window asks is checked here; the window never sees raw core rows or the API key.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use base64::Engine as _;
use serde_json::{Map, Value, json};

use crate::context::{self, MAX_TYPED_CHARS};
use crate::process::{CallError, CoreProcess};
use crate::secrets::Secrets;

pub const DEFAULT_MAX_STEPS: u64 = 25;
const CORE_UNREACHABLE: &str = "Mobius cannot reach its core right now.";
pub const MAX_RECORDING_BYTES: usize = 12 * 1024 * 1024;
const MODEL_KEY: &str = "model-key";
const FALLBACK_KEY: &str = "fallback-key";
const CALL: Duration = Duration::from_secs(10);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn is_model_name(v: &str) -> bool {
    !v.is_empty() && v.chars().count() <= 200 && !v.chars().any(char::is_control)
}

pub fn is_conversation_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug, Clone, PartialEq)]
struct Backup {
    base_url: String,
    model: String,
    key: Option<String>,
    persisted: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct Saved {
    base_url: String,
    model: String,
    system: String,
    key: Option<String>,
    persisted: bool,
    max_steps: u64,
    fallback: Option<Backup>,
}

impl Default for Saved {
    fn default() -> Saved {
        Saved { base_url: String::new(), model: String::new(), system: String::new(), key: None, persisted: false, max_steps: DEFAULT_MAX_STEPS, fallback: None }
    }
}

/// A configure request from the window, checked.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Configure {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub system: Option<String>,
    pub clear_key: bool,
    pub max_steps: Option<u64>,
    pub fallback: Option<FallbackRequest>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct FallbackRequest {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub clear_key: bool,
}

fn text_field(v: &Value, name: &str) -> Result<Option<String>, ()> {
    match v.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(()),
    }
}

fn url_and_model(v: &Value) -> Option<(String, String)> {
    let (url, model) = (v.get("baseUrl")?.as_str()?.trim(), v.get("model")?.as_str()?.trim());
    (!url.is_empty() && url.len() <= 2048 && !model.is_empty() && model.chars().count() <= 200).then(|| (url.to_owned(), model.to_owned()))
}

fn flag(v: &Value, name: &str) -> Result<bool, ()> {
    match v.get(name) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(()),
    }
}

fn parse_fallback(v: &Value) -> Option<FallbackRequest> {
    if !v.is_object() {
        return None;
    }
    let (base_url, model) = url_and_model(v)?;
    let api_key = text_field(v, "apiKey").ok()?;
    if api_key.as_ref().is_some_and(|k| k.chars().count() > 4096) {
        return None;
    }
    Some(FallbackRequest { base_url, model, api_key, clear_key: flag(v, "clearKey").ok()? })
}

pub fn parse_configure(v: &Value) -> Option<Configure> {
    if !v.is_object() {
        return None;
    }
    let (base_url, model) = url_and_model(v)?;
    let api_key = text_field(v, "apiKey").ok()?;
    let system = text_field(v, "system").ok()?;
    if api_key.as_ref().is_some_and(|k| k.chars().count() > 4096) || system.as_ref().is_some_and(|s| s.chars().count() > 8000) {
        return None;
    }
    let fallback = match v.get("fallback") {
        None | Some(Value::Null) => None,
        Some(f) => Some(parse_fallback(f)?),
    };
    let max_steps = match v.get("maxSteps") {
        None | Some(Value::Null) => None,
        Some(n) => Some(n.as_u64().filter(|n| (1..=100).contains(n))?),
    };
    Some(Configure { base_url, model, api_key, system, clear_key: flag(v, "clearKey").ok()?, max_steps, fallback })
}

/// A message to send, checked.
pub struct SendRequest {
    pub conversation: String,
    pub text: String,
    pub context: Vec<context::Item>,
    /// Plan first: the agent only proposes a plan this turn.
    pub plan: bool,
}

pub fn parse_send(v: &Value) -> Option<SendRequest> {
    let conversation = v.get("conversation")?.as_str().filter(|c| is_conversation_id(c))?;
    let text = v.get("text")?.as_str().filter(|t| !t.trim().is_empty() && t.chars().count() <= MAX_TYPED_CHARS)?;
    let context = match v.get("context") {
        None => Vec::new(),
        Some(c) => context::parse_list(c)?,
    };
    let plan = match v.get("plan") {
        None | Some(Value::Null) => false,
        Some(p) => p.as_bool()?,
    };
    Some(SendRequest { conversation: conversation.to_owned(), text: text.to_owned(), context, plan })
}

const AUDIO_TYPES: [&str; 5] = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"];

/// A recording from the window: its type must be a known audio type and its size within bounds.
pub fn parse_recording(base64_audio: &Value, mime: &Value) -> Option<(Vec<u8>, &'static str)> {
    let base = mime.as_str()?.split(';').next()?.trim().to_lowercase();
    let kind = AUDIO_TYPES.iter().find(|t| **t == base)?;
    let text = base64_audio.as_str().filter(|t| t.len() <= MAX_RECORDING_BYTES * 4 / 3 + 8)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(text).ok()?;
    (!bytes.is_empty() && bytes.len() <= MAX_RECORDING_BYTES).then_some((bytes, *kind))
}

/// Gives a sign-in's current token (refreshing it if needed); `None` when not signed in.
pub type TokenSource = Arc<dyn Fn() -> Result<Option<String>, String> + Send + Sync>;

pub struct AgentService {
    /// Addresses whose key is a short-lived sign-in token, asked for each time the core is set up and never saved.
    token_sources: Mutex<Vec<(String, TokenSource)>>,
    /// When the token handed to the core runs out (seconds since 1970), if it is one.
    token_expires: Mutex<Option<u64>>,
    core: Arc<CoreProcess>,
    settings_path: PathBuf,
    secrets: Arc<dyn Secrets>,
    saved: Mutex<Saved>,
    configured: AtomicBool,
}

fn ok() -> Value {
    json!({ "ok": true })
}
fn failed(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

impl AgentService {
    pub fn new(core: Arc<CoreProcess>, settings_path: PathBuf, secrets: Arc<dyn Secrets>) -> AgentService {
        let service = AgentService { token_sources: Mutex::default(), token_expires: Mutex::default(), core, settings_path, secrets, saved: Mutex::default(), configured: AtomicBool::new(false) };
        service.load();
        service
    }

    /// The server in use now: address, model, and the key if there is one. For saving it under a name; never sent to the window.
    pub fn current_server(&self) -> (String, String, Option<String>) {
        let s = lock(&self.saved);
        (s.base_url.clone(), s.model.clone(), s.key.clone())
    }

    /// Points the agent at another server, keeping the instructions, step limit and backup as they were.
    pub fn switch_server(&self, base_url: &str, model: &str, key: Option<String>) -> Value {
        let old = lock(&self.saved).clone();
        let next = Saved { base_url: base_url.to_owned(), model: model.to_owned(), key, persisted: false, ..old };
        let params = match self.params(&next) {
            Ok(p) => p,
            Err(e) => return failed(e),
        };
        if let Err(e) = self.call("agent.configure", params) {
            return failed(Self::describe(&e));
        }
        *lock(&self.saved) = next;
        self.configured.store(true, Ordering::SeqCst);
        self.save();
        ok()
    }

    /// Takes the saved keys out of the secret store. Used when the person removes all their data.
    pub fn forget_keys(&self) {
        self.secrets.delete(MODEL_KEY);
        self.secrets.delete(FALLBACK_KEY);
    }

    pub fn settings(&self) -> Value {
        let s = lock(&self.saved);
        json!({
            "baseUrl": s.base_url, "model": s.model, "system": s.system,
            "configured": self.configured.load(Ordering::SeqCst), "hasKey": s.key.is_some(), "maxSteps": s.max_steps,
            "keyStorage": if s.key.is_none() { "none" } else if s.persisted { "keychain" } else { "session" },
            "fallbackBaseUrl": s.fallback.as_ref().map_or("", |f| f.base_url.as_str()),
            "fallbackModel": s.fallback.as_ref().map_or("", |f| f.model.as_str()),
            "hasFallbackKey": s.fallback.as_ref().is_some_and(|f| f.key.is_some()),
        })
    }

    pub fn mark_stopped(&self) {
        self.configured.store(false, Ordering::SeqCst);
    }

    fn describe(error: &CallError) -> String {
        match error {
            CallError::Rpc(e) => e.message.clone(),
            _ => CORE_UNREACHABLE.to_owned(),
        }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        self.core.call(method, params, CALL)
    }

    /// Set the core up from what was saved. Called each time the core becomes ready, since it forgets on restart.
    pub fn apply(&self) {
        let s = lock(&self.saved).clone();
        if s.base_url.is_empty() || s.model.is_empty() {
            return;
        }
        let ok = self.params(&s).is_ok_and(|p| self.call("agent.configure", p).is_ok());
        self.configured.store(ok, Ordering::SeqCst);
    }

    pub fn configure(&self, request: &Configure) -> Value {
        self.apply_request(request, true)
    }

    /// For tests: configure without saving anything.
    pub fn seed(&self, request: &Configure) -> Value {
        self.apply_request(request, false)
    }

    fn apply_request(&self, r: &Configure, persist: bool) -> Value {
        let old = lock(&self.saved).clone();
        // A saved key only ever goes back to the address it was saved for.
        let key = if r.clear_key { None } else { r.api_key.clone().or_else(|| (r.base_url == old.base_url).then(|| old.key.clone()).flatten()) };
        let fallback = r.fallback.as_ref().map(|f| Backup {
            base_url: f.base_url.clone(),
            model: f.model.clone(),
            key: if f.clear_key { None } else { f.api_key.clone().or_else(|| old.fallback.as_ref().filter(|o| o.base_url == f.base_url).and_then(|o| o.key.clone())) },
            persisted: false,
        });
        let next = Saved { base_url: r.base_url.clone(), model: r.model.clone(), system: r.system.clone().unwrap_or_default(), key, persisted: false, max_steps: r.max_steps.unwrap_or(old.max_steps), fallback };
        let params = match self.params(&next) {
            Ok(p) => p,
            Err(e) => return failed(e),
        };
        if let Err(e) = self.call("agent.configure", params) {
            return failed(Self::describe(&e));
        }
        *lock(&self.saved) = next;
        self.configured.store(true, Ordering::SeqCst);
        if persist {
            self.save();
        }
        ok()
    }

    pub fn set_model(&self, model: &str) -> Value {
        let s = lock(&self.saved).clone();
        if s.base_url.is_empty() || !is_model_name(model) {
            return failed("That model cannot be used.");
        }
        let fallback = s.fallback.as_ref().map(|f| FallbackRequest { base_url: f.base_url.clone(), model: f.model.clone(), api_key: None, clear_key: false });
        self.apply_request(&Configure { base_url: s.base_url, model: model.to_owned(), system: Some(s.system), max_steps: Some(s.max_steps), fallback, ..Configure::default() }, true)
    }

    /// Point the agent at another server and model, keeping its instructions, step limit and second model.
    /// `key` replaces the saved key; `None` means the server needs none.
    pub fn use_endpoint(&self, base_url: &str, model: &str, key: Option<String>) -> Value {
        if !is_model_name(model) {
            return failed("That model cannot be used.");
        }
        let s = lock(&self.saved).clone();
        let fallback = s.fallback.as_ref().map(|f| FallbackRequest { base_url: f.base_url.clone(), model: f.model.clone(), api_key: None, clear_key: false });
        let clear_key = key.is_none();
        self.apply_request(&Configure { base_url: base_url.to_owned(), model: model.to_owned(), api_key: key, clear_key, system: Some(s.system), max_steps: Some(s.max_steps), fallback }, true)
    }

    /// Stop sending the saved key, if the agent is using this address. Used when a provider's key is removed.
    pub fn drop_key_for(&self, base_url: &str) {
        let s = lock(&self.saved).clone();
        if s.key.is_none() || !s.base_url.trim_end_matches('/').eq_ignore_ascii_case(base_url.trim_end_matches('/')) {
            return;
        }
        let fallback = s.fallback.as_ref().map(|f| FallbackRequest { base_url: f.base_url.clone(), model: f.model.clone(), api_key: None, clear_key: false });
        self.apply_request(&Configure { base_url: s.base_url, model: s.model, api_key: None, clear_key: true, system: Some(s.system), max_steps: Some(s.max_steps), fallback }, true);
    }

    /// The key for `address` comes from this sign-in instead of the saved key.
    pub fn add_token_source(&self, address: &str, source: TokenSource) {
        lock(&self.token_sources).push((address.to_owned(), source));
    }

    fn params(&self, s: &Saved) -> Result<Value, String> {
        let mut p = core_params(s);
        let source = lock(&self.token_sources).iter().find(|(a, _)| a.eq_ignore_ascii_case(s.base_url.trim())).map(|(_, f)| f.clone());
        if let Some(source) = source {
            let token = source()?.ok_or("Sign in first, in Settings > Providers.")?;
            *lock(&self.token_expires) = mobius_agent::responses::jwt_claims(&token).and_then(|c| c.get("exp").and_then(Value::as_u64));
            p["api_key"] = json!(token);
        } else {
            *lock(&self.token_expires) = None;
        }
        Ok(p)
    }

    /// Hand the core a fresh sign-in token when the one it has runs out within ten minutes.
    fn refresh_token_if_needed(&self) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        if lock(&self.token_expires).is_some_and(|exp| exp <= now + 600) {
            self.apply();
        }
    }

    /// The address the agent uses now.
    pub fn base_url(&self) -> String {
        lock(&self.saved).base_url.clone()
    }

    /// `bot` is the instructions and model of the bot the conversation belongs to, if it has one.
    pub fn send(&self, request: &SendRequest, bot: Option<(&str, &str)>) -> Value {
        self.send_remembering(request, bot, "")
    }

    /// As `send`, with what Mobius remembers about the person added to the instructions (nothing when empty).
    pub fn send_remembering(&self, request: &SendRequest, bot: Option<(&str, &str)>, remembered: &str) -> Value {
        self.refresh_token_if_needed();
        let mut params = Map::new();
        params.insert("conversation".into(), json!(request.conversation));
        params.insert("text".into(), json!(context::with_context(&request.text, &request.context)));
        let instructions = bot.map(|(i, _)| i).unwrap_or("");
        if !instructions.is_empty() || !remembered.is_empty() {
            // Added to the usual instructions by the core, never in place of them.
            let joined = [instructions, remembered].iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("\n\n");
            params.insert("system".into(), json!(joined));
        }
        if let Some((_, model)) = bot
            && !model.is_empty()
        {
            params.insert("model".into(), json!(model));
        }
        if request.plan {
            params.insert("plan".into(), json!(true));
        }
        match self.call("agent.send", Value::Object(params)) {
            Ok(v) => json!({ "ok": true, "turn": v.get("turn").cloned().unwrap_or(Value::Null) }),
            Err(e) => failed(Self::describe(&e)),
        }
    }

    pub fn cancel(&self, conversation: &str) {
        let _ = self.call("agent.cancel", json!({ "conversation": conversation }));
    }

    pub fn history(&self, conversation: &str) -> Value {
        match self.call("agent.history", json!({ "conversation": conversation })) {
            Ok(v @ Value::Array(_)) => v,
            _ => json!([]),
        }
    }

    pub fn conversations(&self) -> Value {
        let Ok(Value::Array(rows)) = self.call("agent.conversations", json!({})) else { return json!([]) };
        let found: Vec<Value> = rows
            .iter()
            .filter_map(|row| {
                let id = row.get("id")?.as_str().filter(|i| is_conversation_id(i))?;
                let title: String = row.get("title")?.as_str()?.chars().take(200).collect();
                let (updated, messages) = (row.get("updated_ms")?.as_i64()?, row.get("messages")?.as_u64()?);
                let activity = row.get("activity").and_then(Value::as_str).filter(|a| matches!(*a, "working" | "needs_you")).unwrap_or("idle");
                let waiting = row.get("waiting").and_then(Value::as_u64).unwrap_or(0);
                Some(json!({ "id": id, "title": title, "updated_ms": updated, "messages": messages, "activity": activity, "waiting": waiting }))
            })
            .collect();
        Value::Array(found)
    }

    pub fn delete_conversation(&self, conversation: &str) -> Value {
        match self.call("agent.delete", json!({ "conversation": conversation })) {
            Ok(_) => ok(),
            Err(e) => failed(Self::describe(&e)),
        }
    }

    /// Take back the last exchange; answers with the message that was taken back.
    pub fn rewind(&self, conversation: &str) -> Value {
        match self.call("agent.rewind", json!({ "conversation": conversation })) {
            Ok(v) => match v.get("text").and_then(Value::as_str) {
                Some(text) => json!({ "ok": true, "text": text }),
                None => failed(CORE_UNREACHABLE),
            },
            Err(e) => failed(Self::describe(&e)),
        }
    }

    pub fn waiting(&self, conversation: &str) -> Value {
        let Ok(Value::Array(rows)) = self.call("agent.waiting", json!({ "conversation": conversation })) else { return json!([]) };
        Value::Array(
            rows.iter()
                .filter_map(|row| {
                    let (request_id, call_id, tool) = (row.get("request_id")?.as_u64()?, row.get("call_id")?.as_str()?, row.get("tool")?.as_str()?);
                    Some(json!({ "requestId": request_id, "callId": call_id, "tool": tool, "arguments": row.get("arguments").cloned().unwrap_or(Value::Null), "onceOnly": row.get("once_only") == Some(&Value::Bool(true)) }))
                })
                .collect(),
        )
    }

    /// The question the model is waiting on in this conversation, if any, checked before the window sees it.
    pub fn question(&self, conversation: &str) -> Value {
        let Ok(row) = self.call("agent.question", json!({ "conversation": conversation })) else { return Value::Null };
        let q = json!({ "kind": "question", "call_id": row.get("call_id").cloned().unwrap_or(Value::Null), "question": row.get("question").cloned().unwrap_or(Value::Null), "choices": row.get("choices").cloned().unwrap_or(Value::Null) });
        if valid_event(&q) { json!({ "callId": q["call_id"], "question": q["question"], "choices": q["choices"] }) } else { Value::Null }
    }

    /// The person's answer to the model's question.
    pub fn answer(&self, conversation: &str, call_id: &str, text: &str) -> Value {
        if !is_conversation_id(conversation) || call_id.is_empty() || call_id.len() > 200 || text.trim().is_empty() || text.chars().count() > 4000 {
            return failed("That answer cannot be sent.");
        }
        match self.call("agent.answer", json!({ "conversation": conversation, "call_id": call_id, "text": text })) {
            Ok(_) => ok(),
            Err(e) => failed(Self::describe(&e)),
        }
    }

    pub fn resolve(&self, request_id: u64, approve: bool, duration: &str) -> Value {
        match self.call("permissions.resolve", json!({ "request_id": request_id, "approve": approve, "duration": duration })) {
            Ok(_) => ok(),
            Err(e) => failed(Self::describe(&e)),
        }
    }

    fn grant_rows(&self) -> Vec<Value> {
        let Ok(Value::Array(rows)) = self.call("permissions.grants", json!({})) else { return Vec::new() };
        rows.iter()
            .filter_map(|row| {
                let principal = row.get("principal")?;
                if principal.get("kind")?.as_str()? != "agent" || principal.get("id")?.as_str()? != "mobius-agent" {
                    return None;
                }
                let id = row.get("id")?.as_i64()?;
                let capability = row.get("capability")?.as_str()?;
                let resource = match row.get("resource")? {
                    Value::Null => Value::Null,
                    Value::String(s) => json!(s),
                    _ => return None,
                };
                let effect = row.get("effect")?.as_str().filter(|e| *e == "allow" || *e == "deny")?;
                let duration = row.get("duration")?.as_str().filter(|d| ["once", "session", "always"].contains(d))?;
                Some(json!({ "id": id, "capability": capability, "resource": resource, "effect": effect, "duration": duration, "createdMs": row.get("created_ms").and_then(Value::as_i64).unwrap_or(0) }))
            })
            .collect()
    }

    /// What the agent has been allowed (or refused) to do for good, newest first.
    pub fn grants(&self) -> Value {
        Value::Array(self.grant_rows().into_iter().filter(|r| r["duration"] == "always" || r["duration"] == "session").collect())
    }

    pub fn revoke_grant(&self, id: i64) -> Value {
        if !self.grant_rows().iter().any(|r| r["id"] == id) {
            return failed("That approval is not one of the agent's.");
        }
        match self.call("permissions.revoke", json!({ "grant_id": id })) {
            Ok(_) => ok(),
            Err(e) => failed(Self::describe(&e)),
        }
    }

    /// Recent activity, newest first. Only what was decided and by whom: never what was typed or read.
    pub fn activity(&self, limit: u64) -> Value {
        let Ok(Value::Array(rows)) = self.call("events.list", json!({ "newest": true, "limit": limit })) else { return json!([]) };
        Value::Array(
            rows.iter()
                .filter_map(|row| {
                    let (seq, ts, kind) = (row.get("seq")?.as_i64()?, row.get("ts_ms")?.as_i64()?, row.get("kind")?.as_str()?);
                    let text = |v: Option<&Value>| v.and_then(Value::as_str).map_or(Value::Null, |s| json!(s));
                    Some(json!({
                        "seq": seq, "tsMs": ts, "kind": kind, "capability": text(row.get("capability")), "resource": text(row.get("resource")),
                        "tool": text(row.get("detail").and_then(|d| d.get("tool"))), "who": text(row.get("principal").and_then(|p| p.get("kind"))),
                    }))
                })
                .collect(),
        )
    }

    // ---- the model server ----

    fn endpoint(&self) -> Result<(String, Option<String>), Value> {
        let s = lock(&self.saved);
        if s.base_url.is_empty() {
            return Err(failed("No model server is set up yet."));
        }
        Ok((s.base_url.trim_end_matches('/').to_owned(), s.key.clone()))
    }

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder().max_redirects(0).max_redirects_will_error(false).http_status_as_error(false).timeout_connect(Some(Duration::from_secs(8))).timeout_global(Some(Duration::from_secs(60))).build().into()
    }

    /// The key goes only to the saved address, and never in the clear to another computer.
    fn auth(url: &str, key: &Option<String>) -> Option<String> {
        let key = key.as_ref()?;
        let secure = url.starts_with("https://") || is_loopback(url);
        secure.then(|| format!("Bearer {key}"))
    }

    /// The models the server offers.
    pub fn models(&self) -> Value {
        let (base, key) = match self.endpoint() {
            Ok(x) => x,
            Err(e) => return e,
        };
        if base.eq_ignore_ascii_case(crate::providers::CLAUDE_CODE_ADDRESS) {
            return json!({ "ok": true, "models": mobius_claude::frames::MODELS.iter().map(|(id, _)| *id).collect::<Vec<_>>() });
        }
        Self::models_at(&base, &key)
    }

    /// The models a server offers, asked with this key (only ever over https or to this computer).
    pub fn models_at(base: &str, key: &Option<String>) -> Value {
        let url = format!("{}/models", base.trim_end_matches('/'));
        let mut req = Self::agent().get(&url);
        if let Some(a) = Self::auth(&url, key) {
            req = req.header("authorization", a);
        }
        let mut response = match req.call() {
            Ok(r) => r,
            Err(_) => return failed("Mobius could not reach the model server to list its models."),
        };
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return failed("The model server did not accept the key.");
        }
        if !(200..300).contains(&status) {
            return failed("The model server could not list its models.");
        }
        let Some(body) = response.body_mut().with_config().limit(2 * 1024 * 1024).read_to_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
            return failed("The model server answered with something Mobius could not read.");
        };
        let mut found: Vec<String> = body.get("data").and_then(Value::as_array).into_iter().flatten().filter_map(|r| r.get("id")?.as_str().filter(|i| is_model_name(i)).map(str::to_owned)).collect();
        found.sort_by_key(|a| a.to_lowercase());
        found.dedup();
        found.truncate(300);
        json!({ "ok": true, "models": found })
    }

    /// Turn a recording into text with the server's speech model.
    pub fn transcribe(&self, bytes: &[u8], mime: &str, model: &str) -> Value {
        let (base, key) = match self.endpoint() {
            Ok(x) => x,
            Err(e) => return e,
        };
        let url = format!("{base}/audio/transcriptions");
        let boundary = format!("----mobius{:x}", bytes.len() ^ 0x5eed_1234);
        let ext = mime.split('/').nth(1).unwrap_or("webm");
        let mut body = Vec::new();
        for (name, value) in [("model", model), ("response_format", "json")] {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{ext}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut req = Self::agent().post(&url).header("content-type", format!("multipart/form-data; boundary={boundary}"));
        if let Some(a) = Self::auth(&url, &key) {
            req = req.header("authorization", a);
        }
        let mut response = match req.send(&body[..]) {
            Ok(r) => r,
            Err(_) => return failed("Mobius could not reach the model server to turn your speech into text."),
        };
        let status = response.status().as_u16();
        if status == 401 || status == 403 {
            return failed("The model server did not accept the key.");
        }
        if [404, 405, 501].contains(&status) {
            return failed("This server cannot turn speech into text. Use a server with a speech model, or type instead.");
        }
        if !(200..300).contains(&status) {
            return failed(format!("The server did not accept the recording or the speech model \"{model}\"."));
        }
        let unreadable = || failed("The server answered with something Mobius could not read.");
        let Some(parsed) = response.body_mut().with_config().limit(1024 * 1024).read_to_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return unreadable() };
        let Some(text) = parsed.get("text").and_then(Value::as_str) else { return unreadable() };
        let text: String = text.trim().chars().take(5000).collect();
        if text.is_empty() { failed("No speech was heard.") } else { json!({ "ok": true, "text": text }) }
    }

    // ---- saving ----

    fn save(&self) {
        let mut s = lock(&self.saved);
        let usable = self.secrets.available();
        let sealed = s.key.as_ref().is_some_and(|k| usable && self.secrets.put(MODEL_KEY, k));
        if s.key.is_none() || !usable {
            self.secrets.delete(MODEL_KEY);
        }
        let second_sealed = s.fallback.as_ref().and_then(|f| f.key.as_ref()).is_some_and(|k| usable && self.secrets.put(FALLBACK_KEY, k));
        if s.fallback.as_ref().is_none_or(|f| f.key.is_none()) || !usable {
            self.secrets.delete(FALLBACK_KEY);
        }
        let mut body = json!({ "baseUrl": s.base_url, "model": s.model, "system": s.system, "maxSteps": s.max_steps, "keyStored": sealed });
        if let Some(f) = &s.fallback {
            body["fallback"] = json!({ "baseUrl": f.base_url, "model": f.model, "keyStored": second_sealed });
        }
        let written = mobius_store::file::write_json_checked(&self.settings_path, &body);
        s.persisted = sealed && written;
        if let Some(f) = s.fallback.as_mut() {
            f.persisted = second_sealed && written;
        }
    }

    fn load(&self) {
        let Some(Value::Object(data)) = mobius_store::file::read_json(&self.settings_path) else { return };
        let text = |v: Option<&Value>, limit: usize| v.and_then(Value::as_str).filter(|s| s.chars().count() <= limit).map(str::to_owned);
        let (Some(base_url), Some(model)) = (text(data.get("baseUrl"), 2048).filter(|s| !s.is_empty()), text(data.get("model"), 200).filter(|s| !s.is_empty())) else { return };
        let system = match data.get("system") {
            None => String::new(),
            Some(v) => match text(Some(v), 8000) {
                Some(s) => s,
                None => return,
            },
        };
        let max_steps = data.get("maxSteps").and_then(Value::as_u64).filter(|n| (1..=100).contains(n)).unwrap_or(DEFAULT_MAX_STEPS);
        let key = (data.get("keyStored") == Some(&Value::Bool(true)) && self.secrets.available()).then(|| self.secrets.get(MODEL_KEY)).flatten();
        let fallback = data.get("fallback").and_then(Value::as_object).and_then(|f| {
            let (base_url, model) = (text(f.get("baseUrl"), 2048).filter(|s| !s.is_empty())?, text(f.get("model"), 200).filter(|s| !s.is_empty())?);
            let key = (f.get("keyStored") == Some(&Value::Bool(true)) && self.secrets.available()).then(|| self.secrets.get(FALLBACK_KEY)).flatten();
            Some(Backup { base_url, model, persisted: key.is_some(), key })
        });
        *lock(&self.saved) = Saved { base_url, model, system, persisted: key.is_some(), key, max_steps, fallback };
    }
}

fn is_loopback(url: &str) -> bool {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h == "localhost" || h == "127.0.0.1" || h == "[::1]" || h == "::1")).unwrap_or(false)
}

fn core_params(s: &Saved) -> Value {
    let mut p = json!({ "base_url": s.base_url, "model": s.model });
    if let Some(k) = &s.key {
        p["api_key"] = json!(k);
    }
    if !s.system.is_empty() {
        p["system"] = json!(s.system);
    }
    if s.max_steps != DEFAULT_MAX_STEPS {
        p["max_steps"] = json!(s.max_steps);
    }
    if let Some(f) = &s.fallback {
        p["fallback"] = json!({ "base_url": f.base_url, "model": f.model });
        if let Some(k) = &f.key {
            p["fallback"]["api_key"] = json!(k);
        }
    }
    p
}

/// A notification from the core, checked before the window sees it. Anything unrecognised is dropped.
pub fn parse_notification(method: &str, params: &Value) -> Option<Value> {
    let conversation = params.get("conversation")?.as_str().filter(|c| is_conversation_id(c))?;
    let turn = params.get("turn")?.as_u64()?;
    match method {
        "agent.delta" => Some(json!({ "method": method, "params": { "conversation": conversation, "turn": turn, "text": params.get("text")?.as_str()? } })),
        "agent.event" => {
            let event = params.get("event")?;
            valid_event(event).then(|| json!({ "method": method, "params": { "conversation": conversation, "turn": turn, "event": event } }))
        }
        "agent.notice" => {
            let (kind, model, why) = (params.get("kind")?.as_str()?, params.get("model")?.as_str()?, params.get("why")?.as_str()?);
            (kind == "fallback" && !model.is_empty() && model.chars().count() <= 200 && why.chars().count() <= 300).then(|| json!({ "method": method, "params": { "conversation": conversation, "turn": turn, "kind": kind, "model": model, "why": why } }))
        }
        _ => None,
    }
}

fn valid_event(e: &Value) -> bool {
    let s = |k: &str| e.get(k).is_some_and(Value::is_string);
    match e.get("kind").and_then(Value::as_str) {
        Some("message") => s("text"),
        Some("tool_call") => s("call_id") && s("name"),
        Some("tool_result") => s("call_id") && s("name") && e.get("is_error").is_some_and(Value::is_boolean),
        Some("needs_approval") => e.get("request_id").is_some_and(Value::is_u64) && s("call_id") && s("tool") && e.get("arguments").is_some() && e.get("once_only").is_none_or(Value::is_boolean),
        Some("failed") => s("message"),
        Some("compacted") => e.get("messages").is_some_and(Value::is_u64),
        Some("todo") => e.get("items").and_then(Value::as_array).is_some_and(|items| {
            items.len() <= 50 && items.iter().all(|i| i.get("text").and_then(Value::as_str).is_some_and(|t| t.chars().count() <= 300) && matches!(i.get("status").and_then(Value::as_str), Some("pending" | "in_progress" | "done")))
        }),
        Some("question") => {
            s("call_id") && e.get("question").and_then(Value::as_str).is_some_and(|q| !q.is_empty() && q.chars().count() <= 1000)
                && e.get("choices").and_then(Value::as_array).is_some_and(|c| c.len() <= 6 && c.iter().all(|c| c.as_str().is_some_and(|c| c.chars().count() <= 200)))
        }
        Some("done" | "cancelled") => true,
        _ => false,
    }
}
