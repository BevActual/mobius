//! The homeserver behind the local Mobius space in Messages: Tuwunel (Apache-2.0), a Matrix homeserver from the Conduit
//! family. It is not in the installer. The first time the space opens, Mobius downloads the build for this computer
//! from its own GitHub release (`.github/workflows/homeserver.yml`), checks it against the SHA-256 pinned below (never
//! against anything fetched), and runs it on 127.0.0.1 only, with its data in Mobius's folder. It stops when Mobius
//! quits; a copy left behind by a crash is stopped the next time it starts.
//!
//! The window follows the download as `mobius:space-status` events: `{ state, done, total, message, offline, url }`.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where the builds are published: a prerelease that is never Latest.
const RELEASE: &str = "https://github.com/BevActual/mobius/releases/download/homeserver-tuwunel-2f0587000ae5/";
/// Each computer's build and its SHA-256, from the workflow's run. A download that doesn't match is thrown away.
const BUILDS: &[(&str, &str, &str)] = &[
    ("windows-x86_64", "tuwunel-2f0587000ae5-x86_64-pc-windows-msvc.gz", "ab7442ff09c5cff6c3103589411f6e79ade2fe3c9b69a39e8c3365196a6aa221"),
    ("macos-aarch64", "tuwunel-2f0587000ae5-aarch64-apple-darwin.gz", "7fb96fbfc60dcb178b1eca3d1b471647c1737b51586a25a0a346f8a07a3fa4eb"),
];
/// The name it is kept under in Mobius's folder: a new pin is a new file, so an old build is never run by mistake.
const PROGRAM: &str = "tuwunel-2f0587000ae5";
/// Larger than any build (about 40 MB packed); a download past this is stopped.
const MAX_BYTES: u64 = 256 * 1024 * 1024;
/// The local space's server name. Federation is off: nothing outside this computer reaches it.
pub const SERVER_NAME: &str = "mobius.localhost";
const EVENT: &str = "mobius:space-status";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// What the homeserver is doing.
#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// Not downloaded, or downloaded and not started.
    Idle,
    Downloading { done: u64, total: u64 },
    Starting,
    Running { url: String },
    /// It could not be fetched or started. `offline` when the computer couldn't reach GitHub at all: try again later.
    Failed { message: String, offline: bool },
}

impl State {
    pub fn to_json(&self) -> Value {
        match self {
            State::Idle => json!({ "state": "idle" }),
            State::Downloading { done, total } => json!({ "state": "downloading", "done": done, "total": total }),
            State::Starting => json!({ "state": "starting" }),
            State::Running { url } => json!({ "state": "running", "url": url }),
            State::Failed { message, offline } => json!({ "state": "failed", "message": message, "offline": offline }),
        }
    }
}

/// This computer's build, if there is one.
fn build() -> Option<(&'static str, &'static str)> {
    let key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    BUILDS.iter().find(|(k, _, _)| *k == key).map(|(_, file, sha)| (*file, *sha))
}

pub struct Homeserver {
    dir: PathBuf,
    state: Mutex<State>,
    child: Mutex<Option<Child>>,
    busy: AtomicBool,
    emit: crate::bridge::Emit,
    /// Where builds come from (a test serves its own).
    release: String,
    builds: Vec<(String, String)>,
    /// Run once the server answers, with its address: sets up the person's account and the space. A failure there
    /// shows as the space failing.
    ready: std::sync::OnceLock<Ready>,
}

pub type Ready = Box<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync>;

impl Homeserver {
    /// The homeserver kept in `dir` (Mobius's data folder `/homeserver`). A copy left running by a crash is stopped.
    pub fn new(dir: PathBuf, emit: crate::bridge::Emit) -> Homeserver {
        mobius_runtime::server::reap_stale(&dir.join("pid"), "tuwunel");
        let builds = build().map(|(file, sha)| vec![(file.to_owned(), sha.to_owned())]).unwrap_or_default();
        Homeserver { dir, state: Mutex::new(State::Idle), child: Mutex::new(None), busy: AtomicBool::new(false), emit, release: RELEASE.to_owned(), builds, ready: std::sync::OnceLock::new() }
    }

    #[cfg(test)]
    fn serving(dir: PathBuf, emit: crate::bridge::Emit, release: String, file: &str, sha: &str) -> Homeserver {
        Homeserver { dir, state: Mutex::new(State::Idle), child: Mutex::new(None), busy: AtomicBool::new(false), emit, release, builds: vec![(file.to_owned(), sha.to_owned())], ready: std::sync::OnceLock::new() }
    }

    /// What to do once the server answers: called with its address and the registration token.
    pub fn on_ready(&self, ready: Ready) {
        let _ = self.ready.set(ready);
    }

    pub fn status(&self) -> State {
        lock(&self.state).clone()
    }

    /// Where it answers, while it runs.
    pub fn url(&self) -> Option<String> {
        match self.status() {
            State::Running { url } => Some(url),
            _ => None,
        }
    }

    fn set(&self, state: State) {
        (self.emit)(EVENT, state.to_json());
        *lock(&self.state) = state;
    }

    fn program(&self) -> PathBuf {
        self.dir.join(format!("{PROGRAM}{}", std::env::consts::EXE_SUFFIX))
    }

    /// Fetches (the first time) and starts it, on a thread of its own; the window follows `mobius:space-status`. Asked
    /// again while running or on its way, it does nothing; after a failure it tries again.
    pub fn open(self: &Arc<Self>) -> State {
        if matches!(self.status(), State::Running { .. }) || self.busy.swap(true, Ordering::AcqRel) {
            return self.status();
        }
        let me = Arc::clone(self);
        let spawned = std::thread::Builder::new().name("mobius-homeserver".into()).spawn(move || {
            let result = me.fetch().and_then(|()| me.start());
            if let Err(failed) = result {
                me.set(failed);
            }
            me.busy.store(false, Ordering::Release);
        });
        if spawned.is_err() {
            self.busy.store(false, Ordering::Release);
            self.set(State::Failed { message: "Mobius could not start the space's server.".into(), offline: false });
        }
        self.status()
    }

    /// Downloads this computer's build unless it is already here, checks it, and unpacks it.
    fn fetch(&self) -> Result<(), State> {
        let program = self.program();
        if program.is_file() {
            return Ok(());
        }
        let Some((file, sha)) = self.builds.first().cloned() else {
            return Err(State::Failed { message: "The Mobius space doesn't run on this computer yet (Windows and Apple silicon Macs for now).".into(), offline: false });
        };
        let failed = |message: String| State::Failed { message, offline: false };
        std::fs::create_dir_all(&self.dir).map_err(|e| failed(format!("Mobius could not make its folder for the space: {e}")))?;
        self.set(State::Downloading { done: 0, total: 0 });
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(15))).timeout_recv_body(Some(Duration::from_secs(60))).build().into();
        let mut response = agent.get(&format!("{}{file}", self.release)).call().map_err(|e| match e {
            ureq::Error::StatusCode(code) => failed(format!("The space's server could not be downloaded (GitHub answered {code}).")),
            _ => State::Failed { message: "Mobius couldn't reach GitHub to download the space's server. Check the connection and try again.".into(), offline: true },
        })?;
        let total = response.body().content_length().unwrap_or(0);
        if total > MAX_BYTES {
            return Err(failed("The space's server download is larger than expected, so it was stopped.".into()));
        }
        let packed = self.dir.join(format!("{PROGRAM}.gz.part"));
        let mut out = std::fs::File::create(&packed).map_err(|e| failed(format!("Mobius could not save the space's server: {e}")))?;
        let mut reader = response.body_mut().with_config().limit(MAX_BYTES).reader();
        let (mut hasher, mut done, mut buffer, mut told) = (Sha256::new(), 0u64, vec![0u8; 256 * 1024], Instant::now());
        loop {
            let n = reader.read(&mut buffer).map_err(|_| State::Failed { message: "The download of the space's server was cut off. Check the connection and try again.".into(), offline: true })?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            out.write_all(&buffer[..n]).map_err(|e| failed(format!("Mobius could not save the space's server: {e}")))?;
            done += n as u64;
            if told.elapsed() > Duration::from_millis(150) {
                told = Instant::now();
                self.set(State::Downloading { done, total });
            }
        }
        drop(out);
        let got: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if got != sha {
            let _ = std::fs::remove_file(&packed);
            return Err(failed("The space's server that was downloaded doesn't match the one Mobius expects, so it wasn't used.".into()));
        }
        self.set(State::Downloading { done, total: total.max(done) });
        let part = self.dir.join(format!("{PROGRAM}.part"));
        let unpacked = std::fs::File::open(&packed).and_then(|f| {
            let mut gz = flate2::read::GzDecoder::new(f).take(MAX_BYTES * 8);
            let mut to = std::fs::File::create(&part)?;
            std::io::copy(&mut gz, &mut to)?;
            to.sync_all()
        });
        let _ = std::fs::remove_file(&packed);
        unpacked.map_err(|e| failed(format!("Mobius could not unpack the space's server: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).map_err(|e| failed(format!("Mobius could not unpack the space's server: {e}")))?;
        }
        std::fs::rename(&part, &program).map_err(|e| failed(format!("Mobius could not unpack the space's server: {e}")))?;
        Ok(())
    }

    /// The port it listens on: the same each time while it is free, so the space's address stays the same.
    fn port(&self) -> std::io::Result<u16> {
        let file = self.dir.join("port");
        if let Some(port) = std::fs::read_to_string(&file).ok().and_then(|t| t.trim().parse::<u16>().ok()) {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                return Ok(port);
            }
        }
        let port = mobius_runtime::server::free_port()?;
        std::fs::write(&file, port.to_string())?;
        Ok(port)
    }

    /// The registration token only Mobius knows: the server lets only Mobius make accounts on it.
    pub fn token(&self) -> Result<String, String> {
        let file = self.dir.join("registration-token");
        if let Ok(t) = std::fs::read_to_string(&file) {
            if t.trim().len() >= 32 {
                return Ok(t.trim().to_owned());
            }
        }
        let mut bytes = [0u8; 24];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        std::fs::write(&file, &token).map_err(|e| e.to_string())?;
        Ok(token)
    }

    /// Starts it on a free port on 127.0.0.1 and waits until it answers.
    fn start(&self) -> Result<(), State> {
        let failed = |message: String| State::Failed { message, offline: false };
        self.set(State::Starting);
        let port = self.port().map_err(|e| failed(format!("No port was free for the space's server: {e}")))?;
        let token = self.token().map_err(|e| failed(format!("Mobius could not set up the space's server: {e}")))?;
        let log = std::fs::File::create(self.dir.join("server.log")).map_err(|e| failed(format!("Mobius could not start the space's server: {e}")))?;
        let mut command = Command::new(self.program());
        command
            .env("TUWUNEL_SERVER_NAME", SERVER_NAME)
            .env("TUWUNEL_DATABASE_PATH", self.dir.join("data"))
            .env("TUWUNEL_ADDRESS", "127.0.0.1")
            .env("TUWUNEL_PORT", port.to_string())
            .env("TUWUNEL_ALLOW_FEDERATION", "false")
            .env("TUWUNEL_ALLOW_REGISTRATION", "true")
            .env("TUWUNEL_REGISTRATION_TOKEN", &token)
            .env("TUWUNEL_NEW_USER_DISPLAYNAME_SUFFIX", "")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // no console window
        }
        let mut child = command.spawn().map_err(|e| failed(format!("The space's server could not start: {e}")))?;
        mobius_runtime::server::remember_pid(&self.dir.join("pid"), child.id());
        let url = format!("http://127.0.0.1:{port}");
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(2))).build().into();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if agent.get(&format!("{url}/_matrix/client/versions")).call().is_ok() {
                break;
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(failed(format!("The space's server stopped as it started ({status}). Its log is in {}.", self.dir.join("server.log").display())));
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                return Err(failed("The space's server didn't answer in time.".into()));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        *lock(&self.child) = Some(child);
        if let Some(ready) = self.ready.get() {
            ready(&url, &token).map_err(failed)?;
        }
        self.set(State::Running { url });
        Ok(())
    }

    /// Stops it (Mobius quitting, `--quit` included).
    pub fn stop(&self) {
        if let Some(mut child) = lock(&self.child).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        mobius_runtime::server::forget_pid(&self.dir.join("pid"));
        if matches!(self.status(), State::Running { .. }) {
            *lock(&self.state) = State::Idle;
        }
    }

    pub fn call(self: &Arc<Self>, method: &str) -> Result<Value, String> {
        match method {
            "status" => Ok(self.status().to_json()),
            "open" => Ok(self.open().to_json()),
            _ => Err(format!("The space has no \"{method}\"")),
        }
    }
}

impl Drop for Homeserver {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Makes the account `user` on the space's server at `url` with the registration token, through the two steps of
/// Matrix's registration (the server first answers which proof it wants). False when it is there already.
pub fn register(url: &str, token: &str, user: &str, password: &str) -> Result<bool, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(20))).build().into();
    let post = |body: &Value| -> Result<(u16, Value), String> {
        let mut r = agent.post(&format!("{url}/_matrix/client/v3/register")).header("Content-Type", "application/json").send(body.to_string().as_bytes()).map_err(|e| format!("The space's server didn't answer: {e}"))?;
        let status = r.status().as_u16();
        Ok((status, r.body_mut().read_to_string().ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)))
    };
    let mut body = json!({ "username": user, "password": password, "inhibit_login": true, "initial_device_display_name": "Mobius" });
    let (status, answer) = post(&body)?;
    if status == 400 && answer["errcode"] == "M_USER_IN_USE" {
        return Ok(false);
    }
    if status != 401 {
        return if (200..300).contains(&status) { Ok(true) } else { Err(format!("The space's server refused the account ({status} {}).", answer["errcode"].as_str().unwrap_or(""))) };
    }
    body["auth"] = json!({ "type": "m.login.registration_token", "token": token, "session": answer["session"] });
    let (status, answer) = post(&body)?;
    if (200..300).contains(&status) { Ok(true) } else { Err(format!("The space's server refused the account ({status} {}).", answer["errcode"].as_str().unwrap_or(""))) }
}

/// Whether `dir` holds the build already.
#[must_use]
pub fn downloaded(dir: &Path) -> bool {
    dir.join(format!("{PROGRAM}{}", std::env::consts::EXE_SUFFIX)).is_file()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Serves `body` once for any request, and says how many requests came.
    fn serve(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    line.clear();
                }
                let mut stream = stream;
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(&body);
            }
        });
        url
    }

    fn quiet() -> crate::bridge::Emit {
        Arc::new(|_, _| {})
    }

    fn gz(bytes: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(bytes).unwrap();
        e.finish().unwrap()
    }

    #[test]
    fn a_build_that_matches_its_pin_is_unpacked_and_one_that_doesnt_is_thrown_away() {
        let dir = tempfile::tempdir().unwrap();
        let packed = gz(b"the program");
        let url = serve(packed.clone());
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&events);
        let emit: crate::bridge::Emit = Arc::new(move |name, v| seen.lock().unwrap().push((name.to_owned(), v)));
        let wrong = Homeserver::serving(dir.path().join("a"), emit, url.clone(), "x.gz", &"0".repeat(64));
        let failed = wrong.fetch().unwrap_err();
        assert!(matches!(&failed, State::Failed { offline: false, message } if message.contains("doesn't match")), "{failed:?}");
        assert!(!downloaded(&dir.path().join("a")) && std::fs::read_dir(dir.path().join("a")).unwrap().count() == 0);
        assert!(events.lock().unwrap().iter().any(|(n, v)| n == EVENT && v["state"] == "downloading"));
        let right = Homeserver::serving(dir.path().join("b"), quiet(), url, "x.gz", &sha(&packed));
        right.fetch().unwrap();
        assert_eq!(std::fs::read(right.program()).unwrap(), b"the program");
        // Already here: not fetched again.
        right.fetch().unwrap();
    }

    #[test]
    fn with_no_connection_it_says_so_and_can_be_tried_again() {
        let dir = tempfile::tempdir().unwrap();
        // A port nothing listens on.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let server = Arc::new(Homeserver::serving(dir.path().to_owned(), quiet(), format!("http://127.0.0.1:{port}/"), "x.gz", &"0".repeat(64)));
        server.open();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !matches!(server.status(), State::Failed { .. }) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(matches!(server.status(), State::Failed { offline: true, .. }), "{:?}", server.status());
        assert_eq!(server.status().to_json()["offline"], true);
        // Asking again starts again.
        while server.busy.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!matches!(server.open(), State::Running { .. }));
    }

    #[test]
    fn its_registration_token_is_kept_and_only_this_computer_builds_are_known() {
        let dir = tempfile::tempdir().unwrap();
        let server = Homeserver::serving(dir.path().to_owned(), quiet(), String::new(), "x.gz", "y");
        let token = server.token().unwrap();
        assert_eq!(token.len(), 48);
        assert_eq!(server.token().unwrap(), token);
        assert!(BUILDS.iter().all(|(_, file, _)| file.starts_with(PROGRAM)));
    }
}
