//! Many small questions to the model at once, from inside a tool: the host side of the core's `agent.ask_each`.
//!
//! A tool (Mail's sorting of unread mail) gives a list of short prompts; the core asks the quick model about each,
//! a few at a time, and says each answer as it lands. [`Asks::run`] hands each answer to the tool as it comes and
//! returns them all, in the order they were given, once every one is in (or the time is up).
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// The longest a whole job may take before what has not come is given up on.
pub const MOST_WAIT: Duration = Duration::from_secs(120);

/// Every question's answer, by id, in the order asked.
pub type Answers = Vec<(String, Result<String, String>)>;

/// One question.
#[derive(Debug, Clone)]
pub struct Ask {
    /// The tool's own name for it (a message id), at most 64 characters.
    pub id: String,
    pub prompt: String,
}

/// What a job asks with.
#[derive(Debug, Clone, Default)]
pub struct Job {
    pub conversation: String,
    pub system: String,
    pub asks: Vec<Ask>,
    /// The most each answer may be, in tokens (the core's default is 400).
    pub max_tokens: Option<u32>,
    /// How many run at once (the core's default is 6, at most 10).
    pub at_once: Option<usize>,
}

/// The answers the core is still sending, by job.
#[derive(Default)]
pub struct Asks {
    waiting: Mutex<HashMap<String, Sender<Value>>>,
    next: AtomicU64,
}

impl Asks {
    /// An `agent.asked` or `agent.asked_all` from the core. Returns whether it was one.
    pub fn on_notification(&self, method: &str, params: &Value) -> bool {
        if method != "agent.asked" && method != "agent.asked_all" {
            return false;
        }
        let job = params.get("job").and_then(Value::as_str).unwrap_or("");
        if let Some(sender) = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(job)
        {
            let _ = sender.send(json!({ "method": method, "params": params }));
        }
        true
    }

    /// Ask every question. `call` sends a request to the core; `each` gets each answer as it lands (`Err` when that
    /// one failed). Returns every question's answer in the order given; one that never came says so.
    pub fn run(
        &self,
        job: &Job,
        call: &dyn Fn(&str, Value) -> Result<Value, String>,
        each: &mut dyn FnMut(&str, &Result<String, String>),
        wait: Duration,
    ) -> Result<crate::ask_each::Answers, String> {
        let name = format!("ask-{}", self.next.fetch_add(1, Ordering::SeqCst) + 1);
        let (sender, answers) = channel();
        // Waited for before the core is asked, so not even the first answer can be missed.
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(name.clone(), sender);
        let _forget = Forget(self, &name);
        let items: Vec<Value> = job
            .asks
            .iter()
            .map(|a| json!({ "id": a.id, "prompt": a.prompt }))
            .collect();
        let mut params = json!({ "job": name, "conversation": job.conversation, "system": job.system, "items": items });
        if let Some(n) = job.max_tokens {
            params["max_tokens"] = json!(n);
        }
        if let Some(n) = job.at_once {
            params["at_once"] = json!(n);
        }
        call("agent.ask_each", params)?;
        let mut got: HashMap<String, Result<String, String>> = HashMap::new();
        let until = Instant::now() + wait;
        loop {
            let Some(left) = until.checked_duration_since(Instant::now()) else {
                let _ = call("agent.ask_cancel", json!({ "job": name }));
                break;
            };
            let Ok(message) = answers.recv_timeout(left) else {
                continue;
            };
            let p = &message["params"];
            if message["method"] == "agent.asked_all" {
                break;
            }
            let Some(id) = p.get("id").and_then(Value::as_str) else {
                continue;
            };
            let answer = match (
                p.get("text").and_then(Value::as_str),
                p.get("error").and_then(Value::as_str),
            ) {
                (Some(text), _) => Ok(text.to_owned()),
                (None, error) => Err(error.unwrap_or("no answer").to_owned()),
            };
            each(id, &answer);
            got.insert(id.to_owned(), answer);
        }
        Ok(job
            .asks
            .iter()
            .map(|a| {
                (
                    a.id.clone(),
                    got.remove(&a.id)
                        .unwrap_or_else(|| Err("no answer in time".to_owned())),
                )
            })
            .collect())
    }
}

/// Stops waiting for a job's answers however `run` ends.
struct Forget<'a>(&'a Asks, &'a str);
impl Drop for Forget<'_> {
    fn drop(&mut self) {
        self.0
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(self.1);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn job(n: usize) -> Job {
        Job {
            conversation: "c1".into(),
            system: "Sort.".into(),
            asks: (0..n)
                .map(|i| Ask {
                    id: format!("m{i}"),
                    prompt: format!("mail {i}"),
                })
                .collect(),
            ..Job::default()
        }
    }

    #[test]
    fn answers_come_back_in_the_order_asked_and_each_as_it_lands() {
        let asks = Arc::new(Asks::default());
        let core = asks.clone();
        // A pretend core: answers on another thread, out of order, one failing, before the request has returned.
        let call = move |method: &str, params: Value| {
            assert_eq!(method, "agent.ask_each");
            assert_eq!(params["items"].as_array().unwrap().len(), 3);
            let (core, job) = (core.clone(), params["job"].clone());
            std::thread::spawn(move || {
                for (id, answer) in [
                    ("m2", json!({ "text": "later" })),
                    ("m0", json!({ "text": "reply" })),
                    ("m1", json!({ "error": "down" })),
                ] {
                    let mut p = answer;
                    p["job"] = job.clone();
                    p["id"] = json!(id);
                    assert!(core.on_notification("agent.asked", &p));
                }
                core.on_notification("agent.asked_all", &json!({ "job": job }));
            });
            Ok(json!({}))
        };
        let mut landed = Vec::new();
        let all = asks
            .run(
                &job(3),
                &call,
                &mut |id, _| landed.push(id.to_owned()),
                MOST_WAIT,
            )
            .unwrap();
        assert_eq!(landed, ["m2", "m0", "m1"]);
        assert_eq!(
            all,
            [
                ("m0".into(), Ok("reply".into())),
                ("m1".into(), Err("down".into())),
                ("m2".into(), Ok("later".into()))
            ]
        );
        assert!(
            asks.waiting.lock().unwrap().is_empty(),
            "the job is forgotten"
        );
    }

    #[test]
    fn what_never_comes_is_said_and_the_job_is_stopped() {
        let asks = Asks::default();
        let calls = Mutex::new(Vec::new());
        let call = |method: &str, _: Value| {
            calls.lock().unwrap().push(method.to_owned());
            Ok(json!({}))
        };
        let all = asks
            .run(&job(2), &call, &mut |_, _| {}, Duration::from_millis(50))
            .unwrap();
        assert!(
            all.iter()
                .all(|(_, a)| a.as_ref().is_err_and(|e| e.contains("in time")))
        );
        assert_eq!(
            *calls.lock().unwrap(),
            ["agent.ask_each", "agent.ask_cancel"]
        );
    }

    #[test]
    fn a_refusal_from_the_core_is_the_answer() {
        let asks = Asks::default();
        let call = |_: &str, _: Value| Err("no model is set up".to_owned());
        assert_eq!(
            asks.run(&job(1), &call, &mut |_, _| {}, MOST_WAIT),
            Err("no model is set up".to_owned())
        );
        assert!(!asks.on_notification("agent.event", &json!({})));
    }
}
