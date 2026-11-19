//! Telegram, signed in as the person's own account (docs/reference/messages-sign-in.md): their chats, groups and
//! channels, read and written as them. It speaks Telegram's own protocol (MTProto) through `grammers`, pure Rust.
//!
//! - Signing in takes the phone number, then the code Telegram sends to the person's other Telegram apps (or by SMS),
//!   then their two-step verification password if they set one. Telegram can't make new accounts from other apps.
//! - What the sign-in leaves (the account's home data centre and its authorisation key) is kept in the system secret
//!   store, never in a file. Removing the account signs this device out of Telegram.
//! - Telegram needs an app id and hash (from my.telegram.org), built in as `MOBIUS_TELEGRAM_API_ID` and
//!   `MOBIUS_TELEGRAM_API_HASH`. Until they are, Telegram says it isn't set up in this build.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::peer::Peer;
use grammers_client::session::storages::{MemorySession, MemorySessionError};
use grammers_client::session::types::{DcOption, PeerId, PeerInfo, UpdateState, UpdatesState};
use grammers_client::session::{BoxFuture, Session, SessionData};
use grammers_client::{Client, InvocationError, SenderPool, SignInError, tl};
use serde_json::{Value, json};

type Res<T> = Result<T, String>;

pub const NOT_SET_UP: &str = "Telegram isn't set up in this build of Mobius yet.";
pub const EXPIRED: &str = "Telegram signed this device out. Sign in again in Settings, Messages.";
const MAX_DIALOGS: usize = 150;

/// The app id and hash built into this copy of Mobius, if any.
pub fn built_in() -> Option<(i32, String)> {
    let id = option_env!("MOBIUS_TELEGRAM_API_ID")?.trim().parse().ok()?;
    let hash = option_env!("MOBIUS_TELEGRAM_API_HASH")?.trim();
    (!hash.is_empty()).then(|| (id, hash.to_owned()))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A session kept in memory whose sign-in part (home data centre, and each data centre's address and key) is noted
/// as it changes, so it can be put in the secret store. Peers and update state are read again each time.
#[derive(Default)]
pub struct Kept {
    inner: MemorySession,
    home: Mutex<Option<i32>>,
    dcs: Mutex<HashMap<i32, DcOption>>,
    changed: std::sync::atomic::AtomicBool,
}

impl Kept {
    /// What to keep, as JSON.
    pub fn to_json(&self) -> Value {
        let mut dcs: Vec<&DcOption> = Vec::new();
        let all = lock(&self.dcs);
        dcs.extend(all.values());
        dcs.sort_by_key(|d| d.id);
        json!({ "home": *lock(&self.home), "dcs": dcs })
    }

    /// A session from what was kept. Nothing readable gives a fresh one.
    pub fn from_json(kept: &Value) -> Kept {
        let dcs: Vec<DcOption> = kept.get("dcs").and_then(|d| serde_json::from_value(d.clone()).ok()).unwrap_or_default();
        let home = kept.get("home").and_then(Value::as_i64).and_then(|h| i32::try_from(h).ok());
        let mut data = SessionData::default();
        if let Some(h) = home {
            data.home_dc = h;
        }
        for d in &dcs {
            data.dc_options.insert(d.id, d.clone());
        }
        Kept { inner: MemorySession::from(data), home: Mutex::new(home), dcs: Mutex::new(dcs.into_iter().map(|d| (d.id, d)).collect()), changed: std::sync::atomic::AtomicBool::new(false) }
    }

    /// Whether the sign-in part changed since the last call.
    pub fn take_changed(&self) -> bool {
        self.changed.swap(false, std::sync::atomic::Ordering::SeqCst)
    }
}

impl Session for Kept {
    type Error = MemorySessionError;

    fn home_dc_id(&self) -> Result<i32, MemorySessionError> {
        self.inner.home_dc_id()
    }

    fn set_home_dc_id(&self, dc_id: i32) -> BoxFuture<'_, Result<(), MemorySessionError>> {
        *lock(&self.home) = Some(dc_id);
        self.changed.store(true, std::sync::atomic::Ordering::SeqCst);
        self.inner.set_home_dc_id(dc_id)
    }

    fn dc_option(&self, dc_id: i32) -> Result<Option<DcOption>, MemorySessionError> {
        self.inner.dc_option(dc_id)
    }

    fn set_dc_option(&self, dc_option: &DcOption) -> BoxFuture<'_, Result<(), MemorySessionError>> {
        lock(&self.dcs).insert(dc_option.id, dc_option.clone());
        self.changed.store(true, std::sync::atomic::Ordering::SeqCst);
        self.inner.set_dc_option(dc_option)
    }

    fn peer(&self, peer: PeerId) -> BoxFuture<'_, Result<Option<PeerInfo>, MemorySessionError>> {
        self.inner.peer(peer)
    }

    fn cache_peer(&self, peer: PeerInfo) -> BoxFuture<'_, Result<(), MemorySessionError>> {
        self.inner.cache_peer(peer)
    }

    fn updates_state(&self) -> BoxFuture<'_, Result<UpdatesState, MemorySessionError>> {
        self.inner.updates_state()
    }

    fn set_update_state(&self, update: UpdateState) -> BoxFuture<'_, Result<(), MemorySessionError>> {
        self.inner.set_update_state(update)
    }
}

/// One signed-in (or signing-in) connection to Telegram, and the session under it.
struct Live {
    client: Client,
    session: Arc<Kept>,
}

/// Where a sign-in is: waiting for the code, or for the two-step verification password.
enum Step {
    Code { phone: String, token: LoginToken },
    Password(PasswordToken),
}

/// A finished sign-in: what to keep, and who signed in.
pub struct SignedIn {
    pub kept: Value,
    pub user: i64,
    pub name: String,
}

/// What a sign-in step answered: the next step, or done.
pub enum Next {
    Code,
    Password { hint: Option<String> },
    Done(SignedIn),
}

pub struct Telegram {
    keys: Option<(i32, String)>,
    rt: tokio::runtime::Runtime,
    live: Mutex<HashMap<String, Arc<Live>>>,
    signing_in: Mutex<Option<(Arc<Live>, Step)>>,
}

/// An error from Telegram, in the person's words. A signed-out device is `EXPIRED`.
fn said(e: &InvocationError) -> String {
    match e {
        InvocationError::Rpc(r) if ["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "SESSION_EXPIRED", "USER_DEACTIVATED", "AUTH_KEY_INVALID"].contains(&r.name.as_str()) => EXPIRED.into(),
        InvocationError::Rpc(r) if r.name == "FLOOD_WAIT" => format!("Telegram asks to wait {} seconds before trying again.", r.value.unwrap_or(60)),
        InvocationError::Rpc(r) if r.name == "PHONE_NUMBER_INVALID" => "That phone number isn't right. Include the country code, like +44.".into(),
        InvocationError::Rpc(r) if r.name == "PHONE_NUMBER_BANNED" => "Telegram has banned that phone number.".into(),
        InvocationError::Rpc(r) if r.name == "PEER_ID_INVALID" || r.name == "CHANNEL_PRIVATE" => "That chat can't be reached anymore.".into(),
        InvocationError::Rpc(r) if r.name == "CHAT_WRITE_FORBIDDEN" => "You can't write in that chat.".into(),
        InvocationError::Rpc(r) => format!("Telegram refused: {}.", r.name),
        other => format!("Could not reach Telegram: {other}"),
    }
}

/// How a chat is shown: a person, a group or a channel.
pub fn kind_of(peer: &Peer) -> &'static str {
    match peer {
        Peer::User(_) => "direct",
        Peer::Group(_) | Peer::Community(_) => "group",
        Peer::Channel(_) => "channel",
    }
}

/// A chat as the app shows it (`ChatChannel`).
pub fn channel(account: &str, id: i64, name: &str, kind: &str, unread: i64, mentions: i64, last_ms: Option<i64>) -> Value {
    let name = Some(name.trim()).filter(|n| !n.is_empty()).unwrap_or("Deleted account");
    let mut c = json!({ "id": id.to_string(), "account": account, "name": name.chars().take(100).collect::<String>(), "kind": kind, "unread": unread.max(0), "mentions": mentions.max(0) });
    if let Some(l) = last_ms.filter(|l| *l > 0) {
        c["last"] = json!(l);
    }
    c
}

/// What a message with no text says instead, by what it carries.
pub fn placeholder(has_media: bool, is_service: bool) -> Option<&'static str> {
    match (has_media, is_service) {
        (_, true) => None,
        (true, false) => Some("Sent a photo, file or sticker."),
        (false, false) => None,
    }
}

impl Telegram {
    pub fn new(keys: Option<(i32, String)>) -> Res<Telegram> {
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().thread_name("telegram").build().map_err(|e| e.to_string())?;
        Ok(Telegram { keys, rt, live: Mutex::default(), signing_in: Mutex::default() })
    }

    pub fn set_up(&self) -> bool {
        self.keys.is_some()
    }

    fn keys(&self) -> Res<&(i32, String)> {
        self.keys.as_ref().ok_or_else(|| NOT_SET_UP.to_owned())
    }

    fn connect(&self, session: Arc<Kept>) -> Res<Arc<Live>> {
        let (api_id, _) = self.keys()?;
        let params = grammers_client::sender::ConnectionParams { device_model: "Mobius".into(), app_version: env!("CARGO_PKG_VERSION").into(), ..Default::default() };
        let _inside = self.rt.enter();
        let pool = SenderPool::with_configuration(Arc::clone(&session), *api_id, params);
        let client = Client::new(pool.handle);
        self.rt.spawn(pool.runner.run());
        drop(pool.updates);
        Ok(Arc::new(Live { client, session }))
    }

    /// Starts signing in: Telegram sends a code to the person's other Telegram apps, or by SMS.
    pub fn start(&self, phone: &str) -> Res<Next> {
        let phone: String = phone.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
        if phone.trim_start_matches('+').len() < 6 {
            return Err("Type your phone number with its country code, like +44 7700 900123.".into());
        }
        let (_, hash) = self.keys()?.clone();
        let live = self.connect(Arc::new(Kept::default()))?;
        let token = self.rt.block_on(live.client.request_login_code(&phone, &hash)).map_err(|e| said(&e))?;
        *lock(&self.signing_in) = Some((live, Step::Code { phone, token }));
        Ok(Next::Code)
    }

    /// The code the person was sent.
    pub fn code(&self, code: &str) -> Res<Next> {
        let (live, step) = lock(&self.signing_in).take().ok_or("Start signing in to Telegram again.")?;
        let Step::Code { phone, token } = step else { return Err("Start signing in to Telegram again.".into()) };
        let code: String = code.chars().filter(char::is_ascii_digit).collect();
        match self.rt.block_on(live.client.sign_in(&token, &code)) {
            Ok(user) => Ok(Next::Done(Self::signed_in(&live, user.id().bare_id_unchecked(), &user.full_name()))),
            Err(SignInError::PasswordRequired(password)) => {
                let hint = password.hint().map(str::to_owned);
                *lock(&self.signing_in) = Some((live, Step::Password(password)));
                Ok(Next::Password { hint })
            }
            Err(SignInError::InvalidCode) => {
                *lock(&self.signing_in) = Some((live, Step::Code { phone, token }));
                Err("That code isn't right. Check it and try again.".into())
            }
            Err(SignInError::SignUpRequired) => Err("There's no Telegram account for that number. Make one in Telegram's own app first.".into()),
            Err(SignInError::Other(e)) => Err(said(&e)),
            Err(e) => Err(format!("Telegram refused the sign-in: {e}")),
        }
    }

    /// The two-step verification password, which goes only to Telegram and is not kept.
    pub fn password(&self, password: &str) -> Res<Next> {
        let (live, step) = lock(&self.signing_in).take().ok_or("Start signing in to Telegram again.")?;
        let Step::Password(token) = step else { return Err("Start signing in to Telegram again.".into()) };
        match self.rt.block_on(live.client.check_password(token, password.as_bytes())) {
            Ok(user) => Ok(Next::Done(Self::signed_in(&live, user.id().bare_id_unchecked(), &user.full_name()))),
            Err(SignInError::InvalidPassword(token)) => {
                *lock(&self.signing_in) = Some((live, Step::Password(token)));
                Err("That password isn't right.".into())
            }
            Err(SignInError::Other(e)) => Err(said(&e)),
            Err(e) => Err(format!("Telegram refused the sign-in: {e}")),
        }
    }

    pub fn cancel(&self) {
        if let Some((live, _)) = lock(&self.signing_in).take() {
            live.client.disconnect();
        }
    }

    pub fn signing_in(&self) -> bool {
        lock(&self.signing_in).is_some()
    }

    fn signed_in(live: &Live, user: i64, name: &str) -> SignedIn {
        live.session.take_changed();
        SignedIn { kept: live.session.to_json(), user, name: name.trim().chars().take(60).collect() }
    }

    /// Opens a signed-in account from what was kept, once; `keep` hears what to keep when the sign-in part changes.
    fn open(&self, account: &str, kept: &Value) -> Res<Arc<Live>> {
        if let Some(live) = lock(&self.live).get(account) {
            return Ok(Arc::clone(live));
        }
        let live = self.connect(Arc::new(Kept::from_json(kept)))?;
        lock(&self.live).insert(account.to_owned(), Arc::clone(&live));
        Ok(live)
    }

    /// Runs `f` on the account's connection. Answers what to keep too when the sign-in part changed.
    fn with<T>(&self, account: &str, kept: &Value, f: impl AsyncFnOnce(&Client, &Kept) -> Result<T, InvocationError>) -> Res<(T, Option<Value>)> {
        let live = self.open(account, kept)?;
        let result = self.rt.block_on(f(&live.client, &live.session)).map_err(|e| said(&e));
        if result.as_ref().is_err_and(|e| e == EXPIRED) {
            self.forget(account);
        }
        let changed = live.session.take_changed().then(|| live.session.to_json());
        result.map(|t| (t, changed))
    }

    /// The account's chats, the latest first.
    pub fn channels(&self, account: &str, kept: &Value) -> Res<(Vec<Value>, Option<Value>)> {
        self.with(account, kept, async |client, _session| {
            let mut out = Vec::new();
            let mut dialogs = client.iter_dialogs();
            while out.len() < MAX_DIALOGS {
                let Some(d) = dialogs.next().await? else { break };
                let (unread, mentions) = match &d.raw {
                    tl::enums::Dialog::Dialog(raw) => (i64::from(raw.unread_count), i64::from(raw.unread_mentions_count)),
                    _ => (0, 0),
                };
                let name = match d.peer() {
                    Peer::User(u) if u.is_self() => "Saved Messages".to_owned(),
                    p => p.name().unwrap_or("").to_owned(),
                };
                let last = d.last_message.as_ref().map(|m| m.date().as_millisecond());
                out.push(channel(account, d.peer_id().bot_api_dialog_id_unchecked(), &name, kind_of(d.peer()), unread, mentions, last));
            }
            Ok(out)
        })
    }

    /// A chat's messages, newest last: the latest, or the ones before `before`.
    pub fn history(&self, account: &str, kept: &Value, chat: &str, before: Option<&str>, limit: usize, me: i64) -> Res<(Vec<Value>, Option<Value>)> {
        let peer = peer_of(chat)?;
        let before = before.and_then(|b| b.parse::<i32>().ok());
        self.with(account, kept, async |client, session| {
            let Some(target) = find(client, session, peer).await? else { return Ok(Vec::new()) };
            let mut messages = client.iter_messages(target).limit(limit.clamp(1, 100));
            if let Some(b) = before {
                messages = messages.offset_id(b);
            }
            let mut out = Vec::new();
            while let Some(m) = messages.next().await? {
                let text = m.text().trim().to_owned();
                let text = if text.is_empty() { placeholder(m.media().is_some(), m.action().is_some()).map(str::to_owned) } else { Some(text) };
                let Some(text) = text else { continue };
                let author_id = m.sender_id().map_or(0, |s| s.bot_api_dialog_id_unchecked());
                let author = m.sender().and_then(|s| s.name()).map(str::to_owned).unwrap_or_else(|| m.peer().and_then(|p| p.name()).unwrap_or("Someone").to_owned());
                let mut v = json!({ "id": m.id().to_string(), "channel": chat, "author": { "id": author_id.to_string(), "name": author }, "text": text, "at": m.date().as_millisecond() });
                if m.outgoing() || author_id == me {
                    v["author"]["me"] = json!(true);
                }
                if m.edit_date().is_some() {
                    v["edited"] = json!(true);
                }
                out.push(v);
            }
            out.reverse();
            Ok(out)
        })
    }

    /// Sends what the person wrote. Only ever called from the person's own Send.
    pub fn send(&self, account: &str, kept: &Value, chat: &str, text: &str, me: i64, my_name: &str) -> Res<(Value, Option<Value>)> {
        let peer = peer_of(chat)?;
        let text = text.to_owned();
        let (sent, changed) = self.with(account, kept, async |client, session| {
            let Some(target) = find(client, session, peer).await? else { return Ok(None) };
            client.send_message(target, text.as_str()).await.map(Some)
        })?;
        let sent = sent.ok_or("That chat can't be reached anymore.")?;
        let v = json!({ "id": sent.id().to_string(), "channel": chat, "author": { "id": me.to_string(), "name": my_name, "me": true }, "text": sent.text(), "at": sent.date().as_millisecond() });
        Ok((v, changed))
    }

    /// Marks the chat read, on every device the person uses.
    pub fn mark_read(&self, account: &str, kept: &Value, chat: &str) -> Res<Option<Value>> {
        let peer = peer_of(chat)?;
        self.with(account, kept, async |client, session| {
            if let Some(target) = find(client, session, peer).await? {
                client.mark_as_read(target).await?;
            }
            Ok(())
        })
        .map(|((), changed)| changed)
    }

    /// Signs this device out of Telegram, and closes its connection.
    pub fn sign_out(&self, account: &str, kept: &Value) {
        let live = self.open(account, kept);
        if let Ok(live) = live {
            let _ = self.rt.block_on(live.client.sign_out());
            live.client.disconnect();
        }
        lock(&self.live).remove(account);
    }

    /// Closes the account's connection (it was signed out elsewhere, or signed in again).
    pub fn forget(&self, account: &str) {
        if let Some(live) = lock(&self.live).remove(account) {
            live.client.disconnect();
        }
    }
}

fn peer_of(chat: &str) -> Res<PeerId> {
    chat.parse::<i64>().ok().and_then(PeerId::from_bot_api_dialog_id).ok_or_else(|| "That chat can't be read.".to_owned())
}

/// A chat to talk to, from the session's knowledge of it; the chats are read once if this run hasn't seen it yet.
async fn find(client: &Client, session: &Kept, peer: PeerId) -> Result<Option<grammers_client::session::types::PeerRef>, InvocationError> {
    if let Some(found) = session.peer_ref(peer).await.map_err(|e| InvocationError::Session(Box::new(e)))? {
        return Ok(Some(found));
    }
    let mut dialogs = client.iter_dialogs();
    let mut seen = 0;
    while let Some(d) = dialogs.next().await? {
        if d.peer_id() == peer {
            return Ok(Some(d.peer_ref()));
        }
        seen += 1;
        if seen >= MAX_DIALOGS * 2 {
            break;
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sign_in_part_of_a_session_is_kept_and_read_back() {
        let kept = Kept::default();
        assert!(!kept.take_changed());
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let mut dc = SessionData::default().dc_options[&2].clone();
        dc.auth_key = Some([7u8; 256]);
        rt.block_on(kept.set_dc_option(&dc)).unwrap();
        rt.block_on(kept.set_home_dc_id(2)).unwrap();
        assert!(kept.take_changed());
        let json = kept.to_json();
        assert_eq!(json["home"], 2);
        let back = Kept::from_json(&json);
        assert_eq!(back.home_dc_id().unwrap(), 2);
        assert_eq!(back.dc_option(2).unwrap().unwrap().auth_key, Some([7u8; 256]));
        // Nothing kept: a fresh session that knows Telegram's data centres.
        let fresh = Kept::from_json(&Value::Null);
        assert!(fresh.dc_option(1).unwrap().is_some());
    }

    #[test]
    fn a_chat_is_shown_with_its_name_kind_and_unread_counts() {
        assert_eq!(channel("acc", -100123, " Climbing ", "group", 3, 1, Some(5)), json!({ "id": "-100123", "account": "acc", "name": "Climbing", "kind": "group", "unread": 3, "mentions": 1, "last": 5 }));
        assert_eq!(channel("acc", 42, "", "direct", -1, 0, None)["name"], "Deleted account");
        assert_eq!(channel("acc", 42, "", "direct", -1, 0, None)["unread"], 0);
        assert!(peer_of("-100123").is_ok());
        assert!(peer_of("nope").is_err());
        assert_eq!(placeholder(true, false), Some("Sent a photo, file or sticker."));
        assert_eq!(placeholder(false, true), None);
    }

    #[test]
    fn without_built_in_keys_telegram_is_not_set_up() {
        let t = Telegram::new(None).unwrap();
        assert!(!t.set_up());
        assert_eq!(t.start("+447700900123").err().unwrap(), NOT_SET_UP);
    }

    #[test]
    fn messages_says_telegram_is_not_set_up_until_the_keys_are_built_in() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = crate::messages::Accounts::new(dir.path(), Arc::new(crate::secrets::MemorySecrets::new(true)));
        accounts.use_telegram(Telegram::new(None).unwrap());
        assert_eq!(accounts.telegram_status(), json!({ "setUp": false, "pending": false, "hint": NOT_SET_UP }));
        assert_eq!(accounts.telegram_sign_in("phone", "+447700900123").unwrap_err(), NOT_SET_UP);
        assert_eq!(accounts.telegram_sign_in("code", "12345").unwrap_err(), NOT_SET_UP);
        assert_eq!(accounts.list(), json!([]));
    }
}
