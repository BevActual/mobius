//! Code's preview: a project's folder served on this computer only, so its page runs in the Browser beside the editor
//! with its own scripts (the window's own content rules stop that inside the window). Read-only, files under the
//! folder only, GET and HEAD only, and only to requests that name this server's own address (so another site cannot
//! reach it through a name that points at this computer). One server per project, stopped when Code stops it or
//! Mobius quits.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Requests larger than this (the request line and headers) are refused.
const MAX_HEAD: usize = 16 * 1024;
/// Files larger than this are not served.
const MAX_FILE: u64 = 64 * 1024 * 1024;

struct Running {
    url: String,
    stop: Arc<AtomicBool>,
    addr: SocketAddr,
}

/// The preview servers, by project.
#[derive(Default)]
pub struct Previews {
    running: Mutex<HashMap<String, Running>>,
}

impl Previews {
    /// Serves `dir` for `project` (or says where it already is) and answers its address.
    pub fn serve(&self, project: &str, dir: &Path) -> Result<String, String> {
        let mut running = self.running.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(r) = running.get(project) {
            return Ok(r.url.clone());
        }
        let root = dir.canonicalize().map_err(|e| format!("the project's folder cannot be read: {e}"))?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no preview server: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        let url = format!("http://127.0.0.1:{}/", addr.port());
        let stop = Arc::new(AtomicBool::new(false));
        let (flag, port) = (Arc::clone(&stop), addr.port());
        std::thread::Builder::new()
            .name("mobius-preview".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    if flag.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Ok(stream) = stream {
                        let root = root.clone();
                        std::thread::spawn(move || answer(stream, &root, port));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        running.insert(project.to_owned(), Running { url: url.clone(), stop, addr });
        Ok(url)
    }

    /// Stops the project's preview server, if it runs.
    pub fn stop(&self, project: &str) {
        let gone = self.running.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(project);
        if let Some(r) = gone {
            r.stop.store(true, Ordering::Relaxed);
            // Wakes the accept loop so it sees the flag.
            let _ = TcpStream::connect_timeout(&r.addr, Duration::from_millis(200));
        }
    }
}

impl Drop for Previews {
    fn drop(&mut self) {
        let names: Vec<String> = self.running.lock().map(|r| r.keys().cloned().collect()).unwrap_or_default();
        for name in names {
            self.stop(&name);
        }
    }
}

fn answer(mut stream: TcpStream, root: &Path, port: u16) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut head = Vec::new();
    loop {
        let mut line = Vec::new();
        match reader.by_ref().take(MAX_HEAD as u64).read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let end = line == b"\r\n" || line == b"\n";
        head.extend_from_slice(&line);
        if end {
            break;
        }
        if head.len() > MAX_HEAD {
            reply(&mut stream, 431, "text/plain", b"Too large", false);
            return;
        }
    }
    let text = String::from_utf8_lossy(&head);
    let mut lines = text.lines();
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let host = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("host")).map(|(_, v)| v.trim().to_owned()));
    if !host_ok(host.as_deref(), port) {
        reply(&mut stream, 403, "text/plain", b"Forbidden", false);
        return;
    }
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        reply(&mut stream, 405, "text/plain", b"Only GET", false);
        return;
    }
    match resolve(root, target) {
        Some(path) => match std::fs::metadata(&path) {
            Ok(m) if m.len() <= MAX_FILE => match std::fs::read(&path) {
                Ok(body) => reply(&mut stream, 200, content_type(&path), &body, head_only),
                Err(_) => reply(&mut stream, 404, "text/plain", b"Not found", head_only),
            },
            _ => reply(&mut stream, 404, "text/plain", b"Not found", head_only),
        },
        None => reply(&mut stream, 404, "text/plain", b"Not found", head_only),
    }
}

/// Only requests naming this server itself: 127.0.0.1 or localhost, on its port.
fn host_ok(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    host == format!("127.0.0.1:{port}") || host.eq_ignore_ascii_case(&format!("localhost:{port}"))
}

/// The file a request names, inside `root` only: no `..`, no absolute parts, and nothing that leads outside through a
/// link. A folder answers its `index.html`.
fn resolve(root: &Path, target: &str) -> Option<PathBuf> {
    let path = target.split(['?', '#']).next()?;
    let decoded = percent_decode(path)?;
    let mut out = root.to_path_buf();
    for part in Path::new(decoded.trim_start_matches('/')).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.is_dir() {
        out.push("index.html");
    }
    let real = out.canonicalize().ok()?;
    (real.starts_with(root) && real.is_file()).then_some(real)
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let text = String::from_utf8(out).ok()?;
    (!text.contains('\0') && !text.contains('\\')).then_some(text)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("wasm") => "application/wasm",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn reply(stream: &mut TcpStream, status: u16, kind: &str, body: &[u8], head_only: bool) {
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Request Header Fields Too Large",
    };
    let head = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str, host: Option<&str>) -> (u16, String) {
        let rest = url.trim_start_matches("http://");
        let (addr, path) = rest.split_once('/').map(|(a, p)| (a, format!("/{p}"))).unwrap();
        let mut s = TcpStream::connect(addr).unwrap();
        let host = host.map_or_else(|| addr.to_owned(), str::to_owned);
        write!(s, "GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let status = out.split(' ').nth(1).unwrap().parse().unwrap();
        (status, out.split("\r\n\r\n").nth(1).unwrap_or("").to_owned())
    }

    #[test]
    fn serves_the_folder_and_nothing_outside_it() {
        let dir = tempfile::tempdir().unwrap();
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("js")).unwrap();
        std::fs::write(site.join("index.html"), "<h1>Hi</h1>").unwrap();
        std::fs::write(site.join("js/app.js"), "console.log(1)").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "no").unwrap();
        let previews = Previews::default();
        let url = previews.serve("site", &site).unwrap();
        assert_eq!(previews.serve("site", &site).unwrap(), url, "one server per project");
        assert_eq!(get(&url, None), (200, "<h1>Hi</h1>".to_owned()));
        assert_eq!(get(&format!("{url}js/app.js?v=2"), None).0, 200);
        assert_eq!(get(&format!("{url}../secret.txt"), None).0, 404);
        assert_eq!(get(&format!("{url}%2e%2e/secret.txt"), None).0, 404);
        assert_eq!(get(&format!("{url}missing.html"), None).0, 404);
        // Another name pointing at this computer is refused.
        assert_eq!(get(&url, Some("evil.test")).0, 403);
        previews.stop("site");
    }
}
