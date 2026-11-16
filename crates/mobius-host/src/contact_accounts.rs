//! Address books kept on a CardDAV server (iCloud, Fastmail, Nextcloud, any server that speaks CardDAV), signed in
//! with the account name and an app password.
//!
//! A CardDAV address book is a WebDAV folder of `.vcf` files, so each one is synced with its folder in the workspace
//! (`contacts/<book>/`) by the same two-way sync as drives: the same case table, conflicts kept as copies, the delete
//! guard, held changes until Keep, and a checkpoint before sync writes here. This file only finds the account's
//! address books, keeps the accounts (`contact-accounts.json`, passwords in the system's secret store), and opens each
//! book as a drive for sync, under the id `carddav:<account>:<book>`.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::calendar_accounts::{Node, clean_name, dav_agent, dav_request, new_id, server_url, xml};
use crate::drives::{Drive, WebDav};
use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

const MAX_ACCOUNTS: usize = 20;
const MAX_BOOKS: usize = 20;
/// The prefix of the drive ids sync knows these address books by.
pub const PREFIX: &str = "carddav:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    /// Where it is on the server.
    pub href: String,
    /// Its name on the server.
    pub name: String,
    /// Its folder under `contacts/` in the workspace: the name, made unique.
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: String,
    pub books: Vec<Book>,
}

pub struct ContactAccounts {
    file: PathBuf,
    secrets: Arc<dyn Secrets>,
    state: Mutex<Vec<Account>>,
    http: ureq::Agent,
}

fn secret_name(id: &str) -> String {
    format!("carddav-{id}")
}

/// The drive id sync uses for one of an account's books.
pub fn drive_id(account: &str, book: usize) -> String {
    format!("{PREFIX}{account}:{book}")
}

impl ContactAccounts {
    pub fn new(data_dir: &Path, secrets: Arc<dyn Secrets>) -> ContactAccounts {
        let file = data_dir.join("contact-accounts.json");
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Vec<Account>>(&t).ok()).unwrap_or_default();
        ContactAccounts { file, secrets, state: Mutex::new(state), http: dav_agent() }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Account>> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn save(&self, accounts: &[Account]) {
        if let Ok(text) = serde_json::to_string_pretty(accounts) {
            let _ = std::fs::create_dir_all(self.file.parent().unwrap_or(Path::new(".")));
            let temp = self.file.with_extension("json.tmp");
            if std::fs::write(&temp, text).is_ok() {
                let _ = std::fs::rename(&temp, &self.file);
            }
        }
    }

    pub fn list(&self) -> Value {
        json!(self.lock().iter().map(|a| json!({
            "id": a.id, "name": a.name, "url": a.url, "username": a.username,
            "books": a.books.iter().enumerate().map(|(i, b)| json!({ "name": b.name, "folder": b.folder, "drive": drive_id(&a.id, i) })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>())
    }

    fn dav(&self, url: &url::Url, auth: (&str, &str), depth: &str, body: &str) -> Res<Node> {
        let answer = dav_request(&self.http, "PROPFIND", url, Some(auth), &[("Depth", depth), ("Content-Type", "application/xml; charset=utf-8")], Some(body))?;
        match answer.status {
            207 | 200 => xml(&answer.body),
            401 | 403 => Err("The server did not accept that name and password. iCloud and Fastmail need an app password, made in the account's security settings.".into()),
            404 => Err("The server has no address books at that address.".into()),
            s => Err(format!("The server answered {s}.")),
        }
    }

    /// The account's address books: its principal (asked of the address, or of `/.well-known/carddav`), the principal's
    /// address book home, and the address books in it.
    fn discover(&self, base: &url::Url, auth: (&str, &str)) -> Res<Vec<(String, String)>> {
        const PRINCIPAL: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;
        const HOME: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>"#;
        const LIST: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>"#;
        let principal_href = |doc: &Node| doc.first("current-user-principal").and_then(|p| p.text_of("href"));
        let (principal, asked) = match self.dav(base, auth, "0", PRINCIPAL).ok().and_then(|d| principal_href(&d)) {
            Some(p) => (p, base.clone()),
            None => {
                let known = base.join("/.well-known/carddav").map_err(|e| e.to_string())?;
                (principal_href(&self.dav(&known, auth, "0", PRINCIPAL)?).ok_or("That server did not say where the account's address books are.")?, known)
            }
        };
        let principal = asked.join(&principal).map_err(|e| e.to_string())?;
        let home = self.dav(&principal, auth, "0", HOME)?.first("addressbook-home-set").and_then(|h| h.text_of("href")).ok_or("That server did not say where the account's address books are.")?;
        let home = principal.join(&home).map_err(|e| e.to_string())?;
        let list = self.dav(&home, auth, "1", LIST)?;
        let mut responses = Vec::new();
        list.all("response", &mut responses);
        let mut out = Vec::new();
        for r in responses {
            if !r.first("resourcetype").is_some_and(|t| t.find("addressbook").is_some()) {
                continue;
            }
            let Some(href) = r.text_of("href") else { continue };
            let href = home.join(&href).map_err(|e| e.to_string())?;
            let name = r.text_of("displayname").filter(|n| !n.trim().is_empty()).unwrap_or_else(|| href.path().trim_end_matches('/').rsplit('/').next().unwrap_or("Contacts").to_owned());
            out.push((href.to_string(), name));
            if out.len() >= MAX_BOOKS {
                break;
            }
        }
        Ok(out)
    }

    /// Signs in, finds the account's address books, and keeps the account. `taken` are the book folders already in
    /// the workspace: a book whose name is taken by one that isn't the person's own empty main book gets the
    /// account's name added, so two books never share a folder. Answers the account, whose books the caller pairs.
    pub fn connect(&self, name: &str, server: &str, username: &str, password: &str, taken: &[String]) -> Res<Account> {
        let base = server_url(server)?;
        let username = username.trim();
        if username.is_empty() || password.is_empty() {
            return Err("CardDAV needs the account name and an app password.".into());
        }
        if self.lock().len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} contact accounts."));
        }
        let found = self.discover(&base, (username, password))?;
        if found.is_empty() {
            return Err("That account has no address books Mobius can show.".into());
        }
        let name = clean_name(name).or_else(|| base.host_str().map(str::to_owned)).unwrap_or_else(|| "CardDAV".into());
        let mut used: Vec<String> = taken.iter().map(|t| t.to_lowercase()).collect();
        for a in self.lock().iter() {
            used.extend(a.books.iter().map(|b| b.folder.to_lowercase()));
        }
        let mut books = Vec::new();
        for (href, book) in found {
            let plain = clean_name(&book).unwrap_or_else(|| "Contacts".into());
            let mut folder = plain.clone();
            if used.contains(&folder.to_lowercase()) {
                folder = clean_name(&format!("{plain} ({name})")).unwrap_or_else(|| format!("{plain} 2"));
            }
            let mut n = 2;
            while used.contains(&folder.to_lowercase()) {
                folder = format!("{plain} {n}");
                n += 1;
            }
            used.push(folder.to_lowercase());
            books.push(Book { href, name: book, folder });
        }
        let account = Account { id: new_id(), name, url: base.to_string(), username: username.to_owned(), books };
        if !self.secrets.put(&secret_name(&account.id), password) {
            return Err("The password could not be kept in this computer's secret store.".into());
        }
        let mut all = self.lock();
        all.push(account.clone());
        self.save(&all);
        Ok(account)
    }

    /// Forgets the account and its password. Answers the drive ids of its books, so their sync stops; the files in the
    /// workspace stay.
    pub fn remove(&self, id: &str) -> Res<Vec<String>> {
        let mut all = self.lock();
        let account = all.iter().find(|a| a.id == id).cloned().ok_or("That account is gone.")?;
        all.retain(|a| a.id != id);
        self.save(&all);
        drop(all);
        self.secrets.delete(&secret_name(id));
        Ok((0..account.books.len()).map(|i| drive_id(id, i)).collect())
    }

    fn find(&self, drive: &str) -> Option<(Account, Book)> {
        let (account, index) = drive.strip_prefix(PREFIX)?.split_once(':')?;
        let index: usize = index.parse().ok()?;
        let a = self.lock().iter().find(|a| a.id == account).cloned()?;
        let book = a.books.get(index).cloned()?;
        Some((a, book))
    }

    /// The account's name, for sync's checkpoint ("Before sync from Fastmail").
    pub fn name(&self, drive: &str) -> Option<String> {
        self.find(drive).map(|(a, _)| a.name)
    }

    /// One address book as a drive, for sync: its `.vcf` files are the drive's files.
    pub fn drive(&self, drive: &str) -> Res<Box<dyn Drive>> {
        let (account, book) = self.find(drive).ok_or("That address book is gone.")?;
        let password = self.secrets.get(&secret_name(&account.id)).ok_or("The password for this account is missing. Remove it and connect it again.")?;
        let mut href = url::Url::parse(&book.href).map_err(|e| e.to_string())?;
        if !href.path().ends_with('/') {
            let path = format!("{}/", href.path());
            href.set_path(&path);
        }
        Ok(Box::new(WebDav::new(href, &account.username, &password)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive_sync::{Base, RoundOptions, round};
    use crate::drives::tests::server;
    use crate::secrets::MemorySecrets;
    use std::io::{BufRead, BufReader, Read, Write};

    /// A CardDAV server's discovery answers: the principal at `/`, its home, and two address books (on `books`, the
    /// stand-in WebDAV server that holds the cards) beside a calendar that must be left out.
    fn discovery(books: &str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let books = books.to_owned();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let mut length = 0;
                let mut authorized = false;
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let lower = h.to_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                    // ana:app-pass
                    authorized |= lower.starts_with("authorization: basic yw5homfwcc1wyxnz");
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body = String::from_utf8_lossy(&body);
                let (status, reply) = if !authorized {
                    ("401 Unauthorized", String::new())
                } else if body.contains("current-user-principal") && path == "/" {
                    ("207 Multi-Status", r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principals/ana/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#.to_owned())
                } else if body.contains("addressbook-home-set") {
                    ("207 Multi-Status", format!(r#"<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/principals/ana/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>{books}/dav/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#))
                } else {
                    ("404 Not Found", String::new())
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/xml\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        base
    }

    /// The home's listing comes from a second stand-in that answers PROPFIND on the home with the books.
    fn home(books_base: &str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let books_base = books_base.to_owned();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = h.to_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let reply = format!(
                    r#"<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav">
                    <d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
                    <d:response><d:href>{books_base}/dav/contacts/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Contacts</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
                    <d:response><d:href>/dav/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Work</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
                    <d:response><d:href>/dav/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Calendar</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
                    </d:multistatus>"#
                );
                let _ = write!(stream, "HTTP/1.1 207 Multi-Status\r\nContent-Length: {}\r\nContent-Type: application/xml\r\nConnection: close\r\n\r\n{reply}", reply.len());
            }
        });
        base
    }

    #[test]
    fn an_account_finds_its_address_books_names_them_apart_and_syncs_one_both_ways() {
        let (cards, store) = server("/dav/contacts/");
        let home_base = home(&cards);
        let base = discovery(&home_base);
        let dir = tempfile::tempdir().unwrap();
        let accounts = ContactAccounts::new(dir.path(), Arc::new(MemorySecrets::new(true)));

        assert!(accounts.connect("Fastmail", &base, "ana", "wrong", &[]).unwrap_err().contains("did not accept"));
        // The person's own main book already has people in it, so the account's "Contacts" is named apart.
        let account = accounts.connect("Fastmail", &base, "ana", "app-pass", &["Contacts".to_owned()]).unwrap();
        assert_eq!(account.books.iter().map(|b| b.folder.as_str()).collect::<Vec<_>>(), ["Contacts (Fastmail)", "Work"], "address books only, never the calendar");
        assert_eq!(account.books[0].href, format!("{cards}/dav/contacts/"));
        assert_eq!(account.books[1].href, format!("{home_base}/dav/work/"), "a relative href is read against the home");
        assert_eq!(accounts.list()[0]["books"][1]["drive"], drive_id(&account.id, 1));
        assert_eq!(accounts.name(&drive_id(&account.id, 0)).as_deref(), Some("Fastmail"));

        // A card on the server comes here, and one made here goes there, through the same sync as drives.
        store.lock().unwrap().insert("/dav/contacts/priya.vcf".into(), (b"BEGIN:VCARD\r\nVERSION:3.0\r\nUID:priya\r\nFN:Priya Raman\r\nEND:VCARD\r\n".to_vec(), 7));
        let workspace = dir.path().join("workspace");
        let folder = workspace.join("contacts").join(&account.books[0].folder);
        std::fs::create_dir_all(&folder).unwrap();
        let contacts = mobius_workspace::contacts::Contacts::new(&workspace, dir.path().join("checkpoints"));
        let book = &account.books[0].folder;
        contacts.save(book, None, &mobius_workspace::contacts::Draft { name: Some("Sam Okafor".into()), ..Default::default() }, None).unwrap();
        let drive = accounts.drive(&drive_id(&account.id, 0)).unwrap();
        let mut base_state = Base::default();
        let report = round(drive.as_ref(), &folder, "", &mut base_state, &RoundOptions { stamp: "s", ..RoundOptions::default() }, &mut |_| {}).unwrap();
        assert_eq!((report.uploaded.len(), report.downloaded.len()), (1, 1), "{report:?}");
        assert_eq!(contacts.all(Some(book)).iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Priya Raman", "Sam Okafor"]);
        assert!(store.lock().unwrap().iter().any(|(k, (b, _))| k.ends_with(".vcf") && String::from_utf8_lossy(b).contains("FN:Sam Okafor")));

        // Removing the account stops its books' sync and forgets the password; the cards here stay.
        let drives = accounts.remove(&account.id).unwrap();
        assert_eq!(drives, [drive_id(&account.id, 0), drive_id(&account.id, 1)]);
        assert!(accounts.drive(&drives[0]).is_err());
        assert_eq!(contacts.all(Some(book)).len(), 2);
    }
}
