//! A stand-in for `llama-server` used by tests. It speaks just enough HTTP.
//!
//! FAKE_LLAMA_DELAY_MS   answers /health with 503 for this long
//! FAKE_LLAMA_CRASH      prints this and exits with code 3
//! FAKE_LLAMA_LOG_LINES  prints this many log lines first
#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    if let Ok(message) = std::env::var("FAKE_LLAMA_CRASH") {
        eprintln!("{message}");
        std::process::exit(3);
    }
    if value("--host").as_deref() != Some("127.0.0.1") {
        eprintln!("refusing to listen anywhere but 127.0.0.1");
        std::process::exit(2);
    }
    let port: u16 = value("--port").and_then(|p| p.parse().ok()).unwrap_or(0);
    let lines: u32 = std::env::var("FAKE_LLAMA_LOG_LINES").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    for n in 0..lines {
        eprintln!("log line {n}");
    }
    let delay = Duration::from_millis(std::env::var("FAKE_LLAMA_DELAY_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(0));
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
    eprintln!("context={}", value("-c").unwrap_or_default());
    eprintln!("listening on 127.0.0.1:{port}");
    let started = Instant::now();
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
        let mut data = Vec::new();
        let mut buf = [0u8; 4096];
        // Read the whole request, body included, so closing does not reset the connection.
        loop {
            let n = stream.read(&mut buf).unwrap_or(0);
            data.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&data).into_owned();
            let Some(end) = text.find("\r\n\r\n") else {
                if n == 0 { break } else { continue }
            };
            let length = text[..end].lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
            if data.len() >= end + 4 + length || n == 0 {
                break;
            }
        }
        let head = String::from_utf8_lossy(&data).into_owned();
        let (status, body) = if head.starts_with("GET /health") {
            if started.elapsed() < delay { ("503 Service Unavailable", r#"{"error":{"message":"Loading model"}}"#) } else { ("200 OK", r#"{"status":"ok"}"#) }
        } else if head.starts_with("POST /v1/chat/completions") {
            ("200 OK", r#"{"choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}"#)
        } else {
            ("404 Not Found", "{}")
        };
        let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    }
}
