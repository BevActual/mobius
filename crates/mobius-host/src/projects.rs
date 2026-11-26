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
    /// App → `ask` (Ask each time), `propose` (Review changes) or `act` (Auto). An app not listed follows the person's own settings.
    #[serde(default)]
    pub rules: BTreeMap<String, String>,
    /// The project's conversations, newest last.
    #[serde(default)]
    pub threads: Vec<String>,
    /// Bots asked from a thread to do something on the side: each in a conversation of its own, reporting back.
    #[serde(default)]
    pub sides: Vec<Side>,
    /// Where the work stands, as Linear's project statuses: `backlog`, `planned`, `started`, `paused`, `completed` or
    /// `canceled`. None: not said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// The day it should be done by (YYYY-MM-DD).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// The Tasks list that holds its work; its open and done tasks give the project's progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<String>,
    /// Its updates, as Linear's project updates: how it is going (its health) and what to say, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub updates: Vec<Update>,
}

/// A project update: its health (`on_track`, `at_risk` or `off_track`), what was said, and where the project stood
/// then (status, target day, tasks done of all), so the next update can say what changed since.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub id: String,
    /// When it was posted, in ms since 1970.
    pub at: u64,
    pub health: String,
    pub text: String,
    /// When it was last changed, if it was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
}

/// An update being posted or changed: its health and words, and (when posted) the tasks done of all just then.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateText {
    pub health: String,
    pub text: String,
    #[serde(default)]
    pub done: Option<u32>,
    #[serde(default)]
    pub total: Option<u32>,
}

pub const HEALTHS: [&str; 3] = ["on_track", "at_risk", "off_track"];
const MAX_UPDATES: usize = 100;
const MAX_UPDATE_CHARS: usize = 8000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn checked(u: &UpdateText) -> Result<String, String> {
    if !HEALTHS.contains(&u.health.as_str()) {
        return Err("An update's health is On track, At risk or Off track.".into());
    }
    let text = u.text.trim();
    if text.is_empty() {
        return Err("An update needs a few words.".into());
    }
    if text.chars().count() > MAX_UPDATE_CHARS {
        return Err("That update is too long.".into());
    }
    Ok(text.to_owned())
}

/// A change to a project's status, target day or task list. An absent field stays; an empty one is cleared.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Details {
    pub status: Option<String>,
    pub target: Option<String>,
    pub list: Option<String>,
}

pub const STATUSES: [&str; 6] = ["backlog", "planned", "started", "paused", "completed", "canceled"];

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&s[5..7].parse::<u8>().unwrap_or(0)) && (1..=31).contains(&s[8..10].parse::<u8>().unwrap_or(0))
}

/// A bot's side thread: what it was asked from which thread, and what it reported back when it finished.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub conversation: String,
    /// The thread it was asked from, which its report goes back to.
    pub parent: String,
    pub bot: String,
    pub bot_name: String,
    pub ask: String,
    #[serde(default)]
    pub report: Option<String>,
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
        // Written whole and then put in place, so a read at the same moment never finds half a file (and no projects).
        let value = serde_json::to_value(all).map_err(|e| e.to_string())?;
        if mobius_store::file::write_json_checked(&self.file, &value) { Ok(()) } else { Err("The projects could not be saved.".into()) }
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
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
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
            let project = Project { id: format!("p{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()), name, rules: BTreeMap::new(), threads: Vec::new(), sides: Vec::new(), status: None, target: None, list: None, updates: Vec::new() };
            all.push(project.clone());
            Ok(project)
        })
    }

    /// A new name. Returns the project as it was, then as it is, so its folder and page can follow.
    pub fn rename(&self, id: &str, name: &str) -> Result<(Project, Project), String> {
        let name = clean_name(name).ok_or("A project's name is a few words, without / \\ : * ? \" < > |.")?;
        self.change(|all| {
            if all.iter().any(|p| p.id != id && p.name.eq_ignore_ascii_case(&name)) {
                return Err("There is a project with that name already.".into());
            }
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let before = p.clone();
            p.name = name;
            Ok((before, p.clone()))
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
            return Err("That is not a level: Ask each time, Review changes or Auto.".into());
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

    /// Its status, target day or task list; an empty value clears that one.
    pub fn set_details(&self, id: &str, d: &Details) -> Result<Project, String> {
        if let Some(s) = d.status.as_deref().filter(|s| !s.is_empty()) {
            if !STATUSES.contains(&s) {
                return Err("That is not a status.".into());
            }
        }
        if let Some(t) = d.target.as_deref().filter(|t| !t.is_empty()) {
            if !is_day(t) {
                return Err("A target is a day (YYYY-MM-DD).".into());
            }
        }
        let list = d.list.as_deref().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "));
        if list.as_deref().is_some_and(|l| l.chars().count() > 100 || l.contains(['/', '\\'])) {
            return Err("That is not a task list.".into());
        }
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let set = |v: Option<&str>| v.map(|v| (!v.is_empty()).then(|| v.to_owned()));
            if let Some(v) = set(d.status.as_deref()) { p.status = v; }
            if let Some(v) = set(d.target.as_deref()) { p.target = v; }
            if let Some(v) = set(list.as_deref()) { p.list = v; }
            Ok(p.clone())
        })
    }

    /// Post an update. Where the project stands now (its status and target day, with the tasks done given) is kept with it.
    pub fn add_update(&self, id: &str, u: &UpdateText) -> Result<Project, String> {
        let text = checked(u)?;
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let mut bytes = [0u8; 4];
            let _ = getrandom::fill(&mut bytes);
            let total = u.total.filter(|t| *t > 0);
            p.updates.push(Update {
                id: format!("u{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()),
                at: now_ms(), health: u.health.clone(), text, edited: None,
                status: p.status.clone(), target: p.target.clone(), done: total.and(u.done.map(|d| d.min(total.unwrap_or(0)))), total,
            });
            if p.updates.len() > MAX_UPDATES {
                let extra = p.updates.len() - MAX_UPDATES;
                p.updates.drain(..extra);
            }
            Ok(p.clone())
        })
    }

    /// Change an update's health or words; where the project stood when it was posted stays.
    pub fn edit_update(&self, id: &str, update: &str, u: &UpdateText) -> Result<Project, String> {
        let text = checked(u)?;
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let up = p.updates.iter_mut().find(|x| x.id == update).ok_or("That update is not there.")?;
            up.health.clone_from(&u.health);
            up.text = text;
            up.edited = Some(now_ms());
            Ok(p.clone())
        })
    }

    pub fn remove_update(&self, id: &str, update: &str) -> Result<Project, String> {
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let before = p.updates.len();
            p.updates.retain(|x| x.id != update);
            if p.updates.len() == before {
                return Err("That update is not there.".into());
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

    /// A thread leaves the project: the conversation is kept, and the project's rules no longer count in it. The side
    /// threads asked from it leave with it.
    pub fn remove_thread(&self, id: &str, conversation: &str) -> Result<Project, String> {
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            let before = p.threads.len();
            p.threads.retain(|t| t != conversation);
            if p.threads.len() == before {
                return Err("That conversation is not in this project.".into());
            }
            p.sides.retain(|s| s.parent != conversation);
            Ok(p.clone())
        })
    }

    /// The project a conversation belongs to, if any: one of its threads, or a bot's side thread in it.
    #[must_use]
    pub fn project_of(&self, conversation: &str) -> Option<String> {
        self.list().into_iter().find(|p| p.threads.iter().any(|t| t == conversation) || p.sides.iter().any(|s| s.conversation == conversation)).map(|p| p.id)
    }

    /// A bot asked, from one of the project's threads, to do something in a side thread of its own.
    pub fn add_side(&self, id: &str, side: Side) -> Result<Project, String> {
        let ask: String = side.ask.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(500).collect();
        if ask.is_empty() {
            return Err("What should the agent do?".into());
        }
        self.change(|all| {
            if all.iter().any(|p| p.threads.contains(&side.conversation) || p.sides.iter().any(|s| s.conversation == side.conversation)) {
                return Err("That conversation is in a project already.".into());
            }
            let p = all.iter_mut().find(|p| p.id == id).ok_or("That project is not there.")?;
            if !p.threads.contains(&side.parent) {
                return Err("A side thread is asked from one of the project's threads.".into());
            }
            if p.sides.len() >= MAX_THREADS {
                return Err("That project has too many side threads.".into());
            }
            p.sides.push(Side { ask, report: None, ..side });
            Ok(p.clone())
        })
    }

    /// A side thread finished: what it found goes back to the thread it was asked from.
    pub fn report(&self, conversation: &str, text: &str) -> Result<Project, String> {
        let text: String = text.trim().chars().take(4000).collect();
        self.change(|all| {
            let p = all.iter_mut().find(|p| p.sides.iter().any(|s| s.conversation == conversation)).ok_or("That is not a side thread.")?;
            if let Some(s) = p.sides.iter_mut().find(|s| s.conversation == conversation) {
                s.report = Some(if text.is_empty() { "Done.".to_owned() } else { text });
            }
            Ok(p.clone())
        })
    }
}

/// A project's levels as the core's rules. Act allows each app's reads and changes; Propose allows its reversible
/// changes in the workspace; Ask first asks the person every time. Nothing here allows paying, sending, deleting or
/// running commands, and the core asks about those (its floors) whatever a rule says.
#[must_use]
pub fn core_rules(project: &Project) -> Value {
    const REVERSIBLE: [&str; 7] = ["files.write", "tasks.write", "sheets.write", "db.write", "calendar.write", "contacts.write", "document.write"];
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
    fn a_project_keeps_its_status_target_and_task_list() {
        let dir = tempfile::tempdir().unwrap();
        let p = Projects::new(dir.path().join("projects.json"));
        let id = p.create("Offsite").unwrap().id;
        let d = |status: Option<&str>, target: Option<&str>, list: Option<&str>| Details { status: status.map(Into::into), target: target.map(Into::into), list: list.map(Into::into) };
        let got = p.set_details(&id, &d(Some("started"), Some("2026-12-04"), Some(" Offsite  plan "))).unwrap();
        assert_eq!((got.status.as_deref(), got.target.as_deref(), got.list.as_deref()), (Some("started"), Some("2026-12-04"), Some("Offsite plan")));
        let got = p.set_details(&id, &d(Some("paused"), None, None)).unwrap();
        assert_eq!((got.status.as_deref(), got.target.as_deref()), (Some("paused"), Some("2026-12-04")), "an absent field stays");
        let got = p.set_details(&id, &d(None, Some(""), Some(""))).unwrap();
        assert_eq!((got.target, got.list), (None, None), "an empty one is cleared");
        assert!(p.set_details(&id, &d(Some("done"), None, None)).is_err());
        assert!(p.set_details(&id, &d(None, Some("2026-13-01"), None)).is_err());
        assert!(p.set_details(&id, &d(None, Some("next week"), None)).is_err());
        assert!(p.set_details(&id, &d(None, None, Some("a/b"))).is_err());
        assert_eq!(p.list()[0].status.as_deref(), Some("paused"), "kept on disk");
    }

    #[test]
    fn a_project_keeps_its_updates_with_where_it_stood() {
        let dir = tempfile::tempdir().unwrap();
        let p = Projects::new(dir.path().join("projects.json"));
        let id = p.create("Offsite").unwrap().id;
        p.set_details(&id, &Details { status: Some("started".into()), target: Some("2026-12-04".into()), list: None }).unwrap();
        let u = |health: &str, text: &str| UpdateText { health: health.into(), text: text.into(), done: Some(3), total: Some(8) };
        let got = p.add_update(&id, &u("on_track", "  Venue booked. ")).unwrap();
        let first = &got.updates[0];
        assert_eq!((first.health.as_str(), first.text.as_str(), first.status.as_deref(), first.target.as_deref(), first.done, first.total), ("on_track", "Venue booked.", Some("started"), Some("2026-12-04"), Some(3), Some(8)));
        assert!(first.at > 0 && first.edited.is_none());
        let uid = first.id.clone();
        let got = p.edit_update(&id, &uid, &u("at_risk", "Venue booked; catering late.")).unwrap();
        assert_eq!((got.updates[0].health.as_str(), got.updates[0].text.as_str(), got.updates[0].done), ("at_risk", "Venue booked; catering late.", Some(3)));
        assert!(got.updates[0].edited.is_some());
        assert!(p.add_update(&id, &u("fine", "x")).is_err(), "only the three healths");
        assert!(p.add_update(&id, &u("on_track", "  ")).is_err(), "an update needs words");
        assert!(p.add_update("nope", &u("on_track", "x")).is_err());
        assert_eq!(p.list()[0].updates.len(), 1, "kept on disk");
        assert!(p.remove_update(&id, &uid).unwrap().updates.is_empty());
        assert!(p.remove_update(&id, &uid).is_err());
    }

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
        let (before, after) = p.rename(&kestrel.id, "Kestrel P3").unwrap();
        assert_eq!((before.name.as_str(), after.name.as_str()), ("Kestrel P2", "Kestrel P3"));
        assert_eq!(after.threads, before.threads, "its threads and rules stay");
        assert!(p.rename(&kestrel.id, "home").is_err(), "names stay unique");
        assert!(p.rename(&kestrel.id, "a/b").is_err());
        let side = Side { conversation: "c-abc123-1".into(), parent: "main-1".into(), bot: "abc123".into(), bot_name: "Research".into(), ask: "Find three venues".into(), report: None };
        assert!(p.add_side(&kestrel.id, Side { parent: "main-9".into(), ..side.clone() }).is_err(), "asked from one of the project's threads");
        p.add_side(&kestrel.id, side.clone()).unwrap();
        assert_eq!(p.project_of("c-abc123-1").as_deref(), Some(kestrel.id.as_str()), "the project's rules count in a side thread too");
        assert!(p.add_side(&kestrel.id, side).is_err(), "once");
        let reported = p.report("c-abc123-1", "Three venues: A, B and C.").unwrap();
        assert_eq!(reported.sides[0].report.as_deref(), Some("Three venues: A, B and C."));
        assert!(p.report("c-other", "x").is_err());
        assert!(p.remove_thread(&kestrel.id, "main-9").is_err(), "only one of its threads");
        let left = p.remove_thread(&kestrel.id, "main-1").unwrap();
        assert!(left.threads.is_empty() && left.sides.is_empty(), "its side threads leave with it");
        assert_eq!(p.project_of("main-1"), None, "the project's rules no longer count in it");
        assert_eq!(p.project_of("c-abc123-1"), None);
        p.add_thread(&other.id, "main-1").unwrap();
        p.remove(&other.id).unwrap();
        assert_eq!(p.list().len(), 1);
    }

    #[test]
    fn reading_the_projects_while_they_are_being_saved_never_finds_none() {
        let dir = tempfile::tempdir().unwrap();
        let p = std::sync::Arc::new(Projects::new(dir.path().join("projects.json")));
        let kestrel = p.create("Kestrel").unwrap();
        for i in 0..40 {
            p.add_thread(&kestrel.id, &format!("c-{i:04}")).unwrap();
        }
        let writer = {
            let p = p.clone();
            let id = kestrel.id.clone();
            std::thread::spawn(move || {
                for i in 0..200 {
                    p.set_rule(&id, "docs", if i % 2 == 0 { "act" } else { "ask" }).unwrap();
                }
            })
        };
        for _ in 0..400 {
            assert_eq!(p.list().len(), 1, "a read during a save sees the whole file");
            assert_eq!(p.project_of("c-0007").as_deref(), Some(kestrel.id.as_str()));
        }
        writer.join().unwrap();
    }
}

