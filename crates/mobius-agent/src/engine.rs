//! The turn engine: one user message in, a conversation of model calls and tool calls out.
//!
//! It is a state machine, not a loop, because a turn has to be able to stop and wait for a person to answer a
//! permission question while everything else keeps running. The caller does the model calls (on worker threads) and
//! feeds the results back in.
use std::collections::{HashMap, HashSet, VecDeque};

use mobius_core::core::{Core, CoreError, InvokeOutcome};
use mobius_core::model::{Duration, Principal};
use mobius_core::permissions::ApprovalMode;
use serde::Serialize;
use ts_rs::TS;

use crate::compaction::{self, Budget, Compaction};
use crate::message::{Message, ToolCall};
use crate::provider::{ChatRequest, Completion, ProviderError, ToolDef};
use crate::review::{Verdict, parse_verdict, review_request};
use crate::untrusted;

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
    /// A call the model made, with its arguments (long text cut short) so the conversation can say what it acted on:
    /// "Added “Order brake kit”", not "Add a task".
    ToolCall {
        call_id: String,
        name: String,
        #[ts(type = "unknown")]
        arguments: serde_json::Value,
    },
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
        /// The request came from something Mobius read, not from the person: "Priya's invite “Dinner”".
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        origin: Option<String>,
        /// The call's arguments were not taken from `origin`: it only sends, deletes or shares after Mobius read it.
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        #[ts(as = "Option<bool>", optional)]
        earlier: bool,
    },
    /// The model's plan for this task, the whole list each time it changes.
    Todo { items: Vec<TodoItem> },
    /// The person took over: Mobius stopped at a safe point, at this step of its plan (`of` when there is a plan).
    Paused {
        step: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        of: Option<u32>,
    },
    /// The person handed back: Mobius reads what is there again, then goes on.
    Resumed,
    /// The model asks the person something and waits for the answer.
    Question { call_id: String, question: String, choices: Vec<String> },
    /// Earlier messages were summarised to make room in the model's window. The transcript itself is unchanged.
    Compacted {
        #[ts(type = "number")]
        messages: usize,
    },
    /// How much of the model's window the next request takes, estimated in tokens, against the window's size.
    Context {
        #[ts(type = "number")]
        used: usize,
        #[ts(type = "number")]
        limit: usize,
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
    /// Where the call's arguments came from, when it was something read.
    origin: Option<String>,
    /// `origin` was only read before the call, which sends, deletes or shares: its arguments did not come from there.
    earlier: bool,
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
    /// Ask mode: the model is offered only tools that read, and anything else it asks for is refused.
    pub read_only: bool,
    /// Pictures the person attached to this message, as `data:` URLs.
    pub images: Vec<String>,
    /// The project the conversation belongs to: its rules count for the turn's calls.
    pub project: Option<String>,
    /// Reads the turn always starts with (a suggestion's or a mode's), done before the model is first asked, so it
    /// does not spend a round asking for them: each tool's name and arguments. Only reads that would run without
    /// asking anyone are done; the others are left for the model.
    pub reads: Vec<(String, serde_json::Value)>,
    /// The turn is done once a round's calls have all gone through and none of them only read: the window's summary of
    /// what changed stands in for a closing answer, so the model is not asked again just to say it. A suggestion or
    /// mode that ends in changes asks for this.
    pub finish_on_changes: bool,
    /// The kinds of application tools the turn is offered, by the part of their name before the dot (`tasks`, `mail`):
    /// a suggestion or mode that knows which apps it works in sends only theirs, so the model reads (and is billed for)
    /// a much shorter request. Empty offers every tool.
    pub tools: Vec<String>,
    /// The app the person sent it from (`mail`, `photo`). When every tool would fill too much of a small model's
    /// window, only that app's tools and the everyday ones are offered (`APP_TOOLS`).
    pub app: Option<String>,
    /// How hard the model thinks this turn, in place of the engine's setting: an app's mode that sorts and writes
    /// rather than works things out asks for `low`, so its first change comes sooner.
    pub effort: Option<String>,
    /// At most this many calls of a tool run in the turn (Triage: five drafts). A call past that is not run, not shown,
    /// and answered as a plain result, so the model has no limit to report to the person.
    pub caps: Vec<(String, u32)>,
}

/// What a call past its tool's cap is answered with.
pub const NOT_MADE: &str = "Not made: this message gets its line, with no draft. Do not mention it.";

/// On a model with a small window, the kinds of tools each app's turns are offered, beside `EVERYDAY_TOOLS`. An app
/// not named here (Home, the agent's own page) gets the everyday ones and `HOME_TOOLS`: what people most ask of Home.
pub const APP_TOOLS: &[(&str, &[&str])] = &[
    ("mail", &["mail", "calendar", "tasks"]),
    ("calendar", &["calendar", "tasks", "mail"]),
    ("tasks", &["tasks", "calendar"]),
    ("sheets", &["sheets"]),
    ("database", &["db"]),
    ("photo", &["photos", "images"]),
    ("design", &["design", "images"]),
    ("video", &["video"]),
    ("code", &["code"]),
    ("terminal", &["code"]),
    ("browser", &["browser", "web"]),
    ("research", &["web", "browser"]),
    ("search", &["web"]),
    ("files", &["drives"]),
    ("skills", &["skills"]),
    ("docs", &["comments"]),
    ("notes", &["comments"]),
];
const HOME_TOOLS: &[&str] = &["tasks", "calendar", "mail", "web"];
/// Offered in every app: the workspace's files (notes, docs, slides and boards are files), the search of the notes,
/// and what to remember.
pub const EVERYDAY_TOOLS: &[&str] = &["files", "notes", "memory"];
/// Every tool is offered while they fill at most this part of the window; past it, only the app's.
const TOOLS_SHARE: usize = 4;

/// The kinds of tools a turn from `app` is offered on a small window.
pub fn kinds_for_app(app: Option<&str>) -> Vec<&'static str> {
    let own = app.and_then(|a| APP_TOOLS.iter().find(|(id, _)| *id == a)).map_or(HOME_TOOLS, |(_, kinds)| kinds);
    EVERYDAY_TOOLS.iter().chain(own).copied().collect()
}

/// Told to the model when the turn ends once its changes are made (`TurnSetup::finish_on_changes`).
pub const FINISH_ON_CHANGES: &str = "This turn ends as soon as your changes are made, and the person sees a summary of them: you are not asked again afterwards. So in the answer that makes the changes, also write what you would tell the person (the list or the few lines asked for), with each call straight after the line it belongs to, so each change shows as soon as its line is written. If you still need to read something, read it first, in an answer of its own.";

/// Reads done before the model is first asked, with what they gave, kept with the person's message.
pub const READS_OPEN: &str = "\n\n<reads>\nAlready read for this message (use these; read again only what is missing):\n";
pub const READS_CLOSE: &str = "\n</reads>";
/// At most this many reads before a turn.
pub const MAX_READS: usize = 6;

/// Added to the next request after the person took over and handed back.
/// For a model that ended a turn of changes without a word: the next answer tells the person what was done.
const SAY_WHAT_YOU_DID: &str = "You finished without writing anything to the person. Now tell them, in a sentence or two, what you did and anything they should check. Do not call any more tools.";

/// The most of a hand-back note the model is told.
pub const MAX_HANDED_NOTE: usize = 2000;

pub const HANDED_BACK: &str = "The person took over for a while and used the apps themself, then handed back. What you read before may have changed: read the current state again (the page, document or list you were working on) before your next step, and carry on from what is there now.";

/// Added to the instructions of a plan-only turn.
/// Ask mode: what the model is told. Only reading tools are offered, and the engine refuses anything else.
pub const ASK_ONLY_INSTRUCTIONS: &str = "The person chose Ask mode: answer and explain, and change nothing. You can read what they have open and look things up, but do not write, send, add, move or delete anything. If a change would help, say what you would change; they can switch to Agent to have it done.";

/// A capability that only reads: what Ask mode may use.
pub fn is_reading(capability: &str) -> bool {
    matches!(capability.rsplit('.').next(), Some("read" | "list" | "search" | "now" | "output"))
}

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
    /// The plan's steps done and in all, from the last todo.write.
    plan: Option<(u32, u32)>,
    /// The person had control for a while: the next request tells the model to read what is there again.
    reread: bool,
    /// What the person said when handing back: what they changed, or what to do next.
    handed_note: Option<String>,
    /// Calls of the model call in flight that ran as soon as the model finished writing each one.
    early: Early,
    /// Reads still to do before the model is first asked, and what those done gave.
    reads: Option<Reads>,
    /// This model round's calls: whether one failed, was declined or asked something, and whether one only read.
    round: Round,
    /// The model has written something to the person in this turn, in any round.
    said: bool,
    /// The model ended the turn after its changes without a word to the person, and was asked once more for one.
    nudged: bool,
    /// The person allowed reading the web for this question: web.search and web.read run without asking again
    /// until the turn ends.
    web_for_turn: bool,
    /// The calls of each capped tool let through this turn, by id: a call counted early is not counted again.
    ran: HashMap<String, HashSet<String>>,
}

impl Turn {
    /// The call's tool has run as often as the turn allows it to, and this call is not one of those.
    fn at_cap(&self, call: &ToolCall) -> bool {
        let ran = self.ran.get(&call.name);
        self.setup.caps.iter().any(|(tool, most)| *tool == call.name && ran.map_or(0, HashSet::len) >= *most as usize && !ran.is_some_and(|r| r.contains(&call.id)))
    }

    /// Counts a call of a capped tool that is let through.
    fn count_run(&mut self, call: &ToolCall) {
        if self.setup.caps.iter().any(|(tool, _)| *tool == call.name) {
            self.ran.entry(call.name.clone()).or_default().insert(call.id.clone());
        }
    }
}

#[derive(Default, Clone)]
struct Round {
    /// The tools whose results came back.
    tools: Vec<String>,
    troubled: bool,
    /// The model wrote something to the person in this round, beside its calls.
    said: bool,
}

#[derive(Default)]
struct Reads {
    waiting: VecDeque<ToolCall>,
    running: Option<ToolCall>,
    done: Vec<(ToolCall, String)>,
}

/// A model round's calls that run while the model is still writing the rest, so the person sees each change as soon
/// as it is made rather than after the whole answer. Only a call that would run without asking anyone does; the first
/// one that would not stops this for the round, so calls still happen in the order the model wrote them.
#[derive(Default)]
struct Early {
    /// Calls that ran or are running, in order, with what came back (already wrapped for the model) once it has.
    calls: Vec<(ToolCall, Option<(String, bool)>)>,
    /// Calls whose start the window was told about, so they are not announced twice.
    announced: HashSet<String>,
    /// The call the application is running.
    running: Option<String>,
    /// Calls that arrived while another was running, to start after it.
    waiting: VecDeque<ToolCall>,
    /// A call could not run early: the rest of this round waits for the model's whole answer.
    stopped: bool,
    /// The model's answer is in and is waiting for the running call: these are the round's calls still to go through.
    held: Option<VecDeque<ToolCall>>,
}

impl Early {
    fn result(&self, call_id: &str) -> Option<&(String, bool)> {
        self.calls.iter().find(|(c, _)| c.id == call_id).and_then(|(_, r)| r.as_ref())
    }

    fn has(&self, call_id: &str) -> bool {
        self.calls.iter().any(|(c, _)| c.id == call_id)
    }
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

    /// The step the turn is on, and how many its plan has (when there is one).
    pub fn progress(&self) -> (u32, Option<u32>) {
        match self.plan {
            Some((done, total)) if total > 0 => ((done + 1).min(total), Some(total)),
            _ => (self.steps.max(1), None),
        }
    }

    /// The person took over (`Paused`) or handed back (`Resumed`): told to the window like the turn's other events.
    pub fn note_control(&mut self, theirs: bool) {
        let event = if theirs { let (step, of) = self.progress(); AgentEvent::Paused { step, of } } else { AgentEvent::Resumed };
        self.events.push(event);
    }

    pub fn parked_once_only(&self) -> bool {
        self.parked.as_ref().is_some_and(|p| p.once_only)
    }

    /// Where the waiting call's arguments came from, when it was something read and not the person.
    pub fn parked_origin(&self) -> Option<&str> {
        self.parked.as_ref().and_then(|p| p.origin.as_deref())
    }

    /// The parked call's origin was only read before it (it sends, deletes or shares), not where its arguments came from.
    pub fn parked_earlier(&self) -> bool {
        self.parked.as_ref().is_some_and(|p| p.earlier)
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

    /// The turn's first reads are still to be done (`Engine::read_first`).
    pub fn has_reads(&self) -> bool {
        self.reads.as_ref().is_some_and(|r| r.running.is_none() && !r.waiting.is_empty())
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
        let at_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().and_then(|d| u64::try_from(d.as_millis()).ok());
        history.push(Message::User { text: user_text.to_owned(), images: turn_images(&setup), at_ms });
        let reads: VecDeque<ToolCall> = if setup.plan_only {
            VecDeque::new()
        } else {
            setup.reads.iter().take(MAX_READS).enumerate().map(|(i, (name, arguments))| ToolCall { id: format!("read-{id}-{i}"), name: name.clone(), arguments: arguments.clone() }).collect()
        };
        let mut turn = Turn { id, setup, messages: history, steps: 0, parked: None, dispatched: None, asking: None, events: Vec::new(), finished: false, compaction, summarizing: None, overflow_retried: false, plan: None, reread: false, handed_note: None, early: Early::default(), reads: None, round: Round::default(), said: false, nudged: false, web_for_turn: false, ran: HashMap::new() };
        if !reads.is_empty() {
            // The reads need the core to run them: the caller goes on with `read_first`.
            turn.reads = Some(Reads { waiting: reads, ..Reads::default() });
            return (turn, Step::Idle);
        }
        let step = self.next_model_call(core, &mut turn);
        (turn, step)
    }

    /// Do the turn's first reads, then ask the model. Each read the person would see the model do shows the same way
    /// (a call and its result); one that would need anyone's answer, or that is not a read, is left for the model.
    pub fn read_first(&self, turn: &mut Turn, core: &mut Core) -> Step {
        loop {
            let Some(reads) = turn.reads.as_mut() else { return self.next_model_call(core, turn) };
            if reads.running.is_some() {
                return Step::Idle;
            }
            let Some(call) = reads.waiting.pop_front() else { return self.after_reads(core, turn) };
            let reading = core.capability_of(&call.name).is_some_and(|c| is_reading(c.as_str()));
            if !reading || !call.arguments.is_object() || !core.would_run_in(&self.config.principal, &call.name, &call.arguments, turn.setup.project.as_deref()) {
                continue;
            }
            turn.events.push(AgentEvent::ToolCall { call_id: call.id.clone(), name: call.name.clone(), arguments: brief_arguments(&call.arguments) });
            match self.execute(core, &call, false, turn.setup.project.as_deref()) {
                Executed::Result { content, is_error } => self.read_done(turn, call, content, is_error),
                Executed::Dispatch => {
                    let step = Step::RunTool { call_id: call.id.clone(), name: call.name.clone(), arguments: call.arguments.clone() };
                    if let Some(reads) = turn.reads.as_mut() {
                        reads.running = Some(call);
                    }
                    return step;
                }
                Executed::Park(request_id) => {
                    core.withdraw(request_id).ok();
                    turn.events.push(AgentEvent::ToolResult { call_id: call.id, name: call.name, is_error: true });
                }
                Executed::Fatal(_) => turn.events.push(AgentEvent::ToolResult { call_id: call.id, name: call.name, is_error: true }),
            }
        }
    }

    fn read_done(&self, turn: &mut Turn, call: ToolCall, content: String, is_error: bool) {
        turn.events.push(AgentEvent::ToolResult { call_id: call.id.clone(), name: call.name.clone(), is_error });
        // A read that failed is left for the model to try itself.
        if !is_error && let Some(reads) = turn.reads.as_mut() {
            reads.done.push((call, content));
        }
    }

    /// What the reads gave goes with the person's message, each in the envelope that says it is data, then the model
    /// is asked.
    fn after_reads(&self, core: &Core, turn: &mut Turn) -> Step {
        let done = turn.reads.take().map(|r| r.done).unwrap_or_default();
        if !done.is_empty()
            && let Some(Message::User { text, .. }) = turn.messages.iter_mut().rev().find(|m| matches!(m, Message::User { .. }))
        {
            let blocks: Vec<String> = done.iter().map(|(call, content)| format!("{} {}\n{content}", call.name, call.arguments)).collect();
            text.push_str(READS_OPEN);
            text.push_str(&blocks.join("\n\n").replace(READS_CLOSE.trim_start(), "</ reads>"));
            text.push_str(READS_CLOSE);
        }
        self.next_model_call(core, turn)
    }

    pub fn on_model(&self, turn: &mut Turn, core: &mut Core, result: Result<Completion, ProviderError>) -> Step {
        turn.reread = false;
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
            // Calls already ran while the answer was coming: they happened, so they are kept, and the model is asked
            // again with their results rather than the turn failing with changes it cannot account for.
            Err(_) if !turn.early.calls.is_empty() => self.on_model(turn, core, Ok(Completion { text: String::new(), tool_calls: Vec::new(), stop: crate::provider::StopReason::ToolUse, usage: None })),
            Err(error) => self.fail(turn, error.to_string()),
            Ok(completion) => {
                if !completion.text.is_empty() {
                    turn.events.push(AgentEvent::Message { text: completion.text.clone() });
                }
                turn.round.said = !completion.text.trim().is_empty();
                turn.said |= turn.round.said;
                // Every call that ran early is in the answer, even if the finished answer somehow lost it.
                let mut calls: Vec<ToolCall> = turn.early.calls.iter().filter(|(c, _)| !completion.tool_calls.iter().any(|t| t.id == c.id)).map(|(c, _)| c.clone()).collect();
                calls.extend(completion.tool_calls);
                turn.early.waiting.clear();
                turn.messages.push(Message::Assistant { text: completion.text, tool_calls: calls.clone() });
                if calls.is_empty() {
                    // A model that ends a turn of changes saying nothing (a small local one, after its thinking) is
                    // asked once more for a line, so the person is never left with changes and no answer.
                    if !turn.said && !turn.nudged && turn.steps > 1 {
                        turn.nudged = true;
                        return self.next_model_call(core, turn);
                    }
                    return self.finish(turn);
                }
                self.run_calls(turn, core, calls.into(), true)
            }
        }
    }

    /// The model finished writing one call of the answer it is still giving. It runs now if it can run without asking
    /// anyone; otherwise it, and every call after it in this answer, waits for the whole answer as before.
    pub fn on_early_call(&self, turn: &mut Turn, core: &mut Core, call: ToolCall) -> Step {
        if turn.finished || turn.summarizing.is_some() || turn.early.stopped || turn.early.held.is_some() || turn.early.has(&call.id) {
            return Step::Idle;
        }
        if !self.runs_early(turn, core, &call) {
            turn.early.stopped = true;
            return Step::Idle;
        }
        // Counted once it is sure to run, waiting or not, so a call behind it sees the cap.
        turn.count_run(&call);
        if turn.early.running.is_some() {
            turn.early.waiting.push_back(call);
            return Step::Idle;
        }
        self.start_early(turn, core, call)
    }

    /// A call that changes nothing the person has not already allowed, and is not one the engine itself has to stop for.
    fn runs_early(&self, turn: &Turn, core: &Core, call: &ToolCall) -> bool {
        if call.name == ASK_TOOL || !call.arguments.is_object() || turn.setup.plan_only {
            return false;
        }
        if call.name == TODO_TOOL {
            return true;
        }
        if turn.at_cap(call) {
            return false;
        }
        let Some(capability) = core.capability_of(&call.name) else { return false };
        if turn.setup.read_only && !is_reading(capability.as_str()) {
            return false;
        }
        if untrusted::asked_by(&turn.messages, &call.name, capability.as_str(), &call.arguments).is_some() {
            return false;
        }
        core.would_run_in(&self.config.principal, &call.name, &call.arguments, turn.setup.project.as_deref())
    }

    fn start_early(&self, turn: &mut Turn, core: &mut Core, first: ToolCall) -> Step {
        let mut next = Some(first);
        while let Some(call) = next.take().or_else(|| turn.early.waiting.pop_front()) {
            turn.events.push(AgentEvent::ToolCall { call_id: call.id.clone(), name: call.name.clone(), arguments: brief_arguments(&call.arguments) });
            turn.early.announced.insert(call.id.clone());
            if call.name == TODO_TOOL {
                let (content, is_error) = self.todo(turn, &call);
                self.early_done(turn, call, content, is_error);
                continue;
            }
            match self.execute(core, &call, false, turn.setup.project.as_deref()) {
                Executed::Result { content, is_error } => self.early_done(turn, call, content, is_error),
                Executed::Dispatch => {
                    let step = Step::RunTool { call_id: call.id.clone(), name: call.name.clone(), arguments: call.arguments.clone() };
                    turn.early.running = Some(call.id.clone());
                    turn.early.calls.push((call, None));
                    return step;
                }
                // Not expected, as it was checked first; the rules changed meanwhile. Nobody is asked mid-answer: the
                // question is taken back and the call goes through as usual once the answer is in.
                Executed::Park(request_id) => {
                    core.withdraw(request_id).ok();
                    turn.early.stopped = true;
                    turn.early.waiting.clear();
                }
                Executed::Fatal(_) => {
                    turn.early.stopped = true;
                    turn.early.waiting.clear();
                }
            }
        }
        Step::Idle
    }

    fn early_done(&self, turn: &mut Turn, call: ToolCall, content: String, is_error: bool) {
        turn.events.push(AgentEvent::ToolResult { call_id: call.id.clone(), name: call.name.clone(), is_error });
        if let Some(entry) = turn.early.calls.iter_mut().find(|(c, _)| c.id == call.id) {
            entry.1 = Some((content, is_error));
        } else {
            turn.early.calls.push((call, Some((content, is_error))));
        }
    }

    /// The application finished running the tool it was given. Ignored unless it is the call this turn is waiting on.
    pub fn on_tool_result(&self, turn: &mut Turn, core: &mut Core, call_id: &str, result: Result<String, String>) -> Step {
        if turn.finished {
            return Step::Done;
        }
        if turn.reads.as_ref().and_then(|r| r.running.as_ref()).is_some_and(|c| c.id == call_id) {
            let Some(call) = turn.reads.as_mut().and_then(|r| r.running.take()) else { return Step::Idle };
            core.record_external_result(&self.config.principal, &call.name, &call.arguments, result.is_ok()).ok();
            match result {
                Ok(content) => {
                    let content = untrusted::wrap(&call.name, &call.arguments, &truncate(content));
                    self.read_done(turn, call, content, false);
                }
                Err(_) => self.read_done(turn, call, String::new(), true),
            }
            return self.read_first(turn, core);
        }
        if turn.early.running.as_deref() == Some(call_id) {
            turn.early.running = None;
            let Some(call) = turn.early.calls.iter().find(|(c, _)| c.id == call_id).map(|(c, _)| c.clone()) else { return Step::Idle };
            core.record_external_result(&self.config.principal, &call.name, &call.arguments, result.is_ok()).ok();
            let (content, is_error) = match result {
                Ok(content) => (untrusted::wrap(&call.name, &call.arguments, &truncate(content)), false),
                Err(message) => (untrusted::wrap(&call.name, &call.arguments, &truncate(message)), true),
            };
            self.early_done(turn, call, content, is_error);
            if let Some(queue) = turn.early.held.take() {
                return self.run_calls(turn, core, queue, true);
            }
            return match turn.early.waiting.pop_front() {
                Some(next) => self.start_early(turn, core, next),
                None => Step::Idle,
            };
        }
        if turn.dispatched.as_ref().is_none_or(|d| d.call.id != call_id) {
            return Step::Idle;
        }
        let Some(dispatched) = turn.dispatched.take() else { return Step::Idle };
        let succeeded = result.is_ok();
        core.record_external_result(&self.config.principal, &dispatched.call.name, &dispatched.call.arguments, succeeded).ok();
        // What came back is data from somewhere else: it goes to the model inside an envelope that says so.
        let call = &dispatched.call;
        let (content, is_error) = match result {
            Ok(content) => (untrusted::wrap(&call.name, &call.arguments, &truncate(content)), false),
            Err(message) => (untrusted::wrap(&call.name, &call.arguments, &truncate(message)), true),
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
        if approved && core.take_for_turn(request_id) {
            turn.web_for_turn = true;
        }
        if approved {
            let mut queue = parked.remaining;
            queue.push_front(parked.call);
            self.run_calls(turn, core, queue, false)
        } else {
            self.push_result(turn, &parked.call, "the user declined this action".to_owned(), true);
            self.run_calls(turn, core, parked.remaining, true)
        }
    }

    /// The person handed back after taking over. `held` is the step that was waiting when they took over: a model
    /// request is asked again, telling the model to read what is there now; a tool call is not run (what it was
    /// decided on may have changed), and the model is asked again instead.
    ///
    /// `note` is what the person wrote as they handed back ("I booked it myself; just send the summary"): the model
    /// is told it as the person's words, for the rest of the turn.
    pub fn hand_back(&self, turn: &mut Turn, core: &Core, held: Option<Step>, note: Option<&str>) -> Step {
        turn.reread = true;
        if let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) {
            turn.handed_note = Some(note.chars().take(MAX_HANDED_NOTE).collect());
        }
        match held {
            Some(Step::CallModel(_)) => Step::CallModel(self.request(core, turn)),
            Some(Step::RunTool { .. }) => {
                if let Some(d) = turn.dispatched.take() {
                    for call in std::iter::once(d.call).chain(d.remaining) {
                        self.push_result(turn, &call, "Not run: the person took over and changed things meanwhile. Read the current state again, then decide.".to_owned(), true);
                    }
                }
                self.next_model_call(core, turn)
            }
            Some(other) => other,
            None => Step::Idle,
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
        let mut open: Vec<ToolCall> = match (turn.parked.take(), turn.dispatched.take().or_else(|| turn.asking.take())) {
            (Some(parked), _) => std::iter::once(parked.call).chain(parked.remaining).collect(),
            (None, Some(dispatched)) => std::iter::once(dispatched.call).chain(dispatched.remaining).collect(),
            (None, None) => Vec::new(),
        };
        let early = std::mem::take(&mut turn.early);
        match early.held {
            // The answer is in and waits on a call still running: it and the rest of the round are closed.
            Some(held) => open.extend(held),
            // Stopped while the model was still answering: what already ran is kept, with what came back.
            None if !early.calls.is_empty() => {
                turn.messages.push(Message::Assistant { text: String::new(), tool_calls: early.calls.iter().map(|(c, _)| c.clone()).collect() });
                for (call, result) in early.calls {
                    let (content, is_error) = result.unwrap_or_else(|| ("cancelled".to_owned(), true));
                    turn.messages.push(Message::Tool { call_id: call.id, name: call.name, content, is_error });
                }
            }
            None => {}
        }
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
        turn.early = Early::default();
        turn.round = Round::default();
        let request = self.request(core, turn);
        let used = compaction::tokens_of(&request.system, &request.messages, &request.tools);
        turn.events.push(AgentEvent::Context { used, limit: self.budget.context_tokens });
        Step::CallModel(request)
    }

    /// Whether these tools would take more than `1 / TOOLS_SHARE` of the model's window.
    fn tools_crowd(&self, tools: &[mobius_core::core::ToolSpec]) -> bool {
        let tokens: usize = tools.iter().map(|t| compaction::tokens_of_text(&t.name) + compaction::tokens_of_text(&t.description) + compaction::tokens_of_text(&t.input_schema.to_string())).sum();
        tokens * TOOLS_SHARE > self.budget.context_tokens
    }

    fn model_of(&self, turn: &Turn) -> String {
        turn.setup.model.clone().unwrap_or_else(|| self.config.model.clone())
    }

    fn request(&self, core: &Core, turn: &Turn) -> ChatRequest {
        let system = turn.setup.system.clone().unwrap_or_else(|| self.config.system.clone());
        // A plan-only turn offers the model nothing but its own tools.
        let (system, outside) = if turn.setup.plan_only {
            ([system.as_str(), PLAN_ONLY_INSTRUCTIONS].iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("\n\n"), Vec::new())
        } else if turn.setup.read_only {
            let reading = core.tools().into_iter().filter(|t| is_reading(t.capability.as_str())).collect();
            ([system.as_str(), ASK_ONLY_INSTRUCTIONS].iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join("\n\n"), reading)
        } else {
            (system, core.tools())
        };
        let kind_of = |name: &str| name.split_once('.').map_or(String::new(), |(kind, _)| kind.to_owned());
        let outside: Vec<_> = if turn.setup.tools.is_empty() { outside } else { outside.into_iter().filter(|t| turn.setup.tools.contains(&kind_of(&t.name))).collect() };
        // A small window (a model on this computer): when every tool would fill more than a quarter of it, the turn is
        // offered the tools of the app it was sent from and the everyday ones, so the conversation keeps its room.
        let outside: Vec<_> = if turn.setup.tools.is_empty() && self.tools_crowd(&outside) {
            let kinds = kinds_for_app(turn.setup.app.as_deref());
            outside.into_iter().filter(|t| kinds.contains(&kind_of(&t.name).as_str())).collect()
        } else {
            outside
        };
        let system = if system.is_empty() { untrusted::ENVELOPE_RULE.to_owned() } else { format!("{system}\n\n{}", untrusted::ENVELOPE_RULE) };
        let system = if turn.reread { format!("{system}\n\n{HANDED_BACK}") } else { system };
        let system = match &turn.handed_note {
            Some(note) => format!("{system}\n\nJust now, as they handed back, the person wrote (their own words, to follow as an instruction from them; say so as \"as you said when you handed back\", not \"earlier\"): {note}"),
            None => system,
        };
        let system = if turn.nudged { format!("{system}\n\n{SAY_WHAT_YOU_DID}") } else { system };
        let system = if turn.setup.finish_on_changes { format!("{system}\n\n{FINISH_ON_CHANGES}") } else { system };
        ChatRequest {
            model: self.model_of(turn),
            system,
            messages: compaction::view(&turn.messages, turn.compaction.as_ref()),
            tools: outside.into_iter().map(|t| ToolDef { name: t.name, description: t.description, input_schema: t.input_schema }).chain(own_tools()).collect(),
            effort: turn.setup.effort.clone().or_else(|| self.effort.clone()),
            max_tokens: None,
            format: None,
        }
    }

    /// When the next request would be too big for the window: drop old tool output, and if that is not enough, ask
    /// the model for a summary (returned as the step to take). `force` is for a request the provider already refused.
    fn make_room(&self, core: &Core, turn: &mut Turn, force: bool) -> Option<Step> {
        let request = self.request(core, turn);
        let size = compaction::tokens_of(&request.system, &request.messages, &request.tools);
        // The instructions and the tools go with every request and no summary makes them smaller. On a small window
        // (a model on this computer) they can fill most of the share kept for the request; measured against that share
        // alone, every turn after the first would ask for a summary of a conversation of a few lines. So the
        // conversation always gets at least a tail's worth of room beyond them.
        let fixed = compaction::tokens_of(&request.system, &[], &request.tools);
        let limit = self.budget.limit().max(fixed + self.budget.tail());
        if !force && size <= limit {
            return None;
        }
        let current = turn.compaction.clone().unwrap_or(Compaction { covers: 0, summary: String::new(), pruned_before: 0 });
        // After a refusal the window is smaller than assumed: keep a tail that is a part of what was refused.
        let tail_budget = if force { self.budget.tail().min(size / 4) } else { self.budget.tail() };
        let tail = compaction::tail_start(&turn.messages, current.covers, tail_budget)?;
        let pruned = Compaction { pruned_before: current.pruned_before.max(tail), ..current.clone() };
        let pruned_size = compaction::tokens_of(&request.system, &compaction::view(&turn.messages, Some(&pruned)), &request.tools);
        if !force && pruned_size <= fixed + (limit - fixed) * 3 / 4 {
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
            // It ran while the model was still answering: its result is ready, or it is still with the application.
            if turn.early.has(&call.id) {
                match turn.early.result(&call.id).cloned() {
                    Some((content, is_error)) => {
                        turn.round.tools.push(call.name.clone());
                        turn.round.troubled |= is_error;
                        turn.messages.push(Message::Tool { call_id: call.id.clone(), name: call.name.clone(), content, is_error });
                    }
                    None => {
                        queue.push_front(call);
                        turn.early.held = Some(queue);
                        return Step::Idle;
                    }
                }
                continue;
            }
            if turn.at_cap(&call) {
                // Past the tool's cap for the turn: not run and not shown, so nothing counts it as made.
                turn.messages.push(Message::Tool { call_id: call.id.clone(), name: call.name.clone(), content: NOT_MADE.to_owned(), is_error: false });
                continue;
            }
            turn.count_run(&call);
            if announce && !turn.early.announced.contains(&call.id) {
                turn.events.push(AgentEvent::ToolCall { call_id: call.id.clone(), name: call.name.clone(), arguments: brief_arguments(&call.arguments) });
            }
            announce = true;
            if call.name == TODO_TOOL {
                let (content, is_error) = self.todo(turn, &call);
                self.push_result(turn, &call, content, is_error);
                continue;
            }
            if call.name == ASK_TOOL {
                match parse_question(&call.arguments) {
                    Ok((question, choices)) => {
                        turn.round.troubled = true;
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
            if turn.setup.read_only && !core.capability_of(&call.name).is_some_and(|c| is_reading(c.as_str())) {
                // Ask mode: only reading runs, whatever the model asks for.
                self.push_result(turn, &call, "Not in Ask mode: this turn only reads and answers. Say what you would change and the person can switch to Agent.".to_owned(), true);
                continue;
            }
            if turn.setup.plan_only {
                // Whatever the model asks for, nothing outside the conversation runs before the person starts the plan.
                self.push_result(turn, &call, "Not yet: this turn only plans. Write the plan with todo.write; the person starts it.".to_owned(), true);
                continue;
            }
            // Arguments that came from something read, for a call that sends, pays, deletes, runs or opens a site:
            // the person decides, every time and in every mode, told where the request came from.
            // And one that sends, deletes or shares after the conversation read anything from outside, whoever chose
            // its arguments.
            let origin = core.capability_of(&call.name).and_then(|c| untrusted::asked_by(&turn.messages, &call.name, c.as_str(), &call.arguments));
            match self.execute(core, &call, origin.is_some(), turn.setup.project.as_deref()) {
                Executed::Result { content, is_error } => self.push_result(turn, &call, content, is_error),
                Executed::Dispatch => {
                    let step = Step::RunTool { call_id: call.id.clone(), name: call.name.clone(), arguments: call.arguments.clone() };
                    turn.dispatched = Some(Dispatched { call, remaining: queue });
                    return step;
                }
                Executed::Park(request_id) => {
                    // Reading the web was allowed for this question: answer for the person, as they said to.
                    if turn.web_for_turn
                        && core.capability_of(&call.name).is_some_and(|c| mobius_core::core::TURN_SCOPED.contains(&c.as_str()))
                        && !core.is_once_only(request_id)
                        && !core.is_person_only(request_id)
                        && core.resolve(request_id, true, Duration::Once).is_ok()
                    {
                        core.take_resolution(request_id);
                        queue.push_front(call);
                        continue;
                    }
                    // In Act a reviewer model may answer for the person, but never for a floor (running commands,
                    // deleting files, reading secrets, clicking or typing in a page) or an app set to always ask: those
                    // stop as Needs you, every time.
                    if origin.is_none() && core.approval_mode() == ApprovalMode::Smart && !core.is_person_only(request_id) && !core.is_once_only(request_id) {
                        let request = review_request(turn.setup.model.as_deref().unwrap_or(&self.config.model), &call);
                        turn.parked = Some(Parked { request_id, once_only: core.is_once_only(request_id), reviewing: true, origin: None, earlier: false, call, remaining: queue });
                        return Step::Review { request_id, request };
                    }
                    return self.ask(turn, core, request_id, call, queue, origin);
                }
                Executed::Fatal(message) => return self.fail(turn, message),
            }
        }
        // Everything this round asked for is done, it all changed something, and the model already said its piece
        // beside the calls: nothing is left to say that the summary of the changes does not.
        // A call that failed or asked, or one that only read, means the model has more to do or say. A round of calls
        // with nothing written ends the turn when an earlier round of it already wrote to the person (its lines, each
        // beside its change); in a turn that has written nothing yet, the model is asked once more for its reply.
        let round = &turn.round;
        let read = round.tools.iter().any(|t| t != TODO_TOOL && core.capability_of(t).is_none_or(|c| is_reading(c.as_str())));
        if turn.setup.finish_on_changes && (round.said || turn.said) && round.tools.iter().any(|t| t != TODO_TOOL) && !round.troubled && !read {
            return self.finish(turn);
        }
        self.next_model_call(core, turn)
    }

    /// Put the question to the person.
    fn ask(&self, turn: &mut Turn, core: &Core, request_id: u64, call: ToolCall, remaining: VecDeque<ToolCall>, origin: Option<(String, bool)>) -> Step {
        let once_only = core.is_once_only(request_id);
        let (origin, earlier) = origin.map_or((None, false), |(o, e)| (Some(o), e));
        turn.events.push(AgentEvent::NeedsApproval { request_id, call_id: call.id.clone(), tool: call.name.clone(), arguments: call.arguments.clone(), once_only, origin: origin.clone(), earlier });
        turn.parked = Some(Parked { request_id, once_only, reviewing: false, origin, earlier, call, remaining });
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
                self.ask(turn, core, request_id, parked.call, parked.remaining, None)
            }
            _ => self.ask(turn, core, request_id, parked.call, parked.remaining, None),
        }
    }

    fn execute(&self, core: &mut Core, call: &ToolCall, person_only: bool, project: Option<&str>) -> Executed {
        if !call.arguments.is_object() {
            return Executed::Result { content: "the arguments must be a JSON object".to_owned(), is_error: true };
        }
        let error = |content: String| Executed::Result { content, is_error: true };
        match core.invoke_in(&self.config.principal, &call.name, &call.arguments, person_only, project) {
            Ok(InvokeOutcome::Completed { result }) => Executed::Result { content: untrusted::wrap(&call.name, &call.arguments, &truncate(result.to_string())), is_error: false },
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

    /// The model's plan, written with todo.write: shown, and counted for the turn's progress.
    fn todo(&self, turn: &mut Turn, call: &ToolCall) -> (String, bool) {
        match parse_todo(&call.arguments) {
            Ok(items) => {
                let done = items.iter().filter(|i| i.status == "done").count();
                let summary = format!("Plan updated: {done} of {} done.", items.len());
                turn.plan = Some((u32::try_from(done).unwrap_or(u32::MAX), u32::try_from(items.len()).unwrap_or(u32::MAX)));
                turn.events.push(AgentEvent::Todo { items });
                (summary, false)
            }
            Err(message) => (message, true),
        }
    }

    fn push_result(&self, turn: &mut Turn, call: &ToolCall, content: String, is_error: bool) {
        turn.round.tools.push(call.name.clone());
        turn.round.troubled |= is_error;
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

/// A call's arguments for the conversation to show: every string over a few hundred characters (a whole file's text)
/// cut short, so an event stays small. The model and the tool still get the whole of it.
fn brief_arguments(value: &serde_json::Value) -> serde_json::Value {
    const MAX: usize = 300;
    match value {
        serde_json::Value::String(text) if text.chars().count() > MAX => serde_json::Value::String(format!("{}…", text.chars().take(MAX).collect::<String>())),
        serde_json::Value::Array(items) => serde_json::Value::Array(items.iter().take(50).map(brief_arguments).collect()),
        serde_json::Value::Object(map) => serde_json::Value::Object(map.iter().map(|(k, v)| (k.clone(), brief_arguments(v))).collect()),
        other => other.clone(),
    }
}
