//! Where API keys are kept. The real store is the operating system's (see the shell); tests use memory.
use std::collections::HashMap;
use std::sync::Mutex;

pub trait Secrets: Send + Sync {
    /// Whether keys can be kept across runs.
    fn available(&self) -> bool;
    fn put(&self, name: &str, value: &str) -> bool;
    fn get(&self, name: &str) -> Option<String>;
    fn delete(&self, name: &str);
}

/// Keys kept in memory only, for tests and for machines with no secret store.
#[derive(Default)]
pub struct MemorySecrets {
    pub usable: bool,
    items: Mutex<HashMap<String, String>>,
}

impl MemorySecrets {
    pub fn new(usable: bool) -> MemorySecrets {
        MemorySecrets { usable, items: Mutex::default() }
    }
    pub fn contents(&self) -> HashMap<String, String> {
        self.items.lock().map(|m| m.clone()).unwrap_or_default()
    }
}

impl Secrets for MemorySecrets {
    fn available(&self) -> bool {
        self.usable
    }
    fn put(&self, name: &str, value: &str) -> bool {
        if !self.usable {
            return false;
        }
        self.items.lock().map(|mut m| m.insert(name.to_owned(), value.to_owned())).is_ok()
    }
    fn get(&self, name: &str) -> Option<String> {
        self.items.lock().ok()?.get(name).cloned()
    }
    fn delete(&self, name: &str) {
        if let Ok(mut m) = self.items.lock() {
            m.remove(name);
        }
    }
}

/// Keys kept in a plain file, so a test can close the app and open it again and still have them. Never used for a person's
/// own keys: the file is not protected.
pub struct FileSecrets {
    file: std::path::PathBuf,
    lock: Mutex<()>,
}

impl FileSecrets {
    pub fn new(file: std::path::PathBuf) -> FileSecrets {
        FileSecrets { file, lock: Mutex::new(()) }
    }

    fn read(&self) -> HashMap<String, String> {
        std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn write(&self, items: &HashMap<String, String>) -> bool {
        serde_json::to_string(items).is_ok_and(|t| std::fs::write(&self.file, t).is_ok())
    }
}

impl Secrets for FileSecrets {
    fn available(&self) -> bool {
        true
    }
    fn put(&self, name: &str, value: &str) -> bool {
        let _guard = self.lock.lock();
        let mut items = self.read();
        items.insert(name.to_owned(), value.to_owned());
        self.write(&items)
    }
    fn get(&self, name: &str) -> Option<String> {
        let _guard = self.lock.lock();
        self.read().get(name).cloned()
    }
    fn delete(&self, name: &str) {
        let _guard = self.lock.lock();
        let mut items = self.read();
        if items.remove(name).is_some() {
            self.write(&items);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_secrets_survive_being_opened_again_and_can_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets.json");
        let a = FileSecrets::new(file.clone());
        assert!(a.available() && a.get("k").is_none());
        assert!(a.put("k", "v1") && a.put("other", "o"));
        assert_eq!(FileSecrets::new(file.clone()).get("k").as_deref(), Some("v1"));
        a.put("k", "v2");
        a.delete("other");
        let b = FileSecrets::new(file);
        assert_eq!((b.get("k").as_deref(), b.get("other")), (Some("v2"), None));
        b.delete("missing");
    }

    #[test]
    fn a_broken_file_is_treated_as_empty_and_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets.json");
        std::fs::write(&file, "{not json").unwrap();
        let s = FileSecrets::new(file);
        assert_eq!(s.get("k"), None);
        assert!(s.put("k", "v"));
        assert_eq!(s.get("k").as_deref(), Some("v"));
    }
}
