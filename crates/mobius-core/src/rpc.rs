//! JSON-RPC 2.0 over lines. Everything arriving here comes from another process and is validated first.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::core::{Core, CoreError, ToolSpec};
use crate::model::{Capability, Duration, Principal, validate_resource};
use crate::permissions::ApprovalMode;

pub const PROTOCOL_VERSION: u32 = 1;
/// The largest tool arguments accepted in one call.
pub const MAX_ARGS_BYTES: usize = 256 * 1024;
const DEFAULT_EVENT_LIMIT: u32 = 100;

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const INTERNAL_ERROR: i64 = -32603;
const APPLICATION_ERROR: i64 = -32000;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PingResult {
    pub protocol: u32,
    pub version: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct InvokeParams {
    pub principal: Principal,
    pub tool: String,
    #[serde(default)]
    #[ts(type = "unknown")]
    pub args: Value,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct RegisterExternalParams {
    pub name: String,
    pub description: String,
    pub capability: String,
    #[serde(default)]
    pub resource_arg: Option<String>,
    #[serde(default)]
    pub resource_origin: bool,
    #[serde(default)]
    #[ts(type = "unknown")]
    pub input_schema: Option<Value>,
}

const MAX_DESCRIPTION_CHARS: usize = 2000;
const MAX_SCHEMA_BYTES: usize = 16 * 1024;

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct CheckParams {
    pub principal: Principal,
    pub capability: Capability,
    #[serde(default)]
    pub resource: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetModeParams {
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SetRulesParams {
    rules: Vec<crate::permissions::Rule>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct ResolveParams {
    #[ts(type = "number")]
    pub request_id: u64,
    pub approve: bool,
    pub duration: Duration,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct RevokeParams {
    #[ts(type = "number")]
    pub grant_id: u64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct EventsParams {
    #[serde(default)]
    #[ts(type = "number | undefined", optional)]
    pub after_seq: Option<u64>,
    #[serde(default)]
    #[ts(type = "number | undefined", optional)]
    pub limit: Option<u32>,
    /// The most recent events, newest first, instead of paging forward from the start.
    #[serde(default)]
    pub newest: bool,
}

struct RpcError {
    code: i64,
    message: String,
    data: Option<Value>,
}

impl RpcError {
    fn new(code: i64, message: &str) -> Self {
        RpcError { code, message: message.to_owned(), data: None }
    }
    fn invalid_params(detail: impl AsRef<str>) -> Self {
        let detail: String = detail.as_ref().chars().take(200).collect();
        RpcError { code: INVALID_PARAMS, message: format!("invalid params: {detail}"), data: None }
    }
    fn application(kind: &str, message: String) -> Self {
        RpcError { code: APPLICATION_ERROR, message, data: Some(json!({ "kind": kind })) }
    }
}

impl From<CoreError> for RpcError {
    fn from(error: CoreError) -> Self {
        match error {
            // Storage details stay in the log, not on the wire.
            CoreError::Store(inner) => {
                eprintln!("mobius-cored: storage error: {inner}");
                RpcError::new(INTERNAL_ERROR, "internal error")
            }
            CoreError::Model(inner) => RpcError::invalid_params(inner.to_string()),
            CoreError::UnknownTool(_) => RpcError::application("unknown_tool", error.to_string()),
            CoreError::DuplicateTool(_) => RpcError::application("duplicate_tool", error.to_string()),
            CoreError::UnknownRequest(_) => RpcError::application("unknown_request", error.to_string()),
            CoreError::UnknownGrant(_) => RpcError::application("unknown_grant", error.to_string()),
            CoreError::InvalidArgs(_) => RpcError::application("invalid_args", error.to_string()),
            CoreError::StandingNotAllowed(_) => RpcError::application("standing_not_allowed", error.to_string()),
        }
    }
}

fn response(id: Value, result: Result<Value, RpcError>) -> String {
    let body = match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err(error) => {
            let mut object = json!({ "code": error.code, "message": error.message });
            if let (Some(data), Some(map)) = (error.data, object.as_object_mut()) {
                map.insert("data".to_owned(), data);
            }
            json!({ "jsonrpc": "2.0", "id": id, "error": object })
        }
    };
    body.to_string()
}

fn parse_params<T: DeserializeOwned>(params: Option<&Value>) -> Result<T, RpcError> {
    let value = match params {
        None | Some(Value::Null) => json!({}),
        Some(value @ Value::Object(_)) => value.clone(),
        Some(_) => return Err(RpcError::invalid_params("params must be an object")),
    };
    serde_json::from_value(value).map_err(|error| RpcError::invalid_params(error.to_string()))
}

/// A failure from an extension method, reported with the same shapes as the built-in methods.
pub struct ExtensionError(RpcError);

impl ExtensionError {
    pub fn invalid_params(detail: impl AsRef<str>) -> Self {
        ExtensionError(RpcError::invalid_params(detail))
    }
    pub fn application(kind: &str, message: &str) -> Self {
        ExtensionError(RpcError::application(kind, message.to_owned()))
    }
}

/// Methods owned by something outside the core (the agent, for one). Offered only the methods the core does not
/// know, so an extension can never shadow a built-in. Return `None` for a method you do not own.
pub trait Extension {
    fn call(&mut self, core: &mut Core, method: &str, params: Option<&Value>) -> Option<Result<Value, ExtensionError>>;
}

struct NoExtension;

impl Extension for NoExtension {
    fn call(&mut self, _: &mut Core, _: &str, _: Option<&Value>) -> Option<Result<Value, ExtensionError>> {
        None
    }
}

/// Parse and check method parameters the same way the built-in methods do.
pub fn params_as<T: DeserializeOwned>(params: Option<&Value>) -> Result<T, ExtensionError> {
    parse_params(params).map_err(ExtensionError)
}

/// Handle one line. Returns the response line, or `None` for a notification (a request without an id).
pub fn handle_line(core: &mut Core, line: &str) -> Option<String> {
    handle_line_with(core, &mut NoExtension, line)
}

pub fn handle_line_with(core: &mut Core, extension: &mut dyn Extension, line: &str) -> Option<String> {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return Some(response(Value::Null, Err(RpcError::new(PARSE_ERROR, "parse error")))),
    };
    let Some(object) = value.as_object() else {
        return Some(response(Value::Null, Err(RpcError::new(INVALID_REQUEST, "a request must be an object"))));
    };
    let id = match object.get("id") {
        None => None,
        Some(id) if id.is_null() || id.is_number() || id.is_string() => Some(id.clone()),
        Some(_) => return Some(response(Value::Null, Err(RpcError::new(INVALID_REQUEST, "id must be a string, number or null")))),
    };
    let reply_id = id.clone().unwrap_or(Value::Null);
    let result = (|| {
        if object.get("jsonrpc") != Some(&json!("2.0")) {
            return Err(RpcError::new(INVALID_REQUEST, "jsonrpc must be \"2.0\""));
        }
        let Some(method) = object.get("method").and_then(Value::as_str) else {
            return Err(RpcError::new(INVALID_REQUEST, "method must be a string"));
        };
        dispatch(core, extension, method, object.get("params"))
    })();
    id.map(|_| response(reply_id, result))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|_| RpcError::new(INTERNAL_ERROR, "internal error"))
}

fn dispatch(core: &mut Core, extension: &mut dyn Extension, method: &str, params: Option<&Value>) -> Result<Value, RpcError> {
    match method {
        "core.ping" => to_value(PingResult { protocol: PROTOCOL_VERSION, version: env!("CARGO_PKG_VERSION").to_owned() }),
        "tools.list" => to_value(core.tools()),
        "tools.invoke" => {
            let params: InvokeParams = parse_params(params)?;
            params.principal.validate().map_err(|e| RpcError::invalid_params(e.to_string()))?;
            if serde_json::to_vec(&params.args).map_or(true, |bytes| bytes.len() > MAX_ARGS_BYTES) {
                return Err(RpcError::invalid_params("arguments are too large"));
            }
            to_value(core.invoke(&params.principal, &params.tool, &params.args)?)
        }
        "tools.register_external" => {
            let params: RegisterExternalParams = parse_params(params)?;
            if params.description.chars().count() > MAX_DESCRIPTION_CHARS {
                return Err(RpcError::invalid_params("the description is too long"));
            }
            if params.resource_origin && params.resource_arg.is_none() {
                return Err(RpcError::invalid_params("an origin-scoped tool needs resource_arg"));
            }
            let mut spec = ToolSpec::new(&params.name, &params.description, &params.capability).map_err(|e| RpcError::invalid_params(e.to_string()))?;
            if let Some(key) = &params.resource_arg {
                spec = spec.with_resource_arg(key);
            }
            if params.resource_origin {
                spec = spec.with_origin_resource();
            }
            if let Some(schema) = params.input_schema {
                if serde_json::to_vec(&schema).map_or(true, |bytes| bytes.len() > MAX_SCHEMA_BYTES) || !schema.is_object() {
                    return Err(RpcError::invalid_params("the input schema must be an object under 16 KB"));
                }
                spec = spec.with_input_schema(schema);
            }
            core.register_external_tool(spec)?;
            Ok(json!({}))
        }
        "permissions.check" => {
            let params: CheckParams = parse_params(params)?;
            params.principal.validate().map_err(|e| RpcError::invalid_params(e.to_string()))?;
            if let Some(resource) = &params.resource {
                validate_resource(resource).map_err(|e| RpcError::invalid_params(e.to_string()))?;
            }
            to_value(core.check(&params.principal, &params.capability, params.resource.as_deref())?)
        }
        "permissions.pending" => to_value(core.pending()),
        "permissions.resolve" => {
            let params: ResolveParams = parse_params(params)?;
            core.resolve(params.request_id, params.approve, params.duration)?;
            Ok(json!({}))
        }
        "permissions.mode" => Ok(json!({ "mode": core.approval_mode().as_str() })),
        "permissions.set_mode" => {
            let params: SetModeParams = parse_params(params)?;
            let mode = ApprovalMode::parse(&params.mode).ok_or_else(|| RpcError::invalid_params("mode must be manual, propose, smart or off"))?;
            core.set_approval_mode(mode)?;
            Ok(json!({ "mode": mode.as_str() }))
        }
        "permissions.set_rules" => {
            let params: SetRulesParams = parse_params(params)?;
            if params.rules.len() > 200 {
                return Err(RpcError::invalid_params("at most 200 rules"));
            }
            core.set_rules(params.rules)?;
            Ok(json!({}))
        }
        "permissions.grants" => to_value(core.grants()),
        "permissions.revoke" => {
            let params: RevokeParams = parse_params(params)?;
            core.revoke(params.grant_id)?;
            Ok(json!({}))
        }
        "events.list" => {
            let params: EventsParams = parse_params(params)?;
            if params.newest {
                if params.after_seq.is_some() {
                    return Err(RpcError::invalid_params("newest cannot be combined with after_seq"));
                }
                return to_value(core.events_newest(params.limit.unwrap_or(DEFAULT_EVENT_LIMIT))?);
            }
            to_value(core.events(params.after_seq.unwrap_or(0), params.limit.unwrap_or(DEFAULT_EVENT_LIMIT))?)
        }
        _ => match extension.call(core, method, params) {
            Some(result) => result.map_err(|e| e.0),
            None => Err(RpcError::new(METHOD_NOT_FOUND, "method not found")),
        },
    }
}

/// Tool descriptors are part of the protocol surface.
pub type ToolList = Vec<ToolSpec>;
