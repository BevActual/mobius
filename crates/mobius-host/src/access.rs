//! How much the agent may do in each app, as the person set it in Settings, turned into the core's standing rules.
//!
//! Each app has four levels: `off` (it may not read or change anything there), `ask` (it asks, the usual), `read` (it
//! may read without asking) and `act` (it may read and change without asking). Risky actions, such as clicking or typing
//! in a page, are still asked about every time: the core never lets a rule cover those.
use serde_json::{Value, json};


use mobius_store::preferences::APP_ACCESS_APPS as APPS;

/// What each app reads with and changes with: capability and resource pattern.
fn capabilities(app: &str) -> (&'static [(&'static str, Option<&'static str>)], &'static [(&'static str, Option<&'static str>)]) {
    match app {
        "browser" => (&[("browser.list", None), ("browser.read", None)], &[("browser.navigate", None), ("browser.interact", None)]),
        "notes" => (&[("files.read", Some("notes/*"))], &[("files.write", Some("notes/*"))]),
        "tasks" => (&[("tasks.read", None)], &[("tasks.write", None)]),
        "calendar" => (&[("calendar.read", None), ("files.read", Some("calendar/*"))], &[("calendar.write", None), ("files.write", Some("calendar/*"))]),
        _ => (&[], &[]),
    }
}

/// The rules for the core. Anything not understood counts as `ask`, which adds no rule.
pub fn rules(access: &Value) -> Value {
    let mut out = Vec::new();
    for app in APPS {
        let level = access.get(app).and_then(Value::as_str).unwrap_or("ask");
        let (read, write) = capabilities(app);
        let rule = |(capability, resource): &(&str, Option<&str>), effect: &str| match resource {
            Some(r) => json!({ "capability": capability, "resource": r, "effect": effect }),
            None => json!({ "capability": capability, "effect": effect }),
        };
        match level {
            "off" => out.extend(read.iter().chain(write).map(|c| rule(c, "deny"))),
            "read" => out.extend(read.iter().map(|c| rule(c, "allow"))),
            "act" => out.extend(read.iter().chain(write).map(|c| rule(c, "allow"))),
            _ => {}
        }
    }
    json!({ "rules": out })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_level_becomes_the_rules_it_says() {
        assert_eq!(rules(&mobius_store::preferences::app_access_default()), json!({ "rules": [] }));
        let r = rules(&json!({ "browser": "read", "notes": "act", "tasks": "off" }));
        assert_eq!(r["rules"], json!([
            { "capability": "browser.list", "effect": "allow" },
            { "capability": "browser.read", "effect": "allow" },
            { "capability": "files.read", "resource": "notes/*", "effect": "allow" },
            { "capability": "files.write", "resource": "notes/*", "effect": "allow" },
            { "capability": "tasks.read", "effect": "deny" },
            { "capability": "tasks.write", "effect": "deny" },
        ]));
    }
}
