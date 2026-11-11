//! Software Update, as on a Mac: Mobius checks on its own at start and every few hours, downloads a new version
//! quietly, and then says "restart to install". It never interrupts. With "Automatically install updates" on, a
//! downloaded version is also installed the next time Mobius quits.
//!
//! This is the state and its rules, kept apart from the shell's updater so they can be tested; the shell does the
//! checking, downloading and installing, and reports here.

use serde_json::{Value, json};

/// How often Mobius looks for a new version while it is open.
pub const CHECK_EVERY_SECS: u64 = 4 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    /// The updater is not in this build (development, tests, the preview): the page says why.
    Off { why: String },
    /// Nothing checked yet.
    Idle,
    Checking,
    /// The newest version is the one running. `at_ms` is when that was found.
    UpToDate { at_ms: u64 },
    /// A newer version is coming down quietly.
    Downloading { version: String, percent: Option<u8> },
    /// Downloaded and checked: restart to install.
    Ready { version: String },
    /// The last check or download did not work. Mobius tries again at the next check.
    Failed { error: String },
}

/// What happened, as the shell reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    CheckStarted,
    NothingNew { at_ms: u64 },
    Found { version: String },
    Progress { downloaded: u64, total: Option<u64> },
    Downloaded,
    Failed { error: String },
}

impl State {
    /// The next state. A check never undoes a version already downloaded, and nothing changes while off.
    #[must_use]
    pub fn next(&self, event: &Event) -> State {
        match (self, event) {
            (State::Off { .. }, _) => self.clone(),
            // A version already waiting stays waiting: a later check finds nothing newer to do.
            (State::Ready { .. }, Event::CheckStarted | Event::NothingNew { .. } | Event::Failed { .. }) => self.clone(),
            (State::Downloading { .. }, Event::CheckStarted) => self.clone(),
            (_, Event::CheckStarted) => State::Checking,
            (_, Event::NothingNew { at_ms }) => State::UpToDate { at_ms: *at_ms },
            (_, Event::Found { version }) => State::Downloading { version: version.clone(), percent: Some(0) },
            (State::Downloading { version, .. }, Event::Progress { downloaded, total }) => {
                let percent = total.filter(|t| *t > 0).map(|t| u8::try_from((downloaded.saturating_mul(100) / t).min(100)).unwrap_or(100));
                State::Downloading { version: version.clone(), percent }
            }
            (State::Downloading { version, .. }, Event::Downloaded) => State::Ready { version: version.clone() },
            (_, Event::Failed { error }) => State::Failed { error: error.clone() },
            _ => self.clone(),
        }
    }

    /// Whether a check may start now: not while off, checking or downloading, and not once a version is waiting.
    #[must_use]
    pub fn may_check(&self) -> bool {
        matches!(self, State::Idle | State::UpToDate { .. } | State::Failed { .. })
    }

    /// Whether quitting now should install the downloaded version, given the person's choice.
    #[must_use]
    pub fn install_on_quit(&self, auto_install: bool) -> bool {
        auto_install && matches!(self, State::Ready { .. })
    }

    /// For the window: the state, the words to show, and the version running.
    #[must_use]
    pub fn to_json(&self, current: &str) -> Value {
        let (kind, status, extra) = match self {
            State::Off { why } => ("off", why.clone(), json!({})),
            State::Idle => ("idle", "Mobius checks for updates by itself.".to_owned(), json!({})),
            State::Checking => ("checking", "Checking for updates…".to_owned(), json!({})),
            State::UpToDate { at_ms } => ("upToDate", "Mobius is up to date.".to_owned(), json!({ "checkedMs": at_ms })),
            State::Downloading { version, percent } => ("downloading", match percent { Some(p) => format!("Downloading Mobius {version}… {p}%"), None => format!("Downloading Mobius {version}…") }, json!({ "version": version, "percent": percent })),
            State::Ready { version } => ("ready", format!("Mobius {version} is ready. Restart to install it."), json!({ "version": version })),
            State::Failed { error } => ("failed", format!("Could not check for updates: {error}"), json!({})),
        };
        let mut out = json!({ "state": kind, "status": status, "current": current });
        if let (Some(o), Some(e)) = (out.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_finds_a_version_downloads_it_quietly_and_waits_for_a_restart() {
        let mut s = State::Idle;
        assert!(s.may_check());
        s = s.next(&Event::CheckStarted);
        assert_eq!(s, State::Checking);
        assert!(!s.may_check(), "one check at a time");
        s = s.next(&Event::Found { version: "0.2.0".into() });
        s = s.next(&Event::Progress { downloaded: 50, total: Some(200) });
        assert_eq!(s, State::Downloading { version: "0.2.0".into(), percent: Some(25) });
        s = s.next(&Event::Progress { downloaded: 10, total: None });
        assert_eq!(s, State::Downloading { version: "0.2.0".into(), percent: None });
        s = s.next(&Event::Downloaded);
        assert_eq!(s, State::Ready { version: "0.2.0".into() });
        assert_eq!(s.to_json("0.1.0")["status"], "Mobius 0.2.0 is ready. Restart to install it.");
        assert_eq!(s.to_json("0.1.0")["current"], "0.1.0");
    }

    #[test]
    fn a_version_waiting_is_never_undone_and_nothing_moves_while_off() {
        let ready = State::Ready { version: "0.2.0".into() };
        assert!(!ready.may_check());
        assert_eq!(ready.next(&Event::CheckStarted), ready);
        assert_eq!(ready.next(&Event::NothingNew { at_ms: 1 }), ready);
        assert_eq!(ready.next(&Event::Failed { error: "offline".into() }), ready);
        let off = State::Off { why: "Updates are off in development builds.".into() };
        assert!(!off.may_check());
        assert_eq!(off.next(&Event::Found { version: "9.9.9".into() }), off);
        assert_eq!(off.to_json("0.0.0")["state"], "off");
    }

    #[test]
    fn a_failed_check_says_why_and_the_next_one_may_start() {
        let s = State::Checking.next(&Event::Failed { error: "no network".into() });
        assert!(s.may_check());
        assert!(s.to_json("0.1.0")["status"].as_str().unwrap().contains("no network"));
        assert_eq!(State::Checking.next(&Event::NothingNew { at_ms: 5 }), State::UpToDate { at_ms: 5 });
    }

    #[test]
    fn quitting_installs_only_a_downloaded_version_and_only_when_chosen() {
        let ready = State::Ready { version: "0.2.0".into() };
        assert!(ready.install_on_quit(true));
        assert!(!ready.install_on_quit(false));
        assert!(!State::Downloading { version: "0.2.0".into(), percent: None }.install_on_quit(true));
    }
}
