//! The web engine behind the browser app: one system web view (WebView2 on Windows) per tab, stacked in the window.
//! Everything the browser app asks goes through `mobius_browser::engine::Engine`, so another engine can replace this.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::Duration;

#[cfg(not(target_os = "linux"))]
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

type Job = Box<dyn FnOnce() + Send>;

/// Like `later`, but jobs run one after another in the order they were given, on one thread. A page's events (it
/// started loading, it finished, its title) must land in order: on threads of their own, "finished" could be applied
/// before "started", and the tab stayed loading, so the agent's browser.open waited out its whole time.
fn in_order(work: impl FnOnce() + Send + 'static) {
    static QUEUE: OnceLock<Mutex<std::sync::mpsc::Sender<Job>>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (send, receive) = std::sync::mpsc::channel::<Job>();
        std::thread::spawn(move || {
            for job in receive {
                job();
            }
        });
        Mutex::new(send)
    });
    let _ = lock(queue).send(Box::new(work));
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
    /// The scripts that tell pinned tabs' pages they are pinned, by tab.
    #[cfg(windows)]
    pinned: Arc<Mutex<PinScripts>>,
}

/// Which tabs are pinned, and the id of each one's "you are pinned" script once the page has taken it.
#[cfg(windows)]
#[derive(Default)]
struct PinScripts {
    wanted: std::collections::HashSet<String>,
    ids: HashMap<String, String>,
}

impl WebViewEngine {
    pub fn new(window: Window<Wry>) -> Arc<WebViewEngine> {
        Arc::new(WebViewEngine { window, browser: Arc::new(OnceLock::new()), pages: Arc::default(), downloads: Arc::new(OnceLock::new()), keys: Arc::new(OnceLock::new()), zoom: Mutex::new(1.0), finds: Mutex::default(), #[cfg(windows)] pinned: Arc::default() })
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

/// The Escape key's virtual key code.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const ESCAPE: u32 = 0x1B;

/// Whether Shift is held down now (a link clicked with it asks for a new window).
#[cfg(windows)]
pub(crate) fn shift_held() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_SHIFT};
    // SAFETY: reads the keyboard state of this thread; no pointers.
    (unsafe { GetKeyState(i32::from(VK_SHIFT.0)) } as u16 & 0x8000) != 0
}

#[cfg(not(windows))]
pub(crate) fn shift_held() -> bool {
    false
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
                // On Windows the tab learns of the move from `watch_navigation`, which also knows whether it was a
                // click and can send it to a peek instead.
                #[cfg(windows)]
                let _ = &nav_id;
                #[cfg(not(windows))]
                if allowed && let Some(b) = weak_browser(&nav_slot) {
                    let (id, url) = (nav_id.clone(), target.to_string());
                    in_order(move || {
                        b.navigated(&id, &url, false, false);
                        b.loading(&id, true);
                    });
                }
                allowed
            })
            .on_page_load(move |webview, payload| {
                let Some(b) = weak_browser(&load_slot) else { return };
                let (id, url, finished) = (load_id.clone(), payload.url().to_string(), payload.event() == PageLoadEvent::Finished);
                in_order(move || {
                    #[cfg(windows)]
                    let (back, forward) = crate::cdp::history(&webview);
                    #[cfg(target_os = "linux")]
                    let (back, forward) = crate::linux_page::history(&webview);
                    #[cfg(not(any(windows, target_os = "linux")))]
                    let (back, forward) = (false, false);
                    b.navigated(&id, &url, back, forward);
                    if finished {
                        b.finished(&id);
                        // Reading the page and fetching its icon can take a while: not in the queue.
                        later(move || fetch_icon(&b, &id, &url));
                    } else {
                        b.loading(&id, true);
                    }
                });
            })
            .on_document_title_changed(move |_, title| {
                if let Some(b) = weak_browser(&title_slot) {
                    let id = title_id.clone();
                    in_order(move || b.titled(&id, &title));
                }
            })
            .on_new_window(move |target, _| {
                if let Some(b) = weak_browser(&window_slot) {
                    let target = target.to_string();
                    // Shift+click asks for a new window: it opens in a peek instead.
                    if shift_held() {
                        in_order(move || b.new_window_peek(&target));
                    } else {
                        in_order(move || b.new_window(&target));
                    }
                }
                NewWindowResponse::Deny
            });
        #[cfg(target_os = "linux")]
        let builder = match crate::web_data() { Some(dir) => builder.data_directory(dir), None => builder };
        #[cfg(windows)]
        let builder = match crate::webview2_args() { Some(args) => builder.additional_browser_args(&args), None => builder };
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
                    // In a pinned tab a click on a link to another site is caught in the page before anything is sent,
                    // and opens in a peek (the move below can only stop a request already on its way).
                    crate::cdp::add_document_script(&webview, LINK_SCRIPT.to_owned(), Box::new(|_| {}));
                    let (link_slot, link_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_messages(&webview, Arc::new(move |message: String| {
                        // The message comes as JSON: a string, `mobius-link:` and the address.
                        let Some(url) = serde_json::from_str::<String>(&message).ok().and_then(|m| m.strip_prefix(LINK_MESSAGE).map(str::to_owned)) else { return };
                        if let Some(b) = weak_browser(&link_slot) {
                            let id = link_id.clone();
                            in_order(move || b.link_clicked(&id, &url));
                        }
                    }));
                    // The page is moving: the tab learns where. A link clicked that leaves a pinned tab's site opens
                    // in a peek instead, and the tab stays where it is; a redirect or a script's move (no click) stays.
                    let (move_slot, move_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_navigation(&webview, Arc::new(move |url: String, clicked: bool| {
                        let Some(b) = weak_browser(&move_slot).filter(|b| b.allows_navigation(&url)) else { return false };
                        let id = move_id.clone();
                        if b.peeks_link(&id, &url, Some(clicked)) {
                            in_order(move || b.peek(Some(&url)));
                            return true;
                        }
                        in_order(move || {
                            b.navigated(&id, &url, false, false);
                            b.loading(&id, true);
                        });
                        false
                    }));
                    // Ctrl and the mouse wheel zoom the page itself: the tab learns the new factor.
                    let (zoom_slot, zoom_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_zoom(&webview, Arc::new(move |factor| {
                        if let Some(b) = weak_browser(&zoom_slot) {
                            let id = zoom_id.clone();
                            in_order(move || b.zoomed(&id, factor));
                        }
                    }));
                    // A tab shows a speaker while its page plays sound.
                    let (audio_slot, audio_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_audio(&webview, Arc::new(move |audible| {
                        if let Some(b) = weak_browser(&audio_slot) {
                            let id = audio_id.clone();
                            in_order(move || b.audible(&id, audible));
                        }
                    }));
                    // In split view the page clicked last takes the keys, and becomes the active tab.
                    let (focus_slot, focus_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_focus(&webview, Arc::new(move || {
                        if let Some(b) = weak_browser(&focus_slot) {
                            let id = focus_id.clone();
                            in_order(move || b.focused(&id));
                        }
                    }));
                    let key_slot = self.keys.clone();
                    let (escape_slot, escape_id) = (self.browser.clone(), id.clone());
                    crate::cdp::watch_keys(&webview, Arc::new(move |key, control, alt, shift| {
                        // Escape in a peek closes it.
                        if key == ESCAPE && let Some(b) = weak_browser(&escape_slot).filter(|b| b.is_peek(&escape_id)) {
                            in_order(move || b.peek(None));
                            return true;
                        }
                        key_slot.get().and_then(Weak::upgrade).is_some_and(|bridge| bridge.page_key(key, control, alt, shift))
                    }));
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
        // Without the Chromium protocol (Linux, macOS), the web view goes to the address itself.
        #[cfg(not(windows))]
        if let (Some(page), Ok(parsed)) = (self.page(tab), url::Url::parse(url)) {
            if let Err(error) = page.navigate(parsed) {
                eprintln!("[browser] could not navigate: {error}");
            }
            return;
        }
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
        #[cfg(windows)]
        {
            let mut pins = lock(&self.pinned);
            pins.wanted.remove(tab);
            pins.ids.remove(tab);
        }
    }

    fn set_pinned(&self, tab: &str, pinned: bool) {
        #[cfg(windows)]
        if let Some(page) = self.page(tab) {
            if pinned {
                if lock(&self.pinned).wanted.insert(tab.to_owned()) {
                    let (all, tab, later_page) = (self.pinned.clone(), tab.to_owned(), page.clone());
                    crate::cdp::add_document_script(&page, PINNED_SCRIPT.to_owned(), Box::new(move |script| {
                        let mut pins = lock(&all);
                        // Unpinned (or closed) before the page took it: take it away again.
                        if pins.wanted.contains(&tab) {
                            pins.ids.insert(tab, script);
                        } else {
                            drop(pins);
                            crate::cdp::remove_document_script(&later_page, script);
                        }
                    }));
                }
            } else {
                let script = {
                    let mut pins = lock(&self.pinned);
                    pins.wanted.remove(tab);
                    pins.ids.remove(tab)
                };
                if let Some(script) = script {
                    crate::cdp::remove_document_script(&page, script);
                }
            }
            // The document showing now learns it too.
            crate::cdp::run_script(&page, format!("window.__mobiusPinned = {pinned};"));
        }
        #[cfg(not(windows))]
        let _ = (tab, pinned);
    }

    fn zoom_page(&self, tab: &str, factor: f64) {
        if let Some(page) = self.page(tab) {
            let _ = page.set_zoom(factor);
        }
    }

    fn emulate(&self, tab: &str, emulation: mobius_browser::tabs::Emulation) {
        // The DevTools protocol's own overrides: they stay with the page as it navigates.
        #[cfg(windows)]
        {
            let pages = self.pages.clone();
            let tab = tab.to_owned();
            // Off this thread: a DevTools call waits for the page, which answers on the thread that owns it.
            std::thread::spawn(move || {
                let size = match emulation.width {
                    Some(width) => engine_cdp(&pages, &tab, "Emulation.setDeviceMetricsOverride", json!({ "width": width, "height": 0, "deviceScaleFactor": 0, "mobile": width < 768 })),
                    None => engine_cdp(&pages, &tab, "Emulation.clearDeviceMetricsOverride", json!({})),
                };
                let scheme = emulation.scheme.map_or("", |s| s.as_str());
                let media = engine_cdp(&pages, &tab, "Emulation.setEmulatedMedia", json!({ "features": [{ "name": "prefers-color-scheme", "value": scheme }] }));
                if let Err(e) = size.and(media) {
                    eprintln!("[mobius] could not emulate a screen for {tab}: {e}");
                }
            });
        }
        #[cfg(not(windows))]
        let _ = (tab, emulation);
    }

    fn mute(&self, tab: &str, muted: bool) {
        #[cfg(windows)]
        if let Some(page) = self.page(tab) {
            crate::cdp::set_muted(&page, muted);
        }
        #[cfg(not(windows))]
        let _ = (tab, muted);
    }

    fn layout(&self, shown: &[(String, Bounds)]) {
        let zoom = *lock(&self.zoom);
        let pages: Vec<(String, Webview<Wry>)> = lock(&self.pages).iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (id, page) in pages {
            match shown.iter().find(|(s, _)| *s == id).map(|(_, b)| *b) {
                Some(b) => {
                    let rect = Rect {
                        position: LogicalPosition::new(f64::from(b.x) * zoom, f64::from(b.y) * zoom).into(),
                        size: LogicalSize::new(f64::from(b.width) * zoom, f64::from(b.height) * zoom).into(),
                    };
                    let _ = page.set_bounds(rect);
                    #[cfg(target_os = "linux")]
                    crate::linux_views::place(&page, f64::from(b.x) * zoom, f64::from(b.y) * zoom, f64::from(b.width) * zoom, f64::from(b.height) * zoom);
                    let _ = page.show();
                }
                _ => {
                    let _ = page.hide();
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn eval(&self, tab: &str, script: &str) -> Result<Value, String> {
        crate::linux_page::eval(&self.page(tab).ok_or("no such tab")?, script, true)
    }

    #[cfg(not(target_os = "linux"))]
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

    #[cfg(target_os = "linux")]
    fn picture(&self, tab: &str) -> Option<Vec<u8>> {
        crate::linux_page::picture(&self.page(tab)?)
    }

    #[cfg(not(target_os = "linux"))]
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
    #[cfg(target_os = "linux")]
    fn cdp_fire(&self, tab: &str, expression: &str) -> Result<Value, String> {
        crate::linux_page::eval(&self.page(tab).ok_or("no such tab")?, expression, false)
    }

    #[cfg(not(target_os = "linux"))]
    fn cdp_fire(&self, tab: &str, expression: &str) -> Result<Value, String> {
        self.cdp(tab, "Runtime.evaluate", json!({ "expression": expression }))
    }
}

/// Moves the selection to the next (or first) match of the text and counts the matches. Case does not matter.
/// How `LINK_SCRIPT` starts its message.
#[cfg(windows)]
const LINK_MESSAGE: &str = "mobius-link:";

/// Tells a pinned tab's documents that they are pinned, for `LINK_SCRIPT`.
#[cfg(windows)]
const PINNED_SCRIPT: &str = "window.__mobiusPinned = true;";

/// In every tab's top document: a plain click on a link to another site, which nothing else in the page handled,
/// is not followed while the tab is pinned; the shell is told instead and opens it in a peek. It runs after the
/// page's own click handlers, so a link the page handles itself stays the page's.
#[cfg(windows)]
const LINK_SCRIPT: &str = r#"(() => {
  if (window.top !== window) return;
  const LINK_MESSAGE = 'mobius-link:';
  const site = (host) => host.toLowerCase().replace(/^www\./, '');
  addEventListener('click', (e) => {
    if (window.__mobiusPinned !== true || e.defaultPrevented || e.button !== 0) return;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    const target = a.getAttribute('target');
    if (target && target.toLowerCase() !== '_self') return;
    let to;
    try { to = new URL(a.getAttribute('href'), document.baseURI); } catch { return; }
    if (to.protocol !== 'https:' && to.protocol !== 'http:') return;
    if (site(to.hostname) === site(location.hostname)) return;
    e.preventDefault();
    // A string: Tauri's own handler sees the message first and fails on anything but text, which stops it there.
    window.chrome.webview.postMessage(LINK_MESSAGE + to.href);
  });
})();"#;

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
