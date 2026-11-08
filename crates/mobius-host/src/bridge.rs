//! What the interface may ask of the Rust side. The window sends `(namespace, method, arguments)`; this decides
//! whether that is something Rust provides, validates it, and answers. Anything not listed is refused with a plain
//! reason, so an interface call can never reach the core or the machine by being unlisted.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mobius_browser::deps::BrowserTools;
use crate::awake::{Blocker, KeepAwake};
use crate::notify::{self, Notice};
use crate::quick_entry::{QuickEntry, Registrar};
use mobius_browser::downloads::Downloads;
use mobius_browser::engine::Bounds;
use mobius_browser::tabs::Browser;
use mobius_browser::tools::{run_browser_tool, tool_descriptions};
use mobius_store::bookmarks::Bookmarks;
use mobius_store::bots::{self, Bots, MAIN_ID};
use mobius_store::history::History;
use mobius_store::settings::Settings;
use mobius_store::{appearance, preferences};
use serde_json::{Value, json};

use crate::agent::{self, AgentService, is_conversation_id, is_model_name};
use crate::process::{CoreProcess, Status};
use crate::secrets::Secrets;

#[derive(Debug, PartialEq)]
pub enum BridgeError {
    /// Rust does not provide this yet.
    NotAvailable(String),
    /// The arguments were not acceptable.
    Invalid(String),
}

impl BridgeError {
    pub fn message(&self) -> &str {
        match self {
            BridgeError::NotAvailable(m) | BridgeError::Invalid(m) => m,
        }
    }
    /// A short tag the interface can branch on.
    pub fn kind(&self) -> &'static str {
        match self {
            BridgeError::NotAvailable(_) => "not_available",
            BridgeError::Invalid(_) => "invalid",
        }
    }
}

/// Tells the interface something changed: `(event name, payload)`.
/// How a test asks the window system about itself: `(question, argument)` gives the answer.
pub type ProbeFn = Arc<dyn Fn(&str, &Value) -> Value + Send + Sync>;

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

type Out = Result<Value, BridgeError>;

fn is_download_id(t: &str) -> bool {
    t.strip_prefix("dl-").is_some_and(|r| !r.is_empty() && r.len() <= 12 && r.bytes().all(|b| b.is_ascii_digit()))
}

fn is_tab_id(t: &str) -> bool {
    t.strip_prefix("tab-").is_some_and(|r| !r.is_empty() && r.len() <= 32 && r.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// A page area from the window: finite, not negative, and not absurdly large. Nothing means the page is hidden.
pub fn parse_bounds(v: &Value) -> Option<Bounds> {
    let n = |k: &str| v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite());
    let (x, y, w, h) = (n("x")?, n("y")?, n("width")?, n("height")?);
    const MAX: f64 = 20_000.0;
    if w < 0.0 || h < 0.0 || w > MAX || h > MAX || x.abs() > MAX || y.abs() > MAX {
        return None;
    }
    Some(Bounds { x: x.round() as i32, y: y.round() as i32, width: w.round() as i32, height: h.round() as i32 })
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// A folder is only emptied when it sits well below the top of a drive or the home folder: a mistaken setting must never
/// turn "remove my data" into "remove my documents".
pub fn is_safe_to_empty(dir: &std::path::Path) -> bool {
    // At least three folders below the top (C:/Users/me/x, /home/me/x): a drive letter and the root do not count,
    // so the rule is the same on Windows and elsewhere.
    let named = dir.components().filter(|c| matches!(c, std::path::Component::Normal(_))).count();
    dir.is_absolute() && named >= 3 && !dir.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

fn ok(extra: Value) -> Value {
    let mut v = json!({ "ok": true });
    if let (Some(a), Some(b)) = (v.as_object_mut(), extra.as_object()) {
        a.extend(b.clone());
    }
    v
}

fn failed(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

/// Things only the window system can do.
pub trait Dialogs: Send + Sync {
    /// Ask the person to choose a text file. `None` when they cancel.
    fn pick_text_file(&self) -> Option<PathBuf>;
    fn open_path(&self, path: &Path);
    fn show_path(&self, path: &Path);
    /// Stop a download that is being saved at `path`.
    fn cancel_download(&self, path: &Path);
    /// Whether a Mobius window has the focus; notices are for when it does not.
    fn window_focused(&self) -> bool;
    /// Tell the person something, outside the window.
    fn show_notice(&self, notice: &Notice);
    /// The system's way of stopping the computer sleeping.
    fn awake_blocker(&self) -> Box<dyn Blocker>;
    /// The system's global shortcut registration.
    fn shortcut_registrar(&self) -> Box<dyn Registrar>;
    /// Show the window and give it the keyboard (unless a test has asked for it to stay hidden).
    fn bring_forward(&self);
}

pub struct Bridge {
    engine: std::sync::OnceLock<String>,
    endpoints: Mutex<crate::endpoints::Endpoints>,
    archive: Mutex<mobius_store::archive::Archive>,
    last_notice: Mutex<Option<(String, std::time::Instant)>>,
    models: OnceLock<Arc<crate::models::Models>>,
    quick: Mutex<Option<QuickEntry>>,
    probe: OnceLock<ProbeFn>,
    keep_awake: Mutex<Option<KeepAwake>>,
    notices: Mutex<Vec<Value>>,
    last_downloads: Mutex<Value>,
    quit: OnceLock<Arc<dyn Fn() + Send + Sync>>,
    /// Set only for tests: the hooks that let a test talk to the core directly.
    test_hooks: std::sync::atomic::AtomicBool,
    status_history: Mutex<Vec<String>>,
    downloads: Mutex<Downloads>,
    browser: OnceLock<Arc<Browser>>,
    dialogs: OnceLock<Arc<dyn Dialogs>>,
    core: Arc<CoreProcess>,
    agent: AgentService,
    data_dir: PathBuf,
    /// The folder of real files the assistant's file tools work in.
    workspace: mobius_workspace::files::Workspace,
    /// For each conversation, the checkpoint taken when its last turn began: what that turn changed, and the way back.
    turn_marks: Mutex<std::collections::HashMap<String, String>>,
    /// Tools from other programs the person set up (MCP servers).
    mcp: Arc<crate::mcp::McpState>,
    notes: mobius_workspace::notes::Notes,
    docs: mobius_workspace::notes::Notes,
    sheets: mobius_workspace::sheets::Sheets,
    tasks: mobius_workspace::tasks::Tasks,
    calendar: mobius_workspace::calendar::Calendar,
    calendar_accounts: Arc<crate::calendar_accounts::Accounts>,
    mail: Arc<crate::mail::store::Mail>,
    /// What Mobius remembers about the person between conversations.
    memory: crate::memory::Memory,
    /// Requests to make at times of day.
    schedules: crate::schedules::Schedules,
    providers: crate::providers::Providers,
    /// The Claude Code CLI to use; tests set a fake one.
    claude_command: Mutex<Option<PathBuf>>,
    /// Other apps using Mobius's tools over MCP.
    mcp_server: crate::mcp_server::McpServer,
    /// The ChatGPT sign-in; tests point it at a pretend OpenAI.
    chatgpt: Arc<Mutex<Arc<crate::chatgpt::ChatGpt>>>,
    secrets: Arc<dyn Secrets>,
    /// For tests: what a sign-in would have opened, instead of opening a window.
    signed_in_with: Mutex<Vec<String>>,
    emit: Emit,
    appearance: Mutex<Settings>,
    preferences: Mutex<Settings>,
    bots: Mutex<Bots>,
    history: Mutex<History>,
    bookmarks: Mutex<Bookmarks>,
}

impl Bridge {
    pub fn new(core: Arc<CoreProcess>, data_dir: PathBuf, emit: Emit, secrets: Arc<dyn Secrets>) -> Bridge {
        let chatgpt = Arc::new(Mutex::new(Arc::new(crate::chatgpt::ChatGpt::new(crate::chatgpt::ISSUER, secrets.clone()))));
        let calendar_accounts = Arc::new(crate::calendar_accounts::Accounts::new(&data_dir, secrets.clone()));
        let agent = AgentService::new(core.clone(), data_dir.join("agent-settings.json"), secrets.clone());
        let source = chatgpt.clone();
        agent.add_token_source(crate::providers::CHATGPT_ADDRESS, Arc::new(move || lock(&source).clone().access_token()));
        let notes_emit = emit.clone();
        let mcp_server = crate::mcp_server::McpServer::open(
            data_dir.join("mcp-server.json"),
            data_dir.join("workspace"),
            data_dir.join("checkpoints"),
            secrets.clone(),
            Arc::new(move |path: &str| {
                if let Some(page) = path.replace('\\', "/").strip_prefix("notes/") {
                    notes_emit("mobius:notes-changed", json!({ "path": page, "by": "another app" }));
                }
                if let Some(doc) = path.replace('\\', "/").strip_prefix("docs/") {
                    notes_emit("mobius:docs-changed", json!({ "path": doc, "by": "another app" }));
                }
                if let Some(book) = path.replace('\\', "/").strip_prefix("sheets/") {
                    notes_emit("mobius:sheets-changed", json!({ "workbook": book.split('/').next(), "by": "another app" }));
                }
                if let Some(list) = path.replace('\\', "/").strip_prefix("tasks/").and_then(|f| f.strip_suffix(".md")) {
                    notes_emit("mobius:tasks-changed", json!({ "list": list, "by": "another app" }));
                }
                if let Some(name) = path.replace('\\', "/").strip_prefix("calendar/").and_then(|f| f.strip_suffix(".ics")) {
                    notes_emit("mobius:calendar-changed", json!({ "calendar": name, "by": "another app" }));
                }
            }),
        );
        Bridge {
            mcp_server,
            chatgpt,
            secrets: secrets.clone(),
            endpoints: Mutex::new(crate::endpoints::Endpoints::open(data_dir.join("endpoints.json"), secrets.clone())),
            engine: std::sync::OnceLock::new(),
            archive: Mutex::new(mobius_store::archive::Archive::open(data_dir.join("archive.json"))),
            last_notice: Mutex::new(None),
            models: OnceLock::new(),
            quick: Mutex::new(None),
            probe: OnceLock::new(),
            keep_awake: Mutex::new(None),
            notices: Mutex::new(Vec::new()),
            last_downloads: Mutex::new(json!([])),
            quit: OnceLock::new(),
            test_hooks: std::sync::atomic::AtomicBool::new(false),
            status_history: Mutex::new(Vec::new()),
            downloads: Mutex::new(Downloads::new(data_dir.join("downloads"))),
            browser: OnceLock::new(),
            dialogs: OnceLock::new(),
            agent,
            appearance: Mutex::new(appearance::open(data_dir.join("appearance.json"))),
            preferences: Mutex::new(preferences::open(data_dir.join("preferences.json"))),
            bots: Mutex::new(Bots::open(data_dir.join("bots.json"), Box::new(now_ms))),
            history: Mutex::new(History::open(data_dir.join("history.json"), Box::new(now_ms))),
            bookmarks: Mutex::new(Bookmarks::open(data_dir.join("bookmarks.json"), Box::new(now_ms))),
            core,
            workspace: mobius_workspace::files::Workspace::new(data_dir.join("workspace"), data_dir.join("checkpoints")),
            // Kept on disk, so a turn's changes can still be reviewed, kept or put back after a restart.
            turn_marks: Mutex::new(mobius_store::file::read_json(&data_dir.join("turn-marks.json")).and_then(|v: Value| serde_json::from_value(v).ok()).unwrap_or_default()),
            mcp: Arc::default(),
            providers: crate::providers::Providers::new(secrets.clone()),
            claude_command: Mutex::new(None),
            signed_in_with: Mutex::new(Vec::new()),
            notes: mobius_workspace::notes::Notes::new(data_dir.join("workspace"), data_dir.join("checkpoints")),
            docs: mobius_workspace::notes::Notes::in_folder(data_dir.join("workspace"), data_dir.join("checkpoints"), "docs"),
            sheets: mobius_workspace::sheets::Sheets::new(data_dir.join("workspace"), data_dir.join("checkpoints")),
            tasks: mobius_workspace::tasks::Tasks::new(data_dir.join("workspace"), data_dir.join("checkpoints")),
            calendar: {
                let calendar = mobius_workspace::calendar::Calendar::new(data_dir.join("workspace"), data_dir.join("checkpoints"));
                calendar.set_remote(calendar_accounts.clone());
                calendar.set_mirrors(calendar_accounts.mirrors(&calendar.local_calendars()));
                calendar
            },
            calendar_accounts,
            mail: Arc::new(crate::mail::store::Mail::new(&data_dir, secrets.clone())),
            memory: crate::memory::Memory::new(data_dir.join("memory.md")),
            schedules: crate::schedules::Schedules::open(data_dir.join("schedules.json")),
            data_dir,
            emit,
        }
    }

    pub fn call(&self, namespace: &str, method: &str, args: &[Value]) -> Out {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        match (namespace, method) {
            ("core", "getStatus") => Ok(json!(self.core.status().word())),
            ("window", "quickEntryActive") => Ok(json!(lock(&self.quick).as_ref().is_some_and(QuickEntry::active))),
            ("app", "about") => Ok(self.about()),
            ("app", "openDataFolder") => {
                if let Some(d) = self.dialogs.get() {
                    d.open_path(&self.data_dir);
                }
                Ok(Value::Null)
            }
            ("app", "removeData") => Ok(self.remove_data()),
            ("window", _) => Ok(Value::Null),

            ("appearance", "get") => Ok(lock(&self.appearance).get()),
            ("appearance", "set") => Ok(self.change(&self.appearance, "appearance", arg(0))),
            ("schedules", "list") => Ok(json!(self.schedules.list())),
            ("schedules", "add") => Ok(match self.schedules.add(arg(0)) {
                Ok(s) => {
                    (self.emit)("mobius:schedules-changed", Value::Null);
                    json!({ "ok": true, "schedule": s })
                }
                Err(e) => failed(e),
            }),
            ("schedules", "update") => Ok(match arg(0).as_str().map(|id| self.schedules.update(id, arg(1))) {
                Some(Ok(s)) => {
                    (self.emit)("mobius:schedules-changed", Value::Null);
                    json!({ "ok": true, "schedule": s })
                }
                Some(Err(e)) => failed(e),
                None => failed("That schedule is gone."),
            }),
            ("schedules", "remove") => {
                if arg(0).as_str().is_some_and(|id| self.schedules.remove(id)) {
                    (self.emit)("mobius:schedules-changed", Value::Null);
                }
                Ok(Value::Null)
            }
            ("schedules", "runNow") => Ok(match arg(0).as_str().and_then(|id| self.schedules.get_for_run(id)) {
                Some(schedule) => {
                    (self.emit)("mobius:schedules-changed", Value::Null);
                    self.run_schedule(&schedule)
                }
                None => failed("That schedule is gone."),
            }),
            ("memory", "list") => Ok(json!(self.memory.list())),
            ("memory", "forget") => Ok(match arg(0).as_str().map(|t| self.memory.forget(t)) {
                Some(Ok(_)) => {
                    (self.emit)("mobius:memory-changed", Value::Null);
                    json!({ "ok": true })
                }
                Some(Err(e)) => failed(e),
                None => failed("That is not something Mobius remembers."),
            }),
            ("preferences", "get") => Ok(lock(&self.preferences).get()),
            ("preferences", "set") => Ok(self.change(&self.preferences, "preferences", arg(0))),

            ("history", "get") => {
                let query: String = arg(0).as_str().unwrap_or("").chars().take(200).collect();
                let h = lock(&self.history);
                let rows = if query.trim().is_empty() { h.list(200) } else { h.search(&query, 200) };
                Ok(json!({ "enabled": h.enabled(), "entries": rows.iter().map(|e| e.to_json()).collect::<Vec<_>>() }))
            }
            ("history", "remove") => Ok(self.with_url(arg(0), |url| lock(&self.history).remove(url), "history-changed")),
            ("history", "clear") => {
                lock(&self.history).clear();
                (self.emit)("mobius:history-changed", Value::Null);
                Ok(Value::Null)
            }
            ("history", "setEnabled") => {
                if let Some(on) = arg(0).as_bool() {
                    lock(&self.history).set_enabled(on);
                    (self.emit)("mobius:history-changed", Value::Null);
                }
                Ok(Value::Null)
            }
            ("bookmarks", "get") => {
                let query: String = arg(0).as_str().unwrap_or("").chars().take(200).collect();
                let b = lock(&self.bookmarks);
                let rows = if query.trim().is_empty() { b.list(500) } else { b.search(&query, 500) };
                Ok(Value::Array(rows.iter().map(|e| e.to_json()).collect()))
            }
            ("bookmarks", "remove") => Ok(self.with_url(arg(0), |url| lock(&self.bookmarks).remove(url), "bookmarks-changed")),

            ("notes", _) => Ok(self.notes_call(&self.notes, "mobius:notes-changed", method, args)),
            ("docs", _) => Ok(self.notes_call(&self.docs, "mobius:docs-changed", method, args)),
            ("sheets", _) => Ok(self.sheets_call(method, args)),
            ("mail", _) => Ok(self.mail_call(method, args)),
            ("tasks", _) => Ok(self.tasks_call(method, args)),
            ("calendar", _) => Ok(self.calendar_call(method, args)),
            ("providers", _) => Ok(self.providers_call(method, args)),
            ("share", "status") => Ok(self.mcp_server.status()),
            ("share", "token") => Ok(self.mcp_server.reveal_token().map_or(Value::Null, Value::String)),
            ("share", "renewToken") => Ok(self.mcp_server.renew_token()),
            ("share", "set") => {
                let v = arg(0);
                let flag = |k: &str| v.get(k).and_then(Value::as_bool);
                let port = match v.get("port") {
                    None | Some(Value::Null) => None,
                    Some(p) => match p.as_u64().and_then(|p| u16::try_from(p).ok()) {
                        Some(p) => Some(p),
                        None => return Ok(failed("Use a port from 1024 to 65535.")),
                    },
                };
                Ok(self.mcp_server.set(flag("enabled"), flag("allowChanges"), port))
            }
            ("agent", _) => self.agent_call(method, args),
            ("changes", _) => self.changes_call(method, args),
            ("browser", _) => self.browser_call(method, args),
            ("surface", "setBounds") => {
                if let Some(b) = self.browser.get() {
                    b.set_bounds(parse_bounds(arg(0)));
                }
                Ok(Value::Null)
            }
            ("models", _) => self.models_call(method, args),
            ("test", _) => self.test_call(method, args),
            ("downloads", _) => self.downloads_call(method, arg(0)),
            ("bookmarks", "toggle") => Ok(self.toggle_bookmark()),
            ("context", "page") => Ok(self.context_page()),
            ("context", "file") => Ok(self.context_file()),
            ("context", "selection") => Ok(self.context_selection()),

            ("bots", "get") => Ok(self.bots_state()),
            ("bots", "create") => {
                let result = lock(&self.bots).create(arg(0));
                Ok(self.bot_result(result))
            }
            ("bots", "update") => {
                let id = arg(0).get("id").and_then(Value::as_str).unwrap_or("");
                let draft = arg(0).get("draft").unwrap_or(&Value::Null);
                let result = lock(&self.bots).update(id, draft);
                Ok(self.bot_result(result))
            }
            ("bots", "move") => {
                let id = arg(0).get("id").and_then(Value::as_str).unwrap_or("");
                let direction = arg(0).get("direction").and_then(Value::as_str).unwrap_or("");
                let result = lock(&self.bots).move_bot(id, direction);
                Ok(match result {
                    Ok(()) => {
                        self.announce_bots();
                        ok(json!({}))
                    }
                    Err(e) => failed(e),
                })
            }
            ("bots", "remove") => Ok(self.remove_bot(arg(0).as_str().unwrap_or(""))),

            _ => {
                Err(BridgeError::NotAvailable(format!("{namespace}.{method} is not available in this build yet.")))
            }
        }
    }

    /// Removes everything Mobius keeps on this computer: saved keys, then the data folder's contents. The core is stopped first
    /// (its files are in use), and the application closes afterwards. Only ever touches the data folder.
    fn remove_data(&self) -> Value {
        // A folder this close to the root is not a data folder; refuse rather than empty it.
        if !is_safe_to_empty(&self.data_dir) {
            return failed("Mobius would not empty that folder.");
        }
        self.agent.forget_keys();
        lock(&self.endpoints).forget_keys();
        self.providers.forget_all();
        lock(&self.chatgpt).clone().sign_out();
        self.mcp_server.forget();
        self.core.stop_shared();
        let mut failures = 0;
        let mut removed = 0;
        if let Ok(entries) = std::fs::read_dir(&self.data_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let result = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
                match result {
                    Ok(()) => removed += 1,
                    Err(_) => failures += 1,
                }
            }
        }
        if let Some(quit) = self.quit.get() {
            quit();
        }
        if failures == 0 { ok(json!({ "removed": removed })) } else { failed(format!("{failures} items could not be removed. Close other programs using them and try again.")) }
    }

    /// How the application ends itself cleanly (used by tests to restart it the way a person would).
    pub fn set_quit(&self, quit: Arc<dyn Fn() + Send + Sync>) {
        let _ = self.quit.set(quit);
    }

    /// How a test asks the window system about itself (its size, its theme). Set by the shell.
    pub fn set_probe(&self, probe: ProbeFn) {
        let _ = self.probe.set(probe);
    }

    /// Starts the models service. Needs the bridge to be shared, because pointing the agent at a model it has loaded goes back
    /// through the bridge.
    pub fn start_models(self: &Arc<Self>) {
        let (emit, weak) = (self.emit.clone(), Arc::downgrade(self));
        let events: crate::models::Emit = Arc::new(move |event| emit("mobius:models-event", event));
        let assistant: crate::models::UseForAssistant = Arc::new(move |base_url, model| {
            let bridge = weak.upgrade().ok_or("The agent is not available.")?;
            let current = bridge.agent.settings();
            let request = agent::Configure {
                base_url: base_url.to_owned(),
                model: model.to_owned(),
                system: current.get("system").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned),
                max_steps: current.get("maxSteps").and_then(Value::as_u64),
                ..agent::Configure::default()
            };
            let result = bridge.agent.configure(&request);
            (bridge.emit)("mobius:agent-settings", bridge.agent.settings());
            if result.get("ok") == Some(&Value::Bool(true)) { Ok(()) } else { Err(result.get("error").and_then(Value::as_str).unwrap_or("The agent could not be set up.").to_owned()) }
        });
        let _ = self.models.set(crate::models::Models::new(self.core.clone(), events, assistant));
    }

    /// The local model last run, and whether to run it again when Mobius opens.
    fn local_model(&self) -> Value {
        match mobius_store::file::read_json(&self.data_dir.join("local-model.json")) {
            Some(v @ Value::Object(_)) => v,
            _ => json!({}),
        }
    }

    /// Run the model from last time again, if the person asked for that.
    fn start_local_model_again(&self) {
        let saved = self.local_model();
        if saved.get("startWithMobius") != Some(&Value::Bool(true)) {
            return;
        }
        let (Some(models), Some(id)) = (self.models.get().cloned(), saved.get("modelId").filter(|v| v.is_string()).cloned()) else { return };
        let context = saved.get("context").cloned().unwrap_or(Value::Null);
        if models.status().pointer("/runtime/modelId") == Some(&id) {
            return;
        }
        std::thread::spawn(move || {
            models.start(&id, &context);
        });
    }

    fn models_call(&self, method: &str, args: &[Value]) -> Out {
        let Some(models) = self.models.get() else { return Err(BridgeError::NotAvailable("Models are not ready yet.".into())) };
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        Ok(match method {
            "hardware" => models.hardware(),
            "local" => models.local(),
            "status" => models.status(),
            "discover" => models.discover(arg(0)),
            "download" => models.download(arg(0), arg(1)),
            "cancelDownload" => {
                models.cancel_download();
                Value::Null
            }
            "start" => {
                let result = models.start(arg(0), arg(1));
                if result.get("ok") == Some(&Value::Bool(true)) {
                    let mut saved = self.local_model();
                    saved["modelId"] = arg(0).clone();
                    saved["context"] = arg(1).clone();
                    mobius_store::file::write_json_checked(&self.data_dir.join("local-model.json"), &saved);
                }
                result
            }
            "autostart" => {
                let saved = self.local_model();
                json!({ "enabled": saved.get("startWithMobius") == Some(&Value::Bool(true)), "modelId": saved.get("modelId").cloned().unwrap_or(Value::Null) })
            }
            "setAutostart" => match arg(0).as_bool() {
                Some(on) => {
                    let mut saved = self.local_model();
                    saved["startWithMobius"] = json!(on);
                    if mobius_store::file::write_json_checked(&self.data_dir.join("local-model.json"), &saved) { json!({ "ok": true }) } else { failed("That could not be saved.") }
                }
                None => failed("That could not be saved."),
            },
            "stop" => models.stop(),
            "engine" => models.engine(),
            "installEngine" => models.install_engine(),
            "cancelEngine" => {
                models.cancel_engine();
                Value::Null
            }
            _ => return Err(BridgeError::NotAvailable(format!("models.{method} is not available in this build yet."))),
        })
    }

    /// Lets tests talk to the core directly. Never turned on outside tests.
    pub fn enable_test_hooks(&self) {
        self.test_hooks.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    fn test_call(&self, method: &str, args: &[Value]) -> Out {
        if !self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(BridgeError::NotAvailable("That is only for tests.".into()));
        }
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        match method {
            "coreCall" => {
                let name = arg(0).as_str().ok_or_else(|| BridgeError::Invalid("a method name is needed".into()))?;
                let params = if arg(1).is_null() { json!({}) } else { arg(1).clone() };
                self.core.call(name, params, Duration::from_secs(20)).map_err(|e| BridgeError::Invalid(match e {
                    crate::process::CallError::Rpc(r) => r.message,
                    other => format!("the core could not be reached ({other:?})"),
                }))
            }
            "views" => Ok(match self.browser.get() {
                Some(b) => {
                    let shown = b.shown();
                    Value::Array(b.list().into_iter().map(|(id, url, _, _)| match shown.as_ref().filter(|(s, _)| *s == id) {
                        Some((_, r)) => {
                            let z = self.zoom();
                            let scaled = |n: i32| (f64::from(n) * z).round();
                            json!({ "id": id, "url": url, "visible": true, "bounds": { "x": scaled(r.x), "y": scaled(r.y), "width": scaled(r.width), "height": scaled(r.height) } })
                        }
                        None => json!({ "id": id, "url": url, "visible": false, "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 } }),
                    }).collect())
                }
                None => json!([]),
            }),
            "quit" => {
                if let Some(quit) = self.quit.get() {
                    quit();
                }
                Ok(Value::Null)
            }
            "notices" => Ok(Value::Array(lock(&self.notices).clone())),
            "awake" => Ok(json!(lock(&self.keep_awake).as_ref().is_some_and(KeepAwake::is_holding))),
            "probe" => {
                let name = arg(0).as_str().ok_or_else(|| BridgeError::Invalid("a name is needed".into()))?;
                Ok(match name {
                    "zoom" => json!(self.zoom()),
                    other => self.probe.get().map_or(Value::Null, |p| p(other, arg(1))),
                })
            }
            "quickActive" => Ok(json!(lock(&self.quick).as_ref().is_some_and(QuickEntry::active))),
            "quickPress" => {
                if let Some(q) = lock(&self.quick).as_ref() {
                    q.press();
                }
                Ok(Value::Null)
            }
            "takeShortcut" => {
                // Another program owning a combination: the same system registration, under another owner.
                let accelerator = arg(0).as_str().ok_or_else(|| BridgeError::Invalid("a combination is needed".into()))?;
                let taken = self.dialogs.get().is_some_and(|d| d.shortcut_registrar().register(accelerator, Arc::new(|| {})));
                Ok(json!(taken))
            }
            "corePid" => Ok(self.core.pid().map_or(Value::Null, |p| json!(p))),
            "coreHistory" => Ok(json!(lock(&self.status_history).clone())),
            "crashCore" => {
                self.core.crash();
                Ok(Value::Null)
            }
            _ => Err(BridgeError::NotAvailable(format!("test.{method} does not exist."))),
        }
    }

    /// Where downloads are saved. Until this is called they go to a folder inside the data folder.
    pub fn set_downloads_dir(&self, dir: PathBuf) {
        *lock(&self.downloads) = Downloads::new(dir);
    }

    fn downloads_call(&self, method: &str, id: &Value) -> Out {
        let id = id.as_str().filter(|i| is_download_id(i));
        Ok(match method {
            "get" => lock(&self.downloads).list(),
            "clear" => {
                lock(&self.downloads).clear();
                self.downloads_changed();
                Value::Null
            }
            "cancel" => {
                let place = id.and_then(|i| lock(&self.downloads).cancel(i));
                if let (Some(path), Some(d)) = (place, self.dialogs.get()) {
                    d.cancel_download(&path);
                    self.downloads_changed();
                }
                Value::Null
            }
            "open" | "show" => {
                // Programs are never opened from here; the file is shown in its folder instead.
                let file = id.and_then(|i| lock(&self.downloads).file(i).map(|(p, risky)| (p.to_path_buf(), risky)));
                if let (Some((path, risky)), Some(d)) = (file, self.dialogs.get()) {
                    if method == "open" && !risky {
                        d.open_path(&path);
                    } else if method == "show" {
                        d.show_path(&path);
                    }
                }
                Value::Null
            }
            _ => return Err(BridgeError::NotAvailable(format!("downloads.{method} is not available in this build yet."))),
        })
    }

    fn focused(&self) -> bool {
        self.dialogs.get().is_some_and(|d| d.window_focused())
    }

    /// The window was brought to the front. If that follows closely on a notice about a conversation, the person most likely
    /// came for it (the system does not tell us a notice was clicked), so the window is told to open it.
    pub fn window_activated(&self, within: Duration) {
        let found = lock(&self.last_notice).take();
        if let Some((conversation, at)) = found
            && at.elapsed() <= within
        {
            (self.emit)("mobius:open-conversation", json!(conversation));
        }
    }

    /// Shows a notice; while testing it is recorded instead, because a test window never has the focus and nobody is watching.
    fn tell(&self, notice: &Notice) {
        if let Some(c) = &notice.conversation {
            *lock(&self.last_notice) = Some((c.clone(), std::time::Instant::now()));
        }
        if self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            lock(&self.notices).push(notice.to_json());
        } else if let Some(d) = self.dialogs.get() {
            d.show_notice(notice);
        }
    }

    fn downloads_changed(&self) {
        let list = lock(&self.downloads).list();
        let before = std::mem::replace(&mut *lock(&self.last_downloads), list.clone());
        let (old, prefs, focused) = (notify::by_id(&before), lock(&self.preferences).get(), self.focused());
        for entry in list.as_array().into_iter().flatten() {
            let previous = entry.get("id").and_then(Value::as_str).and_then(|id| old.get(id));
            if let Some(notice) = notify::decide_download_notice(previous, entry, &prefs, focused) {
                self.tell(&notice);
            }
        }
        (self.emit)("mobius:downloads-state", list);
    }

    /// A page started a download. Returns where to save it, or `None` to refuse.
    /// Says which web engine shows the pages, for the About page.
    pub fn set_engine(&self, name: &str) {
        let _ = self.engine.set(name.to_owned());
    }

    pub fn download_requested(&self, suggested: &str) -> Option<PathBuf> {
        let accepted = lock(&self.downloads).accept(suggested, 0)?;
        self.downloads_changed();
        Some(accepted.path)
    }

    /// Bytes arrived for the download being saved at `path`.
    pub fn download_progress(&self, path: &Path, received: u64, total: u64) {
        let changed = {
            let mut d = lock(&self.downloads);
            d.progress_path(path, received, total)
        };
        if changed {
            self.downloads_changed();
        }
    }

    /// The web view finished a download at `path`.
    pub fn download_finished(&self, path: &Path, success: bool) {
        if lock(&self.downloads).finish_path(path, success) {
            self.downloads_changed();
        }
    }

    /// A key was pressed while a web page had the keyboard. If it is one of the window's shortcuts the window is told and
    /// the page is not (`true`).
    pub fn page_key(&self, virtual_key: u32, control: bool, alt: bool, shift: bool) -> bool {
        let Some(combo) = mobius_store::keys::combo_of_windows_key(virtual_key, control, alt, shift) else { return false };
        let bindings = lock(&self.preferences).get().get("keybindings").cloned().unwrap_or(Value::Null);
        match mobius_store::keys::window_action_for(&bindings, &combo) {
            Some(shortcut) => {
                (self.emit)("mobius:shortcut", json!(shortcut));
                true
            }
            None => false,
        }
    }

    /// A page finished loading; remembered unless history is off or the address is not a web page.
    pub fn record_visit(&self, url: &str, title: &str) {
        lock(&self.history).visit(url, title);
    }

    /// The theme chosen in settings: `system`, `light` or `dark`.
    pub fn theme(&self) -> String {
        lock(&self.appearance).get().get("theme").and_then(Value::as_str).unwrap_or("system").to_owned()
    }

    /// How much the interface is zoomed (1.0 when unset).
    pub fn zoom(&self) -> f64 {
        lock(&self.appearance).get().get("zoom").and_then(Value::as_f64).filter(|z| (0.5..=3.0).contains(z)).unwrap_or(1.0)
    }

    /// The browser app and the dialogs are provided by the window system once it exists.
    pub fn attach(&self, browser: Arc<Browser>, dialogs: Arc<dyn Dialogs>) {
        let _ = self.browser.set(browser);
        let blocker = dialogs.awake_blocker();
        let (emit, forward) = (self.emit.clone(), Arc::clone(&dialogs));
        let on_press: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            forward.bring_forward();
            emit("mobius:shortcut", json!("quick-entry"));
        });
        let mut quick = QuickEntry::new(dialogs.shortcut_registrar(), on_press);
        let wanted_keys = lock(&self.preferences).get().pointer("/keybindings/quickEntry").and_then(Value::as_str).unwrap_or("").to_owned();
        quick.set(&wanted_keys);
        *lock(&self.quick) = Some(quick);
        let _ = self.dialogs.set(dialogs);
        let wanted = lock(&self.preferences).get().get("keepAwake").and_then(Value::as_bool).unwrap_or(false);
        *lock(&self.keep_awake) = Some(KeepAwake::new(blocker, wanted));
    }

    fn browser_call(&self, method: &str, args: &[Value]) -> Out {
        let Some(b) = self.browser.get() else { return Err(BridgeError::NotAvailable("The browser is not ready yet.".into())) };
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        let tab = || arg(0).as_str().filter(|t| is_tab_id(t));
        Ok(match method {
            "getState" => b.state(),
            "open" => b.open(arg(0).as_str()).map_or(Value::Null, |id| json!(id)),
            "activate" => {
                if let Some(t) = tab() {
                    b.activate(t);
                }
                Value::Null
            }
            "close" => {
                if let Some(t) = tab() {
                    b.close(t);
                }
                Value::Null
            }
            "navigate" => match (tab(), arg(1).as_str()) {
                (Some(t), Some(input)) => json!(b.navigate(t, input)),
                _ => json!("blocked"),
            },
            "back" | "forward" | "reload" | "stopFind" => {
                if let Some(t) = tab() {
                    match method {
                        "back" => b.back(t),
                        "forward" => b.forward(t),
                        "reload" => b.reload(t),
                        _ => b.stop_find(t),
                    }
                }
                Value::Null
            }
            "find" => {
                let r = arg(0);
                let text = r.get("text").and_then(Value::as_str).filter(|t| !t.is_empty() && t.chars().count() <= 200);
                let id = r.get("tabId").and_then(Value::as_str).filter(|t| is_tab_id(t));
                if let (Some(id), Some(text)) = (id, text) {
                    let flag = |name: &str, default: bool| r.get(name).and_then(Value::as_bool).unwrap_or(default);
                    b.find(id, text, flag("forward", true), flag("again", false));
                }
                Value::Null
            }
            "reopenClosed" => b.reopen_closed().map_or(Value::Null, |id| json!(id)),
            "duplicate" => tab().and_then(|t| b.duplicate(t)).map_or(Value::Null, |id| json!(id)),
            "pin" => {
                if let (Some(t), Some(on)) = (tab(), arg(1).as_bool()) {
                    b.pin(t, on);
                }
                Value::Null
            }
            "moveTab" => {
                if let (Some(t), Some(to)) = (tab(), arg(1).as_u64().and_then(|n| usize::try_from(n).ok()).filter(|n| *n < 1000)) {
                    b.move_tab(t, to);
                }
                Value::Null
            }
            "snapshot" => b.picture().map_or(Value::Null, |p| json!(p)),
            _ => return Err(BridgeError::NotAvailable(format!("browser.{method} is not available in this build yet."))),
        })
    }

    /// The page saved is always the open tab as the browser knows it, never an address the window names.
    fn toggle_bookmark(&self) -> Value {
        let Some(b) = self.browser.get() else { return json!(false) };
        let Some((_, url, title, _)) = b.list().into_iter().find(|t| t.3) else { return json!(false) };
        let saved = lock(&self.bookmarks).toggle(&url, &title);
        (self.emit)("mobius:bookmarks-changed", Value::Null);
        json!(saved)
    }

    fn context_page(&self) -> Value {
        let nothing = || failed("There is no web page open to attach.");
        let Some(b) = self.browser.get() else { return nothing() };
        let Some((id, url, tab_title, _)) = b.list().into_iter().find(|t| t.3) else { return nothing() };
        if !mobius_browser::address::is_web_url(&url) {
            return nothing();
        }
        let Some((page_url, title, text)) = b.read(&id) else { return failed("That page has no text Mobius could read.") };
        if text.trim().is_empty() {
            return failed("That page has no text Mobius could read.");
        }
        let title: String = if title.is_empty() { if tab_title.is_empty() { url.clone() } else { tab_title } } else { title }.chars().take(120).collect();
        let source: String = page_url.chars().take(500).collect();
        json!({ "ok": true, "item": { "kind": "page", "title": title, "source": source, "text": crate::context_file::cut(&text) } })
    }

    /// The text selected on the page that is showing, as something to attach: on-canvas actions for the web.
    fn context_selection(&self) -> Value {
        let nothing = || failed("Select some text on the page first.");
        let Some(b) = self.browser.get() else { return nothing() };
        let Some((id, url, tab_title, _)) = b.list().into_iter().find(|t| t.3) else { return nothing() };
        if !mobius_browser::address::is_web_url(&url) {
            return nothing();
        }
        let Some((page_url, title, text)) = b.selection(&id) else { return nothing() };
        if text.trim().is_empty() {
            return nothing();
        }
        let name = if title.is_empty() { if tab_title.is_empty() { url.clone() } else { tab_title } } else { title };
        let title: String = format!("Selected on {name}").chars().take(120).collect();
        let source: String = page_url.chars().take(500).collect();
        json!({ "ok": true, "item": { "kind": "page", "title": title, "source": source, "text": crate::context_file::cut(&text) } })
    }

    fn context_file(&self) -> Value {
        // Tests choose the file without a window opening.
        let chosen = std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1").then(|| std::env::var("MOBIUS_TEST_PICK_FILE").ok()).flatten().map(PathBuf::from);
        let file = chosen.or_else(|| self.dialogs.get().and_then(|d| d.pick_text_file()));
        match file {
            Some(f) => crate::context_file::read_text_file(&f),
            None => json!({ "ok": true, "item": null }),
        }
    }

    /// A tool the core has allowed and the application must run: only the browser's, and only while a window is open.
    pub fn host_request(&self, method: &str, params: &Value) -> Result<Value, String> {
        if method != "host.tool" {
            return Err("method not found".into());
        }
        let tool = params.get("tool").and_then(Value::as_str).filter(|t| mobius_mcp::hub::is_mcp_tool(t) || mobius_workspace::files::is_file_tool(t) || mobius_workspace::tasks::is_task_tool(t) || mobius_workspace::calendar::is_calendar_tool(t) || mobius_workspace::sheets::is_sheet_tool(t) || crate::mail::store::is_mail_tool(t) || crate::memory::is_memory_tool(t) || crate::schedules::is_schedule_tool(t) || tool_descriptions().iter().any(|d| d["name"] == *t)).ok_or("unknown tool")?;
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);
        if mobius_mcp::hub::is_mcp_tool(tool) {
            return self.mcp.run(tool, &args).map(Value::String);
        }
        if crate::schedules::is_schedule_tool(tool) {
            let result = self.schedules.run(tool, &args).map(Value::String);
            if result.is_ok() && tool == "schedules.add" {
                (self.emit)("mobius:schedules-changed", Value::Null);
            }
            return result;
        }
        if crate::memory::is_memory_tool(tool) {
            let result = self.memory.run(tool, &args).map(Value::String);
            if result.is_ok() {
                (self.emit)("mobius:memory-changed", Value::Null);
            }
            return result;
        }
        if mobius_workspace::tasks::is_task_tool(tool) {
            let result = self.tasks.run(tool, &args).map(Value::String);
            if result.is_ok() && tool != "tasks.list" {
                (self.emit)("mobius:tasks-changed", json!({ "list": args.get("list").and_then(Value::as_str).unwrap_or(mobius_workspace::tasks::DEFAULT_LIST), "by": "assistant" }));
            }
            return result;
        }
        if crate::mail::store::is_mail_tool(tool) {
            let result = self.mail.run(tool, &args).map(Value::String);
            if result.is_ok() && tool == "mail.draft" {
                (self.emit)("mobius:mail-changed", json!({ "by": "assistant" }));
            }
            return result;
        }
        if mobius_workspace::sheets::is_sheet_tool(tool) {
            let result = self.sheets.run(tool, &args).map(Value::String);
            if result.is_ok() && tool == "sheets.write" {
                (self.emit)("mobius:sheets-changed", json!({ "workbook": args.get("workbook").and_then(Value::as_str).map(mobius_workspace::notes::file_name_for), "by": "assistant" }));
            }
            return result;
        }
        if mobius_workspace::calendar::is_calendar_tool(tool) {
            let result = self.calendar.run(tool, &args).map(Value::String);
            if result.is_ok() && tool != "calendar.list" {
                (self.emit)("mobius:calendar-changed", json!({ "calendar": args.get("calendar").and_then(Value::as_str).unwrap_or(mobius_workspace::calendar::DEFAULT_CALENDAR), "by": "assistant" }));
            }
            return result;
        }
        if mobius_workspace::files::is_file_tool(tool) {
            let result = self.workspace.run(tool, &args).map(Value::String);
            let path = args.get("path").and_then(Value::as_str).unwrap_or("").replace('\\', "/");
            if result.is_ok() && matches!(tool, "files.write" | "files.edit") {
                if let Some(page) = path.strip_prefix("notes/") {
                    (self.emit)("mobius:notes-changed", json!({ "path": page, "by": "assistant" }));
                }
                if let Some(doc) = path.strip_prefix("docs/") {
                    (self.emit)("mobius:docs-changed", json!({ "path": doc, "by": "assistant" }));
                }
                if let Some(book) = path.strip_prefix("sheets/") {
                    (self.emit)("mobius:sheets-changed", json!({ "workbook": book.split('/').next(), "by": "assistant" }));
                }
                if let Some(list) = path.strip_prefix("tasks/").and_then(|f| f.strip_suffix(".md")) {
                    (self.emit)("mobius:tasks-changed", json!({ "list": list, "by": "assistant" }));
                }
            }
            return result;
        }
        let browser = self.browser.get().ok_or("no window is open")?.clone();
        let prefs = self.preference("agentPrivateUrls");
        let deps = BrowserTools { browser, allow_private: Box::new(move || prefs == Value::Bool(true)) };
        run_browser_tool(tool, &args, &deps).map(Value::String)
    }

    /// Tells the core about the tools this application runs. Called each time the core becomes ready.
    /// Starts one scheduled request: a new conversation, reviewable like any turn. Says which conversation it is.
    fn run_schedule(&self, schedule: &crate::schedules::Schedule) -> Value {
        let conversation = crate::schedules::conversation_for_run();
        let Some(request) = agent::parse_send(&json!({ "conversation": conversation, "text": schedule.prompt })) else {
            return failed("That request cannot be sent.");
        };
        match self.workspace.mark("before a scheduled request") {
            Ok(Some(mark)) => {
                let mut marks = lock(&self.turn_marks);
                marks.insert(conversation.clone(), mark);
                mobius_store::file::write_json(&self.data_dir.join("turn-marks.json"), &json!(*marks));
            }
            Ok(None) => {}
            Err(error) => eprintln!("[changes] no mark before the scheduled request: {error}"),
        }
        let result = self.agent.send_remembering(&request, None, &self.memory.instructions());
        if result["ok"] == json!(true) {
            (self.emit)("mobius:schedule-ran", json!({ "id": schedule.id, "title": schedule.title, "conversation": conversation }));
            json!({ "ok": true, "conversation": conversation })
        } else {
            result
        }
    }

    /// Runs what is due now. Called every half minute; does nothing until the core is ready.
    pub fn run_due_schedules(&self) {
        if self.core.status() != Status::Ready || !self.agent.settings()["configured"].as_bool().unwrap_or(false) {
            return;
        }
        let due = self.schedules.take_due(&chrono::Local::now());
        if !due.is_empty() {
            (self.emit)("mobius:schedules-changed", Value::Null);
        }
        for schedule in due {
            self.run_schedule(&schedule);
        }
    }

    /// Checks the schedules every half minute for as long as the bridge lives.
    pub fn start_schedules(self: &Arc<Self>) {
        // Calendars kept elsewhere are read again every so often, on a thread of their own: a slow server must not
        // hold up a scheduled request.
        let accounts = Arc::downgrade(self);
        std::thread::spawn(move || {
            while let Some(bridge) = accounts.upgrade() {
                if bridge.calendar_accounts.sync_due() {
                    bridge.refresh_mirrors();
                }
                if bridge.mail.sync_due() {
                    (bridge.emit)("mobius:mail-changed", json!({ "by": "another app" }));
                }
                drop(bridge);
                std::thread::sleep(Duration::from_secs(60));
            }
        });
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || {
            while let Some(bridge) = weak.upgrade() {
                bridge.run_due_schedules();
                drop(bridge);
                std::thread::sleep(Duration::from_secs(30));
            }
        });
    }

    fn register_tools(&self) {
        for tool in tool_descriptions().into_iter().chain(mobius_workspace::files::tool_descriptions()).chain(mobius_workspace::tasks::tool_descriptions()).chain(mobius_workspace::calendar::tool_descriptions()).chain(mobius_workspace::sheets::tool_descriptions()).chain(crate::mail::store::tool_descriptions()).chain(crate::memory::tool_descriptions()).chain(crate::schedules::tool_descriptions()) {
            let _ = self.core.call("tools.register_external", tool, Duration::from_secs(5));
        }
        self.mcp.begin(self.data_dir.join("mcp.json"), self.core.clone());
    }

    /// Point a provider at a local fake server. Does nothing unless the test hooks are on.
    pub fn redirect_provider_for_tests(&self, id: &str, url: &str) {
        if self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            self.providers.redirect_for_tests(id, url);
        }
    }

    /// Use this Claude Code CLI (a fake one in tests). Does nothing unless the test hooks are on.
    pub fn use_claude_for_tests(&self, command: &Path) {
        if self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            *lock(&self.claude_command) = Some(command.to_path_buf());
        }
    }

    /// Sign in to ChatGPT at this pretend OpenAI. Does nothing unless the test hooks are on.
    pub fn use_chatgpt_for_tests(&self, issuer: &str) {
        if self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            *lock(&self.chatgpt) = Arc::new(crate::chatgpt::ChatGpt::new(issuer, self.secrets.clone()).with_poll(std::time::Duration::from_millis(200)));
        }
    }

    fn chatgpt_call(&self, method: &str, sub: &crate::providers::Subscription, model: Option<&str>) -> Value {
        let chatgpt = lock(&self.chatgpt).clone();
        let active = self.agent.base_url().eq_ignore_ascii_case(sub.address);
        match method {
            "accountStatus" => {
                let mut status = chatgpt.status();
                status["active"] = json!(active);
                status
            }
            "signIn" => {
                let emit = self.emit.clone();
                match chatgpt.start_sign_in(Arc::new(move |_| emit("mobius:providers-changed", Value::Null))) {
                    Ok(pending) => json!({ "ok": true, "code": pending.code, "url": pending.url }),
                    Err(e) => failed(e),
                }
            }
            "cancelSignIn" => {
                chatgpt.cancel_sign_in();
                json!({ "ok": true })
            }
            "signOut" => {
                chatgpt.sign_out();
                if active {
                    self.agent.mark_stopped();
                }
                (self.emit)("mobius:providers-changed", Value::Null);
                json!({ "ok": true })
            }
            "models" => json!({ "ok": true, "models": crate::providers::CHATGPT_MODELS.iter().map(|(id, _)| *id).collect::<Vec<_>>() }),
            "use" => {
                let Some(model) = model.map(str::trim).filter(|m| !m.is_empty()) else { return failed("Choose a model.") };
                if !(model.starts_with("gpt-") || model.starts_with("codex-")) || !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) {
                    return failed("That is not a ChatGPT model.");
                }
                let result = self.agent.use_endpoint(sub.address, model, None);
                (self.emit)("mobius:providers-changed", Value::Null);
                (self.emit)("mobius:agent-settings", self.agent.settings());
                result
            }
            _ => failed("unknown"),
        }
    }

    /// What sign-ins would have opened (test hooks only).
    pub fn sign_ins_for_tests(&self) -> Vec<String> {
        lock(&self.signed_in_with).clone()
    }

    /// Sign in to a subscription: its own app's sign-in, in a window of its own. Mobius never handles the account.
    fn sign_in(&self, id: &str) -> Value {
        if crate::providers::find_subscription(id).is_none() {
            return failed("That is not a plan Mobius can sign in to.");
        }
        let command = lock(&self.claude_command).clone();
        let Some(program) = mobius_claude::cli::find(command.as_deref()) else { return failed(mobius_claude::cli::INSTALL_HINT) };
        if self.test_hooks.load(std::sync::atomic::Ordering::SeqCst) {
            lock(&self.signed_in_with).push(format!("{} auth login", program.display()));
            return json!({ "ok": true });
        }
        #[cfg(windows)]
        let started = std::process::Command::new("cmd").args(["/C", "start", "Claude Code sign-in", "cmd", "/K"]).arg(&program).args(["auth", "login"]).spawn();
        #[cfg(not(windows))]
        let started = std::process::Command::new(&program).args(["auth", "login"]).spawn();
        match started {
            Ok(_) => json!({ "ok": true }),
            Err(e) => failed(format!("Could not open the sign-in: {e}")),
        }
    }

    pub fn provider_address(&self, id: &str) -> Option<String> {
        self.providers.address(id)
    }

    /// Everything the composer's model picker offers, grouped by where it runs: plans you are signed in to,
    /// providers with a key, the models on this computer, and the server in use when it is none of those. Each
    /// provider's list is asked for at the same time; one that does not answer shows its problem instead.
    fn model_catalog(&self) -> Value {
        let base = self.agent.base_url();
        let (_, current_model, _) = self.agent.current_server();
        let p = &self.providers;
        let claude_command = lock(&self.claude_command).clone();
        let chatgpt = lock(&self.chatgpt).clone();
        let local_runtime = self.models.get().map(|m| m.status()).unwrap_or(Value::Null);
        let local = self.models.get().map(|m| m.local()).unwrap_or_else(|| json!([]));
        let keyed: Vec<(&'static str, &'static str, String, Option<String>)> = crate::providers::CATALOG
            .iter()
            .filter_map(|prov| {
                let address = p.address(prov.id)?;
                let key = p.key(prov.id);
                let active = p.id_for_address(&base) == Some(prov.id);
                (key.is_some() || (!prov.needs_key && active)).then_some((prov.id, prov.name, address, key))
            })
            .collect();
        let (subscriptions, providers) = std::thread::scope(|scope| {
            let subs: Vec<_> = crate::providers::SUBSCRIPTIONS
                .iter()
                .map(|s| {
                    let (command, chatgpt) = (claude_command.clone(), chatgpt.clone());
                    scope.spawn(move || {
                        let signed_in = if s.address == crate::providers::CHATGPT_ADDRESS { chatgpt.status()["signedIn"] == true } else { mobius_claude::cli::status(command.as_deref())["signedIn"] == true };
                        (s, signed_in)
                    })
                })
                .collect();
            let provs: Vec<_> = keyed.iter().map(|(id, name, address, key)| scope.spawn(move || (*id, *name, address.clone(), AgentService::models_at(address, key)))).collect();
            (subs.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>(), provs.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>())
        });
        let mut groups = Vec::new();
        let mut matched = false;
        for (s, signed_in) in subscriptions {
            let active = base.eq_ignore_ascii_case(s.address);
            matched |= active;
            if signed_in || active {
                let models: Vec<Value> = crate::providers::subscription_models(s).iter().map(|(id, label)| json!({ "id": id, "label": label })).collect();
                groups.push(json!({ "kind": "subscription", "id": s.id, "name": s.name, "active": active, "models": models, "error": if signed_in { Value::Null } else { json!("Signed out. Sign in again in Settings > Providers.") } }));
            }
        }
        for (id, name, _address, listed) in providers {
            let active = p.id_for_address(&base) == Some(id);
            matched |= active;
            let ok = listed.get("ok") == Some(&Value::Bool(true));
            let models: Vec<Value> = if ok { listed["models"].as_array().cloned().unwrap_or_default().into_iter().map(|m| json!({ "id": m, "label": m })).collect() } else { Vec::new() };
            groups.push(json!({ "kind": "provider", "id": id, "name": name, "active": active, "models": models, "error": if ok { Value::Null } else { listed.get("error").cloned().unwrap_or(Value::Null) } }));
        }
        let running_base = local_runtime.pointer("/runtime/baseUrl").and_then(Value::as_str).unwrap_or("");
        let running_id = local_runtime.pointer("/runtime/modelId").and_then(Value::as_str).unwrap_or("");
        let local_active = !running_base.is_empty() && running_base.trim_end_matches('/').eq_ignore_ascii_case(base.trim_end_matches('/'));
        matched |= local_active;
        let local_models: Vec<Value> = local
            .as_array()
            .into_iter()
            .flatten()
            .filter(|e| e.pointer("/assessment/fit").and_then(Value::as_str) != Some("too_big"))
            .filter_map(|e| {
                let id = e.pointer("/model/id")?.as_str()?;
                let file = e.pointer("/model/file")?.as_str()?;
                Some(json!({ "id": id, "label": file.trim_end_matches(".gguf"), "current": local_active && id == running_id }))
            })
            .collect();
        if !local_models.is_empty() {
            groups.push(json!({ "kind": "local", "id": "local", "name": "This computer", "active": local_active, "models": local_models, "error": null }));
        }
        if !matched && !base.is_empty() {
            let listed = self.agent.models();
            let ok = listed.get("ok") == Some(&Value::Bool(true));
            let models: Vec<Value> = if ok { listed["models"].as_array().cloned().unwrap_or_default().into_iter().map(|m| json!({ "id": m, "label": m })).collect() } else { Vec::new() };
            groups.push(json!({ "kind": "server", "id": "server", "name": "This server", "active": true, "models": models, "error": if ok { Value::Null } else { listed.get("error").cloned().unwrap_or(Value::Null) } }));
        }
        // The model in use is always shown, even when its provider cannot list its models right now.
        for group in &mut groups {
            if group["active"] == true && group["kind"] != "local" && !current_model.is_empty() && !group["models"].as_array().is_some_and(|m| m.iter().any(|m| m["id"] == current_model.as_str())) {
                if let Some(list) = group["models"].as_array_mut() {
                    list.insert(0, json!({ "id": current_model, "label": current_model }));
                }
            }
        }
        json!({ "current": current_model, "groups": groups })
    }

    /// Settings > Providers. A key goes in and is never given back; it is only ever sent to its provider's address.
    fn providers_call(&self, method: &str, args: &[Value]) -> Value {
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let p = &self.providers;
        let changed = || (self.emit)("mobius:providers-changed", Value::Null);
        // Subscriptions (sign in, no key) go first.
        if let Some(sub) = text(0).and_then(crate::providers::find_subscription) {
            if sub.address == crate::providers::CHATGPT_ADDRESS {
                return self.chatgpt_call(method, sub, text(1));
            }
            return match method {
                "accountStatus" => {
                    let command = lock(&self.claude_command).clone();
                    let mut status = mobius_claude::cli::status(command.as_deref());
                    status["active"] = json!(self.agent.base_url().eq_ignore_ascii_case(sub.address));
                    status
                }
                "signIn" => self.sign_in(sub.id),
                "models" => json!({ "ok": true, "models": mobius_claude::frames::MODELS.iter().map(|(id, _)| *id).collect::<Vec<_>>() }),
                "use" => {
                    let Some(model) = text(1).map(str::trim).filter(|m| !m.is_empty()) else { return failed("Choose a model.") };
                    if !mobius_claude::frames::MODELS.iter().any(|(id, _)| *id == model) && !model.starts_with("claude-") {
                        return failed("That is not a Claude model.");
                    }
                    let result = self.agent.use_endpoint(sub.address, model, None);
                    changed();
                    (self.emit)("mobius:agent-settings", self.agent.settings());
                    result
                }
                _ => failed("unknown"),
            };
        }
        match method {
            "catalog" => self.model_catalog(),
            "accounts" => Value::Array(crate::providers::SUBSCRIPTIONS.iter().map(|s| json!({ "id": s.id, "name": s.name, "note": s.note, "active": self.agent.base_url().eq_ignore_ascii_case(s.address), "kind": s.kind, "models": crate::providers::subscription_models(s).iter().map(|(id, label)| json!({ "id": id, "label": label })).collect::<Vec<_>>() })).collect()),
            "list" => p.list(&self.agent.base_url()),
            "setKey" => match (text(0), text(1)) {
                (Some(id), Some(key)) => match p.set_key(id, key) {
                    Ok(storage) => {
                        changed();
                        json!({ "ok": true, "storage": storage })
                    }
                    Err(e) => failed(e),
                },
                _ => failed("That key cannot be saved."),
            },
            "removeKey" => {
                if let Some(id) = text(0)
                    && let Some(address) = p.address(id)
                {
                    p.remove_key(id);
                    self.agent.drop_key_for(&address);
                    changed();
                    (self.emit)("mobius:agent-settings", self.agent.settings());
                }
                Value::Null
            }
            "models" => {
                let Some((id, address)) = text(0).and_then(|id| p.address(id).map(|a| (id, a))) else { return failed("That provider is not known.") };
                let needs_key = crate::providers::find(id).is_some_and(|x| x.needs_key);
                let key = p.key(id);
                if needs_key && key.is_none() {
                    return failed("Add a key for this provider first.");
                }
                AgentService::models_at(&address, &key)
            }
            "use" => {
                let (Some(id), Some(model)) = (text(0), text(1)) else { return failed("Choose a provider and a model.") };
                let Some(provider) = crate::providers::find(id) else { return failed("That provider is not known.") };
                let key = p.key(id);
                if provider.needs_key && key.is_none() {
                    return failed(format!("Add a key for {} first.", provider.name));
                }
                let Some(address) = p.address(id) else { return failed("That provider is not known.") };
                let result = self.agent.use_endpoint(&address, model.trim(), key);
                changed();
                (self.emit)("mobius:agent-settings", self.agent.settings());
                result
            }
            _ => failed("unknown"),
        }
    }

    /// The Notes app. Every answer is either the data asked for or `{ ok: false, message }`; a save that would
    /// overwrite a change made elsewhere also says `conflict: true` so the window can reload the page.
    /// The Notes app, and Docs, which keeps its documents the same way in another folder.
    fn notes_call(&self, notes: &mobius_workspace::notes::Notes, event: &str, method: &str, args: &[Value]) -> Value {
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let result = match method {
            "list" => notes.list(),
            "read" => text(0).ok_or_else(|| "a page is needed".to_owned()).and_then(|p| notes.read(p)),
            "search" => notes.search(&text(0).unwrap_or("").chars().take(200).collect::<String>()),
            "createNotebook" => text(0).ok_or_else(|| "a name is needed".to_owned()).and_then(|n| notes.create_notebook(n)),
            "createPage" => match (text(0), text(1)) {
                (Some(notebook), Some(title)) => notes.create_page(notebook, title),
                _ => Err("a notebook and a title are needed".to_owned()),
            },
            "save" => match (text(0), text(1), args.get(2).unwrap_or(&Value::Null)) {
                (Some(path), Some(content), base @ (Value::Null | Value::Number(_))) => notes.save(path, content, base.as_u64()),
                _ => Err("that cannot be saved".to_owned()),
            },
            "remove" => text(0).ok_or_else(|| "a page is needed".to_owned()).and_then(|p| notes.remove_page(p)).map(|_| json!({ "ok": true })),
            _ => return json!({ "ok": false, "message": "unknown" }),
        };
        match result {
            Ok(value) => {
                if matches!(method, "createNotebook" | "createPage" | "save" | "remove") {
                    let path = value.get("path").cloned().unwrap_or(Value::Null);
                    (self.emit)(event, json!({ "path": path, "by": "person" }));
                }
                value
            }
            Err(message) => json!({ "ok": false, "conflict": message == "changed elsewhere", "message": message }),
        }
    }

    /// The Tasks app. Every answer is the list asked for or `{ ok: false, message }`; a change to a task that moved or
    /// changed meanwhile also says `conflict: true`, so the window reloads instead of changing the wrong task.
    fn tasks_call(&self, method: &str, args: &[Value]) -> Value {
        use mobius_workspace::tasks::Change;
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let line = |i: usize| args.get(i).and_then(Value::as_u64).and_then(|n| usize::try_from(n).ok());
        let tasks = &self.tasks;
        let result = match method {
            "lists" => tasks.lists(),
            "read" => text(0).ok_or_else(|| "a list is needed".to_owned()).and_then(|l| tasks.read(l)),
            "createList" => text(0).ok_or_else(|| "a name is needed".to_owned()).and_then(|n| tasks.create_list(n)),
            "add" => match (text(0), text(1)) {
                (Some(list), Some(words)) => tasks.add(list, words, text(2).filter(|d| !d.is_empty())),
                _ => Err("a list and some words are needed".to_owned()),
            },
            "update" => match (text(0), line(1), text(2), args.get(3).and_then(Value::as_object)) {
                (Some(list), Some(at), Some(expect), Some(change)) => {
                    let due = match change.get("due") {
                        None => None,
                        Some(Value::Null) => Some(None),
                        Some(Value::String(d)) if d.is_empty() => Some(None),
                        Some(Value::String(d)) => Some(Some(d.clone())),
                        Some(_) => return json!({ "ok": false, "message": "a due date is written YYYY-MM-DD" }),
                    };
                    let change = Change { text: change.get("text").and_then(Value::as_str).map(str::to_owned), done: change.get("done").and_then(Value::as_bool), due };
                    tasks.update(list, at, expect, change)
                }
                _ => Err("that cannot be changed".to_owned()),
            },
            "remove" => match (text(0), line(1), text(2)) {
                (Some(list), Some(at), Some(expect)) => tasks.remove(list, at, expect),
                _ => Err("that cannot be removed".to_owned()),
            },
            "clearDone" => text(0).ok_or_else(|| "a list is needed".to_owned()).and_then(|l| tasks.clear_done(l)),
            _ => return json!({ "ok": false, "message": "unknown" }),
        };
        match result {
            Ok(value) => {
                if method != "lists" && method != "read" {
                    let list = value.get("list").or_else(|| value.get("name")).cloned().unwrap_or(Value::Null);
                    (self.emit)("mobius:tasks-changed", json!({ "list": list, "by": "person" }));
                }
                value
            }
            Err(message) => json!({ "ok": false, "conflict": message == "changed elsewhere", "message": message }),
        }
    }

    /// Shows the calendars the accounts have now, and tells the window.
    fn refresh_mirrors(&self) {
        self.calendar.set_mirrors(self.calendar_accounts.mirrors(&self.calendar.local_calendars()));
        (self.emit)("mobius:calendar-changed", json!({ "calendar": null, "by": "another app" }));
    }

    /// The Mail app. Every answer is what was asked for or `{ ok: false, message }`. Sending is here, for the person's
    /// Send button; the agent has no tool for it.
    fn mail_call(&self, method: &str, args: &[Value]) -> Value {
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let m = &self.mail;
        let result = match method {
            "accounts" => Ok(m.accounts()),
            "connect" => {
                let a = args.first().cloned().unwrap_or(Value::Null);
                let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
                let port = |k: &str| a.get(k).and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok());
                let (ih, sh) = (s("imapHost"), s("smtpHost"));
                let imap = port("imapPort").filter(|_| !ih.is_empty()).map(|p| (ih.as_str(), p));
                let smtp = port("smtpPort").filter(|_| !sh.is_empty()).map(|p| (sh.as_str(), p));
                m.connect(&s("preset"), &s("email"), &s("password"), imap, smtp)
            }
            "removeAccount" => text(0).ok_or_else(|| "an account is needed".to_owned()).and_then(|id| m.remove(id)),
            "sync" => {
                m.sync(text(0));
                Ok(m.accounts())
            }
            "list" => Ok(m.list(text(0).unwrap_or("inbox"), text(1).unwrap_or("all"), text(2).unwrap_or(""), 300)),
            "counts" => Ok(m.counts()),
            "read" => text(0).ok_or_else(|| "a message is needed".to_owned()).and_then(|id| m.read(id, true)),
            "flag" => match (text(0), text(1), args.get(2).and_then(Value::as_bool)) {
                (Some(id), Some(which), Some(on)) => m.flag(id, which, on),
                _ => Err("that cannot be done".to_owned()),
            },
            "sort" => match (text(0), text(1)) {
                (Some(id), Some(c)) => m.sort(id, c),
                _ => Err("that cannot be done".to_owned()),
            },
            "drafts" => Ok(m.drafts()),
            "saveDraft" => m.save_draft(args.first().unwrap_or(&Value::Null), "you"),
            "deleteDraft" => text(0).ok_or_else(|| "a draft is needed".to_owned()).and_then(|id| m.delete_draft(id)),
            "send" => text(0).ok_or_else(|| "a draft is needed".to_owned()).and_then(|id| m.send(id)),
            _ => return json!({ "ok": false, "message": "unknown" }),
        };
        match result {
            Ok(value) => {
                if !matches!(method, "accounts" | "list" | "counts" | "drafts" | "read") {
                    (self.emit)("mobius:mail-changed", json!({ "by": "person" }));
                }
                value
            }
            Err(message) => json!({ "ok": false, "message": message }),
        }
    }

    /// The Sheets app. Every answer is the sheet as it is now (typed and worked out) or `{ ok: false, message }`; a
    /// change to a sheet that changed meanwhile also says `conflict: true`, so the window reloads it.
    fn sheets_call(&self, method: &str, args: &[Value]) -> Value {
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let num = |i: usize| args.get(i).and_then(Value::as_u64).and_then(|n| usize::try_from(n).ok());
        let s = &self.sheets;
        let result = match method {
            "list" => s.list(),
            "read" => match (text(0), text(1)) {
                (Some(w), Some(sh)) => s.read(w, sh),
                _ => Err("a workbook and a sheet are needed".to_owned()),
            },
            "set" => match (text(0), text(1), args.get(2).and_then(Value::as_array)) {
                (Some(w), Some(sh), Some(cells)) => {
                    let changes: Option<Vec<(usize, usize, String)>> = cells
                        .iter()
                        .map(|c| Some((usize::try_from(c.get("row")?.as_u64()?).ok()?, usize::try_from(c.get("col")?.as_u64()?).ok()?, c.get("text")?.as_str()?.to_owned())))
                        .collect();
                    changes.ok_or_else(|| "those cells cannot be set".to_owned()).and_then(|ch| s.set_cells(w, sh, &ch, text(3)))
                }
                _ => Err("those cells cannot be set".to_owned()),
            },
            "shift" => match (text(0), text(1), text(2), num(3), args.get(4).and_then(Value::as_bool)) {
                (Some(w), Some(sh), Some(what), Some(at), Some(insert)) => s.shift(w, sh, what, at, insert),
                _ => Err("that cannot be done".to_owned()),
            },
            "createWorkbook" => text(0).ok_or_else(|| "a name is needed".to_owned()).and_then(|n| s.create_workbook(n)),
            "addSheet" => match (text(0), text(1)) {
                (Some(w), Some(n)) => s.add_sheet(w, n),
                _ => Err("a workbook and a name are needed".to_owned()),
            },
            "renameSheet" => match (text(0), text(1), text(2)) {
                (Some(w), Some(sh), Some(n)) => s.rename_sheet(w, sh, n),
                _ => Err("a name is needed".to_owned()),
            },
            "removeSheet" => match (text(0), text(1)) {
                (Some(w), Some(sh)) => s.remove_sheet(w, sh),
                _ => Err("a sheet is needed".to_owned()),
            },
            _ => return json!({ "ok": false, "message": "unknown" }),
        };
        match result {
            Ok(value) => {
                if !matches!(method, "list" | "read") {
                    let workbook = value.get("workbook").or_else(|| value.get("name")).cloned().unwrap_or(Value::Null);
                    (self.emit)("mobius:sheets-changed", json!({ "workbook": workbook, "by": "person" }));
                }
                value
            }
            Err(message) => json!({ "ok": false, "conflict": message == "changed elsewhere", "message": message }),
        }
    }

    /// The Calendar app. Every answer is what was asked for or `{ ok: false, message }`.
    fn calendar_call(&self, method: &str, args: &[Value]) -> Value {
        use mobius_workspace::calendar::Draft;
        let text = |i: usize| args.get(i).and_then(Value::as_str);
        let cal = &self.calendar;
        let draft = || Draft::from_json(args.get(1).unwrap_or(&Value::Null));
        let accounts = &self.calendar_accounts;
        let changed_accounts = |result: Result<Value, String>| {
            if result.is_ok() {
                self.refresh_mirrors();
            }
            result
        };
        let result = match method {
            "calendars" => Ok(json!(cal.calendars())),
            "sources" => Ok(cal.sources()),
            "suggestions" => Ok(cal.suggestions()),
            "accept" => text(0).ok_or_else(|| "a suggestion is needed".to_owned()).and_then(|id| cal.accept(id)),
            "decline" => text(0).ok_or_else(|| "a suggestion is needed".to_owned()).and_then(|id| cal.decline(id)),
            "accounts" => Ok(accounts.list()),
            "subscribe" => match (text(0), text(1)) {
                (Some(name), Some(link)) => changed_accounts(accounts.subscribe(name, link)),
                _ => Err("a name and a link are needed".to_owned()),
            },
            "connect" => {
                let field = |k: &str| args.first().and_then(|a| a.get(k)).and_then(Value::as_str).unwrap_or("");
                changed_accounts(accounts.connect(field("name"), field("server"), field("username"), field("password")))
            }
            "removeAccount" => text(0).ok_or_else(|| "an account is needed".to_owned()).and_then(|id| changed_accounts(accounts.remove(id))),
            "sync" => {
                accounts.sync(text(0));
                self.refresh_mirrors();
                Ok(accounts.list())
            }
            "events" => match (text(0), text(1)) {
                (Some(from), Some(to)) => cal.events(from, to),
                _ => Err("two days are needed".to_owned()),
            },
            "create" => text(0).ok_or_else(|| "a name is needed".to_owned()).and_then(|n| cal.create(n)),
            "add" => text(0).ok_or_else(|| "a calendar is needed".to_owned()).and_then(|c| cal.add(c, &draft())),
            "update" => match (text(0), args.get(1).and_then(|d| d.get("id")).and_then(Value::as_str)) {
                (Some(c), Some(id)) => cal.update(c, id, &draft()),
                _ => Err("that cannot be changed".to_owned()),
            },
            "remove" => match (text(0), text(1)) {
                (Some(c), Some(id)) => cal.remove(c, id),
                _ => Err("that cannot be removed".to_owned()),
            },
            _ => return json!({ "ok": false, "message": "unknown" }),
        };
        match result {
            Ok(value) => {
                if !matches!(method, "calendars" | "events" | "sources" | "suggestions" | "accounts" | "subscribe" | "connect" | "removeAccount" | "sync") {
                    let name = value.get("calendar").or_else(|| value.get("name")).cloned().unwrap_or(Value::Null);
                    (self.emit)("mobius:calendar-changed", json!({ "calendar": name, "by": "person" }));
                }
                value
            }
            Err(message) => json!({ "ok": false, "message": message }),
        }
    }

    /// Which MCP servers are running, which failed to start and why (for the settings page).
    pub fn mcp_status(&self) -> Value {
        self.mcp.status()
    }

    /// What the last agent turn of a conversation changed in the workspace, and putting it back.
    fn changes_call(&self, method: &str, args: &[Value]) -> Out {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        let Some(conversation) = arg(0).as_str().filter(|c| is_conversation_id(c)) else {
            return Ok(failed("That conversation is not known."));
        };
        let mark = lock(&self.turn_marks).get(conversation).cloned();
        let Some(mark) = mark else {
            return Ok(match method {
                "lastTurn" => json!({ "checkpoint": null, "files": [] }),
                _ => failed("There is nothing to undo."),
            });
        };
        // Open pages and lists reload with what was put back; `undo` adds no new marks.
        let reload = |path: Option<&str>| {
            let note = path.and_then(|p| p.strip_prefix("notes/"));
            let list = path.and_then(|p| p.strip_prefix("tasks/")).and_then(|p| p.strip_suffix(".md"));
            (self.emit)("mobius:notes-changed", json!({ "path": note, "by": "undo" }));
            (self.emit)("mobius:docs-changed", json!({ "path": path.and_then(|p| p.strip_prefix("docs/")), "by": "undo" }));
            (self.emit)("mobius:sheets-changed", json!({ "workbook": path.and_then(|p| p.strip_prefix("sheets/")).and_then(|p| p.split('/').next()), "by": "undo" }));
            (self.emit)("mobius:tasks-changed", json!({ "list": list, "by": "undo" }));
            if path.is_none_or(|p| p.starts_with("calendar/")) {
                (self.emit)("mobius:calendar-changed", json!({ "calendar": path.and_then(|p| p.strip_prefix("calendar/")).and_then(|p| p.strip_suffix(".ics")), "by": "undo" }));
            }
        };
        Ok(match method {
            "lastTurn" => match self.workspace.changed_since(&mark) {
                Ok(files) => json!({ "checkpoint": mark, "files": files }),
                Err(e) => failed(e),
            },
            "undo" => match self.workspace.restore(&mark) {
                Ok(()) => {
                    reload(None);
                    json!({ "ok": true })
                }
                Err(e) => failed(e),
            },
            // The file as it was before the turn, to show what changed. `null` when the turn made it.
            "before" => match arg(1).as_str() {
                Some(path) => match self.workspace.read_at(&mark, path) {
                    Ok(text) => json!({ "ok": true, "text": text }),
                    Err(e) => failed(e),
                },
                None => failed("Which file?"),
            },
            "undoFile" => match arg(1).as_str() {
                Some(path) => match self.workspace.restore_file(&mark, path) {
                    Ok(()) => {
                        reload(Some(path));
                        json!({ "ok": true })
                    }
                    Err(e) => failed(e),
                },
                None => failed("Which file?"),
            },
            _ => return Err(BridgeError::NotAvailable(format!("changes.{method}"))),
        })
    }

    fn agent_call(&self, method: &str, args: &[Value]) -> Out {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        let conversation = || arg(0).as_str().filter(|c| is_conversation_id(c));
        let refused = || failed("That was not allowed.");
        Ok(match method {
            "getSettings" => self.agent.settings(),
            "configure" => match agent::parse_configure(arg(0)) {
                Some(request) => {
                    let result = self.agent.configure(&request);
                    (self.emit)("mobius:agent-settings", self.agent.settings());
                    result
                }
                None => failed("Those settings are not valid."),
            },
            "send" => {
                let mut request = json!({ "conversation": arg(0), "text": arg(1) });
                if !arg(2).is_null() {
                    request["context"] = arg(2).clone();
                }
                // The fourth argument is options: { plan: true } asks for a plan only.
                if let Some(plan) = arg(3).get("plan") {
                    request["plan"] = plan.clone();
                }
                match agent::parse_send(&request) {
                    Some(r) => {
                        // Saved before the turn starts, so everything it changes can be reviewed and undone at once.
                        match self.workspace.mark("before the agent's turn") {
                            Ok(Some(mark)) => {
                                let mut marks = lock(&self.turn_marks);
                                marks.insert(r.conversation.clone(), mark);
                                mobius_store::file::write_json(&self.data_dir.join("turn-marks.json"), &json!(*marks));
                            }
                            Ok(None) => {}
                            // The turn still goes ahead; it just cannot be reviewed or undone as one.
                            Err(error) => eprintln!("[changes] no mark before the turn: {error}"),
                        }
                        let bot = self.bot_for(&r.conversation);
                        self.agent.send_remembering(&r, bot.as_ref().map(|b| (b.instructions.as_str(), b.model.as_str())), &self.memory.instructions())
                    }
                    None => failed("That message cannot be sent."),
                }
            }
            "models" => self.agent.models(),
            "setModel" => match arg(0).as_str().filter(|m| is_model_name(m)) {
                Some(model) => {
                    let result = self.agent.set_model(model);
                    (self.emit)("mobius:agent-settings", self.agent.settings());
                    result
                }
                None => failed("That model cannot be used."),
            },
            "transcribe" => match agent::parse_recording(arg(0), arg(1)) {
                Some((bytes, mime)) => {
                    let model = self.preference("dictationModel");
                    self.agent.transcribe(&bytes, mime, model.as_str().unwrap_or("whisper-1"))
                }
                None => failed("That recording cannot be used."),
            },
            "cancel" => {
                if let Some(c) = conversation() {
                    self.agent.cancel(c);
                }
                Value::Null
            }
            "history" => conversation().map_or_else(|| json!([]), |c| self.agent.history(c)),
            "waiting" => conversation().map_or_else(|| json!([]), |c| self.agent.waiting(c)),
            "question" => conversation().map_or(Value::Null, |c| self.agent.question(c)),
            "answer" => match (conversation(), arg(1).as_str(), arg(2).as_str()) {
                (Some(c), Some(call_id), Some(text)) => self.agent.answer(c, call_id, text),
                _ => refused(),
            },
            "conversations" => self.agent.conversations(),
            "deleteConversation" => conversation().map_or_else(refused, |c| {
                let result = self.agent.delete_conversation(c);
                if result.get("ok") == Some(&Value::Bool(true)) {
                    lock(&self.archive).forget(c);
                }
                result
            }),
            "archive" => match (conversation(), arg(1).as_bool()) {
                (Some(c), Some(on)) => {
                    lock(&self.archive).set(c, on);
                    json!(lock(&self.archive).list())
                }
                _ => refused(),
            },
            "savedServers" => lock(&self.endpoints).list(),
            "saveServer" => match arg(0).as_str() {
                Some(name) => {
                    let (url, model, key) = self.agent.current_server();
                    match lock(&self.endpoints).save(name, &url, &model, key.as_deref()) {
                        Ok(_) => ok(json!({})),
                        Err(e) => failed(e),
                    }
                }
                None => refused(),
            },
            "useServer" => match arg(0).as_str().filter(|id| crate::endpoints::is_endpoint_id(id)).and_then(|id| lock(&self.endpoints).choose(id)) {
                Some(c) => {
                    let result = self.agent.switch_server(&c.base_url, &c.model, c.key);
                    (self.emit)("mobius:agent-settings", self.agent.settings());
                    result
                }
                None => failed("That saved server is not there any more."),
            },
            "removeServer" => match arg(0).as_str() {
                Some(id) if crate::endpoints::is_endpoint_id(id) => {
                    lock(&self.endpoints).remove(id);
                    ok(json!({}))
                }
                _ => refused(),
            },
            "archived" => json!(lock(&self.archive).list()),
            "rewind" => conversation().map_or_else(refused, |c| self.agent.rewind(c)),
            "grants" => self.agent.grants(),
            "revokeGrant" => arg(0).as_i64().filter(|n| *n >= 1).map_or_else(refused, |n| self.agent.revoke_grant(n)),
            "activity" => self.agent.activity(arg(0).as_u64().unwrap_or(50).clamp(1, 200)),
            "resolve" => {
                let duration = arg(2).as_str().filter(|d| ["once", "session", "always"].contains(d));
                match (arg(0).as_u64().filter(|n| *n >= 1), arg(1).as_bool(), duration) {
                    (Some(id), Some(approve), Some(duration)) => self.agent.resolve(id, approve, duration),
                    _ => refused(),
                }
            }
            _ => return Err(BridgeError::NotAvailable(format!("agent.{method} is not available in this build yet."))),
        })
    }

    /// The core changed state. When it is ready, tell it everything it forgets when it restarts.
    pub fn on_core_status(&self, status: Status) {
        lock(&self.status_history).push(status.word().to_owned());
        (self.emit)("mobius:core-status", json!(status.word()));
        if status == Status::Ready {
            let prefs = lock(&self.preferences).get();
            let _ = self.core.call("permissions.set_mode", json!({ "mode": prefs["approvalMode"] }), Duration::from_secs(5));
            let _ = self.core.call("permissions.set_rules", crate::access::rules(&prefs["appAccess"]), Duration::from_secs(5));
            let _ = self.core.call("agent.set_effort", json!({ "effort": prefs["reasoningEffort"] }), Duration::from_secs(5));
            self.register_tools();
            self.agent.apply();
            self.start_local_model_again();
        } else {
            self.agent.mark_stopped();
            if let Some(m) = self.models.get() {
                m.mark_stopped();
            }
        }
        (self.emit)("mobius:agent-settings", self.agent.settings());
    }

    /// A message from the core that is not an answer. Only well formed conversation progress reaches the window.
    pub fn on_core_notification(&self, method: &str, params: &Value) {
        if self.models.get().is_some_and(|m| m.handle_notification(method, params)) {
            return;
        }
        if let Some(n) = agent::parse_notification(method, params) {
            (self.emit)("mobius:agent-notification", n.clone());
            if let Some(awake) = lock(&self.keep_awake).as_mut() {
                awake.note(&n);
            }
            let prefs = lock(&self.preferences).get();
            if let Some(notice) = notify::decide_notice(&n, &prefs, self.focused()) {
                self.tell(&notice);
            }
        }
    }

    /// Test hook: set the model up without saving it.
    pub fn seed_agent(&self, request: &Value) -> Value {
        match agent::parse_configure(request) {
            Some(r) => {
                let result = self.agent.seed(&r);
                (self.emit)("mobius:agent-settings", self.agent.settings());
                result
            }
            None => failed("Those settings are not valid."),
        }
    }

    fn change(&self, store: &Mutex<Settings>, name: &str, change: &Value) -> Value {
        let mut s = lock(store);
        let before = s.get();
        if s.set(change) {
            let value = s.get();
            drop(s);
            if name == "preferences" {
                if before["approvalMode"] != value["approvalMode"] {
                    let _ = self.core.call("permissions.set_mode", json!({ "mode": value["approvalMode"] }), Duration::from_secs(5));
                }
                if before["appAccess"] != value["appAccess"] {
                    let _ = self.core.call("permissions.set_rules", crate::access::rules(&value["appAccess"]), Duration::from_secs(5));
                }
                if before["keepAwake"] != value["keepAwake"]
                    && let Some(awake) = lock(&self.keep_awake).as_mut()
                {
                    awake.set_enabled(value["keepAwake"].as_bool().unwrap_or(false));
                }
                if before.pointer("/keybindings/quickEntry") != value.pointer("/keybindings/quickEntry")
                    && let Some(quick) = lock(&self.quick).as_mut()
                {
                    quick.set(value.pointer("/keybindings/quickEntry").and_then(Value::as_str).unwrap_or(""));
                }
                if before["reasoningEffort"] != value["reasoningEffort"] {
                    let _ = self.core.call("agent.set_effort", json!({ "effort": value["reasoningEffort"] }), Duration::from_secs(5));
                }
            }
            (self.emit)(&format!("mobius:{name}-changed"), value.clone());
            value
        } else {
            s.get()
        }
    }

    /// Runs `act` with a plausible address (a string of at most 2048 characters) and tells the interface.
    fn with_url(&self, v: &Value, act: impl FnOnce(&str), event: &str) -> Value {
        if let Some(url) = v.as_str().filter(|u| u.len() <= 2048) {
            act(url);
            (self.emit)(&format!("mobius:{event}"), Value::Null);
        }
        Value::Null
    }

    fn bots_state(&self) -> Value {
        json!({ "bots": lock(&self.bots).all().iter().map(bots::Bot::to_json).collect::<Vec<_>>() })
    }

    fn announce_bots(&self) {
        (self.emit)("mobius:bots-changed", self.bots_state());
    }

    fn bot_result(&self, result: Result<bots::Bot, String>) -> Value {
        match result {
            Ok(bot) => {
                self.announce_bots();
                ok(json!({ "bot": bot.to_json() }))
            }
            Err(e) => failed(e),
        }
    }

    /// Removes the bot and every conversation it had.
    fn remove_bot(&self, id: &str) -> Value {
        if id == MAIN_ID || !bots::is_bot_id(id) {
            return failed(if id == MAIN_ID { "Mobius cannot be removed." } else { "That bot is not there any more." });
        }
        if lock(&self.bots).get(id).is_none() {
            return failed("That bot is not there any more.");
        }
        let mut removed = 0;
        let rows = self.core.call("agent.conversations", json!({}), Duration::from_secs(5)).ok();
        for row in rows.as_ref().and_then(Value::as_array).into_iter().flatten() {
            let Some(conversation) = row.get("id").and_then(Value::as_str) else { continue };
            if bots::bot_of_conversation(conversation, [id]) != id {
                continue;
            }
            let _ = self.core.call("agent.cancel", json!({ "conversation": conversation }), Duration::from_secs(5));
            if self.core.call("agent.delete", json!({ "conversation": conversation }), Duration::from_secs(5)).is_ok() {
                removed += 1;
            }
        }
        let result = lock(&self.bots).remove(id);
        match result {
            Ok(()) => {
                self.announce_bots();
                ok(json!({ "removedSessions": removed }))
            }
            Err(e) => failed(e),
        }
    }

    /// The bot a conversation belongs to, for the instructions and model it should use.
    pub fn bot_for(&self, conversation: &str) -> Option<bots::Bot> {
        let b = lock(&self.bots);
        let id = bots::bot_of_conversation(conversation, b.all().iter().map(|x| x.id.as_str()));
        if id == MAIN_ID { None } else { b.get(&id).cloned() }
    }

    /// The visited page is remembered (if history is on).
    pub fn visit(&self, url: &str, title: &str) {
        lock(&self.history).visit(url, title);
        (self.emit)("mobius:history-changed", Value::Null);
    }

    pub fn preference(&self, name: &str) -> Value {
        lock(&self.preferences).get().get(name).cloned().unwrap_or(Value::Null)
    }

    fn about(&self) -> Value {
        let core = self
            .core
            .call("core.ping", json!({}), Duration::from_secs(2))
            .ok()
            .and_then(|p| Some(json!({ "version": p.get("version")?.as_str()?, "protocol": p.get("protocol")?.as_u64()? })));
        json!({
            "app": env!("CARGO_PKG_VERSION"),
            "engine": self.engine.get().map_or("unknown", String::as_str),
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "core": core,
            "dataFolder": self.data_dir.display().to_string(),
        })
    }
}
