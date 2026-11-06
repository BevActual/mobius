//! Tab icons: which one to fetch, and whether what came back is a small picture.
use base64::Engine as _;

use crate::address::is_web_url;

pub const MAX_ICON_BYTES: usize = 64 * 1024;
const TYPES: [&str; 7] = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/// The first icon address the page offers that is a plain web address.
pub fn choose_icon(offered: &[String]) -> Option<&String> {
    offered.iter().find(|u| is_web_url(u))
}

/// An icon the page served, as a data address the window can show. Anything that is not a small picture is dropped.
pub fn icon_data_url(content_type: Option<&str>, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    let kind = content_type?.split(';').next()?.trim().to_lowercase();
    TYPES.contains(&kind.as_str()).then(|| format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_web_address_offered_is_chosen() {
        let offered = vec!["data:image/png;base64,AA".to_owned(), "file:///x.ico".to_owned(), "https://a.example/f.png".to_owned(), "https://b.example/g.png".to_owned()];
        assert_eq!(choose_icon(&offered).unwrap(), "https://a.example/f.png");
        assert!(choose_icon(&["javascript:1".to_owned()]).is_none());
        assert!(choose_icon(&[]).is_none());
    }

    #[test]
    fn small_pictures_become_data_addresses() {
        assert_eq!(icon_data_url(Some("image/png; charset=x"), &[1, 2, 3]).unwrap(), "data:image/png;base64,AQID");
        assert!(icon_data_url(Some("IMAGE/SVG+XML"), &[1]).is_some());
    }

    #[test]
    fn anything_else_is_dropped() {
        assert!(icon_data_url(None, &[1]).is_none());
        assert!(icon_data_url(Some("text/html"), &[1]).is_none());
        assert!(icon_data_url(Some("image/png"), &[]).is_none());
        assert!(icon_data_url(Some("image/png"), &vec![0; MAX_ICON_BYTES + 1]).is_none());
        assert!(icon_data_url(Some("image/png"), &vec![0; MAX_ICON_BYTES]).is_some());
    }
}
