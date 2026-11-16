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

/// Long values kept in pieces. Windows Credential Manager holds at most 2560 bytes a credential (1280 characters as
/// it stores them), and a sign-in's tokens are often longer (ChatGPT's, Microsoft's): such a value is kept as numbered
/// pieces under `name#1`, `name#2` …, with `name` itself saying how many. Short values are kept as they are.
pub struct Pieces<S>(pub S);

/// Small enough for any store: 600 characters are at most 2400 bytes in UTF-16.
const PIECE_CHARS: usize = 600;
const PIECES_MARK: &str = "mobius-pieces:";

impl<S: Secrets> Pieces<S> {
    fn piece_name(name: &str, i: usize) -> String {
        format!("{name}#{i}")
    }

    /// How many pieces the kept value under `name` is in, if it is in pieces.
    fn count(&self, name: &str) -> Option<usize> {
        self.0.get(name)?.strip_prefix(PIECES_MARK)?.parse().ok()
    }

    fn delete_pieces(&self, name: &str, from: usize, count: usize) {
        for i in from..=count {
            self.0.delete(&Self::piece_name(name, i));
        }
    }
}

impl<S: Secrets> Secrets for Pieces<S> {
    fn available(&self) -> bool {
        self.0.available()
    }
    fn put(&self, name: &str, value: &str) -> bool {
        let before = self.count(name).unwrap_or(0);
        let chars: Vec<char> = value.chars().collect();
        if chars.len() <= PIECE_CHARS && !value.starts_with(PIECES_MARK) {
            let ok = self.0.put(name, value);
            if ok {
                self.delete_pieces(name, 1, before);
            }
            return ok;
        }
        let pieces: Vec<String> = chars.chunks(PIECE_CHARS).map(|c| c.iter().collect()).collect();
        // The pieces first, then the count: a reader never finds a count with pieces missing.
        let ok = pieces.iter().enumerate().all(|(i, piece)| self.0.put(&Self::piece_name(name, i + 1), piece)) && self.0.put(name, &format!("{PIECES_MARK}{}", pieces.len()));
        if ok {
            self.delete_pieces(name, pieces.len() + 1, before);
        }
        ok
    }
    fn get(&self, name: &str) -> Option<String> {
        let kept = self.0.get(name)?;
        let Some(count) = kept.strip_prefix(PIECES_MARK) else { return Some(kept) };
        let count: usize = count.parse().ok()?;
        (1..=count).map(|i| self.0.get(&Self::piece_name(name, i))).collect()
    }
    fn delete(&self, name: &str) {
        if let Some(count) = self.count(name) {
            self.delete_pieces(name, 1, count);
        }
        self.0.delete(name);
    }
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

    /// A store that, like Windows Credential Manager, refuses values over 1280 characters.
    struct Small(MemorySecrets);
    impl Secrets for Small {
        fn available(&self) -> bool {
            true
        }
        fn put(&self, name: &str, value: &str) -> bool {
            value.encode_utf16().count() * 2 <= 2560 && self.0.put(name, value)
        }
        fn get(&self, name: &str) -> Option<String> {
            self.0.get(name)
        }
        fn delete(&self, name: &str) {
            self.0.delete(name);
        }
    }

    #[test]
    fn a_long_sign_in_is_kept_in_pieces_and_read_back_whole() {
        let store = Pieces(Small(MemorySecrets::new(true)));
        let tokens = format!("{{\"access\":\"{}\",\"id_token\":\"{}\"}}", "a".repeat(2_000), "é😀".repeat(700));
        assert!(!Small(MemorySecrets::new(true)).put("chatgpt", &tokens), "too long for the store as it is");
        assert!(store.put("chatgpt", &tokens));
        assert_eq!(store.get("chatgpt").as_deref(), Some(tokens.as_str()));
        let pieces = store.0.0.contents().keys().filter(|k| k.starts_with("chatgpt#")).count();
        assert!(pieces >= 6, "{pieces}");
        // Shorter again: the pieces left over go.
        assert!(store.put("chatgpt", &"b".repeat(700)));
        assert_eq!(store.get("chatgpt"), Some("b".repeat(700)));
        assert_eq!(store.0.0.contents().len(), 3);
        assert!(store.put("chatgpt", "short"));
        assert_eq!(store.0.0.contents().len(), 1);
        assert_eq!(store.get("chatgpt").as_deref(), Some("short"));
        store.put("chatgpt", &tokens);
        store.delete("chatgpt");
        assert!(store.0.0.contents().is_empty());
        assert_eq!(store.get("chatgpt"), None);
    }

    #[test]
    fn values_kept_before_pieces_are_still_read() {
        let inner = MemorySecrets::new(true);
        inner.put("key", "sk-old");
        let store = Pieces(inner);
        assert_eq!(store.get("key").as_deref(), Some("sk-old"));
        let mut missing = Pieces(MemorySecrets::new(true));
        missing.put("t", &"x".repeat(1_500));
        missing.0 = MemorySecrets::new(true);
        missing.0.put("t", "mobius-pieces:3");
        assert_eq!(missing.get("t"), None, "a missing piece is no value, not a wrong one");
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
