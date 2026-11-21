//! Files' Space preview, as Finder's Quick Look: the start of a text file, or a picture, read only, never the agent's.

use std::fs;
use std::io::Read;
use std::path::Path;

use base64::Engine;
use serde_json::{Value, json};

/// How much of a text file the preview shows.
const TEXT_BYTES: u64 = 64 * 1024;
/// The largest picture the preview draws.
const IMAGE_BYTES: u64 = 8 * 1024 * 1024;

const TEXT: &[&str] = &["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "toml", "log", "html", "htm", "css", "js", "ts", "tsx", "jsx", "rs", "py", "sh", "xml", "ini", "cfg", "ics", "vcf", "eml"];

fn image_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// `{ kind: "text", text, cut }`, `{ kind: "image", src }`, or `{ kind: "none", reason }` for anything else.
pub fn peek(path: &Path) -> Value {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let Ok(meta) = fs::metadata(path) else { return json!({ "kind": "none", "reason": "That is not there any more." }) };
    if !meta.is_file() {
        return json!({ "kind": "none", "reason": "A folder has no preview." });
    }
    if let Some(kind) = image_type(&ext) {
        if meta.len() > IMAGE_BYTES {
            return json!({ "kind": "none", "reason": "This picture is too large to preview." });
        }
        return match fs::read(path) {
            Ok(bytes) => json!({ "kind": "image", "src": format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }),
            Err(e) => json!({ "kind": "none", "reason": e.to_string() }),
        };
    }
    if TEXT.contains(&ext.as_str()) {
        let mut bytes = Vec::new();
        if let Err(e) = fs::File::open(path).and_then(|f| f.take(TEXT_BYTES).read_to_end(&mut bytes)) {
            return json!({ "kind": "none", "reason": e.to_string() });
        }
        // A cut may land inside a character: keep what reads.
        let text = String::from_utf8_lossy(&bytes).trim_end_matches('\u{fffd}').to_owned();
        return json!({ "kind": "text", "text": text, "cut": meta.len() > TEXT_BYTES, "markdown": matches!(ext.as_str(), "md" | "markdown") });
    }
    json!({ "kind": "none", "reason": "No preview for this kind of file. Press Enter to open it." })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_text_pictures_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("plan.md");
        fs::write(&note, "# Plan\n\nBuild week.").unwrap();
        let got = peek(&note);
        assert_eq!(got["kind"], "text");
        assert_eq!(got["markdown"], true);
        assert_eq!(got["text"], "# Plan\n\nBuild week.");
        assert_eq!(got["cut"], false);

        let pic = dir.path().join("dot.png");
        fs::write(&pic, [0x89, b'P', b'N', b'G']).unwrap();
        assert!(peek(&pic)["src"].as_str().unwrap().starts_with("data:image/png;base64,"));

        let other = dir.path().join("song.wav");
        fs::write(&other, [0u8; 4]).unwrap();
        assert_eq!(peek(&other)["kind"], "none");
        assert_eq!(peek(dir.path())["kind"], "none");
    }

    #[test]
    fn cuts_long_text() {
        let dir = tempfile::tempdir().unwrap();
        let long = dir.path().join("log.txt");
        fs::write(&long, "a".repeat(TEXT_BYTES as usize + 10)).unwrap();
        let got = peek(&long);
        assert_eq!(got["cut"], true);
        assert_eq!(got["text"].as_str().unwrap().len(), TEXT_BYTES as usize);
    }
}
