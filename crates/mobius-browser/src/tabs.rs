//! Every browser tab: which are open, which is showing, what each page is called and where it is. The pages
//! themselves live in the engine; this is the application's side of them.
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{Value, json};

use crate::address::{Address, is_web_url, resolve_address};
use crate::engine::{Bounds, Engine};
use crate::page_actions::{READ_SCRIPT, SELECTION_SCRIPT};

pub const START_PAGE: &str = "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ENew%20tab%3C%2Ftitle%3E%3Cmeta%20name%3D%22color-scheme%22%20content%3D%22light%20dark%22%3E%3Cbody%20style%3D%22font%3A14px%20system-ui%3Bdisplay%3Agrid%3Bplace-items%3Acenter%3Bheight%3A100vh%3Bmargin%3A0%3Bcolor%3A%236e6e73%22%3E%3Cp%3EType%20an%20address%2C%20or%20ask%20a%20question.";

/// Called when a page has finished loading: `(url, title)`.
pub type VisitFn = Box<dyn Fn(&str, &str) + Send + Sync>;

/// Tells the interface something happened: `(event name, payload)`.
pub type Notify = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Debug, Clone)]
struct Tab {
    id: String,
    url: String,
    title: String,
    loading: bool,
    can_back: bool,
    can_forward: bool,
    icon: Option<String>,
    icon_from: Option<String>,
    pinned: bool,
    /// The page finished loading before it had a title: the first title it gets goes to history too.
    untitled_visit: bool,
    /// Who is using the tab while a task runs: Mobius reading it, Mobius driving it, or the person who took over.
    driver: Option<Driver>,
}

/// Who is using a tab while a task runs. With none, the tab is simply the person's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Driver {
    /// Mobius reads it and changes nothing.
    Reading,
    /// Mobius opens, clicks and types in it.
    Mobius,
    /// The person took over from Mobius: the tab is theirs until they hand back.
    Yours,
}

impl Driver {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Driver::Reading => "reading",
            Driver::Mobius => "mobius",
            Driver::Yours => "yours",
        }
    }
}

/// How many closed pages are remembered for reopening.
const MAX_CLOSED: usize = 20;

#[derive(Default)]
struct State {
    tabs: Vec<Tab>,
    active: Option<String>,
    counter: u64,
    bounds: Option<Bounds>,
    closed: Vec<String>,
}

pub struct Browser {
    engine: Arc<dyn Engine>,
    state: Mutex<State>,
    notify: Notify,
    /// Called when a page has finished loading in a tab: `(url, title)`.
    on_visit: VisitFn,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// What the window knows of a tab: only plain web addresses are shown.
fn shown_url(url: &str) -> &str {
    if is_web_url(url) { url } else { "" }
}

impl Browser {
    pub fn new(engine: Arc<dyn Engine>, notify: Notify, on_visit: VisitFn) -> Browser {
        Browser { engine, state: Mutex::new(State::default()), notify, on_visit }
    }

    fn publish(&self) {
        (self.notify)("mobius:browser-state", self.state());
    }

    pub fn state(&self) -> Value {
        let s = lock(&self.state);
        let tabs: Vec<Value> = s
            .tabs
            .iter()
            .map(|t| {
                let url = shown_url(&t.url);
                json!({
                    "id": t.id, "url": url, "title": if t.title.is_empty() { if url.is_empty() { "New tab" } else { url } } else { t.title.as_str() },
                    "loading": t.loading, "canGoBack": t.can_back, "canGoForward": t.can_forward, "pinned": t.pinned, "active": s.active.as_deref() == Some(t.id.as_str()), "icon": t.icon, "driver": t.driver.map(Driver::as_str),
                })
            })
            .collect();
        json!({ "tabs": tabs, "activeId": s.active })
    }

    fn layout(&self) {
        let (active, bounds) = {
            let s = lock(&self.state);
            (s.active.clone(), s.bounds)
        };
        let shown = bounds.filter(|b| b.width > 0 && b.height > 0);
        self.engine.layout(active.as_deref().filter(|_| shown.is_some()), shown);
    }

    /// Opens a new tab (on the start page when there is no address) and makes it the active one.
    pub fn open_url(&self, url: Option<&str>) -> String {
        let id = {
            let mut s = lock(&self.state);
            s.counter += 1;
            let id = format!("tab-{}", s.counter);
            s.tabs.push(Tab { id: id.clone(), url: String::new(), title: String::new(), loading: true, can_back: false, can_forward: false, icon: None, icon_from: None, pinned: false, untitled_visit: false, driver: None });
            id
        };
        self.engine.open(&id, url.unwrap_or(START_PAGE));
        self.activate(&id);
        id
    }

    /// The address bar's "new tab" button and the launcher: an address opens it, a question or nothing opens a blank tab.
    pub fn open(&self, input: Option<&str>) -> Option<String> {
        match input.map(str::trim).filter(|i| !i.is_empty()) {
            Some(text) => match resolve_address(text) {
                Address::Url(url) => Some(self.open_url(Some(&url))),
                _ => None,
            },
            None => Some(self.open_url(None)),
        }
    }

    /// Opens the page that was closed last, if one is remembered.
    pub fn reopen_closed(&self) -> Option<String> {
        let url = lock(&self.state).closed.pop()?;
        Some(self.open_url(Some(&url)))
    }

    /// Another tab on the same page, right after this one. A blank tab gives a blank tab.
    pub fn duplicate(&self, id: &str) -> Option<String> {
        let url = lock(&self.state).tabs.iter().find(|t| t.id == id).map(|t| t.url.clone())?;
        let copy = self.open_url(is_web_url(&url).then_some(url.as_str()));
        {
            let mut s = lock(&self.state);
            if let (Some(from), Some(at)) = (s.tabs.iter().position(|t| t.id == id), s.tabs.iter().position(|t| t.id == copy)) {
                let tab = s.tabs.remove(at);
                s.tabs.insert(from + 1, tab);
            }
        }
        self.publish();
        Some(copy)
    }

    /// Pinned tabs stay at the front. Pinning moves a tab to the end of the pinned ones; unpinning to the front of the others.
    pub fn pin(&self, id: &str, pinned: bool) {
        {
            let mut s = lock(&self.state);
            let Some(at) = s.tabs.iter().position(|t| t.id == id) else { return };
            if s.tabs[at].pinned == pinned {
                return;
            }
            let mut tab = s.tabs.remove(at);
            tab.pinned = pinned;
            let front = s.tabs.iter().take_while(|t| t.pinned).count();
            s.tabs.insert(front, tab);
        }
        self.publish();
    }

    /// Moves a tab to a place in the strip, but never across the line between pinned and ordinary tabs.
    pub fn move_tab(&self, id: &str, to: usize) {
        {
            let mut s = lock(&self.state);
            let Some(at) = s.tabs.iter().position(|t| t.id == id) else { return };
            let tab = s.tabs.remove(at);
            let pinned = s.tabs.iter().filter(|t| t.pinned).count();
            let (low, high) = if tab.pinned { (0, pinned) } else { (pinned, s.tabs.len()) };
            s.tabs.insert(to.clamp(low, high), tab);
        }
        self.publish();
    }

    pub fn activate(&self, id: &str) {
        {
            let mut s = lock(&self.state);
            if !s.tabs.iter().any(|t| t.id == id) {
                return;
            }
            s.active = Some(id.to_owned());
        }
        self.layout();
        self.publish();
    }

    pub fn close(&self, id: &str) {
        let next = {
            let mut s = lock(&self.state);
            let Some(index) = s.tabs.iter().position(|t| t.id == id) else { return };
            let gone = s.tabs.remove(index);
            if is_web_url(&gone.url) {
                s.closed.push(gone.url);
                if s.closed.len() > MAX_CLOSED {
                    s.closed.remove(0);
                }
            }
            if s.active.as_deref() == Some(id) {
                s.active = s.tabs.get(index).or_else(|| index.checked_sub(1).and_then(|i| s.tabs.get(i))).map(|t| t.id.clone());
            }
            s.active.clone()
        };
        self.engine.close(id);
        match next {
            None => {
                self.open_url(None);
            }
            Some(n) => self.activate(&n),
        }
    }

    /// `navigated`, `ask`, `blocked` or `empty`.
    pub fn navigate(&self, id: &str, input: &str) -> &'static str {
        match resolve_address(input) {
            Address::Ask(_) => "ask",
            Address::Empty => "empty",
            Address::Blocked(_) => "blocked",
            Address::Url(url) => {
                if !lock(&self.state).tabs.iter().any(|t| t.id == id) {
                    return "blocked";
                }
                self.engine.navigate(id, &url);
                "navigated"
            }
        }
    }

    pub fn back(&self, id: &str) {
        if lock(&self.state).tabs.iter().any(|t| t.id == id && t.can_back) {
            self.engine.back(id);
        }
    }

    pub fn forward(&self, id: &str) {
        if lock(&self.state).tabs.iter().any(|t| t.id == id && t.can_forward) {
            self.engine.forward(id);
        }
    }

    pub fn reload(&self, id: &str) {
        if lock(&self.state).tabs.iter().any(|t| t.id == id) {
            self.engine.reload(id);
        }
    }

    /// `None` hides the page, which is how overlays (launcher, menus) get drawn above the native view.
    pub fn set_bounds(&self, bounds: Option<Bounds>) {
        lock(&self.state).bounds = bounds;
        self.layout();
    }

    /// A picture of the showing page as a JPEG data address, or none when there is none to take.
    pub fn picture(&self) -> Option<String> {
        let id = lock(&self.state).active.clone()?;
        let bytes = self.engine.picture(&id)?;
        (!bytes.is_empty()).then(|| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }

    pub fn find(&self, id: &str, text: &str, forward: bool, again: bool) {
        if !text.is_empty() && lock(&self.state).tabs.iter().any(|t| t.id == id) {
            self.engine.find(id, text, forward, again);
        }
    }

    pub fn stop_find(&self, id: &str) {
        if lock(&self.state).tabs.iter().any(|t| t.id == id) {
            self.engine.stop_find(id);
        }
    }

    // ---- what the engine reports ----

    fn update(&self, id: &str, change: impl FnOnce(&mut Tab)) {
        {
            let mut s = lock(&self.state);
            let Some(tab) = s.tabs.iter_mut().find(|t| t.id == id) else { return };
            change(tab);
        }
        self.publish();
    }

    /// The page moved: a new address (and what back and forward can do now).
    pub fn navigated(&self, id: &str, url: &str, can_back: bool, can_forward: bool) {
        self.update(id, |t| {
            if t.url != url {
                // A new page has its own icon (or none): the old one goes, and the new one arrives with the page.
                t.icon = None;
                t.icon_from = None;
            }
            t.url = url.to_owned();
            t.can_back = can_back;
            t.can_forward = can_forward;
        });
    }

    pub fn titled(&self, id: &str, title: &str) {
        let title: String = title.chars().take(300).collect();
        // Once per load: a visit kept under its address learns its title. Later changes (a count in the title) do not.
        let revisit = {
            let mut s = lock(&self.state);
            s.tabs.iter_mut().find(|t| t.id == id).filter(|t| t.untitled_visit && !title.trim().is_empty()).map(|t| {
                t.untitled_visit = false;
                t.url.clone()
            })
        };
        if let Some(url) = &revisit {
            (self.on_visit)(url, &title);
        }
        self.update(id, |t| t.title = title);
    }

    pub fn loading(&self, id: &str, loading: bool) {
        self.update(id, |t| t.loading = loading);
    }

    /// A page finished loading.
    pub fn finished(&self, id: &str) {
        self.loading(id, false);
        let page = {
            let mut s = lock(&self.state);
            s.tabs.iter_mut().find(|t| t.id == id).map(|t| {
                t.untitled_visit = t.title.trim().is_empty();
                (t.url.clone(), t.title.clone())
            })
        };
        if let Some((url, title)) = page {
            (self.on_visit)(&url, &title);
        }
    }

    /// An icon fetched for the tab, as a data address. `from` is the address it came from.
    pub fn icon(&self, id: &str, from: &str, icon: Option<String>) {
        self.update(id, |t| {
            if t.icon_from.as_deref() == Some(from) {
                t.icon = icon;
            }
        });
    }

    /// The page offers an icon at this address. Returns it if it is one to fetch (a web address not already fetched).
    pub fn icon_offered(&self, id: &str, offered: &[String]) -> Option<String> {
        let url = crate::favicon::choose_icon(offered)?.clone();
        let mut s = lock(&self.state);
        let tab = s.tabs.iter_mut().find(|t| t.id == id)?;
        if tab.icon_from.as_deref() == Some(url.as_str()) {
            return None;
        }
        tab.icon_from = Some(url.clone());
        Some(url)
    }

    /// A page asked for a new window. It gets a new tab, but only for web addresses.
    pub fn new_window(&self, url: &str) {
        if let Address::Url(u) = resolve_address(url) {
            self.open_url(Some(&u));
        }
    }

    pub fn found(&self, id: &str, active: u64, matches: u64) {
        (self.notify)("mobius:browser-found", json!({ "tabId": id, "active": active, "matches": matches }));
    }

    /// Only plain web addresses may be loaded by a page itself (a redirect to `file:` or `javascript:` is refused).
    pub fn allows_navigation(&self, url: &str) -> bool {
        is_web_url(url) || url == START_PAGE
    }

    // ---- for the agent's tools ----

    pub fn list(&self) -> Vec<(String, String, String, bool)> {
        let s = lock(&self.state);
        s.tabs.iter().map(|t| (t.id.clone(), shown_url(&t.url).to_owned(), t.title.clone(), s.active.as_deref() == Some(t.id.as_str()))).collect()
    }

    pub fn has_tab(&self, id: &str) -> bool {
        lock(&self.state).tabs.iter().any(|t| t.id == id)
    }

    /// The tab that is showing and where, or none while the page is hidden.
    pub fn shown(&self) -> Option<(String, Bounds)> {
        let s = lock(&self.state);
        let id = s.active.clone()?;
        let bounds = s.bounds.filter(|b| b.width > 0 && b.height > 0)?;
        Some((id, bounds))
    }

    /// Who is using a tab now (none: the person's, as usual).
    #[must_use]
    pub fn driver(&self, id: &str) -> Option<Driver> {
        lock(&self.state).tabs.iter().find(|t| t.id == id).and_then(|t| t.driver)
    }

    /// Say who is using a tab; the window shows it on the tab.
    pub fn set_driver(&self, id: &str, driver: Option<Driver>) {
        let changed = {
            let mut s = lock(&self.state);
            match s.tabs.iter_mut().find(|t| t.id == id) {
                Some(t) if t.driver != driver => {
                    t.driver = driver;
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.publish();
        }
    }

    pub fn active_id(&self) -> Option<String> {
        lock(&self.state).active.clone()
    }

    /// True once the tab has finished loading; false if it was still loading after `timeout`.
    pub fn wait_for_load(&self, id: &str, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let found = lock(&self.state).tabs.iter().find(|t| t.id == id).map(|t| (t.loading, t.url.clone()));
            match found {
                None => return false,
                Some((false, url)) if !url.is_empty() && url != "about:blank" => return !url.starts_with("chrome-error:") && !url.starts_with("edge:"),
                _ => std::thread::sleep(Duration::from_millis(40)),
            }
        }
        false
    }

    /// The visible text of a tab, with its address and title. Read in a world that sees none of the page's own scripts.
    pub fn read(&self, id: &str) -> Option<(String, String, String)> {
        if !self.has_tab(id) {
            return None;
        }
        let value = self.engine.eval(id, READ_SCRIPT).ok()?;
        let text = value.get("text").and_then(Value::as_str).unwrap_or("").to_owned();
        let url = value.get("url").and_then(Value::as_str).unwrap_or("").to_owned();
        let title = value.get("title").and_then(Value::as_str).unwrap_or("").to_owned();
        Some((url, title, text))
    }

    /// The text selected in a tab, with its address and title. Empty text when nothing is selected.
    pub fn selection(&self, id: &str) -> Option<(String, String, String)> {
        if !self.has_tab(id) {
            return None;
        }
        let value = self.engine.eval(id, SELECTION_SCRIPT).ok()?;
        let text = value.get("text").and_then(Value::as_str).unwrap_or("").to_owned();
        let url = value.get("url").and_then(Value::as_str).unwrap_or("").to_owned();
        let title = value.get("title").and_then(Value::as_str).unwrap_or("").to_owned();
        Some((url, title, text))
    }

    pub fn eval(&self, id: &str, script: &str) -> Result<Value, String> {
        if !self.has_tab(id) {
            return Err("no such tab".into());
        }
        self.engine.eval(id, script)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fake::FakeEngine;

    type Seen = Arc<Mutex<Vec<(String, Value)>>>;
    type Visits = Arc<Mutex<Vec<(String, String)>>>;

    fn browser() -> (Browser, Arc<FakeEngine>, Seen, Visits) {
        let engine = Arc::new(FakeEngine::default());
        let seen: Seen = Arc::default();
        let visits = Arc::new(Mutex::new(Vec::new()));
        let (s, v) = (seen.clone(), visits.clone());
        let b = Browser::new(engine.clone(), Arc::new(move |n, p| s.lock().unwrap().push((n.to_owned(), p))), Box::new(move |u, t| v.lock().unwrap().push((u.to_owned(), t.to_owned()))));
        (b, engine, seen, visits)
    }

    fn ids(b: &Browser) -> Vec<String> {
        b.state()["tabs"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn a_new_tab_is_active_and_a_blank_one_shows_new_tab_with_no_address() {
        let (b, engine, _, _) = browser();
        let id = b.open(None).unwrap();
        assert_eq!(id, "tab-1");
        let state = b.state();
        assert_eq!((state["activeId"].clone(), state["tabs"][0]["title"].clone(), state["tabs"][0]["url"].clone(), state["tabs"][0]["active"].clone()), (json!("tab-1"), json!("New tab"), json!(""), json!(true)));
        assert_eq!(engine.calls(), vec![format!("open tab-1 {START_PAGE}")]);
    }

    #[test]
    fn an_address_opens_a_page_and_a_question_or_junk_does_not() {
        let (b, engine, _, _) = browser();
        assert!(b.open(Some("example.com/x")).is_some());
        assert!(engine.calls().contains(&"open tab-1 https://example.com/x".to_owned()));
        for no in ["what is rust", "javascript:alert(1)", "file:///c:/x", "https://u:p@a.example"] {
            assert!(b.open(Some(no)).is_none(), "{no}");
        }
        assert_eq!(ids(&b), vec!["tab-1"]);
        assert!(b.open(Some("   ")).is_some(), "blank input is a blank tab");
    }

    #[test]
    fn closing_the_active_tab_activates_its_neighbour_and_the_last_tab_is_replaced() {
        let (b, _, _, _) = browser();
        for _ in 0..3 {
            b.open(None);
        }
        b.activate("tab-2");
        b.close("tab-2");
        assert_eq!(b.state()["activeId"], json!("tab-3"), "the one after");
        b.close("tab-3");
        assert_eq!(b.state()["activeId"], json!("tab-1"), "no one after, so the one before");
        b.close("tab-1");
        assert_eq!(ids(&b), vec!["tab-4"], "closing the last tab opens a fresh one");
        b.close("tab-9");
        b.activate("tab-9");
        assert_eq!(b.state()["activeId"], json!("tab-4"), "unknown tabs change nothing");
    }

    #[test]
    fn closing_a_tab_that_is_not_active_keeps_the_active_one() {
        let (b, engine, _, _) = browser();
        for _ in 0..3 {
            b.open(None);
        }
        b.close("tab-1");
        assert_eq!(b.state()["activeId"], json!("tab-3"));
        assert!(engine.calls().contains(&"close tab-1".to_owned()));
    }

    #[test]
    fn navigating_answers_what_happened() {
        let (b, engine, _, _) = browser();
        b.open(None);
        assert_eq!(b.navigate("tab-1", "example.com"), "navigated");
        assert_eq!(b.navigate("tab-1", "what is it"), "ask");
        assert_eq!(b.navigate("tab-1", "  "), "empty");
        assert_eq!(b.navigate("tab-1", "javascript:alert(1)"), "blocked");
        assert_eq!(b.navigate("tab-9", "example.com"), "blocked");
        assert_eq!(engine.calls().iter().filter(|c| c.starts_with("navigate")).count(), 1);
    }

    #[test]
    fn back_and_forward_only_happen_when_there_is_somewhere_to_go() {
        let (b, engine, _, _) = browser();
        b.open(None);
        b.back("tab-1");
        b.forward("tab-1");
        assert!(!engine.calls().iter().any(|c| c.starts_with("back") || c.starts_with("forward")));
        b.navigated("tab-1", "https://a.example/", true, true);
        b.back("tab-1");
        b.forward("tab-1");
        b.reload("tab-1");
        b.reload("tab-9");
        let calls = engine.calls();
        assert!(calls.contains(&"back tab-1".to_owned()) && calls.contains(&"forward tab-1".to_owned()));
        assert_eq!(calls.iter().filter(|c| c.starts_with("reload")).count(), 1);
    }

    #[test]
    fn only_the_active_tab_is_shown_and_only_when_there_is_room_for_it() {
        let (b, engine, _, _) = browser();
        b.open(None);
        b.open(None);
        let area = Bounds { x: 10, y: 20, width: 300, height: 200 };
        b.set_bounds(Some(area));
        b.set_bounds(None);
        b.set_bounds(Some(Bounds { width: 0, ..area }));
        b.activate("tab-1");
        let last = engine.layouts.lock().unwrap().clone();
        assert!(last.contains(&(Some("tab-2".into()), Some(area))));
        assert!(last.iter().filter(|(_, bounds)| bounds.is_none()).count() >= 3, "hidden when there are no bounds or no room: {last:?}");
        assert_eq!(last.last().unwrap(), &(None, None));
    }

    fn titles(b: &Browser) -> Vec<String> {
        b.state()["tabs"].as_array().unwrap().iter().map(|t| format!("{}{}", t["id"].as_str().unwrap(), if t["pinned"] == json!(true) { "*" } else { "" })).collect()
    }

    #[test]
    fn a_closed_page_can_be_reopened_newest_first_and_only_web_pages_are_kept() {
        let (b, engine, _, _) = browser();
        b.open(Some("https://a.example/"));
        b.navigated("tab-1", "https://a.example/", false, false);
        b.open(Some("https://b.example/"));
        b.navigated("tab-2", "https://b.example/", false, false);
        b.open(None);
        b.close("tab-3");
        b.close("tab-1");
        b.close("tab-2");
        let opened = || engine.calls().into_iter().rfind(|c| c.starts_with("open")).unwrap();
        let first = b.reopen_closed().unwrap();
        assert_eq!(opened(), format!("open {first} https://b.example/"), "the last closed comes back first");
        let second = b.reopen_closed().unwrap();
        assert_eq!(opened(), format!("open {second} https://a.example/"));
        assert!(b.reopen_closed().is_none(), "a blank tab is not remembered");
    }

    #[test]
    fn only_the_last_twenty_closed_pages_are_remembered() {
        let (b, _, _, _) = browser();
        for i in 0..25 {
            let id = b.open_url(Some(&format!("https://p{i}.example/")));
            b.navigated(&id, &format!("https://p{i}.example/"), false, false);
        }
        for i in 1..=25 {
            b.close(&format!("tab-{i}"));
        }
        let mut n = 0;
        while b.reopen_closed().is_some() {
            n += 1;
        }
        assert_eq!(n, 20);
    }

    #[test]
    fn pinned_tabs_stay_at_the_front_and_move_only_among_themselves() {
        let (b, _, _, _) = browser();
        for _ in 0..4 {
            b.open(None);
        }
        b.pin("tab-3", true);
        assert_eq!(titles(&b), vec!["tab-3*", "tab-1", "tab-2", "tab-4"]);
        b.pin("tab-4", true);
        assert_eq!(titles(&b), vec!["tab-3*", "tab-4*", "tab-1", "tab-2"]);
        b.move_tab("tab-3", 3);
        assert_eq!(titles(&b), vec!["tab-4*", "tab-3*", "tab-1", "tab-2"], "a pinned tab stops at the end of the pinned ones");
        b.move_tab("tab-2", 0);
        assert_eq!(titles(&b), vec!["tab-4*", "tab-3*", "tab-2", "tab-1"], "an ordinary tab stops after the pinned ones");
        b.pin("tab-3", false);
        assert_eq!(titles(&b), vec!["tab-4*", "tab-3", "tab-2", "tab-1"], "unpinned goes to the front of the others");
        b.pin("tab-9", true);
        b.move_tab("tab-9", 0);
        assert_eq!(titles(&b).len(), 4);
    }

    #[test]
    fn a_tab_can_be_duplicated_next_to_itself() {
        let (b, engine, _, _) = browser();
        b.open(Some("https://a.example/"));
        b.navigated("tab-1", "https://a.example/", false, false);
        b.open(None);
        let copy = b.duplicate("tab-1").unwrap();
        assert_eq!(titles(&b), vec!["tab-1".to_owned(), copy.clone(), "tab-2".to_owned()]);
        assert!(engine.calls().contains(&format!("open {copy} https://a.example/")));
        assert_eq!(b.state()["activeId"], json!(copy));
        assert!(b.duplicate("tab-9").is_none());
        let blank = b.open(None).unwrap();
        assert!(b.duplicate(&blank).is_some(), "a blank tab duplicates to a blank tab");
    }

    #[test]
    fn the_window_only_sees_web_addresses_and_a_title_falls_back_to_the_address() {
        let (b, _, seen, _) = browser();
        b.open(None);
        b.navigated("tab-1", "https://a.example/page", false, false);
        assert_eq!(b.state()["tabs"][0]["title"], json!("https://a.example/page"));
        b.titled("tab-1", "A page");
        assert_eq!(b.state()["tabs"][0]["title"], json!("A page"));
        b.navigated("tab-1", "chrome-error://chromewebdata/", false, false);
        assert_eq!(b.state()["tabs"][0]["url"], json!(""));
        b.navigated("tab-1", "data:text/html,x", false, false);
        assert_eq!(b.state()["tabs"][0]["url"], json!(""));
        b.titled("tab-1", &"t".repeat(500));
        assert_eq!(b.state()["tabs"][0]["title"].as_str().unwrap().chars().count(), 300);
        assert!(seen.lock().unwrap().iter().all(|(n, _)| n == "mobius:browser-state"));
    }

    #[test]
    fn a_finished_page_is_a_visit_and_loading_is_tracked() {
        let (b, _, _, visits) = browser();
        b.open(Some("https://a.example/"));
        assert_eq!(b.state()["tabs"][0]["loading"], json!(true));
        b.navigated("tab-1", "https://a.example/", false, false);
        b.titled("tab-1", "A");
        b.finished("tab-1");
        assert_eq!(b.state()["tabs"][0]["loading"], json!(false));
        assert_eq!(visits.lock().unwrap().clone(), vec![("https://a.example/".to_owned(), "A".to_owned())]);
        b.finished("tab-9");
        assert_eq!(visits.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_title_that_comes_after_the_page_loaded_goes_to_history_once() {
        let (b, _, _, visits) = browser();
        b.open(Some("https://b.example/"));
        b.navigated("tab-1", "https://b.example/", false, false);
        b.finished("tab-1");
        b.titled("tab-1", "B");
        b.titled("tab-1", "(1) B");
        let seen = visits.lock().unwrap().clone();
        assert_eq!(seen, vec![("https://b.example/".into(), String::new()), ("https://b.example/".into(), "B".into())]);
    }

    #[test]
    fn an_icon_belongs_to_the_page_it_was_fetched_for() {
        let (b, _, _, _) = browser();
        b.open(None);
        assert_eq!(b.icon_offered("tab-1", &["file:///x.ico".into(), "https://a.example/f.png".into()]), Some("https://a.example/f.png".into()));
        assert_eq!(b.icon_offered("tab-1", &["https://a.example/f.png".into()]), None, "already being fetched");
        b.icon("tab-1", "https://a.example/f.png", Some("data:image/png;base64,AA".into()));
        assert_eq!(b.state()["tabs"][0]["icon"], json!("data:image/png;base64,AA"));
        b.icon("tab-1", "https://other.example/old.png", Some("data:image/png;base64,BB".into()));
        assert_eq!(b.state()["tabs"][0]["icon"], json!("data:image/png;base64,AA"), "a late answer for an old address is ignored");
        b.navigated("tab-1", "https://a.example/next", false, false);
        assert_eq!(b.state()["tabs"][0]["icon"], json!(null), "a new page starts without the old icon");
        b.navigated("tab-1", "https://a.example/next", false, false);
    }

    #[test]
    fn a_page_that_asks_for_a_new_window_gets_a_tab_only_for_web_addresses() {
        let (b, _, _, _) = browser();
        b.open(None);
        b.new_window("https://pop.example/");
        b.new_window("javascript:alert(1)");
        b.new_window("file:///c:/x");
        b.new_window("not a url");
        assert_eq!(ids(&b), vec!["tab-1", "tab-2"]);
        assert_eq!(b.state()["activeId"], json!("tab-2"));
    }

    #[test]
    fn pages_may_only_load_web_addresses() {
        let (b, _, _, _) = browser();
        assert!(b.allows_navigation("https://a.example/") && b.allows_navigation("http://127.0.0.1:1/") && b.allows_navigation(START_PAGE));
        for no in ["file:///c:/x", "javascript:1", "chrome://settings", "data:text/html,<script>1</script>", "ftp://a.example/", "about:blank"] {
            assert!(!b.allows_navigation(no), "{no}");
        }
    }

    #[test]
    fn find_needs_text_and_a_real_tab() {
        let (b, engine, seen, _) = browser();
        b.open(None);
        b.find("tab-1", "", true, false);
        b.find("tab-9", "apple", true, false);
        b.find("tab-1", "apple", false, true);
        b.stop_find("tab-1");
        b.stop_find("tab-9");
        assert_eq!(engine.calls().into_iter().filter(|c| c.starts_with("find") || c.starts_with("stop_find")).collect::<Vec<_>>(), vec!["find tab-1 apple false true", "stop_find tab-1"]);
        b.found("tab-1", 2, 5);
        assert_eq!(seen.lock().unwrap().last().unwrap(), &("mobius:browser-found".to_owned(), json!({ "tabId": "tab-1", "active": 2, "matches": 5 })));
    }

    #[test]
    fn what_is_showing_is_the_active_tab_with_room_and_nothing_otherwise() {
        let (b, _, _, _) = browser();
        assert_eq!(b.shown(), None);
        b.open(None);
        assert_eq!(b.shown(), None, "no area given yet");
        let area = Bounds { x: 1, y: 2, width: 30, height: 40 };
        b.set_bounds(Some(area));
        assert_eq!(b.shown(), Some(("tab-1".to_owned(), area)));
        b.set_bounds(Some(Bounds { width: 0, ..area }));
        assert_eq!(b.shown(), None);
        b.set_bounds(None);
        assert_eq!(b.shown(), None);
    }

    #[test]
    fn a_picture_comes_as_a_data_address_and_only_when_a_tab_is_showing() {
        let (b, _, _, _) = browser();
        assert!(b.picture().is_none());
        b.open(None);
        assert_eq!(b.picture().unwrap(), "data:image/jpeg;base64,/9j/");
    }

    #[test]
    fn reading_a_page_returns_its_text_and_only_for_open_tabs() {
        let (b, engine, _, _) = browser();
        b.open(None);
        engine.answer("innerText", Ok(json!({ "text": "Hello", "title": "T", "url": "https://a.example/" })));
        assert_eq!(b.read("tab-1"), Some(("https://a.example/".into(), "T".into(), "Hello".into())));
        assert_eq!(b.read("tab-9"), None);
        engine.answer("innerText", Err("gone".into()));
        assert_eq!(b.read("tab-1"), None);
        assert!(b.eval("tab-9", "1").is_err());
    }

    #[test]
    fn the_selected_text_is_read_only_for_open_tabs() {
        let (b, engine, _, _) = browser();
        b.open(None);
        engine.answer("getSelection", Ok(json!({ "text": "a quote", "title": "T", "url": "https://a.example/" })));
        assert_eq!(b.selection("tab-1"), Some(("https://a.example/".into(), "T".into(), "a quote".into())));
        assert_eq!(b.selection("tab-9"), None);
    }

    #[test]
    fn waiting_for_a_load_ends_when_the_page_is_done_or_gone() {
        let (b, _, _, _) = browser();
        b.open(Some("https://a.example/"));
        assert!(!b.wait_for_load("tab-1", Duration::from_millis(120)), "still loading");
        b.navigated("tab-1", "https://a.example/", false, false);
        b.loading("tab-1", false);
        assert!(b.wait_for_load("tab-1", Duration::from_millis(500)));
        b.navigated("tab-1", "chrome-error://chromewebdata/", false, false);
        assert!(!b.wait_for_load("tab-1", Duration::from_millis(500)), "an error page is not a loaded page");
        assert!(!b.wait_for_load("tab-9", Duration::from_millis(100)));
    }
}
