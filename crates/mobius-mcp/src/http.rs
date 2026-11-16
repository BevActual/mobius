//! MCP's Streamable HTTP transport (spec 2025-06-18): each message is a POST to the server's address. A request's
//! answer comes back as JSON, or as server-sent events that may carry the server's own requests (pings) before it.
//! The session id the server gives at the handshake goes with every later message, and the session is ended when the
//! client goes.
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::Value;

use crate::client::{SIGN_IN_NEEDED, Tokens, answer, outcome};
use crate::config::is_server_url;

type Res<T> = Result<T, String>;

pub(crate) const TIMED_OUT: &str = "timed out";
/// The most a server may send for one answer.
const MAX_ANSWER: u64 = 16 * 1024 * 1024;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) struct Http {
    url: String,
    agent: ureq::Agent,
    headers: Vec<(String, String)>,
    tokens: Option<Arc<dyn Tokens>>,
    session: Mutex<Option<String>>,
    protocol: Mutex<Option<String>>,
}

/// Where a 401's `WWW-Authenticate` says the server's sign-in is described (`resource_metadata`, RFC 9728).
fn resource_metadata(challenge: &str) -> Option<String> {
    let at = challenge.find("resource_metadata=")? + "resource_metadata=".len();
    let rest = &challenge[at..];
    let value = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split([',', ' ']).next()?,
    };
    Some(value.to_owned()).filter(|v| v.starts_with("https://") || v.starts_with("http://"))
}

fn failed(e: &ureq::Error) -> String {
    match e {
        ureq::Error::Timeout(_) => TIMED_OUT.to_owned(),
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut || io.kind() == std::io::ErrorKind::WouldBlock => TIMED_OUT.to_owned(),
        e => format!("could not reach the server: {e}"),
    }
}

impl Http {
    pub(crate) fn new(url: &str, headers: &BTreeMap<String, String>, tokens: Option<Arc<dyn Tokens>>) -> Res<Http> {
        if !is_server_url(url) {
            return Err("a server's address must be https (http only on this computer)".into());
        }
        // No redirects: a token or key must never follow one to another address.
        let agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_connect(Some(Duration::from_secs(15))).build().into();
        Ok(Http { url: url.trim().to_owned(), agent, headers: headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect(), tokens, session: Mutex::new(None), protocol: Mutex::new(None) })
    }

    /// The handshake is done: later messages name the protocol version it settled on.
    pub(crate) fn initialized(&self, version: &str) {
        *lock(&self.protocol) = Some(version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(20).collect());
    }

    /// POST one message, refreshing the token once if the server refuses it.
    fn post(&self, message: &Value, timeout: Duration) -> Res<ureq::http::Response<ureq::Body>> {
        let body = message.to_string();
        let mut stale = false;
        loop {
            let token = match &self.tokens {
                Some(t) => t.bearer(stale)?,
                None => None,
            };
            let mut req = self.agent.post(&self.url).config().timeout_global(Some(timeout)).build().header("Content-Type", "application/json").header("Accept", "application/json, text/event-stream");
            for (k, v) in &self.headers {
                req = req.header(k.as_str(), v.as_str());
            }
            if let Some(token) = &token {
                req = req.header("Authorization", &format!("Bearer {token}"));
            }
            if let Some(session) = lock(&self.session).clone() {
                req = req.header("Mcp-Session-Id", &session);
            }
            if let Some(version) = lock(&self.protocol).clone() {
                req = req.header("MCP-Protocol-Version", &version);
            }
            let response = req.send(body.as_bytes()).map_err(|e| failed(&e))?;
            let status = response.status().as_u16();
            let header = |name: &str| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
            match status {
                401 if token.is_some() && !stale => stale = true,
                401 => return Err(format!("{SIGN_IN_NEEDED}{}", header("www-authenticate").as_deref().and_then(resource_metadata).unwrap_or_else(|| self.url.clone()))),
                403 if header("www-authenticate").is_some_and(|c| c.contains("insufficient_scope")) => {
                    return Err(format!("{SIGN_IN_NEEDED}{}", header("www-authenticate").as_deref().and_then(resource_metadata).unwrap_or_else(|| self.url.clone())));
                }
                404 if lock(&self.session).take().is_some() => return Err("the server ended the session; start the connector again".into()),
                s if s >= 400 => return Err(format!("the server answered HTTP {s}")),
                _ => {
                    if let Some(session) = header("mcp-session-id").filter(|s| !s.is_empty() && s.len() <= 256 && s.bytes().all(|b| (0x21..=0x7e).contains(&b))) {
                        lock(&self.session).get_or_insert(session);
                    }
                    return Ok(response);
                }
            }
        }
    }

    pub(crate) fn notify(&self, message: &Value, timeout: Duration) -> Res<()> {
        self.post(message, timeout).map(|_| ())
    }

    /// Send request `id` and wait for its answer, answering what the server asks meanwhile.
    pub(crate) fn request(&self, id: u64, message: &Value, timeout: Duration) -> Res<Value> {
        let response = self.post(message, timeout)?;
        let events = response.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|c| c.to_ascii_lowercase().starts_with("text/event-stream"));
        let reader = response.into_body().into_reader().take(MAX_ANSWER);
        if !events {
            let mut body = Vec::new();
            BufReader::new(reader).read_to_end(&mut body).map_err(|e| if e.kind() == std::io::ErrorKind::TimedOut { TIMED_OUT.to_owned() } else { format!("the answer did not arrive whole: {e}") })?;
            let value: Value = serde_json::from_slice(&body).map_err(|_| "the server's answer is not JSON".to_owned())?;
            let found = match &value {
                Value::Array(batch) => batch.iter().find(|m| m.get("id").and_then(Value::as_u64) == Some(id)).cloned(),
                one => Some(one.clone()).filter(|m| m.get("id").and_then(Value::as_u64) == Some(id)),
            };
            return found.ok_or_else(|| "the server's answer was for another request".to_owned()).and_then(|m| outcome(&m));
        }
        // Server-sent events: `data:` lines up to a blank line make one message.
        let mut data = String::new();
        for line in BufReader::new(reader).lines() {
            let line = line.map_err(|e| if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock { TIMED_OUT.to_owned() } else { format!("the answer did not arrive whole: {e}") })?;
            if let Some(rest) = line.strip_prefix("data:") {
                data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
                data.push('\n');
                continue;
            }
            if !line.is_empty() || data.is_empty() {
                continue;
            }
            let event = std::mem::take(&mut data);
            let Ok(message) = serde_json::from_str::<Value>(&event) else { continue };
            match (message.get("id"), message.get("method").and_then(Value::as_str)) {
                (Some(asker), Some(method)) => {
                    let _ = self.post(&answer(asker, method), Duration::from_secs(10));
                }
                (Some(of), None) if of.as_u64() == Some(id) => return outcome(&message),
                _ => {}
            }
        }
        Err("the server ended its answer without a reply".into())
    }

    /// Ends the session on the server, without waiting long.
    pub(crate) fn end(&self) {
        let Some(session) = lock(&self.session).take() else { return };
        let mut req = self.agent.delete(&self.url).config().timeout_global(Some(Duration::from_secs(3))).build().header("Mcp-Session-Id", &session);
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(token) = self.tokens.as_ref().and_then(|t| t.bearer(false).ok().flatten()) {
            req = req.header("Authorization", &format!("Bearer {token}"));
        }
        let _ = req.call();
    }
}

#[cfg(test)]
mod tests {
    use super::resource_metadata;

    #[test]
    fn the_sign_in_description_is_read_from_the_challenge() {
        assert_eq!(resource_metadata(r#"Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", error="invalid_token""#).as_deref(), Some("https://mcp.example.com/.well-known/oauth-protected-resource"));
        assert_eq!(resource_metadata("Bearer resource_metadata=https://a.example/m, scope=x").as_deref(), Some("https://a.example/m"));
        assert_eq!(resource_metadata("Bearer realm=x"), None);
        assert_eq!(resource_metadata(r#"Bearer resource_metadata="javascript:x""#), None);
    }
}
