//! Matrix, for the Messages app: the person signs in to their own homeserver as themselves, and Mobius reads and sends
//! through the Matrix client-server API (https://spec.matrix.org/latest/client-server-api/).
//!
//! - Finding the server: a Matrix ID (`@ana:example.org`), a server name, or a server's address. A server name is
//!   looked up through its `/.well-known/matrix/client`.
//! - Signing in, whichever the server offers: on the server's own page through OAuth 2.0 (Matrix Authentication
//!   Service: the client registers itself, then PKCE with a one-time page on 127.0.0.1); on the server's own page
//!   through its older single sign-on; or a username and password typed into Mobius, which are sent only to the
//!   server and never kept. Each sign-in is its own device on the account, named "Mobius".
//! - Reading: one `/sync` per account, kept in memory, gives the rooms with their names and unread counts; each later
//!   look asks only for what changed. A room's messages are read from the server as they are shown and not kept.
//! - Encrypted rooms are listed, and say so; reading them needs this device verified, which comes next.
//! - The sign-in stays in the system secret store and is only ever sent to the person's server.
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::dropbox::{form, lock, now};
use crate::loopback::{Callback, challenge, random_text};
use crate::matrix_crypto::Crypto;

type Res<T> = Result<T, String>;
/// What turns the browser's return to the one-time page into a sign-in.
type Finish = Box<dyn FnMut(&HashMap<String, String>) -> Res<Session> + Send>;

pub const EXPIRED: &str = "The Matrix sign-in has ended. Choose Sign in again.";
/// Inside this file only: the server no longer takes the token, which a refresh may still mend.
const UNKNOWN_TOKEN: &str = "matrix:unknown-token";
const PATH: &str = "/matrix";
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
const MAX_JSON: u64 = 8 * 1024 * 1024;
/// The first look at an account can be large: every room it is in.
const MAX_SYNC: u64 = 64 * 1024 * 1024;
pub const MAX_ROOMS: usize = 500;
/// What Mobius says about itself when it registers with a server's sign-in service.
const CLIENT_URI: &str = "https://mobiusworkspace.com/";
const DEVICE_NAME: &str = "Mobius";

/// The parts of each room a first look reads; everything else (presence, typing, receipts) is left out.
const SYNC_FILTER: &str = r#"{"presence":{"not_types":["*"]},"account_data":{"types":["m.direct"]},"room":{"state":{"lazy_load_members":true,"types":["m.room.name","m.room.canonical_alias","m.room.encryption","m.room.member","m.bridge","uk.half-shot.bridge"]},"timeline":{"limit":1,"lazy_load_members":true},"ephemeral":{"not_types":["*"]},"account_data":{"not_types":["*"]}}}"#;
const HISTORY_FILTER: &str = r#"{"lazy_load_members":true,"types":["m.room.message","m.room.encrypted"]}"#;
/// What a message this device can't decrypt says instead.
const NO_KEY: &str = "Encrypted message: this device doesn't have its key yet.";

/// The bots of the common bridges (mautrix and Beeper's), by their usual Matrix IDs: `@whatsappbot:server`.
const BRIDGE_BOTS: &[&str] = &[
    "whatsappbot", "telegrambot", "signalbot", "discordbot", "slackbot", "metabot", "facebookbot", "instagrambot", "gmessagesbot", "googlechatbot", "twitterbot", "linkedinbot", "imessagebot", "gvoicebot", "bluebubblesbot", "heisenbridge",
];

fn is_bridge_bot(user: &str) -> bool {
    let local = user.trim_start_matches('@').split(':').next().unwrap_or("");
    BRIDGE_BOTS.contains(&local)
}

/// A network's name from a bridge's protocol id, when the bridge gives no display name.
fn network_name(id: &str) -> &str {
    match id {
        "whatsapp" => "WhatsApp",
        "telegram" => "Telegram",
        "signal" => "Signal",
        "discord" => "Discord",
        "slack" => "Slack",
        "facebook" | "messenger" => "Messenger",
        "instagram" => "Instagram",
        "gmessages" => "Google Messages",
        "googlechat" => "Google Chat",
        "twitter" => "X",
        "linkedin" => "LinkedIn",
        "imessage" | "imessagego" => "iMessage",
        "irc" => "IRC",
        other => other,
    }
}

/// A sign-in to one account on one server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub homeserver: String,
    pub user: String,
    pub device: String,
    pub access: String,
    #[serde(default)]
    pub refresh: String,
    /// When the access token runs out, in seconds since 1970; 0 when it doesn't.
    #[serde(default)]
    pub expires: u64,
    /// Set when the sign-in came through the server's OAuth service, which then refreshes it.
    #[serde(default)]
    pub oauth: Option<OAuthClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthClient {
    pub client_id: String,
    pub token_endpoint: String,
}

impl Session {
    pub fn fresh(&self) -> bool {
        self.expires == 0 || self.expires > now() + 60
    }
}

/// The ways a server lets the person sign in.
#[derive(Debug, Clone, Default)]
pub struct Methods {
    pub homeserver: String,
    pub password: bool,
    pub sso: bool,
    /// The OAuth service's metadata (issuer, endpoints), when the server has one.
    pub oauth: Option<Value>,
}

impl Methods {
    pub fn to_json(&self) -> Value {
        json!({ "homeserver": self.homeserver, "password": self.password, "browser": self.oauth.is_some() || self.sso })
    }
}

#[derive(Debug, Clone, Default)]
struct Room {
    name: Option<String>,
    alias: Option<String>,
    heroes: Vec<String>,
    joined: u64,
    /// People's display names, from the membership events seen.
    names: HashMap<String, String>,
    encrypted: bool,
    /// The network a bridge carries this room from (WhatsApp, Telegram…), as the bridge names it.
    bridge: Option<String>,
    unread: u64,
    mentions: u64,
    last: u64,
}

/// One account's rooms as of its last `/sync`.
#[derive(Debug, Default)]
struct Synced {
    next: Option<String>,
    rooms: HashMap<String, Room>,
    direct: HashSet<String>,
    /// Bridge bots named by the bridges' own room state.
    bots: HashSet<String>,
}

pub struct Matrix {
    http: ureq::Agent,
    /// For `/sync`, whose first answer can take a while.
    slow: ureq::Agent,
    pending: Mutex<Option<(String, Arc<AtomicBool>)>>,
    synced: Mutex<HashMap<String, Synced>>,
    refreshing: Mutex<()>,
}

fn agent(seconds: u64) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(seconds)))
        .user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn str_at<'a>(v: &'a Value, pointer: &str) -> Option<&'a str> {
    v.pointer(pointer).and_then(Value::as_str)
}

/// A server's address with its path, each part encoded.
fn endpoint(base: &str, parts: &[&str], query: &[(&str, &str)]) -> Res<String> {
    let mut url = url::Url::parse(base).map_err(|_| "That isn't a server address.".to_owned())?;
    url.path_segments_mut().map_err(|()| "That isn't a server address.".to_owned())?.pop_if_empty().extend(parts);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url.to_string())
}

/// A plain `http://` address is only taken for this computer (a server run for testing); everything else is HTTPS.
fn allowed(base: &url::Url) -> bool {
    base.scheme() == "https" || (base.scheme() == "http" && matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}

/// What the person typed, as the server name to look up, or a server's address as it is.
pub fn server_of(input: &str) -> Res<(Option<String>, Option<String>)> {
    let input = input.trim();
    if input.is_empty() || input.len() > 300 || input.chars().any(char::is_whitespace) {
        return Err("Type your Matrix ID, like @you:matrix.org, or your server.".into());
    }
    if input.starts_with("https://") || input.starts_with("http://") {
        let url = url::Url::parse(input).map_err(|_| "That isn't a server address.".to_owned())?;
        if !allowed(&url) {
            return Err("Mobius only signs in to a Matrix server over HTTPS.".into());
        }
        return Ok((None, Some(input.trim_end_matches('/').to_owned())));
    }
    let (user, server) = match input.strip_prefix('@') {
        Some(id) => {
            let (local, server) = id.split_once(':').ok_or("A Matrix ID has its server after a colon, like @you:matrix.org.")?;
            if local.is_empty() {
                return Err("A Matrix ID has a name before its server, like @you:matrix.org.".into());
            }
            (Some(input.to_owned()), server)
        }
        None => (None, input),
    };
    if server.is_empty() || server.contains('/') {
        return Err("That isn't a Matrix server.".into());
    }
    Ok((user, Some(format!("https://{server}"))))
}

/// The Matrix error code and message of an answer, said for a person. `UNKNOWN_TOKEN` when the token is no good.
fn failed(status: u16, answer: &Value) -> String {
    let code = str_at(answer, "/errcode").unwrap_or("");
    let said = str_at(answer, "/error").unwrap_or("").chars().take(160).collect::<String>();
    match code {
        "M_UNKNOWN_TOKEN" | "M_MISSING_TOKEN" => UNKNOWN_TOKEN.into(),
        "M_LIMIT_EXCEEDED" => "The Matrix server is busy. Try again in a minute.".into(),
        "M_NOT_FOUND" => "That isn't there on the Matrix server any more.".into(),
        "M_USER_DEACTIVATED" => "That Matrix account has been deactivated.".into(),
        "M_FORBIDDEN" if !said.is_empty() => format!("The Matrix server refused: {said}"),
        _ if status == 401 => UNKNOWN_TOKEN.into(),
        _ if status == 429 => "The Matrix server is busy. Try again in a minute.".into(),
        "" => format!("The Matrix server answered {status}."),
        other => format!("The Matrix server refused ({}).", other.chars().take(60).collect::<String>()),
    }
}

fn person(user: &str, names: &HashMap<String, String>) -> String {
    names.get(user).filter(|n| !n.trim().is_empty()).cloned().unwrap_or_else(|| user.trim_start_matches('@').split(':').next().unwrap_or(user).to_owned())
}

/// The name a room shows, as the spec works it out: its name, its address, or the people in it.
fn room_name(room: &Room, me: &str) -> String {
    if let Some(n) = room.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        return n.chars().take(200).collect();
    }
    if let Some(a) = room.alias.as_deref().filter(|a| !a.is_empty()) {
        return a.to_owned();
    }
    let people: Vec<String> = room.heroes.iter().filter(|h| *h != me).map(|h| person(h, &room.names)).collect();
    let others = (room.joined as usize).saturating_sub(1).max(people.len());
    match people.as_slice() {
        [] => "Empty room".into(),
        [one] => one.clone(),
        [a, b] if others <= 2 => format!("{a} and {b}"),
        [a, rest @ ..] if others <= people.len() => format!("{} and {}", [a.as_str()].into_iter().chain(rest[..rest.len() - 1].iter().map(String::as_str)).collect::<Vec<_>>().join(", "), rest[rest.len() - 1]),
        [a, b, ..] => format!("{a}, {b} and {} others", others - 2),
    }
}

/// A Matrix message as the app shows it (`ChatMessage`); edits, reactions and anything not a message are `None`.
pub fn message_of(e: &Value, room: &str, me: &str, names: &HashMap<String, String>, in_thread: Option<&str>) -> Option<Value> {
    if str_at(e, "/type") != Some("m.room.message") {
        return None;
    }
    let id = str_at(e, "/event_id").filter(|i| !i.is_empty() && i.len() <= 255)?;
    let relation = str_at(e, "/content/m.relates_to/rel_type");
    if relation == Some("m.replace") {
        return None;
    }
    let parent = str_at(e, "/content/m.relates_to/event_id");
    // A thread's replies show in the thread, not among the room's messages.
    if relation == Some("m.thread") && in_thread.is_none() {
        return None;
    }
    let replaced = e.pointer("/unsigned/m.relations/m.replace").and_then(|r| r.pointer("/content/m.new_content").or_else(|| r.pointer("/m.new_content")));
    let content = replaced.unwrap_or_else(|| e.get("content").unwrap_or(&Value::Null));
    let body = content.get("body").and_then(Value::as_str)?;
    let mut body = body.to_owned();
    // An older client's reply quotes what it answers above a blank line.
    if e.pointer("/content/m.relates_to/m.in_reply_to").is_some() && body.starts_with("> ") {
        if let Some((_, rest)) = body.split_once("\n\n") {
            body = rest.to_owned();
        }
    }
    let sender = str_at(e, "/sender").unwrap_or("");
    let name = person(sender, names);
    let text = match content.get("msgtype").and_then(Value::as_str) {
        Some("m.emote") => format!("* {name} {body}"),
        Some("m.image") => format!("(picture) {body}"),
        Some("m.file") => format!("(file) {body}"),
        Some("m.video") => format!("(video) {body}"),
        Some("m.audio") => format!("(audio) {body}"),
        _ => body,
    };
    if text.trim().is_empty() {
        return None;
    }
    let mut author = json!({ "id": sender, "name": name });
    if !me.is_empty() && sender == me {
        author["me"] = json!(true);
    }
    let mut out = json!({ "id": id, "channel": room, "author": author, "text": text, "at": e.get("origin_server_ts").and_then(Value::as_u64).unwrap_or(0) });
    if relation == Some("m.thread")
        && let Some(p) = parent
    {
        out["thread"] = json!(p);
    }
    if let Some(n) = e.pointer("/unsigned/m.relations/m.thread/count").and_then(Value::as_u64).filter(|n| *n > 0) {
        out["replies"] = json!(n);
    }
    if replaced.is_some() {
        out["edited"] = json!(true);
    }
    Some(out)
}

impl Synced {
    /// Folds one `/sync` answer in.
    fn apply(&mut self, answer: &Value) {
        if let Some(next) = str_at(answer, "/next_batch") {
            self.next = Some(next.to_owned());
        }
        for e in answer.pointer("/account_data/events").and_then(Value::as_array).into_iter().flatten() {
            if str_at(e, "/type") == Some("m.direct") {
                self.direct = e.get("content").and_then(Value::as_object).into_iter().flatten().flat_map(|(_, rooms)| rooms.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_owned)).collect();
            }
        }
        for (id, _) in answer.pointer("/rooms/leave").and_then(Value::as_object).into_iter().flatten() {
            self.rooms.remove(id);
        }
        for (id, r) in answer.pointer("/rooms/join").and_then(Value::as_object).into_iter().flatten() {
            if !self.rooms.contains_key(id) && self.rooms.len() >= MAX_ROOMS {
                continue;
            }
            let room = self.rooms.entry(id.clone()).or_default();
            if let Some(heroes) = r.pointer("/summary/m.heroes").and_then(Value::as_array) {
                room.heroes = heroes.iter().filter_map(Value::as_str).take(5).map(str::to_owned).collect();
            }
            if let Some(n) = r.pointer("/summary/m.joined_member_count").and_then(Value::as_u64) {
                room.joined = n;
            }
            let state = r.pointer("/state/events").and_then(Value::as_array).into_iter().flatten();
            let timeline: Vec<&Value> = r.pointer("/timeline/events").and_then(Value::as_array).into_iter().flatten().collect();
            for e in state.chain(timeline.iter().copied().filter(|e| e.get("state_key").is_some())) {
                let content = e.get("content").unwrap_or(&Value::Null);
                match str_at(e, "/type") {
                    Some("m.room.name") => room.name = content.get("name").and_then(Value::as_str).map(str::to_owned),
                    Some("m.room.canonical_alias") => room.alias = content.get("alias").and_then(Value::as_str).map(str::to_owned),
                    Some("m.room.encryption") => room.encrypted = true,
                    Some("m.bridge" | "uk.half-shot.bridge") => {
                        let protocol = content.get("protocol");
                        let named = protocol.and_then(|p| p.get("displayname")).and_then(Value::as_str).or_else(|| protocol.and_then(|p| p.get("id")).and_then(Value::as_str).map(network_name));
                        if let Some(n) = named.filter(|n| !n.trim().is_empty()) {
                            room.bridge = Some(n.chars().take(40).collect());
                        }
                        if let Some(bot) = content.get("bridgebot").and_then(Value::as_str) {
                            self.bots.insert(bot.to_owned());
                        }
                    }
                    Some("m.room.member") => {
                        if let Some(user) = str_at(e, "/state_key") {
                            match content.get("displayname").and_then(Value::as_str) {
                                Some(n) if content.get("membership").and_then(Value::as_str) == Some("join") => {
                                    room.names.insert(user.to_owned(), n.chars().take(100).collect());
                                }
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
            if let Some(last) = timeline.iter().filter_map(|e| e.get("origin_server_ts").and_then(Value::as_u64)).max() {
                room.last = room.last.max(last);
            }
            if let Some(n) = r.pointer("/unread_notifications/notification_count").and_then(Value::as_u64) {
                room.unread = n;
            }
            if let Some(n) = r.pointer("/unread_notifications/highlight_count").and_then(Value::as_u64) {
                room.mentions = n;
            }
        }
    }

    /// A room with no one in it but the person and bridge bots: a bridge's management room.
    fn is_bot_room(&self, room: &Room, me: &str) -> bool {
        let others: Vec<&String> = room.heroes.iter().filter(|h| *h != me).collect();
        room.bridge.is_none() && room.joined <= 3 && !others.is_empty() && others.iter().all(|h| self.bots.contains(*h) || is_bridge_bot(h))
    }

    /// Every room as the app shows it (`ChatChannel`), the latest first.
    /// `readable`: this device can read encrypted rooms (it is verified), so they aren't marked.
    fn channels(&self, account: &str, me: &str, readable: bool) -> Vec<Value> {
        let mut rooms: Vec<(&String, &Room)> = self.rooms.iter().collect();
        rooms.sort_by(|a, b| b.1.last.cmp(&a.1.last).then_with(|| a.0.cmp(b.0)));
        rooms
            .into_iter()
            // A bridge's own room, where its bot takes commands, is the bridge's business, not a conversation.
            .filter(|(_, room)| !self.is_bot_room(room, me))
            .map(|(id, room)| {
                let named = room.name.as_deref().is_some_and(|n| !n.trim().is_empty()) || room.alias.is_some();
                let kind = if self.direct.contains(id) || (!named && room.joined <= 2) {
                    "direct"
                } else if named {
                    "channel"
                } else {
                    "group"
                };
                let mut c = json!({ "id": id, "account": account, "name": room_name(room, me), "kind": kind, "unread": room.unread, "mentions": room.mentions });
                if room.last > 0 {
                    c["last"] = json!(room.last);
                }
                if room.encrypted && !readable {
                    c["encrypted"] = json!(true);
                }
                if let Some(b) = &room.bridge {
                    c["bridge"] = json!(b);
                }
                c
            })
            .collect()
    }
}

impl Default for Matrix {
    fn default() -> Matrix {
        Matrix::new()
    }
}

impl Matrix {
    pub fn new() -> Matrix {
        Matrix { http: agent(60), slow: agent(180), pending: Mutex::new(None), synced: Mutex::default(), refreshing: Mutex::new(()) }
    }

    fn read(response: Result<ureq::http::Response<ureq::Body>, ureq::Error>, limit: u64) -> Res<(u16, Value)> {
        let response = response.map_err(|e| format!("Could not reach the Matrix server: {e}"))?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), limit + 1), &mut body).map_err(|e| format!("The Matrix server's answer did not arrive whole: {e}"))?;
        if body.len() as u64 > limit {
            return Err("The Matrix server's answer was too large to read.".into());
        }
        Ok((status, serde_json::from_slice(&body).unwrap_or(Value::Null)))
    }

    /// A JSON request; answers the JSON when the server says yes.
    pub(crate) fn call(&self, method: &str, url: &str, token: Option<&str>, body: Option<&Value>) -> Res<Value> {
        self.call_with(&self.http, method, url, token, body, MAX_JSON)
    }

    fn call_with(&self, http: &ureq::Agent, method: &str, url: &str, token: Option<&str>, body: Option<&Value>, limit: u64) -> Res<Value> {
        let auth = token.map(|t| format!("Bearer {t}"));
        let response = match method {
            "GET" => {
                let r = http.get(url);
                match &auth {
                    Some(a) => r.header("Authorization", a).call(),
                    None => r.call(),
                }
            }
            _ => {
                let r = if method == "PUT" { http.put(url) } else { http.post(url) };
                let r = r.header("Content-Type", "application/json");
                let r = match &auth {
                    Some(a) => r.header("Authorization", a),
                    None => r,
                };
                r.send(body.unwrap_or(&json!({})).to_string().as_bytes())
            }
        };
        let (status, answer) = Matrix::read(response, limit)?;
        if (200..300).contains(&status) { Ok(answer) } else { Err(failed(status, &answer)) }
    }

    /// The server's address for what the person typed, checked to be a Matrix server.
    pub fn homeserver(&self, input: &str) -> Res<String> {
        let (_, base) = server_of(input)?;
        let mut base = base.ok_or("That isn't a Matrix server.")?;
        // A server name may point to where its server really is.
        if let Ok(known) = self.call("GET", &format!("{base}/.well-known/matrix/client"), None, None)
            && let Some(found) = str_at(&known, "/m.homeserver/base_url")
            && let Ok(url) = url::Url::parse(found)
            && allowed(&url)
        {
            base = found.trim_end_matches('/').to_owned();
        }
        let versions = self.call("GET", &format!("{base}/_matrix/client/versions"), None, None).map_err(|_| "No Matrix server answered there. Check the address.".to_owned())?;
        if versions.get("versions").and_then(Value::as_array).is_none_or(Vec::is_empty) {
            return Err("No Matrix server answered there. Check the address.".into());
        }
        Ok(base)
    }

    /// How the server lets the person sign in.
    pub fn methods(&self, input: &str) -> Res<Methods> {
        let homeserver = self.homeserver(input)?;
        let flows = self.call("GET", &endpoint(&homeserver, &["_matrix", "client", "v3", "login"], &[])?, None, None).unwrap_or(Value::Null);
        let has = |kind: &str| flows.get("flows").and_then(Value::as_array).is_some_and(|f| f.iter().any(|f| str_at(f, "/type") == Some(kind)));
        let oauth = ["v1", "unstable/org.matrix.msc2965"].iter().find_map(|version| {
            let parts: Vec<&str> = ["_matrix", "client"].into_iter().chain(version.split('/')).chain(["auth_metadata"]).collect();
            let meta = self.call("GET", &endpoint(&homeserver, &parts, &[]).ok()?, None, None).ok()?;
            ["/authorization_endpoint", "/token_endpoint", "/registration_endpoint"].iter().all(|p| str_at(&meta, p).is_some()).then_some(meta)
        });
        let methods = Methods { password: has("m.login.password"), sso: has("m.login.sso"), oauth, homeserver };
        if !methods.password && !methods.sso && methods.oauth.is_none() {
            return Err("This Matrix server doesn't offer a sign-in Mobius can use.".into());
        }
        Ok(methods)
    }

    fn session_of(&self, homeserver: &str, answer: &Value, oauth: Option<OAuthClient>) -> Res<Session> {
        let access = str_at(answer, "/access_token").filter(|t| !t.is_empty()).ok_or("The Matrix server sent no sign-in.")?.to_owned();
        let (user, device) = match (str_at(answer, "/user_id"), str_at(answer, "/device_id")) {
            (Some(u), Some(d)) => (u.to_owned(), d.to_owned()),
            _ => {
                let me = self.call("GET", &endpoint(homeserver, &["_matrix", "client", "v3", "account", "whoami"], &[])?, Some(&access), None)?;
                (str_at(&me, "/user_id").ok_or("The Matrix server did not say who signed in.")?.to_owned(), str_at(&me, "/device_id").unwrap_or("").to_owned())
            }
        };
        let expires = answer.get("expires_in_ms").and_then(Value::as_u64).map(|ms| ms / 1000).or_else(|| answer.get("expires_in").and_then(Value::as_u64)).map_or(0, |s| now() + s);
        Ok(Session { homeserver: homeserver.to_owned(), user, device, access, refresh: str_at(answer, "/refresh_token").unwrap_or("").to_owned(), expires, oauth })
    }

    fn login(&self, homeserver: &str, body: Value) -> Res<Session> {
        let answer = self.call("POST", &endpoint(homeserver, &["_matrix", "client", "v3", "login"], &[])?, None, Some(&body)).map_err(|e| {
            if e.starts_with("The Matrix server refused: ") || e == UNKNOWN_TOKEN { "That username or password isn't right.".to_owned() } else { e }
        })?;
        self.session_of(homeserver, &answer, None)
    }

    /// Signs in with a username (or full Matrix ID) and password, which go only to the server.
    pub fn password_sign_in(&self, homeserver: &str, user: &str, password: &str) -> Res<Session> {
        let user = user.trim();
        if user.is_empty() || password.is_empty() {
            return Err("Type your username and password.".into());
        }
        self.login(homeserver, json!({ "type": "m.login.password", "identifier": { "type": "m.id.user", "user": user }, "password": password, "initial_device_display_name": DEVICE_NAME, "refresh_token": true }))
    }

    pub fn status(&self) -> Value {
        json!({ "pending": lock(&self.pending).as_ref().map(|(url, _)| url.clone()) })
    }

    pub fn cancel(&self) {
        if let Some((_, cancel)) = lock(&self.pending).take() {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Starts signing in on the server's own page and answers the page to open. `done` hears the sign-in, or why not.
    pub fn start(self: &Arc<Self>, methods: &Methods, done: Arc<dyn Fn(Res<Session>) + Send + Sync>) -> Res<String> {
        self.cancel();
        let callback = Callback::listen(PATH)?;
        let redirect = format!("http://127.0.0.1:{}{PATH}", callback.port());
        let state = random_text(16)?;
        let homeserver = methods.homeserver.clone();
        let (url, finish): (String, Finish) = if let Some(meta) = &methods.oauth {
            let registered = self.call("POST", str_at(meta, "/registration_endpoint").unwrap_or(""), None, Some(&json!({
                "client_name": "Mobius", "client_uri": CLIENT_URI, "redirect_uris": [redirect], "application_type": "native",
                "token_endpoint_auth_method": "none", "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            })))?;
            let client_id = str_at(&registered, "/client_id").filter(|c| !c.is_empty()).ok_or("The Matrix server did not register Mobius for the sign-in.")?.to_owned();
            let token_endpoint = str_at(meta, "/token_endpoint").unwrap_or("").to_owned();
            let verifier = random_text(32)?;
            let device = random_text(8)?;
            let mut url = url::Url::parse(str_at(meta, "/authorization_endpoint").unwrap_or("")).map_err(|_| "The Matrix server's sign-in page has no address.".to_owned())?;
            url.query_pairs_mut()
                .append_pair("response_type", "code")
                .append_pair("response_mode", "query")
                .append_pair("client_id", &client_id)
                .append_pair("redirect_uri", &redirect)
                .append_pair("scope", &format!("urn:matrix:client:api:* urn:matrix:client:device:{device}"))
                .append_pair("state", &state)
                .append_pair("code_challenge", &challenge(&verifier))
                .append_pair("code_challenge_method", "S256");
            let me = Arc::clone(self);
            let finish = move |query: &HashMap<String, String>| {
                let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("The Matrix server sent no sign-in code.")?;
                let answer = me.token_request(&token_endpoint, &form(&[("grant_type", "authorization_code"), ("code", code), ("redirect_uri", &redirect), ("client_id", &client_id), ("code_verifier", &verifier)]))?;
                me.session_of(&homeserver, &answer, Some(OAuthClient { client_id: client_id.clone(), token_endpoint: token_endpoint.clone() }))
            };
            (url.to_string(), Box::new(finish))
        } else if methods.sso {
            let back = format!("{redirect}?state={state}");
            let url = endpoint(&homeserver, &["_matrix", "client", "v3", "login", "sso", "redirect"], &[("redirectUrl", &back)])?;
            let me = Arc::clone(self);
            let finish = move |query: &HashMap<String, String>| {
                let token = query.get("loginToken").filter(|c| !c.is_empty() && c.len() <= 4096).ok_or("The Matrix server sent no sign-in.")?;
                me.login(&homeserver, json!({ "type": "m.login.token", "token": token, "initial_device_display_name": DEVICE_NAME, "refresh_token": true }))
            };
            (url, Box::new(finish))
        } else {
            return Err("This Matrix server signs in with a password: type it here.".into());
        };
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.pending) = Some((url.clone(), cancel.clone()));
        let me = Arc::clone(self);
        let mut finish = finish;
        std::thread::spawn(move || {
            let result = callback.wait("the Matrix server", &state, &cancel, MAX_WAIT, |query| finish(query));
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

    fn token_request(&self, url: &str, body: &str) -> Res<Value> {
        let response = self.http.post(url).header("Content-Type", "application/x-www-form-urlencoded").send(body.as_bytes());
        let (status, answer) = Matrix::read(response, MAX_JSON)?;
        match status {
            200 => Ok(answer),
            400 | 401 if str_at(&answer, "/error") == Some("invalid_grant") => Err(EXPIRED.into()),
            _ => Err(format!("The Matrix server refused the sign-in ({}).", str_at(&answer, "/error").unwrap_or(&status.to_string()).chars().take(60).collect::<String>())),
        }
    }

    /// A fresh sign-in for a stale one. `EXPIRED` when the server won't: the person signs in again.
    pub fn refresh(&self, session: &Session) -> Res<Session> {
        let _one_at_a_time = lock(&self.refreshing);
        if session.refresh.is_empty() {
            return Err(EXPIRED.into());
        }
        let answer = match &session.oauth {
            Some(client) => self.token_request(&client.token_endpoint, &form(&[("grant_type", "refresh_token"), ("refresh_token", &session.refresh), ("client_id", &client.client_id)]))?,
            None => self.call("POST", &endpoint(&session.homeserver, &["_matrix", "client", "v3", "refresh"], &[])?, None, Some(&json!({ "refresh_token": session.refresh }))).map_err(|e| if e == UNKNOWN_TOKEN { EXPIRED.to_owned() } else { e })?,
        };
        let access = str_at(&answer, "/access_token").filter(|t| !t.is_empty()).ok_or(EXPIRED)?.to_owned();
        let expires = answer.get("expires_in_ms").and_then(Value::as_u64).map(|ms| ms / 1000).or_else(|| answer.get("expires_in").and_then(Value::as_u64)).map_or(0, |s| now() + s);
        Ok(Session { access, refresh: str_at(&answer, "/refresh_token").map_or_else(|| session.refresh.clone(), str::to_owned), expires, ..session.clone() })
    }

    /// Whether an error means the token is no good, so a refresh may mend it.
    pub fn unknown_token(error: &str) -> bool {
        error == UNKNOWN_TOKEN
    }

    fn api(&self, s: &Session, parts: &[&str], query: &[(&str, &str)]) -> Res<String> {
        let all: Vec<&str> = ["_matrix", "client"].iter().copied().chain(parts.iter().copied()).collect();
        endpoint(&s.homeserver, &all, query)
    }

    /// The account's rooms (`ChatChannel`s), after asking the server what changed since the last look.
    pub fn channels(&self, account: &str, s: &Session, crypto: Option<&Crypto>) -> Res<Vec<Value>> {
        let since = lock(&self.synced).get(account).and_then(|x| x.next.clone());
        let mut query = vec![("filter", SYNC_FILTER), ("timeout", "0"), ("set_presence", "offline")];
        if let Some(since) = since.as_deref() {
            query.push(("since", since));
        }
        let answer = self.call_with(&self.slow, "GET", &self.api(s, &["v3", "sync"], &query)?, Some(&s.access), None, MAX_SYNC)?;
        lock(&self.synced).entry(account.to_owned()).or_default().apply(&answer);
        // Encryption that fails (a server without key upload, say) never stops the rooms being read.
        let readable = crypto.is_some_and(|c| {
            let _ = c.receive(&answer).and_then(|()| self.send_outgoing(s, c));
            c.verified()
        });
        Ok(lock(&self.synced).get(account).map(|x| x.channels(account, &s.user, readable)).unwrap_or_default())
    }

    fn known_names(&self, account: &str, room: &str) -> HashMap<String, String> {
        lock(&self.synced).get(account).and_then(|x| x.rooms.get(room)).map(|r| r.names.clone()).unwrap_or_default()
    }

    /// A room's messages, newest last: the latest, the ones before `before`, or one thread's.
    pub fn history(&self, account: &str, s: &Session, room: &str, before: Option<&str>, thread: Option<&str>, limit: usize, crypto: Option<&Crypto>) -> Res<Vec<Value>> {
        let limit = limit.clamp(1, 200).to_string();
        let mut names = self.known_names(account, room);
        let learn = |names: &mut HashMap<String, String>, state: Option<&Value>| {
            for e in state.and_then(Value::as_array).into_iter().flatten() {
                if str_at(e, "/type") == Some("m.room.member")
                    && let (Some(user), Some(name)) = (str_at(e, "/state_key"), str_at(e, "/content/displayname"))
                {
                    names.insert(user.to_owned(), name.chars().take(100).collect());
                }
            }
        };
        let mut events: Vec<Value> = if let Some(root) = thread {
            let mut query = vec![("dir", "b"), ("limit", limit.as_str())];
            let from;
            if let Some(b) = before {
                from = b.to_owned();
                query.push(("from", from.as_str()));
            }
            let answer = self.call("GET", &self.api(s, &["v1", "rooms", room, "relations", root, "m.thread"], &query)?, Some(&s.access), None)?;
            let mut chunk: Vec<Value> = answer.get("chunk").and_then(Value::as_array).cloned().unwrap_or_default();
            if before.is_none()
                && let Ok(first) = self.call("GET", &self.api(s, &["v3", "rooms", room, "event", root], &[])?, Some(&s.access), None)
            {
                chunk.push(first);
            }
            chunk
        } else {
            let from = match before {
                Some(event) => {
                    let context = self.call("GET", &self.api(s, &["v3", "rooms", room, "context", event], &[("limit", "0")])?, Some(&s.access), None)?;
                    Some(str_at(&context, "/start").ok_or("The Matrix server couldn't find where to read back from.")?.to_owned())
                }
                None => None,
            };
            let mut query = vec![("dir", "b"), ("limit", limit.as_str()), ("filter", HISTORY_FILTER)];
            if let Some(from) = from.as_deref() {
                query.push(("from", from));
            }
            let answer = self.call("GET", &self.api(s, &["v3", "rooms", room, "messages"], &query)?, Some(&s.access), None)?;
            learn(&mut names, answer.get("state"));
            answer.get("chunk").and_then(Value::as_array).cloned().unwrap_or_default()
        };
        events.reverse();
        // Encrypted messages are decrypted where this device has their key, and say so where it doesn't.
        let readable = crypto.is_some_and(Crypto::verified);
        let events = events.into_iter().filter_map(|e| {
            if str_at(&e, "/type") != Some("m.room.encrypted") {
                return Some(e);
            }
            if !readable {
                return None;
            }
            crypto.and_then(|c| c.decrypt(room, &e)).or_else(|| {
                let mut stand_in = e.clone();
                stand_in["type"] = json!("m.room.message");
                stand_in["content"] = json!({ "msgtype": "m.notice", "body": NO_KEY, "m.relates_to": e.pointer("/content/m.relates_to").cloned().unwrap_or(Value::Null) });
                Some(stand_in)
            })
        });
        Ok(events.filter_map(|e| message_of(&e, room, &s.user, &names, thread)).collect())
    }

    /// Sends what the person wrote, in the room or in a thread. Only ever called from the person's own Send.
    /// In an encrypted room it is encrypted for every device of everyone in the room, which needs this device
    /// verified (`crypto`).
    pub fn send(&self, account: &str, s: &Session, room: &str, text: &str, thread: Option<&str>, crypto: Option<&Crypto>) -> Res<Value> {
        let encrypted = lock(&self.synced).get(account).and_then(|x| x.rooms.get(room)).is_some_and(|r| r.encrypted);
        let crypto = match crypto {
            Some(c) if encrypted && c.verified() => Some(c),
            _ if encrypted => return Err("This room is encrypted. Verify this computer in Settings, Messages to write in it.".into()),
            _ => None,
        };
        let mut content = json!({ "msgtype": "m.text", "body": text });
        if let Some(root) = thread {
            content["m.relates_to"] = json!({ "rel_type": "m.thread", "event_id": root, "is_falling_back": true, "m.in_reply_to": { "event_id": root } });
        }
        let txn = random_text(12)?;
        let (kind, content) = match crypto {
            Some(c) => ("m.room.encrypted", self.encrypt_for_room(s, c, room, &content)?),
            None => ("m.room.message", content),
        };
        let answer = self.call("PUT", &self.api(s, &["v3", "rooms", room, "send", kind, &txn], &[])?, Some(&s.access), Some(&content))?;
        if let Some(c) = crypto {
            // The room key is new or was given to more devices: it goes to the key backup too. A failure here
            // leaves it for the next message; what was written is already sent.
            let _ = self.back_up(s, c);
        }
        let id = str_at(&answer, "/event_id").ok_or("The Matrix server did not say it was sent.")?;
        let names = self.known_names(account, room);
        let mut sent = json!({ "id": id, "channel": room, "author": { "id": s.user, "name": person(&s.user, &names), "me": true }, "text": text, "at": now() * 1000 });
        if let Some(root) = thread {
            sent["thread"] = json!(root);
        }
        Ok(sent)
    }

    /// Marks the room read up to a message, on every device the person uses.
    pub fn mark_read(&self, account: &str, s: &Session, room: &str, up_to: &str) -> Res<()> {
        self.call("POST", &self.api(s, &["v3", "rooms", room, "read_markers"], &[])?, Some(&s.access), Some(&json!({ "m.fully_read": up_to, "m.read": up_to })))?;
        if let Some(r) = lock(&self.synced).get_mut(account).and_then(|x| x.rooms.get_mut(room)) {
            r.unread = 0;
            r.mentions = 0;
        }
        Ok(())
    }

    /// Ends this device's sign-in on the server, and forgets the rooms read for it.
    pub fn sign_out(&self, account: &str, s: &Session) {
        lock(&self.synced).remove(account);
        self.sign_out_device(s);
    }

    /// Ends one device's sign-in on the server; nothing else is touched.
    pub fn sign_out_device(&self, s: &Session) {
        if let Ok(url) = self.api(s, &["v3", "logout"], &[]) {
            let _ = self.call("POST", &url, Some(&s.access), None);
        }
    }

    /// Forgets what was read for an account (it was signed in again).
    pub fn forget(&self, account: &str) {
        lock(&self.synced).remove(account);
    }
}

/// The encryption machine's requests, sent through this client.
impl Matrix {
    /// Sends one request the way ruma describes it, with the account's token, and reads the answer back as ruma's.
    pub(crate) fn ruma<R>(&self, s: &Session, request: R) -> Res<R::IncomingResponse>
    where
        R: ruma::api::OutgoingRequest<Authentication = ruma::api::auth_scheme::AccessToken, PathBuilder = ruma::api::path_builder::VersionHistory>,
    {
        use ruma::api::{IncomingResponseExt, OutgoingRequestExt};
        let versions = ruma::api::SupportedVersions::from_parts(&["v1.11".to_owned()], &std::collections::BTreeMap::new());
        let request: ureq::http::Request<Vec<u8>> = request
            .try_into_http_request(&s.homeserver, ruma::api::auth_scheme::SendAccessToken::IfRequired(&s.access), std::borrow::Cow::Owned(versions))
            .map_err(|e| format!("Could not ask the Matrix server: {e}"))?;
        let (status, body) = {
            let response = self.http.run(request).map_err(|e| format!("Could not reach the Matrix server: {e}"))?;
            let status = response.status().as_u16();
            let mut body = Vec::new();
            std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), MAX_SYNC + 1), &mut body).map_err(|e| format!("The Matrix server's answer did not arrive whole: {e}"))?;
            (status, body)
        };
        if !(200..300).contains(&status) {
            return Err(failed(status, &serde_json::from_slice(&body).unwrap_or(Value::Null)));
        }
        let response = ureq::http::Response::builder().status(status).body(body.as_slice()).map_err(|e| e.to_string())?;
        R::IncomingResponse::try_from_http_response(response).map_err(|e| format!("The Matrix server's answer could not be read: {e}"))
    }

    /// Sends everything the encryption machine is waiting to send: this device's keys, questions about other
    /// devices, messages to devices, and signatures.
    pub fn send_outgoing(&self, s: &Session, c: &Crypto) -> Res<()> {
        use matrix_sdk_crypto::types::requests::AnyOutgoingRequest as Out;
        use ruma::api::client::{keys, message, to_device};
        for request in c.outgoing()? {
            let id = request.request_id().to_owned();
            match request.request() {
                Out::KeysUpload(r) => c.sent(&id, &self.ruma(s, r.clone())?)?,
                Out::KeysQuery(r) => {
                    let mut q = keys::get_keys::v3::Request::new();
                    q.device_keys = r.device_keys.clone();
                    q.timeout = r.timeout;
                    c.sent(&id, &self.ruma(s, q)?)?;
                }
                Out::KeysClaim(r) => c.sent(&id, &self.ruma(s, r.clone())?)?,
                Out::ToDeviceRequest(r) => {
                    let q = to_device::send_event_to_device::v3::Request::new_raw(r.event_type.clone(), r.txn_id.clone(), r.messages.clone());
                    c.sent(&id, &self.ruma(s, q)?)?;
                }
                Out::SignatureUpload(r) => c.sent(&id, &self.ruma(s, r.clone())?)?,
                Out::RoomMessage(r) => {
                    let q = message::send_message_event::v3::Request::new(r.room_id.clone(), r.txn_id.clone(), &*r.content).map_err(|e| e.to_string())?;
                    c.sent(&id, &self.ruma(s, q)?)?;
                }
            }
        }
        Ok(())
    }

    /// Encrypts a message for a room: first making sure every device of everyone in the room has this device's room
    /// key, opening a one-to-one channel to each device that has none yet.
    fn encrypt_for_room(&self, s: &Session, c: &Crypto, room: &str, content: &Value) -> Res<Value> {
        use matrix_sdk_crypto::EncryptionSettings;
        use ruma::api::client::to_device::send_event_to_device;
        let room_id = ruma::RoomId::parse(room).map_err(|_| "That room can't be read.".to_owned())?;
        let joined = self.call("GET", &self.api(s, &["v3", "rooms", room, "joined_members"], &[])?, Some(&s.access), None)?;
        let members: Vec<ruma::OwnedUserId> = joined.get("joined").and_then(Value::as_object).into_iter().flatten().filter_map(|(u, _)| ruma::UserId::parse(u).ok()).collect();
        c.block(c.machine().update_tracked_users(members.iter().map(|u| u.as_ref()))).map_err(|e| e.to_string())?;
        // Asks which devices the members have.
        self.send_outgoing(s, c)?;
        if let Some((txn, claim)) = c.block(c.machine().get_missing_sessions(members.iter().map(|u| u.as_ref()))).map_err(|e| e.to_string())? {
            c.sent(&txn, &self.ruma(s, claim)?)?;
        }
        let shares = c.block(c.machine().share_room_key(&room_id, members.iter().map(|u| u.as_ref()), EncryptionSettings::default())).map_err(|e| format!("This room's key could not be shared: {e}"))?;
        for r in shares {
            let q = send_event_to_device::v3::Request::new_raw(r.event_type.clone(), r.txn_id.clone(), r.messages.clone());
            c.sent(&r.txn_id, &self.ruma(s, q)?)?;
        }
        c.encrypt(room, "m.room.message", content)
    }

    /// Sends room keys this device has that the key backup doesn't, when it has a key backup.
    fn back_up(&self, s: &Session, c: &Crypto) -> Res<()> {
        use ruma::api::client::backup::add_backup_keys;
        // Each round sends a batch; the loop stops when nothing is left, or after enough rounds for a long while
        // without a backup.
        for _ in 0..32 {
            let Some((txn, request)) = c.block(c.machine().backup_machine().backup()).map_err(|e| e.to_string())? else { return Ok(()) };
            let q = add_backup_keys::v3::Request::new(request.version.clone(), request.rooms.clone());
            c.sent(&txn, &self.ruma(s, q)?)?;
        }
        Ok(())
    }

    pub(crate) fn account_data(&self, s: &Session, kind: &str) -> Res<Option<Value>> {
        match self.call("GET", &self.api(s, &["v3", "user", &s.user, "account_data", kind], &[])?, Some(&s.access), None) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.starts_with("That isn't there") => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Verifies this device with the person's recovery key (or passphrase): it unlocks their secret storage, takes
    /// in their cross-signing keys and signs this device with them, then reads every room key from their key backup.
    /// Answers how many room keys came from the backup.
    pub fn recover(&self, s: &Session, c: &Crypto, input: &str) -> Res<usize> {
        use matrix_sdk_crypto::secret_storage::{AesHmacSha2EncryptedData, SecretStorageKey};
        use ruma::events::GlobalAccountDataEvent;
        use ruma::events::secret::request::SecretName;
        use ruma::events::secret_storage::key::SecretStorageKeyEventContent;
        let input = input.trim();
        if input.is_empty() {
            return Err("Type your recovery key.".into());
        }
        // This device's keys are on the server, and its own identity known, before anything is signed.
        self.send_outgoing(s, c)?;
        let default = self.account_data(s, "m.secret_storage.default_key")?.ok_or("This account has no recovery set up. Set it up in another Matrix app (such as Element) first.")?;
        let key_id = str_at(&default, "/key").ok_or("This account's recovery can't be read.")?.to_owned();
        let kind = format!("m.secret_storage.key.{key_id}");
        let description = self.account_data(s, &kind)?.ok_or("This account's recovery can't be read.")?;
        let event: GlobalAccountDataEvent<SecretStorageKeyEventContent> = serde_json::from_value(json!({ "type": kind, "content": description })).map_err(|_| "This account's recovery can't be read.".to_owned())?;
        let key = SecretStorageKey::from_account_data(input, event.content).map_err(|_| "That recovery key isn't right.".to_owned())?;
        let secret = |name: SecretName| -> Res<Option<String>> {
            let Some(stored) = self.account_data(s, name.as_str())? else { return Ok(None) };
            let Some(data) = stored.pointer(&format!("/encrypted/{key_id}")) else { return Ok(None) };
            let data: AesHmacSha2EncryptedData = serde_json::from_value(data.clone()).map_err(|_| "A secret in your recovery can't be read.".to_owned())?;
            let plain = key.decrypt(&data, &name).map_err(|_| "That recovery key isn't right.".to_owned())?;
            Ok(Some(String::from_utf8(plain).map_err(|_| "A secret in your recovery can't be read.".to_owned())?))
        };
        let export = matrix_sdk_crypto::CrossSigningKeyExport {
            master_key: secret(SecretName::CrossSigningMasterKey)?,
            self_signing_key: secret(SecretName::CrossSigningSelfSigningKey)?,
            user_signing_key: secret(SecretName::CrossSigningUserSigningKey)?,
        };
        if export.self_signing_key.is_none() {
            return Err("This account's recovery has no cross-signing keys. Set up recovery again in another Matrix app.".into());
        }
        c.import_cross_signing(export)?;
        let device = c.block(c.machine().get_device(c.machine().user_id(), c.machine().device_id(), None)).map_err(|e| e.to_string())?.ok_or("This device isn't known to the server yet. Try again in a minute.")?;
        let signatures = c.block(device.verify()).map_err(|e| format!("This device could not be signed: {e}"))?;
        self.ruma(s, signatures)?;
        // Read this device's keys back, now with the signature, so the machine knows it is verified.
        let (txn, query) = c.machine().query_keys_for_users([c.machine().user_id()]);
        let mut q = ruma::api::client::keys::get_keys::v3::Request::new();
        q.device_keys = query.device_keys;
        c.sent(&txn, &self.ruma(s, q)?)?;
        // The key backup: every room key kept on the server, readable with the backup key from secret storage.
        let Some(backup_key) = secret(SecretName::RecoveryKey).ok().flatten().or(secret(SecretName::from("m.megolm_backup.v1"))?) else { return Ok(0) };
        self.restore_backup(s, c, &backup_key)
    }

    /// Reads every room key from the key backup with its key (base64), after checking it is the server's backup's.
    /// Answers how many keys were new; no backup on the server is none.
    pub(crate) fn restore_backup(&self, s: &Session, c: &Crypto, backup_key: &str) -> Res<usize> {
        let version = match self.call("GET", &self.api(s, &["v3", "room_keys", "version"], &[])?, Some(&s.access), None) {
            Ok(v) => v,
            Err(e) if e.starts_with("That isn't there") => return Ok(0),
            Err(e) => return Err(e),
        };
        let (Some(number), Some(public)) = (str_at(&version, "/version"), str_at(&version, "/auth_data/public_key")) else { return Ok(0) };
        let decryption = c.use_backup_key(backup_key, number, public)?;
        let keys = self.call_with(&self.slow, "GET", &self.api(s, &["v3", "room_keys", "keys"], &[("version", number)])?, Some(&s.access), None, MAX_SYNC)?;
        c.import_backup(&decryption, keys.get("rooms").unwrap_or(&Value::Null))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn what_is_typed_names_a_server() {
        assert_eq!(server_of("@ana:matrix.org").unwrap(), (Some("@ana:matrix.org".into()), Some("https://matrix.org".into())));
        assert_eq!(server_of(" example.org ").unwrap(), (None, Some("https://example.org".into())));
        assert_eq!(server_of("https://matrix.example.org/").unwrap(), (None, Some("https://matrix.example.org".into())));
        assert_eq!(server_of("http://127.0.0.1:8008").unwrap().1.unwrap(), "http://127.0.0.1:8008");
        assert!(server_of("http://example.org").is_err());
        assert!(server_of("@ana").is_err());
        assert!(server_of("").is_err());
        assert!(server_of("a b").is_err());
    }

    #[test]
    fn bridged_rooms_say_their_network_and_bridge_bot_rooms_are_hidden() {
        let mut synced = Synced::default();
        let bridge = |protocol: Value, bot: &str| json!({ "type": "m.bridge", "state_key": "x", "content": { "bridgebot": bot, "protocol": protocol } });
        synced.apply(&json!({ "rooms": { "join": {
            // A WhatsApp chat carried by a bridge that names its network.
            "!wa:x": { "summary": { "m.heroes": ["@whatsapp_1555:x"], "m.joined_member_count": 3 }, "state": { "events": [bridge(json!({ "id": "whatsapp", "displayname": "WhatsApp" }), "@whatsappbot:x")] } },
            // An older bridge's event, with only the protocol id.
            "!tg:x": { "summary": { "m.joined_member_count": 5 }, "state": { "events": [{ "type": "m.room.name", "state_key": "", "content": { "name": "Climbing" } }, { "type": "uk.half-shot.bridge", "state_key": "y", "content": { "protocol": { "id": "telegram" } } }] } },
            // The bridges' own rooms: one bot named by a bridge, one known by its usual ID.
            "!wabot:x": { "summary": { "m.heroes": ["@whatsappbot:x"], "m.joined_member_count": 2 } },
            "!sigbot:x": { "summary": { "m.heroes": ["@signalbot:beeper.local"], "m.joined_member_count": 2 } },
            // A person whose name only looks like a bot's stays.
            "!abbot:x": { "summary": { "m.heroes": ["@abbot:x"], "m.joined_member_count": 2 } },
        } } }));
        let rooms = synced.channels("acc", "@me:x", true);
        let by: HashMap<&str, &Value> = rooms.iter().map(|r| (r["id"].as_str().unwrap(), r)).collect();
        assert_eq!(by.len(), 3);
        assert_eq!(by["!wa:x"]["bridge"], "WhatsApp");
        assert_eq!(by["!tg:x"]["bridge"], "Telegram");
        assert!(by["!abbot:x"].get("bridge").is_none());
    }

    #[test]
    fn a_room_is_named_by_its_name_address_or_people() {
        let names: HashMap<String, String> = [("@lee:x".to_owned(), "Lee".to_owned()), ("@sam:x".to_owned(), "Sam".to_owned())].into();
        let room = |heroes: &[&str], joined| Room { heroes: heroes.iter().map(|h| (*h).to_owned()).collect(), joined, names: names.clone(), ..Room::default() };
        assert_eq!(room_name(&Room { name: Some("Ops".into()), ..room(&[], 5) }, "@me:x"), "Ops");
        assert_eq!(room_name(&Room { alias: Some("#ops:x".into()), ..room(&[], 5) }, "@me:x"), "#ops:x");
        assert_eq!(room_name(&room(&["@lee:x"], 2), "@me:x"), "Lee");
        assert_eq!(room_name(&room(&["@lee:x", "@sam:x"], 3), "@me:x"), "Lee and Sam");
        assert_eq!(room_name(&room(&["@lee:x", "@sam:x", "@kim:x"], 4), "@me:x"), "Lee, Sam and kim");
        assert_eq!(room_name(&room(&["@lee:x", "@sam:x"], 9), "@me:x"), "Lee, Sam and 6 others");
        assert_eq!(room_name(&room(&[], 1), "@me:x"), "Empty room");
    }

    #[test]
    fn a_message_reads_as_plain_text_with_its_thread_and_edits() {
        let names: HashMap<String, String> = [("@lee:x".to_owned(), "Lee".to_owned())].into();
        let e = json!({ "type": "m.room.message", "event_id": "$1", "sender": "@lee:x", "origin_server_ts": 1000, "content": { "msgtype": "m.text", "body": "> <@me:x> earlier\n\nHello", "m.relates_to": { "m.in_reply_to": { "event_id": "$0" } } }, "unsigned": { "m.relations": { "m.thread": { "count": 2 } } } });
        assert_eq!(message_of(&e, "!r", "@me:x", &names, None).unwrap(), json!({ "id": "$1", "channel": "!r", "author": { "id": "@lee:x", "name": "Lee" }, "text": "Hello", "at": 1000, "replies": 2 }));
        let reply = json!({ "type": "m.room.message", "event_id": "$2", "sender": "@me:x", "origin_server_ts": 2000, "content": { "msgtype": "m.emote", "body": "waves", "m.relates_to": { "rel_type": "m.thread", "event_id": "$1" } } });
        assert!(message_of(&reply, "!r", "@me:x", &names, None).is_none());
        let shown = message_of(&reply, "!r", "@me:x", &names, Some("$1")).unwrap();
        assert_eq!((shown["text"].as_str(), shown["thread"].as_str(), shown["author"]["me"].as_bool()), (Some("* me waves"), Some("$1"), Some(true)));
        let edit = json!({ "type": "m.room.message", "event_id": "$3", "sender": "@lee:x", "content": { "body": "* fixed", "m.new_content": { "body": "fixed" }, "m.relates_to": { "rel_type": "m.replace", "event_id": "$1" } } });
        assert!(message_of(&edit, "!r", "", &names, None).is_none());
        let edited = json!({ "type": "m.room.message", "event_id": "$1", "sender": "@lee:x", "content": { "body": "typo" }, "unsigned": { "m.relations": { "m.replace": { "content": { "m.new_content": { "msgtype": "m.text", "body": "fixed" } } } } } });
        let edited = message_of(&edited, "!r", "", &names, None).unwrap();
        assert_eq!((edited["text"].as_str(), edited["edited"].as_bool()), (Some("fixed"), Some(true)));
        assert!(message_of(&json!({ "type": "m.reaction", "event_id": "$4" }), "!r", "", &names, None).is_none());
        let picture = json!({ "type": "m.room.message", "event_id": "$5", "sender": "@lee:x", "content": { "msgtype": "m.image", "body": "cat.png" } });
        assert_eq!(message_of(&picture, "!r", "", &names, None).unwrap()["text"], "(picture) cat.png");
    }

    /// A pretend homeserver: password and token sign-in (password `pw`, login token `the-token`), an OAuth service
    /// (code `the-code`), refresh (`refresh-1`), sync, messages, threads, send and read markers. Every request is
    /// logged as `METHOD path body`.
    pub(crate) fn server(oauth: bool) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let base = url.clone();
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
                let mut words = head.split_whitespace();
                let method = words.next().unwrap_or("").to_owned();
                let target = words.next().unwrap_or("").to_owned();
                let parsed = url::Url::parse(&format!("http://x{target}")).unwrap();
                let path = percent_encoding::percent_decode_str(parsed.path()).decode_utf8_lossy().to_string();
                let query: HashMap<String, String> = parsed.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
                let auth = head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).map(|(_, v)| v.trim().to_owned())).unwrap_or_default();
                lg.lock().unwrap().push(format!("{method} {path} {body}"));
                let json_body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let arg = |k: &str| url::form_urlencoded::parse(body.as_bytes()).find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap_or_default();
                let signed = auth.starts_with("Bearer access-") && !auth.ends_with("expired");
                let (status, answer) = match (method.as_str(), path.as_str()) {
                    ("GET", "/_matrix/client/versions") => (200, json!({ "versions": ["v1.11"] })),
                    ("GET", "/.well-known/matrix/client") => (404, json!({})),
                    ("GET", "/_matrix/client/v3/login") => (200, json!({ "flows": [{ "type": "m.login.password" }, { "type": "m.login.sso" }] })),
                    ("GET", "/_matrix/client/v1/auth_metadata") if oauth => (200, json!({ "issuer": base, "authorization_endpoint": format!("{base}/oauth/authorize"), "token_endpoint": format!("{base}/oauth/token"), "registration_endpoint": format!("{base}/oauth/register") })),
                    ("POST", "/oauth/register") if json_body["application_type"] == "native" && json_body["token_endpoint_auth_method"] == "none" => (201, json!({ "client_id": "client-1" })),
                    ("POST", "/oauth/token") => {
                        if (arg("code") == "the-code" && !arg("code_verifier").is_empty() && arg("client_id") == "client-1") || arg("refresh_token") == "refresh-1" {
                            minted += 1;
                            (200, json!({ "access_token": format!("access-{minted}"), "refresh_token": "refresh-1", "expires_in": 300 }))
                        } else {
                            (400, json!({ "error": "invalid_grant" }))
                        }
                    }
                    ("POST", "/_matrix/client/v3/login") => {
                        let ok = (json_body["type"] == "m.login.password" && json_body["password"] == "pw" && json_body["identifier"]["user"] == "ana") || (json_body["type"] == "m.login.token" && json_body["token"] == "the-token");
                        if ok {
                            minted += 1;
                            (200, json!({ "user_id": "@ana:x", "device_id": format!("DEV{minted}"), "access_token": format!("access-{minted}"), "refresh_token": "refresh-1", "expires_in_ms": 300_000 }))
                        } else {
                            (403, json!({ "errcode": "M_FORBIDDEN", "error": "Invalid username or password" }))
                        }
                    }
                    ("POST", "/_matrix/client/v3/refresh") if json_body["refresh_token"] == "refresh-1" => {
                        minted += 1;
                        (200, json!({ "access_token": format!("access-{minted}"), "expires_in_ms": 300_000 }))
                    }
                    ("POST", "/_matrix/client/v3/refresh") => (401, json!({ "errcode": "M_UNKNOWN_TOKEN", "error": "gone" })),
                    _ if !signed => (401, json!({ "errcode": "M_UNKNOWN_TOKEN", "error": "Unknown token", "soft_logout": true })),
                    ("GET", "/_matrix/client/v3/account/whoami") => (200, json!({ "user_id": "@ana:x", "device_id": "DEV2" })),
                    ("GET", "/_matrix/client/v3/sync") if !query.contains_key("since") => (200, json!({
                        "next_batch": "s1",
                        "account_data": { "events": [{ "type": "m.direct", "content": { "@lee:x": ["!dm:x"] } }] },
                        "rooms": { "join": {
                            "!ops:x": { "summary": { "m.joined_member_count": 8 }, "state": { "events": [{ "type": "m.room.name", "state_key": "", "content": { "name": "Ops" } }] }, "timeline": { "events": [{ "type": "m.room.message", "origin_server_ts": 2000, "content": {} }] }, "unread_notifications": { "notification_count": 3, "highlight_count": 1 } },
                            "!dm:x": { "summary": { "m.heroes": ["@lee:x"], "m.joined_member_count": 2 }, "state": { "events": [{ "type": "m.room.member", "state_key": "@lee:x", "content": { "membership": "join", "displayname": "Lee Park" } }, { "type": "m.room.encryption", "state_key": "", "content": { "algorithm": "m.megolm.v1.aes-sha2" } }] }, "timeline": { "events": [{ "type": "m.room.encrypted", "origin_server_ts": 3000, "content": {} }] } },
                        } },
                    })),
                    ("GET", "/_matrix/client/v3/sync") => (200, json!({ "next_batch": "s2", "rooms": { "join": { "!ops:x": { "timeline": { "events": [{ "type": "m.room.message", "origin_server_ts": 4000, "content": {} }] }, "unread_notifications": { "notification_count": 4 } } }, "leave": { "!dm:x": {} } } })),
                    ("GET", "/_matrix/client/v3/rooms/!ops:x/messages") => (200, json!({
                        "chunk": [
                            { "type": "m.room.message", "event_id": "$b", "sender": "@ana:x", "origin_server_ts": 2000, "content": { "msgtype": "m.text", "body": "On it" } },
                            { "type": "m.room.message", "event_id": "$a", "sender": "@sam:x", "origin_server_ts": 1000, "content": { "msgtype": "m.text", "body": "The build is red" }, "unsigned": { "m.relations": { "m.thread": { "count": 1 } } } },
                        ],
                        "state": [{ "type": "m.room.member", "state_key": "@sam:x", "content": { "membership": "join", "displayname": "Sam" } }],
                        "start": if query.contains_key("from") { "t1" } else { "t0" },
                    })),
                    ("GET", "/_matrix/client/v3/rooms/!ops:x/context/$b") => (200, json!({ "start": "t1" })),
                    ("GET", "/_matrix/client/v1/rooms/!ops:x/relations/$a/m.thread") => (200, json!({ "chunk": [{ "type": "m.room.message", "event_id": "$r", "sender": "@ana:x", "origin_server_ts": 1500, "content": { "body": "Looking", "m.relates_to": { "rel_type": "m.thread", "event_id": "$a" } } }] })),
                    ("GET", "/_matrix/client/v3/rooms/!ops:x/event/$a") => (200, json!({ "type": "m.room.message", "event_id": "$a", "sender": "@sam:x", "origin_server_ts": 1000, "content": { "body": "The build is red" } })),
                    ("PUT", p) if p.starts_with("/_matrix/client/v3/rooms/!ops:x/send/m.room.message/") => (200, json!({ "event_id": "$sent" })),
                    ("POST", "/_matrix/client/v3/rooms/!ops:x/read_markers") => (200, json!({})),
                    ("POST", "/_matrix/client/v3/logout") => (200, json!({})),
                    _ => (404, json!({ "errcode": "M_UNRECOGNIZED", "error": "Unrecognized request" })),
                };
                let out = answer.to_string();
                let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
            }
        });
        (url, log)
    }

    /// Signs in on the pretend server's page: the browser's visit to the one-time page with what the server sends back.
    pub(crate) fn browser_sign_in(matrix: &Arc<Matrix>, methods: &Methods) -> Res<Session> {
        let (tx, rx) = std::sync::mpsc::channel();
        let page = url::Url::parse(&matrix.start(methods, Arc::new(move |r| tx.send(r).unwrap()))?).unwrap();
        let q = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
        let back = match q("redirect_uri") {
            Some(redirect) => {
                assert_eq!(q("code_challenge_method").as_deref(), Some("S256"));
                assert!(q("scope").unwrap().starts_with("urn:matrix:client:api:* urn:matrix:client:device:"));
                format!("{redirect}?code=the-code&state={}", q("state").unwrap())
            }
            None => format!("{}&loginToken=the-token", q("redirectUrl").unwrap()),
        };
        let _ = ureq::get(&back).call();
        rx.recv_timeout(Duration::from_secs(10)).unwrap()
    }

    #[test]
    fn a_password_sign_in_lists_reads_sends_and_marks_read() {
        let (url, log) = server(false);
        let matrix = Arc::new(Matrix::new());
        let methods = matrix.methods(&url).unwrap();
        assert_eq!(methods.to_json(), json!({ "homeserver": url, "password": true, "browser": true }));
        assert_eq!(matrix.password_sign_in(&url, "ana", "wrong").unwrap_err(), "That username or password isn't right.");
        let s = matrix.password_sign_in(&url, "ana", "pw").unwrap();
        assert_eq!((s.user.as_str(), s.device.as_str(), s.refresh.as_str()), ("@ana:x", "DEV1", "refresh-1"));
        assert!(s.fresh() && s.oauth.is_none());
        let rooms = matrix.channels("acc", &s, None).unwrap();
        assert_eq!(rooms[0], json!({ "id": "!dm:x", "account": "acc", "name": "Lee Park", "kind": "direct", "unread": 0, "mentions": 0, "last": 3000, "encrypted": true }));
        assert_eq!(rooms[1], json!({ "id": "!ops:x", "account": "acc", "name": "Ops", "kind": "channel", "unread": 3, "mentions": 1, "last": 2000 }));
        // The next look asks only for what changed.
        let rooms = matrix.channels("acc", &s, None).unwrap();
        assert_eq!(rooms.len(), 1);
        assert_eq!((rooms[0]["unread"].as_u64(), rooms[0]["last"].as_u64()), (Some(4), Some(4000)));
        let history = matrix.history("acc", &s, "!ops:x", None, None, 50, None).unwrap();
        assert_eq!(history.iter().map(|m| m["text"].as_str().unwrap()).collect::<Vec<_>>(), ["The build is red", "On it"]);
        assert_eq!(history[0]["author"], json!({ "id": "@sam:x", "name": "Sam" }));
        assert_eq!(history[1]["author"]["me"], true);
        assert_eq!(matrix.history("acc", &s, "!ops:x", Some("$b"), None, 50, None).unwrap().len(), 2);
        let thread = matrix.history("acc", &s, "!ops:x", None, Some("$a"), 50, None).unwrap();
        assert_eq!(thread.iter().map(|m| m["text"].as_str().unwrap()).collect::<Vec<_>>(), ["The build is red", "Looking"]);
        let sent = matrix.send("acc", &s, "!ops:x", "Fixed & green", Some("$a"), None).unwrap();
        assert_eq!((sent["id"].as_str(), sent["thread"].as_str(), sent["author"]["me"].as_bool()), (Some("$sent"), Some("$a"), Some(true)));
        matrix.mark_read("acc", &s, "!ops:x", "$b").unwrap();
        let log = log.lock().unwrap();
        assert!(log.iter().any(|l| l.starts_with("PUT /_matrix/client/v3/rooms/!ops:x/send/m.room.message/") && l.contains("\"rel_type\":\"m.thread\"") && l.contains("Fixed & green")));
        assert!(log.iter().any(|l| l.starts_with("POST /_matrix/client/v3/rooms/!ops:x/read_markers") && l.contains("\"m.fully_read\":\"$b\"")));
        assert!(log.iter().any(|l| l.starts_with("GET /_matrix/client/v3/rooms/!ops:x/context/$b")));
    }

    #[test]
    fn an_encrypted_room_is_not_written_in_before_this_device_is_verified() {
        let (url, _) = server(false);
        let matrix = Arc::new(Matrix::new());
        let s = matrix.password_sign_in(&url, "ana", "pw").unwrap();
        matrix.channels("acc", &s, None).unwrap();
        assert!(matrix.send("acc", &s, "!dm:x", "hi", None, None).unwrap_err().starts_with("This room is encrypted."));
    }

    #[test]
    fn the_servers_own_page_signs_in_through_oauth_or_single_sign_on() {
        let (url, log) = server(true);
        let matrix = Arc::new(Matrix::new());
        let methods = matrix.methods(&url).unwrap();
        assert!(methods.oauth.is_some());
        let s = browser_sign_in(&matrix, &methods).unwrap();
        assert_eq!((s.user.as_str(), s.device.as_str()), ("@ana:x", "DEV2"));
        assert_eq!(s.oauth.as_ref().map(|o| o.client_id.as_str()), Some("client-1"));
        // An OAuth sign-in is refreshed by the OAuth service; a refused refresh means signing in again.
        assert!(matrix.refresh(&Session { expires: 1, ..s.clone() }).unwrap().access.starts_with("access-"));
        assert_eq!(matrix.refresh(&Session { refresh: "gone".into(), ..s.clone() }).unwrap_err(), EXPIRED);
        assert!(log.lock().unwrap().iter().filter(|l| l.starts_with("POST /oauth/token")).all(|l| !l.contains("client_secret")));
        // A server without OAuth sends the person to its single sign-on page.
        let (url, _) = server(false);
        let methods = matrix.methods(&url).unwrap();
        let s = browser_sign_in(&matrix, &methods).unwrap();
        assert_eq!((s.user.as_str(), s.oauth.is_none()), ("@ana:x", true));
        assert_eq!(matrix.refresh(&Session { refresh: "gone".into(), ..s }).unwrap_err(), EXPIRED);
    }

    #[test]
    fn a_token_the_server_no_longer_takes_can_be_refreshed() {
        let (url, _) = server(false);
        let matrix = Arc::new(Matrix::new());
        let s = matrix.password_sign_in(&url, "ana", "pw").unwrap();
        let stale = Session { access: "access-expired".into(), ..s };
        assert!(Matrix::unknown_token(&matrix.channels("acc", &stale, None).unwrap_err()));
        let fresh = matrix.refresh(&stale).unwrap();
        assert!(matrix.channels("acc", &fresh, None).is_ok());
    }
}
