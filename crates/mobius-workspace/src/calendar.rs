//! Calendar: each calendar is an iCalendar file under `<workspace>/calendar` (`Calendar.ics`, `Work.ics`), so it opens
//! in any other calendar app and can be imported anywhere. Times are the person's local time ("floating"), the way a
//! paper diary works; a time given in UTC is shown in local time. Parts of a file Mobius does not use (time zone
//! definitions, alarms, properties it does not know) are kept as they are when it writes the file again.
//!
//! As with notes and tasks, a checkpoint is taken before the agent changes a calendar, so its changes can be kept or
//! put back.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde_json::{Value, json};

use crate::checkpoints::Checkpoints;
use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "calendar";
pub const DEFAULT_CALENDAR: &str = "Calendar";
const MAX_TITLE: usize = 200;
const MAX_LOCATION: usize = 200;
const MAX_NOTES: usize = 4000;
const MAX_FILE: usize = 4 * 1024 * 1024;
const MAX_RANGE_DAYS: i64 = 400;
const MAX_EXPANDED: usize = 2000;
const MAX_SUGGESTIONS: usize = 50;
const MAX_WHY: usize = 300;
/// Events the agent suggests, waiting for the person to add or decline them. In the calendar folder, so they are
/// checkpointed with it, but hidden from the list of calendars.
const SUGGESTIONS: &str = ".suggestions.json";
/// Other people's calendars, read only to see when they are busy (shared with the person, or seeded in the demo):
/// `calendar/people/<Name>.ics`. Never listed as the person's own.
pub const PEOPLE: &str = "people";
const MAX_FREE: usize = 8;

/// When an event starts or ends: a whole day, or a time of day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum When {
    Day(NaiveDate),
    At(NaiveDateTime),
}

impl When {
    /// `YYYY-MM-DD` for a day, `YYYY-MM-DDTHH:MM` for a time.
    pub fn parse(text: &str) -> Option<When> {
        let text = text.trim();
        if text.len() == 10 {
            return NaiveDate::parse_from_str(text, "%Y-%m-%d").ok().map(When::Day);
        }
        NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M").ok().map(When::At)
    }

    pub fn show(self) -> String {
        match self {
            When::Day(d) => d.format("%Y-%m-%d").to_string(),
            When::At(t) => t.format("%Y-%m-%dT%H:%M").to_string(),
        }
    }

    /// The moment it stands for, for ordering and overlap: a day is its midnight.
    pub fn moment(self) -> NaiveDateTime {
        match self {
            When::Day(d) => d.and_time(NaiveTime::MIN),
            When::At(t) => t,
        }
    }

    fn date(self) -> NaiveDate {
        self.moment().date()
    }

    fn ics(self, name: &str) -> String {
        match self {
            When::Day(d) => format!("{name};VALUE=DATE:{}", d.format("%Y%m%d")),
            When::At(t) => format!("{name}:{}", t.format("%Y%m%dT%H%M%S")),
        }
    }

    fn shifted(self, by: Duration) -> When {
        match self {
            When::Day(d) => When::Day(d + by),
            When::At(t) => When::At(t + by),
        }
    }
}

/// Repetition, as far as Mobius follows it: every N days, weeks (on some weekdays), months or years, until a date or
/// for a number of times.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repeat {
    pub freq: String,
    pub interval: u32,
    pub count: Option<u32>,
    pub until: Option<NaiveDate>,
    pub by_day: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub uid: String,
    pub title: String,
    pub start: When,
    /// Exclusive, as in iCalendar: an all-day event on the 12th ends on the 13th.
    pub end: When,
    pub location: String,
    pub notes: String,
    pub repeat: Option<Repeat>,
    /// Lines of the event Mobius does not use, kept as they were.
    pub extra: Vec<String>,
}

// ---- reading and writing iCalendar ---------------------------------------------------------------------------------

/// Long lines are folded onto continuation lines that start with a space or a tab.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = raw.strip_prefix(' ').or_else(|| raw.strip_prefix('\t'))
            && let Some(last) = lines.last_mut()
        {
            last.push_str(rest);
        } else if !raw.is_empty() {
            lines.push(raw.to_owned());
        }
    }
    lines
}

/// Lines longer than 75 bytes go onto continuation lines, never splitting a character.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut width = 0;
    for c in line.chars() {
        let len = c.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(c);
        width += len;
    }
    out
}

fn unescape(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

type Params = Vec<(String, String)>;

/// A content line split into its name, its parameters and its value.
fn split_line(line: &str) -> Option<(String, Params, String)> {
    let colon = {
        // The first colon outside a quoted parameter value.
        let mut quoted = false;
        line.char_indices().find(|(_, c)| {
            if *c == '"' {
                quoted = !quoted;
            }
            *c == ':' && !quoted
        })?.0
    };
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts.filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_owned()))).collect();
    Some((name, params, value.to_owned()))
}

fn parse_when(params: &[(String, String)], value: &str) -> Option<When> {
    let value = value.trim();
    let date_only = params.iter().any(|(k, v)| k == "VALUE" && v.eq_ignore_ascii_case("DATE")) || value.len() == 8;
    if date_only {
        return NaiveDate::parse_from_str(&value[..8.min(value.len())], "%Y%m%d").ok().map(When::Day);
    }
    if let Some(utc) = value.strip_suffix('Z') {
        let t = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
        return Some(When::At(Utc.from_utc_datetime(&t).with_timezone(&Local).naive_local()));
    }
    // A time with a named zone is read as written: Mobius shows calendars in the wall time they were made in.
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok().map(When::At)
}

fn parse_repeat(value: &str) -> Option<Repeat> {
    let mut repeat = Repeat { freq: String::new(), interval: 1, count: None, until: None, by_day: Vec::new() };
    for part in value.split(';') {
        let (k, v) = part.split_once('=')?;
        match k.to_ascii_uppercase().as_str() {
            "FREQ" => repeat.freq = v.to_ascii_uppercase(),
            "INTERVAL" => repeat.interval = v.parse().ok().filter(|n| *n >= 1)?,
            "COUNT" => repeat.count = v.parse().ok(),
            "UNTIL" => repeat.until = NaiveDate::parse_from_str(&v[..8.min(v.len())], "%Y%m%d").ok(),
            "BYDAY" => {
                repeat.by_day = v
                    .split(',')
                    .filter_map(|d| ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].iter().position(|w| d.ends_with(w)).map(|i| i as u32))
                    .collect();
            }
            _ => {}
        }
    }
    ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].contains(&repeat.freq.as_str()).then_some(repeat)
}

/// The events of an iCalendar text, and everything else in it, kept to write back.
pub fn parse(text: &str) -> (Vec<Event>, Vec<String>) {
    let mut events = Vec::new();
    let mut other = Vec::new();
    let mut current: Option<Vec<String>> = None;
    let mut depth_other = 0;
    for line in unfold(text) {
        let upper = line.to_ascii_uppercase();
        if current.is_none() && depth_other == 0 && upper == "BEGIN:VEVENT" {
            current = Some(Vec::new());
            continue;
        }
        if let Some(lines) = current.as_mut() {
            if upper == "END:VEVENT" && depth_other == 0 {
                if let Some(event) = event_of(lines) {
                    events.push(event);
                }
                current = None;
            } else {
                if upper.starts_with("BEGIN:") {
                    depth_other += 1;
                } else if upper.starts_with("END:") {
                    depth_other -= 1;
                }
                lines.push(line);
            }
            continue;
        }
        if ["BEGIN:VCALENDAR", "END:VCALENDAR", "VERSION:2.0"].contains(&upper.as_str()) || upper.starts_with("PRODID:") {
            continue;
        }
        other.push(line);
    }
    (events, other)
}

fn event_of(lines: &[String]) -> Option<Event> {
    let mut uid = None;
    let mut title = String::new();
    let mut start = None;
    let mut end = None;
    let mut duration = None;
    let mut location = String::new();
    let mut notes = String::new();
    let mut repeat = None;
    let mut extra = Vec::new();
    let mut nested = 0;
    for line in lines {
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("BEGIN:") {
            nested += 1;
        }
        if nested > 0 {
            extra.push(line.clone());
            if upper.starts_with("END:") {
                nested -= 1;
            }
            continue;
        }
        let Some((name, params, value)) = split_line(line) else { continue };
        match name.as_str() {
            "UID" => uid = Some(value.trim().to_owned()),
            "SUMMARY" => title = unescape(&value),
            "DTSTART" => start = parse_when(&params, &value),
            "DTEND" => end = parse_when(&params, &value),
            "DURATION" => duration = parse_duration(&value),
            "LOCATION" => location = unescape(&value),
            "DESCRIPTION" => notes = unescape(&value),
            "RRULE" => repeat = parse_repeat(&value),
            _ => extra.push(line.clone()),
        }
    }
    let start = start?;
    let end = end.or_else(|| duration.map(|d| start.shifted(d))).unwrap_or(match start {
        When::Day(d) => When::Day(d + Duration::days(1)),
        When::At(t) => When::At(t),
    });
    Some(Event { uid: uid.unwrap_or_else(new_uid), title: if title.trim().is_empty() { "Busy".into() } else { title }, start, end, location, notes, repeat, extra })
}

/// `PT1H30M`, `P1D`, `P2W`.
fn parse_duration(value: &str) -> Option<Duration> {
    let v = value.trim().trim_start_matches('+').strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut number = String::new();
    let mut in_time = false;
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => number.push(c),
            _ => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += match (c, in_time) {
                    ('W', false) => Duration::weeks(n),
                    ('D', false) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(total)
}

pub fn write(name: &str, events: &[Event], other: &[String]) -> String {
    let mut lines = vec!["BEGIN:VCALENDAR".to_owned(), "VERSION:2.0".to_owned(), "PRODID:-//Mobius//Calendar//EN".to_owned()];
    if !other.iter().any(|l| l.to_ascii_uppercase().starts_with("X-WR-CALNAME")) {
        lines.push(format!("X-WR-CALNAME:{}", escape(name)));
    }
    lines.extend(other.iter().cloned());
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    for e in events {
        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:{}", e.uid));
        if !e.extra.iter().any(|l| l.to_ascii_uppercase().starts_with("DTSTAMP")) {
            lines.push(format!("DTSTAMP:{stamp}"));
        }
        lines.push(e.start.ics("DTSTART"));
        lines.push(e.end.ics("DTEND"));
        lines.push(format!("SUMMARY:{}", escape(&e.title)));
        if !e.location.is_empty() {
            lines.push(format!("LOCATION:{}", escape(&e.location)));
        }
        if !e.notes.is_empty() {
            lines.push(format!("DESCRIPTION:{}", escape(&e.notes)));
        }
        if let Some(r) = &e.repeat {
            lines.push(format!("RRULE:{}", repeat_text(r)));
        }
        lines.extend(e.extra.iter().cloned());
        lines.push("END:VEVENT".into());
    }
    lines.push("END:VCALENDAR".into());
    lines.iter().map(|l| fold(l)).collect::<Vec<_>>().join("\r\n") + "\r\n"
}

fn repeat_text(r: &Repeat) -> String {
    let mut parts = vec![format!("FREQ={}", r.freq)];
    if r.interval > 1 {
        parts.push(format!("INTERVAL={}", r.interval));
    }
    if let Some(n) = r.count {
        parts.push(format!("COUNT={n}"));
    }
    if let Some(u) = r.until {
        parts.push(format!("UNTIL={}", u.format("%Y%m%d")));
    }
    if !r.by_day.is_empty() {
        let days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
        parts.push(format!("BYDAY={}", r.by_day.iter().filter_map(|d| days.get(*d as usize)).copied().collect::<Vec<_>>().join(",")));
    }
    parts.join(";")
}

// ---- repetition ----------------------------------------------------------------------------------------------------

/// The starts of `event` that fall before `to`, from its first, at most `MAX_EXPANDED`.
fn occurrences(event: &Event, to: NaiveDateTime) -> Vec<When> {
    let Some(r) = &event.repeat else { return vec![event.start] };
    let mut out = Vec::new();
    let first = event.start;
    let until = r.until.map(|u| u.and_time(NaiveTime::from_hms_opt(23, 59, 59).unwrap_or(NaiveTime::MIN)));
    let fits = |w: When, n: usize| w.moment() < to && until.is_none_or(|u| w.moment() <= u) && r.count.is_none_or(|c| n < c as usize);
    let interval = i64::from(r.interval.max(1));
    match r.freq.as_str() {
        "WEEKLY" if !r.by_day.is_empty() => {
            // Week by week from the first one's Monday, on the days named.
            let monday = first.date() - Duration::days(i64::from(first.date().weekday().num_days_from_monday()));
            let mut week = 0;
            'weeks: while out.len() < MAX_EXPANDED {
                for &day in &r.by_day {
                    let date = monday + Duration::weeks(week * interval) + Duration::days(i64::from(day));
                    let when = first.shifted(date - first.date());
                    if when < first {
                        continue;
                    }
                    if !fits(when, out.len()) {
                        break 'weeks;
                    }
                    out.push(when);
                }
                week += 1;
            }
        }
        freq => {
            let mut n = 0i64;
            while out.len() < MAX_EXPANDED {
                let when = match freq {
                    "DAILY" => first.shifted(Duration::days(n * interval)),
                    "WEEKLY" => first.shifted(Duration::weeks(n * interval)),
                    "MONTHLY" | "YEARLY" => {
                        let months = if freq == "MONTHLY" { n * interval } else { n * interval * 12 };
                        let total = first.date().month0() as i64 + months;
                        let year = first.date().year() + i32::try_from(total.div_euclid(12)).unwrap_or(0);
                        match NaiveDate::from_ymd_opt(year, u32::try_from(total.rem_euclid(12)).unwrap_or(0) + 1, first.date().day()) {
                            Some(date) => first.shifted(date - first.date()),
                            None => {
                                // The 31st in a short month: skipped, as calendars do.
                                n += 1;
                                continue;
                            }
                        }
                    }
                    _ => break,
                };
                if !fits(when, out.len()) {
                    break;
                }
                out.push(when);
                n += 1;
            }
        }
    }
    out
}

// ---- the store ----------------------------------------------------------------------------------------------------

static NEXT: AtomicU64 = AtomicU64::new(0);

fn new_uid() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    format!("{ms:x}-{:x}-{:x}@mobius", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}

fn calendar_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

/// What may be set on an event, as the window or the agent sends it.
#[derive(Debug, Default, Clone)]
pub struct Draft {
    pub title: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    /// How it repeats, by name (`REPEATS`); an empty text stops it repeating.
    pub repeat: Option<String>,
    /// For a repeating event, the start of the one time the window showed and changed: a new start then moves every
    /// time by as much, rather than starting the series again there.
    pub occurrence: Option<String>,
}

impl Draft {
    pub fn from_json(v: &Value) -> Draft {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        Draft { title: s("title"), start: s("start"), end: s("end"), location: s("location"), notes: s("notes"), repeat: s("repeat"), occurrence: s("occurrence") }
    }
}

/// The ways to repeat an event that the window and the agent offer, by name.
pub const REPEATS: [&str; 6] = ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

/// A repeat by name; `None` for no repeat (an empty name or "never").
pub fn repeat_named(name: &str) -> Res<Option<Repeat>> {
    let plain = |freq: &str, interval: u32, by_day: Vec<u32>| Some(Repeat { freq: freq.into(), interval, count: None, until: None, by_day });
    Ok(match name.trim().to_ascii_lowercase().as_str() {
        "" | "never" | "none" => None,
        "daily" => plain("DAILY", 1, vec![]),
        "weekdays" => plain("WEEKLY", 1, vec![0, 1, 2, 3, 4]),
        "weekly" => plain("WEEKLY", 1, vec![]),
        "biweekly" => plain("WEEKLY", 2, vec![]),
        "monthly" => plain("MONTHLY", 1, vec![]),
        "yearly" => plain("YEARLY", 1, vec![]),
        _ => return Err(format!("repeat is one of {}, or empty", REPEATS.join(", "))),
    })
}

/// The name of a repeat, or "custom" for one made elsewhere that has no name here.
pub fn repeat_name(r: &Repeat) -> &'static str {
    let open = r.count.is_none() && r.until.is_none();
    match (r.freq.as_str(), r.interval, r.by_day.as_slice()) {
        _ if !open => "custom",
        ("DAILY", 1, []) => "daily",
        ("WEEKLY", 1, [0, 1, 2, 3, 4]) => "weekdays",
        ("WEEKLY", 1, []) => "weekly",
        ("WEEKLY", 2, []) => "biweekly",
        ("MONTHLY", 1, []) => "monthly",
        ("YEARLY", 1, []) => "yearly",
        _ => "custom",
    }
}

/// A calendar kept somewhere else (a subscribed link, or a calendar on a CalDAV server) and mirrored in a file here,
/// outside the workspace. Mobius shows it beside the person's own calendars.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mirror {
    pub name: String,
    pub file: PathBuf,
    /// The account it comes from, for the window.
    pub account: String,
    /// Changes go to the server; a subscription is only read.
    pub writable: bool,
}

/// Sends a change to a calendar kept elsewhere. The mirror changes only once the server has taken it.
pub trait Remote: Send + Sync {
    /// `parts` is everything stored under that event's id: the event, and changed copies of single times of it.
    fn put(&self, mirror: &Mirror, uid: &str, parts: &[Event], new: bool) -> Res<()>;
    fn delete(&self, mirror: &Mirror, uid: &str) -> Res<()>;
}

pub struct Calendar {
    root: PathBuf,
    checkpoints: Checkpoints,
    workspace: PathBuf,
    mirrors: RwLock<Vec<Mirror>>,
    remote: RwLock<Option<Arc<dyn Remote>>>,
}

pub fn tool_descriptions() -> Vec<Value> {
    crate::batch::with_more(tool_list(), &["calendar.add", "calendar.suggest"], "calendar")
}

fn tool_list() -> Vec<Value> {
    let when = "A day as YYYY-MM-DD for an all-day event, or a local time as YYYY-MM-DDTHH:MM.";
    vec![
        json!({ "name": "calendar.list", "capability": "calendar.read",
            "description": "Read the person's events in the Calendar app between two days (both included), from every calendar. Leave the days out for the next seven days.",
            "input_schema": { "type": "object", "properties": { "from": { "type": "string", "description": "First day, YYYY-MM-DD." }, "to": { "type": "string", "description": "Last day, YYYY-MM-DD." } } } }),
        json!({ "name": "calendar.add", "capability": "calendar.write", "resource_arg": "calendar",
            "description": "Add an event to one of the person's calendars in the Calendar app. It does not invite anyone.",
            "input_schema": { "type": "object", "properties": {
                "calendar": { "type": "string", "description": "Which calendar: Calendar, unless the person names another (calendar.list shows each event's)." },
                "title": { "type": "string" }, "start": { "type": "string", "description": when },
                "end": { "type": "string", "description": format!("{when} Leave out for an hour (or the one day).") },
                "location": { "type": "string" }, "notes": { "type": "string" },
                "repeat": { "type": "string", "enum": REPEATS, "description": "How it repeats, if it does." } }, "required": ["calendar", "title", "start"] } }),
        json!({ "name": "calendar.suggest", "capability": "calendar.suggest",
            "description": "Suggest an event for the person to add to their calendar or decline, with why. Use this, not calendar.add, for anything they did not ask for outright: a reminder before a deadline, time to prepare, a free hour for a task. It shows dashed in their calendar and nothing is added until they choose Add. Never suggest inviting anyone.",
            "input_schema": { "type": "object", "properties": {
                "calendar": { "type": "string", "description": "Which calendar it would go in: Calendar unless the person uses another for this." },
                "title": { "type": "string" }, "start": { "type": "string", "description": when },
                "end": { "type": "string", "description": format!("{when} Leave out for an hour (or the one day).") },
                "location": { "type": "string" }, "notes": { "type": "string" },
                "why": { "type": "string", "description": "One short sentence the person reads: why this, and why then." } }, "required": ["title", "start", "why"] } }),
        json!({ "name": "calendar.free", "capability": "calendar.read",
            "description": "Find times when the person is free, and the people named are too (from the calendars they share), for a meeting of a given length. Weekdays, in working hours, from now on. Then offer the best two or three with calendar.suggest; to invite, draft an email with mail.draft.",
            "input_schema": { "type": "object", "properties": {
                "with": { "type": "array", "items": { "type": "string" }, "description": "People who must be free too, by name (a first name is enough)." },
                "minutes": { "type": "integer", "description": "How long, in minutes. Defaults to 60." },
                "from": { "type": "string", "description": "First day to look at, YYYY-MM-DD. Defaults to today." },
                "to": { "type": "string", "description": "Last day, YYYY-MM-DD. Defaults to seven days on." },
                "dayStart": { "type": "string", "description": "When the working day starts, HH:MM. Defaults to 09:00." },
                "dayEnd": { "type": "string", "description": "When it ends, HH:MM. Defaults to 17:30." } } } }),
        json!({ "name": "calendar.update", "capability": "calendar.write", "resource_arg": "calendar",
            "description": "Change an event in the Calendar app, found by the id calendar.list gave: its title, times, place, notes or how it repeats. For a repeating event, a new start moves the whole series to start there.",
            "input_schema": { "type": "object", "properties": {
                "calendar": { "type": "string" }, "id": { "type": "string" }, "title": { "type": "string" },
                "start": { "type": "string", "description": when }, "end": { "type": "string", "description": when },
                "location": { "type": "string" }, "notes": { "type": "string" },
                "repeat": { "type": "string", "description": format!("How it repeats: one of {}, or never.", REPEATS.join(", ")) } }, "required": ["calendar", "id"] } }),
    ]
}

pub fn is_calendar_tool(name: &str) -> bool {
    tool_descriptions().iter().any(|d| d["name"] == name)
}

/// Each time the events happen between `start` and `end` (repeats one entry per time), as `(start, event)`.
fn expand(calendar: &str, events: &[Event], (start, end): (NaiveDateTime, NaiveDateTime), read_only: bool, found: &mut Vec<(NaiveDateTime, Value)>) {
    for e in events {
        let length = e.end.moment() - e.start.moment();
        // Times a repeating event skips, or that a changed copy of that one time replaces.
        let mut skip = moments_in(e, "EXDATE");
        if e.repeat.is_some() {
            skip.extend(events.iter().filter(|o| o.uid == e.uid && o.repeat.is_none()).flat_map(|o| moments_in(o, "RECURRENCE-ID")));
        }
        for when in occurrences(e, end) {
            if e.repeat.is_some() && skip.contains(&when.moment()) {
                continue;
            }
            let (s, f) = (when.moment(), when.moment() + length);
            // Overlaps the range; an event of no length counts at its moment.
            if s < end && (f > start || (f == s && s >= start)) {
                found.push((s, event_json(calendar, e, when, read_only)));
            }
        }
    }
}

fn event_json(calendar: &str, e: &Event, start: When, read_only: bool) -> Value {
    let shift = start.moment() - e.start.moment();
    let end = e.end.shifted(shift);
    let all_day = matches!(e.start, When::Day(_));
    json!({ "id": e.uid, "calendar": calendar, "title": e.title, "start": start.show(), "end": end.show(), "allDay": all_day,
        "location": e.location, "notes": e.notes, "repeats": e.repeat.is_some(), "repeat": e.repeat.as_ref().map_or("", repeat_name), "readOnly": read_only })
}

/// The starts a repeating event skips (`EXDATE`), and the one a changed copy of a single time replaces
/// (`RECURRENCE-ID`): calendars from servers carry both.
fn moments_in(e: &Event, property: &str) -> Vec<NaiveDateTime> {
    e.extra
        .iter()
        .filter_map(|l| split_line(l))
        .filter(|(name, ..)| name == property)
        .flat_map(|(_, params, value)| value.split(',').filter_map(|v| parse_when(&params, v)).map(When::moment).collect::<Vec<_>>())
        .collect()
}

impl Calendar {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Calendar {
        let workspace = workspace.into();
        Calendar { root: workspace.join(FOLDER), checkpoints: Checkpoints::new(checkpoint_store), workspace, mirrors: RwLock::new(Vec::new()), remote: RwLock::new(None) }
    }

    /// The calendars kept elsewhere, as the accounts have them now.
    pub fn set_mirrors(&self, mirrors: Vec<Mirror>) {
        *self.mirrors.write().unwrap_or_else(std::sync::PoisonError::into_inner) = mirrors;
    }

    pub fn set_remote(&self, remote: Arc<dyn Remote>) {
        *self.remote.write().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(remote);
    }

    fn mirror(&self, calendar: &str) -> Option<Mirror> {
        self.mirrors.read().unwrap_or_else(std::sync::PoisonError::into_inner).iter().find(|m| m.name == calendar).cloned()
    }

    /// Every calendar with where it is kept: `{ name, account, readOnly }`, the person's own first.
    pub fn sources(&self) -> Value {
        let local = self.local_calendars().into_iter().map(|name| json!({ "name": name, "account": null, "readOnly": false }));
        let mirrors = self.mirrors.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        Value::Array(local.chain(mirrors.into_iter().map(|m| json!({ "name": m.name, "account": m.account, "readOnly": !m.writable }))).collect())
    }

    /// A change to a calendar kept elsewhere goes to its server first; a subscription is never changed.
    fn send(&self, calendar: &str, put: Option<(&[Event], bool)>, delete: Option<&str>) -> Res<()> {
        let Some(mirror) = self.mirror(calendar) else { return Ok(()) };
        if !mirror.writable {
            return Err(format!("{calendar} is a subscribed calendar: it can be read but not changed"));
        }
        let remote = self.remote.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone().ok_or("that calendar's account is not connected")?;
        match (put, delete) {
            (Some((parts, new)), _) => parts.first().map_or(Ok(()), |first| remote.put(&mirror, &first.uid, parts, new)),
            (None, Some(uid)) => remote.delete(&mirror, uid),
            _ => Ok(()),
        }
    }

    fn file(&self, calendar: &str) -> Res<PathBuf> {
        if let Some(mirror) = self.mirror(calendar) {
            return Ok(mirror.file);
        }
        if !calendar_ok(calendar) {
            return Err("that is not a calendar".into());
        }
        let file = self.root.join(format!("{calendar}.ics"));
        if file.exists() {
            let real = fs::canonicalize(&file).map_err(|e| e.to_string())?;
            let root = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
            if real.parent() != Some(root.as_path()) {
                return Err("that is not a calendar".into());
            }
        }
        Ok(file)
    }

    fn load(&self, calendar: &str) -> Res<(Vec<Event>, Vec<String>)> {
        let file = self.file(calendar)?;
        match fs::read_to_string(&file) {
            Ok(text) if text.len() <= MAX_FILE => Ok(parse(&text)),
            Ok(_) => Err("that calendar is too big".into()),
            Err(_) => Ok((Vec::new(), Vec::new())),
        }
    }

    fn store(&self, calendar: &str, events: &[Event], other: &[String]) -> Res<()> {
        let file = self.file(calendar)?;
        fs::create_dir_all(file.parent().unwrap_or(&self.root)).map_err(|e| e.to_string())?;
        let text = write(calendar, events, other);
        let temp = file.with_extension("ics.mobius-tmp");
        fs::write(&temp, text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })
    }

    /// Every calendar by name: the person's own (Calendar is always there), then the ones kept elsewhere.
    pub fn calendars(&self) -> Vec<String> {
        let mut names = self.local_calendars();
        names.extend(self.mirrors.read().unwrap_or_else(std::sync::PoisonError::into_inner).iter().map(|m| m.name.clone()));
        names
    }

    /// The person's own calendars, in the workspace.
    pub fn local_calendars(&self) -> Vec<String> {
        let mut names = vec![DEFAULT_CALENDAR.to_owned()];
        if let Ok(dir) = fs::read_dir(&self.root) {
            let mut found: Vec<String> = dir
                .filter_map(Result::ok)
                .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".ics")).map(str::to_owned))
                .filter(|n| calendar_ok(n) && n != DEFAULT_CALENDAR)
                .collect();
            found.sort_by_key(|n| n.to_lowercase());
            names.extend(found);
        }
        names
    }

    pub fn create(&self, name: &str) -> Res<Value> {
        let name = file_name_for(name.trim());
        if self.calendars().iter().any(|c| c.eq_ignore_ascii_case(&name)) {
            return Err("there is already a calendar with that name".into());
        }
        self.store(&name, &[], &[])?;
        Ok(json!({ "name": name }))
    }

    /// The events between two days (both included), from every calendar, in order. Repeating events give one entry
    /// for each time they happen.
    pub fn events(&self, from: &str, to: &str) -> Res<Value> {
        let from = NaiveDate::parse_from_str(from, "%Y-%m-%d").map_err(|_| "from is a day, YYYY-MM-DD")?;
        let to = NaiveDate::parse_from_str(to, "%Y-%m-%d").map_err(|_| "to is a day, YYYY-MM-DD")?;
        if to < from || (to - from).num_days() > MAX_RANGE_DAYS {
            return Err(format!("a range runs forward and covers at most {MAX_RANGE_DAYS} days"));
        }
        let (start, end) = (from.and_time(NaiveTime::MIN), (to + Duration::days(1)).and_time(NaiveTime::MIN));
        let mut found: Vec<(NaiveDateTime, Value)> = Vec::new();
        for calendar in self.calendars() {
            let read_only = self.mirror(&calendar).is_some_and(|m| !m.writable);
            // A calendar that cannot be read (a damaged file, one too big) is left out rather than hiding the rest.
            let Ok((events, _)) = self.load(&calendar) else { continue };
            expand(&calendar, &events, (start, end), read_only, &mut found);
        }
        found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1["title"].as_str().cmp(&b.1["title"].as_str())));
        Ok(Value::Array(found.into_iter().map(|(_, v)| v).collect()))
    }

    /// The people whose calendars are shared here (`calendar/people/<Name>.ics`), by name.
    pub fn people(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.root.join(PEOPLE))
            .map(|dir| dir.filter_map(Result::ok).filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".ics")).map(str::to_owned)).filter(|n| calendar_ok(n)).collect())
            .unwrap_or_default();
        names.sort_by_key(|n| n.to_lowercase());
        names
    }

    /// Times of `minutes` when the person and everyone in `with` are free, on weekdays between `day` hours, from
    /// `now` on: `{ with, unknown, free: [{start, end}] }`, the first few, at most one each morning and afternoon.
    pub fn free(&self, with: &[String], minutes: i64, (from, to): (NaiveDate, NaiveDate), day: (NaiveTime, NaiveTime), now: NaiveDateTime) -> Res<Value> {
        if !(15..=8 * 60).contains(&minutes) {
            return Err("a meeting is 15 minutes to 8 hours".into());
        }
        if to < from || (to - from).num_days() > 31 {
            return Err("look at most a month ahead, from a day to a later one".into());
        }
        let range = (from.and_time(NaiveTime::MIN), (to + Duration::days(1)).and_time(NaiveTime::MIN));
        let mut busy: Vec<(NaiveDateTime, NaiveDateTime)> = Vec::new();
        let mut add = |list: &[(NaiveDateTime, Value)]| {
            for (_, e) in list {
                // An all-day event (a holiday, a deadline) does not fill the day.
                if e["allDay"] == true {
                    continue;
                }
                if let (Some(s), Some(f)) = (e["start"].as_str().and_then(When::parse), e["end"].as_str().and_then(When::parse)) {
                    busy.push((s.moment(), f.moment()));
                }
            }
        };
        let own: Vec<(NaiveDateTime, Value)> = self.events(&from.format("%Y-%m-%d").to_string(), &to.format("%Y-%m-%d").to_string())?.as_array().cloned().unwrap_or_default().into_iter().map(|v| (NaiveDateTime::MIN, v)).collect();
        add(&own);
        let people = self.people();
        let (mut found, mut unknown) = (Vec::new(), Vec::new());
        for name in with {
            let wanted = name.trim().to_lowercase();
            let Some(person) = people.iter().find(|p| p.to_lowercase() == wanted || p.to_lowercase().split_whitespace().next() == Some(wanted.as_str())) else {
                unknown.push(name.trim().to_owned());
                continue;
            };
            let text = fs::read_to_string(self.root.join(PEOPLE).join(format!("{person}.ics"))).unwrap_or_default();
            let (events, _) = if text.len() <= MAX_FILE { parse(&text) } else { (Vec::new(), Vec::new()) };
            let mut theirs = Vec::new();
            expand(person, &events, range, true, &mut theirs);
            add(&theirs);
            found.push(person.clone());
        }
        let length = Duration::minutes(minutes);
        let step = Duration::minutes(30);
        let mut free = Vec::new();
        let mut date = from;
        while date <= to && free.len() < MAX_FREE {
            if date.weekday().number_from_monday() <= 5 {
                let (open, close) = (date.and_time(day.0), date.and_time(day.1));
                // From the next half hour after now.
                let mut at = open;
                while at < now {
                    at += step;
                }
                let mut taken_half = [false, false];
                while at + length <= close && free.len() < MAX_FREE {
                    let end = at + length;
                    let half = usize::from(at.time() >= NaiveTime::from_hms_opt(12, 0, 0).unwrap_or(NaiveTime::MIN));
                    if !taken_half[half] && !busy.iter().any(|(s, f)| *s < end && *f > at) {
                        free.push(json!({ "start": at.format("%Y-%m-%dT%H:%M").to_string(), "end": end.format("%Y-%m-%dT%H:%M").to_string() }));
                        taken_half[half] = true;
                    }
                    at += step;
                }
            }
            date += Duration::days(1);
        }
        Ok(json!({ "with": found, "unknown": unknown, "known": people, "free": free }))
    }

    fn checked(draft: &Draft, base: Option<&Event>) -> Res<(String, When, When, String, String)> {
        let title = draft.title.clone().or_else(|| base.map(|b| b.title.clone())).unwrap_or_default();
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() || title.chars().count() > MAX_TITLE {
            return Err(format!("an event needs a title of up to {MAX_TITLE} characters"));
        }
        let start = match &draft.start {
            Some(s) => When::parse(s).ok_or("start is YYYY-MM-DD or YYYY-MM-DDTHH:MM")?,
            None => base.map(|b| b.start).ok_or("an event needs a start")?,
        };
        let end = match &draft.end {
            Some(s) if !s.trim().is_empty() => When::parse(s).ok_or("end is YYYY-MM-DD or YYYY-MM-DDTHH:MM")?,
            // Keeps its length when only the start moves.
            _ => match base {
                Some(b) if draft.start.is_some() => start.shifted(b.end.moment() - b.start.moment()),
                Some(b) => b.end,
                None => match start {
                    When::Day(d) => When::Day(d + Duration::days(1)),
                    When::At(t) => When::At(t + Duration::hours(1)),
                },
            },
        };
        // An all-day event's end day, as people say it ("the 12th to the 14th"), is included.
        let end = match (start, end, &draft.end) {
            (When::Day(_), When::Day(e), Some(s)) if !s.trim().is_empty() => When::Day(e + Duration::days(1)),
            _ => end,
        };
        if matches!(start, When::Day(_)) != matches!(end, When::Day(_)) {
            return Err("start and end are both days or both times".into());
        }
        if end.moment() < start.moment() {
            return Err("an event ends after it starts".into());
        }
        let location = draft.location.clone().or_else(|| base.map(|b| b.location.clone())).unwrap_or_default().trim().to_owned();
        let notes = draft.notes.clone().or_else(|| base.map(|b| b.notes.clone())).unwrap_or_default().trim().to_owned();
        if location.chars().count() > MAX_LOCATION || notes.chars().count() > MAX_NOTES {
            return Err("the place or the notes are too long".into());
        }
        Ok((title, start, end, location, notes))
    }

    pub fn add(&self, calendar: &str, draft: &Draft) -> Res<Value> {
        let (title, start, end, location, notes) = Self::checked(draft, None)?;
        let repeat = repeat_named(draft.repeat.as_deref().unwrap_or(""))?;
        let (mut events, other) = self.load(calendar)?;
        let event = Event { uid: new_uid(), title, start, end, location, notes, repeat, extra: Vec::new() };
        self.send(calendar, Some((std::slice::from_ref(&event), true)), None)?;
        events.push(event.clone());
        self.store(calendar, &events, &other)?;
        Ok(event_json(calendar, &event, event.start, false))
    }

    pub fn update(&self, calendar: &str, uid: &str, draft: &Draft) -> Res<Value> {
        let (mut events, other) = self.load(calendar)?;
        // The event itself, not a changed copy of one of its times.
        let at = events.iter().position(|e| e.uid == uid && (e.repeat.is_some() || moments_in(e, "RECURRENCE-ID").is_empty())).ok_or("that event is not in that calendar")?;
        let (title, mut start, mut end, location, notes) = Self::checked(draft, Some(&events[at]))?;
        let base = &events[at];
        // One time of a repeating event moved: every time moves by as much, so the series keeps its first time.
        if base.repeat.is_some()
            && draft.start.is_some()
            && let Some(shown) = draft.occurrence.as_deref().and_then(When::parse)
            && matches!(shown, When::Day(_)) == matches!(start, When::Day(_))
            && matches!(base.start, When::Day(_)) == matches!(start, When::Day(_))
        {
            let length = end.moment() - start.moment();
            start = base.start.shifted(start.moment() - shown.moment());
            end = start.shifted(length);
        }
        let mut changed = base.clone();
        (changed.title, changed.start, changed.end, changed.location, changed.notes) = (title, start, end, location, notes);
        if let Some(name) = &draft.repeat {
            changed.repeat = repeat_named(name)?;
        }
        let mut after = events.clone();
        after[at] = changed.clone();
        let parts: Vec<Event> = after.iter().filter(|e| e.uid == uid).cloned().collect();
        self.send(calendar, Some((&parts, false)), None)?;
        events = after;
        self.store(calendar, &events, &other)?;
        Ok(event_json(calendar, &changed, changed.start, false))
    }

    pub fn remove(&self, calendar: &str, uid: &str) -> Res<Value> {
        let (mut events, other) = self.load(calendar)?;
        let before = events.len();
        events.retain(|e| e.uid != uid);
        if events.len() == before {
            return Err("that event is not in that calendar".into());
        }
        self.send(calendar, None, Some(uid))?;
        self.store(calendar, &events, &other)?;
        Ok(json!({ "calendar": calendar, "removed": uid }))
    }

    /// The agent's tools. Each change is checkpointed first, so it can be reviewed and put back.
    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        // Several events in one call (`more`, see batch.rs): a day's suggested blocks are one call, not one each.
        if matches!(tool, "calendar.add" | "calendar.suggest") {
            if let Some(all) = crate::batch::run_more(args, "calendar", |one| self.run(tool, one)) {
                return Ok(all);
            }
        }
        let text = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let calendar = text("calendar").unwrap_or(DEFAULT_CALENDAR);
        let result = match tool {
            "calendar.list" => {
                let today = Local::now().date_naive();
                let from = text("from").map_or_else(|| today.format("%Y-%m-%d").to_string(), str::to_owned);
                let to = text("to").map_or_else(|| (today + Duration::days(6)).format("%Y-%m-%d").to_string(), str::to_owned);
                self.events(&from, &to)?
            }
            "calendar.free" => {
                let now = Local::now().naive_local();
                let day = |k: &str, d: &str| NaiveDate::parse_from_str(text(k).unwrap_or(d), "%Y-%m-%d").map_err(|_| format!("{k} is a day, YYYY-MM-DD"));
                let time = |k: &str, d: &str| NaiveTime::parse_from_str(text(k).unwrap_or(d), "%H:%M").map_err(|_| format!("{k} is a time, HH:MM"));
                let today = now.date().format("%Y-%m-%d").to_string();
                let week = (now.date() + Duration::days(7)).format("%Y-%m-%d").to_string();
                let with: Vec<String> = args.get("with").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).take(10).map(str::to_owned).collect()).unwrap_or_default();
                self.free(&with, args.get("minutes").and_then(Value::as_i64).unwrap_or(60), (day("from", &today)?, day("to", &week)?), (time("dayStart", "09:00")?, time("dayEnd", "17:30")?), now)?
            }
            "calendar.add" => {
                self.checkpoint(&format!("before the agent added an event to {calendar}"));
                self.add(calendar, &Draft::from_json(args))?
            }
            "calendar.suggest" => {
                self.checkpoint(&format!("before the agent suggested an event for {calendar}"));
                self.suggest(calendar, &Draft::from_json(args), text("why").unwrap_or(""))?
            }
            "calendar.update" => {
                let uid = text("id").ok_or("id is the event's id from calendar.list")?;
                self.checkpoint(&format!("before the agent changed an event in {calendar}"));
                self.update(calendar, uid, &Draft::from_json(args))?
            }
            _ => return Err("unknown tool".into()),
        };
        Ok(result.to_string())
    }

    fn suggestions_file(&self) -> PathBuf {
        self.root.join(SUGGESTIONS)
    }

    fn read_suggestions(&self) -> Vec<Value> {
        fs::read_to_string(self.suggestions_file()).ok().and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok()).unwrap_or_default()
    }

    fn write_suggestions(&self, list: &[Value]) -> Res<()> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        fs::write(self.suggestions_file(), Value::Array(list.to_vec()).to_string()).map_err(|e| e.to_string())
    }

    /// What the agent suggested and the person has not answered yet, soonest first.
    pub fn suggestions(&self) -> Value {
        let mut list = self.read_suggestions();
        list.sort_by(|a, b| a["start"].as_str().cmp(&b["start"].as_str()));
        Value::Array(list)
    }

    /// Keeps a suggestion for the person to answer. It is checked as an event would be, so Add cannot fail on it later.
    pub fn suggest(&self, calendar: &str, draft: &Draft, why: &str) -> Res<Value> {
        let (title, start, end, location, notes) = Self::checked(draft, None)?;
        if !self.calendars().iter().any(|c| c == calendar) || self.mirror(calendar).is_some_and(|m| !m.writable) {
            return Err(format!("{calendar} is not a calendar that can take events"));
        }
        let why = why.split_whitespace().collect::<Vec<_>>().join(" ");
        if why.is_empty() || why.chars().count() > MAX_WHY {
            return Err(format!("a suggestion says why, in up to {MAX_WHY} characters"));
        }
        let mut list = self.read_suggestions();
        if list.len() >= MAX_SUGGESTIONS {
            return Err("there are already many suggestions waiting; let the person answer those first".into());
        }
        // An all-day end is kept as the person would say it, as when the event is added.
        let shown_end = match end {
            When::Day(d) => When::Day(d - Duration::days(1)),
            at @ When::At(_) => at,
        };
        let item = json!({ "id": new_uid(), "calendar": calendar, "title": title, "start": start.show(), "end": shown_end.show(),
            "allDay": matches!(start, When::Day(_)), "location": location, "notes": notes, "why": why });
        list.push(item.clone());
        self.write_suggestions(&list)?;
        Ok(item)
    }

    fn take_suggestion(&self, id: &str) -> Res<Value> {
        let mut list = self.read_suggestions();
        let at = list.iter().position(|s| s["id"] == id).ok_or("that suggestion is gone")?;
        let item = list.remove(at);
        self.write_suggestions(&list)?;
        Ok(item)
    }

    /// The person chose Add: the suggestion becomes an event in its calendar.
    pub fn accept(&self, id: &str) -> Res<Value> {
        let item = self.read_suggestions().into_iter().find(|s| s["id"] == id).ok_or("that suggestion is gone")?;
        let calendar = item["calendar"].as_str().unwrap_or(DEFAULT_CALENDAR).to_owned();
        let added = self.add(&calendar, &Draft::from_json(&item))?;
        self.take_suggestion(id)?;
        Ok(added)
    }

    pub fn decline(&self, id: &str) -> Res<Value> {
        self.take_suggestion(id).map(|item| json!({ "calendar": item["calendar"], "declined": id }))
    }

    fn checkpoint(&self, why: &str) {
        let _ = self.checkpoints.snapshot(&self.workspace, why);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Calendar) {
        let dir = tempfile::tempdir().unwrap();
        let c = Calendar::new(dir.path().join("workspace"), dir.path().join("checkpoints"));
        (dir, c)
    }
    fn draft(title: &str, start: &str, end: Option<&str>) -> Draft {
        Draft { title: Some(title.into()), start: Some(start.into()), end: end.map(str::to_owned), ..Draft::default() }
    }

    #[test]
    fn free_times_leave_out_what_the_person_and_the_people_named_have_on() {
        let (dir, c) = store();
        // Monday 16 November 2026: the person is in a meeting from 9 to 10, Sam from 10 to 12 and every afternoon
        // until 15:00; an all-day deadline fills nothing.
        c.add("Calendar", &draft("Stand-up", "2026-11-16T09:00", Some("2026-11-16T10:00"))).unwrap();
        c.add("Calendar", &draft("Parts list due", "2026-11-16", None)).unwrap();
        let people = dir.path().join("workspace/calendar/people");
        fs::create_dir_all(&people).unwrap();
        fs::write(people.join("Sam Okafor.ics"), "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s1\r\nSUMMARY:Supplier call\r\nDTSTART:20261116T100000\r\nDTEND:20261116T120000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s2\r\nSUMMARY:Workshop\r\nDTSTART:20261116T120000\r\nDTEND:20261116T150000\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        assert_eq!(c.people(), vec!["Sam Okafor"]);
        assert_eq!(c.calendars(), vec!["Calendar"], "someone else's calendar is not the person's own");
        let at = |d: &str, t: &str| NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap().and_time(NaiveTime::parse_from_str(t, "%H:%M").unwrap());
        let day = (NaiveTime::from_hms_opt(9, 0, 0).unwrap(), NaiveTime::from_hms_opt(17, 30, 0).unwrap());
        let monday = NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();
        let out = c.free(&["sam".into(), "Jo".into()], 60, (monday, monday + Duration::days(6)), day, at("2026-11-16", "08:00")).unwrap();
        assert_eq!(out["with"], json!(["Sam Okafor"]));
        assert_eq!(out["unknown"], json!(["Jo"]));
        let free: Vec<&str> = out["free"].as_array().unwrap().iter().map(|f| f["start"].as_str().unwrap()).collect();
        // Monday: only 15:00 in the afternoon (morning is all taken); Tuesday: 9:00 and 15:00; nothing on the weekend.
        assert_eq!(&free[..3], &["2026-11-16T15:00", "2026-11-17T09:00", "2026-11-17T15:00"]);
        assert!(free.iter().all(|f| !f.starts_with("2026-11-21") && !f.starts_with("2026-11-22")));
        // Alone, the morning after the stand-up is free; from midday on, only times after now.
        let alone = c.free(&[], 60, (monday, monday), day, at("2026-11-16", "12:10")).unwrap();
        assert_eq!(alone["free"][0]["start"], "2026-11-16T12:30");
        assert!(c.free(&[], 5, (monday, monday), day, at("2026-11-16", "08:00")).is_err());
        let tool: Value = serde_json::from_str(&c.run("calendar.free", &json!({ "with": ["Sam"], "from": "2026-11-16", "to": "2026-11-16", "minutes": 30 })).unwrap()).unwrap();
        assert_eq!(tool["with"], json!(["Sam Okafor"]));
    }

    #[test]
    fn events_are_added_listed_changed_and_removed() {
        let (_d, c) = store();
        let lunch = c.add("Calendar", &draft("Lunch with Ana", "2026-11-12T12:30", None)).unwrap();
        assert_eq!((lunch["start"].as_str(), lunch["end"].as_str()), (Some("2026-11-12T12:30"), Some("2026-11-12T13:30")), "an hour by default");
        let trip = c.add("Calendar", &draft("Lisbon", "2026-11-12", Some("2026-11-14"))).unwrap();
        assert_eq!((trip["end"].as_str(), trip["allDay"].as_bool()), (Some("2026-11-15"), Some(true)), "the last day is included");
        let week = c.events("2026-11-09", "2026-11-15").unwrap();
        assert_eq!(week.as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap()).collect::<Vec<_>>(), vec!["Lisbon", "Lunch with Ana"]);
        assert_eq!(c.events("2026-11-14", "2026-11-14").unwrap().as_array().unwrap().len(), 1, "a trip covers its middle days");
        let moved = c.update("Calendar", lunch["id"].as_str().unwrap(), &Draft { start: Some("2026-11-13T13:00".into()), ..Draft::default() }).unwrap();
        assert_eq!(moved["end"], "2026-11-13T14:00", "keeps its length");
        c.remove("Calendar", lunch["id"].as_str().unwrap()).unwrap();
        assert_eq!(c.events("2026-11-09", "2026-11-15").unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn bad_events_are_refused() {
        let (_d, c) = store();
        assert!(c.add("Calendar", &draft("", "2026-11-12", None)).is_err());
        assert!(c.add("Calendar", &draft("x", "tomorrow", None)).is_err());
        assert!(c.add("Calendar", &draft("x", "2026-11-12T10:00", Some("2026-11-12T09:00"))).is_err());
        assert!(c.add("Calendar", &draft("x", "2026-11-12", Some("2026-11-12T09:00"))).is_err());
        assert!(c.add("../x", &draft("x", "2026-11-12", None)).is_err());
        assert!(c.events("2026-11-15", "2026-11-09").is_err());
    }

    #[test]
    fn the_file_is_icalendar_and_what_mobius_does_not_use_is_kept() {
        let (_d, c) = store();
        let text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Other//EN\r\nX-WR-CALNAME:Work\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Lisbon\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:abc\r\nDTSTART;TZID=Europe/Lisbon:20261112T090000\r\nDTEND;TZID=Europe/Lisbon:20261112T100000\r\nSUMMARY:Stand-up\\, team\r\nDESCRIPTION:Line one\\nline two that is long enough to be folded over more than one line when written\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nX-CUSTOM:keep me\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        std::fs::create_dir_all(c.root.clone()).unwrap();
        std::fs::write(c.root.join("Work.ics"), text).unwrap();
        assert_eq!(c.calendars(), vec!["Calendar", "Work"]);
        let found = c.events("2026-11-12", "2026-11-12").unwrap();
        assert_eq!(found[0]["title"], "Stand-up, team");
        assert_eq!(found[0]["start"], "2026-11-12T09:00");
        assert_eq!(found[0]["notes"], "Line one\nline two that is long enough to be folded over more than one line when written");
        c.update("Work", "abc", &Draft { title: Some("Stand-up".into()), ..Draft::default() }).unwrap();
        let written = std::fs::read_to_string(c.root.join("Work.ics")).unwrap();
        for kept in ["TZID:Europe/Lisbon", "BEGIN:VALARM", "TRIGGER:-PT10M", "X-CUSTOM:keep me", "X-WR-CALNAME:Work"] {
            assert!(written.contains(kept), "{kept} kept");
        }
        assert!(written.lines().all(|l| l.len() <= 76), "long lines are folded");
        assert_eq!(c.events("2026-11-12", "2026-11-12").unwrap()[0]["title"], "Stand-up");
    }

    #[test]
    fn repeating_events_show_each_time_they_happen() {
        let (_d, c) = store();
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART:20261102T090000\r\nDURATION:PT30M\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:m\r\nDTSTART;VALUE=DATE:20260131\r\nRRULE:FREQ=MONTHLY;UNTIL=20260601\r\nSUMMARY:Rent\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        std::fs::create_dir_all(c.root.clone()).unwrap();
        std::fs::write(c.root.join("Repeats.ics"), text).unwrap();
        let nov = c.events("2026-11-01", "2026-11-30").unwrap();
        let standups: Vec<&str> = nov.as_array().unwrap().iter().filter(|e| e["title"] == "Standup").map(|e| e["start"].as_str().unwrap()).collect();
        assert_eq!(standups, vec!["2026-11-02T09:00", "2026-11-04T09:00", "2026-11-09T09:00", "2026-11-11T09:00", "2026-11-16T09:00"]);
        assert_eq!(nov[0]["end"], "2026-11-02T09:30");
        let rent: Vec<String> = c.events("2026-01-01", "2026-12-31").unwrap().as_array().unwrap().iter().filter(|e| e["title"] == "Rent").map(|e| e["start"].as_str().unwrap().to_owned()).collect();
        assert_eq!(rent, vec!["2026-01-31", "2026-03-31", "2026-05-31"], "short months are skipped; until is kept");
    }

    #[derive(Default)]
    struct Server(std::sync::Mutex<Vec<String>>, bool);
    impl Remote for Server {
        fn put(&self, mirror: &Mirror, uid: &str, parts: &[Event], new: bool) -> Res<()> {
            if self.1 {
                return Err("the server said no".into());
            }
            self.0.lock().unwrap().push(format!("put {} {uid} {} {new} {}", mirror.name, parts.len(), parts[0].title));
            Ok(())
        }
        fn delete(&self, mirror: &Mirror, uid: &str) -> Res<()> {
            self.0.lock().unwrap().push(format!("delete {} {uid}", mirror.name));
            Ok(())
        }
    }

    #[test]
    fn calendars_kept_elsewhere_show_beside_the_persons_own_and_changes_go_to_their_server_first() {
        let (dir, c) = store();
        let holidays = dir.path().join("mirror").join("holidays.ics");
        let work = dir.path().join("mirror").join("work.ics");
        std::fs::create_dir_all(holidays.parent().unwrap()).unwrap();
        std::fs::write(&holidays, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:h1\r\nDTSTART;VALUE=DATE:20261126\r\nSUMMARY:Thanksgiving\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        // A weekly meeting with one time moved and one skipped, as servers keep them.
        std::fs::write(&work, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART:20261102T100000\r\nDTEND:20261102T110000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE:20261116T100000\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:w\r\nRECURRENCE-ID:20261109T100000\r\nDTSTART:20261110T150000\r\nDTEND:20261110T160000\r\nSUMMARY:Planning (moved)\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        c.set_mirrors(vec![
            Mirror { name: "US Holidays".into(), file: holidays, account: "US Holidays".into(), writable: false },
            Mirror { name: "Work (iCloud)".into(), file: work.clone(), account: "iCloud".into(), writable: true },
        ]);
        assert_eq!(c.calendars(), vec!["Calendar", "US Holidays", "Work (iCloud)"]);
        assert_eq!(c.sources()[1], json!({ "name": "US Holidays", "account": "US Holidays", "readOnly": true }));
        let nov = c.events("2026-11-01", "2026-11-30").unwrap();
        let shown: Vec<(&str, &str)> = nov.as_array().unwrap().iter().map(|e| (e["title"].as_str().unwrap(), e["start"].as_str().unwrap())).collect();
        assert_eq!(shown, vec![("Planning", "2026-11-02T10:00"), ("Planning (moved)", "2026-11-10T15:00"), ("Planning", "2026-11-23T10:00"), ("Thanksgiving", "2026-11-26")]);
        assert_eq!(nov[3]["readOnly"], true);

        assert!(c.add("US Holidays", &draft("Mine", "2026-11-27", None)).unwrap_err().contains("subscribed"));
        assert!(c.add("Work (iCloud)", &draft("x", "2026-11-27", None)).unwrap_err().contains("not connected"));
        let server = Arc::new(Server::default());
        c.set_remote(server.clone());
        let added = c.add("Work (iCloud)", &draft("Offsite", "2026-11-27", None)).unwrap();
        c.update("Work (iCloud)", "w", &Draft { title: Some("Weekly planning".into()), ..Draft::default() }).unwrap();
        c.remove("Work (iCloud)", added["id"].as_str().unwrap()).unwrap();
        let log = server.0.lock().unwrap().clone();
        assert_eq!(log[0], format!("put Work (iCloud) {} 1 true Offsite", added["id"].as_str().unwrap()));
        assert_eq!(log[1], "put Work (iCloud) w 2 false Weekly planning", "the moved time goes with it");
        assert!(log[2].starts_with("delete Work (iCloud) "));
        assert!(std::fs::read_to_string(&work).unwrap().contains("SUMMARY:Weekly planning"));

        // When the server refuses, the mirror is left as it was.
        let refusing = Arc::new(Server(std::sync::Mutex::default(), true));
        c.set_remote(refusing);
        assert!(c.update("Work (iCloud)", "w", &Draft { title: Some("Nope".into()), ..Draft::default() }).is_err());
        assert!(!std::fs::read_to_string(&work).unwrap().contains("Nope"));
    }

    #[test]
    fn a_days_blocks_are_suggested_in_one_call() {
        let (_d, c) = store();
        let got: Value = serde_json::from_str(&c.run("calendar.suggest", &json!({ "title": "Report", "start": "2026-11-12T09:00", "why": "Due today.", "more": [{ "title": "Van", "start": "2026-11-12T11:00", "why": "Before lunch." }] })).unwrap()).unwrap();
        assert_eq!(got.as_array().map(Vec::len), Some(2), "{got}");
        assert_eq!((got[0]["title"].as_str(), got[1]["title"].as_str()), (Some("Report"), Some("Van")));
    }

    #[test]
    fn suggestions_wait_for_the_person_and_become_events_only_when_added() {
        let (_d, c) = store();
        let s: Value = serde_json::from_str(&c.run("calendar.suggest", &json!({ "title": "Prep slides", "start": "2026-11-12T10:00", "why": "First free hour before the kickoff." })).unwrap()).unwrap();
        assert_eq!((s["end"].as_str(), s["calendar"].as_str()), (Some("2026-11-12T11:00"), Some("Calendar")));
        assert_eq!(c.events("2026-11-12", "2026-11-12").unwrap(), json!([]), "nothing is added yet");
        assert_eq!(c.calendars(), vec!["Calendar"], "the waiting list is not a calendar");
        let trip = c.suggest("Calendar", &draft("Lisbon", "2026-11-13", Some("2026-11-14")), "Flights are booked.").unwrap();
        assert_eq!(trip["end"], "2026-11-14", "the last day, as people say it");
        assert!(c.suggest("Calendar", &draft("x", "2026-11-12", None), "").is_err(), "it says why");
        assert!(c.suggest("Nope", &draft("x", "2026-11-12", None), "why").is_err());
        assert_eq!(c.suggestions().as_array().unwrap().len(), 2);

        let added = c.accept(s["id"].as_str().unwrap()).unwrap();
        assert_eq!(added["title"], "Prep slides");
        assert_eq!(c.accept(trip["id"].as_str().unwrap()).unwrap()["end"], "2026-11-15");
        assert_eq!(c.events("2026-11-12", "2026-11-14").unwrap().as_array().unwrap().len(), 2);
        let again = c.suggest("Calendar", &draft("Gym", "2026-11-12T18:00", None), "You said twice a week.").unwrap();
        c.decline(again["id"].as_str().unwrap()).unwrap();
        assert_eq!(c.suggestions(), json!([]));
        assert!(c.accept(again["id"].as_str().unwrap()).is_err());
    }

    #[test]
    fn the_agent_adds_lists_and_changes_through_its_tools() {
        let (_d, c) = store();
        let added: Value = serde_json::from_str(&c.run("calendar.add", &json!({ "title": "Dentist", "start": "2026-11-20T08:00", "location": "Main St" })).unwrap()).unwrap();
        let id = added["id"].as_str().unwrap();
        let listed: Value = serde_json::from_str(&c.run("calendar.list", &json!({ "from": "2026-11-20", "to": "2026-11-20" })).unwrap()).unwrap();
        assert_eq!(listed[0]["location"], "Main St");
        c.run("calendar.update", &json!({ "calendar": "Calendar", "id": id, "start": "2026-11-21T08:00" })).unwrap();
        assert_eq!(c.events("2026-11-21", "2026-11-21").unwrap()[0]["title"], "Dentist");
        assert!(c.run("calendar.update", &json!({ "calendar": "Calendar", "id": "nope", "title": "x" })).is_err());
    }

    #[test]
    fn an_event_repeats_by_name_and_moving_one_time_moves_them_all() {
        let dir = tempfile::tempdir().unwrap();
        let cal = Calendar::new(dir.path().join("work"), dir.path().join("store"));
        cal.create("Work").unwrap();
        let draft = |start: &str, repeat: &str| Draft { title: Some("Standup".into()), start: Some(start.into()), end: None, repeat: Some(repeat.into()), ..Draft::default() };
        let made = cal.add("Work", &draft("2026-11-02T09:00", "weekdays")).unwrap();
        assert_eq!((made["repeats"].clone(), made["repeat"].clone()), (json!(true), json!("weekdays")));
        let week = cal.events("2026-11-02", "2026-11-08").unwrap();
        assert_eq!(week.as_array().unwrap().len(), 5);
        assert!(std::fs::read_to_string(dir.path().join("work/calendar/Work.ics")).unwrap().contains("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"));
        // Wednesday's standup dragged to 10:30: every time moves to 10:30, and Monday is still the first.
        let id = made["id"].as_str().unwrap();
        let moved = Draft { start: Some("2026-11-04T10:30".into()), end: Some("2026-11-04T11:30".into()), occurrence: Some("2026-11-04T09:00".into()), ..Draft::default() };
        cal.update("Work", id, &moved).unwrap();
        let week = cal.events("2026-11-02", "2026-11-08").unwrap();
        let starts: Vec<&str> = week.as_array().unwrap().iter().map(|e| e["start"].as_str().unwrap()).collect();
        assert_eq!(starts, ["2026-11-02T10:30", "2026-11-03T10:30", "2026-11-04T10:30", "2026-11-05T10:30", "2026-11-06T10:30"]);
        assert_eq!(week[0]["end"], "2026-11-02T11:30");
        // Stop repeating; a name it does not know is refused.
        cal.update("Work", id, &Draft { repeat: Some(String::new()), ..Draft::default() }).unwrap();
        assert_eq!(cal.events("2026-11-02", "2026-11-08").unwrap().as_array().unwrap().len(), 1);
        assert!(cal.add("Work", &draft("2026-11-02T09:00", "fortnightly-ish")).is_err());
        let yearly = cal.add("Work", &draft("2026-11-10", "yearly")).unwrap();
        assert_eq!(yearly["repeat"], "yearly");
        assert_eq!(repeat_name(&Repeat { freq: "WEEKLY".into(), interval: 1, count: Some(3), until: None, by_day: vec![] }), "custom");
    }
}
