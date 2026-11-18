//! Outlook.com and Microsoft 365 calendars, through Microsoft Graph (docs/reference/calendar-sign-in.md). Microsoft
//! offers no CalDAV, so `calendar_accounts` mirrors a Microsoft account's calendars with these calls instead:
//!
//! - The sign-in is OneDrive's (`onedrive::Service`, PKCE on `http://localhost`), asking for the calendars instead of
//!   the files. The tokens stay in the system secret store and are only ever sent to Microsoft.
//! - Reading asks Graph for each calendar's **calendar view** over the mirrored span: every occurrence of a repeating
//!   event comes as its own event, already worked out by Microsoft, in UTC, with plain-text notes. Each is mirrored
//!   under its Graph id, so a change to one occurrence changes only that one, as in Outlook.
//! - A change goes to Graph first: a new event is POSTed (a repeating one with its pattern), a changed one PATCHed
//!   and a removed one DELETEd, each with the version Mobius read (`If-Match`), so a change made in Outlook meanwhile
//!   is never overwritten.
use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use mobius_workspace::calendar::{Event, Person, Repeat, When};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};

use crate::calendar_sign_in::Found;
use crate::dropbox::read_body;

type Res<T> = Result<T, String>;
/// Each event's Graph id and version, by the id Mobius keeps it under.
pub type Items = BTreeMap<String, (String, String)>;

/// What the calendar sign-in asks Microsoft for.
pub const SCOPES: &str = "offline_access User.Read Calendars.ReadWrite";
pub const NOT_SET_UP: &str = "Outlook calendars aren't set up in this build of Mobius yet. Until they are, an Outlook calendar can be subscribed to with its ICS link, from Outlook's calendar settings under Shared calendars.";
pub const EXPIRED: &str = "The Microsoft sign-in has ended. Choose Sign in again.";
pub const CHANGED: &str = "That event was changed in Outlook meanwhile. Refresh the calendar and try again.";
const MAX_JSON: u64 = 8 * 1024 * 1024;
/// The most events one calendar mirrors.
const MAX_EVENTS: usize = 5_000;
const MAX_CALENDARS: usize = 30;
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');
const PREFER: &str = r#"outlook.timezone="UTC", outlook.body-content-type="text""#;
const DAYS: [&str; 7] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/// The HTTP client for Graph.
pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(60)))
        .user_agent(format!("Mobius/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// One signed-in account's calendars, at `graph` (`https://graph.microsoft.com/v1.0`).
pub struct Graph<'a> {
    pub http: &'a ureq::Agent,
    pub graph: String,
    pub token: &'a str,
}

struct Reply {
    status: u16,
    etag: Option<String>,
    json: Value,
}

/// Graph's error code and message, for a status Mobius has no words of its own for.
fn failed(reply: &Reply) -> String {
    match reply.status {
        401 => EXPIRED.into(),
        403 => "Microsoft did not let Mobius do that to this calendar.".into(),
        404 => "That is not in the calendar any more. Refresh it.".into(),
        412 => CHANGED.into(),
        429 | 503 => "Microsoft is busy. Mobius tries again later.".into(),
        s => {
            let message = reply.json.pointer("/error/message").and_then(Value::as_str).unwrap_or("").chars().take(200).collect::<String>();
            if message.is_empty() { format!("Microsoft answered {s}.") } else { format!("Microsoft answered {s}: {message}") }
        }
    }
}

/// UTC as Graph writes it (`2026-11-10T09:00:00.0000000`), to local time.
fn local(text: &str) -> Option<NaiveDateTime> {
    let text = text.split('.').next()?;
    let utc = NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").ok()?;
    Some(Utc.from_utc_datetime(&utc).with_timezone(&Local).naive_local())
}

fn utc(t: NaiveDateTime) -> String {
    let at = Local.from_local_datetime(&t).earliest().map_or(t, |l| l.with_timezone(&Utc).naive_utc());
    at.format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Graph's start or end, for an event that is all day or not.
fn when(v: &Value, all_day: bool) -> Option<When> {
    let text = v.get("dateTime").and_then(Value::as_str)?;
    if all_day {
        // An all-day event is the same days everywhere: its date as written.
        return NaiveDate::parse_from_str(text.get(..10)?, "%Y-%m-%d").ok().map(When::Day);
    }
    local(text).map(When::At)
}

fn graph_when(w: When) -> Value {
    match w {
        When::Day(d) => json!({ "dateTime": format!("{}T00:00:00", d.format("%Y-%m-%d")), "timeZone": "UTC" }),
        When::At(t) => json!({ "dateTime": utc(t), "timeZone": "UTC" }),
    }
}

/// An event from Graph, mirrored under its Graph id.
pub fn event_of(e: &Value) -> Option<Event> {
    let id = e.get("id").and_then(Value::as_str).filter(|i| !i.is_empty())?;
    let all_day = e.get("isAllDay").and_then(Value::as_bool).unwrap_or(false);
    let start = when(e.get("start")?, all_day)?;
    let end = when(e.get("end")?, all_day).filter(|end| *end > start).unwrap_or(start);
    let text = |p: &str| e.pointer(p).and_then(Value::as_str).unwrap_or("").trim().to_owned();
    // Who is invited, and who sent it, as Graph has them. Kept as read: a change to them is not written back to Graph.
    let person = |p: &Value, status: &str| {
        let email = p.pointer("/emailAddress/address").and_then(Value::as_str).unwrap_or("").trim();
        (!email.is_empty()).then(|| Person { name: p.pointer("/emailAddress/name").and_then(Value::as_str).unwrap_or("").trim().to_owned(), email: email.to_owned(), status: status.to_owned(), params: Vec::new() })
    };
    let answer = |a: &Value| match a.pointer("/status/response").and_then(Value::as_str).unwrap_or("") {
        "accepted" | "organizer" => "accepted",
        "declined" => "declined",
        "tentativelyAccepted" => "tentative",
        _ => "needs-action",
    };
    let attendees = e.get("attendees").and_then(Value::as_array).map(|list| list.iter().filter_map(|a| person(a, answer(a))).collect()).unwrap_or_default();
    let organizer = e.get("organizer").and_then(|o| person(o, ""));
    Some(Event { uid: id.to_owned(), title: text("/subject"), start, end, location: text("/location/displayName"), notes: text("/body/content"), repeat: None, attendees, organizer, extra: Vec::new() })
}

/// A repetition as Graph writes it, from where the event starts. None for one Graph can't take.
fn recurrence(r: &Repeat, start: When) -> Option<Value> {
    let first = start.moment().date();
    let day = |d: NaiveDate| DAYS[d.weekday().num_days_from_monday() as usize];
    let pattern = match r.freq.as_str() {
        "DAILY" => json!({ "type": "daily", "interval": r.interval }),
        "WEEKLY" => {
            let days: Vec<&str> = if r.by_day.is_empty() { vec![day(first)] } else { r.by_day.iter().filter_map(|d| DAYS.get(*d as usize)).copied().collect() };
            json!({ "type": "weekly", "interval": r.interval, "daysOfWeek": days, "firstDayOfWeek": "monday" })
        }
        "MONTHLY" => json!({ "type": "absoluteMonthly", "interval": r.interval, "dayOfMonth": first.day() }),
        "YEARLY" => json!({ "type": "absoluteYearly", "interval": r.interval, "dayOfMonth": first.day(), "month": first.month() }),
        _ => return None,
    };
    let start_date = first.format("%Y-%m-%d").to_string();
    let range = match (r.until, r.count) {
        (Some(until), _) => json!({ "type": "endDate", "startDate": start_date, "endDate": until.format("%Y-%m-%d").to_string() }),
        (None, Some(n)) => json!({ "type": "numbered", "startDate": start_date, "numberOfOccurrences": n }),
        (None, None) => json!({ "type": "noEnd", "startDate": start_date }),
    };
    Some(json!({ "pattern": pattern, "range": range }))
}

/// What Graph is sent for an event. `new` adds its repetition; a change to one occurrence leaves the series alone.
pub fn body_of(e: &Event, new: bool) -> Value {
    let mut body = json!({
        "subject": e.title,
        "isAllDay": matches!(e.start, When::Day(_)),
        "start": graph_when(e.start),
        "end": graph_when(if e.end > e.start { e.end } else { match e.start { When::Day(d) => When::Day(d + chrono::Duration::days(1)), When::At(t) => When::At(t + chrono::Duration::hours(1)) } }),
        "location": { "displayName": e.location },
        "body": { "contentType": "text", "content": e.notes },
    });
    if new && let Some(r) = e.repeat.as_ref().and_then(|r| recurrence(r, e.start)) {
        body["recurrence"] = r;
    }
    body
}

impl Graph<'_> {
    fn call(&self, method: &str, url: &str, if_match: Option<&str>, body: Option<&Value>) -> Res<Reply> {
        // Only ever to Microsoft's Graph (or the pretend one in tests): a next page must be there too.
        if !url.starts_with(&self.graph) {
            return Err("Microsoft sent Mobius somewhere else.".into());
        }
        let mut builder = ureq::http::Request::builder().method(method).uri(url).header("Authorization", format!("Bearer {}", self.token)).header("Prefer", PREFER);
        if let Some(tag) = if_match.filter(|t| !t.is_empty()) {
            builder = builder.header("If-Match", tag);
        }
        let text = body.map(Value::to_string).unwrap_or_default();
        if body.is_some() {
            builder = builder.header("Content-Type", "application/json");
        }
        let request = builder.body(text).map_err(|e| e.to_string())?;
        let response = self.http.run(request).map_err(|e| format!("Could not reach Microsoft: {e}"))?;
        let (status, headers, bytes) = read_body(response, MAX_JSON)?;
        let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let etag = json.get("@odata.etag").and_then(Value::as_str).map(str::to_owned).or_else(|| headers.get("etag").cloned());
        Ok(Reply { status, etag, json })
    }

    /// The account's calendars: its default one first.
    pub fn calendars(&self) -> Res<Vec<Found>> {
        let reply = self.call("GET", &format!("{}/me/calendars?$top=100&$select=id,name,canEdit,isDefaultCalendar", self.graph), None, None)?;
        if reply.status != 200 {
            return Err(failed(&reply));
        }
        let mut found: Vec<(bool, Found)> = reply
            .json
            .get("value")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|c| {
                let id = c.get("id").and_then(Value::as_str).filter(|i| !i.is_empty() && i.len() <= 400)?;
                let name = c.get("name").and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or("Calendar");
                let default = c.get("isDefaultCalendar").and_then(Value::as_bool).unwrap_or(false);
                Some((default, Found { href: format!("{}/me/calendars/{}", self.graph, utf8_percent_encode(id, SEGMENT)), name: name.to_owned(), read_only: !c.get("canEdit").and_then(Value::as_bool).unwrap_or(false) }))
            })
            .collect();
        found.sort_by_key(|(default, _)| !default);
        Ok(found.into_iter().map(|(_, f)| f).take(MAX_CALENDARS).collect())
    }

    /// Every occurrence in `[from, to)` of calendar `href`, and each one's Graph id and version, by its id.
    pub fn read(&self, href: &str, from: NaiveDate, to: NaiveDate) -> Res<(Vec<Event>, Items)> {
        let mut next = Some(format!(
            "{href}/calendarView?startDateTime={}T00:00:00Z&endDateTime={}T00:00:00Z&$top=250&$select=id,subject,start,end,isAllDay,location,body,isCancelled,attendees,organizer",
            from.format("%Y-%m-%d"),
            to.format("%Y-%m-%d")
        ));
        let (mut events, mut items) = (Vec::new(), BTreeMap::new());
        while let Some(url) = next.take() {
            let reply = self.call("GET", &url, None, None)?;
            if reply.status != 200 {
                return Err(failed(&reply));
            }
            for e in reply.json.get("value").and_then(Value::as_array).into_iter().flatten() {
                if e.get("isCancelled").and_then(Value::as_bool) == Some(true) || events.len() >= MAX_EVENTS {
                    continue;
                }
                if let Some(event) = event_of(e) {
                    let tag = e.get("@odata.etag").and_then(Value::as_str).unwrap_or("").to_owned();
                    items.insert(event.uid.clone(), (event.uid.clone(), tag));
                    events.push(event);
                }
            }
            next = reply.json.get("@odata.nextLink").and_then(Value::as_str).filter(|_| events.len() < MAX_EVENTS).map(str::to_owned);
        }
        Ok((events, items))
    }

    /// Send an event to calendar `href`: a new one (`known` None) is added, a known one changed if it is still the
    /// version Mobius read. Answers its Graph id and new version.
    pub fn put(&self, href: &str, known: Option<&(String, String)>, event: &Event) -> Res<(String, String)> {
        let reply = match known {
            None => self.call("POST", &format!("{href}/events"), None, Some(&body_of(event, true)))?,
            Some((id, tag)) => self.call("PATCH", &format!("{}/me/events/{}", self.graph, utf8_percent_encode(id, SEGMENT)), Some(tag), Some(&body_of(event, false)))?,
        };
        if !matches!(reply.status, 200 | 201) {
            return Err(failed(&reply));
        }
        let id = reply.json.get("id").and_then(Value::as_str).map(str::to_owned).or_else(|| known.map(|(id, _)| id.clone())).ok_or("Microsoft did not say where the event went.")?;
        Ok((id, reply.etag.unwrap_or_default()))
    }

    pub fn delete(&self, id: &str, tag: &str) -> Res<()> {
        let reply = self.call("DELETE", &format!("{}/me/events/{}", self.graph, utf8_percent_encode(id, SEGMENT)), Some(tag), None)?;
        match reply.status {
            200 | 204 | 404 => Ok(()),
            _ => Err(failed(&reply)),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::sync::{Arc, Mutex};

    /// What the pretend Graph holds: event id → (event JSON, version), all in one calendar "work", and every request
    /// as `METHOD path if-match`.
    pub(crate) type Store = Arc<Mutex<BTreeMap<String, (Value, u32)>>>;

    /// A pretend Microsoft: its token endpoint and Graph's calendars, at `/v1.0`. Answers its address.
    pub(crate) fn graph() -> (String, Store, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let store: Store = Arc::default();
        store.lock().unwrap().insert("ev1".into(), (json!({ "subject": "Kickoff", "isAllDay": false, "start": { "dateTime": "2026-11-10T09:00:00.0000000", "timeZone": "UTC" }, "end": { "dateTime": "2026-11-10T10:00:00.0000000", "timeZone": "UTC" }, "location": { "displayName": "Room 4" }, "body": { "content": "Agenda" } }), 1));
        store.lock().unwrap().insert("ev2".into(), (json!({ "subject": "Offsite", "isAllDay": true, "start": { "dateTime": "2026-11-12T00:00:00.0000000", "timeZone": "UTC" }, "end": { "dateTime": "2026-11-14T00:00:00.0000000", "timeZone": "UTC" } }), 1));
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let (s, l, me) = (store.clone(), log.clone(), base.clone());
        std::thread::spawn(move || {
            let mut next = 10;
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
                let (mut length, mut auth, mut if_match, mut prefer) = (0, String::new(), String::new(), String::new());
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    match k.to_ascii_lowercase().as_str() {
                        "content-length" => length = v.trim().parse().unwrap(),
                        "authorization" => auth = v.trim().to_owned(),
                        "if-match" => if_match = v.trim().to_owned(),
                        "prefer" => prefer = v.trim().to_owned(),
                        _ => {}
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                l.lock().unwrap().push(format!("{method} {path} {if_match}"));
                let tagged = |id: &str, e: &Value, v: u32| {
                    let mut e = e.clone();
                    e["id"] = json!(id);
                    e["@odata.etag"] = json!(format!("W/\"{v}\""));
                    e
                };
                let path_only = path.split('?').next().unwrap_or("").to_owned();
                let (status, reply) = if path_only == "/token" {
                    (200, json!({ "access_token": "ms-a1", "refresh_token": "ms-r1", "expires_in": 3600 }))
                } else if auth != "Bearer ms-a1" {
                    (401, json!({ "error": { "code": "InvalidAuthenticationToken" } }))
                } else if path_only != "/v1.0/me" && path_only != "/v1.0/me/drive" && !prefer.contains("outlook.timezone=\"UTC\"") {
                    (400, json!({ "error": { "message": "no time zone asked for" } }))
                } else {
                    let mut st = s.lock().unwrap();
                    match (method.as_str(), path_only.as_str()) {
                        ("GET", "/v1.0/me/drive") => (404, json!({})),
                        ("GET", "/v1.0/me") => (200, json!({ "mail": "ana@example.com", "displayName": "Ana" })),
                        ("GET", "/v1.0/me/calendars") => (200, json!({ "value": [
                            { "id": "birthdays", "name": "Birthdays", "canEdit": false },
                            { "id": "work", "name": "Calendar", "canEdit": true, "isDefaultCalendar": true },
                        ] })),
                        ("GET", "/v1.0/me/calendars/work/calendarView") if path.contains("startDateTime=") => {
                            // Two pages, to follow the next link.
                            let all: Vec<Value> = st.iter().map(|(id, (e, v))| tagged(id, e, *v)).collect();
                            if path.contains("page=2") {
                                (200, json!({ "value": all[1..].to_vec() }))
                            } else {
                                (200, json!({ "value": all[..1].to_vec(), "@odata.nextLink": format!("{me}/v1.0/me/calendars/work/calendarView?startDateTime=x&page=2") }))
                            }
                        }
                        ("GET", "/v1.0/me/calendars/birthdays/calendarView") => (200, json!({ "value": [] })),
                        ("POST", "/v1.0/me/calendars/work/events") => {
                            next += 1;
                            let id = format!("ev{next}");
                            st.insert(id.clone(), (body.clone(), 1));
                            (201, tagged(&id, &body, 1))
                        }
                        ("PATCH", p) | ("DELETE", p) if p.starts_with("/v1.0/me/events/") => {
                            let id = p.trim_start_matches("/v1.0/me/events/").to_owned();
                            match st.get(&id).cloned() {
                                None => (404, json!({})),
                                Some((_, v)) if if_match != format!("W/\"{v}\"") => (412, json!({ "error": { "code": "ErrorIrresolvableConflict" } })),
                                Some((mut e, v)) if method == "PATCH" => {
                                    for (k, val) in body.as_object().unwrap() {
                                        e[k] = val.clone();
                                    }
                                    st.insert(id.clone(), (e.clone(), v + 1));
                                    (200, tagged(&id, &e, v + 1))
                                }
                                Some(_) => {
                                    st.remove(&id);
                                    (204, Value::Null)
                                }
                            }
                        }
                        _ => (404, json!({ "error": { "message": "no such thing" } })),
                    }
                };
                let text = if reply.is_null() { String::new() } else { reply.to_string() };
                let _ = write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
            }
        });
        (base, store, log)
    }

    #[test]
    fn events_go_both_ways_in_local_time() {
        let at = |d: &str| When::parse(d).unwrap();
        let e = Event { uid: "x".into(), title: "Retro".into(), start: at("2026-11-12T16:00"), end: at("2026-11-12T16:30"), location: String::new(), notes: "Bring notes".into(), repeat: Some(Repeat { freq: "WEEKLY".into(), interval: 2, count: Some(5), until: None, by_day: vec![3] }), attendees: Vec::new(), organizer: None, extra: Vec::new() };
        let body = body_of(&e, true);
        assert_eq!(body["start"]["timeZone"], "UTC");
        assert_eq!(body["recurrence"]["pattern"], json!({ "type": "weekly", "interval": 2, "daysOfWeek": ["thursday"], "firstDayOfWeek": "monday" }));
        assert_eq!(body["recurrence"]["range"], json!({ "type": "numbered", "startDate": "2026-11-12", "numberOfOccurrences": 5 }));
        assert!(body_of(&e, false).get("recurrence").is_none(), "a change leaves the series alone");
        let mut back = body.clone();
        back["id"] = json!("g1");
        let read = event_of(&back).unwrap();
        assert_eq!((read.start, read.end, read.title.as_str(), read.notes.as_str()), (e.start, e.end, "Retro", "Bring notes"), "UTC there, local here");

        let day = Event { uid: "d".into(), title: "Offsite".into(), start: When::Day(NaiveDate::from_ymd_opt(2026, 11, 12).unwrap()), end: When::Day(NaiveDate::from_ymd_opt(2026, 11, 14).unwrap()), location: String::new(), notes: String::new(), repeat: Some(Repeat { freq: "YEARLY".into(), interval: 1, count: None, until: None, by_day: Vec::new() }), attendees: Vec::new(), organizer: None, extra: Vec::new() };
        let body = body_of(&day, true);
        assert_eq!((body["isAllDay"].clone(), body["start"]["dateTime"].clone()), (json!(true), json!("2026-11-12T00:00:00")));
        assert_eq!(body["recurrence"]["pattern"], json!({ "type": "absoluteYearly", "interval": 1, "dayOfMonth": 12, "month": 11 }));
        let mut back = body;
        back["id"] = json!("g2");
        assert_eq!(event_of(&back).unwrap().end, day.end, "all-day keeps its days whatever the time zone");
    }

    #[test]
    fn attendees_and_the_organizer_are_read_with_their_answers() {
        let e = event_of(&json!({ "id": "ev", "subject": "Review", "isAllDay": false,
            "start": { "dateTime": "2026-11-10T09:00:00.0000000", "timeZone": "UTC" }, "end": { "dateTime": "2026-11-10T10:00:00.0000000", "timeZone": "UTC" },
            "organizer": { "emailAddress": { "name": "Sam Okafor", "address": "sam@northway.example" } },
            "attendees": [
                { "emailAddress": { "name": "Priya Raman", "address": "priya@northway.example" }, "status": { "response": "tentativelyAccepted" } },
                { "emailAddress": { "name": "Jo", "address": "jo@northway.example" }, "status": { "response": "none" } },
                { "emailAddress": { "name": "No address" } },
            ] })).unwrap();
        assert_eq!(e.organizer.map(|o| (o.name, o.email)), Some(("Sam Okafor".into(), "sam@northway.example".into())));
        assert_eq!(e.attendees.iter().map(|a| (a.email.as_str(), a.status.as_str())).collect::<Vec<_>>(), vec![("priya@northway.example", "tentative"), ("jo@northway.example", "needs-action")]);
    }

    #[test]
    fn a_calendar_is_read_page_by_page_and_changed_only_from_the_version_read() {
        let (base, store, log) = graph();
        let http = agent();
        let graph_at = format!("{base}/v1.0");
        let g = Graph { http: &http, graph: graph_at.clone(), token: "ms-a1" };
        let found = g.calendars().unwrap();
        assert_eq!(found.iter().map(|f| (f.name.as_str(), f.read_only)).collect::<Vec<_>>(), [("Calendar", false), ("Birthdays", true)], "the default calendar first");
        let day = |d: u32| NaiveDate::from_ymd_opt(2026, 11, d).unwrap();
        let (events, items) = g.read(&found[0].href, day(1), day(30)).unwrap();
        assert_eq!(events.len(), 2, "both pages");
        assert_eq!((events[0].title.as_str(), events[0].location.as_str(), events[0].notes.as_str()), ("Kickoff", "Room 4", "Agenda"));
        assert_eq!(events[1].start, When::Day(day(12)));
        let (id, tag) = items["ev1"].clone();
        let mut changed = events[0].clone();
        changed.title = "Project kickoff".into();
        let (_, newer) = g.put(&found[0].href, Some(&(id.clone(), tag.clone())), &changed).unwrap();
        assert_eq!(store.lock().unwrap()["ev1"].0["subject"], "Project kickoff");
        assert_eq!(g.put(&found[0].href, Some(&(id.clone(), tag)), &changed).unwrap_err(), CHANGED, "an old version is refused");
        let (made, made_tag) = g.put(&found[0].href, None, &Event { uid: "new".into(), title: "Retro".into(), ..changed.clone() }).unwrap();
        assert!(store.lock().unwrap().contains_key(&made));
        g.delete(&made, &made_tag).unwrap();
        g.delete(&id, &newer).unwrap();
        assert!(!store.lock().unwrap().contains_key("ev1"));
        assert!(log.lock().unwrap().iter().any(|l| l.starts_with("PATCH /v1.0/me/events/ev1 W/")), "{:?}", log.lock().unwrap());
        let wrong = Graph { http: &http, graph: graph_at.clone(), token: "old" };
        assert_eq!(wrong.calendars().unwrap_err(), EXPIRED);
        assert!(Graph { http: &http, graph: "https://graph.example/v1.0".into(), token: "x" }.read(&format!("{graph_at}/me/calendars/work"), day(1), day(2)).is_err(), "nowhere but Graph");
    }
}
