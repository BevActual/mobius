//! Photos: albums are folders in `<workspace>/photos`, photos are the image files in them, untouched. Edits are kept
//! beside each photo as `<photo>.edits.json` (adjustments, each to an area of the picture), so the agent changes them
//! with the ordinary file tools and every change can be put back; Export writes a new file next to the photo.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "photos";
const MAX_PHOTO: u64 = 40 * 1024 * 1024;
const MAX_EDITS: usize = 256 * 1024;
const MAX_PHOTOS: usize = 2000;
pub const EDITS_SUFFIX: &str = ".edits.json";

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn media_type(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    let ext = lower.rsplit_once('.')?.1;
    Some(match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return None,
    })
}

/// `album/photo.jpg`: one safe folder name and one safe image file name.
fn photo_ok(path: &str) -> Option<(&str, &str)> {
    let (album, file) = path.split_once('/')?;
    (album == file_name_for(album) && !album.starts_with('.') && file == file_name_for(file) && !file.contains('/') && media_type(file).is_some()).then_some((album, file))
}

/// Base64, standard alphabet with padding, both ways: the window sends and receives pictures this way.
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
pub fn base64_decode(text: &str) -> Res<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in text.bytes().filter(|c| !c.is_ascii_whitespace()) {
        if c == b'=' {
            break;
        }
        let v = B64.iter().position(|&b| b == c).ok_or("that is not a picture")? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

pub struct Photos {
    root: PathBuf,
}

impl Photos {
    pub fn new(workspace: impl Into<PathBuf>) -> Photos {
        Photos { root: workspace.into().join(FOLDER) }
    }

    fn photo(&self, path: &str) -> Res<PathBuf> {
        let (album, _) = photo_ok(path).ok_or("that is not a photo")?;
        let dir = self.root.join(album);
        if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that album is a link, which Photo does not follow".into());
        }
        let file = self.root.join(path);
        if fs::symlink_metadata(&file).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that photo is a link, which Photo does not follow".into());
        }
        Ok(file)
    }

    /// Every album with its photos, albums by name, photos by name.
    pub fn albums(&self) -> Res<Value> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut dirs: Vec<_> = fs::read_dir(&self.root).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).collect();
        dirs.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
        let mut count = 0;
        let mut out = Vec::new();
        for dir in dirs {
            let album = dir.file_name().to_string_lossy().into_owned();
            if album != file_name_for(&album) || album.starts_with('.') {
                continue;
            }
            let mut photos: Vec<Value> = Vec::new();
            let mut files: Vec<_> = fs::read_dir(dir.path()).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_file())).collect();
            files.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
            for f in files {
                let name = f.file_name().to_string_lossy().into_owned();
                let path = format!("{album}/{name}");
                if photo_ok(&path).is_none() || count >= MAX_PHOTOS {
                    continue;
                }
                count += 1;
                let edited = dir.path().join(format!("{name}{EDITS_SUFFIX}")).is_file();
                photos.push(json!({ "path": path, "name": name, "modified": modified_ms(&f.path()), "edited": edited }));
            }
            out.push(json!({ "name": album, "photos": photos }));
        }
        Ok(Value::Array(out))
    }

    pub fn create_album(&self, name: &str) -> Res<Value> {
        let name = file_name_for(name);
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut chosen = name.clone();
        let mut n = 2;
        while self.root.join(&chosen).exists() {
            chosen = format!("{name} {n}");
            n += 1;
        }
        fs::create_dir(self.root.join(&chosen)).map_err(|e| e.to_string())?;
        Ok(json!({ "name": chosen }))
    }

    /// The photo as a data URL, with its edits (the file's text, or null) and when each last changed.
    pub fn read(&self, path: &str) -> Res<Value> {
        let file = self.photo(path)?;
        let meta = fs::metadata(&file).map_err(|_| "that photo is not there".to_owned())?;
        if meta.len() > MAX_PHOTO {
            return Err("that photo is too big to open here".into());
        }
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        let kind = media_type(path).unwrap_or("image/jpeg");
        let edits_file = PathBuf::from(format!("{}{EDITS_SUFFIX}", file.display()));
        let edits = fs::read_to_string(&edits_file).ok();
        Ok(json!({ "path": path, "dataUrl": format!("data:{kind};base64,{}", base64_encode(&bytes)), "edits": edits, "modified": modified_ms(&file), "editsModified": if edits.is_some() { json!(modified_ms(&edits_file)) } else { Value::Null } }))
    }

    /// Writes a photo's edits; `base` is the `editsModified` read (null for none yet), refused if they changed since.
    pub fn save_edits(&self, path: &str, text: &str, base: Option<u64>) -> Res<Value> {
        if text.len() > MAX_EDITS {
            return Err("those edits are too long".into());
        }
        let file = self.photo(path)?;
        if !file.is_file() {
            return Err("that photo is not there".into());
        }
        let edits = PathBuf::from(format!("{}{EDITS_SUFFIX}", file.display()));
        let now = edits.is_file().then(|| modified_ms(&edits));
        if base != now {
            return Err("changed elsewhere".into());
        }
        let temp = PathBuf::from(format!("{}.mobius-tmp", edits.display()));
        fs::write(&temp, text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &edits).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(json!({ "path": path, "editsModified": modified_ms(&edits) }))
    }

    /// Adds a picture to an album (a file dropped on the window), under a name not yet taken.
    pub fn add(&self, album: &str, name: &str, base64: &str) -> Res<Value> {
        let dir = self.root.join(album);
        if album != file_name_for(album) || !dir.is_dir() {
            return Err("that album is not there".into());
        }
        if base64.len() as u64 > MAX_PHOTO / 3 * 4 + 8 {
            return Err("that photo is too big".into());
        }
        let name = file_name_for(name);
        media_type(&name).ok_or("Photo opens JPEG, PNG, WebP and GIF pictures")?;
        let bytes = base64_decode(base64)?;
        let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, "jpg"));
        let mut chosen = name.clone();
        let mut n = 2;
        while dir.join(&chosen).exists() {
            chosen = format!("{stem} {n}.{ext}");
            n += 1;
        }
        fs::write(dir.join(&chosen), bytes).map_err(|e| e.to_string())?;
        Ok(json!({ "path": format!("{album}/{chosen}") }))
    }

    /// Writes an exported picture (the photo with its edits, made by the window) next to the photo, as `<name> edited`.
    pub fn export(&self, path: &str, base64: &str) -> Res<Value> {
        let (album, file) = photo_ok(path).ok_or("that is not a photo")?;
        self.photo(path)?;
        let stem = file.rsplit_once('.').map_or(file, |s| s.0);
        let name = format!("{stem} edited.jpg");
        let made = self.add(album, &name, base64)?;
        Ok(made)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_goes_both_ways() {
        for bytes in [&b""[..], b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar", &[0, 255, 128, 7]] {
            assert_eq!(base64_decode(&base64_encode(bytes)).unwrap(), bytes);
        }
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert!(base64_decode("@@").is_err());
    }

    #[test]
    fn albums_photos_and_edits_beside_them() {
        let dir = tempfile::tempdir().unwrap();
        let photos = Photos::new(dir.path());
        assert_eq!(photos.create_album("Lisbon").unwrap()["name"], "Lisbon");
        let png = base64_encode(b"\x89PNG fake");
        assert_eq!(photos.add("Lisbon", "coast.png", &png).unwrap()["path"], "Lisbon/coast.png");
        assert_eq!(photos.add("Lisbon", "coast.png", &png).unwrap()["path"], "Lisbon/coast 2.png");
        assert!(photos.add("Lisbon", "notes.txt", &png).is_err());
        assert!(photos.add("Nope", "a.png", &png).is_err());
        let read = photos.read("Lisbon/coast.png").unwrap();
        assert!(read["dataUrl"].as_str().unwrap().starts_with("data:image/png;base64,iVBORyBmYWtl"));
        assert_eq!(read["edits"], Value::Null);
        let saved = photos.save_edits("Lisbon/coast.png", "{\"version\":1,\"adjustments\":[]}", None).unwrap();
        assert!(photos.save_edits("Lisbon/coast.png", "{}", None).is_err(), "edits made since are not overwritten");
        photos.save_edits("Lisbon/coast.png", "{}", saved["editsModified"].as_u64()).unwrap();
        let albums = photos.albums().unwrap();
        assert_eq!(albums[0]["photos"].as_array().unwrap().len(), 2);
        let coast = albums[0]["photos"].as_array().unwrap().iter().find(|p| p["name"] == "coast.png").unwrap();
        assert_eq!(coast["edited"], true);
        assert_eq!(photos.export("Lisbon/coast.png", &base64_encode(b"jpeg")).unwrap()["path"], "Lisbon/coast edited.jpg");
        for bad in ["../x.png", "Lisbon/../x.png", "Lisbon/a.txt", "x.png", "Lisbon/sub/x.png"] {
            assert!(photos.read(bad).is_err(), "{bad}");
        }
    }
}
