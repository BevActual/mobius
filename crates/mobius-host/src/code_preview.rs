//! Code's preview: a project's folder served on this computer only, so its page runs in the Browser beside the editor
//! with its own scripts (the window's own content rules stop that inside the window). Read-only, files under the
//! folder only, and only to requests that name this server's own address (so another site cannot reach it through a
//! name that points at this computer). One server per project, stopped when Code stops it or Mobius quits.
//!
//! Each HTML page it serves carries a small script of Mobius's (`/__mobius/preview.js`) that tells Code what the page
//! does: its errors, and the element the person picks. The script hears Code through `/__mobius/events` (reload, pick)
//! and reports with a POST to `/__mobius/report`, which only the page itself may send (its Origin is this server).
//! Engine-free: it works the same in every browser that shows the page.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Map, Value};

/// Requests larger than this (the request line and headers) are refused.
const MAX_HEAD: usize = 16 * 1024;
/// Files larger than this are not served.
const MAX_FILE: u64 = 64 * 1024 * 1024;
/// A page's report larger than this is refused.
const MAX_REPORT: usize = 16 * 1024;
/// Pages listening for Code at once, per project; the oldest is let go first (a reload leaves its old one behind).
const MAX_LISTENERS: usize = 32;
const SCRIPT_PATH: &str = "/__mobius/preview.js";
const EVENTS_PATH: &str = "/__mobius/events";
const REPORT_PATH: &str = "/__mobius/report";
const SCRIPT_TAG: &str = "<script src=\"/__mobius/preview.js\"></script>";

/// Where a page's reports go: `{ kind, ... }`, already checked and cut to size.
pub type Report = Arc<dyn Fn(Value) + Send + Sync>;

/// What Code can tell the pages of a project.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Say {
    Reload,
    Pick,
    StopPick,
}

impl Say {
    #[must_use]
    pub fn parse(text: &str) -> Option<Say> {
        match text {
            "reload" => Some(Say::Reload),
            "pick" => Some(Say::Pick),
            "stopPick" => Some(Say::StopPick),
            _ => None,
        }
    }
    fn word(self) -> &'static str {
        match self {
            Say::Reload => "reload",
            Say::Pick => "pick",
            Say::StopPick => "stopPick",
        }
    }
}

type Listeners = Arc<Mutex<Vec<TcpStream>>>;

struct Running {
    url: String,
    stop: Arc<AtomicBool>,
    addr: SocketAddr,
    listeners: Listeners,
}

/// The preview servers, by project.
#[derive(Default)]
pub struct Previews {
    running: Mutex<HashMap<String, Running>>,
}

struct Server {
    root: PathBuf,
    port: u16,
    listeners: Listeners,
    report: Report,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Previews {
    /// Serves `dir` for `project` (or says where it already is) and answers its address. The pages' reports go to
    /// `report`, each with the project's name added.
    pub fn serve(&self, project: &str, dir: &Path, report: Report) -> Result<String, String> {
        let mut running = lock(&self.running);
        if let Some(r) = running.get(project) {
            return Ok(r.url.clone());
        }
        let root = dir.canonicalize().map_err(|e| format!("the project's folder cannot be read: {e}"))?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no preview server: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        let url = format!("http://127.0.0.1:{}/", addr.port());
        let stop = Arc::new(AtomicBool::new(false));
        let listeners: Listeners = Arc::default();
        let name = project.to_owned();
        let server = Arc::new(Server {
            root,
            port: addr.port(),
            listeners: Arc::clone(&listeners),
            report: Arc::new(move |mut v: Value| {
                if let Some(o) = v.as_object_mut() {
                    o.insert("project".into(), Value::String(name.clone()));
                }
                report(v);
            }),
        });
        let flag = Arc::clone(&stop);
        std::thread::Builder::new()
            .name("mobius-preview".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    if flag.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Ok(stream) = stream {
                        let server = Arc::clone(&server);
                        std::thread::spawn(move || answer(stream, &server));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        running.insert(project.to_owned(), Running { url: url.clone(), stop, addr, listeners });
        Ok(url)
    }

    /// Tells the project's open pages something; answers how many heard it, or None when nothing is served.
    pub fn say(&self, project: &str, what: Say) -> Option<usize> {
        let listeners = Arc::clone(&lock(&self.running).get(project)?.listeners);
        let mut pages = lock(&listeners);
        let line = format!("data: {}\n\n", what.word());
        pages.retain_mut(|s| s.write_all(line.as_bytes()).and_then(|()| s.flush()).is_ok());
        Some(pages.len())
    }

    /// Stops the project's preview server, if it runs.
    pub fn stop(&self, project: &str) {
        let gone = lock(&self.running).remove(project);
        if let Some(r) = gone {
            r.stop.store(true, Ordering::Relaxed);
            for page in lock(&r.listeners).drain(..) {
                let _ = page.shutdown(std::net::Shutdown::Both);
            }
            // Wakes the accept loop so it sees the flag.
            let _ = TcpStream::connect_timeout(&r.addr, Duration::from_millis(200));
        }
    }
}

impl Drop for Previews {
    fn drop(&mut self) {
        let names: Vec<String> = lock(&self.running).keys().cloned().collect();
        for name in names {
            self.stop(&name);
        }
    }
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim()))
}

fn answer(mut stream: TcpStream, server: &Server) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
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
    let mut first = text.lines().next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    if !host_ok(header(&text, "host"), server.port) {
        reply(&mut stream, 403, "text/plain", b"Forbidden", false);
        return;
    }
    let path = target.split(['?', '#']).next().unwrap_or("");
    if method == "POST" && path == REPORT_PATH {
        // Only the page itself reports: a page of another site sends its own Origin, and is refused.
        if !origin_ok(header(&text, "origin"), server.port) {
            reply(&mut stream, 403, "text/plain", b"Forbidden", false);
            return;
        }
        let Some(len) = header(&text, "content-length").and_then(|v| v.parse::<usize>().ok()).filter(|n| *n <= MAX_REPORT) else {
            reply(&mut stream, 413, "text/plain", b"Too large", false);
            return;
        };
        let mut body = vec![0; len];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        match serde_json::from_slice::<Value>(&body).ok().and_then(|v| checked_report(&v)) {
            Some(report) => {
                (server.report)(report);
                reply(&mut stream, 204, "text/plain", b"", false);
            }
            None => reply(&mut stream, 400, "text/plain", b"Not a report", false),
        }
        return;
    }
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        reply(&mut stream, 405, "text/plain", b"Only GET", false);
        return;
    }
    if path == SCRIPT_PATH {
        reply(&mut stream, 200, "text/javascript; charset=utf-8", PREVIEW_SCRIPT.as_bytes(), head_only);
        return;
    }
    if path == EVENTS_PATH && !head_only {
        let start = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n: ready\n\n";
        // Listed in the same hold as the opening is written, so a page that has heard ": ready" hears what is said
        // next, and nothing said is written before the opening.
        let mut pages = lock(&server.listeners);
        if stream.write_all(start.as_bytes()).is_ok() {
            let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
            if pages.len() >= MAX_LISTENERS {
                pages.remove(0);
            }
            pages.push(stream);
        }
        return;
    }
    match resolve(&server.root, target) {
        Some(path) => match std::fs::metadata(&path) {
            Ok(m) if m.len() <= MAX_FILE => match std::fs::read(&path) {
                Ok(body) => {
                    let kind = content_type(&path);
                    let body = if kind.starts_with("text/html") { with_script(&body) } else { body };
                    reply(&mut stream, 200, kind, &body, head_only);
                }
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

/// A report comes from a page of this server only.
fn origin_ok(origin: Option<&str>, port: u16) -> bool {
    origin.and_then(|o| o.strip_prefix("http://")).is_some_and(|host| host_ok(Some(host), port))
}

/// A page's report, kept to what Code reads and cut to size: anything else is dropped.
fn checked_report(v: &Value) -> Option<Value> {
    let o = v.as_object()?;
    let kind = o.get("kind")?.as_str()?;
    let fields: &[(&str, usize)] = match kind {
        "error" => &[("message", 2000), ("source", 500), ("stack", 4000)],
        "pick" => &[("selector", 500), ("tag", 40), ("text", 500), ("html", 2000), ("path", 500)],
        "loaded" => &[("path", 500), ("title", 200)],
        "pickCancelled" => &[],
        _ => return None,
    };
    let mut out = Map::new();
    out.insert("kind".into(), Value::String(kind.to_owned()));
    for (name, most) in fields {
        if let Some(text) = o.get(*name).and_then(Value::as_str) {
            out.insert((*name).into(), Value::String(text.chars().take(*most).collect()));
        }
    }
    if kind == "error" {
        out.get("message")?;
        for name in ["line", "column"] {
            if let Some(n) = o.get(name).and_then(Value::as_u64) {
                out.insert(name.into(), Value::from(n));
            }
        }
    }
    Some(Value::Object(out))
}

/// The page with Mobius's script first in its head, so it hears every error. A page without a head gets it after its
/// `<html>` or its doctype, never before the doctype, which would put the page in quirks mode.
fn with_script(body: &[u8]) -> Vec<u8> {
    let lower = body.to_ascii_lowercase();
    let at = [&b"<head"[..], b"<html", b"<!doctype"].iter().find_map(|tag| after_tag(&lower, tag)).unwrap_or(0);
    let mut out = Vec::with_capacity(body.len() + SCRIPT_TAG.len());
    out.extend_from_slice(&body[..at]);
    out.extend_from_slice(SCRIPT_TAG.as_bytes());
    out.extend_from_slice(&body[at..]);
    out
}

/// Just past the first `<tag ...>` (the name whole: `<head` is not `<header`).
fn after_tag(lower: &[u8], tag: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(at) = find(&lower[from..], tag).map(|i| from + i) {
        let next = lower.get(at + tag.len()).copied();
        if matches!(next, Some(b'>' | b' ' | b'\t' | b'\n' | b'\r' | b'/')) {
            return lower[at..].iter().position(|&b| b == b'>').map(|end| at + end + 1);
        }
        from = at + tag.len();
    }
    None
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
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
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Content Too Large",
        _ => "Request Header Fields Too Large",
    };
    let head = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

/// In each served page: reports its errors and the element the person picks, and hears Code (reload, pick).
const PREVIEW_SCRIPT: &str = r#"(() => {
  if (window.top !== window || window.__mobiusPreview) return;
  window.__mobiusPreview = true;
  let sent = 0;
  const report = (what) => {
    if (sent++ >= 100) return;
    try { fetch('/__mobius/report', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(what), keepalive: true }).catch(() => {}); } catch {}
  };
  const here = (url) => { try { const u = new URL(url, location.href); return u.origin === location.origin ? u.pathname : u.href; } catch { return String(url || ''); } };
  const said = (a) => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })();
  addEventListener('error', (e) => {
    const t = e.target;
    if (t instanceof Element) {
      const src = t.getAttribute('src') || t.getAttribute('href') || t.tagName.toLowerCase();
      report({ kind: 'error', message: 'Could not load ' + src, source: here(location.href) });
      return;
    }
    report({ kind: 'error', message: e.message || said(e.error), source: here(e.filename), line: e.lineno, column: e.colno, stack: e.error && e.error.stack ? String(e.error.stack) : undefined });
  }, true);
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report({ kind: 'error', message: 'Unhandled rejection: ' + (r && r.message ? r.message : said(r)), stack: r && r.stack ? String(r.stack) : undefined });
  });
  const pageError = console.error;
  console.error = function (...args) {
    report({ kind: 'error', message: args.map(said).join(' ') });
    return pageError.apply(this, args);
  };
  let picking = false, box = null, over = null;
  const selectorOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase() + [...n.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      const p = n.parentElement;
      if (p) { const same = [...p.children].filter((c) => c.tagName === n.tagName); if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'; }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const show = (el) => {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('data-mobius-pick', '');
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px dashed #6366f1;background:rgba(99,102,241,.08);border-radius:2px;transition:all 80ms ease-out;';
      document.documentElement.appendChild(box);
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'block' });
  };
  const stop = () => { picking = false; over = null; if (box) box.style.display = 'none'; document.documentElement.style.cursor = ''; };
  addEventListener('mousemove', (e) => { if (picking && e.target instanceof Element && e.target !== box) { over = e.target; show(over); } }, true);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) addEventListener(type, (e) => { if (picking) { e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener('click', (e) => {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target instanceof Element ? e.target : over;
    stop();
    if (el) report({ kind: 'pick', selector: selectorOf(el), tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim(), html: el.outerHTML, path: here(location.href) });
  }, true);
  addEventListener('keydown', (e) => { if (picking && e.key === 'Escape') { e.preventDefault(); stop(); report({ kind: 'pickCancelled' }); } }, true);
  const events = new EventSource('/__mobius/events');
  events.onmessage = (m) => {
    if (m.data === 'reload') location.reload();
    else if (m.data === 'pick') { picking = true; document.documentElement.style.cursor = 'crosshair'; }
    else if (m.data === 'stopPick') stop();
  };
  // When the preview stops (Code stopped it, or opened another project), the page says so rather than looking live.
  let heard = false;
  events.onopen = () => { heard = true; };
  events.onerror = () => {
    if (!heard) return;
    fetch('/__mobius/preview.js', { method: 'HEAD', cache: 'no-store' }).then(() => {}, () => {
      events.close();
      if (document.getElementById('__mobius-stopped')) return;
      const note = document.createElement('div');
      note.id = '__mobius-stopped';
      note.setAttribute('role', 'status');
      note.textContent = 'This preview has stopped. Open Preview in Code to see the page again.';
      note.style.cssText = 'all:initial;position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;background:#1f1f22;color:#f4f4f5;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
      document.documentElement.appendChild(note);
    });
  };
  addEventListener('DOMContentLoaded', () => report({ kind: 'loaded', path: here(location.href), title: document.title }));
})();"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn send(url: &str, request: &str) -> (u16, String) {
        let addr = url.trim_start_matches("http://").trim_end_matches('/');
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(request.replace("{addr}", addr).as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let status = out.split(' ').nth(1).unwrap().parse().unwrap();
        (status, out.split("\r\n\r\n").nth(1).unwrap_or("").to_owned())
    }

    fn get(url: &str, path: &str, host: Option<&str>) -> (u16, String) {
        let host = host.unwrap_or("{addr}");
        send(url, &format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n"))
    }

    fn post(url: &str, origin: &str, body: &str) -> u16 {
        send(url, &format!("POST /__mobius/report HTTP/1.1\r\nHost: {{addr}}\r\nOrigin: {origin}\r\nContent-Length: {}\r\n\r\n{body}", body.len())).0
    }

    fn site() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("js")).unwrap();
        std::fs::write(site.join("index.html"), "<html><head><title>Hi</title></head><h1>Hi</h1>").unwrap();
        std::fs::write(site.join("js/app.js"), "console.log(1)").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "no").unwrap();
        (dir, site)
    }

    fn quiet() -> Report {
        Arc::new(|_| {})
    }

    #[test]
    fn serves_the_folder_and_nothing_outside_it() {
        let (_dir, site) = site();
        let previews = Previews::default();
        let url = previews.serve("site", &site, quiet()).unwrap();
        assert_eq!(previews.serve("site", &site, quiet()).unwrap(), url, "one server per project");
        assert_eq!(get(&url, "", None), (200, format!("<html><head>{SCRIPT_TAG}<title>Hi</title></head><h1>Hi</h1>")));
        assert_eq!(get(&url, "js/app.js?v=2", None), (200, "console.log(1)".to_owned()), "only pages carry the script");
        assert_eq!(get(&url, "__mobius/preview.js", None).0, 200);
        assert_eq!(get(&url, "../secret.txt", None).0, 404);
        assert_eq!(get(&url, "%2e%2e/secret.txt", None).0, 404);
        assert_eq!(get(&url, "missing.html", None).0, 404);
        // Another name pointing at this computer is refused.
        assert_eq!(get(&url, "", Some("evil.test")).0, 403);
        previews.stop("site");
    }

    #[test]
    fn a_page_without_a_head_gets_the_script_first() {
        assert_eq!(with_script(b"<h1>x</h1>"), format!("{SCRIPT_TAG}<h1>x</h1>").into_bytes());
        assert_eq!(with_script(b"<!doctype html><HEAD lang=en><b>"), format!("<!doctype html><HEAD lang=en>{SCRIPT_TAG}<b>").into_bytes());
        // Never before the doctype (quirks mode), and a <header> is not the head.
        assert_eq!(with_script(b"<!DOCTYPE html>\n<title>x</title>"), format!("<!DOCTYPE html>{SCRIPT_TAG}\n<title>x</title>").into_bytes());
        assert_eq!(with_script(b"<!doctype html><html lang=en><header>h</header>"), format!("<!doctype html><html lang=en>{SCRIPT_TAG}<header>h</header>").into_bytes());
    }

    #[test]
    fn only_the_page_itself_reports_and_only_what_code_reads() {
        let (_dir, site) = site();
        let seen: Arc<Mutex<Vec<Value>>> = Arc::default();
        let into = Arc::clone(&seen);
        let previews = Previews::default();
        let url = previews.serve("site", &site, Arc::new(move |v| lock(&into).push(v))).unwrap();
        let own = url.trim_end_matches('/');
        let error = r#"{"kind":"error","message":"x is not defined","source":"/js/app.js","line":3,"column":7,"extra":"dropped"}"#;
        assert_eq!(post(&url, own, error), 204);
        assert_eq!(post(&url, "http://evil.test", error), 403, "another site's page");
        assert_eq!(post(&url, "null", error), 403);
        assert_eq!(post(&url, own, r#"{"kind":"run","message":"no"}"#), 400);
        assert_eq!(post(&url, own, &format!(r#"{{"kind":"pick","tag":"h1","text":"{}"}}"#, "a".repeat(900))), 204);
        let seen = lock(&seen).clone();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0], serde_json::json!({ "kind": "error", "message": "x is not defined", "source": "/js/app.js", "line": 3, "column": 7, "project": "site" }));
        assert_eq!(seen[1]["text"].as_str().unwrap().len(), 500, "cut to size");
        previews.stop("site");
    }

    #[test]
    fn code_is_heard_by_the_open_pages() {
        let (_dir, site) = site();
        let previews = Previews::default();
        assert_eq!(previews.say("site", Say::Pick), None, "nothing served");
        let url = previews.serve("site", &site, quiet()).unwrap();
        assert_eq!(previews.say("site", Say::Pick), Some(0));
        let addr = url.trim_start_matches("http://").trim_end_matches('/');
        let mut page = TcpStream::connect(addr).unwrap();
        write!(page, "GET /__mobius/events HTTP/1.1\r\nHost: {addr}\r\n\r\n").unwrap();
        page.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut reader = BufReader::new(page);
        let mut line = String::new();
        while line != ": ready\n" {
            line.clear();
            reader.read_line(&mut line).unwrap();
        }
        assert_eq!(previews.say("site", Say::Reload), Some(1));
        let mut heard = String::new();
        while !heard.starts_with("data:") {
            heard.clear();
            reader.read_line(&mut heard).unwrap();
        }
        assert_eq!(heard, "data: reload\n");
        previews.stop("site");
    }
}
