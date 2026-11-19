//! The launcher from anywhere: its own small window, over whatever app is in front, opened by the launcher's key (Ctrl+Space
//! unless changed). It shows the same interface, which sees the window's label and draws only the launcher. Choosing
//! something hands it to the main window, which comes forward and opens it; closing goes back to the app you were in.
//!
//! The window is made the first time and then hidden and shown, so it opens at once after that.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow};

pub const LABEL: &str = "launcher";
const WIDTH: f64 = 640.0;
const HEIGHT: f64 = 440.0;
/// The most a question from the launcher's window may hold, and the most an answer to it may.
const MAX_QUERY: usize = 2000;
const MAX_ANSWER: usize = 256 * 1024;

/// Open the launcher window over the app in front, or put it away when it is already open.
pub fn toggle(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
        place(app, &window);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to(LABEL, "mobius:launcher-shown", ());
        return;
    }
    let Ok(window) = build(app) else { return };
    place(app, &window);
    let _ = window.show();
    let _ = window.set_focus();
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let mut builder = tauri::WebviewWindowBuilder::new(app, LABEL, WebviewUrl::default());
    #[cfg(windows)]
    if let Some(args) = crate::webview2_args() {
        builder = builder.additional_browser_args(&args);
    }
    #[cfg(target_os = "linux")]
    if let Some(dir) = crate::web_data() {
        builder = builder.data_directory(dir);
    }
    let window = builder
        .title("Mobius launcher")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    // Clicking anywhere else puts it away, as a menu does.
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = hidden.hide();
        }
    });
    Ok(window)
}

/// Across the middle of the screen the pointer is on, a little above centre, where the eye already is.
fn place(app: &AppHandle, window: &WebviewWindow) {
    let pointer = app.cursor_position().ok();
    let monitors = app.available_monitors().unwrap_or_default();
    let monitor = pointer
        .and_then(|p| {
            monitors.iter().find(|m| {
                let (at, size) = (m.position(), m.size());
                p.x >= f64::from(at.x) && p.y >= f64::from(at.y) && p.x < f64::from(at.x) + f64::from(size.width) && p.y < f64::from(at.y) + f64::from(size.height)
            })
        })
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (left, top) = (f64::from(area.position.x) / scale, f64::from(area.position.y) / scale);
    let (across, down) = (f64::from(area.size.width) / scale, f64::from(area.size.height) / scale);
    let x = left + ((across - WIDTH) / 2.0).max(0.0);
    let y = top + (down * 0.22).min((down - HEIGHT).max(0.0));
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// The launcher window's calls: put it away, or hand what was chosen to the main window.
pub fn call(app: &AppHandle, method: &str, args: &[Value]) -> Result<Value, Value> {
    match method {
        "hide" => {
            if let Some(window) = app.get_webview_window(LABEL) {
                let _ = window.hide();
            }
            Ok(Value::Null)
        }
        "run" => {
            let chosen = args.first().cloned().unwrap_or(Value::Null);
            if !chosen.is_object() {
                return Err(serde_json::json!({ "kind": "invalid", "message": "Nothing was chosen." }));
            }
            if let Some(window) = app.get_webview_window(LABEL) {
                let _ = window.hide();
            }
            if let Some(main) = app.get_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
            let _ = app.emit("mobius:launch", chosen);
            Ok(Value::Null)
        }
        // The launcher's window asks the main window what it finds for the words typed; the main window answers.
        // Rust only passes each on, checked for shape and size.
        "find" => {
            let (Some(query), Some(seq)) = (args.first().and_then(Value::as_str), args.get(1).and_then(Value::as_u64)) else {
                return Err(serde_json::json!({ "kind": "invalid", "message": "A question needs its words and a number." }));
            };
            if query.len() > MAX_QUERY {
                return Err(serde_json::json!({ "kind": "invalid", "message": "Those words are too long." }));
            }
            let _ = app.emit_to("main", "mobius:launcher-find", serde_json::json!({ "query": query, "seq": seq }));
            Ok(Value::Null)
        }
        "answer" => {
            let answer = args.first().cloned().unwrap_or(Value::Null);
            if !answer.is_object() || answer.to_string().len() > MAX_ANSWER {
                return Err(serde_json::json!({ "kind": "invalid", "message": "Not an answer." }));
            }
            let _ = app.emit_to(LABEL, "mobius:launcher-found", answer);
            Ok(Value::Null)
        }
        _ => Err(serde_json::json!({ "kind": "not_available", "message": "Not a launcher call." })),
    }
}
