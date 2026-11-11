//! The supervised core process: starts it, speaks JSON-RPC to it, restarts it with a backoff when it crashes, and
//! gives up (status `Failed`) when it keeps crashing or cannot start.
use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::protocol::{Line, MAX_LINE_BYTES, RestartBudget, RpcError, read_bounded_line};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Starting,
    Ready,
    Restarting,
    Failed,
}

impl Status {
    /// The word the interface uses.
    pub fn word(self) -> &'static str {
        match self {
            Status::Starting => "starting",
            Status::Ready => "ready",
            Status::Restarting => "restarting",
            Status::Failed => "failed",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum CallError {
    /// The core is not running (it crashed, has not started, or gave up).
    NotRunning,
    Timeout,
    /// The host is shutting down.
    Stopped,
    Rpc(RpcError),
}

type StatusFn = Arc<dyn Fn(Status) + Send + Sync>;
type NoteFn = Arc<dyn Fn(&str, &Value) + Send + Sync>;
type RequestFn = Arc<dyn Fn(&str, &Value) -> Result<Value, String> + Send + Sync>;
type LogFn = Arc<dyn Fn(&str) + Send + Sync>;

pub struct Options {
    pub binary: PathBuf,
    pub args: Vec<String>,
    pub on_status: StatusFn,
    /// Messages from the core that are not replies (the conversation's progress, for one).
    pub on_notification: NoteFn,
    /// Questions from the core that the host must answer (running a tool, for one). Without a handler the host
    /// answers "method not found".
    pub on_request: Option<RequestFn>,
    pub log: LogFn,
}

type Waiter = Sender<Result<Value, CallError>>;

struct Shared {
    options: Options,
    writer: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, Waiter>>,
    status: Mutex<Status>,
    next_id: AtomicU64,
    stopping: AtomicBool,
    /// Which run of the core a late ping answer belongs to.
    generation: AtomicU64,
    child: Mutex<Option<Child>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Shared {
    fn log(&self, message: &str) {
        (self.options.log)(message);
    }

    fn set_status(&self, next: Status) {
        {
            let mut status = lock(&self.status);
            if *status == next {
                return;
            }
            *status = next;
        }
        (self.options.on_status)(next);
    }

    fn reject_all(&self, make: impl Fn() -> CallError) {
        let waiters: Vec<Waiter> = lock(&self.pending).drain().map(|(_, w)| w).collect();
        for waiter in waiters {
            let _ = waiter.send(Err(make()));
        }
    }

    fn write_line(&self, value: &Value) -> bool {
        let mut writer = lock(&self.writer);
        let Some(stdin) = writer.as_mut() else { return false };
        writeln!(stdin, "{value}").and_then(|()| stdin.flush()).is_ok()
    }

    fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(CallError::Stopped);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        lock(&self.pending).insert(id, tx);
        if !self.write_line(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            lock(&self.pending).remove(&id);
            return Err(if self.stopping.load(Ordering::SeqCst) { CallError::Stopped } else { CallError::NotRunning });
        }
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                lock(&self.pending).remove(&id);
                Err(CallError::Timeout)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(CallError::NotRunning),
        }
    }

    fn handle_line(self: &Arc<Self>, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            self.log("the core sent something that is not JSON");
            return;
        };
        let method = message.get("method").and_then(Value::as_str);
        match (message.get("id"), method) {
            (Some(Value::Number(id)), None) => {
                let Some(id) = id.as_u64() else { return };
                let Some(waiter) = lock(&self.pending).remove(&id) else { return };
                let outcome = match message.get("error") {
                    Some(error) => Err(CallError::Rpc(RpcError {
                        code: error.get("code").and_then(Value::as_i64).unwrap_or(-32603),
                        message: error.get("message").and_then(Value::as_str).unwrap_or("core error").to_owned(),
                        data: error.get("data").cloned(),
                    })),
                    None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = waiter.send(outcome);
            }
            (None, Some(method)) => (self.options.on_notification)(method, message.get("params").unwrap_or(&Value::Null)),
            (Some(Value::String(id)), Some(method)) => {
                let (shared, id, method) = (Arc::clone(self), id.clone(), method.to_owned());
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                std::thread::spawn(move || shared.answer_request(&id, &method, &params));
            }
            _ => {}
        }
    }

    fn answer_request(&self, id: &str, method: &str, params: &Value) {
        let outcome = match &self.options.on_request {
            Some(handler) => handler(method, params),
            None => Err("method not found".to_owned()),
        };
        let reply = match outcome {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => {
                let short: String = message.chars().take(300).collect();
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": short } })
            }
        };
        self.write_line(&reply);
    }

    fn give_up(&self, reason: &str) {
        self.log(&format!("the core is unavailable: {reason}"));
        *lock(&self.writer) = None;
        self.reject_all(|| CallError::NotRunning);
        self.set_status(Status::Failed);
    }

    fn spawn(self: &Arc<Self>) -> Result<(), String> {
        let mut command = Command::new(&self.options.binary);
        command.args(&self.options.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // no console window
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *lock(&self.writer) = child.stdin.take();
        *lock(&self.child) = Some(child);
        if let Some(stdout) = stdout {
            let shared = Arc::clone(self);
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_bounded_line(&mut reader, MAX_LINE_BYTES) {
                        Ok(Line::Text(line)) => shared.handle_line(&line),
                        Ok(Line::TooLong) => shared.log("the core sent a message that was too large and it was dropped"),
                        Ok(Line::Eof) | Err(_) => break,
                    }
                }
            });
        }
        if let Some(stderr) = stderr {
            let shared = Arc::clone(self);
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                while let Ok(Line::Text(line)) = read_bounded_line(&mut reader, 64 * 1024) {
                    shared.log(line.trim_end());
                }
            });
        }
        let shared = Arc::clone(self);
        std::thread::spawn(move || {
            // A core that is running but slow to answer (a busy or freshly scanned computer) is waited for, asking again
            // every few seconds, rather than ended: ending it looks like a crash (Windows gives a killed process code 1)
            // and a few of those in a row gave up on the core for good. Only one that never answers is ended.
            let began = Instant::now();
            loop {
                let left = START_WAIT.saturating_sub(began.elapsed());
                match shared.call("core.ping", json!({}), left.min(PING_WAIT)) {
                    Ok(_) => {
                        if shared.generation.load(Ordering::SeqCst) == generation && !shared.stopping.load(Ordering::SeqCst) {
                            shared.set_status(Status::Ready);
                        }
                        return;
                    }
                    Err(CallError::Timeout) if began.elapsed() < START_WAIT && shared.generation.load(Ordering::SeqCst) == generation => {
                        let running = lock(&shared.child).as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
                        if !running {
                            return;
                        }
                    }
                    Err(_) => {
                        if shared.generation.load(Ordering::SeqCst) == generation
                            && let Some(child) = lock(&shared.child).as_mut()
                        {
                            shared.log(&format!("the core did not answer within {} s of starting; ending it", began.elapsed().as_secs()));
                            let _ = child.kill();
                        }
                        return;
                    }
                }
            }
        });
        Ok(())
    }

    /// Runs until the core is stopped or given up on.
    fn supervise(self: &Arc<Self>) {
        let mut budget = RestartBudget::default();
        let began = Instant::now();
        self.set_status(Status::Starting);
        loop {
            if self.stopping.load(Ordering::SeqCst) {
                return;
            }
            if let Err(reason) = self.spawn() {
                self.give_up(&reason);
                return;
            }
            // Wait for it to leave.
            let code = loop {
                if let Some(child) = lock(&self.child).as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => break status.code(),
                        Ok(None) => {}
                        Err(_) => break None,
                    }
                }
                std::thread::sleep(Duration::from_millis(15));
            };
            *lock(&self.child) = None;
            *lock(&self.writer) = None;
            let stopping = self.stopping.load(Ordering::SeqCst);
            self.reject_all(|| if stopping { CallError::Stopped } else { CallError::NotRunning });
            if stopping {
                return;
            }
            self.log(&format!("the core exited (code {code:?})"));
            let Some(delay) = budget.next(began.elapsed().as_millis() as u64) else {
                self.give_up("the core keeps crashing");
                return;
            };
            self.set_status(Status::Restarting);
            let until = Instant::now() + Duration::from_millis(delay);
            while Instant::now() < until {
                if self.stopping.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            self.set_status(Status::Starting);
        }
    }
}

/// How long one startup ping waits, and how long a running core has to answer one before it is ended.
const PING_WAIT: Duration = Duration::from_secs(5);
const START_WAIT: Duration = Duration::from_secs(30);

/// The core daemon, run and watched. Dropping it stops the core.
pub struct CoreProcess {
    shared: Arc<Shared>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

impl CoreProcess {
    pub fn start(options: Options) -> CoreProcess {
        let shared = Arc::new(Shared {
            options,
            writer: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            status: Mutex::new(Status::Starting),
            next_id: AtomicU64::new(1),
            stopping: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            child: Mutex::new(None),
        });
        let runner = Arc::clone(&shared);
        let handle = std::thread::spawn(move || runner.supervise());
        CoreProcess { shared, supervisor: Mutex::new(Some(handle)) }
    }

    pub fn status(&self) -> Status {
        *lock(&self.shared.status)
    }

    /// The operating system's number for the running core, if there is one.
    pub fn pid(&self) -> Option<u32> {
        lock(&self.shared.child).as_ref().map(std::process::Child::id)
    }

    /// Ends the running core the hard way, as a crash would; it is then restarted like after any crash.
    pub fn crash(&self) {
        if let Some(child) = lock(&self.shared.child).as_mut() {
            let _ = child.kill();
        }
    }

    pub fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        self.shared.call(method, params, timeout)
    }

    /// Ends the core. Closing its input is the polite request; it is killed if it does not leave in time.
    pub fn stop_shared(&self) {
        let shared = &self.shared;
        shared.stopping.store(true, Ordering::SeqCst);
        shared.reject_all(|| CallError::Stopped);
        *lock(&shared.writer) = None;
        let handle = lock(&self.supervisor).take();
        let deadline = Instant::now() + Duration::from_secs(2);
        while handle.as_ref().is_some_and(|h| !h.is_finished()) {
            if Instant::now() > deadline {
                if let Some(child) = lock(&shared.child).as_mut() {
                    let _ = child.kill();
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }

    pub fn stop(self) {
        self.stop_shared();
    }
}

impl Drop for CoreProcess {
    fn drop(&mut self) {
        self.stop_shared();
    }
}
