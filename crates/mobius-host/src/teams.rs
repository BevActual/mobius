//! Microsoft Teams chats, through Microsoft Graph: the person's one-to-one, group and meeting chats, read and written
//! as them (docs/reference/messages-sign-in.md).
//!
//! - The sign-in is the same Microsoft sign-in as OneDrive's and Outlook calendars' (`onedrive::Service`, PKCE on
//!   `http://localhost`), asking for chats. Its tokens stay in the system secret store and only go to Microsoft.
//! - Graph's chat calls take work and school accounts only; a personal Microsoft account is told so at sign-in.
//! - Teams channels need an administrator's consent to read, so they are not here: only chats.
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};

use crate::dropbox::read_body;
use crate::onedrive::Account;

type Res<T> = Result<T, String>;

/// What the Teams sign-in asks Microsoft for.
pub const SCOPES: &str = "offline_access User.Read Chat.ReadWrite";
pub const NOT_SET_UP: &str = "Teams isn't set up in this build of Mobius yet.";
pub const EXPIRED: &str = "The Microsoft sign-in has ended. Sign in again in Settings, Messages.";
pub const PERSONAL: &str = "Teams chats need a work or school Microsoft account. Microsoft doesn't let apps read personal Teams chats.";
const MAX_JSON: u64 = 8 * 1024 * 1024;
const MAX_CHATS: usize = 200;
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// Who signed in, as Teams knows them: their user id and their organisation's (tenant) id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Me {
    pub user: String,
    pub tenant: String,
}

impl Me {
    /// Kept as the account's `team`, so signing in to the same account twice keeps one.
    pub fn to_team(&self) -> String {
        format!("{}|{}", self.user, self.tenant)
    }

    pub fn from_team(team: &str) -> Option<Me> {
        let (user, tenant) = team.split_once('|')?;
        Some(Me { user: user.to_owned(), tenant: tenant.to_owned() })
    }
}

pub struct Teams {
    http: ureq::Agent,
    graph: String,
}

fn ms(at: &str) -> Option<u64> {
    DateTime::parse_from_rfc3339(at).ok().and_then(|t| u64::try_from(t.timestamp_millis()).ok())
}

fn failed(status: u16, body: &[u8]) -> String {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let message = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
    match status {
        401 => EXPIRED.into(),
        403 => "Microsoft didn't allow that. Your organisation may not let apps read Teams chats.".into(),
        404 => "That chat is gone.".into(),
        429 => "Teams is busy. Try again in a minute.".into(),
        _ if message.is_empty() => format!("Teams did not answer (HTTP {status})."),
        _ => format!("Teams did not answer (HTTP {status}): {}", message.chars().take(200).collect::<String>()),
    }
}

impl Teams {
    pub fn new(graph: &str, http: ureq::Agent) -> Teams {
        Teams { http, graph: graph.trim_end_matches('/').to_owned() }
    }

    /// One Graph call with the account's token; a token Graph no longer takes is refreshed once.
    fn call(&self, account: &Account, method: &str, path: &str, body: Option<&Value>) -> Res<Value> {
        let url = format!("{}{path}", self.graph);
        let once = |token: &str| -> Res<(u16, Vec<u8>)> {
            let auth = format!("Bearer {token}");
            let response = match body {
                Some(b) => self.http.post(&url).header("Authorization", &auth).header("Content-Type", "application/json").send(b.to_string().as_bytes()),
                None if method == "GET" => self.http.get(&url).header("Authorization", &auth).call(),
                None => self.http.post(&url).header("Authorization", &auth).send_empty(),
            }
            .map_err(|e| format!("Could not reach Microsoft: {e}"))?;
            let (status, _, body) = read_body(response, MAX_JSON)?;
            Ok((status, body))
        };
        let token = |stale| account.token(stale).map_err(|e| if e == crate::onedrive::EXPIRED { EXPIRED.to_owned() } else { e });
        let (mut status, mut answer) = once(&token(false)?)?;
        if status == 401 {
            (status, answer) = once(&token(true)?)?;
        }
        if !(200..300).contains(&status) {
            return Err(failed(status, &answer));
        }
        Ok(serde_json::from_slice(&answer).unwrap_or(Value::Null))
    }

    /// Who signed in. A personal account has no organisation, and no Teams chats Graph can read.
    pub fn me(&self, account: &Account) -> Res<Me> {
        let me = self.call(account, "GET", "/me?$select=id", None)?;
        let user = me.get("id").and_then(Value::as_str).filter(|u| !u.is_empty()).ok_or("Microsoft did not say who signed in.")?.to_owned();
        let tenant = self.call(account, "GET", "/organization?$select=id", None).ok().and_then(|o| o.pointer("/value/0/id").and_then(Value::as_str).map(str::to_owned)).filter(|t| !t.is_empty()).ok_or(PERSONAL)?;
        Ok(Me { user, tenant })
    }

    /// The person's chats as the app shows them (`ChatChannel`), the latest first. A chat is unread when its last
    /// message came from someone else after the person last read it.
    pub fn channels(&self, account: &Account, id: &str, me: &Me) -> Res<Vec<Value>> {
        let mut path = "/me/chats?$expand=members,lastMessagePreview&$top=50&$orderby=lastMessagePreview/createdDateTime%20desc".to_owned();
        let mut out = Vec::new();
        while out.len() < MAX_CHATS {
            let page = self.call(account, "GET", &path, None)?;
            for chat in page.get("value").and_then(Value::as_array).into_iter().flatten() {
                if chat.pointer("/viewpoint/isHidden").and_then(Value::as_bool) == Some(true) {
                    continue;
                }
                if let Some(c) = channel_of(chat, id, me) {
                    out.push(c);
                }
            }
            match page.get("@odata.nextLink").and_then(Value::as_str).and_then(|n| n.strip_prefix(&self.graph)) {
                Some(next) => path = next.to_owned(),
                None => break,
            }
        }
        out.sort_by(|a, b| b["last"].as_u64().unwrap_or(0).cmp(&a["last"].as_u64().unwrap_or(0)));
        Ok(out)
    }

    /// A chat's messages, newest last: the latest, or the ones before `before` (a message id, which in Teams is the
    /// time it was sent, in ms).
    pub fn history(&self, account: &Account, chat: &str, before: Option<&str>, limit: usize, me: &Me) -> Res<Vec<Value>> {
        let mut path = format!("/chats/{}/messages?$top={}&$orderby=createdDateTime%20desc", utf8_percent_encode(chat, SEGMENT), limit.clamp(1, 50));
        if let Some(at) = before.and_then(|b| b.parse::<i64>().ok()).and_then(|t| Utc.timestamp_millis_opt(t).single()) {
            path.push_str(&format!("&$filter=createdDateTime%20lt%20{}", at.to_rfc3339_opts(SecondsFormat::Millis, true)));
        }
        let page = self.call(account, "GET", &path, None)?;
        let mut messages: Vec<Value> = page.get("value").and_then(Value::as_array).into_iter().flatten().filter_map(|m| message_of(m, chat, me)).collect();
        messages.reverse();
        Ok(messages)
    }

    /// Sends what the person wrote. Only ever called from the person's own Send.
    pub fn send(&self, account: &Account, chat: &str, text: &str, me: &Me) -> Res<Value> {
        let sent = self.call(account, "POST", &format!("/chats/{}/messages", utf8_percent_encode(chat, SEGMENT)), Some(&json!({ "body": { "contentType": "text", "content": text } })))?;
        let mut shown = message_of(&sent, chat, me).ok_or("Teams did not say it was sent.")?;
        shown["author"]["me"] = json!(true);
        Ok(shown)
    }

    /// Marks the chat read, on every device the person uses.
    pub fn mark_read(&self, account: &Account, chat: &str, me: &Me) -> Res<()> {
        self.call(account, "POST", &format!("/chats/{}/markChatReadForUser", utf8_percent_encode(chat, SEGMENT)), Some(&json!({ "user": { "id": me.user, "tenantId": me.tenant } }))).map(|_| ())
    }
}

/// A chat as the app shows it, named by its topic or the other people in it.
fn channel_of(chat: &Value, account: &str, me: &Me) -> Option<Value> {
    let id = chat.get("id").and_then(Value::as_str)?;
    let kind = if chat.get("chatType").and_then(Value::as_str) == Some("oneOnOne") { "direct" } else { "group" };
    let others: Vec<&str> = chat
        .get("members")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| m.get("userId").and_then(Value::as_str) != Some(me.user.as_str()))
        .filter_map(|m| m.get("displayName").and_then(Value::as_str).filter(|n| !n.trim().is_empty()))
        .collect();
    let topic = chat.get("topic").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty());
    let name = match topic {
        Some(t) => t.to_owned(),
        None if others.is_empty() => "Chat".to_owned(),
        None if others.len() <= 3 => others.join(", "),
        None => format!("{}, and {} more", others[..2].join(", "), others.len() - 2),
    };
    let preview = chat.get("lastMessagePreview");
    let last = preview.and_then(|p| p.get("createdDateTime")).and_then(Value::as_str).and_then(ms).or_else(|| chat.get("lastUpdatedDateTime").and_then(Value::as_str).and_then(ms));
    let read = chat.pointer("/viewpoint/lastMessageReadDateTime").and_then(Value::as_str).and_then(ms).unwrap_or(0);
    let from_me = preview.and_then(|p| p.pointer("/from/user/id")).and_then(Value::as_str) == Some(me.user.as_str());
    let unread = u64::from(last.is_some_and(|l| l > read) && !from_me && preview.is_some());
    let mut c = json!({ "id": id, "account": account, "name": name.chars().take(100).collect::<String>(), "kind": kind, "unread": unread, "mentions": 0 });
    if let Some(l) = last {
        c["last"] = json!(l);
    }
    Some(c)
}

/// A message as the app shows it (`ChatMessage`). System messages (someone joined, the topic changed) and deleted
/// ones are left out.
fn message_of(m: &Value, chat: &str, me: &Me) -> Option<Value> {
    if m.get("messageType").and_then(Value::as_str) != Some("message") || m.get("deletedDateTime").is_some_and(|d| !d.is_null()) {
        return None;
    }
    let id = m.get("id").and_then(Value::as_str)?;
    let at = m.get("createdDateTime").and_then(Value::as_str).and_then(ms)?;
    let user = m.pointer("/from/user");
    let author_id = user.and_then(|u| u.get("id")).and_then(Value::as_str).unwrap_or("");
    let author_name = user.and_then(|u| u.get("displayName")).and_then(Value::as_str).or_else(|| m.pointer("/from/application/displayName").and_then(Value::as_str)).unwrap_or("Someone");
    let content = m.pointer("/body/content").and_then(Value::as_str).unwrap_or("");
    let text = if m.pointer("/body/contentType").and_then(Value::as_str) == Some("html") { crate::mail::store::html_text(content) } else { content.to_owned() };
    let text = text.trim();
    let attachments = m.get("attachments").and_then(Value::as_array).map_or(0, Vec::len);
    let text = match (text.is_empty(), attachments) {
        (true, 0) => return None,
        (true, 1) => "Sent an attachment.".to_owned(),
        (true, n) => format!("Sent {n} attachments."),
        (false, _) => text.to_owned(),
    };
    let mut out = json!({ "id": id, "channel": chat, "author": { "id": author_id, "name": author_name }, "text": text, "at": at });
    if !author_id.is_empty() && author_id == me.user {
        out["author"]["me"] = json!(true);
    }
    if m.get("lastEditedDateTime").is_some_and(|e| !e.is_null()) {
        out["edited"] = json!(true);
    }
    let mut reactions: Vec<(String, u64, bool)> = Vec::new();
    for r in m.get("reactions").and_then(Value::as_array).into_iter().flatten() {
        let emoji = r.get("displayName").and_then(Value::as_str).or_else(|| r.get("reactionType").and_then(Value::as_str)).unwrap_or("").to_owned();
        if emoji.is_empty() {
            continue;
        }
        let mine = r.pointer("/user/user/id").and_then(Value::as_str) == Some(me.user.as_str());
        match reactions.iter_mut().find(|(e, _, _)| *e == emoji) {
            Some(found) => {
                found.1 += 1;
                found.2 |= mine;
            }
            None => reactions.push((emoji, 1, mine)),
        }
    }
    if !reactions.is_empty() {
        out["reactions"] = Value::Array(reactions.into_iter().map(|(emoji, count, mine)| if mine { json!({ "emoji": emoji, "count": count, "mine": true }) } else { json!({ "emoji": emoji, "count": count }) }).collect());
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn me() -> Me {
        Me { user: "u-me".into(), tenant: "t-1".into() }
    }

    #[test]
    fn a_chat_is_named_by_its_topic_or_the_others_in_it_and_unread_when_someone_else_wrote_last() {
        let member = |id: &str, name: &str| json!({ "userId": id, "displayName": name });
        let one = json!({ "id": "19:a", "chatType": "oneOnOne", "members": [member("u-me", "Ana"), member("u-lee", "Lee Park")], "lastMessagePreview": { "createdDateTime": "2026-11-19T10:00:00Z", "from": { "user": { "id": "u-lee" } } }, "viewpoint": { "lastMessageReadDateTime": "2026-11-19T09:00:00Z" } });
        let c = channel_of(&one, "acc", &me()).unwrap();
        assert_eq!(c["name"], "Lee Park");
        assert_eq!(c["kind"], "direct");
        assert_eq!(c["unread"], 1);
        assert_eq!(c["last"], 1_795_082_400_000u64);
        // Read since, or written by the person: not unread.
        let mut read = one.clone();
        read["viewpoint"]["lastMessageReadDateTime"] = json!("2026-11-19T10:00:01Z");
        assert_eq!(channel_of(&read, "acc", &me()).unwrap()["unread"], 0);
        let mut mine = one.clone();
        mine["lastMessagePreview"]["from"]["user"]["id"] = json!("u-me");
        assert_eq!(channel_of(&mine, "acc", &me()).unwrap()["unread"], 0);
        let group = json!({ "id": "19:b", "chatType": "group", "topic": " Launch ", "members": [] });
        assert_eq!(channel_of(&group, "acc", &me()).unwrap()["name"], "Launch");
        let many = json!({ "id": "19:c", "chatType": "group", "members": [member("u-me", "Ana"), member("1", "Bo"), member("2", "Cy"), member("3", "Di"), member("4", "Ed")] });
        assert_eq!(channel_of(&many, "acc", &me()).unwrap()["name"], "Bo, Cy, and 2 more");
    }

    #[test]
    fn messages_read_as_plain_text_and_system_messages_are_left_out() {
        let m = json!({ "id": "1763546400000", "messageType": "message", "createdDateTime": "2026-11-19T10:00:00Z", "from": { "user": { "id": "u-lee", "displayName": "Lee Park" } }, "body": { "contentType": "html", "content": "<p>Ship it &amp; go</p>" }, "lastEditedDateTime": "2026-11-19T10:01:00Z", "reactions": [{ "reactionType": "like", "displayName": "👍", "user": { "user": { "id": "u-me" } } }, { "reactionType": "like", "displayName": "👍", "user": { "user": { "id": "u-bo" } } }] });
        let shown = message_of(&m, "19:a", &me()).unwrap();
        assert_eq!(shown["text"], "Ship it & go");
        assert_eq!(shown["author"], json!({ "id": "u-lee", "name": "Lee Park" }));
        assert_eq!(shown["edited"], true);
        assert_eq!(shown["reactions"], json!([{ "emoji": "👍", "count": 2, "mine": true }]));
        let system = json!({ "id": "1", "messageType": "systemEventMessage", "createdDateTime": "2026-11-19T10:00:00Z" });
        assert!(message_of(&system, "19:a", &me()).is_none());
        let deleted = json!({ "id": "2", "messageType": "message", "createdDateTime": "2026-11-19T10:00:00Z", "deletedDateTime": "2026-11-19T10:02:00Z", "body": { "content": "x" } });
        assert!(message_of(&deleted, "19:a", &me()).is_none());
        let file = json!({ "id": "3", "messageType": "message", "createdDateTime": "2026-11-19T10:00:00Z", "from": { "user": { "id": "u-me", "displayName": "Ana" } }, "body": { "contentType": "html", "content": "" }, "attachments": [{}] });
        let file = message_of(&file, "19:a", &me()).unwrap();
        assert_eq!(file["text"], "Sent an attachment.");
        assert_eq!(file["author"]["me"], true);
    }

    #[test]
    fn the_account_remembers_who_signed_in() {
        assert_eq!(Me::from_team(&me().to_team()), Some(me()));
        assert_eq!(Me::from_team("nothing"), None);
    }

    /// A pretend Microsoft: the token endpoint and the Graph calls Teams uses, for one work account with one chat.
    /// `personal`: an account with no organisation. What was sent and marked read is noted in `log`.
    fn graph(personal: bool) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let log: std::sync::Arc<std::sync::Mutex<Vec<String>>> = std::sync::Arc::default();
        let noted = log.clone();
        std::thread::spawn(move || {
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
                let body: Value = serde_json::from_slice(data.get(end + 4..).unwrap_or_default()).unwrap_or(Value::Null);
                let mut words = head.split_whitespace();
                let (method, target) = (words.next().unwrap_or("").to_owned(), words.next().unwrap_or("").to_owned());
                let path = target.split('?').next().unwrap_or("").to_owned();
                let lee = json!({ "id": "1795082400000", "messageType": "message", "createdDateTime": "2026-11-19T10:00:00Z", "from": { "user": { "id": "u-lee", "displayName": "Lee Park" } }, "body": { "contentType": "html", "content": "<p>Ready?</p>" } });
                let (status, out) = match (method.as_str(), path.as_str()) {
                    ("POST", "/token") => (200, json!({ "access_token": "a1", "refresh_token": "r1", "expires_in": 3600 })),
                    ("GET", "/v1.0/me") => (200, json!({ "id": "u-me", "displayName": "Ana", "mail": "ana@example.com" })),
                    ("GET", "/v1.0/me/drive") => (404, json!({ "error": { "code": "itemNotFound" } })),
                    ("GET", "/v1.0/organization") if personal => (200, json!({ "value": [] })),
                    ("GET", "/v1.0/organization") => (200, json!({ "value": [{ "id": "t-1" }] })),
                    ("GET", "/v1.0/me/chats") => (200, json!({ "value": [
                        { "id": "19:lee", "chatType": "oneOnOne", "members": [{ "userId": "u-me", "displayName": "Ana" }, { "userId": "u-lee", "displayName": "Lee Park" }], "lastMessagePreview": { "createdDateTime": "2026-11-19T10:00:00Z", "from": { "user": { "id": "u-lee" } } }, "viewpoint": { "lastMessageReadDateTime": "2026-11-19T09:00:00Z" } },
                        { "id": "19:old", "chatType": "group", "topic": "Hidden", "viewpoint": { "isHidden": true } },
                    ] })),
                    ("GET", "/v1.0/chats/19%3Alee/messages") => {
                        let older = target.contains("createdDateTime%20lt%202026-11-19T10:00:00.000Z");
                        (200, json!({ "value": if older { vec![] } else { vec![lee.clone(), json!({ "id": "9", "messageType": "systemEventMessage", "createdDateTime": "2026-11-19T09:59:00Z" })] } }))
                    }
                    ("POST", "/v1.0/chats/19%3Alee/messages") => {
                        noted.lock().unwrap().push(format!("sent {}", body.pointer("/body/content").and_then(Value::as_str).unwrap_or("")));
                        (201, json!({ "id": "1795082460000", "messageType": "message", "createdDateTime": "2026-11-19T10:01:00Z", "from": { "user": { "id": "u-me", "displayName": "Ana" } }, "body": body["body"] }))
                    }
                    ("POST", "/v1.0/chats/19%3Alee/markChatReadForUser") => {
                        noted.lock().unwrap().push(format!("read by {} in {}", body.pointer("/user/id").and_then(Value::as_str).unwrap_or(""), body.pointer("/user/tenantId").and_then(Value::as_str).unwrap_or("")));
                        (204, Value::Null)
                    }
                    _ => (404, json!({ "error": { "code": "notFound", "message": path } })),
                };
                let out = if out.is_null() { String::new() } else { out.to_string() };
                let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
            }
        });
        (url, log)
    }

    fn accounts(url: &str) -> (std::sync::Arc<crate::messages::Accounts>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let accounts = std::sync::Arc::new(crate::messages::Accounts::new(dir.path(), std::sync::Arc::new(crate::secrets::MemorySecrets::new(true))));
        let at = crate::onedrive::Endpoints { auth: format!("{url}/authorize"), token: format!("{url}/token"), graph: format!("{url}/v1.0") };
        accounts.use_microsoft(None, at.clone());
        assert_eq!(accounts.teams_status()["hint"], NOT_SET_UP);
        accounts.use_microsoft(Some("client-id".into()), at);
        (accounts, dir)
    }

    fn sign_in(accounts: &std::sync::Arc<crate::messages::Accounts>) -> Res<Value> {
        let (tx, rx) = std::sync::mpsc::channel();
        let page = accounts.teams_sign_in(std::sync::Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        assert!(page["url"].as_str().unwrap().contains("Chat.ReadWrite"), "asks for chats");
        crate::calendar_sign_in::tests::agree(page["url"].as_str().unwrap());
        rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap()
    }

    #[test]
    fn a_work_account_reads_writes_and_marks_its_teams_chats_read() {
        let (url, log) = graph(false);
        let (accounts, _dir) = accounts(&url);
        let kept = sign_in(&accounts).unwrap();
        assert_eq!(kept["service"], "teams");
        assert_eq!(kept["name"], "ana@example.com");
        let id = kept["id"].as_str().unwrap().to_owned();
        // Signing in again keeps one account.
        assert_eq!(sign_in(&accounts).unwrap()["id"], json!(id));
        assert_eq!(accounts.list().as_array().unwrap().len(), 1);

        let chats = accounts.channels(&id).unwrap();
        assert_eq!(chats, json!([{ "id": "19:lee", "account": id, "name": "Lee Park", "kind": "direct", "unread": 1, "mentions": 0, "last": 1_795_082_400_000u64 }]));
        let history = accounts.history(&id, "19:lee", None, None, 50).unwrap();
        assert_eq!(history.as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap()).collect::<Vec<_>>(), ["Ready?"]);
        assert_eq!(accounts.history(&id, "19:lee", Some("1795082400000"), None, 50).unwrap(), json!([]));
        let sent = accounts.send(&id, "19:lee", "  Yes  ", None).unwrap();
        assert_eq!(sent["text"], "Yes");
        assert_eq!(sent["author"]["me"], true);
        accounts.mark_read(&id, "19:lee", "1795082460000").unwrap();
        assert_eq!(*log.lock().unwrap(), ["sent Yes", "read by u-me in t-1"]);
    }

    #[test]
    fn a_personal_account_is_told_teams_chats_need_a_work_account() {
        let (url, _log) = graph(true);
        let (accounts, _dir) = accounts(&url);
        assert_eq!(sign_in(&accounts).unwrap_err(), PERSONAL);
        assert_eq!(accounts.list(), json!([]));
    }
}
