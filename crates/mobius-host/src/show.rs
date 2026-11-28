//! Mobius showing something beside the person's work on purpose ("Show me today beside this"): a task list, a day of
//! the calendar or a mail conversation, as a piece (docs/design/pieces.md). It changes nothing, so each needs only
//! the reading capability of its app: the person's access level for that app decides it, as for reading it.
use serde_json::{Value, json};

pub const LIST: &str = "show.list";
pub const DAY: &str = "show.day";
pub const THREAD: &str = "show.thread";

pub fn is_show_tool(name: &str) -> bool {
    matches!(name, LIST | DAY | THREAD)
}

pub fn tool_descriptions() -> Vec<Value> {
    let tail = "It changes nothing and stays until the person puts it away. Use it when the person asks to see something beside what they are doing; to change it, use that app's own tools.";
    vec![
        json!({ "name": LIST, "capability": "tasks.read",
            "description": format!("Show one task list beside the person's work, as a small live panel they can tick and add to. {tail}"),
            "input_schema": { "type": "object", "properties": { "list": { "type": "string", "description": "The list's name, as tasks.list gives it." } }, "required": ["list"] } }),
        json!({ "name": DAY, "capability": "calendar.read",
            "description": format!("Show one day of the calendar beside the person's work, as a small live panel. {tail}"),
            "input_schema": { "type": "object", "properties": { "date": { "type": "string", "description": "\"today\", or the day as YYYY-MM-DD." } }, "required": ["date"] } }),
        json!({ "name": THREAD, "capability": "mail.read",
            "description": format!("Show one mail conversation beside the person's work, as a small live panel they can reply from. {tail}"),
            "input_schema": { "type": "object", "properties": { "id": { "type": "string", "description": "The message's id, as mail.list gives it." } }, "required": ["id"] } }),
    ]
}

/// A day as the piece names it: "today", or a real date written YYYY-MM-DD.
pub fn day(date: &str) -> Option<String> {
    let date = date.trim();
    if date.eq_ignore_ascii_case("today") {
        return Some("today".into());
    }
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok().map(|d| d.format("%Y-%m-%d").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_is_today_or_a_real_date() {
        assert_eq!(day("Today").as_deref(), Some("today"));
        assert_eq!(day(" 2026-11-28 ").as_deref(), Some("2026-11-28"));
        assert_eq!(day("2026-02-30"), None);
        assert_eq!(day("tomorrow"), None);
        assert!(tool_descriptions().iter().all(|t| is_show_tool(t["name"].as_str().unwrap())));
    }
}
