//! A second model to try when the first one cannot answer.
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::message::ToolCall;
use crate::provider::{ChatRequest, Completion, Provider, ProviderError};

/// Whether a failure is the kind a second model could get past: the service is busy or down, cannot be reached, or
/// sent nonsense. A request the service rejected as wrong (bad key, unknown model, too large) is a mistake to show,
/// not to hide, and being stopped is not a failure at all.
#[must_use]
pub fn should_fall_back(error: &ProviderError) -> bool {
    match error {
        ProviderError::Http { status, .. } => *status == 408 || *status == 429 || (500..=599).contains(status),
        ProviderError::Network(_) | ProviderError::Protocol(_) => true,
        ProviderError::Cancelled => false,
    }
}

/// What went wrong, in a few words and without anything the service said, so it is safe to show.
fn summary(error: &ProviderError) -> String {
    match error {
        ProviderError::Http { status: 429, .. } => "the first model said it was too busy (HTTP 429)".to_owned(),
        ProviderError::Http { status, .. } => format!("the first model failed (HTTP {status})"),
        ProviderError::Network(_) => "the first model could not be reached".to_owned(),
        ProviderError::Protocol(_) => "the first model sent something unreadable".to_owned(),
        ProviderError::Cancelled => "the request was stopped".to_owned(),
    }
}

/// Tells whoever is listening that the second model is being used: its name, and in a few words why.
pub type OnSwitch = Box<dyn Fn(&str, &str) + Send + Sync>;

/// Asks the first provider, and if it fails in a way a second model could get past, asks the second with the same
/// request under the second's own model name. Never switches once any text has reached the person, since the second
/// model would start the answer again.
pub struct FallbackProvider {
    first: Arc<dyn Provider>,
    second: Arc<dyn Provider>,
    second_model: String,
    on_switch: OnSwitch,
}

impl FallbackProvider {
    pub fn new(first: Arc<dyn Provider>, second: Arc<dyn Provider>, second_model: impl Into<String>, on_switch: OnSwitch) -> Self {
        FallbackProvider { first, second, second_model: second_model.into(), on_switch }
    }
}

impl Provider for FallbackProvider {
    fn complete(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool) -> Result<Completion, ProviderError> {
        self.complete_with_calls(request, on_text, &mut |_| {})
    }

    /// Never switches once a call was given early either: it may have run, and the second model would do it again.
    fn complete_with_calls(&self, request: &ChatRequest, on_text: &mut dyn FnMut(&str) -> bool, on_call: &mut dyn FnMut(&ToolCall)) -> Result<Completion, ProviderError> {
        let spoke = AtomicBool::new(false);
        let first = self.first.complete_with_calls(
            request,
            &mut |text| {
                if !text.is_empty() {
                    spoke.store(true, Ordering::SeqCst);
                }
                on_text(text)
            },
            &mut |call| {
                spoke.store(true, Ordering::SeqCst);
                on_call(call);
            },
        );
        let error = match first {
            Ok(done) => return Ok(done),
            Err(error) => error,
        };
        if spoke.load(Ordering::SeqCst) || !should_fall_back(&error) {
            return Err(error);
        }
        (self.on_switch)(&self.second_model, &summary(&error));
        let mut again = request.clone();
        again.model.clone_from(&self.second_model);
        self.second.complete_with_calls(&again, on_text, on_call)
    }
}
