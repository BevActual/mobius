//! Tasks: each list is a Markdown file under `<workspace>/tasks`, and each task is a checkbox line in it
//! (`- [ ] Call the plumber (due 2026-11-12)`), so the lists are ordinary files the person can open anywhere.
//! Lines that are not tasks are kept as they are. Every change is checked against what the window or the agent last
//! saw, so a change made elsewhere is never overwritten, and a checkpoint is taken before the agent changes a list.
use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::checkpoints::Checkpoints;
use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "tasks";
pub const DEFAULT_LIST: &str = "Inbox";
const MAX_TEXT: usize = 500;
const MAX_LIST: usize = 512 * 1024;
const MAX_TASKS: usize = 2000;
const MAX_LISTS: usize = 200;

/// One task line, parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub text: String,
    pub done: bool,
    pub due: Option<String>,
}

/// `YYYY-MM-DD` with a month 1-12 and a day that month can have (29 February in any year: the person decides).
pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let (month, day): (u32, u32) = (s[5..7].parse().unwrap_or(0), s[8..10].parse().unwrap_or(0));
    let longest = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => 29,
        _ => return false,
    };
    (1..=longest).contains(&day)
}

/// A task's words: one line, trimmed, not empty, not too long.
fn clean_text(text: &str) -> Res<String> {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.is_empty() {
        return Err("a task needs some words".into());
    }
    if one.chars().count() > MAX_TEXT {
        return Err("that task is too long".into());
    }
    Ok(one)
}

pub fn parse_line(line: &str) -> Option<Task> {
    let rest = line.trim_start().strip_prefix("- [")?;
    let (mark, rest) = rest.split_at_checked(1)?;
    let done = match mark {
        " " => false,
        "x" | "X" => true,
        _ => return None,
    };
    let body = rest.strip_prefix("] ")?.trim();
    let (text, due) = match body.strip_suffix(')').and_then(|b| b.rsplit_once(" (due ")) {
        Some((text, date)) if is_date(date) => (text.trim(), Some(date.to_owned())),
        _ => (body, None),
    };
    (!text.is_empty()).then(|| Task { text: text.to_owned(), done, due })
}

pub fn format_line(task: &Task) -> String {
    let due = task.due.as_ref().map(|d| format!(" (due {d})")).unwrap_or_default();
    format!("- [{}] {}{due}", if task.done { "x" } else { " " }, task.text)
}

fn list_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

/// What may change about a task. `due: Some(None)` clears the date.
#[derive(Debug, Default)]
pub struct Change {
    pub text: Option<String>,
    pub done: Option<bool>,
    pub due: Option<Option<String>>,
}

pub struct Tasks {
    root: PathBuf,
    checkpoints: Checkpoints,
    workspace: PathBuf,
}

pub fn tool_descriptions() -> Vec<Value> {
    let list = json!({ "type": "string", "description": "The list's name, such as Inbox (the default list) or Groceries." });
    vec![
        json!({ "name": "tasks.list", "description": "Read the person's task lists in the Tasks app: every list with its tasks (done or not, and due dates), or one list.", "capability": "tasks.read",
            "input_schema": { "type": "object", "properties": { "list": { "type": "string", "description": "One list to read. Leave out to read them all." } } } }),
        json!({ "name": "tasks.add", "description": "Add a task to one of the person's lists in the Tasks app. Creates the list if it is not there yet.", "capability": "tasks.write", "resource_arg": "list",
            "input_schema": { "type": "object", "properties": { "list": list, "text": { "type": "string", "description": "What to do, in a few words." }, "due": { "type": "string", "description": "A due date as YYYY-MM-DD, if there is one." } }, "required": ["list", "text"] } }),
        json!({ "name": "tasks.update", "description": "Change a task in the Tasks app: tick it off, untick it, reword it, or set or clear its due date. The task is found by its exact words and must be in the list only once.", "capability": "tasks.write", "resource_arg": "list",
            "input_schema": { "type": "object", "properties": { "list": list, "task": { "type": "string", "description": "The task's exact words now." }, "done": { "type": "boolean" }, "text": { "type": "string", "description": "New words for it." }, "due": { "type": "string", "description": "A new due date as YYYY-MM-DD, or an empty text to clear it." } }, "required": ["list", "task"] } }),
    ]
}

pub fn is_task_tool(name: &str) -> bool {
    tool_descriptions().iter().any(|d| d["name"] == name)
}

impl Tasks {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Tasks {
        let workspace = workspace.into();
        Tasks { root: workspace.join(FOLDER), checkpoints: Checkpoints::new(checkpoint_store), workspace }
    }

    fn file(&self, list: &str) -> Res<PathBuf> {
        if !list_ok(list) {
            return Err("that is not a list".into());
        }
        let file = self.root.join(format!("{list}.md"));
        if file.exists() {
            let real = fs::canonicalize(&file).map_err(|e| e.to_string())?;
            let root = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
            if real.parent() != Some(root.as_path()) {
                return Err("that is not a list".into());
            }
        }
        Ok(file)
    }

    fn load(&self, list: &str) -> Res<(PathBuf, String)> {
        let file = self.file(list)?;
        let content = fs::read_to_string(&file).map_err(|_| "that list is not there".to_owned())?;
        Ok((file, content))
    }

    fn store(file: &PathBuf, content: &str) -> Res<()> {
        if content.len() > MAX_LIST {
            return Err("that list is too long".into());
        }
        let temp = file.with_extension("md.mobius-tmp");
        fs::write(&temp, content).map_err(|e| e.to_string())?;
        fs::rename(&temp, file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })
    }

    /// Every list by name, each with how many tasks are open and done. Inbox is always there.
    pub fn lists(&self) -> Res<Value> {
        fs::create_dir_all(&self.root).map_err(|e| format!("the tasks folder cannot be used: {e}"))?;
        let inbox = self.root.join(format!("{DEFAULT_LIST}.md"));
        if !inbox.exists() {
            Self::store(&inbox, &format!("# {DEFAULT_LIST}\n\n"))?;
        }
        let mut names: Vec<String> = fs::read_dir(&self.root)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".md").map(str::to_owned))
            .filter(|n| list_ok(n))
            .take(MAX_LISTS)
            .collect();
        names.sort_by_key(|n| (n != DEFAULT_LIST, n.to_lowercase()));
        let mut out = Vec::new();
        for name in names {
            let tasks = self.read(&name)?;
            let all = tasks["tasks"].as_array().cloned().unwrap_or_default();
            let done = all.iter().filter(|t| t["done"] == true).count();
            out.push(json!({ "name": name, "open": all.len() - done, "done": done }));
        }
        Ok(Value::Array(out))
    }

    /// One list: its tasks in file order, each with the line it is on, and the whole file's text as `version` so a
    /// change can say what it expected.
    pub fn read(&self, list: &str) -> Res<Value> {
        let (_, content) = self.load(list)?;
        let tasks: Vec<Value> = content
            .lines()
            .enumerate()
            .filter_map(|(line, l)| parse_line(l).map(|t| json!({ "line": line, "text": t.text, "done": t.done, "due": t.due })))
            .take(MAX_TASKS)
            .collect();
        Ok(json!({ "list": list, "tasks": tasks, "version": version_of(&content) }))
    }

    pub fn create_list(&self, name: &str) -> Res<Value> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let base = file_name_for(name);
        let mut chosen = base.clone();
        let mut n = 2;
        while self.root.join(format!("{chosen}.md")).exists() {
            chosen = format!("{base} {n}");
            n += 1;
        }
        Self::store(&self.file(&chosen)?, &format!("# {chosen}\n\n"))?;
        Ok(json!({ "name": chosen }))
    }

    /// Add a task at the end of a list, creating the list first if needed.
    pub fn add(&self, list: &str, text: &str, due: Option<&str>) -> Res<Value> {
        let text = clean_text(text)?;
        if let Some(d) = due
            && !is_date(d)
        {
            return Err("a due date is written YYYY-MM-DD".into());
        }
        let file = self.file(list)?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut content = fs::read_to_string(&file).unwrap_or_else(|_| format!("# {list}\n\n"));
        if content.lines().filter(|l| parse_line(l).is_some()).count() >= MAX_TASKS {
            return Err("that list is full".into());
        }
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format_line(&Task { text, done: false, due: due.map(str::to_owned) }));
        content.push('\n');
        Self::store(&file, &content)?;
        self.read(list)
    }

    /// Change the task on `line`, which must still say `expect` (else "changed elsewhere").
    pub fn update(&self, list: &str, line: usize, expect: &str, change: Change) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        let mut task = lines.get(line).and_then(|l| parse_line(l)).filter(|t| t.text == expect).ok_or("changed elsewhere")?;
        if let Some(text) = change.text {
            task.text = clean_text(&text)?;
        }
        if let Some(done) = change.done {
            task.done = done;
        }
        if let Some(due) = change.due {
            if let Some(d) = &due
                && !is_date(d)
            {
                return Err("a due date is written YYYY-MM-DD".into());
            }
            task.due = due;
        }
        let indent: String = lines[line].chars().take_while(|c| c.is_whitespace()).collect();
        lines[line] = format!("{indent}{}", format_line(&task));
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(list)
    }

    /// Delete the task on `line`, which must still say `expect`.
    pub fn remove(&self, list: &str, line: usize, expect: &str) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<&str> = content.lines().collect();
        lines.get(line).and_then(|l| parse_line(l)).filter(|t| t.text == expect).ok_or("changed elsewhere")?;
        lines.remove(line);
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(list)
    }

    /// Delete every ticked-off task in a list.
    pub fn clear_done(&self, list: &str) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let kept: Vec<&str> = content.lines().filter(|l| !parse_line(l).is_some_and(|t| t.done)).collect();
        Self::store(&file, &(kept.join("\n") + "\n"))?;
        self.read(list)
    }

    /// A tool the agent called. A checkpoint is taken before any change, so the person can undo it.
    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        let text = |k: &str| args.get(k).and_then(Value::as_str);
        let list = text("list").filter(|l| !l.trim().is_empty()).unwrap_or(DEFAULT_LIST).trim();
        let result = match tool {
            "tasks.list" => match text("list") {
                Some(one) if !one.trim().is_empty() => self.read(one.trim())?,
                _ => {
                    let mut all = Vec::new();
                    for entry in self.lists()?.as_array().cloned().unwrap_or_default() {
                        let mut one = self.read(entry["name"].as_str().unwrap_or(DEFAULT_LIST))?;
                        if let Some(o) = one.as_object_mut() {
                            o.remove("version");
                        }
                        all.push(one);
                    }
                    Value::Array(all)
                }
            },
            "tasks.add" => {
                let words = text("text").ok_or("text must be text")?;
                self.checkpoint(&format!("before the agent added a task to {list}"));
                self.add(list, words, text("due").filter(|d| !d.is_empty()))?
            }
            "tasks.update" => {
                let wanted = text("task").ok_or("task must be text")?;
                let current = self.read(list)?;
                let matches: Vec<&Value> = current["tasks"].as_array().into_iter().flatten().filter(|t| t["text"] == wanted.trim()).collect();
                let found = match matches.as_slice() {
                    [one] => *one,
                    [] => return Err(format!("no task in {list} says exactly that")),
                    _ => return Err(format!("more than one task in {list} says that; reword it to tell them apart")),
                };
                let change = Change {
                    text: text("text").map(str::to_owned),
                    done: args.get("done").and_then(Value::as_bool),
                    due: text("due").map(|d| (!d.is_empty()).then(|| d.to_owned())),
                };
                self.checkpoint(&format!("before the agent changed a task in {list}"));
                let line = usize::try_from(found["line"].as_u64().unwrap_or(0)).unwrap_or(0);
                self.update(list, line, wanted.trim(), change)?
            }
            _ => return Err("unknown tool".into()),
        };
        let mut shown = result;
        if let Some(o) = shown.as_object_mut() {
            o.remove("version");
        }
        Ok(shown.to_string())
    }

    fn checkpoint(&self, why: &str) {
        let _ = self.checkpoints.snapshot(&self.workspace, why);
    }
}

/// A short fingerprint of a list's text (FNV-1a), enough to tell the window its copy is stale.
fn version_of(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Tasks) {
        let dir = TempDir::new().unwrap();
        let tasks = Tasks::new(dir.path().join("work"), dir.path().join("store"));
        (dir, tasks)
    }
    fn texts(v: &Value) -> Vec<String> {
        v["tasks"].as_array().unwrap().iter().map(|t| t["text"].as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn task_lines_read_and_write_the_same_way() {
        let t = parse_line("- [ ] Call the plumber (due 2026-11-12)").unwrap();
        assert_eq!(t, Task { text: "Call the plumber".into(), done: false, due: Some("2026-11-12".into()) });
        assert_eq!(format_line(&t), "- [ ] Call the plumber (due 2026-11-12)");
        assert!(parse_line("  - [X] Done thing").unwrap().done);
        // Not dates, so they stay part of the words.
        assert_eq!(parse_line("- [ ] Read (due someday)").unwrap().text, "Read (due someday)");
        assert_eq!(parse_line("- [ ] Pay (due 2026-02-30)").unwrap().due, None);
        for not_a_task in ["- [] x", "- [y] x", "* [ ] x", "- [ ]", "- [ ]    ", "plain text", "- [ ]x"] {
            assert_eq!(parse_line(not_a_task), None, "{not_a_task}");
        }
    }

    #[test]
    fn only_real_dates_are_dates() {
        for good in ["2026-01-31", "2026-02-29", "2026-04-30", "2026-12-01"] {
            assert!(is_date(good), "{good}");
        }
        for bad in ["2026-13-01", "2026-00-10", "2026-04-31", "2026-02-30", "2026-1-01", "26-01-01", "2026/01/01", "2026-01-0a", ""] {
            assert!(!is_date(bad), "{bad}");
        }
    }

    #[test]
    fn there_is_always_an_inbox_and_lists_are_real_files() {
        let (dir, tasks) = setup();
        assert_eq!(tasks.lists().unwrap(), json!([{ "name": "Inbox", "open": 0, "done": 0 }]));
        assert_eq!(tasks.create_list("Groceries").unwrap()["name"], "Groceries");
        assert_eq!(tasks.create_list("Groceries").unwrap()["name"], "Groceries 2");
        assert_eq!(tasks.create_list("a/b:c").unwrap()["name"], "a b c");
        tasks.add("Groceries", "Milk", None).unwrap();
        let names: Vec<Value> = tasks.lists().unwrap().as_array().unwrap().iter().map(|l| l["name"].clone()).collect();
        assert_eq!(names, vec![json!("Inbox"), json!("a b c"), json!("Groceries"), json!("Groceries 2")]);
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/Groceries.md")).unwrap(), "# Groceries\n\n- [ ] Milk\n");
    }

    #[test]
    fn adding_ticking_and_rewording_keep_the_rest_of_the_file() {
        let (dir, tasks) = setup();
        let file = dir.path().join("work/tasks/Home.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "# Home\nSome thoughts.\n- [ ] Paint the door\n").unwrap();
        let after = tasks.add("Home", "  Fix   the tap ", Some("2026-11-20")).unwrap();
        assert_eq!(texts(&after), ["Paint the door", "Fix the tap"]);
        let line = usize::try_from(after["tasks"][0]["line"].as_u64().unwrap()).unwrap();
        tasks.update("Home", line, "Paint the door", Change { done: Some(true), ..Change::default() }).unwrap();
        tasks.update("Home", 3, "Fix the tap", Change { text: Some("Fix the kitchen tap".into()), due: Some(None), ..Change::default() }).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\nSome thoughts.\n- [x] Paint the door\n- [ ] Fix the kitchen tap\n");
        let lists = tasks.lists().unwrap();
        assert_eq!(lists[1], json!({ "name": "Home", "open": 1, "done": 1 }));
        tasks.clear_done("Home").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\nSome thoughts.\n- [ ] Fix the kitchen tap\n");
        tasks.remove("Home", 2, "Fix the kitchen tap").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\nSome thoughts.\n");
    }

    #[test]
    fn a_change_to_a_line_that_moved_or_changed_is_refused() {
        let (_dir, tasks) = setup();
        tasks.add("Inbox", "One", None).unwrap();
        tasks.add("Inbox", "Two", None).unwrap();
        assert_eq!(tasks.update("Inbox", 2, "Two", Change { done: Some(true), ..Change::default() }).unwrap_err(), "changed elsewhere");
        assert_eq!(tasks.remove("Inbox", 0, "One").unwrap_err(), "changed elsewhere");
        assert_eq!(tasks.update("Inbox", 99, "One", Change::default()).unwrap_err(), "changed elsewhere");
        assert_eq!(texts(&tasks.read("Inbox").unwrap()), ["One", "Two"]);
    }

    #[test]
    fn bad_words_dates_and_names_are_refused() {
        let (_dir, tasks) = setup();
        assert!(tasks.add("Inbox", "   ", None).is_err());
        assert!(tasks.add("Inbox", &"x".repeat(MAX_TEXT + 1), None).is_err());
        assert!(tasks.add("Inbox", "Pay", Some("tomorrow")).is_err());
        for bad in ["../notes/x", "a/b", "", ".hidden", "CON"] {
            assert!(tasks.add(bad, "x", None).is_err(), "{bad}");
            assert!(tasks.read(bad).is_err(), "{bad}");
        }
        let first = tasks.add("Inbox", "Pay", None).unwrap();
        let line = usize::try_from(first["tasks"][0]["line"].as_u64().unwrap()).unwrap();
        assert!(tasks.update("Inbox", line, "Pay", Change { due: Some(Some("2026-02-31".into())), ..Change::default() }).is_err());
        assert!(tasks.update("Inbox", line, "Pay", Change { text: Some(" ".into()), ..Change::default() }).is_err());
    }

    #[test]
    fn a_new_line_in_the_words_cannot_add_a_second_task() {
        let (_dir, tasks) = setup();
        tasks.add("Inbox", "Buy milk\n- [ ] Transfer money", None).unwrap();
        assert_eq!(texts(&tasks.read("Inbox").unwrap()), ["Buy milk - [ ] Transfer money"]);
    }

    #[test]
    fn the_agent_adds_and_ticks_by_words_and_a_checkpoint_comes_first() {
        let (dir, tasks) = setup();
        let added: Value = serde_json::from_str(&tasks.run("tasks.add", &json!({ "text": "Book dentist", "due": "2026-11-30" })).unwrap()).unwrap();
        assert_eq!(added["list"], "Inbox");
        assert!(added.get("version").is_none());
        tasks.run("tasks.add", &json!({ "list": "Work", "text": "Send report" })).unwrap();
        tasks.run("tasks.update", &json!({ "task": "Book dentist", "done": true, "due": "" })).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/Inbox.md")).unwrap(), "# Inbox\n\n- [x] Book dentist\n");
        let all: Value = serde_json::from_str(&tasks.run("tasks.list", &json!({})).unwrap()).unwrap();
        assert_eq!(all.as_array().unwrap().iter().map(|l| l["list"].clone()).collect::<Vec<_>>(), [json!("Inbox"), json!("Work")]);
        assert!(!Checkpoints::new(dir.path().join("store")).list(&dir.path().join("work"), 10).unwrap().is_empty());
    }

    #[test]
    fn a_tool_approved_per_list_always_asks_the_model_for_the_list() {
        // The core refuses a call whose resource argument is missing, so the schema must make the model send it.
        for tool in tool_descriptions() {
            if let Some(arg) = tool.get("resource_arg").and_then(Value::as_str) {
                let required = tool["input_schema"]["required"].as_array().cloned().unwrap_or_default();
                assert!(required.contains(&json!(arg)), "{} must require {arg}", tool["name"]);
            }
        }
    }

    #[test]
    fn the_agent_cannot_guess_which_of_two_tasks_it_means() {
        let (_dir, tasks) = setup();
        tasks.add("Inbox", "Call", None).unwrap();
        tasks.add("Inbox", "Call", None).unwrap();
        assert!(tasks.run("tasks.update", &json!({ "task": "Call", "done": true })).unwrap_err().contains("more than one"));
        assert!(tasks.run("tasks.update", &json!({ "task": "Cal", "done": true })).unwrap_err().contains("no task"));
        assert!(tasks.run("tasks.delete", &json!({})).is_err());
        assert!(is_task_tool("tasks.add") && !is_task_tool("tasks.delete"));
    }
}
