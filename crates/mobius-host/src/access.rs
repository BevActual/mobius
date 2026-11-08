//! How much the agent may do in each app, as the person set it in Settings, turned into the core's standing rules.
//!
//! Each app has four levels: `off` (it may not read or change anything there), `ask` (it asks, the usual), `read` (it
//! may read without asking) and `act` (it may read and change without asking). Risky actions, such as clicking or typing
//! in a page, are still asked about every time: the core never lets a rule cover those.
use serde_json::{Value, json};


use mobius_store::preferences::APP_ACCESS_APPS as APPS;

/// What each app reads with and changes with: capability and resource pattern.
/// A capability and, for file capabilities, the paths it covers.
type Grants = &'static [(&'static str, Option<&'static str>)];

fn capabilities(app: &str) -> (Grants, Grants) {
    match app {
        "browser" => (&[("browser.list", None), ("browser.read", None), ("web.search", None), ("web.read", None)], &[("browser.navigate", None), ("browser.interact", None)]),
        "notes" => (&[("files.read", Some("notes/*"))], &[("files.write", Some("notes/*"))]),
        "docs" => (&[("files.read", Some("docs/*"))], &[("files.write", Some("docs/*"))]),
        "slides" => (&[("files.read", Some("slides/*"))], &[("files.write", Some("slides/*"))]),
        "sheets" => (&[("sheets.read", None), ("files.read", Some("sheets/*"))], &[("sheets.write", None), ("files.write", Some("sheets/*"))]),
        "tasks" => (&[("tasks.read", None)], &[("tasks.write", None)]),
        "mail" => (&[("mail.read", None)], &[]),
        "design" => (&[("files.read", Some("designs/*"))], &[("files.write", Some("designs/*"))]),
        "photo" => (&[("files.read", Some("photos/*"))], &[("files.write", Some("photos/*"))]),
        "studio" => (&[("files.read", Some("studio/*"))], &[("files.write", Some("studio/*"))]),
        "video" => (&[("files.read", Some("video/*"))], &[("files.write", Some("video/*"))]),
        "skills" => (&[("skills.read", None), ("files.read", Some("skills/*"))], &[("files.write", Some("skills/*"))]),
        "code" => (&[("files.read", Some("code/*"))], &[("files.write", Some("code/*"))]),
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
        // A suggestion changes nothing until the person takes it (adds the event, sends the draft), so it needs no
        // asking; with the app off, it is blocked.
        let suggest = match app {
            "calendar" => Some("calendar.suggest"),
            "mail" => Some("mail.draft"),
            // Running the tests runs only the command the person chose.
            "code" => Some("code.test"),
            _ => None,
        };
        if let Some(capability) = suggest {
            out.push(json!({ "capability": capability, "effect": if level == "off" { "deny" } else { "allow" } }));
        }
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
        assert_eq!(rules(&mobius_store::preferences::app_access_default()), json!({ "rules": [{ "capability": "calendar.suggest", "effect": "allow" }, { "capability": "mail.draft", "effect": "allow" }, { "capability": "code.test", "effect": "allow" }] }));
        let r = rules(&json!({ "browser": "read", "notes": "act", "tasks": "off" }));
        assert_eq!(r["rules"], json!([
            { "capability": "browser.list", "effect": "allow" },
            { "capability": "browser.read", "effect": "allow" },
            { "capability": "web.search", "effect": "allow" },
            { "capability": "web.read", "effect": "allow" },
            { "capability": "files.read", "resource": "notes/*", "effect": "allow" },
            { "capability": "files.write", "resource": "notes/*", "effect": "allow" },
            { "capability": "tasks.read", "effect": "deny" },
            { "capability": "tasks.write", "effect": "deny" },
            { "capability": "calendar.suggest", "effect": "allow" },
            { "capability": "mail.draft", "effect": "allow" },
            { "capability": "code.test", "effect": "allow" },
        ]));
        let off = rules(&json!({ "browser": "ask", "notes": "ask", "tasks": "ask", "calendar": "off" }));
        assert_eq!(off["rules"][0], json!({ "capability": "calendar.suggest", "effect": "deny" }));
    }
}
