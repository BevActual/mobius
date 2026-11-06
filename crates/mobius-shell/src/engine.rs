//! The web engine behind the browser app: one system web view (WebView2 on Windows) per tab, stacked in the window.
//! Everything the browser app asks goes through `mobius_browser::engine::Engine`, so another engine can replace this.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::Duration;

use base64::Engine as _;
use mobius_browser::engine::{Bounds, Engine};
use mobius_browser::tabs::Browser;
use serde_json::{Value, json};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{LogicalPosition, LogicalSize, Rect, Webview, WebviewUrl, Window, Wry};

const CDP_TIMEOUT: Duration = Duration::from_secs(10);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Run on another thread: the window toolkit calls our handlers on its own thread, which must never wait for it.
fn later(work: impl FnOnce() + Send + 'static) {
    std::thread::spawn(work);
}

pub struct WebViewEngine {
    window: Window<Wry>,
    browser: Arc<OnceLock<Weak<Browser>>>,
    pages: Pages,
    downloads: Arc<OnceLock<Weak<mobius_host::Bridge>>>,
    keys: Arc<OnceLock<Weak<mobius_host::Bridge>>>,
    /// How much the window's own interface is zoomed: page areas are placed in the same units.
    zoom: Mutex<f64>,
    finds: Mutex<HashMap<String, String>>,
}

impl WebViewEngine {
    pub fn new(window: Window<Wry>) -> Arc<WebViewEngine> {
        Arc::new(WebViewEngine { window, browser: Arc::new(OnceLock::new()), pages: Arc::default(), downloads: Arc::new(OnceLock::new()), keys: Arc::new(OnceLock::new()), zoom: Mutex::new(1.0), finds: Mutex::default() })
    }

    pub fn attach(&self, browser: &Arc<Browser>) {
        let _ = self.browser.set(Arc::downgrade(browser));
    }

    pub fn attach_downloads(&self, bridge: &Arc<mobius_host::Bridge>) {
        let _ = self.downloads.set(Arc::downgrade(bridge));
        let _ = self.keys.set(Arc::downgrade(bridge));
    }

    /// Stops the download being saved at `path`.
    pub fn cancel_download(&self, path: &std::path::Path) {
        #[cfg(windows)]
        if let Some(page) = lock(&self.pages).values().next().cloned() {
            crate::cdp::cancel_download(&page, path.to_path_buf());
        }
        #[cfg(not(windows))]
        let _ = path;
    }

    pub fn set_zoom(&self, zoom: f64) {
        *lock(&self.zoom) = zoom;
    }

    fn pages_handle(&self) -> Pages {
        self.pages.clone()
    }

    fn page(&self, tab: &str) -> Option<Webview<Wry>> {
        lock(&self.pages).get(tab).cloned()
    }

    #[cfg(windows)]
    fn cdp(&self, tab: &str, method: &str, params: Value) -> Result<Value, String> {
        let page = self.page(tab).ok_or("no such tab")?;
        let text = crate::cdp::call(&page, method, &params.to_string(), CDP_TIMEOUT)?;
        serde_json::from_str(&text).map_err(|_| "the page answered with something unreadable".to_owned())
    }

    #[cfg(not(windows))]
    fn cdp(&self, _tab: &str, _method: &str, _params: Value) -> Result<Value, String> {
        Err("pages cannot be read on this system yet".into())
    }
}

/// What the shell needs from an engine beyond the browser's own `Engine`: both engines (WebView2 and Chromium) fit it.
pub trait PageEngine: Engine {
    fn attach(&self, browser: &Arc<Browser>);
    fn attach_downloads(&self, bridge: &Arc<mobius_host::Bridge>);
    fn set_zoom(&self, zoom: f64);
    fn cancel_download(&self, path: &std::path::Path);
    /// Called as the application ends.
    fn shutdown(&self) {}
    /// What shows the pages, for the About page.
    fn name(&self) -> &'static str;
    /// For tests: runs a statement in the page itself (its own world), as if typed in its console.
    fn run_in_page(&self, _tab: &str, _code: &str) -> Result<Value, String> {
        Err("this engine is driven from outside".into())
    }
}

impl PageEngine for WebViewEngine {
    fn name(&self) -> &'static str {
        "System web view (WebView2)"
    }
    fn attach(&self, browser: &Arc<Browser>) {
        WebViewEngine::attach(self, browser);
    }
    fn attach_downloads(&self, bridge: &Arc<mobius_host::Bridge>) {
        WebViewEngine::attach_downloads(self, bridge);
    }
    fn set_zoom(&self, zoom: f64) {
        WebViewEngine::set_zoom(self, zoom);
    }
    fn cancel_download(&self, path: &std::path::Path) {
        WebViewEngine::cancel_download(self, path);
    }
}

fn weak_browser(slot: &Arc<OnceLock<Weak<Browser>>>) -> Option<Arc<Browser>> {
    slot.get().and_then(Weak::upgrade)
}

/// What a page may never do, in the names the web platform gives them.
pub(crate) const DENIED_PERMISSIONS: [&str; 10] = ["geolocation", "notifications", "midi", "camera", "microphone", "clipboard-read", "background-sync", "persistent-storage", "screen-wake-lock", "idle-detection"];

type Pages = Arc<Mutex<HashMap<String, Webview<Wry>>>>;

#[cfg(windows)]
fn engine_cdp(pages: &Pages, tab: &str, method: &str, params: Value) -> Result<Value, String> {
    let page = lock(pages).get(tab).cloned().ok_or("no such tab")?;
    let text = crate::cdp::call(&page, method, &params.to_string(), CDP_TIMEOUT)?;
    serde_json::from_str(&text).map_err(|_| "unreadable".to_owned())
}

#[cfg(not(windows))]
fn engine_cdp(_: &Pages, _: &str, _: &str, _: Value) -> Result<Value, String> {
    Err("not supported here".into())
}

impl Engine for WebViewEngine {
    fn open(&self, tab: &str, url: &str) {
        let Ok(parsed) = url.parse() else { return };
        let id = tab.to_owned();
        let slot = self.browser.clone();
        let (nav_slot, load_slot, title_slot, window_slot) = (slot.clone(), slot.clone(), slot.clone(), slot);
        let (nav_id, load_id, title_id) = (id.clone(), id.clone(), id.clone());
        let builder = WebviewBuilder::new(&id, WebviewUrl::External(parsed))
            .on_navigation(move |target| {
                let allowed = weak_browser(&nav_slot).is_none_or(|b| b.allows_navigation(target.as_str()));
                if allowed && let Some(b) = weak_browser(&nav_slot) {
                    let (id, url) = (nav_id.clone(), target.to_string());
                    later(move || {
                        b.navigated(&id, &url, false, false);
                        b.loading(&id, true);
                    });
                }
                allowed
            })
            .on_page_load(move |webview, payload| {
                let Some(b) = weak_browser(&load_slot) else { return };
                let (id, url, finished) = (load_id.clone(), payload.url().to_string(), payload.event() == PageLoadEvent::Finished);
                later(move || {
                    #[cfg(windows)]
                    let (back, forward) = crate::cdp::history(&webview);
                    #[cfg(not(windows))]
                    let (back, forward) = (false, false);
                    b.navigated(&id, &url, back, forward);
                    if finished {
                        b.finished(&id);
                        fetch_icon(&b, &id, &url);
                    } else {
                        b.loading(&id, true);
                    }
                });
            })
            .on_document_title_changed(move |_, title| {
                if let Some(b) = weak_browser(&title_slot) {
                    let id = title_id.clone();
                    later(move || b.titled(&id, &title));
                }
            })
            .on_new_window(move |target, _| {
                if let Some(b) = weak_browser(&window_slot) {
                    let target = target.to_string();
                    later(move || b.new_window(&target));
                }
                NewWindowResponse::Deny
            });
        // A page starts out of the way; `layout` places it.
        match self.window.add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)) {
            Ok(webview) => {
                let _ = webview.hide();
                #[cfg(windows)]
                {
                    crate::cdp::restrict_permissions(&webview, false);
                    if std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1") {
                        crate::cdp::disable_reputation_check(&webview);
                    }
                    // A page asking what it may do is told "denied", not "ask me".
                    let tab = id.clone();
                    let engine_pages = self.pages_handle();
                    later(move || {
                        for name in DENIED_PERMISSIONS {
                            let _ = engine_cdp(&engine_pages, &tab, "Browser.setPermission", json!({ "permission": { "name": name }, "setting": "denied" }));
                        }
                    });
                    let key_slot = self.keys.clone();
                    crate::cdp::watch_keys(&webview, Arc::new(move |key, control, alt, shift| key_slot.get().and_then(Weak::upgrade).is_some_and(|bridge| bridge.page_key(key, control, alt, shift))));
                    let (start_slot, progress_slot, end_slot) = (self.downloads.clone(), self.downloads.clone(), self.downloads.clone());
                    crate::cdp::watch_downloads(
                        &webview,
                        Arc::new(move |name| start_slot.get().and_then(Weak::upgrade).and_then(|bridge| bridge.download_requested(name))),
                        Arc::new(move |path, got, total| {
                            if let Some(bridge) = progress_slot.get().and_then(Weak::upgrade) {
                                bridge.download_progress(path, got, total);
                            }
                        }),
                        Arc::new(move |path, ok| {
                            if let Some(bridge) = end_slot.get().and_then(Weak::upgrade) {
                                bridge.download_finished(path, ok);
                            }
                        }),
                    );
                }
                lock(&self.pages).insert(id, webview);
            }
            Err(error) => eprintln!("[browser] could not open a page: {error}"),
        }
    }

    fn navigate(&self, tab: &str, url: &str) {
        if let Err(error) = self.cdp(tab, "Page.navigate", json!({ "url": url })) {
            eprintln!("[browser] could not navigate: {error}");
        }
    }

    fn back(&self, tab: &str) {
        let _ = self.cdp_fire(tab, "history.back()");
    }

    fn forward(&self, tab: &str) {
        let _ = self.cdp_fire(tab, "history.forward()");
    }

    fn reload(&self, tab: &str) {
        if let Some(page) = self.page(tab) {
            let _ = page.reload();
        }
    }

    fn close(&self, tab: &str) {
        let page = lock(&self.pages).remove(tab);
        if let Some(page) = page {
            let _ = page.close();
        }
        lock(&self.finds).remove(tab);
    }

    fn layout(&self, visible: Option<&str>, bounds: Option<Bounds>) {
        let zoom = *lock(&self.zoom);
        let pages: Vec<(String, Webview<Wry>)> = lock(&self.pages).iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (id, page) in pages {
            match (visible, bounds) {
                (Some(shown), Some(b)) if shown == id => {
                    let rect = Rect {
                        position: LogicalPosition::new(f64::from(b.x) * zoom, f64::from(b.y) * zoom).into(),
                        size: LogicalSize::new(f64::from(b.width) * zoom, f64::from(b.height) * zoom).into(),
                    };
                    let _ = page.set_bounds(rect);
                    let _ = page.show();
                }
                _ => {
                    let _ = page.hide();
                }
            }
        }
    }

    fn eval(&self, tab: &str, script: &str) -> Result<Value, String> {
        // A world of its own sees the page's DOM but none of the page's scripts or globals.
        let frame = self.cdp(tab, "Page.getFrameTree", json!({}))?;
        let frame_id = frame.pointer("/frameTree/frame/id").and_then(Value::as_str).ok_or("the page has no frame")?.to_owned();
        let world = self.cdp(tab, "Page.createIsolatedWorld", json!({ "frameId": frame_id, "worldName": "mobius" }))?;
        let context = world.get("executionContextId").cloned().ok_or("the page could not be reached")?;
        let answer = self.cdp(tab, "Runtime.evaluate", json!({ "expression": script, "contextId": context, "awaitPromise": true, "returnByValue": true }))?;
        if answer.get("exceptionDetails").is_some() {
            return Err("the page script failed".into());
        }
        Ok(answer.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    fn picture(&self, tab: &str) -> Option<Vec<u8>> {
        let shot = self.cdp(tab, "Page.captureScreenshot", json!({ "format": "jpeg", "quality": 70 })).ok()?;
        base64::engine::general_purpose::STANDARD.decode(shot.get("data")?.as_str()?).ok()
    }

    fn find(&self, tab: &str, text: &str, forward: bool, again: bool) {
        let Some(browser) = weak_browser(&self.browser) else { return };
        let (id, text) = (tab.to_owned(), text.to_owned());
        let repeat = again && lock(&self.finds).get(tab).is_some_and(|t| *t == text);
        lock(&self.finds).insert(id.clone(), text.clone());
        let script = format!("({FIND_SCRIPT})({},{},{})", json!(text), json!(forward), json!(repeat));
        let engine_pages = self.page(tab).is_some();
        if !engine_pages {
            return;
        }
        let outcome = self.eval(tab, &script);
        if let Ok(result) = outcome {
            let active = result.get("active").and_then(Value::as_u64).unwrap_or(0);
            let matches = result.get("matches").and_then(Value::as_u64).unwrap_or(0);
            browser.found(&id, active, matches);
        }
    }

    fn stop_find(&self, tab: &str) {
        lock(&self.finds).remove(tab);
        let _ = self.eval(tab, "(() => { getSelection()?.removeAllRanges(); return true; })()");
    }
}

impl WebViewEngine {
    /// Runs a statement in the page itself (not the isolated world): used only for history navigation.
    fn cdp_fire(&self, tab: &str, expression: &str) -> Result<Value, String> {
        self.cdp(tab, "Runtime.evaluate", json!({ "expression": expression }))
    }
}

/// Moves the selection to the next (or first) match of the text and counts the matches. Case does not matter.
const FIND_SCRIPT: &str = r#"((text, forward, again) => {
  const needle = text.toLowerCase();
  const nodes = [];
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    nodes.push(n);
  }
  const matches = [];
  for (const node of nodes) {
    const hay = node.data.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + Math.max(needle.length, 1))) matches.push({ node, at });
  }
  if (matches.length === 0) { getSelection()?.removeAllRanges(); return { active: 0, matches: 0 }; }
  const sel = getSelection();
  let current = -1;
  if (again && sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    current = matches.findIndex((m) => m.node === r.startContainer && m.at === r.startOffset);
  }
  const next = current < 0 ? (forward ? 0 : matches.length - 1) : (current + (forward ? 1 : -1) + matches.length) % matches.length;
  const m = matches[next];
  const range = document.createRange();
  range.setStart(m.node, m.at);
  range.setEnd(m.node, m.at + needle.length);
  sel.removeAllRanges();
  sel.addRange(range);
  (m.node.parentElement ?? document.body).scrollIntoView({ block: 'center' });
  return { active: next + 1, matches: matches.length };
})"#;

/// The icons a page offers, as absolute addresses; the site's default is last.
const ICON_SCRIPT: &str = r#"(() => {
  const found = [...document.querySelectorAll('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]')].map((l) => l.href).filter(Boolean);
  found.push(new URL('/favicon.ico', location.href).href);
  return found;
})()"#;

/// Asks the page for its icon and fetches it, then tells the browser. A page without a usable icon just shows the plain tab.
pub(crate) fn fetch_icon(browser: &Arc<Browser>, id: &str, page_url: &str) {
    use mobius_browser::favicon::{MAX_ICON_BYTES, icon_data_url};
    use mobius_browser::net_rules::{UrlCheck, check_agent_url};
    let Ok(Value::Array(found)) = browser.eval(id, ICON_SCRIPT) else { return };
    let offered: Vec<String> = found.into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect();
    let Some(url) = browser.icon_offered(id, &offered) else { return };
    // An icon from another host is fetched only if that host is a public one: a page cannot aim this at the local network.
    let host_of = |u: &str| url::Url::parse(u).ok().and_then(|u| u.host_str().map(str::to_lowercase));
    if host_of(&url) != host_of(page_url) {
        let resolve = |host: &str| {
            use std::net::ToSocketAddrs;
            (host, 443).to_socket_addrs().ok().map(|a| a.map(|s| s.ip().to_string()).collect::<Vec<_>>())
        };
        if !matches!(check_agent_url(&url, resolve), UrlCheck::Ok) {
            return;
        }
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(5))).build().into();
    let Ok(mut response) = agent.get(&url).call() else { return };
    let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let Ok(bytes) = response.body_mut().with_config().limit(MAX_ICON_BYTES as u64).read_to_vec() else { return };
    browser.icon(id, &url, icon_data_url(content_type.as_deref(), &bytes));
}
