//! What starting the host takes beyond the window: the core's arguments, and for tests where the test settings point
//! (a fake model, a fake Claude Code, a fake ChatGPT). The shell uses it, and so does the dev bridge
//! (`dev_bridge.rs`), so the end-to-end tests drive the same host either way.

use std::path::Path;
use std::sync::Arc;

use crate::{Bridge, CoreProcess, Status};

/// The core's arguments: its databases in the profile's folder, models and engine state shared by every profile. Tests
/// add the demo tools and whatever fake servers their settings name.
#[must_use]
pub fn core_args(data_dir: &Path, base_dir: &Path, test_mode: bool) -> Vec<String> {
    let mut args = vec!["--db".into(), data_dir.join("core.db").display().to_string(), "--conversations".into(), data_dir.join("conversations.db").display().to_string()];
    args.extend(["--models-dir".into(), base_dir.join("models").display().to_string(), "--download-dir".into(), base_dir.join("models").display().to_string(), "--state-dir".into(), base_dir.display().to_string()]);
    if test_mode {
        args.extend(["--demo-tools".into(), "--no-default-models".into()]);
        let mut pass = |var: &str, flag: &str| {
            if let Ok(value) = std::env::var(var) {
                args.extend([flag.into(), value]);
            }
        };
        pass("MOBIUS_TEST_HUB", "--hub");
        pass("MOBIUS_TEST_ENGINE_RELEASES", "--engine-releases");
        pass("MOBIUS_TEST_LLAMA", "--llama-server");
        // A fake Claude Code CLI and a fake Anthropic server, so tests never touch a real subscription.
        pass("MOBIUS_TEST_CLAUDE", "--claude-command");
        pass("MOBIUS_TEST_CLAUDE_UPSTREAM", "--claude-upstream");
        // A pretend OpenAI: its sign-in (for the host) and its ChatGPT endpoint (for the core).
        if let Ok(openai) = std::env::var("MOBIUS_TEST_CHATGPT") {
            args.extend(["--chatgpt-upstream".into(), format!("{}/v1", openai.trim_end_matches('/'))]);
        }
    }
    args
}

/// Points a test's host at the fakes its settings name, and turns on the `test` hooks.
pub fn ready_for_tests(bridge: &Arc<Bridge>, core: &Arc<CoreProcess>) {
    if let Ok(url) = std::env::var("MOBIUS_AGENT_URL") {
        let model = std::env::var("MOBIUS_AGENT_MODEL").unwrap_or_else(|_| "test-model".into());
        let mut seed = serde_json::json!({ "baseUrl": url, "model": model });
        if let Ok(system) = std::env::var("MOBIUS_AGENT_SYSTEM") {
            seed["system"] = serde_json::json!(system);
        }
        let seeded = bridge.clone();
        let watcher = core.clone();
        std::thread::spawn(move || {
            while watcher.status() != Status::Ready {
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            let _ = seeded.seed_agent(&seed);
        });
    }
    bridge.enable_test_hooks();
    // `MOBIUS_TEST_PROVIDER=openai=http://127.0.0.1:1234/v1` points one provider at a local fake server.
    // Tests never ask the real Claude Code on this computer: without a fake one, there is none.
    let claude = std::env::var("MOBIUS_TEST_CLAUDE").unwrap_or_else(|_| "no-claude-in-tests".into());
    bridge.use_claude_for_tests(Path::new(&claude));
    if let Ok(openai) = std::env::var("MOBIUS_TEST_CHATGPT") {
        bridge.use_chatgpt_for_tests(&openai);
    }
    if let Some((id, url)) = std::env::var("MOBIUS_TEST_PROVIDER").ok().as_deref().and_then(|v| v.split_once('=')) {
        bridge.redirect_provider_for_tests(id, url);
    }
}
