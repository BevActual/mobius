//! The dev bridge: the real host behind a small web server on this computer, so the interface runs in a plain
//! browser against it (`npm run e2e:local`, docs/developers/testing.md). The interface talks to the shell through one
//! command, `bridge`, and listens for events; here the same two go over HTTP instead (a stand-in for Tauri's internals
//! is put in the page by the test harness, `e2e/dev-bridge.ts`).
//!
//! Development only. It is behind the `dev-bridge` feature, which nothing that ships turns on, and a release build
//! with it refuses to compile; the release workflow checks the installed program for [`MARKER`] as well. It listens
//! on 127.0.0.1 alone and answers only requests that carry its token, a random one for each start.

#[cfg(not(debug_assertions))]
compile_error!("The dev bridge is for development builds only: a release build must never contain it.");

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};

use crate::Bridge;
use crate::bridge::Emit;

/// Found in any program that holds the dev bridge: the release workflow fails if the installed program has it.
pub const MARKER: &str = "mobius-dev-bridge-0f3c";

/// Whoever is listening for events: each open event stream.
#[derive(Default)]
pub struct Hub {
    streams: Mutex<Vec<Sender<String>>>,
}

impl Hub {
    /// What the host calls to send an event: every open stream gets it.
    #[must_use]
    pub fn emit(self: &Arc<Self>) -> Emit {
        let hub = self.clone();
        Arc::new(move |event, payload| {
            let line = json!({ "event": event, "payload": payload }).to_string();
            hub.streams.lock().unwrap_or_else(PoisonError::into_inner).retain(|stream| stream.send(line.clone()).is_ok());
        })
    }
}

/// Where the server listens, and the token every request must carry.
pub struct Address {
    pub port: u16,
    pub token: String,
}

/// Starts the server on a free port of 127.0.0.1. Each connection gets a thread of its own: a call can wait on the
/// core a long time, and an event stream stays open.
///
/// # Errors
/// When no port can be had.
pub fn serve(bridge: Arc<Bridge>, hub: Arc<Hub>) -> std::io::Result<Address> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let expected = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (bridge, hub, token) = (bridge.clone(), hub.clone(), expected.clone());
            std::thread::spawn(move || {
                let _ = answer(stream, &bridge, &hub, &token);
            });
        }
    });
    Ok(Address { port, token })
}

struct Request {
    method: String,
    path: String,
    query: String,
    origin: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> std::io::Result<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_owned();
    let target = parts.next().unwrap_or("").to_owned();
    let (path, query) = target.split_once('?').map_or((target.clone(), String::new()), |(p, q)| (p.to_owned(), q.to_owned()));
    let (mut length, mut origin) = (0usize, None);
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "content-length" => length = value.trim().parse().unwrap_or(0),
                "origin" => origin = Some(value.trim().to_owned()),
                _ => {}
            }
        }
    }
    let mut body = vec![0; length.min(64 << 20)];
    reader.read_exact(&mut body)?;
    Ok(Request { method, path, query, origin, body })
}

/// Only a page on this computer may call: its origin is echoed back so the browser lets it read the answer.
fn local_origin(origin: Option<&str>) -> Option<&str> {
    let origin = origin?;
    let host = origin.strip_prefix("http://")?.split(':').next()?;
    matches!(host, "127.0.0.1" | "localhost").then_some(origin)
}

fn answer(mut stream: TcpStream, bridge: &Bridge, hub: &Hub, token: &str) -> std::io::Result<()> {
    let request = read_request(&stream)?;
    let allow = local_origin(request.origin.as_deref()).map(|o| format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\n")).unwrap_or_default();
    let carried = request.query.split('&').find_map(|pair| pair.strip_prefix("t=")).unwrap_or("");
    if (request.origin.is_some() && allow.is_empty()) || carried != token {
        return stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    match (request.method.as_str(), request.path.as_str()) {
        // One call through the host's door, as the shell's `bridge` command makes it.
        ("POST", "/bridge") => {
            let asked: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
            let namespace = asked["namespace"].as_str().unwrap_or("");
            let method = asked["method"].as_str().unwrap_or("");
            let args = asked["args"].as_array().cloned().unwrap_or_default();
            let reply = match bridge.call(namespace, method, &args) {
                Ok(value) => json!({ "ok": value }),
                Err(e) => json!({ "error": { "kind": e.kind(), "message": e.message() } }),
            };
            let body = reply.to_string();
            write!(stream, "HTTP/1.1 200 OK\r\n{allow}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
        }
        // The host's events, one per message, for as long as the page keeps the stream open.
        ("GET", "/events") => {
            let (send, receive) = channel();
            hub.streams.lock().unwrap_or_else(PoisonError::into_inner).push(send);
            write!(stream, "HTTP/1.1 200 OK\r\n{allow}Content-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n: open\n\n")?;
            stream.flush()?;
            for line in receive {
                write!(stream, "data: {line}\n\n")?;
                stream.flush()?;
            }
            Ok(())
        }
        _ => stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::local_origin;

    #[test]
    fn only_a_page_on_this_computer_may_call() {
        assert_eq!(local_origin(Some("http://127.0.0.1:5199")), Some("http://127.0.0.1:5199"));
        assert_eq!(local_origin(Some("http://localhost:5199")), Some("http://localhost:5199"));
        assert_eq!(local_origin(Some("https://example.com")), None);
        assert_eq!(local_origin(Some("http://127.0.0.1.example.com")), None);
        assert_eq!(local_origin(None), None);
    }
}
