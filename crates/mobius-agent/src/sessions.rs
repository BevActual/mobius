//! Searching past conversations: what the person and Mobius said, found by words. Tool output is left out (it is
//! often web text, and not what anyone said). Used by the `sessions.search` tool.
use serde_json::{Value, json};

use crate::conversations::SavedConversation;
use crate::message::Message;

pub const MAX_HITS: usize = 8;
const SNIPPET: usize = 160;

/// The text someone said: a person's words without what they attached, or Mobius's reply.
fn said(message: &Message) -> Option<(&'static str, String)> {
    match message {
        Message::User { text } => Some(("person", text.split("<attached").next().unwrap_or("").trim().to_owned())),
        Message::Assistant { text, .. } if !text.trim().is_empty() => Some(("mobius", text.trim().to_owned())),
        _ => None,
    }
}

/// A short piece of `text` around the first place it contains `needle` (already lower case).
fn snippet(text: &str, needle: &str) -> String {
    let lower = text.to_lowercase();
    let at = lower.find(needle).map_or(0, |byte| lower[..byte].chars().count());
    let chars: Vec<char> = text.chars().collect();
    let start = at.saturating_sub(SNIPPET / 3);
    let end = (start + SNIPPET).min(chars.len());
    let mut out: String = chars[start..end].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

/// Conversations where every word of `query` was said, newest first, each with where it was said. `skip` is the
/// conversation asking, which is left out.
pub fn search(conversations: &[SavedConversation], query: &str, skip: Option<&str>) -> Value {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).filter(|w| !w.is_empty()).take(8).collect();
    if words.is_empty() {
        return json!({ "error": "give some words to look for" });
    }
    let mut hits = Vec::new();
    for conversation in conversations {
        if Some(conversation.id.as_str()) == skip {
            continue;
        }
        let lines: Vec<(&str, String)> = conversation.messages.iter().filter_map(said).collect();
        let all = lines.iter().map(|(_, t)| t.to_lowercase()).collect::<Vec<_>>().join("\n");
        if !words.iter().all(|w| all.contains(w.as_str())) {
            continue;
        }
        let Some((who, text)) = lines.iter().find(|(_, t)| t.to_lowercase().contains(words[0].as_str())) else { continue };
        let title = lines.iter().find(|(w, _)| *w == "person").map(|(_, t)| t.lines().next().unwrap_or("").chars().take(60).collect::<String>()).unwrap_or_default();
        hits.push(json!({ "conversation": conversation.id, "title": title, "updated_ms": conversation.updated_ms, "said_by": who, "snippet": snippet(text, &words[0]) }));
        if hits.len() == MAX_HITS {
            break;
        }
    }
    json!({ "matches": hits })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(id: &str, updated_ms: u64, messages: Vec<Message>) -> SavedConversation {
        SavedConversation { id: id.into(), messages, updated_ms, compaction: None }
    }
    fn user(t: &str) -> Message {
        Message::User { text: t.into() }
    }
    fn reply(t: &str) -> Message {
        Message::Assistant { text: t.into(), tool_calls: vec![] }
    }

    #[test]
    fn finds_conversations_where_every_word_was_said_and_not_in_tool_output() {
        let all = vec![
            saved("c-new", 30, vec![user("Plan the Lisbon offsite"), reply("Casa Amora fits the budget and is walkable.")]),
            saved("c-old", 10, vec![user("Hotels in Porto?"), Message::Tool { call_id: "t".into(), name: "browser.read".into(), content: "Lisbon Casa".into(), is_error: false }]),
            saved("c-here", 40, vec![user("Lisbon again")]),
        ];
        let r = search(&all, "casa LISBON", Some("c-here"));
        let hits = r["matches"].as_array().unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["conversation"], "c-new");
        assert_eq!(hits[0]["title"], "Plan the Lisbon offsite");
        assert_eq!(hits[0]["said_by"], "mobius");
        assert!(hits[0]["snippet"].as_str().unwrap().contains("Casa Amora"));
        assert_eq!(search(&all, "   ", None)["error"], "give some words to look for");
    }

    #[test]
    fn what_was_attached_is_not_what_was_said() {
        let all = vec![saved("c", 1, vec![user("Summarise this\n\n<attached kind=\"page\">secret page words</attached>")])];
        assert_eq!(search(&all, "secret", None)["matches"], json!([]));
        assert_eq!(search(&all, "summarise", None)["matches"][0]["snippet"], "Summarise this");
    }
}
