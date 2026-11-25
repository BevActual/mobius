//! Tasks as CalDAV servers keep them: one `VTODO` per task (RFC 5545), read into a [`RemoteTask`] and written back.
//!
//! What maps: the words (`SUMMARY`), done (`STATUS:COMPLETED`), the due date and time (`DUE`), the day it is planned for (`DTSTART`, or
//! `X-MOBIUS-WHEN:SOMEDAY`), the day it was done (`COMPLETED`), a repeat Mobius knows
//! (`RRULE`: every day, weekday, week, month or year), the flag (`PRIORITY` 1 to 4, the high ones), notes
//! (`DESCRIPTION`) and the task it is under (`RELATED-TO`). Everything else in a task, such as categories, alarms or a
//! repeat Mobius can't show, is kept as it was when a change is written back.
use chrono::Utc;

use crate::calendar::{When, escape, fold, parse_when, split_line, unescape, unfold};
use crate::tasks::{RemoteTask, Task};

/// One task read from a server, with what orders it in its list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Todo {
    pub uid: String,
    pub task: RemoteTask,
    /// Apple's sort order when there is one, then when it was made.
    pub order: (Option<i64>, String),
}

fn repeat_of(rule: &str) -> Option<&'static str> {
    let mut freq = "";
    let mut by_day = "";
    for part in rule.split(';') {
        match part.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v)) {
            Some((k, v)) if k == "FREQ" => freq = v,
            Some((k, v)) if k == "INTERVAL" && v != "1" => return None,
            Some((k, v)) if k == "BYDAY" => by_day = v,
            Some((k, _)) if k == "COUNT" || k == "UNTIL" || k.starts_with("BY") => return None,
            _ => {}
        }
    }
    match (freq.to_ascii_uppercase().as_str(), by_day.to_ascii_uppercase().as_str()) {
        ("DAILY", "") => Some("day"),
        ("WEEKLY", "MO,TU,WE,TH,FR") => Some("weekday"),
        ("WEEKLY", "") => Some("week"),
        ("MONTHLY", "") => Some("month"),
        ("YEARLY", "") => Some("year"),
        _ => None,
    }
}

fn rule_of(repeat: &str) -> Option<&'static str> {
    match repeat {
        "day" => Some("FREQ=DAILY"),
        "weekday" => Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
        "week" => Some("FREQ=WEEKLY"),
        "month" => Some("FREQ=MONTHLY"),
        "year" => Some("FREQ=YEARLY"),
        _ => None,
    }
}

/// Is this `RELATED-TO` the task's parent (the default relation)?
fn is_parent(params: &[(String, String)]) -> bool {
    params.iter().find(|(k, _)| k == "RELTYPE").is_none_or(|(_, v)| v.eq_ignore_ascii_case("PARENT"))
}

/// The tasks in a calendar object (usually one).
pub fn todos(text: &str) -> Vec<Todo> {
    let mut out = Vec::new();
    let mut current: Option<(Todo, Option<String>)> = None;
    let mut depth = 0;
    for line in unfold(text) {
        let Some((name, params, value)) = split_line(&line) else { continue };
        match (name.as_str(), value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VTODO") if current.is_none() => {
                let task = Task { text: String::new(), done: false, due: None, time: None, repeat: None, flagged: false, start: None, done_on: None, id: None };
                current = Some((Todo { uid: String::new(), task: RemoteTask { task, notes: String::new(), parent: None }, order: (None, String::new()) }, None));
                depth = 0;
                continue;
            }
            ("BEGIN", _) if current.is_some() => depth += 1,
            ("END", "VTODO") if depth == 0 => {
                if let Some((mut todo, created)) = current.take() {
                    todo.order.1 = created.unwrap_or_default();
                    if !todo.uid.is_empty() {
                        out.push(todo);
                    }
                }
                continue;
            }
            ("END", _) if current.is_some() => depth -= 1,
            _ => {}
        }
        let Some((todo, created)) = current.as_mut() else { continue };
        if depth > 0 {
            continue;
        }
        let t = &mut todo.task;
        match name.as_str() {
            "UID" => todo.uid = value.trim().to_owned(),
            "SUMMARY" => t.task.text = unescape(&value).replace(['\n', '\r'], " ").trim().to_owned(),
            "STATUS" => t.task.done = t.task.done || value.trim().eq_ignore_ascii_case("COMPLETED"),
            "COMPLETED" => {
                t.task.done = true;
                let day = value.trim();
                t.task.done_on = (day.len() >= 8).then(|| format!("{}-{}-{}", &day[..4], &day[4..6], &day[6..8])).filter(|d| crate::tasks::is_date(d));
            }
            // When the person plans to do it: a start day, or Mobius's own Someday.
            "DTSTART" => {
                if let Some(w) = parse_when(&params, &value) {
                    t.task.start.get_or_insert_with(|| w.moment().format("%Y-%m-%d").to_string());
                }
            }
            "X-MOBIUS-WHEN" if value.trim().eq_ignore_ascii_case("SOMEDAY") => t.task.start = Some(crate::tasks::SOMEDAY.into()),
            "DUE" => match parse_when(&params, &value) {
                Some(When::Day(d)) => t.task.due = Some(d.format("%Y-%m-%d").to_string()),
                Some(When::At(at)) => {
                    t.task.due = Some(at.format("%Y-%m-%d").to_string());
                    t.task.time = Some(at.format("%H:%M").to_string());
                }
                None => {}
            },
            "RRULE" => t.task.repeat = repeat_of(&value).map(str::to_owned),
            "PRIORITY" => t.task.flagged = value.trim().parse::<u8>().is_ok_and(|p| (1..=4).contains(&p)),
            "DESCRIPTION" => t.notes = unescape(&value).trim().to_owned(),
            "RELATED-TO" if is_parent(&params) => t.parent = Some(value.trim().to_owned()).filter(|p| !p.is_empty()),
            "X-APPLE-SORT-ORDER" => todo.order.0 = value.trim().parse().ok(),
            "CREATED" => *created = Some(value.trim().to_owned()),
            _ => {}
        }
    }
    // A repeating task stays open: ticking it off moves it on.
    for todo in &mut out {
        if todo.task.task.repeat.is_some() {
            todo.task.task.done = false;
        }
    }
    out
}

fn stamp() -> String {
    Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
}

/// The lines Mobius writes for a task, inside its `VTODO`.
fn own_lines(task: &RemoteTask, keep_rule: Option<&str>) -> Vec<String> {
    let t = &task.task;
    let mut lines = vec![format!("SUMMARY:{}", escape(&t.text))];
    if t.done {
        lines.push("STATUS:COMPLETED".into());
        let when = t.done_on.as_ref().map_or_else(stamp, |d| format!("{}T120000Z", d.replace('-', "")));
        lines.push(format!("COMPLETED:{when}"));
        lines.push("PERCENT-COMPLETE:100".into());
    } else {
        lines.push("STATUS:NEEDS-ACTION".into());
    }
    if let Some(due) = &t.due {
        let day = due.replace('-', "");
        match &t.time {
            Some(time) => lines.push(format!("DUE:{day}T{}00", time.replace(':', ""))),
            None => lines.push(format!("DUE;VALUE=DATE:{day}")),
        }
    }
    match t.start.as_deref() {
        Some(crate::tasks::SOMEDAY) => lines.push("X-MOBIUS-WHEN:SOMEDAY".into()),
        Some(day) => lines.push(format!("DTSTART;VALUE=DATE:{}", day.replace('-', ""))),
        None => {}
    }
    match t.repeat.as_deref().and_then(rule_of) {
        Some(rule) => lines.push(format!("RRULE:{rule}")),
        None => lines.extend(keep_rule.map(|r| format!("RRULE:{r}"))),
    }
    if t.flagged {
        lines.push("PRIORITY:1".into());
    }
    if !task.notes.trim().is_empty() {
        lines.push(format!("DESCRIPTION:{}", escape(task.notes.trim())));
    }
    if let Some(parent) = &task.parent {
        lines.push(format!("RELATED-TO;RELTYPE=PARENT:{parent}"));
    }
    lines.push(format!("LAST-MODIFIED:{}", stamp()));
    lines.push(format!("DTSTAMP:{}", stamp()));
    lines
}

/// The calendar object to send for a task: `existing` (what the server had) with Mobius's part of the task replaced and
/// everything else kept, or a new one.
pub fn todo_ics(existing: Option<&str>, uid: &str, task: &RemoteTask) -> String {
    const OWN: [&str; 13] = ["SUMMARY", "STATUS", "COMPLETED", "PERCENT-COMPLETE", "DUE", "DTSTART", "X-MOBIUS-WHEN", "RRULE", "PRIORITY", "DESCRIPTION", "RELATED-TO", "LAST-MODIFIED", "DTSTAMP"];
    let Some(existing) = existing.filter(|e| todos(e).iter().any(|t| t.uid == uid)) else {
        let mut lines = vec!["BEGIN:VCALENDAR".to_owned(), "VERSION:2.0".into(), "PRODID:-//Mobius//Tasks//EN".into(), "BEGIN:VTODO".into(), format!("UID:{uid}"), format!("CREATED:{}", stamp())];
        lines.extend(own_lines(task, None));
        lines.extend(["END:VTODO".to_owned(), "END:VCALENDAR".into()]);
        return lines.iter().map(|l| fold(l)).collect::<Vec<_>>().join("\r\n") + "\r\n";
    };
    let mut out = Vec::new();
    let (mut inside, mut depth, mut this) = (false, 0, false);
    let mut block: Vec<String> = Vec::new();
    for line in unfold(existing) {
        let parts = split_line(&line);
        let (name, upper) = parts.as_ref().map_or((String::new(), String::new()), |(n, _, v)| (n.clone(), v.to_ascii_uppercase()));
        if !inside {
            if name == "BEGIN" && upper == "VTODO" {
                (inside, depth, this) = (true, 0, false);
                block = vec![line];
            } else {
                out.push(line);
            }
            continue;
        }
        if name == "BEGIN" {
            depth += 1;
        } else if name == "END" && upper == "VTODO" && depth == 0 {
            inside = false;
            if this {
                // Keep a repeat Mobius can't show, unless the task now has one of its own.
                let rule = block.iter().filter_map(|l| split_line(l)).find(|(n, _, _)| n == "RRULE").map(|(_, _, v)| v).filter(|r| repeat_of(r).is_none());
                // Only the task's own lines are Mobius's: an alarm inside it has a DESCRIPTION of its own.
                let mut level = 0;
                let kept: Vec<String> = block
                    .into_iter()
                    .filter(|l| match split_line(l) {
                        Some((n, _, _)) if n == "BEGIN" => {
                            level += 1;
                            true
                        }
                        Some((n, _, _)) if n == "END" => {
                            level -= 1;
                            true
                        }
                        // The block starts with the task's own BEGIN, so its lines are at level 1.
                        Some((n, p, _)) if level == 1 && n == "RELATED-TO" => !is_parent(&p),
                        Some((n, _, _)) if level == 1 => !OWN.contains(&n.as_str()),
                        _ => true,
                    })
                    .collect();
                out.extend(kept);
                out.extend(own_lines(task, rule.as_deref()));
            } else {
                out.extend(block);
            }
            block = Vec::new();
            out.push(line);
            continue;
        } else if name == "END" {
            depth -= 1;
        } else if depth == 0 && name == "UID" && parts.as_ref().is_some_and(|(_, _, v)| v.trim() == uid) {
            this = true;
        }
        block.push(line);
    }
    out.iter().map(|l| fold(l)).collect::<Vec<_>>().join("\r\n") + "\r\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    const APPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iOS 18//EN\r\nBEGIN:VTODO\r\nUID:ABC-1\r\nCREATED:20261101T090000Z\r\nSUMMARY:Call the plumber\\, today\r\nDUE;VALUE=DATE:20261120\r\nPRIORITY:1\r\nCATEGORIES:Home\r\nDESCRIPTION:Ask about\\nthe tap\r\nX-APPLE-SORT-ORDER:12\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";

    #[test]
    fn a_server_task_reads_with_its_date_flag_notes_and_order() {
        let t = &todos(APPLE)[0];
        assert_eq!(t.uid, "ABC-1");
        assert_eq!(t.task.task.text, "Call the plumber, today");
        assert_eq!((t.task.task.due.as_deref(), t.task.task.flagged, t.task.task.done), (Some("2026-11-20"), true, false));
        assert_eq!(t.task.notes, "Ask about\nthe tap", "the alarm's description is not the task's");
        assert_eq!(t.order, (Some(12), "20261101T090000Z".to_owned()));
        let sub = todos("BEGIN:VTODO\nUID:2\nSUMMARY:Buy washer\nRELATED-TO:ABC-1\nSTATUS:COMPLETED\nDUE:20261120T093000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\nEND:VTODO\n");
        assert_eq!(sub[0].task.parent.as_deref(), Some("ABC-1"));
        assert_eq!((sub[0].task.task.time.as_deref(), sub[0].task.task.repeat.as_deref()), (Some("09:30"), Some("weekday")));
        assert!(!sub[0].task.task.done, "a repeating task stays open");
        assert_eq!(repeat_of("FREQ=WEEKLY;INTERVAL=2"), None);
    }

    #[test]
    fn a_change_keeps_what_mobius_does_not_show() {
        let mut task = todos(APPLE)[0].task.clone();
        task.task.done = true;
        task.task.flagged = false;
        task.task.due = Some("2026-11-21".into());
        task.task.time = Some("14:00".into());
        let text = todo_ics(Some(APPLE), "ABC-1", &task);
        assert!(text.contains("CATEGORIES:Home") && text.contains("TRIGGER:-PT15M") && text.contains("DESCRIPTION:Reminder"), "{text}");
        assert!(text.contains("STATUS:COMPLETED") && text.contains("DUE:20261121T140000") && !text.contains("PRIORITY"), "{text}");
        assert!(!text.contains("VALUE=DATE:20261120"));
        let back = &todos(&text)[0];
        assert_eq!(back.task.task.text, "Call the plumber, today");
        assert_eq!(back.task.notes, "Ask about\nthe tap");
        assert!(back.task.task.done);

        let fresh = todo_ics(None, "new@mobius", &RemoteTask { task: Task { text: "Water plants".into(), done: false, due: None, time: None, repeat: Some("week".into()), flagged: true, start: None, done_on: None, id: None }, notes: String::new(), parent: Some("ABC-1".into()) });
        let read = &todos(&fresh)[0];
        assert_eq!((read.uid.as_str(), read.task.task.repeat.as_deref(), read.task.task.flagged, read.task.parent.as_deref()), ("new@mobius", Some("week"), true, Some("ABC-1")));
        // A repeat Mobius can't show stays when the task is changed.
        let odd = "BEGIN:VTODO\r\nUID:3\r\nSUMMARY:Rent\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1\r\nEND:VTODO\r\n";
        let mut rent = todos(odd)[0].task.clone();
        rent.task.text = "Pay rent".into();
        assert!(todo_ics(Some(odd), "3", &rent).contains("RRULE:FREQ=MONTHLY;BYMONTHDAY=1"));
    }

    #[test]
    fn when_someday_and_the_done_day_go_to_the_server_and_back() {
        let mut task = todos(APPLE)[0].task.clone();
        task.task.start = Some("2026-11-18".into());
        let text = todo_ics(Some(APPLE), "ABC-1", &task);
        assert!(text.contains("DTSTART;VALUE=DATE:20261118"), "{text}");
        assert_eq!(todos(&text)[0].task.task.start.as_deref(), Some("2026-11-18"));
        task.task.start = Some("someday".into());
        let text = todo_ics(Some(&text), "ABC-1", &task);
        assert!(text.contains("X-MOBIUS-WHEN:SOMEDAY") && !text.contains("DTSTART"), "{text}");
        assert_eq!(todos(&text)[0].task.task.start.as_deref(), Some("someday"));
        task.task.done = true;
        task.task.done_on = Some("2026-11-25".into());
        let text = todo_ics(Some(&text), "ABC-1", &task);
        assert!(text.contains("COMPLETED:20261125T120000Z"), "{text}");
        assert_eq!(todos(&text)[0].task.task.done_on.as_deref(), Some("2026-11-25"));
    }
}
