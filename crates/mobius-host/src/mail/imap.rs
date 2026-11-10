//! Just enough IMAP (RFC 9051 / 3501) to mirror a mailbox: log in, list mailboxes, choose one, find messages by
//! date, fetch them, set flags and keep a draft. Always over TLS (port 993). Responses are read into small trees
//! (atoms, strings, literals, lists) by [`parse`], which is all the FETCH and LIST answers need.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

type Res<T> = Result<T, String>;

const MAX_LITERAL: usize = 30 * 1024 * 1024;
const MAX_RESPONSE: usize = 200 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
    Atom(String),
    Str(Vec<u8>),
    List(Vec<Item>),
    Nil,
}

impl Item {
    pub fn text(&self) -> Option<String> {
        match self {
            Item::Atom(a) => Some(a.clone()),
            Item::Str(s) => Some(String::from_utf8_lossy(s).into_owned()),
            _ => None,
        }
    }
    pub fn bytes(&self) -> Option<&[u8]> {
        match self {
            Item::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn list(&self) -> &[Item] {
        match self {
            Item::List(l) => l,
            _ => &[],
        }
    }
}

/// One response line, literals included, as items: `* 3 FETCH (UID 7 FLAGS (\Seen))` → [*, 3, FETCH, (…)].
pub fn parse(line: &[u8]) -> Res<Vec<Item>> {
    fn items(b: &[u8], at: &mut usize, until_close: bool) -> Res<Vec<Item>> {
        let mut out = Vec::new();
        while *at < b.len() {
            match b[*at] {
                b' ' | b'\r' | b'\n' => *at += 1,
                b')' if until_close => {
                    *at += 1;
                    return Ok(out);
                }
                b'(' => {
                    *at += 1;
                    out.push(Item::List(items(b, at, true)?));
                }
                b'"' => {
                    *at += 1;
                    let mut s = Vec::new();
                    loop {
                        match b.get(*at) {
                            None => return Err("unfinished string".into()),
                            Some(b'\\') => {
                                if let Some(c) = b.get(*at + 1) {
                                    s.push(*c);
                                }
                                *at += 2;
                            }
                            Some(b'"') => {
                                *at += 1;
                                break;
                            }
                            Some(c) => {
                                s.push(*c);
                                *at += 1;
                            }
                        }
                    }
                    out.push(Item::Str(s));
                }
                b'{' => {
                    let close = b[*at..].iter().position(|c| *c == b'}').ok_or("bad literal")? + *at;
                    let n: usize = std::str::from_utf8(&b[*at + 1..close]).ok().map(|s| s.trim_end_matches('+')).and_then(|s| s.parse().ok()).ok_or("bad literal")?;
                    let start = close + 3; // }\r\n
                    let end = start.checked_add(n).filter(|e| *e <= b.len()).ok_or("short literal")?;
                    out.push(Item::Str(b[start..end].to_vec()));
                    *at = end;
                }
                _ => {
                    // An atom; `BODY[HEADER.FIELDS (A B)]` keeps its brackets and what is inside them together.
                    let start = *at;
                    let mut depth = 0;
                    while *at < b.len() {
                        let c = b[*at];
                        if c == b'[' {
                            depth += 1;
                        } else if c == b']' {
                            depth -= 1;
                        } else if depth == 0 && (c == b' ' || c == b'(' || c == b')' || c == b'\r' || c == b'\n') {
                            break;
                        }
                        *at += 1;
                    }
                    let atom = String::from_utf8_lossy(&b[start..*at]).into_owned();
                    out.push(if atom.eq_ignore_ascii_case("NIL") { Item::Nil } else { Item::Atom(atom) });
                }
            }
        }
        if until_close { Err("unfinished list".into()) } else { Ok(out) }
    }
    let mut at = 0;
    items(line, &mut at, false)
}

/// A string as IMAP wants it quoted.
pub fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Mailbox names are modified UTF-7 (RFC 3501 5.1.3): `&AOk-` is é.
pub fn decode_mailbox(name: &str) -> String {
    use base64::Engine;
    let mut out = String::new();
    let mut rest = name;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at + 1..];
        let end = rest.find('-').unwrap_or(rest.len());
        let chunk = &rest[..end];
        if chunk.is_empty() {
            out.push('&');
        } else {
            let b64 = chunk.replace(',', "/");
            let padded = format!("{b64}{}", "=".repeat((4 - b64.len() % 4) % 4));
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(padded) {
                let units: Vec<u16> = bytes.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                out.push_str(&String::from_utf16_lossy(&units));
            }
        }
        rest = rest.get(end + 1..).unwrap_or("");
    }
    out.push_str(rest);
    out
}

pub trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

pub struct Imap {
    reader: BufReader<Box<dyn Stream>>,
    tag: u32,
}

/// A mailbox the account has, with its special use (`\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`) if it says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    pub name: String,
    pub shown: String,
    pub special: Option<String>,
}

/// A fetched message: its UID, flags, when the server got it, and the whole message.
#[derive(Debug, Clone)]
pub struct Fetched {
    pub uid: u32,
    pub flags: Vec<String>,
    pub internal_date: String,
    pub raw: Vec<u8>,
}

pub fn tls_config() -> Res<Arc<rustls::ClientConfig>> {
    let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider())).with_safe_default_protocol_versions().map_err(|e| e.to_string())?;
    Ok(Arc::new(builder.with_root_certificates(roots).with_no_client_auth()))
}

impl Imap {
    /// Connects over TLS and reads the greeting.
    pub fn connect(host: &str, port: u16) -> Res<Imap> {
        let tcp = TcpStream::connect((host, port)).map_err(|e| format!("Could not reach {host}: {e}"))?;
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(60)));
        let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));
        let name = rustls::pki_types::ServerName::try_from(host.to_owned()).map_err(|_| "That is not a server name.".to_owned())?;
        let conn = rustls::ClientConnection::new(tls_config()?, name).map_err(|e| e.to_string())?;
        Imap::over(Box::new(rustls::StreamOwned::new(conn, tcp)))
    }

    /// Over a stream that is already secure (or, in tests, plain).
    pub fn over(stream: Box<dyn Stream>) -> Res<Imap> {
        let mut imap = Imap { reader: BufReader::new(stream), tag: 0 };
        let greeting = imap.line()?;
        if !greeting.starts_with(b"* OK") && !greeting.starts_with(b"* PREAUTH") {
            return Err("The mail server did not say hello.".into());
        }
        Ok(imap)
    }

    /// One logical line: a line, and any literal it ends with, and the rest after it.
    fn line(&mut self) -> Res<Vec<u8>> {
        let mut out = Vec::new();
        loop {
            let mut part = Vec::new();
            let n = self.reader.read_until(b'\n', &mut part).map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("The mail server closed the connection.".into());
            }
            out.extend_from_slice(&part);
            if out.len() > MAX_RESPONSE {
                return Err("The mail server sent too much.".into());
            }
            // `{123}\r\n`: that many bytes follow, then the line goes on.
            let trimmed = part.strip_suffix(b"\r\n").or_else(|| part.strip_suffix(b"\n")).unwrap_or(&part);
            let Some(open) = trimmed.iter().rposition(|c| *c == b'{') else { return Ok(out) };
            if trimmed.last() != Some(&b'}') {
                return Ok(out);
            }
            let Some(n) = std::str::from_utf8(&trimmed[open + 1..trimmed.len() - 1]).ok().and_then(|s| s.parse::<usize>().ok()) else { return Ok(out) };
            if n > MAX_LITERAL {
                return Err("A message is too big.".into());
            }
            let mut literal = vec![0; n];
            self.reader.read_exact(&mut literal).map_err(|e| e.to_string())?;
            out.extend_from_slice(&literal);
        }
    }

    fn send(&mut self, command: &str) -> Res<String> {
        self.tag += 1;
        let tag = format!("m{}", self.tag);
        let stream = self.reader.get_mut();
        stream.write_all(format!("{tag} {command}\r\n").as_bytes()).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok(tag)
    }

    /// The untagged lines of the answer, once the server says the command went through.
    fn finish(&mut self, tag: &str) -> Res<Vec<Vec<u8>>> {
        let mut lines = Vec::new();
        loop {
            let line = self.line()?;
            if line.starts_with(tag.as_bytes()) && line.get(tag.len()) == Some(&b' ') {
                let rest = String::from_utf8_lossy(&line[tag.len() + 1..]).trim().to_owned();
                if rest.to_ascii_uppercase().starts_with("OK") {
                    return Ok(lines);
                }
                let said = rest.split_once(' ').map_or("", |x| x.1).trim().to_owned();
                return Err(said);
            }
            lines.push(line);
        }
    }

    fn run(&mut self, command: &str) -> Res<Vec<Vec<u8>>> {
        let tag = self.send(command)?;
        self.finish(&tag)
    }

    pub fn login(&mut self, user: &str, password: &str) -> Res<()> {
        self.run(&format!("LOGIN {} {}", quote(user), quote(password))).map(|_| ()).map_err(|said| {
            if said.to_ascii_uppercase().contains("AUTHENTICATIONFAILED") || said.to_ascii_lowercase().contains("invalid") || said.to_ascii_lowercase().contains("fail") {
                "The mail server did not accept that address and password. Most accounts need an app password, made in the account's security settings.".to_owned()
            } else {
                format!("The mail server refused to sign in: {said}")
            }
        })
    }

    pub fn list(&mut self) -> Res<Vec<Mailbox>> {
        let mut out = Vec::new();
        for line in self.run("LIST \"\" \"*\"")? {
            let items = parse(&line)?;
            // * LIST (\HasNoChildren \Sent) "/" "Sent Messages"
            if items.get(1).and_then(Item::text).is_none_or(|t| !t.eq_ignore_ascii_case("LIST")) {
                continue;
            }
            let flags: Vec<String> = items.get(2).map(Item::list).unwrap_or_default().iter().filter_map(Item::text).collect();
            if flags.iter().any(|f| f.eq_ignore_ascii_case("\\Noselect") || f.eq_ignore_ascii_case("\\NonExistent")) {
                continue;
            }
            let Some(name) = items.get(4).and_then(Item::text) else { continue };
            let special = flags.iter().find(|f| ["\\Sent", "\\Drafts", "\\Trash", "\\Junk", "\\Archive", "\\All"].iter().any(|s| s.eq_ignore_ascii_case(f))).cloned();
            out.push(Mailbox { shown: decode_mailbox(&name), name, special });
        }
        Ok(out)
    }

    /// Opens a mailbox for reading only; its UIDVALIDITY says whether UIDs known before still mean the same.
    pub fn examine(&mut self, mailbox: &str) -> Res<u32> {
        let lines = self.run(&format!("EXAMINE {}", quote(mailbox)))?;
        Ok(lines
            .iter()
            .find_map(|l| {
                let t = String::from_utf8_lossy(l);
                t.find("UIDVALIDITY ").and_then(|at| t[at + 12..].split(|c: char| !c.is_ascii_digit()).next().and_then(|n| n.parse().ok()))
            })
            .unwrap_or(0))
    }

    pub fn select(&mut self, mailbox: &str) -> Res<()> {
        self.run(&format!("SELECT {}", quote(mailbox))).map(|_| ())
    }

    /// UIDs of messages since a day (`1-Oct-2026`).
    pub fn search_since(&mut self, day: &str) -> Res<Vec<u32>> {
        let mut out = Vec::new();
        for line in self.run(&format!("UID SEARCH SINCE {day}"))? {
            let t = String::from_utf8_lossy(&line);
            if let Some(rest) = t.strip_prefix("* SEARCH") {
                out.extend(rest.split_whitespace().filter_map(|n| n.parse::<u32>().ok()));
            }
        }
        Ok(out)
    }

    /// Fetches whole messages by UID, without marking them read.
    pub fn fetch(&mut self, uids: &[u32]) -> Res<Vec<Fetched>> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let mut out = Vec::new();
        for line in self.run(&format!("UID FETCH {set} (UID FLAGS INTERNALDATE BODY.PEEK[])"))? {
            let items = parse(&line)?;
            if items.get(2).and_then(Item::text).is_none_or(|t| !t.eq_ignore_ascii_case("FETCH")) {
                continue;
            }
            let fields = items.get(3).map(Item::list).unwrap_or_default();
            let mut fetched = Fetched { uid: 0, flags: Vec::new(), internal_date: String::new(), raw: Vec::new() };
            for pair in fields.chunks(2) {
                let (Some(key), Some(value)) = (pair[0].text(), pair.get(1)) else { continue };
                match key.to_ascii_uppercase().as_str() {
                    "UID" => fetched.uid = value.text().and_then(|t| t.parse().ok()).unwrap_or(0),
                    "FLAGS" => fetched.flags = value.list().iter().filter_map(Item::text).collect(),
                    "INTERNALDATE" => fetched.internal_date = value.text().unwrap_or_default(),
                    k if k.starts_with("BODY[") => fetched.raw = value.bytes().map(<[u8]>::to_vec).unwrap_or_default(),
                    _ => {}
                }
            }
            if fetched.uid != 0 {
                out.push(fetched);
            }
        }
        Ok(out)
    }

    /// Adds or takes away a flag (`\Seen`, `\Flagged`) on one message in the selected mailbox.
    pub fn flag(&mut self, uid: u32, flag: &str, on: bool) -> Res<()> {
        self.run(&format!("UID STORE {uid} {}FLAGS.SILENT ({flag})", if on { "+" } else { "-" })).map(|_| ())
    }

    /// Moves one message of the selected mailbox to another: MOVE where the server has it, else a copy there and
    /// this one deleted.
    pub fn move_uid(&mut self, uid: u32, to: &str) -> Res<()> {
        if self.run(&format!("UID MOVE {uid} {}", quote(to))).is_ok() {
            return Ok(());
        }
        self.run(&format!("UID COPY {uid} {}", quote(to)))?;
        self.run(&format!("UID STORE {uid} +FLAGS.SILENT (\\Deleted)"))?;
        // Only that message, where the server can (UIDPLUS); else every message marked deleted in the mailbox.
        if self.run(&format!("UID EXPUNGE {uid}")).is_err() {
            self.run("EXPUNGE")?;
        }
        Ok(())
    }

    /// Makes a mailbox, unless the account has it already.
    pub fn create(&mut self, mailbox: &str) -> Res<()> {
        match self.run(&format!("CREATE {}", quote(mailbox))) {
            Ok(_) => Ok(()),
            Err(e) if e.to_ascii_uppercase().contains("EXISTS") => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// UIDs, in the selected mailbox, of the message with this Message-ID.
    pub fn search_message_id(&mut self, message_id: &str) -> Res<Vec<u32>> {
        let id = format!("<{}>", message_id.trim_matches(['<', '>']));
        let mut out = Vec::new();
        for line in self.run(&format!("UID SEARCH HEADER Message-ID {}", quote(&id)))? {
            let t = String::from_utf8_lossy(&line);
            if let Some(rest) = t.strip_prefix("* SEARCH") {
                out.extend(rest.split_whitespace().filter_map(|n| n.parse::<u32>().ok()));
            }
        }
        Ok(out)
    }

    /// Keeps a message in a mailbox (a draft in Drafts), as the server's own copy.
    pub fn append(&mut self, mailbox: &str, flags: &str, message: &[u8]) -> Res<()> {
        let tag = self.send(&format!("APPEND {} ({flags}) {{{}}}", quote(mailbox), message.len()))?;
        let go = self.line()?;
        if !go.starts_with(b"+") {
            return Err(String::from_utf8_lossy(&go).trim().to_owned());
        }
        let stream = self.reader.get_mut();
        stream.write_all(message).and_then(|()| stream.write_all(b"\r\n")).and_then(|()| stream.flush()).map_err(|e| e.to_string())?;
        self.finish(&tag).map(|_| ())
    }

    pub fn logout(mut self) {
        let _ = self.run("LOGOUT");
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn answers_are_read_into_items_with_literals_and_brackets() {
        let line = b"* 3 FETCH (UID 7 FLAGS (\\Seen \\Flagged) INTERNALDATE \"08-Nov-2026 09:02:00 +0000\" BODY[] {12}\r\nHello\r\nWorld)\r\n";
        let items = parse(line).unwrap();
        assert_eq!(items[2], Item::Atom("FETCH".into()));
        let fields = items[3].list();
        assert_eq!(fields[1], Item::Atom("7".into()));
        assert_eq!(fields[3], Item::List(vec![Item::Atom("\\Seen".into()), Item::Atom("\\Flagged".into())]));
        assert_eq!(fields[6], Item::Atom("BODY[]".into()));
        assert_eq!(fields[7].bytes().unwrap(), b"Hello\r\nWorld");
        assert_eq!(parse(b"* LIST (\\HasNoChildren) \"/\" NIL").unwrap()[4], Item::Nil);
        assert_eq!(parse(b"* OK [HEADER.FIELDS (FROM TO)] x").unwrap()[2], Item::Atom("[HEADER.FIELDS (FROM TO)]".into()));
        assert_eq!(quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(decode_mailbox("Entw&APw-rfe"), "Entwürfe");
        assert_eq!(decode_mailbox("A &- B"), "A & B");
    }

    /// A tiny IMAP server for tests, over plain TCP: one user, an INBOX and a Drafts mailbox.
    pub fn fake_server(messages: Vec<(u32, &'static str, Vec<u8>)>) -> (std::net::SocketAddr, Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let log: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
        let seen = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let messages = messages.clone();
                let log = seen.clone();
                std::thread::spawn(move || {
                    let mut w = stream.try_clone().unwrap();
                    let mut r = BufReader::new(stream);
                    let _ = w.write_all(b"* OK fake ready\r\n");
                    let mut line = String::new();
                    while { line.clear(); r.read_line(&mut line).unwrap_or(0) > 0 } {
                        let (tag, rest) = line.trim_end().split_once(' ').unwrap_or(("", ""));
                        log.lock().unwrap().push(rest.to_owned());
                        let upper = rest.to_ascii_uppercase();
                        let reply = if upper.starts_with("LOGIN") {
                            if rest.contains("\"app-pass\"") { format!("{tag} OK logged in\r\n") } else { format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n") }
                        } else if upper.starts_with("LIST") {
                            format!("* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n* LIST (\\HasNoChildren \\Drafts) \"/\" \"Drafts\"\r\n* LIST (\\HasNoChildren \\Sent) \"/\" \"Sent Messages\"\r\n{tag} OK done\r\n")
                        } else if upper.starts_with("EXAMINE") || upper.starts_with("SELECT") {
                            format!("* {} EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n{tag} OK [READ-ONLY] done\r\n", messages.len())
                        } else if upper.starts_with("UID SEARCH") {
                            format!("* SEARCH {}\r\n{tag} OK done\r\n", messages.iter().map(|m| m.0.to_string()).collect::<Vec<_>>().join(" "))
                        } else if upper.starts_with("UID FETCH") {
                            let mut s = String::new();
                            let wanted: Vec<u32> = rest.split_whitespace().nth(2).unwrap_or("").split(',').filter_map(|n| n.parse().ok()).collect();
                            let mut out = Vec::new();
                            for (i, (uid, flags, raw)) in messages.iter().enumerate() {
                                if !wanted.contains(uid) { continue }
                                out.extend_from_slice(format!("* {} FETCH (UID {uid} FLAGS ({flags}) INTERNALDATE \"08-Nov-2026 09:02:00 +0000\" BODY[] {{{}}}\r\n", i + 1, raw.len()).as_bytes());
                                out.extend_from_slice(raw);
                                out.extend_from_slice(b")\r\n");
                            }
                            s.push_str(&format!("{tag} OK done\r\n"));
                            out.extend_from_slice(s.as_bytes());
                            let _ = w.write_all(&out);
                            continue;
                        } else if upper.starts_with("UID MOVE") || upper.starts_with("UID COPY") || upper.starts_with("CREATE") || upper.contains("EXPUNGE") {
                            format!("{tag} OK done\r\n")
                        } else if upper.starts_with("UID STORE") {
                            format!("{tag} OK stored\r\n")
                        } else if upper.starts_with("APPEND") {
                            let n: usize = rest.rsplit('{').next().unwrap_or("0}").trim_end_matches('}').parse().unwrap_or(0);
                            let _ = w.write_all(b"+ go ahead\r\n");
                            let mut body = vec![0; n + 2];
                            let _ = r.read_exact(&mut body);
                            log.lock().unwrap().push(format!("APPENDED {}", String::from_utf8_lossy(&body[..n])));
                            format!("{tag} OK appended\r\n")
                        } else if upper.starts_with("LOGOUT") {
                            let _ = w.write_all(format!("* BYE\r\n{tag} OK bye\r\n").as_bytes());
                            break;
                        } else {
                            format!("{tag} BAD what\r\n")
                        };
                        let _ = w.write_all(reply.as_bytes());
                    }
                });
            }
        });
        (addr, log)
    }

    #[test]
    fn a_mailbox_is_listed_searched_and_fetched() {
        let raw = b"From: Rui <rui@example.com>\r\nSubject: Terrace\r\n\r\nHi!\r\n".to_vec();
        let (addr, log) = fake_server(vec![(7, "\\Seen", raw.clone()), (9, "", b"Subject: Two\r\n\r\nx".to_vec())]);
        let mut imap = Imap::over(Box::new(TcpStream::connect(addr).unwrap())).unwrap();
        assert!(imap.login("ana@example.com", "wrong").unwrap_err().contains("app password"));
        imap.login("ana@example.com", "app-pass").unwrap();
        let boxes = imap.list().unwrap();
        assert_eq!(boxes.iter().map(|b| (b.shown.as_str(), b.special.as_deref())).collect::<Vec<_>>(), vec![("INBOX", None), ("Drafts", Some("\\Drafts")), ("Sent Messages", Some("\\Sent"))]);
        assert_eq!(imap.examine("INBOX").unwrap(), 42);
        assert_eq!(imap.search_since("1-Oct-2026").unwrap(), vec![7, 9]);
        let got = imap.fetch(&[7, 9]).unwrap();
        assert_eq!((got[0].uid, got[0].flags.clone(), got[0].raw.clone()), (7, vec!["\\Seen".to_owned()], raw));
        assert_eq!(got[1].flags, Vec::<String>::new());
        imap.select("INBOX").unwrap();
        imap.flag(9, "\\Seen", true).unwrap();
        imap.append("Drafts", "\\Draft", b"Subject: Re: Terrace\r\n\r\nYes").unwrap();
        imap.logout();
        let log = log.lock().unwrap().clone();
        assert!(log.contains(&"UID STORE 9 +FLAGS.SILENT (\\Seen)".to_owned()));
        assert!(log.iter().any(|l| l == "APPENDED Subject: Re: Terrace\r\n\r\nYes"));
    }
}
