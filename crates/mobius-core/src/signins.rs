//! Sign in once per task. When a page Mobius is driving needs a sign-in, the person signs in themselves (their password
//! manager fills it; Mobius never sees the password), and that sign-in is good for the rest of that task only: the
//! same conversation does not ask again for that site, but another conversation, or a bot, does. It ends when the
//! conversation ends, or when the person chooses Sign out now.
use std::collections::{HashMap, HashSet};

/// The sites signed in to, per conversation. Held in memory only: nothing of a sign-in outlives the session.
#[derive(Debug, Default)]
pub struct SignIns {
    by_conversation: HashMap<String, HashSet<String>>,
}

/// The site a sign-in is for: the address's scheme and host (`https://shop.example`), lower case. None for anything
/// that is not an http or https address with a host.
#[must_use]
pub fn site_of(url: &str) -> Option<String> {
    let rest = url.trim();
    let (scheme, after) = rest.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host_port = after.split(['/', '?', '#']).next()?;
    let host_port = host_port.rsplit_once('@').map_or(host_port, |(_, h)| h);
    if host_port.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{}", host_port.to_ascii_lowercase()))
}

impl SignIns {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The person signed in to `site` for this conversation's task.
    pub fn signed_in(&mut self, conversation: &str, site: &str) {
        self.by_conversation.entry(conversation.to_owned()).or_default().insert(site.to_owned());
    }

    /// Whether this conversation's task already has a sign-in to `site`, so it need not ask again.
    #[must_use]
    pub fn has(&self, conversation: &str, site: &str) -> bool {
        self.by_conversation.get(conversation).is_some_and(|s| s.contains(site))
    }

    /// The sites this conversation's task is signed in to, sorted, for the line that says so.
    #[must_use]
    pub fn sites(&self, conversation: &str) -> Vec<String> {
        let mut sites: Vec<String> = self.by_conversation.get(conversation).map(|s| s.iter().cloned().collect()).unwrap_or_default();
        sites.sort();
        sites
    }

    /// Sign out now: this task no longer has that sign-in. Says whether it had.
    pub fn sign_out(&mut self, conversation: &str, site: &str) -> bool {
        let Some(sites) = self.by_conversation.get_mut(conversation) else { return false };
        let had = sites.remove(site);
        if sites.is_empty() {
            self.by_conversation.remove(conversation);
        }
        had
    }

    /// The task ended (the conversation was deleted, put away or started afresh): its sign-ins end with it.
    pub fn task_ended(&mut self, conversation: &str) {
        self.by_conversation.remove(conversation);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sign_in_lasts_for_its_task_only_and_ends_with_it_or_on_sign_out() {
        let mut s = SignIns::new();
        let site = site_of("https://Axion.example/orders/new?x=1").unwrap();
        assert_eq!(site, "https://axion.example");
        assert!(!s.has("c1", &site), "the first time, the task asks");
        s.signed_in("c1", &site);
        assert!(s.has("c1", &site), "later steps of the same task do not ask again");
        assert!(!s.has("c2", &site), "another task (or a bot's conversation) asks again");
        assert!(!s.has("c1", "https://other.example"), "another site asks again");
        assert_eq!(s.sites("c1"), [site.clone()]);
        assert!(s.sign_out("c1", &site));
        assert!(!s.has("c1", &site));
        assert!(!s.sign_out("c1", &site));
        s.signed_in("c1", &site);
        s.task_ended("c1");
        assert!(!s.has("c1", &site));
        assert!(s.sites("c1").is_empty());
    }

    #[test]
    fn a_site_is_the_scheme_and_host_of_a_web_address() {
        assert_eq!(site_of("http://localhost:8080/login").as_deref(), Some("http://localhost:8080"));
        assert_eq!(site_of("https://user@bank.example/").as_deref(), Some("https://bank.example"));
        assert_eq!(site_of("file:///etc/passwd"), None);
        assert_eq!(site_of("https://"), None);
        assert_eq!(site_of("not an address"), None);
    }
}
