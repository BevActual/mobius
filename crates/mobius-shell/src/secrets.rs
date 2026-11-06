//! API keys kept in the operating system's own store (Windows Credential Manager, the macOS keychain, the Linux secret
//! service). If the store cannot be used, keys live in memory until the app closes.
use mobius_host::secrets::Secrets;

const SERVICE: &str = "app.mobius.shell";

pub struct OsSecrets;

impl OsSecrets {
    fn entry(name: &str) -> Option<keyring::Entry> {
        keyring::Entry::new(SERVICE, name).ok()
    }
}

impl Secrets for OsSecrets {
    fn available(&self) -> bool {
        // A probe: write and read back a harmless value.
        let Some(entry) = Self::entry("probe") else { return false };
        let ok = entry.set_password("ok").is_ok() && entry.get_password().is_ok_and(|v| v == "ok");
        let _ = entry.delete_credential();
        ok
    }
    fn put(&self, name: &str, value: &str) -> bool {
        Self::entry(name).is_some_and(|e| e.set_password(value).is_ok())
    }
    fn get(&self, name: &str) -> Option<String> {
        Self::entry(name)?.get_password().ok()
    }
    fn delete(&self, name: &str) {
        if let Some(e) = Self::entry(name) {
            let _ = e.delete_credential();
        }
    }
}
