/// Only plain web pages are ever kept.
pub fn is_web_url(text: &str) -> bool {
    url::Url::parse(text).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

pub fn clean_title(title: &str, url: &str, max: usize) -> String {
    let t = title.trim();
    if t.is_empty() { url.to_owned() } else { t.chars().take(max).collect() }
}

/// Every word of the query is in the title or the address, ignoring case.
pub fn matches(query: &str, title: &str, url: &str) -> bool {
    let (title, url) = (title.to_lowercase(), url.to_lowercase());
    query.to_lowercase().split_whitespace().all(|w| title.contains(w) || url.contains(w))
}
