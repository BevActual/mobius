//! The servers a person has set up, read from `mcp.json`:
//! `{ "servers": { "notes": { "command": "npx.cmd", "args": ["-y", "some-server"], "env": { "KEY": "value" } } } }`
//! A server on the network is an address instead of a command, with any headers it wants (an API key):
//! `{ "servers": { "linear": { "url": "https://mcp.linear.app/mcp", "headers": { "Authorization": "Bearer …" } } } }`
//! An address is `https`, or `http` only on this computer.
use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerConfig {
    /// The program to run, for a server on this computer; empty for one at `url`.
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    /// The address of a server on the network (MCP's Streamable HTTP).
    pub url: Option<String>,
    /// Headers sent with every request to `url`.
    pub headers: BTreeMap<String, String>,
}

/// Whether `url` may be a server's address: `https`, or `http` on this computer only.
pub fn is_server_url(url: &str) -> bool {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if let Some(rest) = lower.strip_prefix("https://") {
        return rest.split(['/', '?', '#']).next().is_some_and(|host| !host.is_empty() && !host.contains('@'));
    }
    let Some(rest) = lower.strip_prefix("http://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let name = if host.starts_with('[') { host.split(']').next().map(|h| format!("{h}]")).unwrap_or_default() } else { host.split(':').next().unwrap_or("").to_owned() };
    matches!(name.as_str(), "127.0.0.1" | "localhost" | "[::1]")
}

/// A header name as HTTP allows it.
fn is_header_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A server's name becomes part of tool and capability names, so it is short and plain.
pub fn is_server_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 24 && chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn parse(text: &str) -> Result<BTreeMap<String, ServerConfig>, String> {
    let root: Value = serde_json::from_str(text).map_err(|_| "mcp.json is not valid JSON".to_owned())?;
    let Some(servers) = root.get("servers").and_then(Value::as_object) else { return Err("mcp.json needs a \"servers\" object".into()) };
    let mut out = BTreeMap::new();
    for (name, entry) in servers {
        if !is_server_name(name) {
            return Err(format!("\"{name}\" is not a usable server name: use lowercase letters, digits and _, starting with a letter"));
        }
        if let Some(url) = entry.get("url").filter(|u| !u.is_null()) {
            let url = url.as_str().map(str::trim).filter(|u| is_server_url(u)).ok_or_else(|| format!("server {name}: url must be an https address (http only on this computer)"))?;
            if entry.get("command").is_some_and(|c| !c.is_null()) {
                return Err(format!("server {name}: give a command or a url, not both"));
            }
            let headers = match entry.get("headers") {
                None | Some(Value::Null) => BTreeMap::new(),
                Some(Value::Object(m)) => m
                    .iter()
                    .map(|(k, v)| match v.as_str() {
                        Some(v) if is_header_name(k) && !v.contains(['\r', '\n']) => Ok((k.clone(), v.to_owned())),
                        _ => Err(format!("server {name}: header {k} must be a plain name and text")),
                    })
                    .collect::<Result<_, _>>()?,
                Some(_) => return Err(format!("server {name}: headers must be an object")),
            };
            out.insert(name.clone(), ServerConfig { url: Some(url.to_owned()), headers, ..ServerConfig::default() });
            continue;
        }
        let command = entry.get("command").and_then(Value::as_str).map(str::trim).filter(|c| !c.is_empty()).ok_or_else(|| format!("server {name} needs a command or a url"))?;
        let args = match entry.get("args") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(a)) => a.iter().map(|v| v.as_str().map(str::to_owned).ok_or_else(|| format!("server {name}: every argument must be text"))).collect::<Result<_, _>>()?,
            Some(_) => return Err(format!("server {name}: args must be a list")),
        };
        let env = match entry.get("env") {
            None | Some(Value::Null) => BTreeMap::new(),
            Some(Value::Object(m)) => m.iter().map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_owned())).ok_or_else(|| format!("server {name}: env {k} must be text"))).collect::<Result<_, _>>()?,
            Some(_) => return Err(format!("server {name}: env must be an object")),
        };
        out.insert(name.clone(), ServerConfig { command: command.to_owned(), args, env, ..ServerConfig::default() });
    }
    Ok(out)
}
