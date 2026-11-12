//! The Chromium engine (CEF) behind the browser app. Same job as `engine.rs` (WebView2), another implementation of
//! `mobius_browser::engine::Engine`: one Chromium everywhere, with real download, permission and key hooks.
//!
//! CEF runs its own UI thread (`multi_threaded_message_loop`); each tab is a child window of the Mobius window. Anything
//! that touches a CEF object is posted to that thread. Events go to the browser app through one ordered queue.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::Duration;

use base64::Engine as _;
use mobius_browser::engine::{Bounds, Engine};
use serde_json::{Value, json};

/// The inner radius, in points, of the frame a page sits in (`--radius-panel` less its border); the native page window is cut to match.
#[cfg_attr(not(windows), allow(dead_code))]
const PAGE_RADIUS: f64 = 7.0;

const CDP_TIMEOUT: Duration = Duration::from_secs(10);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

type Work = Box<dyn FnOnce() + Send>;

/// One thread runs everything the browser app is told, in the order it happened.
fn later(work: impl FnOnce() + Send + 'static) {
    static QUEUE: OnceLock<Sender<Work>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (send, receive) = channel::<Work>();
        std::thread::spawn(move || {
            for job in receive {
                job();
            }
        });
        send
    });
    let _ = queue.send(Box::new(work));
}

/// Where the engine keeps what it is told about the application.
#[derive(Default)]
pub struct Links {
    tabs: OnceLock<Weak<mobius_browser::tabs::Browser>>,
    bridge: OnceLock<Weak<mobius_host::Bridge>>,
}

impl Links {
    fn tabs(&self) -> Option<Arc<mobius_browser::tabs::Browser>> {
        self.tabs.get().and_then(Weak::upgrade)
    }
    fn bridge(&self) -> Option<Arc<mobius_host::Bridge>> {
        self.bridge.get().and_then(Weak::upgrade)
    }
}

mod chromium {
    use super::*;
    use cef::*;
    type Json = serde_json::Value;

    /// A tab as the engine knows it.
    #[derive(Default)]
    pub struct TabState {
        pub browser: Option<cef::Browser>,
        pub registration: Option<Registration>,
        pub url: String,
        pub can_back: bool,
        pub can_forward: bool,
    }

    #[derive(Default, Clone)]
    pub struct FindState {
        pub text: String,
        pub active: u64,
        pub step: i64,
    }

    pub struct Shared {
        pub links: Links,
        pub tabs: Mutex<HashMap<String, TabState>>,
        pub by_id: Mutex<HashMap<i32, String>>,
        pub waiting: Mutex<HashMap<i32, Sender<Result<Json, String>>>>,
        pub next_call: AtomicI32,
        pub downloads: Mutex<HashMap<PathBuf, DownloadItemCallback>>,
        pub download_paths: Mutex<HashMap<u32, PathBuf>>,
        pub shown: Mutex<(Option<String>, Option<Bounds>)>,
        pub window: isize,
        pub scale: Box<dyn Fn() -> f64 + Send + Sync>,
        pub zoom: Mutex<f64>,
        pub ready: AtomicBool,
        pub before_ready: Mutex<Vec<Work>>,
        /// Per tab: the text searched for, the match shown last, and which way the next step goes (0 for a new search).
        pub finds: Mutex<HashMap<String, FindState>>,
    }

    impl Shared {
        pub fn context_ready(&self) {
            self.ready.store(true, Ordering::SeqCst);
            let jobs = std::mem::take(&mut *lock(&self.before_ready));
            for job in jobs {
                job();
            }
        }

        /// Runs on CEF's UI thread, now if already there, and after start-up if CEF is not ready yet.
        pub fn ui(self: &Arc<Self>, work: impl FnOnce() + Send + 'static) {
            if !self.ready.load(Ordering::SeqCst) {
                let mut waiting = lock(&self.before_ready);
                if !self.ready.load(Ordering::SeqCst) {
                    waiting.push(Box::new(move || run_on_ui(work)));
                    return;
                }
            }
            run_on_ui(work);
        }
    }

    fn run_on_ui(work: impl FnOnce() + Send + 'static) {
        if currently_on(ThreadId::UI) != 0 {
            work();
            return;
        }
        let mut task = UiTask::new(Arc::new(Mutex::new(Some(Box::new(work) as Work))));
        post_task(ThreadId::UI, Some(&mut task));
    }

    wrap_task! {
        struct UiTask {
            work: Arc<Mutex<Option<Work>>>,
        }
        impl Task {
            fn execute(&self) {
                if let Some(work) = lock(&self.work).take() {
                    work();
                }
            }
        }
    }

    // ---- the application object: tells us when browsers may be created ----
    wrap_app! {
        pub struct MobiusApp {
            shared: Arc<Shared>,
        }
        impl App {
            // Chromium's GPU process dies on this machine's driver and the pages then never paint, so drawing is done in software.
            // Pages are drawn by a child window; nothing here is graphics-heavy enough to need more.
            fn on_before_command_line_processing(&self, _process_type: Option<&CefString>, command_line: Option<&mut CommandLine>) {
                if let Some(line) = command_line {
                    for switch in ["disable-gpu", "disable-gpu-compositing"] {
                        line.append_switch(Some(&CefString::from(switch)));
                    }
                }
            }
            fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
                Some(MobiusProcessHandler::new(self.shared.clone()))
            }
        }
    }

    wrap_browser_process_handler! {
        struct MobiusProcessHandler {
            shared: Arc<Shared>,
        }
        impl BrowserProcessHandler {
            fn on_context_initialized(&self) {
                // A page asking what it may do is told "denied", for every page from the start. Set once here, before
                // any tab exists, so a tab's first page cannot ask before the tab's own DevTools setting lands.
                if let Some(context) = request_context_get_global_context() {
                    use sys::cef_content_setting_types_t as T;
                    for kind in [T::CEF_CONTENT_SETTING_TYPE_GEOLOCATION, T::CEF_CONTENT_SETTING_TYPE_NOTIFICATIONS, T::CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC, T::CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA, T::CEF_CONTENT_SETTING_TYPE_MIDI_SYSEX] {
                        context.set_content_setting(None, None, kind.into(), sys::cef_content_setting_values_t::CEF_CONTENT_SETTING_VALUE_BLOCK.into());
                    }
                }
                self.shared.context_ready();
            }
        }
    }

    // ---- the pieces of one tab's client ----
    wrap_client! {
        pub struct TabClient {
            shared: Arc<Shared>,
            tab: String,
        }
        impl Client {
            fn display_handler(&self) -> Option<DisplayHandler> {
                Some(TabDisplay::new(self.shared.clone(), self.tab.clone()))
            }
            fn life_span_handler(&self) -> Option<LifeSpanHandler> {
                Some(TabLifeSpan::new(self.shared.clone(), self.tab.clone()))
            }
            fn load_handler(&self) -> Option<LoadHandler> {
                Some(TabLoad::new(self.shared.clone(), self.tab.clone()))
            }
            fn request_handler(&self) -> Option<RequestHandler> {
                Some(TabRequest::new(self.shared.clone(), self.tab.clone()))
            }
            fn download_handler(&self) -> Option<DownloadHandler> {
                Some(TabDownload::new(self.shared.clone()))
            }
            fn keyboard_handler(&self) -> Option<KeyboardHandler> {
                Some(TabKeys::new(self.shared.clone()))
            }
            fn permission_handler(&self) -> Option<PermissionHandler> {
                Some(TabPermissions::new())
            }
            fn find_handler(&self) -> Option<FindHandler> {
                Some(TabFind::new(self.shared.clone(), self.tab.clone()))
            }
        }
    }

    wrap_display_handler! {
        struct TabDisplay {
            shared: Arc<Shared>,
            tab: String,
        }
        impl DisplayHandler {
            fn on_address_change(&self, _browser: Option<&mut cef::Browser>, frame: Option<&mut Frame>, url: Option<&CefString>) {
                let main = frame.is_some_and(|f| f.is_main() != 0);
                let Some(url) = url.map(CefString::to_string).filter(|_| main) else { return };
                let (back, forward) = {
                    let mut tabs = lock(&self.shared.tabs);
                    let state = tabs.entry(self.tab.clone()).or_default();
                    state.url.clone_from(&url);
                    (state.can_back, state.can_forward)
                };
                let (links, id) = (self.shared.clone(), self.tab.clone());
                later(move || {
                    if let Some(b) = links.links.tabs() {
                        b.navigated(&id, &url, back, forward);
                    }
                });
            }
            fn on_title_change(&self, _browser: Option<&mut cef::Browser>, title: Option<&CefString>) {
                let title = title.map(CefString::to_string).unwrap_or_default();
                let (shared, id) = (self.shared.clone(), self.tab.clone());
                later(move || {
                    if let Some(b) = shared.links.tabs() {
                        b.titled(&id, &title);
                    }
                });
            }
        }
    }

    wrap_load_handler! {
        struct TabLoad {
            shared: Arc<Shared>,
            tab: String,
        }
        impl LoadHandler {
            fn on_loading_state_change(&self, _browser: Option<&mut cef::Browser>, is_loading: i32, can_go_back: i32, can_go_forward: i32) {
                let url = {
                    let mut tabs = lock(&self.shared.tabs);
                    let state = tabs.entry(self.tab.clone()).or_default();
                    state.can_back = can_go_back != 0;
                    state.can_forward = can_go_forward != 0;
                    state.url.clone()
                };
                let (shared, id) = (self.shared.clone(), self.tab.clone());
                let (back, forward, loading) = (can_go_back != 0, can_go_forward != 0, is_loading != 0);
                later(move || {
                    let Some(b) = shared.links.tabs() else { return };
                    if loading {
                        b.loading(&id, true);
                        return;
                    }
                    b.navigated(&id, &url, back, forward);
                    b.finished(&id);
                    let page_url = url.clone();
                    std::thread::spawn(move || crate::engine::fetch_icon(&b, &id, &page_url));
                });
            }
        }
    }

    wrap_request_handler! {
        struct TabRequest {
            shared: Arc<Shared>,
            tab: String,
        }
        impl RequestHandler {
            fn on_before_browse(&self, _browser: Option<&mut cef::Browser>, _frame: Option<&mut Frame>, request: Option<&mut Request>, _user_gesture: i32, _is_redirect: i32) -> i32 {
                let Some(request) = request else { return 0 };
                let url = CefString::from(&request.url()).to_string();
                let allowed = self.shared.links.tabs().is_none_or(|b| b.allows_navigation(&url));
                i32::from(!allowed)
            }
        }
    }

    wrap_life_span_handler! {
        struct TabLifeSpan {
            shared: Arc<Shared>,
            tab: String,
        }
        impl LifeSpanHandler {
            fn on_before_popup(&self, _browser: Option<&mut cef::Browser>, _frame: Option<&mut Frame>, _popup_id: i32, target_url: Option<&CefString>, _target_frame_name: Option<&CefString>, _target_disposition: WindowOpenDisposition, _user_gesture: i32, _popup_features: Option<&PopupFeatures>, _window_info: Option<&mut WindowInfo>, _client: Option<&mut Option<Client>>, _settings: Option<&mut BrowserSettings>, _extra_info: Option<&mut Option<DictionaryValue>>, _no_javascript_access: Option<&mut i32>) -> i32 {
                if let Some(target) = target_url.map(CefString::to_string) {
                    let shared = self.shared.clone();
                    later(move || {
                        if let Some(b) = shared.links.tabs() {
                            b.new_window(&target);
                        }
                    });
                }
                // The page never gets a window of its own: the target opens as a tab.
                1
            }

            // The page has really closed (after close_browser): it is no longer one of the open pages, so shutting down
            // waits only as long as closing takes.
            fn on_before_close(&self, browser: Option<&mut cef::Browser>) {
                if let Some(browser) = browser {
                    lock(&self.shared.by_id).remove(&browser.identifier());
                }
            }

            fn on_after_created(&self, browser: Option<&mut cef::Browser>) {
                let Some(browser) = browser.cloned() else { return };
                let id = browser.identifier();
                lock(&self.shared.by_id).insert(id, self.tab.clone());
                let registration = browser.host().and_then(|host| {
                    let mut observer = TabDevTools::new(self.shared.clone());
                    host.add_dev_tools_message_observer(Some(&mut observer))
                });
                {
                    let mut tabs = lock(&self.shared.tabs);
                    let state = tabs.entry(self.tab.clone()).or_default();
                    state.browser = Some(browser);
                    state.registration = registration;
                }
                // A page asking what it may do is told "denied", not "ask me".
                if let Some(host) = lock(&self.shared.tabs).get(&self.tab).and_then(|s| s.browser.as_ref()).and_then(|b| b.host()) {
                    for name in crate::engine::DENIED_PERMISSIONS {
                        let id = self.shared.next_call.fetch_add(1, Ordering::SeqCst);
                        let message = serde_json::json!({ "id": id, "method": "Browser.setPermission", "params": { "permission": { "name": name }, "setting": "denied" } }).to_string();
                        host.send_dev_tools_message(Some(message.as_bytes()));
                    }
                }
                apply_layout(&self.shared);
            }
        }
    }

    wrap_dev_tools_message_observer! {
        struct TabDevTools {
            shared: Arc<Shared>,
        }
        impl DevToolsMessageObserver {
            fn on_dev_tools_method_result(&self, _browser: Option<&mut cef::Browser>, message_id: i32, success: i32, result: Option<&[u8]>) {
                let text = result.map(|r| String::from_utf8_lossy(r).into_owned()).unwrap_or_default();
                let outcome = if success != 0 { serde_json::from_str::<Json>(&text).map_err(|_| "the page answered with something unreadable".to_owned()) } else { Err("the page refused".to_owned()) };
                if let Some(sender) = lock(&self.shared.waiting).remove(&message_id) {
                    let _ = sender.send(outcome);
                }
            }
        }
    }

    wrap_download_handler! {
        struct TabDownload {
            shared: Arc<Shared>,
        }
        impl DownloadHandler {
            fn can_download(&self, _browser: Option<&mut cef::Browser>, _url: Option<&CefString>, _request_method: Option<&CefString>) -> i32 {
                1
            }
            fn on_before_download(&self, _browser: Option<&mut cef::Browser>, item: Option<&mut DownloadItem>, suggested_name: Option<&CefString>, callback: Option<&mut BeforeDownloadCallback>) -> i32 {
                let (Some(item), Some(callback)) = (item, callback) else { return 0 };
                let name = suggested_name.map(CefString::to_string).unwrap_or_default();
                let path = self.shared.links.bridge().and_then(|bridge| bridge.download_requested(&name));
                match path {
                    Some(path) => {
                        lock(&self.shared.download_paths).insert(item.id(), path.clone());
                        callback.cont(Some(&CefString::from(path.to_string_lossy().as_ref())), 0);
                    }
                    None => {
                        // Nothing is saved: the callback is dropped without a path, which cancels the download.
                    }
                }
                1
            }
            fn on_download_updated(&self, _browser: Option<&mut cef::Browser>, item: Option<&mut DownloadItem>, callback: Option<&mut DownloadItemCallback>) {
                let Some(item) = item else { return };
                let Some(path) = lock(&self.shared.download_paths).get(&item.id()).cloned() else { return };
                let bridge = self.shared.links.bridge();
                if item.is_complete() != 0 || item.is_canceled() != 0 || (item.is_in_progress() == 0 && item.is_valid() != 0) {
                    let done = item.is_complete() != 0;
                    lock(&self.shared.download_paths).remove(&item.id());
                    lock(&self.shared.downloads).remove(&path);
                    if let Some(bridge) = bridge {
                        later(move || bridge.download_finished(&path, done));
                    }
                    return;
                }
                if let Some(callback) = callback {
                    lock(&self.shared.downloads).insert(path.clone(), callback.clone());
                }
                let (got, total) = (u64::try_from(item.received_bytes()).unwrap_or(0), u64::try_from(item.total_bytes()).unwrap_or(0));
                if let Some(bridge) = bridge {
                    later(move || bridge.download_progress(&path, got, total));
                }
            }
        }
    }

    wrap_keyboard_handler! {
        struct TabKeys {
            shared: Arc<Shared>,
        }
        impl KeyboardHandler {
            fn on_pre_key_event(&self, _browser: Option<&mut cef::Browser>, event: Option<&KeyEvent>, _os_event: Option<&mut sys::MSG>, _is_keyboard_shortcut: Option<&mut i32>) -> i32 {
                let Some(event) = event else { return 0 };
                if event.type_ != KeyEventType::from(sys::cef_key_event_type_t::KEYEVENT_RAWKEYDOWN) {
                    return 0;
                }
                let Some(bridge) = self.shared.links.bridge() else { return 0 };
                let (control, alt, shift) = (event.modifiers & 4 != 0, event.modifiers & 8 != 0, event.modifiers & 2 != 0);
                let key = u32::try_from(event.windows_key_code).unwrap_or(0);
                i32::from(bridge.page_key(key, control, alt, shift))
            }
        }
    }

    wrap_permission_handler! {
        struct TabPermissions {
        }
        impl PermissionHandler {
            // A page asking for anything (location, notifications, camera...) is told no. Nothing is asked of the person.
            fn on_show_permission_prompt(&self, _browser: Option<&mut cef::Browser>, _prompt_id: u64, _requesting_origin: Option<&CefString>, _requested_permissions: u32, callback: Option<&mut PermissionPromptCallback>) -> i32 {
                if let Some(callback) = callback {
                    callback.cont(sys::cef_permission_request_result_t::CEF_PERMISSION_RESULT_DENY.into());
                }
                1
            }
            fn on_request_media_access_permission(&self, _browser: Option<&mut cef::Browser>, _frame: Option<&mut Frame>, _requesting_origin: Option<&CefString>, _requested_permissions: u32, callback: Option<&mut MediaAccessCallback>) -> i32 {
                if let Some(callback) = callback {
                    callback.cancel();
                }
                1
            }
        }
    }

    wrap_find_handler! {
        struct TabFind {
            shared: Arc<Shared>,
            tab: String,
        }
        impl FindHandler {
            fn on_find_result(&self, _browser: Option<&mut cef::Browser>, _identifier: i32, count: i32, _selection_rect: Option<&Rect>, _active_match_ordinal: i32, final_update: i32) {
                if final_update == 0 {
                    return;
                }
                let (shared, id) = (self.shared.clone(), self.tab.clone());
                let matches = u64::try_from(count).unwrap_or(0);
                // Chromium's own number for the current match runs a step behind when the page is out of sight, so the number is
                // worked out here: a new search starts at the first match, and each step moves one along (wrapping round).
                let active = {
                    let mut finds = lock(&self.shared.finds);
                    let state = finds.entry(self.tab.clone()).or_default();
                    let now = mobius_browser::find::current_match(matches, state.active, state.step);
                    state.active = now;
                    now
                };
                later(move || {
                    if let Some(b) = shared.links.tabs() {
                        b.found(&id, active, matches);
                    }
                });
            }
        }
    }

    /// Moves every tab's window to where it belongs: the shown one at its place, the rest out of sight.
    pub fn apply_layout(shared: &Arc<Shared>) {
        let shared = shared.clone();
        let again = shared.clone();
        again.ui(move || {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
            use windows::Win32::UI::WindowsAndMessaging::{HWND_TOP, SW_HIDE, SW_SHOW, SWP_NOACTIVATE, SetWindowPos, ShowWindow};
            let (visible, bounds) = lock(&shared.shown).clone();
            let (zoom, scale) = (*lock(&shared.zoom), (shared.scale)());
            cut_hole_in_interface(shared.window, if visible.is_some() { bounds } else { None }, zoom * scale);
            let tabs = lock(&shared.tabs);
            for (id, state) in tabs.iter() {
                let Some(host) = state.browser.as_ref().and_then(|b| b.host()) else { continue };
                let handle = HWND(host.window_handle().0.cast());
                match (visible.as_deref(), bounds) {
                    (Some(shown), Some(b)) if shown == id => {
                        let to_pixels = |v: i32| (f64::from(v) * zoom * scale).round() as i32;
                        // SAFETY: `handle` is the window CEF made for this tab; the calls only move and show it.
                        unsafe {
                            // On top: the interface's own view fills the window and would otherwise hide the page.
                            let _ = SetWindowPos(handle, Some(HWND_TOP), to_pixels(b.x), to_pixels(b.y), to_pixels(b.width), to_pixels(b.height), SWP_NOACTIVATE);
                            // The page sits in a rounded frame: its own corners are cut to match (the frame's inner radius is 7 points: `--radius-panel` less its 1-point border).
                            let radius = (PAGE_RADIUS * zoom * scale * 2.0).round() as i32;
                            let region = CreateRoundRectRgn(0, 0, to_pixels(b.width) + 1, to_pixels(b.height) + 1, radius, radius);
                            SetWindowRgn(handle, Some(region), true);
                            let _ = ShowWindow(handle, SW_SHOW);
                        }
                        host.was_resized();
                    }
                    // SAFETY: as above.
                    _ => unsafe {
                        let _ = ShowWindow(handle, SW_HIDE);
                    },
                }
            }
        });
    }

    /// Closes a tab's page. CEF answers a close by telling the top-level window above the page to close, and that would be
    /// the Mobius window: so the page is first moved under a throwaway hidden window that takes the message instead.
    pub fn close_page(host: &cef::BrowserHost) {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, SetParent, WS_EX_TOOLWINDOW, WS_POPUP};
        use windows::core::w;
        let page = HWND(host.window_handle().0.cast());
        // SAFETY: a hidden window of a system class, made only to receive the close message; the page window is ours.
        unsafe {
            if let Ok(catcher) = CreateWindowExW(WS_EX_TOOLWINDOW, w!("STATIC"), w!(""), WS_POPUP, 0, 0, 0, 0, None, None, None, None) {
                let _ = SetParent(page, Some(catcher));
            }
        }
        host.close_browser(1);
    }

    /// The interface's own web view fills the window and is drawn above every other child window, whatever their order. So
    /// the part of it where a page goes is cut away (a window region), and the page shows through. No page: the view is whole again.
    fn cut_hole_in_interface(parent: isize, hole: Option<Bounds>, scale: f64) {
        use windows::Win32::Foundation::{HWND, LPARAM, RECT};
        use windows::core::BOOL;
        use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, HGDIOBJ, RGN_DIFF, SetWindowRgn};
        use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, GetClientRect};

        unsafe extern "system" fn find(window: HWND, found: LPARAM) -> BOOL {
            let mut name = [0u16; 32];
            // SAFETY: `name` is a buffer we own; `found` points at the `Option<HWND>` passed in below, alive for the whole call.
            unsafe {
                let length = usize::try_from(GetClassNameW(window, &mut name)).unwrap_or(0);
                if String::from_utf16_lossy(&name[..length]) == "WRY_WEBVIEW" {
                    *(found.0 as *mut Option<HWND>) = Some(window);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        let mut interface: Option<HWND> = None;
        // SAFETY: the parent is the Mobius window; the callback only reads window class names and writes `interface`.
        unsafe {
            let _ = EnumChildWindows(Some(HWND(parent as *mut _)), Some(find), LPARAM(&mut interface as *mut _ as isize));
        }
        let Some(interface) = interface else { return };
        let _ = scale;
        // SAFETY: regions are created here and handed to the system (which owns the outer one afterwards); the hole is freed.
        unsafe {
            let Some(hole) = hole else {
                let _ = SetWindowRgn(interface, None, true);
                return;
            };
            let mut client = RECT::default();
            if GetClientRect(interface, &mut client).is_err() {
                return;
            }
            let to_px = |v: i32| (f64::from(v) * scale).round() as i32;
            let outer = CreateRectRgn(0, 0, client.right, client.bottom);
            // Rounded like the page itself, so the frame's own (dark) corners show instead of the window's.
            let radius = (PAGE_RADIUS * scale * 2.0).round() as i32;
            let cut = CreateRoundRectRgn(to_px(hole.x), to_px(hole.y), to_px(hole.x) + to_px(hole.width) + 1, to_px(hole.y) + to_px(hole.height) + 1, radius, radius);
            CombineRgn(Some(outer), Some(outer), Some(cut), RGN_DIFF);
            let _ = DeleteObject(HGDIOBJ(cut.0));
            SetWindowRgn(interface, Some(outer), true);
        }
    }

    pub fn open(shared: &Arc<Shared>, tab: &str, url: &str) {
        lock(&shared.tabs).entry(tab.to_owned()).or_default();
        let (shared, tab, url) = (shared.clone(), tab.to_owned(), url.to_owned());
        let again = shared.clone();
        again.ui(move || {
            let mut client = TabClient::new(shared.clone(), tab);
            let info = WindowInfo { runtime_style: RuntimeStyle::ALLOY, ..Default::default() }.set_as_child(sys::HWND(shared.window as *mut _), &Rect { x: 0, y: 0, width: 1, height: 1 });
            let info = WindowInfo { style: info.style & !windows::Win32::UI::WindowsAndMessaging::WS_VISIBLE.0, ..info };
            browser_host_create_browser(Some(&info), Some(&mut client), Some(&CefString::from(url.as_str())), Some(&BrowserSettings::default()), None::<&mut DictionaryValue>, None::<&mut RequestContext>);
        });
    }

    pub fn with_browser<T>(shared: &Shared, tab: &str, f: impl FnOnce(&cef::Browser) -> T) -> Option<T> {
        lock(&shared.tabs).get(tab).and_then(|s| s.browser.as_ref()).map(f)
    }

    pub fn initialize_cef(shared: &Arc<Shared>, cache: &Path) -> bool {
        let args = cef::args::Args::new();
        let cache_text = cache.to_string_lossy().into_owned();
        let settings = Settings {
            no_sandbox: 1,
            multi_threaded_message_loop: 1,
            remote_debugging_port: std::env::var("MOBIUS_REMOTE_DEBUGGING_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(0),
            root_cache_path: CefString::from(cache_text.as_str()),
            cache_path: CefString::from(cache_text.as_str()),
            ..Default::default()
        };
        let mut app = MobiusApp::new(shared.clone());
        initialize(Some(args.as_main_args()), Some(&settings), Some(&mut app), std::ptr::null_mut()) == 1
    }
}

use chromium::Shared;

pub struct CefEngine {
    shared: Arc<Shared>,
}

/// Run first thing in `main`: CEF starts the same program again for its helper processes, and those must do their work
/// and leave without starting the application. Returns the exit code to leave with, or `None` for the real start.
pub fn run_helper_process() -> Option<i32> {
    use cef::*;
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = cef::args::Args::new();
    let code = execute_process(Some(args.as_main_args()), None::<&mut App>, std::ptr::null_mut());
    (code >= 0).then_some(code)
}

impl CefEngine {
    /// `window` is the native handle of the Mobius window; `scale` says how many pixels make one point right now.
    pub fn new(window: isize, cache: &Path, scale: impl Fn() -> f64 + Send + Sync + 'static) -> Option<Arc<CefEngine>> {
        let shared = Arc::new(Shared {
            links: Links::default(),
            tabs: Mutex::default(),
            by_id: Mutex::default(),
            waiting: Mutex::default(),
            next_call: AtomicI32::new(1),
            downloads: Mutex::default(),
            download_paths: Mutex::default(),
            shown: Mutex::new((None, None)),
            window,
            scale: Box::new(scale),
            zoom: Mutex::new(1.0),
            ready: AtomicBool::new(false),
            before_ready: Mutex::default(),
            finds: Mutex::default(),
        });
        std::fs::create_dir_all(cache).ok()?;
        chromium::initialize_cef(&shared, cache).then(|| Arc::new(CefEngine { shared }))
    }

    pub fn attach(&self, browser: &Arc<mobius_browser::tabs::Browser>) {
        let _ = self.shared.links.tabs.set(Arc::downgrade(browser));
    }

    pub fn attach_downloads(&self, bridge: &Arc<mobius_host::Bridge>) {
        let _ = self.shared.links.bridge.set(Arc::downgrade(bridge));
    }

    pub fn set_zoom(&self, zoom: f64) {
        *lock(&self.shared.zoom) = zoom;
        chromium::apply_layout(&self.shared);
    }

    pub fn cancel_download(&self, path: &Path) {
        if let Some(callback) = lock(&self.shared.downloads).get(path).cloned() {
            use cef::ImplDownloadItemCallback;
            self.shared.ui(move || callback.cancel());
        }
    }

    fn cdp(&self, tab: &str, method: &str, params: Value) -> Result<Value, String> {
        use cef::{ImplBrowser, ImplBrowserHost};
        let id = self.shared.next_call.fetch_add(1, Ordering::SeqCst);
        let (send, receive) = channel();
        lock(&self.shared.waiting).insert(id, send);
        let message = json!({ "id": id, "method": method, "params": params }).to_string();
        let browser = chromium::with_browser(&self.shared, tab, Clone::clone).ok_or("no such tab")?;
        self.shared.ui(move || {
            if let Some(host) = browser.host() {
                host.send_dev_tools_message(Some(message.as_bytes()));
            }
        });
        let outcome = receive.recv_timeout(CDP_TIMEOUT).map_err(|_| "the page did not answer".to_owned());
        lock(&self.shared.waiting).remove(&id);
        outcome?
    }

    /// Closes every page, and shuts CEF down. Called as the application ends.
    pub fn shutdown(&self) {
        use cef::ImplBrowser;
        let tabs: Vec<cef::Browser> = lock(&self.shared.tabs).values().filter_map(|t| t.browser.clone()).collect();
        for browser in tabs {
            self.shared.ui(move || {
                if let Some(host) = browser.host() {
                    chromium::close_page(&host);
                }
            });
        }
        let start = std::time::Instant::now();
        while !lock(&self.shared.by_id).is_empty() && start.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(50));
        }
        cef::shutdown();
    }
}

impl crate::engine::PageEngine for CefEngine {
    fn name(&self) -> &'static str {
        "Chromium (CEF 156)"
    }
    fn attach(&self, browser: &Arc<mobius_browser::tabs::Browser>) {
        CefEngine::attach(self, browser);
    }
    fn attach_downloads(&self, bridge: &Arc<mobius_host::Bridge>) {
        CefEngine::attach_downloads(self, bridge);
    }
    fn set_zoom(&self, zoom: f64) {
        CefEngine::set_zoom(self, zoom);
    }
    fn cancel_download(&self, path: &Path) {
        CefEngine::cancel_download(self, path);
    }
    fn shutdown(&self) {
        CefEngine::shutdown(self);
    }
    fn run_in_page(&self, tab: &str, code: &str) -> Result<Value, String> {
        let answer = self.cdp(tab, "Runtime.evaluate", json!({ "expression": code, "awaitPromise": true, "returnByValue": true, "userGesture": true }))?;
        if let Some(problem) = answer.pointer("/exceptionDetails/exception/description").and_then(Value::as_str) {
            return Err(problem.to_owned());
        }
        Ok(answer.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }
}

impl Engine for CefEngine {
    fn open(&self, tab: &str, url: &str) {
        chromium::open(&self.shared, tab, url);
    }

    fn navigate(&self, tab: &str, url: &str) {
        use cef::{ImplBrowser, ImplFrame};
        if let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) {
            let url = url.to_owned();
            self.shared.ui(move || {
                if let Some(frame) = browser.main_frame() {
                    frame.load_url(Some(&cef::CefString::from(url.as_str())));
                }
            });
        }
    }

    fn back(&self, tab: &str) {
        use cef::ImplBrowser;
        if let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) {
            self.shared.ui(move || browser.go_back());
        }
    }

    fn forward(&self, tab: &str) {
        use cef::ImplBrowser;
        if let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) {
            self.shared.ui(move || browser.go_forward());
        }
    }

    fn reload(&self, tab: &str) {
        use cef::ImplBrowser;
        if let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) {
            self.shared.ui(move || browser.reload());
        }
    }

    fn close(&self, tab: &str) {
        use cef::ImplBrowser;
        let state = lock(&self.shared.tabs).remove(tab);
        lock(&self.shared.finds).remove(tab);
        if let Some(browser) = state.and_then(|s| s.browser) {
            let (shared, id) = (self.shared.clone(), browser.identifier());
            self.shared.ui(move || {
                if let Some(host) = browser.host() {
                    chromium::close_page(&host);
                }
                lock(&shared.by_id).remove(&id);
            });
        }
    }

    fn layout(&self, visible: Option<&str>, bounds: Option<Bounds>) {
        *lock(&self.shared.shown) = (visible.map(str::to_owned), bounds);
        chromium::apply_layout(&self.shared);
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
        use cef::ImplBrowserHost;
        let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) else { return };
        let repeat = {
            let mut finds = lock(&self.shared.finds);
            let state = finds.entry(tab.to_owned()).or_default();
            let repeat = again && state.text == text;
            if !repeat {
                state.active = 0;
            }
            state.text = text.to_owned();
            state.step = if repeat { if forward { 1 } else { -1 } } else { 0 };
            repeat
        };
        let text = text.to_owned();
        self.shared.ui(move || {
            use cef::ImplBrowser;
            if let Some(host) = browser.host() {
                host.find(Some(&cef::CefString::from(text.as_str())), i32::from(forward), 0, i32::from(repeat));
            }
        });
    }

    fn stop_find(&self, tab: &str) {
        use cef::{ImplBrowser, ImplBrowserHost};
        lock(&self.shared.finds).remove(tab);
        if let Some(browser) = chromium::with_browser(&self.shared, tab, Clone::clone) {
            self.shared.ui(move || {
                if let Some(host) = browser.host() {
                    host.stop_finding(1);
                }
            });
        }
    }
}
