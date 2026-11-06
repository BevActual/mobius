//! The servers a person has set up, read from `mcp.json`:
//! `{ "servers": { "notes": { "command": "npx.cmd", "args": ["-y", "some-server"], "env": { "KEY": "value" } } } }`
use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
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
        let command = entry.get("command").and_then(Value::as_str).map(str::trim).filter(|c| !c.is_empty()).ok_or_else(|| format!("server {name} needs a command"))?;
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
        out.insert(name.clone(), ServerConfig { command: command.to_owned(), args, env });
    }
    Ok(out)
}
