//! Sign-in for connectors at an address, as MCP describes it (spec 2025-06-18, "Authorization"): OAuth 2.1 with PKCE,
//! the server's sign-in found from its protected resource metadata (RFC 9728) and its authorization server's metadata
//! (RFC 8414, or OpenID's), Mobius registered with that server on the spot (RFC 7591), and the token bound to the
//! connector's address with `resource` (RFC 8707). The browser comes back to `http://127.0.0.1:<port>/callback`.
//!
//! Tokens are kept in the system secret store as `mcp:<name>`, with what refreshing them takes, and given to the
//! connector's requests by [`Kept`], which refreshes them shortly before they run out or when the server refuses one.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::dropbox::{form, lock, now, read_body};
use crate::loopback::{Callback, challenge, random_text};
use crate::secrets::Secrets;

type Res<T> = Result<T, String>;

const MAX_JSON: u64 = 1024 * 1024;
const SKEW_SECONDS: u64 = 60;
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);

/// The secret a connector's sign-in is kept under.
pub fn secret_name(server: &str) -> String {
    format!("mcp:{server}")
}

/// What a sign-in keeps: the tokens, and what refreshing them takes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Record {
    access: String,
    refresh: String,
    /// When `access` runs out, in seconds since 1970 (0: not said).
    expires: u64,
    token_endpoint: String,
    client_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    client_secret: Option<String>,
    resource: String,
}

/// An address Mobius may send a sign-in to or ask for metadata: https, or http on this computer.
fn allowed(url: &str) -> bool {
    mobius_mcp::config::is_server_url(url)
}

fn origin(url: &url::Url) -> String {
    url.origin().ascii_serialization()
}

fn http() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).max_redirects(0).timeout_global(Some(Duration::from_secs(20))).build().into()
}

fn get_json(http: &ureq::Agent, url: &str) -> Option<Value> {
    if !allowed(url) {
        return None;
    }
    let response = http.get(url).header("Accept", "application/json").header("MCP-Protocol-Version", mobius_mcp::client::PROTOCOL).call().ok()?;
    let (status, _, body) = read_body(response, MAX_JSON).ok()?;
    (status == 200).then(|| serde_json::from_slice(&body).ok()).flatten().filter(Value::is_object)
}

/// The connector's protected resource metadata: from where its 401 pointed, else the well-known places (RFC 9728 §3).
fn resource_metadata(http: &ureq::Agent, server: &url::Url, pointed: Option<&str>) -> Option<Value> {
    let path = server.path().trim_end_matches('/');
    let mut places: Vec<String> = pointed.map(str::to_owned).into_iter().collect();
    places.push(format!("{}/.well-known/oauth-protected-resource{path}", origin(server)));
    places.push(format!("{}/.well-known/oauth-protected-resource", origin(server)));
    places.iter().find_map(|p| get_json(http, p).filter(|m| m.get("authorization_servers").and_then(Value::as_array).is_some_and(|a| !a.is_empty())))
}

/// The authorization server's metadata (RFC 8414 §3, then OpenID's, with the issuer's path where it has one).
fn server_metadata(http: &ureq::Agent, issuer: &str) -> Res<Value> {
    let at = url::Url::parse(issuer).map_err(|_| "The connector named a sign-in server that isn't an address.".to_owned())?;
    let base = origin(&at);
    let path = at.path().trim_end_matches('/');
    let places = if path.is_empty() {
        vec![format!("{base}/.well-known/oauth-authorization-server"), format!("{base}/.well-known/openid-configuration")]
    } else {
        vec![format!("{base}/.well-known/oauth-authorization-server{path}"), format!("{base}/.well-known/openid-configuration{path}"), format!("{base}{path}/.well-known/openid-configuration")]
    };
    places.iter().find_map(|p| get_json(http, p)).ok_or_else(|| "The connector's sign-in server doesn't describe itself, so Mobius can't sign in to it.".to_owned())
}

/// What a sign-in needs, found from the connector: where to send the person, where to get tokens, whether Mobius can
/// register itself, the scopes, and the address the token is for.
#[derive(Debug, Clone)]
struct Plan {
    authorize: String,
    token: String,
    register: Option<String>,
    scope: Option<String>,
    resource: String,
}

fn plan(http: &ureq::Agent, server: &str, pointed: Option<&str>) -> Res<Plan> {
    let server_url = url::Url::parse(server).map_err(|_| "The connector's address isn't an address.".to_owned())?;
    let (issuer, scope, resource) = match resource_metadata(http, &server_url, pointed) {
        Some(m) => {
            let resource = m.get("resource").and_then(Value::as_str).unwrap_or(server).to_owned();
            // The metadata must be about this connector (RFC 9728 §3.3), not another site's.
            if url::Url::parse(&resource).map(|r| origin(&r)).ok() != Some(origin(&server_url)) {
                return Err("The connector's sign-in description is for another site, so Mobius won't use it.".into());
            }
            let issuer = m["authorization_servers"][0].as_str().unwrap_or("").to_owned();
            let scope = m.get("scopes_supported").and_then(Value::as_array).map(|s| s.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).filter(|s| !s.is_empty());
            (issuer, scope, resource)
        }
        // Servers from before RFC 9728 was required sign in at their own address.
        None => (origin(&server_url), None, server.to_owned()),
    };
    let meta = server_metadata(http, &issuer)?;
    let text = |k: &str| meta.get(k).and_then(Value::as_str).map(str::to_owned);
    let authorize = text("authorization_endpoint").filter(|u| allowed(u)).ok_or("The connector's sign-in server has no sign-in page Mobius can use.")?;
    let token = text("token_endpoint").filter(|u| allowed(u)).ok_or("The connector's sign-in server has no token address Mobius can use.")?;
    if let Some(methods) = meta.get("code_challenge_methods_supported").and_then(Value::as_array)
        && !methods.iter().any(|m| m == "S256")
    {
        return Err("The connector's sign-in server doesn't support PKCE, which MCP requires.".into());
    }
    Ok(Plan { authorize, token, register: text("registration_endpoint").filter(|u| allowed(u)), scope, resource })
}

/// Registers Mobius with the sign-in server for this redirect (RFC 7591): a public client, with no secret if it can.
fn register(http: &ureq::Agent, endpoint: &str, redirect: &str) -> Res<(String, Option<String>)> {
    let body = json!({
        "client_name": "Mobius",
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let response = http.post(endpoint).header("Content-Type", "application/json").send(body.to_string().as_bytes()).map_err(|e| format!("Could not reach the connector's sign-in server: {e}"))?;
    let (status, _, body) = read_body(response, MAX_JSON)?;
    let reply: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    if !(200..300).contains(&status) {
        return Err(format!("The connector's sign-in server wouldn't register Mobius (HTTP {status})."));
    }
    let id = reply.get("client_id").and_then(Value::as_str).filter(|i| !i.is_empty()).ok_or("The connector's sign-in server gave no client id.")?.to_owned();
    Ok((id, reply.get("client_secret").and_then(Value::as_str).map(str::to_owned)))
}

fn tokens_from(reply: &Value, keep_refresh: &str) -> Res<(String, String, u64)> {
    let access = reply.get("access_token").and_then(Value::as_str).filter(|a| !a.is_empty()).ok_or("The connector's sign-in server sent no token.")?.to_owned();
    let refresh = reply.get("refresh_token").and_then(Value::as_str).filter(|r| !r.is_empty()).unwrap_or(keep_refresh).to_owned();
    let expires = reply.get("expires_in").and_then(Value::as_u64).map_or(0, |s| now() + s);
    Ok((access, refresh, expires))
}

/// A connector's kept sign-in, as the connector's requests use it.
pub struct Kept {
    secrets: Arc<dyn Secrets>,
    server: String,
    http: ureq::Agent,
    refreshing: Mutex<()>,
}

impl Kept {
    pub fn new(secrets: Arc<dyn Secrets>, server: &str) -> Kept {
        Kept { secrets, server: server.to_owned(), http: http(), refreshing: Mutex::new(()) }
    }
}

impl mobius_mcp::client::Tokens for Kept {
    fn bearer(&self, stale: bool) -> Res<Option<String>> {
        let _one_at_a_time = lock(&self.refreshing);
        let secret = secret_name(&self.server);
        let Some(record) = self.secrets.get(&secret).and_then(|t| serde_json::from_str::<Record>(&t).ok()) else { return Ok(None) };
        let fresh = record.expires == 0 || record.expires > now() + SKEW_SECONDS;
        if !stale && fresh {
            return Ok(Some(record.access));
        }
        if record.refresh.is_empty() {
            // Nothing to refresh with: send no token, and the server asks for a sign-in again.
            return Ok(None);
        }
        let mut pairs = vec![("grant_type", "refresh_token"), ("refresh_token", record.refresh.as_str()), ("client_id", record.client_id.as_str()), ("resource", record.resource.as_str())];
        if let Some(s) = &record.client_secret {
            pairs.push(("client_secret", s.as_str()));
        }
        let response = self.http.post(&record.token_endpoint).header("Content-Type", "application/x-www-form-urlencoded").header("Accept", "application/json").send(form(&pairs).as_bytes()).map_err(|e| format!("Could not reach the connector's sign-in server: {e}"))?;
        let (status, _, body) = read_body(response, MAX_JSON)?;
        if status != 200 {
            // A refused refresh: the sign-in is over. Forget it, so the connector shows Sign in.
            self.secrets.delete(&secret);
            return Ok(None);
        }
        let reply: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let (access, refresh, expires) = tokens_from(&reply, &record.refresh)?;
        let next = Record { access: access.clone(), refresh, expires, ..record };
        self.secrets.put(&secret, &serde_json::to_string(&next).map_err(|e| e.to_string())?);
        Ok(Some(access))
    }
}

/// Browser sign-ins for connectors, one at a time each.
#[derive(Default)]
pub struct SignIns {
    pending: Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
}

impl SignIns {
    /// Starts a sign-in for connector `server` at `address`; `pointed` is where its 401 said its sign-in is described.
    /// Returns the page to open. `finish` gets the outcome on the sign-in's own thread, once the tokens are kept.
    pub fn start(self: &Arc<Self>, server: &str, address: &str, pointed: Option<&str>, secrets: Arc<dyn Secrets>, finish: Arc<dyn Fn(Res<()>) + Send + Sync>) -> Res<String> {
        if let Some((url, _)) = lock(&self.pending).get(server) {
            return Ok(url.clone());
        }
        let http = http();
        let plan = plan(&http, address, pointed)?;
        let callback = Callback::listen("/callback")?;
        let redirect = format!("http://127.0.0.1:{}/callback", callback.port());
        let registration = plan.register.clone().ok_or("This connector's sign-in server doesn't let apps register themselves, so Mobius can't sign in to it yet. Use a key in mcp.json if it offers one.")?;
        let (client_id, client_secret) = register(&http, &registration, &redirect)?;
        let (verifier, state) = (random_text(32)?, random_text(16)?);
        let mut url = url::Url::parse(&plan.authorize).map_err(|e| e.to_string())?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("response_type", "code").append_pair("client_id", &client_id).append_pair("redirect_uri", &redirect).append_pair("state", &state).append_pair("code_challenge", &challenge(&verifier)).append_pair("code_challenge_method", "S256").append_pair("resource", &plan.resource);
            if let Some(scope) = &plan.scope {
                q.append_pair("scope", scope);
            }
        }
        let page = url.to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.pending).insert(server.to_owned(), (page.clone(), cancel.clone()));
        let (me, server) = (Arc::clone(self), server.to_owned());
        std::thread::spawn(move || {
            let result = callback.wait("the connector", &state, &cancel, MAX_WAIT, |query| {
                let code = query.get("code").filter(|c| !c.is_empty() && c.len() <= 8192).ok_or("The connector's sign-in sent no code.")?;
                let mut pairs = vec![("grant_type", "authorization_code"), ("code", code.as_str()), ("redirect_uri", redirect.as_str()), ("client_id", client_id.as_str()), ("code_verifier", verifier.as_str()), ("resource", plan.resource.as_str())];
                if let Some(s) = &client_secret {
                    pairs.push(("client_secret", s.as_str()));
                }
                let response = http.post(&plan.token).header("Content-Type", "application/x-www-form-urlencoded").header("Accept", "application/json").send(form(&pairs).as_bytes()).map_err(|e| format!("Could not reach the connector's sign-in server: {e}"))?;
                let (status, _, body) = read_body(response, MAX_JSON)?;
                if status != 200 {
                    return Err(format!("The connector's sign-in server refused the sign-in (HTTP {status})."));
                }
                let reply: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let (access, refresh, expires) = tokens_from(&reply, "")?;
                let record = Record { access, refresh, expires, token_endpoint: plan.token.clone(), client_id: client_id.clone(), client_secret: client_secret.clone(), resource: plan.resource.clone() };
                if secrets.put(&secret_name(&server), &serde_json::to_string(&record).map_err(|e| e.to_string())?) { Ok(()) } else { Err("The sign-in could not be kept in this computer's secret store.".into()) }
            });
            lock(&me.pending).remove(&server);
            finish(result);
        });
        Ok(page)
    }

    pub fn cancel(&self, server: &str) {
        if let Some((_, cancel)) = lock(&self.pending).get(server) {
            cancel.store(true, Ordering::SeqCst);
        }
    }

    pub fn waiting(&self, server: &str) -> bool {
        lock(&self.pending).contains_key(server)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use mobius_mcp::client::Tokens as _;
    use std::io::{Read, Write};

    fn reply(s: &mut std::net::TcpStream, status: u16, body: &Value) {
        let body = body.to_string();
        let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
    }

    /// A pretend connector and its sign-in server, at one address. `register` off: no registration endpoint.
    /// `elsewhere`: its resource metadata names another site. Logs each request's path and body.
    fn server(register: bool, elsewhere: bool) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let (base, lg) = (url.clone(), log.clone());
        std::thread::spawn(move || {
            let mut minted = 0;
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut data = Vec::new();
                let mut buf = [0u8; 16384];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if data.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let end = data.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(data.len());
                let head = String::from_utf8_lossy(&data[..end]).to_string();
                let body = String::from_utf8_lossy(data.get(end + 4..).unwrap_or_default()).to_string();
                let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                lg.lock().unwrap().push(format!("{target} {body}"));
                match target.as_str() {
                    "/.well-known/oauth-protected-resource/mcp" => {
                        let resource = if elsewhere { "https://other.example/mcp".to_owned() } else { format!("{base}/mcp") };
                        reply(&mut s, 200, &json!({ "resource": resource, "authorization_servers": [format!("{base}/auth")], "scopes_supported": ["read", "write"] }));
                    }
                    "/.well-known/oauth-authorization-server/auth" => {
                        let mut meta = json!({ "issuer": format!("{base}/auth"), "authorization_endpoint": format!("{base}/auth/authorize"), "token_endpoint": format!("{base}/auth/token"), "code_challenge_methods_supported": ["S256"] });
                        if register {
                            meta["registration_endpoint"] = json!(format!("{base}/auth/register"));
                        }
                        reply(&mut s, 200, &meta);
                    }
                    "/auth/register" => reply(&mut s, 201, &json!({ "client_id": "client-1" })),
                    "/auth/token" if body.contains("grant_type=authorization_code") && body.contains("code=the-code") && body.contains("code_verifier=") && body.contains("client_id=client-1") && body.contains("resource=") => {
                        minted += 1;
                        reply(&mut s, 200, &json!({ "access_token": format!("access-{minted}"), "refresh_token": "refresh-1", "expires_in": 3600 }));
                    }
                    "/auth/token" if body.contains("refresh_token=refresh-1") => {
                        minted += 1;
                        reply(&mut s, 200, &json!({ "access_token": format!("access-{minted}"), "expires_in": 3600 }));
                    }
                    _ => reply(&mut s, 400, &json!({ "error": "invalid_grant" })),
                }
            }
        });
        (url, log)
    }

    /// Play the browser: follow the sign-in page back to Mobius with a code.
    fn come_back(page: &str) {
        let page = url::Url::parse(page).unwrap();
        let q: HashMap<String, String> = page.query_pairs().into_owned().collect();
        let back = format!("{}?code=the-code&state={}", q["redirect_uri"], q["state"]);
        let _ = ureq::get(&back).call();
    }

    #[test]
    fn a_connector_is_signed_in_through_its_own_sign_in_server_and_its_token_refreshes() {
        let (base, log) = server(true, false);
        let secrets: Arc<dyn Secrets> = Arc::new(MemorySecrets::new(true));
        let sign_ins = Arc::new(SignIns::default());
        let (sender, done) = std::sync::mpsc::channel();
        let page = sign_ins.start("tracker", &format!("{base}/mcp"), None, secrets.clone(), Arc::new(move |r| sender.send(r).unwrap())).unwrap();
        assert!(sign_ins.waiting("tracker"));
        let q: HashMap<String, String> = url::Url::parse(&page).unwrap().query_pairs().into_owned().collect();
        assert!(page.starts_with(&format!("{base}/auth/authorize?")));
        assert_eq!((q["client_id"].as_str(), q["code_challenge_method"].as_str(), q["resource"].clone(), q["scope"].as_str()), ("client-1", "S256", format!("{base}/mcp"), "read write"));
        assert!(q["redirect_uri"].starts_with("http://127.0.0.1:") && q["redirect_uri"].ends_with("/callback"));
        come_back(&page);
        assert_eq!(done.recv_timeout(Duration::from_secs(10)).unwrap(), Ok(()));
        assert!(!sign_ins.waiting("tracker"));
        let kept = Kept::new(secrets.clone(), "tracker");
        assert_eq!(kept.bearer(false).unwrap().as_deref(), Some("access-1"));
        assert_eq!(kept.bearer(true).unwrap().as_deref(), Some("access-2"), "a refused token is refreshed");
        assert_eq!(kept.bearer(false).unwrap().as_deref(), Some("access-2"));
        assert!(log.lock().unwrap().iter().any(|l| l.starts_with("/auth/token") && l.contains("resource=")), "the token is bound to the connector");
        // A refresh the server refuses ends the sign-in: the connector asks again.
        let mut record: Record = serde_json::from_str(&secrets.get(&secret_name("tracker")).unwrap()).unwrap();
        record.refresh = "revoked".into();
        secrets.put(&secret_name("tracker"), &serde_json::to_string(&record).unwrap());
        assert_eq!(kept.bearer(true).unwrap(), None);
        assert_eq!(secrets.get(&secret_name("tracker")), None);
    }

    #[test]
    fn a_sign_in_that_cannot_work_says_why_before_anything_opens() {
        let secrets: Arc<dyn Secrets> = Arc::new(MemorySecrets::new(true));
        let none: Arc<dyn Fn(Res<()>) + Send + Sync> = Arc::new(|_| {});
        let (base, _) = server(false, false);
        let error = Arc::new(SignIns::default()).start("a", &format!("{base}/mcp"), None, secrets.clone(), none.clone()).unwrap_err();
        assert!(error.contains("register"), "{error}");
        let (base, _) = server(true, true);
        let error = Arc::new(SignIns::default()).start("b", &format!("{base}/mcp"), None, secrets.clone(), none.clone()).unwrap_err();
        assert!(error.contains("another site"), "{error}");
        assert!(Kept::new(secrets, "never").bearer(false).unwrap().is_none(), "no sign-in: no token");
    }

    #[test]
    fn cancelling_a_sign_in_ends_it() {
        let (base, _) = server(true, false);
        let sign_ins = Arc::new(SignIns::default());
        let (sender, done) = std::sync::mpsc::channel();
        sign_ins.start("c", &format!("{base}/mcp"), None, Arc::new(MemorySecrets::new(true)), Arc::new(move |r| sender.send(r).unwrap())).unwrap();
        sign_ins.cancel("c");
        assert!(done.recv_timeout(Duration::from_secs(10)).unwrap().is_err());
        assert!(!sign_ins.waiting("c"));
    }
}
