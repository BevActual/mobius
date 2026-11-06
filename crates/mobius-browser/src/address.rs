//! The address field takes both addresses and questions. This is the single place that decides which. It is
//! deliberately conservative: only http(s) pages can ever be loaded into a browser surface.
use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum Address {
    Url(String),
    Ask(String),
    Blocked(&'static str),
    Empty,
}

const MAX_INPUT: usize = 2048;

fn scheme(input: &str) -> Option<String> {
    let colon = input.find(':')?;
    let s = &input[..colon];
    let mut chars = s.chars();
    (chars.next()?.is_ascii_alphabetic() && chars.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))).then(|| s.to_lowercase())
}

/// `host:port` followed by a path, query, fragment or nothing.
fn looks_like_host_port(input: &str) -> bool {
    let Some(colon) = input.find(':') else { return false };
    let (host, rest) = (&input[..colon], &input[colon + 1..]);
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return false;
    }
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    (1..=5).contains(&digits) && rest[digits..].chars().next().is_none_or(|c| "/?#".contains(c))
}

fn host_like(input: &str) -> bool {
    let end = input.find(['/', '?', '#']).unwrap_or(input.len());
    let authority = &input[..end];
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) => (h, true),
        Some(_) => return false,
        None => (authority, false),
    };
    let _ = port;
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() == 4 && labels.iter().all(|l| (1..=3).contains(&l.len()) && l.bytes().all(|b| b.is_ascii_digit())) {
        return true;
    }
    labels.len() >= 2 && labels.iter().all(|l| !l.is_empty() && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

fn loopback(input: &str) -> bool {
    let lower = input.to_lowercase();
    let host_end = lower.find([':', '/']).unwrap_or(lower.len());
    let host = &lower[..host_end];
    host == "localhost" || host == "[::1]" || (host.starts_with("127") && host.split('.').count() == 4 && host.split('.').all(|p| (1..=3).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit())))
}

fn finish(candidate: &str) -> Address {
    let Ok(url) = Url::parse(candidate) else { return Address::Blocked("invalid") };
    if url.scheme() != "http" && url.scheme() != "https" {
        return Address::Blocked("scheme");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Address::Blocked("credentials");
    }
    Address::Url(url.to_string())
}

pub fn resolve_address(raw: &str) -> Address {
    let input = raw.trim();
    if input.is_empty() {
        return Address::Empty;
    }
    if input.chars().count() > MAX_INPUT {
        return Address::Blocked("too-long");
    }
    // "localhost:5173" parses as a scheme, so treat host:port as a host, not a scheme.
    if let Some(s) = scheme(input).filter(|_| !looks_like_host_port(input)) {
        if s != "http" && s != "https" {
            return Address::Blocked("scheme");
        }
        return finish(input);
    }
    if input.chars().any(char::is_whitespace) || !host_like(input) {
        return Address::Ask(input.to_owned());
    }
    finish(&format!("{}{input}", if loopback(input) { "http://" } else { "https://" }))
}

/// A web address, exactly as the browser would load it. Only http(s) pages without credentials.
pub fn is_web_url(text: &str) -> bool {
    Url::parse(text).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Address {
        Address::Url(s.into())
    }

    #[test]
    fn full_http_and_https_addresses_are_kept() {
        assert_eq!(resolve_address("https://example.com/a?b=1"), url("https://example.com/a?b=1"));
        assert_eq!(resolve_address("http://example.com"), url("http://example.com/"));
    }

    #[test]
    fn bare_hosts_get_https() {
        assert_eq!(resolve_address("example.com"), url("https://example.com/"));
        assert_eq!(resolve_address("docs.example.co.uk/path"), url("https://docs.example.co.uk/path"));
    }

    #[test]
    fn localhost_and_loopback_get_http() {
        assert_eq!(resolve_address("localhost:5173"), url("http://localhost:5173/"));
        assert_eq!(resolve_address("127.0.0.1:8080/x"), url("http://127.0.0.1:8080/x"));
    }

    #[test]
    fn anything_with_spaces_or_a_question_mark_is_a_question_for_the_agent() {
        assert_eq!(resolve_address("what is a webview"), Address::Ask("what is a webview".into()));
        assert_eq!(resolve_address("is example.com safe?"), Address::Ask("is example.com safe?".into()));
    }

    #[test]
    fn a_single_word_with_no_dot_is_a_question_not_a_host() {
        assert_eq!(resolve_address("electron"), Address::Ask("electron".into()));
    }

    #[test]
    fn dangerous_and_internal_schemes_are_blocked() {
        for bad in ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "file:///C:/Windows/win.ini", "chrome://settings", "devtools://devtools", "vbscript:x", "about:blank#x"] {
            assert!(matches!(resolve_address(bad), Address::Blocked(_)), "{bad}");
        }
    }

    #[test]
    fn addresses_with_embedded_credentials_are_blocked() {
        assert!(matches!(resolve_address("https://user:pass@example.com"), Address::Blocked("credentials")));
    }

    #[test]
    fn whitespace_is_ignored_and_empty_input_is_empty() {
        assert_eq!(resolve_address("  example.com  "), url("https://example.com/"));
        assert_eq!(resolve_address("   "), Address::Empty);
        assert_eq!(resolve_address(""), Address::Empty);
    }

    #[test]
    fn absurdly_long_input_is_blocked() {
        assert!(matches!(resolve_address(&format!("{}.com", "a".repeat(5000))), Address::Blocked("too-long")));
    }

    #[test]
    fn only_plain_web_addresses_count_as_web_addresses() {
        assert!(is_web_url("https://a.example/x"));
        assert!(is_web_url("http://127.0.0.1:1/"));
        for bad in ["file:///x", "javascript:1", "data:text/html,x", "chrome://x", "about:blank", "nope", ""] {
            assert!(!is_web_url(bad), "{bad}");
        }
    }
}
