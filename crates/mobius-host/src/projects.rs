//! Projects: a place for one piece of work. A project has a name, how much Mobius may do in each app there (Ask
//! first, Propose or Act), its conversations (threads), its memory as a wiki page and its files as a folder.
//! Its rules go to the core, which counts them for every call made in the project's conversations. Paying, sending,
//! deleting and running commands are asked about every time whatever a project says: no rule here allows them, and
//! the core never lets a rule cover a floor.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MAX_PROJECTS: usize = 50;
const MAX_THREADS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// App → `ask` (Ask first), `propose` or `act`. An app not listed follows the person's own settings.
    #[serde(default)]
    pub rules: BTreeMap<String, String>,
    /// The project's conversations, newest last.
    #[serde(default)]
    pub threads: Vec<String>,
}

pub struct Projects {
    file: PathBuf,
    lock: Mutex<()>,
}

fn clean_name(name: &str) -> Option<String> {
    let n = name.split_whitespace().collect::<Vec<_>>().join(" ");
    (!n.is_empty() && n.chars().count() <= 60 && !n.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])).then_some(n)
}

/// Words only: what the project's folder and wiki page are called.
#[must_use]
pub fn folder_of(name: &str) -> String {
    name.trim().trim_end_matches('.').to_owned()
}

impl Projects {
    #[must_use]
    pub fn new(file: PathBuf) -> Projects {
        Projects { file, lock: Mutex::new(()) }
    }

    fn load(&self) -> Vec<Project> {
        std::fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn store(&self, all: &[Project]) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.file, serde_json::to_string_pretty(all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    fn change<T>(&self, f: impl FnOnce(&mut Vec<Project>) -> Result<T, String>) -> Result<T, String> {
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut all = self.load();
        let out = f(&mut all)?;
        self.store(&all)?;
        Ok(out)
    }

    #[must_use]
    pub fn list(&self) -> Vec<Project> {
        self.load()
    }

    pub fn create(&self, name: &str) -> Result<Project, String> {
        let name = clean_name(name).ok_or("A project's name is a few words, without / \\ : * ? \" < > |.")?;
        self.change(|all| {
            if all.len() >= MAX_PROJECTS {
                return Err("There are too many projects.".into());
            }
            if all.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
                return Err("There is a project with that name already.".into());
            }
            let mut bytes = [0u8; 4];
            let _ = getrandom::fill(&mut bytes);
            let project = Project { id: format!("p{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()), name, rules: BTreeMap::new(), threads: Vec::new() };
            all.push(project.clone());
            Ok(project)
        })
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.change(|all| {
            let before = all.len();
            all.retain(|p| p.id != id);
            if all.len() == before { Err("That project is not there.".into()) } else { Ok(()) }
        })
    }

    /// How much Mobius may do in one app of the project: `ask`, `propose`, `act`, or `follow` (the person's settings).
    pub fn set_rule(&self, id: &str, app: &str, level: &str) -> Result<Project, String> {
        if !crate::access::APP_NAMES.contains(&app) {
            return Err("That is not an app.".into());
        }
        if !matches!(level, "ask" | "propose" | "act" | "follow") {
            return Err("That is not a level: Ask first, Propose or Act.".into());
        }
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            if level == "follow" {
                p.rules.remove(app);
            } else {
                p.rules.insert(app.to_owned(), level.to_owned());
            }
            Ok(p.clone())
        })
    }

    /// A conversation becomes one of the project's threads.
    pub fn add_thread(&self, id: &str, conversation: &str) -> Result<Project, String> {
        self.change(|all| {
            if all.iter().any(|p| p.id != id && p.threads.iter().any(|t| t == conversation)) {
                return Err("That conversation is in another project.".into());
            }
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            if !p.threads.iter().any(|t| t == conversation) {
                if p.threads.len() >= MAX_THREADS {
                    return Err("That project has too many threads.".into());
                }
                p.threads.push(conversation.to_owned());
            }
            Ok(p.clone())
        })
    }

    /// The project a conversation belongs to, if any.
    #[must_use]
    pub fn project_of(&self, conversation: &str) -> Option<String> {
        self.load().into_iter().find(|p| p.threads.iter().any(|t| t == conversation)).map(|p| p.id)
    }
}

/// A project's levels as the core's rules. Act allows each app's reads and changes; Propose allows its reversible
/// changes in the workspace; Ask first asks the person every time. Nothing here allows paying, sending, deleting or
/// running commands, and the core asks about those (its floors) whatever a rule says.
#[must_use]
pub fn core_rules(project: &Project) -> Value {
    const REVERSIBLE: [&str; 6] = ["files.write", "tasks.write", "sheets.write", "db.write", "calendar.write", "document.write"];
    const NEVER: [&str; 5] = ["process.exec", "fs.delete", "browser.interact", "mail.send", "payments.pay"];
    let mut out = Vec::new();
    for (app, level) in &project.rules {
        let (read, write) = crate::access::capabilities(app);
        let rule = |(capability, resource): &(&str, Option<&str>), effect: &str| match resource {
            Some(r) => json!({ "capability": capability, "resource": r, "effect": effect }),
            None => json!({ "capability": capability, "effect": effect }),
        };
        match level.as_str() {
            "ask" => out.extend(read.iter().chain(write).map(|c| rule(c, "ask"))),
            "propose" => out.extend(write.iter().filter(|(c, _)| REVERSIBLE.contains(c)).map(|c| rule(c, "allow"))),
            "act" => out.extend(read.iter().chain(write).filter(|(c, _)| !NEVER.contains(c)).map(|c| rule(c, "allow"))),
            _ => {}
        }
    }
    json!(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_keeps_its_name_rules_and_threads() {
        let dir = tempfile::tempdir().unwrap();
        let p = Projects::new(dir.path().join("projects.json"));
        let kestrel = p.create("Kestrel P2").unwrap();
        assert!(p.create("kestrel p2").is_err(), "names are unique");
        assert!(p.create("a/b").is_err());
        p.set_rule(&kestrel.id, "docs", "act").unwrap();
        p.set_rule(&kestrel.id, "tasks", "propose").unwrap();
        p.set_rule(&kestrel.id, "mail", "ask").unwrap();
        assert!(p.set_rule(&kestrel.id, "docs", "always").is_err());
        assert!(p.set_rule(&kestrel.id, "nope", "act").is_err());
        p.add_thread(&kestrel.id, "main-1").unwrap();
        assert_eq!(p.project_of("main-1").as_deref(), Some(kestrel.id.as_str()));
        assert_eq!(p.project_of("main-2"), None);
        let other = p.create("Home").unwrap();
        assert!(p.add_thread(&other.id, "main-1").is_err(), "a conversation is in one project");
        let rules = core_rules(&p.list()[0]);
        assert!(rules.as_array().unwrap().contains(&json!({ "capability": "files.write", "resource": "docs/*", "effect": "allow" })), "{rules}");
        assert!(rules.as_array().unwrap().contains(&json!({ "capability": "tasks.write", "effect": "allow" })));
        assert!(!rules.as_array().unwrap().contains(&json!({ "capability": "tasks.read", "effect": "allow" })), "Propose allows changes, not more");
        assert!(rules.as_array().unwrap().contains(&json!({ "capability": "mail.read", "effect": "ask" })));
        p.set_rule(&kestrel.id, "browser", "act").unwrap();
        let rules = core_rules(&p.list()[0]);
        assert!(rules.as_array().unwrap().contains(&json!({ "capability": "browser.navigate", "effect": "allow" })));
        assert!(!rules.to_string().contains("browser.interact"), "acting in a page always asks");
        p.set_rule(&kestrel.id, "docs", "follow").unwrap();
        assert!(!p.list()[0].rules.contains_key("docs"));
        p.remove(&other.id).unwrap();
        assert_eq!(p.list().len(), 1);
    }
}
