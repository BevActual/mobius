//! The `models.*` methods: finding models, ranking them for this computer, and running one with llama-server.
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::SyncSender;

use mobius_core::core::Core;
use mobius_core::rpc::{Extension, ExtensionError, params_as};
use mobius_runtime::discover::discover;
use mobius_runtime::download::{DownloadError, Options as DownloadOptions, Progress, download};
use mobius_runtime::fit::assess;
use mobius_runtime::hardware;
use mobius_runtime::hub::{HubClient, files_of_model, safe_file_path, valid_repo_id};
use mobius_runtime::local::{LocalModel, scan};
use mobius_runtime::server::{LaunchSpec, Runtime, RuntimeError, State, default_binary_candidates, forget_pid, free_port, locate_binary, reap_stale, remember_pid};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::inbox::Inbox;

const DEFAULT_CONTEXT: u32 = 16_384;
const MAX_JOBS: usize = 2;
const MAX_QUERY_CHARS: usize = 100;
const DEFAULT_RESULTS: usize = 12;
const MAX_RESULTS: usize = 20;
const LOG_LINES: usize = 30;

pub struct ModelsConfig {
    pub hub: String,
    pub roots: Vec<PathBuf>,
    pub llama_server: Option<PathBuf>,
    pub llama_env: Vec<(String, String)>,
    pub state_dir: Option<PathBuf>,
    /// Where downloaded models are kept.
    pub download_dir: Option<PathBuf>,
    pub home: PathBuf,
}

struct Active {
    runtime: Runtime,
    model_id: String,
    model: String,
}

pub struct Models {
    config: ModelsConfig,
    inbox: SyncSender<Inbox>,
    jobs_running: Arc<AtomicUsize>,
    next_job: u64,
    /// The download in progress: its job and the switch that stops it.
    download: Option<(String, Arc<AtomicBool>)>,
    active: Option<Active>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DiscoverParams {
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DownloadParams {
    repo: String,
    file: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelParams {
    job: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StartParams {
    id: String,
    #[serde(default)]
    context: Option<u32>,
}

fn runtime_error(error: &RuntimeError) -> ExtensionError {
    let kind = match error {
        RuntimeError::NoProgram(_) => "no_program",
        RuntimeError::NoModel(_) => "no_model",
        RuntimeError::Setting(_) => "setting",
        RuntimeError::Spawn(_) => "spawn",
    };
    ExtensionError::application(kind, &error.to_string())
}

impl Models {
    pub fn new(config: ModelsConfig, inbox: SyncSender<Inbox>) -> Self {
        let models = Models { config, inbox, jobs_running: Arc::new(AtomicUsize::new(0)), next_job: 1, download: None, active: None };
        // A server left over from a daemon that was killed would hold the graphics memory.
        if let Some(file) = models.pid_file() {
            reap_stale(&file, &models.program_name());
        }
        models
    }

    fn pid_file(&self) -> Option<PathBuf> {
        self.config.state_dir.as_ref().map(|dir| dir.join("llama.pid"))
    }

    fn binary(&self) -> Option<PathBuf> {
        match &self.config.llama_server {
            Some(path) => path.is_file().then(|| path.clone()),
            None => {
                let path_dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
                locate_binary(&default_binary_candidates(&self.config.home, std::env::var_os("MOBIUS_LLAMA_SERVER").map(PathBuf::from), &path_dirs))
            }
        }
    }

    fn program_name(&self) -> String {
        self.binary().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned())).unwrap_or_else(|| "llama-server".to_owned())
    }

    fn local(&self) -> Vec<LocalModel> {
        scan(&self.config.roots)
    }

    /// A background job finished: make the notification for it, and free whatever it was using.
    pub fn on_job(&mut self, job: &str, result: &Result<Value, String>) -> Value {
        if self.download.as_ref().is_some_and(|(id, _)| id == job) {
            self.download = None;
        }
        let params = match result {
            Ok(value) => json!({ "job": job, "ok": true, "result": value }),
            Err(error) => json!({ "job": job, "ok": false, "error": error }),
        };
        json!({ "jsonrpc": "2.0", "method": "models.job", "params": params })
    }

    fn discover(&mut self, params: Option<&Value>) -> Result<Value, ExtensionError> {
        let params: DiscoverParams = params_as(params)?;
        let query = params.query.unwrap_or_default();
        if query.chars().count() > MAX_QUERY_CHARS {
            return Err(ExtensionError::invalid_params("the search is too long"));
        }
        let limit = params.limit.unwrap_or(DEFAULT_RESULTS);
        if !(1..=MAX_RESULTS).contains(&limit) {
            return Err(ExtensionError::invalid_params("limit must be from 1 to 20"));
        }
        if self.jobs_running.load(Ordering::SeqCst) >= MAX_JOBS {
            return Err(ExtensionError::application("busy", "two searches are already running"));
        }
        let client = HubClient::new(&self.config.hub).map_err(|e| ExtensionError::application("hub", &e.to_string()))?;
        let job = format!("j{}", self.next_job);
        self.next_job += 1;
        self.jobs_running.fetch_add(1, Ordering::SeqCst);
        let (inbox, running, id) = (self.inbox.clone(), self.jobs_running.clone(), job.clone());
        std::thread::spawn(move || {
            let hardware = hardware::detect();
            let result = discover(&client, &query, &hardware, limit).map_err(|e| e.to_string()).and_then(|found| serde_json::to_value(found).map_err(|e| e.to_string()));
            running.fetch_sub(1, Ordering::SeqCst);
            inbox.send(Inbox::Job { job: id, result }).ok();
        });
        Ok(json!({ "job": job }))
    }

    fn download(&mut self, params: Option<&Value>) -> Result<Value, ExtensionError> {
        let params: DownloadParams = params_as(params)?;
        if !valid_repo_id(&params.repo) || !safe_file_path(&params.file) || !params.file.to_ascii_lowercase().ends_with(".gguf") {
            return Err(ExtensionError::invalid_params("that is not a model file in a Hugging Face repository"));
        }
        if self.download.is_some() {
            return Err(ExtensionError::application("busy", "a model is already being downloaded"));
        }
        let Some(folder) = self.config.download_dir.clone().or_else(|| self.config.roots.first().cloned()) else {
            return Err(ExtensionError::application("no_folder", "there is no folder to keep models in"));
        };
        let client = HubClient::new(&self.config.hub).map_err(|e| ExtensionError::application("hub", &e.to_string()))?;
        let job = format!("j{}", self.next_job);
        self.next_job += 1;
        let cancel = Arc::new(AtomicBool::new(false));
        let progress = Arc::new(Progress::default());
        let finished = Arc::new(AtomicBool::new(false));
        self.download = Some((job.clone(), cancel.clone()));

        // Tell the window how far along it is, a couple of times a second.
        {
            let (inbox, progress, finished, job) = (self.inbox.clone(), progress.clone(), finished.clone(), job.clone());
            std::thread::spawn(move || {
                while !finished.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let note = json!({ "jsonrpc": "2.0", "method": "models.progress", "params": { "job": job, "done": progress.done(), "total": progress.total() } });
                    if finished.load(Ordering::SeqCst) || inbox.send(Inbox::Notify(note)).is_err() {
                        break;
                    }
                }
            });
        }
        let (inbox, id) = (self.inbox.clone(), job.clone());
        std::thread::spawn(move || {
            let result = (|| -> Result<Value, String> {
                let listing = client.files(&params.repo).map_err(|e| e.to_string())?;
                let parts = files_of_model(&listing, &params.file).ok_or_else(|| "that file is not in the repository, or is only part of a split model".to_owned())?;
                let paths = download(&client, &params.repo, &parts, &folder, &progress, &cancel, &DownloadOptions::default()).map_err(|e| match e {
                    DownloadError::Cancelled => "cancelled".to_owned(),
                    other => other.to_string(),
                })?;
                Ok(json!({ "files": paths.len() }))
            })();
            finished.store(true, Ordering::SeqCst);
            inbox.send(Inbox::Job { job: id, result }).ok();
        });
        Ok(json!({ "job": job }))
    }

    fn cancel(&mut self, params: Option<&Value>) -> Result<Value, ExtensionError> {
        let params: CancelParams = params_as(params)?;
        match &self.download {
            Some((job, cancel)) if *job == params.job => {
                cancel.store(true, Ordering::SeqCst);
                Ok(json!({}))
            }
            _ => Err(ExtensionError::application("no_job", "there is no such download")),
        }
    }

    fn start(&mut self, params: Option<&Value>) -> Result<Value, ExtensionError> {
        let params: StartParams = params_as(params)?;
        let context = params.context.unwrap_or(DEFAULT_CONTEXT);
        if !(256..=1_048_576).contains(&context) {
            return Err(ExtensionError::invalid_params("context must be from 256 to 1048576 tokens"));
        }
        // Only a model the list contains can be run: the window never gets to name a file.
        let Some(model) = self.local().into_iter().find(|m| m.id == params.id) else {
            return Err(ExtensionError::application("no_model", "that model is not on this computer"));
        };
        let Some(binary) = self.binary() else {
            return Err(ExtensionError::application("no_program", "llama-server was not found. Install llama.cpp, or set MOBIUS_LLAMA_SERVER to its path."));
        };
        self.stop();
        let port = free_port().map_err(|e| ExtensionError::application("spawn", &e.to_string()))?;
        let spec = LaunchSpec { binary, model: model.path.clone(), projector: model.projector.clone(), port, context, gpu_layers: -1, extra_env: self.config.llama_env.clone() };
        let runtime = Runtime::start(spec).map_err(|e| runtime_error(&e))?;
        if let (Some(file), Some(pid)) = (self.pid_file(), runtime.pid()) {
            remember_pid(&file, pid);
        }
        let name = model.file.strip_suffix(".gguf").or_else(|| model.file.strip_suffix(".GGUF")).unwrap_or(&model.file).to_owned();
        let result = json!({ "base_url": runtime.base_url(), "model": name });
        self.active = Some(Active { runtime, model_id: model.id, model: name });
        Ok(result)
    }

    pub fn stop(&mut self) {
        if let Some(mut active) = self.active.take() {
            active.runtime.stop();
        }
        if let Some(file) = self.pid_file() {
            forget_pid(&file);
        }
    }

    fn status(&mut self) -> Value {
        let binary = self.binary().map(|p| p.to_string_lossy().into_owned());
        let runtime = self.active.as_mut().map(|active| {
            let state = active.runtime.poll();
            let (name, reason) = match &state {
                State::Stopped => ("stopped", None),
                State::Starting => ("starting", None),
                State::Ready => ("ready", None),
                State::Failed(reason) => ("failed", Some(reason.clone())),
            };
            json!({ "state": name, "reason": reason, "model_id": active.model_id, "model": active.model, "base_url": active.runtime.base_url(), "log": active.runtime.log_tail(LOG_LINES) })
        });
        json!({ "binary": binary, "runtime": runtime })
    }
}

impl Extension for Models {
    fn call(&mut self, _core: &mut Core, method: &str, params: Option<&Value>) -> Option<Result<Value, ExtensionError>> {
        if !method.starts_with("models.") {
            return None;
        }
        Some(match method {
            "models.hardware" => serde_json::to_value(hardware::detect()).map_err(|e| ExtensionError::application("internal", &e.to_string())),
            "models.local" => {
                let hardware = hardware::detect();
                Ok(Value::Array(self.local().into_iter().map(|model| json!({ "assessment": assess(model.size, &hardware), "model": model })).collect()))
            }
            "models.discover" => self.discover(params),
            "models.download" => self.download(params),
            "models.cancel" => self.cancel(params),
            "models.status" => Ok(self.status()),
            "models.start" => self.start(params),
            "models.stop" => {
                self.stop();
                Ok(json!({}))
            }
            _ => return None,
        })
    }
}

impl Drop for Models {
    fn drop(&mut self) {
        self.stop();
    }
}
