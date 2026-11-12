#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Installing the engine from a pretend GitHub: the real download, checksum, unpack and switch-over code.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use mobius_runtime::download::Progress;
use mobius_runtime::engine::{Backend, EngineError, devices, fetch_releases, install, installed, plan};
use sha2::{Digest, Sha256};

fn temp(label: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("mobius-engine-it-{label}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&d).unwrap();
    d
}

fn zip_of(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn sha(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// Serves `/releases` and `/download/<tag>/<name>`. `lie` makes the listed checksum of every file wrong.
fn github(tag: &str, files: Vec<(String, Vec<u8>)>, lie: bool) -> (String, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let prefix = format!("{origin}/download/");
    let assets: Vec<serde_json::Value> = files
        .iter()
        .map(|(name, data)| serde_json::json!({ "name": name, "size": data.len(), "browser_download_url": format!("{prefix}{tag}/{name}"), "digest": format!("sha256:{}", if lie { "0".repeat(64) } else { sha(data) }) }))
        .collect();
    let listing = serde_json::json!([{ "tag_name": "v0.9.0", "assets": [] }, { "tag_name": tag, "assets": assets }]).to_string();
    let tag = tag.to_owned();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let mut buf = [0u8; 4096];
            let n = s.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = head.split_whitespace().nth(1).unwrap_or("").to_owned();
            let body: Vec<u8> = if path == "/releases" {
                listing.clone().into_bytes()
            } else if let Some((_, data)) = files.iter().find(|(name, _)| path == format!("/download/{tag}/{name}")) {
                data.clone()
            } else {
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                continue;
            };
            let _ = write!(s, "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
            let _ = s.write_all(&body);
        }
    });
    (format!("{origin}/releases"), prefix)
}

fn fake_server() -> Vec<u8> {
    fs::read(env!("CARGO_BIN_EXE_mobius-fake-llama")).unwrap()
}

/// The server's file name on this system: the install looks for the one it can run.
const SERVER: &str = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

fn cuda_build(tag: &str) -> Vec<(String, Vec<u8>)> {
    vec![
        (format!("llama-{tag}-bin-win-cuda-12.4-x64.zip"), zip_of(&[(SERVER, fake_server()), ("ggml-cuda.dll", b"cuda".to_vec())])),
        ("cudart-llama-bin-win-cuda-12.4-x64.zip".into(), zip_of(&[("cudart64_12.dll", b"rt".to_vec())])),
    ]
}

fn plan_from(url: &str, prefix: &str) -> mobius_runtime::engine::Plan {
    plan(&fetch_releases(url).unwrap(), "win", Backend::Cuda12, prefix).unwrap()
}

#[test]
fn a_build_is_downloaded_checked_unpacked_and_used_and_the_old_one_goes() {
    let (url, prefix) = github("b200", cuda_build("b200"), false);
    let dir = temp("ok");
    // An older engine is there from before.
    fs::create_dir_all(dir.join("b100-cuda-12")).unwrap();
    let p = plan_from(&url, &prefix);
    assert_eq!(p.tag, "b200");
    let progress = Progress::default();
    let got = install(&p, &dir, &progress, &AtomicBool::new(false), None).unwrap();
    assert_eq!((got.tag.as_str(), got.backend), ("b200", Backend::Cuda12));
    assert_eq!(installed(&dir), Some(got.clone()));
    assert!(got.server.parent().unwrap().join("cudart64_12.dll").is_file(), "the CUDA runtime sits next to the program");
    assert_eq!(progress.done(), p.size());
    assert!(!dir.join("b100-cuda-12").exists(), "the old engine was removed");
    assert!(fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".download")), "no downloads are left behind");
    // The engine reports the card it can use, and that is remembered.
    assert_eq!(devices(&got.server), ["CUDA0: Fake GPU (12282 MiB, 11000 MiB free)"]);
    assert_eq!(got.devices, ["CUDA0: Fake GPU (12282 MiB, 11000 MiB free)"]);
    // A device list that came back empty is asked for again and remembered.
    let mut forgot = installed(&dir).unwrap();
    forgot.devices.clear();
    fs::write(dir.join("current.json"), serde_json::to_string(&forgot).unwrap()).unwrap();
    assert!(installed(&dir).unwrap().devices.is_empty());
    assert_eq!(mobius_runtime::engine::recheck(&dir).unwrap().devices.len(), 1);
    assert_eq!(installed(&dir).unwrap().devices.len(), 1);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_file_that_does_not_match_its_checksum_is_never_used_and_the_engine_in_use_stays() {
    let (good_url, good_prefix) = github("b100", cuda_build("b100"), false);
    let dir = temp("lie");
    let before = install(&plan_from(&good_url, &good_prefix), &dir, &Progress::default(), &AtomicBool::new(false), None).unwrap();
    let (url, prefix) = github("b200", cuda_build("b200"), true);
    let err = install(&plan_from(&url, &prefix), &dir, &Progress::default(), &AtomicBool::new(false), None).unwrap_err();
    assert!(matches!(err, EngineError::Corrupt(_)), "{err:?}");
    assert_eq!(installed(&dir), Some(before), "still the earlier engine");
    assert!(!dir.join("b200-cuda-12").exists() && !dir.join("b200-cuda-12.part").exists());
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_build_without_the_program_is_refused() {
    let tag = "b300";
    let files = vec![
        (format!("llama-{tag}-bin-win-cuda-12.4-x64.zip"), zip_of(&[("readme.txt", b"no program".to_vec())])),
        ("cudart-llama-bin-win-cuda-12.4-x64.zip".into(), zip_of(&[("cudart64_12.dll", b"rt".to_vec())])),
    ];
    let (url, prefix) = github(tag, files, false);
    let dir = temp("empty");
    assert!(matches!(install(&plan_from(&url, &prefix), &dir, &Progress::default(), &AtomicBool::new(false), None), Err(EngineError::Corrupt(_))));
    assert_eq!(installed(&dir), None);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn cancelling_or_too_little_space_installs_nothing() {
    let (url, prefix) = github("b400", cuda_build("b400"), false);
    let dir = temp("cancel");
    let p = plan_from(&url, &prefix);
    assert_eq!(install(&p, &dir, &Progress::default(), &AtomicBool::new(true), None), Err(EngineError::Cancelled));
    assert!(matches!(install(&p, &dir, &Progress::default(), &AtomicBool::new(false), Some(10)), Err(EngineError::NoSpace { .. })));
    assert_eq!(installed(&dir), None);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_remembered_engine_outside_its_folder_is_not_trusted() {
    let dir = temp("outside");
    let elsewhere = temp("elsewhere");
    let program = elsewhere.join("llama-server.exe");
    File::create(&program).unwrap();
    fs::write(dir.join("current.json"), serde_json::json!({ "tag": "b1", "backend": "cpu", "server": program, "devices": [] }).to_string()).unwrap();
    assert_eq!(installed(&dir), None);
    fs::write(dir.join("current.json"), "not json").unwrap();
    assert_eq!(installed(&dir), None);
    fs::remove_dir_all(&dir).ok();
    fs::remove_dir_all(&elsewhere).ok();
}

/// The installed engine on this computer: `MOBIUS_ENGINE_SERVER=<path> cargo test -p mobius-runtime --test engine -- --ignored live`.
#[test]
#[ignore = "needs a real engine"]
fn live_devices_of_a_real_engine() {
    let server = PathBuf::from(std::env::var("MOBIUS_ENGINE_SERVER").unwrap());
    let started = std::time::Instant::now();
    let found = devices(&server);
    eprintln!("devices {found:?} in {:?}", started.elapsed());
    assert!(!found.is_empty());
}
