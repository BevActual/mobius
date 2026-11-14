//! How much the agent may do in each app, as the person set it in Settings, turned into the core's standing rules.
//!
//! Each app has three levels: `follow` (the approval mode decides: Ask each time, Review changes or Auto), `always` (the person is
//! asked each time, whatever the mode) and `off` (it may not read or change anything there). Risky actions, such as
//! clicking or typing in a page, are asked about every time in every mode: the core never lets a rule cover those.
use serde_json::{Value, json};


use mobius_store::preferences::APP_ACCESS_APPS as APPS;

/// The apps a level can be set for.
pub const APP_NAMES: &[&str] = &APPS;

/// What each app reads with and changes with: capability and resource pattern.
/// A capability and, for file capabilities, the paths it covers.
pub(crate) type Grants = &'static [(&'static str, Option<&'static str>)];

pub(crate) fn capabilities(app: &str) -> (Grants, Grants) {
    match app {
        "browser" => (&[("browser.list", None), ("browser.read", None), ("web.search", None), ("web.read", None)], &[("browser.navigate", None), ("browser.interact", None)]),
        "notes" => (&[("files.read", Some("notes/*"))], &[("files.write", Some("notes/*"))]),
        "docs" => (&[("files.read", Some("docs/*"))], &[("files.write", Some("docs/*"))]),
        "slides" => (&[("files.read", Some("slides/*"))], &[("files.write", Some("slides/*"))]),
        "sheets" => (&[("sheets.read", None), ("files.read", Some("sheets/*"))], &[("sheets.write", None), ("files.write", Some("sheets/*"))]),
        "tasks" => (&[("tasks.read", None)], &[("tasks.write", None)]),
        "mail" => (&[("mail.read", None)], &[]),
        "design" => (&[("files.read", Some("designs/*"))], &[("files.write", Some("designs/*"))]),
        "research" => (&[("files.read", Some("research/*"))], &[("files.write", Some("research/*"))]),
        "reader" => (&[("files.read", Some("reading/*"))], &[("files.write", Some("reading/*"))]),
        "database" => (&[("db.read", None), ("files.read", Some("databases/*"))], &[("db.write", None), ("files.write", Some("databases/*"))]),
        "canvas" => (&[("files.read", Some("boards/*"))], &[("files.write", Some("boards/*"))]),
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
        let level = access.get(app).and_then(Value::as_str).unwrap_or("follow");
        let (read, write) = capabilities(app);
        let rule = |(capability, resource): &(&str, Option<&str>), effect: &str| match resource {
            Some(r) => json!({ "capability": capability, "resource": r, "effect": effect }),
            None => json!({ "capability": capability, "effect": effect }),
        };
        // A suggestion changes nothing until the person takes it (adds the event, sends the draft), so it needs no
        // asking; with the app off, it is blocked.
        let suggest: &[&str] = match app {
            "calendar" => &["calendar.suggest"],
            "mail" => &["mail.draft"],
            // Running the tests runs only the command the person chose; reading or stopping a running command
            // changes nothing it did not already do. Starting one is process.exec, asked every time.
            "code" => &["code.test", "code.output"],
            _ => &[],
        };
        for capability in suggest {
            out.push(json!({ "capability": capability, "effect": if level == "off" { "deny" } else { "allow" } }));
        }
        match level {
            "off" => out.extend(read.iter().chain(write).map(|c| rule(c, "deny"))),
            "always" => out.extend(read.iter().chain(write).map(|c| rule(c, "ask"))),
            // Following the mode adds no rule. So do the levels from before the three modes, which are read as follow.
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
        assert_eq!(rules(&mobius_store::preferences::app_access_default()), json!({ "rules": [{ "capability": "calendar.suggest", "effect": "allow" }, { "capability": "mail.draft", "effect": "allow" }, { "capability": "code.test", "effect": "allow" }, { "capability": "code.output", "effect": "allow" }] }));
        let r = rules(&json!({ "browser": "follow", "notes": "always", "tasks": "off" }));
        assert_eq!(r["rules"], json!([
            { "capability": "files.read", "resource": "notes/*", "effect": "ask" },
            { "capability": "files.write", "resource": "notes/*", "effect": "ask" },
            { "capability": "tasks.read", "effect": "deny" },
            { "capability": "tasks.write", "effect": "deny" },
            { "capability": "calendar.suggest", "effect": "allow" },
            { "capability": "mail.draft", "effect": "allow" },
            { "capability": "code.test", "effect": "allow" },
            { "capability": "code.output", "effect": "allow" },
        ]));
        let off = rules(&json!({ "browser": "follow", "notes": "follow", "tasks": "follow", "calendar": "off" }));
        assert_eq!(off["rules"][0], json!({ "capability": "calendar.suggest", "effect": "deny" }));
    }
}
