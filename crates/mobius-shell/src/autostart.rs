//! Starting Mobius when the person signs in to Windows: an entry of their own under the registry's Run key, off until
//! they turn it on from the tray. Started that way, Mobius waits in the tray without opening its window.

/// What the Run entry passes, so Mobius starts in the tray.
pub const HIDDEN_ARG: &str = "--hidden";

/// Whether this start came from signing in (the Run entry), so the window stays hidden.
pub fn started_hidden() -> bool {
    std::env::args().skip(1).any(|a| a == HIDDEN_ARG)
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW};
    use windows::core::{HSTRING, w};

    pub const AVAILABLE: bool = true;

    pub fn enabled() -> bool {
        // SAFETY: no buffer is passed; this only asks whether the value is there.
        unsafe { RegGetValueW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), w!("Mobius"), RRF_RT_REG_SZ, None, None, None) }.is_ok()
    }

    pub fn set(on: bool) -> Result<(), String> {
        if !on {
            // SAFETY: the key and value names are static wide strings.
            let gone = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), w!("Mobius")) };
            return if gone.is_ok() || gone == ERROR_FILE_NOT_FOUND { Ok(()) } else { Err(format!("Windows would not stop Mobius starting with it ({})", gone.0)) };
        }
        let exe = std::env::current_exe().map_err(|e| format!("Mobius could not find itself: {e}"))?;
        let command = HSTRING::from(format!("\"{}\" {}", exe.display(), super::HIDDEN_ARG));
        let bytes = u32::try_from((command.len() + 1) * 2).map_err(|_| "Mobius's path is too long.".to_owned())?;
        // SAFETY: the data is the command's wide characters with their ending zero, `bytes` long, as REG_SZ asks.
        let set = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), w!("Mobius"), REG_SZ.0, Some(command.as_ptr().cast()), bytes) };
        if set.is_ok() { Ok(()) } else { Err(format!("Windows would not start Mobius with it ({})", set.0)) }
    }
}

#[cfg(not(windows))]
mod imp {
    pub const AVAILABLE: bool = false;
    pub fn enabled() -> bool {
        false
    }
    pub fn set(_on: bool) -> Result<(), String> {
        Err("Starting with the computer is only on Windows for now.".into())
    }
}

pub use imp::{AVAILABLE, enabled, set};

#[cfg(test)]
mod tests {
    #[test]
    fn the_run_entry_starts_mobius_hidden() {
        assert_eq!(super::HIDDEN_ARG, "--hidden");
        // The test runner is not started from the Run entry.
        assert!(!super::started_hidden());
    }
}
