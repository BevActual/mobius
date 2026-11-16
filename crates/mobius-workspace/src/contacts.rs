//! Contacts: an address book in the workspace, one vCard file per person under `<workspace>/contacts/<book>/`, so
//! checkpoints, Keep, Rewind and folder sync cover them like any other file, and a CardDAV account can mirror a book.
//! Mail and Calendar show them (names as you address someone, a person card from a sender or an attendee), and the
//! agent can look people up ("email Priya the deck"). There is no People app.
//!
//! Every field Mobius doesn't show (photos, addresses, a server's own fields) is kept exactly as it was: a save only
//! rewrites the lines of the fields it changes. Every change is checked against the version the window or the agent
//! last saw, so a change made elsewhere is never overwritten, and a checkpoint is taken before the agent changes a book.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use serde_json::{Value, json};

use crate::calendar::{escape, fold, split_line, unescape, unfold};
use crate::checkpoints::Checkpoints;
use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "contacts";
pub const DEFAULT_BOOK: &str = "Contacts";
const MAX_FILE: u64 = 1024 * 1024;
const MAX_FIELD: usize = 2000;
const MAX_NOTE: usize = 10_000;
const MAX_VALUES: usize = 20;
const MAX_BOOKS: usize = 50;
const MAX_CONTACTS: usize = 20_000;
const MAX_RESULTS: usize = 200;

/// One person, as Mobius shows them. `id` is the file's name in its book, without `.vcf`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Contact {
    pub book: String,
    pub id: String,
    pub name: String,
    pub emails: Vec<Labelled>,
    pub phones: Vec<Labelled>,
    pub org: String,
    pub title: String,
    pub note: String,
    /// `YYYY-MM-DD`, or `--MM-DD` with no year.
    pub birthday: String,
    /// A fingerprint of the file, sent back with a change so one made elsewhere since is never overwritten.
    pub version: String,
}

/// An email address or a phone number, with its kind (`work`, `home`, `cell`) when the card gives one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Labelled {
    pub value: String,
    pub label: String,
}

impl Contact {
    pub fn to_json(&self) -> Value {
        let list = |v: &[Labelled]| v.iter().map(|l| json!({ "value": l.value, "label": l.label })).collect::<Vec<_>>();
        json!({ "book": self.book, "id": self.id, "name": self.name, "emails": list(&self.emails), "phones": list(&self.phones), "org": self.org, "title": self.title, "note": self.note, "birthday": self.birthday, "version": self.version })
    }
}

/// What a save sets. A field left out stays as it is.
#[derive(Debug, Default, Clone)]
pub struct Draft {
    pub name: Option<String>,
    pub emails: Option<Vec<Labelled>>,
    pub phones: Option<Vec<Labelled>>,
    pub org: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub birthday: Option<String>,
}

impl Draft {
    /// From the window's or the agent's JSON. Emails and phones are a list of texts or of `{ value, label }`.
    pub fn from_json(v: &Value) -> Res<Draft> {
        let text = |k: &str, max: usize| -> Res<Option<String>> {
            match v.get(k) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) if s.chars().count() <= max => Ok(Some(s.trim().to_owned())),
                Some(Value::String(_)) => Err(format!("{k} is too long")),
                Some(_) => Err(format!("{k} must be text")),
            }
        };
        let many = |k: &str| -> Res<Option<Vec<Labelled>>> {
            let Some(list) = v.get(k).filter(|l| !l.is_null()) else { return Ok(None) };
            let list = list.as_array().ok_or_else(|| format!("{k} must be a list"))?;
            if list.len() > MAX_VALUES {
                return Err(format!("at most {MAX_VALUES} {k}"));
            }
            let mut out = Vec::new();
            for item in list {
                let (value, label) = match item {
                    Value::String(s) => (s.as_str(), ""),
                    Value::Object(o) => (o.get("value").and_then(Value::as_str).unwrap_or(""), o.get("label").and_then(Value::as_str).unwrap_or("")),
                    _ => return Err(format!("{k} must be texts")),
                };
                let (value, label) = (value.trim(), label.trim());
                if value.len() > MAX_FIELD || label.len() > 40 || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    return Err(format!("one of the {k} is not right"));
                }
                if !value.is_empty() {
                    out.push(Labelled { value: value.to_owned(), label: label.to_ascii_lowercase() });
                }
            }
            Ok(Some(out))
        };
        let draft = Draft { name: text("name", MAX_FIELD)?, emails: many("emails")?, phones: many("phones")?, org: text("org", MAX_FIELD)?, title: text("title", MAX_FIELD)?, note: text("note", MAX_NOTE)?, birthday: text("birthday", 10)? };
        if let Some(emails) = &draft.emails
            && let Some(bad) = emails.iter().find(|e| !looks_like_email(&e.value))
        {
            return Err(format!("{} is not an email address", bad.value));
        }
        if let Some(b) = draft.birthday.as_deref().filter(|b| !b.is_empty() && !is_birthday(b)) {
            return Err(format!("a birthday is written YYYY-MM-DD or --MM-DD, not {b}"));
        }
        Ok(draft)
    }
}

fn looks_like_email(s: &str) -> bool {
    let Some((user, host)) = s.rsplit_once('@') else { return false };
    !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.') && !s.chars().any(|c| c.is_whitespace() || c == '<' || c == '>' || c == ',')
}

fn is_birthday(s: &str) -> bool {
    let digits = |t: &str| t.bytes().all(|b| b.is_ascii_digit());
    match s.len() {
        10 => digits(&s[..4]) && &s[4..5] == "-" && digits(&s[5..7]) && &s[7..8] == "-" && digits(&s[8..]),
        7 => s.starts_with("--") && digits(&s[2..4]) && &s[4..5] == "-" && digits(&s[5..]),
        _ => false,
    }
}

// ---- reading and writing vCard ---------------------------------------------------------------------------------------

/// The property's name without its group (`item1.EMAIL` is `EMAIL`).
fn base_name(name: &str) -> &str {
    name.rsplit('.').next().unwrap_or(name)
}

fn label_of(params: &[(String, String)]) -> String {
    // TYPE=work,pref or TYPE=WORK;TYPE=VOICE: the first kind that isn't a preference or a technical one.
    params
        .iter()
        .filter(|(k, _)| k == "TYPE")
        .flat_map(|(_, v)| v.split(','))
        .map(|t| t.trim().to_ascii_lowercase())
        .find(|t| !matches!(t.as_str(), "pref" | "internet" | "voice" | "x400" | ""))
        .unwrap_or_default()
}

/// A text value split on its unescaped `;` (the parts of N and ORG).
fn components(value: &str) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut escaped = false;
    for c in value.chars() {
        let last = parts.len() - 1;
        if escaped {
            parts[last].push('\\');
            parts[last].push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == ';' {
            parts.push(String::new());
        } else {
            parts[last].push(c);
        }
    }
    parts.into_iter().map(|p| unescape(&p)).collect()
}

/// Reads a vCard. `None` when the text has no card in it.
pub fn parse(text: &str, book: &str, id: &str) -> Option<Contact> {
    let lines = unfold(text);
    if !lines.iter().any(|l| l.eq_ignore_ascii_case("BEGIN:VCARD")) {
        return None;
    }
    let mut c = Contact { book: book.to_owned(), id: id.to_owned(), version: version_of(text), ..Contact::default() };
    let mut structured = String::new();
    for line in &lines {
        let Some((name, params, value)) = split_line(line) else { continue };
        match base_name(&name) {
            "FN" => c.name = unescape(value.trim()),
            "N" => {
                // Family; Given; Additional; Prefix; Suffix.
                let p = components(&value);
                let part = |i: usize| p.get(i).map(|s| s.trim()).unwrap_or("");
                structured = [part(3), part(1), part(2), part(0), part(4)].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" ");
            }
            "EMAIL" if c.emails.len() < MAX_VALUES => c.emails.push(Labelled { value: unescape(value.trim()), label: label_of(&params) }),
            "TEL" if c.phones.len() < MAX_VALUES => c.phones.push(Labelled { value: unescape(value.trim().trim_start_matches("tel:")), label: label_of(&params) }),
            "ORG" => c.org = components(&value).into_iter().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "),
            "TITLE" => c.title = unescape(value.trim()),
            "NOTE" => c.note = unescape(&value),
            "BDAY" => c.birthday = birthday_from(value.trim()),
            _ => {}
        }
    }
    if c.name.is_empty() {
        c.name = if structured.is_empty() { c.org.clone() } else { structured };
    }
    if c.name.is_empty() {
        c.name = c.emails.first().map(|e| e.value.clone()).unwrap_or_default();
    }
    Some(c)
}

/// `19850412`, `1985-04-12`, `--0412` or `--04-12` (and a time after a `T`) as `1985-04-12` or `--04-12`.
fn birthday_from(value: &str) -> String {
    let day = value.split('T').next().unwrap_or("");
    let digits: String = day.chars().filter(char::is_ascii_digit).collect();
    if day.starts_with("--") && digits.len() == 4 {
        format!("--{}-{}", &digits[..2], &digits[2..])
    } else if digits.len() == 8 {
        format!("{}-{}-{}", &digits[..4], &digits[4..6], &digits[6..])
    } else {
        String::new()
    }
}

/// N from a shown name: the last word is the family name, the rest the given names.
fn structured_name(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    match words.split_last() {
        Some((family, given)) if !given.is_empty() => format!("{};{};;;", escape(family), escape(&given.join(" "))),
        _ => format!("{};;;;", escape(name)),
    }
}

fn typed(name: &str, l: &Labelled) -> String {
    let value = escape(&l.value);
    if l.label.is_empty() { format!("{name}:{value}") } else { format!("{name};TYPE={}:{value}", l.label) }
}

/// The card with the draft applied: lines of fields the draft doesn't touch stay exactly as they were, and lines of
/// fields it sets are replaced where the first of them was. A new card (no text) gets VERSION 3.0, which every server
/// and phone reads.
pub fn apply(existing: Option<&str>, draft: &Draft, uid: &str) -> String {
    let lines = existing.map(unfold).unwrap_or_default();
    let mut fresh: Vec<(&str, Vec<String>)> = Vec::new();
    if let Some(name) = &draft.name {
        fresh.push(("FN", vec![format!("FN:{}", escape(name))]));
        fresh.push(("N", vec![format!("N:{}", structured_name(name))]));
    }
    if let Some(emails) = &draft.emails {
        fresh.push(("EMAIL", emails.iter().map(|e| typed("EMAIL", e)).collect()));
    }
    if let Some(phones) = &draft.phones {
        fresh.push(("TEL", phones.iter().map(|p| typed("TEL", p)).collect()));
    }
    let single = |name: &'static str, v: &Option<String>, fresh: &mut Vec<(&str, Vec<String>)>| {
        if let Some(v) = v {
            fresh.push((name, if v.is_empty() { Vec::new() } else { vec![format!("{name}:{}", escape(v))] }));
        }
    };
    single("ORG", &draft.org, &mut fresh);
    single("TITLE", &draft.title, &mut fresh);
    single("NOTE", &draft.note, &mut fresh);
    if let Some(b) = &draft.birthday {
        // The basic form, which vCard 3.0 and 4.0 both read: 19850412, or --0412 with no year.
        let value = b.strip_prefix("--").map_or_else(|| b.replace('-', ""), |md| format!("--{}", md.replace('-', "")));
        fresh.push(("BDAY", if b.is_empty() { Vec::new() } else { vec![format!("BDAY:{value}")] }));
    }
    let rev = format!("REV:{}", chrono::Utc::now().format("%Y%m%dT%H%M%SZ"));

    let mut out: Vec<String> = Vec::new();
    let mut placed: Vec<&str> = Vec::new();
    if lines.is_empty() {
        out.extend(["BEGIN:VCARD".to_owned(), "VERSION:3.0".to_owned(), format!("UID:{uid}"), "PRODID:-//Mobius//Contacts//EN".to_owned()]);
        for (_, new_lines) in &fresh {
            out.extend(new_lines.iter().cloned());
        }
        out.push(rev);
        out.push("END:VCARD".to_owned());
    } else {
        for line in &lines {
            let name = split_line(line).map(|(n, _, _)| base_name(&n).to_owned()).unwrap_or_default();
            if name == "REV" {
                continue;
            }
            if line.eq_ignore_ascii_case("END:VCARD") {
                // Fields the card didn't have yet go at its end.
                for (field, new_lines) in &fresh {
                    if !placed.contains(field) {
                        out.extend(new_lines.iter().cloned());
                    }
                }
                out.push(rev.clone());
                out.push(line.clone());
                continue;
            }
            match fresh.iter().find(|(field, _)| *field == name) {
                Some((field, new_lines)) => {
                    // A grouped line (item1.EMAIL with its item1.X-ABLabel) goes with its group's label line, which
                    // stays: harmless, and some phones need it.
                    if !placed.contains(field) {
                        placed.push(field);
                        out.extend(new_lines.iter().cloned());
                    }
                }
                None => out.push(line.clone()),
            }
        }
    }
    out.iter().map(|l| fold(l)).collect::<Vec<_>>().join("\r\n") + "\r\n"
}

/// A short fingerprint of a card's text (FNV-1a), enough to tell a copy is stale.
fn version_of(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

static NEXT: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    let ms = SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    format!("{ms:x}-{:x}-{:x}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}

fn book_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.starts_with('.') && id.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | ' ' | '+'))
}

// ---- the store --------------------------------------------------------------------------------------------------------

/// The index: each card file's contact, read again only when the file's size or time changes.
type Index = HashMap<PathBuf, (u64, Option<SystemTime>, Contact)>;

pub struct Contacts {
    root: PathBuf,
    workspace: PathBuf,
    checkpoints: Checkpoints,
    index: Mutex<Index>,
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "contacts.search", "description": "Find people in the person's address book by name, email address, company or phone number, for addressing an email or an invite. Leave out the query to list everyone (up to the limit).", "capability": "contacts.read",
            "input_schema": { "type": "object", "properties": { "query": { "type": "string", "description": "Words to look for, such as Priya or northway.example." }, "limit": { "type": "integer", "minimum": 1, "maximum": MAX_RESULTS } } } }),
        json!({ "name": "contacts.save", "description": "Add a person to the address book, or change one: give the id from contacts.search to change it, with only the fields that change. Emails and phones replace the ones there.", "capability": "contacts.write", "resource_arg": "book",
            "input_schema": { "type": "object", "properties": {
                "book": { "type": "string", "description": "The address book; leave out for the main one." },
                "id": { "type": "string", "description": "The contact to change. Leave out to add a new one." },
                "name": { "type": "string" },
                "emails": { "type": "array", "items": { "type": "object", "properties": { "value": { "type": "string" }, "label": { "type": "string", "description": "work, home or other" } }, "required": ["value"] } },
                "phones": { "type": "array", "items": { "type": "object", "properties": { "value": { "type": "string" }, "label": { "type": "string", "description": "cell, work or home" } }, "required": ["value"] } },
                "org": { "type": "string", "description": "Company or organisation." },
                "title": { "type": "string", "description": "Job title." },
                "note": { "type": "string" },
                "birthday": { "type": "string", "description": "YYYY-MM-DD, or --MM-DD with no year." } } } }),
    ]
}

pub fn is_contact_tool(name: &str) -> bool {
    matches!(name, "contacts.search" | "contacts.save")
}

impl Contacts {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Contacts {
        let workspace = workspace.into();
        Contacts { root: workspace.join(FOLDER), checkpoints: Checkpoints::new(checkpoint_store), workspace, index: Mutex::new(HashMap::new()) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The address books: each folder under `contacts/`. The main one is listed even before it has anyone in it.
    pub fn books(&self) -> Vec<String> {
        let mut books: Vec<String> = fs::read_dir(&self.root)
            .map(|d| d.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).filter_map(|e| e.file_name().into_string().ok()).filter(|n| book_ok(n)).take(MAX_BOOKS).collect())
            .unwrap_or_default();
        if !books.iter().any(|b| b == DEFAULT_BOOK) {
            books.push(DEFAULT_BOOK.to_owned());
        }
        books.sort_by_key(|b| (b != DEFAULT_BOOK, b.to_lowercase()));
        books
    }

    fn file(&self, book: &str, id: &str) -> Res<PathBuf> {
        if !book_ok(book) {
            return Err(format!("{book} is not an address book name"));
        }
        if !id_ok(id) {
            return Err("that contact id is not right".into());
        }
        Ok(self.root.join(book).join(format!("{id}.vcf")))
    }

    /// Everyone in every book (or one book), sorted by name. Files changed since they were last read are read again;
    /// a file that isn't a card is left out.
    pub fn all(&self, only: Option<&str>) -> Vec<Contact> {
        let mut index = self.lock();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for book in self.books() {
            if only.is_some_and(|o| o != book) {
                continue;
            }
            let Ok(dir) = fs::read_dir(self.root.join(&book)) else { continue };
            for entry in dir.flatten().take(MAX_CONTACTS) {
                let path = entry.path();
                let Some(id) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".vcf").or_else(|| n.strip_suffix(".VCF"))).map(str::to_owned) else { continue };
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() || meta.len() > MAX_FILE {
                    continue;
                }
                let stamp = (meta.len(), meta.modified().ok());
                seen.insert(path.clone());
                if let Some((len, time, c)) = index.get(&path)
                    && (*len, *time) == stamp
                {
                    out.push(c.clone());
                    continue;
                }
                let Some(c) = fs::read_to_string(&path).ok().and_then(|t| parse(&t, &book, &id)) else {
                    index.remove(&path);
                    continue;
                };
                index.insert(path, (stamp.0, stamp.1, c.clone()));
                out.push(c);
            }
        }
        if only.is_none() {
            index.retain(|p, _| seen.contains(p));
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.id.cmp(&b.id)));
        out
    }

    pub fn get(&self, book: &str, id: &str) -> Res<Contact> {
        let path = self.file(book, id)?;
        let text = fs::read_to_string(&path).map_err(|_| "That contact is gone.".to_owned())?;
        parse(&text, book, id).ok_or_else(|| "That file is not a contact card.".to_owned())
    }

    /// People whose name, email, company or phone has every word of the query, best first: a name that starts with
    /// the query, then a name that has it, then the rest.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Contact> {
        let words: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_owned).collect();
        let digits: String = query.chars().filter(char::is_ascii_digit).collect();
        let q = query.trim().to_lowercase();
        let mut found: Vec<(u8, Contact)> = self
            .all(None)
            .into_iter()
            .filter_map(|c| {
                let hay = format!("{} {} {} {}", c.name, c.emails.iter().map(|e| e.value.as_str()).collect::<Vec<_>>().join(" "), c.org, c.title).to_lowercase();
                let phone = c.phones.iter().any(|p| digits.len() >= 4 && p.value.chars().filter(char::is_ascii_digit).collect::<String>().contains(&digits));
                if !(words.iter().all(|w| hay.contains(w.as_str())) || phone) {
                    return None;
                }
                let name = c.name.to_lowercase();
                let rank = if q.is_empty() || name.starts_with(&q) { 0 } else if name.contains(&q) { 1 } else { 2 };
                Some((rank, c))
            })
            .collect();
        found.sort_by_key(|(rank, _)| *rank);
        found.into_iter().take(limit.clamp(1, MAX_RESULTS)).map(|(_, c)| c).collect()
    }

    /// The contact with this email address, if anyone has it (any case). Mail and Calendar use it to put a name and a
    /// card to a sender or an attendee.
    pub fn by_email(&self, email: &str) -> Option<Contact> {
        let email = email.trim().trim_start_matches("mailto:").to_lowercase();
        if email.is_empty() {
            return None;
        }
        self.all(None).into_iter().find(|c| c.emails.iter().any(|e| e.value.to_lowercase() == email))
    }

    /// Adds a contact (no `id`) or changes one. `expect` is the version last seen; a change made since is refused.
    pub fn save(&self, book: &str, id: Option<&str>, draft: &Draft, expect: Option<&str>) -> Res<Contact> {
        let book = if book.trim().is_empty() { DEFAULT_BOOK } else { book.trim() };
        match id {
            Some(id) => {
                let path = self.file(book, id)?;
                let text = fs::read_to_string(&path).map_err(|_| "That contact is gone.".to_owned())?;
                if expect.is_some_and(|v| v != version_of(&text)) {
                    return Err("changed elsewhere".into());
                }
                if parse(&text, book, id).is_none() {
                    return Err("That file is not a contact card.".into());
                }
                let uid = id.to_owned();
                write(&path, &apply(Some(&text), draft, &uid))?;
                self.get(book, id)
            }
            None => {
                if draft.name.as_deref().is_none_or(str::is_empty) && draft.emails.as_ref().is_none_or(Vec::is_empty) {
                    return Err("A contact needs a name or an email address.".into());
                }
                if self.all(None).len() >= MAX_CONTACTS {
                    return Err(format!("There can be at most {MAX_CONTACTS} contacts."));
                }
                let id = new_id();
                let path = self.file(book, &id)?;
                write(&path, &apply(None, draft, &id))?;
                self.get(book, &id)
            }
        }
    }

    /// Removes a contact. `text` is what its file held, for `restore` (Undo).
    pub fn remove(&self, book: &str, id: &str, expect: Option<&str>) -> Res<Value> {
        let path = self.file(book, id)?;
        let text = fs::read_to_string(&path).map_err(|_| "That contact is gone.".to_owned())?;
        if expect.is_some_and(|v| v != version_of(&text)) {
            return Err("changed elsewhere".into());
        }
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        Ok(json!({ "book": book, "removed": id, "text": text }))
    }

    /// Puts back a removed contact as it was. Never replaces one that is there.
    pub fn restore(&self, book: &str, id: &str, text: &str) -> Res<Contact> {
        let path = self.file(book, id)?;
        if path.exists() {
            return Err("There is a contact there already.".into());
        }
        if text.len() as u64 > MAX_FILE || parse(text, book, id).is_none() {
            return Err("That is not a contact card.".into());
        }
        write(&path, text)?;
        self.get(book, id)
    }

    fn checkpoint(&self, why: &str) {
        let _ = self.checkpoints.snapshot(&self.workspace, why);
    }

    /// A tool the agent called. A checkpoint is taken before a change, so the person can undo it.
    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        let text = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        match tool {
            "contacts.search" => {
                let limit = args.get("limit").and_then(Value::as_u64).map_or(20, |n| usize::try_from(n).unwrap_or(MAX_RESULTS));
                let found = self.search(text("query").unwrap_or(""), limit);
                let list: Vec<Value> = found.iter().map(|c| {
                    let mut v = c.to_json();
                    if let Some(o) = v.as_object_mut() {
                        o.remove("version");
                    }
                    v
                }).collect();
                Ok(serde_json::to_string(&json!({ "contacts": list })).unwrap_or_default())
            }
            "contacts.save" => {
                let draft = Draft::from_json(args)?;
                let book = text("book").unwrap_or(DEFAULT_BOOK);
                self.checkpoint(&format!("before the agent saved a contact in {book}"));
                let saved = self.save(book, text("id"), &draft, None)?;
                let mut v = saved.to_json();
                if let Some(o) = v.as_object_mut() {
                    o.remove("version");
                }
                Ok(serde_json::to_string(&v).unwrap_or_default())
            }
            _ => Err(format!("unknown tool {tool}")),
        }
    }
}

/// Writes through a temp file and a rename, so a reader never finds half a card.
fn write(path: &Path, text: &str) -> Res<()> {
    let dir = path.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!(".{}.mobius-tmp", new_id()));
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const APPLE: &str = "BEGIN:VCARD\r\nVERSION:3.0\r\nPRODID:-//Apple Inc.//iPhone OS 18.0//EN\r\nN:Raman;Priya;;;\r\nFN:Priya Raman\r\nORG:Northway Motors;Parts\r\nTITLE:Buyer\r\nitem1.EMAIL;type=INTERNET;type=WORK;type=pref:priya@northway.example\r\nitem1.X-ABLabel:_$!<Work>!$_\r\nEMAIL;type=INTERNET;type=HOME:priya.r@mail.example\r\nTEL;type=CELL;type=VOICE;type=pref:+44 7700 900123\r\nADR;type=WORK:;;1 Dock Road;Leeds;;LS1 1AA;UK\r\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJ\r\n C4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIy\r\nBDAY:1985-04-12\r\nNOTE:Prefers calls before 10\\, not after.\\nAsk about the fleet.\r\nX-SOCIALPROFILE;type=linkedin:https://example.com/priya\r\nUID:3F2A\r\nEND:VCARD\r\n";

    fn store() -> (tempfile::TempDir, Contacts) {
        let dir = tempfile::tempdir().unwrap();
        let c = Contacts::new(dir.path().join("workspace"), dir.path().join("checkpoints"));
        (dir, c)
    }

    #[test]
    fn a_phones_card_reads_with_its_kinds_and_parts() {
        let c = parse(APPLE, "Contacts", "3F2A").unwrap();
        assert_eq!(c.name, "Priya Raman");
        assert_eq!(c.emails, vec![Labelled { value: "priya@northway.example".into(), label: "work".into() }, Labelled { value: "priya.r@mail.example".into(), label: "home".into() }]);
        assert_eq!(c.phones, vec![Labelled { value: "+44 7700 900123".into(), label: "cell".into() }]);
        assert_eq!((c.org.as_str(), c.title.as_str(), c.birthday.as_str()), ("Northway Motors, Parts", "Buyer", "1985-04-12"));
        assert_eq!(c.note, "Prefers calls before 10, not after.\nAsk about the fleet.");
    }

    #[test]
    fn a_card_with_no_shown_name_takes_one_from_its_parts_its_company_or_its_email() {
        assert_eq!(parse("BEGIN:VCARD\nVERSION:4.0\nN:Okafor;Sam;;Dr.;\nEND:VCARD\n", "b", "x").unwrap().name, "Dr. Sam Okafor");
        assert_eq!(parse("BEGIN:VCARD\nORG:Axion\nEND:VCARD\n", "b", "x").unwrap().name, "Axion");
        assert_eq!(parse("BEGIN:VCARD\nEMAIL:a@b.example\nEND:VCARD\n", "b", "x").unwrap().name, "a@b.example");
        assert!(parse("not a card", "b", "x").is_none());
    }

    #[test]
    fn a_change_keeps_every_field_mobius_does_not_show() {
        let draft = Draft { title: Some("Head of parts".into()), phones: Some(vec![Labelled { value: "+44 113 496 0000".into(), label: "work".into() }]), ..Draft::default() };
        let out = apply(Some(APPLE), &draft, "3F2A");
        let c = parse(&out, "Contacts", "3F2A").unwrap();
        assert_eq!(c.title, "Head of parts");
        assert_eq!(c.phones, vec![Labelled { value: "+44 113 496 0000".into(), label: "work".into() }]);
        assert_eq!(c.emails.len(), 2, "emails weren't in the draft, so they stay");
        for kept in ["ADR;type=WORK:;;1 Dock Road;Leeds;;LS1 1AA;UK", "X-SOCIALPROFILE;type=linkedin:https://example.com/priya", "item1.X-ABLabel:_$!<Work>!$_", "UID:3F2A", "PRODID:-//Apple Inc.//iPhone OS 18.0//EN"] {
            assert!(unfold(&out).iter().any(|l| l == kept), "{kept} is kept:\n{out}");
        }
        let photo = unfold(APPLE).into_iter().find(|l| l.starts_with("PHOTO")).unwrap();
        assert!(unfold(&out).contains(&photo), "the photo is kept whole");
        assert!(out.lines().all(|l| l.trim_end_matches('\r').len() <= 75), "lines are folded");
        assert_eq!(unfold(&out).iter().filter(|l| l.starts_with("REV:")).count(), 1);
    }

    #[test]
    fn a_new_card_is_vcard_3_with_its_fields_and_reads_back_the_same() {
        let draft = Draft { name: Some("Ana Lima".into()), emails: Some(vec![Labelled { value: "ana@lima.example".into(), label: "work".into() }]), org: Some("Lima, Rocha & Co".into()), birthday: Some("--06-01".into()), ..Draft::default() };
        let out = apply(None, &draft, "abc");
        assert!(out.starts_with("BEGIN:VCARD\r\nVERSION:3.0\r\nUID:abc\r\n"), "{out}");
        assert!(out.contains("N:Lima;Ana;;;\r\n") && out.contains("ORG:Lima\\, Rocha & Co\r\n") && out.contains("BDAY:--0601\r\n"), "{out}");
        let c = parse(&out, "Contacts", "abc").unwrap();
        assert_eq!((c.name.as_str(), c.org.as_str(), c.birthday.as_str()), ("Ana Lima", "Lima, Rocha & Co", "--06-01"));
        assert_eq!(c.emails[0], Labelled { value: "ana@lima.example".into(), label: "work".into() });
    }

    #[test]
    fn the_store_adds_finds_changes_and_removes_and_never_overwrites_a_change_made_elsewhere() {
        let (_d, s) = store();
        let draft = Draft::from_json(&json!({ "name": "Priya Raman", "emails": [{ "value": "Priya@Northway.example", "label": "work" }], "org": "Northway Motors" })).unwrap();
        let made = s.save("", None, &draft, None).unwrap();
        assert_eq!(made.book, DEFAULT_BOOK);
        s.save("Work", None, &Draft { name: Some("Sam Okafor".into()), phones: Some(vec![Labelled { value: "+44 7700 900456".into(), label: "cell".into() }]), ..Draft::default() }, None).unwrap();
        assert_eq!(s.books(), ["Contacts", "Work"]);
        assert_eq!(s.all(None).iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Priya Raman", "Sam Okafor"]);
        assert_eq!(s.by_email("mailto:priya@northway.EXAMPLE").unwrap().id, made.id, "any case, with or without mailto:");
        assert_eq!(s.search("northway", 10).len(), 1);
        assert_eq!(s.search("900456", 10)[0].name, "Sam Okafor", "a phone number's digits find its owner");
        assert_eq!(s.search("ok", 10)[0].name, "Sam Okafor");
        assert!(s.search("nobody", 10).is_empty());

        let changed = s.save(DEFAULT_BOOK, Some(&made.id), &Draft { title: Some("Buyer".into()), ..Draft::default() }, Some(&made.version)).unwrap();
        assert_eq!(changed.title, "Buyer");
        assert_eq!(s.save(DEFAULT_BOOK, Some(&made.id), &Draft { title: Some("X".into()), ..Draft::default() }, Some(&made.version)).unwrap_err(), "changed elsewhere");

        let gone = s.remove(DEFAULT_BOOK, &made.id, Some(&changed.version)).unwrap();
        assert!(s.by_email("priya@northway.example").is_none());
        s.restore(DEFAULT_BOOK, &made.id, gone["text"].as_str().unwrap()).unwrap();
        assert_eq!(s.get(DEFAULT_BOOK, &made.id).unwrap().title, "Buyer");
        assert!(s.restore(DEFAULT_BOOK, &made.id, gone["text"].as_str().unwrap()).is_err(), "never over one that is there");
    }

    #[test]
    fn a_card_changed_on_disk_is_read_again() {
        let (_d, s) = store();
        let c = s.save("", None, &Draft { name: Some("Ana".into()), ..Draft::default() }, None).unwrap();
        assert_eq!(s.all(None)[0].name, "Ana");
        let path = s.file(DEFAULT_BOOK, &c.id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana Lima\r\nEND:VCARD\r\n").unwrap();
        assert_eq!(s.all(None)[0].name, "Ana Lima");
        fs::remove_file(&path).unwrap();
        assert!(s.all(None).is_empty());
    }

    #[test]
    fn bad_input_is_refused_before_anything_is_written() {
        assert!(Draft::from_json(&json!({ "emails": ["not an address"] })).is_err());
        assert!(Draft::from_json(&json!({ "birthday": "12/04/1985" })).is_err());
        assert!(Draft::from_json(&json!({ "emails": [{ "value": "a@b.example", "label": "work;evil" }] })).is_err());
        let (_d, s) = store();
        assert!(s.save("", None, &Draft::default(), None).is_err(), "a contact needs a name or an email");
        assert!(s.save("../x", None, &Draft { name: Some("A".into()), ..Draft::default() }, None).is_err());
        assert!(s.get(DEFAULT_BOOK, "../../etc/passwd").is_err());
    }

    #[test]
    fn the_agent_searches_and_saves_with_a_checkpoint_first() {
        let (d, s) = store();
        let said = s.run("contacts.save", &json!({ "name": "Priya Raman", "emails": [{ "value": "priya@northway.example" }] })).unwrap();
        let saved: Value = serde_json::from_str(&said).unwrap();
        assert!(saved.get("version").is_none(), "the agent gets no versions");
        let found: Value = serde_json::from_str(&s.run("contacts.search", &json!({ "query": "priya" })).unwrap()).unwrap();
        assert_eq!(found["contacts"][0]["emails"][0]["value"], "priya@northway.example");
        s.run("contacts.save", &json!({ "id": saved["id"], "title": "Buyer" })).unwrap();
        assert!(!Checkpoints::new(d.path().join("checkpoints")).list(&d.path().join("workspace"), 10).unwrap().is_empty(), "a checkpoint came before the change");
    }
}
