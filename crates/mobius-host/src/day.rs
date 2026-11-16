//! Plan my day, worked out in code: which tasks are for today, when each one goes, the hour kept for focus and the
//! one kept for lunch. The model only copies the lines and makes the plan with one call, so the times, the order and
//! the counts are the same on every run (the model placing them was right four runs in five).

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::{Value, json};

pub const PLAN: &str = "tasks.plan_day";
pub const MAKE: &str = "tasks.schedule_day";

/// When the planned day ends: nothing is placed after it.
const DAY_END: (u32, u32) = (18, 0);
/// The earliest a planned day starts, however early it is asked for.
const DAY_START: (u32, u32) = (9, 0);
const LUNCH: ((u32, u32), (u32, u32)) = ((12, 0), (13, 0));
pub const FOCUS_TITLE: &str = "Focus time";
/// Words that make a task an hour's work rather than half an hour's.
const LONG_WORDS: [&str; 14] = ["write", "draft", "prepare", "prep", "review", "report", "plan", "budget", "deck", "proposal", "analysis", "presentation", "slides", "research"];

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": PLAN, "capability": "tasks.read",
            "description": "Work out the person's day, changing nothing: the open tasks due today, overdue or flagged, each given a time between now and 18:00 around their events (most important first, back to back, lunch kept free), and one Focus time hour in the longest free stretch left. Gives back `lines`, the day to tell them, and `start`, to pass to tasks.schedule_day.",
            "input_schema": { "type": "object", "properties": {} } }),
        json!({ "name": MAKE, "capability": "tasks.write",
            "description": "Make the plan tasks.plan_day worked out: each of those tasks gets its time today, and each block and the Focus time hour are suggested in the calendar (dashed until the person adds them). Pass the `start` that tasks.plan_day gave.",
            "input_schema": { "type": "object", "properties": { "start": { "type": "string", "description": "The start tasks.plan_day gave, HH:MM." } }, "required": ["start"] } }),
    ]
}

pub fn is_day_tool(name: &str) -> bool {
    name == PLAN || name == MAKE
}

/// A task given a time today.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub list: String,
    pub text: String,
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub why: String,
}

#[derive(Debug, Default)]
pub struct Plan {
    /// Where the plan starts: now, rounded up to the half hour.
    pub start: Option<NaiveDateTime>,
    /// Tasks to give a time and a suggested block.
    pub placed: Vec<Placed>,
    /// Tasks for today that already have a time or a block: shown, not changed.
    pub fixed: Vec<(NaiveDateTime, NaiveDateTime, String)>,
    pub events: Vec<(NaiveDateTime, NaiveDateTime, String)>,
    pub focus: Option<(NaiveDateTime, NaiveDateTime)>,
    /// The Focus time hour was already suggested on an earlier run.
    pub focus_held: bool,
    pub lunch: Option<(NaiveDateTime, NaiveDateTime)>,
    /// What can wait: tasks for today with no room left, then those due in the coming week. Each with why.
    pub waiting: Vec<String>,
}

fn at(day: NaiveDate, (h, m): (u32, u32)) -> NaiveDateTime {
    day.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap_or_default())
}

fn moment(text: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M").ok()
}

/// Now, rounded up to the next half hour.
fn rounded(now: NaiveDateTime) -> NaiveDateTime {
    let day = now.date();
    let minutes = now.time().signed_duration_since(NaiveTime::MIN).num_minutes();
    let up = (minutes + 29) / 30 * 30;
    day.and_time(NaiveTime::MIN) + Duration::minutes(up.min(24 * 60 - 1))
}

fn minutes_for(text: &str) -> i64 {
    let lower = text.to_lowercase();
    if lower.split(|c: char| !c.is_alphanumeric()).any(|w| LONG_WORDS.contains(&w)) { 60 } else { 30 }
}

fn short_day(d: NaiveDate) -> String {
    d.format("%a %-d %b").to_string()
}

/// Work out the day. `lists` is what tasks.list gives for every list; `events` what calendar.list gives for today;
/// `pending` the calendar's suggestions not yet answered (an earlier run's blocks, so a second run repeats nothing).
pub fn plan(now: NaiveDateTime, lists: &Value, events: &Value, pending: &Value) -> Plan {
    let today = now.date();
    let mut plan = Plan::default();
    let (day_start, day_end) = (at(today, DAY_START), at(today, DAY_END));
    let start = rounded(now).max(day_start);
    plan.start = Some(start);

    let mut busy: Vec<(NaiveDateTime, NaiveDateTime)> = Vec::new();
    for e in events.as_array().into_iter().flatten() {
        if e["allDay"].as_bool() == Some(true) {
            continue;
        }
        let (Some(s), Some(f)) = (e["start"].as_str().and_then(moment), e["end"].as_str().and_then(moment)) else { continue };
        if s.date() != today || f <= s {
            continue;
        }
        plan.events.push((s, f, e["title"].as_str().unwrap_or("").to_owned()));
        busy.push((s, f));
    }
    plan.events.sort_by_key(|e| e.0);

    // An earlier run's blocks, still waiting for an answer: by title.
    let held: Vec<(String, NaiveDateTime, NaiveDateTime)> = pending
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| Some((s["title"].as_str()?.to_owned(), s["start"].as_str().and_then(moment)?, s["end"].as_str().and_then(moment)?)))
        .filter(|(_, s, _)| s.date() == today)
        .collect();
    if let Some((_, s, f)) = held.iter().find(|(t, _, _)| t == FOCUS_TITLE) {
        plan.focus = Some((*s, *f));
        plan.focus_held = true;
        busy.push((*s, *f));
    }

    // The tasks for today, most important first: flagged, then overdue (oldest first), then due today.
    struct Wanted {
        list: String,
        text: String,
        rank: (u8, NaiveDate, usize),
        why: String,
    }
    let mut wanted = Vec::new();
    let mut later: Vec<(NaiveDate, String)> = Vec::new();
    let mut order = 0;
    for list in lists.as_array().into_iter().flatten() {
        let name = list["list"].as_str().unwrap_or("Inbox");
        for t in list["tasks"].as_array().into_iter().flatten() {
            order += 1;
            if t["done"].as_bool() == Some(true) {
                continue;
            }
            let Some(text) = t["text"].as_str().filter(|t| !t.trim().is_empty()) else { continue };
            let due = t["due"].as_str().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
            let flagged = t["flagged"].as_bool() == Some(true);
            if due.is_some_and(|d| d > today) {
                if due.is_some_and(|d| d <= today + Duration::days(7)) {
                    later.push((due.unwrap_or(today), text.to_owned()));
                }
                continue;
            }
            if due.is_none() && !flagged {
                continue;
            }
            // Already given a time today, or already a block from an earlier run: it stays where it is.
            if let Some(time) = t["time"].as_str().filter(|_| due == Some(today)).and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()) {
                let s = today.and_time(time);
                let f = s + Duration::minutes(minutes_for(text));
                plan.fixed.push((s, f, text.to_owned()));
                busy.push((s, f));
                continue;
            }
            if let Some((_, s, f)) = held.iter().find(|(title, _, _)| title == text) {
                plan.fixed.push((*s, *f, text.to_owned()));
                busy.push((*s, *f));
                continue;
            }
            let why = match due {
                _ if flagged => "Flagged as important.".to_owned(),
                Some(d) if d < today => format!("Overdue since {}.", short_day(d)),
                _ => "Due today.".to_owned(),
            };
            let rank = (if flagged { 0 } else if due.is_some_and(|d| d < today) { 1 } else { 2 }, due.unwrap_or(today), order);
            wanted.push(Wanted { list: name.to_owned(), text: text.to_owned(), rank, why });
        }
    }
    wanted.sort_by(|a, b| a.rank.cmp(&b.rank));

    // Lunch: an event that says so, or else the hour from noon, if it is still to come and free.
    let (lunch_start, lunch_end) = (at(today, LUNCH.0), at(today, LUNCH.1));
    let lunch_event = plan.events.iter().any(|(_, _, t)| t.to_lowercase().contains("lunch"));
    if !lunch_event && start < lunch_end && !overlaps(&busy, lunch_start, lunch_end) {
        let s = start.max(lunch_start);
        plan.lunch = Some((s, lunch_end));
        busy.push((s, lunch_end));
    }

    // Focus time: the first hour of the longest free stretch.
    if plan.focus.is_none() {
        if let Some((s, f)) = gaps(&busy, start, day_end).into_iter().max_by_key(|(s, f)| (*f - *s, std::cmp::Reverse(*s))) {
            if f - s >= Duration::minutes(60) {
                plan.focus = Some((s, s + Duration::minutes(60)));
                busy.push((s, s + Duration::minutes(60)));
            }
        }
    }

    // Each task in the earliest free time it fits, so they sit back to back.
    let mut no_room = Vec::new();
    for w in wanted {
        let length = Duration::minutes(minutes_for(&w.text));
        match gaps(&busy, start, day_end).into_iter().find(|(s, f)| *f - *s >= length) {
            Some((s, _)) => {
                busy.push((s, s + length));
                plan.placed.push(Placed { list: w.list, text: w.text, start: s, end: s + length, why: w.why });
            }
            None => no_room.push(w.text),
        }
    }
    later.sort();
    plan.waiting = no_room.into_iter().map(|t| format!("{t} (no room left today)")).chain(later.into_iter().map(|(d, t)| format!("{t} (due {})", short_day(d)))).collect();
    plan
}

fn overlaps(busy: &[(NaiveDateTime, NaiveDateTime)], s: NaiveDateTime, f: NaiveDateTime) -> bool {
    busy.iter().any(|(bs, bf)| *bs < f && *bf > s)
}

/// The free stretches between `from` and `to`, in time order.
fn gaps(busy: &[(NaiveDateTime, NaiveDateTime)], from: NaiveDateTime, to: NaiveDateTime) -> Vec<(NaiveDateTime, NaiveDateTime)> {
    let mut taken: Vec<_> = busy.iter().filter(|(s, f)| *f > from && *s < to).copied().collect();
    taken.sort();
    let mut free = Vec::new();
    let mut cursor = from;
    for (s, f) in taken {
        if s > cursor {
            free.push((cursor, s));
        }
        cursor = cursor.max(f);
    }
    if cursor < to {
        free.push((cursor, to));
    }
    free
}

impl Plan {
    /// The day to tell the person, in time order, written here so every time and count is the real one.
    pub fn lines(&self) -> String {
        let hm = |t: NaiveDateTime| t.format("%H:%M").to_string();
        let mut rows: Vec<(NaiveDateTime, String)> = Vec::new();
        for (s, f, t) in &self.events {
            if *f > self.start.unwrap_or(*s) {
                rows.push((*s, format!("- {}–{} {t}", hm(*s), hm(*f))));
            }
        }
        for p in &self.placed {
            rows.push((p.start, format!("- {}–{} {}", hm(p.start), hm(p.end), p.text)));
        }
        for (s, f, t) in &self.fixed {
            rows.push((*s, format!("- {}–{} {t}", hm(*s), hm(*f))));
        }
        if let Some((s, f)) = self.focus {
            rows.push((s, format!("- {}–{} **{FOCUS_TITLE}**, kept for focused work", hm(s), hm(f))));
        }
        if let Some((s, f)) = self.lunch {
            rows.push((s, format!("- {}–{} Lunch, kept free", hm(s), hm(f))));
        }
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        let n = self.placed.len();
        let head = match (n, rows.is_empty()) {
            (_, true) => "Nothing is left on your day before 18:00.".to_owned(),
            (0, _) => "Here is the rest of your day. No task needed a new time:".to_owned(),
            (1, _) => "Here is the rest of your day. I gave 1 task a time and suggested a block for it:".to_owned(),
            (n, _) => format!("Here is the rest of your day. I gave {n} tasks a time and suggested a block for each:"),
        };
        let mut out = head;
        for (_, row) in rows {
            out.push('\n');
            out.push_str(&row);
        }
        if !self.waiting.is_empty() {
            let shown: Vec<&str> = self.waiting.iter().take(3).map(String::as_str).collect();
            let more = self.waiting.len() - shown.len();
            out.push_str(&format!("\n\nCan wait: {}{}.", shown.join(", "), if more > 0 { format!(", and {more} more") } else { String::new() }));
        }
        out
    }

    /// The calls that make it: one tasks.update per task, and one calendar.suggest with every block and Focus time.
    pub fn updates(&self) -> Vec<Value> {
        self.placed
            .iter()
            .map(|p| json!({ "list": p.list, "task": p.text, "due": p.start.format("%Y-%m-%d").to_string(), "time": p.start.format("%H:%M").to_string() }))
            .collect()
    }

    pub fn suggestion(&self) -> Option<Value> {
        let hm = |t: NaiveDateTime| t.format("%Y-%m-%dT%H:%M").to_string();
        let mut items: Vec<Value> = self.placed.iter().map(|p| json!({ "title": p.text, "start": hm(p.start), "end": hm(p.end), "why": p.why })).collect();
        if let (Some((s, f)), false) = (self.focus, self.focus_held) {
            items.push(json!({ "title": FOCUS_TITLE, "start": hm(s), "end": hm(f), "why": "The longest free stretch left today, kept whole for focused work." }));
        }
        let mut first = items.first()?.clone();
        first["calendar"] = json!(mobius_workspace::calendar::DEFAULT_CALENDAR);
        if items.len() > 1 {
            first["more"] = json!(items[1..]);
        }
        Some(first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now(hm: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(&format!("2026-11-16T{hm}"), "%Y-%m-%dT%H:%M").unwrap()
    }

    fn lists() -> Value {
        json!([{ "list": "Work", "tasks": [
            { "text": "Send the Northway quote", "done": false, "due": "2026-11-16", "flagged": false },
            { "text": "Write the board report", "done": false, "due": "2026-11-14", "flagged": false },
            { "text": "Call the bank", "done": false, "flagged": true },
            { "text": "Book the venue", "done": false, "due": "2026-11-18", "flagged": false },
            { "text": "Old thing", "done": true, "due": "2026-11-10" },
            { "text": "Someday", "done": false },
        ] }])
    }

    fn events() -> Value {
        json!([
            { "title": "Stand-up", "start": "2026-11-16T09:30", "end": "2026-11-16T10:00", "allDay": false },
            { "title": "Design review", "start": "2026-11-16T14:00", "end": "2026-11-16T15:00", "allDay": false },
            { "title": "Holiday", "start": "2026-11-16", "end": "2026-11-16", "allDay": true },
        ])
    }

    #[test]
    fn a_morning_day_keeps_lunch_holds_focus_in_the_longest_stretch_and_puts_tasks_back_to_back() {
        let plan = plan(now("09:10"), &lists(), &events(), &json!([]));
        assert_eq!(plan.start, Some(now("09:30")));
        assert_eq!(plan.lunch, Some((now("12:00"), now("13:00"))));
        // Free: 10:00–12:00, 13:00–14:00, 15:00–18:00. The longest is the afternoon: focus starts it.
        assert_eq!(plan.focus, Some((now("15:00"), now("16:00"))));
        let placed: Vec<(&str, String)> = plan.placed.iter().map(|p| (p.text.as_str(), p.start.format("%H:%M").to_string())).collect();
        assert_eq!(placed, [("Call the bank", "10:00".to_owned()), ("Write the board report", "10:30".to_owned()), ("Send the Northway quote", "11:30".to_owned())]);
        assert_eq!(plan.placed[1].why, "Overdue since Sat 14 Nov.");
        assert_eq!(plan.waiting, ["Book the venue (due Wed 18 Nov)"]);
        let lines = plan.lines();
        assert!(lines.starts_with("Here is the rest of your day. I gave 3 tasks a time and suggested a block for each:\n- 09:30–10:00 Stand-up\n- 10:00–10:30 Call the bank\n- 10:30–11:30 Write the board report\n- 11:30–12:00 Send the Northway quote\n- 12:00–13:00 Lunch, kept free\n- 14:00–15:00 Design review\n- 15:00–16:00 **Focus time**"), "{lines}");
        assert!(lines.ends_with("\n\nCan wait: Book the venue (due Wed 18 Nov)."), "{lines}");
        assert_eq!(plan.updates()[0], json!({ "list": "Work", "task": "Call the bank", "due": "2026-11-16", "time": "10:00" }));
        let s = plan.suggestion().unwrap();
        assert_eq!((s["title"].as_str(), s["more"].as_array().map(Vec::len)), (Some("Call the bank"), Some(3)));
        assert_eq!(s["more"][2]["title"], FOCUS_TITLE);
    }

    #[test]
    fn a_second_run_moves_nothing_and_suggests_nothing_again() {
        let first = plan(now("09:10"), &lists(), &events(), &json!([]));
        let s = first.suggestion().unwrap();
        let mut pending = vec![s.clone()];
        pending.extend(s["more"].as_array().cloned().unwrap_or_default());
        let mut lists = lists();
        for u in first.updates() {
            let task = lists[0]["tasks"].as_array_mut().unwrap().iter_mut().find(|t| t["text"] == u["task"]).unwrap();
            task["due"] = u["due"].clone();
            task["time"] = u["time"].clone();
        }
        let again = plan(now("09:12"), &lists, &events(), &json!(pending));
        assert!(again.placed.is_empty() && again.suggestion().is_none(), "{:?}", again.placed);
        assert_eq!(again.focus, first.focus);
        assert!(again.lines().contains("No task needed a new time"), "{}", again.lines());
    }

    #[test]
    fn an_afternoon_day_starts_from_now_and_has_no_lunch_line() {
        let plan = plan(now("13:05"), &lists(), &events(), &json!([]));
        assert_eq!(plan.start, Some(now("13:30")));
        assert_eq!(plan.lunch, None);
        assert_eq!(plan.focus, Some((now("15:00"), now("16:00"))));
        assert_eq!(plan.placed[0].start, now("13:30"));
        // The hour's task does not fit before the review, so it goes after focus time.
        assert_eq!(plan.placed[1].start, now("16:00"));
    }

    #[test]
    fn after_six_nothing_is_placed_and_it_says_so() {
        let plan = plan(now("18:40"), &lists(), &events(), &json!([]));
        assert!(plan.placed.is_empty() && plan.focus.is_none());
        assert!(plan.lines().starts_with("Nothing is left on your day before 18:00."), "{}", plan.lines());
        assert!(plan.waiting.iter().any(|w| w == "Call the bank (no room left today)"));
    }
}
