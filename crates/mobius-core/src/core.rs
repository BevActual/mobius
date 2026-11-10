//! The core: permissions, tools and the event log, tied together.
use std::collections::{HashMap, HashSet, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;

use crate::model::{
    Capability, Decision, Duration, Effect, Event, Grant, ModelError, PendingRequest, Principal, origin_of, validate_resource,
};
use crate::permissions::{ApprovalMode, Policy, Verdict};
use crate::store::{NewEvent, Store, StoreError};

pub type Clock = Box<dyn Fn() -> u64 + Send>;
pub type ToolHandler = Box<dyn Fn(&Value) -> Result<Value, String> + Send>;

pub fn system_clock() -> Clock {
    Box::new(|| SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

/// A one-time approval is valid for this long.
pub const ONCE_TTL_MS: u64 = 5 * 60 * 1000;
/// Unanswered questions are capped so a misbehaving agent cannot bury the user in prompts.
pub const MAX_PENDING: usize = 100;
pub const MAX_EVENTS_PER_PAGE: u32 = 500;
/// How many answered questions are remembered for their askers to collect.
const MAX_REMEMBERED_ANSWERS: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Model(#[from] ModelError),
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("tool already registered: {0}")]
    DuplicateTool(String),
    #[error("unknown or already resolved request: {0}")]
    UnknownRequest(u64),
    #[error("unknown grant: {0}")]
    UnknownGrant(u64),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("{0} needs approval for each use; it cannot be allowed for the session or always")]
    StandingNotAllowed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub capability: Capability,
    /// Name of the top-level argument that identifies what the tool acts on (a URL, an artifact id).
    /// The core reads the resource from the arguments itself so a caller cannot misdeclare it.
    pub resource_arg: Option<String>,
    /// JSON Schema for the arguments, shown to the model so it can call the tool correctly.
    #[serde(default = "default_input_schema")]
    #[ts(type = "unknown")]
    pub input_schema: Value,
    /// Run by the application around the core (the browser, for one), not by the core itself. The core still decides
    /// whether a call may happen; the caller is then told to run it.
    #[serde(default)]
    pub external: bool,
    /// The resource is the origin (scheme, host and port) of the address in `resource_arg`, so a person approves a
    /// site rather than one page of it.
    #[serde(default)]
    pub resource_origin: bool,
}

fn default_input_schema() -> Value {
    json!({ "type": "object" })
}

impl ToolSpec {
    pub fn new(name: &str, description: &str, capability: &str) -> Result<Self, ModelError> {
        Ok(ToolSpec {
            name: name.to_owned(),
            description: description.to_owned(),
            capability: Capability::new(capability)?,
            resource_arg: None,
            input_schema: default_input_schema(),
            external: false,
            resource_origin: false,
        })
    }

    pub fn with_resource_arg(mut self, key: &str) -> Self {
        self.resource_arg = Some(key.to_owned());
        self
    }

    pub fn with_origin_resource(mut self) -> Self {
        self.resource_origin = true;
        self
    }

    pub fn with_input_schema(mut self, schema: Value) -> Self {
        self.input_schema = schema;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
#[ts(export)]
pub enum InvokeOutcome {
    Completed {
        #[ts(type = "unknown")]
        result: Value,
    },
    NeedsApproval {
        #[ts(type = "number")]
        request_id: u64,
    },
    Denied {
        reason: String,
    },
    Failed {
        error: String,
    },
    /// Allowed, and it is the caller's job to run it (an application tool). Report how it went with
    /// `Core::record_external_result`.
    Dispatch,
}

struct Tool {
    spec: ToolSpec,
    handler: ToolHandler,
}

pub struct Core {
    store: Store,
    clock: Clock,
    policy: Policy,
    tools: HashMap<String, Tool>,
    /// Every live grant. Always grants are mirrored in the store; session and one-time grants live only here.
    grants: Vec<Grant>,
    pending: Vec<PendingRequest>,
    /// Questions that may only be answered "allow once", whatever the policy says.
    once_only: HashSet<u64>,
    /// Questions only the person may answer: the app is set to always ask, so no reviewer answers them.
    person_only: HashSet<u64>,
    /// Answers to questions, held until the asker collects them (oldest dropped first).
    answered: VecDeque<(u64, bool)>,
    next_grant_id: u64,
    next_request_id: u64,
}

impl Core {
    pub fn open(path: &Path, clock: Clock) -> Result<Self, CoreError> {
        Self::with_store(Store::open(path)?, clock)
    }

    pub fn open_in_memory(clock: Clock) -> Result<Self, CoreError> {
        Self::with_store(Store::open_in_memory()?, clock)
    }

    fn with_store(store: Store, clock: Clock) -> Result<Self, CoreError> {
        let grants = store.load_grants()?;
        let next_grant_id = store.max_grant_id()? + 1;
        Ok(Core { store, clock, policy: Policy::default_floors(), tools: HashMap::new(), grants, pending: Vec::new(), once_only: HashSet::new(), person_only: HashSet::new(), answered: VecDeque::new(), next_grant_id, next_request_id: 1 })
    }

    pub fn register_tool(&mut self, spec: ToolSpec, handler: ToolHandler) -> Result<(), CoreError> {
        Capability::new(&spec.name)?;
        if self.tools.contains_key(&spec.name) {
            return Err(CoreError::DuplicateTool(spec.name));
        }
        self.tools.insert(spec.name.clone(), Tool { spec, handler });
        Ok(())
    }

    /// Register a tool that the application runs. The core only decides whether a call may happen.
    pub fn register_external_tool(&mut self, mut spec: ToolSpec) -> Result<(), CoreError> {
        if spec.resource_origin && spec.resource_arg.is_none() {
            return Err(CoreError::InvalidArgs("an origin-scoped tool needs `resource_arg`".to_owned()));
        }
        spec.external = true;
        self.register_tool(spec, Box::new(|_| Err("this tool is run by the application".to_owned())))
    }

    /// Note how an application tool went, for the event log. Arguments and results are never recorded.
    pub fn record_external_result(&mut self, principal: &Principal, tool: &str, succeeded: bool) -> Result<(), CoreError> {
        principal.validate()?;
        let capability = match self.tools.get(tool) {
            Some(entry) if entry.spec.external => entry.spec.capability.clone(),
            _ => return Err(CoreError::UnknownTool(tool.to_owned())),
        };
        let kind = if succeeded { "tool.completed" } else { "tool.failed" };
        self.log(kind, Some(principal), Some(capability.as_str()), None, json!({ "tool": tool }))
    }

    pub fn tools(&self) -> Vec<ToolSpec> {
        let mut specs: Vec<ToolSpec> = self.tools.values().map(|tool| tool.spec.clone()).collect();
        specs.sort_by(|a, b| a.name.cmp(&b.name));
        specs
    }

    pub fn pending(&self) -> Vec<PendingRequest> {
        self.pending.clone()
    }

    /// Whether this question can only be answered "allow once": its capability is a floor.
    pub fn is_once_only(&self, request_id: u64) -> bool {
        self.pending.iter().find(|r| r.id == request_id).is_some_and(|r| self.once_only.contains(&r.id) || self.policy.is_floor(&r.capability))
    }

    /// Whether only the person may answer this question: its app is set to always ask, so no reviewer model does.
    pub fn is_person_only(&self, request_id: u64) -> bool {
        self.person_only.contains(&request_id)
    }

    /// From now on this question can only be answered "allow once". Nothing happens for an unknown question.
    pub fn require_once(&mut self, request_id: u64) {
        if self.pending.iter().any(|r| r.id == request_id) {
            self.once_only.insert(request_id);
        }
    }

    #[must_use]
    pub fn approval_mode(&self) -> ApprovalMode {
        self.policy.mode()
    }

    /// Replace the standing rules from Settings (how much the agent may do in each app). Kept only in memory: the
    /// host sends them again whenever the core starts.
    pub fn set_rules(&mut self, rules: Vec<crate::permissions::Rule>) -> Result<(), CoreError> {
        for rule in &rules {
            if let Some(resource) = &rule.resource {
                validate_resource(resource)?;
            }
        }
        let count = rules.len();
        self.policy.set_rules(rules);
        self.log("permission.rules", None, None, None, json!({ "rules": count }))
    }

    #[must_use]
    pub fn rules(&self) -> Vec<crate::permissions::Rule> {
        self.policy.rules().to_vec()
    }

    /// Change how often the assistant has to ask. Standing approvals are kept, only not used in the careful mode.
    pub fn set_approval_mode(&mut self, mode: ApprovalMode) -> Result<(), CoreError> {
        self.policy.set_mode(mode);
        self.log("permission.mode", None, None, None, json!({ "mode": mode.as_str() }))
    }

    pub fn grants(&self) -> Vec<Grant> {
        let now = (self.clock)();
        self.grants.iter().filter(|g| g.expires_ms.is_none_or(|expires| now < expires)).cloned().collect()
    }

    pub fn events(&self, after_seq: u64, limit: u32) -> Result<Vec<Event>, CoreError> {
        Ok(self.store.events(after_seq, limit.clamp(1, MAX_EVENTS_PER_PAGE))?)
    }

    /// The most recent events, newest first. At least one and at most one page are returned.
    pub fn events_newest(&self, limit: u32) -> Result<Vec<Event>, CoreError> {
        Ok(self.store.events_newest(limit.clamp(1, MAX_EVENTS_PER_PAGE))?)
    }

    /// Ask what would happen. Never consumes a one-time approval.
    pub fn check(&mut self, principal: &Principal, capability: &Capability, resource: Option<&str>) -> Result<Decision, CoreError> {
        principal.validate()?;
        if let Some(resource) = resource {
            validate_resource(resource)?;
        }
        self.decide(principal, capability, resource, false)
    }

    pub fn invoke(&mut self, principal: &Principal, tool: &str, args: &Value) -> Result<InvokeOutcome, CoreError> {
        principal.validate()?;
        let (capability, resource_arg, by_origin, external) = {
            let tool = self.tools.get(tool).ok_or_else(|| CoreError::UnknownTool(tool.to_owned()))?;
            (tool.spec.capability.clone(), tool.spec.resource_arg.clone(), tool.spec.resource_origin, tool.spec.external)
        };
        let resource = match resource_arg {
            None => None,
            Some(key) => match args.get(&key) {
                Some(Value::String(value)) if by_origin => {
                    Some(origin_of(value).map_err(|_| CoreError::InvalidArgs(format!("`{key}` must be a plain http or https address")))?)
                }
                Some(Value::String(value)) => {
                    validate_resource(value).map_err(|_| CoreError::InvalidArgs(format!("`{key}` is not a valid resource")))?;
                    Some(value.clone())
                }
                _ => return Err(CoreError::InvalidArgs(format!("`{key}` is required and must be a string"))),
            },
        };
        match self.decide(principal, &capability, resource.as_deref(), true)? {
            Decision::Allow => {
                self.log("tool.started", Some(principal), Some(capability.as_str()), resource.as_deref(), json!({ "tool": tool }))?;
                if external {
                    return Ok(InvokeOutcome::Dispatch);
                }
                let outcome = match self.tools.get(tool) {
                    Some(entry) => catch_unwind(AssertUnwindSafe(|| (entry.handler)(args))),
                    None => return Err(CoreError::UnknownTool(tool.to_owned())),
                };
                match outcome {
                    Ok(Ok(result)) => {
                        self.log("tool.completed", Some(principal), Some(capability.as_str()), resource.as_deref(), json!({ "tool": tool }))?;
                        Ok(InvokeOutcome::Completed { result })
                    }
                    Ok(Err(error)) => {
                        self.log("tool.failed", Some(principal), Some(capability.as_str()), resource.as_deref(), json!({ "tool": tool }))?;
                        Ok(InvokeOutcome::Failed { error })
                    }
                    Err(_) => {
                        self.log("tool.failed", Some(principal), Some(capability.as_str()), resource.as_deref(), json!({ "tool": tool, "panicked": true }))?;
                        Ok(InvokeOutcome::Failed { error: "the tool crashed".to_owned() })
                    }
                }
            }
            Decision::Ask { request_id } => Ok(InvokeOutcome::NeedsApproval { request_id }),
            Decision::Deny { reason } => Ok(InvokeOutcome::Denied { reason }),
        }
    }

    /// Answer a pending question. Approving or rejecting for `Session` or `Always` creates a standing grant.
    pub fn resolve(&mut self, request_id: u64, approve: bool, duration: Duration) -> Result<(), CoreError> {
        let index = self.pending.iter().position(|r| r.id == request_id).ok_or(CoreError::UnknownRequest(request_id))?;
        let floor = self.is_once_only(request_id);
        if approve && floor && duration != Duration::Once {
            return Err(CoreError::StandingNotAllowed(self.pending[index].capability.as_str().to_owned()));
        }
        let request = self.pending.remove(index);
        self.once_only.remove(&request.id);
        self.person_only.remove(&request.id);
        let now = (self.clock)();
        let effect = if approve { Effect::Allow } else { Effect::Deny };
        // Rejecting once is just "no, not now": it leaves nothing behind, so the next attempt asks again.
        if approve || duration != Duration::Once {
            let grant = Grant {
                id: self.next_grant_id,
                principal: request.principal.clone(),
                capability: request.capability.clone(),
                resource: request.resource.clone(),
                effect,
                duration,
                created_ms: now,
                expires_ms: (duration == Duration::Once).then_some(now + ONCE_TTL_MS),
            };
            if duration == Duration::Always {
                self.store.insert_grant(&grant)?;
            }
            self.next_grant_id += 1;
            self.grants.push(grant);
        }
        self.answered.push_back((request_id, approve));
        if self.answered.len() > MAX_REMEMBERED_ANSWERS {
            self.answered.pop_front();
        }
        let kind = if approve { "permission.approved" } else { "permission.rejected" };
        self.log(kind, Some(&request.principal), Some(request.capability.as_str()), request.resource.as_deref(), json!({ "request_id": request_id, "duration": duration }))?;
        Ok(())
    }

    /// How a question was answered (`true` = approved), if it has been. Returned once, to whoever is waiting on it.
    pub fn take_resolution(&mut self, request_id: u64) -> Option<bool> {
        let index = self.answered.iter().position(|(id, _)| *id == request_id)?;
        self.answered.remove(index).map(|(_, approved)| approved)
    }

    /// Drop an unanswered question because whoever asked has given up on it.
    pub fn withdraw(&mut self, request_id: u64) -> Result<(), CoreError> {
        let index = self.pending.iter().position(|r| r.id == request_id).ok_or(CoreError::UnknownRequest(request_id))?;
        let request = self.pending.remove(index);
        self.once_only.remove(&request.id);
        self.person_only.remove(&request.id);
        self.log("permission.withdrawn", Some(&request.principal), Some(request.capability.as_str()), request.resource.as_deref(), json!({ "request_id": request_id }))?;
        Ok(())
    }

    pub fn revoke(&mut self, grant_id: u64) -> Result<(), CoreError> {
        let index = self.grants.iter().position(|g| g.id == grant_id).ok_or(CoreError::UnknownGrant(grant_id))?;
        let grant = self.grants.remove(index);
        if grant.duration == Duration::Always {
            self.store.delete_grant(grant_id)?;
        }
        self.log("permission.revoked", Some(&grant.principal), Some(grant.capability.as_str()), grant.resource.as_deref(), json!({ "grant_id": grant_id }))?;
        Ok(())
    }

    fn decide(&mut self, principal: &Principal, capability: &Capability, resource: Option<&str>, consume: bool) -> Result<Decision, CoreError> {
        let now = (self.clock)();
        self.grants.retain(|g| g.expires_ms.is_none_or(|expires| now < expires));
        let verdict = self.policy.evaluate(&self.grants, now, principal, capability, resource);
        match verdict {
            Verdict::Allow { consume: used } => {
                if consume && let Some(id) = used {
                    self.grants.retain(|g| g.id != id);
                }
                self.log("permission.allowed", Some(principal), Some(capability.as_str()), resource, json!({}))?;
                Ok(Decision::Allow)
            }
            Verdict::Deny => {
                self.log("permission.denied", Some(principal), Some(capability.as_str()), resource, json!({ "reason": "denied by a standing rule" }))?;
                Ok(Decision::Deny { reason: "blocked by a standing rule".to_owned() })
            }
            Verdict::Ask | Verdict::AskPerson => {
                let person = matches!(verdict, Verdict::AskPerson);
                let existing = self.pending.iter().find(|r| r.principal == *principal && r.capability == *capability && r.resource.as_deref() == resource).map(|r| r.id);
                if let Some(request_id) = existing {
                    if person {
                        self.once_only.insert(request_id);
                        self.person_only.insert(request_id);
                    }
                    return Ok(Decision::Ask { request_id });
                }
                if self.pending.len() >= MAX_PENDING {
                    self.log("permission.denied", Some(principal), Some(capability.as_str()), resource, json!({ "reason": "too many unanswered requests" }))?;
                    return Ok(Decision::Deny { reason: "too many unanswered requests".to_owned() });
                }
                let request_id = self.next_request_id;
                self.next_request_id += 1;
                self.pending.push(PendingRequest { id: request_id, principal: principal.clone(), capability: capability.clone(), resource: resource.map(str::to_owned), created_ms: now });
                if person {
                    // The app is set to always ask: allow once is the only yes, and no reviewer answers for the person.
                    self.once_only.insert(request_id);
                    self.person_only.insert(request_id);
                }
                self.log("permission.asked", Some(principal), Some(capability.as_str()), resource, json!({ "request_id": request_id }))?;
                Ok(Decision::Ask { request_id })
            }
        }
    }

    fn log(&self, kind: &str, principal: Option<&Principal>, capability: Option<&str>, resource: Option<&str>, detail: Value) -> Result<(), CoreError> {
        self.store.append_event(&NewEvent { ts_ms: (self.clock)(), kind, principal, capability, resource, detail: &detail })?;
        Ok(())
    }
}
