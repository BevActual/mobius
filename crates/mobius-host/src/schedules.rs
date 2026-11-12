//! Scheduled requests: something to ask Mobius at a time of day, on chosen days ("every weekday at 8:00, brief me on
//! my tasks"). Kept in `schedules.json` in the data folder. Each run is a new conversation, so it shows in the Agent
//! app like any other and its changes can be reviewed. A run missed while Mobius was closed happens once when it next
//! opens on the same day; earlier days are not made up.
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{DateTime, Datelike, Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_SCHEDULES: usize = 50;
const MAX_TITLE: usize = 80;
const MAX_PROMPT: usize = 4000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub title: String,
    pub prompt: String,
    /// "HH:MM", 24-hour, local time.
    pub time: String,
    /// Days it runs: 1 is Monday, 7 is Sunday.
    pub days: Vec<u8>,
    pub enabled: bool,
    /// When it last ran (ms since the epoch), if it has.
    #[serde(default)]
    pub last_run_ms: Option<u64>,
    /// The agent it runs as (its id), with that agent's instructions and model. None is Mobius itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot: Option<String>,
}

/// What the window sends for a new or changed schedule, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Draft {
    pub title: String,
    pub prompt: String,
    pub time: String,
    pub days: Vec<u8>,
    pub enabled: bool,
    pub bot: Option<String>,
}

/// An agent's id, as the Agents app makes them: six lowercase letters and digits. `main` (Mobius) is no agent.
fn is_bot_id(id: &str) -> bool {
    id.len() == 6 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn parse_time(time: &str) -> Option<NaiveTime> {
    let (h, m) = time.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    NaiveTime::from_hms_opt(h.parse().ok()?, m.parse().ok()?, 0)
}

/// The id and last run are not the window's to set. An agent that is not an id is refused; "main" or none is Mobius.
pub fn parse_draft(v: &Value) -> Option<Draft> {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::trim);
    let title = s("title").filter(|t| !t.is_empty() && t.chars().count() <= MAX_TITLE && !t.chars().any(char::is_control))?;
    let prompt = s("prompt").filter(|p| !p.is_empty() && p.chars().count() <= MAX_PROMPT && !p.contains('\0'))?;
    let time = s("time").filter(|t| parse_time(t).is_some())?;
    let mut days: Vec<u8> = v.get("days")?.as_array()?.iter().map(|d| d.as_u64().filter(|d| (1..=7).contains(d)).map(|d| d as u8)).collect::<Option<_>>()?;
    days.sort_unstable();
    days.dedup();
    if days.is_empty() {
        return None;
    }
    let enabled = v.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    let bot = match v.get("bot") {
        None | Some(Value::Null) => None,
        Some(Value::String(b)) if b == "main" || b.is_empty() => None,
        Some(Value::String(b)) if is_bot_id(b) => Some(b.clone()),
        Some(_) => return None,
    };
    Some(Draft { title: title.to_owned(), prompt: prompt.to_owned(), time: time.to_owned(), days, enabled, bot })
}

/// The moment today that `schedule` is due, if it runs today at all.
fn due_today<Tz: TimeZone>(schedule: &Schedule, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let weekday = now.weekday().number_from_monday() as u8;
    if !schedule.days.contains(&weekday) {
        return None;
    }
    let time = parse_time(&schedule.time)?;
    now.timezone().from_local_datetime(&now.date_naive().and_time(time)).earliest()
}

/// Whether `schedule` should run now: it is on, today is one of its days, its time has passed, and it has not run since.
pub fn is_due<Tz: TimeZone>(schedule: &Schedule, now: &DateTime<Tz>) -> bool {
    if !schedule.enabled {
        return false;
    }
    let Some(due) = due_today(schedule, now) else { return false };
    let due_ms = u64::try_from(due.timestamp_millis()).unwrap_or(0);
    now >= &due && schedule.last_run_ms.is_none_or(|last| last < due_ms)
}

pub fn is_schedule_tool(name: &str) -> bool {
    matches!(name, "schedules.list" | "schedules.add")
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "schedules.list", "capability": "schedules.read",
            "description": "List the requests the person has scheduled: name, what is asked, time of day and days (1 is Monday, 7 is Sunday).",
            "input_schema": { "type": "object", "properties": {} } }),
        json!({ "name": "schedules.add", "capability": "schedules.write",
            "description": "Schedule a request to Mobius at a time of day on chosen days, when the person asks for something to happen regularly (\"every weekday at 8, brief me on my tasks\"). Each run starts a new conversation with the prompt. The person may be asked first.",
            "input_schema": { "type": "object", "properties": {
                "title": { "type": "string", "description": "A short name, like Morning brief." },
                "prompt": { "type": "string", "description": "What to ask Mobius each time, written as the person would." },
                "time": { "type": "string", "description": "Local time of day, HH:MM, 24-hour." },
                "days": { "type": "array", "items": { "type": "integer", "minimum": 1, "maximum": 7 }, "description": "1 is Monday, 7 is Sunday." }
            }, "required": ["title", "prompt", "time", "days"] } }),
    ]
}

pub struct Schedules {
    file: PathBuf,
    list: Mutex<Vec<Schedule>>,
}

fn new_id() -> String {
    let mut bytes = [0u8; 6];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl Schedules {
    pub fn open(file: PathBuf) -> Schedules {
        let list = mobius_store::file::read_json(&file)
            .and_then(|v| serde_json::from_value::<Vec<Schedule>>(v).ok())
            .map(|l| l.into_iter().filter(|s| parse_time(&s.time).is_some() && !s.days.is_empty()).take(MAX_SCHEDULES).collect())
            .unwrap_or_default();
        Schedules { file, list: Mutex::new(list) }
    }

    fn save(&self, list: &[Schedule]) {
        mobius_store::file::write_json(&self.file, &json!(list));
    }

    pub fn list(&self) -> Vec<Schedule> {
        self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub fn add(&self, draft: &Value) -> Result<Schedule, String> {
        let Draft { title, prompt, time, days, enabled, bot } = parse_draft(draft).ok_or("That schedule is not complete: it needs a name, what to ask, a time and at least one day.")?;
        let mut list = self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if list.len() >= MAX_SCHEDULES {
            return Err(format!("There can be at most {MAX_SCHEDULES} schedules."));
        }
        // Made now: it does not run for a time that already passed today.
        let schedule = Schedule { id: new_id(), title, prompt, time, days, enabled, last_run_ms: Some(now_ms()), bot };
        list.push(schedule.clone());
        self.save(&list);
        Ok(schedule)
    }

    pub fn update(&self, id: &str, draft: &Value) -> Result<Schedule, String> {
        let Draft { title, prompt, time, days, enabled, bot } = parse_draft(draft).ok_or("That schedule is not complete: it needs a name, what to ask, a time and at least one day.")?;
        let mut list = self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let schedule = list.iter_mut().find(|s| s.id == id).ok_or("That schedule is gone.")?;
        *schedule = Schedule { id: schedule.id.clone(), title, prompt, time, days, enabled, last_run_ms: Some(now_ms()), bot };
        let changed = schedule.clone();
        self.save(&list);
        Ok(changed)
    }

    pub fn remove(&self, id: &str) -> bool {
        let mut list = self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let before = list.len();
        list.retain(|s| s.id != id);
        let removed = list.len() != before;
        if removed {
            self.save(&list);
        }
        removed
    }

    /// The schedules due now, marked as run (so a slow run is never started twice).
    pub fn take_due(&self, now: &DateTime<Local>) -> Vec<Schedule> {
        let mut list = self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let at = u64::try_from(now.timestamp_millis()).unwrap_or(0);
        let mut due = Vec::new();
        for schedule in list.iter_mut() {
            if is_due(schedule, now) {
                schedule.last_run_ms = Some(at);
                due.push(schedule.clone());
            }
        }
        if !due.is_empty() {
            self.save(&list);
        }
        due
    }

    /// The agent's tools.
    pub fn run(&self, tool: &str, args: &Value) -> Result<String, String> {
        match tool {
            "schedules.list" => Ok(json!(self.list().iter().map(|s| json!({ "title": s.title, "prompt": s.prompt, "time": s.time, "days": s.days, "on": s.enabled })).collect::<Vec<_>>()).to_string()),
            "schedules.add" => self.add(args).map(|s| format!("Scheduled \"{}\" at {} on days {:?}. The person can change it in Settings › Schedules.", s.title, s.time, s.days)),
            _ => Err("unknown tool".into()),
        }
    }

    /// Marks one as run now, for "Run now".
    pub fn get_for_run(&self, id: &str) -> Option<Schedule> {
        let mut list = self.list.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let schedule = list.iter_mut().find(|s| s.id == id)?;
        schedule.last_run_ms = Some(now_ms());
        let found = schedule.clone();
        self.save(&list);
        Some(found)
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// A conversation id for one run. Mobius's own is never mistaken for an agent's (those are `c-`, the agent's six
/// characters, then `-`); an agent's run is one of that agent's conversations, so it shows on its page.
pub fn conversation_for_run(bot: Option<&str>) -> String {
    match bot.filter(|b| is_bot_id(b)) {
        Some(bot) => format!("c-{bot}-scheduled-{}{}", new_id(), new_id()),
        None => format!("c-scheduled-{}{}", new_id(), new_id()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn at(day: u32, hour: u32, minute: u32) -> DateTime<FixedOffset> {
        // November 2026: the 2nd is a Monday.
        FixedOffset::west_opt(8 * 3600).unwrap().with_ymd_and_hms(2026, 11, day, hour, minute, 0).unwrap()
    }
    fn schedule(time: &str, days: &[u8], last: Option<DateTime<FixedOffset>>) -> Schedule {
        Schedule { id: "a".into(), title: "Brief".into(), prompt: "Brief me".into(), time: time.into(), days: days.to_vec(), enabled: true, last_run_ms: last.map(|l| l.timestamp_millis() as u64), bot: None }
    }

    #[test]
    fn a_schedule_is_due_once_on_its_days_after_its_time() {
        let weekdays = [1, 2, 3, 4, 5];
        assert!(!is_due(&schedule("08:00", &weekdays, Some(at(1, 9, 0))), &at(2, 7, 59)), "not yet");
        assert!(is_due(&schedule("08:00", &weekdays, Some(at(1, 9, 0))), &at(2, 8, 0)));
        assert!(is_due(&schedule("08:00", &weekdays, Some(at(1, 9, 0))), &at(2, 13, 0)), "missed earlier today: runs on opening");
        assert!(!is_due(&schedule("08:00", &weekdays, Some(at(2, 8, 0))), &at(2, 13, 0)), "already ran today");
        assert!(!is_due(&schedule("08:00", &weekdays, None), &at(7, 9, 0)), "Saturday is not a weekday");
        let mut off = schedule("08:00", &weekdays, None);
        off.enabled = false;
        assert!(!is_due(&off, &at(2, 9, 0)));
    }

    #[test]
    fn drafts_are_checked() {
        let good = json!({ "title": "Brief", "prompt": "Brief me on my tasks", "time": "08:05", "days": [5, 1, 1] });
        assert_eq!(parse_draft(&good), Some(Draft { title: "Brief".into(), prompt: "Brief me on my tasks".into(), time: "08:05".into(), days: vec![1, 5], enabled: true, bot: None }));
        let mut as_agent = good.clone();
        as_agent["bot"] = json!("ab12cd");
        assert_eq!(parse_draft(&as_agent).unwrap().bot.as_deref(), Some("ab12cd"));
        as_agent["bot"] = json!("main");
        assert_eq!(parse_draft(&as_agent).unwrap().bot, None);
        for bad_bot in [json!("../x"), json!("ABCDEF"), json!(7)] {
            as_agent["bot"] = bad_bot;
            assert_eq!(parse_draft(&as_agent), None);
        }
        for bad in [
            json!({ "title": "", "prompt": "p", "time": "08:00", "days": [1] }),
            json!({ "title": "t", "prompt": "", "time": "08:00", "days": [1] }),
            json!({ "title": "t", "prompt": "p", "time": "8:00", "days": [1] }),
            json!({ "title": "t", "prompt": "p", "time": "25:00", "days": [1] }),
            json!({ "title": "t", "prompt": "p", "time": "08:00", "days": [] }),
            json!({ "title": "t", "prompt": "p", "time": "08:00", "days": [8] }),
        ] {
            assert_eq!(parse_draft(&bad), None, "{bad}");
        }
    }

    #[test]
    fn schedules_are_kept_and_a_new_one_does_not_run_for_a_time_already_past() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("schedules.json");
        let s = Schedules::open(file.clone());
        let made = s.add(&json!({ "title": "Brief", "prompt": "Brief me", "time": "00:00", "days": [1, 2, 3, 4, 5, 6, 7] })).unwrap();
        assert!(s.take_due(&Local::now()).is_empty(), "made after today's time");
        let again = Schedules::open(file);
        assert_eq!(again.list(), vec![made.clone()]);
        assert!(again.remove(&made.id));
        assert!(again.list().is_empty());
        assert!(conversation_for_run(None).starts_with("c-scheduled-") && crate::agent::is_conversation_id(&conversation_for_run(None)));
        let agents = conversation_for_run(Some("ab12cd"));
        assert!(agents.starts_with("c-ab12cd-scheduled-") && crate::agent::is_conversation_id(&agents), "{agents}");
        assert!(conversation_for_run(Some("../../x")).starts_with("c-scheduled-"));
    }
}
