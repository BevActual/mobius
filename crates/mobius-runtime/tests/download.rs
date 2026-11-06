#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod support;
use mobius_runtime::download::{DownloadError, Options, Progress, download};
use mobius_runtime::hub::{HubClient, RepoFile};
use mobius_runtime::local::scan;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use support::{Resp, Server};

fn data(n: usize) -> Vec<u8> {
    (0..n).map(|i| (i * 31 % 251) as u8).collect()
}
fn sha(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}
fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mobius-dl-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
fn file(path: &str, bytes: &[u8]) -> RepoFile {
    RepoFile { path: path.into(), size: bytes.len() as u64, sha256: Some(sha(bytes)) }
}
fn run(server: &Server, files: &[RepoFile], dest: &std::path::Path) -> Result<Vec<PathBuf>, DownloadError> {
    let client = HubClient::new(&server.url()).unwrap();
    download(&client, "org/Model-GGUF", files, dest, &Progress::default(), &AtomicBool::new(false), &Options::default())
}
/// Serves `bytes` at the resolve address, honouring Range requests.
fn serving(path: &'static str, bytes: Vec<u8>) -> Server {
    Server::start(move |req| {
        if !req.path.starts_with(&format!("/org/Model-GGUF/resolve/main/{path}")) {
            return Resp::status(404, "no");
        }
        match req.header("range").and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.strip_suffix('-')).and_then(|n| n.parse::<usize>().ok()) {
            Some(from) if from < bytes.len() => Resp::bytes(206, bytes[from..].to_vec()).with("Content-Range", &format!("bytes {from}-{}/{}", bytes.len() - 1, bytes.len())),
            Some(_) => Resp::status(416, ""),
            None => Resp::bytes(200, bytes.clone()),
        }
    })
}

#[test]
fn a_file_is_downloaded_checked_and_found_by_the_local_scan() {
    let bytes = data(300_000);
    let server = serving("Model-Q4_K_M.gguf", bytes.clone());
    let dest = tmp("full");
    let progress = Progress::default();
    let client = HubClient::new(&server.url()).unwrap();
    let files = [file("Model-Q4_K_M.gguf", &bytes)];
    let paths = download(&client, "org/Model-GGUF", &files, &dest, &progress, &AtomicBool::new(false), &Options::default()).unwrap();
    assert_eq!(std::fs::read(&paths[0]).unwrap(), bytes);
    assert_eq!(progress.done(), 300_000);
    assert_eq!(progress.total(), 300_000);
    let found = scan(std::slice::from_ref(&dest));
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].repo.as_deref(), Some("org/Model-GGUF"));
    assert_eq!(found[0].quant.as_deref(), Some("Q4_K_M"));
    assert!(!std::fs::read_dir(paths[0].parent().unwrap()).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".part")), "no leftovers");
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn a_file_already_there_is_not_fetched_again() {
    let bytes = data(1000);
    let server = serving("M-Q4_K_M.gguf", bytes.clone());
    let dest = tmp("again");
    let files = [file("M-Q4_K_M.gguf", &bytes)];
    run(&server, &files, &dest).unwrap();
    let before = server.paths().len();
    run(&server, &files, &dest).unwrap();
    assert_eq!(server.paths().len(), before, "nothing was asked for the second time");
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn an_interrupted_download_carries_on_where_it_stopped() {
    let bytes = data(100_000);
    let server = serving("M-Q4_K_M.gguf", bytes.clone());
    let dest = tmp("resume");
    let target = dest.join("models--org--Model-GGUF/snapshots/main");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("M-Q4_K_M.gguf.part"), &bytes[..40_000]).unwrap();
    let files = [file("M-Q4_K_M.gguf", &bytes)];
    let paths = run(&server, &files, &dest).unwrap();
    assert_eq!(std::fs::read(&paths[0]).unwrap(), bytes);
    let seen = server.seen.lock().unwrap();
    assert_eq!(seen[0].header("range"), Some("bytes=40000-"));
    drop(seen);
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn a_server_that_ignores_the_resume_request_still_gives_a_correct_file() {
    let bytes = data(50_000);
    let copy = bytes.clone();
    let server = Server::start(move |_| Resp::bytes(200, copy.clone()));
    let dest = tmp("norange");
    let target = dest.join("models--org--Model-GGUF/snapshots/main");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("M-Q4_K_M.gguf.part"), &bytes[..10_000]).unwrap();
    let paths = run(&server, &[file("M-Q4_K_M.gguf", &bytes)], &dest).unwrap();
    assert_eq!(std::fs::read(&paths[0]).unwrap(), bytes, "started over rather than gluing the whole file onto the start");
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn a_corrupt_download_is_refused_and_removed() {
    let bytes = data(20_000);
    let mut wrong = bytes.clone();
    wrong[500] ^= 0xFF;
    let server = serving("M-Q4_K_M.gguf", wrong);
    let dest = tmp("corrupt");
    let err = run(&server, &[file("M-Q4_K_M.gguf", &bytes)], &dest).unwrap_err();
    assert!(matches!(err, DownloadError::Corrupt(_)), "{err:?}");
    assert!(scan(std::slice::from_ref(&dest)).is_empty());
    assert!(!std::fs::read_dir(&dest).unwrap().flatten().any(|e| walk_has_part(&e.path())), "not even a partial file stays");
    std::fs::remove_dir_all(dest).ok();
}
fn walk_has_part(path: &std::path::Path) -> bool {
    if path.is_dir() {
        std::fs::read_dir(path).unwrap().flatten().any(|e| walk_has_part(&e.path()))
    } else {
        path.extension().is_some_and(|e| e == "part" || e == "gguf")
    }
}

#[test]
fn a_file_of_the_wrong_length_is_refused() {
    let bytes = data(20_000);
    let server = serving("M-Q4_K_M.gguf", bytes[..15_000].to_vec());
    let dest = tmp("short");
    let err = run(&server, &[file("M-Q4_K_M.gguf", &bytes)], &dest).unwrap_err();
    assert!(matches!(err, DownloadError::Corrupt(_) | DownloadError::Network(_)), "{err:?}");
    assert!(scan(std::slice::from_ref(&dest)).is_empty());
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn files_split_into_parts_are_all_fetched() {
    let a = data(30_000);
    let b = data(20_000);
    let (ac, bc) = (a.clone(), b.clone());
    let server = Server::start(move |req| {
        if req.path.contains("-00001-of-00002") { Resp::bytes(200, ac.clone()) } else if req.path.contains("-00002-of-00002") { Resp::bytes(200, bc.clone()) } else { Resp::status(404, "") }
    });
    let dest = tmp("shards");
    let files = [file("M-Q4_K_M-00001-of-00002.gguf", &a), file("M-Q4_K_M-00002-of-00002.gguf", &b)];
    let progress = Progress::default();
    let client = HubClient::new(&server.url()).unwrap();
    download(&client, "org/Model-GGUF", &files, &dest, &progress, &AtomicBool::new(false), &Options::default()).unwrap();
    assert_eq!(progress.total(), 50_000);
    assert_eq!(progress.done(), 50_000);
    let found = scan(std::slice::from_ref(&dest));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].size, 50_000);
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn a_download_can_be_cancelled_and_picked_up_later() {
    let bytes = data(4_000_000);
    let copy = bytes.clone();
    let server = Server::start(move |_| Resp::bytes(200, copy.clone()));
    let dest = tmp("cancel");
    let cancel = Arc::new(AtomicBool::new(false));
    cancel.store(true, Ordering::SeqCst);
    let client = HubClient::new(&server.url()).unwrap();
    let err = download(&client, "org/Model-GGUF", &[file("M-Q4_K_M.gguf", &bytes)], &dest, &Progress::default(), &cancel, &Options::default()).unwrap_err();
    assert!(matches!(err, DownloadError::Cancelled), "{err:?}");
    assert!(scan(std::slice::from_ref(&dest)).is_empty());
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn nothing_is_fetched_when_the_disk_is_too_full() {
    let bytes = data(10_000);
    let server = serving("M-Q4_K_M.gguf", bytes.clone());
    let dest = tmp("space");
    let client = HubClient::new(&server.url()).unwrap();
    let options = Options { available_space: Some(5_000) };
    let err = download(&client, "org/Model-GGUF", &[file("M-Q4_K_M.gguf", &bytes)], &dest, &Progress::default(), &AtomicBool::new(false), &options).unwrap_err();
    assert!(matches!(err, DownloadError::NoSpace { .. }), "{err:?}");
    assert!(server.paths().is_empty());
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn names_that_could_escape_the_folder_are_refused() {
    let server = Server::start(|_| Resp::bytes(200, vec![1, 2, 3]));
    let dest = tmp("escape");
    let client = HubClient::new(&server.url()).unwrap();
    for (repo, path) in [("../x/y", "a.gguf"), ("org/Model-GGUF", "../evil.gguf"), ("org/Model-GGUF", "/abs.gguf"), ("org/Model-GGUF", "a\\b.gguf"), ("org/Model-GGUF", "notmodel.exe"), ("org/Model-GGUF", "")] {
        let files = [RepoFile { path: path.into(), size: 3, sha256: None }];
        let err = download(&client, repo, &files, &dest, &Progress::default(), &AtomicBool::new(false), &Options::default()).unwrap_err();
        assert!(matches!(err, DownloadError::BadName), "{repo} {path}: {err:?}");
    }
    assert!(server.paths().is_empty());
    assert!(download(&client, "org/Model-GGUF", &[], &dest, &Progress::default(), &AtomicBool::new(false), &Options::default()).is_err(), "nothing to download is an error");
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn a_redirect_to_the_content_server_is_followed() {
    let bytes = data(5000);
    let copy = bytes.clone();
    let server = Server::start(move |req| {
        if req.path.starts_with("/org/") { Resp::status(302, "").with("Location", "/cdn/blob-1") } else if req.path == "/cdn/blob-1" { Resp::bytes(200, copy.clone()) } else { Resp::status(404, "") }
    });
    let dest = tmp("redirect");
    let paths = run(&server, &[file("M-Q4_K_M.gguf", &bytes)], &dest).unwrap();
    assert_eq!(std::fs::read(&paths[0]).unwrap(), bytes);
    std::fs::remove_dir_all(dest).ok();
}

#[test]
fn http_errors_are_reported() {
    let server = Server::start(|_| Resp::status(404, "gone"));
    let dest = tmp("404");
    let err = run(&server, &[file("M-Q4_K_M.gguf", &data(10))], &dest).unwrap_err();
    assert!(matches!(err, DownloadError::Status(404)), "{err:?}");
    std::fs::remove_dir_all(dest).ok();
}

/// A server that sends the file slowly, so there is time to change one's mind part way through.
fn slow_server(bytes: Vec<u8>) -> (String, Arc<AtomicBool>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        while !stop2.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            };
            let bytes = bytes.clone();
            std::thread::spawn(move || {
                stream.set_nonblocking(false).ok();
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
                for chunk in bytes.chunks(64 * 1024) {
                    if stream.write_all(chunk).is_err() {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(60));
                }
            });
        }
    });
    (url, stop)
}

#[test]
fn cancelling_part_way_stops_at_once_keeps_the_piece_and_can_be_finished_later() {
    let bytes = data(2_000_000);
    let (url, stop) = slow_server(bytes.clone());
    let dest = tmp("midway");
    let client = HubClient::new(&url).unwrap();
    let files = [file("M-Q4_K_M.gguf", &bytes)];
    let progress = Arc::new(Progress::default());
    let cancel = Arc::new(AtomicBool::new(false));
    let watcher = {
        let (progress, cancel) = (progress.clone(), cancel.clone());
        std::thread::spawn(move || {
            while progress.done() == 0 {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            cancel.store(true, Ordering::SeqCst);
        })
    };
    let started = std::time::Instant::now();
    let err = download(&client, "org/Model-GGUF", &files, &dest, &progress, &cancel, &Options::default()).unwrap_err();
    watcher.join().unwrap();
    assert!(matches!(err, DownloadError::Cancelled), "{err:?}");
    assert!(started.elapsed() < std::time::Duration::from_millis(1500), "it stopped long before the 2 second transfer finished");
    assert!(progress.done() < 2_000_000);
    assert!(scan(std::slice::from_ref(&dest)).is_empty(), "a piece is not a model");
    let part = dest.join("models--org--Model-GGUF/snapshots/main/M-Q4_K_M.gguf.part");
    assert!(part.is_file(), "the piece is kept so the download can carry on");

    let paths = download(&client, "org/Model-GGUF", &files, &dest, &Progress::default(), &AtomicBool::new(false), &Options::default()).unwrap();
    assert_eq!(std::fs::read(&paths[0]).unwrap(), bytes);
    stop.store(true, Ordering::SeqCst);
    std::fs::remove_dir_all(dest).ok();
}
