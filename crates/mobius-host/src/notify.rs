//! What, if anything, to tell the person about something the agent did while they were elsewhere. Only the kind of thing and
//! the tool's name are ever used: not what was asked, typed or read, and not an error message, because a notice can appear
//! on a lock screen.
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    /// `needs-you`, `finished` or `download`.
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    /// The conversation to open when the notice is clicked.
    pub conversation: Option<String>,
    pub silent: bool,
}

impl Notice {
    pub fn to_json(&self) -> Value {
        json!({ "kind": self.kind, "title": self.title, "body": self.body, "conversation": self.conversation, "silent": self.silent })
    }
}

fn flag(prefs: &Value, name: &str) -> bool {
    prefs.get(name).and_then(Value::as_bool).unwrap_or(false)
}

/// `notification` is a checked agent notification (`{method, params}`); `focused` says whether a Mobius window has the focus.
pub fn decide_notice(notification: &Value, prefs: &Value, focused: bool) -> Option<Notice> {
    if focused || notification.get("method").and_then(Value::as_str) != Some("agent.event") {
        return None;
    }
    let params = notification.get("params")?;
    let conversation = params.get("conversation").and_then(Value::as_str).map(str::to_owned);
    let event = params.get("event")?;
    let silent = flag(prefs, "muteSounds");
    match event.get("kind").and_then(Value::as_str)? {
        "needs_approval" if flag(prefs, "notifyNeedsYou") => {
            let tool = event.get("tool").and_then(Value::as_str)?;
            Some(Notice { kind: "needs-you", title: "Mobius needs you".into(), body: format!("It is waiting to use {tool}."), conversation, silent })
        }
        // A question waits for you as an approval does. Only that there is one is said, never the question itself.
        "question" if flag(prefs, "notifyNeedsYou") => Some(Notice { kind: "needs-you", title: "Mobius needs you".into(), body: "It has a question for you.".into(), conversation, silent }),
        "done" if flag(prefs, "notifyFinished") => Some(Notice { kind: "finished", title: "Mobius finished".into(), body: "Your request is done.".into(), conversation, silent }),
        "failed" if flag(prefs, "notifyFinished") => {
            Some(Notice { kind: "finished", title: "Mobius stopped".into(), body: "Something went wrong. Open Mobius to see what.".into(), conversation, silent })
        }
        _ => None,
    }
}

const MAX_BODY: usize = 80;

/// A download that has just finished: `before` and `after` are the list entries (`{name, state, ...}`) either side of the change.
pub fn decide_download_notice(before: Option<&Value>, after: &Value, prefs: &Value, focused: bool) -> Option<Notice> {
    if focused || !flag(prefs, "notifyDownloads") {
        return None;
    }
    let state = |v: &Value| v.get("state").and_then(Value::as_str).map(str::to_owned);
    if before.and_then(state).as_deref() != Some("downloading") || state(after).as_deref() != Some("done") {
        return None;
    }
    let name = after.get("name").and_then(Value::as_str)?;
    let body: String = if name.chars().count() > MAX_BODY { format!("{}…", name.chars().take(MAX_BODY - 1).collect::<String>()) } else { name.to_owned() };
    Some(Notice { kind: "download", title: "Download finished".into(), body, conversation: None, silent: flag(prefs, "muteSounds") })
}

/// Entries of a download list by id, for comparing one list with the next.
pub fn by_id(list: &Value) -> Map<String, Value> {
    list.as_array().into_iter().flatten().filter_map(|e| Some((e.get("id")?.as_str()?.to_owned(), e.clone()))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs() -> Value {
        json!({ "notifyNeedsYou": true, "notifyFinished": true, "notifyDownloads": true, "muteSounds": false })
    }
    fn event(kind: &str, extra: Value) -> Value {
        let mut e = json!({ "kind": kind });
        e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        json!({ "method": "agent.event", "params": { "conversation": "c-main-abc", "turn": 1, "event": e } })
    }

    #[test]
    fn needing_you_says_which_tool_and_nothing_else() {
        let n = decide_notice(&event("needs_approval", json!({ "tool": "browser.tabs", "arguments": { "secret": "x" }, "request_id": 1, "call_id": "k" })), &prefs(), false).unwrap();
        assert_eq!((n.kind, n.title.as_str(), n.body.as_str(), n.conversation.as_deref(), n.silent), ("needs-you", "Mobius needs you", "It is waiting to use browser.tabs.", Some("c-main-abc"), false));
        assert!(!n.to_json().to_string().contains("secret"));
    }

    #[test]
    fn a_question_is_told_as_needing_you_without_the_question() {
        let n = decide_notice(&event("question", json!({ "call_id": "q", "question": "Book the Casa Amora for $5,420?", "choices": [] })), &prefs(), false).unwrap();
        assert_eq!((n.kind, n.title.as_str(), n.body.as_str()), ("needs-you", "Mobius needs you", "It has a question for you."));
        assert!(!n.to_json().to_string().contains("Casa"));
        let mut off = prefs();
        off["notifyNeedsYou"] = json!(false);
        assert_eq!(decide_notice(&event("question", json!({ "call_id": "q", "question": "?", "choices": [] })), &off, false), None);
    }

    #[test]
    fn finishing_and_failing_are_told_without_the_reason() {
        let done = decide_notice(&event("done", json!({})), &prefs(), false).unwrap();
        assert_eq!((done.title.as_str(), done.body.as_str()), ("Mobius finished", "Your request is done."));
        let failed = decide_notice(&event("failed", json!({ "message": "the key sk-123 was rejected" })), &prefs(), false).unwrap();
        assert_eq!(failed.title, "Mobius stopped");
        assert!(!failed.to_json().to_string().contains("sk-123"));
    }

    #[test]
    fn nothing_is_said_while_a_window_has_the_focus_or_for_other_events_or_when_the_kind_is_off() {
        assert_eq!(decide_notice(&event("done", json!({})), &prefs(), true), None);
        for kind in ["message", "tool_call", "tool_result", "cancelled"] {
            assert_eq!(decide_notice(&event(kind, json!({ "text": "x", "call_id": "k", "name": "n", "is_error": false })), &prefs(), false), None, "{kind}");
        }
        assert_eq!(decide_notice(&json!({ "method": "agent.delta", "params": { "conversation": "c", "turn": 1, "text": "x" } }), &prefs(), false), None);
        let mut off = prefs();
        off["notifyNeedsYou"] = json!(false);
        assert_eq!(decide_notice(&event("needs_approval", json!({ "tool": "t" })), &off, false), None);
        assert!(decide_notice(&event("done", json!({})), &off, false).is_some(), "the other kind is unaffected");
        off["notifyFinished"] = json!(false);
        assert_eq!(decide_notice(&event("done", json!({})), &off, false), None);
        assert_eq!(decide_notice(&event("failed", json!({ "message": "m" })), &off, false), None);
    }

    #[test]
    fn muting_makes_notices_silent() {
        let mut quiet = prefs();
        quiet["muteSounds"] = json!(true);
        assert!(decide_notice(&event("done", json!({})), &quiet, false).unwrap().silent);
    }

    fn entry(state: &str, name: &str) -> Value {
        json!({ "id": "dl-1", "name": name, "state": state })
    }

    #[test]
    fn a_download_is_announced_once_when_it_goes_from_running_to_done() {
        let n = decide_download_notice(Some(&entry("downloading", "file.txt")), &entry("done", "file.txt"), &prefs(), false).unwrap();
        assert_eq!((n.kind, n.title.as_str(), n.body.as_str(), n.conversation), ("download", "Download finished", "file.txt", None));
        assert_eq!(decide_download_notice(Some(&entry("done", "file.txt")), &entry("done", "file.txt"), &prefs(), false), None, "already done");
        assert_eq!(decide_download_notice(None, &entry("done", "file.txt"), &prefs(), false), None, "never seen running");
        assert_eq!(decide_download_notice(Some(&entry("downloading", "f")), &entry("failed", "f"), &prefs(), false), None);
        assert_eq!(decide_download_notice(Some(&entry("downloading", "f")), &entry("done", "f"), &prefs(), true), None, "focused");
        let mut off = prefs();
        off["notifyDownloads"] = json!(false);
        assert_eq!(decide_download_notice(Some(&entry("downloading", "f")), &entry("done", "f"), &off, false), None);
    }

    #[test]
    fn a_long_download_name_is_shortened() {
        let long = "n".repeat(200);
        let n = decide_download_notice(Some(&entry("downloading", &long)), &entry("done", &long), &prefs(), false).unwrap();
        assert_eq!(n.body.chars().count(), 80);
        assert!(n.body.ends_with('…'));
    }

    #[test]
    fn lists_are_compared_by_id() {
        let m = by_id(&json!([{ "id": "dl-1", "state": "done" }, { "id": "dl-2" }, { "name": "no id" }, 5]));
        assert_eq!(m.keys().cloned().collect::<Vec<_>>(), vec!["dl-1", "dl-2"]);
    }
}
