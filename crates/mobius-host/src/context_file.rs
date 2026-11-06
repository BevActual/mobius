//! A text file as something to attach to a message. Only its name is kept, not the folders it sits in. Binary or very
//! large files are refused, and long text is cut so the message stays within its limits.
use std::path::Path;

use serde_json::{Value, json};

use crate::context::MAX_ITEM_CHARS;

/// Bigger files are refused before they are read.
pub const MAX_FILE_BYTES: u64 = 400_000;

fn failed(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

/// Cuts `text` to the most characters an attachment may carry, marking the cut.
pub fn cut(text: &str) -> String {
    if text.encode_utf16().count() <= MAX_ITEM_CHARS {
        return text.to_owned();
    }
    let mut kept = String::new();
    let mut units = 0;
    for c in text.chars() {
        units += c.len_utf16();
        if units > MAX_ITEM_CHARS - 20 {
            break;
        }
        kept.push(c);
    }
    format!("{kept}\n… [cut]")
}

pub fn read_text_file(file: &Path) -> Value {
    let Ok(info) = std::fs::metadata(file) else { return failed("Mobius could not read that file.") };
    if !info.is_file() {
        return failed("That is not a file.");
    }
    if info.len() > MAX_FILE_BYTES {
        return failed("That file is too big to attach. Try one under 400 KB.");
    }
    let Ok(bytes) = std::fs::read(file) else { return failed("Mobius could not read that file.") };
    if bytes.contains(&0) {
        return failed("That does not look like a text file.");
    }
    let Ok(text) = String::from_utf8(bytes) else { return failed("That file is not plain text (UTF-8), so it cannot be attached.") };
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    if text.trim().is_empty() {
        return failed("That file is empty.");
    }
    let name: String = file.file_name().map_or(String::new(), |n| n.to_string_lossy().chars().take(120).collect());
    let name = if name.is_empty() { "file".to_owned() } else { name };
    json!({ "ok": true, "item": { "kind": "file", "title": name, "source": name, "text": cut(text) } })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn a_text_file_becomes_an_attachment_named_by_its_file_name_only() {
        let (dir, path) = file("notes.txt", "line one\nline two".as_bytes());
        let r = read_text_file(&path);
        assert_eq!(r, json!({ "ok": true, "item": { "kind": "file", "title": "notes.txt", "source": "notes.txt", "text": "line one\nline two" } }));
        assert!(!r.to_string().contains(&dir.path().display().to_string().replace('\\', "\\\\")), "no folders");
    }

    #[test]
    fn a_byte_order_mark_is_dropped() {
        let (_d, path) = file("b.txt", b"\xEF\xBB\xBFhello");
        assert_eq!(read_text_file(&path)["item"]["text"], "hello");
    }

    #[test]
    fn files_that_should_not_be_attached_are_refused_with_a_reason() {
        let (_d, bin) = file("blob.bin", &[1, 2, 0, 3]);
        assert_eq!(read_text_file(&bin)["error"], "That does not look like a text file.");
        let (_d, latin) = file("latin.txt", &[0xe9, 0xe8, 0x41]);
        assert!(read_text_file(&latin)["error"].as_str().unwrap().contains("UTF-8"));
        let (_d, empty) = file("empty.txt", b"  \n ");
        assert_eq!(read_text_file(&empty)["error"], "That file is empty.");
        let (_d, big) = file("big.txt", &vec![b'a'; MAX_FILE_BYTES as usize + 1]);
        assert!(read_text_file(&big)["error"].as_str().unwrap().contains("too big"));
        let (dir, _p) = file("x", b"x");
        assert_eq!(read_text_file(dir.path())["error"], "That is not a file.");
        assert_eq!(read_text_file(&dir.path().join("missing.txt"))["error"], "Mobius could not read that file.");
    }

    #[test]
    fn long_text_is_cut_to_the_limit_and_marked() {
        let (_d, path) = file("long.txt", "a".repeat(30_000).as_bytes());
        let text = read_text_file(&path)["item"]["text"].as_str().unwrap().to_owned();
        assert!(text.ends_with("… [cut]") && text.encode_utf16().count() <= MAX_ITEM_CHARS + 8, "{}", text.len());
        let exact = "b".repeat(MAX_ITEM_CHARS);
        assert_eq!(cut(&exact), exact);
        let emoji = "😀".repeat(15_000);
        assert!(cut(&emoji).ends_with("… [cut]"));
    }

    #[test]
    fn a_long_name_is_shortened() {
        let (_d, path) = file(&format!("{}.txt", "n".repeat(200)), b"x");
        assert_eq!(read_text_file(&path)["item"]["title"].as_str().unwrap().chars().count(), 120);
    }
}
