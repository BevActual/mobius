//! The turn engine: one user message in, a conversation of model calls and tool calls out.
//!
//! It is a state machine, not a loop, because a turn has to be able to stop and wait for a person to answer a
//! permission question while everything else keeps running. The caller does the model calls (on worker threads) and
//! feeds the results back in.
use std::collections::VecDeque;

use mobius_core::core::{Core, CoreError, InvokeOutcome};
use mobius_core::model::{Duration, Principal};
use mobius_core::permissions::ApprovalMode;
use serde::Serialize;
use ts_rs::TS;

use crate::message::{Message, ToolCall};
use crate::provider::{ChatRequest, Completion, ProviderError, ToolDef};
use crate::review::{Verdict, parse_verdict, review_request};

/// The most a single tool result may add to the conversation.
pub const MAX_TOOL_RESULT_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub model: String,
    pub system: String,
    pub max_steps: u32,
    pub principal: Principal,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Call the model with this request and report the result with `on_model`.
    CallModel(ChatRequest),
    /// The question is being looked at by a reviewer model first. Call it with this request and report with `on_review`.
    Review { request_id: u64, request: ChatRequest },
    /// A person has to answer this question. Report the answer with `on_approval`.
    AwaitApproval { request_id: u64 },
    /// The application has to run this tool (the core has already allowed it). Report with `on_tool_result`.
    RunTool { call_id: String, name: String, arguments: serde_json::Value },
    /// Nothing to do: the turn is waiting for a model result that has not arrived yet.
    Idle,
    Done,
    Failed { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum AgentEvent {
    Message { text: String },
    ToolCall { call_id: String, name: String },
    ToolResult { call_id: String, name: String, is_error: bool },
    NeedsApproval {
        #[ts(type = "number")]
        request_id: u64,
        call_id: String,
        tool: String,
        #[ts(type = "unknown")]
        arguments: serde_json::Value,
        /// The answer can only be "allow once": there is no standing approval for this kind of action.
        once_only: bool,
    },
    Done,
    Failed { message: String },
    Cancelled,
}

struct Parked {
    request_id: u64,
    once_only: bool,
    /// A reviewer model is looking at it; the person has not been asked yet.
    reviewing: bool,
    call: ToolCall,
    remaining: VecDeque<ToolCall>,
}

/// A call that the application is running right now.
struct Dispatched {
    call: ToolCall,
    remaining: VecDeque<ToolCall>,
}

/// What one turn does differently from the usual setup: the instructions and model of the bot it belongs to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnSetup {
    pub system: Option<String>,
    pub model: Option<String>,
}

pub struct Turn {
    pub id: u64,
    setup: TurnSetup,
    messages: Vec<Message>,
    steps: u32,
    parked: Option<Parked>,
    dispatched: Option<Dispatched>,
    events: Vec<AgentEvent>,
    finished: bool,
}

impl Turn {
    pub fn messages(&self) -> &[Message] {
        &self.messages
    }

    pub fn into_messages(self) -> Vec<Message> {
        self.messages
    }

    /// Events since the last call, oldest first.
    pub fn drain_events(&mut self) -> Vec<AgentEvent> {
        std::mem::take(&mut self.events)
    }

    pub fn parked_request(&self) -> Option<u64> {
        self.parked.as_ref().map(|p| p.request_id)
    }

    /// Whether the question is still with the reviewer model, so the person has nothing to answer yet.
    pub fn is_reviewing(&self) -> bool {
        self.parked.as_ref().is_some_and(|p| p.reviewing)
    }

    pub fn parked_once_only(&self) -> bool {
        self.parked.as_ref().is_some_and(|p| p.once_only)
    }

    /// The tool call that is waiting for a person's answer, if any.
    pub fn parked_call(&self) -> Option<&ToolCall> {
        self.parked.as_ref().map(|p| &p.call)
    }

    /// The call the application is running, if any.
    pub fn dispatched_call(&self) -> Option<&ToolCall> {
        self.dispatched.as_ref().map(|d| &d.call)
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }
}

enum Executed {
    Result { content: String, is_error: bool },
    Dispatch,
    Park(u64),
    Fatal(String),
}

pub struct Engine {
    config: EngineConfig,
    effort: Option<String>,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Engine { config, effort: None }
    }

    /// How hard the model is asked to think from now on: `low`, `medium` or `high`, or none for the model's own way.
    pub fn set_effort(&mut self, effort: Option<String>) {
        self.effort = effort;
    }

    pub fn start(&self, core: &Core, history: Vec<Message>, user_text: &str, id: u64) -> (Turn, Step) {
        self.start_with(core, history, user_text, id, TurnSetup::default())
    }

    /// Like `start`, for a turn that uses its own instructions or model.
    pub fn start_with(&self, core: &Core, mut history: Vec<Message>, user_text: &str, id: u64, setup: TurnSetup) -> (Turn, Step) {
        history.push(Message::User { text: user_text.to_owned() });
        let mut turn = Turn { id, setup, messages: history, steps: 0, parked: None, dispatched: None, events: Vec::new(), finished: false };
        let step = self.next_model_call(core, &mut turn);
        (turn, step)
    }

    pub fn on_model(&self, turn: &mut Turn, core: &mut Core, result: Result<Completion, ProviderError>) -> Step {
        if turn.finished {
            return Step::Done;
        }
        match result {
            Err(error) => self.fail(turn, error.to_string()),
            Ok(completion) => {
                if !completion.text.is_empty() {
                    turn.events.push(AgentEvent::Message { text: completion.text.clone() });
                }
                turn.messages.push(Message::Assistant { text: completion.text, tool_calls: completion.tool_calls.clone() });
                if completion.tool_calls.is_empty() {
                    return self.finish(turn);
                }
                self.run_calls(turn, core, completion.tool_calls.into(), true)
            }
        }
    }

    /// The application finished running the tool it was given. Ignored unless it is the call this turn is waiting on.
    pub fn on_tool_result(&self, turn: &mut Turn, core: &mut Core, call_id: &str, result: Result<String, String>) -> Step {
        if turn.finished {
            return Step::Done;
        }
        if turn.dispatched.as_ref().is_none_or(|d| d.call.id != call_id) {
            return Step::Idle;
        }
        let Some(dispatched) = turn.dispatched.take() else { return Step::Idle };
        let succeeded = result.is_ok();
        core.record_external_result(&self.config.principal, &dispatched.call.name, succeeded).ok();
        let (content, is_error) = match result {
            Ok(content) => (truncate(content), false),
            Err(message) => (truncate(message), true),
        };
        self.push_result(turn, &dispatched.call, content, is_error);
        self.run_calls(turn, core, dispatched.remaining, true)
    }

    /// A person answered question `request_id`. Ignored unless this turn is waiting on exactly that question.
    pub fn on_approval(&self, turn: &mut Turn, core: &mut Core, request_id: u64, approved: bool) -> Step {
        if turn.finished {
            return Step::Done;
        }
        match &turn.parked {
            None => return Step::Idle,
            Some(parked) if parked.request_id != request_id => return Step::AwaitApproval { request_id: parked.request_id },
            Some(_) => {}
        }
        let Some(parked) = turn.parked.take() else { return Step::Idle };
        if approved {
            let mut queue = parked.remaining;
            queue.push_front(parked.call);
            self.run_calls(turn, core, queue, false)
        } else {
            self.push_result(turn, &parked.call, "the user declined this action".to_owned(), true);
            self.run_calls(turn, core, parked.remaining, true)
        }
    }

    /// Stop the turn. Its open question is withdrawn and every unfinished call is closed, so the conversation stays
    /// valid for whatever comes next.
    pub fn cancel(&self, turn: &mut Turn, core: &mut Core) {
        if let Some(request_id) = turn.parked_request() {
            core.withdraw(request_id).ok();
        }
        self.cancel_keeping_question(turn);
    }

    /// Like `cancel`, but leaves the question open, for when another turn is waiting on the same answer.
    pub fn cancel_keeping_question(&self, turn: &mut Turn) {
        if turn.finished {
            return;
        }
        let open: Vec<ToolCall> = match (turn.parked.take(), turn.dispatched.take()) {
            (Some(parked), _) => std::iter::once(parked.call).chain(parked.remaining).collect(),
            (None, Some(dispatched)) => std::iter::once(dispatched.call).chain(dispatched.remaining).collect(),
            (None, None) => Vec::new(),
        };
        for call in open {
            turn.messages.push(Message::Tool { call_id: call.id, name: call.name, content: "cancelled".to_owned(), is_error: true });
        }
        turn.finished = true;
        turn.events.push(AgentEvent::Cancelled);
    }

    fn next_model_call(&self, core: &Core, turn: &mut Turn) -> Step {
        if turn.steps >= self.config.max_steps {
            return self.fail(turn, format!("stopped after too many steps ({})", self.config.max_steps));
        }
        turn.steps += 1;
        Step::CallModel(ChatRequest {
            model: turn.setup.model.clone().unwrap_or_else(|| self.config.model.clone()),
            system: turn.setup.system.clone().unwrap_or_else(|| self.config.system.clone()),
            messages: turn.messages.clone(),
            tools: core.tools().into_iter().map(|t| ToolDef { name: t.name, description: t.description, input_schema: t.input_schema }).collect(),
            effort: self.effort.clone(),
        })
    }

    fn run_calls(&self, turn: &mut Turn, core: &mut Core, mut queue: VecDeque<ToolCall>, mut announce: bool) -> Step {
        while let Some(call) = queue.pop_front() {
            if announce {
                turn.events.push(AgentEvent::ToolCall { call_id: call.id.clone(), name: call.name.clone() });
            }
            announce = true;
            match self.execute(core, &call) {
                Executed::Result { content, is_error } => self.push_result(turn, &call, content, is_error),
                Executed::Dispatch => {
                    let step = Step::RunTool { call_id: call.id.clone(), name: call.name.clone(), arguments: call.arguments.clone() };
                    turn.dispatched = Some(Dispatched { call, remaining: queue });
                    return step;
                }
                Executed::Park(request_id) => {
                    if core.approval_mode() == ApprovalMode::Smart {
                        let request = review_request(turn.setup.model.as_deref().unwrap_or(&self.config.model), &call);
                        turn.parked = Some(Parked { request_id, once_only: core.is_once_only(request_id), reviewing: true, call, remaining: queue });
                        return Step::Review { request_id, request };
                    }
                    return self.ask(turn, core, request_id, call, queue);
                }
                Executed::Fatal(message) => return self.fail(turn, message),
            }
        }
        self.next_model_call(core, turn)
    }

    /// Put the question to the person.
    fn ask(&self, turn: &mut Turn, core: &Core, request_id: u64, call: ToolCall, remaining: VecDeque<ToolCall>) -> Step {
        let once_only = core.is_once_only(request_id);
        turn.events.push(AgentEvent::NeedsApproval { request_id, call_id: call.id.clone(), tool: call.name.clone(), arguments: call.arguments.clone(), once_only });
        turn.parked = Some(Parked { request_id, once_only, reviewing: false, call, remaining });
        Step::AwaitApproval { request_id }
    }

    /// The reviewer model answered (or failed to). Ignored unless this turn is waiting on exactly that review.
    ///
    /// Approve lets this one use through and leaves nothing standing. Deny, unsure, and any failure all go to the person;
    /// after a deny they can still say yes, but only for this once.
    pub fn on_review(&self, turn: &mut Turn, core: &mut Core, request_id: u64, result: Result<Completion, ProviderError>) -> Step {
        if turn.finished {
            return Step::Done;
        }
        match &turn.parked {
            Some(parked) if parked.request_id == request_id && parked.reviewing => {}
            Some(parked) => return Step::AwaitApproval { request_id: parked.request_id },
            None => return Step::Idle,
        }
        let verdict = result.map_or(Verdict::Escalate, |completion| parse_verdict(&completion.text));
        let Some(parked) = turn.parked.take() else { return Step::Idle };
        match verdict {
            Verdict::Approve if core.resolve(request_id, true, Duration::Once).is_ok() => {
                let mut queue = parked.remaining;
                queue.push_front(parked.call);
                self.run_calls(turn, core, queue, false)
            }
            Verdict::Deny => {
                core.require_once(request_id);
                self.ask(turn, core, request_id, parked.call, parked.remaining)
            }
            _ => self.ask(turn, core, request_id, parked.call, parked.remaining),
        }
    }

    fn execute(&self, core: &mut Core, call: &ToolCall) -> Executed {
        if !call.arguments.is_object() {
            return Executed::Result { content: "the arguments must be a JSON object".to_owned(), is_error: true };
        }
        let error = |content: String| Executed::Result { content, is_error: true };
        match core.invoke(&self.config.principal, &call.name, &call.arguments) {
            Ok(InvokeOutcome::Completed { result }) => Executed::Result { content: truncate(result.to_string()), is_error: false },
            Ok(InvokeOutcome::Failed { error: message }) => error(message),
            Ok(InvokeOutcome::Denied { reason }) => error(format!("denied: {reason}")),
            Ok(InvokeOutcome::NeedsApproval { request_id }) => Executed::Park(request_id),
            Ok(InvokeOutcome::Dispatch) => Executed::Dispatch,
            Err(CoreError::UnknownTool(name)) => error(format!("unknown tool: {name}")),
            Err(CoreError::InvalidArgs(message)) => error(message),
            Err(CoreError::Model(_)) => error("invalid request".to_owned()),
            Err(other) => {
                eprintln!("mobius-agent: core error during a tool call: {other}");
                Executed::Fatal("the core failed while running a tool".to_owned())
            }
        }
    }

    fn push_result(&self, turn: &mut Turn, call: &ToolCall, content: String, is_error: bool) {
        turn.events.push(AgentEvent::ToolResult { call_id: call.id.clone(), name: call.name.clone(), is_error });
        turn.messages.push(Message::Tool { call_id: call.id.clone(), name: call.name.clone(), content, is_error });
    }

    fn finish(&self, turn: &mut Turn) -> Step {
        turn.finished = true;
        turn.events.push(AgentEvent::Done);
        Step::Done
    }

    fn fail(&self, turn: &mut Turn, message: String) -> Step {
        turn.finished = true;
        turn.events.push(AgentEvent::Failed { message: message.clone() });
        Step::Failed { message }
    }
}

fn truncate(mut text: String) -> String {
    if text.len() <= MAX_TOOL_RESULT_BYTES {
        return text;
    }
    let mut cut = MAX_TOOL_RESULT_BYTES;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    text.push_str("… [truncated]");
    text
}
