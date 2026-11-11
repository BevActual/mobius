//! Software Update: checks on start and every few hours, downloads quietly, then the window says "restart to install".
//! The rules are in `mobius_host::updates`; this does the checking, downloading and installing with Tauri's updater,
//! which only accepts a download signed with the key whose public half is in tauri.conf.json.
//!
//! Off in development builds, in tests and when MOBIUS_NO_UPDATES is set: the Settings page says so.

use std::sync::Mutex;
use std::time::Duration;

use mobius_host::updates::{CHECK_EVERY_SECS, Event, State};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct Updates {
    state: Mutex<State>,
    /// The downloaded version, checked against the signature, kept until it is installed.
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Why updates are off in this build, if they are.
fn off_because(test_mode: bool) -> Option<&'static str> {
    if cfg!(debug_assertions) {
        Some("Updates are off in development builds.")
    } else if test_mode {
        Some("Updates are off while Mobius is being tested.")
    } else if std::env::var_os("MOBIUS_NO_UPDATES").is_some() {
        Some("Updates are turned off on this computer.")
    } else {
        None
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(0))
}

impl Updates {
    pub fn new(test_mode: bool) -> Updates {
        let state = off_because(test_mode).map_or(State::Idle, |why| State::Off { why: why.to_owned() });
        Updates { state: Mutex::new(state), ready: Mutex::new(None) }
    }

    pub fn snapshot(&self, app: &AppHandle) -> Value {
        lock(&self.state).to_json(&app.package_info().version.to_string())
    }

    fn apply(&self, app: &AppHandle, event: &Event) {
        let next = lock(&self.state).next(event);
        *lock(&self.state) = next;
        let _ = app.emit("mobius:updates", self.snapshot(app));
    }

    /// Look for a newer version and download it, unless one is being checked, downloaded or already waiting.
    pub async fn check(&self, app: &AppHandle) {
        if !lock(&self.state).may_check() {
            return;
        }
        self.apply(app, &Event::CheckStarted);
        let found = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(e) => Err(e),
        };
        let update = match found {
            Ok(Some(update)) => update,
            Ok(None) => return self.apply(app, &Event::NothingNew { at_ms: now_ms() }),
            Err(e) => return self.apply(app, &Event::Failed { error: e.to_string() }),
        };
        self.apply(app, &Event::Found { version: update.version.clone() });
        let mut downloaded: u64 = 0;
        let bytes = update
            .download(
                |chunk, total| {
                    downloaded += chunk as u64;
                    self.apply(app, &Event::Progress { downloaded, total });
                },
                || {},
            )
            .await;
        match bytes {
            Ok(bytes) => {
                *lock(&self.ready) = Some((update, bytes));
                self.apply(app, &Event::Downloaded);
            }
            Err(e) => self.apply(app, &Event::Failed { error: e.to_string() }),
        }
    }

    /// Install the downloaded version and start it. On Windows the installer closes Mobius itself.
    pub fn install_and_restart(&self, app: &AppHandle) -> Value {
        let Some((update, bytes)) = lock(&self.ready).take() else {
            return serde_json::json!({ "ok": false, "error": "No update is waiting." });
        };
        match update.install(bytes) {
            Ok(()) => {
                app.restart();
            }
            Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
        }
    }

    /// At quit: install the downloaded version if the person chose to have updates installed by themselves.
    pub fn install_on_quit(&self, auto_install: bool) {
        if !lock(&self.state).install_on_quit(auto_install) {
            return;
        }
        if let Some((update, bytes)) = lock(&self.ready).take() {
            let _ = update.install(bytes);
        }
    }
}

/// Start checking: now, and every few hours while Mobius is open.
pub fn start(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // A moment after start, so the first check does not slow the window coming up.
        tokio_sleep(Duration::from_secs(20)).await;
        loop {
            if let Some(updates) = handle.try_state::<Updates>() {
                updates.check(&handle).await;
            }
            tokio_sleep(Duration::from_secs(CHECK_EVERY_SECS)).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    let (tx, rx) = tauri::async_runtime::channel::<()>(1);
    std::thread::spawn(move || {
        std::thread::sleep(d);
        let _ = tx.blocking_send(());
    });
    let mut rx = rx;
    let _ = rx.recv().await;
}

/// The window's Software Update calls.
pub async fn call(app: &AppHandle, method: &str) -> Result<Value, Value> {
    let Some(updates) = app.try_state::<Updates>() else {
        return Err(serde_json::json!({ "kind": "not_available", "message": "Updates are not available." }));
    };
    match method {
        "get" => Ok(updates.snapshot(app)),
        "check" => {
            updates.check(app).await;
            Ok(updates.snapshot(app))
        }
        "restart" => Ok(updates.install_and_restart(app)),
        _ => Err(serde_json::json!({ "kind": "not_available", "message": "Not an updates call." })),
    }
}
