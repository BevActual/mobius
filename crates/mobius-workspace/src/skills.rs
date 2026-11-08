//! Skills: procedures Mobius keeps and follows, one folder each in `<workspace>/skills`, in the open agentskills.io
//! shape: `skills/<name>/SKILL.md`, a `name` and `description` in its front matter, then the steps. Every saved change
//! keeps the version before it in `versions/`, so any of them can be restored. The agent reads skills with its own
//! tools and changes them with the ordinary file tools (asked first, and shown to keep or discard).
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use crate::checkpoints::Checkpoints;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "skills";
pub const FILE: &str = "SKILL.md";
const MAX_SKILL: usize = 64 * 1024;
const MAX_VERSIONS: usize = 50;

pub fn is_skill_tool(name: &str) -> bool {
    matches!(name, "skills.list" | "skills.read")
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "skills.list", "capability": "skills.read", "description": "List the skills the person keeps: procedures to follow for tasks that come back, each with a name and when to use it.", "input_schema": { "type": "object", "properties": {} } }),
        json!({ "name": "skills.read", "capability": "skills.read", "resource_arg": "name", "description": "Read one skill: its description and its steps. Follow the steps when the task matches. To improve a skill, change skills/<name>/SKILL.md with files.edit; the person keeps or discards the change.", "input_schema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } }),
    ]
}

/// A skill's name: lowercase words joined by hyphens, as agentskills.io names them.
pub fn name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && !name.starts_with('-') && !name.ends_with('-') && !name.contains("--") && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A name made from what a person typed: "Compare stays" becomes `compare-stays`.
pub fn name_for(text: &str) -> String {
    let mut out = String::new();
    for c in text.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(64).collect();
    if out.is_empty() { "skill".to_owned() } else { out.trim_end_matches('-').to_owned() }
}

/// The `description:` in the front matter, if there is one.
pub fn description_of(text: &str) -> String {
    let Some(rest) = text.strip_prefix("---") else { return String::new() };
    let Some(end) = rest.find("\n---") else { return String::new() };
    rest[..end].lines().find_map(|l| l.trim().strip_prefix("description:")).map(|d| d.trim().trim_matches('"').to_owned()).unwrap_or_default()
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

pub struct Skills {
    root: PathBuf,
    workspace: PathBuf,
    checkpoints: Checkpoints,
}

impl Skills {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Skills {
        let workspace = workspace.into();
        Skills { root: workspace.join(FOLDER), workspace, checkpoints: Checkpoints::new(checkpoint_store) }
    }

    fn dir(&self, name: &str) -> Res<PathBuf> {
        if !name_ok(name) {
            return Err("that is not a skill name".into());
        }
        let dir = self.root.join(name);
        if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that skill is a link".into());
        }
        Ok(dir)
    }

    fn versions(&self, dir: &Path) -> Vec<(u32, PathBuf)> {
        let mut out: Vec<(u32, PathBuf)> = fs::read_dir(dir.join("versions"))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let n = e.file_name().to_string_lossy().strip_prefix('v')?.strip_suffix(".md")?.parse().ok()?;
                Some((n, e.path()))
            })
            .collect();
        out.sort_by_key(|(n, _)| *n);
        out
    }

    pub fn list(&self) -> Res<Value> {
        let mut out = Vec::new();
        for e in fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let file = e.path().join(FILE);
            if !name_ok(&name) || !file.is_file() {
                continue;
            }
            let text = fs::read_to_string(&file).unwrap_or_default();
            out.push(json!({ "name": name, "description": description_of(&text), "modified": modified_ms(&file), "version": self.versions(&e.path()).len() + 1 }));
        }
        out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        Ok(Value::Array(out))
    }

    pub fn read(&self, name: &str) -> Res<Value> {
        let dir = self.dir(name)?;
        let file = dir.join(FILE);
        let text = fs::read_to_string(&file).map_err(|_| "that skill is not there".to_owned())?;
        let versions: Vec<Value> = self.versions(&dir).into_iter().map(|(n, p)| json!({ "version": n, "modified": modified_ms(&p), "description": description_of(&fs::read_to_string(&p).unwrap_or_default()) })).collect();
        Ok(json!({ "name": name, "text": text, "modified": modified_ms(&file), "version": versions.len() + 1, "versions": versions }))
    }

    /// Writes the skill; the version it replaces is kept first. `base` is the `modified` read; refused if it changed.
    pub fn save(&self, name: &str, text: &str, base: Option<u64>) -> Res<Value> {
        if text.len() > MAX_SKILL {
            return Err("that skill is too long".into());
        }
        let dir = self.dir(name)?;
        let file = dir.join(FILE);
        if !file.is_file() {
            return Err("that skill is not there".into());
        }
        if base.is_some_and(|b| b != modified_ms(&file)) {
            return Err("changed elsewhere".into());
        }
        let was = fs::read_to_string(&file).unwrap_or_default();
        if was != text {
            self.keep_version(&dir, &was)?;
            fs::write(&file, text).map_err(|e| e.to_string())?;
        }
        Ok(json!({ "name": name, "modified": modified_ms(&file) }))
    }

    fn keep_version(&self, dir: &Path, text: &str) -> Res<()> {
        let versions = dir.join("versions");
        fs::create_dir_all(&versions).map_err(|e| e.to_string())?;
        let next = self.versions(dir).last().map_or(1, |(n, _)| n + 1);
        fs::write(versions.join(format!("v{next}.md")), text).map_err(|e| e.to_string())?;
        // The oldest go once there are many.
        let all = self.versions(dir);
        for (_, p) in all.iter().take(all.len().saturating_sub(MAX_VERSIONS)) {
            let _ = fs::remove_file(p);
        }
        Ok(())
    }

    pub fn create(&self, title: &str, description: &str) -> Res<Value> {
        let base = name_for(title);
        let mut name = base.clone();
        let mut n = 2;
        while self.root.join(&name).exists() {
            name = format!("{base}-{n}");
            n += 1;
        }
        let dir = self.dir(&name)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let description = description.trim().replace('\n', " ");
        let text = format!("---\nname: {name}\ndescription: {}\n---\n\n1. \n", if description.is_empty() { "When to use this skill, in one sentence." } else { &description });
        fs::write(dir.join(FILE), &text).map_err(|e| e.to_string())?;
        Ok(json!({ "name": name, "text": text, "modified": modified_ms(&dir.join(FILE)) }))
    }

    /// Adds a skill someone shared: a SKILL.md as text. Its name comes from its front matter (made safe, and made
    /// unique if one by that name is here); nothing in it runs until Mobius is asked for it.
    pub fn install(&self, text: &str) -> Res<Value> {
        if text.len() > MAX_SKILL {
            return Err("that skill is too long".into());
        }
        let text = text.replace("\r\n", "\n");
        let Some(rest) = text.strip_prefix("---\n") else { return Err("That is not a skill: a SKILL.md starts with its name and description between lines of ---.".into()) };
        let end = rest.find("\n---").ok_or("That is not a skill: its front matter does not end.")?;
        let front = &rest[..end];
        let named = front.lines().find_map(|l| l.trim().strip_prefix("name:")).map(|n| n.trim().trim_matches('"').to_owned()).filter(|n| !n.is_empty()).ok_or("That skill has no name.")?;
        if description_of(&text).is_empty() {
            return Err("That skill does not say when it runs (its description).".into());
        }
        let base = name_for(&named);
        let mut name = base.clone();
        let mut n = 2;
        while self.root.join(&name).exists() {
            name = format!("{base}-{n}");
            n += 1;
        }
        let front: Vec<String> = front.lines().map(|l| if l.trim_start().starts_with("name:") { format!("name: {name}") } else { l.to_owned() }).collect();
        let text = format!("---\n{}{}", front.join("\n"), &rest[end..]);
        let dir = self.dir(&name)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join(FILE), &text).map_err(|e| e.to_string())?;
        Ok(json!({ "name": name, "text": text, "modified": modified_ms(&dir.join(FILE)) }))
    }

    /// Puts an earlier version back as the skill (the one it replaces is kept too).
    pub fn restore(&self, name: &str, version: u32) -> Res<Value> {
        let dir = self.dir(name)?;
        let (_, path) = self.versions(&dir).into_iter().find(|(n, _)| *n == version).ok_or("that version is not there")?;
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        self.save(name, &text, None)
    }

    /// Deletes a skill; a checkpoint is taken first so it can be brought back.
    pub fn remove(&self, name: &str) -> Res<Value> {
        let dir = self.dir(name)?;
        if !dir.is_dir() {
            return Err("that skill is not there".into());
        }
        let checkpoint = self.checkpoints.snapshot(&self.workspace, &format!("before deleting skill {name}")).is_ok();
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(json!({ "removed": name, "checkpoint": checkpoint }))
    }

    /// The skills as a few lines for the agent's instructions, so it knows what it may follow.
    pub fn summary(&self) -> String {
        let Ok(Value::Array(list)) = self.list() else { return String::new() };
        if list.is_empty() {
            return String::new();
        }
        let lines: Vec<String> = list.iter().take(40).map(|s| format!("- {}: {}", s["name"].as_str().unwrap_or(""), s["description"].as_str().unwrap_or("").chars().take(200).collect::<String>())).collect();
        format!("Skills the person keeps (read one with skills.read and follow its steps when a request matches it; a message starting /<name> asks for that skill):\n{}", lines.join("\n"))
    }

    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        match tool {
            "skills.list" => self.list().map(|v| v.to_string()),
            "skills.read" => {
                let name = args.get("name").and_then(Value::as_str).ok_or("name must be text")?;
                self.read(name).map(|v| v["text"].as_str().unwrap_or("").to_owned())
            }
            _ => Err("unknown tool".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_lowercase_words_joined_by_hyphens() {
        assert_eq!(name_for("Compare stays!"), "compare-stays");
        assert_eq!(name_for("  "), "skill");
        assert!(name_ok("compare-stays"));
        for bad in ["", "Compare", "a--b", "-a", "a/b", "../x"] {
            assert!(!name_ok(bad), "{bad}");
        }
        assert_eq!(description_of("---\nname: x\ndescription: Compare hotels side by side\n---\n1. a"), "Compare hotels side by side");
        assert_eq!(description_of("no front matter"), "");
    }

    #[test]
    fn every_saved_change_keeps_the_version_before_it() {
        let d = tempfile::tempdir().unwrap();
        let s = Skills::new(d.path().join("work"), d.path().join("store"));
        let made = s.create("Compare stays", "When choosing where to stay").unwrap();
        assert_eq!(made["name"], "compare-stays");
        assert_eq!(s.create("Compare stays", "").unwrap()["name"], "compare-stays-2");
        let text = made["text"].as_str().unwrap();
        let saved = s.save("compare-stays", &text.replace("1. \n", "1. List the hotels\n"), made["modified"].as_u64()).unwrap();
        s.save("compare-stays", &text.replace("1. \n", "1. List the hotels\n2. Check cancellation\n"), saved["modified"].as_u64()).unwrap();
        let read = s.read("compare-stays").unwrap();
        assert_eq!(read["version"], 3);
        assert!(read["text"].as_str().unwrap().contains("Check cancellation"));
        s.restore("compare-stays", 2).unwrap();
        let back = s.read("compare-stays").unwrap();
        assert!(!back["text"].as_str().unwrap().contains("Check cancellation"));
        assert_eq!(back["version"], 4);
        assert!(s.summary().contains("- compare-stays: When choosing where to stay"));
        assert!(s.run("skills.read", &json!({ "name": "compare-stays" })).unwrap().contains("List the hotels"));
        assert!(s.read("../x").is_err());
        assert!(s.save("compare-stays", "x", Some(1)).is_err());
        s.remove("compare-stays-2").unwrap();
        let shared = "---\nname: Compare Stays\ndescription: Compare places\nallowed-tools: browser.read sheets.write\n---\n\n1. Look\n";
        let got = s.install(shared).unwrap();
        assert_eq!(got["name"], "compare-stays-2");
        assert!(got["text"].as_str().unwrap().starts_with("---\nname: compare-stays-2\ndescription: Compare places\nallowed-tools"));
        assert!(s.install("1. no front matter").is_err());
        assert!(s.install("---\nname: x\n---\n1. a").is_err(), "a skill must say when it runs");
        s.remove("compare-stays-2").unwrap();
        assert_eq!(s.list().unwrap().as_array().unwrap().len(), 1);
    }
}
