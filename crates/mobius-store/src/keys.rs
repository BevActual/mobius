//! Keyboard shortcut bindings, checked the same way as `keys.ts` in the shared package.
use serde_json::{Map, Value, json};

pub const ACTIONS: [&str; 9] = ["launcher", "address", "newTab", "closeTab", "settings", "find", "quickEntry", "splitView", "littleMobius"];

pub fn defaults() -> Value {
    json!({ "launcher": "mod+k", "address": "mod+l", "newTab": "mod+t", "closeTab": "mod+w", "settings": "mod+,", "find": "mod+f", "quickEntry": "", "splitView": "mod+\\", "littleMobius": "mod+shift+m" })
}

fn is_key(k: &str) -> bool {
    let punctuation = [",", ".", "/", ";", "'", "[", "]", "-", "=", "\\", "`"];
    let named = ["space", "up", "down", "left", "right"];
    (k.len() == 1 && (k.as_bytes()[0].is_ascii_lowercase() || k.as_bytes()[0].is_ascii_digit()))
        || punctuation.contains(&k)
        || named.contains(&k)
        || is_function_key(k)
}

fn is_function_key(k: &str) -> bool {
    k.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=12).contains(&n) && k == format!("f{n}"))
}

struct Combo {
    key: String,
    modifier: bool,
    alt: bool,
}

fn parse_combo(text: &str) -> Option<Combo> {
    if text.is_empty() || text.chars().count() > 40 {
        return None;
    }
    let parts: Vec<&str> = text.split('+').collect();
    let (key, modifiers) = parts.split_last()?;
    if !is_key(key) {
        return None;
    }
    let order = ["mod", "alt", "shift"];
    let mut last: i32 = -1;
    let mut combo = Combo { key: (*key).to_owned(), modifier: false, alt: false };
    for m in modifiers {
        let at = order.iter().position(|o| o == m)? as i32;
        if at <= last {
            return None;
        }
        last = at;
        match *m {
            "mod" => combo.modifier = true,
            "alt" => combo.alt = true,
            _ => {}
        }
    }
    Some(combo)
}

fn is_binding(v: &Value) -> bool {
    let Some(text) = v.as_str() else { return false };
    if text.is_empty() {
        return true;
    }
    let Some(c) = parse_combo(text) else { return false };
    let function = is_function_key(&c.key);
    if !c.modifier && !c.alt && !function {
        return false;
    }
    !(["c", "v", "x", "a", "z", "y"].contains(&c.key.as_str()) && c.modifier && !c.alt)
}

/// The combination written the way the system's global shortcut registration wants it (`CommandOrControl+Alt+Space`), or none
/// when it is not a binding that may be global. A bare letter as a global shortcut would take that key from every program.
pub fn to_accelerator(binding: &str) -> Option<String> {
    if binding.is_empty() || !is_binding(&Value::String(binding.to_owned())) {
        return None;
    }
    let combo = parse_combo(binding)?;
    let shift = binding.split('+').any(|p| p == "shift");
    let key = match combo.key.as_str() {
        "space" => "Space".to_owned(),
        "up" => "Up".to_owned(),
        "down" => "Down".to_owned(),
        "left" => "Left".to_owned(),
        "right" => "Right".to_owned(),
        other => other.to_uppercase(),
    };
    let mut parts = Vec::new();
    if combo.modifier {
        parts.push("CommandOrControl".to_owned());
    }
    if combo.alt {
        parts.push("Alt".to_owned());
    }
    if shift {
        parts.push("Shift".to_owned());
    }
    parts.push(key);
    Some(parts.join("+"))
}

/// Every action is present and well formed, and no two actions share a combination.
pub fn is_key_bindings(v: &Value) -> bool {
    let Some(map): Option<&Map<String, Value>> = v.as_object() else { return false };
    if map.len() != ACTIONS.len() || !ACTIONS.iter().all(|a| map.contains_key(*a)) {
        return false;
    }
    let mut used = std::collections::HashSet::new();
    for a in ACTIONS {
        let b = &map[a];
        if !is_binding(b) {
            return false;
        }
        let text = b.as_str().unwrap_or_default();
        if !text.is_empty() && !used.insert(text.to_owned()) {
            return false;
        }
    }
    true
}

/// The combination a key press makes, written as bindings are (`mod+alt+shift+key`), from a Windows virtual-key code.
/// `None` for modifiers and keys that cannot be bound.
pub fn combo_of_windows_key(virtual_key: u32, control: bool, alt: bool, shift: bool) -> Option<String> {
    let key: String = match virtual_key {
        0x41..=0x5A => char::from(u8::try_from(virtual_key).ok()? + 32).to_string(),
        0x30..=0x39 => char::from(u8::try_from(virtual_key).ok()?).to_string(),
        0x70..=0x7B => format!("f{}", virtual_key - 0x70 + 1),
        0x20 => "space".into(),
        0x25 => "left".into(),
        0x26 => "up".into(),
        0x27 => "right".into(),
        0x28 => "down".into(),
        0xBC => ",".into(),
        0xBE => ".".into(),
        0xBF => "/".into(),
        0xBA => ";".into(),
        0xDE => "'".into(),
        0xDB => "[".into(),
        0xDD => "]".into(),
        0xBD => "-".into(),
        0xBB => "=".into(),
        0xDC => "\\".into(),
        0xC0 => "`".into(),
        _ => return None,
    };
    let mut parts = Vec::new();
    if control {
        parts.push("mod");
    }
    if alt {
        parts.push("alt");
    }
    if shift {
        parts.push("shift");
    }
    parts.push(&key);
    Some(parts.join("+"))
}

/// The window action a press triggers when it matches one of the bindings. The quick-entry binding is global and not included.
pub fn window_action_for(bindings: &Value, combo: &str) -> Option<&'static str> {
    const FORWARDED: [(&str, &str); 8] = [("launcher", "launcher"), ("address", "address"), ("newTab", "new-tab"), ("closeTab", "close-tab"), ("settings", "settings"), ("find", "find"), ("splitView", "split-view"), ("littleMobius", "little-mobius")];
    FORWARDED.iter().find(|(action, _)| bindings.get(*action).and_then(Value::as_str) == Some(combo)).map(|(_, shortcut)| *shortcut)
}

#[cfg(test)]
mod press_tests {
    use super::*;

    #[test]
    fn a_binding_becomes_the_accelerator_the_system_registers() {
        assert_eq!(to_accelerator("mod+alt+space").as_deref(), Some("CommandOrControl+Alt+Space"));
        assert_eq!(to_accelerator("mod+shift+k").as_deref(), Some("CommandOrControl+Shift+K"));
        assert_eq!(to_accelerator("alt+left").as_deref(), Some("Alt+Left"));
        assert_eq!(to_accelerator("mod+,").as_deref(), Some(",".to_owned()).map(|k| format!("CommandOrControl+{k}")).as_deref());
        assert_eq!(to_accelerator("f5").as_deref(), Some("F5"));
        assert_eq!(to_accelerator("mod+alt+shift+7").as_deref(), Some("CommandOrControl+Alt+Shift+7"));
    }

    #[test]
    fn what_cannot_be_global_has_no_accelerator() {
        for bad in ["", "k", "shift+k", "mod+c", "mod+alt", "mod+mod+k", "alt+mod+k", "mod+K", "mod+escape"] {
            assert_eq!(to_accelerator(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_windows_key_press_becomes_the_combination_a_binding_is_written_in() {
        assert_eq!(combo_of_windows_key(0x4B, true, false, false).as_deref(), Some("mod+k"));
        assert_eq!(combo_of_windows_key(0x54, true, false, true).as_deref(), Some("mod+shift+t"));
        assert_eq!(combo_of_windows_key(0xBC, true, true, true).as_deref(), Some("mod+alt+shift+,"));
        assert_eq!(combo_of_windows_key(0x31, false, true, false).as_deref(), Some("alt+1"));
        assert_eq!(combo_of_windows_key(0x70, false, false, false).as_deref(), Some("f1"));
        assert_eq!(combo_of_windows_key(0x7B, false, false, false).as_deref(), Some("f12"));
        assert_eq!(combo_of_windows_key(0x20, true, false, false).as_deref(), Some("mod+space"));
        assert_eq!(combo_of_windows_key(0x25, false, true, false).as_deref(), Some("alt+left"));
        assert_eq!(combo_of_windows_key(0xDC, true, false, false).as_deref(), Some("mod+\\"));
    }

    #[test]
    fn modifiers_and_unbindable_keys_make_no_combination() {
        for vk in [0x10, 0x11, 0x12, 0x5B, 0x0D, 0x1B, 0x09, 0x7C, 0x00, 0xFF] {
            assert_eq!(combo_of_windows_key(vk, true, false, false), None, "{vk:#x}");
        }
    }

    #[test]
    fn every_key_a_binding_can_name_can_be_pressed() {
        let all: Vec<String> = (0x41..=0x5Au32).chain(0x30..=0x39).chain(0x70..=0x7B).chain([0x20, 0x25, 0x26, 0x27, 0x28, 0xBC, 0xBE, 0xBF, 0xBA, 0xDE, 0xDB, 0xDD, 0xBD, 0xBB, 0xDC, 0xC0]).filter_map(|vk| combo_of_windows_key(vk, false, true, false)).collect();
        assert_eq!(all.len(), 26 + 10 + 12 + 16);
        assert!(all.iter().all(|c| is_key_bindings(&json!({ "launcher": c, "address": "", "newTab": "", "closeTab": "", "settings": "", "find": "", "quickEntry": "", "splitView": "", "littleMobius": "" }))), "each spelling is one the settings accept");
    }

    #[test]
    fn a_press_finds_its_window_action_by_the_bindings_in_use() {
        let b = defaults();
        assert_eq!(window_action_for(&b, "mod+k"), Some("launcher"));
        assert_eq!(window_action_for(&b, "mod+t"), Some("new-tab"));
        assert_eq!(window_action_for(&b, "mod+w"), Some("close-tab"));
        assert_eq!(window_action_for(&b, "mod+f"), Some("find"));
        assert_eq!(window_action_for(&b, "mod+j"), None);
        assert_eq!(window_action_for(&b, ""), None, "an unbound action is not triggered by nothing");
        let mut custom = defaults();
        custom["find"] = json!("alt+g");
        custom["quickEntry"] = json!("mod+shift+space");
        assert_eq!(window_action_for(&custom, "alt+g"), Some("find"));
        assert_eq!(window_action_for(&custom, "mod+f"), None);
        assert_eq!(window_action_for(&custom, "mod+shift+space"), None, "quick entry is global, not a window action");
    }
}
