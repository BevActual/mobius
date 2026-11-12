//! A group of settings kept in one small JSON file. A change is checked field by field; a file that is missing,
//! damaged or hostile falls back to the defaults one field at a time.
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::file::{read_json, write_json};

pub type Check = fn(&Value) -> bool;

pub struct Field {
    pub name: &'static str,
    pub default: fn() -> Value,
    pub check: Check,
}

pub struct Settings {
    file: PathBuf,
    fields: &'static [Field],
    value: Map<String, Value>,
}

impl Settings {
    pub fn open(file: PathBuf, fields: &'static [Field]) -> Settings {
        let mut value: Map<String, Value> = fields.iter().map(|f| (f.name.to_owned(), (f.default)())).collect();
        if let Some(Value::Object(saved)) = read_json(&file) {
            for f in fields {
                // A group saved before an entry was added (a new shortcut, say) gets that entry's default, so what
                // was chosen is kept instead of the whole group being reset.
                let saved_value = match (saved.get(f.name), (f.default)()) {
                    (Some(Value::Object(kept)), Value::Object(mut whole)) => {
                        whole.extend(kept.clone());
                        Some(Value::Object(whole))
                    }
                    (other, _) => other.cloned(),
                };
                if let Some(v) = saved_value.filter(|v| (f.check)(v)) {
                    value.insert(f.name.to_owned(), v);
                }
            }
        }
        Settings { file, fields, value }
    }

    pub fn get(&self) -> Value {
        Value::Object(self.value.clone())
    }

    /// Applies a change. Unknown fields are dropped; one bad field refuses the whole change; nothing valid means no
    /// change. Returns whether anything was applied.
    pub fn set(&mut self, change: &Value) -> bool {
        let Value::Object(change) = change else { return false };
        let mut patch = Vec::new();
        for f in self.fields {
            match change.get(f.name) {
                None => {}
                Some(v) if (f.check)(v) => patch.push((f.name, v.clone())),
                Some(_) => return false,
            }
        }
        if patch.is_empty() {
            return false;
        }
        for (name, v) in patch {
            self.value.insert(name.to_owned(), v);
        }
        write_json(&self.file, &Value::Object(self.value.clone()));
        true
    }
}

pub fn is_flag(v: &Value) -> bool {
    v.is_boolean()
}

pub fn one_of(v: &Value, choices: &[&str]) -> bool {
    v.as_str().is_some_and(|s| choices.contains(&s))
}

pub fn in_range(v: &Value, min: f64, max: f64) -> bool {
    v.as_f64().is_some_and(|n| n.is_finite() && n >= min && n <= max)
}
