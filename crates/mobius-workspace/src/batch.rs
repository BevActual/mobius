//! Several of one tool's changes in one call. A plan of six tasks, or six suggested blocks, is one call the model
//! writes rather than six (each call it writes costs it time), and one answer back. The extra items go in `more`,
//! each shaped like the call itself; they stay in the call's own list or calendar, which is what was approved.

use serde_json::{Value, json};

/// Gives each named tool a `more` argument: further items like the call itself, without the scope key.
pub fn with_more(mut tools: Vec<Value>, names: &[&str], scope: &str) -> Vec<Value> {
    for tool in &mut tools {
        if !tool["name"].as_str().is_some_and(|n| names.contains(&n)) {
            continue;
        }
        let schema = &tool["input_schema"];
        let mut props = schema["properties"].as_object().cloned().unwrap_or_default();
        props.remove(scope);
        let required: Vec<Value> = schema["required"].as_array().cloned().unwrap_or_default().into_iter().filter(|r| r != scope).collect();
        let more = json!({ "type": "array", "description": format!("More of the same in this one call, each like this call itself, all in the same {scope}. Use it instead of calling again."),
            "items": { "type": "object", "properties": props, "required": required } });
        if let Some(p) = tool["input_schema"]["properties"].as_object_mut() {
            p.insert("more".into(), more);
        }
    }
    tools
}

/// Runs a call that has `more`: the call itself, then each item in the call's own scope, each with its own answer
/// (one that fails says why, and the rest still go). None when the call has no `more`.
pub fn run_more(args: &Value, scope: &str, run: impl Fn(&Value) -> Result<String, String>) -> Option<String> {
    let more = args.get("more")?.as_array()?;
    let within = args.get(scope).cloned().unwrap_or(Value::Null);
    let mut first = args.clone();
    if let Some(o) = first.as_object_mut() {
        o.remove("more");
    }
    let mut out = Vec::with_capacity(more.len() + 1);
    for item in std::iter::once(first).chain(more.iter().cloned()) {
        let Some(mut one) = item.as_object().cloned() else {
            out.push(json!({ "error": "each item in more is an object like the call itself" }));
            continue;
        };
        if one.get(scope).is_some_and(|s| *s != within) {
            out.push(json!({ "error": format!("every item in more stays in the call's own {scope}; use another call for another") }));
            continue;
        }
        one.remove("more");
        if !within.is_null() {
            one.insert(scope.into(), within.clone());
        }
        out.push(match run(&Value::Object(one)) {
            Ok(done) => serde_json::from_str(&done).unwrap_or(Value::String(done)),
            Err(e) => json!({ "error": e }),
        });
    }
    Some(Value::Array(out).to_string())
}
