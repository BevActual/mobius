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
/// Where films made from the cut go, inside the project.
pub const EXPORTS: &str = "Exports";
const MAX_EXPORT: usize = 400 * 1024 * 1024;
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

/// How long a clip plays, read from its header without reading the footage: an MP4 or QuickTime movie's `mvhd`
/// (wherever `moov` is in the file), or a WAV file's data size over its byte rate. `None` for other kinds, or when the
/// header cannot be read.
pub fn duration_ms(path: &Path) -> Option<u64> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    match media_type(&path.file_name()?.to_string_lossy())? {
        "video/mp4" | "video/quicktime" | "audio/mp4" => mp4_duration(&mut file, len),
        "audio/wav" => wav_duration(&mut file, len),
        _ => None,
    }
}

fn read_u32(file: &mut fs::File) -> Option<u32> {
    let mut b = [0u8; 4];
    file.read_exact(&mut b).ok()?;
    Some(u32::from_be_bytes(b))
}

fn read_u64(file: &mut fs::File) -> Option<u64> {
    let mut b = [0u8; 8];
    file.read_exact(&mut b).ok()?;
    Some(u64::from_be_bytes(b))
}

/// The boxes between `start` and `end`: each one's type, where its contents begin, and where it ends.
fn mp4_boxes(file: &mut fs::File, start: u64, end: u64) -> Vec<([u8; 4], u64, u64)> {
    let mut out = Vec::new();
    let mut at = start;
    while at + 8 <= end && out.len() < 4096 {
        if file.seek(SeekFrom::Start(at)).is_err() {
            break;
        }
        let Some(size) = read_u32(file) else { break };
        let mut kind = [0u8; 4];
        if file.read_exact(&mut kind).is_err() {
            break;
        }
        let (size, header) = match size {
            0 => (end - at, 8),
            1 => match read_u64(file) {
                Some(large) => (large, 16),
                None => break,
            },
            n => (u64::from(n), 8),
        };
        if size < header || at + size > end {
            break;
        }
        out.push((kind, at + header, at + size));
        at += size;
    }
    out
}

fn mp4_duration(file: &mut fs::File, len: u64) -> Option<u64> {
    let (_, moov, moov_end) = mp4_boxes(file, 0, len).into_iter().find(|(k, _, _)| k == b"moov")?;
    let (_, mvhd, mvhd_end) = mp4_boxes(file, moov, moov_end).into_iter().find(|(k, _, _)| k == b"mvhd")?;
    file.seek(SeekFrom::Start(mvhd)).ok()?;
    let version = read_u32(file)? >> 24;
    let (timescale, duration) = if version == 1 {
        if mvhd + 32 > mvhd_end {
            return None;
        }
        file.seek(SeekFrom::Current(16)).ok()?;
        (read_u32(file)?, read_u64(file)?)
    } else {
        if mvhd + 20 > mvhd_end {
            return None;
        }
        file.seek(SeekFrom::Current(8)).ok()?;
        (read_u32(file)?, u64::from(read_u32(file)?))
    };
    // All ones means "not known".
    (timescale > 0 && duration != u64::MAX && duration != u64::from(u32::MAX)).then(|| u64::try_from(u128::from(duration) * 1000 / u128::from(timescale)).unwrap_or(u64::MAX))
}

fn wav_duration(file: &mut fs::File, len: u64) -> Option<u64> {
    let mut head = [0u8; 12];
    file.read_exact(&mut head).ok()?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return None;
    }
    let (mut at, mut byte_rate) = (12u64, None);
    while at + 8 <= len {
        file.seek(SeekFrom::Start(at)).ok()?;
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk).ok()?;
        let size = u64::from(u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]));
        match &chunk[0..4] {
            b"fmt " => {
                let mut fmt = [0u8; 12];
                file.read_exact(&mut fmt).ok()?;
                byte_rate = Some(u64::from(u32::from_le_bytes([fmt[8], fmt[9], fmt[10], fmt[11]])));
            }
            b"data" => {
                let rate = byte_rate.filter(|r| *r > 0)?;
                // A recording still being written can say more than the file holds.
                return Some(size.min(len - at - 8) * 1000 / rate);
            }
            _ => {}
        }
        at += 8 + size + (size & 1);
    }
    None
}

/// 1:05, or 1:02:03 for an hour or more.
pub fn clock(ms: u64) -> String {
    let s = ms / 1000;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{}:{:02}", s / 60, s % 60) }
}

fn name_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

/// The agent's Video tool. It reads only; the agent changes a cut with the file tools, so each change can be reviewed.
pub fn tool_descriptions() -> Vec<Value> {
    vec![json!({ "name": "video.clips", "description": "The Video app's projects and their clips: each clip's kind, length and size, and whether the project has a cut (video/<project>/cut.json, changed with the file tools). Use the lengths to place clips in a cut.", "capability": "files.read",
        "input_schema": { "type": "object", "properties": { "project": { "type": "string", "description": "One project; all of them when left out." } } } })]
}

pub fn is_video_tool(name: &str) -> bool {
    name == "video.clips"
}

fn size_words(bytes: u64) -> String {
    match bytes {
        b if b < 1024 * 1024 => format!("{} KB", b.div_ceil(1024)),
        b => format!("{} MB", b.div_ceil(1024 * 1024)),
    }
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
                    (name_ok(&n) && media_type(&n).is_some()).then(|| json!({ "name": n, "bytes": e.metadata().map(|m| m.len()).unwrap_or(0), "kind": if media_type(&n).is_some_and(|t| t.starts_with("audio")) { "audio" } else { "video" }, "durationMs": duration_ms(&e.path()) }))
                })
                .collect();
            clips.sort_by_key(|c| c["name"].as_str().unwrap_or("").to_lowercase());
            out.push(json!({ "name": name, "clips": clips, "hasCut": d.path().join(CUT).is_file() }));
        }
        Ok(Value::Array(out))
    }

    pub fn run(&self, name: &str, args: &Value) -> Res<String> {
        if name != "video.clips" {
            return Err(format!("unknown tool {name}"));
        }
        let only = args.get("project").and_then(Value::as_str).map(str::trim).filter(|p| !p.is_empty());
        let projects = self.projects()?;
        let projects: Vec<&Value> = projects.as_array().map(|a| a.iter().filter(|p| only.is_none_or(|o| p["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(o)))).collect()).unwrap_or_default();
        if projects.is_empty() {
            return Ok(match only {
                Some(o) => format!("There is no Video project named {o}."),
                None => "There are no Video projects yet.".into(),
            });
        }
        let mut out = Vec::new();
        for p in projects {
            let name = p["name"].as_str().unwrap_or("");
            let cut = if p["hasCut"] == true { format!("cut: {FOLDER}/{name}/{CUT}") } else { "no cut yet".into() };
            out.push(format!("{name} ({cut})"));
            let clips = p["clips"].as_array().cloned().unwrap_or_default();
            if clips.is_empty() {
                out.push("- no clips".into());
            }
            for c in clips {
                let length = c["durationMs"].as_u64().map_or_else(|| "length unknown".to_owned(), clock);
                out.push(format!("- {}: {}, {}, {}", c["name"].as_str().unwrap_or(""), c["kind"].as_str().unwrap_or("video"), length, size_words(c["bytes"].as_u64().unwrap_or(0))));
            }
        }
        Ok(out.join("\n"))
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

    /// The project's `Exports` folder, made if needed: films made from the cut. A folder inside the project, so
    /// exports are never listed as footage.
    pub fn exports(&self, project: &str) -> Res<PathBuf> {
        let dir = self.project(project)?.join(EXPORTS);
        if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that project's Exports folder is a link".into());
        }
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    /// A film made from the cut, saved in `Exports` under a name not yet taken (MP4 or WebM only).
    pub fn save_export(&self, project: &str, name: &str, base64: &str) -> Res<Value> {
        if base64.len() > MAX_EXPORT / 3 * 4 + 8 {
            return Err("that film is too big to save".into());
        }
        let name = file_name_for(name);
        if !matches!(media_type(&name), Some("video/mp4" | "video/webm")) {
            return Err("a film is saved as MP4 or WebM".into());
        }
        let dir = self.exports(project)?;
        let bytes = base64_decode(base64)?;
        let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, "webm"));
        let mut chosen = name.clone();
        let mut n = 2;
        while dir.join(&chosen).exists() {
            chosen = format!("{stem} {n}.{ext}");
            n += 1;
        }
        let file = dir.join(&chosen);
        fs::write(&file, bytes).map_err(|e| e.to_string())?;
        Ok(json!({ "project": project, "file": format!("{EXPORTS}/{chosen}"), "path": file.display().to_string() }))
    }
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn exports_go_in_their_own_folder_under_fresh_names_and_are_not_footage() {
        let tmp = std::env::temp_dir().join(format!("mobius-video-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let v = Video::new(&tmp);
        let p = v.create_project("Trip").unwrap()["name"].as_str().unwrap().to_owned();
        let a = v.save_export(&p, "Trip.webm", "AAEC").unwrap();
        let b = v.save_export(&p, "Trip.webm", "AAEC").unwrap();
        assert_eq!(a["file"], "Exports/Trip.webm");
        assert_eq!(b["file"], "Exports/Trip 2.webm");
        assert_eq!(fs::read(tmp.join("video/Trip/Exports/Trip.webm")).unwrap(), vec![0, 1, 2]);
        assert!(v.save_export(&p, "Trip.mov", "AAEC").is_err());
        assert!(v.save_export("Nope", "Trip.webm", "AAEC").is_err());
        assert_eq!(v.projects().unwrap()[0]["clips"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&tmp);
    }
}

/// A whole media file, for a player that cannot ask for parts; refused past 512 MB.
pub fn read_whole(file: &Path) -> Res<(Vec<u8>, u64, u64)> {
    let len = fs::metadata(file).map_err(|e| e.to_string())?.len();
    if len > 512 * 1024 * 1024 {
        return Err("that clip is too big to play here".into());
    }
    let bytes = fs::read(file).map_err(|e| e.to_string())?;
    Ok((bytes, 0, len))
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
        assert_eq!(list[0]["clips"], json!([{ "name": "terrace.mp4", "bytes": 10, "kind": "video", "durationMs": null }]), "not a movie inside: no length");
        assert_eq!(v.read_cut("Offsite recap").unwrap()["text"], Value::Null);
        let saved = v.save_cut("Offsite recap", "{}", None).unwrap();
        assert!(v.save_cut("Offsite recap", "{}", None).is_err());
        v.save_cut("Offsite recap", "{\"clips\":[]}", saved["modified"].as_u64()).unwrap();
        assert!(v.clip_path("Offsite recap", "terrace.mp4").is_ok());
        for (p, c) in [("..", "x.mp4"), ("Offsite recap", "../x.mp4"), ("Offsite recap", "readme.txt"), ("Offsite recap", "cut.json"), ("Nope", "terrace.mp4")] {
            assert!(v.clip_path(p, c).is_err(), "{p} {c}");
        }
    }

    /// A movie's header only: ftyp, the footage (mdat), then moov with its mvhd, as phones write them.
    fn movie(version: u8, timescale: u32, duration: u64) -> Vec<u8> {
        let boxed = |kind: &[u8], body: &[u8]| [&u32::try_from(body.len() + 8).unwrap().to_be_bytes()[..], kind, body].concat();
        let mut mvhd = vec![version, 0, 0, 0];
        if version == 1 {
            mvhd.extend([0u8; 16]);
            mvhd.extend(timescale.to_be_bytes());
            mvhd.extend(duration.to_be_bytes());
        } else {
            mvhd.extend([0u8; 8]);
            mvhd.extend(timescale.to_be_bytes());
            mvhd.extend(u32::try_from(duration).unwrap().to_be_bytes());
        }
        mvhd.extend([0u8; 80]);
        let moov = boxed(b"moov", &[boxed(b"udta", b"x"), boxed(b"mvhd", &mvhd), boxed(b"trak", &[0u8; 20])].concat());
        [boxed(b"ftyp", b"isom\0\0\0\0"), boxed(b"mdat", &[7u8; 5000]), moov].concat()
    }

    fn wav(byte_rate: u32, data: usize) -> Vec<u8> {
        let mut fmt = vec![1u8, 0, 2, 0];
        fmt.extend(44100u32.to_le_bytes());
        fmt.extend(byte_rate.to_le_bytes());
        fmt.extend([4u8, 0, 16, 0]);
        let chunk = |kind: &[u8], body: &[u8]| [kind, &u32::try_from(body.len()).unwrap().to_le_bytes()[..], body].concat();
        let body = [&b"WAVE"[..], &chunk(b"LIST", b"abc\0"), &chunk(b"fmt ", &fmt), &chunk(b"data", &vec![0u8; data])].concat();
        [&b"RIFF"[..], &u32::try_from(body.len()).unwrap().to_le_bytes()[..], &body].concat()
    }

    #[test]
    fn a_clip_says_how_long_it_plays_from_its_header() {
        let dir = tempfile::tempdir().unwrap();
        let v = Video::new(dir.path());
        v.create_project("Launch").unwrap();
        let at = |n: &str| dir.path().join("video/Launch").join(n);
        fs::write(at("terrace.mp4"), movie(0, 600, 25_500)).unwrap();
        fs::write(at("drone.mov"), movie(1, 90_000, 90_000 * 3725)).unwrap();
        fs::write(at("voice.wav"), wav(176_400, 352_800)).unwrap();
        fs::write(at("broken.mp4"), b"not a movie").unwrap();
        fs::write(at("song.mp3"), b"ID3").unwrap();
        assert_eq!(duration_ms(&at("terrace.mp4")), Some(42_500));
        assert_eq!(duration_ms(&at("drone.mov")), Some(3_725_000));
        assert_eq!(duration_ms(&at("voice.wav")), Some(2_000));
        assert_eq!(duration_ms(&at("broken.mp4")), None);
        assert_eq!(duration_ms(&at("song.mp3")), None);
        assert_eq!(v.projects().unwrap()[0]["clips"][3]["durationMs"], 42_500);

        let said = v.run("video.clips", &json!({ "project": "launch" })).unwrap();
        assert_eq!(said, "Launch (no cut yet)\n- broken.mp4: video, length unknown, 1 KB\n- drone.mov: video, 1:02:05, 6 KB\n- song.mp3: audio, length unknown, 1 KB\n- terrace.mp4: video, 0:42, 6 KB\n- voice.wav: audio, 0:02, 345 KB");
        assert_eq!(v.run("video.clips", &json!({ "project": "Nope" })).unwrap(), "There is no Video project named Nope.");
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
