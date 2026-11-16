//! `agent.ask_each`: many small questions to a model at once, inside a turn, each answer passed on as it lands.
//!
//! An app's tool uses it to sort many things one by one (Mail's unread mail): one short call per item, run a few at
//! a time on worker threads. No tools are offered to these calls; their answers are text for the tool to read.
use std::collections::{HashMap, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use mobius_agent::message::Message;
use mobius_agent::provider::{ChatRequest, NO_REASONING, Provider, ProviderError, Usage};
use serde::Deserialize;

/// How many calls run at once when the caller does not say. Tunable; `MOST_AT_ONCE` is the most a caller may ask for.
pub const AT_ONCE: usize = 6;
/// With the Claude subscription each call starts its own Claude Code process (two to three seconds of it start-up), so
/// a whole inbox needs many at once to stay quick: 40 mails take 4 rounds at 10 (about 11 s), 2 at 20 (about 6 s).
pub const MOST_AT_ONCE: usize = 24;
pub const MOST_ITEMS: usize = 200;
const MOST_PROMPT_CHARS: usize = 8_000;
const MOST_SYSTEM_CHARS: usize = 8_000;
const MOST_ID_CHARS: usize = 64;
const DEFAULT_MAX_TOKENS: u32 = 400;
const MOST_MAX_TOKENS: u32 = 4_096;
/// How much of an answer's error is passed on.
const MOST_ERROR_CHARS: usize = 300;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AskEachParams {
    /// Chosen by the caller, so its answers can be told apart from the moment the first one lands.
    pub job: String,
    /// The conversation whose turn asks: cancelling that turn stops these calls too, and usage is counted to it.
    pub conversation: String,
    #[serde(default)]
    pub system: String,
    pub items: Vec<AskItem>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Ask the quick model (the chat model steps in when it cannot). Off: the chat model.
    #[serde(default = "yes")]
    pub quick: bool,
    #[serde(default)]
    pub at_once: Option<usize>,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct AskItem {
    pub id: String,
    pub prompt: String,
}

fn plain_name(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= MOST_ID_CHARS && !s.chars().any(char::is_control)
}

impl AskEachParams {
    /// What is wrong with the request, said for the caller.
    pub fn check(&self) -> Result<(), &'static str> {
        if !plain_name(&self.job) || !plain_name(&self.conversation) {
            return Err("job and conversation must be names of 1 to 64 characters");
        }
        if self.items.is_empty() || self.items.len() > MOST_ITEMS {
            return Err("items must be 1 to 200 questions");
        }
        if self.items.iter().any(|i| {
            !plain_name(&i.id)
                || i.prompt.trim().is_empty()
                || i.prompt.chars().count() > MOST_PROMPT_CHARS
        }) {
            return Err(
                "each item needs an id of 1 to 64 characters and a prompt of 1 to 8000 characters",
            );
        }
        let mut seen = std::collections::HashSet::new();
        if !self.items.iter().all(|i| seen.insert(i.id.as_str())) {
            return Err("item ids must differ");
        }
        if self.system.chars().count() > MOST_SYSTEM_CHARS {
            return Err("the instructions are too long");
        }
        if self
            .max_tokens
            .is_some_and(|m| m == 0 || m > MOST_MAX_TOKENS)
        {
            return Err("max_tokens must be from 1 to 4096");
        }
        if self.at_once.is_some_and(|n| n == 0 || n > MOST_AT_ONCE) {
            return Err("at_once must be from 1 to 24");
        }
        Ok(())
    }

    pub fn request_for(&self, model: &str, item: &AskItem) -> ChatRequest {
        ChatRequest {
            model: model.to_owned(),
            system: self.system.clone(),
            messages: vec![Message::user(item.prompt.clone())],
            tools: Vec::new(),
            effort: Some(NO_REASONING.to_owned()),
            max_tokens: Some(self.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS)),
        }
    }
}

/// The jobs running, by job: their conversation and their stop switch.
pub type Running = Arc<Mutex<HashMap<String, (String, Arc<AtomicBool>)>>>;

/// Stop every job a conversation started. Returns how many were stopped.
pub fn stop_conversation(running: &Running, conversation: &str) -> usize {
    let jobs = running
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    jobs.values()
        .filter(|(c, _)| c == conversation)
        .map(|(_, stop)| stop.store(true, Ordering::SeqCst))
        .count()
}

pub fn stop_job(running: &Running, job: &str) -> bool {
    let jobs = running
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    jobs.get(job)
        .inspect(|(_, stop)| stop.store(true, Ordering::SeqCst))
        .is_some()
}

/// One item's answer.
pub enum Answer {
    Text(String, Option<Usage>),
    Failed(String),
}

/// Ask every item, `at_once` at a time, and give each answer to `each` as it lands (from the worker threads, so
/// `each` must be shareable). Returns once all are answered, or once `stop` is set and the calls running have ended:
/// items not yet asked then are not asked at all. Returns how many were asked.
pub fn ask_all(
    provider: Arc<dyn Provider>,
    requests: Vec<(String, ChatRequest)>,
    at_once: usize,
    stop: &Arc<AtomicBool>,
    each: &(dyn Fn(&str, Answer) + Sync),
) -> usize {
    let queue = Mutex::new(requests.into_iter().collect::<VecDeque<_>>());
    let asked = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..at_once.max(1) {
            scope.spawn(|| {
                loop {
                    if stop.load(Ordering::SeqCst) {
                        return;
                    }
                    let Some((id, request)) = queue
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .pop_front()
                    else {
                        return;
                    };
                    asked.fetch_add(1, Ordering::SeqCst);
                    let result = catch_unwind(AssertUnwindSafe(|| {
                        provider.complete(&request, &mut |_| !stop.load(Ordering::SeqCst))
                    }))
                    .unwrap_or_else(|_| {
                        Err(ProviderError::Protocol(
                            "the model connection failed unexpectedly".to_owned(),
                        ))
                    });
                    match result {
                        Ok(done) => each(&id, Answer::Text(done.text, done.usage)),
                        Err(e) => each(
                            &id,
                            Answer::Failed(e.to_string().chars().take(MOST_ERROR_CHARS).collect()),
                        ),
                    }
                }
            });
        }
    });
    asked.into_inner()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use mobius_agent::provider::{Completion, StopReason};
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    /// Answers each question with its own text, after a pause, counting how many run at once.
    struct Echo {
        now: AtomicUsize,
        most: AtomicUsize,
        fail: &'static str,
    }
    impl Provider for Echo {
        fn complete(
            &self,
            request: &ChatRequest,
            on_text: &mut dyn FnMut(&str) -> bool,
        ) -> Result<Completion, ProviderError> {
            let n = self.now.fetch_add(1, Ordering::SeqCst) + 1;
            self.most.fetch_max(n, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(30));
            self.now.fetch_sub(1, Ordering::SeqCst);
            let prompt = match &request.messages[0] {
                Message::User { text, .. } => text.clone(),
                _ => String::new(),
            };
            if prompt == self.fail {
                return Err(ProviderError::Http {
                    status: 500,
                    message: "down".into(),
                });
            }
            if !on_text(&prompt) {
                return Err(ProviderError::Cancelled);
            }
            Ok(Completion {
                text: format!("re: {prompt}"),
                tool_calls: Vec::new(),
                stop: StopReason::EndTurn,
                usage: None,
            })
        }
    }

    fn params(n: usize) -> AskEachParams {
        AskEachParams {
            job: "j".into(),
            conversation: "c".into(),
            system: "Sort it.".into(),
            items: (0..n)
                .map(|i| AskItem {
                    id: format!("m{i}"),
                    prompt: format!("mail {i}"),
                })
                .collect(),
            max_tokens: None,
            quick: true,
            at_once: None,
        }
    }

    #[test]
    fn every_item_is_answered_a_few_at_a_time() {
        let echo = Arc::new(Echo {
            now: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
            fail: "mail 3",
        });
        let p = params(20);
        let requests = p
            .items
            .iter()
            .map(|i| (i.id.clone(), p.request_for("quick", i)))
            .collect();
        let got = Mutex::new(Vec::new());
        let asked = ask_all(
            echo.clone(),
            requests,
            4,
            &Arc::new(AtomicBool::new(false)),
            &|id, a| {
                got.lock().unwrap().push((
                    id.to_owned(),
                    match a {
                        Answer::Text(t, _) => Ok(t),
                        Answer::Failed(e) => Err(e),
                    },
                ));
            },
        );
        assert_eq!(asked, 20);
        let mut got = got.into_inner().unwrap();
        got.sort();
        assert_eq!(got.len(), 20);
        assert_eq!(
            got.iter().find(|(id, _)| id == "m7").unwrap().1,
            Ok("re: mail 7".to_owned())
        );
        assert!(
            got.iter()
                .find(|(id, _)| id == "m3")
                .unwrap()
                .1
                .as_ref()
                .is_err_and(|e| e.contains("500")),
            "a failure is that item's answer"
        );
        let most = echo.most.load(Ordering::SeqCst);
        assert!(most > 1 && most <= 4, "ran {most} at once");
    }

    #[test]
    fn stopping_asks_no_more() {
        let echo = Arc::new(Echo {
            now: AtomicUsize::new(0),
            most: AtomicUsize::new(0),
            fail: "",
        });
        let p = params(50);
        let requests = p
            .items
            .iter()
            .map(|i| (i.id.clone(), p.request_for("quick", i)))
            .collect();
        let stop = Arc::new(AtomicBool::new(false));
        let answered = AtomicUsize::new(0);
        let asked = ask_all(echo, requests, 2, &stop, &|_, _| {
            if answered.fetch_add(1, Ordering::SeqCst) == 3 {
                stop.store(true, Ordering::SeqCst);
            }
        });
        assert!(asked < 10, "asked {asked} after the stop");
    }

    #[test]
    fn a_request_is_small_and_checked() {
        let p = params(2);
        let r = p.request_for("quick", &p.items[0]);
        assert!(r.tools.is_empty());
        assert_eq!(r.max_tokens, Some(DEFAULT_MAX_TOKENS));
        assert_eq!(r.system, "Sort it.");
        assert!(p.check().is_ok());
        let mut twice = params(2);
        twice.items[1].id = "m0".into();
        assert!(twice.check().is_err());
        assert!(params(0).check().is_err());
        assert!(params(201).check().is_err());
        let mut many = params(2);
        many.at_once = Some(25);
        assert!(many.check().is_err());
    }

    #[test]
    fn a_conversation_stops_only_its_own_jobs() {
        let running: Running = Arc::default();
        let (a, b) = (
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        running
            .lock()
            .unwrap()
            .insert("j1".into(), ("c1".into(), a.clone()));
        running
            .lock()
            .unwrap()
            .insert("j2".into(), ("c2".into(), b.clone()));
        assert_eq!(stop_conversation(&running, "c1"), 1);
        assert!(a.load(Ordering::SeqCst) && !b.load(Ordering::SeqCst));
        assert!(stop_job(&running, "j2") && b.load(Ordering::SeqCst));
        assert!(!stop_job(&running, "nope"));
    }
}
