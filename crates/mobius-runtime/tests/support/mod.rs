#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! A tiny local HTTP server for tests: a closure decides every answer.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
}
impl Req {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}
pub struct Resp {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}
impl Resp {
    pub fn json(body: &str) -> Resp {
        Resp { status: 200, headers: vec![("Content-Type".into(), "application/json".into())], body: body.as_bytes().to_vec() }
    }
    pub fn status(status: u16, body: &str) -> Resp {
        Resp { status, headers: vec![], body: body.as_bytes().to_vec() }
    }
    pub fn bytes(status: u16, body: Vec<u8>) -> Resp {
        Resp { status, headers: vec![], body }
    }
    pub fn with(mut self, k: &str, v: &str) -> Resp {
        self.headers.push((k.into(), v.into()));
        self
    }
}

pub struct Server {
    pub addr: SocketAddr,
    pub seen: Arc<Mutex<Vec<Req>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Server {
    pub fn start(handler: impl Fn(&Req) -> Resp + Send + Sync + 'static) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (s2, st2) = (seen.clone(), stop.clone());
        let handler = Arc::new(handler);
        let thread = std::thread::spawn(move || {
            while !st2.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (h, s) = (handler.clone(), s2.clone());
                        std::thread::spawn(move || serve(stream, &*h, &s));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        Server { addr, seen, stop, thread: Some(thread) }
    }
    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }
    pub fn paths(&self) -> Vec<String> {
        self.seen.lock().unwrap().iter().map(|r| r.path.clone()).collect()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            t.join().ok();
        }
    }
}

fn serve(mut stream: TcpStream, handler: &dyn Fn(&Req) -> Resp, seen: &Mutex<Vec<Req>>) {
    stream.set_nonblocking(false).ok();
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let Ok(n) = stream.read(&mut chunk) else { return };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("").to_owned();
    let path = first.next().unwrap_or("").to_owned();
    let headers = lines.take_while(|l| !l.is_empty()).filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned())).collect();
    let req = Req { method, path, headers };
    seen.lock().unwrap().push(req.clone());
    let resp = handler(&req);
    let mut out = format!("HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n", resp.status, resp.body.len());
    for (k, v) in &resp.headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes()).ok();
    stream.write_all(&resp.body).ok();
}
