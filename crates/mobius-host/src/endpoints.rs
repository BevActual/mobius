//! Model servers the person has saved by name, so they can switch between them. Addresses and model names are kept in a
//! file; each saved API key goes to the secret store under the endpoint's own name and never reaches the window.
use std::path::PathBuf;
use std::sync::Arc;

use mobius_store::file::{read_json, write_json};
use serde_json::{Value, json};

use crate::agent::is_model_name;
use crate::secrets::Secrets;

pub const MAX_ENDPOINTS: usize = 20;
pub const MAX_NAME: usize = 40;

#[derive(Debug, Clone, PartialEq)]
struct Endpoint {
    id: String,
    name: String,
    base_url: String,
    model: String,
    has_key: bool,
}

/// What `use` hands back: everything needed to point the agent at the endpoint.
#[derive(Debug, Clone, PartialEq)]
pub struct Chosen {
    pub base_url: String,
    pub model: String,
    pub key: Option<String>,
}

pub struct Endpoints {
    file: PathBuf,
    secrets: Arc<dyn Secrets>,
    items: Vec<Endpoint>,
}

fn secret_name(id: &str) -> String {
    format!("endpoint-{id}")
}

pub fn is_endpoint_id(v: &str) -> bool {
    v.strip_prefix("e-").is_some_and(|n| !n.is_empty() && n.len() <= 9 && n.bytes().all(|b| b.is_ascii_digit()))
}

impl Endpoints {
    pub fn open(file: PathBuf, secrets: Arc<dyn Secrets>) -> Endpoints {
        let items = read_json(&file)
            .and_then(|v| v.get("endpoints").and_then(Value::as_array).cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|e| {
                let (id, name, base_url, model) = (e.get("id")?.as_str()?, e.get("name")?.as_str()?, e.get("baseUrl")?.as_str()?, e.get("model")?.as_str()?);
                (is_endpoint_id(id) && !name.is_empty() && name.chars().count() <= MAX_NAME && is_model_name(model) && base_url.starts_with("http")).then(|| Endpoint {
                    id: id.to_owned(),
                    name: name.to_owned(),
                    base_url: base_url.to_owned(),
                    model: model.to_owned(),
                    has_key: e.get("hasKey") == Some(&Value::Bool(true)),
                })
            })
            .take(MAX_ENDPOINTS)
            .collect();
        Endpoints { file, secrets, items }
    }

    fn save_file(&self) {
        let rows: Vec<Value> = self.items.iter().map(|e| json!({ "id": e.id, "name": e.name, "baseUrl": e.base_url, "model": e.model, "hasKey": e.has_key })).collect();
        write_json(&self.file, &json!({ "endpoints": rows }));
    }

    /// What the window may see: names and addresses, and whether a key is kept, never the key.
    pub fn list(&self) -> Value {
        Value::Array(self.items.iter().map(|e| json!({ "id": e.id, "name": e.name, "baseUrl": e.base_url, "model": e.model, "hasKey": e.has_key })).collect())
    }

    /// Saves the current server under a name. A name already in use is replaced (so saving again updates it).
    pub fn save(&mut self, name: &str, base_url: &str, model: &str, key: Option<&str>) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(char::is_control) {
            return Err(format!("Give it a name of 1 to {MAX_NAME} characters."));
        }
        if base_url.is_empty() || model.is_empty() {
            return Err("Set up a model server first, then save it.".into());
        }
        let existing = self.items.iter().position(|e| e.name.eq_ignore_ascii_case(name));
        if existing.is_none() && self.items.len() >= MAX_ENDPOINTS {
            return Err(format!("You can save up to {MAX_ENDPOINTS} servers. Remove one first."));
        }
        let id = match existing {
            Some(at) => self.items[at].id.clone(),
            None => {
                let next = self.items.iter().filter_map(|e| e.id[2..].parse::<u64>().ok()).max().unwrap_or(0) + 1;
                format!("e-{next}")
            }
        };
        let kept = match key {
            Some(k) => self.secrets.available() && self.secrets.put(&secret_name(&id), k),
            None => {
                self.secrets.delete(&secret_name(&id));
                false
            }
        };
        let item = Endpoint { id: id.clone(), name: name.to_owned(), base_url: base_url.to_owned(), model: model.to_owned(), has_key: kept };
        match existing {
            Some(at) => self.items[at] = item,
            None => self.items.push(item),
        }
        self.save_file();
        Ok(id)
    }

    pub fn choose(&self, id: &str) -> Option<Chosen> {
        let e = self.items.iter().find(|e| e.id == id)?;
        Some(Chosen { base_url: e.base_url.clone(), model: e.model.clone(), key: e.has_key.then(|| self.secrets.get(&secret_name(id))).flatten() })
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|e| e.id != id);
        if self.items.len() == before {
            return false;
        }
        self.secrets.delete(&secret_name(id));
        self.save_file();
        true
    }

    /// Takes every saved key out of the secret store (when the person removes all their data).
    pub fn forget_keys(&self) {
        for e in &self.items {
            self.secrets.delete(&secret_name(&e.id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;

    fn endpoints() -> (Endpoints, Arc<MemorySecrets>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MemorySecrets::new(true));
        (Endpoints::open(dir.path().join("endpoints.json"), secrets.clone()), secrets, dir)
    }

    #[test]
    fn a_saved_server_is_listed_without_its_key_and_can_be_chosen_with_it() {
        let (mut e, secrets, _d) = endpoints();
        let id = e.save("Work", "https://api.work.example/v1", "big-model", Some("sk-work")).unwrap();
        assert_eq!(id, "e-1");
        assert_eq!(e.list(), json!([{ "id": "e-1", "name": "Work", "baseUrl": "https://api.work.example/v1", "model": "big-model", "hasKey": true }]));
        assert!(!e.list().to_string().contains("sk-work"));
        assert_eq!(secrets.get("endpoint-e-1").as_deref(), Some("sk-work"));
        assert_eq!(e.choose("e-1"), Some(Chosen { base_url: "https://api.work.example/v1".into(), model: "big-model".into(), key: Some("sk-work".into()) }));
        assert_eq!(e.choose("e-9"), None);
    }

    #[test]
    fn saving_under_the_same_name_updates_it_and_a_missing_key_clears_the_old_one() {
        let (mut e, secrets, _d) = endpoints();
        e.save("Home", "http://127.0.0.1:8080/v1", "local", Some("k1")).unwrap();
        assert_eq!(e.save("home", "http://127.0.0.1:9090/v1", "other", None).unwrap(), "e-1");
        assert_eq!(e.list().as_array().unwrap().len(), 1);
        assert_eq!(e.list()[0]["model"], "other");
        assert_eq!(e.list()[0]["hasKey"], false);
        assert_eq!(secrets.get("endpoint-e-1"), None);
        assert_eq!(e.choose("e-1").unwrap().key, None);
    }

    #[test]
    fn names_and_the_count_are_bounded_and_an_empty_setup_cannot_be_saved() {
        let (mut e, _s, _d) = endpoints();
        for bad in ["", "   ", &"n".repeat(41), "bad\nname"] {
            assert!(e.save(bad, "http://a/v1", "m", None).is_err(), "{bad:?}");
        }
        assert!(e.save("x", "", "m", None).is_err());
        assert!(e.save("x", "http://a/v1", "", None).is_err());
        for i in 0..MAX_ENDPOINTS {
            e.save(&format!("s{i}"), "http://a/v1", "m", None).unwrap();
        }
        assert!(e.save("one more", "http://a/v1", "m", None).is_err());
        assert!(e.save("s3", "http://b/v1", "m", None).is_ok(), "replacing one is still allowed when full");
    }

    #[test]
    fn removing_forgets_the_key_and_ids_are_not_reused_while_others_remain() {
        let (mut e, secrets, _d) = endpoints();
        e.save("A", "http://a/v1", "m", Some("ka")).unwrap();
        e.save("B", "http://b/v1", "m", Some("kb")).unwrap();
        assert!(e.remove("e-1"));
        assert!(!e.remove("e-1"));
        assert_eq!(secrets.get("endpoint-e-1"), None);
        assert_eq!(e.save("C", "http://c/v1", "m", None).unwrap(), "e-3");
    }

    #[test]
    fn the_list_survives_a_restart_and_a_damaged_file_gives_an_empty_one() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("endpoints.json");
        let secrets = Arc::new(MemorySecrets::new(true));
        let mut e = Endpoints::open(file.clone(), secrets.clone());
        e.save("A", "http://a/v1", "m", Some("ka")).unwrap();
        let again = Endpoints::open(file.clone(), secrets.clone());
        assert_eq!(again.choose("e-1").unwrap().key.as_deref(), Some("ka"));
        std::fs::write(&file, "{nope").unwrap();
        assert_eq!(Endpoints::open(file.clone(), secrets.clone()).list(), json!([]));
        std::fs::write(&file, json!({ "endpoints": [{ "id": "../x", "name": "n", "baseUrl": "http://a", "model": "m" }, { "id": "e-1", "name": "ok", "baseUrl": "file:///x", "model": "m" }] }).to_string()).unwrap();
        assert_eq!(Endpoints::open(file, secrets).list(), json!([]), "bad ids and non-web addresses are dropped");
    }

    #[test]
    fn without_a_secret_store_the_server_is_saved_but_no_key_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let mut e = Endpoints::open(dir.path().join("e.json"), Arc::new(MemorySecrets::new(false)));
        e.save("A", "http://a/v1", "m", Some("ka")).unwrap();
        assert_eq!(e.list()[0]["hasKey"], false);
    }

    #[test]
    fn forgetting_keys_clears_every_saved_one() {
        let (mut e, secrets, _d) = endpoints();
        e.save("A", "http://a/v1", "m", Some("ka")).unwrap();
        e.save("B", "http://b/v1", "m", Some("kb")).unwrap();
        e.forget_keys();
        assert_eq!((secrets.get("endpoint-e-1"), secrets.get("endpoint-e-2")), (None, None));
    }
}
