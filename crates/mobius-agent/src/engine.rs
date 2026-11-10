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

use crate::compaction::{self, Budget, Compaction};
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
    /// The model asked the person something. Report the answer with `on_answer`.
    AwaitAnswer { call_id: String },
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
    /// The model's plan for this task, the whole list each time it changes.
    Todo { items: Vec<TodoItem> },
    /// The model asks the person something and waits for the answer.
    Question { call_id: String, question: String, choices: Vec<String> },
    /// Earlier messages were summarised to make room in the model's window. The transcript itself is unchanged.
    Compacted {
        #[ts(type = "number")]
        messages: usize,
    },
    Done,
    Failed { message: String },
    Cancelled,
}

/// One step of the model's plan. `status` is `pending`, `in_progress` or `done`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct TodoItem {
    pub text: String,
    pub status: String,
}

/// The tools the engine itself answers. They change nothing outside the conversation, so they need no permission.
pub const TODO_TOOL: &str = "todo.write";
pub const ASK_TOOL: &str = "ask.person";
const MAX_TODO_ITEMS: usize = 50;
const MAX_TODO_TEXT: usize = 300;
const MAX_QUESTION: usize = 1000;
const MAX_CHOICES: usize = 6;
const MAX_CHOICE: usize = 200;

fn own_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: TODO_TOOL.into(),
            description: "Keep a short plan for a task with several steps, so the person can follow along. Send the whole list each time; mark one step in_progress while you work on it and done when it is finished. Not for simple one-step requests.".into(),
            input_schema: serde_json::json!({ "type": "object", "properties": { "items": { "type": "array", "maxItems": MAX_TODO_ITEMS, "items": { "type": "object", "properties": { "text": { "type": "string" }, "status": { "type": "string", "enum": ["pending", "in_progress", "done"] } }, "required": ["text", "status"] } } }, "required": ["items"] }),
        },
        ToolDef {
            name: ASK_TOOL.into(),
            description: "Ask the person a question and wait for the answer, when you cannot go on without a decision only they can make. Offer choices when there are a few clear options; they can always answer in their own words.".into(),
            input_schema: serde_json::json!({ "type": "object", "properties": { "question": { "type": "string" }, "choices": { "type": "array", "maxItems": MAX_CHOICES, "items": { "type": "string" } } }, "required": ["question"] }),
        },
    ]
}

fn parse_todo(args: &serde_json::Value) -> Result<Vec<TodoItem>, String> {
    let items = args.get("items").and_then(serde_json::Value::as_array).ok_or("items must be a list")?;
    if items.len() > MAX_TODO_ITEMS {
        return Err(format!("a plan has at most {MAX_TODO_ITEMS} steps"));
    }
    items
        .iter()
        .map(|item| {
            let text = item.get("text").and_then(serde_json::Value::as_str).map(str::trim).filter(|t| !t.is_empty() && t.chars().count() <= MAX_TODO_TEXT).ok_or("each step needs text of up to 300 characters")?;
            let status = item.get("status").and_then(serde_json::Value::as_str).filter(|s| matches!(*s, "pending" | "in_progress" | "done")).ok_or("status must be pending, in_progress or done")?;
            Ok(TodoItem { text: text.to_owned(), status: status.to_owned() })
        })
        .collect()
}

fn parse_question(args: &serde_json::Value) -> Result<(String, Vec<String>), String> {
    let question = args.get("question").and_then(serde_json::Value::as_str).map(str::trim).filter(|q| !q.is_empty() && q.chars().count() <= MAX_QUESTION).ok_or("question must be text of up to 1000 characters")?;
    let choices = match args.get("choices") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(list)) if list.len() <= MAX_CHOICES => list
            .iter()
            .map(|c| c.as_str().map(str::trim).filter(|c| !c.is_empty() && c.chars().count() <= MAX_CHOICE).map(str::to_owned).ok_or_else(|| "each choice must be short text".to_owned()))
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(format!("choices must be a list of at most {MAX_CHOICES}")),
    };
    Ok((question.to_owned(), choices))
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

/// The pictures of a turn that are acceptable: a few `data:` URLs of common picture types, none too big.
pub const MAX_IMAGES: usize = 4;
pub const MAX_IMAGE_CHARS: usize = 7_000_000;
pub fn image_ok(url: &str) -> bool {
    url.len() <= MAX_IMAGE_CHARS && ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/gif;base64,"].iter().any(|p| url.starts_with(p))
}
fn turn_images(setup: &TurnSetup) -> Vec<String> {
    setup.images.iter().filter(|u| image_ok(u)).take(MAX_IMAGES).cloned().collect()
}

/// What one turn does differently from the usual setup: the instructions and model of the bot it belongs to, and
/// whether it only proposes a plan.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnSetup {
    pub system: Option<String>,
    pub model: Option<String>,
    /// Plan first: the model may only write a plan and ask questions. Nothing else runs until the person starts it.
    pub plan_only: bool,
    /// Pictures the person attached to this message, as `data:` URLs.
    pub images: Vec<String>,
}

/// Added to the instructions of a plan-only turn.
pub const PLAN_ONLY_INSTRUCTIONS: &str = "The person asked to see your plan before you do anything. Do not do the task yet: you can only write the plan and ask questions in this turn. Write the steps with the todo.write tool, all pending, in the order you would do them, each a short sentence that says what you will do and in which app. Ask with ask.person only if you cannot plan without an answer. Then say in one or two sentences what the plan does and that nothing will happen until they start it.";

pub struct Turn {
    pub id: u64,
    setup: TurnSetup,
    messages: Vec<Message>,
    steps: u32,
    parked: Option<Parked>,
    dispatched: Option<Dispatched>,
    /// A question to the person, waiting for the answer.
    asking: Option<Dispatched>,
    events: Vec<AgentEvent>,
    finished: bool,
    compaction: Option<Compaction>,
    /// The model is writing a summary of everything before this index, not answering.
    summarizing: Option<usize>,
    /// A request was refused as too long once already in this turn.
    overflow_retried: bool,
}

impl Turn {
    /// How the conversation is shortened for the model, if it is.
    pub fn compaction(&self) -> Option<&Compaction> {
        self.compaction.as_ref()
    }

    /// The model call in flight is writing a summary, so its text is not part of the answer.
    pub fn is_summarizing(&self) -> bool {
        self.summarizing.is_some()
    }

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

    /// The question the model is waiting for the person to answer, if any.
    pub fn asking(&self) -> Option<&ToolCall> {
        self.asking.as_ref().map(|d| &d.call)
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
    budget: Budget,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Engine { config, effort: None, budget: Budget::default() }
    }

    /// The model's context window in tokens, when known; otherwise a common size is assumed and a request the
    /// provider refuses as too long makes room and is tried once more.
    pub fn set_context_window(&mut self, tokens: Option<usize>) {
        self.budget = tokens.map_or_else(Budget::default, Budget::with_context);
    }

    pub fn budget(&self) -> Budget {
        self.budget
    }

    /// How hard the model is asked to think from now on: `low`, `medium` or `high`, or none for the model's own way.
    pub fn set_effort(&mut self, effort: Option<String>) {
        self.effort = effort;
    }

    pub fn start(&self, core: &Core, history: Vec<Message>, user_text: &str, id: u64) -> (Turn, Step) {
        self.start_with(core, history, user_text, id, TurnSetup::default())
    }

    /// Like `start`, for a turn that uses its own instructions or model.
    pub fn start_with(&self, core: &Core, history: Vec<Message>, user_text: &str, id: u64, setup: TurnSetup) -> (Turn, Step) {
        self.start_from(core, history, None, user_text, id, setup)
    }

    /// Like `start_with`, for a conversation that was already shortened for the model.
    pub fn start_from(&self, core: &Core, mut history: Vec<Message>, compaction: Option<Compaction>, user_text: &str, id: u64, setup: TurnSetup) -> (Turn, Step) {
        let compaction = compaction.filter(|c| c.covers < history.len() && !matches!(history[c.covers], Message::Tool { .. }));
        history.push(Message::User { text: user_text.to_owned(), images: turn_images(&setup) });
        let mut turn = Turn { id, setup, messages: history, steps: 0, parked: None, dispatched: None, asking: None, events: Vec::new(), finished: false, compaction, summarizing: None, overflow_retried: false };
        let step = self.next_model_call(core, &mut turn);
        (turn, step)
    }

    pub fn on_model(&self, turn: &mut Turn, core: &mut Core, result: Result<Completion, ProviderError>) -> Step {
        if turn.finished {
            return Step::Done;
        }
        if let Some(tail) = turn.summarizing.take() {
            return self.on_summary(turn, core, tail, result);
        }
        match result {
            Err(error) if compaction::is_context_overflow(&error) && !turn.overflow_retried => {
                turn.overflow_retried = true;
                match self.make_room(core, turn, true) {
                    Some(step) => step,
                    None => self.fail(turn, error.to_string()),
                }
            }
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

    /// The person answered the model's question. Ignored unless it is the question this turn is waiting on.
    pub fn on_answer(&self, turn: &mut Turn, core: &mut Core, call_id: &str, answer: &str) -> Step {
        if turn.finished {
            return Step::Done;
        }
        match &turn.asking {
            None => return Step::Idle,
            Some(asking) if asking.call.id != call_id => return Step::AwaitAnswer { call_id: asking.call.id.clone() },
            Some(_) => {}
        }
        let Some(asking) = turn.asking.take() else { return Step::Idle };
        self.push_result(turn, &asking.call, truncate(format!("The person answered: {}", answer.trim())), false);
        self.run_calls(turn, core, asking.remaining, true)
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
        let open: Vec<ToolCall> = match (turn.parked.take(), turn.dispatched.take().or_else(|| turn.asking.take())) {
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
        if let Some(step) = self.make_room(core, turn, false) {
            return step;
        }
        self.call_model(core, turn)
    }

    fn call_model(&self, core: &Core, turn: &mut Turn) -> Step {
        turn.steps += 1;
        Step::CallModel(self.request(core, turn))
    }

    fn model_of(&self, turn: &Turn) -> String {
        turn.setup.model.clone().unwrap_or_else(|| self.config.model.clone())
    }

    fn request(&self, core: &Core, turn: &Turn) -> ChatRequest {
        let system = turn.setup.system.clone().unwrap_or_else(|| self.config.system.clone());
        // A plan-only turn offers the model nothing but its own tools.
        let (system, outside) = if turn.setup.plan_only {
            ([system.as_str(), PLAN_ONLY_INSTRUCTIONS].iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("\n\n"), Vec::new())
        } else {
            (system, core.tools())
        };
        ChatRequest {
            model: self.model_of(turn),
            system,
            messages: compaction::view(&turn.messages, turn.compaction.as_ref()),
            tools: outside.into_iter().map(|t| ToolDef { name: t.name, description: t.description, input_schema: t.input_schema }).chain(own_tools()).collect(),
            effort: self.effort.clone(),
            max_tokens: None,
        }
    }

    /// When the next request would be too big for the window: drop old tool output, and if that is not enough, ask
    /// the model for a summary (returned as the step to take). `force` is for a request the provider already refused.
    fn make_room(&self, core: &Core, turn: &mut Turn, force: bool) -> Option<Step> {
        let request = self.request(core, turn);
        let size = compaction::tokens_of(&request.system, &request.messages, &request.tools);
        let limit = self.budget.limit();
        if !force && size <= limit {
            return None;
        }
        let current = turn.compaction.clone().unwrap_or(Compaction { covers: 0, summary: String::new(), pruned_before: 0 });
        // After a refusal the window is smaller than assumed: keep a tail that is a part of what was refused.
        let tail_budget = if force { self.budget.tail().min(size / 4) } else { self.budget.tail() };
        let tail = compaction::tail_start(&turn.messages, current.covers, tail_budget)?;
        let pruned = Compaction { pruned_before: current.pruned_before.max(tail), ..current.clone() };
        let pruned_size = compaction::tokens_of(&request.system, &compaction::view(&turn.messages, Some(&pruned)), &request.tools);
        if !force && pruned_size <= limit * 3 / 4 {
            turn.compaction = Some(pruned);
            return None;
        }
        turn.summarizing = Some(tail);
        let previous = (!current.summary.is_empty()).then_some(current.summary.as_str());
        Some(Step::CallModel(compaction::summary_request(&self.model_of(turn), previous, &turn.messages[current.covers..tail], &self.budget)))
    }

    /// The model wrote the summary (or failed to: then a plain list takes its place). Carry on with the real call.
    fn on_summary(&self, turn: &mut Turn, core: &Core, tail: usize, result: Result<Completion, ProviderError>) -> Step {
        let current = turn.compaction.clone().unwrap_or(Compaction { covers: 0, summary: String::new(), pruned_before: 0 });
        let previous = (!current.summary.is_empty()).then_some(current.summary.as_str());
        let summary = match result {
            Ok(c) if !c.text.trim().is_empty() && c.tool_calls.is_empty() => c.text.trim().to_owned(),
            _ => compaction::fallback_summary(previous, &turn.messages[current.covers..tail]),
        };
        turn.compaction = Some(Compaction { covers: tail, summary, pruned_before: current.pruned_before.max(tail) });
        turn.events.push(AgentEvent::Compacted { messages: tail - current.covers });
        self.call_model(core, turn)
    }

    fn run_calls(&self, turn: &mut Turn, core: &mut Core, mut queue: VecDeque<ToolCall>, mut announce: bool) -> Step {
        while let Some(call) = queue.pop_front() {
            if announce {
                turn.events.push(AgentEvent::ToolCall { call_id: call.id.clone(), name: call.name.clone() });
            }
            announce = true;
            if call.name == TODO_TOOL {
                match parse_todo(&call.arguments) {
                    Ok(items) => {
                        let done = items.iter().filter(|i| i.status == "done").count();
                        let summary = format!("Plan updated: {done} of {} done.", items.len());
                        turn.events.push(AgentEvent::Todo { items });
                        self.push_result(turn, &call, summary, false);
                    }
                    Err(message) => self.push_result(turn, &call, message, true),
                }
                continue;
            }
            if call.name == ASK_TOOL {
                match parse_question(&call.arguments) {
                    Ok((question, choices)) => {
                        turn.events.push(AgentEvent::Question { call_id: call.id.clone(), question, choices });
                        let call_id = call.id.clone();
                        turn.asking = Some(Dispatched { call, remaining: queue });
                        return Step::AwaitAnswer { call_id };
                    }
                    Err(message) => {
                        self.push_result(turn, &call, message, true);
                        continue;
                    }
                }
            }
            if turn.setup.plan_only {
                // Whatever the model asks for, nothing outside the conversation runs before the person starts the plan.
                self.push_result(turn, &call, "Not yet: this turn only plans. Write the plan with todo.write; the person starts it.".to_owned(), true);
                continue;
            }
            match self.execute(core, &call) {
                Executed::Result { content, is_error } => self.push_result(turn, &call, content, is_error),
                Executed::Dispatch => {
                    let step = Step::RunTool { call_id: call.id.clone(), name: call.name.clone(), arguments: call.arguments.clone() };
                    turn.dispatched = Some(Dispatched { call, remaining: queue });
                    return step;
                }
                Executed::Park(request_id) => {
                    // In Act a reviewer model may answer for the person, but never for a floor (running commands,
                    // deleting files, reading secrets, clicking or typing in a page) or an app set to always ask: those
                    // stop as Needs you, every time.
                    if core.approval_mode() == ApprovalMode::Smart && !core.is_person_only(request_id) && !core.is_once_only(request_id) {
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
