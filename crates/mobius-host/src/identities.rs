//! Settings › Accounts: one Google or Microsoft account, signed in once, for several apps, as macOS's Internet Accounts
//! does. Each app still keeps its own copy of the sign-in (Calendar its account, Files its drive), so an app works and
//! is removed as before; this adds the one sign-in that asks for all of them at once, and remembers the account itself
//! so it stays listed with every app switched off.
//!
//! Google asks for the calendars and the files the person picks (`drive.file`), never mail: Mail keeps app passwords
//! until Mobius passes Google's paid review. Microsoft asks for OneDrive and the calendars; Teams stays its own sign-in,
//! since only work and school accounts have it.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::calendar_sign_in::{self, Google, SignIn, Tokens};

type Res<T> = Result<T, String>;
type Done = Arc<dyn Fn(Res<Value>) + Send + Sync>;

/// Microsoft's OneDrive and calendars, asked for together.
pub const MICROSOFT_SCOPES: &str = "offline_access User.Read Files.ReadWrite.All Calendars.ReadWrite";
const GOOGLE_FILES: &str = "openid email https://www.googleapis.com/auth/drive.file";
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const FILES_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
/// The most accounts remembered.
const MAX: usize = 40;

/// An account signed in to once: a provider and the address.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub provider: String,
    pub email: String,
}

/// The apps the one sign-in is for, as Settings names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum App {
    Calendar,
    Files,
}

impl App {
    pub fn parse(name: &str) -> Option<App> {
        match name {
            "calendar" => Some(App::Calendar),
            "files" => Some(App::Files),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            App::Calendar => "calendar",
            App::Files => "files",
        }
    }
}

pub struct Identities {
    file: PathBuf,
    list: Mutex<Vec<Identity>>,
    google: Mutex<(Option<Google>, calendar_sign_in::Endpoints)>,
    microsoft: Mutex<(Option<String>, crate::onedrive::Endpoints)>,
    /// The sign-in waiting in the browser, so it can be cancelled.
    pending_google: Mutex<Option<Arc<SignIn>>>,
    pending_microsoft: Mutex<Option<Arc<crate::onedrive::Service>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Identities {
    pub fn new(data_dir: &Path) -> Identities {
        let file = data_dir.join("accounts.json");
        let list = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Vec<Identity>>(&b).ok()).unwrap_or_default();
        Identities {
            file,
            list: Mutex::new(list),
            google: Mutex::new((Google::built_in(), calendar_sign_in::Endpoints::default())),
            microsoft: Mutex::new((crate::onedrive::built_in_client_id(), crate::onedrive::Endpoints::default())),
            pending_google: Mutex::new(None),
            pending_microsoft: Mutex::new(None),
        }
    }

    /// A pretend Google, in tests.
    pub fn use_google(&self, google: Option<Google>, at: calendar_sign_in::Endpoints) {
        *lock(&self.google) = (google, at);
    }

    /// A pretend Microsoft, in tests.
    pub fn use_microsoft(&self, client_id: Option<String>, at: crate::onedrive::Endpoints) {
        *lock(&self.microsoft) = (client_id, at);
    }

    /// The accounts signed in to here, by provider and then address.
    pub fn list(&self) -> Vec<Identity> {
        let mut all = lock(&self.list).clone();
        all.sort_by(|a, b| (&a.provider, a.email.to_lowercase()).cmp(&(&b.provider, b.email.to_lowercase())));
        all
    }

    fn save(&self, all: &[Identity]) {
        if let Ok(text) = serde_json::to_vec_pretty(all) {
            let _ = std::fs::create_dir_all(self.file.parent().unwrap_or(Path::new(".")));
            let _ = std::fs::write(&self.file, text);
        }
    }

    /// Remembers `email` at `provider`, so it stays listed with every app off.
    pub fn remember(&self, provider: &str, email: &str) {
        let email = email.trim();
        if email.is_empty() || email.len() > 200 {
            return;
        }
        let mut all = lock(&self.list);
        if all.iter().any(|i| i.provider == provider && i.email.eq_ignore_ascii_case(email)) || all.len() >= MAX {
            return;
        }
        all.push(Identity { provider: provider.to_owned(), email: email.to_owned() });
        self.save(&all);
    }

    /// Forgets the account; its apps are removed by Settings, each the way that app removes its own.
    pub fn forget(&self, provider: &str, email: &str) {
        let mut all = lock(&self.list);
        all.retain(|i| !(i.provider == provider && i.email.eq_ignore_ascii_case(email)));
        self.save(&all);
    }

    /// Whether each provider is set up in this build, and the sign-in page while one waits.
    pub fn status(&self) -> Value {
        let google = lock(&self.pending_google).as_ref().map(|s| s.status()).and_then(|s| s.get("pending").cloned()).unwrap_or(Value::Null);
        let microsoft = lock(&self.pending_microsoft).as_ref().map(|s| s.status()).and_then(|s| s.get("pending").cloned()).unwrap_or(Value::Null);
        json!({
            "google": { "setUp": lock(&self.google).0.is_some(), "pending": google },
            "microsoft": { "setUp": lock(&self.microsoft).0.is_some(), "pending": microsoft },
        })
    }

    pub fn cancel(&self) {
        if let Some(s) = lock(&self.pending_google).take() {
            s.cancel();
        }
        if let Some(s) = lock(&self.pending_microsoft).take() {
            s.cancel();
        }
    }

    /// Starts one Google sign-in for `apps` and returns the page to open. Once the person allows it, each app Google
    /// gave access for keeps it: Calendar adds the account (or renews the one it has for that address), Files keeps it as
    /// its Google Drive sign-in. `done` hears the address, the apps now on, and why any is not.
    pub fn google_sign_in(self: &Arc<Self>, apps: &[App], calendar: Arc<crate::calendar_accounts::Accounts>, drive: Option<Arc<crate::google_drive::GoogleDrive>>, done: Done) -> Res<String> {
        let (google, at) = lock(&self.google).clone();
        if google.is_none() {
            return Err(calendar_sign_in::NOT_SET_UP.into());
        }
        let files = apps.contains(&App::Files) && drive.is_some();
        let scopes = match (apps.contains(&App::Calendar), files) {
            (true, true) => calendar_sign_in::CALENDAR_AND_FILES,
            (false, true) => GOOGLE_FILES,
            (true, false) => "openid email https://www.googleapis.com/auth/calendar",
            (false, false) => return Err("Choose at least one app to use this account for.".into()),
        };
        let sign_in = Arc::new(SignIn::new(google, at).with_scopes(scopes));
        *lock(&self.pending_google) = Some(Arc::clone(&sign_in));
        let (me, apps) = (Arc::clone(self), apps.to_vec());
        sign_in.start(Arc::new(move |signed: Res<Tokens>| {
            lock(&me.pending_google).take();
            done(signed.and_then(|tokens| me.keep_google(&apps, &tokens, &calendar, drive.as_deref())));
        }))
    }

    fn keep_google(&self, apps: &[App], tokens: &Tokens, calendar: &crate::calendar_accounts::Accounts, drive: Option<&crate::google_drive::GoogleDrive>) -> Res<Value> {
        let email = tokens.email.clone().unwrap_or_default();
        let (mut on, mut off, mut calendar_id) = (Vec::new(), Vec::new(), Value::Null);
        for &app in apps {
            let kept = match app {
                App::Calendar if !tokens.allows(CALENDAR_SCOPE) => Err("Google didn't give access to your calendars.".to_owned()),
                App::Calendar => calendar.keep_google("", calendar.find("google", &email).as_deref(), tokens).map(|kept| calendar_id = kept["id"].clone()),
                App::Files if !tokens.allows(FILES_SCOPE) => Err("Google didn't give access to the files you pick.".to_owned()),
                App::Files => match drive {
                    Some(d) => d.adopt(&tokens.access, &tokens.refresh, tokens.expires, tokens.email.as_deref(), tokens.granted.as_deref().unwrap_or("")),
                    None => Err("Google Drive isn't set up in this build of Mobius.".to_owned()),
                },
            };
            match kept {
                Ok(()) => on.push(app.name()),
                Err(why) => off.push(json!({ "app": app.name(), "why": why })),
            }
        }
        if on.is_empty() {
            return Err(off.first().and_then(|o| o.get("why")).and_then(Value::as_str).unwrap_or("Nothing could be kept from that sign-in.").to_owned());
        }
        self.remember("google", &email);
        Ok(json!({ "provider": "google", "email": email, "on": on, "off": off, "calendar": calendar_id }))
    }

    /// As `google_sign_in`, for a Microsoft account: Calendar and the account's own OneDrive in Files.
    pub fn microsoft_sign_in(self: &Arc<Self>, apps: &[App], calendar: Arc<crate::calendar_accounts::Accounts>, drives: Arc<crate::drives::Drives>, done: Done) -> Res<String> {
        let (client_id, at) = lock(&self.microsoft).clone();
        if client_id.is_none() {
            return Err(crate::graph_calendar::NOT_SET_UP.into());
        }
        let scopes = match (apps.contains(&App::Calendar), apps.contains(&App::Files)) {
            (true, true) => MICROSOFT_SCOPES,
            (false, true) => crate::onedrive::SCOPES,
            (true, false) => crate::graph_calendar::SCOPES,
            (false, false) => return Err("Choose at least one app to use this account for.".into()),
        };
        let service = Arc::new(crate::onedrive::Service::new(client_id, at, crate::graph_calendar::agent()).with_scopes(scopes));
        *lock(&self.pending_microsoft) = Some(Arc::clone(&service));
        let (me, apps) = (Arc::clone(self), apps.to_vec());
        let pending = service.start(Arc::new(move |signed: Res<crate::onedrive::SignedIn>| {
            lock(&me.pending_microsoft).take();
            done(signed.and_then(|signed| me.keep_microsoft(&apps, &signed, &calendar, &drives)));
        }))?;
        Ok(pending.url)
    }

    fn keep_microsoft(&self, apps: &[App], signed: &crate::onedrive::SignedIn, calendar: &crate::calendar_accounts::Accounts, drives: &crate::drives::Drives) -> Res<Value> {
        let (mut on, mut off, mut calendar_id) = (Vec::new(), Vec::new(), Value::Null);
        for &app in apps {
            let kept = match app {
                App::Calendar => calendar.keep_microsoft("", calendar.find("microsoft", &signed.email).as_deref(), signed).map(|kept| calendar_id = kept["id"].clone()),
                App::Files => drives.keep_onedrive(None, "", "", drives.onedrive_of(&signed.email).as_ref(), signed).map(|_| ()),
            };
            match kept {
                Ok(()) => on.push(app.name()),
                Err(why) => off.push(json!({ "app": app.name(), "why": why })),
            }
        }
        if on.is_empty() {
            return Err(off.first().and_then(|o| o.get("why")).and_then(Value::as_str).unwrap_or("Nothing could be kept from that sign-in.").to_owned());
        }
        self.remember("microsoft", &signed.email);
        Ok(json!({ "provider": "microsoft", "email": signed.email, "on": on, "off": off, "calendar": calendar_id }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_each_account_once_and_lists_them_by_provider_then_address() {
        let dir = tempfile::tempdir().unwrap();
        let ids = Identities::new(dir.path());
        ids.remember("microsoft", "zoe@outlook.com");
        ids.remember("google", "Bo@gmail.com");
        ids.remember("google", "bo@gmail.com");
        ids.remember("google", "  ");
        ids.remember("google", "ana@gmail.com");
        let list: Vec<_> = ids.list().into_iter().map(|i| format!("{}:{}", i.provider, i.email)).collect();
        assert_eq!(list, ["google:ana@gmail.com", "google:Bo@gmail.com", "microsoft:zoe@outlook.com"]);
        // Kept on disk.
        assert_eq!(Identities::new(dir.path()).list().len(), 3);
        ids.forget("google", "BO@gmail.com");
        assert_eq!(Identities::new(dir.path()).list().len(), 2);
    }

    #[test]
    fn asks_for_an_app_and_a_build_that_can_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let ids = Arc::new(Identities::new(dir.path()));
        ids.use_google(None, calendar_sign_in::Endpoints::default());
        let calendar = Arc::new(crate::calendar_accounts::Accounts::new(dir.path(), Arc::new(crate::secrets::MemorySecrets::new(true))));
        let done: Done = Arc::new(|_| {});
        assert_eq!(ids.google_sign_in(&[App::Calendar], Arc::clone(&calendar), None, Arc::clone(&done)).unwrap_err(), calendar_sign_in::NOT_SET_UP);
        ids.use_google(Some(Google { client_id: "id".into(), client_secret: String::new() }), calendar_sign_in::Endpoints::default());
        assert!(ids.google_sign_in(&[], calendar, None, done).unwrap_err().contains("at least one app"));
        assert_eq!(App::parse("files"), Some(App::Files));
        assert_eq!(App::parse("mail"), None);
    }
}
