#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Sign in with ChatGPT against a pretend OpenAI: registering, the browser coming back, the token exchange and its
//! checks, refreshing, the account's models, signing out.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mobius_host::chatgpt::{ChatGpt, REGISTRATION, SECRET, expires_at};
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
    /// The nonce the sign-in sent, which the pretend ID token carries back.
    nonce: Arc<Mutex<String>>,
}

/// `scope`: what the pretend OpenAI grants.
fn openai(access_life: i64, scope: &'static str) -> OpenAi {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let refreshes = Arc::new(AtomicUsize::new(0));
    let nonce = Arc::new(Mutex::new(String::new()));
    let (log, count, said, issuer) = (seen.clone(), refreshes.clone(), nonce.clone(), url.clone());
    std::thread::spawn(move || {
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
            let access = |n: usize| jwt(&json!({ "exp": exp, "n": n }));
            let id = || jwt(&json!({ "iss": issuer, "aud": "oaiapp_test", "exp": now() + 3600, "nonce": *said.lock().unwrap(), "email": "me@example.com" }));
            let (status, reply) = match path.as_str() {
                "/api/accounts/oauth/token" if body.contains("grant_type=authorization_code") && body.contains("client_id=oaiapp_test") => {
                    (200, json!({ "access_token": access(0), "refresh_token": "refresh-1", "id_token": id(), "scope": scope, "expires_in": 3600 }))
                }
                "/api/accounts/oauth/token" if body.contains("refresh_token=refresh-1") => {
                    let n = count.fetch_add(1, Ordering::SeqCst) + 1;
                    (200, json!({ "access_token": access(n), "refresh_token": "refresh-2" }))
                }
                "/api/accounts/oauth/token" => (400, json!({ "error": "invalid_grant" })),
                "/v1/models" => (200, json!({ "models": [{ "slug": "gpt-6.1-sol", "visibility": "list" }, { "slug": "hidden-model", "visibility": "hide" }] })),
                "/.well-known/openid-configuration" => (200, json!({ "revocation_endpoint": format!("{issuer}/oauth/revoke") })),
                "/oauth/revoke" => (200, json!({})),
                _ => (404, json!({})),
            };
            let reply = reply.to_string();
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    OpenAi { url, seen, refreshes, nonce }
}

fn service(o: &OpenAi) -> (Arc<ChatGpt>, Arc<MemorySecrets>) {
    let secrets = Arc::new(MemorySecrets::new(true));
    (Arc::new(ChatGpt::new(&o.url, &format!("{}/v1", o.url), secrets.clone())), secrets)
}

fn param(url: &str, name: &str) -> Option<String> {
    url::Url::parse(url).unwrap().query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned())
}

/// The browser coming back to Mobius, as OpenAI sends it after the person signs in.
fn come_back(url: &str, extra: &str) -> u16 {
    let back = format!("{}?code=auth-code&state={}{extra}", param(url, "redirect_uri").unwrap(), param(url, "state").unwrap());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    agent.get(&back).call().unwrap().status().as_u16()
}

fn sign_in(o: &OpenAi, c: &Arc<ChatGpt>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    *o.nonce.lock().unwrap() = param(&pending.url, "nonce").unwrap();
    come_back(&pending.url, "&client_id=oaiapp_test");
    rx.recv_timeout(Duration::from_secs(10)).unwrap()
}

#[test]
fn signing_in_registers_mobius_and_keeps_the_tokens_in_the_secret_store_only() {
    let o = openai(3600, "openid email offline_access resource.invoke chatgpt.tokens.use.direct");
    let (c, secrets) = service(&o);
    assert_eq!(c.status()["signedIn"], false);
    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    // The first sign-in registers Mobius, for this computer, through the public API's resource, with PKCE.
    let url = &pending.url;
    assert!(url.starts_with(&format!("{}/api/accounts/authorize?", o.url)));
    for (name, value) in [("client_id", "dynamic_agent_client"), ("agent_name_hint", "Mobius"), ("response_type", "code"), ("resource", "https://api.openai.com/v1"), ("code_challenge_method", "S256")] {
        assert_eq!(param(url, name).as_deref(), Some(value), "{name}");
    }
    assert!(param(url, "scope").unwrap().split(' ').any(|s| s == "chatgpt.tokens.use.direct"));
    assert!(param(url, "ext_agent_host_id").unwrap().starts_with("urn:uuid:"));
    let redirect = param(url, "redirect_uri").unwrap();
    assert!(redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/auth/callback"), "{redirect}");
    assert_eq!(c.start_sign_in(Arc::new(|_| {})).unwrap(), pending, "asking again while waiting shows the same page");
    assert!(c.status()["pending"]["url"].is_string());

    *o.nonce.lock().unwrap() = param(url, "nonce").unwrap();
    assert_eq!(come_back(url, "&client_id=oaiapp_test"), 200);
    assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), Ok(()));
    let status = c.status();
    assert_eq!((status["signedIn"].clone(), status["account"].clone(), status["pending"].clone()), (json!(true), json!("me@example.com"), Value::Null));
    assert!(secrets.get(SECRET).unwrap().contains("refresh-1"));
    let registration: Value = serde_json::from_str(&secrets.get(REGISTRATION).unwrap()).unwrap();
    assert_eq!(registration["client_id"], "oaiapp_test");
    // The exchange used the issued client, never the registration one, and the same redirect.
    let seen = o.seen.lock().unwrap().clone();
    let exchange = &seen.iter().find(|(p, b)| p == "/api/accounts/oauth/token" && b.contains("authorization_code")).unwrap().1;
    for part in ["code=auth-code", "client_id=oaiapp_test", "code_verifier=", "redirect_uri=http", "resource=https"] {
        assert!(exchange.contains(part), "{part} in {exchange}");
    }
    assert!(!exchange.contains("dynamic_agent_client"));
    // A fresh token is used as it is, and the account's own models are listed.
    assert!(c.access_token().unwrap().is_some());
    assert_eq!(o.refreshes.load(Ordering::SeqCst), 0);
    assert_eq!(c.models(), Ok(vec!["gpt-6.1-sol".to_owned()]));

    // Signing out stops the refresh token at OpenAI and forgets it here, but keeps the registration.
    c.sign_out();
    assert_eq!(c.status()["signedIn"], false);
    assert!(secrets.get(SECRET).is_none());
    assert!(o.seen.lock().unwrap().iter().any(|(p, b)| p == "/oauth/revoke" && b.contains("token=refresh-1") && b.contains("client_id=oaiapp_test")));
    assert_eq!(c.access_token(), Ok(None));
    // Signing in again is the same app: the saved client, no new registration.
    let again = c.start_sign_in(Arc::new(|_| {})).unwrap();
    assert_eq!(param(&again.url, "client_id").as_deref(), Some("oaiapp_test"));
    assert_eq!(param(&again.url, "agent_name_hint"), None);
    assert_eq!(param(&again.url, "ext_agent_host_id"), registration["host_id"].as_str().map(str::to_owned));
    c.cancel_sign_in();
}

#[test]
fn a_wrong_nonce_a_missing_plan_scope_or_a_declined_sign_in_keep_nothing() {
    let o = openai(3600, "openid email offline_access resource.invoke chatgpt.tokens.use.direct");
    let (c, secrets) = service(&o);
    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    *o.nonce.lock().unwrap() = "someone-else".into();
    come_back(&pending.url, "&client_id=oaiapp_test");
    assert!(rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap_err().contains("did not match"));
    assert!(secrets.get(SECRET).is_none());

    let o = openai(3600, "openid email offline_access");
    let (c, secrets) = service(&o);
    assert!(sign_in(&o, &c).unwrap_err().contains("did not allow Mobius to use your plan"));
    assert!(secrets.get(SECRET).is_none());

    let (tx, rx) = mpsc::channel();
    let pending = c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    let back = format!("{}?error=access_denied&state={}", param(&pending.url, "redirect_uri").unwrap(), param(&pending.url, "state").unwrap());
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    agent.get(&back).call().unwrap();
    assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), Err("The sign-in was declined on ChatGPT.".into()));
}

#[test]
fn a_token_about_to_run_out_is_refreshed_once_and_the_new_refresh_token_is_kept() {
    let o = openai(60, "openid offline_access resource.invoke chatgpt.tokens.use.direct");
    let (c, secrets) = service(&o);
    sign_in(&o, &c).unwrap();
    assert!(c.needs_refresh());
    let first = c.access_token().unwrap().unwrap();
    assert_eq!(o.refreshes.load(Ordering::SeqCst), 1);
    assert!(expires_at(&first).is_some());
    assert!(secrets.get(SECRET).unwrap().contains("refresh-2"), "the rotated refresh token replaces the old one");
    let refresh = &o.seen.lock().unwrap().iter().rfind(|(p, b)| p == "/api/accounts/oauth/token" && b.contains("grant_type=refresh_token")).unwrap().1.clone();
    assert!(refresh.contains("client_id=oaiapp_test") && refresh.contains("resource=https"), "{refresh}");
    // The rotated token is what the next refresh uses; the pretend OpenAI refuses the old one, as OpenAI does, and
    // the sign-in is then over.
    assert_eq!(c.access_token(), Err("The ChatGPT sign-in has expired. Sign in again in Settings.".into()));
    assert_eq!(c.status()["signedIn"], false);
}

#[test]
fn a_sign_in_can_be_cancelled_and_nothing_is_kept() {
    let o = openai(3600, "chatgpt.tokens.use.direct");
    let (c, secrets) = service(&o);
    let (tx, rx) = mpsc::channel();
    c.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    c.cancel_sign_in();
    assert_eq!(rx.recv_timeout(Duration::from_secs(10)).unwrap(), Err("cancelled".into()));
    assert!(secrets.get(SECRET).is_none());
    assert!(c.status()["pending"].is_null() && c.status()["hint"].is_null());
}

#[test]
fn a_sign_in_kept_by_the_old_flow_asks_to_sign_in_again() {
    let o = openai(3600, "chatgpt.tokens.use.direct");
    let (c, secrets) = service(&o);
    secrets.put(SECRET, &json!({ "access": jwt(&json!({ "exp": now() + 3600 })), "refresh": "old" }).to_string());
    assert_eq!(c.status()["signedIn"], false);
    assert!(c.status()["hint"].as_str().unwrap().contains("Sign in again"));
    assert_eq!(c.access_token(), Ok(None), "the old tokens are never sent");
}
