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

pub fn register_builtin_tools(core: &mut Core) -> Result<(), CoreError> {
    core.register_tool(
        ToolSpec::new("clock.now", "Returns the current date and time in UTC.", "clock.read")?,
        Box::new(|_| {
            let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "the system clock is set before 1970".to_owned())?.as_secs();
            Ok(json!({ "utc": iso_utc(seconds) }))
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
