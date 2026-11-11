//! Model providers, like Hermes's Providers settings: a known list of services that speak the OpenAI chat format,
//! with one key per provider kept in the system's secret store. A key is only ever sent to its own provider's
//! address, and never shown again once saved.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::{Value, json};

use crate::secrets::Secrets;

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub note: &'static str,
    pub key_url: Option<&'static str>,
    pub needs_key: bool,
    /// For voice only (listening and speaking): it does not speak the chat format, so it is never a chat model.
    pub voice_only: bool,
}

const fn hosted(id: &'static str, name: &'static str, base_url: &'static str, note: &'static str, key_url: &'static str) -> Provider {
    Provider { id, name, base_url, note, key_url: Some(key_url), needs_key: true, voice_only: false }
}
const fn local(id: &'static str, name: &'static str, base_url: &'static str, note: &'static str) -> Provider {
    Provider { id, name, base_url, note, key_url: None, needs_key: false, voice_only: false }
}

/// The addresses are the ones each service documents for the OpenAI chat format.
pub const CATALOG: &[Provider] = &[
    hosted("openai", "OpenAI", "https://api.openai.com/v1", "GPT models.", "https://platform.openai.com/api-keys"),
    hosted("anthropic", "Anthropic", "https://api.anthropic.com/v1", "Claude models, through their OpenAI-compatible layer.", "https://console.anthropic.com/settings/keys"),
    hosted("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "Gemini models from Google AI Studio.", "https://aistudio.google.com/app/apikey"),
    hosted("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "One key for hundreds of models.", "https://openrouter.ai/keys"),
    hosted("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "DeepSeek chat and reasoning models.", "https://platform.deepseek.com/api_keys"),
    hosted("groq", "Groq", "https://api.groq.com/openai/v1", "Fast hosted open models.", "https://console.groq.com/keys"),
    hosted("together", "Together AI", "https://api.together.xyz/v1", "Hosted open models.", "https://api.together.ai/settings/api-keys"),
    hosted("mistral", "Mistral", "https://api.mistral.ai/v1", "Mistral models.", "https://console.mistral.ai/api-keys"),
    hosted("xai", "xAI", "https://api.x.ai/v1", "Grok models.", "https://console.x.ai/"),
    hosted("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "Hosted open models.", "https://app.fireworks.ai/settings/users/api-keys"),
    hosted("huggingface", "Hugging Face", "https://router.huggingface.co/v1", "Inference providers behind one address.", "https://huggingface.co/settings/tokens"),
    local("ollama", "Ollama", "http://127.0.0.1:11434/v1", "Models you run with Ollama on this computer. No key needed."),
    local("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", "The local server in LM Studio on this computer. No key needed."),
    local("llamacpp", "llama.cpp", "http://127.0.0.1:8080/v1", "A llama-server you started on this computer. No key needed."),
    Provider { id: "elevenlabs", name: "ElevenLabs", base_url: "https://api.elevenlabs.io/v1", note: "Voice only: listening and speaking, in Settings, Voice.", key_url: Some("https://elevenlabs.io/app/settings/api-keys"), needs_key: true, voice_only: true },
];

/// Plans you sign in to instead of pasting a key. Each runs through the service's own app on this computer.
pub struct Subscription {
    pub id: &'static str,
    pub name: &'static str,
    pub address: &'static str,
    pub note: &'static str,
    /// How signing in works: `cli` (the service's own app keeps the sign-in) or `device` (a code you enter on the
    /// service's site; Mobius keeps the token in the system secret store).
    pub kind: &'static str,
}

pub const CLAUDE_CODE_ADDRESS: &str = "claude-code://subscription";

pub const CHATGPT_ADDRESS: &str = "chatgpt://subscription";

pub const SUBSCRIPTIONS: &[Subscription] = &[
    Subscription {
        id: "claude-code",
        name: "Claude subscription",
        address: CLAUDE_CODE_ADDRESS,
        note: "Your Claude Pro or Max plan, through the Claude Code app on this computer. Each request counts against the plan's Agent SDK allowance, at the same rate as claude -p. Claude Code keeps the sign-in; Mobius never sees it.",
        kind: "cli",
    },
    Subscription {
        id: "chatgpt",
        name: "ChatGPT subscription",
        address: CHATGPT_ADDRESS,
        note: "Your ChatGPT Plus, Pro or Team plan, the way the Codex app uses it. Requests count against the plan's Codex limits. You sign in on OpenAI's site with a code; the sign-in is kept in this computer's secret store and only ever sent to OpenAI.",
        kind: "device",
    },
];

/// Models the ChatGPT plan's Codex endpoint accepts (after Hermes Agent's list), newest first.
pub const CHATGPT_MODELS: &[(&str, &str)] = &[("gpt-5.5", "GPT-5.5"), ("gpt-5.4", "GPT-5.4"), ("gpt-5.4-mini", "GPT-5.4 mini"), ("gpt-6-sol", "GPT-6 Sol"), ("gpt-6-luna", "GPT-6 Luna")];

pub fn subscription_models(s: &Subscription) -> &'static [(&'static str, &'static str)] {
    if s.address == CHATGPT_ADDRESS { CHATGPT_MODELS } else { mobius_claude::frames::MODELS }
}

pub fn find_subscription(id: &str) -> Option<&'static Subscription> {
    SUBSCRIPTIONS.iter().find(|s| s.id == id)
}

pub fn find(id: &str) -> Option<&'static Provider> {
    CATALOG.iter().find(|p| p.id == id)
}

/// A key as pasted: printable, no spaces inside, a sensible length.
pub fn is_key_text(key: &str) -> bool {
    (8..=500).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

fn secret_name(id: &str) -> String {
    format!("provider-{id}")
}

fn same_address(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/').eq_ignore_ascii_case(b.trim().trim_end_matches('/'))
}

pub struct Providers {
    secrets: Arc<dyn Secrets>,
    /// Keys for this run only, when the system has no secret store.
    session: Mutex<HashMap<String, String>>,
    /// Tests point a provider at a local fake server. Set only through the bridge's test hooks.
    redirected: Mutex<HashMap<String, String>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Providers {
    pub fn new(secrets: Arc<dyn Secrets>) -> Providers {
        Providers { secrets, session: Mutex::default(), redirected: Mutex::default() }
    }

    pub fn redirect_for_tests(&self, id: &str, url: &str) {
        if find(id).is_some() {
            lock(&self.redirected).insert(id.to_owned(), url.to_owned());
        }
    }

    /// Where this provider's requests go.
    pub fn address(&self, id: &str) -> Option<String> {
        let provider = find(id)?;
        Some(lock(&self.redirected).get(id).cloned().unwrap_or_else(|| provider.base_url.to_owned()))
    }

    pub fn key(&self, id: &str) -> Option<String> {
        find(id)?;
        lock(&self.session).get(id).cloned().or_else(|| self.secrets.get(&secret_name(id)))
    }

    /// Saved in the secret store when there is one, else kept until Mobius quits. Says which.
    pub fn set_key(&self, id: &str, key: &str) -> Result<&'static str, String> {
        let provider = find(id).ok_or("That provider is not known.")?;
        if !provider.needs_key {
            return Err(format!("{} needs no key.", provider.name));
        }
        let key = key.trim();
        if !is_key_text(key) {
            return Err("That does not look like a key: paste it again, with nothing around it.".into());
        }
        lock(&self.session).remove(id);
        if self.secrets.available() && self.secrets.put(&secret_name(id), key) {
            return Ok("keychain");
        }
        lock(&self.session).insert(id.to_owned(), key.to_owned());
        Ok("session")
    }

    pub fn remove_key(&self, id: &str) {
        if find(id).is_some() {
            lock(&self.session).remove(id);
            self.secrets.delete(&secret_name(id));
        }
    }

    pub fn forget_all(&self) {
        for p in CATALOG {
            self.remove_key(p.id);
        }
    }

    /// The provider this address belongs to, if any.
    pub fn id_for_address(&self, base_url: &str) -> Option<&'static str> {
        CATALOG.iter().find(|p| self.address(p.id).is_some_and(|a| same_address(&a, base_url))).map(|p| p.id)
    }

    /// The catalog as the window shows it. Keys are never included, only whether there is one.
    pub fn list(&self, active_base_url: &str) -> Value {
        let active = self.id_for_address(active_base_url);
        Value::Array(
            CATALOG
                .iter()
                .map(|p| json!({
                    "id": p.id, "name": p.name, "baseUrl": p.base_url, "note": p.note, "keyUrl": p.key_url,
                    "needsKey": p.needs_key, "voiceOnly": p.voice_only, "hasKey": self.key(p.id).is_some(), "active": active == Some(p.id),
                    "storage": if lock(&self.session).contains_key(p.id) { "session" } else if self.secrets.get(&secret_name(p.id)).is_some() { "keychain" } else { "none" },
                }))
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;

    #[test]
    fn the_catalog_is_unique_and_hosted_providers_use_https() {
        let mut ids: Vec<_> = CATALOG.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        for p in CATALOG {
            assert_eq!(p.needs_key, p.base_url.starts_with("https://"), "{}", p.id);
            assert_eq!(p.needs_key, p.key_url.is_some_and(|u| u.starts_with("https://")), "{}", p.id);
            assert!(!p.base_url.ends_with('/'), "{}", p.id);
            assert!(p.id.chars().all(|c| c.is_ascii_lowercase()), "{}", p.id);
        }
    }

    #[test]
    fn keys_are_checked_kept_per_provider_and_never_listed() {
        let providers = Providers::new(Arc::new(MemorySecrets::new(true)));
        assert_eq!(providers.set_key("openai", "  sk-test-12345678  "), Ok("keychain"));
        assert_eq!(providers.key("openai").as_deref(), Some("sk-test-12345678"));
        assert_eq!(providers.key("groq"), None);
        for bad in ["", "short", "has space inside 123", "tab\tinside12345", &"k".repeat(501), "ключ-12345678"] {
            assert!(providers.set_key("groq", bad).is_err(), "{bad:?}");
        }
        assert!(providers.set_key("nope", "sk-test-12345678").is_err());
        assert!(providers.set_key("ollama", "sk-test-12345678").is_err(), "a local provider takes no key");
        let listed = providers.list("").to_string();
        assert!(!listed.contains("sk-test"), "{listed}");
        let openai = providers.list("")[0].clone();
        assert_eq!((openai["hasKey"].as_bool(), openai["storage"].as_str()), (Some(true), Some("keychain")));
        providers.remove_key("openai");
        assert_eq!(providers.key("openai"), None);
    }

    #[test]
    fn without_a_secret_store_a_key_lasts_only_for_this_run() {
        let providers = Providers::new(Arc::new(MemorySecrets::new(false)));
        assert_eq!(providers.set_key("openai", "sk-test-12345678"), Ok("session"));
        assert_eq!(providers.key("openai").as_deref(), Some("sk-test-12345678"));
        assert_eq!(providers.list("")[0]["storage"], "session");
    }

    #[test]
    fn the_active_provider_is_found_by_its_address() {
        let providers = Providers::new(Arc::new(MemorySecrets::new(true)));
        let listed = providers.list("https://api.groq.com/openai/v1/");
        let active: Vec<_> = listed.as_array().unwrap().iter().filter(|p| p["active"] == true).map(|p| p["id"].as_str().unwrap()).collect();
        assert_eq!(active, ["groq"]);
        assert_eq!(providers.id_for_address("https://example.com/v1"), None);
        providers.redirect_for_tests("openai", "http://127.0.0.1:9/v1");
        assert_eq!(providers.address("openai").as_deref(), Some("http://127.0.0.1:9/v1"));
        assert_eq!(providers.id_for_address("http://127.0.0.1:9/v1"), Some("openai"));
    }

    #[test]
    fn forgetting_removes_every_key() {
        let providers = Providers::new(Arc::new(MemorySecrets::new(true)));
        providers.set_key("openai", "sk-test-12345678").unwrap();
        providers.set_key("groq", "gsk-test-12345678").unwrap();
        providers.forget_all();
        assert!(CATALOG.iter().all(|p| providers.key(p.id).is_none()));
    }
}
