//! Finding, downloading and running models. The work happens in the core; this keeps the window from ever naming a file or a
//! program, waits for the core's background jobs, and points the agent at a model once it has loaded.
use std::collections::HashMap;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{Map, Value, json};

use crate::process::{CallError, CoreProcess};

const CORE_UNREACHABLE: &str = "Mobius cannot reach its core right now.";
const RESULTS: u64 = 12;
const EARLY_RESULTS: usize = 16;
const FITS: [&str; 4] = ["gpu", "split", "cpu", "too_big"];

pub const CONTEXT_SIZES: [u64; 5] = [4096, 8192, 16384, 32768, 65536];

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// A context size from the list as `Some(Some(size))`, `Some(None)` for "the default", or `None` when it is not acceptable.
pub fn parse_context_size(v: &Value) -> Option<Option<u64>> {
    match v {
        Value::Null => Some(None),
        Value::Number(n) => n.as_u64().filter(|c| CONTEXT_SIZES.contains(c)).map(Some),
        _ => None,
    }
}

pub fn parse_model_id(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty() && s.chars().count() <= 1000 && !s.contains('\0')).map(str::to_owned)
}

/// A repository and a file in it, as the window may name them. The core checks them again.
pub fn parse_download_request(repo: &Value, file: &Value) -> Option<(String, String)> {
    let (repo, file) = (repo.as_str()?, file.as_str()?);
    let part_ok = |p: &str| !p.is_empty() && p.len() <= 96 && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    let mut parts = repo.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    if parts.next().is_some() || !part_ok(owner) || !part_ok(name) || owner == "." || owner == ".." || name == "." || name == ".." {
        return None;
    }
    if file.is_empty() || file.chars().count() > 400 || !file.to_lowercase().ends_with(".gguf") || file.contains(['\\', ':', '\0']) || file.starts_with('/') || file.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return None;
    }
    Some((repo.to_owned(), file.to_owned()))
}

pub fn parse_search_query(v: &Value) -> Option<String> {
    match v {
        Value::Null => Some(String::new()),
        Value::String(s) if s.chars().count() <= 100 => Some(s.trim().to_owned()),
        _ => None,
    }
}

fn num(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).is_some_and(f64::is_finite)
}

fn is_assessment(v: Option<&Value>) -> bool {
    v.is_some_and(|a| a.get("fit").and_then(Value::as_str).is_some_and(|f| FITS.contains(&f)) && num(a.get("needed")) && num(a.get("gpu_fraction")))
}

fn as_recommendation(v: &Value) -> bool {
    let Some(c) = v.get("candidate").filter(|c| c.is_object()) else { return false };
    let s = |k: &str| c.get(k).is_some_and(Value::is_string);
    s("repo") && s("file") && s("quant") && num(c.get("size")) && num(c.get("downloads")) && num(c.get("likes")) && is_assessment(v.get("assessment")) && num(v.get("params_b")) && num(v.get("score")) && num(v.get("quality"))
}

fn as_local(v: &Value) -> bool {
    let Some(m) = v.get("model").filter(|m| m.is_object()) else { return false };
    let s = |k: &str| m.get(k).is_some_and(Value::is_string);
    is_assessment(v.get("assessment")) && s("id") && s("file") && s("path") && num(m.get("size"))
}

fn as_hardware(v: &Value) -> bool {
    ["vram_total", "vram_free", "ram_total", "ram_free"].iter().all(|k| num(v.get(*k)))
}

/// The runtime as the window sees it, or none when the core's answer is not one.
fn as_runtime(v: &Value) -> Option<Map<String, Value>> {
    let state = v.get("state")?.as_str().filter(|s| ["starting", "ready", "failed", "stopped"].contains(s))?;
    let (model_id, model, base_url) = (v.get("model_id")?.as_str()?, v.get("model")?.as_str()?, v.get("base_url")?.as_str()?);
    let log: Vec<Value> = v.get("log").and_then(Value::as_array).map(|l| l.iter().filter(|x| x.is_string()).cloned().collect::<Vec<_>>()).unwrap_or_default();
    let tail = log.len().saturating_sub(30);
    let mut m = Map::new();
    m.insert("state".into(), json!(state));
    m.insert("reason".into(), v.get("reason").filter(|r| r.is_string()).cloned().unwrap_or(Value::Null));
    m.insert("modelId".into(), json!(model_id));
    m.insert("model".into(), json!(model));
    m.insert("baseUrl".into(), json!(base_url));
    m.insert("log".into(), Value::Array(log[tail..].to_vec()));
    m.insert("usingForAssistant".into(), json!(false));
    Some(m)
}

/// The engine status as the window sees it, or none when the core's answer is not one.
fn as_engine(v: &Value) -> Option<Value> {
    let text = |x: &Value, k: &str| x.get(k).and_then(Value::as_str).filter(|s| s.chars().count() <= 300).map(str::to_owned);
    let recommended = v.get("recommended")?;
    let installed = match v.get("installed") {
        None | Some(Value::Null) => Value::Null,
        Some(i) => {
            let devices: Vec<String> = i.get("devices")?.as_array()?.iter().filter_map(|d| d.as_str().map(|s| s.chars().take(200).collect())).take(16).collect();
            json!({ "tag": text(i, "tag")?, "label": text(i, "label")?, "devices": devices })
        }
    };
    let using = match v.get("using") {
        None | Some(Value::Null) => Value::Null,
        Some(u) => {
            let source = text(u, "source").filter(|s| ["setting", "mobius", "found"].contains(&s.as_str()))?;
            json!({ "source": source, "path": text(u, "path")? })
        }
    };
    Some(json!({
        "supported": v.get("supported")?.as_bool()?,
        "recommended": text(recommended, "label")?,
        "installed": installed,
        "using": using,
        "installing": v.get("installing").is_some_and(Value::is_string),
    }))
}

type JobResult = Result<Value, String>;

#[derive(Default)]
struct State {
    waiting: HashMap<String, Sender<JobResult>>,
    early: Vec<(String, JobResult)>,
    download_job: Option<String>,
    /// A download has been asked for and not finished (its job may not be known yet: progress can arrive before the answer is read).
    downloading: bool,
    engine_job: Option<String>,
    installing_engine: bool,
    watch_token: u64,
    last_runtime: Option<Value>,
    configured_for: Option<String>,
    configure_problem: Option<String>,
}

pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;
pub type UseForAssistant = Arc<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync>;

pub struct Models {
    core: Arc<CoreProcess>,
    emit: Emit,
    use_for_assistant: UseForAssistant,
    poll: Duration,
    job_timeout: Duration,
    state: Mutex<State>,
}

impl Models {
    pub fn new(core: Arc<CoreProcess>, emit: Emit, use_for_assistant: UseForAssistant) -> Arc<Models> {
        Models::with_timing(core, emit, use_for_assistant, Duration::from_secs(1), Duration::from_secs(120))
    }

    pub fn with_timing(core: Arc<CoreProcess>, emit: Emit, use_for_assistant: UseForAssistant, poll: Duration, job_timeout: Duration) -> Arc<Models> {
        Arc::new(Models { core, emit, use_for_assistant, poll, job_timeout, state: Mutex::new(State::default()) })
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        self.core.call(method, params, Duration::from_secs(30))
    }

    fn describe(error: &CallError) -> String {
        match error {
            CallError::Rpc(r) => r.message.clone(),
            _ => CORE_UNREACHABLE.to_owned(),
        }
    }

    /// Messages from the core. Returns whether this service wanted it.
    pub fn handle_notification(&self, method: &str, params: &Value) -> bool {
        let Some(job) = params.get("job").and_then(Value::as_str) else { return false };
        match method {
            "models.progress" => {
                let done = params.get("done").and_then(Value::as_f64);
                let total = params.get("total").and_then(Value::as_f64);
                let (download, engine) = {
                    let s = lock(&self.state);
                    let engine = s.installing_engine && s.engine_job.as_deref().is_none_or(|j| j == job);
                    (!engine && s.downloading && s.download_job.as_deref().is_none_or(|j| j == job), engine)
                };
                if let (Some(done), Some(total)) = (done, total) {
                    if download {
                        (self.emit)(json!({ "kind": "progress", "job": job, "done": done, "total": total }));
                    } else if engine {
                        (self.emit)(json!({ "kind": "engine", "state": "progress", "done": done, "total": total }));
                    }
                }
                true
            }
            "models.job" => {
                let result: JobResult = if params.get("ok") == Some(&Value::Bool(true)) {
                    Ok(params.get("result").cloned().unwrap_or(Value::Null))
                } else {
                    Err(params.get("error").and_then(Value::as_str).unwrap_or("It did not work.").to_owned())
                };
                let mut s = lock(&self.state);
                if let Some(waiter) = s.waiting.remove(job) {
                    let _ = waiter.send(result);
                } else {
                    // The result can get here before the answer to the request that started the job has been looked at.
                    s.early.push((job.to_owned(), result));
                    if s.early.len() > EARLY_RESULTS {
                        let _ = s.early.remove(0);
                    }
                }
                true
            }
            _ => false,
        }
    }

    pub fn hardware(&self) -> Value {
        match self.call("models.hardware", json!({})) {
            Ok(v) if as_hardware(&v) => v,
            _ => Value::Null,
        }
    }

    pub fn local(&self) -> Value {
        match self.call("models.local", json!({})) {
            Ok(Value::Array(rows)) => Value::Array(rows.into_iter().filter(as_local).collect()),
            _ => json!([]),
        }
    }

    pub fn status(&self) -> Value {
        match self.call("models.status", json!({})) {
            Ok(raw) => self.snapshot(&raw),
            Err(_) => json!({ "binary": null, "runtime": null }),
        }
    }

    pub fn discover(&self, query: &Value) -> Value {
        let Some(text) = parse_search_query(query) else { return json!({ "ok": false, "error": "That search is too long." }) };
        match self.run_job("models.discover", json!({ "query": text, "limit": RESULTS }), self.job_timeout, "The search took too long.", |_| {}) {
            Ok(result) => {
                let rows = result.as_array().cloned().unwrap_or_default();
                json!({ "ok": true, "results": rows.into_iter().filter(as_recommendation).collect::<Vec<_>>() })
            }
            Err(error) => json!({ "ok": false, "error": error }),
        }
    }

    pub fn download(&self, repo: &Value, file: &Value) -> Value {
        let Some((repo, file)) = parse_download_request(repo, file) else { return json!({ "ok": false, "error": "That is not a model file Mobius can download." }) };
        lock(&self.state).downloading = true;
        (self.emit)(json!({ "kind": "download", "state": "started", "repo": repo, "file": file }));
        let outcome = self.run_job("models.download", json!({ "repo": repo, "file": file }), Duration::from_secs(24 * 60 * 60), "The download took too long.", |job| {
            lock(&self.state).download_job = Some(job.to_owned());
        });
        {
            let mut s = lock(&self.state);
            s.download_job = None;
            s.downloading = false;
        }
        match outcome {
            Ok(_) => {
                (self.emit)(json!({ "kind": "download", "state": "finished", "repo": repo, "file": file }));
                json!({ "ok": true })
            }
            Err(error) => {
                (self.emit)(json!({ "kind": "download", "state": "failed", "repo": repo, "file": file, "error": error }));
                json!({ "ok": false, "error": error })
            }
        }
    }

    pub fn cancel_download(&self) {
        let job = lock(&self.state).download_job.clone();
        if let Some(job) = job {
            let _ = self.call("models.cancel", json!({ "job": job })); // It may just have finished.
        }
    }

    /// The llama.cpp engine: what is used, what Mobius installed, and what it would install. Checked field by field.
    pub fn engine(&self) -> Value {
        let Ok(raw) = self.call("models.engine", json!({})) else { return Value::Null };
        as_engine(&raw).unwrap_or(Value::Null)
    }

    /// Install or update Mobius's own engine. Resolves when it is done; progress arrives as `engine` events.
    pub fn install_engine(&self) -> Value {
        lock(&self.state).installing_engine = true;
        (self.emit)(json!({ "kind": "engine", "state": "started" }));
        let outcome = self.run_job("models.install_engine", json!({}), Duration::from_secs(6 * 60 * 60), "Installing the engine took too long.", |job| {
            lock(&self.state).engine_job = Some(job.to_owned());
        });
        {
            let mut s = lock(&self.state);
            s.engine_job = None;
            s.installing_engine = false;
        }
        match outcome {
            Ok(result) => {
                let up_to_date = result.get("up_to_date") == Some(&Value::Bool(true));
                (self.emit)(json!({ "kind": "engine", "state": "finished" }));
                json!({ "ok": true, "upToDate": up_to_date })
            }
            Err(error) => {
                (self.emit)(json!({ "kind": "engine", "state": "failed", "error": error }));
                json!({ "ok": false, "error": error })
            }
        }
    }

    pub fn cancel_engine(&self) {
        let job = lock(&self.state).engine_job.clone();
        if let Some(job) = job {
            let _ = self.call("models.cancel", json!({ "job": job }));
        }
    }

    pub fn start(self: &Arc<Self>, id: &Value, context: &Value) -> Value {
        let Some(model_id) = parse_model_id(id) else { return json!({ "ok": false, "error": "That is not a model on this computer." }) };
        let Some(size) = parse_context_size(context) else { return json!({ "ok": false, "error": "That context size is not one Mobius offers." }) };
        self.stop_watching();
        let params = match size {
            Some(c) => json!({ "id": model_id, "context": c }),
            None => json!({ "id": model_id }),
        };
        let started = match self.call("models.start", params) {
            Ok(v) => v,
            Err(e) => return json!({ "ok": false, "error": Self::describe(&e) }),
        };
        let (Some(base_url), Some(model)) = (started.get("base_url").and_then(Value::as_str), started.get("model").and_then(Value::as_str)) else {
            return json!({ "ok": false, "error": "The core gave an answer Mobius could not read." });
        };
        {
            let mut s = lock(&self.state);
            s.configured_for = None;
            s.configure_problem = None;
        }
        self.watching(base_url.to_owned(), model.to_owned());
        json!({ "ok": true })
    }

    pub fn stop(&self) -> Value {
        self.stop_watching();
        if let Err(e) = self.call("models.stop", json!({})) {
            return json!({ "ok": false, "error": Self::describe(&e) });
        }
        lock(&self.state).last_runtime = None;
        (self.emit)(json!({ "kind": "runtime", "snapshot": self.status() }));
        json!({ "ok": true })
    }

    /// The core has gone away, and with it the model it was running.
    pub fn mark_stopped(&self) {
        self.stop_watching();
        let had = {
            let mut s = lock(&self.state);
            s.configured_for = None;
            s.last_runtime.take().is_some()
        };
        if had {
            (self.emit)(json!({ "kind": "runtime", "snapshot": { "binary": null, "runtime": null } }));
        }
    }

    // ---- internals -------------------------------------------------------------------------------------------

    fn snapshot(&self, raw: &Value) -> Value {
        if !raw.is_object() {
            return json!({ "binary": null, "runtime": null });
        }
        let binary = raw.get("binary").filter(|b| b.is_string()).cloned().unwrap_or(Value::Null);
        let runtime = raw.get("runtime").and_then(as_runtime).map(|mut r| {
            let s = lock(&self.state);
            let base = r.get("baseUrl").and_then(Value::as_str).unwrap_or("").to_owned();
            let using = s.configured_for.as_deref() == Some(base.as_str());
            r.insert("usingForAssistant".into(), json!(using));
            if r.get("state") == Some(&json!("ready")) && !using && let Some(problem) = &s.configure_problem {
                r.insert("reason".into(), json!(problem));
            }
            Value::Object(r)
        });
        json!({ "binary": binary, "runtime": runtime })
    }

    fn run_job(&self, method: &str, params: Value, timeout: Duration, timeout_message: &str, on_job: impl FnOnce(&str)) -> Result<Value, String> {
        let started = self.call(method, params).map_err(|e| Self::describe(&e))?;
        let job = started.get("job").and_then(Value::as_str).ok_or("The core gave an answer Mobius could not read.")?.to_owned();
        on_job(&job);
        let (tx, rx) = channel();
        {
            let mut s = lock(&self.state);
            if let Some(at) = s.early.iter().position(|(j, _)| *j == job) {
                return s.early.remove(at).1;
            }
            s.waiting.insert(job.clone(), tx);
        }
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                lock(&self.state).waiting.remove(&job);
                Err(timeout_message.to_owned())
            }
        }
    }

    fn stop_watching(&self) {
        lock(&self.state).watch_token += 1;
    }

    /// Look at the model until it has loaded (or failed), telling the window each time something changes.
    fn watching(self: &Arc<Self>, base_url: String, model: String) {
        let token = {
            let mut s = lock(&self.state);
            s.watch_token += 1;
            s.watch_token
        };
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            loop {
                if lock(&me.state).watch_token != token {
                    return;
                }
                let raw = me.call("models.status", json!({})).unwrap_or(Value::Null);
                if lock(&me.state).watch_token != token {
                    return;
                }
                let runtime = raw.get("runtime").and_then(as_runtime);
                let state = runtime.as_ref().and_then(|r| r.get("state")).and_then(Value::as_str).unwrap_or("").to_owned();
                let (configured, problem) = {
                    let s = lock(&me.state);
                    (s.configured_for.as_deref() == Some(base_url.as_str()), s.configure_problem.is_some())
                };
                if state == "ready" && !configured && !problem {
                    let result = (me.use_for_assistant)(&base_url, &model);
                    if lock(&me.state).watch_token != token {
                        return;
                    }
                    let mut s = lock(&me.state);
                    match result {
                        Ok(()) => s.configured_for = Some(base_url.clone()),
                        Err(e) => s.configure_problem = Some(if e.is_empty() { "The agent could not be set up.".to_owned() } else { e }),
                    }
                }
                let snapshot = me.snapshot(&raw);
                lock(&me.state).last_runtime = snapshot.get("runtime").filter(|r| !r.is_null()).cloned();
                (me.emit)(json!({ "kind": "runtime", "snapshot": snapshot }));
                // Look often while it loads, and now and then afterwards, so a server that dies later is noticed.
                let wait = match state.as_str() {
                    "starting" => me.poll,
                    "ready" => me.poll * 5,
                    _ => return,
                };
                std::thread::sleep(wait);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_sizes_are_from_the_list_or_the_default() {
        assert_eq!(parse_context_size(&Value::Null), Some(None));
        assert_eq!(parse_context_size(&json!(16384)), Some(Some(16384)));
        for bad in [json!(1000), json!("8192"), json!(-1), json!(8192.5), json!(true)] {
            assert_eq!(parse_context_size(&bad), None, "{bad}");
        }
    }

    #[test]
    fn a_model_id_is_text_of_reasonable_length_without_a_null_byte() {
        assert_eq!(parse_model_id(&json!("m1")).as_deref(), Some("m1"));
        for bad in [json!(""), json!(5), json!("a\0b"), json!("x".repeat(1001)), Value::Null] {
            assert_eq!(parse_model_id(&bad), None, "{bad}");
        }
    }

    #[test]
    fn a_download_names_a_repository_and_a_gguf_file_inside_it_and_nothing_that_climbs_out() {
        assert_eq!(parse_download_request(&json!("acme/Tiny-1B-GGUF"), &json!("Tiny.Q4_K_M.GGUF")), Some(("acme/Tiny-1B-GGUF".into(), "Tiny.Q4_K_M.GGUF".into())));
        assert!(parse_download_request(&json!("acme/x"), &json!("sub/dir/m.gguf")).is_some());
        for (repo, file) in [
            ("acme", "a.gguf"), ("a/b/c", "a.gguf"), ("../x", "a.gguf"), ("a/..", "a.gguf"), ("a b/c", "a.gguf"), ("acme/x", "a.bin"), ("acme/x", "../a.gguf"), ("acme/x", "/a.gguf"),
            ("acme/x", "a\\b.gguf"), ("acme/x", "c:a.gguf"), ("acme/x", "a//b.gguf"), ("acme/x", "./a.gguf"), ("acme/x", ""),
        ] {
            assert_eq!(parse_download_request(&json!(repo), &json!(file)), None, "{repo} {file}");
        }
        assert_eq!(parse_download_request(&json!(5), &json!("a.gguf")), None);
        assert_eq!(parse_download_request(&json!("acme/x"), &json!(5)), None);
        assert_eq!(parse_download_request(&json!("acme/x"), &json!(format!("{}.gguf", "a".repeat(400)))), None);
    }

    #[test]
    fn a_search_is_trimmed_short_text_or_nothing() {
        assert_eq!(parse_search_query(&Value::Null).as_deref(), Some(""));
        assert_eq!(parse_search_query(&json!("  coder ")).as_deref(), Some("coder"));
        assert_eq!(parse_search_query(&json!("x".repeat(101))), None);
        assert_eq!(parse_search_query(&json!(5)), None);
    }

    #[test]
    fn what_the_core_returns_is_checked_before_the_window_sees_it() {
        let a = json!({ "fit": "gpu", "needed": 1.0, "gpu_fraction": 1.0 });
        assert!(as_local(&json!({ "model": { "id": "m", "file": "f", "path": "p", "size": 3 }, "assessment": a })));
        assert!(!as_local(&json!({ "model": { "id": "m", "file": "f", "path": "p", "size": 3 }, "assessment": { "fit": "magic", "needed": 1, "gpu_fraction": 1 } })));
        assert!(!as_local(&json!({ "model": { "id": 5 }, "assessment": a })));
        assert!(as_hardware(&json!({ "vram_total": 1, "vram_free": 1, "ram_total": 1, "ram_free": 1 })));
        assert!(!as_hardware(&json!({ "vram_total": 1 })));
        let rec = json!({ "candidate": { "repo": "a/b", "file": "f", "quant": "Q4", "size": 1, "downloads": 1, "likes": 1 }, "assessment": a, "params_b": 1, "score": 1, "quality": 1 });
        assert!(as_recommendation(&rec));
        assert!(!as_recommendation(&json!({ "candidate": {}, "assessment": a })));
    }

    #[test]
    fn the_engine_status_is_checked_before_the_window_sees_it() {
        let raw = json!({ "supported": true, "recommended": { "backend": "cuda12", "label": "NVIDIA (CUDA 12)" }, "installed": { "tag": "b1", "backend": "cuda12", "label": "NVIDIA (CUDA 12)", "devices": ["CUDA0: x", 5] }, "using": { "source": "mobius", "path": "C:/d/engine/b1/llama-server.exe" }, "installing": null });
        assert_eq!(as_engine(&raw).unwrap(), json!({ "supported": true, "recommended": "NVIDIA (CUDA 12)", "installed": { "tag": "b1", "label": "NVIDIA (CUDA 12)", "devices": ["CUDA0: x"] }, "using": { "source": "mobius", "path": "C:/d/engine/b1/llama-server.exe" }, "installing": false }));
        let none = json!({ "supported": false, "recommended": { "label": "Vulkan" }, "installed": null, "using": null, "installing": "j3" });
        assert_eq!(as_engine(&none).unwrap()["installing"], true);
        for bad in [json!({}), json!({ "supported": "yes", "recommended": { "label": "x" } }), json!({ "supported": true, "recommended": { "label": "x" }, "using": { "source": "elsewhere", "path": "p" } }), json!({ "supported": true, "recommended": { "label": "x" }, "installed": { "tag": 5 } })] {
            assert!(as_engine(&bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_runtime_is_checked_and_its_log_is_cut_to_the_last_thirty_lines() {
        let log: Vec<Value> = (0..40).map(|i| json!(format!("line {i}"))).chain([json!(5)]).collect();
        let r = as_runtime(&json!({ "state": "ready", "model_id": "m", "model": "x", "base_url": "http://127.0.0.1:1/v1", "log": log, "reason": null })).unwrap();
        assert_eq!(r["log"].as_array().unwrap().len(), 30);
        assert_eq!(r["log"][29], "line 39");
        assert_eq!((r["usingForAssistant"].clone(), r["reason"].clone()), (json!(false), json!(null)));
        assert!(as_runtime(&json!({ "state": "weird", "model_id": "m", "model": "x", "base_url": "u" })).is_none());
        assert!(as_runtime(&json!({ "state": "ready", "model_id": 5, "model": "x", "base_url": "u" })).is_none());
    }
}
