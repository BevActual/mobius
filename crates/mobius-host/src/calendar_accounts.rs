//! Calendars kept somewhere else, shown in the Calendar app beside the person's own:
//!
//! - a **subscription**: a link to an `.ics` file (`webcal://` or `https://`), such as public holidays or a team's
//!   published calendar. Mobius reads it again now and then and never changes it.
//! - a **CalDAV account**: iCloud, Fastmail, Nextcloud and other servers that speak CalDAV, signed in with the account
//!   name and an app password. Mobius finds the account's calendars, mirrors their events, and sends the person's (and
//!   the agent's) changes back to the server.
//!
//! Each calendar is mirrored to a file in `calendar-accounts/<account>/` in the data folder; the passwords are kept in
//! the system's secret store. Google and Microsoft accounts need their own sign-in and come later.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mobius_workspace::calendar::{Event, Mirror, Remote, parse, write};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

const MAX_ACCOUNTS: usize = 20;
const MAX_BODY: u64 = 8 * 1024 * 1024;
/// How often calendars kept elsewhere are read again.
pub const SYNC_EVERY_MS: u64 = 15 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCalendar {
    /// Where it is on the server; for a subscription, the link.
    pub href: String,
    pub name: String,
    #[serde(default)]
    pub ctag: String,
    /// Each event's id → where it is on the server and its version there.
    #[serde(default)]
    pub items: BTreeMap<String, (String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// `subscription` or `caldav`.
    pub kind: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub calendars: Vec<RemoteCalendar>,
    #[serde(default)]
    pub last_sync_ms: u64,
    #[serde(default)]
    pub problem: Option<String>,
}

pub struct Accounts {
    file: PathBuf,
    dir: PathBuf,
    secrets: Arc<dyn Secrets>,
    state: Mutex<Vec<Account>>,
    http: ureq::Agent,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn new_id() -> String {
    let mut bytes = [0u8; 4];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn secret_name(id: &str) -> String {
    format!("calendar-account:{id}")
}

fn clean_name(name: &str) -> Option<String> {
    let name = mobius_workspace::notes::file_name_for(name.trim());
    (!name.starts_with("Untitled") || name == "Untitled").then_some(name).filter(|n| n.chars().count() <= 60)
}

/// `webcal://` is the same link over https.
fn subscription_url(text: &str) -> Res<url::Url> {
    let text = text.trim();
    let text = text.strip_prefix("webcal://").map_or_else(|| text.to_owned(), |rest| format!("https://{rest}"));
    let url = url::Url::parse(&text).map_err(|_| "That is not a link.".to_owned())?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err("A calendar link starts with https:// or webcal://.".into());
    }
    Ok(url)
}

fn server_url(text: &str) -> Res<url::Url> {
    let text = text.trim();
    let text = if text.contains("://") { text.to_owned() } else { format!("https://{text}") };
    let url = url::Url::parse(&text).map_err(|_| "That is not a server address.".to_owned())?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err("A server address starts with https://.".into());
    }
    Ok(url)
}

/// Credentials go only to the server they were given for, or another of the same site (iCloud sends people from
/// caldav.icloud.com to p01-caldav.icloud.com).
fn same_site(a: &url::Url, b: &url::Url) -> bool {
    let site = |u: &url::Url| {
        let host = u.host_str().unwrap_or("").to_ascii_lowercase();
        let parts: Vec<&str> = host.rsplitn(3, '.').collect();
        if parts.len() >= 2 { format!("{}.{}", parts[1], parts[0]) } else { host }
    };
    site(a) == site(b) && (b.scheme() == "https" || a.scheme() == b.scheme())
}

// ---- a little XML, enough for WebDAV answers ----------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
pub struct Node {
    /// The name without its namespace prefix.
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
    pub text: String,
}

impl Node {
    pub fn find(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }
    /// Every node under this one with that name, at any depth.
    pub fn all<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        for c in &self.children {
            if c.name == name {
                out.push(c);
            }
            c.all(name, out);
        }
    }
    pub fn first(&self, name: &str) -> Option<&Node> {
        let mut out = Vec::new();
        self.all(name, &mut out);
        out.into_iter().next()
    }
    pub fn text_of(&self, name: &str) -> Option<String> {
        self.first(name).map(|n| n.text.trim().to_owned())
    }
}

fn local(name: &str) -> String {
    name.rsplit(':').next().unwrap_or(name).to_owned()
}

fn entities(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|e| *e < 12) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let c = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match c {
            Some(c) => out.push(c),
            None => out.push_str(&rest[..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Reads an XML document into a tree. Comments, declarations and processing instructions are skipped.
pub fn xml(text: &str) -> Res<Node> {
    let mut stack: Vec<Node> = vec![Node::default()];
    let mut rest = text;
    while !rest.is_empty() {
        let Some(at) = rest.find('<') else {
            if let Some(top) = stack.last_mut() {
                top.text.push_str(&entities(rest));
            }
            break;
        };
        if at > 0 {
            if let Some(top) = stack.last_mut() {
                top.text.push_str(&entities(&rest[..at]));
            }
        }
        rest = &rest[at..];
        if let Some(r) = rest.strip_prefix("<![CDATA[") {
            let end = r.find("]]>").ok_or("unfinished CDATA")?;
            if let Some(top) = stack.last_mut() {
                top.text.push_str(&r[..end]);
            }
            rest = &r[end + 3..];
        } else if let Some(r) = rest.strip_prefix("<!--") {
            rest = &r[r.find("-->").ok_or("unfinished comment")? + 3..];
        } else if rest.starts_with("<?") || rest.starts_with("<!") {
            rest = &rest[rest.find('>').ok_or("unfinished declaration")? + 1..];
        } else if let Some(r) = rest.strip_prefix("</") {
            let end = r.find('>').ok_or("unfinished tag")?;
            rest = &r[end + 1..];
            let node = stack.pop().ok_or("too many closing tags")?;
            stack.last_mut().ok_or("too many closing tags")?.children.push(node);
        } else {
            let end = rest.find('>').ok_or("unfinished tag")?;
            let inner = &rest[1..end];
            rest = &rest[end + 1..];
            let closed = inner.ends_with('/');
            let inner = inner.trim_end_matches('/');
            let name_end = inner.find(char::is_whitespace).unwrap_or(inner.len());
            let mut node = Node { name: local(&inner[..name_end]), ..Node::default() };
            let mut attrs = inner[name_end..].trim();
            while let Some(eq) = attrs.find('=') {
                let key = attrs[..eq].trim().to_owned();
                let after = attrs[eq + 1..].trim_start();
                let quote = after.chars().next().filter(|c| *c == '"' || *c == '\'').ok_or("bad attribute")?;
                let close = after[1..].find(quote).ok_or("bad attribute")?;
                node.attrs.push((local(&key), entities(&after[1..=close])));
                attrs = after[close + 2..].trim_start();
            }
            if closed {
                stack.last_mut().ok_or("bad document")?.children.push(node);
            } else {
                stack.push(node);
            }
        }
    }
    if stack.len() != 1 {
        return Err("unfinished document".into());
    }
    stack.pop().and_then(|root| root.children.into_iter().next()).ok_or_else(|| "empty document".to_owned())
}

// ---- talking to servers -------------------------------------------------------------------------------------------

struct Answer {
    status: u16,
    etag: Option<String>,
    location: Option<String>,
    body: String,
}

impl Accounts {
    pub fn new(data_dir: &Path, secrets: Arc<dyn Secrets>) -> Accounts {
        let file = data_dir.join("calendar-accounts.json");
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Vec<Account>>(&t).ok()).unwrap_or_default();
        let http = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .allow_non_standard_methods(true)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(60)))
            .user_agent("Mobius")
            .build()
            .into();
        Accounts { file, dir: data_dir.join("calendar-accounts"), secrets, state: Mutex::new(state), http }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Account>> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn save(&self, accounts: &[Account]) {
        if let Ok(text) = serde_json::to_string_pretty(accounts) {
            let _ = std::fs::create_dir_all(self.file.parent().unwrap_or(Path::new(".")));
            let _ = std::fs::write(&self.file, text);
        }
    }

    fn mirror_file(&self, account: &str, index: usize) -> PathBuf {
        self.dir.join(account).join(format!("{index}.ics"))
    }

    /// One request, following up to five redirects. Credentials go only to the same site.
    fn request(&self, method: &str, url: &url::Url, auth: Option<(&str, &str)>, headers: &[(&str, &str)], body: Option<&str>) -> Res<Answer> {
        let mut at = url.clone();
        for _ in 0..6 {
            let mut builder = ureq::http::Request::builder().method(method).uri(at.as_str());
            if let Some((user, password)) = auth.filter(|_| same_site(url, &at)) {
                use base64::Engine;
                builder = builder.header("Authorization", format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"))));
            }
            for (k, v) in headers {
                builder = builder.header(*k, *v);
            }
            let request = builder.body(body.unwrap_or("").to_owned()).map_err(|e| e.to_string())?;
            let mut response = self.http.run(request).map_err(|e| format!("Could not reach {}: {e}", at.host_str().unwrap_or("the server")))?;
            let status = response.status().as_u16();
            let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
            let (etag, location) = (header("etag"), header("location"));
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                let next = location.as_deref().and_then(|l| at.join(l).ok()).ok_or("The server sent Mobius somewhere it could not follow.")?;
                if !matches!(next.scheme(), "https" | "http") {
                    return Err("The server sent Mobius somewhere it could not follow.".into());
                }
                at = next;
                continue;
            }
            let body = response.body_mut().with_config().limit(MAX_BODY).read_to_string().map_err(|e| e.to_string())?;
            return Ok(Answer { status, etag, location, body });
        }
        Err("The server sent Mobius round in circles.".into())
    }

    fn dav(&self, method: &str, url: &url::Url, auth: (&str, &str), depth: &str, body: &str) -> Res<Node> {
        let answer = self.request(method, url, Some(auth), &[("Depth", depth), ("Content-Type", "application/xml; charset=utf-8")], Some(body))?;
        match answer.status {
            207 | 200 => xml(&answer.body),
            401 | 403 => Err("The server did not accept that name and password. iCloud and Fastmail need an app password, made in the account's security settings.".into()),
            404 => Err("The server has no calendars at that address.".into()),
            s => Err(format!("The server answered {s}.")),
        }
    }

    // ---- what the window asks for ----

    pub fn list(&self) -> Value {
        json!(self.lock().iter().map(|a| json!({
            "id": a.id, "kind": a.kind, "name": a.name, "url": a.url, "username": a.username,
            "calendars": a.calendars.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
            "lastSyncMs": a.last_sync_ms, "problem": a.problem,
        })).collect::<Vec<_>>())
    }

    /// The calendars to show, named so none hides another: a clash with one of the person's own calendars (or with
    /// another account's) adds the account's name.
    pub fn mirrors(&self, local: &[String]) -> Vec<Mirror> {
        let mut taken: Vec<String> = local.iter().map(|n| n.to_lowercase()).collect();
        let mut out = Vec::new();
        for a in self.lock().iter() {
            for (i, c) in a.calendars.iter().enumerate() {
                let mut name = c.name.clone();
                if taken.contains(&name.to_lowercase()) {
                    name = format!("{} ({})", c.name, a.name);
                }
                let mut n = 2;
                while taken.contains(&name.to_lowercase()) {
                    name = format!("{} ({}) {n}", c.name, a.name);
                    n += 1;
                }
                taken.push(name.to_lowercase());
                out.push(Mirror { name, file: self.mirror_file(&a.id, i), account: a.name.clone(), writable: a.kind == "caldav" });
            }
        }
        out
    }

    pub fn subscribe(&self, name: &str, link: &str) -> Res<Value> {
        let url = subscription_url(link)?;
        let name = clean_name(name).or_else(|| url.host_str().map(str::to_owned)).ok_or("A subscription needs a name.")?;
        if self.lock().len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} calendar accounts."));
        }
        let mut account = Account { id: new_id(), kind: "subscription".into(), name: name.clone(), url: url.to_string(), username: String::new(), calendars: vec![RemoteCalendar { href: url.to_string(), name, ctag: String::new(), items: BTreeMap::new() }], last_sync_ms: 0, problem: None };
        // Read once now, so a wrong link is said at once rather than later.
        self.sync_subscription(&mut account)?;
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!({ "id": account.id, "name": account.name }))
    }

    /// Finds the account's calendars and mirrors them. The password is kept only once it worked.
    pub fn connect(&self, name: &str, server: &str, username: &str, password: &str) -> Res<Value> {
        let base = server_url(server)?;
        let username = username.trim();
        if username.is_empty() || password.is_empty() {
            return Err("CalDAV needs the account name and an app password.".into());
        }
        if self.lock().len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} calendar accounts."));
        }
        let calendars = self.discover(&base, (username, password))?;
        if calendars.is_empty() {
            return Err("That account has no calendars Mobius can show.".into());
        }
        let name = clean_name(name).or_else(|| base.host_str().map(str::to_owned)).unwrap_or_else(|| "CalDAV".into());
        let mut account = Account { id: new_id(), kind: "caldav".into(), name, url: base.to_string(), username: username.to_owned(), calendars, last_sync_ms: 0, problem: None };
        if !self.secrets.put(&secret_name(&account.id), password) {
            return Err("The password could not be kept in this computer's secret store.".into());
        }
        if let Err(e) = self.sync_caldav(&mut account, password) {
            self.secrets.delete(&secret_name(&account.id));
            return Err(e);
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(json!({ "id": account.id, "name": account.name, "calendars": account.calendars.iter().map(|c| c.name.clone()).collect::<Vec<_>>() }))
    }

    pub fn remove(&self, id: &str) -> Res<Value> {
        let mut all = self.lock();
        let before = all.len();
        all.retain(|a| a.id != id);
        if all.len() == before {
            return Err("That account is gone.".into());
        }
        self.save(&all);
        drop(all);
        self.secrets.delete(&secret_name(id));
        if id.len() == 8 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
            let _ = std::fs::remove_dir_all(self.dir.join(id));
        }
        Ok(json!({ "ok": true }))
    }

    /// Reads one account again (or every one), now. Problems are kept on the account to show, not returned.
    pub fn sync(&self, only: Option<&str>) -> bool {
        let accounts: Vec<Account> = self.lock().iter().filter(|a| only.is_none_or(|id| a.id == id)).cloned().collect();
        let mut changed = false;
        for mut account in accounts {
            let before = account.calendars.clone();
            let result = if account.kind == "caldav" {
                match self.secrets.get(&secret_name(&account.id)) {
                    Some(password) => self.sync_caldav(&mut account, &password),
                    None => Err("The password for this account is missing. Remove it and connect it again.".into()),
                }
            } else {
                self.sync_subscription(&mut account)
            };
            account.problem = result.err();
            account.last_sync_ms = now_ms();
            changed |= account.calendars != before;
            let mut all = self.lock();
            if let Some(slot) = all.iter_mut().find(|a| a.id == account.id) {
                *slot = account;
            }
            self.save(&all);
        }
        changed
    }

    /// Accounts not read for a while are read again. True when anything changed.
    pub fn sync_due(&self) -> bool {
        let due: Vec<String> = self.lock().iter().filter(|a| now_ms().saturating_sub(a.last_sync_ms) >= SYNC_EVERY_MS).map(|a| a.id.clone()).collect();
        let mut changed = false;
        for id in &due {
            changed |= self.sync(Some(id));
        }
        changed
    }

    fn sync_subscription(&self, account: &mut Account) -> Res<()> {
        let url = subscription_url(&account.url)?;
        let answer = self.request("GET", &url, None, &[("Accept", "text/calendar")], None)?;
        if answer.status != 200 {
            return Err(format!("The calendar link answered {}.", answer.status));
        }
        if !answer.body.trim_start_matches('\u{feff}').trim_start().to_ascii_uppercase().starts_with("BEGIN:VCALENDAR") {
            return Err("That link is not a calendar (.ics) file.".into());
        }
        let (events, _) = parse(&answer.body);
        let file = self.mirror_file(&account.id, 0);
        std::fs::create_dir_all(file.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
        std::fs::write(&file, write(&account.name, &events, &[])).map_err(|e| e.to_string())?;
        if let Some(c) = account.calendars.first_mut() {
            c.ctag = answer.etag.unwrap_or_default();
        }
        Ok(())
    }

    /// The account's calendars that hold events: principal → calendar home → calendars.
    fn discover(&self, base: &url::Url, auth: (&str, &str)) -> Res<Vec<RemoteCalendar>> {
        const PRINCIPAL: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;
        const HOME: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>"#;
        const LIST: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/></d:prop></d:propfind>"#;
        let principal_href = |doc: &Node| doc.first("current-user-principal").and_then(|p| p.text_of("href"));
        let principal = match self.dav("PROPFIND", base, auth, "0", PRINCIPAL).ok().and_then(|d| principal_href(&d)) {
            Some(p) => p,
            None => {
                let known = base.join("/.well-known/caldav").map_err(|e| e.to_string())?;
                principal_href(&self.dav("PROPFIND", &known, auth, "0", PRINCIPAL)?).ok_or("That server did not say where the account's calendars are.")?
            }
        };
        let principal = base.join(&principal).map_err(|e| e.to_string())?;
        let home = self.dav("PROPFIND", &principal, auth, "0", HOME)?.first("calendar-home-set").and_then(|h| h.text_of("href")).ok_or("That server did not say where the account's calendars are.")?;
        let home = principal.join(&home).map_err(|e| e.to_string())?;
        let list = self.dav("PROPFIND", &home, auth, "1", LIST)?;
        let mut responses = Vec::new();
        list.all("response", &mut responses);
        let mut out = Vec::new();
        for r in responses {
            let is_calendar = r.first("resourcetype").is_some_and(|t| t.find("calendar").is_some());
            let comps: Vec<String> = {
                let mut found = Vec::new();
                r.all("comp", &mut found);
                found.iter().filter_map(|c| c.attrs.iter().find(|(k, _)| k == "name").map(|(_, v)| v.to_ascii_uppercase())).collect()
            };
            if !is_calendar || !(comps.is_empty() || comps.iter().any(|c| c == "VEVENT")) {
                continue;
            }
            let Some(href) = r.text_of("href") else { continue };
            let href = home.join(&href).map_err(|e| e.to_string())?.to_string();
            let name = r.text_of("displayname").filter(|n| !n.is_empty()).unwrap_or_else(|| href.trim_end_matches('/').rsplit('/').next().unwrap_or("Calendar").to_owned());
            out.push(RemoteCalendar { href, name: clean_name(&name).unwrap_or_else(|| "Calendar".into()), ctag: String::new(), items: BTreeMap::new() });
        }
        Ok(out)
    }

    /// Mirrors each calendar's events from a year back to two years ahead, skipping calendars that have not changed.
    fn sync_caldav(&self, account: &mut Account, password: &str) -> Res<()> {
        const CTAG: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:getctag/></d:prop></d:propfind>"#;
        let auth = (account.username.as_str(), password);
        let today = chrono::Utc::now().date_naive();
        let (from, to) = (today - chrono::Duration::days(365), today + chrono::Duration::days(730));
        let query = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="{}T000000Z" end="{}T000000Z"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"#,
            from.format("%Y%m%d"),
            to.format("%Y%m%d")
        );
        let id = account.id.clone();
        for (i, cal) in account.calendars.iter_mut().enumerate() {
            let url = url::Url::parse(&cal.href).map_err(|e| e.to_string())?;
            let file = self.mirror_file(&id, i);
            let ctag = self.dav("PROPFIND", &url, auth, "0", CTAG).ok().and_then(|d| d.text_of("getctag")).unwrap_or_default();
            if !ctag.is_empty() && ctag == cal.ctag && file.exists() {
                continue;
            }
            let doc = self.dav("REPORT", &url, auth, "1", &query)?;
            let mut responses = Vec::new();
            doc.all("response", &mut responses);
            let mut events = Vec::new();
            let mut items = BTreeMap::new();
            for r in responses {
                let (Some(href), Some(data)) = (r.text_of("href"), r.text_of("calendar-data")) else { continue };
                let etag = r.text_of("getetag").unwrap_or_default();
                let (found, _) = parse(&data);
                if let Some(first) = found.first() {
                    items.insert(first.uid.clone(), (href, etag));
                }
                events.extend(found);
            }
            std::fs::create_dir_all(file.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
            std::fs::write(&file, write(&cal.name, &events, &[])).map_err(|e| e.to_string())?;
            cal.items = items;
            cal.ctag = ctag;
        }
        Ok(())
    }

    /// The account and calendar a mirror file belongs to.
    fn owner(&self, mirror: &Mirror) -> Option<(Account, usize)> {
        self.lock().iter().find_map(|a| (0..a.calendars.len()).find(|i| self.mirror_file(&a.id, *i) == mirror.file).map(|i| (a.clone(), i)))
    }

    fn remember(&self, account: &str, index: usize, uid: &str, item: Option<(String, String)>) {
        let mut all = self.lock();
        if let Some(cal) = all.iter_mut().find(|a| a.id == account).and_then(|a| a.calendars.get_mut(index)) {
            match item {
                Some(item) => cal.items.insert(uid.to_owned(), item),
                None => cal.items.remove(uid),
            };
            // The calendar changed: read it fully next time.
            cal.ctag.clear();
        }
        self.save(&all);
    }
}

impl Remote for Accounts {
    fn put(&self, mirror: &Mirror, uid: &str, parts: &[Event], new: bool) -> Res<()> {
        let (account, index) = self.owner(mirror).ok_or("that calendar's account is gone")?;
        let password = self.secrets.get(&secret_name(&account.id)).ok_or("The password for this account is missing.")?;
        let cal = &account.calendars[index];
        let base = url::Url::parse(&cal.href).map_err(|e| e.to_string())?;
        let known = cal.items.get(uid).cloned();
        let href = match &known {
            Some((href, _)) => href.clone(),
            None => {
                let safe: String = uid.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '-' }).collect();
                format!("{}/{safe}.ics", base.path().trim_end_matches('/'))
            }
        };
        let url = base.join(&href).map_err(|e| e.to_string())?;
        let body = write(&mirror.name, parts, &[]);
        let mut headers = vec![("Content-Type", "text/calendar; charset=utf-8")];
        let if_match;
        match (&known, new) {
            (Some((_, etag)), _) if !etag.is_empty() => {
                if_match = etag.clone();
                headers.push(("If-Match", if_match.as_str()));
            }
            (None, true) => headers.push(("If-None-Match", "*")),
            _ => {}
        }
        let answer = self.request("PUT", &url, Some((&account.username, &password)), &headers, Some(&body))?;
        match answer.status {
            200 | 201 | 204 => {
                let href = answer.location.and_then(|l| url.join(&l).ok()).map_or_else(|| url.path().to_owned(), |u| u.path().to_owned());
                self.remember(&account.id, index, uid, Some((href, answer.etag.unwrap_or_default())));
                Ok(())
            }
            412 => Err("That event was changed on the server meanwhile. Refresh the calendar and try again.".into()),
            401 | 403 => Err("The server did not let Mobius change that calendar.".into()),
            s => Err(format!("The server answered {s}.")),
        }
    }

    fn delete(&self, mirror: &Mirror, uid: &str) -> Res<()> {
        let (account, index) = self.owner(mirror).ok_or("that calendar's account is gone")?;
        let password = self.secrets.get(&secret_name(&account.id)).ok_or("The password for this account is missing.")?;
        let cal = &account.calendars[index];
        let Some((href, etag)) = cal.items.get(uid).cloned() else { return Err("Refresh the calendar first: Mobius does not know where that event is on the server.".into()) };
        let url = url::Url::parse(&cal.href).and_then(|b| b.join(&href)).map_err(|e| e.to_string())?;
        let headers: Vec<(&str, &str)> = if etag.is_empty() { vec![] } else { vec![("If-Match", etag.as_str())] };
        let answer = self.request("DELETE", &url, Some((&account.username, &password)), &headers, None)?;
        match answer.status {
            200 | 204 | 404 => {
                self.remember(&account.id, index, uid, None);
                Ok(())
            }
            412 => Err("That event was changed on the server meanwhile. Refresh the calendar and try again.".into()),
            s => Err(format!("The server answered {s}.")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use std::io::{BufRead, BufReader, Read, Write};

    #[test]
    fn webdav_answers_are_read_with_any_prefixes() {
        let doc = xml(r#"<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/cal/work/</D:href><D:propstat><D:prop><D:displayname>Work &amp; play</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><C:calendar-data><![CDATA[BEGIN:VCALENDAR]]></C:calendar-data></D:prop></D:propstat></D:response><!-- note --></D:multistatus>"#).unwrap();
        assert_eq!(doc.name, "multistatus");
        assert_eq!(doc.text_of("displayname").as_deref(), Some("Work & play"));
        assert!(doc.first("resourcetype").unwrap().find("calendar").is_some());
        assert_eq!(doc.text_of("calendar-data").as_deref(), Some("BEGIN:VCALENDAR"));
        assert!(xml("<a><b></a>").is_err());
    }

    #[test]
    fn links_and_sites_are_checked() {
        assert_eq!(subscription_url("webcal://example.com/h.ics").unwrap().as_str(), "https://example.com/h.ics");
        assert!(subscription_url("file:///etc/passwd").is_err());
        assert!(subscription_url("nonsense").is_err());
        let a = url::Url::parse("https://caldav.icloud.com/").unwrap();
        assert!(same_site(&a, &url::Url::parse("https://p01-caldav.icloud.com/1/").unwrap()));
        assert!(!same_site(&a, &url::Url::parse("https://evil.example/").unwrap()));
        assert!(!same_site(&a, &url::Url::parse("http://p01-caldav.icloud.com/").unwrap()), "not over plain http");
    }

    type Shared<T> = Arc<Mutex<T>>;

    /// A small CalDAV server: one principal, one home, one calendar, and the events PUT to it.
    fn server() -> (String, Shared<BTreeMap<String, String>>, Shared<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let store: Arc<Mutex<BTreeMap<String, String>>> = Arc::default();
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        store.lock().unwrap().insert("/cal/work/a.ics".into(), "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T090000\r\nDTEND:20261110T100000\r\nSUMMARY:Kickoff\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n".into());
        let (s, l) = (store.clone(), log.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
                let (mut length, mut auth, mut if_match) = (0, String::new(), String::new());
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    match k.to_ascii_lowercase().as_str() {
                        "content-length" => length = v.trim().parse().unwrap(),
                        "authorization" => auth = v.trim().to_owned(),
                        "if-match" => if_match = v.trim().to_owned(),
                        _ => {}
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                l.lock().unwrap().push(format!("{method} {path} {if_match}"));
                let ok_auth = auth == format!("Basic {}", { use base64::Engine; base64::engine::general_purpose::STANDARD.encode("ana:app-pass") });
                let ms = |inner: String| format!(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">{inner}</d:multistatus>"#);
                let (status, extra, reply) = if !ok_auth {
                    ("401 Unauthorized", String::new(), String::new())
                } else {
                    match (method.as_str(), path.as_str()) {
                        ("PROPFIND", "/") => ("301 Moved", "Location: /dav/\r\n".into(), String::new()),
                        ("PROPFIND", "/dav/") => ("207 Multi-Status", String::new(), ms("<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principals/ana/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>".into())),
                        ("PROPFIND", "/principals/ana/") => ("207 Multi-Status", String::new(), ms("<d:response><d:href>/principals/ana/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/cal/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>".into())),
                        ("PROPFIND", "/cal/") => ("207 Multi-Status", String::new(), ms(r#"<d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/cal/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response><d:response><d:href>/cal/todo/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>"#.into())),
                        ("PROPFIND", "/cal/work/") => ("207 Multi-Status", String::new(), ms(format!("<d:response><d:href>/cal/work/</d:href><d:propstat><d:prop><cs:getctag>{}</cs:getctag></d:prop></d:propstat></d:response>", s.lock().unwrap().len()))),
                        ("REPORT", "/cal/work/") => {
                            let items: String = s.lock().unwrap().iter().map(|(h, d)| format!("<d:response><d:href>{h}</d:href><d:propstat><d:prop><d:getetag>\"{}\"</d:getetag><c:calendar-data>{}</c:calendar-data></d:prop></d:propstat></d:response>", d.len(), d.replace('&', "&amp;").replace('<', "&lt;"))).collect();
                            ("207 Multi-Status", String::new(), ms(items))
                        }
                        ("PUT", p) => {
                            let mut st = s.lock().unwrap();
                            if !if_match.is_empty() && st.get(p).map(|d| format!("\"{}\"", d.len())) != Some(if_match.clone()) {
                                ("412 Precondition Failed", String::new(), String::new())
                            } else {
                                let text = String::from_utf8(body).unwrap();
                                let tag = format!("ETag: \"{}\"\r\n", text.len());
                                st.insert(p.to_owned(), text);
                                ("201 Created", tag, String::new())
                            }
                        }
                        ("DELETE", p) => {
                            s.lock().unwrap().remove(p);
                            ("204 No Content", String::new(), String::new())
                        }
                        _ => ("404 Not Found", String::new(), String::new()),
                    }
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        (base, store, log)
    }

    #[test]
    fn a_caldav_account_is_found_mirrored_and_changed_on_its_server() {
        let (base, store, log) = server();
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MemorySecrets::new(true));
        let accounts = Arc::new(Accounts::new(dir.path(), secrets.clone()));
        assert!(accounts.connect("Mine", &base, "ana", "wrong").unwrap_err().contains("app password"));
        let made = accounts.connect("Mine", &base, "ana", "app-pass").unwrap();
        assert_eq!(made["calendars"], json!(["Work"]), "the to-do list is left out");
        let mirrors = accounts.mirrors(&["Calendar".into(), "Work".into()]);
        assert_eq!(mirrors.len(), 1);
        assert_eq!((mirrors[0].name.as_str(), mirrors[0].writable), ("Work (Mine)", true), "no clash with the person's own Work");

        let cal = mobius_workspace::calendar::Calendar::new(dir.path().join("ws"), dir.path().join("cp"));
        cal.set_mirrors(mirrors);
        cal.set_remote(accounts.clone());
        let found = cal.events("2026-11-10", "2026-11-10").unwrap();
        assert_eq!(found[0]["title"], "Kickoff");
        cal.update("Work (Mine)", "a", &mobius_workspace::calendar::Draft { title: Some("Project kickoff".into()), ..Default::default() }).unwrap();
        assert!(store.lock().unwrap()["/cal/work/a.ics"].contains("SUMMARY:Project kickoff"));
        let added = cal.add("Work (Mine)", &mobius_workspace::calendar::Draft { title: Some("Retro".into()), start: Some("2026-11-12T16:00".into()), ..Default::default() }).unwrap();
        let uid = added["id"].as_str().unwrap().to_owned();
        assert!(store.lock().unwrap().values().any(|d| d.contains("SUMMARY:Retro")));
        cal.remove("Work (Mine)", &uid).unwrap();
        assert!(!store.lock().unwrap().values().any(|d| d.contains("SUMMARY:Retro")));
        assert!(log.lock().unwrap().iter().any(|l| l.starts_with("PUT /cal/work/a.ics \"")), "the change said which version it replaced");

        // Changed elsewhere: Mobius's version is out of date, so the server refuses and nothing is lost.
        store.lock().unwrap().insert("/cal/work/a.ics".into(), "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T090000\r\nDTEND:20261110T100000\r\nSUMMARY:Changed on the phone\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n".into());
        assert!(cal.update("Work (Mine)", "a", &mobius_workspace::calendar::Draft { title: Some("Mine".into()), ..Default::default() }).unwrap_err().contains("meanwhile"));
        assert!(accounts.sync(None));
        assert_eq!(cal.events("2026-11-10", "2026-11-10").unwrap()[0]["title"], "Changed on the phone");

        let id = accounts.list()[0]["id"].as_str().unwrap().to_owned();
        accounts.remove(&id).unwrap();
        assert!(secrets.get(&secret_name(&id)).is_none());
        assert!(!dir.path().join("calendar-accounts").join(&id).exists());
    }

    #[test]
    fn a_subscription_is_read_and_a_link_that_is_not_a_calendar_is_refused() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut line = String::new();
                BufReader::new(stream.try_clone().unwrap()).read_line(&mut line).unwrap();
                let body = if line.contains("/holidays.ics") { "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:t\r\nDTSTART;VALUE=DATE:20261126\r\nSUMMARY:Thanksgiving\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n" } else { "<html>nope</html>" };
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        assert!(accounts.subscribe("Bad", &format!("{base}/page.html")).unwrap_err().contains("not a calendar"));
        accounts.subscribe("US Holidays", &format!("{base}/holidays.ics")).unwrap();
        let mirrors = accounts.mirrors(&["Calendar".into()]);
        assert_eq!((mirrors[0].name.as_str(), mirrors[0].writable), ("US Holidays", false));
        assert!(std::fs::read_to_string(&mirrors[0].file).unwrap().contains("SUMMARY:Thanksgiving"));
        // Kept across a restart.
        let again = Accounts::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        assert_eq!(again.list()[0]["name"], "US Holidays");
    }
}
