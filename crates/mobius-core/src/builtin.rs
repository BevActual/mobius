//! Tools every Mobius core has.
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::core::{Core, CoreError, ToolSpec};

/// An ISO 8601 UTC timestamp for a Unix time in seconds (proleptic Gregorian, after Howard Hinnant's algorithm).
pub fn iso_utc(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let in_day = unix_seconds % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", in_day / 3_600, in_day % 3_600 / 60, in_day % 60)
}

/// What clock.now says: the person's local time first, as the model plans their day by it (it once took UTC for
/// local and planned a Pacific morning as the afternoon).
fn now_json(unix_seconds: u64, local: chrono::DateTime<chrono::FixedOffset>) -> serde_json::Value {
    json!({
        "local": local.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        "weekday": local.format("%A").to_string(),
        "offset": local.format("%:z").to_string(),
        "utc": iso_utc(unix_seconds),
    })
}

pub fn register_builtin_tools(core: &mut Core) -> Result<(), CoreError> {
    core.register_tool(
        ToolSpec::new(
            "clock.now",
            "Returns the current date and time where the person is: local (their wall-clock time, with its offset from UTC), the weekday, and UTC. Plan the person's day by local, never by UTC.",
            "clock.read",
        )?,
        Box::new(|_| {
            let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "the system clock is set before 1970".to_owned())?.as_secs();
            Ok(now_json(seconds, chrono::Local::now().fixed_offset()))
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_time_is_given_where_the_person_is_with_its_weekday() {
        // 16:29 UTC on Saturday 14 November 2026 is 08:29 in the morning on the US west coast.
        let pacific = chrono::FixedOffset::west_opt(8 * 3600).unwrap();
        let at = chrono::DateTime::from_timestamp(1_794_673_740, 0).unwrap().with_timezone(&pacific);
        let said = now_json(1_794_673_740, at);
        assert_eq!(said["local"], "2026-11-14T08:29:00-08:00");
        assert_eq!(said["weekday"], "Saturday");
        assert_eq!(said["offset"], "-08:00");
        assert_eq!(said["utc"], "2026-11-14T16:29:00Z");
    }

    #[test]
    fn known_instants_format_correctly() {
        for (secs, expected) in [
            (0, "1970-01-01T00:00:00Z"),
            (86_399, "1970-01-01T23:59:59Z"),
            (951_782_400, "2000-02-29T00:00:00Z"),
            (1_700_000_000, "2023-11-14T22:13:20Z"),
            (4_102_444_800, "2100-01-01T00:00:00Z"),
            (1_709_164_800, "2024-02-29T00:00:00Z"),
            (1_709_251_200, "2024-03-01T00:00:00Z"),
            (1_735_689_599, "2024-12-31T23:59:59Z"),
        ] {
            assert_eq!(iso_utc(secs), expected, "{secs}");
        }
    }
}
