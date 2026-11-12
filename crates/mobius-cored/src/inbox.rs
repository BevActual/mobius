//! Everything the daemon's main loop can be woken up by.
use mobius_agent::provider::{Completion, ProviderError, Usage};

pub enum Line {
    Eof,
    Text(String),
    TooLong,
}

pub enum Inbox {
    Line(Line),
    InputFailed(String),
    /// Text streamed by a model call that is running on a worker thread.
    Text { turn_id: u64, text: String },
    /// A second model took over a turn because the first one failed.
    Switched { turn_id: u64, model: String, why: String },
    /// A worker thread finished its model call.
    ModelDone { turn_id: u64, result: Result<Completion, ProviderError> },
    /// What a model call used, sent just before its result. `kind` is `chat` or `quick` (a review).
    Usage { turn_id: u64, kind: &'static str, usage: Usage },
    /// A worker thread finished asking the reviewer model about a question (smart approvals).
    Verdict { turn_id: u64, request_id: u64, result: Result<Completion, ProviderError> },
    /// A background search for models finished.
    Job { job: String, result: Result<serde_json::Value, String> },
    /// A notification to pass on to the application as it is.
    Notify(serde_json::Value),
}
