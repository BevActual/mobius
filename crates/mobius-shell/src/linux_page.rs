//! Linux: reading and picturing pages through WebKitGTK itself, where Windows uses the Chromium protocol.
//! Calls come from the bridge's threads; the work runs on the main thread and the answer comes back on a channel.
use std::sync::mpsc;
use std::time::Duration;

use javascriptcore::ValueExt;
use serde_json::Value;
use tauri::{Webview, Wry};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

const WAIT: Duration = Duration::from_secs(10);

/// Runs an expression in the page and returns its value as JSON. `isolated`: in a world of its own, which sees the
/// page's DOM but none of its scripts or globals. A promise is waited for.
pub fn eval(webview: &Webview<Wry>, expression: &str, isolated: bool) -> Result<Value, String> {
    let (send, answer) = mpsc::channel::<Result<Value, String>>();
    // The value goes back as text, so anything JSON can say arrives whole and undefined becomes null.
    let body = format!("const value = await ({expression});\nreturn value === undefined ? 'null' : JSON.stringify(value);");
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            let world = isolated.then_some("mobius");
            view.call_async_javascript_function(&body, None, world, None, None::<&webkit2gtk::gio::Cancellable>, move |result| {
                let value = result
                    .map_err(|_| "the page script failed".to_owned())
                    .and_then(|v| serde_json::from_str(v.to_str().as_str()).map_err(|_| "the page answered with something unreadable".to_owned()));
                let _ = send.send(value);
            });
        })
        .map_err(|_| "the page could not be reached".to_owned())?;
    answer.recv_timeout(WAIT).map_err(|_| "the page did not answer".to_owned())?
}

/// What the page shows right now, as PNG bytes.
pub fn picture(webview: &Webview<Wry>) -> Option<Vec<u8>> {
    let (send, answer) = mpsc::channel::<Option<Vec<u8>>>();
    webview
        .with_webview(move |platform| {
            platform.inner().snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&webkit2gtk::gio::Cancellable>, move |result| {
                let bytes = result.ok().and_then(|surface| cairo::ImageSurface::try_from(surface).ok()).and_then(|image| {
                    let mut out = Vec::new();
                    image.write_to_png(&mut out).ok().map(|()| out)
                });
                let _ = send.send(bytes);
            });
        })
        .ok()?;
    answer.recv_timeout(WAIT).ok().flatten()
}

/// Whether the page can go back and forward.
pub fn history(webview: &Webview<Wry>) -> (bool, bool) {
    let (send, answer) = mpsc::channel::<(bool, bool)>();
    let asked = webview.with_webview(move |platform| {
        let view = platform.inner();
        let _ = send.send((view.can_go_back(), view.can_go_forward()));
    });
    if asked.is_err() {
        return (false, false);
    }
    answer.recv_timeout(WAIT).unwrap_or((false, false))
}
