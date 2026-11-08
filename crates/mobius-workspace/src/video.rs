//! Video: each project is a folder in `<workspace>/video` holding its clips (the footage, never changed) and
//! `cut.json`, the edit: which parts of which clips play in what order, with titles. The agent changes the cut with
//! the ordinary file tools, so each change can be kept or put back; the window plays clips from the folder through
//! the application's `media` address, which serves only files here.
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use crate::notes::file_name_for;
use crate::photos::base64_decode;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "video";
pub const CUT: &str = "cut.json";
const MAX_CUT: usize = 512 * 1024;
const MAX_ADD: usize = 150 * 1024 * 1024;
/// The most served in one answer, when the player asks for "the rest of the file".
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

pub fn media_type(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    Some(match lower.rsplit_once('.')?.1 {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => return None,
    })
}

fn name_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

pub struct Video {
    root: PathBuf,
}

impl Video {
    pub fn new(workspace: impl Into<PathBuf>) -> Video {
        Video { root: workspace.into().join(FOLDER) }
    }

    fn project(&self, name: &str) -> Res<PathBuf> {
        let dir = self.root.join(name);
        if !name_ok(name) || !dir.is_dir() || fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that project is not there".into());
        }
        Ok(dir)
    }

    /// The file of a clip, for playing: only a media file directly in a project folder, never a link.
    pub fn clip_path(&self, project: &str, clip: &str) -> Res<PathBuf> {
        let dir = self.project(project)?;
        if !name_ok(clip) || media_type(clip).is_none() {
            return Err("that is not a clip".into());
        }
        let file = dir.join(clip);
        if !file.is_file() || fs::symlink_metadata(&file).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that clip is not there".into());
        }
        Ok(file)
    }

    pub fn projects(&self) -> Res<Value> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut dirs: Vec<_> = fs::read_dir(&self.root).map_err(|e| e.to_string())?.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).collect();
        dirs.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
        let mut out = Vec::new();
        for d in dirs {
            let name = d.file_name().to_string_lossy().into_owned();
            if !name_ok(&name) {
                continue;
            }
            let mut clips: Vec<Value> = fs::read_dir(d.path())
                .map_err(|e| e.to_string())?
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    (name_ok(&n) && media_type(&n).is_some()).then(|| json!({ "name": n, "bytes": e.metadata().map(|m| m.len()).unwrap_or(0), "kind": if media_type(&n).is_some_and(|t| t.starts_with("audio")) { "audio" } else { "video" } }))
                })
                .collect();
            clips.sort_by_key(|c| c["name"].as_str().unwrap_or("").to_lowercase());
            out.push(json!({ "name": name, "clips": clips, "hasCut": d.path().join(CUT).is_file() }));
        }
        Ok(Value::Array(out))
    }

    pub fn create_project(&self, name: &str) -> Res<Value> {
        let name = file_name_for(name);
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut chosen = name.clone();
        let mut n = 2;
        while self.root.join(&chosen).exists() {
            chosen = format!("{name} {n}");
            n += 1;
        }
        fs::create_dir(self.root.join(&chosen)).map_err(|e| e.to_string())?;
        Ok(json!({ "name": chosen, "folder": self.root.join(&chosen).display().to_string() }))
    }

    pub fn folder(&self, project: &str) -> Res<PathBuf> {
        self.project(project)
    }

    pub fn read_cut(&self, project: &str) -> Res<Value> {
        let file = self.project(project)?.join(CUT);
        let text = fs::read_to_string(&file).ok();
        Ok(json!({ "project": project, "text": text, "modified": if text.is_some() { json!(modified_ms(&file)) } else { Value::Null } }))
    }

    /// Writes the cut; `base` is the `modified` read (null when there was none), refused if it changed since.
    pub fn save_cut(&self, project: &str, text: &str, base: Option<u64>) -> Res<Value> {
        if text.len() > MAX_CUT {
            return Err("that cut is too long".into());
        }
        let file = self.project(project)?.join(CUT);
        if file.is_file().then(|| modified_ms(&file)) != base {
            return Err("changed elsewhere".into());
        }
        let temp = file.with_extension("json.mobius-tmp");
        fs::write(&temp, text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(json!({ "project": project, "modified": modified_ms(&file) }))
    }

    /// A clip dropped on the window, under a name not yet taken. Big footage is better copied into the folder.
    pub fn add_clip(&self, project: &str, name: &str, base64: &str) -> Res<Value> {
        let dir = self.project(project)?;
        if base64.len() > MAX_ADD / 3 * 4 + 8 {
            return Err("that clip is too big to drop here; copy it into the project's folder instead".into());
        }
        let name = file_name_for(name);
        media_type(&name).ok_or("Video plays MP4, MOV and WebM clips, and MP3, M4A and WAV sound")?;
        let bytes = base64_decode(base64)?;
        let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, "mp4"));
        let mut chosen = name.clone();
        let mut n = 2;
        while dir.join(&chosen).exists() {
            chosen = format!("{stem} {n}.{ext}");
            n += 1;
        }
        fs::write(dir.join(&chosen), bytes).map_err(|e| e.to_string())?;
        Ok(json!({ "project": project, "clip": chosen }))
    }
}

/// Part of a media file, as a player asks for it with `Range: bytes=start-end`: the bytes, where they start, and
/// the file's whole length. Without a range, the start of the file.
pub fn read_range(file: &Path, range: Option<&str>) -> Res<(Vec<u8>, u64, u64)> {
    let mut f = fs::File::open(file).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let (start, end) = match range.and_then(|r| r.trim().strip_prefix("bytes=")).and_then(|r| r.split(',').next()).and_then(|r| r.split_once('-')) {
        Some((a, b)) if !a.trim().is_empty() => {
            let start: u64 = a.trim().parse().map_err(|_| "bad range")?;
            let end = b.trim().parse::<u64>().ok().map_or(start.saturating_add(MAX_CHUNK - 1), |e| e.min(start.saturating_add(MAX_CHUNK - 1)));
            (start, end.min(len.saturating_sub(1)))
        }
        Some((_, b)) => {
            let suffix: u64 = b.trim().parse().map_err(|_| "bad range")?;
            (len.saturating_sub(suffix.min(MAX_CHUNK)), len.saturating_sub(1))
        }
        None => (0, MAX_CHUNK.min(len).saturating_sub(1)),
    };
    if len == 0 {
        return Ok((Vec::new(), 0, 0));
    }
    if start >= len || end < start {
        return Err("range not satisfiable".into());
    }
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; usize::try_from(end - start + 1).map_err(|_| "too big")?];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok((buf, start, len))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::photos::base64_encode;

    #[test]
    fn projects_clips_and_the_cut_beside_them() {
        let dir = tempfile::tempdir().unwrap();
        let v = Video::new(dir.path());
        assert_eq!(v.create_project("Offsite recap").unwrap()["name"], "Offsite recap");
        assert_eq!(v.add_clip("Offsite recap", "terrace.mp4", &base64_encode(b"0123456789")).unwrap()["clip"], "terrace.mp4");
        assert!(v.add_clip("Offsite recap", "notes.txt", "AA==").is_err());
        fs::write(v.root.join("Offsite recap/readme.txt"), "x").unwrap();
        let list = v.projects().unwrap();
        assert_eq!(list[0]["clips"], json!([{ "name": "terrace.mp4", "bytes": 10, "kind": "video" }]));
        assert_eq!(v.read_cut("Offsite recap").unwrap()["text"], Value::Null);
        let saved = v.save_cut("Offsite recap", "{}", None).unwrap();
        assert!(v.save_cut("Offsite recap", "{}", None).is_err());
        v.save_cut("Offsite recap", "{\"clips\":[]}", saved["modified"].as_u64()).unwrap();
        assert!(v.clip_path("Offsite recap", "terrace.mp4").is_ok());
        for (p, c) in [("..", "x.mp4"), ("Offsite recap", "../x.mp4"), ("Offsite recap", "readme.txt"), ("Offsite recap", "cut.json"), ("Nope", "terrace.mp4")] {
            assert!(v.clip_path(p, c).is_err(), "{p} {c}");
        }
    }

    #[test]
    fn ranges_are_served_as_players_ask() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("c.mp4");
        fs::write(&file, b"0123456789").unwrap();
        assert_eq!(read_range(&file, Some("bytes=2-4")).unwrap(), (b"234".to_vec(), 2, 10));
        assert_eq!(read_range(&file, Some("bytes=7-")).unwrap(), (b"789".to_vec(), 7, 10));
        assert_eq!(read_range(&file, Some("bytes=-3")).unwrap(), (b"789".to_vec(), 7, 10));
        assert_eq!(read_range(&file, None).unwrap().0.len(), 10);
        assert!(read_range(&file, Some("bytes=20-")).is_err());
    }
}
