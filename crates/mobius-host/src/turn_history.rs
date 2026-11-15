//! Every agent turn in a conversation, not only the last: the checkpoint taken before it started and the one taken
//! when it ended, with when and what was asked, so what any turn changed can be shown and put back one item at a
//! time. Kept in `turn-history.json` in the data folder, the newest few per conversation.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const PER_CONVERSATION: usize = 30;
const MAX_CONVERSATIONS: usize = 200;
const MAX_ASK: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Turn {
    /// The checkpoint before the turn.
    pub start: String,
    /// The checkpoint when it ended; `None` while it runs, or when Mobius closed before it ended.
    pub end: Option<String>,
    /// Milliseconds since 1970.
    pub when: u64,
    /// The start of what was asked.
    pub ask: String,
    /// What of the turn's changes the person kept: workspace folders such as `tasks/` (an app's own Keep), or `""`
    /// for the whole turn. Sync holds back what is not kept yet.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kept: Vec<String>,
}

impl Turn {
    /// Whether the person kept this turn's change to `path` (a workspace path).
    pub fn kept(&self, path: &str) -> bool {
        self.kept.iter().any(|folder| folder.is_empty() || path.starts_with(folder.as_str()))
    }

    /// Whether the person kept all of the turn.
    pub fn all_kept(&self) -> bool {
        self.kept.iter().any(String::is_empty)
    }
}

pub struct TurnHistory {
    file: PathBuf,
    all: Mutex<HashMap<String, Vec<Turn>>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

impl TurnHistory {
    pub fn open(file: impl Into<PathBuf>) -> TurnHistory {
        let file = file.into();
        let all = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        TurnHistory {
            file,
            all: Mutex::new(all),
        }
    }

    fn save(&self, all: &HashMap<String, Vec<Turn>>) {
        if let Ok(text) = serde_json::to_string(all) {
            let temp = self.file.with_extension("json.tmp");
            if std::fs::write(&temp, text).is_ok() {
                let _ = std::fs::rename(&temp, &self.file);
            }
        }
    }

    /// A turn starts in a conversation, after `start` was taken.
    pub fn started(&self, conversation: &str, start: &str, ask: &str) {
        let Ok(mut all) = self.all.lock() else { return };
        let turns = all.entry(conversation.to_owned()).or_default();
        // A turn sent again from the same checkpoint (nothing changed between) is still a turn of its own.
        turns.push(Turn {
            start: start.to_owned(),
            end: None,
            when: now_ms(),
            // A suggestion's hidden steps (after "<steps>", see withSteps in the shared package) are not what was asked.
            ask: ask
                .split("\n\n<steps>\n")
                .next()
                .unwrap_or(ask)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(MAX_ASK)
                .collect(),
            kept: Vec::new(),
        });
        let extra = turns.len().saturating_sub(PER_CONVERSATION);
        turns.drain(..extra);
        if all.len() > MAX_CONVERSATIONS {
            // The conversations whose last turn is oldest go first.
            let mut by_age: Vec<(String, u64)> = all
                .iter()
                .map(|(k, v)| (k.clone(), v.last().map_or(0, |t| t.when)))
                .collect();
            by_age.sort_by_key(|(_, w)| *w);
            for (k, _) in by_age.into_iter().take(all.len() - MAX_CONVERSATIONS) {
                all.remove(&k);
            }
        }
        self.save(&all);
    }

    /// The start of the conversation's newest turn, if it is still waiting for its end.
    pub fn running_start(&self, conversation: &str) -> Option<String> {
        self.all.lock().ok()?.get(conversation)?.last().filter(|t| t.end.is_none()).map(|t| t.start.clone())
    }

    /// The turn of the conversation that started at `start` ended, with `end` taken. Another turn may have started
    /// meanwhile; it is left alone.
    pub fn ended_turn(&self, conversation: &str, start: &str, end: &str) {
        let Ok(mut all) = self.all.lock() else { return };
        if let Some(turn) = all.get_mut(conversation).and_then(|t| t.iter_mut().rev().find(|t| t.start == start && t.end.is_none())) {
            turn.end = Some(end.to_owned());
            self.save(&all);
        }
    }

    /// Whether the conversation's newest turn is still waiting for its end.
    pub fn running(&self, conversation: &str) -> bool {
        self.all
            .lock()
            .ok()
            .and_then(|a| {
                a.get(conversation)
                    .and_then(|t| t.last())
                    .map(|t| t.end.is_none())
            })
            .unwrap_or(false)
    }

    /// The conversation's newest turn ended, with `end` taken.
    pub fn ended(&self, conversation: &str, end: &str) {
        let Ok(mut all) = self.all.lock() else { return };
        if let Some(turn) = all
            .get_mut(conversation)
            .and_then(|t| t.last_mut())
            .filter(|t| t.end.is_none())
        {
            turn.end = Some(end.to_owned());
            self.save(&all);
        }
    }

    /// Newest first.
    pub fn turns(&self, conversation: &str) -> Vec<Turn> {
        self.all
            .lock()
            .ok()
            .and_then(|a| a.get(conversation).cloned())
            .map(|mut t| {
                t.reverse();
                t
            })
            .unwrap_or_default()
    }

    /// Takes out the turns after the one that started at `start` (rewinding to it), oldest first. None when that
    /// turn is not known.
    pub fn drop_after(&self, conversation: &str, start: &str) -> Option<Vec<Turn>> {
        let Ok(mut all) = self.all.lock() else { return None };
        let turns = all.get_mut(conversation)?;
        let at = turns.iter().position(|t| t.start == start)?;
        let later = turns.split_off(at + 1);
        self.save(&all);
        Some(later)
    }

    /// Puts back turns taken out by a rewind that was undone, after the ones there now.
    pub fn put_back(&self, conversation: &str, later: Vec<Turn>) {
        let Ok(mut all) = self.all.lock() else { return };
        let turns = all.entry(conversation.to_owned()).or_default();
        turns.extend(later);
        let extra = turns.len().saturating_sub(PER_CONVERSATION);
        turns.drain(..extra);
        self.save(&all);
    }

    /// How many turns came after the one that started at `start`.
    pub fn later_than(&self, conversation: &str, start: &str) -> Option<usize> {
        let all = self.all.lock().ok()?;
        let turns = all.get(conversation)?;
        let at = turns.iter().position(|t| t.start == start)?;
        Some(turns.len() - at - 1)
    }

    /// The person kept the turn that started at `start`: all of it (`folder` empty), or one app's folder of it.
    /// False when that turn is not known.
    pub fn keep(&self, conversation: &str, start: &str, folder: &str) -> bool {
        let Ok(mut all) = self.all.lock() else { return false };
        let Some(turn) = all.get_mut(conversation).and_then(|t| t.iter_mut().rev().find(|t| t.start == start)) else {
            return false;
        };
        if !turn.kept.iter().any(|k| k == folder) {
            turn.kept.push(folder.to_owned());
            self.save(&all);
        }
        true
    }

    /// The turns whose changes may still wait for Keep, with their conversation: each conversation's newest turn, when
    /// it started at or after `since` (milliseconds since 1970) and is not kept as a whole. A turn before the newest
    /// was left behind when the next one started, as Review leaves it, so it is not waited for.
    pub fn waiting(&self, since: u64) -> Vec<(String, Turn)> {
        let Ok(all) = self.all.lock() else { return Vec::new() };
        all.iter()
            .filter_map(|(c, turns)| turns.last().filter(|t| t.when >= since && !t.all_kept()).map(|t| (c.clone(), t.clone())))
            .collect()
    }

    /// One turn, by the checkpoint before it.
    pub fn find(&self, conversation: &str, start: &str) -> Option<Turn> {
        self.all
            .lock()
            .ok()?
            .get(conversation)?
            .iter()
            .rev()
            .find(|t| t.start == start)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_are_kept_with_their_start_and_end_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("turn-history.json");
        let h = TurnHistory::open(&file);
        h.started("c1", "aaaa", "Add   a task\nfor Friday");
        assert!(h.running("c1"));
        h.ended("c1", "bbbb");
        assert!(!h.running("c1"));
        h.ended("c1", "cccc");
        h.started("c1", "bbbb", "Rename it");
        let again = TurnHistory::open(&file);
        let turns = again.turns("c1");
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].ask, "Rename it");
        assert_eq!(turns[0].end, None);
        assert_eq!(
            turns[1],
            Turn {
                start: "aaaa".into(),
                end: Some("bbbb".into()),
                when: turns[1].when,
                ask: "Add a task for Friday".into(),
                kept: Vec::new(),
            }
        );
        assert_eq!(
            again.find("c1", "aaaa").unwrap().ask,
            "Add a task for Friday"
        );
        // A suggestion's hidden steps are not part of what was asked.
        h.started("c3", "dddd", "Take care of this\n\n<steps>\nTake care of the attached email.\n</steps>");
        assert_eq!(h.turns("c3")[0].ask, "Take care of this");
        for i in 0..40 {
            h.started("c2", &format!("{i:04}"), "x");
        }
        assert_eq!(h.turns("c2").len(), PER_CONVERSATION);
        assert!(h.turns("nope").is_empty());
    }

    #[test]
    fn rewinding_takes_out_the_later_turns_and_undoing_puts_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let h = TurnHistory::open(dir.path().join("turn-history.json"));
        for (start, end) in [("aaaa", "bbbb"), ("bbbb", "cccc"), ("cccc", "dddd")] {
            h.started("c1", start, start);
            h.ended("c1", end);
        }
        assert_eq!(h.later_than("c1", "aaaa"), Some(2));
        assert_eq!(h.later_than("c1", "nope"), None);
        let later = h.drop_after("c1", "aaaa").unwrap();
        assert_eq!(later.iter().map(|t| t.start.as_str()).collect::<Vec<_>>(), ["bbbb", "cccc"]);
        assert_eq!(h.turns("c1").len(), 1);
        h.put_back("c1", later);
        assert_eq!(h.turns("c1").iter().map(|t| t.start.as_str()).collect::<Vec<_>>(), ["cccc", "bbbb", "aaaa"]);
    }

    #[test]
    fn only_each_conversations_newest_turn_waits_until_it_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("turn-history.json");
        let h = TurnHistory::open(&file);
        h.started("c1", "aaaa", "first");
        h.ended("c1", "bbbb");
        h.started("c1", "bbbb", "second");
        h.started("c2", "cccc", "other");
        let mut waiting: Vec<(String, String)> = h.waiting(0).into_iter().map(|(c, t)| (c, t.start)).collect();
        waiting.sort();
        assert_eq!(waiting, [("c1".to_owned(), "bbbb".to_owned()), ("c2".to_owned(), "cccc".to_owned())]);
        // Kept for one app: the rest of the turn still waits.
        assert!(h.keep("c1", "bbbb", "tasks/"));
        let turn = h.find("c1", "bbbb").unwrap();
        assert!(turn.kept("tasks/plan.md") && !turn.kept("notes/a.md"));
        assert_eq!(h.waiting(0).len(), 2);
        // Kept as a whole, and still so after Mobius opens again.
        assert!(h.keep("c1", "bbbb", ""));
        assert!(!h.keep("c1", "nope", ""));
        let again = TurnHistory::open(&file);
        assert_eq!(again.waiting(0).into_iter().map(|(c, _)| c).collect::<Vec<_>>(), ["c2"]);
        // Turns from before a time are not waited for.
        assert!(again.waiting(u64::MAX).is_empty());
    }
}
