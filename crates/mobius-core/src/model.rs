use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PrincipalKind {
    /// The user, acting directly through the interface. The user is the authority and is never gated.
    Person,
    /// An agent, such as the Mobius agent or an outside agent connected over MCP or ACP.
    Agent,
    /// A tool server Mobius connects to as an MCP client.
    McpServer,
    Plugin,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct Principal {
    pub kind: PrincipalKind,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ModelError {
    #[error("invalid capability: {0}")]
    Capability(String),
    #[error("invalid principal id")]
    PrincipalId,
    #[error("invalid resource")]
    Resource,
}

pub const MAX_ID_LEN: usize = 128;
pub const MAX_RESOURCE_LEN: usize = 512;

impl Principal {
    pub fn new(kind: PrincipalKind, id: &str) -> Result<Self, ModelError> {
        let p = Principal { kind, id: id.to_owned() };
        p.validate()?;
        Ok(p)
    }

    /// Anything that arrives from outside the core must be validated before it is trusted.
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.id.is_empty() || self.id.len() > MAX_ID_LEN || self.id.chars().any(char::is_control) {
            return Err(ModelError::PrincipalId);
        }
        Ok(())
    }
}

/// A capability is a dotted, lowercase name such as `browser.read` or `process.exec`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, TS)]
#[ts(type = "string", export)]
pub struct Capability(String);

impl Serialize for Capability {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// Deserializing validates, so a malformed capability can never exist inside the core.
impl<'de> Deserialize<'de> for Capability {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Capability::new(&text).map_err(serde::de::Error::custom)
    }
}

impl Capability {
    pub fn new(name: &str) -> Result<Self, ModelError> {
        let ok = name.len() <= 64
            && name.split('.').count() >= 2
            && name.split('.').all(|seg| {
                let mut chars = seg.chars();
                chars.next().is_some_and(|c| c.is_ascii_lowercase())
                    && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            });
        if ok { Ok(Capability(name.to_owned())) } else { Err(ModelError::Capability(name.chars().take(64).collect())) }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A resource is a concrete identifier (a URL, an artifact id), never a pattern. A trailing `*` is refused so
/// that what a person approves is exactly what was asked for, not something that reads as a wildcard.
pub fn validate_resource(resource: &str) -> Result<(), ModelError> {
    if resource.len() > MAX_RESOURCE_LEN || resource.ends_with('*') || resource.chars().any(char::is_control) {
        return Err(ModelError::Resource);
    }
    Ok(())
}

/// The origin of a web address: its scheme, host and port, lowercased, and nothing else. Only plain `http` and `https`
/// addresses with a simple ASCII host qualify; anything that could be read two ways (user names, backslashes,
/// whitespace) is refused, so what a person approves is what will be opened.
pub fn origin_of(url: &str) -> Result<String, ModelError> {
    if url.len() > MAX_RESOURCE_LEN || url.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\') {
        return Err(ModelError::Resource);
    }
    let (scheme, rest) = url.split_once("://").ok_or(ModelError::Resource)?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(ModelError::Resource);
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err(ModelError::Resource);
    }
    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']').ok_or(ModelError::Resource)?;
        let host = &authority[..=end];
        let inner = &host[1..host.len() - 1];
        if inner.is_empty() || !inner.chars().all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.') {
            return Err(ModelError::Resource);
        }
        (host, authority[end + 1..].strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    if host.is_empty() || (!host.starts_with('[') && !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')) {
        return Err(ModelError::Resource);
    }
    if let Some(port) = port
        && (port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) || port.parse::<u32>().is_ok_and(|p| p == 0 || p > 65_535))
    {
        return Err(ModelError::Resource);
    }
    let host = host.to_ascii_lowercase();
    Ok(match port {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Effect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Duration {
    /// Valid for one use, within a short window.
    Once,
    /// Valid until the core process stops.
    Session,
    /// Persisted until revoked.
    Always,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Grant {
    #[ts(type = "number")]
    pub id: u64,
    pub principal: Principal,
    pub capability: Capability,
    /// `None` matches every resource. `Some("a*")` matches resources starting with `a`; otherwise exact.
    pub resource: Option<String>,
    pub effect: Effect,
    pub duration: Duration,
    #[ts(type = "number")]
    pub created_ms: u64,
    /// Set for `Once` grants so an old approval cannot be used later.
    #[ts(type = "number | null")]
    pub expires_ms: Option<u64>,
}

/// The answer to "may this principal do this?".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "decision", rename_all = "snake_case")]
#[ts(export)]
pub enum Decision {
    Allow,
    Deny { reason: String },
    /// Someone must decide. Resolve the request to continue.
    Ask {
        #[ts(type = "number")]
        request_id: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PendingRequest {
    #[ts(type = "number")]
    pub id: u64,
    pub principal: Principal,
    pub capability: Capability,
    pub resource: Option<String>,
    #[ts(type = "number")]
    pub created_ms: u64,
}

/// One entry in the append-only log. Arguments are never recorded, only what was decided and by whom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    #[ts(type = "number")]
    pub seq: u64,
    #[ts(type = "number")]
    pub ts_ms: u64,
    pub kind: String,
    pub principal: Option<Principal>,
    pub capability: Option<String>,
    pub resource: Option<String>,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}
