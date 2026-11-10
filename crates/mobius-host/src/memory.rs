//! What Mobius remembers about the person between conversations: short facts in one plain Markdown file
//! (`memory.md` in the data folder), one per line, that the person can read, edit and forget.
//!
//! The agent adds and removes them with two tools that go through the usual approvals (capability `memory.write`), so
//! with "Ask first" every new memory is a question first. What is remembered is added to the agent's instructions for
//! every turn.
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{Value, json};

pub const MAX_ITEMS: usize = 100;
pub const MAX_TEXT: usize = 300;
const HEADER: &str = "# What Mobius remembers\n\nOne fact per line. Edit or delete lines freely; Mobius reads this file before every turn.\n\n";

pub fn is_memory_tool(name: &str) -> bool {
    matches!(name, "memory.remember" | "memory.forget")
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "memory.remember", "capability": "memory.write",
            "description": "Remember one short, lasting fact about the person or how they like things done (a preference, a name, a habit), to use in later conversations. Only things they said or confirmed, never secrets or sensitive details. The person may be asked first.",
            "input_schema": { "type": "object", "properties": {
                "text": { "type": "string", "description": "The fact, as one short sentence." },
                "category": { "type": "string", "enum": CATEGORIES, "description": "you (about them), prefs (how they like things), work (projects and plans), people (others in their life), skills (ways of doing things)" },
                "source": { "type": "string", "description": "Where you noticed it, in two or three words: Mail, a conversation, Calendar." } }, "required": ["text"] } }),
        json!({ "name": "memory.forget", "capability": "memory.write",
            "description": "Forget a remembered fact, given its exact words as listed in what you remember.",
            "input_schema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }),
    ]
}

/// The kinds of things remembered, as the Journey app sorts them.
pub const CATEGORIES: [&str; 5] = ["you", "prefs", "work", "people", "skills"];

/// One remembered fact, with what kind it is and where it was noticed. In the file:
/// `- Likes boutique hotels <!-- prefs · Browser -->`; a line without the comment is just the fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub text: String,
    pub category: String,
    pub source: String,
    /// The person kept what Mobius learned (or wrote it themself): it is no longer shown as learned.
    pub kept: bool,
}

/// Where a fact the person wrote themself says it came from.
pub const YOURS: &str = "you added it";

impl Item {
    fn line(&self) -> String {
        if self.category.is_empty() && self.source.is_empty() && !self.kept {
            format!("- {}\n", self.text)
        } else {
            format!("- {} <!-- {} · {}{} -->\n", self.text, if self.category.is_empty() { "you" } else { &self.category }, self.source, if self.kept { " · kept" } else { "" })
        }
    }
    pub fn to_json(&self) -> Value {
        // Learned: Mobius noticed it and the person has not kept it yet. A line written by hand, or by the person, is theirs.
        let learned = !self.kept && !self.source.is_empty() && self.source != YOURS;
        json!({ "text": self.text, "category": if self.category.is_empty() { "you" } else { &self.category }, "source": self.source, "learned": learned })
    }
}

fn parse_line(line: &str) -> Option<Item> {
    let line = line.trim().trim_start_matches(['-', '*']).trim();
    let (text, meta) = match line.rfind("<!--") {
        Some(at) if line.ends_with("-->") => (line[..at].trim(), line[at + 4..line.len() - 3].trim()),
        _ => (line, ""),
    };
    let mut parts = meta.split('·').map(str::trim);
    let category = parts.next().unwrap_or("");
    let source = parts.next().unwrap_or("");
    let kept = parts.next() == Some("kept");
    let category = if CATEGORIES.contains(&category) { category } else { "" };
    clean(text).map(|text| Item { text, category: category.to_owned(), source: clean(source).unwrap_or_default(), kept })
}

pub struct Memory {
    file: PathBuf,
    lock: Mutex<()>,
}

/// One fact: one line of text, no control characters, at most `MAX_TEXT` characters.
fn clean(text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty() && text.chars().count() <= MAX_TEXT && !text.chars().any(char::is_control)).then_some(text)
}

impl Memory {
    pub fn new(file: PathBuf) -> Memory {
        Memory { file, lock: Mutex::new(()) }
    }

    /// The facts, in the order they were added. Lines the person wrote by hand count too, with or without a dash.
    pub fn items(&self) -> Vec<Item> {
        let text = std::fs::read_to_string(&self.file).unwrap_or_default();
        text.lines()
            .filter(|l| {
                let l = l.trim();
                !l.is_empty() && !l.starts_with('#') && l != HEADER.lines().nth(2).unwrap_or_default()
            })
            .filter_map(parse_line)
            .take(MAX_ITEMS)
            .collect()
    }

    /// Just the facts' words.
    pub fn list(&self) -> Vec<String> {
        self.items().into_iter().map(|i| i.text).collect()
    }

    fn save(&self, items: &[Item]) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let body: String = items.iter().map(Item::line).collect();
        std::fs::write(&self.file, format!("{HEADER}{body}")).map_err(|e| e.to_string())
    }

    pub fn remember(&self, text: &str) -> Result<String, String> {
        self.remember_with(text, "", "")
    }

    /// Remembers a fact, with its kind and where it was noticed (either may be empty).
    pub fn remember_with(&self, text: &str, category: &str, source: &str) -> Result<String, String> {
        let text = clean(text).ok_or(format!("a memory is one line of up to {MAX_TEXT} characters"))?;
        let category = if CATEGORIES.contains(&category) { category } else { "" };
        let source = clean(source).map(|s| s.chars().take(60).collect()).unwrap_or_default();
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut items = self.items();
        if items.iter().any(|i| i.text.eq_ignore_ascii_case(&text)) {
            return Ok("Already remembered.".into());
        }
        if items.len() >= MAX_ITEMS {
            return Err(format!("memory is full ({MAX_ITEMS} facts); forget one first"));
        }
        items.push(Item { text, category: category.to_owned(), source, kept: false });
        self.save(&items)?;
        Ok("Remembered.".into())
    }

    /// The person changes a fact's words or its kind; where it was noticed stays.
    pub fn edit(&self, old: &str, text: &str, category: &str) -> Result<String, String> {
        let old = clean(old).ok_or("give the exact words of the memory")?;
        let text = clean(text).ok_or(format!("a memory is one line of up to {MAX_TEXT} characters"))?;
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut items = self.items();
        if items.iter().any(|i| i.text.eq_ignore_ascii_case(&text) && !i.text.eq_ignore_ascii_case(&old)) {
            return Err("that is remembered already".into());
        }
        let item = items.iter_mut().find(|i| i.text.eq_ignore_ascii_case(&old)).ok_or("nothing remembered has those words")?;
        item.text = text;
        if CATEGORIES.contains(&category) {
            item.category = category.to_owned();
        }
        self.save(&items)?;
        Ok("Changed.".into())
    }

    /// The person kept a fact Mobius learned (on), or undid that (off).
    pub fn keep(&self, text: &str, on: bool) -> Result<String, String> {
        let text = clean(text).ok_or("give the exact words of the memory")?;
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut items = self.items();
        let item = items.iter_mut().find(|i| i.text.eq_ignore_ascii_case(&text)).ok_or("nothing remembered has those words")?;
        item.kept = on;
        self.save(&items)?;
        Ok(if on { "Kept." } else { "Not kept." }.into())
    }

    pub fn forget(&self, text: &str) -> Result<String, String> {
        let text = clean(text).ok_or("give the exact words of the memory")?;
        let _one = self.lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut items = self.items();
        let before = items.len();
        items.retain(|i| !i.text.eq_ignore_ascii_case(&text));
        if items.len() == before {
            return Err("nothing remembered has those words".into());
        }
        self.save(&items)?;
        Ok("Forgotten.".into())
    }

    pub fn run(&self, tool: &str, args: &Value) -> Result<String, String> {
        let text = args.get("text").and_then(Value::as_str).ok_or("text is required")?;
        let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("");
        match tool {
            "memory.remember" => self.remember_with(text, s("category"), s("source")),
            "memory.forget" => self.forget(text),
            _ => Err("unknown tool".into()),
        }
    }

    /// What is added to the agent's instructions: nothing when nothing is remembered.
    pub fn instructions(&self) -> String {
        let items = self.list();
        if items.is_empty() {
            return String::new();
        }
        let lines: String = items.iter().map(|i| format!("- {i}\n")).collect();
        format!("What you remember about the person from earlier conversations (they can see and edit this list):\n{lines}Use it where it helps; do not repeat it back unasked.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> (tempfile::TempDir, Memory) {
        let dir = tempfile::tempdir().unwrap();
        let m = Memory::new(dir.path().join("memory.md"));
        (dir, m)
    }

    #[test]
    fn facts_are_remembered_once_listed_and_forgotten() {
        let (_d, m) = memory();
        assert_eq!(m.instructions(), "");
        assert_eq!(m.remember("Prefers  boutique hotels").unwrap(), "Remembered.");
        assert_eq!(m.remember("prefers boutique hotels").unwrap(), "Already remembered.");
        m.remember("Works from Lisbon on Fridays").unwrap();
        assert_eq!(m.list(), vec!["Prefers boutique hotels", "Works from Lisbon on Fridays"]);
        assert!(m.instructions().contains("- Prefers boutique hotels\n"));
        assert!(m.forget("Nope").is_err());
        m.forget("prefers boutique hotels").unwrap();
        assert_eq!(m.list(), vec!["Works from Lisbon on Fridays"]);
    }

    #[test]
    fn the_file_is_plain_text_the_person_can_edit() {
        let (_d, m) = memory();
        m.remember("Likes short replies").unwrap();
        let text = std::fs::read_to_string(&m.file).unwrap();
        assert!(text.starts_with("# What Mobius remembers") && text.ends_with("- Likes short replies\n"));
        std::fs::write(&m.file, "# What Mobius remembers\n\n- Likes short replies\nCalls their manager Priya\n* Uses metric units\n").unwrap();
        assert_eq!(m.list(), vec!["Likes short replies", "Calls their manager Priya", "Uses metric units"]);
    }

    #[test]
    fn facts_keep_their_kind_and_where_they_were_noticed_in_the_same_plain_file() {
        let (_d, m) = memory();
        m.run("memory.remember", &json!({ "text": "Likes boutique hotels", "category": "prefs", "source": "Browser, June" })).unwrap();
        m.remember_with("Rui runs the terrace venue", "people", "Mail").unwrap();
        m.remember("Uses metric units").unwrap();
        let text = std::fs::read_to_string(&m.file).unwrap();
        assert!(text.contains("- Likes boutique hotels <!-- prefs · Browser, June -->\n- Rui runs the terrace venue <!-- people · Mail -->\n- Uses metric units\n"), "{text}");
        assert_eq!(m.items()[0], Item { text: "Likes boutique hotels".into(), category: "prefs".into(), source: "Browser, June".into(), kept: false });
        assert_eq!(m.items()[2].to_json(), json!({ "text": "Uses metric units", "category": "you", "source": "", "learned": false }));
        assert_eq!(m.list()[1], "Rui runs the terrace venue", "the agent sees the facts, not the marks");
        assert!(m.instructions().contains("- Rui runs the terrace venue\n"));
        m.edit("rui runs the terrace venue", "Rui runs the terrace venue; prefers email", "people").unwrap();
        assert_eq!(m.items()[1].source, "Mail");
        assert!(m.edit("Likes boutique hotels", "Uses metric units", "").is_err());
        m.forget("Likes boutique hotels").unwrap();
        assert_eq!(m.items().len(), 2);
    }

    #[test]
    fn what_mobius_learned_is_marked_until_the_person_keeps_it_and_their_own_lines_are_theirs() {
        let (_d, m) = memory();
        m.remember_with("Answers mail in the morning", "prefs", "Mail").unwrap();
        m.remember_with("Vegetarian", "you", YOURS).unwrap();
        assert_eq!(m.items()[0].to_json()["learned"], true);
        assert_eq!(m.items()[1].to_json()["learned"], false, "what the person added is theirs");
        m.keep("answers mail in the morning", true).unwrap();
        assert_eq!(m.items()[0].to_json()["learned"], false);
        assert!(std::fs::read_to_string(&m.file).unwrap().contains("- Answers mail in the morning <!-- prefs · Mail · kept -->"));
        assert_eq!(m.items()[0].source, "Mail", "where it was noticed stays");
        m.keep("Answers mail in the morning", false).unwrap();
        assert_eq!(m.items()[0].to_json()["learned"], true, "undo");
        assert!(m.keep("nothing", true).is_err());
    }

    #[test]
    fn bad_facts_are_refused() {
        let (_d, m) = memory();
        for bad in ["", "   ", &"x".repeat(301), "two\u{0007}bells"] {
            assert!(m.remember(bad).is_err(), "{bad:?}");
        }
        assert!(m.run("memory.remember", &json!({})).is_err());
    }
}
