//! Profiles: separate Mobiuses for separate parts of life (Personal, Work, a client), each with its own conversations,
//! notes, tasks, memory, schedules and settings. The first is Personal and lives in the data folder itself; others live
//! in `profiles/<id>` inside it. Which one is open is kept in `profiles.json`; switching restarts Mobius.
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

pub const DEFAULT_ID: &str = "default";
/// The demo workspace: a profile like the others, but built from the seed shipped with Mobius each time it is opened.
pub const DEMO_ID: &str = "demo";
const DEMO_NAME: &str = "Demo workspace";
/// Where a fresh demo workspace waits until Mobius starts again, so it never replaces files that are open.
const DEMO_NEXT: &str = "demo-next";
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
    id == DEFAULT_ID || id == DEMO_ID || (id.len() == 8 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
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

    /// Opens the demo workspace fresh from `seed` (or opens it again from the start, when it is the one open): a new
    /// copy is made beside it and takes its place when Mobius starts again (`settle_demo`).
    pub fn open_demo(&mut self, base: &Path, seed: &Path) -> Result<(), String> {
        let next = base.join("profiles").join(DEMO_NEXT);
        remove_folder(&next)?;
        if let Err(e) = mobius_host::demo::build(seed, &next) {
            let _ = remove_folder(&next);
            return Err(e);
        }
        if !self.list.iter().any(|p| p.id == DEMO_ID) {
            if self.list.len() >= MAX_PROFILES {
                return Err(format!("There can be at most {MAX_PROFILES} profiles."));
            }
            self.list.push(Profile { id: DEMO_ID.into(), name: DEMO_NAME.into() });
        }
        self.current = DEMO_ID.into();
        Ok(())
    }

    pub fn switch(&mut self, id: &str) -> Result<(), String> {
        if !self.list.iter().any(|p| p.id == id) {
            return Err("That profile is gone.".into());
        }
        self.current = id.into();
        Ok(())
    }
}

/// Before anything is opened: a fresh demo workspace made last time takes the old one's place.
pub fn settle_demo(base: &Path) -> Result<(), String> {
    let folder = base.join("profiles");
    if !folder.join(DEMO_NEXT).is_dir() {
        return Ok(());
    }
    remove_folder(&folder.join(DEMO_ID))?;
    std::fs::rename(folder.join(DEMO_NEXT), folder.join(DEMO_ID)).map_err(|e| e.to_string())
}

/// Removes a folder of Mobius's own, never following a link out of it.
fn remove_folder(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(_) => Ok(()),
        Ok(m) if m.file_type().is_symlink() => std::fs::remove_file(path).map_err(|e| e.to_string()),
        Ok(_) => std::fs::remove_dir_all(path).map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn the_demo_workspace_is_built_fresh_beside_the_open_one_and_takes_its_place_at_the_next_start() {
        let dir = tempfile::tempdir().unwrap();
        let seed = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(seed.path().join("workspace/notes/Team")).unwrap();
        std::fs::write(seed.path().join("workspace/notes/Team/Plan.md"), "# Plan\n").unwrap();
        let mut p = Profiles::read(dir.path());
        p.open_demo(dir.path(), seed.path()).unwrap();
        p.write(dir.path()).unwrap();
        assert_eq!(p.current, DEMO_ID);
        assert_eq!(p.list.iter().filter(|q| q.id == DEMO_ID).count(), 1);
        settle_demo(dir.path()).unwrap();
        let demo = Profiles::read(dir.path()).folder(dir.path());
        assert_eq!(demo, dir.path().join("profiles/demo"));
        assert!(demo.join("workspace/notes/Team/Plan.md").is_file());
        // What a run changed goes on Reset.
        std::fs::write(demo.join("workspace/notes/Team/Plan.md"), "changed").unwrap();
        std::fs::write(demo.join("workspace/notes/Team/New.md"), "new").unwrap();
        p.open_demo(dir.path(), seed.path()).unwrap();
        assert_eq!(std::fs::read_to_string(demo.join("workspace/notes/Team/Plan.md")).unwrap(), "changed", "the open one is left until Mobius starts again");
        settle_demo(dir.path()).unwrap();
        assert_eq!(std::fs::read_to_string(demo.join("workspace/notes/Team/Plan.md")).unwrap(), "# Plan\n");
        assert!(!demo.join("workspace/notes/Team/New.md").exists());
        assert_eq!(p.list.iter().filter(|q| q.id == DEMO_ID).count(), 1);
        // A build without the seed says so and changes nothing.
        let mut q = Profiles::read(dir.path());
        q.switch(DEFAULT_ID).unwrap();
        assert!(q.open_demo(dir.path(), &dir.path().join("missing")).is_err());
        assert_eq!(q.current, DEFAULT_ID);
        assert!(!dir.path().join("profiles/demo-next").exists());
    }
}
