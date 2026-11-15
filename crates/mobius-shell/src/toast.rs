//! Desktop notices on Windows, sent through notify-rust rather than the notification plugin, for two reasons.
//!
//! A toast shows the name registered for the app id it is sent under. The installed app's Start shortcut registers
//! Mobius under its identifier. A build run from a cargo target directory has no shortcut, so the plugin sends its
//! toasts under PowerShell's id and they said "Windows PowerShell". Such a build registers its own id here, under
//! HKCU\Software\Classes\AppUserModelId (how an app with no shortcut names its toasts), and sends under that.
//!
//! The plugin also passes its sound name straight through, and Windows knows "Default" but not "default": every toast
//! went out silent, whatever the notice asked for.
use std::path::Path;

/// The app id a build run from a cargo target directory sends its toasts under.
#[cfg_attr(not(windows), allow(dead_code))]
pub const SOURCE_BUILD_ID: &str = "app.mobius.shell.dev";
/// The name such a build's toasts carry.
#[cfg_attr(not(windows), allow(dead_code))]
pub const SOURCE_BUILD_NAME: &str = "Mobius (dev build)";

/// Whether the exe in this folder is a build in a cargo target directory rather than an installed copy: the same test
/// the notification plugin makes before it gives a toast the app's identifier.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_source_build(exe_dir: &Path) -> bool {
    exe_dir.ends_with("target/debug") || exe_dir.ends_with("target/release")
}

/// The app id to send under: the identifier when installed, otherwise the source build's own (registered once).
#[cfg(windows)]
fn app_id(identifier: &str) -> Option<String> {
    use std::sync::OnceLock;
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let exe = std::env::current_exe().ok()?;
    if !exe.parent().is_some_and(is_source_build) {
        return Some(identifier.to_owned());
    }
    REGISTERED.get_or_init(register_source_build).then(|| SOURCE_BUILD_ID.to_owned())
}

/// Names the source build's app id for this user, with the Mobius icon from the source tree.
#[cfg(windows)]
fn register_source_build() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, REG_SZ, RegSetKeyValueW};
    use windows::core::HSTRING;
    let key = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{SOURCE_BUILD_ID}"));
    let icon = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons").join("icon.png");
    let set = |name: &str, value: &str| {
        let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let Ok(bytes) = u32::try_from(wide.len() * 2) else { return false };
        // SAFETY: the data points at `bytes` bytes of a NUL-terminated UTF-16 string, as REG_SZ asks.
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, &key, &HSTRING::from(name), REG_SZ.0, Some(wide.as_ptr().cast()), bytes) }.is_ok()
    };
    set("DisplayName", SOURCE_BUILD_NAME) && set("IconUri", &icon.display().to_string())
}

/// Shows one notice. A source build that could not register its id sends under PowerShell's, as before.
#[cfg(windows)]
pub fn show(identifier: &str, notice: &mobius_host::notify::Notice) {
    let mut toast = notify_rust::Notification::new();
    toast.summary(&notice.title).body(&notice.body).auto_icon();
    if !notice.silent {
        toast.sound_name("Default");
    }
    if let Some(id) = app_id(identifier) {
        toast.app_id(&id);
    }
    std::thread::spawn(move || {
        let _ = toast.show();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_build_in_a_cargo_target_directory_counts_as_a_source_build() {
        assert!(is_source_build(Path::new("/src/mobius/target/debug")));
        assert!(is_source_build(Path::new("/src/mobius/target/release")));
        assert!(!is_source_build(Path::new("/opt/Mobius")));
        assert!(!is_source_build(Path::new("/src/mobius/target/debug/deps")));
        assert!(!is_source_build(Path::new("/src/mobius/mytarget/debug")));
    }
}
