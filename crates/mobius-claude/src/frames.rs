//! Turning a Mobius request into what the Claude Code CLI reads (stream-json frames, a tool manifest, the extra
//! request body), and the captured answer back into a Mobius completion. Pure, so it is tested without a CLI.
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use mobius_agent::message::{Message, ToolCall};
use mobius_agent::openai::{from_wire_name, to_wire_name};
use mobius_agent::provider::{ChatRequest, Completion, StopReason};
use serde_json::{Value, json};

/// Mobius tools are offered to the CLI as tools of an MCP server called `mobius`.
pub const PREFIX: &str = "mcp__mobius__";
const MAX_NATIVE_NAME: usize = 50;

/// Pinned routes: the window each model has through the CLI, and the short names people use.
const ONE_MILLION: &[&str] = &["claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-fable-5-1"];
const ALIASES: &[(&str, &str)] = &[("sonnet", "claude-sonnet-5-5"), ("haiku", "claude-haiku-5-5"), ("opus", "claude-opus-5-5"), ("fable", "claude-fable-5-1"), ("claude-haiku-4-5", "claude-haiku-4-5-20251001")];

/// The models offered in the picker, newest families first: `(id, label)`.
pub const MODELS: &[(&str, &str)] = &[
    ("sonnet", "Sonnet 5.5"),
    ("opus", "Opus 5.5"),
    ("haiku", "Haiku 5.5"),
    ("claude-sonnet-5", "Sonnet 5"),
    ("claude-opus-5", "Opus 5"),
    ("claude-opus-4-8", "Opus 4.8"),
    ("claude-haiku-4-5-20251001", "Haiku 4.5"),
    ("fable", "Fable 5.1 (usage credits on Pro)"),
];

/// What the CLI is asked to run: an alias resolves to its pinned id, and a pinned 1M model gets the explicit `[1m]`
/// route (the CLI otherwise applies its 200K gateway default behind the relay). Unknown names pass through unchanged.
pub fn native_model(model: &str) -> String {
    let base = model.strip_suffix("[1m]").unwrap_or(model);
    let dotted = base.replace('.', "-");
    let with_vendor = if dotted.starts_with("claude-") { dotted.clone() } else { format!("claude-{dotted}") };
    let canonical = ALIASES.iter().find(|(a, _)| *a == base || *a == dotted).map(|(_, id)| (*id).to_owned()).or_else(|| ONE_MILLION.contains(&with_vendor.as_str()).then_some(with_vendor)).unwrap_or_else(|| base.to_owned());
    if ONE_MILLION.contains(&canonical.as_str()) { format!("{canonical}[1m]") } else { canonical }
}

/// The CLI shows names longer than 50 characters under a stable shortened alias.
pub fn native_tool_name(mobius_name: &str) -> String {
    let wire = to_wire_name(mobius_name);
    if wire.len() <= MAX_NATIVE_NAME {
        return wire;
    }
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in wire.bytes() {
        hash = (hash ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{}_{:08x}", &wire[..41], hash & 0xffff_ffff)
}

/// Anthropic refuses a top-level oneOf/allOf/anyOf; the handlers re-check arguments anyway.
fn normalize_schema(schema: &Value) -> Value {
    let mut s = if schema.is_object() { schema.clone() } else { json!({ "type": "object" }) };
    if let Some(m) = s.as_object_mut() {
        for k in ["oneOf", "allOf", "anyOf"] {
            m.remove(k);
        }
        m.entry("type").or_insert(json!("object"));
        if m.get("type") == Some(&json!("object")) && !m.get("properties").is_some_and(Value::is_object) {
            m.insert("properties".into(), json!({}));
        }
    }
    s
}

/// The key a native assistant turn is remembered under: what Mobius keeps of it.
fn projection_key(text: &str, calls: &[ToolCall]) -> String {
    json!({ "text": text.trim(), "calls": calls.iter().map(|c| json!([c.id, c.name, c.arguments])).collect::<Vec<_>>() }).to_string()
}

/// Recent native assistant turns (with their signed thinking), so a tool loop replays them exactly. Kept in memory:
/// after a restart history replays as plain text and tool calls, which the CLI also accepts.
#[derive(Default)]
pub struct NativeTurns {
    turns: Mutex<VecDeque<(String, Vec<Value>)>>,
}

const KEEP_TURNS: usize = 64;

impl NativeTurns {
    pub fn remember(&self, text: &str, calls: &[ToolCall], native: Vec<Value>) {
        let mut t = self.turns.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = projection_key(text, calls);
        t.retain(|(k, _)| *k != key);
        t.push_back((key, native));
        while t.len() > KEEP_TURNS {
            t.pop_front();
        }
    }

    fn find(&self, text: &str, calls: &[ToolCall]) -> Option<Vec<Value>> {
        let key = projection_key(text, calls);
        self.turns.lock().unwrap_or_else(std::sync::PoisonError::into_inner).iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone())
    }
}

#[derive(Debug)]
pub struct Prepared {
    pub system: String,
    pub frames: Vec<Value>,
    /// What the inert MCP server lists.
    pub manifest: Vec<Value>,
    /// The extra request body the CLI merges into its request (`CLAUDE_CODE_EXTRA_BODY`).
    pub body: Value,
    /// Native tool name to Mobius tool name.
    pub names: HashMap<String, String>,
    pub model: String,
    pub effort: Option<String>,
}

pub fn prepare(request: &ChatRequest, natives: &NativeTurns) -> Result<Prepared, String> {
    let mut manifest = Vec::new();
    let mut tools = Vec::new();
    let mut names = HashMap::new();
    for tool in &request.tools {
        let native = native_tool_name(&tool.name);
        if names.insert(native.clone(), tool.name.clone()).is_some() {
            return Err(format!("two tools share the name {native}"));
        }
        let schema = normalize_schema(&tool.input_schema);
        manifest.push(json!({ "name": native, "description": tool.description, "inputSchema": schema }));
        tools.push(json!({ "name": format!("{PREFIX}{native}"), "description": tool.description, "input_schema": schema }));
    }
    let to_native = |mobius: &str| names.iter().find(|(_, m)| m.as_str() == mobius).map_or_else(|| to_wire_name(mobius), |(n, _)| n.clone());
    let mut frames: Vec<Value> = Vec::new();
    let push_user = |frames: &mut Vec<Value>, blocks: Vec<Value>| {
        if let Some(last) = frames.last_mut()
            && last["type"] == "user"
            && let Some(content) = last["message"]["content"].as_array_mut()
        {
            content.extend(blocks);
            return;
        }
        frames.push(json!({ "type": "user", "message": { "role": "user", "content": blocks } }));
    };
    for message in &request.messages {
        match message {
            Message::User { text, images, .. } => {
                let mut blocks = Vec::new();
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                // A `data:image/png;base64,...` URL as the image block Claude reads.
                for url in images {
                    if let Some((kind, data)) = url.strip_prefix("data:").and_then(|u| u.split_once(";base64,")) {
                        blocks.push(json!({ "type": "image", "source": { "type": "base64", "media_type": kind, "data": data } }));
                    }
                }
                if !blocks.is_empty() {
                    push_user(&mut frames, blocks);
                }
            }
            Message::Assistant { text, tool_calls } => {
                if let Some(native) = natives.find(text, tool_calls) {
                    for mut m in native {
                        // The CLI sizes its local "prompt is too long" check from the newest message's usage.
                        if let Some(o) = m.as_object_mut() {
                            o.remove("usage");
                        }
                        frames.push(json!({ "type": "assistant", "message": m }));
                    }
                    continue;
                }
                let mut blocks = Vec::new();
                if !text.is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                for call in tool_calls {
                    blocks.push(json!({ "type": "tool_use", "id": call.id, "name": format!("{PREFIX}{}", to_native(&call.name)), "input": call.arguments }));
                }
                if !blocks.is_empty() {
                    frames.push(json!({ "type": "assistant", "message": { "role": "assistant", "content": blocks } }));
                }
            }
            Message::Tool { call_id, content, is_error, .. } => {
                push_user(&mut frames, vec![json!({ "type": "tool_result", "tool_use_id": call_id, "content": content, "is_error": is_error })]);
            }
        }
    }
    let ends_with_user = frames.last().is_some_and(|f| f["type"] == "user" && f["message"]["content"].as_array().is_some_and(|c| !c.is_empty()));
    if !ends_with_user {
        return Err("the conversation must end with a message or a tool result".into());
    }
    let mut body = json!({ "tools": tools });
    let effort = request.effort.clone().filter(|e| matches!(e.as_str(), "low" | "medium" | "high"));
    if let Some(e) = &effort {
        body["output_config"] = json!({ "effort": e });
    }
    Ok(Prepared { system: request.system.clone(), frames, manifest, body, names, model: native_model(&request.model), effort })
}

/// A session id that stays the same for the whole conversation (the CLI names a scratch folder after it near the top
/// of every request, so a new one each time would move the cache prefix).
pub fn session_id(system: &str, frames: &[Value]) -> String {
    let seed = json!([system, frames.first()]).to_string();
    let (mut a, mut b) = (0xcbf2_9ce4_8422_2325_u64, 0x8422_2325_cbf2_9ce4_u64);
    for byte in seed.bytes() {
        a = (a ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        b = (b.rotate_left(5) ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    let hex = format!("{a:016x}{b:016x}");
    // Shaped as a version-4 UUID, which is what the CLI accepts.
    format!("{}-{}-4{}-a{}-{}", &hex[0..8], &hex[8..12], &hex[13..16], &hex[17..20], &hex[20..32])
}

/// The captured native message as a Mobius completion. Tool names come back without the prefix and as Mobius names.
pub fn completion(message: &Value, names: &HashMap<String, String>) -> Completion {
    let blocks = message["content"].as_array().cloned().unwrap_or_default();
    let text: String = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
    let tool_calls: Vec<ToolCall> = blocks
        .iter()
        .filter(|b| b["type"] == "tool_use")
        .map(|b| {
            let raw = b["name"].as_str().unwrap_or("");
            let native = raw.strip_prefix(PREFIX).unwrap_or(raw);
            let name = names.get(native).cloned().unwrap_or_else(|| from_wire_name(native));
            ToolCall { id: b["id"].as_str().unwrap_or("").to_owned(), name, arguments: b["input"].clone() }
        })
        .collect();
    let stop = match message["stop_reason"].as_str() {
        Some("refusal") => StopReason::Other("refusal".into()),
        _ if !tool_calls.is_empty() => StopReason::ToolUse,
        Some("max_tokens" | "model_context_window_exceeded") => StopReason::Length,
        Some("end_turn" | "stop_sequence") | None => StopReason::EndTurn,
        Some(other) => StopReason::Other(other.to_owned()),
    };
    // A refused turn must not run the call the refusal cut off.
    let tool_calls = if matches!(&stop, StopReason::Other(r) if r == "refusal") { Vec::new() } else { tool_calls };
    Completion { text, tool_calls, stop, usage: usage_of(&message["usage"]) }
}

/// Anthropic's usage: `input_tokens` counts only what was not read from or written to the cache, so the whole input
/// is the three together, and the cached part is what was read.
fn usage_of(usage: &Value) -> Option<mobius_agent::provider::Usage> {
    let n = |k: &str| usage[k].as_u64().unwrap_or(0);
    usage.is_object().then(|| {
        let cached = n("cache_read_input_tokens");
        mobius_agent::provider::Usage::tokens(n("input_tokens") + cached + n("cache_creation_input_tokens"), n("output_tokens"), cached)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mobius_agent::provider::ToolDef;

    fn request(messages: Vec<Message>) -> ChatRequest {
        ChatRequest {
            model: "sonnet".into(),
            system: "Be brief.".into(),
            messages,
            tools: vec![ToolDef { name: "files.read".into(), description: "Read".into(), input_schema: json!({ "type": "object", "properties": { "path": { "type": "string" } }, "anyOf": [] }) }],
            effort: Some("high".into()),
            max_tokens: None,
        }
    }
    fn call(id: &str) -> ToolCall {
        ToolCall { id: id.into(), name: "files.read".into(), arguments: json!({ "path": "a.md" }) }
    }

    #[test]
    fn models_resolve_to_pinned_routes_and_unknown_ones_pass_through() {
        assert_eq!(native_model("sonnet"), "claude-sonnet-5-5[1m]");
        assert_eq!(native_model("opus"), "claude-opus-5-5[1m]");
        assert_eq!(native_model("sonnet-5.5"), "claude-sonnet-5-5[1m]");
        assert_eq!(native_model("claude-opus-4-8"), "claude-opus-4-8[1m]");
        assert_eq!(native_model("claude-haiku-4-5"), "claude-haiku-4-5-20251001");
        assert_eq!(native_model("claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001");
        assert_eq!(native_model("claude-new-9"), "claude-new-9", "never promised a 1M window");
    }

    #[test]
    fn tools_are_offered_under_the_mobius_server_and_long_names_are_shortened_stably() {
        let p = prepare(&request(vec![Message::user("hi")]), &NativeTurns::default()).unwrap();
        assert_eq!(p.manifest[0]["name"], "files-read");
        assert_eq!(p.body["tools"][0]["name"], "mcp__mobius__files-read");
        assert!(p.body["tools"][0]["input_schema"].get("anyOf").is_none());
        assert_eq!(p.body["output_config"]["effort"], "high");
        assert_eq!(p.model, "claude-sonnet-5-5[1m]");
        let long = "mcp.some_server.a_really_long_tool_name_that_goes_on_and_on";
        let a = native_tool_name(long);
        assert_eq!(a.len(), 50);
        assert_eq!(a, native_tool_name(long));
        assert_ne!(a, native_tool_name(&format!("{long}x")));
    }

    #[test]
    fn history_becomes_frames_with_tool_results_merged_into_one_user_turn() {
        let p = prepare(&request(vec![
            Message::user("read two"),
            Message::Assistant { text: "Reading.".into(), tool_calls: vec![call("t1"), call("t2")] },
            Message::Tool { call_id: "t1".into(), name: "files.read".into(), content: "one".into(), is_error: false },
            Message::Tool { call_id: "t2".into(), name: "files.read".into(), content: "nope".into(), is_error: true },
        ]), &NativeTurns::default()).unwrap();
        assert_eq!(p.frames.len(), 3);
        assert_eq!(p.frames[1]["message"]["content"][1], json!({ "type": "tool_use", "id": "t1", "name": "mcp__mobius__files-read", "input": { "path": "a.md" } }));
        let results = p.frames[2]["message"]["content"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[1]["is_error"], true);
    }

    #[test]
    fn a_remembered_native_turn_replays_exactly_with_its_signed_thinking() {
        let natives = NativeTurns::default();
        let native = json!({ "role": "assistant", "content": [{ "type": "thinking", "thinking": "hm", "signature": "s" }, { "type": "text", "text": "Reading." }, { "type": "tool_use", "id": "t1", "name": "mcp__mobius__files-read", "input": { "path": "a.md" } }], "usage": { "input_tokens": 3 } });
        natives.remember("Reading.", &[call("t1")], vec![native]);
        let p = prepare(&request(vec![
            Message::user("read"),
            Message::Assistant { text: "Reading.".into(), tool_calls: vec![call("t1")] },
            Message::Tool { call_id: "t1".into(), name: "files.read".into(), content: "one".into(), is_error: false },
        ]), &natives).unwrap();
        assert_eq!(p.frames[1]["message"]["content"][0]["signature"], "s");
        assert!(p.frames[1]["message"].get("usage").is_none());
        // A turn Mobius changed since does not get the old signed blocks.
        let changed = prepare(&request(vec![
            Message::user("read"),
            Message::Assistant { text: "Reading now.".into(), tool_calls: vec![call("t1")] },
            Message::Tool { call_id: "t1".into(), name: "files.read".into(), content: "one".into(), is_error: false },
        ]), &natives).unwrap();
        assert_eq!(changed.frames[1]["message"]["content"][0]["type"], "text");
    }

    #[test]
    fn a_conversation_must_end_with_the_person_or_a_tool_result() {
        assert!(prepare(&request(vec![Message::user("a"), Message::Assistant { text: "b".into(), tool_calls: vec![] }]), &NativeTurns::default()).is_err());
        assert!(prepare(&request(vec![]), &NativeTurns::default()).is_err());
    }

    #[test]
    fn the_answer_comes_back_as_mobius_tool_calls_and_a_refusal_runs_nothing() {
        let names = HashMap::from([("files-read".to_owned(), "files.read".to_owned())]);
        let m = json!({ "content": [{ "type": "text", "text": "Sure" }, { "type": "tool_use", "id": "t9", "name": "mcp__mobius__files-read", "input": { "path": "x" } }], "stop_reason": "tool_use" });
        let c = completion(&m, &names);
        assert_eq!((c.text.as_str(), c.tool_calls[0].name.as_str(), c.stop.clone()), ("Sure", "files.read", StopReason::ToolUse));
        let refused = json!({ "content": [{ "type": "tool_use", "id": "t9", "name": "mcp__mobius__files-read", "input": {} }], "stop_reason": "refusal" });
        assert!(completion(&refused, &names).tool_calls.is_empty());
        assert_eq!(completion(&json!({ "content": [{ "type": "text", "text": "x" }], "stop_reason": "max_tokens" }), &names).stop, StopReason::Length);
    }

    #[test]
    fn the_session_id_is_stable_for_a_conversation_and_shaped_like_a_uuid() {
        let f = vec![json!({ "type": "user", "message": { "content": [{ "type": "text", "text": "hi" }] } })];
        let a = session_id("s", &f);
        assert_eq!(a, session_id("s", &f));
        assert_ne!(a, session_id("t", &f));
        let parts: Vec<_> = a.split('-').map(str::len).collect();
        assert_eq!(parts, [8, 4, 4, 4, 12]);
    }

    #[test]
    fn pictures_go_as_image_blocks() {
        let p = prepare(&request(vec![Message::User { text: "what is this?".into(), images: vec!["data:image/png;base64,iVBORw0KGgo=".into()], at_ms: None }]), &NativeTurns::default()).unwrap();
        assert_eq!(p.frames[0]["message"]["content"][1], json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" } }));
    }

}
