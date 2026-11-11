//! Making pictures, for Photo, Design and Slides: the model chosen in Settings, Models, Images, on a gateway that makes
//! them. OpenAI and its kin answer `POST /images/generations` with the picture as base64; OpenRouter makes pictures
//! through chat completions with `modalities: ["image", "text"]` and answers with a `data:` address.

use std::time::Duration;

use serde_json::{Value, json};

/// The most a picture's answer may be: a large PNG as base64, with room to spare.
const MAX_BODY: u64 = 40 * 1024 * 1024;

/// Image models Settings offers for each gateway that makes pictures. The person can only choose a gateway they have a
/// key for.
pub const MODELS: &[(&str, &str, &str)] = &[
    ("openai", "gpt-image-1", "GPT Image"),
    ("openai", "dall-e-3", "DALL·E 3"),
    ("openrouter", "google/gemini-2.5-flash-image", "Gemini Flash Image"),
    ("openrouter", "openai/gpt-5-image-mini", "GPT-5 Image Mini"),
    ("together", "black-forest-labs/FLUX.1-schnell", "FLUX.1 schnell"),
    ("xai", "grok-2-image", "Grok 2 Image"),
];

pub fn tool_descriptions() -> Vec<Value> {
    vec![json!({
        "name": "images.generate",
        "description": "Make a picture from a description, with the image model chosen in Settings, Models, Images, and keep it in the Photo app (album Made by Mobius unless another is named). Answers with the picture's path, such as photos/Made by Mobius/Harbour at dawn.png, to use in a design, a deck or a document. Each picture may cost money on the person's account.",
        "capability": "images.generate",
        "input_schema": { "type": "object", "properties": {
            "prompt": { "type": "string", "description": "What the picture shows, its style and its mood, in a few sentences." },
            "name": { "type": "string", "description": "A short name for the file, without the extension." },
            "album": { "type": "string", "description": "The Photo album to keep it in." },
            "shape": { "type": "string", "enum": ["square", "wide", "tall"], "description": "Square when left out." }
        }, "required": ["prompt"] }
    })]
}

pub fn is_image_tool(name: &str) -> bool {
    name == "images.generate"
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().max_redirects(0).http_status_as_error(false).timeout_connect(Some(Duration::from_secs(10))).timeout_global(Some(Duration::from_secs(180))).build().into()
}

fn read_json(response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value), String> {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(response.into_body().into_reader(), MAX_BODY), &mut body).map_err(|e| e.to_string())?;
    Ok((status, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

fn problem(service: &str, status: u16, body: &Value) -> String {
    let said = body.pointer("/error/message").or_else(|| body.get("error")).and_then(Value::as_str).unwrap_or("");
    let said: String = said.chars().take(300).collect();
    if said.is_empty() { format!("{service} could not make the picture (HTTP {status}).") } else { format!("{service} could not make the picture: {said}") }
}

/// Make one picture. Answers with the picture as base64 (PNG unless the service says otherwise).
pub fn generate(base_url: &str, key: Option<&str>, model: &str, prompt: &str, shape: &str) -> Result<String, String> {
    let base = base_url.trim_end_matches('/');
    let post = |path: &str, body: Value| {
        let mut request = agent().post(&format!("{base}{path}")).header("Content-Type", "application/json");
        if let Some(key) = key {
            request = request.header("Authorization", &format!("Bearer {key}"));
        }
        request.send(body.to_string().as_bytes()).map_err(|e| format!("Could not reach the image service: {e}")).and_then(read_json)
    };
    if base.contains("openrouter.ai") {
        let aspect = match shape { "wide" => "16:9", "tall" => "9:16", _ => "1:1" };
        let (status, body) = post("/chat/completions", json!({ "model": model, "messages": [{ "role": "user", "content": prompt }], "modalities": ["image", "text"], "image_config": { "aspect_ratio": aspect } }))?;
        if status != 200 {
            return Err(problem("OpenRouter", status, &body));
        }
        let url = body.pointer("/choices/0/message/images/0/image_url/url").and_then(Value::as_str).ok_or("OpenRouter answered without a picture. Choose a model that makes pictures in Settings, Models, Images.")?;
        return url.split_once("base64,").map(|(_, b64)| b64.to_owned()).ok_or_else(|| "OpenRouter answered with a picture Mobius cannot keep.".to_owned());
    }
    let size = match (model.starts_with("dall-e-3"), shape) {
        (true, "wide") => "1792x1024",
        (true, "tall") => "1024x1792",
        (false, "wide") => "1536x1024",
        (false, "tall") => "1024x1536",
        _ => "1024x1024",
    };
    let mut request = json!({ "model": model, "prompt": prompt, "n": 1, "size": size });
    // GPT Image always answers with base64; the older models are asked to.
    if !model.starts_with("gpt-image") {
        request["response_format"] = json!("b64_json");
    }
    let (status, body) = post("/images/generations", request)?;
    if status != 200 {
        return Err(problem("The image service", status, &body));
    }
    body.pointer("/data/0/b64_json").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "The image service answered without a picture.".to_owned())
}

/// A file name for the picture, from its name or the start of its description.
pub fn file_name(name: Option<&str>, prompt: &str) -> String {
    let from = name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(prompt);
    let words: String = from.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').collect::<String>().split_whitespace().take(8).collect::<Vec<_>>().join(" ");
    let stem: String = words.chars().take(60).collect();
    format!("{}.png", if stem.trim().is_empty() { "Picture" } else { stem.trim() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_is_named_by_its_name_or_its_description() {
        assert_eq!(file_name(Some("Harbour at dawn"), "x"), "Harbour at dawn.png");
        assert_eq!(file_name(None, "A red kite over the hills, at sunset, painted in watercolour with soft edges"), "A red kite over the hills at sunset.png");
        assert_eq!(file_name(Some("../../etc"), "x"), "etc.png");
        assert_eq!(file_name(None, "!!!"), "Picture.png");
        assert!(MODELS.iter().all(|(id, _, _)| crate::providers::find(id).is_some()));
    }
}
