//! Voice: listening (speech to text) and speaking (text to speech) with the services chosen in Settings, Voice. The
//! chat model's own server listens through `AgentService::transcribe`; this module talks to a speech server on this
//! computer in OpenAI's audio format (faster-whisper, Kokoro) and to ElevenLabs. Keys never leave the host: the window
//! sends sound or words and gets words or sound back.

use std::time::Duration;

use base64::Engine as _;
use serde_json::{Value, json};

/// The most words spoken in one go.
pub const MAX_SPEAK_CHARS: usize = 4000;
/// ElevenLabs's own default voice (Rachel), when none is chosen.
const ELEVENLABS_VOICE: &str = "21m00Tcm4TlvDq8ikWAM";

fn failed(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

fn http() -> ureq::Agent {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_global(Some(Duration::from_secs(90)))
        .build()
        .into()
}

/// A recording as a form, the way both OpenAI's format and ElevenLabs take it.
fn form(fields: &[(&str, &str)], bytes: &[u8], mime: &str) -> (String, Vec<u8>) {
    let boundary = format!("----mobius{:x}", bytes.len() ^ 0x5eed_4321);
    let ext = mime.split('/').nth(1).unwrap_or("webm");
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{ext}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

fn text_from(response: &mut ureq::http::Response<ureq::Body>, who: &str) -> Value {
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return failed(format!("{who} did not accept the key."));
    }
    if !(200..300).contains(&status) {
        return failed(format!("{who} did not accept the recording ({status})."));
    }
    let parsed = response.body_mut().with_config().limit(1024 * 1024).read_to_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let Some(text) = parsed.as_ref().and_then(|p| p.get("text")).and_then(Value::as_str) else { return failed(format!("{who} answered with something Mobius could not read.")) };
    let text: String = text.trim().chars().take(5000).collect();
    if text.is_empty() { failed("No speech was heard.") } else { json!({ "ok": true, "text": text }) }
}

/// Listening with a speech server on this computer, in OpenAI's audio format.
pub fn transcribe_local(base: &str, model: &str, bytes: &[u8], mime: &str) -> Value {
    let (kind, body) = form(&[("model", model), ("response_format", "json")], bytes, mime);
    match http().post(&format!("{}/audio/transcriptions", base.trim_end_matches('/'))).header("content-type", kind).send(&body[..]) {
        Ok(mut r) => text_from(&mut r, "The speech server on this computer"),
        Err(_) => failed(format!("Mobius could not reach the speech server at {base}.")),
    }
}

/// Listening with ElevenLabs. A Whisper model name means ElevenLabs's own model.
pub fn transcribe_elevenlabs(base: &str, key: &str, model: &str, bytes: &[u8], mime: &str) -> Value {
    let model = if model.starts_with("whisper") { "scribe_v1" } else { model };
    let (kind, body) = form(&[("model_id", model)], bytes, mime);
    match http().post(&format!("{}/speech-to-text", base.trim_end_matches('/'))).header("content-type", kind).header("xi-api-key", key).send(&body[..]) {
        Ok(mut r) => text_from(&mut r, "ElevenLabs"),
        Err(_) => failed("Mobius could not reach ElevenLabs."),
    }
}

fn audio_from(response: &mut ureq::http::Response<ureq::Body>, who: &str) -> Value {
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return failed(format!("{who} did not accept the key."));
    }
    if !(200..300).contains(&status) {
        return failed(format!("{who} could not speak that ({status})."));
    }
    let kind = response.headers().get("content-type").and_then(|v| v.to_str().ok()).map(|v| v.split(';').next().unwrap_or("").trim().to_owned()).filter(|v| v.starts_with("audio/")).unwrap_or_else(|| "audio/mpeg".to_owned());
    let Ok(bytes) = response.body_mut().with_config().limit(25 * 1024 * 1024).read_to_vec() else { return failed(format!("{who} answered with something Mobius could not play.")) };
    if bytes.is_empty() {
        return failed(format!("{who} sent no sound."));
    }
    json!({ "ok": true, "audio": format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) })
}

/// Speaking with a speech server on this computer, in OpenAI's audio format.
pub fn speak_local(base: &str, model: &str, voice: &str, text: &str) -> Value {
    let body = json!({ "model": model, "input": text, "voice": if voice.is_empty() { "af_heart" } else { voice }, "response_format": "mp3" });
    match http().post(&format!("{}/audio/speech", base.trim_end_matches('/'))).header("content-type", "application/json").send(body.to_string().as_bytes()) {
        Ok(mut r) => audio_from(&mut r, "The speech server on this computer"),
        Err(_) => failed(format!("Mobius could not reach the speech server at {base}.")),
    }
}

/// Speaking with ElevenLabs. Its voices are ids; a Kokoro model name means ElevenLabs's own model.
pub fn speak_elevenlabs(base: &str, key: &str, model: &str, voice: &str, text: &str) -> Value {
    let voice = if voice.is_empty() { ELEVENLABS_VOICE } else { voice };
    let model = if model == "kokoro" || model.is_empty() { "eleven_multilingual_v2" } else { model };
    let body = json!({ "text": text, "model_id": model });
    let url = format!("{}/text-to-speech/{}", base.trim_end_matches('/'), urlencode(voice));
    match http().post(&url).header("content-type", "application/json").header("accept", "audio/mpeg").header("xi-api-key", key).send(body.to_string().as_bytes()) {
        Ok(mut r) => audio_from(&mut r, "ElevenLabs"),
        Err(_) => failed("Mobius could not reach ElevenLabs."),
    }
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// The services to try for a job, in order: the chosen one, then its fallback, without "off" or a repeat.
#[must_use]
pub fn order<'a>(first: &'a str, fallback: &'a str) -> Vec<&'a str> {
    let mut out = Vec::new();
    for s in [first, fallback] {
        if s != "off" && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_order_is_the_choice_then_its_fallback_never_off_never_twice() {
        assert_eq!(order("local", "elevenlabs"), ["local", "elevenlabs"]);
        assert_eq!(order("chat", "chat"), ["chat"]);
        assert_eq!(order("off", "local"), ["local"]);
        assert!(order("off", "off").is_empty());
    }

    #[test]
    fn a_voice_id_is_safe_in_the_address() {
        assert_eq!(urlencode("a b/../c"), "a%20b%2F..%2Fc");
    }
}
