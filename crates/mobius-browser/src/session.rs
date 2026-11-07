//! The tabs open when Mobius closed, kept so the next start opens them again. Only web pages are kept: a blank tab or
//! an internal page is not worth reopening.
use serde_json::{Value, json};

use crate::tabs::Browser;

/// How many tabs a start reopens at most.
pub const MAX_TABS: usize = 50;

/// What to keep from the browser's published state: each web tab's address and whether it is pinned, and which was
/// active (its place among the kept tabs).
pub fn session_of(state: &Value) -> Value {
    let tabs: Vec<&Value> = state["tabs"].as_array().map(|t| t.iter().filter(|t| t["url"].as_str().is_some_and(|u| !u.is_empty())).collect()).unwrap_or_default();
    let active = tabs.iter().position(|t| t["active"].as_bool() == Some(true));
    json!({
        "tabs": tabs.iter().take(MAX_TABS).map(|t| json!({ "url": t["url"], "pinned": t["pinned"].as_bool() == Some(true) })).collect::<Vec<_>>(),
        "active": active,
    })
}

/// Opens the kept tabs, pinned ones pinned, and shows the one that was active. Returns how many opened; with none,
/// the caller opens its usual first tab.
pub fn restore(browser: &Browser, session: &Value) -> usize {
    let Some(tabs) = session["tabs"].as_array() else { return 0 };
    let active = session["active"].as_u64().and_then(|i| usize::try_from(i).ok());
    let mut opened = 0;
    let mut show = None;
    for (at, tab) in tabs.iter().take(MAX_TABS).enumerate() {
        let Some(url) = tab["url"].as_str().filter(|u| crate::address::is_web_url(u)) else { continue };
        let id = browser.open_url(Some(url));
        if tab["pinned"].as_bool() == Some(true) {
            browser.pin(&id, true);
        }
        if active == Some(at) {
            show = Some(id);
        }
        opened += 1;
    }
    if let Some(id) = show {
        browser.activate(&id);
    }
    opened
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::engine::fake::FakeEngine;

    fn browser() -> (Browser, Arc<FakeEngine>) {
        let engine = Arc::new(FakeEngine::default());
        (Browser::new(engine.clone(), Arc::new(|_, _| {}), Box::new(|_, _| {})), engine)
    }

    #[test]
    fn only_web_tabs_are_kept_with_their_pins_and_the_active_one() {
        let state = json!({ "tabs": [
            { "id": "tab-1", "url": "https://a.example/", "pinned": true, "active": false },
            { "id": "tab-2", "url": "", "pinned": false, "active": false },
            { "id": "tab-3", "url": "https://b.example/x", "pinned": false, "active": true },
        ] });
        assert_eq!(session_of(&state), json!({ "tabs": [{ "url": "https://a.example/", "pinned": true }, { "url": "https://b.example/x", "pinned": false }], "active": 1 }));
        assert_eq!(session_of(&json!({ "tabs": [] })), json!({ "tabs": [], "active": null }));
    }

    #[test]
    fn a_start_reopens_the_kept_tabs_pins_them_and_shows_the_active_one() {
        let (b, engine) = browser();
        let session = json!({ "tabs": [{ "url": "https://a.example/", "pinned": true }, { "url": "javascript:alert(1)", "pinned": false }, { "url": "https://b.example/x", "pinned": false }], "active": 2 });
        assert_eq!(restore(&b, &session), 2, "an address that is not a web page is not opened");
        let opens: Vec<String> = engine.calls().into_iter().filter(|c| c.starts_with("open ")).collect();
        assert_eq!(opens, ["open tab-1 https://a.example/", "open tab-2 https://b.example/x"]);
        let state = b.state();
        assert_eq!(state["activeId"], "tab-2");
        assert_eq!(state["tabs"][0]["pinned"], true);
        assert_eq!(restore(&b, &json!(null)), 0);
        assert_eq!(restore(&b, &json!({ "tabs": "x" })), 0);
    }
}
