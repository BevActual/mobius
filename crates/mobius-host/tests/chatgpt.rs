#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! ChatGPT sign-in against a pretend OpenAI: the device code, the wait, the token exchange, refreshing, signing out.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mobius_host::chatgpt::{ChatGpt, SECRET, expires_at};
use mobius_host::secrets::{MemorySecrets, Secrets};
use serde_json::{Value, json};

pub fn jwt(claims: &Value) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bytes = claims.to_string().into_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |a, (i, b)| a | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    format!("h.{out}.s")
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

struct OpenAi {
    url: String,
    seen: Arc<Mutex<Vec<(String, String)>>>,
    refreshes: Arc<AtomicUsize>,
}

/// `pending_polls`: how many polls say "not yet" before the person has entered the code.
fn openai(pending_polls: usize, access_life: i64) -> OpenAi {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let (log, count) = (seen.clone(), refreshes.clone());
    std::thread::spawn(move || {
        let mut polls = 0;
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let mut data = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = s.read(&mut buf).unwrap_or(0);
                data.extend_from_slice(&buf[..n]);
                let t = String::from_utf8_lossy(&data).to_string();
                if let Some(end) = t.find("\r\n\r\n") {
                    let len = t.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    if data.len() >= end + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&data).to_string();
            let path = text.split_whitespace().nth(1).unwrap_or("").to_owned();
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_owned();
            log.lock().unwrap().push((path.clone(), body.clone()));
            let exp = (i64::try_from(now()).unwrap() + access_life).max(0);
            let access = |n: usize| jwt(&json!({ "exp": exp, "n": n, "https://api.openai.com/auth": { "chatgpt_account_id": "acct-7" } }));
            let (status, reply) = match path.as_str() {
                "/api/accounts/deviceauth/usercode" => (200, json!({ "device_auth_id": "dev-1", "user_code": "ABCD-1234", "interval": "1" })),
                "/api/accounts/deviceauth/token" => {
                    polls += 1;
                    if polls <= pending_polls { (403, json!({})) } else { (200, json!({ "authorization_code": "auth-code", "code_verifier": "verifier" })) }
                }
                "/oauth/token" if body.contains("grant_type=authorization_code") => (200, json!({ "access_token": access(0), "refresh_token": "refresh-1", "id_token": jwt(&json!({ "email": "me@example.com" })) })),
                "/oauth/token" if body.contains("refresh_token=refresh-1") => {
                    let n = count.fetch_add(1, Ordering::SeqCst) + 1;
                    (200, json!({ "access_token": access(n), "refresh_token": "refresh-2" }))
                }
                "/oauth/token" => (401, json!({ "error": "invalid_grant" })),
                _ => (404, json!({})),
            };
            let reply = reply.to_string();
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    OpenAi { url, seen, refreshes }
}

fn service(o: &OpenAi) -> (Arc<ChatGpt>, Arc<MemorySecrets>) {
    let secrets = Arc::new(MemorySecrets::new(true));
    (Arc::new(ChatGpt::new(&o.url, secrets.clone()).with_poll(Duration::from_millis(50))), secrets)
}

fn sign_in(c: &Arc<ChatGpt>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    assert_eq!(pending.code, "ABCD-1234");
    rx.recv_timeout(Duration::from_secs(10)).unwrap()
}

#[test]
fn the_device_code_sign_in_keeps_the_tokens_in_the_secret_store_only() {
    let o = openai(2, 3600);
    let (c, secrets) = service(&o);
    assert_eq!(c.status()["signedIn"], false);
    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    assert!(pending.url.ends_with("/codex/device"));
    assert_eq!(c.status()["pending"]["code"], "ABCD-1234", "the code is shown while waiting");
    assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), Ok(()));
    let status = c.status();
    assert_eq!((status["signedIn"].clone(), status["account"].clone(), status["pending"].clone()), (json!(true), json!("me@example.com"), Value::Null));
    assert!(secrets.get(SECRET).unwrap().contains("refresh-1"));
    // The exchange used the verifier OpenAI gave, the device callback and the Codex client.
    let seen = o.seen.lock().unwrap().clone();
    let exchange = &seen.iter().find(|(p, b)| p == "/oauth/token" && b.contains("authorization_code")).unwrap().1;
    for part in ["code=auth-code", "code_verifier=verifier", "client_id=app_EMoamEEZ73f0CkXaXp7hrann", "redirect_uri=http"] {
        assert!(exchange.contains(part), "{part} in {exchange}");
    }
    // A fresh token is used as it is.
    assert!(c.access_token().unwrap().is_some());
    assert_eq!(o.refreshes.load(Ordering::SeqCst), 0);
    c.sign_out();
    assert_eq!(c.status()["signedIn"], false);
    assert!(secrets.get(SECRET).is_none());
    assert_eq!(c.access_token(), Ok(None));
}

#[test]
fn a_token_about_to_run_out_is_refreshed_once_and_the_new_refresh_token_is_kept() {
    let o = openai(0, 60);
    let (c, secrets) = service(&o);
    sign_in(&c).unwrap();
    assert!(c.needs_refresh());
    let first = c.access_token().unwrap().unwrap();
    assert_eq!(o.refreshes.load(Ordering::SeqCst), 1);
    assert!(expires_at(&first).is_some());
    assert!(secrets.get(SECRET).unwrap().contains("refresh-2"), "the rotated refresh token replaces the old one");
    // The rotated token is what the next refresh uses; the pretend OpenAI refuses the old one, as OpenAI does.
    assert_eq!(c.access_token(), Err("The ChatGPT sign-in has expired. Sign in again in Settings.".into()));
}

#[test]
fn a_sign_in_can_be_cancelled_and_nothing_is_kept() {
    let o = openai(1_000, 3600);
    let (c, secrets) = service(&o);
    let (tx, rx) = mpsc::channel();
    c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    // Asking again while waiting shows the same code instead of starting over.
    assert_eq!(c.start_sign_in(Arc::new(|_| {})).unwrap().code, "ABCD-1234");
    c.cancel_sign_in();
    assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), Err("cancelled".into()));
    assert!(secrets.get(SECRET).is_none());
    assert!(c.status()["pending"].is_null() && c.status()["hint"].is_null());
}
