//! `mobius-dev-bridge`: the real host, with its core, behind a web server on 127.0.0.1, for driving the interface in
//! a plain browser (`npm run e2e:local`). Development only: see `mobius_host::dev_bridge`.
//!
//! Reads the same settings as the shell under test (`MOBIUS_TEST`, `MOBIUS_USER_DATA`, the fake servers), starts,
//! and prints one line, `MOBIUS_DEV_BRIDGE <port> <token>`. It ends when asked to quit or when its input closes.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use mobius_host::dev_bridge::{Hub, MARKER, serve};
use mobius_host::{Bridge, CoreProcess, Options, Status};

fn main() {
    let test_mode = std::env::var("MOBIUS_TEST").is_ok_and(|v| v == "1");
    let Some(base_dir) = std::env::var_os("MOBIUS_USER_DATA").map(PathBuf::from) else {
        eprintln!("MOBIUS_USER_DATA must name the data folder to use.");
        std::process::exit(2);
    };
    if std::fs::create_dir_all(&base_dir).is_err() {
        eprintln!("Could not make {}", base_dir.display());
        std::process::exit(2);
    }
    let core_bin = std::env::var_os("MOBIUS_CORE_BIN").map_or_else(
        || {
            let name = if cfg!(windows) { "mobius-cored.exe" } else { "mobius-cored" };
            std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(name))).unwrap_or_else(|| PathBuf::from(name))
        },
        PathBuf::from,
    );
    let slot: Arc<OnceLock<Arc<Bridge>>> = Arc::new(OnceLock::new());
    let (status_slot, note_slot, request_slot) = (slot.clone(), slot.clone(), slot.clone());
    let core = Arc::new(CoreProcess::start(Options {
        binary: core_bin,
        args: mobius_host::start::core_args(&base_dir, &base_dir, test_mode),
        on_status: Arc::new(move |status: Status| {
            if let Some(b) = status_slot.get() {
                b.on_core_status(status);
            }
        }),
        on_notification: Arc::new(move |method, params| {
            if let Some(b) = note_slot.get() {
                b.on_core_notification(method, params);
            }
        }),
        on_request: Some(Arc::new(move |method, params| match request_slot.get() {
            Some(b) => b.host_request(method, params),
            None => Err("not ready".to_owned()),
        })),
        log: Arc::new(|line| eprintln!("[core] {line}")),
    }));
    let hub = Arc::new(Hub::default());
    // Secrets stay in a file in the data folder: this is never a person's own Mobius.
    let secrets = Arc::new(mobius_host::secrets::FileSecrets::new(base_dir.join("test-secrets.json")));
    let bridge = Arc::new(Bridge::new(core.clone(), base_dir.clone(), hub.emit(), secrets));
    let _ = slot.set(bridge.clone());
    bridge.start_models();
    bridge.start_schedules();
    bridge.on_core_status(core.status());
    if test_mode {
        mobius_host::start::ready_for_tests(&bridge, &core);
    }
    let stopping = core.clone();
    let quit = Arc::new(move || {
        stopping.stop_shared();
        std::process::exit(0);
    });
    bridge.set_quit(quit.clone());
    let address = match serve(bridge, hub) {
        Ok(address) => address,
        Err(e) => {
            eprintln!("Could not listen on 127.0.0.1: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("[{MARKER}] listening on 127.0.0.1:{}", address.port);
    println!("MOBIUS_DEV_BRIDGE {} {}", address.port, address.token);
    // Whoever started it holds its input open; when that closes (the test ended, or was stopped), so does this.
    let mut sink = String::new();
    while std::io::stdin().read_line(&mut sink).is_ok_and(|n| n > 0) {
        sink.clear();
    }
    quit();
}
