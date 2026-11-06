//! Running `llama-server` as a child of Mobius: start it on a private port, watch it, stop it.

use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use ts_rs::TS;

const LOG_LINES: usize = 200;
const LOG_LINE_CHARS: usize = 500;
const DEFAULT_LOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub binary: PathBuf,
    pub model: PathBuf,
    pub projector: Option<PathBuf>,
    pub port: u16,
    /// Tokens of conversation the model can hold at once.
    pub context: u32,
    /// Layers to put on the GPU: -1 leaves it to llama-server, which fits the model to the memory it finds.
    pub gpu_layers: i32,
    pub extra_env: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "state", content = "reason", rename_all = "snake_case")]
#[ts(export)]
pub enum State {
    Stopped,
    Starting,
    Ready,
    Failed(String),
}

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("llama-server was not found at {0}")]
    NoProgram(PathBuf),
    #[error("not a model file: {0}")]
    NoModel(PathBuf),
    #[error("{0}")]
    Setting(String),
    #[error("could not start llama-server: {0}")]
    Spawn(String),
}

/// The command line. The server only listens on this computer, and tool calls are switched on.
pub fn build_args(spec: &LaunchSpec) -> Vec<String> {
    let mut args = vec![
        "-m".to_owned(),
        spec.model.to_string_lossy().into_owned(),
        "--host".to_owned(),
        "127.0.0.1".to_owned(),
        "--port".to_owned(),
        spec.port.to_string(),
        "-c".to_owned(),
        spec.context.to_string(),
        "--jinja".to_owned(),
        "--no-webui".to_owned(),
    ];
    if spec.gpu_layers >= 0 {
        args.push("-ngl".to_owned());
        args.push(spec.gpu_layers.to_string());
    }
    if let Some(projector) = &spec.projector {
        args.push("--mmproj".to_owned());
        args.push(projector.to_string_lossy().into_owned());
    }
    args
}

/// A port nobody is using right now.
pub fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// The first of these that is a real file.
pub fn locate_binary(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// Places `llama-server` is usually found, most specific first.
pub fn default_binary_candidates(home: &Path, from_env: Option<PathBuf>, path_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    let mut list: Vec<PathBuf> = from_env.into_iter().collect();
    list.extend(path_dirs.iter().map(|d| d.join(name)));
    let unsloth = home.join(".unsloth").join("llama.cpp");
    list.push(unsloth.join("build").join("bin").join("Release").join(name));
    list.push(unsloth.join("build").join("bin").join(name));
    list.push(home.join(".mobius").join("llama.cpp").join(name));
    list
}

type Log = Arc<Mutex<VecDeque<String>>>;

pub struct Runtime {
    child: Option<Child>,
    readers: Vec<JoinHandle<()>>,
    log: Log,
    port: u16,
    state: State,
    started: Instant,
    load_timeout: Duration,
    agent: ureq::Agent,
}

fn pump(stream: impl std::io::Read + Send + 'static, log: Log) -> JoinHandle<()> {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
            let text: String = String::from_utf8_lossy(&line).trim_end().chars().take(LOG_LINE_CHARS).collect();
            if let Ok(mut log) = log.lock() {
                if log.len() == LOG_LINES {
                    log.pop_front();
                }
                log.push_back(text);
            }
        }
    })
}

fn validate(spec: &LaunchSpec) -> Result<(), RuntimeError> {
    if !spec.binary.is_file() {
        return Err(RuntimeError::NoProgram(spec.binary.clone()));
    }
    let is_gguf = |p: &Path| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("gguf"));
    if !is_gguf(&spec.model) {
        return Err(RuntimeError::NoModel(spec.model.clone()));
    }
    if let Some(projector) = &spec.projector
        && !is_gguf(projector)
    {
        return Err(RuntimeError::NoModel(projector.clone()));
    }
    if !(256..=1_048_576).contains(&spec.context) {
        return Err(RuntimeError::Setting("the context size must be between 256 and 1048576 tokens".into()));
    }
    if !(-1..=999).contains(&spec.gpu_layers) {
        return Err(RuntimeError::Setting("the number of GPU layers must be automatic (-1) or between 0 and 999".into()));
    }
    if spec.port < 1024 {
        return Err(RuntimeError::Setting("the port must be 1024 or higher".into()));
    }
    Ok(())
}

impl Runtime {
    pub fn start(spec: LaunchSpec) -> Result<Self, RuntimeError> {
        validate(&spec)?;
        let mut command = Command::new(&spec.binary);
        command.args(build_args(&spec)).envs(spec.extra_env.iter().map(|(k, v)| (k, v))).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // no console window
        }
        let mut child = command.spawn().map_err(|e| RuntimeError::Spawn(e.to_string()))?;
        let log: Log = Arc::new(Mutex::new(VecDeque::new()));
        let mut readers = Vec::new();
        if let Some(out) = child.stdout.take() {
            readers.push(pump(out, log.clone()));
        }
        if let Some(err) = child.stderr.take() {
            readers.push(pump(err, log.clone()));
        }
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_global(Some(Duration::from_millis(800))).build().into();
        Ok(Runtime { child: Some(child), readers, log, port: spec.port, state: State::Starting, started: Instant::now(), load_timeout: DEFAULT_LOAD_TIMEOUT, agent })
    }

    /// The operating system's number for the process, while it runs.
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    pub fn with_load_timeout(mut self, timeout: Duration) -> Self {
        self.load_timeout = timeout;
        self
    }

    /// Where the assistant talks to it.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }

    pub fn log_tail(&self, lines: usize) -> Vec<String> {
        let log = self.log.lock().map(|l| l.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
        log[log.len().saturating_sub(lines)..].to_vec()
    }

    /// Looks at the process now. Never waits long.
    pub fn poll(&mut self) -> State {
        if matches!(self.state, State::Stopped | State::Failed(_)) {
            return self.state.clone();
        }
        let exited = match self.child.as_mut().map(Child::try_wait) {
            Some(Ok(Some(status))) => Some(status),
            _ => None,
        };
        if let Some(status) = exited {
            for reader in self.readers.drain(..) {
                reader.join().ok();
            }
            self.child = None;
            let code = status.code().map_or("no exit code".to_owned(), |c| format!("exit code {c}"));
            let last = self.log_tail(3).join(" | ");
            self.state = State::Failed(format!("llama-server stopped ({code}). {last}").trim_end().to_owned());
        } else if self.state == State::Starting {
            let healthy = self.agent.get(&format!("http://127.0.0.1:{}/health", self.port)).call().is_ok_and(|r| r.status().as_u16() == 200);
            if healthy {
                self.state = State::Ready;
            } else if self.started.elapsed() > self.load_timeout {
                self.stop();
                self.state = State::Failed(format!("llama-server was not ready after {} seconds", self.load_timeout.as_secs()));
            }
        }
        self.state.clone()
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill().ok();
            child.wait().ok();
        }
        for reader in self.readers.drain(..) {
            reader.join().ok();
        }
        if !matches!(self.state, State::Failed(_)) {
            self.state = State::Stopped;
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Writes down which process is the server, so a later run can clean up if this one is killed without a chance to stop it.
pub fn remember_pid(file: &Path, pid: u32) {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(file, pid.to_string()).ok();
}

pub fn forget_pid(file: &Path) {
    std::fs::remove_file(file).ok();
}

/// Stops a server left over from an earlier run. The process is only stopped when its name still contains
/// `program_name`: the number may by now belong to something unrelated. Returns whether anything was stopped.
pub fn reap_stale(file: &Path, program_name: &str) -> bool {
    let Some(pid) = std::fs::read_to_string(file).ok().and_then(|text| text.trim().parse::<u32>().ok()) else {
        forget_pid(file);
        return false;
    };
    let pid = sysinfo::Pid::from_u32(pid);
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    let stopped = match system.process(pid) {
        Some(process) if process.name().to_string_lossy().to_ascii_lowercase().contains(&program_name.to_ascii_lowercase()) => process.kill(),
        _ => false,
    };
    if stopped || system.process(pid).is_none() {
        forget_pid(file);
    }
    stopped
}
