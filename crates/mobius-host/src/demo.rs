//! The demo workspace: a made-up small team's mail, calendar, notes, documents and the rest, kept in the repository
//! under `demo/` and shipped with Mobius, so every moment of the tour runs on the same data and can be run again. It
//! is opened as a profile of its own, built fresh from the seed each time it is opened or reset, so a run never
//! changes the seed.
//!
//! The seed is `workspace/`, copied as the profile's workspace (notes, tasks, calendar, docs, sheets…), and `mail/`, a
//! mail account kept on this computer (see `Mail::import_local`). In text files, `{{date:+N}}` and `{{date:-N}}`
//! become the date N days from the day it is opened (`YYYY-MM-DD`, or `YYYYMMDD` in an `.ics` file, as iCalendar
//! writes dates), so a busy week is always this week.
use std::path::Path;

use crate::mail::store::Mail;

const MAX_FILES: usize = 5000;
const TEXT: [&str; 9] = ["md", "json", "txt", "csv", "ics", "yaml", "yml", "html", "sql"];

/// Fills the profile folder `target` from the seed folder `seed`. `target` must be empty or missing.
pub fn build(seed: &Path, target: &Path) -> Result<(), String> {
    if !seed.join("workspace").is_dir() {
        return Err("The demo workspace is not part of this build.".into());
    }
    if target.exists() && std::fs::read_dir(target).map_err(|e| e.to_string())?.next().is_some() {
        return Err("The demo workspace's folder is not empty.".into());
    }
    let today = chrono::Local::now().date_naive();
    let mut count = 0;
    copy(&seed.join("workspace"), &target.join("workspace"), today, &mut count)?;
    if seed.join("mail").join("account.json").is_file() {
        Mail::import_local(target, &seed.join("mail"))?;
    }
    Ok(())
}

fn copy(from: &Path, to: &Path, today: chrono::NaiveDate, count: &mut usize) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        *count += 1;
        if *count > MAX_FILES {
            return Err("The demo workspace has too many files.".into());
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy(&path, &dest, today, count)?;
        } else if kind.is_file() {
            let ext = path.extension().and_then(|x| x.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
            let text = TEXT.contains(&ext.as_str());
            let format = if ext == "ics" { "%Y%m%d" } else { "%Y-%m-%d" };
            match text.then(|| std::fs::read_to_string(&path).ok()).flatten() {
                Some(body) => std::fs::write(&dest, with_dates(&body, today, format)),
                None => std::fs::copy(&path, &dest).map(|_| ()),
            }
            .map_err(|e| e.to_string())?;
        }
        // Links are left out: the seed is plain files.
    }
    Ok(())
}

/// `{{date:+N}}` and `{{date:-N}}` written as the date N days from `today`, in `format`.
fn with_dates(text: &str, today: chrono::NaiveDate, format: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("{{date:") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 7..];
        let parsed = after.find("}}").and_then(|end| after[..end].trim().parse::<i64>().ok().map(|n| (n, end)));
        match parsed {
            Some((n, end)) if n.abs() <= 3660 => {
                out.push_str(&(today + chrono::Duration::days(n)).format(format).to_string());
                rest = &after[end + 2..];
            }
            _ => {
                out.push_str("{{date:");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_written_from_the_day_it_is_opened() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 14).unwrap();
        assert_eq!(with_dates("due {{date:+1}}, held {{date:-3}}T09:00, {{date:x}} {{date:+2", today, "%Y-%m-%d"), "due 2026-11-15, held 2026-11-11T09:00, {{date:x}} {{date:+2");
        assert_eq!(with_dates("DTSTART:{{date:-3}}T090000", today, "%Y%m%d"), "DTSTART:20261111T090000");
    }

    #[test]
    fn the_seed_is_copied_with_its_dates_and_its_mail_made_into_a_local_account() {
        let seed = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(seed.path().join("workspace/tasks")).unwrap();
        std::fs::create_dir_all(seed.path().join("mail/inbox")).unwrap();
        std::fs::write(seed.path().join("workspace/tasks/Launch.md"), "# Launch\n\n- [ ] Book the venue 📅 {{date:+2}}\n").unwrap();
        std::fs::write(seed.path().join("workspace/photo.jpg"), [0xff, 0xd8, 0x7b, 0x7b]).unwrap();
        std::fs::write(seed.path().join("workspace/team.ics"), "DTSTART:{{date:+2}}T090000").unwrap();
        std::fs::write(seed.path().join("mail/account.json"), r#"{"name":"Ana","email":"ana@northway.example"}"#).unwrap();
        std::fs::write(seed.path().join("mail/inbox/1.eml"), "From: Sam <sam@northway.example>\r\nSubject: Hi\r\nDate: Mon, 09 Nov 2026 09:10:00 +0000\r\n\r\nHello\r\n").unwrap();
        let target = tempfile::tempdir().unwrap();
        let profile = target.path().join("demo");
        build(seed.path(), &profile).unwrap();
        let due = (chrono::Local::now().date_naive() + chrono::Duration::days(2)).format("%Y-%m-%d").to_string();
        assert_eq!(std::fs::read_to_string(profile.join("workspace/tasks/Launch.md")).unwrap(), format!("# Launch\n\n- [ ] Book the venue 📅 {due}\n"));
        assert_eq!(std::fs::read(profile.join("workspace/photo.jpg")).unwrap(), vec![0xff, 0xd8, 0x7b, 0x7b]);
        assert_eq!(std::fs::read_to_string(profile.join("workspace/team.ics")).unwrap(), format!("DTSTART:{}T090000", due.replace('-', "")));
        assert!(profile.join("mail/mail.json").is_file());
        assert!(build(seed.path(), &profile).is_err(), "never over a profile already there");
        assert!(build(target.path().join("nothing").as_path(), &target.path().join("other")).is_err());
    }
}
