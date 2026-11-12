//! Settings, Usage: how many tokens each model call used, kept on this computer as one row per day, gateway, model,
//! app and kind, already summed. Costs are estimated when asked for, from a price list (see [`Prices`]).
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::providers::{self, Providers};

/// Two years of days is plenty; older rows are dropped as new ones come.
const MAX_DAYS: usize = 731;
const MAX_NAME_CHARS: usize = 200;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One model call, as the core reported it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub day: String,
    pub gateway: String,
    pub model: String,
    pub app: String,
    pub kind: String,
    pub input: u64,
    pub output: u64,
    pub cached: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Tally {
    requests: u64,
    input: u64,
    output: u64,
    cached: u64,
}

/// day, gateway, model, app, kind.
type Key = (String, String, String, String, String);

pub struct UsageBook {
    path: PathBuf,
    rows: Mutex<BTreeMap<Key, Tally>>,
}

#[derive(Serialize, Deserialize)]
struct SavedRow {
    day: String,
    gateway: String,
    model: String,
    app: String,
    kind: String,
    #[serde(flatten)]
    tally: Tally,
}

pub fn is_day(day: &str) -> bool {
    let b = day.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn clean(text: &str) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(MAX_NAME_CHARS).collect()
}

impl UsageBook {
    pub fn open(path: PathBuf) -> UsageBook {
        let rows = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<SavedRow>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|r| is_day(&r.day))
            .map(|r| ((r.day, r.gateway, r.model, r.app, r.kind), r.tally))
            .collect();
        UsageBook { path, rows: Mutex::new(rows) }
    }

    pub fn record(&self, call: &Call) {
        if !is_day(&call.day) {
            return;
        }
        let mut rows = lock(&self.rows);
        let key = (call.day.clone(), clean(&call.gateway), clean(&call.model), clean(&call.app), clean(&call.kind));
        let tally = rows.entry(key).or_default();
        tally.requests += 1;
        tally.input = tally.input.saturating_add(call.input);
        tally.output = tally.output.saturating_add(call.output);
        tally.cached = tally.cached.saturating_add(call.cached.min(call.input));
        // Keep the newest days only.
        let days: std::collections::BTreeSet<String> = rows.keys().map(|k| k.0.clone()).collect();
        if days.len() > MAX_DAYS
            && let Some(oldest) = days.iter().nth(days.len() - MAX_DAYS)
        {
            let oldest = oldest.clone();
            rows.retain(|k, _| k.0 >= oldest);
        }
        save(&self.path, &rows);
    }

    /// The rows from `from` to `to`, both days included, with an estimated cost in US dollars (null when unknown).
    pub fn query(&self, from: &str, to: &str, prices: &Prices) -> Value {
        let rows = lock(&self.rows);
        let out: Vec<Value> = rows
            .iter()
            .filter(|(k, _)| k.0.as_str() >= from && k.0.as_str() <= to)
            .map(|((day, gateway, model, app, kind), t)| {
                let mut row = json!({
                    "day": day, "gateway": gateway, "model": model, "app": app, "kind": kind,
                    "requests": t.requests, "inputTokens": t.input, "outputTokens": t.output,
                    "costUsd": prices.cost(gateway, model, t),
                });
                if t.cached > 0 {
                    row["cachedTokens"] = json!(t.cached);
                }
                row
            })
            .collect();
        Value::Array(out)
    }

    pub fn clear(&self) {
        let mut rows = lock(&self.rows);
        rows.clear();
        save(&self.path, &rows);
    }
}

fn save(path: &Path, rows: &BTreeMap<Key, Tally>) {
    let saved: Vec<SavedRow> = rows
        .iter()
        .map(|((day, gateway, model, app, kind), tally)| SavedRow { day: day.clone(), gateway: gateway.clone(), model: model.clone(), app: app.clone(), kind: kind.clone(), tally: tally.clone() })
        .collect();
    if let Ok(text) = serde_json::to_vec(&saved) {
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            std::fs::rename(&tmp, path).ok();
        }
    }
}

const MAX_CSV_BYTES: usize = 5 * 1024 * 1024;

/// Save the Usage table the window made as `Exports/Usage <day>.csv` in the workspace (so Files shows it), never
/// replacing a file there. Returns where, relative to the workspace.
pub fn export_csv(workspace: &Path, csv: &str, day: &str) -> Result<String, String> {
    if csv.is_empty() || csv.len() > MAX_CSV_BYTES {
        return Err("There is nothing to export.".into());
    }
    let day = if is_day(day) { day } else { "export" };
    let folder = workspace.join("Exports");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    for n in 1..1000 {
        let name = if n < 2 { format!("Usage {day}.csv") } else { format!("Usage {day} {n}.csv") };
        match std::fs::OpenOptions::new().write(true).create_new(true).open(folder.join(&name)) {
            Ok(mut f) => {
                if let Err(e) = std::io::Write::write_all(&mut f, csv.as_bytes()) {
                    drop(f);
                    std::fs::remove_file(folder.join(&name)).ok();
                    return Err(e.to_string());
                }
                return Ok(format!("Exports/{name}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Exports has too many usage files.".into())
}

/// The gateway an address belongs to, as Settings names it: a gateway's id, a plan's id, `local` for a server on this
/// computer, or the address's host for one of your own.
pub fn gateway_of(endpoint: &str, gateways: &Providers) -> String {
    if let Some(plan) = providers::SUBSCRIPTIONS.iter().find(|s| s.address.eq_ignore_ascii_case(endpoint.trim())) {
        return plan.id.to_owned();
    }
    if let Some(id) = gateways.id_for_address(endpoint) {
        return id.to_owned();
    }
    let host = endpoint.split("://").nth(1).unwrap_or(endpoint).split(['/', ':']).next().unwrap_or("").to_ascii_lowercase();
    if host == "localhost" || host == "[::1]" || host.starts_with("127.") || host.is_empty() {
        return "local".to_owned();
    }
    host
}

fn is_local_gateway(gateway: &str) -> bool {
    gateway == "local" || providers::CATALOG.iter().any(|p| p.id == gateway && !p.needs_key)
}

fn is_plan(gateway: &str) -> bool {
    providers::find_subscription(gateway).is_some()
}

/// US dollars per million tokens.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    /// For input read from the cache; the input price when not given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached: Option<f64>,
}

/// Prices by model name. A model on this computer costs nothing; one on a plan has no per-token price (null); any
/// other is looked up by its name, then by its name without the gateway's prefix ("openai/gpt-5" and "gpt-5").
#[derive(Debug, Clone, Default)]
pub struct Prices {
    by_model: BTreeMap<String, Price>,
}

fn bare(model: &str) -> &str {
    model.rsplit('/').next().unwrap_or(model)
}

impl Prices {
    pub fn new(by_model: BTreeMap<String, Price>) -> Prices {
        Prices { by_model }
    }

    /// OpenRouter's public list of models (`/api/v1/models`), whose prices are per token, as text.
    pub fn from_openrouter(list: &Value) -> Prices {
        let per_million = |v: Option<&Value>| v.and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())).filter(|p| p.is_finite() && *p >= 0.0).map(|p| p * 1_000_000.0);
        let mut by_model = BTreeMap::new();
        for m in list.get("data").and_then(Value::as_array).into_iter().flatten() {
            let (Some(id), Some(pricing)) = (m.get("id").and_then(Value::as_str), m.get("pricing")) else { continue };
            let (Some(input), Some(output)) = (per_million(pricing.get("prompt")), per_million(pricing.get("completion"))) else { continue };
            let price = Price { input, output, cached: per_million(pricing.get("input_cache_read")) };
            by_model.insert(id.to_owned(), price);
            by_model.entry(bare(id).to_owned()).or_insert(price);
        }
        Prices { by_model }
    }

    fn price_of(&self, model: &str) -> Option<Price> {
        self.by_model.get(model).or_else(|| self.by_model.get(bare(model))).copied()
    }

    fn cost(&self, gateway: &str, model: &str, t: &Tally) -> Value {
        if is_local_gateway(gateway) {
            return json!(0.0);
        }
        if is_plan(gateway) {
            return Value::Null;
        }
        match self.price_of(model) {
            Some(p) => {
                let cached = t.cached.min(t.input) as f64;
                let fresh = t.input as f64 - cached;
                let usd = (fresh * p.input + cached * p.cached.unwrap_or(p.input) + t.output as f64 * p.output) / 1_000_000.0;
                json!((usd * 1_000_000.0).round() / 1_000_000.0)
            }
            None => Value::Null,
        }
    }
}

/// Where prices come from: OpenRouter's public model list, fetched at most once a day when Usage is looked at and
/// kept beside the tally. Nothing about the person is sent; it is a plain request for the list.
pub struct PriceList {
    path: PathBuf,
    url: String,
    cached: Mutex<Option<(u64, Prices)>>,
    fetching: Mutex<bool>,
}

const PRICES_URL: &str = "https://openrouter.ai/api/v1/models";
const DAY_SECS: u64 = 24 * 60 * 60;

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl PriceList {
    pub fn new(path: PathBuf) -> PriceList {
        let cached = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| {
            let at = v.get("fetchedAt").and_then(Value::as_u64).unwrap_or(0);
            let by_model: BTreeMap<String, Price> = v.get("prices").cloned().and_then(|p| serde_json::from_value(p).ok()).unwrap_or_default();
            (at, Prices::new(by_model))
        });
        PriceList { path, url: PRICES_URL.to_owned(), cached: Mutex::new(cached), fetching: Mutex::new(false) }
    }

    pub fn redirect_for_tests(&mut self, url: &str) {
        url.clone_into(&mut self.url);
    }

    pub fn prices(&self) -> Prices {
        lock(&self.cached).as_ref().map(|(_, p)| p.clone()).unwrap_or_default()
    }

    /// Whether the list is a day old or missing, so a fetch is worth starting.
    pub fn stale(&self) -> bool {
        lock(&self.cached).as_ref().is_none_or(|(at, _)| now().saturating_sub(*at) > DAY_SECS)
    }

    /// Fetch the list (blocking). Returns whether it changed the prices.
    pub fn refresh(&self) -> bool {
        {
            let mut busy = lock(&self.fetching);
            if *busy {
                return false;
            }
            *busy = true;
        }
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(std::time::Duration::from_secs(8))).timeout_global(Some(std::time::Duration::from_secs(30))).build().into();
        let fetched = agent
            .get(&self.url)
            .call()
            .ok()
            .and_then(|mut r| r.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().ok())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok());
        *lock(&self.fetching) = false;
        let Some(list) = fetched else { return false };
        let prices = Prices::from_openrouter(&list);
        if prices.by_model.is_empty() {
            return false;
        }
        let at = now();
        if let Ok(text) = serde_json::to_vec(&json!({ "fetchedAt": at, "prices": prices.by_model })) {
            std::fs::write(&self.path, text).ok();
        }
        *lock(&self.cached) = Some((at, prices));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(day: &str, gateway: &str, model: &str, input: u64, output: u64, cached: u64) -> Call {
        Call { day: day.into(), gateway: gateway.into(), model: model.into(), app: "mail".into(), kind: "chat".into(), input, output, cached }
    }

    fn book() -> (tempfile::TempDir, UsageBook) {
        let dir = tempfile::tempdir().unwrap();
        let book = UsageBook::open(dir.path().join("usage.json"));
        (dir, book)
    }

    #[test]
    fn calls_on_the_same_day_model_and_app_add_up_into_one_row() {
        let (_dir, book) = book();
        book.record(&call("2026-11-12", "openai", "gpt-5", 1000, 200, 400));
        book.record(&call("2026-11-12", "openai", "gpt-5", 500, 100, 0));
        book.record(&call("2026-11-13", "openai", "gpt-5", 10, 1, 0));
        let rows = book.query("2026-11-12", "2026-11-12", &Prices::default());
        assert_eq!(rows, json!([{ "day": "2026-11-12", "gateway": "openai", "model": "gpt-5", "app": "mail", "kind": "chat", "requests": 2, "inputTokens": 1500, "outputTokens": 300, "cachedTokens": 400, "costUsd": null }]));
        assert_eq!(book.query("2026-11-01", "2026-11-30", &Prices::default()).as_array().unwrap().len(), 2);
    }

    #[test]
    fn the_tally_is_kept_on_disk_and_can_be_cleared() {
        let (dir, book) = book();
        book.record(&call("2026-11-12", "ollama", "llama3", 10, 5, 0));
        let again = UsageBook::open(dir.path().join("usage.json"));
        assert_eq!(again.query("2026-11-12", "2026-11-12", &Prices::default())[0]["requests"], 1);
        again.clear();
        assert_eq!(UsageBook::open(dir.path().join("usage.json")).query("0000-00-00", "9999-99-99", &Prices::default()), json!([]));
    }

    #[test]
    fn cost_is_free_on_this_computer_unknown_on_a_plan_and_priced_from_the_list_elsewhere() {
        let prices = Prices::from_openrouter(&json!({ "data": [
            { "id": "openai/gpt-5", "pricing": { "prompt": "0.000001", "completion": "0.00001", "input_cache_read": "0.0000001" } },
            { "id": "broken", "pricing": { "prompt": "x" } },
        ] }));
        let t = Tally { requests: 1, input: 1_000_000, output: 100_000, cached: 500_000 };
        assert_eq!(prices.cost("ollama", "gpt-5", &t), json!(0.0));
        assert_eq!(prices.cost("local", "anything", &t), json!(0.0));
        assert_eq!(prices.cost("chatgpt", "gpt-5", &t), Value::Null);
        // 500k fresh at $1/M + 500k cached at $0.10/M + 100k out at $10/M.
        assert_eq!(prices.cost("openai", "gpt-5", &t), json!(1.55));
        assert_eq!(prices.cost("openrouter", "openai/gpt-5", &t), json!(1.55));
        assert_eq!(prices.cost("openai", "unknown-model", &t), Value::Null);
        assert_eq!(prices.cost("openai", "broken", &t), Value::Null);
    }

    #[test]
    fn a_gateway_is_named_from_its_address() {
        let gateways = Providers::new(Arc::new(crate::secrets::MemorySecrets::new(true)));
        assert_eq!(gateway_of("https://api.openai.com/v1", &gateways), "openai");
        assert_eq!(gateway_of("claude-code://subscription", &gateways), "claude-code");
        assert_eq!(gateway_of("http://127.0.0.1:9999/v1", &gateways), "local");
        assert_eq!(gateway_of("https://models.example.com:8443/v1", &gateways), "models.example.com");
    }

    #[test]
    fn an_export_goes_to_exports_and_never_replaces_a_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(export_csv(dir.path(), "day,model\n", "2026-11-12").unwrap(), "Exports/Usage 2026-11-12.csv");
        assert_eq!(export_csv(dir.path(), "day,model\n", "2026-11-12").unwrap(), "Exports/Usage 2026-11-12 2.csv");
        assert_eq!(std::fs::read_to_string(dir.path().join("Exports/Usage 2026-11-12.csv")).unwrap(), "day,model\n");
        assert!(export_csv(dir.path(), "", "2026-11-12").is_err());
        assert_eq!(export_csv(dir.path(), "x", "../../etc").unwrap(), "Exports/Usage export.csv");
    }

    #[test]
    fn only_real_days_are_kept() {
        let (_dir, book) = book();
        book.record(&call("12/11/2026", "openai", "gpt-5", 1, 1, 0));
        assert_eq!(book.query("0000-00-00", "9999-99-99", &Prices::default()), json!([]));
        assert!(is_day("2026-11-12") && !is_day("2026-1-12") && !is_day("2026-11-1x"));
    }

    use std::sync::Arc;
}
