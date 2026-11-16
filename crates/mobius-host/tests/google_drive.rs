#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Google Drive's picked files against a pretend Google: signing in, the picker page and the ids it sends back,
//! opening files (and Google Docs as Markdown), saving back, refusing to save over a change made on Drive, refreshing,
//! and signing out.
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use mobius_host::google_drive::{App, CHANGED, Endpoints, GoogleDrive, NOT_SET_UP, SECRET};
use mobius_host::secrets::{MemorySecrets, Secrets};
use serde_json::{Value, json};

fn jwt(claims: &Value) -> String {
    use base64::Engine;
    format!("h.{}.s", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string()))
}

/// id → (name, mime type, version, bytes)
type Files = Arc<Mutex<BTreeMap<String, (String, String, u64, Vec<u8>)>>>;

struct Google {
    url: String,
    files: Files,
    seen: Arc<Mutex<Vec<String>>>,
}

const CLIENT: &str = "123456-test.apps.googleusercontent.com";

/// `access_life`: seconds a token lasts. `scope`: what the pretend Google grants.
fn google(access_life: u64, scope: &'static str) -> Google {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let files: Files = Arc::default();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (store, log) = (files.clone(), seen.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { break };
            let mut data = Vec::new();
            let mut buf = [0u8; 8192];
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
            let body = data.get(end + 4..).unwrap_or_default().to_vec();
            let mut words = head.split_whitespace();
            let (method, target) = (words.next().unwrap_or("").to_owned(), words.next().unwrap_or("").to_owned());
            let bearer = head.lines().any(|l| l.to_lowercase().starts_with("authorization: bearer access-"));
            log.lock().unwrap().push(format!("{method} {target}"));
            let text = String::from_utf8_lossy(&body).to_string();
            let path = target.split('?').next().unwrap_or("").to_owned();
            let query = target.split_once('?').map_or("", |(_, q)| q).to_owned();
            let mut files = store.lock().unwrap();
            let meta = |id: &str, f: &(String, String, u64, Vec<u8>)| json!({ "id": id, "name": f.0, "mimeType": f.1, "version": f.2.to_string(), "trashed": false, "webViewLink": format!("https://drive.example/{id}") });
            let (status, reply): (u16, Vec<u8>) = match (method.as_str(), path.as_str()) {
                ("POST", "/token") if text.contains("grant_type=authorization_code") && text.contains("code_verifier=") && text.contains("client_secret=secret") => {
                    let id = jwt(&json!({ "aud": CLIENT, "email": "ana@example.com" }));
                    (200, json!({ "access_token": "access-1", "refresh_token": "refresh-1", "expires_in": access_life, "scope": scope, "id_token": id }).to_string().into_bytes())
                }
                ("POST", "/token") if text.contains("refresh_token=refresh-1") => (200, json!({ "access_token": "access-2", "expires_in": 3600 }).to_string().into_bytes()),
                ("POST", "/token") => (400, json!({ "error": "invalid_grant" }).to_string().into_bytes()),
                ("POST", "/revoke") => (200, b"{}".to_vec()),
                _ if !bearer => (401, json!({ "error": { "code": 401 } }).to_string().into_bytes()),
                ("GET", p) if p.starts_with("/drive/v3/files/") => {
                    let rest = &p["/drive/v3/files/".len()..];
                    let (id, export) = rest.split_once('/').map_or((rest, false), |(i, e)| (i, e == "export"));
                    match files.get(id) {
                        None => (404, json!({ "error": { "code": 404 } }).to_string().into_bytes()),
                        Some(f) if export => (200, format!("# {}\n\nexported as {}", f.0, query).into_bytes()),
                        Some(f) if query.contains("alt=media") => (200, f.3.clone()),
                        Some(f) => (200, meta(id, f).to_string().into_bytes()),
                    }
                }
                ("PATCH", p) if p.starts_with("/upload/drive/v3/files/") => {
                    let id = &p["/upload/drive/v3/files/".len()..];
                    match files.get_mut(id) {
                        None => (404, b"{}".to_vec()),
                        Some(f) => {
                            f.2 += 1;
                            f.3 = body;
                            (200, json!({ "id": id, "version": f.2.to_string() }).to_string().into_bytes())
                        }
                    }
                }
                _ => (404, b"{}".to_vec()),
            };
            drop(files);
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", reply.len());
            let _ = s.write_all(&reply);
        }
    });
    Google { url, files, seen }
}

fn app() -> App {
    App { client_id: CLIENT.into(), client_secret: "secret".into(), api_key: "picker-key".into() }
}

fn service(g: &Google, dir: &std::path::Path) -> (Arc<GoogleDrive>, Arc<MemorySecrets>) {
    let secrets = Arc::new(MemorySecrets::new(true));
    let at = Endpoints { auth: format!("{}/auth", g.url), token: format!("{}/token", g.url), api: g.url.clone(), revoke: format!("{}/revoke", g.url) };
    (Arc::new(GoogleDrive::new(Some(app()), at, secrets.clone(), &dir.join("google-drive.json"))), secrets)
}

fn param(url: &str, name: &str) -> Option<String> {
    url::Url::parse(url).unwrap().query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned())
}

fn browser(url: &str) -> (u16, String) {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).proxy(None).build().into();
    let r = agent.get(url).call().unwrap();
    let status = r.status().as_u16();
    (status, r.into_body().read_to_string().unwrap())
}

fn sign_in(drive: &Arc<GoogleDrive>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let pending = drive.start_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    assert_eq!(param(&pending.url, "scope").unwrap(), "openid email https://www.googleapis.com/auth/drive.file", "only the files people pick");
    assert_eq!(param(&pending.url, "code_challenge_method").as_deref(), Some("S256"));
    assert_eq!(param(&pending.url, "access_type").as_deref(), Some("offline"));
    let back = param(&pending.url, "redirect_uri").unwrap();
    assert!(back.starts_with("http://127.0.0.1:"));
    let state = param(&pending.url, "state").unwrap();
    browser(&format!("{back}?state={state}&code=the-code&scope=x"));
    rx.recv_timeout(Duration::from_secs(10)).unwrap()
}

/// Opens the picker page as the browser would, and picks `ids` (or closes it, with none).
fn pick(drive: &Arc<GoogleDrive>, ids: Option<&str>) -> Result<Vec<String>, String> {
    let (tx, rx) = mpsc::channel();
    let pending = drive.start_pick(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
    assert_eq!(pending.kind, "pick");
    let (status, page) = browser(&pending.url);
    assert_eq!(status, 200);
    assert!(page.contains(r#"token: "access-"#) && page.contains(r#"key: "picker-key""#) && page.contains(r#"app: "123456""#), "{page}");
    let state = page.split(r#"state: ""#).nth(1).unwrap().split('"').next().unwrap().to_owned();
    let base = pending.url.split("/google/pick-").next().unwrap().to_owned();
    // Another page on the same port is turned away and the wait goes on.
    assert_eq!(browser(&format!("{base}/google/pick-guess")).0, 404);
    let tail = ids.map_or("cancelled=1".to_owned(), |i| format!("ids={i}"));
    browser(&format!("{base}/google/picked?state={state}&{tail}"));
    rx.recv_timeout(Duration::from_secs(10)).unwrap()
}

#[test]
fn picked_files_open_and_save_back_but_never_over_a_change_on_drive() {
    let g = google(3600, "openid email https://www.googleapis.com/auth/drive.file");
    g.files.lock().unwrap().insert("f1".into(), ("Plan.md".into(), "text/markdown".into(), 7, b"# Plan".to_vec()));
    g.files.lock().unwrap().insert("d1".into(), ("Budget notes".into(), "application/vnd.google-apps.document".into(), 3, Vec::new()));
    let dir = tempfile::tempdir().unwrap();
    let (drive, secrets) = service(&g, dir.path());
    assert_eq!(drive.status()["signedIn"], false);
    assert_eq!(drive.status()["setUp"], true);

    sign_in(&drive).unwrap();
    let status = drive.status();
    assert_eq!((status["signedIn"].clone(), status["account"].clone()), (json!(true), json!("ana@example.com")));
    assert!(status["pending"].is_null());

    assert_eq!(pick(&drive, None).unwrap(), Vec::<String>::new(), "closing the picker picks nothing");
    let ids = pick(&drive, Some("f1,d1,bad%20id")).unwrap();
    assert_eq!(ids, ["f1", "d1"], "only ids that look like Drive's");

    // Opening copies each into the workspace, making the folder, never over a file already there.
    let workspace = mobius_workspace::files::Workspace::new(dir.path().join("workspace"), dir.path().join("checkpoints"));
    std::fs::create_dir_all(dir.path().join("workspace")).unwrap();
    let (opened, failed) = drive.open_into(&workspace, "Picked", &["f1".to_owned(), "gone".to_owned()]);
    assert_eq!(opened[0]["path"], "Picked/Plan.md");
    assert_eq!(failed[0]["id"], "gone");
    assert!(failed[0]["message"].as_str().unwrap().contains("isn't on Google Drive any more"));
    let (again, _) = drive.open_into(&workspace, "Picked", &["f1".to_owned()]);
    assert_eq!(again[0]["path"], "Picked/Plan 2.md");
    assert_eq!(std::fs::read(dir.path().join("workspace/Picked/Plan 2.md")).unwrap(), b"# Plan");
    drive.forget("Picked/Plan.md").unwrap();
    drive.forget("Picked/Plan 2.md").unwrap();

    let plan = drive.fetch("f1").unwrap();
    assert_eq!((plan.file_name.as_str(), plan.bytes.as_slice(), plan.version.as_str(), plan.exported), ("Plan.md", b"# Plan".as_slice(), "7", false));
    let doc = drive.fetch("d1").unwrap();
    assert_eq!(doc.file_name, "Budget notes.md");
    assert!(doc.exported);
    assert!(String::from_utf8_lossy(&doc.bytes).contains("mimeType=text%2Fmarkdown"), "a Google Doc comes in as Markdown");

    drive.remember(&plan, "Google Drive/Plan.md").unwrap();
    drive.remember(&doc, "Google Drive/Budget notes.md").unwrap();
    assert_eq!(drive.links().len(), 2);
    let saved = drive.save_back("Google Drive/Plan.md", b"# Plan, v2").unwrap();
    assert_eq!(saved.version, "8");
    assert_eq!(g.files.lock().unwrap()["f1"].3, b"# Plan, v2");
    assert!(drive.save_back("Google Drive/Budget notes.md", b"x").unwrap_err().contains("can't be saved over it"));
    assert_eq!(drive.save_back("Elsewhere.md", b"x").unwrap_err(), "That file didn't come from Google Drive.");

    // Changed on Drive since: nothing is written.
    g.files.lock().unwrap().get_mut("f1").unwrap().2 = 20;
    assert_eq!(drive.save_back("Google Drive/Plan.md", b"mine").unwrap_err(), CHANGED);
    assert_eq!(g.files.lock().unwrap()["f1"].3, b"# Plan, v2");

    // The link follows a move, and is kept across runs.
    drive.moved("Google Drive", "Drive").unwrap();
    assert_eq!(drive.link_of("Drive/Budget notes.md").unwrap().id, "d1", "a moved folder takes its links along");
    drive.moved("Drive/Plan.md", "Plans/Plan.md").unwrap();
    let (again, _) = service(&g, dir.path());
    assert_eq!(again.link_of("Plans/Plan.md").unwrap().id, "f1");
    drive.forget("Plans/Plan.md").unwrap();
    assert!(drive.link_of("Plans/Plan.md").is_none());

    drive.sign_out();
    assert!(secrets.get(SECRET).is_none());
    assert!(g.seen.lock().unwrap().iter().any(|s| s == "POST /revoke"));
    assert_eq!(drive.links().len(), 1, "the links stay, for signing in again");
}

#[test]
fn an_old_token_is_refreshed_and_an_ended_sign_in_says_so() {
    let g = google(1, "openid email https://www.googleapis.com/auth/drive.file");
    g.files.lock().unwrap().insert("f1".into(), ("a.txt".into(), "text/plain".into(), 1, b"a".to_vec()));
    let dir = tempfile::tempdir().unwrap();
    let (drive, secrets) = service(&g, dir.path());
    sign_in(&drive).unwrap();
    drive.fetch("f1").unwrap();
    assert!(g.seen.lock().unwrap().iter().any(|s| s == "POST /token"), "refreshed before use");
    assert!(secrets.get(SECRET).unwrap().contains("access-2"));

    // Google ended it (a week, in testing): the sign-in is forgotten and the message says what to do.
    let mut tokens: Value = serde_json::from_str(&secrets.get(SECRET).unwrap()).unwrap();
    tokens["expires"] = json!(0);
    tokens["refresh"] = json!("refresh-gone");
    secrets.put(SECRET, &tokens.to_string());
    assert!(drive.fetch("f1").unwrap_err().contains("Sign in to Google again"));
    assert!(secrets.get(SECRET).is_none());
}

#[test]
fn a_sign_in_without_file_access_is_refused_and_no_app_means_not_set_up() {
    let g = google(3600, "openid email");
    let dir = tempfile::tempdir().unwrap();
    let (drive, secrets) = service(&g, dir.path());
    assert!(sign_in(&drive).unwrap_err().contains("leave that box ticked"));
    assert!(secrets.get(SECRET).is_none());
    assert!(drive.status()["hint"].as_str().unwrap().contains("leave that box ticked"));

    let none = Arc::new(GoogleDrive::new(None, Endpoints::default(), secrets, &dir.path().join("g.json")));
    assert_eq!(none.status()["setUp"], false);
    assert_eq!(none.start_sign_in(Arc::new(|_| {})).unwrap_err(), NOT_SET_UP);
}
