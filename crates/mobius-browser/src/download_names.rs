//! File names for downloads: whatever a page calls a file, it can only ever be a plain name in the downloads folder.
const MAX_NAME: usize = 120;
const RISKY: [&str; 24] = ["exe", "msi", "bat", "cmd", "ps1", "scr", "js", "jse", "vbs", "vbe", "wsf", "jar", "lnk", "com", "hta", "reg", "dll", "pif", "cpl", "msc", "sh", "app", "dmg", "apk"];

fn reserved(stem: &str) -> bool {
    let s = stem.to_lowercase();
    matches!(s.as_str(), "con" | "prn" | "aux" | "nul") || ((s.starts_with("com") || s.starts_with("lpt")) && s.len() == 4 && s.as_bytes()[3].is_ascii_digit() && s.as_bytes()[3] != b'0')
}

/// A file name that is safe to create in the downloads folder, whatever the page called it.
pub fn safe_file_name(raw: &str) -> String {
    // Only the last part counts: a page cannot choose a folder.
    let last = raw.rsplit(['\\', '/']).next().unwrap_or("");
    let replaced: String = last.chars().map(|c| if (c as u32) < 32 || "<>:\"|?*".contains(c) { '_' } else { c }).collect();
    let name = replaced.trim_start_matches('.').trim_end_matches(['.', ' ']).trim();
    if name.is_empty() {
        return "download".into();
    }
    let mut name = name.to_owned();
    // Windows treats the part before the FIRST dot as the device name, so "nul.tar.gz" is as bad as "nul".
    let stem = name.split('.').next().unwrap_or("");
    if reserved(stem) {
        name = format!("_{name}");
    }
    let chars: Vec<char> = name.chars().collect();
    if chars.len() > MAX_NAME {
        let dot = name.rfind('.').filter(|d| *d > 0);
        let ending: String = dot.filter(|d| name[*d..].chars().count() <= 16).map(|d| name[d..].to_owned()).unwrap_or_default();
        let keep = MAX_NAME - ending.chars().count();
        name = chars[..keep].iter().collect::<String>() + &ending;
    }
    name
}

/// `name`, or `name (1)`, `name (2)`… before the ending, whichever is not taken.
pub fn unique_name(name: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(name) {
        return name.to_owned();
    }
    let dot = name.rfind('.').filter(|d| *d > 0);
    let (stem, ending) = dot.map_or((name, ""), |d| (&name[..d], &name[d..]));
    for n in 1..=999 {
        let candidate = format!("{stem} ({n}){ending}");
        if !exists(&candidate) {
            return candidate;
        }
    }
    let mut bytes = [0u8; 4];
    let _ = getrandom::fill(&mut bytes);
    format!("{stem}-{}{ending}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// Files that can run a program when opened. They are saved, but never opened for you.
pub fn is_risky(name: &str) -> bool {
    name.rfind('.').filter(|d| *d > 0).is_some_and(|d| RISKY.contains(&name[d + 1..].to_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_cannot_choose_a_folder() {
        assert_eq!(safe_file_name("..\\..\\Windows\\evil.txt"), "evil.txt");
        assert_eq!(safe_file_name("/etc/passwd"), "passwd");
        assert_eq!(safe_file_name("a/b\\c.txt"), "c.txt");
    }

    #[test]
    fn forbidden_characters_dots_and_empty_names_are_fixed() {
        assert_eq!(safe_file_name("a<b>:c|d?e*f.txt"), "a_b__c_d_e_f.txt");
        assert_eq!(safe_file_name("\u{1}x\u{1f}.txt"), "_x_.txt");
        assert_eq!(safe_file_name("...hidden"), "hidden");
        assert_eq!(safe_file_name("name. . "), "name");
        for empty in ["", "   ", "...", "/", "\\"] {
            assert_eq!(safe_file_name(empty), "download", "{empty:?}");
        }
    }

    #[test]
    fn windows_device_names_are_made_ordinary() {
        for name in ["con", "CON.txt", "nul.tar.gz", "com1.txt", "LPT9", "prn"] {
            assert!(safe_file_name(name).starts_with('_'), "{name}");
        }
        for name in ["com0.txt", "com10.txt", "console.txt", "lpt.txt"] {
            assert!(!safe_file_name(name).starts_with('_'), "{name}");
        }
    }

    #[test]
    fn long_names_are_cut_but_keep_a_short_ending() {
        let long = format!("{}.pdf", "a".repeat(300));
        let cut = safe_file_name(&long);
        assert_eq!(cut.chars().count(), 120);
        assert!(cut.ends_with(".pdf"));
        let weird = format!("{}.{}", "a".repeat(300), "b".repeat(40));
        assert_eq!(safe_file_name(&weird).chars().count(), 120);
        assert_eq!(safe_file_name(&"é".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn a_taken_name_gets_a_number_before_the_ending() {
        let taken = ["a.txt", "a (1).txt", "noext", "noext (1)"];
        let exists = |n: &str| taken.contains(&n);
        assert_eq!(unique_name("b.txt", exists), "b.txt");
        assert_eq!(unique_name("a.txt", exists), "a (2).txt");
        assert_eq!(unique_name("noext", exists), "noext (2)");
        let everything = |_: &str| true;
        let last = unique_name("x.bin", everything);
        assert!(last.starts_with("x-") && last.ends_with(".bin"), "{last}");
    }

    #[test]
    fn files_that_can_run_a_program_are_risky() {
        for name in ["setup.exe", "A.MSI", "x.bat", "run.ps1", "a.b.js", "tool.sh", "App.dmg", "x.lnk"] {
            assert!(is_risky(name), "{name}");
        }
        for name in ["notes.txt", "photo.png", "exe", ".exe", "report.pdf", "archive.zip"] {
            assert!(!is_risky(name), "{name}");
        }
    }
}
