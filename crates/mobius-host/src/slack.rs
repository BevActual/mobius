//! Slack, for the Messages app: the person signs in on Slack's own page as themselves, and Mobius reads and sends
//! through Slack's Web API with the user token it gets back.
//!
//! - The sign-in is OAuth with PKCE, which Slack takes from a desktop app with no client secret once the app has PKCE
//!   turned on. Slack only comes back to the address registered with it, so the one-time page listens on a fixed
//!   port of this computer (`PORT`), at `http://localhost:PORT/slack`.
//! - Only user scopes are asked for (Slack gives a desktop sign-in no bot scopes): reading the person's channels,
//!   direct messages and groups, their history and people's names, sending as the person, and marking a channel read.
//! - Slack hands a PKCE app rotating tokens: the access token lasts hours and is refreshed; the refresh token lasts
//!   30 days, so a person away for longer signs in again.
//! - The tokens stay in the system secret store and are only ever sent to Slack.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::dropbox::{form, lock, now, read_body};
use crate::loopback::{Callback, challenge, random_text};

type Res<T> = Result<T, String>;

pub const AUTH: &str = "https://slack.com/oauth/v2/authorize";
pub const API: &str = "https://slack.com/api";
/// The port the sign-in comes back to. Registered with Slack as `http://localhost:47615/slack`.
pub const PORT: u16 = 47615;
const PATH: &str = "/slack";
/// What Mobius may do as the person: read their conversations and who is in them, send as them, and mark a
/// conversation read (Slack files marking read under the `:write` scopes).
pub const USER_SCOPES: &str = "channels:read,channels:history,channels:write,groups:read,groups:history,groups:write,im:read,im:history,im:write,mpim:read,mpim:history,mpim:write,users:read,chat:write";
const SKEW_SECONDS: u64 = 5 * 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 8 * 1024 * 1024;
/// The most conversations one workspace lists.
pub const MAX_CHANNELS: usize = 500;
/// The most people whose names a workspace keeps, for showing who wrote what.
const MAX_PEOPLE: usize = 5000;

pub const NOT_SET_UP: &str = "Slack isn't set up in this build of Mobius yet. Mobius has to be registered with Slack first.";
pub const EXPIRED: &str = "The Slack sign-in has ended. Choose Sign in again.";

/// Mobius as registered with Slack (Andrew's "Mobius" app, PKCE on). A PKCE app has no secret, so its client ID is
/// public and kept here; `MOBIUS_SLACK_CLIENT_ID` when building points a build at another registration.
pub const CLIENT_ID: &str = "12667206116160.12633560458981";

pub fn built_in_client_id() -> Option<String> {
    Some(option_env!("MOBIUS_SLACK_CLIENT_ID").filter(|k| !k.is_empty()).unwrap_or(CLIENT_ID).to_owned())
}

/// Where requests go: Slack, or a pretend Slack in tests (which also listens on any free port).
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth: String,
    pub api: String,
    pub port: u16,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints { auth: AUTH.into(), api: API.into(), port: PORT }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    #[serde(default)]
    pub refresh: String,
    /// When `access` runs out, in seconds since 1970; 0 when it doesn't.
    #[serde(default)]
    pub expires: u64,
    /// The person, in Slack's ids.
    pub user: String,
    pub team: String,
    #[serde(default)]
    pub team_name: String,
}

impl Tokens {
    pub fn fresh(&self) -> bool {
        self.expires == 0 || self.expires > now() + SKEW_SECONDS
    }
}

/// Which of a conversation's messages to read.
#[derive(Debug, Clone, Copy, Default)]
pub struct Page<'a> {
    pub before: Option<&'a str>,
    /// One thread's messages, by its first message.
    pub thread: Option<&'a str>,
    pub limit: usize,
}

pub struct Slack {
    client_id: Option<String>,
    pub at: Endpoints,
    pending: Mutex<Option<(String, Arc<AtomicBool>)>>,
    refreshing: Mutex<()>,
    http: ureq::Agent,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(60)))
        .user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// Slack's answer to a token request: the person's token is under `authed_user` after a sign-in, and at the top
/// after a refresh.
fn tokens_of(answer: &Value, before: Option<&Tokens>) -> Res<Tokens> {
    let user = answer.get("authed_user").filter(|u| u.get("access_token").is_some()).unwrap_or(answer);
    let access = user.get("access_token").and_then(Value::as_str).filter(|s| s.starts_with("xox")).ok_or("Slack did not send a token for you.")?.to_owned();
    let text = |v: Option<&Value>| v.and_then(Value::as_str).unwrap_or("").to_owned();
    let refresh = Some(text(user.get("refresh_token"))).filter(|r| !r.is_empty()).or_else(|| before.map(|b| b.refresh.clone())).unwrap_or_default();
    let expires = user.get("expires_in").and_then(Value::as_u64).map_or(0, |s| now() + s);
    let id = Some(text(user.get("id"))).filter(|i| !i.is_empty()).or_else(|| before.map(|b| b.user.clone())).unwrap_or_default();
    let team = answer.get("team");
    let team_id = Some(text(team.and_then(|t| t.get("id")))).filter(|i| !i.is_empty()).or_else(|| before.map(|b| b.team.clone())).unwrap_or_default();
    let team_name = Some(text(team.and_then(|t| t.get("name")))).filter(|i| !i.is_empty()).or_else(|| before.map(|b| b.team_name.clone())).unwrap_or_default();
    if id.is_empty() {
        return Err("Slack did not say who signed in.".into());
    }
    Ok(Tokens { access, refresh, expires, user: id, team: team_id, team_name })
}

/// Slack's own errors, said for a person. A sign-in that has ended comes back as `EXPIRED`.
fn failed(error: &str) -> String {
    match error {
        "invalid_auth" | "not_authed" | "token_revoked" | "token_expired" | "account_inactive" | "invalid_refresh_token" => EXPIRED.into(),
        "missing_scope" => "Slack didn't give Mobius that permission. Sign in to Slack again and allow everything it asks for.".into(),
        "channel_not_found" => "That conversation isn't there on Slack any more.".into(),
        "not_in_channel" => "You're not in that channel on Slack.".into(),
        "is_archived" => "That channel is archived on Slack.".into(),
        "msg_too_long" => "That message is too long for Slack.".into(),
        "ratelimited" => "Slack is busy. Try again in a minute.".into(),
        other => format!("Slack refused ({}).", other.chars().take(60).collect::<String>()),
    }
}

impl Slack {
    /// `client_id` is `built_in_client_id()` except in tests.
    pub fn new(client_id: Option<String>, at: Endpoints) -> Slack {
        let at = Endpoints { auth: at.auth, api: at.api.trim_end_matches('/').to_owned(), port: at.port };
        Slack { client_id, at, pending: Mutex::new(None), refreshing: Mutex::new(()), http: agent() }
    }

    fn client_id(&self) -> Res<&str> {
        self.client_id.as_deref().ok_or_else(|| NOT_SET_UP.to_owned())
    }

    /// What Settings shows before the person starts.
    pub fn status(&self) -> Value {
        json!({ "setUp": self.client_id.is_some(), "pending": lock(&self.pending).as_ref().map(|(url, _)| url.clone()), "hint": self.client_id.is_none().then_some(NOT_SET_UP) })
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = lock(&self.pending).take() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Start a browser sign-in and return the page to open. `done` hears the tokens, or why not.
    pub fn start(self: &Arc<Self>, done: Arc<dyn Fn(Res<Tokens>) + Send + Sync>) -> Res<String> {
        let client_id = self.client_id()?.to_owned();
        if let Some((url, _)) = lock(&self.pending).as_ref() {
            return Ok(url.clone());
        }
        let callback = Callback::listen_on(PATH, self.at.port)?;
        let redirect = format!("http://localhost:{}{PATH}", callback.port());
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&self.at.auth).map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("scope", "")
            .append_pair("user_scope", USER_SCOPES)
            .append_pair("redirect_uri", &redirect)
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge(&verifier))
            .append_pair("code_challenge_method", "S256");
        let url = url.to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.pending) = Some((url.clone(), cancel.clone()));
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let result = callback.wait("Slack", &state, &cancel, MAX_WAIT, |query| me.exchange(&client_id, query, &verifier, &redirect));
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

    fn token_request(&self, body: &str) -> Res<Value> {
        let response = self.http.post(&format!("{}/oauth.v2.access", self.at.api)).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes()).map_err(|e| format!("Could not reach Slack: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        if status != 200 {
            return Err(format!("Slack answered {status} to the sign-in."));
        }
        Ok(serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    fn exchange(&self, client_id: &str, query: &HashMap<String, String>, verifier: &str, redirect: &str) -> Res<Tokens> {
        let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("Slack sent no sign-in code.")?;
        let answer = self.token_request(&form(&[("client_id", client_id), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect)]))?;
        if answer.get("ok").and_then(Value::as_bool) != Some(true) {
            let error = answer.get("error").and_then(Value::as_str).unwrap_or("unknown");
            return Err(if error == "invalid_code" { "The sign-in code had expired. Try again.".into() } else { format!("Slack refused the sign-in ({}).", error.chars().take(60).collect::<String>()) });
        }
        tokens_of(&answer, None)
    }

    /// Fresh tokens for stale ones. `EXPIRED` when Slack won't refresh them: the person signs in again.
    pub fn refresh(&self, tokens: &Tokens) -> Res<Tokens> {
        let client_id = self.client_id()?;
        let _one_at_a_time = lock(&self.refreshing);
        if tokens.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let answer = self.token_request(&form(&[("client_id", client_id), ("grant_type", "refresh_token"), ("refresh_token", &tokens.refresh)]))?;
        if answer.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(failed(answer.get("error").and_then(Value::as_str).unwrap_or("unknown")));
        }
        tokens_of(&answer, Some(tokens))
    }

    /// One Web API method, with its arguments as a form. Answers Slack's JSON when it says `ok`.
    pub fn call(&self, token: &str, method: &str, args: &[(&str, &str)]) -> Res<Value> {
        let response = self
            .http
            .post(&format!("{}/{method}", self.at.api))
            .header("Authorization", &format!("Bearer {token}"))
            .header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
            .send(form(args).as_bytes())
            .map_err(|e| format!("Could not reach Slack: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        if status == 429 {
            return Err(failed("ratelimited"));
        }
        if status != 200 {
            return Err(format!("Slack answered {status}."));
        }
        let answer: Value = serde_json::from_slice(&body).map_err(|_| "Slack's answer could not be read.".to_owned())?;
        if answer.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(failed(answer.get("error").and_then(Value::as_str).unwrap_or("unknown")));
        }
        Ok(answer)
    }

    /// Every page of a listing method, up to `max` items of `field`.
    fn pages(&self, token: &str, method: &str, args: &[(&str, &str)], field: &str, max: usize) -> Res<Vec<Value>> {
        let mut all = Vec::new();
        let mut cursor = String::new();
        loop {
            let mut with: Vec<(&str, &str)> = args.to_vec();
            with.push(("limit", "200"));
            if !cursor.is_empty() {
                with.push(("cursor", &cursor));
            }
            let answer = self.call(token, method, &with)?;
            all.extend(answer.get(field).and_then(Value::as_array).cloned().unwrap_or_default());
            cursor = answer.pointer("/response_metadata/next_cursor").and_then(Value::as_str).unwrap_or("").to_owned();
            if cursor.is_empty() || all.len() >= max {
                all.truncate(max);
                return Ok(all);
            }
        }
    }

    /// Everyone in the workspace, by id: their display name, else their real name, else their handle.
    pub fn people(&self, token: &str) -> Res<HashMap<String, String>> {
        let members = self.pages(token, "users.list", &[], "members", MAX_PEOPLE)?;
        Ok(members
            .iter()
            .filter_map(|m| {
                let id = m.get("id").and_then(Value::as_str)?;
                let profile = m.get("profile");
                let pick = |k: &str| profile.and_then(|p| p.get(k)).and_then(Value::as_str).filter(|s| !s.trim().is_empty());
                let name = pick("display_name").or_else(|| pick("real_name")).or_else(|| m.get("real_name").and_then(Value::as_str).filter(|s| !s.trim().is_empty())).or_else(|| m.get("name").and_then(Value::as_str))?;
                Some((id.to_owned(), name.trim().to_owned()))
            })
            .collect())
    }

    /// The conversations the person is in: channels, private channels, direct messages and groups.
    pub fn channels(&self, token: &str, account: &str, people: &HashMap<String, String>) -> Res<Vec<Value>> {
        let found = self.pages(token, "users.conversations", &[("types", "public_channel,private_channel,mpim,im"), ("exclude_archived", "true")], "channels", MAX_CHANNELS)?;
        Ok(found.iter().filter_map(|c| channel_of(c, account, people)).collect())
    }

    /// A conversation's messages, oldest first: the newest `page.limit` before `page.before`, or one thread's.
    pub fn history(&self, token: &str, channel: &str, page: &Page<'_>, me: &str, people: &HashMap<String, String>) -> Res<Vec<Value>> {
        let (before, limit) = (page.before, page.limit.clamp(1, 200).to_string());
        let answer = match page.thread {
            Some(ts) => self.call(token, "conversations.replies", &[("channel", channel), ("ts", ts), ("limit", &limit)])?,
            None => {
                let mut args = vec![("channel", channel), ("limit", limit.as_str())];
                if let Some(b) = before {
                    args.push(("latest", b));
                }
                self.call(token, "conversations.history", &args)?
            }
        };
        let mut out: Vec<Value> = answer.get("messages").and_then(Value::as_array).into_iter().flatten().filter_map(|m| message_of(m, channel, me, people)).collect();
        out.sort_by(|a, b| a["at"].as_f64().unwrap_or(0.0).total_cmp(&b["at"].as_f64().unwrap_or(0.0)));
        Ok(out)
    }

    /// Sends what the person wrote, as the person.
    pub fn send(&self, token: &str, channel: &str, text: &str, thread: Option<&str>, me: &str, people: &HashMap<String, String>) -> Res<Value> {
        let mut args = vec![("channel", channel), ("text", text)];
        if let Some(t) = thread {
            args.push(("thread_ts", t));
        }
        let answer = self.call(token, "chat.postMessage", &args)?;
        let sent = answer.get("message").cloned().unwrap_or_else(|| json!({ "ts": answer.get("ts"), "user": me, "text": text }));
        message_of(&sent, channel, me, people).ok_or_else(|| "Slack did not say what it sent.".to_owned())
    }

    pub fn mark_read(&self, token: &str, channel: &str, up_to: &str) -> Res<()> {
        self.call(token, "conversations.mark", &[("channel", channel), ("ts", up_to)]).map(|_| ())
    }
}

/// A Slack conversation as Messages shows it.
pub fn channel_of(c: &Value, account: &str, people: &HashMap<String, String>) -> Option<Value> {
    let id = c.get("id").and_then(Value::as_str).filter(|i| !i.is_empty() && i.len() <= 40)?;
    let flag = |k: &str| c.get(k).and_then(Value::as_bool).unwrap_or(false);
    let (kind, name) = if flag("is_im") {
        let user = c.get("user").and_then(Value::as_str).unwrap_or("");
        if c.get("is_user_deleted").and_then(Value::as_bool).unwrap_or(false) {
            return None;
        }
        ("direct", people.get(user).cloned().unwrap_or_else(|| user.to_owned()))
    } else if flag("is_mpim") {
        // Slack names a group "mpdm-ana--lee--sam-1": the people's handles.
        let raw = c.get("name").and_then(Value::as_str).unwrap_or("group");
        let inner = raw.strip_prefix("mpdm-").map(|s| s.rsplit_once('-').map_or(s, |(a, _)| a)).unwrap_or(raw);
        ("group", inner.split("--").collect::<Vec<_>>().join(", "))
    } else {
        ("channel", c.get("name").and_then(Value::as_str).unwrap_or(id).to_owned())
    };
    let mut channel = json!({ "id": id, "account": account, "name": name, "kind": kind, "unread": 0, "mentions": 0 });
    if let Some(n) = c.get("unread_count_display").and_then(Value::as_u64) {
        channel["unread"] = json!(n);
    }
    Some(channel)
}

/// Slack's timestamp (`"1731920700.000200"`) in ms.
fn at_of(ts: &str) -> Option<u64> {
    let (secs, micros) = ts.split_once('.').unwrap_or((ts, "0"));
    let secs: u64 = secs.parse().ok()?;
    let millis: u64 = micros.get(..3).unwrap_or(micros).parse().unwrap_or(0);
    Some(secs * 1000 + millis)
}

/// Slack's message markup as plain text: `<@U1>` → `@Ana`, `<#C1|general>` → `#general`, `<https://x|label>` →
/// `label (https://x)`, and `&amp;`, `&lt;`, `&gt;` back to what was typed.
pub fn plain(text: &str, people: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('>') else {
            out.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let inner = &rest[open + 1..open + close];
        let (target, label) = inner.split_once('|').map_or((inner, None), |(t, l)| (t, Some(l)));
        let shown = if let Some(user) = target.strip_prefix('@') {
            format!("@{}", label.map(str::to_owned).or_else(|| people.get(user).cloned()).unwrap_or_else(|| user.to_owned()))
        } else if let Some(channel) = target.strip_prefix('#') {
            format!("#{}", label.unwrap_or(channel))
        } else if let Some(special) = target.strip_prefix('!') {
            label.map_or_else(|| format!("@{}", special.split('^').next().unwrap_or(special)), |l| l.to_owned())
        } else {
            match label {
                Some(l) if l != target => format!("{l} ({target})"),
                _ => target.strip_prefix("mailto:").unwrap_or(target).to_owned(),
            }
        };
        out.push_str(&shown);
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// A few of Slack's reaction names as emoji; the rest are shown by name.
fn emoji(name: &str) -> String {
    let base = name.split("::").next().unwrap_or(name);
    let known = match base {
        "+1" | "thumbsup" => "👍",
        "-1" | "thumbsdown" => "👎",
        "eyes" => "👀",
        "heart" => "❤️",
        "joy" => "😂",
        "smile" | "smiley" => "😄",
        "tada" => "🎉",
        "white_check_mark" | "heavy_check_mark" => "✅",
        "fire" => "🔥",
        "pray" => "🙏",
        "raised_hands" => "🙌",
        "100" => "💯",
        "rocket" => "🚀",
        "thinking_face" => "🤔",
        "wave" => "👋",
        "clap" => "👏",
        "x" => "❌",
        "warning" => "⚠️",
        _ => "",
    };
    if known.is_empty() { format!(":{base}:") } else { known.to_owned() }
}

/// A Slack message as Messages shows it. Joins and other notices without words are left out.
pub fn message_of(m: &Value, channel: &str, me: &str, people: &HashMap<String, String>) -> Option<Value> {
    let ts = m.get("ts").and_then(Value::as_str).filter(|t| !t.is_empty() && t.len() <= 40)?;
    let raw = m.get("text").and_then(Value::as_str).unwrap_or("");
    let files = m.get("files").and_then(Value::as_array).map_or(0, Vec::len);
    if raw.trim().is_empty() && files == 0 {
        return None;
    }
    let user = m.get("user").and_then(Value::as_str).unwrap_or("");
    let name = people
        .get(user)
        .cloned()
        .or_else(|| m.pointer("/user_profile/display_name").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned))
        .or_else(|| m.get("username").and_then(Value::as_str).map(str::to_owned))
        .or_else(|| m.pointer("/bot_profile/name").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| if user.is_empty() { "Slack".to_owned() } else { user.to_owned() });
    let id = if user.is_empty() { m.get("bot_id").and_then(Value::as_str).unwrap_or("bot") } else { user };
    let mut text = plain(raw, people);
    if files > 0 {
        let line = if files == 1 { "(1 file)".to_owned() } else { format!("({files} files)") };
        text = if text.trim().is_empty() { line } else { format!("{text}\n{line}") };
    }
    let mut author = json!({ "id": id, "name": name });
    if !me.is_empty() && user == me {
        author["me"] = json!(true);
    }
    let mut out = json!({ "id": ts, "channel": channel, "author": author, "text": text, "at": at_of(ts)? });
    if let Some(parent) = m.get("thread_ts").and_then(Value::as_str).filter(|t| *t != ts) {
        out["thread"] = json!(parent);
    }
    if let Some(n) = m.get("reply_count").and_then(Value::as_u64).filter(|n| *n > 0) {
        out["replies"] = json!(n);
    }
    let reactions: Vec<Value> = m
        .get("reactions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let name = r.get("name").and_then(Value::as_str)?;
            let count = r.get("count").and_then(Value::as_u64).unwrap_or(1);
            let mine = !me.is_empty() && r.get("users").and_then(Value::as_array).is_some_and(|u| u.iter().any(|x| x.as_str() == Some(me)));
            let mut reaction = json!({ "emoji": emoji(name), "count": count });
            if mine {
                reaction["mine"] = json!(true);
            }
            Some(reaction)
        })
        .collect();
    if !reactions.is_empty() {
        out["reactions"] = json!(reactions);
    }
    if m.get("edited").is_some() {
        out["edited"] = json!(true);
    }
    Some(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn people() -> HashMap<String, String> {
        HashMap::from([("U1".to_owned(), "Ana".to_owned()), ("U2".to_owned(), "Lee Park".to_owned())])
    }

    #[test]
    fn slack_markup_reads_as_plain_text() {
        let p = people();
        assert_eq!(plain("hi <@U2>, see <#C9|general>", &p), "hi @Lee Park, see #general");
        assert_eq!(plain("<https://example.com|the doc> &amp; <https://x.example>", &p), "the doc (https://example.com) & https://x.example");
        assert_eq!(plain("<!here> 3 &lt; 4", &p), "@here 3 < 4");
        assert_eq!(plain("<mailto:a@b.example|a@b.example>", &p), "a@b.example (mailto:a@b.example)");
        assert_eq!(plain("unclosed <@U1", &p), "unclosed <@U1");
        assert_eq!(plain("<@U7>", &p), "@U7");
    }

    #[test]
    fn a_message_has_its_author_thread_reactions_and_time() {
        let m = json!({ "ts": "1731920700.000200", "user": "U2", "text": "On it <@U1>", "thread_ts": "1731920600.000100", "reply_count": 0, "edited": { "ts": "1" },
            "reactions": [{ "name": "+1", "count": 2, "users": ["U1", "U2"] }, { "name": "partyparrot", "count": 1, "users": ["U2"] }] });
        let got = message_of(&m, "C1", "U1", &people()).unwrap();
        assert_eq!(got["id"], "1731920700.000200");
        assert_eq!(got["at"], 1_731_920_700_000u64);
        assert_eq!(got["author"], json!({ "id": "U2", "name": "Lee Park" }));
        assert_eq!(got["text"], "On it @Ana");
        assert_eq!(got["thread"], "1731920600.000100");
        assert!(got.get("replies").is_none());
        assert_eq!(got["reactions"], json!([{ "emoji": "👍", "count": 2, "mine": true }, { "emoji": ":partyparrot:", "count": 1 }]));
        assert_eq!(got["edited"], true);
        let mine = message_of(&json!({ "ts": "1.5", "user": "U1", "text": "x" }), "C1", "U1", &people()).unwrap();
        assert_eq!(mine["author"]["me"], true);
        // A thread's first message is not "in" its own thread.
        let parent = message_of(&json!({ "ts": "2.0", "thread_ts": "2.0", "reply_count": 3, "user": "U2", "text": "q" }), "C1", "U1", &people()).unwrap();
        assert!(parent.get("thread").is_none());
        assert_eq!(parent["replies"], 3);
        // A bot, a file with no words, and a join with nothing to say.
        assert_eq!(message_of(&json!({ "ts": "3.0", "bot_id": "B1", "username": "CI", "text": "Build passed" }), "C1", "U1", &people()).unwrap()["author"], json!({ "id": "B1", "name": "CI" }));
        assert_eq!(message_of(&json!({ "ts": "4.0", "user": "U2", "text": "", "files": [{}] }), "C1", "U1", &people()).unwrap()["text"], "(1 file)");
        assert!(message_of(&json!({ "ts": "5.0", "user": "U2", "subtype": "channel_join", "text": "" }), "C1", "U1", &people()).is_none());
    }

    #[test]
    fn conversations_are_channels_direct_messages_and_groups() {
        let p = people();
        assert_eq!(channel_of(&json!({ "id": "C1", "name": "general", "is_channel": true }), "w", &p).unwrap(), json!({ "id": "C1", "account": "w", "name": "general", "kind": "channel", "unread": 0, "mentions": 0 }));
        assert_eq!(channel_of(&json!({ "id": "D1", "is_im": true, "user": "U2" }), "w", &p).unwrap()["name"], "Lee Park");
        assert_eq!(channel_of(&json!({ "id": "D1", "is_im": true, "user": "U2" }), "w", &p).unwrap()["kind"], "direct");
        assert!(channel_of(&json!({ "id": "D2", "is_im": true, "user": "U3", "is_user_deleted": true }), "w", &p).is_none());
        let group = channel_of(&json!({ "id": "G1", "is_mpim": true, "name": "mpdm-ana--lee--sam-1" }), "w", &p).unwrap();
        assert_eq!((group["kind"].as_str(), group["name"].as_str()), (Some("group"), Some("ana, lee, sam")));
    }

    #[test]
    fn a_token_answer_is_read_from_a_sign_in_and_from_a_refresh() {
        let signed = tokens_of(&json!({ "ok": true, "team": { "id": "T1", "name": "Northway" }, "authed_user": { "id": "U1", "access_token": "xoxe.xoxp-1", "refresh_token": "xoxe-1-r", "expires_in": 43200 } }), None).unwrap();
        assert_eq!((signed.user.as_str(), signed.team.as_str(), signed.team_name.as_str(), signed.refresh.as_str()), ("U1", "T1", "Northway", "xoxe-1-r"));
        assert!(signed.fresh());
        let refreshed = tokens_of(&json!({ "ok": true, "access_token": "xoxe.xoxp-2", "refresh_token": "xoxe-1-s", "expires_in": 43200, "token_type": "user" }), Some(&signed)).unwrap();
        assert_eq!((refreshed.access.as_str(), refreshed.refresh.as_str(), refreshed.user.as_str(), refreshed.team_name.as_str()), ("xoxe.xoxp-2", "xoxe-1-s", "U1", "Northway"));
        assert!(tokens_of(&json!({ "ok": true, "authed_user": { "id": "U1" } }), None).is_err());
    }

    #[test]
    fn slack_errors_read_for_a_person() {
        assert_eq!(failed("token_expired"), EXPIRED);
        assert_eq!(failed("invalid_auth"), EXPIRED);
        assert!(failed("not_in_channel").contains("not in that channel"));
        assert!(failed("weird_thing").contains("weird_thing"));
    }

    /// A pretend Slack: the token endpoint (code `the-code`, refresh `refresh-1`), and enough of the Web API for
    /// Messages. Every request is logged as `method body`.
    pub(crate) fn server() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let lg = log.clone();
        std::thread::spawn(move || {
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
                let body = String::from_utf8_lossy(data.get(end + 4..).unwrap_or_default()).to_string();
                let method = head.split_whitespace().nth(1).unwrap_or("").trim_start_matches('/').to_owned();
                let auth = head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).map(|(_, v)| v.trim().to_owned())).unwrap_or_default();
                lg.lock().unwrap().push(format!("{method} {body}"));
                let arg = |k: &str| url::form_urlencoded::parse(body.as_bytes()).find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap_or_default();
                let answer = if method == "oauth.v2.access" {
                    if arg("code") == "the-code" && !arg("code_verifier").is_empty() && arg("client_id") == "client-1" {
                        minted += 1;
                        json!({ "ok": true, "team": { "id": "T1", "name": "Northway" }, "authed_user": { "id": "U1", "access_token": format!("xoxe.xoxp-{minted}"), "refresh_token": "refresh-1", "expires_in": 43200 } })
                    } else if arg("refresh_token") == "refresh-1" {
                        minted += 1;
                        json!({ "ok": true, "access_token": format!("xoxe.xoxp-{minted}"), "refresh_token": "refresh-1", "expires_in": 43200 })
                    } else {
                        json!({ "ok": false, "error": "invalid_refresh_token" })
                    }
                } else if !auth.starts_with("Bearer xoxe.xoxp-") || auth.ends_with("expired") {
                    json!({ "ok": false, "error": "token_expired" })
                } else {
                    match method.as_str() {
                        "users.list" => json!({ "ok": true, "members": [{ "id": "U1", "name": "ana", "profile": { "display_name": "Ana" } }, { "id": "U2", "name": "lee", "profile": { "display_name": "", "real_name": "Lee Park" } }], "response_metadata": { "next_cursor": "" } }),
                        "users.conversations" if arg("cursor").is_empty() => json!({ "ok": true, "channels": [{ "id": "C1", "name": "general", "is_channel": true }], "response_metadata": { "next_cursor": "page2" } }),
                        "users.conversations" => json!({ "ok": true, "channels": [{ "id": "D1", "is_im": true, "user": "U2" }], "response_metadata": { "next_cursor": "" } }),
                        "conversations.history" => json!({ "ok": true, "messages": [
                            { "ts": "1731920760.000300", "user": "U2", "text": "Can someone look before standup?" },
                            { "ts": "1731920700.000200", "user": "U2", "text": "The build is red again", "thread_ts": "1731920700.000200", "reply_count": 1 },
                        ] }),
                        "conversations.replies" => json!({ "ok": true, "messages": [
                            { "ts": "1731920700.000200", "user": "U2", "text": "The build is red again", "thread_ts": "1731920700.000200", "reply_count": 1 },
                            { "ts": "1731920800.000400", "user": "U1", "text": "On it", "thread_ts": "1731920700.000200" },
                        ] }),
                        "chat.postMessage" => json!({ "ok": true, "channel": arg("channel"), "ts": "1731920900.000500", "message": { "ts": "1731920900.000500", "user": "U1", "text": arg("text") } }),
                        "conversations.mark" => json!({ "ok": true }),
                        _ => json!({ "ok": false, "error": "unknown_method" }),
                    }
                };
                let out = answer.to_string();
                let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
            }
        });
        (url, log)
    }

    pub(crate) fn pretend(url: &str) -> Arc<Slack> {
        Arc::new(Slack::new(Some("client-1".into()), Endpoints { auth: format!("{url}/authorize"), api: url.to_owned(), port: 0 }))
    }

    /// Signs in through the pretend Slack's page: the browser's visit to the one-time page with the code.
    pub(crate) fn sign_in(slack: &Arc<Slack>) -> Tokens {
        let (tx, rx) = std::sync::mpsc::channel();
        let url = slack.start(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        let page = url::Url::parse(&url).unwrap();
        let q = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
        assert_eq!(q("scope"), "");
        assert_eq!(q("user_scope"), USER_SCOPES);
        assert_eq!(q("code_challenge_method"), "S256");
        let back = format!("{}?code=the-code&state={}", q("redirect_uri"), q("state"));
        assert!(back.starts_with("http://localhost:"));
        let back = back.replacen("localhost", "127.0.0.1", 1);
        let _ = ureq::get(&back).call();
        rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap()
    }

    #[test]
    fn signed_in_slack_lists_reads_sends_and_marks_read() {
        let (url, log) = server();
        let slack = pretend(&url);
        let tokens = sign_in(&slack);
        assert_eq!((tokens.user.as_str(), tokens.team_name.as_str()), ("U1", "Northway"));
        let people = slack.people(&tokens.access).unwrap();
        assert_eq!(people.get("U2").map(String::as_str), Some("Lee Park"));
        let channels = slack.channels(&tokens.access, "w", &people).unwrap();
        assert_eq!(channels.iter().map(|c| c["name"].as_str().unwrap()).collect::<Vec<_>>(), ["general", "Lee Park"]);
        let history = slack.history(&tokens.access, "C1", &Page { limit: 50, ..Page::default() }, &tokens.user, &people).unwrap();
        assert_eq!(history.iter().map(|m| m["text"].as_str().unwrap()).collect::<Vec<_>>(), ["The build is red again", "Can someone look before standup?"]);
        let thread = slack.history(&tokens.access, "C1", &Page { thread: Some("1731920700.000200"), limit: 50, ..Page::default() }, &tokens.user, &people).unwrap();
        assert_eq!(thread[1]["author"], json!({ "id": "U1", "name": "Ana", "me": true }));
        let sent = slack.send(&tokens.access, "C1", "Looking & fixing", Some("1731920700.000200"), &tokens.user, &people).unwrap();
        assert_eq!(sent["text"], "Looking & fixing");
        slack.mark_read(&tokens.access, "C1", "1731920760.000300").unwrap();
        let log = log.lock().unwrap();
        assert!(log.iter().any(|l| l.starts_with("chat.postMessage ") && l.contains("thread_ts=1731920700.000200") && l.contains("text=Looking+%26+fixing")));
        assert!(log.iter().any(|l| l.starts_with("conversations.mark ") && l.contains("ts=1731920760.000300")));
        // The sign-in sent no secret: a PKCE app has none.
        assert!(log.iter().filter(|l| l.starts_with("oauth.v2.access ")).all(|l| !l.contains("client_secret")));
    }

    #[test]
    fn a_refused_refresh_means_signing_in_again() {
        let (url, _) = server();
        let slack = pretend(&url);
        let tokens = sign_in(&slack);
        let stale = Tokens { expires: 1, ..tokens.clone() };
        assert!(!stale.fresh());
        assert!(slack.refresh(&stale).unwrap().access.starts_with("xoxe.xoxp-"));
        assert_eq!(slack.refresh(&Tokens { refresh: "gone".into(), ..tokens.clone() }).unwrap_err(), EXPIRED);
        assert_eq!(slack.call("xoxe.xoxp-expired", "users.list", &[]).unwrap_err(), EXPIRED);
    }

    #[test]
    fn without_a_registration_slack_is_not_set_up() {
        let slack = Arc::new(Slack::new(None, Endpoints::default()));
        assert_eq!(slack.status()["setUp"], false);
        assert_eq!(slack.start(Arc::new(|_| {})).unwrap_err(), NOT_SET_UP);
    }
}
