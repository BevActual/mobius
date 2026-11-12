//! Material the person attaches to a message (a page, a file, text selected in a note). It travels inside the message text between markers, so
//! it is saved with the conversation and the model can tell it from what the person typed. It is data, never
//! instructions. Same rules as `context.ts` in the shared package.
use serde_json::Value;

pub const MAX_ITEMS: usize = 5;
pub const MAX_ITEM_CHARS: usize = 20_000;
pub const MAX_TOTAL_CHARS: usize = 60_000;
pub const MAX_TYPED_CHARS: usize = 32_000;
const MAX_TITLE: usize = 120;
const MAX_SOURCE: usize = 500;
const OPEN: &str = "<attached ";
const CLOSE: &str = "</attached>";

#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub kind: String,
    pub title: String,
    pub source: String,
    pub text: String,
}

fn clean(value: &str, limit: usize) -> String {
    let replaced: String = value.chars().map(|c| if matches!(c, '\r' | '\n' | '"' | '<' | '>') { ' ' } else { c }).collect();
    replaced.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(limit).collect()
}

fn item(v: &Value) -> Option<Item> {
    let kind = v.get("kind")?.as_str().filter(|k| matches!(*k, "page" | "file" | "note"))?;
    let (title, source, text) = (v.get("title")?.as_str()?, v.get("source")?.as_str()?, v.get("text")?.as_str()?);
    if title.is_empty() || title.encode_utf16().count() > MAX_TITLE || source.encode_utf16().count() > MAX_SOURCE || text.encode_utf16().count() > MAX_ITEM_CHARS {
        return None;
    }
    Some(Item { kind: kind.to_owned(), title: title.to_owned(), source: source.to_owned(), text: text.to_owned() })
}

/// The list is acceptable: few enough, each fine, and not too much altogether.
pub fn parse_list(v: &Value) -> Option<Vec<Item>> {
    let rows = v.as_array().filter(|r| r.len() <= MAX_ITEMS)?;
    let items: Vec<Item> = rows.iter().map(item).collect::<Option<_>>()?;
    (items.iter().map(|i| i.text.encode_utf16().count()).sum::<usize>() <= MAX_TOTAL_CHARS).then_some(items)
}

/// The text the model receives: what the person typed, then each attachment between markers it cannot close early.
pub fn with_context(text: &str, items: &[Item]) -> String {
    if items.is_empty() {
        return text.to_owned();
    }
    let blocks: Vec<String> = items
        .iter()
        .map(|i| {
            let body = i.text.replace(CLOSE, "</ attached>");
            format!("{OPEN}kind=\"{}\" title=\"{}\" source=\"{}\">\n{body}\n{CLOSE}", i.kind, clean(&i.title, MAX_TITLE), clean(&i.source, MAX_SOURCE))
        })
        .collect();
    format!("{text}\n\n{}", blocks.join("\n\n"))
}
