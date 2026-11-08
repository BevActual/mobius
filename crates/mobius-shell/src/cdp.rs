//! Talking to a page with the DevTools protocol, and the few WebView2 settings Tauri does not expose.
#![cfg(windows)]
use std::sync::mpsc;
use std::time::Duration;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Webview, Wry};
use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_DOWNLOAD_STATE, COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED, COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS, ICoreWebView2DownloadOperation, ICoreWebView2Settings3, ICoreWebView2Settings8, ICoreWebView2_4, COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
use webview2_com::{AcceleratorKeyPressedEventHandler, BytesReceivedChangedEventHandler, DownloadStartingEventHandler, StateChangedEventHandler, take_pwstr};
use windows::core::{Interface, PWSTR};
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY};
use webview2_com::PermissionRequestedEventHandler;
use windows::core::HSTRING;

/// Calls a DevTools protocol method on a page and gives back the JSON answer.
pub fn call(webview: &Webview<Wry>, method: &str, params: &str, timeout: Duration) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let (method, params) = (HSTRING::from(method), HSTRING::from(params));
    let sender = tx.clone();
    webview
        .with_webview(move |platform| {
            // SAFETY: the controller and its core view are used on the thread that owns them (this closure runs on it),
            // and the handler is a COM object kept alive by the call.
            let outcome = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = platform.controller().CoreWebView2()?;
                    let reply = sender.clone();
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                        let _ = reply.send(result.map(|()| json).map_err(|e| e.message()));
                        Ok(())
                    }));
                    core.CallDevToolsProtocolMethod(&method, &params, &handler)
                })()
            };
            if let Err(e) = outcome {
                let _ = sender.send(Err(e.message()));
            }
        })
        .map_err(|e| e.to_string())?;
    drop(tx);
    rx.recv_timeout(timeout).map_err(|_| "the page did not answer".to_owned())?
}

/// Deny every permission a page asks for (camera, location, notifications...), except that `allow_microphone` lets the
/// shell's own window listen for dictation.
pub fn restrict_permissions(webview: &Webview<Wry>, allow_microphone: bool) {
    let _ = webview.with_webview(move |platform| {
        // SAFETY: same as above.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut kind = Default::default();
                    args.PermissionKind(&mut kind)?;
                    let allow = allow_microphone && kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE;
                    args.SetState(if allow { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY })?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
        }
    });
}

/// Whether the page can go back, and forward.
pub fn history(webview: &Webview<Wry>) -> (bool, bool) {
    let (tx, rx) = mpsc::channel();
    let _ = webview.with_webview(move |platform| {
        // SAFETY: same as above.
        let answer = unsafe {
            platform.controller().CoreWebView2().ok().map(|core| {
                let (mut back, mut forward) = (windows::core::BOOL(0), windows::core::BOOL(0));
                let _ = core.CanGoBack(&mut back);
                let _ = core.CanGoForward(&mut forward);
                (back.as_bool(), forward.as_bool())
            })
        };
        let _ = tx.send(answer);
    });
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten().unwrap_or((false, false))
}

pub type StartFn = Arc<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
pub type ProgressFn = Arc<dyn Fn(&Path, u64, u64) + Send + Sync>;
pub type EndFn = Arc<dyn Fn(&Path, bool) + Send + Sync>;

thread_local! {
    /// The downloads in progress, by where they are being saved. Only the window thread touches them.
    static OPERATIONS: std::cell::RefCell<std::collections::HashMap<PathBuf, ICoreWebView2DownloadOperation>> = std::cell::RefCell::default();
}

/// Names of files that can run a program on Windows.
const RUNS_PROGRAMS: [&str; 9] = [".exe", ".msi", ".msix", ".bat", ".cmd", ".ps1", ".com", ".scr", ".vbs"];

/// Lets the application decide where each download goes (`start` gets the suggested file name and returns the place to
/// save it, or nothing to refuse), and hears how it goes (`progress`, then `end` with whether it worked).
pub fn watch_downloads(webview: &Webview<Wry>, start: StartFn, progress: ProgressFn, end: EndFn) {
    let _ = webview.with_webview(move |platform| {
        // SAFETY: same as above; the handlers are COM objects owned by the web view for as long as it lives.
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let Ok(core4) = core.cast::<ICoreWebView2_4>() else { return };
            let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut file = PWSTR::null();
                args.ResultFilePath(&mut file)?;
                let suggested = PathBuf::from(take_pwstr(file));
                let name = suggested.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let Some(path) = start(&name) else { return args.SetCancel(true) };
                args.SetResultFilePath(&HSTRING::from(path.as_path().as_os_str()))?;
                // A file that can run a program is held by WebView2 until someone says to keep it, and with the download
                // handled here nobody could: it would stay "downloading" for ever. For those, WebView2 shows its own
                // download prompt with Keep; the list here still follows it and says when it is done.
                let runs = RUNS_PROGRAMS.iter().any(|e| name.to_ascii_lowercase().ends_with(e));
                args.SetHandled(!runs)?;
                let operation = args.DownloadOperation()?;
                let (progress, place) = (progress.clone(), path.clone());
                let received = BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                    let Some(operation) = operation else { return Ok(()) };
                    let (mut got, mut total) = (0i64, 0i64);
                    operation.BytesReceived(&mut got)?;
                    operation.TotalBytesToReceive(&mut total)?;
                    progress(&place, got.max(0) as u64, total.max(0) as u64);
                    Ok(())
                }));
                let (end, place) = (end.clone(), path.clone());
                let changed = StateChangedEventHandler::create(Box::new(move |operation, _| {
                    let Some(operation) = operation else { return Ok(()) };
                    let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                    operation.State(&mut state)?;
                    if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                        OPERATIONS.with(|ops| ops.borrow_mut().remove(&place));
                        end(&place, state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED);
                    }
                    Ok(())
                }));
                let mut token = 0i64;
                operation.add_BytesReceivedChanged(&received, &mut token)?;
                operation.add_StateChanged(&changed, &mut token)?;
                OPERATIONS.with(|ops| ops.borrow_mut().insert(path, operation));
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core4.add_DownloadStarting(&handler, &mut token);
        }
    });
}

/// Stops the download being saved at `path`, if it is still running.
pub fn cancel_download(webview: &Webview<Wry>, path: PathBuf) {
    let _ = webview.with_webview(move |_| {
        let operation = OPERATIONS.with(|ops| ops.borrow_mut().remove(&path));
        if let Some(operation) = operation {
            // SAFETY: the operation is a live COM object on the thread that owns it.
            let _ = unsafe { operation.Cancel() };
        }
    });
}

pub type KeyFn = Arc<dyn Fn(u32, bool, bool, bool) -> bool + Send + Sync>;

/// Passes key presses made inside a page to `on_key(virtual key, control, alt, shift)`; when it answers `true` the page
/// does not get the press. The web view's own browser shortcuts (its find box, zoom, print) are turned off.
pub fn watch_keys(webview: &Webview<Wry>, on_key: KeyFn) {
    let _ = webview.with_webview(move |platform| {
        // SAFETY: same as above.
        unsafe {
            let controller = platform.controller();
            if let Ok(core) = controller.CoreWebView2()
                && let Ok(settings) = core.Settings()
                && let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>()
            {
                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                    return Ok(());
                }
                let mut key = 0u32;
                args.VirtualKey(&mut key)?;
                let down = |vk: i32| (GetKeyState(vk) as u16 & 0x8000) != 0;
                if on_key(key, down(i32::from(VK_CONTROL.0)), down(i32::from(VK_MENU.0)), down(i32::from(VK_SHIFT.0))) {
                    args.SetHandled(true)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
        }
    });
}

/// Turns the web view's online reputation check (SmartScreen) off. Only for tests, which run with no network guarantee.
pub fn disable_reputation_check(webview: &Webview<Wry>) {
    let _ = webview.with_webview(move |platform| {
        // SAFETY: same as above.
        unsafe {
            if let Ok(core) = platform.controller().CoreWebView2()
                && let Ok(settings) = core.Settings()
                && let Ok(settings8) = settings.cast::<ICoreWebView2Settings8>()
            {
                let _ = settings8.SetIsReputationCheckingRequired(false);
            }
        }
    });
}
