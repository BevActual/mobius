//! Conversations and turns, independent of threads and I/O.
//!
//! The host decides what should happen next and returns it as a list of things for the caller to do: call the model
//! on a worker thread, or send a notification to the window. Nothing in here blocks, so the process around it stays
//! responsive while the model is thinking or a person is deciding.
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use mobius_core::core::Core;
use mobius_core::model::Principal;
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::compaction::Compaction;
use crate::conversations::{ConversationStore, MemoryStore, valid_conversation_id};
use crate::engine::{Engine, EngineConfig, Step, Turn, TurnSetup};
use crate::message::Message;
use crate::provider::{ChatRequest, Completion, ProviderError};

/// The most a message may hold, including anything the person attached to it.
pub const MAX_MESSAGE_CHARS: usize = 100_000;
pub const MAX_CONVERSATIONS: usize = 64;
pub const DEFAULT_MAX_STEPS: u32 = 25;
/// The transcript limit. The model sees a shortened view once a conversation outgrows its window, so this only
/// bounds what is kept on disk and shown.
pub const MAX_HISTORY_MESSAGES: usize = 4000;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("no model is set up yet")]
    NotConfigured,
    #[error("this conversation is already working on something")]
    Busy,
    #[error("there is nothing to send")]
    Empty,
    #[error("that message is too long")]
    TooLong,
    #[error("this conversation is full; start a new one")]
    ConversationFull,
    #[error("there are too many saved conversations; delete an old one")]
    TooManyConversations,
    #[error("that is not a valid conversation id")]
    InvalidConversation,
    #[error("nothing in this conversation is waiting for that answer")]
    NotWaiting,
    #[error("there is nothing to take back")]
    NothingToRewind,
}

/// A tool call that is waiting for a person to allow or decline it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Waiting {
    #[ts(type = "number")]
    pub request_id: u64,
    pub call_id: String,
    pub tool: String,
    #[ts(type = "unknown")]
    pub arguments: Value,
    pub once_only: bool,
    /// The request came from something Mobius read, not from the person.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<String>,
}

/// A question the model put to the person, still open.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct OpenQuestion {
    pub call_id: String,
    pub question: String,
    pub choices: Vec<String>,
}

pub enum Out {
    /// Call the model on a worker thread, stream text to `Host::text`, and report with `Host::model_result`.
    /// The worker should stop streaming when `cancel` becomes true.
    CallModel { turn_id: u64, request: ChatRequest, cancel: Arc<AtomicBool> },
    /// Ask the reviewer model about a question before the person is asked (smart approvals): call it on a worker
    /// thread and report with `Host::review_result`. Nothing is streamed.
    Review { turn_id: u64, request_id: u64, request: ChatRequest, cancel: Arc<AtomicBool> },
    /// Ask the application to run an allowed tool, and report with `Host::tool_result`.
    RunTool { turn_id: u64, call_id: String, name: String, arguments: Value },
    /// A complete JSON-RPC notification for the window.
    Notify(Value),
}

struct Active {
    conversation: String,
    turn: Turn,
    cancel: Arc<AtomicBool>,
    /// The person took over: the next step waits here until they hand back.
    theirs: bool,
    held: Option<Step>,
}

pub struct Host {
    principal: Principal,
    engine: Option<Engine>,
    histories: HashMap<String, Vec<Message>>,
    updated: HashMap<String, u64>,
    active: HashMap<u64, Active>,
    next_turn: u64,
    store: Box<dyn ConversationStore>,
    clock: Box<dyn Fn() -> u64 + Send>,
    effort: Option<String>,
    context_window: Option<usize>,
    compactions: HashMap<String, Compaction>,
}

/// What the window needs to list a conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ConversationInfo {
    pub id: String,
    pub title: String,
    #[ts(type = "number")]
    pub updated_ms: u64,
    #[ts(type = "number")]
    pub messages: usize,
    pub activity: Activity,
    /// Questions this conversation is waiting for a person to answer.
    #[ts(type = "number")]
    pub waiting: usize,
}

/// What a conversation is doing right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Activity {
    Idle,
    Working,
    NeedsYou,
}

const MAX_TITLE_CHARS: usize = 60;

fn title_of(messages: &[Message]) -> String {
    let first = messages.iter().find_map(|m| match m {
        Message::User { text, .. } => text.trim().lines().next().map(str::trim).filter(|line| !line.is_empty()),
        _ => None,
    });
    match first {
        None => "New conversation".to_owned(),
        Some(line) if line.chars().count() <= MAX_TITLE_CHARS => line.to_owned(),
        Some(line) => format!("{}\u{2026}", line.chars().take(MAX_TITLE_CHARS).collect::<String>()),
    }
}

fn system_millis() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn notification(method: &str, params: Value) -> Out {
    Out::Notify(serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params }))
}

impl Host {
    /// A host that remembers conversations only until it is dropped.
    pub fn new(principal: Principal) -> Self {
        Self::with_store(principal, Box::new(MemoryStore::default()), Box::new(system_millis))
    }

    /// A host that saves each finished conversation to `store` and starts with what is already in it.
    pub fn with_store(principal: Principal, store: Box<dyn ConversationStore>, clock: Box<dyn Fn() -> u64 + Send>) -> Self {
        let mut histories = HashMap::new();
        let mut updated = HashMap::new();
        let mut compactions = HashMap::new();
        match store.load_all(MAX_CONVERSATIONS) {
            Ok(saved) => {
                for conversation in saved {
                    updated.insert(conversation.id.clone(), conversation.updated_ms);
                    if let Some(c) = conversation.compaction {
                        compactions.insert(conversation.id.clone(), c);
                    }
                    histories.insert(conversation.id, conversation.messages);
                }
            }
            Err(error) => eprintln!("mobius-agent: cannot load saved conversations: {error}"),
        }
        Host { principal, engine: None, histories, updated, active: HashMap::new(), next_turn: 1, store, clock, effort: None, context_window: None, compactions }
    }

    pub fn configure(&mut self, model: &str, system: &str) {
        self.configure_with(model, system, DEFAULT_MAX_STEPS);
    }

    /// Like `configure`, with the most model calls one request may use.
    pub fn configure_with(&mut self, model: &str, system: &str, max_steps: u32) {
        let mut engine = Engine::new(EngineConfig { model: model.to_owned(), system: system.to_owned(), max_steps, principal: self.principal.clone() });
        engine.set_effort(self.effort.clone());
        engine.set_context_window(self.context_window);
        self.engine = Some(engine);
    }

    /// How hard the model is asked to think: `low`, `medium` or `high`, or none for the model's own way. Kept across a new setup.
    pub fn set_effort(&mut self, effort: Option<&str>) {
        self.effort = effort.map(str::to_owned);
        if let Some(engine) = self.engine.as_mut() {
            engine.set_effort(self.effort.clone());
        }
    }

    /// The model's context window in tokens, when known. Kept across a new setup.
    pub fn set_context_window(&mut self, tokens: Option<usize>) {
        self.context_window = tokens;
        if let Some(engine) = self.engine.as_mut() {
            engine.set_context_window(tokens);
        }
    }

    /// How a conversation is shortened for the model, if it is.
    pub fn compaction(&self, conversation: &str) -> Option<Compaction> {
        match self.active.values().find(|a| a.conversation == conversation) {
            Some(active) => active.turn.compaction().cloned(),
            None => self.compactions.get(conversation).cloned(),
        }
    }

    pub fn is_configured(&self) -> bool {
        self.engine.is_some()
    }

    pub fn send(&mut self, core: &Core, conversation: &str, text: &str) -> Result<(u64, Vec<Out>), HostError> {
        self.send_with(core, conversation, text, TurnSetup::default())
    }

    /// Like `send`, for a conversation that uses its own instructions or model (a bot's).
    pub fn send_with(&mut self, core: &Core, conversation: &str, text: &str, setup: TurnSetup) -> Result<(u64, Vec<Out>), HostError> {
        let engine = self.engine.as_ref().ok_or(HostError::NotConfigured)?;
        if !valid_conversation_id(conversation) {
            return Err(HostError::InvalidConversation);
        }
        if text.trim().is_empty() {
            return Err(HostError::Empty);
        }
        if text.chars().count() > MAX_MESSAGE_CHARS {
            return Err(HostError::TooLong);
        }
        if self.is_busy(conversation) {
            return Err(HostError::Busy);
        }
        if !self.histories.contains_key(conversation) && self.histories.len() >= MAX_CONVERSATIONS {
            return Err(HostError::TooManyConversations);
        }
        let history = self.histories.get(conversation).cloned().unwrap_or_default();
        if history.len() + 2 > MAX_HISTORY_MESSAGES {
            return Err(HostError::ConversationFull);
        }
        let turn_id = self.next_turn;
        self.next_turn += 1;
        let compaction = self.compactions.get(conversation).cloned();
        let (turn, step) = engine.start_from(core, history, compaction, text, turn_id, setup);
        let mut outs = Vec::new();
        self.settle(Active { conversation: conversation.to_owned(), turn, cancel: Arc::new(AtomicBool::new(false)), theirs: false, held: None }, step, &mut outs);
        Ok((turn_id, outs))
    }

    /// The conversation a running turn belongs to, for an application tool that works per task (sign-ins).
    #[must_use]
    pub fn conversation_of(&self, turn_id: u64) -> Option<&str> {
        self.active.get(&turn_id).map(|a| a.conversation.as_str())
    }

    pub fn text(&mut self, turn_id: u64, text: &str) -> Vec<Out> {
        match self.active.get(&turn_id) {
            // A summary being written is not part of the answer.
            Some(active) if active.turn.is_summarizing() => Vec::new(),
            Some(active) => vec![notification("agent.delta", serde_json::json!({ "conversation": active.conversation, "turn": turn_id, "text": text }))],
            None => Vec::new(),
        }
    }

    /// Something the person should know about a turn that is running, for example that a second model took over.
    pub fn notice(&mut self, turn_id: u64, kind: &str, model: &str, why: &str) -> Vec<Out> {
        match self.active.get(&turn_id) {
            Some(active) => vec![notification("agent.notice", serde_json::json!({ "conversation": active.conversation, "turn": turn_id, "kind": kind, "model": model, "why": why }))],
            None => Vec::new(),
        }
    }

    pub fn model_result(&mut self, core: &mut Core, turn_id: u64, result: Result<Completion, ProviderError>) -> Vec<Out> {
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Vec::new() };
        let step = engine.on_model(&mut active.turn, core, result);
        let mut outs = Vec::new();
        self.settle(active, step, &mut outs);
        outs
    }

    /// The reviewer model answered about question `request_id`.
    pub fn review_result(&mut self, core: &mut Core, turn_id: u64, request_id: u64, result: Result<Completion, ProviderError>) -> Vec<Out> {
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Vec::new() };
        let step = engine.on_review(&mut active.turn, core, request_id, result);
        let mut outs = Vec::new();
        self.settle(active, step, &mut outs);
        outs
    }

    /// The application finished running a tool it was asked to run.
    pub fn tool_result(&mut self, core: &mut Core, turn_id: u64, call_id: &str, result: Result<String, String>) -> Vec<Out> {
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Vec::new() };
        let step = engine.on_tool_result(&mut active.turn, core, call_id, result);
        let mut outs = Vec::new();
        self.settle(active, step, &mut outs);
        outs
    }

    /// The person answered the model's question `call_id` in this conversation.
    pub fn answer(&mut self, core: &mut Core, conversation: &str, call_id: &str, text: &str) -> Result<Vec<Out>, HostError> {
        let turn_id = self.active.iter().find(|(_, a)| a.conversation == conversation && a.turn.asking().is_some_and(|c| c.id == call_id)).map(|(id, _)| *id).ok_or(HostError::NotWaiting)?;
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Err(HostError::NotWaiting) };
        let step = engine.on_answer(&mut active.turn, core, call_id, text);
        let mut outs = Vec::new();
        self.settle(active, step, &mut outs);
        Ok(outs)
    }

    /// The question the model is waiting on in this conversation, so a window that opens later can show it.
    pub fn question(&self, conversation: &str) -> Option<OpenQuestion> {
        self.active.values().filter(|a| a.conversation == conversation).find_map(|a| {
            let call = a.turn.asking()?;
            let question = call.arguments.get("question")?.as_str()?.trim().to_owned();
            let choices = call.arguments.get("choices").and_then(Value::as_array).map(|l| l.iter().filter_map(|c| c.as_str().map(|c| c.trim().to_owned())).collect()).unwrap_or_default();
            Some(OpenQuestion { call_id: call.id.clone(), question, choices })
        })
    }

    /// Look for answers to questions that turns are waiting on, and continue those turns.
    ///
    /// The core merges identical questions into one, so several turns can wait on the same answer. Each answer is
    /// collected once and given to every turn waiting on it.
    pub fn poll(&mut self, core: &mut Core) -> Vec<Out> {
        let mut outs = Vec::new();
        let mut request_ids: Vec<u64> = self.active.values().filter(|a| !a.turn.is_reviewing()).filter_map(|a| a.turn.parked_request()).collect();
        request_ids.sort_unstable();
        request_ids.dedup();
        for request_id in request_ids {
            let Some(approved) = core.take_resolution(request_id) else { continue };
            let mut waiting: Vec<u64> = self.active.iter().filter(|(_, a)| !a.turn.is_reviewing() && a.turn.parked_request() == Some(request_id)).map(|(id, _)| *id).collect();
            waiting.sort_unstable();
            for turn_id in waiting {
                let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { continue };
                let step = engine.on_approval(&mut active.turn, core, request_id, approved);
                self.settle(active, step, &mut outs);
            }
        }
        outs
    }

    /// The person takes over a running task: Mobius stops at the next safe point (before its next model request or
    /// tool call) and the apps are theirs until they hand back.
    pub fn take_over(&mut self, conversation: &str) -> Result<Vec<Out>, HostError> {
        let turn_id = self.active.iter().find(|(_, a)| a.conversation == conversation).map(|(id, _)| *id).ok_or(HostError::NotWaiting)?;
        let Some(mut active) = self.active.remove(&turn_id) else { return Err(HostError::NotWaiting) };
        let mut outs = Vec::new();
        if active.theirs {
            self.active.insert(turn_id, active);
            return Ok(outs);
        }
        active.theirs = true;
        active.turn.note_control(true);
        self.settle(active, Step::Idle, &mut outs);
        Ok(outs)
    }

    /// The person hands back: Mobius reads what is there again, then goes on from where it stopped.
    pub fn hand_back(&mut self, core: &mut Core, conversation: &str) -> Result<Vec<Out>, HostError> {
        let turn_id = self.active.iter().find(|(_, a)| a.conversation == conversation && a.theirs).map(|(id, _)| *id).ok_or(HostError::NotWaiting)?;
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Err(HostError::NotWaiting) };
        active.theirs = false;
        active.turn.note_control(false);
        let step = engine.hand_back(&mut active.turn, core, active.held.take());
        let mut outs = Vec::new();
        self.settle(active, step, &mut outs);
        Ok(outs)
    }

    /// Whether the person has control of this conversation's task, and where Mobius stopped.
    #[must_use]
    pub fn control(&self, conversation: &str) -> Option<(u32, Option<u32>)> {
        self.active.values().find(|a| a.conversation == conversation && a.theirs).map(|a| a.turn.progress())
    }

    pub fn cancel(&mut self, core: &mut Core, conversation: &str) -> Vec<Out> {
        let Some(turn_id) = self.active.iter().find(|(_, a)| a.conversation == conversation).map(|(id, _)| *id) else { return Vec::new() };
        let (Some(engine), Some(mut active)) = (self.engine.as_ref(), self.active.remove(&turn_id)) else { return Vec::new() };
        active.cancel.store(true, Ordering::SeqCst);
        match active.turn.parked_request() {
            Some(request_id) if self.active.values().any(|other| other.turn.parked_request() == Some(request_id)) => engine.cancel_keeping_question(&mut active.turn),
            _ => engine.cancel(&mut active.turn, core),
        }
        let mut outs = Vec::new();
        self.settle(active, Step::Done, &mut outs);
        outs
    }

    /// Every conversation, most recently updated first. A conversation with a turn in progress is included.
    pub fn conversations(&self) -> Vec<ConversationInfo> {
        let mut ids: Vec<&String> = self.histories.keys().collect();
        for active in self.active.values() {
            if !self.histories.contains_key(&active.conversation) {
                ids.push(&active.conversation);
            }
        }
        let mut list: Vec<ConversationInfo> = ids
            .into_iter()
            .map(|id| {
                let messages = self.history(id);
                ConversationInfo { id: id.clone(), title: title_of(&messages), updated_ms: self.updated.get(id).copied().unwrap_or_else(|| (self.clock)()), messages: messages.len(), activity: self.activity(id), waiting: self.waiting(id).len() }
            })
            .collect();
        list.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms).then_with(|| a.id.cmp(&b.id)));
        list
    }

    /// Take back the last exchange: the last message from the person and everything after it. Returns that message,
    /// so it can be sent again or edited. Not while the conversation is working.
    pub fn rewind(&mut self, conversation: &str) -> Result<String, HostError> {
        if !valid_conversation_id(conversation) {
            return Err(HostError::InvalidConversation);
        }
        if self.is_busy(conversation) {
            return Err(HostError::Busy);
        }
        let history = self.histories.get_mut(conversation).ok_or(HostError::NothingToRewind)?;
        let at = history.iter().rposition(|m| matches!(m, Message::User { .. })).ok_or(HostError::NothingToRewind)?;
        let Message::User { text, .. } = history[at].clone() else { return Err(HostError::NothingToRewind) };
        history.truncate(at);
        // A summary that covers what was taken back no longer describes the conversation.
        if self.compactions.get(conversation).is_some_and(|c| c.covers >= at) {
            self.compactions.remove(conversation);
            if let Err(error) = self.store.save_compaction(conversation, None) {
                eprintln!("mobius-agent: cannot save the conversation: {error}");
            }
        }
        if history.is_empty() {
            self.histories.remove(conversation);
            self.updated.remove(conversation);
            if let Err(error) = self.store.delete(conversation) {
                eprintln!("mobius-agent: cannot delete a saved conversation: {error}");
            }
        } else {
            let now = (self.clock)();
            self.updated.insert(conversation.to_owned(), now);
            if let Err(error) = self.store.save(conversation, history, now) {
                eprintln!("mobius-agent: cannot save the conversation: {error}");
            }
        }
        Ok(text)
    }

    /// Forget a conversation, here and in storage. Not while it is working.
    pub fn delete(&mut self, conversation: &str) -> Result<(), HostError> {
        if !valid_conversation_id(conversation) {
            return Err(HostError::InvalidConversation);
        }
        if self.is_busy(conversation) {
            return Err(HostError::Busy);
        }
        self.histories.remove(conversation);
        self.updated.remove(conversation);
        self.compactions.remove(conversation);
        if let Err(error) = self.store.delete(conversation) {
            eprintln!("mobius-agent: cannot delete a saved conversation: {error}");
        }
        Ok(())
    }

    /// What has been said, including the turn that is still running.
    pub fn history(&self, conversation: &str) -> Vec<Message> {
        match self.active.values().find(|a| a.conversation == conversation) {
            Some(active) => active.turn.messages().to_vec(),
            None => self.histories.get(conversation).cloned().unwrap_or_default(),
        }
    }

    /// The calls in this conversation that are waiting for a person.
    pub fn waiting(&self, conversation: &str) -> Vec<Waiting> {
        self.active
            .values()
            .filter(|a| a.conversation == conversation)
            .filter_map(|a| {
                if a.turn.is_reviewing() {
                    return None;
                }
                let (request_id, call) = (a.turn.parked_request()?, a.turn.parked_call()?);
                Some(Waiting { request_id, call_id: call.id.clone(), tool: call.name.clone(), arguments: call.arguments.clone(), once_only: a.turn.parked_once_only(), origin: a.turn.parked_origin().map(str::to_owned) })
            })
            .collect()
    }

    fn activity(&self, conversation: &str) -> Activity {
        if !self.waiting(conversation).is_empty() || self.question(conversation).is_some() {
            Activity::NeedsYou
        } else if self.is_busy(conversation) {
            Activity::Working
        } else {
            Activity::Idle
        }
    }

    pub fn is_busy(&self, conversation: &str) -> bool {
        self.active.values().any(|a| a.conversation == conversation)
    }

    /// Announce what the turn did, then either keep it going or finish it. A finished turn that succeeded or was
    /// cancelled becomes part of the history; one that failed leaves the conversation exactly as it was.
    fn settle(&mut self, mut active: Active, step: Step, outs: &mut Vec<Out>) {
        let turn_id = active.turn.id;
        for event in active.turn.drain_events() {
            let event = serde_json::to_value(&event).unwrap_or(Value::Null);
            outs.push(notification("agent.event", serde_json::json!({ "conversation": active.conversation, "turn": turn_id, "event": event })));
        }
        // The person has control: what Mobius would do next waits until they hand back.
        if active.theirs && matches!(step, Step::CallModel(_) | Step::RunTool { .. } | Step::Review { .. }) {
            active.held = Some(step);
            self.active.insert(turn_id, active);
            return;
        }
        match step {
            Step::CallModel(request) => {
                outs.push(Out::CallModel { turn_id, request, cancel: active.cancel.clone() });
                self.active.insert(turn_id, active);
            }
            Step::Review { request_id, request } => {
                outs.push(Out::Review { turn_id, request_id, request, cancel: active.cancel.clone() });
                self.active.insert(turn_id, active);
            }
            Step::RunTool { call_id, name, arguments } => {
                outs.push(Out::RunTool { turn_id, call_id, name, arguments });
                self.active.insert(turn_id, active);
            }
            Step::AwaitApproval { .. } | Step::AwaitAnswer { .. } | Step::Idle => {
                self.active.insert(turn_id, active);
            }
            Step::Done => {
                let now = (self.clock)();
                let compaction = active.turn.compaction().cloned();
                let messages = active.turn.into_messages();
                if let Err(error) = self.store.save(&active.conversation, &messages, now) {
                    eprintln!("mobius-agent: cannot save the conversation: {error}");
                }
                if compaction.as_ref() != self.compactions.get(&active.conversation) {
                    if let Err(error) = self.store.save_compaction(&active.conversation, compaction.as_ref()) {
                        eprintln!("mobius-agent: cannot save the conversation: {error}");
                    }
                    match compaction {
                        Some(c) => self.compactions.insert(active.conversation.clone(), c),
                        None => self.compactions.remove(&active.conversation),
                    };
                }
                self.updated.insert(active.conversation.clone(), now);
                self.histories.insert(active.conversation, messages);
            }
            Step::Failed { .. } => {
                self.histories.entry(active.conversation).or_default();
            }
        }
    }
}
