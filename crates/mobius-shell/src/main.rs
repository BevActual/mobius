#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! The Mobius desktop shell on Tauri. It owns the window and the core process and gives the interface one command,
//! `bridge`, which `mobius_host::Bridge` validates. Nothing else is reachable from the page.
mod awake;
mod secrets;
mod tray;
mod menu;
mod profiles;
mod updater;
#[cfg(windows)]
mod cdp;
mod engine;
#[cfg(target_os = "linux")]
mod linux_page;
#[cfg(target_os = "linux")]
mod linux_views;
#[cfg(all(feature = "cef", windows))]
mod cef_engine;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use mobius_host::{Bridge, CoreProcess, Options, Status};
use serde_json::Value;
use mobius_browser::tabs::Browser;
use mobius_host::bridge::Dialogs;
use tauri::webview::WebviewBuilder;
use tauri::{Emitter, Listener, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WindowBuilder, WindowEvent};

/// Opening and showing files uses the system's own programs. Choosing a file is not native yet.
/// Global shortcuts through the system registration; a combination another program has is simply refused.
struct GlobalKeys {
    handle: tauri::AppHandle,
}

impl mobius_host::quick_entry::Registrar for GlobalKeys {
    fn register(&mut self, accelerator: &str, on_press: Arc<dyn Fn() + Send + Sync>) -> bool {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
        let Ok(shortcut) = accelerator.parse::<Shortcut>() else { return false };
        self.handle
            .global_shortcut()
            .on_shortcut(shortcut, move |_, _, event| {
                if event.state == ShortcutState::Pressed {
                    on_press();
                }
            })
            .is_ok()
    }

    fn unregister(&mut self, accelerator: &str) {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
        if let Ok(shortcut) = accelerator.parse::<Shortcut>() {
            let _ = self.handle.global_shortcut().unregister(shortcut);
        }
    }
}

struct SystemDialogs {
    keep_hidden: bool,
    engine: Arc<OnceLock<Arc<dyn engine::PageEngine>>>,
    handle: tauri::AppHandle,
    window: tauri::Window,
}
impl Dialogs for SystemDialogs {
    fn pick_text_file(&self) -> Option<PathBuf> {
        use tauri_plugin_dialog::DialogExt;
        self.handle.dialog().file().add_filter("Text", &["txt", "md", "json", "csv", "log", "rs", "ts", "tsx", "js", "py", "html", "css", "toml", "yaml", "yml"]).blocking_pick_file().and_then(|f| f.into_path().ok())
    }
    fn open_path(&self, path: &std::path::Path) {
        #[cfg(windows)]
        let _ = std::process::Command::new("explorer").arg(path).spawn();
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(path).spawn();
        #[cfg(all(unix, not(target_os = "macos")))]
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
    fn window_focused(&self) -> bool {
        self.window.is_focused().unwrap_or(false)
    }
    fn show_notice(&self, notice: &mobius_host::notify::Notice) {
        use tauri_plugin_notification::NotificationExt;
        let mut builder = self.handle.notification().builder().title(&notice.title).body(&notice.body);
        if !notice.silent {
            builder = builder.sound("default");
        }
        let _ = builder.show();
    }
    fn awake_blocker(&self) -> Box<dyn mobius_host::awake::Blocker> {
        Box::new(awake::SystemBlocker::new())
    }
    fn shortcut_registrar(&self) -> Box<dyn mobius_host::quick_entry::Registrar> {
        Box::new(GlobalKeys { handle: self.handle.clone() })
    }
    fn bring_forward(&self) {
        if self.keep_hidden {
            return;
        }
        let _ = self.window.unminimize();
        let _ = self.window.show();
        let _ = self.window.set_focus();
    }
    fn cancel_download(&self, path: &std::path::Path) {
        if let Some(engine) = self.engine.get() {
            engine.cancel_download(path);
        }
    }
    fn show_path(&self, path: &std::path::Path) {
        #[cfg(windows)]
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg("-R").arg(path).spawn();
        #[cfg(all(unix, not(target_os = "macos")))]
        let _ = path.parent().map(|dir| std::process::Command::new("xdg-open").arg(dir).spawn());
    }
}

/// One answer of the `media` address: `/<project>/<clip>`, with the part of the file the Range header asks for.
fn media_response(bridge: Option<&Bridge>, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode, header};
    let fail = |status: StatusCode| Response::builder().status(status).body(Vec::new()).unwrap_or_default();
    let Some(bridge) = bridge else { return fail(StatusCode::SERVICE_UNAVAILABLE) };
    let path = request.uri().path().trim_start_matches('/');
    let decode = |s: &str| percent_decode(s);
    let Some((project, clip)) = path.split_once('/').map(|(p, c)| (decode(p), decode(c))) else { return fail(StatusCode::NOT_FOUND) };
    // Without a range, the whole clip (the window on Linux reads it once to play from memory).
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    match bridge.media_part(&project, &clip, range) {
        Ok((bytes, start, len, kind)) => {
            let end = start + bytes.len() as u64;
            Response::builder()
                .status(if range.is_some() { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
                .header(header::CONTENT_TYPE, kind)
                .header(header::ACCEPT_RANGES, "bytes")
                // The window reads clips across addresses on Linux (to play them from memory); only its own page may.
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, own_origin(request))
                .header(header::CONTENT_RANGE, format!("bytes {start}-{}/{len}", end.saturating_sub(1)))
                .header(header::CONTENT_LENGTH, bytes.len())
                .body(bytes)
                .unwrap_or_default()
        }
        Err(e) if e.contains("not there") || e.contains("not a clip") => fail(StatusCode::NOT_FOUND),
        Err(_) => fail(StatusCode::RANGE_NOT_SATISFIABLE),
    }
}

/// The interface page's own origin, if the request came from it, else nothing another page could use.
fn own_origin(request: &tauri::http::Request<Vec<u8>>) -> &'static str {
    match request.headers().get(tauri::http::header::ORIGIN).and_then(|v| v.to_str().ok()) {
        Some("tauri://localhost") => "tauri://localhost",
        Some("http://tauri.localhost") => "http://tauri.localhost",
        _ => "null",
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(b) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Shell {
    bridge: Arc<Bridge>,
    /// Where Little Mobius keeps its place on the screen between openings.
    mini_place: PathBuf,
    /// What the tray shows now, so a change only redraws what changed.
    tray: std::sync::Mutex<Option<tray::Shown>>,
    /// The menus in the macOS menu bar now.
    menu: std::sync::Mutex<Option<Vec<menu::Spec>>>,
    /// The data folder every profile lives in.
    profiles_base: PathBuf,
}

/// Linux: where every web view keeps its storage (the interface's saved state, pages' cookies), inside Mobius's own
/// data folder, so separate data folders stay separate and Remove all data takes it too. Windows keeps WebView2's
/// folder as it was, so nobody loses their sign-ins.
#[cfg(target_os = "linux")]
static WEB_DATA: OnceLock<PathBuf> = OnceLock::new();

#[cfg(target_os = "linux")]
pub(crate) fn web_data() -> Option<PathBuf> {
    WEB_DATA.get().cloned()
}

/// Windows: the browser arguments every web view is made with, when `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` asks for
/// more (the end-to-end tests' debugging port). Newer WebView2 runtimes (156) take the arguments the app passes
/// instead of that variable, so they are joined here to the ones Tauri passes by default: its features turned off
/// (one `--disable-features`, merged) and autoplay. Every view must use the same arguments, or WebView2 refuses it.
#[cfg(windows)]
pub(crate) fn webview2_args() -> Option<String> {
    let extra = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok().filter(|v| !v.trim().is_empty())?;
    Some(joined_webview2_args(&extra))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn joined_webview2_args(extra: &str) -> String {
    let mut features: Vec<String> = ["msWebOOUI", "msPdfOOUI", "msSmartScreenProtection"].map(String::from).to_vec();
    let mut rest = vec!["--autoplay-policy=no-user-gesture-required".to_owned()];
    for arg in extra.split_whitespace() {
        match arg.strip_prefix("--disable-features=") {
            Some(list) => {
                for feature in list.split(',').filter(|f| !f.is_empty()) {
                    if !features.iter().any(|f| f == feature) {
                        features.push(feature.to_owned());
                    }
                }
            }
            None if !rest.iter().any(|r| r == arg) => rest.push(arg.to_owned()),
            None => {}
        }
    }
    format!("--disable-features={} {}", features.join(","), rest.join(" "))
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_tests_webview2_arguments_join_the_ones_tauri_passes() {
        let joined = super::joined_webview2_args("--remote-debugging-port=9400 --disable-features=msSmartScreenProtection,msEdgeSafety --use-fake-ui-for-media-stream");
        assert_eq!(joined, "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,msEdgeSafety --autoplay-policy=no-user-gesture-required --remote-debugging-port=9400 --use-fake-ui-for-media-stream");
        assert_eq!(joined.matches("--disable-features").count(), 1, "one list, or WebView2 keeps only the last");
    }
}

/// Little Mobius: a small window that keeps the agent at hand over other apps. It shows the same interface, which sees
/// the window's label and draws only the conversation.
const MINI: &str = "mini";

/// Where a window was last put, in logical pixels, if that spot is still on one of the screens. Its size is kept
/// within `min` and a sensible largest size.
fn kept_place(app: &tauri::AppHandle, file: &std::path::Path, min: (f64, f64)) -> Option<(f64, f64, f64, f64)> {
    let kept = mobius_store::file::read_json(file)?;
    let get = |k: &str| kept.get(k).and_then(Value::as_f64).filter(|v| v.is_finite());
    let (x, y, w, h) = (get("x")?, get("y")?, get("width")?.clamp(min.0, 8000.0), get("height")?.clamp(min.1, 5000.0));
    // Its top-left corner must be well inside a screen, so a screen since unplugged never hides it.
    let on_screen = app.available_monitors().ok()?.iter().any(|m| {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (left, top) = (f64::from(area.position.x) / scale, f64::from(area.position.y) / scale);
        let (right, bottom) = (left + f64::from(area.size.width) / scale, top + f64::from(area.size.height) / scale);
        x >= left && y >= top && x + 80.0 <= right && y + 40.0 <= bottom
    });
    on_screen.then_some((x, y, w, h))
}

fn keep_window_place(window: &tauri::Window, file: &std::path::Path) {
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized || window.is_minimized().unwrap_or(false) {
        let mut kept = mobius_store::file::read_json(file).unwrap_or_else(|| serde_json::json!({}));
        if !maximized || kept.get("maximized") == Some(&Value::Bool(true)) || !kept.is_object() {
            return;
        }
        kept["maximized"] = Value::Bool(true);
        mobius_store::file::write_json(file, &kept);
        return;
    }
    let (Ok(scale), Ok(at), Ok(size)) = (window.scale_factor(), window.outer_position(), window.inner_size()) else { return };
    let (at, size) = (at.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
    mobius_store::file::write_json(file, &serde_json::json!({ "x": at.x, "y": at.y, "width": size.width, "height": size.height, "maximized": false }));
}

fn little_mobius(app: &tauri::AppHandle, method: &str, place_file: &std::path::Path) -> Result<Value, Value> {
    let fail = |message: String| serde_json::json!({ "kind": "invalid", "message": message });
    match method {
        "open" => {
            if let Some(mini) = app.get_webview_window(MINI) {
                let _ = mini.unminimize();
                let _ = mini.show();
                let _ = mini.set_focus();
                return Ok(Value::Null);
            }
            let kept = kept_place(app, place_file, (320.0, 380.0));
            let (width, height) = kept.map_or((380.0, 560.0), |(_, _, w, h)| (w, h));
            let mut builder = tauri::WebviewWindowBuilder::new(app, MINI, WebviewUrl::default());
            #[cfg(windows)]
            if let Some(args) = webview2_args() {
                builder = builder.additional_browser_args(&args);
            }
            #[cfg(target_os = "linux")]
            if let Some(dir) = web_data() {
                builder = builder.data_directory(dir);
            }
            let mut builder = builder
                .title("Little Mobius")
                .inner_size(width, height)
                .min_inner_size(320.0, 380.0)
                .always_on_top(true);
            // Where it was last put; the first time, the bottom-right corner of the screen Mobius is on, clear of the
            // taskbar, like a chat that pops out.
            if let Some((x, y, _, _)) = kept {
                builder = builder.position(x, y);
            } else if let Some(monitor) = app.get_window("main").and_then(|main| main.current_monitor().ok().flatten()) {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let (left, top) = (f64::from(area.position.x) / scale, f64::from(area.position.y) / scale);
                let (across, down) = (f64::from(area.size.width) / scale, f64::from(area.size.height) / scale);
                const MARGIN: f64 = 24.0;
                // A title bar and frame sit outside the inner size; leave room for them.
                const FRAME: f64 = 40.0;
                let x = (left + across - width - MARGIN).max(left);
                let y = (top + down - height - FRAME - MARGIN).max(top);
                builder = builder.position(x, y);
            }
            let mini = builder.build().map_err(|e| fail(format!("Little Mobius could not open: {e}")))?;
            // Its place is kept as it is moved or resized.
            let (placed, file) = (mini.clone(), place_file.to_path_buf());
            mini.on_window_event(move |event| {
                if !matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                    return;
                }
                let (Ok(scale), Ok(at), Ok(size)) = (placed.scale_factor(), placed.outer_position(), placed.inner_size()) else { return };
                let (at, size) = (at.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
                mobius_store::file::write_json(&file, &serde_json::json!({ "x": at.x, "y": at.y, "width": size.width, "height": size.height }));
            });
            Ok(Value::Null)
        }
        "close" => {
            if let Some(mini) = app.get_webview_window(MINI) {
                let _ = mini.close();
            }
            Ok(Value::Null)
        }
        "isOpen" => Ok(Value::Bool(app.get_webview_window(MINI).is_some())),
        // From Little Mobius back to the full window.
        "showMain" => {
            if let Some(main) = app.get_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
            Ok(Value::Null)
        }
        "setOnTop" => Ok(Value::Null),
        _ => Err(serde_json::json!({ "kind": "not_available", "message": "Not a Little Mobius call." })),
    }
}

/// The one door from the interface into Rust.
#[tauri::command]
async fn bridge(app: tauri::AppHandle, shell: State<'_, Shell>, namespace: String, method: String, args: Vec<Value>) -> Result<Value, Value> {
    // Software Update is the shell's own: it replaces the shell.
    if namespace == "updates" {
        return updater::call(&app, &method).await;
    }
    if namespace == "profiles" {
        let base = &shell.profiles_base;
        let mut profiles = profiles::Profiles::read(base);
        let name = args.get(1).and_then(Value::as_str).unwrap_or("");
        let id = args.first().and_then(Value::as_str).unwrap_or("");
        let changed = match method.as_str() {
            "list" => return Ok(profiles.to_json()),
            "create" => profiles.create(args.first().and_then(Value::as_str).unwrap_or("")).map(|_| ()),
            "rename" => profiles.rename(id, name),
            "remove" => profiles.remove(id),
            "switch" => profiles.switch(id),
            _ => return Err(serde_json::json!({ "kind": "not_available", "message": "Not a profiles call." })),
        };
        return Ok(match changed.and_then(|()| profiles.write(base)) {
            Ok(()) => {
                if method == "switch" {
                    // A different profile is a different set of data: Mobius starts again with it.
                    app.request_restart();
                }
                serde_json::json!({ "ok": true, "profiles": profiles.to_json() })
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }),
        });
    }
    if namespace == "menu" && method == "set" {
        let mut before = shell.menu.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        return menu::set(&app, &mut before, &args);
    }
    if namespace == "tray" && method == "set" {
        let mut before = shell.tray.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        return tray::set(&app, &mut before, &args);
    }
    if namespace == "mini" {
        if method == "setOnTop" && let Some(mini) = app.get_webview_window(MINI) {
            let _ = mini.set_always_on_top(args.first().and_then(Value::as_bool).unwrap_or(true));
        }
        let result = little_mobius(&app, &method, &shell.mini_place);
        if method == "open" || method == "close" {
            let _ = app.emit("mobius:mini", app.get_webview_window(MINI).is_some() && method == "open");
        }
        return result;
    }
    let bridge = Arc::clone(&shell.bridge);
    // Some calls wait for the core for a long time (a search, a download): they get a thread of their own.
    tauri::async_runtime::spawn_blocking(move || bridge.call(&namespace, &method, &args))
        .await
        .map_err(|_| serde_json::json!({ "kind": "invalid", "message": "That did not finish." }))?
        .map_err(|e| serde_json::json!({ "kind": e.kind(), "message": e.message() }))
}

fn daemon_path() -> PathBuf {
    if let Ok(path) = std::env::var("MOBIUS_CORE_BIN") {
        return PathBuf::from(path);
    }
    let name = if cfg!(windows) { "mobius-cored.exe" } else { "mobius-cored" };
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(name))).unwrap_or_else(|| PathBuf::from(name))
}

fn emit_for(handle: &tauri::AppHandle) -> mobius_browser::tabs::Notify {
    let handle = handle.clone();
    Arc::new(move |name, payload| {
        let _ = handle.emit(name, payload);
    })
}

/// Passes browser updates on, and when `file` is given keeps the open tabs in it whenever they change.
fn keep_tabs(notify: mobius_browser::tabs::Notify, file: Option<PathBuf>) -> mobius_browser::tabs::Notify {
    let Some(file) = file else { return notify };
    let last = Arc::new(std::sync::Mutex::new(Value::Null));
    Arc::new(move |name, payload| {
        if name == "mobius:browser-state" {
            let session = mobius_browser::session::session_of(&payload);
            let mut kept = last.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if *kept != session {
                mobius_store::file::write_json(&file, &session);
                *kept = session;
            }
        }
        notify(name, payload);
    })
}

/// Chromium when it was built in (feature `cef`), unless `MOBIUS_ENGINE=webview` asks for the system web view.
fn choose_engine(window: &tauri::Window, data_dir: &std::path::Path) -> Arc<dyn engine::PageEngine> {
    #[cfg(all(feature = "cef", windows))]
    if !std::env::var("MOBIUS_ENGINE").is_ok_and(|v| v == "webview") {
        let scale_window = window.clone();
        let handle = window.hwnd().map(|h| h.0 as isize);
        match handle.map(|h| cef_engine::CefEngine::new(h, &data_dir.join("chromium"), move || scale_window.scale_factor().unwrap_or(1.0))) {
            Ok(Some(engine)) => return engine,
            _ => eprintln!("[browser] Chromium could not start; using the system web view"),
        }
    }
    let _ = data_dir;
    engine::WebViewEngine::new(window.clone())
}

struct Engines(Arc<dyn engine::PageEngine>);

fn main() {
    // Chromium starts this program again for its helper processes; they do their work and leave.
    #[cfg(all(feature = "cef", windows))]
    if let Some(code) = cef_engine::run_helper_process() {
        std::process::exit(code);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![bridge])
        // Video clips for the window's player, streamed in parts as it asks: only clips in a Video project.
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let shell = ctx.app_handle().try_state::<Shell>().map(|s| s.bridge.clone());
            std::thread::spawn(move || responder.respond(media_response(shell.as_deref(), &request)));
        })
        .setup(|app| {
            let test_mode = std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1");
            let base_dir = match std::env::var("MOBIUS_USER_DATA") {
                Ok(dir) if test_mode => PathBuf::from(dir),
                _ => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&base_dir)?;
            // The open profile's own folder. Models and the local engine are shared by every profile: they are large,
            // and the same on one computer.
            let data_dir = profiles::Profiles::read(&base_dir).folder(&base_dir);
            std::fs::create_dir_all(&data_dir)?;
            let handle = app.handle().clone();
            let slot: Arc<OnceLock<Arc<Bridge>>> = Arc::new(OnceLock::new());
            let (status_slot, note_slot, request_slot) = (slot.clone(), slot.clone(), slot.clone());
            let mut args = vec!["--db".into(), data_dir.join("core.db").display().to_string(), "--conversations".into(), data_dir.join("conversations.db").display().to_string()];
            args.extend(["--models-dir".into(), base_dir.join("models").display().to_string(), "--download-dir".into(), base_dir.join("models").display().to_string(), "--state-dir".into(), base_dir.display().to_string()]);
            if test_mode {
                args.extend(["--demo-tools".into(), "--no-default-models".into()]);
                if let Ok(hub) = std::env::var("MOBIUS_TEST_HUB") {
                    args.extend(["--hub".into(), hub]);
                }
                if let Ok(releases) = std::env::var("MOBIUS_TEST_ENGINE_RELEASES") {
                    args.extend(["--engine-releases".into(), releases]);
                }
                if let Ok(llama) = std::env::var("MOBIUS_TEST_LLAMA") {
                    args.extend(["--llama-server".into(), llama]);
                }
                // A fake Claude Code CLI and a fake Anthropic server, so tests never touch a real subscription.
                if let Ok(claude) = std::env::var("MOBIUS_TEST_CLAUDE") {
                    args.extend(["--claude-command".into(), claude]);
                }
                if let Ok(upstream) = std::env::var("MOBIUS_TEST_CLAUDE_UPSTREAM") {
                    args.extend(["--claude-upstream".into(), upstream]);
                }
                // A pretend OpenAI: its sign-in (for the host) and its ChatGPT endpoint (for the core).
                if let Ok(openai) = std::env::var("MOBIUS_TEST_CHATGPT") {
                    args.extend(["--chatgpt-upstream".into(), format!("{}/backend-api/codex", openai.trim_end_matches('/'))]);
                }
            }
            let core = Arc::new(CoreProcess::start(Options {
                binary: daemon_path(),
                args,
                on_status: Arc::new(move |status: Status| {
                    if let Some(b) = status_slot.get() {
                        b.on_core_status(status);
                    }
                }),
                on_notification: Arc::new(move |method, params| {
                    if let Some(b) = note_slot.get() {
                        b.on_core_notification(method, params);
                    }
                }),
                on_request: Some(Arc::new(move |method, params| match request_slot.get() {
                    Some(b) => b.host_request(method, params),
                    None => Err("not ready".to_owned()),
                })),
                log: Arc::new(|line| eprintln!("[core] {line}")),
            }));
            let emit_handle = handle.clone();
            let emit: mobius_host::bridge::Emit = Arc::new(move |name, payload| {
                let _ = emit_handle.emit(name, payload);
            });
            let secret_store: Arc<dyn mobius_host::secrets::Secrets> =
                if std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1") { Arc::new(mobius_host::secrets::FileSecrets::new(data_dir.join("test-secrets.json"))) } else { Arc::new(secrets::OsSecrets) };
            let bridge = Arc::new(Bridge::new(core.clone(), data_dir.clone(), emit, secret_store));
            let _ = slot.set(bridge.clone());
            bridge.start_models();
            bridge.start_schedules();
            // The core may have become ready before the bridge existed.
            bridge.on_core_status(core.status());
            if test_mode && let Ok(url) = std::env::var("MOBIUS_AGENT_URL") {
                let model = std::env::var("MOBIUS_AGENT_MODEL").unwrap_or_else(|_| "test-model".into());
                let mut seed = serde_json::json!({ "baseUrl": url, "model": model });
                if let Ok(system) = std::env::var("MOBIUS_AGENT_SYSTEM") {
                    seed["system"] = serde_json::json!(system);
                }
                let seeded = bridge.clone();
                let watcher = core.clone();
                std::thread::spawn(move || {
                    while watcher.status() != Status::Ready {
                        std::thread::sleep(std::time::Duration::from_millis(30));
                    }
                    let _ = seeded.seed_agent(&seed);
                });
            }
            if test_mode {
                bridge.enable_test_hooks();
                // `MOBIUS_TEST_PROVIDER=openai=http://127.0.0.1:1234/v1` points one provider at a local fake server.
                // Tests never ask the real Claude Code on this computer: without a fake one, there is none.
                let claude = std::env::var("MOBIUS_TEST_CLAUDE").unwrap_or_else(|_| "no-claude-in-tests".into());
                bridge.use_claude_for_tests(std::path::Path::new(&claude));
                if let Ok(openai) = std::env::var("MOBIUS_TEST_CHATGPT") {
                    bridge.use_chatgpt_for_tests(&openai);
                }
                if let Some((id, url)) = std::env::var("MOBIUS_TEST_PROVIDER").ok().as_deref().and_then(|v| v.split_once('=')) {
                    bridge.redirect_provider_for_tests(id, url);
                }
            }
            let quit_handle = handle.clone();
            bridge.set_quit(Arc::new(move || quit_handle.exit(0)));
            app.manage(updater::Updates::new(test_mode));
            updater::start(&handle);
            app.manage(Shell { bridge: bridge.clone(), mini_place: data_dir.join("little-mobius.json"), tray: std::sync::Mutex::new(None), menu: std::sync::Mutex::new(None), profiles_base: base_dir.clone() });
            // A choice in the macOS menu bar goes to the interface, which runs it.
            handle.on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()));
            // The print in the menu bar or notification area; the app keeps it, found again by its id. Tests start and
            // kill the app hundreds of times, and each kill leaves a dead icon in the notification area: they go
            // without one unless they ask for it.
            if !test_mode || std::env::var("MOBIUS_TEST_TRAY").is_ok_and(|v| v == "1") {
                let _ = tray::create(&handle);
            }
            let hidden = test_mode && std::env::var("MOBIUS_HIDE_WINDOW").is_ok_and(|v| v == "1");
            // The window holds the interface as one web view that fills it, and the browser's pages as more views above it.
            // Tests need one known size; a person gets a window that fits the screen they have and opens in the middle of it.
            let (width, height) = if test_mode {
                (1440.0, 900.0)
            } else {
                app.primary_monitor().ok().flatten().map_or((1440.0, 900.0), |monitor| {
                    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
                    ((size.width * 0.9).min(1440.0), (size.height * 0.85).min(900.0))
                })
            };
            // Where the window was last put, its size, and whether it was maximised; tests always get the known size.
            let window_file = data_dir.join("window.json");
            let keep_window = !test_mode || std::env::var("MOBIUS_KEEP_WINDOW").is_ok_and(|v| v == "1");
            let kept = if keep_window { kept_place(app.handle(), &window_file, (720.0, 480.0)) } else { None };
            let maximised = keep_window && mobius_store::file::read_json(&window_file).is_some_and(|v| v["maximized"] == true);
            let (width, height) = kept.map_or((width, height), |(_, _, w, h)| (w, h));
            let mut builder = WindowBuilder::new(app, "main").title("Mobius").inner_size(width, height).min_inner_size(720.0, 480.0).visible(!hidden);
            builder = match kept {
                Some((x, y, _, _)) => builder.position(x, y),
                None => builder.center(),
            };
            let window = builder.build()?;
            if maximised {
                let _ = window.maximize();
            }
            let scale = window.scale_factor()?;
            let size = window.inner_size()?.to_logical::<f64>(scale);
            #[cfg(target_os = "linux")]
            let _ = WEB_DATA.set(data_dir.join("webview"));
            let interface_view = WebviewBuilder::new("main", WebviewUrl::default());
            #[cfg(windows)]
            let interface_view = match webview2_args() { Some(args) => interface_view.additional_browser_args(&args), None => interface_view };
            #[cfg(target_os = "linux")]
            let interface_view = match web_data() { Some(dir) => interface_view.data_directory(dir), None => interface_view };
            let interface = window.add_child(interface_view, LogicalPosition::new(0.0, 0.0), size)?;
            #[cfg(target_os = "linux")]
            linux_views::place(&interface, 0.0, 0.0, size.width, size.height);
            let web = choose_engine(&window, &data_dir);
            bridge.set_engine(web.name());
            let engine_slot: Arc<OnceLock<Arc<dyn engine::PageEngine>>> = Arc::new(OnceLock::new());
            let _ = engine_slot.set(web.clone());
            app.manage(Engines(web.clone()));
            let visits = bridge.clone();
            // The open tabs are kept as they change, so the next start opens them again. Tests start from a known tab.
            let tabs_file = data_dir.join("tabs.json");
            let restore_tabs = !test_mode || std::env::var("MOBIUS_RESTORE_TABS").is_ok_and(|v| v == "1");
            let notify = keep_tabs(emit_for(&handle), restore_tabs.then(|| tabs_file.clone()));
            let browser = Arc::new(Browser::new(web.clone() as Arc<dyn mobius_browser::engine::Engine>, notify, Box::new(move |url, title| visits.record_visit(url, title))));
            web.attach(&browser);
            web.attach_downloads(&bridge);
            let downloads_dir = std::env::var("MOBIUS_DOWNLOADS_DIR").ok().filter(|_| test_mode).map(PathBuf::from).or_else(|| app.path().download_dir().ok());
            if let Some(dir) = downloads_dir {
                bridge.set_downloads_dir(dir);
            }
            bridge.attach(browser.clone(), Arc::new(SystemDialogs { keep_hidden: hidden, engine: engine_slot, handle: handle.clone(), window: window.clone() }));
            // The first tab: an address given for tests, or a blank page.
            let start = std::env::var("MOBIUS_START_URL").ok().filter(|_| test_mode);
            let reopened = if restore_tabs && start.is_none() {
                mobius_store::file::read_json(&tabs_file).map_or(0, |kept| mobius_browser::session::restore(&browser, &kept))
            } else {
                0
            };
            if reopened == 0 {
                browser.open_url(start.as_deref());
            }
            // The interface follows the window's size.
            let (resized, resize_window) = (interface.clone(), window.clone());
            let focus_bridge = bridge.clone();
            let mini_handle = handle.clone();
            window.on_window_event(move |event| {
                // Little Mobius belongs to the main window: it goes when the main window does.
                if let WindowEvent::Destroyed = event && let Some(mini) = mini_handle.get_webview_window(MINI) {
                    let _ = mini.close();
                }
                if let WindowEvent::Focused(true) = event {
                    focus_bridge.window_activated(std::time::Duration::from_secs(120));
                }
                // The window's place is kept as it moves and resizes; while maximised only that is noted, so the size
                // it goes back to is the one it had.
                if keep_window && matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                    keep_window_place(&resize_window, &window_file);
                }
                if let WindowEvent::Resized(_) = event && let (Ok(scale), Ok(size)) = (resize_window.scale_factor(), resize_window.inner_size()) {
                    let size = size.to_logical::<f64>(scale);
                    let _ = resized.set_size(LogicalSize::new(size.width, size.height));
                    #[cfg(target_os = "linux")]
                    linux_views::place(&resized, 0.0, 0.0, size.width, size.height);
                }
            });
            // Zoom of the interface is applied to it, and page areas are placed in the same units.
            let zoom_bridge = bridge.clone();
            let zoom_web = web.clone();
            let zoomed = interface.clone();
            handle.listen("mobius:appearance-changed", move |_| {
                let zoom = zoom_bridge.zoom();
                zoom_web.set_zoom(zoom);
                let _ = zoomed.set_zoom(zoom);
            });
            // The window follows the theme chosen in settings (or the system's when none is chosen).
            let theme_bridge = bridge.clone();
            let theme_window = window.clone();
            let apply_theme = move || {
                let _ = theme_window.set_theme(match theme_bridge.theme().as_str() {
                    "dark" => Some(tauri::Theme::Dark),
                    "light" => Some(tauri::Theme::Light),
                    _ => None,
                });
            };
            apply_theme();
            let on_theme = apply_theme.clone();
            handle.listen("mobius:appearance-changed", move |_| on_theme());
            if test_mode {
                let probe_window = window.clone();
                let probe_pages = web.clone();
                bridge.set_probe(Arc::new(move |name, arg| match name {
                    "runInPage" => match probe_pages.run_in_page(arg["tab"].as_str().unwrap_or_default(), arg["code"].as_str().unwrap_or_default()) {
                        Ok(value) => serde_json::json!({ "value": value }),
                        Err(error) => serde_json::json!({ "error": error }),
                    },
                    "clipboard" => serde_json::json!(arboard::Clipboard::new().and_then(|mut c| c.get_text()).unwrap_or_default()),
                    "theme" => serde_json::json!(probe_window.theme().map(|t| if t == tauri::Theme::Dark { "dark" } else { "light" }).unwrap_or("light")),
                    "setSize" => {
                        let (w, h) = (arg["width"].as_f64().unwrap_or(1000.0), arg["height"].as_f64().unwrap_or(700.0));
                        let _ = probe_window.set_size(LogicalSize::new(w, h));
                        serde_json::Value::Null
                    }
                    _ => serde_json::Value::Null,
                }));
            }
            let zoom = bridge.zoom();
            web.set_zoom(zoom);
            let _ = interface.set_zoom(zoom);
            Ok(())
        })
        .build(tauri::generate_context!());
    match app {
        Ok(app) => app.run(|handle, event| {
            if matches!(event, tauri::RunEvent::Exit) && let Some(engines) = handle.try_state::<Engines>() {
                engines.0.shutdown();
            }
            if matches!(event, tauri::RunEvent::Exit) && let Some(shell) = handle.try_state::<Shell>() {
                // A downloaded update is installed as Mobius quits, if the person chose that.
                if let Some(updates) = handle.try_state::<updater::Updates>() {
                    let auto = shell.bridge.call("preferences", "get", &[]).ok().and_then(|p| p["autoUpdate"].as_bool()).unwrap_or(true);
                    updates.install_on_quit(auto);
                }
                shell.bridge.stop_core();
            }
        }),
        Err(error) => eprintln!("the Mobius shell could not start: {error}"),
    }
}
