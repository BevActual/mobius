//! The Messages app's accounts: chat services the person signed in to, read and sent through as them. Messages are
//! read from the service as they are shown and nothing of them is kept here; this keeps only the list of accounts
//! (`messages-accounts.json` in the data folder) and, in the system secret store, each account's sign-in.
//!
//! Slack (`slack`), Matrix (`matrix`) and Microsoft Teams chats (`teams`). Only the person sends: the app calls `send` from their own Send, and the
//! agent has no tool that does.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::calendar_accounts::new_id;
use crate::secrets::Secrets;
use crate::matrix::{self, Matrix, Session};
use crate::matrix_crypto::Crypto;
use crate::slack::{EXPIRED, Endpoints, Page, Slack, Tokens};
use crate::teams::{self, Me, Teams};

type Res<T> = Result<T, String>;

const MAX_ACCOUNTS: usize = 20;
/// How long a workspace's names are kept before they are read again.
const PEOPLE_FOR: Duration = Duration::from_secs(60 * 60);

/// A workspace's names by id, and when they were read.
type People = HashMap<String, (Instant, Arc<HashMap<String, String>>)>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// `slack`, `matrix` or `teams`.
    pub service: String,
    pub name: String,
    /// The workspace's id on the service (on Matrix, the person's Matrix ID; on Teams, their user and organisation
    /// ids), so signing in to it twice keeps one account.
    #[serde(default)]
    pub team: String,
    /// Why it can't be read now: `EXPIRED` when the person has to sign in again.
    #[serde(default)]
    pub problem: Option<String>,
}

pub struct Accounts {
    file: PathBuf,
    secrets: Arc<dyn Secrets>,
    state: Mutex<Vec<Account>>,
    slack: Mutex<Arc<Slack>>,
    matrix: Arc<Matrix>,
    /// Each Matrix account's encryption, opened the first time it is needed.
    crypto: Mutex<HashMap<String, Arc<Crypto>>>,
    people: Mutex<People>,
    /// The Microsoft sign-in, asking for Teams chats.
    microsoft: Mutex<Arc<crate::onedrive::Service>>,
}

fn secret_name(id: &str) -> String {
    format!("messages-account:{id}")
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Accounts {
    pub fn new(data_dir: &Path, secrets: Arc<dyn Secrets>) -> Accounts {
        let file = data_dir.join("messages-accounts.json");
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Vec<Account>>(&t).ok()).unwrap_or_default();
        let slack = Arc::new(Slack::new(crate::slack::built_in_client_id(), Endpoints::default()));
        let microsoft = Arc::new(crate::onedrive::Service::new(crate::onedrive::built_in_client_id(), crate::onedrive::Endpoints::default(), crate::graph_calendar::agent()).with_scopes(teams::SCOPES));
        Accounts { file, secrets, state: Mutex::new(state), slack: Mutex::new(slack), matrix: Arc::new(Matrix::new()), crypto: Mutex::default(), people: Mutex::default(), microsoft: Mutex::new(microsoft) }
    }

    /// A pretend Microsoft, in tests.
    pub fn use_microsoft(&self, client_id: Option<String>, at: crate::onedrive::Endpoints) {
        *lock(&self.microsoft) = Arc::new(crate::onedrive::Service::new(client_id, at, crate::graph_calendar::agent()).with_scopes(teams::SCOPES));
    }

    fn microsoft(&self) -> Arc<crate::onedrive::Service> {
        Arc::clone(&lock(&self.microsoft))
    }

    /// A pretend Slack, in tests.
    pub fn use_slack(&self, client_id: Option<String>, at: Endpoints) {
        *lock(&self.slack) = Arc::new(Slack::new(client_id, at));
    }

    fn slack(&self) -> Arc<Slack> {
        Arc::clone(&lock(&self.slack))
    }

    fn save(&self, accounts: &[Account]) {
        if let Ok(text) = serde_json::to_string_pretty(accounts) {
            let _ = std::fs::create_dir_all(self.file.parent().unwrap_or(Path::new(".")));
            let _ = std::fs::write(&self.file, text);
        }
    }

    /// Each account as the app shows it (`ChatAccount`).
    pub fn list(&self) -> Value {
        Value::Array(
            lock(&self.state)
                .iter()
                .map(|a| {
                    let status = match a.problem.as_deref() {
                        None => "ready",
                        Some(EXPIRED | matrix::EXPIRED | teams::EXPIRED) => "signed-out",
                        Some(_) => "error",
                    };
                    let mut account = json!({ "id": a.id, "service": a.service, "name": a.name, "status": status });
                    if let Some(p) = &a.problem {
                        account["message"] = json!(p);
                    }
                    account
                })
                .collect(),
        )
    }

    fn set_problem(&self, id: &str, problem: Option<String>) {
        let mut all = lock(&self.state);
        if let Some(a) = all.iter_mut().find(|a| a.id == id)
            && a.problem != problem
        {
            a.problem = problem;
            self.save(&all);
        }
    }

    /// The account's sign-in, refreshed when it is about to run out.
    fn tokens(&self, id: &str) -> Res<Tokens> {
        if !lock(&self.state).iter().any(|a| a.id == id) {
            return Err("That account is gone.".into());
        }
        let tokens: Tokens = self.secrets.get(&secret_name(id)).and_then(|t| serde_json::from_str(&t).ok()).ok_or(EXPIRED)?;
        if tokens.fresh() {
            return Ok(tokens);
        }
        let fresh = self.slack().refresh(&tokens)?;
        if let Ok(text) = serde_json::to_string(&fresh) {
            self.secrets.put(&secret_name(id), &text);
        }
        Ok(fresh)
    }

    /// Runs `f` with the account's sign-in; an ended sign-in marks the account signed out, and a good answer clears
    /// what was wrong before.
    fn with<T>(&self, id: &str, f: impl FnOnce(&Slack, &Tokens) -> Res<T>) -> Res<T> {
        let result = self.tokens(id).and_then(|tokens| f(&self.slack(), &tokens));
        match &result {
            Ok(_) => self.set_problem(id, None),
            Err(e) if e == EXPIRED => self.set_problem(id, Some(EXPIRED.into())),
            Err(_) => {}
        }
        result
    }

    /// The workspace's names, read once an hour.
    fn people(&self, id: &str, slack: &Slack, tokens: &Tokens) -> Res<Arc<HashMap<String, String>>> {
        if let Some((when, people)) = lock(&self.people).get(id)
            && when.elapsed() < PEOPLE_FOR
        {
            return Ok(Arc::clone(people));
        }
        let people = Arc::new(slack.people(&tokens.access)?);
        lock(&self.people).insert(id.to_owned(), (Instant::now(), Arc::clone(&people)));
        Ok(people)
    }

    pub fn channels(&self, id: &str) -> Res<Value> {
        if self.is_teams(id) {
            return self.with_teams(id, |t, a, me| t.channels(a, id, me)).map(Value::Array);
        }
        if self.is_matrix(id) {
            return self.with_matrix(id, |m, s| m.channels(id, s, self.crypto_for(id, s).as_deref())).map(Value::Array);
        }
        self.with(id, |slack, tokens| {
            let people = self.people(id, slack, tokens)?;
            slack.channels(&tokens.access, id, &people).map(Value::Array)
        })
    }

    pub fn history(&self, id: &str, channel: &str, before: Option<&str>, thread: Option<&str>, limit: usize) -> Res<Value> {
        if self.is_teams(id) {
            // Teams chats have no threads.
            return if thread.is_some() { Ok(json!([])) } else { self.with_teams(id, |t, a, me| t.history(a, channel, before, limit, me)).map(Value::Array) };
        }
        if self.is_matrix(id) {
            return self.with_matrix(id, |m, s| m.history(id, s, channel, before, thread, limit, self.crypto_for(id, s).as_deref())).map(Value::Array);
        }
        self.with(id, |slack, tokens| {
            let people = self.people(id, slack, tokens)?;
            slack.history(&tokens.access, channel, &Page { before, thread, limit }, &tokens.user, &people).map(Value::Array)
        })
    }

    /// Sends what the person wrote. Only ever called from the person's own Send.
    pub fn send(&self, id: &str, channel: &str, text: &str, thread: Option<&str>) -> Res<Value> {
        let text = text.trim();
        if text.is_empty() {
            return Err("There is nothing to send.".into());
        }
        let matrix = self.is_matrix(id);
        if text.chars().count() > 40_000 {
            return Err(if matrix { "That message is too long to send." } else { "That message is too long for Slack." }.into());
        }
        if matrix {
            return self.with_matrix(id, |m, s| m.send(id, s, channel, text, thread, self.crypto_for(id, s).as_deref()));
        }
        if self.is_teams(id) {
            return self.with_teams(id, |t, a, me| t.send(a, channel, text, me));
        }
        self.with(id, |slack, tokens| {
            let people = self.people(id, slack, tokens)?;
            slack.send(&tokens.access, channel, text, thread, &tokens.user, &people)
        })
    }

    pub fn mark_read(&self, id: &str, channel: &str, up_to: &str) -> Res<()> {
        if self.is_teams(id) {
            return self.with_teams(id, |t, a, me| t.mark_read(a, channel, me));
        }
        if self.is_matrix(id) {
            return self.with_matrix(id, |m, s| m.mark_read(id, s, channel, up_to));
        }
        self.with(id, |slack, tokens| slack.mark_read(&tokens.access, channel, up_to))
    }

    pub fn slack_status(&self) -> Value {
        self.slack().status()
    }

    pub fn slack_cancel(&self) {
        self.slack().cancel();
    }

    /// Start signing in to Slack and return the page to open. Once the person agrees the workspace is kept (signing
    /// in to one already here gives it the new sign-in) and `done` hears it, or why not.
    pub fn slack_sign_in(self: &Arc<Self>, done: Arc<dyn Fn(Res<Value>) + Send + Sync>) -> Res<Value> {
        let me = Arc::clone(self);
        let url = self.slack().start(Arc::new(move |signed: Res<Tokens>| done(signed.and_then(|tokens| me.keep_slack(&tokens)))))?;
        Ok(json!({ "url": url }))
    }

    fn keep_slack(&self, tokens: &Tokens) -> Res<Value> {
        let text = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        let mut all = lock(&self.state);
        let existing = all.iter().position(|a| a.service == "slack" && !tokens.team.is_empty() && a.team == tokens.team);
        if existing.is_none() && all.len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} message accounts."));
        }
        let id = existing.map_or_else(new_id, |i| all[i].id.clone());
        if !self.secrets.put(&secret_name(&id), &text) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let name = Some(tokens.team_name.trim().chars().take(60).collect::<String>()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Slack".into());
        match existing {
            Some(i) => {
                all[i].problem = None;
                all[i].name = name.clone();
            }
            None => all.push(Account { id: id.clone(), service: "slack".into(), name: name.clone(), team: tokens.team.clone(), problem: None }),
        }
        self.save(&all);
        drop(all);
        lock(&self.people).remove(&id);
        Ok(json!({ "id": id, "service": "slack", "name": name }))
    }

    fn is_teams(&self, id: &str) -> bool {
        lock(&self.state).iter().any(|a| a.id == id && a.service == "teams")
    }

    fn teams(&self) -> Teams {
        Teams::new(&self.microsoft().at.graph, crate::graph_calendar::agent())
    }

    /// Runs `f` with the Teams account's sign-in (refreshed as Graph needs); an ended sign-in marks the account
    /// signed out, and a good answer clears what was wrong before.
    fn with_teams<T>(&self, id: &str, f: impl FnOnce(&Teams, &crate::onedrive::Account, &Me) -> Res<T>) -> Res<T> {
        let me = lock(&self.state).iter().find(|a| a.id == id).and_then(|a| Me::from_team(&a.team)).ok_or("That account is gone.")?;
        let result = self.microsoft().account(Arc::clone(&self.secrets), &secret_name(id)).map_err(|_| teams::NOT_SET_UP.to_owned()).and_then(|account| f(&self.teams(), &account, &me));
        match &result {
            Ok(_) => self.set_problem(id, None),
            Err(e) if e == teams::EXPIRED => self.set_problem(id, Some(teams::EXPIRED.into())),
            Err(_) => {}
        }
        result
    }

    /// Whether Teams can be signed in to in this build, and the sign-in page while one is under way.
    pub fn teams_status(&self) -> Value {
        let mut status = self.microsoft().status();
        if status["setUp"] != true {
            status["hint"] = json!(teams::NOT_SET_UP);
        }
        status
    }

    pub fn teams_cancel(&self) {
        self.microsoft().cancel();
    }

    /// Start signing in to Microsoft for Teams chats and return the page to open. Once the person agrees the account
    /// is kept (signing in to one already here gives it the new sign-in) and `done` hears it, or why not.
    pub fn teams_sign_in(self: &Arc<Self>, done: Arc<dyn Fn(Res<Value>) + Send + Sync>) -> Res<Value> {
        if self.microsoft().client_id.is_none() {
            return Err(teams::NOT_SET_UP.into());
        }
        let me = Arc::clone(self);
        let pending = self.microsoft().start(Arc::new(move |signed: Res<crate::onedrive::SignedIn>| done(signed.and_then(|signed| me.keep_teams(&signed)))))?;
        Ok(json!({ "url": pending.url }))
    }

    fn keep_teams(&self, signed: &crate::onedrive::SignedIn) -> Res<Value> {
        let text = serde_json::to_string(&signed.tokens).map_err(|e| e.to_string())?;
        // Who it is comes from Graph, with the new tokens kept under a name of their own until the account is known.
        let trial = format!("messages-teams-new:{}", new_id());
        if !self.secrets.put(&trial, &text) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let who = self.microsoft().account(Arc::clone(&self.secrets), &trial).and_then(|a| self.teams().me(&a));
        let text = self.secrets.get(&trial).unwrap_or(text);
        self.secrets.delete(&trial);
        let who = who?;
        let team = who.to_team();
        let mut all = lock(&self.state);
        let existing = all.iter().position(|a| a.service == "teams" && a.team == team);
        if existing.is_none() && all.len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} message accounts."));
        }
        let id = existing.map_or_else(new_id, |i| all[i].id.clone());
        if !self.secrets.put(&secret_name(&id), &text) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let name = if signed.email.is_empty() { "Teams".to_owned() } else { signed.email.chars().take(60).collect() };
        match existing {
            Some(i) => {
                all[i].problem = None;
                all[i].name = name.clone();
            }
            None => all.push(Account { id: id.clone(), service: "teams".into(), name: name.clone(), team, problem: None }),
        }
        self.save(&all);
        Ok(json!({ "id": id, "service": "teams", "name": name }))
    }

    fn is_matrix(&self, id: &str) -> bool {
        lock(&self.state).iter().any(|a| a.id == id && a.service == "matrix")
    }

    fn keep_session(&self, id: &str, session: &Session) {
        if let Ok(text) = serde_json::to_string(session) {
            self.secrets.put(&secret_name(id), &text);
        }
    }

    /// The Matrix account's sign-in, refreshed when it is about to run out.
    fn matrix_session(&self, id: &str) -> Res<Session> {
        if !lock(&self.state).iter().any(|a| a.id == id) {
            return Err("That account is gone.".into());
        }
        let session: Session = self.secrets.get(&secret_name(id)).and_then(|t| serde_json::from_str(&t).ok()).ok_or(matrix::EXPIRED)?;
        if session.fresh() {
            return Ok(session);
        }
        let fresh = self.matrix.refresh(&session)?;
        self.keep_session(id, &fresh);
        Ok(fresh)
    }

    /// Runs `f` with the Matrix account's sign-in. A token the server no longer takes is refreshed once; an ended
    /// sign-in marks the account signed out, and a good answer clears what was wrong before.
    fn with_matrix<T>(&self, id: &str, f: impl Fn(&Matrix, &Session) -> Res<T>) -> Res<T> {
        let result = self.matrix_session(id).and_then(|session| match f(&self.matrix, &session) {
            Err(e) if Matrix::unknown_token(&e) => {
                let fresh = self.matrix.refresh(&session)?;
                self.keep_session(id, &fresh);
                f(&self.matrix, &fresh)
            }
            other => other,
        });
        let result = result.map_err(|e| if Matrix::unknown_token(&e) { matrix::EXPIRED.to_owned() } else { e });
        match &result {
            Ok(_) => self.set_problem(id, None),
            Err(e) if e == matrix::EXPIRED => self.set_problem(id, Some(matrix::EXPIRED.into())),
            Err(_) => {}
        }
        result
    }

    fn crypto_dir(&self, id: &str) -> PathBuf {
        self.file.parent().unwrap_or(Path::new(".")).join("matrix").join(id)
    }

    /// The account's encryption, opened with its store's key from the secret store (made the first time). `None`
    /// when there is no secret store to keep that key in: then encrypted rooms stay unread.
    fn crypto_for(&self, id: &str, s: &Session) -> Option<Arc<Crypto>> {
        if let Some(c) = lock(&self.crypto).get(id) {
            return Some(Arc::clone(c));
        }
        let name = format!("messages-matrix-store:{id}");
        let key = match self.secrets.get(&name).and_then(|k| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, k).ok()).filter(|k| k.len() == 32) {
            Some(key) => key,
            None => {
                let mut key = vec![0u8; 32];
                getrandom::fill(&mut key).ok()?;
                if !self.secrets.put(&name, &base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &key)) {
                    return None;
                }
                // A store whose key is gone can't be opened: start it again.
                let _ = std::fs::remove_dir_all(self.crypto_dir(id));
                key
            }
        };
        let crypto = Arc::new(Crypto::open(&self.crypto_dir(id), &s.user, &s.device, &key).ok()?);
        lock(&self.crypto).insert(id.to_owned(), Arc::clone(&crypto));
        Some(crypto)
    }

    /// Forgets the account's encryption: its store, and the store's key.
    fn drop_crypto(&self, id: &str) {
        lock(&self.crypto).remove(id);
        self.secrets.delete(&format!("messages-matrix-store:{id}"));
        let _ = std::fs::remove_dir_all(self.crypto_dir(id));
    }

    /// Whether this device can read the account's encrypted rooms: `{ verified }`.
    pub fn matrix_device(&self, id: &str) -> Res<Value> {
        self.with_matrix(id, |_, s| Ok(json!({ "verified": self.crypto_for(id, s).is_some_and(|c| c.verified()) })))
    }

    /// Verifies this device with the person's recovery key, and reads their key backup: `{ verified, keys }`.
    pub fn matrix_recover(&self, id: &str, recovery: &str) -> Res<Value> {
        self.with_matrix(id, |m, s| {
            let crypto = self.crypto_for(id, s).ok_or("Encrypted rooms need this computer's secret store, which isn't available.")?;
            let keys = m.recover(s, &crypto, recovery)?;
            Ok(json!({ "verified": crypto.verified(), "keys": keys }))
        })
    }

    /// Emoji verification with another of the person's devices. `step` is `start`, `check`, `match`, `differ` or
    /// `cancel`; it answers where the verification is (see `Matrix::verify_check`).
    pub fn matrix_verify(&self, id: &str, step: &str) -> Res<Value> {
        self.with_matrix(id, |m, s| {
            let crypto = self.crypto_for(id, s).ok_or("Encrypted rooms need this computer's secret store, which isn't available.")?;
            match step {
                "start" => m.verify_start(s, &crypto)?,
                "match" => m.verify_confirm(s, &crypto, true)?,
                "differ" => m.verify_confirm(s, &crypto, false)?,
                "cancel" => m.verify_cancel(s, &crypto),
                "check" => {}
                _ => return Err("That verification step isn't known.".into()),
            }
            m.verify_check(id, s, &crypto)
        })
    }

    /// How a Matrix server lets the person sign in: `{ homeserver, password, browser }`.
    pub fn matrix_methods(&self, server: &str) -> Res<Value> {
        self.matrix.methods(server).map(|m| m.to_json())
    }

    /// Signs in to Matrix with a username and password, which go only to the server and are not kept.
    pub fn matrix_sign_in(&self, server: &str, user: &str, password: &str) -> Res<Value> {
        let homeserver = self.matrix.homeserver(server)?;
        let session = self.matrix.password_sign_in(&homeserver, user, password)?;
        self.keep_matrix(&session)
    }

    pub fn matrix_status(&self) -> Value {
        self.matrix.status()
    }

    pub fn matrix_cancel(&self) {
        self.matrix.cancel();
    }

    /// Starts signing in on the Matrix server's own page and returns the page to open; `done` hears how it ended.
    pub fn matrix_browser_sign_in(self: &Arc<Self>, server: &str, done: Arc<dyn Fn(Res<Value>) + Send + Sync>) -> Res<Value> {
        let methods = self.matrix.methods(server)?;
        let me = Arc::clone(self);
        let url = self.matrix.start(&methods, Arc::new(move |signed: Res<Session>| done(signed.and_then(|s| me.keep_matrix(&s)))))?;
        Ok(json!({ "url": url }))
    }

    fn keep_matrix(&self, session: &Session) -> Res<Value> {
        let text = serde_json::to_string(session).map_err(|e| e.to_string())?;
        let mut all = lock(&self.state);
        let existing = all.iter().position(|a| a.service == "matrix" && a.team == session.user);
        if existing.is_none() && all.len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} message accounts."));
        }
        let id = existing.map_or_else(new_id, |i| all[i].id.clone());
        // Signing in again replaces the device signed in before: end that one on the server.
        let before = self.secrets.get(&secret_name(&id)).and_then(|t| serde_json::from_str::<Session>(&t).ok()).filter(|b| b.device != session.device);
        if !self.secrets.put(&secret_name(&id), &text) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        let name = session.user.chars().take(80).collect::<String>();
        match existing {
            Some(i) => {
                all[i].problem = None;
                all[i].name = name.clone();
            }
            None => all.push(Account { id: id.clone(), service: "matrix".into(), name: name.clone(), team: session.user.clone(), problem: None }),
        }
        self.save(&all);
        drop(all);
        self.matrix.forget(&id);
        // A new device is a new encryption identity.
        if before.is_some() {
            self.drop_crypto(&id);
        }
        if let Some(before) = before {
            let m = Arc::clone(&self.matrix);
            std::thread::spawn(move || m.sign_out_device(&before));
        }
        Ok(json!({ "id": id, "service": "matrix", "name": name }))
    }

    /// Forgets the account and its sign-in. Its messages stay on the service.
    pub fn remove(&self, id: &str) -> Res<Value> {
        let mut all = lock(&self.state);
        let before = all.len();
        all.retain(|a| a.id != id);
        if all.len() == before {
            return Err("That account is gone.".into());
        }
        self.save(&all);
        drop(all);
        // A Matrix sign-in is its own device on the account: it is signed out there too, without waiting.
        if let Some(session) = self.secrets.get(&secret_name(id)).and_then(|t| serde_json::from_str::<Session>(&t).ok()).filter(|s| !s.homeserver.is_empty()) {
            let (m, id) = (Arc::clone(&self.matrix), id.to_owned());
            std::thread::spawn(move || m.sign_out(&id, &session));
        }
        self.secrets.delete(&secret_name(id));
        self.drop_crypto(id);
        lock(&self.people).remove(id);
        Ok(json!({ "ok": true }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use crate::slack::tests::server;

    fn accounts(url: &str) -> (Arc<Accounts>, tempfile::TempDir, Arc<MemorySecrets>) {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MemorySecrets::new(true));
        let accounts = Arc::new(Accounts::new(dir.path(), secrets.clone()));
        accounts.use_slack(Some("client-1".into()), Endpoints { auth: format!("{url}/authorize"), api: url.to_owned(), port: 0 });
        (accounts, dir, secrets)
    }

    fn sign_in_here(accounts: &Arc<Accounts>) -> Value {
        let (tx, rx) = std::sync::mpsc::channel();
        let page = accounts.slack_sign_in(Arc::new(move |r| tx.send(r).unwrap())).unwrap();
        let page = url::Url::parse(page["url"].as_str().unwrap()).unwrap();
        let q = |k: &str| page.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned()).unwrap();
        let _ = ureq::get(&format!("{}?code=the-code&state={}", q("redirect_uri"), q("state")).replacen("localhost", "127.0.0.1", 1)).call();
        rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap()
    }

    #[test]
    fn a_slack_workspace_is_kept_once_and_read_as_the_person() {
        let (url, log) = server();
        let (accounts, dir, secrets) = accounts(&url);
        let kept = sign_in_here(&accounts);
        assert_eq!(kept["name"], "Northway");
        let id = kept["id"].as_str().unwrap().to_owned();
        assert_eq!(accounts.list(), json!([{ "id": id, "service": "slack", "name": "Northway", "status": "ready" }]));
        // Signing in to the same workspace again keeps one account.
        assert_eq!(sign_in_here(&accounts)["id"], id.as_str());
        assert_eq!(accounts.list().as_array().unwrap().len(), 1);
        // The list is kept across runs; the tokens are not in it.
        let file = std::fs::read_to_string(dir.path().join("messages-accounts.json")).unwrap();
        assert!(!file.contains("xox"));
        assert!(secrets.get(&secret_name(&id)).unwrap().contains("xoxe.xoxp-"));
        let channels = accounts.channels(&id).unwrap();
        assert_eq!(channels[1], json!({ "id": "D1", "account": id, "name": "Lee Park", "kind": "direct", "unread": 0, "mentions": 0 }));
        assert_eq!(accounts.history(&id, "C1", None, None, 200).unwrap().as_array().unwrap().len(), 2);
        assert_eq!(accounts.send(&id, "C1", "  On it  ", None).unwrap()["author"]["me"], true);
        assert_eq!(accounts.send(&id, "C1", "   ", None).unwrap_err(), "There is nothing to send.");
        accounts.mark_read(&id, "C1", "1731920760.000300").unwrap();
        // Names are read once, not on every call.
        assert_eq!(log.lock().unwrap().iter().filter(|l| l.starts_with("users.list ")).count(), 1);
        accounts.remove(&id).unwrap();
        assert_eq!(accounts.list(), json!([]));
        assert!(secrets.get(&secret_name(&id)).is_none());
    }

    #[test]
    fn an_ended_sign_in_shows_the_account_signed_out_until_signed_in_again() {
        let (url, _) = server();
        let (accounts, _dir, secrets) = accounts(&url);
        let id = sign_in_here(&accounts)["id"].as_str().unwrap().to_owned();
        let tokens: Tokens = serde_json::from_str(&secrets.get(&secret_name(&id)).unwrap()).unwrap();
        // A stale token Slack won't refresh any more.
        secrets.put(&secret_name(&id), &serde_json::to_string(&Tokens { access: "xoxe.xoxp-expired".into(), refresh: "gone".into(), expires: 1, ..tokens.clone() }).unwrap());
        assert_eq!(accounts.channels(&id).unwrap_err(), EXPIRED);
        assert_eq!(accounts.list()[0]["status"], "signed-out");
        assert_eq!(accounts.list()[0]["message"], EXPIRED);
        sign_in_here(&accounts);
        assert_eq!(accounts.list()[0]["status"], "ready");
        assert!(accounts.channels(&id).is_ok());
        // A stale token that refreshes is used without the person noticing.
        secrets.put(&secret_name(&id), &serde_json::to_string(&Tokens { expires: 1, ..tokens }).unwrap());
        assert!(accounts.channels(&id).is_ok());
        assert!(serde_json::from_str::<Tokens>(&secrets.get(&secret_name(&id)).unwrap()).unwrap().fresh());
    }

    #[test]
    fn a_matrix_account_is_kept_once_read_and_signed_out_when_its_sign_in_ends() {
        let (url, log) = crate::matrix::tests::server(false);
        let (accounts, dir, secrets) = accounts(&url);
        assert_eq!(accounts.matrix_methods(&url).unwrap()["password"], true);
        assert_eq!(accounts.matrix_sign_in(&url, "ana", "nope").unwrap_err(), "That username or password isn't right.");
        let kept = accounts.matrix_sign_in(&url, "ana", "pw").unwrap();
        let id = kept["id"].as_str().unwrap().to_owned();
        assert_eq!(kept, json!({ "id": id, "service": "matrix", "name": "@ana:x" }));
        // Signing in again keeps one account, and ends the device signed in before.
        assert_eq!(accounts.matrix_sign_in(&url, "ana", "pw").unwrap()["id"], id.as_str());
        assert_eq!(accounts.list().as_array().unwrap().len(), 1);
        // Neither the password nor the token is in the list kept on disk.
        let file = std::fs::read_to_string(dir.path().join("messages-accounts.json")).unwrap();
        assert!(!file.contains("pw") && !file.contains("access-"));
        assert_eq!(accounts.channels(&id).unwrap().as_array().unwrap().len(), 2);
        assert_eq!(accounts.history(&id, "!ops:x", None, None, 50).unwrap().as_array().unwrap().len(), 2);
        assert_eq!(accounts.send(&id, "!ops:x", " Done ", None).unwrap()["text"], "Done");
        accounts.mark_read(&id, "!ops:x", "$b").unwrap();
        // A token the server no longer takes is refreshed without the person noticing.
        let session: Session = serde_json::from_str(&secrets.get(&secret_name(&id)).unwrap()).unwrap();
        secrets.put(&secret_name(&id), &serde_json::to_string(&Session { access: "access-expired".into(), ..session.clone() }).unwrap());
        assert!(accounts.channels(&id).is_ok());
        // One that can't be refreshed shows the account signed out.
        secrets.put(&secret_name(&id), &serde_json::to_string(&Session { access: "access-expired".into(), refresh: "gone".into(), ..session }).unwrap());
        assert_eq!(accounts.channels(&id).unwrap_err(), crate::matrix::EXPIRED);
        assert_eq!(accounts.list()[0]["status"], "signed-out");
        accounts.remove(&id).unwrap();
        assert!(secrets.get(&secret_name(&id)).is_none());
        let started = Instant::now();
        while log.lock().unwrap().iter().filter(|l| l.starts_with("POST /_matrix/client/v3/logout")).count() < 2 && started.elapsed() < Duration::from_secs(5) {
            std::thread::yield_now();
        }
        assert_eq!(log.lock().unwrap().iter().filter(|l| l.starts_with("POST /_matrix/client/v3/logout")).count(), 2);
    }

    #[test]
    fn an_unknown_account_is_gone() {
        let (url, _) = server();
        let (accounts, _dir, _) = accounts(&url);
        assert_eq!(accounts.channels("nope").unwrap_err(), "That account is gone.");
        assert_eq!(accounts.remove("nope").unwrap_err(), "That account is gone.");
    }
}
