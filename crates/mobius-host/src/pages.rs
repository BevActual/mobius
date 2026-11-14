//! The person's own web pages (the workspace's `pages` folder) open in the Browser as they would on the web: served on
//! this computer only, at an address with a secret part, so another program or site cannot guess it. The agent's
//! browser tools treat a tab on such an address as the person's own file, not as a private network address.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// The folder in the workspace whose files are served.
pub const FOLDER: &str = "pages";
const MAX_HEAD: usize = 16 * 1024;

pub struct Pages {
    root: PathBuf,
    /// Where the address is kept, so a link to a page (in a note, say) still opens after Mobius starts again.
    kept: Option<PathBuf>,
    /// `http://127.0.0.1:<port>/<secret>`, once the first page has been asked for.
    origin: OnceLock<Result<String, String>>,
}

impl Pages {
    /// Pages served from `root`, the workspace's `pages` folder. Nothing listens until a page is asked for.
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self { root, kept: None, origin: OnceLock::new() }
    }

    /// As [`Pages::new`], keeping the address in `kept` and using it again on the next start when its port is free.
    #[must_use]
    pub fn kept_in(root: PathBuf, kept: PathBuf) -> Self {
        Self { root, kept: Some(kept), origin: OnceLock::new() }
    }

    fn origin(&self) -> Result<&str, String> {
        self.origin.get_or_init(|| start(self.root.clone(), self.kept.as_deref())).as_ref().map(String::as_str).map_err(Clone::clone)
    }

    /// The address a workspace file (`pages/…`) opens at in the Browser.
    ///
    /// # Errors
    /// When the path is not a file in the pages folder, or nothing could listen.
    pub fn url(&self, path: &str) -> Result<String, String> {
        let path = path.replace('\\', "/");
        let inside = path.trim_start_matches('/').strip_prefix(&format!("{FOLDER}/")).ok_or_else(|| format!("only files in {FOLDER}/ open as web pages"))?;
        if resolve(&self.root, inside).is_none() {
            return Err(format!("{path} is not a page in the workspace"));
        }
        let encoded: Vec<String> = inside.split('/').map(|s| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")).collect();
        Ok(format!("{}/{}", self.origin()?, encoded.join("/")))
    }

    /// Whether a tab's address is one of the person's own pages served here.
    #[must_use]
    pub fn is_own(&self, address: &str) -> bool {
        matches!(self.origin.get(), Some(Ok(origin)) if address.strip_prefix(origin.as_str()).is_some_and(|rest| rest.starts_with('/')))
    }

    /// A page's address from an earlier start (another port or secret, as after the demo is reset), as it is served
    /// now, so a link kept in a note still opens. None for any other address, or one whose file is not in the folder.
    #[must_use]
    pub fn current(&self, address: &str) -> Option<String> {
        if self.is_own(address) {
            return None;
        }
        let rest = address.strip_prefix("http://127.0.0.1:")?;
        let (port, rest) = rest.split_once('/')?;
        let (secret, rest) = rest.split_once('/')?;
        if port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) || secret.len() != 32 || !secret.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let (path, tail) = rest.find(['?', '#']).map_or((rest, ""), |at| rest.split_at(at));
        resolve(&self.root, &decode(path))?;
        Some(format!("{}/{path}{tail}", self.origin().ok()?))
    }

    /// The workspace file (`pages/…`) a tab's address serves, when it is one of the person's own pages.
    #[must_use]
    pub fn file_of(&self, address: &str) -> Option<String> {
        let Some(Ok(origin)) = self.origin.get() else { return None };
        let rest = address.strip_prefix(origin.as_str())?.strip_prefix('/')?.split(['?', '#']).next()?;
        let decoded = decode(rest);
        resolve(&self.root, &decoded)?;
        Some(format!("{FOLDER}/{decoded}"))
    }
}

fn secret() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| format!("no secret for the pages address: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn start(root: PathBuf, kept: Option<&Path>) -> Result<String, String> {
    // The last address, when there is one: the same secret, and the same port if nothing else has taken it.
    let before: Option<(u16, String)> = kept.and_then(|k| std::fs::read_to_string(k).ok()).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).and_then(|v| {
        let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
        let secret = v.get("secret")?.as_str().filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))?.to_owned();
        Some((port, secret))
    });
    let listener = before
        .as_ref()
        .and_then(|(port, _)| TcpListener::bind(("127.0.0.1", *port)).ok())
        .map_or_else(|| TcpListener::bind("127.0.0.1:0"), Ok)
        .map_err(|e| format!("the pages could not be served: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let secret = match before {
        Some((_, secret)) => secret,
        None => secret()?,
    };
    if let Some(kept) = kept {
        let _ = std::fs::write(kept, serde_json::json!({ "port": port, "secret": secret }).to_string());
    }
    let (root, prefix) = (Arc::new(root), Arc::new(format!("/{secret}/")));
    std::thread::Builder::new()
        .name("mobius-pages".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let (root, prefix) = (root.clone(), prefix.clone());
                let _ = std::thread::Builder::new().name("mobius-page".into()).spawn(move || answer(stream, &root, &prefix));
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(format!("http://127.0.0.1:{port}/{secret}"))
}

/// A file inside `root` for a decoded relative path, never outside it and never a hidden file or folder.
fn resolve(root: &Path, relative: &str) -> Option<PathBuf> {
    if relative.is_empty() || relative.contains('\\') || relative.contains('\0') {
        return None;
    }
    let mut path = root.to_path_buf();
    for part in Path::new(relative).components() {
        match part {
            Component::Normal(name) if !name.to_string_lossy().starts_with('.') && !name.to_string_lossy().contains(':') => path.push(name),
            _ => return None,
        }
    }
    let (real, real_root) = (path.canonicalize().ok()?, root.canonicalize().ok()?);
    (real.starts_with(&real_root) && real.is_file()).then_some(real)
}

/// A path from an address, with `%20` and the like turned back into what they stand for.
fn decode(path: &str) -> String {
    url::form_urlencoded::parse(format!("p={}", path.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn answer(mut stream: TcpStream, root: &Path, prefix: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut head = String::new();
    let mut reader = BufReader::new((&stream).take(MAX_HEAD as u64));
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line == "\r\n" || line == "\n" => break,
            Ok(_) => head.push_str(&line),
        }
    }
    let (status, kind, body) = respond(head.lines().next().unwrap_or(""), root, prefix);
    let head_only = head.starts_with("HEAD ");
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    if !head_only {
        let _ = stream.write_all(&body);
    }
}

/// The status, type and body for a request line such as `GET /<secret>/report.html HTTP/1.1`.
fn respond(request: &str, root: &Path, prefix: &str) -> (&'static str, &'static str, Vec<u8>) {
    const MISSING: (&str, &str, &[u8]) = ("404 Not Found", "text/plain; charset=utf-8", b"Not found");
    let mut parts = request.split(' ');
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "GET" && method != "HEAD" {
        return ("405 Method Not Allowed", "text/plain; charset=utf-8", b"Only reading".to_vec());
    }
    let Some(rest) = target.split(['?', '#']).next().and_then(|p| p.strip_prefix(prefix)) else { return (MISSING.0, MISSING.1, MISSING.2.to_vec()) };
    match resolve(root, &decode(rest)).and_then(|file| std::fs::read(&file).ok().map(|bytes| (content_type(&file), bytes))) {
        Some((kind, bytes)) => ("200 OK", kind, bytes),
        None => (MISSING.0, MISSING.1, MISSING.2.to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str) -> (String, String) {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_once('/').unwrap();
        let mut stream = TcpStream::connect(host).unwrap();
        write!(stream, "GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut text = String::new();
        stream.read_to_string(&mut text).unwrap();
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        (head.to_owned(), body.to_owned())
    }

    #[test]
    fn the_address_is_the_same_after_a_restart_so_links_keep_working() {
        let dir = tempfile::tempdir().unwrap();
        let pages = dir.path().join("pages");
        std::fs::create_dir_all(&pages).unwrap();
        std::fs::write(pages.join("a.html"), "a").unwrap();
        let kept = dir.path().join("pages-address.json");
        let first = Pages::kept_in(pages.clone(), kept.clone()).url("pages/a.html").unwrap();
        // The first server still holds its port here, so the second takes another one but keeps the secret.
        let second = Pages::kept_in(pages, kept).url("pages/a.html").unwrap();
        let secret = |u: &str| u.split('/').nth(3).unwrap().to_owned();
        assert_eq!(secret(&first), secret(&second));
        assert_eq!(get(&second).1, "a");
    }

    #[test]
    fn a_workspace_page_opens_at_a_secret_address_and_nothing_outside_the_folder_does() {
        let dir = tempfile::tempdir().unwrap();
        let pages = dir.path().join("pages");
        std::fs::create_dir_all(pages.join("packs")).unwrap();
        std::fs::write(pages.join("packs/Veltro 60 kWh pack.html"), "<h1>Veltro</h1>").unwrap();
        std::fs::write(pages.join(".secret.html"), "hidden").unwrap();
        std::fs::write(dir.path().join("notes.md"), "private").unwrap();
        let served = Pages::new(pages);
        assert!(served.url("notes.md").is_err());
        assert!(served.url("pages/missing.html").is_err());
        assert!(!served.is_own("http://127.0.0.1:1/x"), "nothing is the person's own before anything is served");

        let url = served.url("pages/packs/Veltro 60 kWh pack.html").unwrap();
        assert!(url.ends_with("/packs/Veltro%2060%20kWh%20pack.html"), "{url}");
        assert!(served.is_own(&url));
        assert_eq!(served.file_of(&format!("{url}#:~:text=60")).as_deref(), Some("pages/packs/Veltro 60 kWh pack.html"));
        let (head, body) = get(&url);
        assert!(head.starts_with("HTTP/1.1 200") && head.contains("text/html") && head.contains("no-referrer"), "{head}");
        assert_eq!(body, "<h1>Veltro</h1>");

        let origin = url.split("/packs/").next().unwrap();
        for wrong in [format!("{origin}/../notes.md"), format!("{origin}/%2e%2e/notes.md"), format!("{origin}/.secret.html"), format!("{origin}/packs")] {
            assert!(get(&wrong).0.starts_with("HTTP/1.1 404"), "{wrong}");
        }
        // A link from an earlier start opens at today's address; an address that only looks like one does not.
        let old = format!("http://127.0.0.1:1/{}/packs/Veltro%2060%20kWh%20pack.html#top", "a".repeat(32));
        assert_eq!(served.current(&old), Some(format!("{url}#top")));
        assert_eq!(served.current(&url), None, "today's address is already right");
        assert_eq!(served.current(&format!("http://127.0.0.1:1/{}/missing.html", "a".repeat(32))), None);
        assert_eq!(served.current(&format!("http://127.0.0.1:1/{}/../notes.md", "a".repeat(32))), None);
        assert_eq!(served.current("http://127.0.0.1:1/short/packs/Veltro%2060%20kWh%20pack.html"), None);
        // Without the secret, nothing.
        let port = origin.rsplit_once('/').unwrap().0;
        assert!(get(&format!("{port}/packs/Veltro%2060%20kWh%20pack.html")).0.starts_with("HTTP/1.1 404"));
        assert!(!served.is_own(&format!("{port}/packs/x.html")));
    }
}
