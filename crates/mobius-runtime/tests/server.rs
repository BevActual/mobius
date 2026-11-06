#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use mobius_runtime::server::{LaunchSpec, Runtime, RuntimeError, State, build_args, free_port, locate_binary};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const FAKE: &str = env!("CARGO_BIN_EXE_mobius-fake-llama");

fn model_file(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mobius-server-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, b"gguf").unwrap();
    path
}
fn spec(env: &[(&str, &str)]) -> LaunchSpec {
    LaunchSpec {
        binary: PathBuf::from(FAKE),
        model: model_file("fake-Q4_K_M.gguf"),
        projector: None,
        port: free_port().unwrap(),
        context: 8192,
        gpu_layers: 99,
        extra_env: env.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect(),
    }
}
fn wait_for(runtime: &mut Runtime, want: impl Fn(&State) -> bool) -> State {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let state = runtime.poll();
        if want(&state) || Instant::now() > deadline {
            return state;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
fn reachable(port: u16) -> bool {
    TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_millis(300)).is_ok()
}

#[test]
fn the_command_line_keeps_the_server_private_and_turns_on_tool_calls() {
    let mut s = spec(&[]);
    s.projector = Some(PathBuf::from("/m/mmproj-F16.gguf"));
    let args = build_args(&s);
    let at = |flag: &str| args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("{flag} missing in {args:?}"));
    assert_eq!(args[at("--host") + 1], "127.0.0.1");
    assert_eq!(args[at("--port") + 1], s.port.to_string());
    assert_eq!(args[at("-m") + 1], s.model.to_string_lossy());
    assert_eq!(args[at("-c") + 1], "8192");
    assert_eq!(args[at("-ngl") + 1], "99");
    assert_eq!(args[at("--mmproj") + 1], "/m/mmproj-F16.gguf");
    assert!(args.iter().any(|a| a == "--jinja"), "the assistant needs tool calls");
    assert!(!args.iter().any(|a| a == "0.0.0.0" || a == "::"));
    assert!(args.iter().any(|a| a == "--no-webui"), "no web page is served");
    s.projector = None;
    assert!(!build_args(&s).iter().any(|a| a == "--mmproj"));
}

#[test]
fn automatic_gpu_use_leaves_the_choice_to_the_server() {
    let mut s = spec(&[]);
    s.gpu_layers = -1;
    assert!(!build_args(&s).iter().any(|a| a == "-ngl"), "llama-server fits the model to the memory it finds when this is not set");
    s.gpu_layers = 0;
    let args = build_args(&s);
    assert_eq!(args[args.iter().position(|a| a == "-ngl").unwrap() + 1], "0", "zero means the CPU only");
}

#[test]
fn the_first_existing_program_is_chosen() {
    let real = PathBuf::from(FAKE);
    let found = locate_binary(&[PathBuf::from("/definitely/not/here"), real.clone(), PathBuf::from("/also/not")]);
    assert_eq!(found, Some(real));
    assert_eq!(locate_binary(&[PathBuf::from("/nope")]), None);
    assert_eq!(locate_binary(&[std::env::temp_dir()]), None, "a folder is not a program");
}

#[test]
fn a_server_starts_loads_then_answers_and_stops_when_told() {
    let s = spec(&[("FAKE_LLAMA_DELAY_MS", "600")]);
    let port = s.port;
    let mut runtime = Runtime::start(s).unwrap();
    assert_eq!(runtime.base_url(), format!("http://127.0.0.1:{port}/v1"));
    assert_eq!(runtime.poll(), State::Starting, "still loading the model");
    let state = wait_for(&mut runtime, |s| *s != State::Starting);
    assert_eq!(state, State::Ready);
    assert!(reachable(port));
    let reply = ureq::post(&format!("{}/chat/completions", runtime.base_url())).send_json(serde_json::json!({"model":"x","messages":[]})).unwrap();
    assert_eq!(reply.status(), 200);
    runtime.stop();
    assert_eq!(runtime.poll(), State::Stopped);
    std::thread::sleep(Duration::from_millis(200));
    assert!(!reachable(port), "the process is gone");
    runtime.stop();
}

#[test]
fn dropping_the_runtime_ends_the_process() {
    let s = spec(&[]);
    let port = s.port;
    let mut runtime = Runtime::start(s).unwrap();
    assert_eq!(wait_for(&mut runtime, |s| *s == State::Ready), State::Ready);
    drop(runtime);
    std::thread::sleep(Duration::from_millis(300));
    assert!(!reachable(port));
}

#[test]
fn a_server_that_dies_while_loading_is_reported_with_its_last_words() {
    let mut runtime = Runtime::start(spec(&[("FAKE_LLAMA_CRASH", "cudaMalloc failed: out of memory")])).unwrap();
    let state = wait_for(&mut runtime, |s| matches!(s, State::Failed(_)));
    let State::Failed(reason) = state else { panic!("expected a failure, got {state:?}") };
    assert!(reason.contains("out of memory"), "{reason}");
    assert!(reason.contains("3"), "the exit code is mentioned: {reason}");
    assert!(runtime.log_tail(10).iter().any(|l| l.contains("out of memory")));
    assert!(matches!(runtime.poll(), State::Failed(_)), "stays failed");
}

#[test]
fn a_server_that_never_gets_ready_is_given_up_on() {
    let mut s = spec(&[("FAKE_LLAMA_DELAY_MS", "60000")]);
    s.port = free_port().unwrap();
    let mut runtime = Runtime::start(s).unwrap().with_load_timeout(Duration::from_millis(400));
    let state = wait_for(&mut runtime, |s| matches!(s, State::Failed(_)));
    let State::Failed(reason) = state else { panic!("{state:?}") };
    assert!(reason.contains("ready"), "{reason}");
    assert!(!reachable(runtime_port(&runtime)), "and it is stopped, not left running");
}
fn runtime_port(r: &Runtime) -> u16 {
    r.base_url().rsplit(':').next().unwrap().trim_end_matches("/v1").parse().unwrap()
}

#[test]
fn the_log_is_kept_but_bounded() {
    let mut runtime = Runtime::start(spec(&[("FAKE_LLAMA_LOG_LINES", "1000")])).unwrap();
    wait_for(&mut runtime, |s| *s == State::Ready);
    std::thread::sleep(Duration::from_millis(300));
    let tail = runtime.log_tail(10_000);
    assert!(tail.len() <= 200, "{}", tail.len());
    assert!(tail.last().unwrap().contains("line 999") || tail.iter().any(|l| l.contains("listening")), "{:?}", tail.last());
    assert_eq!(runtime.log_tail(3).len(), 3);
}

#[test]
fn problems_are_caught_before_anything_is_started() {
    let mut missing_binary = spec(&[]);
    missing_binary.binary = PathBuf::from("/no/such/llama-server");
    assert!(matches!(Runtime::start(missing_binary), Err(RuntimeError::NoProgram(_))));
    let mut missing_model = spec(&[]);
    missing_model.model = PathBuf::from("/no/such/model.gguf");
    assert!(matches!(Runtime::start(missing_model), Err(RuntimeError::NoModel(_))));
    let mut not_gguf = spec(&[]);
    not_gguf.model = model_file("notes.txt");
    assert!(matches!(Runtime::start(not_gguf), Err(RuntimeError::NoModel(_))), "only .gguf files");
    let mut bad_ctx = spec(&[]);
    bad_ctx.context = 10;
    assert!(matches!(Runtime::start(bad_ctx), Err(RuntimeError::Setting(_))));
    let mut bad_ngl = spec(&[]);
    bad_ngl.gpu_layers = -2;
    assert!(matches!(Runtime::start(bad_ngl), Err(RuntimeError::Setting(_))));
}

#[test]
fn a_free_port_is_not_zero_and_changes() {
    let a = free_port().unwrap();
    assert!(a > 1024);
}

#[test]
fn the_process_id_is_known_while_it_runs() {
    let mut runtime = Runtime::start(spec(&[])).unwrap();
    assert!(runtime.pid().is_some_and(|p| p > 0));
    runtime.stop();
    assert_eq!(runtime.pid(), None);
}

#[test]
fn a_leftover_server_from_a_previous_run_is_stopped_but_nothing_else_is() {
    use mobius_runtime::server::{forget_pid, reap_stale, remember_pid};
    let dir = std::env::temp_dir().join(format!("mobius-reap-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("llama.pid");
    // A server that was left running: start it, remember it, and lose track of it without stopping it.
    let s = spec(&[]);
    let port = s.port;
    let mut orphan = std::process::Command::new(FAKE).args(build_args(&s)).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
    let pid = orphan.id();
    std::thread::sleep(Duration::from_millis(400));
    assert!(reachable(port));
    remember_pid(&file, pid);
    // A different program name is not touched, even though the process id matches.
    assert!(!reap_stale(&file, "definitely-not-this-name"), "never stop a process that is not ours");
    assert!(reachable(port));
    // The right name is.
    remember_pid(&file, pid);
    assert!(reap_stale(&file, "mobius-fake-llama"));
    orphan.wait().ok();
    std::thread::sleep(Duration::from_millis(200));
    assert!(!reachable(port));
    assert!(!file.exists(), "the note is removed");
    assert!(!reap_stale(&file, "mobius-fake-llama"), "nothing to do without a note");
    std::fs::write(&file, "not a number").unwrap();
    assert!(!reap_stale(&file, "mobius-fake-llama"));
    std::fs::write(&file, "99999999").unwrap();
    assert!(!reap_stale(&file, "mobius-fake-llama"), "a process that is gone is fine");
    remember_pid(&file, 1);
    forget_pid(&file);
    assert!(!file.exists());
}
