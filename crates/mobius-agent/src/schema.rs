//! Checking a model's structured answer against its JSON schema, in code: what the service promised is checked again,
//! and an answer from a service that cannot follow a schema is held to the same bar.
//!
//! Only the part of JSON Schema that answer formats use: `type`, `enum`, `properties`, `required`,
//! `additionalProperties: false` and `items`. Anything else in a schema is not checked.
use serde_json::Value;

/// The JSON object in a model's answer: the whole answer, or the object inside a code fence or a sentence.
pub fn json_in(text: &str) -> Option<Value> {
    let text = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some(v);
    }
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// The answer's JSON when it follows `schema`, or what is wrong with it.
pub fn check_answer(schema: &Value, text: &str) -> Result<Value, String> {
    let value = json_in(text).ok_or_else(|| "the answer is not JSON".to_owned())?;
    check(schema, &value, "answer")?;
    Ok(value)
}

/// Whether `value` follows `schema`; otherwise where it does not, by its path (`answer.group`).
pub fn check(schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    if let Some(kind) = schema.get("type") {
        let kinds: Vec<&str> = match kind {
            Value::String(k) => vec![k.as_str()],
            Value::Array(ks) => ks.iter().filter_map(Value::as_str).collect(),
            _ => Vec::new(),
        };
        if !kinds.is_empty() && !kinds.iter().any(|k| is_type(value, k)) {
            return Err(format!("{at} should be {}", kinds.join(" or ")));
        }
    }
    if let Some(Value::Array(allowed)) = schema.get("enum") {
        if !allowed.contains(value) {
            return Err(format!("{at} is not one of the values allowed"));
        }
    }
    if let Value::Object(fields) = value {
        let properties = schema.get("properties").and_then(Value::as_object);
        for name in schema.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if !fields.contains_key(name) {
                return Err(format!("{at}.{name} is missing"));
            }
        }
        for (name, field) in fields {
            match properties.and_then(|p| p.get(name)) {
                Some(inner) => check(inner, field, &format!("{at}.{name}"))?,
                None if schema.get("additionalProperties") == Some(&Value::Bool(false)) => return Err(format!("{at}.{name} is not expected")),
                None => {}
            }
        }
    }
    if let (Value::Array(items), Some(inner)) = (value, schema.get("items")) {
        for (i, item) in items.iter().enumerate() {
            check(inner, item, &format!("{at}[{i}]"))?;
        }
    }
    Ok(())
}

fn is_type(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_f64().is_some_and(|n| n.fract() == 0.0),
        "number" => value.is_number(),
        "null" => value.is_null(),
        _ => true,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sort() -> Value {
        json!({
            "type": "object",
            "properties": {
                "why": { "type": "string" },
                "group": { "type": "string", "enum": ["reply", "later", "archive"] },
                "urgent": { "type": "boolean" },
            },
            "required": ["why", "group", "urgent"],
            "additionalProperties": false,
        })
    }

    #[test]
    fn an_answer_that_follows_the_schema_is_taken_even_inside_a_fence() {
        let v = check_answer(&sort(), "```json\n{\"why\": \"asks a date\", \"group\": \"reply\", \"urgent\": true}\n```").unwrap();
        assert_eq!(v["group"], "reply");
    }

    #[test]
    fn what_is_wrong_is_said_by_its_place() {
        assert_eq!(check_answer(&sort(), "Sure! It's for later.").unwrap_err(), "the answer is not JSON");
        assert_eq!(check_answer(&sort(), r#"{"why": "", "group": "maybe", "urgent": false}"#).unwrap_err(), "answer.group is not one of the values allowed");
        assert_eq!(check_answer(&sort(), r#"{"why": "", "group": "later"}"#).unwrap_err(), "answer.urgent is missing");
        assert_eq!(check_answer(&sort(), r#"{"why": "", "group": "later", "urgent": "yes"}"#).unwrap_err(), "answer.urgent should be boolean");
        assert_eq!(check_answer(&sort(), r#"{"why": "", "group": "later", "urgent": false, "extra": 1}"#).unwrap_err(), "answer.extra is not expected");
        let list = json!({ "type": "array", "items": { "type": "integer" } });
        assert_eq!(check(&list, &json!([1, 2.5]), "answer").unwrap_err(), "answer[1] should be integer");
    }
}
