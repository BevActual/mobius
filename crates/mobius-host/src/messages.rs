//! The Messages app's accounts: chat services the person signed in to, read and sent through as them. Messages are
//! read from the service as they are shown and nothing of them is kept here; this keeps only the list of accounts
//! (`messages-accounts.json` in the data folder) and, in the system secret store, each account's sign-in.
//!
//! Slack (`slack`), Matrix (`matrix`), Microsoft Teams chats (`teams`) and Telegram (`telegram`). Only the person sends: the app calls `send` from their own Send, and the
//! agent has no tool that does: it only reads, through `messages_tools`.
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
use crate::telegram::{self, Next, Telegram};

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
    /// `slack`, `matrix`, `teams` or `telegram`.
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
    /// Telegram, made the first time it is needed (it runs its own connection thread).
    telegram: std::sync::OnceLock<Option<Arc<Telegram>>>,
}

/// The person's account on the local Mobius space, and where its password is kept.
const LOCAL_USER: &str = "me";
const LOCAL_PASSWORD: &str = "messages-local-space-password";

fn secret_name(id: &str) -> String {
    format!("messages-account:{id}")
}

fn member_secret(bot: &str) -> String {
    format!("messages-space-member:{bot}")
}

fn random_hex() -> Res<String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The agent's own conversation for what the person writes to it in the space; it belongs to that agent.
fn new_conversation(bot: &str) -> Res<String> {
    let id = &random_hex()?[..16];
    Ok(if bot == "main" { format!("c-space-{id}") } else { format!("c-{bot}-space-{id}") })
}

/// An agent as a member of the local space: its account there, and its direct room with the person.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Member {
    pub bot: String,
    pub name: String,
    pub user: String,
    pub room: String,
    /// The agent's conversation that what the person writes in the room goes to.
    pub conversation: String,
}

/// A Matrix event's address on matrix.to, which any Matrix app opens.
fn matrix_link(room: &str, event: &str) -> String {
    let part = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>();
    format!("https://matrix.to/#/{}/{}", part(room), part(event))
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
        Accounts { file, secrets, state: Mutex::new(state), slack: Mutex::new(slack), matrix: Arc::new(Matrix::new()), crypto: Mutex::default(), people: Mutex::default(), microsoft: Mutex::new(microsoft), telegram: std::sync::OnceLock::new() }
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
                        Some(EXPIRED | matrix::EXPIRED | teams::EXPIRED | telegram::EXPIRED) => "signed-out",
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
        if self.is_service(id, "telegram") {
            return self.with_telegram(id, |t, kept, _| t.channels(id, kept)).map(Value::Array);
        }
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
        if self.is_service(id, "telegram") {
            return if thread.is_some() { Ok(json!([])) } else { self.with_telegram(id, |t, kept, me| t.history(id, kept, channel, before, limit, me.0)).map(Value::Array) };
        }
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
        if self.is_service(id, "telegram") {
            return self.with_telegram(id, |t, kept, me| t.send(id, kept, channel, text, me.0, &me.1));
        }
        self.with(id, |slack, tokens| {
            let people = self.people(id, slack, tokens)?;
            slack.send(&tokens.access, channel, text, thread, &tokens.user, &people)
        })
    }

    pub fn mark_read(&self, id: &str, channel: &str, up_to: &str) -> Res<()> {
        if self.is_service(id, "telegram") {
            return self.with_telegram(id, |t, kept, _| t.mark_read(id, kept, channel).map(|changed| ((), changed)));
        }
        if self.is_teams(id) {
            return self.with_teams(id, |t, a, me| t.mark_read(a, channel, me));
        }
        if self.is_matrix(id) {
            return self.with_matrix(id, |m, s| m.mark_read(id, s, channel, up_to));
        }
        self.with(id, |slack, tokens| slack.mark_read(&tokens.access, channel, up_to))
    }

    fn service_name(&self, id: &str) -> String {
        let service = lock(&self.state).iter().find(|a| a.id == id).map(|a| a.service.clone()).unwrap_or_default();
        match service.as_str() {
            "matrix" => "Matrix",
            "teams" => "Teams",
            "telegram" => "Telegram",
            _ => "this account",
        }
        .to_owned()
    }

    /// The person's reaction on a message, added or taken back. Slack only, once it may ([`crate::slack::REACTION_SCOPE`]).
    pub fn react(&self, id: &str, channel: &str, message: &str, emoji: &str, on: bool) -> Res<()> {
        if !self.is_service(id, "slack") {
            return Err(format!("Reacting from Mobius isn't available for {} yet.", self.service_name(id)));
        }
        self.with(id, |slack, tokens| slack.react(&tokens.access, channel, message, emoji, on)).map_err(|e| {
            if e.contains("didn't give Mobius that permission") { "Reacting needs a Slack permission Mobius doesn't ask for yet.".to_owned() } else { e }
        })
    }

    /// A link to the message on its service, to copy or open.
    pub fn permalink(&self, id: &str, channel: &str, message: &str) -> Res<String> {
        if self.is_matrix(id) {
            return Ok(matrix_link(channel, message));
        }
        if !self.is_service(id, "slack") {
            return Err(format!("Message links aren't available for {} yet.", self.service_name(id)));
        }
        self.with(id, |slack, tokens| slack.permalink(&tokens.access, channel, message))
    }

    /// Unread again from this message on.
    pub fn mark_unread(&self, id: &str, channel: &str, message: &str) -> Res<()> {
        if !self.is_service(id, "slack") {
            return Err(format!("Marking unread isn't available for {} yet.", self.service_name(id)));
        }
        self.with(id, |slack, tokens| slack.mark_unread(&tokens.access, channel, message))
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

    fn is_service(&self, id: &str, service: &str) -> bool {
        lock(&self.state).iter().any(|a| a.id == id && a.service == service)
    }

    fn telegram(&self) -> Option<Arc<Telegram>> {
        self.telegram.get_or_init(|| Telegram::new(telegram::built_in()).ok().map(Arc::new)).clone()
    }

    /// A pretend Telegram, in tests: one without keys.
    #[cfg(test)]
    pub fn use_telegram(&self, t: Telegram) {
        let _ = self.telegram.set(Some(Arc::new(t)));
    }

    /// Runs `f` with the Telegram account's kept sign-in and who it is (`(user id, name)`). What changed in the
    /// sign-in is kept again; a device Telegram signed out marks the account signed out.
    fn with_telegram<T>(&self, id: &str, f: impl FnOnce(&Telegram, &Value, &(i64, String)) -> Res<(T, Option<Value>)>) -> Res<T> {
        let t = self.telegram().ok_or(telegram::NOT_SET_UP)?;
        let mut saved: Value = self.secrets.get(&secret_name(id)).and_then(|k| serde_json::from_str(&k).ok()).ok_or(telegram::EXPIRED)?;
        let me = (saved["user"].as_i64().unwrap_or(0), saved["name"].as_str().unwrap_or("").to_owned());
        let result = f(&t, &saved["kept"], &me);
        match &result {
            Ok((_, Some(changed))) => {
                saved["kept"] = changed.clone();
                self.secrets.put(&secret_name(id), &saved.to_string());
                self.set_problem(id, None);
            }
            Ok(_) => self.set_problem(id, None),
            Err(e) if e == telegram::EXPIRED => self.set_problem(id, Some(telegram::EXPIRED.into())),
            Err(_) => {}
        }
        result.map(|(t, _)| t)
    }

    /// Whether Telegram can be signed in to in this build, and whether a sign-in is waiting for a code or password.
    pub fn telegram_status(&self) -> Value {
        match self.telegram() {
            Some(t) if t.set_up() => json!({ "setUp": true, "pending": t.signing_in(), "hint": null }),
            _ => json!({ "setUp": false, "pending": false, "hint": telegram::NOT_SET_UP }),
        }
    }

    /// One step of signing in to Telegram: `phone` starts it, then `code`, then `password` if the account has one.
    /// Answers `{ next: "code" }`, `{ next: "password", hint }`, or the kept account.
    pub fn telegram_sign_in(&self, step: &str, value: &str) -> Res<Value> {
        let t = self.telegram().filter(|t| t.set_up()).ok_or(telegram::NOT_SET_UP)?;
        let next = match step {
            "phone" => t.start(value)?,
            "code" => t.code(value)?,
            "password" => t.password(value)?,
            _ => return Err("That sign-in step isn't known.".into()),
        };
        match next {
            Next::Code => Ok(json!({ "next": "code" })),
            Next::Password { hint } => Ok(json!({ "next": "password", "hint": hint })),
            Next::Done(signed) => self.keep_telegram(&t, &signed),
        }
    }

    pub fn telegram_cancel(&self) {
        if let Some(t) = self.telegram() {
            t.cancel();
        }
    }

    fn keep_telegram(&self, t: &Telegram, signed: &telegram::SignedIn) -> Res<Value> {
        let team = signed.user.to_string();
        let mut all = lock(&self.state);
        let existing = all.iter().position(|a| a.service == "telegram" && a.team == team);
        if existing.is_none() && all.len() >= MAX_ACCOUNTS {
            return Err(format!("There can be at most {MAX_ACCOUNTS} message accounts."));
        }
        let id = existing.map_or_else(new_id, |i| all[i].id.clone());
        let name = Some(signed.name.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Telegram".into());
        let saved = json!({ "kept": signed.kept, "user": signed.user, "name": name });
        if !self.secrets.put(&secret_name(&id), &saved.to_string()) {
            return Err("The sign-in could not be kept in this computer's secret store.".into());
        }
        // A new sign-in replaces the old connection.
        t.forget(&id);
        match existing {
            Some(i) => {
                all[i].problem = None;
                all[i].name = name.clone();
            }
            None => all.push(Account { id: id.clone(), service: "telegram".into(), name: name.clone(), team, problem: None }),
        }
        self.save(&all);
        Ok(json!({ "id": id, "service": "telegram", "name": name }))
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

    /// The local Mobius space, on the homeserver Mobius runs at `url`: the first time, makes the person's account there
    /// (through `register`, with a password kept in this computer's secret store), keeps it like any Matrix account
    /// (named "Mobius space"), and makes the space with a General channel. Later, only its address is brought up to date.
    pub fn local_space(&self, url: &str, register: &dyn Fn(&str, &str) -> Res<bool>) -> Res<String> {
        let me = format!("@{LOCAL_USER}:{}", crate::homeserver::SERVER_NAME);
        let existing = lock(&self.state).iter().find(|a| a.service == "matrix" && a.team == me).map(|a| a.id.clone());
        if let Some(id) = existing {
            if let Some(mut session) = self.secrets.get(&secret_name(&id)).and_then(|t| serde_json::from_str::<Session>(&t).ok()) {
                if session.homeserver != url {
                    session.homeserver = url.to_owned();
                    let text = serde_json::to_string(&session).map_err(|e| e.to_string())?;
                    self.secrets.put(&secret_name(&id), &text);
                    self.matrix.forget(&id);
                }
                return Ok(id);
            }
        }
        let password = match self.secrets.get(LOCAL_PASSWORD) {
            Some(p) if p.len() >= 32 => p,
            _ => {
                let mut bytes = [0u8; 24];
                getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
                let p: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                if !self.secrets.put(LOCAL_PASSWORD, &p) {
                    return Err("The space's sign-in could not be kept in this computer's secret store.".into());
                }
                p
            }
        };
        let made = register(LOCAL_USER, &password)?;
        let session = self.matrix.password_sign_in(url, LOCAL_USER, &password)?;
        let kept = self.keep_matrix(&session)?;
        let id = kept["id"].as_str().unwrap_or_default().to_owned();
        {
            let mut all = lock(&self.state);
            if let Some(a) = all.iter_mut().find(|a| a.id == id) {
                a.name = "Mobius space".into();
            }
            self.save(&all);
        }
        if made {
            self.make_space(&session)?;
        }
        Ok(id)
    }

    /// The space itself and its first channel.
    fn make_space(&self, s: &Session) -> Res<()> {
        let room = |body: Value| self.matrix.call("POST", &format!("{}/_matrix/client/v3/createRoom", s.homeserver), Some(&s.access), Some(&body));
        let space = room(json!({ "name": "Mobius", "topic": "Your own space: channels, and a message from each agent.", "preset": "private_chat", "creation_content": { "type": "m.space" } }))?;
        let space = space["room_id"].as_str().ok_or("The space's server didn't make the space.")?.to_owned();
        let general = room(json!({ "name": "General", "preset": "private_chat", "initial_state": [{ "type": "m.space.parent", "state_key": space, "content": { "via": [crate::homeserver::SERVER_NAME], "canonical": true } }] }))?;
        let general = general["room_id"].as_str().ok_or("The space's server didn't make its channel.")?;
        let child = format!("{}/_matrix/client/v3/rooms/{}/state/m.space.child/{}", s.homeserver, percent_encoding::utf8_percent_encode(&space, percent_encoding::NON_ALPHANUMERIC), percent_encoding::utf8_percent_encode(general, percent_encoding::NON_ALPHANUMERIC));
        self.matrix.call("PUT", &child, Some(&s.access), Some(&json!({ "via": [crate::homeserver::SERVER_NAME], "suggested": true })))?;
        Ok(())
    }

    /// The local space's account and its sign-in, once it has been made.
    fn local_session(&self) -> Option<(String, Session)> {
        let me = format!("@{LOCAL_USER}:{}", crate::homeserver::SERVER_NAME);
        let id = lock(&self.state).iter().find(|a| a.service == "matrix" && a.team == me).map(|a| a.id.clone())?;
        let session = self.secrets.get(&secret_name(&id)).and_then(|t| serde_json::from_str::<Session>(&t).ok())?;
        Some((id, session))
    }

    fn members_file(&self) -> PathBuf {
        self.file.with_file_name("space-members.json")
    }

    /// The agents that are members of the local space.
    pub fn space_members(&self) -> Vec<Member> {
        std::fs::read_to_string(self.members_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn save_members(&self, members: &[Member]) {
        if let Ok(text) = serde_json::to_string_pretty(members) {
            let _ = std::fs::write(self.members_file(), text);
        }
    }

    /// A member's own sign-in, which the space's server gave it.
    fn member_session(&self, bot: &str) -> Option<Session> {
        self.secrets.get(&member_secret(bot)).and_then(|t| serde_json::from_str(&t).ok())
    }

    /// Each agent (`bots`: id and name, Mobius first) as a member of the local space: the first time, its own account
    /// there (through `register`) and a direct room with the person, which shows as a message from the agent. A renamed
    /// agent is renamed there; a removed one leaves. Only the person's own computer reaches this server.
    pub fn sync_space_members(&self, bots: &[(String, String)], register: &dyn Fn(&str, &str) -> Res<bool>) -> Res<()> {
        let (_, me) = self.local_session().ok_or("The space isn't made yet.")?;
        let url = me.homeserver.clone();
        let call = |method: &str, parts: &[&str], token: &str, body: Option<&Value>| -> Res<Value> {
            let mut all = vec!["_matrix", "client", "v3"];
            all.extend_from_slice(parts);
            self.matrix.call(method, &matrix::endpoint(&url, &all, &[])?, Some(token), body)
        };
        let mut members = self.space_members();
        for (bot, name) in bots {
            if let Some(m) = members.iter_mut().find(|m| &m.bot == bot) {
                if &m.name != name {
                    let s = self.member_session(bot).ok_or("An agent's sign-in to the space is missing.")?;
                    call("PUT", &["profile", &m.user, "displayname"], &s.access, Some(&json!({ "displayname": name })))?;
                    call("PUT", &["rooms", &m.room, "state", "m.room.name", ""], &s.access, Some(&json!({ "name": name })))?;
                    m.name.clone_from(name);
                }
                continue;
            }
            let local = if bot == "main" { "mobius".to_owned() } else { format!("agent-{bot}") };
            let password = match self.secrets.get(&format!("{}-password", member_secret(bot))) {
                Some(p) if p.len() >= 32 => p,
                _ => {
                    let p = random_hex()?;
                    if !self.secrets.put(&format!("{}-password", member_secret(bot)), &p) {
                        return Err("An agent's sign-in could not be kept in this computer's secret store.".into());
                    }
                    p
                }
            };
            register(&local, &password)?;
            let mut session = self.matrix.password_sign_in(&url, &local, &password)?;
            session.homeserver.clone_from(&url);
            self.secrets.put(&member_secret(bot), &serde_json::to_string(&session).map_err(|e| e.to_string())?);
            call("PUT", &["profile", &session.user, "displayname"], &session.access, Some(&json!({ "displayname": name })))?;
            let room = call("POST", &["createRoom"], &session.access, Some(&json!({ "name": name, "preset": "trusted_private_chat", "is_direct": true, "invite": [me.user] })))?;
            let room = room["room_id"].as_str().ok_or("The space's server didn't make the agent's room.")?.to_owned();
            call("POST", &["join", &room], &me.access, Some(&json!({})))?;
            // The person's list of direct rooms, so it shows as a message from the agent rather than a channel.
            let mut direct = call("GET", &["user", &me.user, "account_data", "m.direct"], &me.access, None).unwrap_or_else(|_| json!({}));
            if !direct.is_object() {
                direct = json!({});
            }
            direct[session.user.as_str()] = json!([room]);
            call("PUT", &["user", &me.user, "account_data", "m.direct"], &me.access, Some(&direct))?;
            members.push(Member { bot: bot.clone(), name: name.clone(), user: session.user.clone(), room, conversation: new_conversation(bot)? });
            self.save_members(&members);
        }
        let (keep, gone): (Vec<Member>, Vec<Member>) = members.into_iter().partition(|m| bots.iter().any(|(b, _)| b == &m.bot));
        for m in &gone {
            if let Some(s) = self.member_session(&m.bot) {
                let _ = call("POST", &["rooms", &m.room, "leave"], &s.access, Some(&json!({})));
            }
            // The person leaves it too, so it goes from their list.
            let _ = call("POST", &["rooms", &m.room, "leave"], &me.access, Some(&json!({})));
            self.secrets.delete(&member_secret(&m.bot));
            self.secrets.delete(&format!("{}-password", member_secret(&m.bot)));
        }
        self.save_members(&keep);
        Ok(())
    }

    /// The agent whose direct room `room` is, in the local space's account `id`.
    pub fn space_member_of(&self, id: &str, room: &str) -> Option<Member> {
        let (local, _) = self.local_session()?;
        if local != id {
            return None;
        }
        self.space_members().into_iter().find(|m| m.room == room)
    }

    /// Posts `text` as the agent `bot`, in its direct room with the person.
    pub fn space_post(&self, bot: &str, text: &str) -> Res<()> {
        let (_, me) = self.local_session().ok_or("The space isn't made yet.")?;
        let m = self.space_members().into_iter().find(|m| m.bot == bot).ok_or("That agent isn't in the space.")?;
        let s = self.member_session(bot).ok_or("An agent's sign-in to the space is missing.")?;
        let txn = random_hex()?;
        let url = matrix::endpoint(&me.homeserver, &["_matrix", "client", "v3", "rooms", &m.room, "send", "m.room.message", &txn], &[])?;
        self.matrix.call("PUT", &url, Some(&s.access), Some(&json!({ "msgtype": "m.text", "body": text })))?;
        Ok(())
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
        let was_telegram = all.iter().any(|a| a.id == id && a.service == "telegram");
        all.retain(|a| a.id != id);
        if all.len() == before {
            return Err("That account is gone.".into());
        }
        self.save(&all);
        drop(all);
        // A Telegram sign-in is its own device too: it is signed out of Telegram, without waiting.
        if was_telegram
            && let (Some(t), Some(saved)) = (self.telegram(), self.secrets.get(&secret_name(id)).and_then(|k| serde_json::from_str::<Value>(&k).ok()))
        {
            let id = id.to_owned();
            std::thread::spawn(move || t.sign_out(&id, &saved["kept"]));
        }
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
    fn the_local_space_makes_its_account_and_space_once_and_follows_its_address() {
        let (url, log) = crate::matrix::tests::server(false);
        let (accounts, _dir, secrets) = accounts(&url);
        let register = |user: &str, password: &str| crate::homeserver::register(&url, "tok", user, password);
        let id = accounts.local_space(&url, &register).unwrap();
        let list = accounts.list();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["name"], "Mobius space");
        let made = log.lock().unwrap().clone();
        assert_eq!(made.iter().filter(|l| l.starts_with("POST /_matrix/client/v3/register")).count(), 2);
        assert!(made.iter().any(|l| l.contains("createRoom") && l.contains("m.space")));
        assert!(made.iter().any(|l| l.starts_with("PUT /_matrix/client/v3/rooms/!space:mobius.localhost/state/m.space.child/!general:mobius.localhost")));
        // The password is kept only in the secret store.
        assert_eq!(secrets.get(LOCAL_PASSWORD).unwrap().len(), 48);
        // Started again (on another port): the same account, its address moved, nothing made again.
        log.lock().unwrap().clear();
        assert_eq!(accounts.local_space("http://127.0.0.1:1", &register).unwrap(), id);
        assert!(log.lock().unwrap().is_empty());
        assert_eq!(serde_json::from_str::<Session>(&secrets.get(&secret_name(&id)).unwrap()).unwrap().homeserver, "http://127.0.0.1:1");
        // The wrong token is refused, plainly.
        assert!(crate::homeserver::register(&url, "nope", "me", &"a".repeat(48)).unwrap_err().contains("refused"));
    }

    #[test]
    fn each_agent_is_a_member_of_the_local_space_with_a_room_of_its_own() {
        let (url, log) = crate::matrix::tests::server(false);
        let (accounts, _dir, secrets) = accounts(&url);
        let register = |user: &str, password: &str| crate::homeserver::register(&url, "tok", user, password);
        assert!(accounts.sync_space_members(&[], &register).is_err(), "nothing before the space is made");
        let id = accounts.local_space(&url, &register).unwrap();
        let bots = vec![("main".to_owned(), "Mobius".to_owned()), ("ab12cd".to_owned(), "Scout".to_owned())];
        accounts.sync_space_members(&bots, &register).unwrap();
        let members = accounts.space_members();
        assert_eq!(members.iter().map(|m| (m.user.as_str(), m.room.as_str())).collect::<Vec<_>>(), [("@mobius:mobius.localhost", "!dm-Mobius:mobius.localhost"), ("@agent-ab12cd:mobius.localhost", "!dm-Scout:mobius.localhost")]);
        assert!(members[0].conversation.starts_with("c-space-") && members[1].conversation.starts_with("c-ab12cd-space-"));
        assert!(crate::agent::is_conversation_id(&members[1].conversation));
        let made = log.lock().unwrap().clone();
        assert!(made.iter().any(|l| l.starts_with("POST /_matrix/client/v3/createRoom") && l.contains("@me:mobius.localhost") && l.contains("trusted_private_chat")));
        assert!(made.iter().any(|l| l.starts_with("POST /_matrix/client/v3/join/!dm-Scout:mobius.localhost")));
        assert!(made.iter().any(|l| l.starts_with("PUT /_matrix/client/v3/user/@me:mobius.localhost/account_data/m.direct") && l.contains("@agent-ab12cd:mobius.localhost")));
        // What the person writes in an agent's room is known as that agent's; other rooms and accounts are not.
        assert_eq!(accounts.space_member_of(&id, "!dm-Scout:mobius.localhost").unwrap().bot, "ab12cd");
        assert!(accounts.space_member_of(&id, "!general:mobius.localhost").is_none());
        assert!(accounts.space_member_of("other", "!dm-Scout:mobius.localhost").is_none());
        accounts.space_post("ab12cd", "Done: the inbox is sorted.").unwrap();
        assert!(log.lock().unwrap().iter().any(|l| l.starts_with("PUT /_matrix/client/v3/rooms/!dm-Scout:mobius.localhost/send/m.room.message/") && l.contains("the inbox is sorted")));
        // Again: nothing new is made. Renamed: renamed there. Removed: it leaves, and its sign-in is forgotten.
        log.lock().unwrap().clear();
        accounts.sync_space_members(&bots, &register).unwrap();
        assert!(log.lock().unwrap().is_empty());
        accounts.sync_space_members(&[("main".to_owned(), "Mobius".to_owned()), ("ab12cd".to_owned(), "Finder".to_owned())], &register).unwrap();
        assert!(log.lock().unwrap().iter().any(|l| l.starts_with("PUT /_matrix/client/v3/profile/@agent-ab12cd:mobius.localhost/displayname") && l.contains("Finder")));
        accounts.sync_space_members(&bots[..1], &register).unwrap();
        assert_eq!(log.lock().unwrap().iter().filter(|l| l.starts_with("POST /_matrix/client/v3/rooms/!dm-Scout:mobius.localhost/leave")).count(), 2, "the agent and the person both leave");
        assert_eq!(accounts.space_members().len(), 1);
        assert!(secrets.get(&member_secret("ab12cd")).is_none());
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
