#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! The Mobius desktop shell on Tauri. It owns the window and the core process and gives the interface one command,
//! `bridge`, which `mobius_host::Bridge` validates. Nothing else is reachable from the page.
mod awake;
mod secrets;
#[cfg(windows)]
mod cdp;
mod engine;
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

struct Shell {
    bridge: Arc<Bridge>,
}

/// The one door from the interface into Rust.
#[tauri::command]
async fn bridge(shell: State<'_, Shell>, namespace: String, method: String, args: Vec<Value>) -> Result<Value, Value> {
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
        .invoke_handler(tauri::generate_handler![bridge])
        .setup(|app| {
            let test_mode = std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1");
            let data_dir = match std::env::var("MOBIUS_USER_DATA") {
                Ok(dir) if test_mode => PathBuf::from(dir),
                _ => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let handle = app.handle().clone();
            let slot: Arc<OnceLock<Arc<Bridge>>> = Arc::new(OnceLock::new());
            let (status_slot, note_slot, request_slot) = (slot.clone(), slot.clone(), slot.clone());
            let mut args = vec!["--db".into(), data_dir.join("core.db").display().to_string(), "--conversations".into(), data_dir.join("conversations.db").display().to_string()];
            args.extend(["--models-dir".into(), data_dir.join("models").display().to_string(), "--download-dir".into(), data_dir.join("models").display().to_string(), "--state-dir".into(), data_dir.display().to_string()]);
            if test_mode {
                args.extend(["--demo-tools".into(), "--no-default-models".into()]);
                if let Ok(hub) = std::env::var("MOBIUS_TEST_HUB") {
                    args.extend(["--hub".into(), hub]);
                }
                if let Ok(llama) = std::env::var("MOBIUS_TEST_LLAMA") {
                    args.extend(["--llama-server".into(), llama]);
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
                if let Some((id, url)) = std::env::var("MOBIUS_TEST_PROVIDER").ok().as_deref().and_then(|v| v.split_once('=')) {
                    bridge.redirect_provider_for_tests(id, url);
                }
            }
            let quit_handle = handle.clone();
            bridge.set_quit(Arc::new(move || quit_handle.exit(0)));
            app.manage(Shell { bridge: bridge.clone() });
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
            let window = WindowBuilder::new(app, "main").title("Mobius").inner_size(width, height).min_inner_size(720.0, 480.0).center().visible(!hidden).build()?;
            let scale = window.scale_factor()?;
            let size = window.inner_size()?.to_logical::<f64>(scale);
            let interface = window.add_child(WebviewBuilder::new("main", WebviewUrl::default()), LogicalPosition::new(0.0, 0.0), size)?;
            let web = choose_engine(&window, &data_dir);
            bridge.set_engine(web.name());
            let engine_slot: Arc<OnceLock<Arc<dyn engine::PageEngine>>> = Arc::new(OnceLock::new());
            let _ = engine_slot.set(web.clone());
            app.manage(Engines(web.clone()));
            let visits = bridge.clone();
            let browser = Arc::new(Browser::new(web.clone() as Arc<dyn mobius_browser::engine::Engine>, emit_for(&handle), Box::new(move |url, title| visits.record_visit(url, title))));
            web.attach(&browser);
            web.attach_downloads(&bridge);
            let downloads_dir = std::env::var("MOBIUS_DOWNLOADS_DIR").ok().filter(|_| test_mode).map(PathBuf::from).or_else(|| app.path().download_dir().ok());
            if let Some(dir) = downloads_dir {
                bridge.set_downloads_dir(dir);
            }
            bridge.attach(browser.clone(), Arc::new(SystemDialogs { keep_hidden: hidden, engine: engine_slot, handle: handle.clone(), window: window.clone() }));
            // The first tab: an address given for tests, or a blank page.
            let start = std::env::var("MOBIUS_START_URL").ok().filter(|_| test_mode);
            browser.open_url(start.as_deref());
            // The interface follows the window's size.
            let (resized, resize_window) = (interface.clone(), window.clone());
            let focus_bridge = bridge.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(true) = event {
                    focus_bridge.window_activated(std::time::Duration::from_secs(120));
                }
                if let WindowEvent::Resized(_) = event && let (Ok(scale), Ok(size)) = (resize_window.scale_factor(), resize_window.inner_size()) {
                    let size = size.to_logical::<f64>(scale);
                    let _ = resized.set_size(LogicalSize::new(size.width, size.height));
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
        }),
        Err(error) => eprintln!("the Mobius shell could not start: {error}"),
    }
}
