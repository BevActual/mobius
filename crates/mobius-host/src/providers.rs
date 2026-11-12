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
    /// Gateways whose address is your own (an Azure resource, an AWS region): `base_url` holds `{}` where it goes.
    pub place: Option<Place>,
}

/// What the person names to make a gateway's address their own.
pub struct Place {
    pub label: &'static str,
    pub example: &'static str,
}

/// A place is a single name: letters, digits and dashes. It can only fill its slot, never point the key elsewhere.
pub fn is_place_text(place: &str) -> bool {
    (1..=63).contains(&place.len()) && place.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !place.starts_with('-') && !place.ends_with('-')
}

const fn placed(id: &'static str, name: &'static str, base_url: &'static str, note: &'static str, key_url: &'static str, label: &'static str, example: &'static str) -> Provider {
    Provider { id, name, base_url, note, key_url: Some(key_url), needs_key: true, voice_only: false, place: Some(Place { label, example }) }
}

const fn hosted(id: &'static str, name: &'static str, base_url: &'static str, note: &'static str, key_url: &'static str) -> Provider {
    Provider { id, name, base_url, note, key_url: Some(key_url), needs_key: true, voice_only: false, place: None }
}
const fn local(id: &'static str, name: &'static str, base_url: &'static str, note: &'static str) -> Provider {
    Provider { id, name, base_url, note, key_url: None, needs_key: false, voice_only: false, place: None }
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
    hosted("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "Very fast hosted open models.", "https://cloud.cerebras.ai/"),
    hosted("perplexity", "Perplexity", "https://api.perplexity.ai", "Sonar models that search the web as they answer.", "https://www.perplexity.ai/account/api/keys"),
    hosted("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "Command models, through their OpenAI-compatible layer.", "https://dashboard.cohere.com/api-keys"),
    hosted("moonshot", "Moonshot AI (Kimi)", "https://api.moonshot.ai/v1", "Kimi models.", "https://platform.moonshot.ai/console/api-keys"),
    hosted("qwen", "Alibaba Cloud (Qwen)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "Qwen models from Model Studio.", "https://modelstudio.console.alibabacloud.com/"),
    hosted("zai", "Z.ai (GLM)", "https://api.z.ai/api/paas/v4", "GLM models.", "https://z.ai/manage-apikey/apikey-list"),
    hosted("nvidia", "NVIDIA", "https://integrate.api.nvidia.com/v1", "Open models hosted by NVIDIA.", "https://build.nvidia.com/settings/api-keys"),
    placed("azure", "Azure OpenAI", "https://{}.openai.azure.com/openai/v1", "OpenAI models in your own Azure resource.", "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI", "Azure resource name", "my-resource"),
    placed("bedrock", "Amazon Bedrock", "https://bedrock-runtime.{}.amazonaws.com/openai/v1", "Models on Amazon Bedrock, with a Bedrock API key.", "https://console.aws.amazon.com/bedrock/home#/api-keys", "AWS region", "us-west-2"),
    local("ollama", "Ollama", "http://127.0.0.1:11434/v1", "Models you run with Ollama on this computer. No key needed."),
    local("lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", "The local server in LM Studio on this computer. No key needed."),
    local("llamacpp", "llama.cpp", "http://127.0.0.1:8080/v1", "A llama-server you started on this computer. No key needed."),
    Provider { id: "elevenlabs", name: "ElevenLabs", base_url: "https://api.elevenlabs.io/v1", note: "Voice only: listening and speaking, in Settings, Voice.", key_url: Some("https://elevenlabs.io/app/settings/api-keys"), needs_key: true, voice_only: true, place: None },
];

/// Plans you sign in to instead of pasting a key. Each runs through the service's own app on this computer.
pub struct Subscription {
    pub id: &'static str,
    pub name: &'static str,
    pub address: &'static str,
    pub note: &'static str,
    /// How signing in works: `cli` (the service's own app keeps the sign-in) or `device` (a code you enter on the
    /// service's site), or `browser` (you sign in on the service's page and come back; Mobius keeps the token in the system
    /// secret store).
    pub kind: &'static str,
}

pub const CLAUDE_CODE_ADDRESS: &str = "claude-code://subscription";

pub const CHATGPT_ADDRESS: &str = "chatgpt://subscription";

pub const COPILOT_ADDRESS: &str = "copilot://subscription";

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
        note: "Your ChatGPT plan, through OpenAI's Sign in with ChatGPT for open-source apps. Requests count against your plan's usage. You sign in on ChatGPT's own page; the sign-in is kept in this computer's secret store and only ever sent to OpenAI.",
        kind: "browser",
    },
    Subscription {
        id: "copilot",
        name: "GitHub Copilot",
        address: COPILOT_ADDRESS,
        note: "Your GitHub Copilot plan, through GitHub's Copilot CLI on this computer. Requests count against your plan's premium requests. You sign in with GitHub using a code; the sign-in is kept in this computer's secret store and only ever sent to GitHub.",
        kind: "browser",
    },
];

/// Models to offer for the ChatGPT plan when OpenAI's own list for the account cannot be had, newest first.
pub const CHATGPT_MODELS: &[(&str, &str)] = &[("gpt-5.5", "GPT-5.5"), ("gpt-5.4", "GPT-5.4"), ("gpt-5.4-mini", "GPT-5.4 mini"), ("gpt-6-sol", "GPT-6 Sol"), ("gpt-6-luna", "GPT-6 Luna")];

pub fn subscription_models(s: &Subscription) -> &'static [(&'static str, &'static str)] {
    match s.address {
        CHATGPT_ADDRESS => CHATGPT_MODELS,
        COPILOT_ADDRESS => mobius_claude::copilot::MODELS,
        _ => mobius_claude::frames::MODELS,
    }
}

pub fn find_subscription(id: &str) -> Option<&'static Subscription> {
    SUBSCRIPTIONS.iter().find(|s| s.id == id)
}

/// Models to offer when a gateway does not list its own (some answer chat but have no list of models). Asking the
/// gateway always comes first; this is only what to show when it cannot say.
pub fn known_models(base_url: &str) -> &'static [&'static str] {
    match CATALOG.iter().find(|p| same_address(p.base_url, base_url) || fits_template(p.base_url, base_url)).map(|p| p.id) {
        Some("perplexity") => &["sonar", "sonar-pro", "sonar-reasoning-pro", "sonar-deep-research"],
        Some("cohere") => &["command-a-03-2025", "command-r-plus-08-2024", "command-r-08-2024", "command-r7b-12-2024"],
        Some("zai") => &["glm-4.6", "glm-4.5", "glm-4.5-air"],
        Some("bedrock") => &["openai.gpt-oss-120b-1:0", "openai.gpt-oss-20b-1:0"],
        Some("qwen") => &["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-coder-plus"],
        _ => &[],
    }
}

pub fn find(id: &str) -> Option<&'static Provider> {
    CATALOG.iter().find(|p| p.id == id)
}

/// A key as pasted: printable, no spaces inside, a sensible length.
pub fn is_key_text(key: &str) -> bool {
    (8..=500).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

/// The gateway you can sign in to on its own site, which then hands Mobius a key (see `key_sign_in`).
pub const KEY_SIGN_IN: &str = "openrouter";

fn secret_name(id: &str) -> String {
    format!("provider-{id}")
}

/// Whether an address is this template with a place filled in.
fn fits_template(template: &str, address: &str) -> bool {
    let Some((before, after)) = template.split_once("{}") else { return false };
    let address = address.trim().trim_end_matches('/').to_ascii_lowercase();
    address.len() > before.len() + after.len()
        && address.starts_with(&before.to_ascii_lowercase())
        && address.ends_with(&after.to_ascii_lowercase())
        && is_place_text(&address[before.len()..address.len() - after.len()])
}

fn place_name(id: &str) -> String {
    format!("provider-{id}-place")
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

    /// Where this provider's requests go. A gateway with a place has no address until its place is named.
    pub fn address(&self, id: &str) -> Option<String> {
        let provider = find(id)?;
        if let Some(url) = lock(&self.redirected).get(id).cloned() {
            return Some(url);
        }
        match provider.place {
            Some(_) => self.place(id).map(|place| provider.base_url.replace("{}", &place)),
            None => Some(provider.base_url.to_owned()),
        }
    }

    /// The Azure resource or AWS region named for this gateway.
    pub fn place(&self, id: &str) -> Option<String> {
        find(id)?.place.as_ref()?;
        lock(&self.session).get(&place_name(id)).cloned().or_else(|| self.secrets.get(&place_name(id)))
    }

    /// Set a gateway's key and, for one with a place, the place it lives (both at once, so neither is left half set).
    pub fn set_key_at(&self, id: &str, key: &str, place: Option<&str>) -> Result<&'static str, String> {
        let provider = find(id).ok_or("That provider is not known.")?;
        let place = match (&provider.place, place.map(|p| p.trim().to_ascii_lowercase())) {
            (Some(_), Some(given)) if is_place_text(&given) => Some(given),
            (Some(p), _) => return Err(format!("Give the {} (letters, digits and dashes), such as {}.", p.label, p.example)),
            (None, _) => None,
        };
        let storage = self.set_key(id, key)?;
        if let Some(place) = place {
            lock(&self.session).remove(&place_name(id));
            if !(storage == "keychain" && self.secrets.put(&place_name(id), &place)) {
                lock(&self.session).insert(place_name(id), place);
            }
        }
        Ok(storage)
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
            lock(&self.session).remove(&place_name(id));
            self.secrets.delete(&place_name(id));
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
                    "id": p.id, "name": p.name, "baseUrl": self.address(p.id).unwrap_or_else(|| p.base_url.to_owned()),
                    "place": p.place.as_ref().map(|place| json!({ "label": place.label, "example": place.example, "value": self.place(p.id) })), "note": p.note, "keyUrl": p.key_url,
                    "needsKey": p.needs_key, "voiceOnly": p.voice_only, "canSignIn": p.id == KEY_SIGN_IN, "hasKey": self.key(p.id).is_some(), "active": active == Some(p.id),
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
            assert_eq!(p.place.is_some(), p.base_url.contains("{}"), "{}", p.id);
        }
    }

    #[test]
    fn a_gateway_without_a_list_of_models_still_offers_its_known_ones() {
        assert!(known_models("https://api.perplexity.ai/").contains(&"sonar"));
        assert!(known_models("HTTPS://api.cohere.ai/compatibility/v1").iter().any(|m| m.starts_with("command")));
        assert!(known_models("https://api.openai.com/v1").is_empty());
        for id in ["cerebras", "perplexity", "cohere", "moonshot", "qwen", "zai", "nvidia"] {
            assert!(find(id).is_some_and(|p| p.needs_key), "{id}");
        }
    }

    #[test]
    fn a_gateway_at_your_own_address_needs_its_place_and_keeps_the_key_there() {
        let p = Providers::new(Arc::new(MemorySecrets::default()));
        assert_eq!(p.address("azure"), None);
        assert!(p.set_key_at("azure", "azure-key-12345", None).is_err());
        for bad in ["evil.com/x", "a b", "-a", "x.y", ""] {
            assert!(p.set_key_at("azure", "azure-key-12345", Some(bad)).is_err(), "{bad}");
        }
        assert!(p.key("azure").is_none());
        p.set_key_at("azure", "azure-key-12345", Some("My-Resource")).unwrap();
        assert_eq!(p.address("azure").as_deref(), Some("https://my-resource.openai.azure.com/openai/v1"));
        assert_eq!(p.id_for_address("https://my-resource.openai.azure.com/openai/v1/"), Some("azure"));
        p.set_key_at("bedrock", "bedrock-key-12345", Some("us-west-2")).unwrap();
        assert!(known_models("https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1").iter().any(|m| m.contains("gpt-oss")));
        let listed = p.list("");
        let azure = listed.as_array().unwrap().iter().find(|r| r["id"] == "azure").unwrap();
        assert_eq!(azure["place"]["value"], "my-resource");
        p.remove_key("azure");
        assert_eq!(p.address("azure"), None);
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
