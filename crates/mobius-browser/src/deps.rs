//! The agent's browser tools, wired to the real browser.
use std::net::ToSocketAddrs;
use std::sync::Arc;
use std::time::Duration;

use crate::page_actions::{ActionResult, as_action_result, click_script, type_script};
use crate::tabs::Browser;
use crate::tools::{TabInfo, ToolDeps};

pub struct BrowserTools {
    pub browser: Arc<Browser>,
    /// Whether the person has allowed the agent to use addresses on this computer or the local network.
    pub allow_private: Box<dyn Fn() -> bool + Send + Sync>,
    /// Whether an address is one of the person's own pages, served from their workspace by the shell.
    pub own_page: Box<dyn Fn(&str) -> bool + Send + Sync>,
}

impl ToolDeps for BrowserTools {
    fn list(&self) -> Vec<TabInfo> {
        self.browser.list().into_iter().map(|(id, url, title, active)| TabInfo { id, url, title, active }).collect()
    }

    fn allow_private(&self) -> bool {
        (self.allow_private)()
    }

    fn own_page(&self, url: &str) -> bool {
        (self.own_page)(url)
    }

    fn resolve(&self, host: &str) -> Option<Vec<String>> {
        let found = (host, 443).to_socket_addrs().ok()?;
        Some(found.map(|a| a.ip().to_string()).collect())
    }

    fn open(&self, url: &str) -> String {
        self.browser.open_url(Some(url))
    }

    fn wait_for_load(&self, tab: &str, timeout: Duration) -> bool {
        self.browser.wait_for_load(tab, timeout)
    }

    fn click(&self, tab: &str, text: &str) -> ActionResult {
        match self.browser.eval(tab, &click_script(text)) {
            Ok(v) => as_action_result(&v),
            Err(e) if e == "no such tab" => ActionResult { ok: false, what: e },
            Err(_) => ActionResult { ok: false, what: "the page could not be used".into() },
        }
    }

    fn type_text(&self, tab: &str, field: &str, text: &str, submit: bool) -> ActionResult {
        match self.browser.eval(tab, &type_script(field, text, submit)) {
            Ok(v) => as_action_result(&v),
            Err(e) if e == "no such tab" => ActionResult { ok: false, what: e },
            Err(_) => ActionResult { ok: false, what: "the page could not be used".into() },
        }
    }

    fn read(&self, tab: &str) -> Option<(String, String, String)> {
        self.browser.read(tab)
    }
}
