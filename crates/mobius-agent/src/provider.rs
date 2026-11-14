//! The model provider interface. A provider turns a request into a completion, reporting text as it streams.
use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::Value;

use crate::message::{Message, ToolCall};

#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDef>,
    /// How hard the model should think (`low`, `medium` or `high`), when the person chose. Models that do not reason ignore it.
    pub effort: Option<String>,
    /// The most the answer may be, in tokens, when it must be bounded (a summary). Otherwise the server decides.
    pub max_tokens: Option<u32>,
}

/// An `effort` that asks the model not to reason at all, for short mechanical work such as a summary. Sent only to a
/// server on this computer (llama.cpp, vLLM understand it); other providers just do not get an effort.
pub const NO_REASONING: &str = "none";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    EndTurn,
    ToolUse,
    Length,
    Other(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Completion {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop: StopReason,
    /// What the call cost in tokens, when the server said.
    pub usage: Option<Usage>,
}

/// The tokens one model call used, as the server reported them. `cached` is the part of `input` served from the
/// server's cache (cheaper on most services). `model` and `endpoint` say who answered; the core fills them in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Usage {
    pub model: String,
    pub endpoint: String,
    pub input: u64,
    pub output: u64,
    pub cached: u64,
    /// For a model reached through another program (Claude Code), how long that program took to start and be ready
    /// before it asked the model, in ms: part of every round's wait that is not the model's.
    pub startup_ms: Option<u64>,
}

impl Usage {
    pub fn tokens(input: u64, output: u64, cached: u64) -> Usage {
        Usage { input, output, cached: cached.min(input), ..Usage::default() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    #[error("the provider answered with HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error("cannot reach the provider: {0}")]
    Network(String),
    #[error("the provider sent something unexpected: {0}")]
    Protocol(String),
    #[error("cancelled")]
    Cancelled,
}

/// Blocking by design: it runs on a worker thread so the core's event loop stays responsive.
/// `on_text` receives text as it streams; returning `false` asks the provider to stop (`Cancelled`).
pub trait Provider: Send + Sync {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError>;
}

/// A provider that replays a fixed script and records what it was asked. For tests.
pub struct ScriptedProvider {
    script: Mutex<VecDeque<Result<Completion, ProviderError>>>,
    requests: Mutex<Vec<ChatRequest>>,
}

impl ScriptedProvider {
    pub fn new(script: Vec<Result<Completion, ProviderError>>) -> Self {
        ScriptedProvider { script: Mutex::new(script.into()), requests: Mutex::new(Vec::new()) }
    }

    pub fn requests(&self) -> Vec<ChatRequest> {
        self.requests.lock().map(|r| r.clone()).unwrap_or_default()
    }
}

impl Provider for ScriptedProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        if let Ok(mut requests) = self.requests.lock() {
            requests.push(request.clone());
        }
        let next = self.script.lock().ok().and_then(|mut s| s.pop_front());
        let result = next.unwrap_or_else(|| Err(ProviderError::Protocol("the script has no more replies".to_owned())));
        if let Ok(completion) = &result
            && !completion.text.is_empty()
            && !on_text(&completion.text)
        {
            return Err(ProviderError::Cancelled);
        }
        result
    }
}
