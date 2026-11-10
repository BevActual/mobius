//! Tasks: each list is a Markdown file under `<workspace>/tasks`, and each task is a checkbox line in it
//! (`- [ ] Call the plumber (due 2026-11-12)`), so the lists are ordinary files the person can open anywhere.
//! A task can carry a flag (`(flagged)` after it), notes (lines indented under it), and subtasks (checkbox lines
//! indented under it). Lines that are not tasks are kept as they are. Every change is checked against what the window or the agent last
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
const MAX_NOTES: usize = 4000;
const MAX_BLOCK_LINES: usize = 400;

/// One task line, parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub text: String,
    pub done: bool,
    pub due: Option<String>,
    pub flagged: bool,
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
    let mut body = rest.strip_prefix("] ")?.trim();
    // What follows the words, in either order: a due date and a flag.
    let (mut due, mut flagged) = (None, false);
    loop {
        if !flagged && let Some(b) = body.strip_suffix("(flagged)").filter(|b| b.ends_with(' ')) {
            body = b.trim_end();
            flagged = true;
            continue;
        }
        if due.is_none() && let Some((b, d)) = body.strip_suffix(')').and_then(|b| b.rsplit_once(" (due ")).filter(|(_, d)| is_date(d)) {
            body = b.trim_end();
            due = Some(d.to_owned());
            continue;
        }
        break;
    }
    (!body.is_empty()).then(|| Task { text: body.to_owned(), done, due, flagged })
}

pub fn format_line(task: &Task) -> String {
    let due = task.due.as_ref().map(|d| format!(" (due {d})")).unwrap_or_default();
    let flag = if task.flagged { " (flagged)" } else { "" };
    format!("- [{}] {}{due}{flag}", if task.done { "x" } else { " " }, task.text)
}

/// How far a line is indented (a tab counts as four spaces).
fn indent(line: &str) -> usize {
    line.chars().take_while(|c| c.is_whitespace()).map(|c| if c == '\t' { 4 } else { 1 }).sum()
}

/// Where a task's block ends: the task, then every line indented under it (notes, subtasks), up to a blank line.
fn block_end(lines: &[String], at: usize) -> usize {
    let own = indent(&lines[at]);
    let mut end = at + 1;
    while end < lines.len() && !lines[end].trim().is_empty() && indent(&lines[end]) > own {
        end += 1;
    }
    end
}

/// The lines of a task's notes, which belong to it and not to one of its subtasks.
fn note_lines(lines: &[String], at: usize) -> Vec<usize> {
    let mut sub: Option<usize> = None;
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate().take(block_end(lines, at)).skip(at + 1) {
        if parse_line(line).is_some() {
            sub = Some(indent(line));
        } else if sub.is_none_or(|s| indent(line) <= s) {
            out.push(i);
        }
    }
    out
}

/// A note line as written in the file: a line that would read as a task or a heading is escaped.
fn note_out(line: &str) -> String {
    let t = line.trim_end();
    if t.trim_start().starts_with("- [") || t.trim_start().starts_with('#') { format!("\\{}", t.trim_start()) } else { t.trim_start().to_owned() }
}
fn note_in(line: &str) -> &str {
    let t = line.trim();
    t.strip_prefix('\\').filter(|r| r.starts_with("- [") || r.starts_with('#')).unwrap_or(t)
}

/// Notes as the person wrote them: blank lines dropped (a blank line would end the task in Markdown), not too long.
fn clean_notes(notes: &str) -> Res<Vec<String>> {
    if notes.chars().count() > MAX_NOTES {
        return Err("those notes are too long".into());
    }
    Ok(notes.lines().map(note_out).filter(|l| !l.is_empty()).collect())
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
    pub flagged: Option<bool>,
    pub notes: Option<String>,
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
            "input_schema": { "type": "object", "properties": { "list": list, "text": { "type": "string", "description": "What to do, in a few words." }, "due": { "type": "string", "description": "A due date as YYYY-MM-DD, if there is one." }, "flagged": { "type": "boolean", "description": "Flag it as important." } }, "required": ["list", "text"] } }),
        json!({ "name": "tasks.update", "description": "Change a task in the Tasks app: tick it off, untick it, reword it, set or clear its due date, flag or unflag it, or replace its notes. The task is found by its exact words and must be in the list only once.", "capability": "tasks.write", "resource_arg": "list",
            "input_schema": { "type": "object", "properties": { "list": list, "task": { "type": "string", "description": "The task's exact words now." }, "done": { "type": "boolean" }, "text": { "type": "string", "description": "New words for it." }, "due": { "type": "string", "description": "A new due date as YYYY-MM-DD, or an empty text to clear it." }, "flagged": { "type": "boolean" }, "notes": { "type": "string", "description": "The task's notes, replacing what is there; an empty text clears them." } }, "required": ["list", "task"] } }),
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

    /// One list: its tasks in file order, each with the line it is on, its notes, and the task it is under (`parent`,
    /// a line) if it is a subtask; and the whole file's text as `version` so a change can say what it expected.
    pub fn read(&self, list: &str) -> Res<Value> {
        let (_, content) = self.load(list)?;
        Ok(json!({ "list": list, "tasks": tasks_of(&content), "version": version_of(&content) }))
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

    /// Give a list a new name: its file is renamed, and its heading too when the heading was its name.
    pub fn rename_list(&self, list: &str, to: &str) -> Res<Value> {
        if list == DEFAULT_LIST {
            return Err(format!("{DEFAULT_LIST} keeps its name"));
        }
        let (file, content) = self.load(list)?;
        let name = file_name_for(to.trim());
        if !list_ok(&name) || name == DEFAULT_LIST {
            return Err("that name cannot be used".into());
        }
        if name == list {
            return Ok(json!({ "name": name }));
        }
        let target = self.file(&name)?;
        // A name that differs only in case is the same file on Windows and macOS.
        if target.exists() && !name.eq_ignore_ascii_case(list) {
            return Err(format!("there is already a list called {name}"));
        }
        let heading = format!("# {list}");
        let mut lines: Vec<&str> = content.lines().collect();
        let renamed = format!("# {name}");
        if lines.first() == Some(&heading.as_str()) {
            lines[0] = &renamed;
        }
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        fs::rename(&file, &target).map_err(|e| e.to_string())?;
        Ok(json!({ "name": name }))
    }

    /// Delete a whole list. Inbox stays. Its text comes back as `text`, so `restore_list` can put it back (Undo).
    pub fn delete_list(&self, list: &str) -> Res<Value> {
        if list == DEFAULT_LIST {
            return Err(format!("{DEFAULT_LIST} cannot be deleted"));
        }
        let (file, content) = self.load(list)?;
        fs::remove_file(&file).map_err(|e| e.to_string())?;
        Ok(json!({ "name": list, "text": content }))
    }

    /// Put back a deleted list with the text it had. A list of that name that is there again is never replaced.
    pub fn restore_list(&self, list: &str, text: &str) -> Res<Value> {
        if !list_ok(list) || text.len() > MAX_LIST {
            return Err("that list cannot be put back".into());
        }
        let file = self.file(list)?;
        if file.exists() {
            return Err(format!("there is already a list called {list}"));
        }
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        Self::store(&file, text)?;
        Ok(json!({ "name": list }))
    }

    /// Add a task at the end of a list (creating the list first if needed), or under a task as a subtask.
    pub fn add(&self, list: &str, text: &str, due: Option<&str>) -> Res<Value> {
        self.add_with(list, text, due, false, None)
    }

    /// `under`: the line of the task it goes under and that task's words.
    pub fn add_with(&self, list: &str, text: &str, due: Option<&str>, flagged: bool, under: Option<(usize, &str)>) -> Res<Value> {
        let text = clean_text(text)?;
        if let Some(d) = due
            && !is_date(d)
        {
            return Err("a due date is written YYYY-MM-DD".into());
        }
        let file = self.file(list)?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let content = fs::read_to_string(&file).unwrap_or_else(|_| format!("# {list}\n\n"));
        if content.lines().filter(|l| parse_line(l).is_some()).count() >= MAX_TASKS {
            return Err("that list is full".into());
        }
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        let task = format_line(&Task { text, done: false, due: due.map(str::to_owned), flagged });
        match under {
            Some((at, expect)) => {
                found(&lines, at, expect)?;
                let pad = " ".repeat(indent(&lines[at]) + 2);
                lines.insert(block_end(&lines, at), format!("{pad}{task}"));
            }
            None => lines.push(task),
        }
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(list)
    }

    /// Change the task on `line`, which must still say `expect` (else "changed elsewhere").
    pub fn update(&self, list: &str, line: usize, expect: &str, change: Change) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        let mut task = found(&lines, line, expect)?;
        if let Some(text) = change.text {
            task.text = clean_text(&text)?;
        }
        if let Some(done) = change.done {
            task.done = done;
        }
        if let Some(flagged) = change.flagged {
            task.flagged = flagged;
        }
        if let Some(due) = change.due {
            if let Some(d) = &due
                && !is_date(d)
            {
                return Err("a due date is written YYYY-MM-DD".into());
            }
            task.due = due;
        }
        let own: String = lines[line].chars().take_while(|c| c.is_whitespace()).collect();
        lines[line] = format!("{own}{}", format_line(&task));
        if let Some(notes) = change.notes {
            let written = clean_notes(&notes)?;
            for i in note_lines(&lines, line).into_iter().rev() {
                lines.remove(i);
            }
            let pad = " ".repeat(indent(&lines[line]) + 2);
            for (n, note) in written.into_iter().enumerate() {
                lines.insert(line + 1 + n, format!("{pad}{note}"));
            }
        }
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(list)
    }

    /// Delete the task on `line` (which must still say `expect`) with its notes and subtasks. What was taken out comes
    /// back as `removed` (`line` and `text`), so it can be put back with `restore`.
    pub fn remove(&self, list: &str, line: usize, expect: &str) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        found(&lines, line, expect)?;
        let taken: Vec<String> = lines.drain(line..block_end(&lines, line)).collect();
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        let mut out = self.read(list)?;
        out["removed"] = json!({ "line": line, "text": taken.join("\n") });
        Ok(out)
    }

    /// Put back what `remove` took out, at the line it was on (or the end, if the list is shorter now).
    pub fn restore(&self, list: &str, line: usize, text: &str) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let block: Vec<&str> = text.lines().collect();
        let ok = !block.is_empty()
            && block.len() <= MAX_BLOCK_LINES
            && block.first().is_some_and(|l| parse_line(l).is_some())
            && block.iter().all(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'));
        if !ok {
            return Err("that cannot be put back".into());
        }
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        let at = line.min(lines.len());
        for (n, l) in block.iter().enumerate() {
            lines.insert(at + n, (*l).to_owned());
        }
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(list)
    }

    /// Move the task on `line` (with its notes and subtasks) to just before another task, `before` (its line and
    /// words), in this list or `to`, or to the end of `to`. A moved subtask becomes a task of its own.
    pub fn move_task(&self, list: &str, line: usize, expect: &str, to: &str, before: Option<(usize, &str)>) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        found(&lines, line, expect)?;
        let end = block_end(&lines, line);
        let own = indent(&lines[line]);
        let target_is_top = |ls: &[String], at: usize, words: &str| -> Res<()> {
            found(ls, at, words)?;
            if tasks_of(&ls.join("\n")).iter().any(|t| t["line"] == at && !t["parent"].is_null()) {
                return Err("a task can only go before a task that is not under another".into());
            }
            Ok(())
        };
        if to == list {
            if let Some((at, words)) = before {
                target_is_top(&lines, at, words)?;
                if (line..end).contains(&at) {
                    return Err("a task cannot go inside itself".into());
                }
            }
        }
        let block: Vec<String> = lines.drain(line..end).map(|l| dedent(&l, own)).collect();
        if to == list {
            let at = match before {
                Some((at, _)) if at > line => at - (end - line),
                Some((at, _)) => at,
                None => lines.len(),
            };
            lines.splice(at..at, block);
            Self::store(&file, &(lines.join("\n") + "\n"))?;
            return self.read(list);
        }
        let (other, theirs) = self.load(to)?;
        let mut there: Vec<String> = theirs.lines().map(str::to_owned).collect();
        let at = match before {
            Some((at, words)) => {
                target_is_top(&there, at, words)?;
                at
            }
            None => there.len(),
        };
        there.splice(at..at, block);
        Self::store(&other, &(there.join("\n") + "\n"))?;
        Self::store(&file, &(lines.join("\n") + "\n"))?;
        self.read(to)
    }

    /// Delete every ticked-off task in a list, with its notes and subtasks.
    pub fn clear_done(&self, list: &str) -> Res<Value> {
        let (file, content) = self.load(list)?;
        let mut lines: Vec<String> = content.lines().map(str::to_owned).collect();
        let mut at = 0;
        while at < lines.len() {
            if parse_line(&lines[at]).is_some_and(|t| t.done) {
                let end = block_end(&lines, at);
                lines.drain(at..end);
            } else {
                at += 1;
            }
        }
        Self::store(&file, &(lines.join("\n") + "\n"))?;
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
                self.add_with(list, words, text("due").filter(|d| !d.is_empty()), args.get("flagged").and_then(Value::as_bool).unwrap_or(false), None)?
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
                    flagged: args.get("flagged").and_then(Value::as_bool),
                    notes: text("notes").map(str::to_owned),
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

/// The task on `at`, if it still says `expect`.
fn found(lines: &[String], at: usize, expect: &str) -> Res<Task> {
    lines.get(at).and_then(|l| parse_line(l)).filter(|t| t.text == expect).ok_or_else(|| "changed elsewhere".to_owned())
}

/// A line with `by` columns of indent taken off (as much as it has).
fn dedent(line: &str, by: usize) -> String {
    let mut left = by;
    let mut rest = line;
    while left > 0 {
        match rest.chars().next() {
            Some('\t') => { left = left.saturating_sub(4); rest = &rest[1..]; }
            Some(c) if c.is_whitespace() => { left -= 1; rest = &rest[c.len_utf8()..]; }
            _ => break,
        }
    }
    rest.to_owned()
}

/// Every task in a list's text, in order: its line, words, state, notes, and the task it is under.
fn tasks_of(content: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    // The task a line may belong to, and the top-level task above it, each with its indent.
    let mut current: Option<(usize, usize)> = None;
    let mut top: Option<(usize, usize)> = None;
    for (i, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            (current, top) = (None, None);
            continue;
        }
        let own = indent(line);
        if let Some(t) = parse_line(line) {
            if out.len() >= MAX_TASKS {
                break;
            }
            let parent = match top {
                Some((ind, at)) if own > ind => Some(at),
                _ => {
                    top = Some((own, i));
                    None
                }
            };
            current = Some((own, out.len()));
            out.push(json!({ "line": i, "text": t.text, "done": t.done, "due": t.due, "flagged": t.flagged, "notes": "", "parent": parent }));
            continue;
        }
        let owner = match (current, top) {
            (Some((ind, at)), _) if own > ind => Some(at),
            (_, Some((ind, at))) if own > ind => out.iter().position(|t| t["line"] == at),
            _ => None,
        };
        match owner {
            Some(at) => {
                let notes = out[at]["notes"].as_str().unwrap_or("");
                let joined = if notes.is_empty() { note_in(line).to_owned() } else { format!("{notes}\n{}", note_in(line)) };
                out[at]["notes"] = Value::String(joined);
            }
            None => (current, top) = (None, None),
        }
    }
    out
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
        assert_eq!(t, Task { text: "Call the plumber".into(), done: false, due: Some("2026-11-12".into()), flagged: false });
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

    fn lines_of(v: &Value) -> Vec<(u64, String, Value)> {
        v["tasks"].as_array().unwrap().iter().map(|t| (t["line"].as_u64().unwrap(), t["text"].as_str().unwrap().to_owned(), t["parent"].clone())).collect()
    }

    #[test]
    fn a_flag_notes_and_subtasks_are_plain_markdown_under_the_task() {
        let (dir, tasks) = setup();
        let file = dir.path().join("work/tasks/Build.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "# Build\n\n- [ ] Book the sled (flagged) (due 2026-11-12)\n  Ask Dana for the code.\n  - [ ] Check the trailer\n    It needs new straps.\n  - [x] Call the yard\n  Bring cash.\n- [ ] Pay the deposit\n").unwrap();
        let read = tasks.read("Build").unwrap();
        let t = &read["tasks"];
        assert_eq!((t[0]["flagged"].clone(), t[0]["due"].clone()), (json!(true), json!("2026-11-12")));
        assert_eq!(t[0]["notes"], "Ask Dana for the code.\nBring cash.");
        assert_eq!(t[1]["notes"], "It needs new straps.");
        assert_eq!(lines_of(&read), vec![(2, "Book the sled".into(), Value::Null), (4, "Check the trailer".into(), json!(2)), (6, "Call the yard".into(), json!(2)), (8, "Pay the deposit".into(), Value::Null)]);
        // Written back in one order, whichever way it was read.
        assert_eq!(format_line(&parse_line("- [ ] A (flagged) (due 2026-11-12)").unwrap()), "- [ ] A (due 2026-11-12) (flagged)");

        // New notes replace the task's own notes, not its subtasks' notes; a line that would read as a task is escaped.
        tasks.update("Build", 2, "Book the sled", Change { notes: Some("Code is 4411.\n\n- [ ] not a task".into()), flagged: Some(false), ..Change::default() }).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Build\n\n- [ ] Book the sled (due 2026-11-12)\n  Code is 4411.\n  \\- [ ] not a task\n  - [ ] Check the trailer\n    It needs new straps.\n  - [x] Call the yard\n- [ ] Pay the deposit\n");
        assert_eq!(tasks.read("Build").unwrap()["tasks"][0]["notes"], "Code is 4411.\n- [ ] not a task");

        let after = tasks.add_with("Build", "Load the packs", None, true, Some((2, "Book the sled"))).unwrap();
        assert_eq!(after["tasks"][3], json!({ "line": 8, "text": "Load the packs", "done": false, "due": null, "flagged": true, "notes": "", "parent": 2 }));
        assert_eq!(tasks.add_with("Build", "x", None, false, Some((2, "Wrong words"))).unwrap_err(), "changed elsewhere");
    }

    #[test]
    fn deleting_a_task_takes_its_notes_and_subtasks_and_undo_puts_them_back() {
        let (dir, tasks) = setup();
        let file = dir.path().join("work/tasks/Home.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let text = "# Home\n\n- [ ] Paint\n  White, not grey.\n  - [ ] Buy brushes\n- [x] Sweep\n  - [ ] Under the bed\n- [ ] Rest\n";
        fs::write(&file, text).unwrap();
        let gone = tasks.remove("Home", 2, "Paint").unwrap();
        assert_eq!(gone["removed"], json!({ "line": 2, "text": "- [ ] Paint\n  White, not grey.\n  - [ ] Buy brushes" }));
        assert_eq!(texts(&gone), ["Sweep", "Under the bed", "Rest"]);
        tasks.restore("Home", 2, gone["removed"]["text"].as_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), text);
        for bad in ["", "# Heading", "plain words", "- [ ] ok\n# sneaky heading"] {
            assert!(tasks.restore("Home", 0, bad).is_err(), "{bad}");
        }
        // Clearing the done ones takes their subtasks too.
        tasks.clear_done("Home").unwrap();
        assert_eq!(texts(&tasks.read("Home").unwrap()), ["Paint", "Buy brushes", "Rest"]);
    }

    #[test]
    fn a_task_moves_with_its_subtasks_within_a_list_and_to_another() {
        let (dir, tasks) = setup();
        let file = dir.path().join("work/tasks/Home.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "# Home\n\n- [ ] A\n  - [ ] A1\n- [ ] B\n- [ ] C\n").unwrap();
        tasks.move_task("Home", 2, "A", "Home", Some((5, "C"))).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\n\n- [ ] B\n- [ ] A\n  - [ ] A1\n- [ ] C\n");
        tasks.move_task("Home", 5, "C", "Home", Some((2, "B"))).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\n\n- [ ] C\n- [ ] B\n- [ ] A\n  - [ ] A1\n");
        // Not before a subtask, and not inside itself.
        assert!(tasks.move_task("Home", 2, "C", "Home", Some((5, "A1"))).is_err());
        assert!(tasks.move_task("Home", 4, "A", "Home", Some((4, "A"))).is_err());
        // A subtask moved to another list stands on its own there.
        assert!(tasks.move_task("Home", 5, "A1", "Nowhere", None).is_err());
        tasks.lists().unwrap();
        let moved = tasks.move_task("Home", 5, "A1", "Inbox", None).unwrap();
        assert_eq!(moved["list"], "Inbox");
        tasks.move_task("Home", 2, "C", "Inbox", Some((2, "A1"))).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/Inbox.md")).unwrap(), "# Inbox\n\n- [ ] C\n- [ ] A1\n");
        assert_eq!(fs::read_to_string(&file).unwrap(), "# Home\n\n- [ ] B\n- [ ] A\n");
    }

    #[test]
    fn a_list_can_be_renamed_and_deleted_but_inbox_stays() {
        let (dir, tasks) = setup();
        tasks.create_list("Groceries").unwrap();
        tasks.add("Groceries", "Milk", None).unwrap();
        assert_eq!(tasks.rename_list("Groceries", "Shop").unwrap()["name"], "Shop");
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/Shop.md")).unwrap(), "# Shop\n\n- [ ] Milk\n");
        assert!(!dir.path().join("work/tasks/Groceries.md").exists());
        tasks.create_list("Work").unwrap();
        assert!(tasks.rename_list("Shop", "Work").unwrap_err().contains("already"));
        assert!(tasks.rename_list("Inbox", "Mine").is_err());
        assert!(tasks.rename_list("Shop", "Inbox").is_err());
        assert!(tasks.rename_list("Shop", "../x").is_ok_and(|v| v["name"] == "x"));
        assert!(tasks.delete_list("Inbox").is_err());
        let gone = tasks.delete_list("x").unwrap();
        assert!(!dir.path().join("work/tasks/x.md").exists());
        assert!(tasks.delete_list("x").is_err());
        // Undo puts it back as it was, but never over a list made since.
        tasks.restore_list("x", gone["text"].as_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/x.md")).unwrap(), "# x\n\n- [ ] Milk\n");
        assert!(tasks.restore_list("x", "anything").is_err());
        assert!(tasks.restore_list("../y", "anything").is_err());
    }

    #[test]
    fn the_agent_can_flag_and_write_notes() {
        let (dir, tasks) = setup();
        tasks.run("tasks.add", &json!({ "list": "Inbox", "text": "Call Sam", "flagged": true })).unwrap();
        tasks.run("tasks.update", &json!({ "list": "Inbox", "task": "Call Sam", "notes": "About the sled." })).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("work/tasks/Inbox.md")).unwrap(), "# Inbox\n\n- [ ] Call Sam (flagged)\n  About the sled.\n");
    }
}
