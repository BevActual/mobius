//! The GitHub Copilot plan: a GitHub sign-in (device flow) kept in the secret store, handed to GitHub's Copilot CLI
//! when Mobius asks it for an answer (see `mobius_claude::copilot`). The sign-in is only ever sent to GitHub and to the
//! Copilot CLI on this computer.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::device_sign_in::{DeviceSignIn, Done};
use crate::secrets::Secrets;

pub const SECRET: &str = "account-copilot";

pub struct CopilotAccount {
    secrets: Arc<dyn Secrets>,
    sign_in: Mutex<Arc<DeviceSignIn>>,
    /// Kept for this run when the system has no secret store.
    session: Mutex<Option<String>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl CopilotAccount {
    pub fn new(secrets: Arc<dyn Secrets>) -> CopilotAccount {
        CopilotAccount { secrets, sign_in: Mutex::new(Arc::new(DeviceSignIn::github(crate::device_sign_in::GITHUB, crate::device_sign_in::GITHUB_CLIENT_ID))), session: Mutex::default() }
    }

    /// Sign in at a pretend GitHub (tests only).
    pub fn use_site_for_tests(&self, site: &str, client_id: &str) {
        *lock(&self.sign_in) = Arc::new(DeviceSignIn::github(site, client_id).polling_every(std::time::Duration::from_millis(100)));
    }

    pub fn token(&self) -> Option<String> {
        lock(&self.session).clone().or_else(|| self.secrets.get(SECRET))
    }

    fn keep(&self, token: &str) {
        *lock(&self.session) = None;
        if !(self.secrets.available() && self.secrets.put(SECRET, token)) {
            *lock(&self.session) = Some(token.to_owned());
        }
    }

    /// What Settings shows: whether the CLI is installed, whether you are signed in, and the code while waiting.
    pub fn status(&self, program: Option<&Path>) -> Value {
        let installed: Option<PathBuf> = mobius_claude::copilot::find(program);
        let sign_in = lock(&self.sign_in).clone();
        let waiting = sign_in.status();
        let signed_in = self.token().is_some();
        let hint = if installed.is_none() {
            json!(mobius_claude::copilot::INSTALL_HINT)
        } else if !sign_in.available() && !signed_in {
            json!("Signing in with GitHub is not set up in this version yet.")
        } else {
            waiting["error"].clone()
        };
        json!({
            "installed": installed.is_some(),
            "signedIn": signed_in,
            "pending": waiting["pending"].as_str().map(|url| json!({ "url": url, "code": waiting["code"] })),
            "hint": hint,
            "manageUsage": "https://github.com/settings/copilot",
        })
    }

    /// Start signing in with GitHub: answers with the page to open and the code to enter there.
    pub fn start_sign_in(self: &Arc<Self>, then: Arc<dyn Fn() + Send + Sync>) -> Result<(String, String), String> {
        let me = Arc::clone(self);
        let done: Done = Arc::new(move |result| {
            if let Ok(token) = result {
                me.keep(&token);
            }
            then();
        });
        lock(&self.sign_in).clone().start(done)
    }

    pub fn cancel_sign_in(&self) {
        lock(&self.sign_in).cancel();
    }

    pub fn sign_out(&self) {
        *lock(&self.session) = None;
        self.secrets.delete(SECRET);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;

    #[test]
    fn signing_out_forgets_the_sign_in_and_status_says_what_is_missing() {
        let account = CopilotAccount::new(Arc::new(MemorySecrets::default()));
        account.keep("gho_kept_token");
        assert_eq!(account.token().as_deref(), Some("gho_kept_token"));
        let missing = account.status(Some(Path::new("/nowhere/copilot")));
        assert_eq!((missing["installed"].as_bool(), missing["signedIn"].as_bool()), (Some(false), Some(true)));
        assert!(missing["hint"].as_str().unwrap().contains("not installed"));
        account.sign_out();
        assert_eq!(account.token(), None);
    }
}
