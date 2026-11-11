//! A provider for OpenAI's Responses API (`/responses`), which the ChatGPT plan's Codex endpoint speaks.
//!
//! Request and stream shapes follow OpenAI's Responses API and Hermes Agent's Codex transport (MIT,
//! `agent/transports/codex.py`): the system prompt goes in `instructions`, history is a list of `message`,
//! `function_call` and `function_call_output` items, nothing is stored on OpenAI's side, and the answer streams as
//! `response.*` events.
use std::io::Read;
use std::time::Duration;

use serde_json::{Value, json};

use crate::message::{Message, ToolCall};
use crate::openai::{from_wire_name, to_wire_name};
use crate::provider::{ChatRequest, Completion, NO_REASONING, Provider, ProviderError, StopReason};
use crate::sse::SseParser;

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ERROR_CHARS: usize = 300;

fn base64url(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(u8::try_from((acc >> bits) & 0xff).ok()?);
        }
    }
    Some(out)
}

/// The claims of a JSON web token, read without checking its signature (only to learn which account it is for and
/// when it expires; the server checks the signature).
pub fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    serde_json::from_slice(&base64url(payload)?).ok()
}

/// What a ChatGPT plan request sends besides the token: only who is calling. OpenAI's public Responses API takes
/// the account and workspace from the token itself.
pub fn chatgpt_headers(_token: &str) -> Vec<(String, String)> {
    vec![("User-Agent".to_owned(), format!("Mobius/{}", env!("CARGO_PKG_VERSION")))]
}

/// What to tell the person for a ChatGPT plan error, when it is one with its own advice
/// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
pub fn plan_error(code: &str) -> Option<&'static str> {
    Some(match code {
        "subscription_sharing_usage_limit_exceeded" => "Mobius has reached its limit on your ChatGPT plan for now. See Manage usage in ChatGPT Settings, Usage.",
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => "ChatGPT could not check your plan's usage just now. Try again in a moment.",
        "subscription_sharing_user_not_eligible" => "This ChatGPT account cannot use its plan in other apps. Use an OpenAI API key instead.",
        "subscription_sharing_unsupported_capability" => "Your ChatGPT plan cannot do that through Mobius (images, files or a tool it does not allow).",
        "subscription_sharing_invalid_user" | "chatpass_v2_scope_not_authorized" | "chatpass_v2_invalid_authorization_context" => "ChatGPT did not accept the sign-in for your plan. Sign in again in Settings, Gateways.",
        _ => return None,
    })
}

/// The request body for one model call.
pub fn build_body(request: &ChatRequest) -> Value {
    let mut input = Vec::new();
    for message in &request.messages {
        match message {
            Message::User { text, images, .. } => {
                let mut content = vec![json!({ "type": "input_text", "text": text })];
                content.extend(images.iter().map(|url| json!({ "type": "input_image", "image_url": url })));
                input.push(json!({ "type": "message", "role": "user", "content": content }));
            }
            Message::Assistant { text, tool_calls } => {
                if !text.is_empty() {
                    input.push(json!({ "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": text }] }));
                }
                for call in tool_calls {
                    input.push(json!({ "type": "function_call", "call_id": call.id, "name": to_wire_name(&call.name), "arguments": call.arguments.to_string() }));
                }
            }
            Message::Tool { call_id, content, is_error, .. } => {
                input.push(json!({ "type": "function_call_output", "call_id": call_id, "output": if *is_error { format!("error: {content}") } else { content.clone() } }));
            }
        }
    }
    let mut body = json!({ "model": request.model, "instructions": request.system, "input": input, "store": false, "stream": true });
    if !request.tools.is_empty() {
        body["tools"] = request
            .tools
            .iter()
            .map(|t| json!({ "type": "function", "name": to_wire_name(&t.name), "description": t.description, "parameters": t.input_schema, "strict": false }))
            .collect::<Vec<_>>()
            .into();
        body["tool_choice"] = json!("auto");
        body["parallel_tool_calls"] = json!(true);
    }
    if let Some(effort) = request.effort.as_deref().filter(|e| *e != NO_REASONING) {
        body["reasoning"] = json!({ "effort": effort });
    }
    body
}

/// Assembles the streamed answer.
#[derive(Default)]
pub struct ResponsesStream {
    text: String,
    calls: Vec<ToolCall>,
    status: Option<String>,
    incomplete_reason: Option<String>,
}

fn status_for(code: &str) -> u16 {
    match code {
        "rate_limit_exceeded" | "insufficient_quota" | "usage_limit_reached" | "subscription_sharing_usage_limit_exceeded" => 429,
        "context_length_exceeded" | "invalid_request_error" | "invalid_prompt" | "subscription_sharing_unsupported_capability" => 400,
        "subscription_sharing_invalid_user" => 401,
        "subscription_sharing_user_not_eligible" | "chatpass_v2_scope_not_authorized" | "chatpass_v2_invalid_authorization_context" => 403,
        "server_error" => 500,
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => 503,
        _ => 502,
    }
}

impl ResponsesStream {
    /// One event. Returns the text it added, if any.
    pub fn feed(&mut self, event: &Value) -> Result<Option<String>, ProviderError> {
        let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "response.output_text.delta" => {
                let delta = event.get("delta").and_then(Value::as_str).unwrap_or("");
                self.text.push_str(delta);
                return Ok((!delta.is_empty()).then(|| delta.to_owned()));
            }
            "response.output_item.done" => {
                let item = event.get("item").unwrap_or(&Value::Null);
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    let raw = item.get("arguments").and_then(Value::as_str).unwrap_or("{}");
                    let arguments = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw }).map_err(|_| ProviderError::Protocol("a tool call's arguments were not JSON".into()))?;
                    let id = item.get("call_id").and_then(Value::as_str).filter(|s| !s.is_empty()).map_or_else(|| format!("call_{}", self.calls.len()), str::to_owned);
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
                    self.calls.push(ToolCall { id, name: from_wire_name(name), arguments });
                }
            }
            "response.completed" | "response.incomplete" => {
                let response = event.get("response").unwrap_or(&Value::Null);
                self.status = Some(response.get("status").and_then(Value::as_str).unwrap_or(if kind == "response.completed" { "completed" } else { "incomplete" }).to_owned());
                self.incomplete_reason = response.pointer("/incomplete_details/reason").and_then(Value::as_str).map(str::to_owned);
            }
            "response.failed" | "error" => {
                let error = event.pointer("/response/error").or_else(|| event.get("error")).unwrap_or(event);
                let code = error.get("code").and_then(Value::as_str).unwrap_or("");
                let message: String = plan_error(code).or_else(|| error.get("message").and_then(Value::as_str)).unwrap_or("the model failed").chars().take(MAX_ERROR_CHARS).collect();
                return Err(ProviderError::Http { status: status_for(code), message });
            }
            _ => {}
        }
        Ok(None)
    }

    pub fn finish(self) -> Result<Completion, ProviderError> {
        if self.status.is_none() {
            return Err(ProviderError::Network("the answer stopped before it was complete".into()));
        }
        let stop = if !self.calls.is_empty() {
            StopReason::ToolUse
        } else if self.status.as_deref() == Some("incomplete") {
            if self.incomplete_reason.as_deref() == Some("max_output_tokens") { StopReason::Length } else { StopReason::Other(self.incomplete_reason.unwrap_or_else(|| "incomplete".into())) }
        } else {
            StopReason::EndTurn
        };
        Ok(Completion { text: self.text, tool_calls: self.calls, stop })
    }
}

/// A Responses API endpoint with a bearer token and fixed extra headers (for ChatGPT: the account the token is for).
pub struct ResponsesProvider {
    url: String,
    token: String,
    headers: Vec<(String, String)>,
    agent: ureq::Agent,
}

impl std::fmt::Debug for ResponsesProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponsesProvider").field("url", &self.url).field("token", &"<hidden>").finish()
    }
}

impl ResponsesProvider {
    /// `base_url` is the API root (`https://api.openai.com/v1`); requests go to `<base>/responses`.
    pub fn new(base_url: &str, token: &str, headers: Vec<(String, String)>) -> Result<Self, String> {
        let base = base_url.trim().trim_end_matches('/');
        crate::openai::check_base_url(base, true)?;
        if token.trim().is_empty() {
            return Err("there is no sign-in to use".into());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_global(Some(Duration::from_secs(20 * 60)))
            .build()
            .into();
        Ok(ResponsesProvider { url: format!("{base}/responses"), token: token.trim().to_owned(), headers, agent })
    }
}

fn error_text(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.pointer("/error/code").and_then(Value::as_str).and_then(plan_error).map(Value::from).or_else(|| v.pointer("/error/message").cloned()).or_else(|| v.get("detail").cloned()))
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| text.trim().to_owned())
        .chars()
        .take(MAX_ERROR_CHARS)
        .collect()
}

impl Provider for ResponsesProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        let body = build_body(request).to_string();
        let mut call = self.agent.post(&self.url).header("Content-Type", "application/json").header("Accept", "text/event-stream").header("Authorization", &format!("Bearer {}", self.token));
        for (name, value) in &self.headers {
            call = call.header(name, value);
        }
        let mut response = call.send(body.as_bytes()).map_err(|e| ProviderError::Network(e.to_string()))?;
        let status = response.status().as_u16();
        let mut reader = response.body_mut().as_reader();
        if !(200..300).contains(&status) {
            let mut buf = Vec::new();
            reader.take(8192).read_to_end(&mut buf).ok();
            return Err(ProviderError::Http { status, message: error_text(&buf) });
        }
        let mut parser = SseParser::new();
        let mut stream = ResponsesStream::default();
        let mut total = 0usize;
        let mut buf = [0u8; 8192];
        let mut handle = |stream: &mut ResponsesStream, data: &str| -> Result<(), ProviderError> {
            let Ok(event) = serde_json::from_str::<Value>(data) else { return Ok(()) };
            match stream.feed(&event)? {
                Some(text) if !on_text(&text) => Err(ProviderError::Cancelled),
                _ => Ok(()),
            }
        };
        loop {
            let n = reader.read(&mut buf).map_err(|e| ProviderError::Network(e.to_string()))?;
            if n == 0 {
                break;
            }
            total += n;
            if total > MAX_RESPONSE_BYTES {
                return Err(ProviderError::Protocol("the reply was too large".into()));
            }
            for data in parser.push(&buf[..n]) {
                handle(&mut stream, &data)?;
            }
            if stream.status.is_some() {
                break;
            }
        }
        if let Some(data) = parser.finish() {
            handle(&mut stream, &data)?;
        }
        stream.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ToolDef;

    fn request() -> ChatRequest {
        ChatRequest {
            model: "gpt-5.5".into(),
            system: "You are Mobius.".into(),
            messages: vec![
                Message::user("read it"),
                Message::Assistant { text: "Reading.".into(), tool_calls: vec![ToolCall { id: "c1".into(), name: "files.read".into(), arguments: json!({ "path": "a" }) }] },
                Message::Tool { call_id: "c1".into(), name: "files.read".into(), content: "nope".into(), is_error: true },
            ],
            tools: vec![ToolDef { name: "files.read".into(), description: "Read".into(), input_schema: json!({ "type": "object" }) }],
            effort: Some("high".into()),
            max_tokens: Some(100),
        }
    }

    #[test]
    fn history_becomes_response_items_and_nothing_is_stored() {
        let b = build_body(&request());
        assert_eq!(b["instructions"], "You are Mobius.");
        assert_eq!((b["store"].clone(), b["stream"].clone()), (json!(false), json!(true)));
        assert_eq!(b["input"][0], json!({ "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "read it" }] }));
        assert_eq!(b["input"][1]["content"][0]["type"], "output_text");
        assert_eq!(b["input"][2], json!({ "type": "function_call", "call_id": "c1", "name": "files-read", "arguments": "{\"path\":\"a\"}" }));
        assert_eq!(b["input"][3], json!({ "type": "function_call_output", "call_id": "c1", "output": "error: nope" }));
        assert_eq!(b["tools"][0]["name"], "files-read");
        assert_eq!(b["reasoning"]["effort"], "high");
        assert!(b.get("max_output_tokens").is_none(), "the ChatGPT endpoint refuses an output limit");
        let mut none = request();
        none.effort = Some(NO_REASONING.into());
        none.tools.clear();
        let b = build_body(&none);
        assert!(b.get("reasoning").is_none() && b.get("tools").is_none() && b.get("tool_choice").is_none());
    }

    #[test]
    fn a_streamed_answer_with_a_tool_call_is_assembled() {
        let mut s = ResponsesStream::default();
        assert_eq!(s.feed(&json!({ "type": "response.created" })).unwrap(), None);
        assert_eq!(s.feed(&json!({ "type": "response.output_text.delta", "delta": "Hel" })).unwrap().as_deref(), Some("Hel"));
        s.feed(&json!({ "type": "response.output_text.delta", "delta": "lo" })).unwrap();
        s.feed(&json!({ "type": "response.output_item.done", "item": { "type": "reasoning", "id": "r" } })).unwrap();
        s.feed(&json!({ "type": "response.output_item.done", "item": { "type": "function_call", "call_id": "call_9", "name": "files-read", "arguments": "{\"path\":\"x\"}" } })).unwrap();
        s.feed(&json!({ "type": "response.completed", "response": { "status": "completed" } })).unwrap();
        let c = s.finish().unwrap();
        assert_eq!((c.text.as_str(), c.stop.clone()), ("Hello", StopReason::ToolUse));
        assert_eq!(c.tool_calls, vec![ToolCall { id: "call_9".into(), name: "files.read".into(), arguments: json!({ "path": "x" }) }]);
    }

    #[test]
    fn endings_and_failures_are_reported_as_mobius_knows_them() {
        let mut s = ResponsesStream::default();
        s.feed(&json!({ "type": "response.incomplete", "response": { "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" } } })).unwrap();
        assert_eq!(s.finish().unwrap().stop, StopReason::Length);
        let failed = ResponsesStream::default().feed(&json!({ "type": "response.failed", "response": { "error": { "code": "rate_limit_exceeded", "message": "slow down" } } }));
        assert_eq!(failed, Err(ProviderError::Http { status: 429, message: "slow down".into() }));
        let overflow = ResponsesStream::default().feed(&json!({ "type": "response.failed", "response": { "error": { "code": "context_length_exceeded", "message": "Your input exceeds the context window of this model." } } })).unwrap_err();
        assert!(crate::compaction::is_context_overflow(&overflow), "a long conversation makes room and is tried again");
        assert!(matches!(ResponsesStream::default().finish(), Err(ProviderError::Network(_))), "a stream that never finished is not an answer");
        assert!(ResponsesStream::default().feed(&json!({ "type": "response.output_item.done", "item": { "type": "function_call", "call_id": "c", "name": "x", "arguments": "{oops" } })).is_err());
    }

    /// A token with these claims (unsigned: only the middle part matters here).
    pub(crate) fn fake_jwt(claims: &Value) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let bytes = claims.to_string().into_bytes();
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let n = chunk.iter().enumerate().fold(0u32, |a, (i, b)| a | (u32::from(*b) << (16 - 8 * i)));
            for i in 0..=chunk.len() {
                out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
            }
        }
        format!("h.{out}.s")
    }

    #[test]
    fn plan_errors_say_what_to_do() {
        let token = fake_jwt(&json!({ "exp": 99 }));
        assert_eq!(jwt_claims(&token).unwrap()["exp"], 99);
        assert_eq!(chatgpt_headers(&token).len(), 1, "only who is calling: no private headers");
        let mut stream = ResponsesStream::default();
        let failed = json!({ "type": "response.failed", "response": { "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "x" } } });
        match stream.feed(&failed) {
            Err(ProviderError::Http { status, message }) => assert!(status == 429 && message.contains("Manage usage"), "{message}"),
            other => panic!("{other:?}"),
        }
        assert!(error_text(br#"{"error":{"code":"subscription_sharing_user_not_eligible","message":"no"}}"#).contains("API key"));
        assert_eq!(error_text(br#"{"detail":"blocked"}"#), "blocked");
    }

    #[test]
    fn the_token_is_required_and_never_shown() {
        assert!(ResponsesProvider::new("https://api.openai.com/v1", " ", vec![]).is_err());
        assert!(ResponsesProvider::new("http://chatgpt.example/x", "t", vec![]).is_err(), "never over plain http to another machine");
        let p = ResponsesProvider::new("https://api.openai.com/v1/", "SECRET", vec![]).unwrap();
        assert!(!format!("{p:?}").contains("SECRET"));
        assert_eq!(p.url, "https://api.openai.com/v1/responses");
    }

    #[test]
    fn pictures_go_as_input_images() {
        let mut r = request();
        r.messages = vec![Message::User { text: "look".into(), images: vec!["data:image/jpeg;base64,AAAA".into()], at_ms: None }];
        let body = build_body(&r);
        assert_eq!(body["input"][0]["content"][1], json!({ "type": "input_image", "image_url": "data:image/jpeg;base64,AAAA" }));
    }

}
