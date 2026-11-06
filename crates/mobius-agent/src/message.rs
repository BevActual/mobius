use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolCall {
    pub id: String,
    /// The tool's name as registered in the core, for example `browser.open`.
    pub name: String,
    #[ts(type = "unknown")]
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "role", rename_all = "snake_case")]
#[ts(export)]
pub enum Message {
    User { text: String },
    Assistant { text: String, tool_calls: Vec<ToolCall> },
    /// The result of one tool call. Every call in an assistant message gets exactly one of these.
    Tool { call_id: String, name: String, content: String, is_error: bool },
}
