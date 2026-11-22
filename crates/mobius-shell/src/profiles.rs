//! Profiles: separate Mobiuses for separate parts of life (Personal, Work, a client), each with its own conversations,
//! notes, tasks, memory, schedules and settings. The first is Personal and lives in the data folder itself; others live
//! in `profiles/<id>` inside it. Which one is open is kept in `profiles.json`; switching restarts Mobius.
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

pub const DEFAULT_ID: &str = "default";
/// The id the retired demo workspace had: a profile someone already has under it still opens and can be removed.
const OLD_DEMO_ID: &str = "demo";
const MAX_PROFILES: usize = 12;
const MAX_NAME: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profiles {
    pub current: String,
    pub list: Vec<Profile>,
}

fn is_id(id: &str) -> bool {
    id == DEFAULT_ID || id == OLD_DEMO_ID || (id.len() == 8 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
}

fn clean_name(name: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    (!name.is_empty() && name.chars().count() <= MAX_NAME && !name.chars().any(char::is_control)).then_some(name)
}

impl Profiles {
    /// What `profiles.json` in `base` says, or just Personal. Entries that do not make sense are dropped.
    pub fn read(base: &Path) -> Profiles {
        let saved = std::fs::read_to_string(base.join("profiles.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
        let mut list = vec![Profile { id: DEFAULT_ID.into(), name: "Personal".into() }];
        for p in saved.get("list").and_then(Value::as_array).into_iter().flatten().take(MAX_PROFILES) {
            let (Some(id), Some(name)) = (p.get("id").and_then(Value::as_str), p.get("name").and_then(Value::as_str).and_then(clean_name)) else { continue };
            if !is_id(id) {
                continue;
            }
            match list.iter_mut().find(|q| q.id == id) {
                Some(existing) => existing.name = name,
                None => list.push(Profile { id: id.into(), name }),
            }
        }
        let current = saved.get("current").and_then(Value::as_str).filter(|c| list.iter().any(|p| p.id == *c)).unwrap_or(DEFAULT_ID).to_owned();
        Profiles { current, list }
    }

    pub fn write(&self, base: &Path) -> Result<(), String> {
        std::fs::create_dir_all(base).map_err(|e| e.to_string())?;
        let body = json!({ "current": self.current, "list": self.list.iter().map(|p| json!({ "id": p.id, "name": p.name })).collect::<Vec<_>>() });
        std::fs::write(base.join("profiles.json"), body.to_string()).map_err(|e| e.to_string())
    }

    /// The folder the open profile keeps its data in.
    pub fn folder(&self, base: &Path) -> PathBuf {
        if self.current == DEFAULT_ID { base.to_path_buf() } else { base.join("profiles").join(&self.current) }
    }

    pub fn to_json(&self) -> Value {
        json!({ "current": self.current, "list": self.list.iter().map(|p| json!({ "id": p.id, "name": p.name })).collect::<Vec<_>>() })
    }

    pub fn create(&mut self, name: &str) -> Result<Profile, String> {
        let name = clean_name(name).ok_or(format!("A profile needs a name of up to {MAX_NAME} characters."))?;
        if self.list.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
            return Err("There is already a profile with that name.".into());
        }
        if self.list.len() >= MAX_PROFILES {
            return Err(format!("There can be at most {MAX_PROFILES} profiles."));
        }
        let mut bytes = [0u8; 4];
        let _ = getrandom::fill(&mut bytes);
        let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let profile = Profile { id, name };
        self.list.push(profile.clone());
        Ok(profile)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name).ok_or(format!("A profile needs a name of up to {MAX_NAME} characters."))?;
        if self.list.iter().any(|p| p.id != id && p.name.eq_ignore_ascii_case(&name)) {
            return Err("There is already a profile with that name.".into());
        }
        let profile = self.list.iter_mut().find(|p| p.id == id).ok_or("That profile is gone.")?;
        profile.name = name;
        Ok(())
    }

    /// Takes it off the list. Its folder is left as it is, so nothing is lost by accident.
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if id == DEFAULT_ID {
            return Err("Personal is always there.".into());
        }
        if id == self.current {
            return Err("Switch to another profile first.".into());
        }
        let before = self.list.len();
        self.list.retain(|p| p.id != id);
        if self.list.len() == before { Err("That profile is gone.".into()) } else { Ok(()) }
    }

    pub fn switch(&mut self, id: &str) -> Result<(), String> {
        if !self.list.iter().any(|p| p.id == id) {
            return Err("That profile is gone.".into());
        }
        self.current = id.into();
        Ok(())
    }
}

/// The name of the file that says which set of data a folder is: see [`space_id`].
const SPACE_FILE: &str = "space-id";

/// Which set of data `folder` holds, for the window's own view state (hidden calendars, the last sheet, kept turns). The
/// web view keeps that per computer, not per profile, so the window files it under this and swaps it when the profile
/// changes. A folder made afresh has no file yet and so gets a new one.
pub fn space_id(folder: &Path) -> String {
    let file = folder.join(SPACE_FILE);
    if let Ok(id) = std::fs::read_to_string(&file) {
        let id = id.trim();
        if !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return id.to_owned();
        }
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let id = format!("{:x}-{:x}", nanos, std::process::id());
    // Not kept, the window still works: it only cannot tell this folder from another next time.
    let _ = std::fs::write(&file, &id);
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_keeps_its_space_and_a_fresh_one_gets_another() {
        let dir = tempfile::tempdir().unwrap();
        let first = space_id(dir.path());
        assert!(!first.is_empty());
        assert_eq!(space_id(dir.path()), first, "the same folder, the same view state");
        let fresh = tempfile::tempdir().unwrap();
        assert_ne!(space_id(fresh.path()), first, "a new folder starts from no view state");
        std::fs::write(dir.path().join(SPACE_FILE), "<script>").unwrap();
        assert_ne!(space_id(dir.path()), "<script>", "only plain ids are passed to the window");
    }

    #[test]
    fn personal_is_there_from_the_start_and_lives_in_the_data_folder() {
        let dir = tempfile::tempdir().unwrap();
        let p = Profiles::read(dir.path());
        assert_eq!(p.current, DEFAULT_ID);
        assert_eq!(p.list, vec![Profile { id: DEFAULT_ID.into(), name: "Personal".into() }]);
        assert_eq!(p.folder(dir.path()), dir.path());
    }

    #[test]
    fn profiles_are_made_switched_to_kept_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = Profiles::read(dir.path());
        let work = p.create("  Work ").unwrap();
        assert_eq!(work.name, "Work");
        assert!(p.create("work").is_err(), "names are not repeated");
        assert!(p.create("").is_err());
        p.switch(&work.id).unwrap();
        p.write(dir.path()).unwrap();
        let again = Profiles::read(dir.path());
        assert_eq!(again.current, work.id);
        assert_eq!(again.folder(dir.path()), dir.path().join("profiles").join(&work.id));
        let mut again = again;
        assert!(again.remove(&work.id).is_err(), "not the open one");
        assert!(again.remove(DEFAULT_ID).is_err());
        again.switch(DEFAULT_ID).unwrap();
        again.rename(&work.id, "Client").unwrap();
        again.remove(&work.id).unwrap();
        assert_eq!(again.list.len(), 1);
    }

    #[test]
    fn a_damaged_file_still_opens_personal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("profiles.json"), r#"{ "current": "../x", "list": [{ "id": "../x", "name": "Bad" }, { "id": "abcdef01", "name": "" }] }"#).unwrap();
        let p = Profiles::read(dir.path());
        assert_eq!((p.current.as_str(), p.list.len()), (DEFAULT_ID, 1));
    }
}
