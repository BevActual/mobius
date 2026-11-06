//! Keeps the computer awake while the agent is working, if the person asked for that. Waiting for a person's answer is not
//! work, so the computer may sleep then.
use std::collections::HashSet;

/// The operating system's way of stopping the computer sleeping.
pub trait Blocker: Send {
    fn start(&mut self);
    fn stop(&mut self);
}

pub struct KeepAwake {
    blocker: Box<dyn Blocker>,
    working: HashSet<String>,
    enabled: bool,
    held: bool,
}

impl KeepAwake {
    pub fn new(blocker: Box<dyn Blocker>, enabled: bool) -> KeepAwake {
        KeepAwake { blocker, working: HashSet::new(), enabled, held: false }
    }

    pub fn set_enabled(&mut self, on: bool) {
        self.enabled = on;
        self.update();
    }

    /// A checked agent notification (`{method, params}`).
    pub fn note(&mut self, notification: &serde_json::Value) {
        let method = notification.get("method").and_then(serde_json::Value::as_str).unwrap_or("");
        let Some(conversation) = notification.pointer("/params/conversation").and_then(serde_json::Value::as_str) else { return };
        match method {
            "agent.notice" => return, // Only says which model is answering.
            "agent.delta" => {
                self.working.insert(conversation.to_owned());
            }
            _ => match notification.pointer("/params/event/kind").and_then(serde_json::Value::as_str) {
                Some("done" | "failed" | "cancelled" | "needs_approval") => {
                    self.working.remove(conversation);
                }
                _ => {
                    self.working.insert(conversation.to_owned());
                }
            },
        }
        self.update();
    }

    pub fn is_holding(&self) -> bool {
        self.held
    }

    fn update(&mut self) {
        let want = self.enabled && !self.working.is_empty();
        if want && !self.held {
            self.blocker.start();
            self.held = true;
        } else if !want && self.held {
            self.blocker.stop();
            self.held = false;
        }
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        self.enabled = false;
        self.working.clear();
        self.update();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    struct Log(Arc<Mutex<Vec<&'static str>>>);
    impl Blocker for Log {
        fn start(&mut self) {
            self.0.lock().unwrap().push("start");
        }
        fn stop(&mut self) {
            self.0.lock().unwrap().push("stop");
        }
    }

    fn awake(enabled: bool) -> (KeepAwake, Arc<Mutex<Vec<&'static str>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        (KeepAwake::new(Box::new(Log(log.clone())), enabled), log)
    }
    fn delta(c: &str) -> serde_json::Value {
        json!({ "method": "agent.delta", "params": { "conversation": c, "turn": 1, "text": "x" } })
    }
    fn event(c: &str, kind: &str) -> serde_json::Value {
        json!({ "method": "agent.event", "params": { "conversation": c, "turn": 1, "event": { "kind": kind } } })
    }

    #[test]
    fn the_computer_is_held_awake_only_while_enabled_and_working() {
        let (mut a, log) = awake(true);
        a.note(&delta("c1"));
        assert!(a.is_holding());
        a.note(&event("c1", "done"));
        assert!(!a.is_holding());
        assert_eq!(log.lock().unwrap().clone(), vec!["start", "stop"]);
    }

    #[test]
    fn nothing_is_held_while_off_and_the_setting_takes_effect_at_once() {
        let (mut a, log) = awake(false);
        a.note(&delta("c1"));
        assert!(!a.is_holding());
        a.set_enabled(true);
        assert!(a.is_holding(), "work was already going on");
        a.set_enabled(false);
        assert!(!a.is_holding());
        assert_eq!(log.lock().unwrap().clone(), vec!["start", "stop"]);
    }

    #[test]
    fn waiting_for_an_answer_is_not_work_and_several_conversations_share_one_hold() {
        let (mut a, log) = awake(true);
        a.note(&delta("c1"));
        a.note(&delta("c2"));
        a.note(&event("c1", "needs_approval"));
        assert!(a.is_holding(), "the other is still working");
        a.note(&event("c2", "cancelled"));
        assert!(!a.is_holding());
        a.note(&event("c1", "tool_call"));
        assert!(a.is_holding(), "work resumes");
        a.note(&event("c1", "failed"));
        assert_eq!(log.lock().unwrap().clone(), vec!["start", "stop", "start", "stop"]);
    }

    #[test]
    fn notices_and_malformed_notifications_change_nothing() {
        let (mut a, log) = awake(true);
        a.note(&json!({ "method": "agent.notice", "params": { "conversation": "c1", "turn": 1 } }));
        a.note(&json!({ "method": "agent.delta" }));
        a.note(&json!({}));
        assert!(!a.is_holding() && log.lock().unwrap().is_empty());
    }

    #[test]
    fn dropping_lets_go() {
        let (mut a, log) = awake(true);
        a.note(&delta("c1"));
        drop(a);
        assert_eq!(log.lock().unwrap().clone(), vec!["start", "stop"]);
    }
}
