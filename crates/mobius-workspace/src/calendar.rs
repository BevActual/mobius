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
const MAX_PEOPLE: usize = 100;
const MAX_NAME: usize = 120;
const MAX_EMAIL: usize = 254;
/// What an attendee answered (`PARTSTAT`), as Mobius names it.
pub const STATUSES: [&str; 4] = ["needs-action", "accepted", "declined", "tentative"];
/// Events the agent suggests, waiting for the person to add or decline them. In the calendar folder, so they are
/// checkpointed with it, but hidden from the list of calendars.
const SUGGESTIONS: &str = ".suggestions.json";
/// Other people's calendars, read only to see when they are busy (shared with the person, or seeded in the demo):
/// `calendar/people/<Name>.ics`. Never listed as the person's own.
pub const PEOPLE: &str = "people";
const MAX_FREE: usize = 10;

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

    /// Its line, in the form the file wrote it (see `Event::zone`): a UTC time goes back to UTC, a zoned time keeps
    /// its `TZID` (read as written, so the wall time is the zone's), and a day is always a date.
    fn ics(self, name: &str, zone: Option<&str>) -> String {
        match (self, zone) {
            (When::Day(d), _) => format!("{name};VALUE=DATE:{}", d.format("%Y%m%d")),
            (When::At(t), Some("UTC")) => {
                let utc = Local.from_local_datetime(&t).earliest().map(|l| l.with_timezone(&Utc).naive_utc()).unwrap_or(t);
                format!("{name}:{}Z", utc.format("%Y%m%dT%H%M%S"))
            }
            (When::At(t), Some(tz)) => format!("{name};TZID={}:{}", param_value(tz), t.format("%Y%m%dT%H%M%S")),
            (When::At(t), None) => format!("{name}:{}", t.format("%Y%m%dT%H%M%S")),
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
    /// Who is invited (`ATTENDEE`), in the order the file has them.
    pub attendees: Vec<Person>,
    /// Who sent the invitation (`ORGANIZER`).
    pub organizer: Option<Person>,
    /// Lines of the event Mobius does not use, kept as they were.
    pub extra: Vec<String>,
    /// How the file wrote its times, so a saved event keeps that form: `Some("UTC")` for times in UTC (`…Z`), the
    /// `TZID` of a time with a named zone, or None for a floating local time. Times are held as local wall times.
    pub zone: Option<String>,
}

/// Someone on an event: an attendee or its organizer, by address.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Person {
    pub name: String,
    pub email: String,
    /// One of `STATUSES`; empty for the organizer, or for an answer Mobius does not name (kept in `params`).
    pub status: String,
    /// Its other parameters (ROLE, RSVP, CUTYPE and the like), kept as they were.
    pub params: Vec<(String, String)>,
}

/// An `ATTENDEE` or `ORGANIZER` line's person. None without an address.
fn person_of(params: &[(String, String)], value: &str) -> Option<Person> {
    let value = value.trim();
    let email = if value.len() >= 7 && value[..7].eq_ignore_ascii_case("mailto:") { &value[7..] } else { value };
    if email.trim().is_empty() {
        return None;
    }
    let mut person = Person { email: email.trim().to_owned(), ..Person::default() };
    for (k, v) in params {
        match k.as_str() {
            "CN" => person.name = v.clone(),
            "PARTSTAT" if STATUSES.contains(&v.to_ascii_lowercase().as_str()) => person.status = v.to_ascii_lowercase(),
            _ => person.params.push((k.clone(), v.clone())),
        }
    }
    Some(person)
}

/// A parameter's value as iCalendar writes it: quoted when it holds a separator, never with a quote inside.
fn param_value(v: &str) -> String {
    let v: String = v.chars().filter(|c| *c != '"' && !c.is_control()).collect();
    if v.contains([':', ';', ',']) { format!("\"{v}\"") } else { v }
}

fn person_line(property: &str, p: &Person) -> String {
    let mut line = property.to_owned();
    if !p.name.is_empty() {
        line.push_str(&format!(";CN={}", param_value(&p.name)));
    }
    if !p.status.is_empty() {
        line.push_str(&format!(";PARTSTAT={}", p.status.to_ascii_uppercase()));
    }
    for (k, v) in &p.params {
        line.push_str(&format!(";{k}={}", param_value(v)));
    }
    format!("{line}:mailto:{}", p.email)
}

/// An answer for the agent: events without their attendees and organizer, as before they were read.
fn without_people(mut v: Value) -> Value {
    match &mut v {
        Value::Array(list) => *list = std::mem::take(list).into_iter().map(without_people).collect(),
        Value::Object(map) => {
            map.remove("attendees");
            map.remove("organizer");
        }
        _ => {}
    }
    v
}

fn person_json(p: &Person) -> Value {
    json!({ "name": p.name, "email": p.email, "status": p.status })
}

// ---- reading and writing iCalendar ---------------------------------------------------------------------------------

/// Long lines are folded onto continuation lines that start with a space or a tab.
pub(crate) fn unfold(text: &str) -> Vec<String> {
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
pub(crate) fn fold(line: &str) -> String {
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

pub(crate) fn unescape(text: &str) -> String {
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

pub(crate) fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

pub(crate) type Params = Vec<(String, String)>;

/// A content line split into its name, its parameters and its value.
pub(crate) fn split_line(line: &str) -> Option<(String, Params, String)> {
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

pub(crate) fn parse_when(params: &[(String, String)], value: &str) -> Option<When> {
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
    let mut attendees = Vec::new();
    let mut organizer = None;
    let mut extra = Vec::new();
    let mut zone = None;
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
            "DTSTART" => {
                start = parse_when(&params, &value);
                zone = time_zone(&params, &value);
            }
            "DTEND" => end = parse_when(&params, &value),
            "DURATION" => duration = parse_duration(&value),
            "LOCATION" => location = unescape(&value),
            "DESCRIPTION" => notes = unescape(&value),
            "RRULE" => repeat = parse_repeat(&value),
            "ATTENDEE" | "ORGANIZER" => match person_of(&params, &value) {
                Some(p) if name == "ATTENDEE" => attendees.push(p),
                Some(p) => organizer = Some(p),
                None => extra.push(line.clone()),
            },
            _ => extra.push(line.clone()),
        }
    }
    let start = start?;
    let end = end.or_else(|| duration.map(|d| start.shifted(d))).unwrap_or(match start {
        When::Day(d) => When::Day(d + Duration::days(1)),
        When::At(t) => When::At(t),
    });
    Some(Event { uid: uid.unwrap_or_else(new_uid), title: if title.trim().is_empty() { "Busy".into() } else { title }, start, end, location, notes, repeat, attendees, organizer, extra, zone })
}

/// The form of a `DTSTART`'s time, for `Event::zone`.
fn time_zone(params: &[(String, String)], value: &str) -> Option<String> {
    if value.trim().ends_with('Z') {
        return Some("UTC".into());
    }
    params.iter().find(|(k, _)| k == "TZID").map(|(_, v)| v.clone()).filter(|v| !v.is_empty())
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

/// The alarms of an event (`VALARM` blocks, kept among its other lines), each as its lines.
fn alarm_blocks(extra: &[String]) -> Vec<std::ops::Range<usize>> {
    let mut blocks = Vec::new();
    let mut open = None;
    for (i, line) in extra.iter().enumerate() {
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("BEGIN:VALARM") {
            open = Some(i);
        } else if upper.starts_with("END:VALARM")
            && let Some(from) = open.take()
        {
            blocks.push(from..i + 1);
        }
    }
    blocks
}

/// An alarm's time as minutes before the event starts (negative: after it starts), when it is set from the start;
/// None for one at a set time or from the end, which Mobius keeps but does not show.
fn alarm_minutes(lines: &[String]) -> Option<i64> {
    lines.iter().filter_map(|l| split_line(l)).find(|(name, ..)| name == "TRIGGER").and_then(|(_, params, value)| {
        let from_start = params.iter().all(|(k, v)| !(k == "VALUE" && v.eq_ignore_ascii_case("DATE-TIME")) && !(k == "RELATED" && v.eq_ignore_ascii_case("END")));
        if !from_start {
            return None;
        }
        let v = value.trim();
        let (before, rest) = match v.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, v),
        };
        let d = parse_duration(rest)?.num_minutes();
        Some(if before { d } else { -d })
    })
}

/// The event's alert, as minutes before it starts: its first alarm set from the start.
pub fn alert_of(e: &Event) -> Option<i64> {
    alarm_blocks(&e.extra).into_iter().find_map(|r| alarm_minutes(&e.extra[r]))
}

/// The longest an alert may be before an event: four weeks.
const MAX_ALERT_MINUTES: i64 = 28 * 24 * 60;

/// Sets the event's alert: the alarms set from its start go, and one is written for `minutes` before it (if any).
/// Alarms at a set time or from the end stay as they were.
fn set_alert(e: &mut Event, minutes: Option<i64>) {
    let mine: Vec<std::ops::Range<usize>> = alarm_blocks(&e.extra).into_iter().filter(|r| alarm_minutes(&e.extra[r.clone()]).is_some()).collect();
    for r in mine.into_iter().rev() {
        e.extra.drain(r);
    }
    if let Some(m) = minutes {
        let trigger = match m {
            0 => "PT0S".to_owned(),
            m if m > 0 => format!("-PT{m}M"),
            m => format!("PT{}M", -m),
        };
        e.extra.extend(["BEGIN:VALARM".to_owned(), "ACTION:DISPLAY".to_owned(), format!("DESCRIPTION:{}", escape(&e.title)), format!("TRIGGER:{trigger}"), "END:VALARM".to_owned()]);
    }
}

/// An alert as sent: absent leaves it, null takes it off, a whole number of minutes before the start sets it.
fn alert_sent(draft: &Draft) -> Res<Option<Option<i64>>> {
    match &draft.alert {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(v) => match v.as_i64() {
            Some(m) if m.abs() <= MAX_ALERT_MINUTES => Ok(Some(Some(m))),
            _ => Err("alert is the minutes before the event starts, up to four weeks, or null for none".into()),
        },
    }
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
        lines.push(e.start.ics("DTSTART", e.zone.as_deref()));
        lines.push(e.end.ics("DTEND", e.zone.as_deref()));
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
        if let Some(o) = &e.organizer {
            lines.push(person_line("ORGANIZER", o));
        }
        lines.extend(e.attendees.iter().map(|a| person_line("ATTENDEE", a)));
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

pub(crate) fn new_uid() -> String {
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
    /// For a repeating event, which of its times a change is for: `one` (that time only), `following` (that time and
    /// those after it, as a series of its own) or `all` (the default).
    pub scope: Option<String>,
    /// Who is invited, as sent: `[{ name, email, status }]`, the whole list. Checked when the event is saved.
    pub attendees: Option<Value>,
    /// Who sent it, as sent: `{ name, email }`, or null for no one. Checked when the event is saved.
    pub organizer: Option<Value>,
    /// The alert, as minutes before the start (negative: after it, as an all-day event's 9:00 on the day), or null for
    /// none. Absent leaves it as it was.
    pub alert: Option<Value>,
}

impl Draft {
    pub fn from_json(v: &Value) -> Draft {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        Draft {
            title: s("title"),
            start: s("start"),
            end: s("end"),
            location: s("location"),
            notes: s("notes"),
            repeat: s("repeat"),
            occurrence: s("occurrence"),
            scope: s("scope"),
            attendees: v.get("attendees").cloned(),
            organizer: v.get("organizer").cloned(),
            alert: v.get("alert").cloned(),
        }
    }
}

/// A person as sent, checked. Their status and other parameters carry over from `was` (the same address before).
fn person_sent(v: &Value, was: Option<&Person>, attendee: bool) -> Res<Person> {
    let bad = || "a person on an event is { name, email } with a real address".to_owned();
    let text = |k: &str| match v.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.trim().to_owned())),
        Some(_) => Err(bad()),
    };
    if !v.is_object() {
        return Err(bad());
    }
    let email = text("email")?.ok_or_else(bad)?;
    let ok_email = email.len() <= MAX_EMAIL
        && email.split('@').count() == 2
        && email.split('@').all(|part| !part.is_empty())
        && !email.chars().any(|c| c.is_whitespace() || c.is_control() || "\"<>:;,()[]\\".contains(c));
    if !ok_email {
        return Err(format!("{email:?} is not an email address"));
    }
    let name = text("name")?.unwrap_or_default();
    if name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
        return Err(format!("a person's name is up to {MAX_NAME} characters on one line"));
    }
    let status = match text("status")? {
        Some(s) if attendee => {
            let s = s.to_ascii_lowercase();
            if !STATUSES.contains(&s.as_str()) {
                return Err(format!("an attendee's status is one of {}", STATUSES.join(", ")));
            }
            s
        }
        _ if attendee => was.map_or_else(|| "needs-action".to_owned(), |w| w.status.clone()),
        _ => String::new(),
    };
    Ok(Person { name, email, status, params: was.map(|w| w.params.clone()).unwrap_or_default() })
}

/// The attendees and organizer a save leaves on the event: as sent, or as they were when the draft leaves them out.
fn people_sent(draft: &Draft, base: Option<&Event>) -> Res<(Vec<Person>, Option<Person>)> {
    let same = |a: &Person, email: &str| a.email.eq_ignore_ascii_case(email);
    let attendees = match &draft.attendees {
        None => base.map(|b| b.attendees.clone()).unwrap_or_default(),
        Some(Value::Array(list)) => {
            if list.len() > MAX_PEOPLE {
                return Err(format!("an event has up to {MAX_PEOPLE} attendees"));
            }
            let mut out: Vec<Person> = Vec::new();
            for v in list {
                let email = v.get("email").and_then(Value::as_str).unwrap_or("").trim();
                let was = base.and_then(|b| b.attendees.iter().find(|a| same(a, email)));
                let p = person_sent(v, was, true)?;
                if out.iter().any(|o| same(o, &p.email)) {
                    return Err(format!("{} is on the event twice", p.email));
                }
                out.push(p);
            }
            out
        }
        Some(_) => return Err("attendees is a list of { name, email, status }".into()),
    };
    let organizer = match &draft.organizer {
        None => base.and_then(|b| b.organizer.clone()),
        Some(Value::Null) => None,
        Some(v) => {
            let email = v.get("email").and_then(Value::as_str).unwrap_or("").trim();
            let was = base.and_then(|b| b.organizer.as_ref()).filter(|o| same(o, email));
            Some(person_sent(v, was, false)?)
        }
    };
    Ok((attendees, organizer))
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
/// Which times of a repeating event a change or a removal is for, as calendars ask: this event, this and following
/// events, or all events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    One,
    Following,
    All,
}

impl Scope {
    pub fn named(name: Option<&str>) -> Res<Scope> {
        match name.map(str::trim).unwrap_or("") {
            "" | "all" => Ok(Scope::All),
            "one" | "this" => Ok(Scope::One),
            "following" => Ok(Scope::Following),
            _ => Err("scope is one, following or all".into()),
        }
    }
}

/// The time a changed copy of one time of a repeating event stands in for (`RECURRENCE-ID`).
fn recurrence_id(e: &Event) -> Option<NaiveDateTime> {
    moments_in(e, "RECURRENCE-ID").into_iter().next()
}

/// A changed copy of one time of the repeating event `uid`.
fn is_copy_of(e: &Event, uid: &str) -> bool {
    e.uid == uid && e.repeat.is_none() && recurrence_id(e).is_some()
}

/// `at` as the same kind of time as `like`: a day for an all-day event.
fn same_kind(like: When, at: NaiveDateTime) -> When {
    match like {
        When::Day(_) => When::Day(at.date()),
        When::At(_) => When::At(at),
    }
}

/// One time of a repeating event, as an event of its own.
fn instance(series: &Event, at: When) -> Event {
    let mut e = series.clone();
    e.end = series.end.shifted(at.moment() - series.start.moment());
    e.start = at;
    e
}

/// Lines that belong to a series, not to one time of it or to a series made from part of it.
fn series_line(line: &str) -> bool {
    split_line(line).is_some_and(|(name, ..)| matches!(name.as_str(), "RECURRENCE-ID" | "EXDATE" | "RDATE" | "RRULE"))
}

/// Ends a series just before `at`: a counted one after the times before it, otherwise on the day before. The times
/// it had left from `at`, when it was counted.
fn end_before(series: &mut Event, at: NaiveDateTime) -> Option<u32> {
    let before = u32::try_from(occurrences(series, at).len()).unwrap_or(u32::MAX);
    let r = series.repeat.as_mut()?;
    match r.count {
        Some(count) => {
            r.count = Some(before);
            Some(count.saturating_sub(before))
        }
        None => {
            let day = at.date() - Duration::days(1);
            r.until = Some(r.until.map_or(day, |u| u.min(day)));
            None
        }
    }
}

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
            "description": "Find times when the person is free, and the people named are too (from the calendars they share), for a meeting of a given length. Weekdays, in working hours, from now on: the first free time of each morning and each afternoon (from 13:00). For afternoons only, set dayStart to 13:00; for mornings only, dayEnd to 12:00. Then offer the best two or three with calendar.suggest; to invite, draft an email with mail.draft.",
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
                "repeat": { "type": "string", "description": format!("How it repeats: one of {}, or never.", REPEATS.join(", ")) },
                "occurrence": { "type": "string", "description": "For a repeating event, the start of the one time meant, as calendar.list gave it." },
                "scope": { "type": "string", "enum": ["one", "following", "all"], "description": "For a repeating event: that time only, it and the times after it, or every time (the default)." } }, "required": ["calendar", "id"] } }),
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
                let mut v = event_json(calendar, e, when, read_only);
                // Which time of a series it is, so a change can be for that time only.
                if e.repeat.is_some() {
                    v["occurrence"] = json!(when.show());
                } else if let Some(id) = recurrence_id(e)
                    && let Some(series) = events.iter().find(|o| o.uid == e.uid && o.repeat.is_some())
                {
                    v["repeats"] = json!(true);
                    v["repeat"] = json!(series.repeat.as_ref().map_or("", repeat_name));
                    v["occurrence"] = json!(same_kind(series.start, id).show());
                }
                found.push((s, v));
            }
        }
    }
}

fn event_json(calendar: &str, e: &Event, start: When, read_only: bool) -> Value {
    let shift = start.moment() - e.start.moment();
    let end = e.end.shifted(shift);
    let all_day = matches!(e.start, When::Day(_));
    json!({ "id": e.uid, "calendar": calendar, "title": e.title, "start": start.show(), "end": end.show(), "allDay": all_day,
        "location": e.location, "notes": e.notes, "repeats": e.repeat.is_some(), "repeat": e.repeat.as_ref().map_or("", repeat_name), "readOnly": read_only,
        "attendees": e.attendees.iter().map(person_json).collect::<Vec<_>>(), "organizer": e.organizer.as_ref().map(person_json), "alert": alert_of(e) })
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

    /// A calendar of the person's own, by name: not the default one, which is always there, and not an account's.
    fn own(&self, name: &str) -> Res<PathBuf> {
        if name == DEFAULT_CALENDAR {
            return Err(format!("{DEFAULT_CALENDAR} is always there: it cannot be renamed or deleted"));
        }
        if self.mirror(name).is_some() {
            return Err("that calendar is an account's: it is changed in Settings, Calendar".into());
        }
        let file = self.file(name)?;
        if !file.exists() {
            return Err("that calendar is not there".into());
        }
        Ok(file)
    }

    /// Renames one of the person's own calendars: its file, and the name inside it.
    pub fn rename(&self, from: &str, to: &str) -> Res<Value> {
        let file = self.own(from)?;
        let to = file_name_for(to.trim());
        if !calendar_ok(&to) {
            return Err("that is not a name for a calendar".into());
        }
        if self.calendars().iter().any(|c| c.eq_ignore_ascii_case(&to) && !c.eq_ignore_ascii_case(from)) {
            return Err("there is already a calendar with that name".into());
        }
        let (events, mut other) = self.load(from)?;
        other.retain(|l| !l.to_ascii_uppercase().starts_with("X-WR-CALNAME"));
        // The new name inside the file first, then the file renamed, so a change of case alone renames it too.
        fs::write(&file, write(&to, &events, &other)).map_err(|e| e.to_string())?;
        fs::rename(&file, self.root.join(format!("{to}.ics"))).map_err(|e| e.to_string())?;
        Ok(json!({ "name": to, "was": from }))
    }

    fn deleted_root(&self) -> PathBuf {
        self.root.join(".deleted")
    }

    /// Deletes one of the person's own calendars: its file is kept aside, so `restore_calendar` can put it back.
    pub fn remove_calendar(&self, name: &str) -> Res<Value> {
        let file = self.own(name)?;
        let (events, _) = self.load(name)?;
        let id = format!("{}-{}", Utc::now().timestamp_millis(), file_name_for(name));
        let aside = self.deleted_root().join(format!("{id}.ics"));
        fs::create_dir_all(self.deleted_root()).map_err(|e| e.to_string())?;
        fs::rename(&file, &aside).map_err(|e| e.to_string())?;
        Ok(json!({ "id": id, "name": name, "events": events.len() }))
    }

    /// Puts a deleted calendar back under its name, unless another has taken it.
    pub fn restore_calendar(&self, id: &str) -> Res<Value> {
        if id.is_empty() || id.contains(['/', '\\']) || id.starts_with('.') {
            return Err("that is not a deleted calendar".into());
        }
        let aside = self.deleted_root().join(format!("{id}.ics"));
        if !aside.is_file() {
            return Err("that calendar is no longer kept".into());
        }
        let name = id.split_once('-').map_or(id, |(_, n)| n).to_owned();
        if !calendar_ok(&name) || self.calendars().iter().any(|c| c.eq_ignore_ascii_case(&name)) {
            return Err("there is already a calendar with that name".into());
        }
        fs::rename(&aside, self.file(&name)?).map_err(|e| e.to_string())?;
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
                    // A morning and an afternoon each, the afternoon from 13:00, after lunch, so a week gives all ten.
                    let half = usize::from(at.time() >= NaiveTime::from_hms_opt(13, 0, 0).unwrap_or(NaiveTime::MIN));
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
        let (attendees, organizer) = people_sent(draft, None)?;
        let alert = alert_sent(draft)?;
        let (mut events, other) = self.load(calendar)?;
        let mut event = Event { uid: new_uid(), title, start, end, location, notes, repeat, attendees, organizer, extra: Vec::new(), zone: None };
        if let Some(alert) = alert {
            set_alert(&mut event, alert);
        }
        self.send(calendar, Some((std::slice::from_ref(&event), true)), None)?;
        events.push(event.clone());
        self.store(calendar, &events, &other)?;
        Ok(event_json(calendar, &event, event.start, false))
    }

    pub fn update(&self, calendar: &str, uid: &str, draft: &Draft) -> Res<Value> {
        let (mut events, other) = self.load(calendar)?;
        // The event itself, not a changed copy of one of its times.
        let at = events.iter().position(|e| e.uid == uid && (e.repeat.is_some() || moments_in(e, "RECURRENCE-ID").is_empty())).ok_or("that event is not in that calendar")?;
        let scope = Scope::named(draft.scope.as_deref())?;
        if scope != Scope::All && events[at].repeat.is_some() {
            let shown = self.time_of(&events, at, draft.occurrence.as_deref())?;
            if scope == Scope::One || shown.moment() > events[at].start.moment() {
                return self.update_times(calendar, events, &other, at, shown, scope, draft);
            }
        }
        let (title, mut start, mut end, location, notes) = Self::checked(draft, Some(&events[at]))?;
        let (attendees, organizer) = people_sent(draft, Some(&events[at]))?;
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
        (changed.attendees, changed.organizer) = (attendees, organizer);
        if let Some(name) = &draft.repeat {
            changed.repeat = repeat_named(name)?;
        }
        if let Some(alert) = alert_sent(draft)? {
            set_alert(&mut changed, alert);
        }
        let mut after = events.clone();
        after[at] = changed.clone();
        let parts: Vec<Event> = after.iter().filter(|e| e.uid == uid).cloned().collect();
        self.send(calendar, Some((&parts, false)), None)?;
        events = after;
        self.store(calendar, &events, &other)?;
        Ok(event_json(calendar, &changed, changed.start, false))
    }

    /// The time of the series at `at` that `occurrence` names: one it has, or one a changed copy stands in for.
    fn time_of(&self, events: &[Event], at: usize, occurrence: Option<&str>) -> Res<When> {
        let series = &events[at];
        let named = occurrence.and_then(When::parse).ok_or("occurrence is the start of the one time meant, as calendar.list gave it")?;
        let shown = same_kind(series.start, named.moment());
        let has = occurrences(series, shown.moment() + Duration::seconds(1)).contains(&shown)
            || events.iter().any(|e| is_copy_of(e, &series.uid) && recurrence_id(e) == Some(shown.moment()));
        if has { Ok(shown) } else { Err("that event does not happen then".into()) }
    }

    /// A change to one time of a repeating event, or to it and the times after it.
    #[allow(clippy::too_many_arguments)]
    fn update_times(&self, calendar: &str, mut events: Vec<Event>, other: &[String], at: usize, shown: When, scope: Scope, draft: &Draft) -> Res<Value> {
        let series = events[at].clone();
        let uid = series.uid.clone();
        let copy = events.iter().position(|e| is_copy_of(e, &uid) && recurrence_id(e) == Some(shown.moment()));
        let base = copy.map_or_else(|| instance(&series, shown), |i| events[i].clone());
        let (title, start, end, location, notes) = Self::checked(draft, Some(&base))?;
        let (attendees, organizer) = people_sent(draft, Some(&base))?;
        let mut changed = base;
        (changed.title, changed.start, changed.end, changed.location, changed.notes) = (title, start, end, location, notes);
        (changed.attendees, changed.organizer) = (attendees, organizer);
        if let Some(alert) = alert_sent(draft)? {
            set_alert(&mut changed, alert);
        }
        let mut shown_json = None;
        if scope == Scope::One {
            changed.repeat = None;
            if copy.is_none() {
                changed.extra.retain(|l| !series_line(l));
                let zone = changed.zone.clone();
                changed.extra.push(shown.ics("RECURRENCE-ID", zone.as_deref()));
            }
            match copy {
                Some(i) => events[i] = changed.clone(),
                None => events.push(changed.clone()),
            }
            shown_json = Some(shown);
        } else {
            // This and following: the series ends before it, and a new one starts there.
            let left = end_before(&mut events[at], shown.moment());
            events.retain(|e| !(is_copy_of(e, &uid) && recurrence_id(e).is_some_and(|m| m >= shown.moment())));
            changed.uid = new_uid();
            changed.extra.retain(|l| !series_line(l));
            changed.repeat = match &draft.repeat {
                Some(name) => repeat_named(name)?,
                None => series.repeat.clone().map(|mut r| {
                    r.count = left.or(r.count);
                    r
                }),
            };
            events.push(changed.clone());
            self.send(calendar, Some((std::slice::from_ref(&changed), true)), None)?;
        }
        let parts: Vec<Event> = events.iter().filter(|e| e.uid == uid).cloned().collect();
        self.send(calendar, Some((&parts, false)), None)?;
        self.store(calendar, &events, other)?;
        let mut v = event_json(calendar, &changed, changed.start, false);
        if let Some(shown) = shown_json {
            v["repeats"] = json!(true);
            v["repeat"] = json!(series.repeat.as_ref().map_or("", repeat_name));
            v["occurrence"] = json!(shown.show());
        }
        Ok(v)
    }

    pub fn remove(&self, calendar: &str, uid: &str) -> Res<Value> {
        self.remove_times(calendar, uid, None, Scope::All)
    }

    /// Takes out one time of a repeating event (`occurrence`, with `Scope::One`), or it and the times after it.
    pub fn remove_times(&self, calendar: &str, uid: &str, occurrence: Option<&str>, scope: Scope) -> Res<Value> {
        if scope != Scope::All {
            let (mut events, other) = self.load(calendar)?;
            if let Some(at) = events.iter().position(|e| e.uid == uid && e.repeat.is_some()) {
                let shown = self.time_of(&events, at, occurrence)?;
                if scope == Scope::One || shown.moment() > events[at].start.moment() {
                    if scope == Scope::One {
                        let zone = events[at].zone.clone();
                        events[at].extra.push(shown.ics("EXDATE", zone.as_deref()));
                    } else {
                        end_before(&mut events[at], shown.moment());
                    }
                    let gone = |m: NaiveDateTime| if scope == Scope::One { m == shown.moment() } else { m >= shown.moment() };
                    events.retain(|e| !(is_copy_of(e, uid) && recurrence_id(e).is_some_and(gone)));
                    let parts: Vec<Event> = events.iter().filter(|e| e.uid == uid).cloned().collect();
                    self.send(calendar, Some((&parts, false)), None)?;
                    self.store(calendar, &events, &other)?;
                    return Ok(json!({ "calendar": calendar, "removed": uid, "occurrence": shown.show() }));
                }
            }
        }
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
        // The agent neither sees nor sets who is invited yet: a CalDAV server can email an invitation on its own.
        let draft = || Draft { attendees: None, organizer: None, ..Draft::from_json(args) };
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
                self.add(calendar, &draft())?
            }
            "calendar.suggest" => {
                self.checkpoint(&format!("before the agent suggested an event for {calendar}"));
                self.suggest(calendar, &draft(), text("why").unwrap_or(""))?
            }
            "calendar.update" => {
                let uid = text("id").ok_or("id is the event's id from calendar.list")?;
                self.checkpoint(&format!("before the agent changed an event in {calendar}"));
                self.update(calendar, uid, &draft())?
            }
            _ => return Err("unknown tool".into()),
        };
        Ok(without_people(result).to_string())
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
        // A free week gives a morning and an afternoon (from 13:00, after lunch) on each of its five weekdays.
        let next = c.free(&[], 60, (monday + Duration::days(7), monday + Duration::days(13)), day, at("2026-11-16", "08:00")).unwrap();
        let starts: Vec<&str> = next["free"].as_array().unwrap().iter().map(|f| f["start"].as_str().unwrap()).collect();
        assert_eq!(starts.len(), 10, "{starts:?}");
        assert!(starts.iter().step_by(2).all(|s| s.ends_with("T09:00")) && starts.iter().skip(1).step_by(2).all(|s| s.ends_with("T13:00")), "{starts:?}");
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
    fn attendees_and_the_organizer_are_read_written_and_kept_through_a_save() {
        let (dir, c) = store();
        let file = dir.path().join("workspace/calendar/Calendar.ics");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        // As a CalDAV server sends it: a quoted name with a comma, other parameters, and an answer Mobius does not name.
        fs::write(&file, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:m1\r\nDTSTART:20261116T100000\r\nDTEND:20261116T110000\r\nSUMMARY:Supplier review\r\nORGANIZER;CN=\"Okafor, Sam\":mailto:sam@northway.example\r\nATTENDEE;CN=Priya Raman;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:priya@northway.example\r\nATTENDEE;PARTSTAT=DELEGATED:MAILTO:jo@northway.example\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        let shown = c.events("2026-11-16", "2026-11-16").unwrap();
        assert_eq!(shown[0]["organizer"], json!({ "name": "Okafor, Sam", "email": "sam@northway.example", "status": "" }));
        assert_eq!(shown[0]["attendees"], json!([
            { "name": "Priya Raman", "email": "priya@northway.example", "status": "accepted" },
            { "name": "", "email": "jo@northway.example", "status": "" },
        ]));
        // A save that leaves them out keeps them, with their other parameters.
        c.update("Calendar", "m1", &Draft { title: Some("Supplier review, moved".into()), ..Draft::default() }).unwrap();
        // Read as unfolded lines: long ones are folded in the file.
        let text = unfold(&fs::read_to_string(&file).unwrap()).join("\n");
        assert!(text.contains("ORGANIZER;CN=\"Okafor, Sam\":mailto:sam@northway.example"), "{text}");
        assert!(text.contains("ATTENDEE;CN=Priya Raman;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:priya@northway.example"), "{text}");
        assert!(text.contains("ATTENDEE;PARTSTAT=DELEGATED:mailto:jo@northway.example"), "{text}");
        // The list as sent replaces it: Priya keeps her answer and parameters, Ana is new and has not answered yet.
        let saved = c.update("Calendar", "m1", &Draft::from_json(&json!({ "attendees": [{ "email": "Priya@northway.example", "name": "Priya Raman" }, { "name": "Ana Silva", "email": "ana@example.org" }] }))).unwrap();
        assert_eq!(saved["attendees"], json!([
            { "name": "Priya Raman", "email": "Priya@northway.example", "status": "accepted" },
            { "name": "Ana Silva", "email": "ana@example.org", "status": "needs-action" },
        ]));
        assert!(unfold(&fs::read_to_string(&file).unwrap()).join("\n").contains("ATTENDEE;CN=Ana Silva;PARTSTAT=NEEDS-ACTION:mailto:ana@example.org"));
        let cleared = c.update("Calendar", "m1", &Draft::from_json(&json!({ "attendees": [], "organizer": null }))).unwrap();
        assert_eq!((cleared["attendees"].clone(), cleared["organizer"].clone()), (json!([]), Value::Null));
        // A new event takes them too.
        let added = c.add("Calendar", &Draft::from_json(&json!({ "title": "Kickoff", "start": "2026-11-17T09:00", "organizer": { "name": "Me", "email": "me@example.org" }, "attendees": [{ "email": "sam@northway.example", "status": "tentative" }] }))).unwrap();
        assert_eq!(added["attendees"][0]["status"], "tentative");
        assert_eq!(added["organizer"]["email"], "me@example.org");
        // The agent's tools neither show them nor set them.
        let listed: Value = serde_json::from_str(&c.run("calendar.list", &json!({ "from": "2026-11-17", "to": "2026-11-17" })).unwrap()).unwrap();
        assert!(listed[0].get("attendees").is_none() && listed[0].get("organizer").is_none(), "{listed}");
        let by_agent: Value = serde_json::from_str(&c.run("calendar.add", &json!({ "title": "Call", "start": "2026-11-18T09:00", "attendees": [{ "email": "x@example.org" }] })).unwrap()).unwrap();
        assert_eq!(c.events("2026-11-18", "2026-11-18").unwrap()[0]["attendees"], json!([]), "{by_agent}");
    }

    #[test]
    fn an_alert_is_read_set_and_taken_off_as_a_valarm_keeping_alarms_mobius_does_not_show() {
        let (dir, c) = store();
        let file = dir.path().join("workspace/calendar/Calendar.ics");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        // One alarm set from the start (shown as the alert) and one at a set time (kept, not shown).
        fs::write(&file, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nDTSTART:20261116T100000\r\nDTEND:20261116T110000\r\nSUMMARY:Review\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;RELATED=START:-PT1H\r\nEND:VALARM\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER;VALUE=DATE-TIME:20261116T080000Z\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        assert_eq!(c.events("2026-11-16", "2026-11-16").unwrap()[0]["alert"], json!(60));
        let saved = c.update("Calendar", "a1", &Draft::from_json(&json!({ "alert": 10 }))).unwrap();
        assert_eq!(saved["alert"], json!(10));
        let text = unfold(&fs::read_to_string(&file).unwrap()).join("\n");
        assert!(text.contains("TRIGGER:-PT10M") && !text.contains("-PT1H"), "{text}");
        assert!(text.contains("TRIGGER;VALUE=DATE-TIME:20261116T080000Z"), "{text}");
        // A save that leaves it out keeps it; null takes it off, and the alarm at a set time stays.
        c.update("Calendar", "a1", &Draft { title: Some("Review, moved".into()), ..Draft::default() }).unwrap();
        assert_eq!(c.events("2026-11-16", "2026-11-16").unwrap()[0]["alert"], json!(10));
        let cleared = c.update("Calendar", "a1", &Draft::from_json(&json!({ "alert": null }))).unwrap();
        assert_eq!(cleared["alert"], Value::Null);
        let text = fs::read_to_string(&file).unwrap();
        assert!(!text.contains("-PT10M") && text.contains("ACTION:AUDIO"), "{text}");
        // A new all-day event at 9:00 on its day: after its start, written as such.
        let day = c.add("Calendar", &Draft::from_json(&json!({ "title": "Trip", "start": "2026-11-20", "alert": -540 }))).unwrap();
        assert_eq!(day["alert"], json!(-540));
        assert!(fs::read_to_string(&file).unwrap().contains("TRIGGER:PT540M"));
        // At the time, and nonsense refused.
        let now = c.add("Calendar", &Draft::from_json(&json!({ "title": "Call", "start": "2026-11-21T09:00", "alert": 0 }))).unwrap();
        assert_eq!(now["alert"], json!(0));
        assert!(c.add("Calendar", &Draft::from_json(&json!({ "title": "x", "start": "2026-11-21T09:00", "alert": "soon" }))).is_err());
        assert!(c.add("Calendar", &Draft::from_json(&json!({ "title": "x", "start": "2026-11-21T09:00", "alert": 999_999 }))).is_err());
    }

    #[test]
    fn a_calendar_of_ones_own_is_renamed_deleted_and_put_back_but_not_the_default() {
        let (dir, c) = store();
        c.create("Work").unwrap();
        c.add("Work", &Draft::from_json(&json!({ "title": "Review", "start": "2026-11-16T10:00" }))).unwrap();
        let renamed = c.rename("Work", "Office").unwrap();
        assert_eq!(renamed["name"], "Office");
        let root = dir.path().join("workspace/calendar");
        assert!(!root.join("Work.ics").exists());
        let text = fs::read_to_string(root.join("Office.ics")).unwrap();
        assert!(text.contains("X-WR-CALNAME:Office") && text.contains("SUMMARY:Review"), "{text}");
        assert!(c.calendars().contains(&"Office".to_owned()));
        // A change of case alone.
        c.rename("Office", "office").unwrap();
        assert!(c.calendars().contains(&"office".to_owned()));
        c.rename("office", "Office").unwrap();
        // Names taken, and the default, are refused.
        c.create("Home").unwrap();
        assert!(c.rename("Office", "home").is_err());
        assert!(c.rename(DEFAULT_CALENDAR, "Mine").is_err());
        assert!(c.remove_calendar(DEFAULT_CALENDAR).is_err());
        // A name with a path in it stays a file in the calendar folder.
        let odd = c.rename("Office", "../x").unwrap();
        let odd = odd["name"].as_str().unwrap().to_owned();
        assert!(!odd.contains('/') && root.join(format!("{odd}.ics")).exists(), "{odd}");
        c.rename(&odd, "Office").unwrap();
        // Deleted: gone from the list, kept aside, and put back whole.
        let gone = c.remove_calendar("Office").unwrap();
        assert_eq!(gone["events"], 1);
        assert!(!c.calendars().contains(&"Office".to_owned()));
        let back = c.restore_calendar(gone["id"].as_str().unwrap()).unwrap();
        assert_eq!(back["name"], "Office");
        assert_eq!(c.events("2026-11-16", "2026-11-16").unwrap()[0]["calendar"], "Office");
        assert!(c.restore_calendar(gone["id"].as_str().unwrap()).is_err());
        assert!(c.restore_calendar("../Office").is_err());
    }

    #[test]
    fn people_that_are_not_real_addresses_or_come_twice_are_refused() {
        let (_d, c) = store();
        let with = |people: Value| c.add("Calendar", &Draft::from_json(&json!({ "title": "x", "start": "2026-11-12T09:00", "attendees": people })));
        assert!(with(json!([{ "email": "ana@example.org" }])).is_ok());
        for bad in [
            json!("ana@example.org"),
            json!([{ "name": "Ana" }]),
            json!([{ "email": "not an address" }]),
            json!([{ "email": "a@b@c" }]),
            json!([{ "email": "ana@example.org:x" }]),
            json!([{ "email": "ana@example.org", "status": "maybe" }]),
            json!([{ "email": "ana@example.org", "name": "two\nlines" }]),
            json!([{ "email": "ana@example.org" }, { "email": "ANA@example.org" }]),
            Value::Array(vec![json!({ "email": "a@example.org" }); MAX_PEOPLE + 1]),
        ] {
            assert!(with(bad.clone()).is_err(), "{bad}");
        }
        assert!(c.add("Calendar", &Draft::from_json(&json!({ "title": "x", "start": "2026-11-12T09:00", "organizer": { "email": "nobody" } }))).is_err());
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
    fn a_saved_event_keeps_its_times_in_utc_or_its_zone() {
        let (_d, c) = store();
        // Google writes times in UTC; Outlook names a zone. A save keeps each as it was, not as a floating local time.
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:g\r\nDTSTART:20261125T150000Z\r\nDTEND:20261125T160000Z\r\nSUMMARY:Sync\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:o\r\nDTSTART;TZID=W. Europe Standard Time:20261126T090000\r\nDTEND;TZID=W. Europe Standard Time:20261126T100000\r\nSUMMARY:Review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        std::fs::create_dir_all(c.root.clone()).unwrap();
        std::fs::write(c.root.join("Shared.ics"), text).unwrap();
        c.update("Shared", "g", &Draft { title: Some("Sync, moved".into()), ..Draft::default() }).unwrap();
        c.update("Shared", "o", &Draft { title: Some("Review, kept".into()), ..Draft::default() }).unwrap();
        let written = unfold(&std::fs::read_to_string(c.root.join("Shared.ics")).unwrap()).join("\n");
        for kept in ["DTSTART:20261125T150000Z", "DTEND:20261125T160000Z", "DTSTART;TZID=W. Europe Standard Time:20261126T090000", "DTEND;TZID=W. Europe Standard Time:20261126T100000"] {
            assert!(written.contains(kept), "{kept} kept in {written}");
        }
        // Moved in the app, a UTC event is still written in UTC, at the same moment.
        let local = Utc.with_ymd_and_hms(2026, 11, 25, 17, 0, 0).unwrap().with_timezone(&Local).naive_local();
        let at = local.format("%Y-%m-%dT%H:%M").to_string();
        let end = (local + Duration::hours(1)).format("%Y-%m-%dT%H:%M").to_string();
        c.update("Shared", "g", &Draft::from_json(&json!({ "start": at, "end": end }))).unwrap();
        let written = std::fs::read_to_string(c.root.join("Shared.ics")).unwrap();
        assert!(written.contains("DTSTART:20261125T170000Z"), "{written}");
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
    #[test]
    fn one_time_or_this_and_following_of_a_repeating_event_changes_or_goes_alone() {
        let (dir, c) = store();
        let file = dir.path().join("workspace/calendar/Calendar.ics");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTART:20261102T090000\r\nDTEND:20261102T093000\r\nRRULE:FREQ=WEEKLY;COUNT=6\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        let titles = |from: &str, to: &str| -> Vec<(String, String)> {
            c.events(from, to).unwrap().as_array().unwrap().iter().map(|e| (e["start"].as_str().unwrap().to_owned(), e["title"].as_str().unwrap().to_owned())).collect()
        };
        let week = |t: &str| (t.to_owned(), "Standup".to_owned());
        // Each time says which time of the series it is.
        assert_eq!(c.events("2026-11-09", "2026-11-09").unwrap()[0]["occurrence"], "2026-11-09T09:00");

        // This event: the 9th moves to 15:00 and is renamed; the others stay.
        let one = Draft { title: Some("Standup (late)".into()), start: Some("2026-11-09T15:00".into()), end: Some("2026-11-09T15:30".into()), occurrence: Some("2026-11-09T09:00".into()), scope: Some("one".into()), ..Draft::default() };
        let moved = c.update("Calendar", "s", &one).unwrap();
        assert_eq!((moved["repeats"].clone(), moved["occurrence"].clone()), (json!(true), json!("2026-11-09T09:00")));
        assert_eq!(titles("2026-11-02", "2026-11-16"), vec![week("2026-11-02T09:00"), ("2026-11-09T15:00".into(), "Standup (late)".into()), week("2026-11-16T09:00")]);
        let shown = c.events("2026-11-09", "2026-11-09").unwrap();
        assert_eq!((shown[0]["repeats"].clone(), shown[0]["occurrence"].clone(), shown[0]["repeat"].clone()), (json!(true), json!("2026-11-09T09:00"), json!("custom")));
        // Changed again, the same copy changes: still one copy in the file.
        c.update("Calendar", "s", &Draft { title: Some("Standup (later)".into()), ..one.clone() }).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap().matches("RECURRENCE-ID").count(), 1);

        // Delete this event: the 16th goes, and only it.
        c.remove_times("Calendar", "s", Some("2026-11-16T09:00"), Scope::One).unwrap();
        assert_eq!(titles("2026-11-16", "2026-11-23"), vec![week("2026-11-23T09:00")]);
        // A time it does not have is refused.
        assert!(c.remove_times("Calendar", "s", Some("2026-11-17T09:00"), Scope::One).is_err());

        // This and following from the 23rd: a new series of what was left (the 23rd, 30th and 7 Dec) at 10:00.
        let following = Draft { title: Some("Team sync".into()), start: Some("2026-11-23T10:00".into()), end: Some("2026-11-23T10:30".into()), occurrence: Some("2026-11-23T09:00".into()), scope: Some("following".into()), ..Draft::default() };
        let made = c.update("Calendar", "s", &following).unwrap();
        assert_ne!(made["id"], "s");
        let all = titles("2026-11-01", "2026-12-31");
        assert_eq!(all.len(), 5, "{all:?}");
        assert_eq!(&all[2..], &[("2026-11-23T10:00".to_owned(), "Team sync".to_owned()), ("2026-11-30T10:00".into(), "Team sync".into()), ("2026-12-07T10:00".into(), "Team sync".into())]);

        // Delete this and following from the 30th of the new series: only the 23rd is left of it.
        let new_id = made["id"].as_str().unwrap();
        c.remove_times("Calendar", new_id, Some("2026-11-30T10:00"), Scope::Following).unwrap();
        assert_eq!(titles("2026-11-23", "2026-12-31"), vec![("2026-11-23T10:00".to_owned(), "Team sync".to_owned())]);
        // And from its first time, the whole of it goes.
        c.remove_times("Calendar", new_id, Some("2026-11-23T10:00"), Scope::Following).unwrap();
        assert!(titles("2026-11-23", "2026-12-31").is_empty());
        // The first series keeps its changed time, and its own copy, through all of that.
        assert_eq!(titles("2026-11-09", "2026-11-09"), vec![("2026-11-09T15:00".to_owned(), "Standup (later)".to_owned())]);

        // An all-day series without a count ends the day before.
        fs::write(&file, "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Walk\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").unwrap();
        c.remove_times("Calendar", "d", Some("2026-11-05"), Scope::Following).unwrap();
        assert!(fs::read_to_string(&file).unwrap().contains("UNTIL=20261104"));
        assert_eq!(c.events("2026-11-01", "2026-11-30").unwrap().as_array().unwrap().len(), 4);
        assert!(Scope::named(Some("some")).is_err());
    }
}
