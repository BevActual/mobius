//! OpenAI-compatible chat completions with streaming. Works with any server that speaks `/v1/chat/completions`
//! (hosted providers, llama.cpp, Unsloth Studio, and so on).
use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::message::{Message, ToolCall};
use std::io::Read;
use std::time::Duration;

use crate::provider::{ChatRequest, Completion, Provider, ProviderError, StopReason};
use crate::sse::SseParser;

/// Tool names contain dots (`browser.open`); the wire format allows only letters, digits, `_` and `-`.
/// Our names never contain `-`, so this is reversible.
pub fn to_wire_name(name: &str) -> String {
    name.replace('.', "-")
}

pub fn from_wire_name(name: &str) -> String {
    name.replace('-', ".")
}

pub fn build_request_body(request: &ChatRequest) -> Value {
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({ "role": "system", "content": request.system }));
    }
    for message in &request.messages {
        messages.push(match message {
            Message::User { text } => json!({ "role": "user", "content": text }),
            Message::Assistant { text, tool_calls } if tool_calls.is_empty() => json!({ "role": "assistant", "content": text }),
            Message::Assistant { text, tool_calls } => json!({
                "role": "assistant",
                "content": if text.is_empty() { Value::Null } else { Value::String(text.clone()) },
                "tool_calls": tool_calls.iter().map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    "function": { "name": to_wire_name(&call.name), "arguments": call.arguments.to_string() },
                })).collect::<Vec<_>>(),
            }),
            Message::Tool { call_id, content, is_error, .. } => json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": if *is_error { format!("error: {content}") } else { content.clone() },
            }),
        });
    }
    let mut body = json!({ "model": request.model, "messages": messages, "stream": true });
    if let Some(effort) = &request.effort {
        body["reasoning_effort"] = json!(effort);
    }
    if !request.tools.is_empty() {
        body["tools"] = request
            .tools
            .iter()
            .map(|tool| json!({ "type": "function", "function": { "name": to_wire_name(&tool.name), "description": tool.description, "parameters": tool.input_schema } }))
            .collect::<Vec<_>>()
            .into();
    }
    body
}

fn protocol(message: impl Into<String>) -> ProviderError {
    ProviderError::Protocol(message.into())
}

/// Assembles a streamed response, one decoded chunk at a time.
#[derive(Default)]
pub struct StreamAccumulator {
    text: String,
    calls: BTreeMap<u64, PartialCall>,
    finish_reason: Option<String>,
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        StreamAccumulator::default()
    }

    /// Feed one decoded chunk. Returns the text it added, if any.
    pub fn feed(&mut self, chunk: &Value) -> Result<Option<String>, ProviderError> {
        let chunk = chunk.as_object().ok_or_else(|| protocol("a stream chunk was not an object"))?;
        if let Some(error) = chunk.get("error") {
            let message = error.get("message").and_then(Value::as_str).map_or_else(|| error.to_string(), str::to_owned);
            return Err(protocol(format!("the provider reported an error: {}", message.chars().take(300).collect::<String>())));
        }
        let choices = match chunk.get("choices") {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Array(choices)) => choices,
            Some(_) => return Err(protocol("choices was not a list")),
        };
        let Some(choice) = choices.first() else { return Ok(None) };
        let choice = choice.as_object().ok_or_else(|| protocol("a choice was not an object"))?;
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }
        let delta = match choice.get("delta") {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(delta)) => delta,
            Some(_) => return Err(protocol("delta was not an object")),
        };
        let mut added = None;
        match delta.get("content") {
            None | Some(Value::Null) => {}
            Some(Value::String(text)) => {
                if !text.is_empty() {
                    self.text.push_str(text);
                    added = Some(text.clone());
                }
            }
            Some(_) => return Err(protocol("content was not text")),
        }
        match delta.get("tool_calls") {
            None | Some(Value::Null) => {}
            Some(Value::Array(calls)) => {
                for (position, call) in calls.iter().enumerate() {
                    let call = call.as_object().ok_or_else(|| protocol("a tool call was not an object"))?;
                    let index = match call.get("index") {
                        None | Some(Value::Null) => position as u64,
                        Some(value) => value.as_u64().ok_or_else(|| protocol("a tool call index was not a number"))?,
                    };
                    let partial = self.calls.entry(index).or_default();
                    if let Some(id) = call.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()) {
                        partial.id = id.to_owned();
                    }
                    if let Some(function) = call.get("function").and_then(Value::as_object) {
                        if let Some(name) = function.get("name").and_then(Value::as_str).filter(|n| !n.is_empty())
                            && partial.name.is_empty()
                        {
                            partial.name = name.to_owned();
                        }
                        if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                            partial.arguments.push_str(arguments);
                        }
                    }
                }
            }
            Some(_) => return Err(protocol("tool_calls was not a list")),
        }
        Ok(added)
    }

    /// Nothing at all has been received: no text, no tool calls, no finish reason.
    pub fn is_empty(&self) -> bool {
        self.text.is_empty() && self.calls.is_empty() && self.finish_reason.is_none()
    }

    pub fn finish(self) -> Completion {
        let mut seen = std::collections::HashSet::new();
        let tool_calls: Vec<ToolCall> = self
            .calls
            .into_iter()
            .map(|(index, partial)| {
                let arguments = if partial.arguments.trim().is_empty() {
                    json!({})
                } else {
                    // Not valid JSON is kept as a string; the engine reports that to the model so it can retry.
                    serde_json::from_str(&partial.arguments).unwrap_or(Value::String(partial.arguments))
                };
                let mut id = if partial.id.is_empty() { format!("call_{index}") } else { partial.id };
                while !seen.insert(id.clone()) {
                    id = format!("{id}-{index}");
                }
                ToolCall { id, name: from_wire_name(&partial.name), arguments }
            })
            .collect();
        let stop = match self.finish_reason.as_deref() {
            Some("stop") | None if tool_calls.is_empty() => StopReason::EndTurn,
            Some("stop") | None | Some("tool_calls") | Some("function_call") => StopReason::ToolUse,
            Some("length") => StopReason::Length,
            Some(other) => StopReason::Other(other.to_owned()),
        };
        Completion { text: self.text, tool_calls, stop }
    }
}

const DEFAULT_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 300;

/// A provider for any server that speaks OpenAI-style `/chat/completions`.
pub struct OpenAiProvider {
    base_url: String,
    api_key: Option<String>,
    agent: ureq::Agent,
    max_response_bytes: usize,
}

impl std::fmt::Debug for OpenAiProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAiProvider").field("base_url", &self.base_url).field("api_key", &self.api_key.as_ref().map(|_| "<hidden>")).finish()
    }
}

/// Where the connection goes, for deciding whether a key may travel there.
fn check_base_url(url: &str, has_key: bool) -> Result<(), String> {
    let (scheme, rest) = url.split_once("://").ok_or("the URL needs a scheme such as https://")?;
    let secure = match scheme.to_ascii_lowercase().as_str() {
        "https" => true,
        "http" => false,
        other => return Err(format!("unsupported URL scheme: {other}")),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err("the URL has no host".to_owned());
    }
    if authority.contains('@') {
        return Err("put the key in the key field, not in the URL".to_owned());
    }
    let host = if let Some(stripped) = authority.strip_prefix('[') {
        stripped.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    if host.is_empty() {
        return Err("the URL has no host".to_owned());
    }
    let loopback = host.eq_ignore_ascii_case("localhost") || host == "::1" || host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback());
    if has_key && !secure && !loopback {
        return Err("refusing to send a key over plain http to another machine; use https".to_owned());
    }
    Ok(())
}

impl OpenAiProvider {
    /// `base_url` is the API root, for example `https://api.openai.com/v1` or `http://127.0.0.1:8888/v1`.
    pub fn new(base_url: &str, api_key: Option<String>) -> Result<Self, String> {
        let api_key = api_key.filter(|k| !k.is_empty());
        let base_url = base_url.trim().trim_end_matches('/').to_owned();
        check_base_url(&base_url, api_key.is_some())?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(20 * 60)))
            .build()
            .into();
        Ok(OpenAiProvider { base_url, api_key, agent, max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES })
    }

    pub fn with_max_response_bytes(mut self, limit: usize) -> Self {
        self.max_response_bytes = limit;
        self
    }
}

fn error_message(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_owned).or_else(|| v.get("error").and_then(Value::as_str).map(str::to_owned)))
        .unwrap_or_else(|| text.trim().to_owned());
    message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect()
}

/// A non-streaming reply, rewritten as the one chunk a stream would have produced.
fn chunk_from_full_reply(reply: &Value) -> Result<Value, ProviderError> {
    let choice = reply.pointer("/choices/0").ok_or_else(|| protocol("the reply had no choices"))?;
    let message = choice.get("message").ok_or_else(|| protocol("the reply had no message"))?;
    let mut delta = serde_json::Map::new();
    if let Some(content) = message.get("content") {
        delta.insert("content".to_owned(), content.clone());
    }
    if let Some(Value::Array(calls)) = message.get("tool_calls") {
        let calls: Vec<Value> = calls.iter().enumerate().map(|(i, call)| {
            let mut call = call.clone();
            call["index"] = json!(i);
            call
        }).collect();
        delta.insert("tool_calls".to_owned(), Value::Array(calls));
    }
    Ok(json!({ "choices": [{ "delta": delta, "finish_reason": choice.get("finish_reason").cloned().unwrap_or(Value::Null) }] }))
}

impl Provider for OpenAiProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        let body = build_request_body(request).to_string();
        let mut call = self.agent.post(&format!("{}/chat/completions", self.base_url)).header("Content-Type", "application/json").header("Accept", "text/event-stream, application/json");
        if let Some(key) = &self.api_key {
            call = call.header("Authorization", &format!("Bearer {key}"));
        }
        let mut response = call.send(body.as_bytes()).map_err(|e| ProviderError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        let mut reader = response.body_mut().as_reader();

        if !(200..300).contains(&status) {
            let mut buf = Vec::new();
            reader.take(4096).read_to_end(&mut buf).ok();
            return Err(ProviderError::Http { status, message: error_message(&buf) });
        }

        let too_large = || protocol("the reply was too large");
        let mut acc = StreamAccumulator::new();
        let mut emit = |acc: &mut StreamAccumulator, chunk: &Value| -> Result<(), ProviderError> {
            match acc.feed(chunk)? {
                Some(text) if !on_text(&text) => Err(ProviderError::Cancelled),
                _ => Ok(()),
            }
        };

        if content_type.contains("text/event-stream") {
            let mut parser = SseParser::new();
            let mut total = 0usize;
            let mut buf = [0u8; 8192];
            'read: loop {
                let n = reader.read(&mut buf).map_err(|e| ProviderError::Network(e.to_string()))?;
                if n == 0 {
                    break;
                }
                total += n;
                if total > self.max_response_bytes {
                    return Err(too_large());
                }
                for data in parser.push(&buf[..n]) {
                    if data.trim() == "[DONE]" {
                        break 'read;
                    }
                    let chunk: Value = serde_json::from_str(&data).map_err(|_| protocol("a stream chunk was not valid JSON"))?;
                    emit(&mut acc, &chunk)?;
                }
            }
            if let Some(data) = parser.finish()
                && data.trim() != "[DONE]"
            {
                let chunk: Value = serde_json::from_str(&data).map_err(|_| protocol("the last stream chunk was not valid JSON"))?;
                emit(&mut acc, &chunk)?;
            }
        } else {
            let mut buf = Vec::new();
            reader.take(self.max_response_bytes as u64 + 1).read_to_end(&mut buf).map_err(|e| ProviderError::Network(e.to_string()))?;
            if buf.len() > self.max_response_bytes {
                return Err(too_large());
            }
            let reply: Value = serde_json::from_slice(&buf).map_err(|_| protocol("the reply was not valid JSON"))?;
            if reply.get("error").is_some() {
                emit(&mut acc, &reply)?;
            }
            emit(&mut acc, &chunk_from_full_reply(&reply)?)?;
        }
        if acc.is_empty() {
            return Err(protocol("the provider sent an empty reply"));
        }
        Ok(acc.finish())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::Message;
    use crate::provider::{StopReason, ToolDef};
    use serde_json::json;

    fn feed_all(chunks: Vec<Value>) -> Result<(String, Completion), ProviderError> {
        let mut acc = StreamAccumulator::new();
        let mut streamed = String::new();
        for chunk in chunks {
            if let Some(t) = acc.feed(&chunk)? {
                streamed.push_str(&t);
            }
        }
        Ok((streamed, acc.finish()))
    }
    fn delta(d: Value) -> Value {
        json!({ "choices": [{ "index": 0, "delta": d }] })
    }
    fn finish(reason: &str) -> Value {
        json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": reason }] })
    }

    #[test]
    fn wire_names_round_trip_and_are_legal() {
        for name in ["browser.open", "document.write", "demo.echo", "a.b_c.d9"] {
            let wire = to_wire_name(name);
            assert!(wire.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'), "{wire}");
            assert_eq!(from_wire_name(&wire), name);
        }
    }

    #[test]
    fn text_streams_through_and_ends_the_turn() {
        let (streamed, c) = feed_all(vec![delta(json!({ "role": "assistant", "content": "" })), delta(json!({ "content": "Hel" })), delta(json!({ "content": "lo" })), finish("stop")]).unwrap();
        assert_eq!(streamed, "Hello");
        assert_eq!(c.text, "Hello");
        assert!(c.tool_calls.is_empty());
        assert_eq!(c.stop, StopReason::EndTurn);
    }

    #[test]
    fn tool_calls_assembled_from_fragments_in_index_order() {
        let (_, c) = feed_all(vec![
            delta(json!({ "tool_calls": [{ "index": 1, "id": "call_b", "type": "function", "function": { "name": "demo-echo", "arguments": "" } }] })),
            delta(json!({ "tool_calls": [{ "index": 0, "id": "call_a", "type": "function", "function": { "name": "browser-open", "arguments": "{\"ur" } }] })),
            delta(json!({ "tool_calls": [{ "index": 0, "function": { "arguments": "l\":\"https://a.example\"}" } }] })),
            delta(json!({ "tool_calls": [{ "index": 1, "function": { "arguments": "{\"text\":\"hi\"}" } }] })),
            finish("tool_calls"),
        ])
        .unwrap();
        assert_eq!(c.stop, StopReason::ToolUse);
        assert_eq!(c.tool_calls.len(), 2);
        assert_eq!(c.tool_calls[0], ToolCall { id: "call_a".into(), name: "browser.open".into(), arguments: json!({ "url": "https://a.example" }) });
        assert_eq!(c.tool_calls[1].arguments, json!({ "text": "hi" }));
        assert_eq!(c.tool_calls[1].name, "demo.echo");
    }

    #[test]
    fn text_and_tool_calls_can_share_a_reply() {
        let (streamed, c) = feed_all(vec![delta(json!({ "content": "One moment." })), delta(json!({ "tool_calls": [{ "index": 0, "id": "c", "function": { "name": "demo-echo", "arguments": "{}" } }] })), finish("tool_calls")]).unwrap();
        assert_eq!(streamed, "One moment.");
        assert_eq!(c.tool_calls.len(), 1);
    }

    #[test]
    fn empty_arguments_mean_no_arguments_and_broken_arguments_are_kept_for_the_engine_to_reject() {
        let (_, c) = feed_all(vec![delta(json!({ "tool_calls": [{ "index": 0, "id": "a", "function": { "name": "demo-echo", "arguments": "" } }, { "index": 1, "id": "b", "function": { "name": "demo-echo", "arguments": "{not json" } }] })), finish("tool_calls")]).unwrap();
        assert_eq!(c.tool_calls[0].arguments, json!({}));
        assert_eq!(c.tool_calls[1].arguments, Value::String("{not json".into()), "not an object, so the engine reports it");
    }

    #[test]
    fn a_call_without_an_id_gets_one_and_a_stop_reason_of_stop_with_calls_still_means_tool_use() {
        let (_, c) = feed_all(vec![delta(json!({ "tool_calls": [{ "index": 0, "function": { "name": "demo-echo", "arguments": "{}" } }] })), finish("stop")]).unwrap();
        assert!(!c.tool_calls[0].id.is_empty());
        assert_eq!(c.stop, StopReason::ToolUse);
    }

    #[test]
    fn call_ids_are_unique_within_a_reply_even_if_the_server_repeats_them() {
        let (_, c) = feed_all(vec![
            delta(json!({ "tool_calls": [{ "index": 0, "id": "call_0", "function": { "name": "demo-echo", "arguments": "{}" } }, { "index": 1, "id": "call_0", "function": { "name": "demo-echo", "arguments": "{}" } }, { "index": 2, "function": { "name": "demo-echo", "arguments": "{}" } }] })),
            finish("tool_calls"),
        ])
        .unwrap();
        let ids: Vec<&str> = c.tool_calls.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids[0], "call_0");
        assert_ne!(ids[1], ids[0]);
        assert_eq!(ids.iter().collect::<std::collections::HashSet<_>>().len(), 3);
    }

    #[test]
    fn stop_reasons_map() {
        for (reason, expected) in [("stop", StopReason::EndTurn), ("length", StopReason::Length), ("content_filter", StopReason::Other("content_filter".into()))] {
            let (_, c) = feed_all(vec![delta(json!({ "content": "x" })), finish(reason)]).unwrap();
            assert_eq!(c.stop, expected, "{reason}");
        }
    }

    #[test]
    fn null_content_and_missing_choices_are_tolerated() {
        let (streamed, c) = feed_all(vec![json!({ "choices": [] }), json!({ "usage": { "total_tokens": 5 } }), delta(json!({ "content": null })), delta(json!({ "content": "ok" })), finish("stop")]).unwrap();
        assert_eq!((streamed.as_str(), c.text.as_str()), ("ok", "ok"));
    }

    #[test]
    fn an_error_object_in_the_stream_is_an_error() {
        let result = feed_all(vec![delta(json!({ "content": "partial" })), json!({ "error": { "message": "model overloaded", "type": "server_error" } })]);
        match result {
            Err(ProviderError::Protocol(m)) => assert!(m.contains("model overloaded")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unexpected_shapes_are_protocol_errors_not_panics() {
        for bad in [json!("a string"), json!([1, 2]), json!({ "choices": "nope" }), json!({ "choices": [{ "delta": { "tool_calls": "nope" } }] }), json!({ "choices": [{ "delta": { "tool_calls": [{ "index": "x" }] } }] })] {
            assert!(matches!(StreamAccumulator::new().feed(&bad), Err(ProviderError::Protocol(_))), "{bad}");
        }
    }

    #[test]
    fn the_request_body_maps_messages_tools_and_names() {
        let request = ChatRequest {
            model: "m".into(),
            system: "be brief".into(),
            messages: vec![
                Message::User { text: "hi".into() },
                Message::Assistant { text: String::new(), tool_calls: vec![ToolCall { id: "c1".into(), name: "demo.echo".into(), arguments: json!({ "text": "x" }) }] },
                Message::Tool { call_id: "c1".into(), name: "demo.echo".into(), content: "{\"echo\":1}".into(), is_error: false },
                Message::Tool { call_id: "c2".into(), name: "demo.fail".into(), content: "it broke".into(), is_error: true },
                Message::Assistant { text: "done".into(), tool_calls: vec![] },
            ],
            tools: vec![ToolDef { name: "demo.echo".into(), description: "Echo".into(), input_schema: json!({ "type": "object" }) }],
            effort: None,
        };
        let body = build_request_body(&request);
        assert_eq!(body["model"], "m");
        assert_eq!(body["stream"], true);
        let m = body["messages"].as_array().unwrap();
        assert_eq!(m[0], json!({ "role": "system", "content": "be brief" }));
        assert_eq!(m[1], json!({ "role": "user", "content": "hi" }));
        assert_eq!(m[2]["role"], "assistant");
        assert_eq!(m[2]["content"], Value::Null, "no text means null content when there are tool calls");
        assert_eq!(m[2]["tool_calls"][0]["id"], "c1");
        assert_eq!(m[2]["tool_calls"][0]["type"], "function");
        assert_eq!(m[2]["tool_calls"][0]["function"]["name"], "demo-echo");
        assert_eq!(m[2]["tool_calls"][0]["function"]["arguments"], "{\"text\":\"x\"}", "arguments travel as a JSON string");
        assert_eq!(m[3], json!({ "role": "tool", "tool_call_id": "c1", "content": "{\"echo\":1}" }));
        assert_eq!(m[4]["content"], "error: it broke");
        assert_eq!(m[5], json!({ "role": "assistant", "content": "done" }));
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "demo-echo");
        assert_eq!(body["tools"][0]["function"]["parameters"], json!({ "type": "object" }));
    }

    #[test]
    fn with_no_tools_the_field_is_left_out() {
        let request = ChatRequest { model: "m".into(), system: String::new(), messages: vec![Message::User { text: "hi".into() }], tools: vec![], effort: None };
        let body = build_request_body(&request);
        assert!(body.get("tools").is_none());
        assert_eq!(body["messages"].as_array().unwrap().len(), 1, "an empty system prompt is not sent");
    }

    #[test]
    fn the_effort_is_sent_only_when_one_was_chosen() {
        let mut request = ChatRequest { model: "m".into(), system: String::new(), messages: vec![Message::User { text: "hi".into() }], tools: vec![], effort: None };
        assert!(build_request_body(&request).get("reasoning_effort").is_none());
        request.effort = Some("high".into());
        assert_eq!(build_request_body(&request)["reasoning_effort"], "high");
    }
}
