//! Which web addresses the agent may use. Pages are untrusted and can try to steer the agent at things only this
//! computer can reach (a router's admin page, a local database, a cloud metadata service), so by default it stays
//! out of them. The person can still go anywhere themselves.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

const REFUSED: &str = "The agent is not allowed to use addresses on this computer or your local network. You can allow it in Settings, under Browser and Network.";
const LOCAL_SUFFIXES: [&str; 8] = [".localhost", ".local", ".lan", ".internal", ".home.arpa", ".localdomain", ".intranet", ".corp"];

fn private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 0 || a == 10 || a == 127 || (a == 100 && (64..=127).contains(&b)) || (a == 169 && b == 254) || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0) || (a == 192 && b == 168) || (a == 198 && (b == 18 || b == 19)) || a >= 224
}

fn private_v6(ip: Ipv6Addr) -> bool {
    let g = ip.segments();
    let embedded = Ipv4Addr::new((g[6] >> 8) as u8, (g[6] & 255) as u8, (g[7] >> 8) as u8, (g[7] & 255) as u8);
    if ip.is_unspecified() || ip.is_loopback() {
        return true;
    }
    if (g[0] & 0xfe00) == 0xfc00 || (g[0] & 0xffc0) == 0xfe80 {
        return true; // unique local, link-local
    }
    if g[..5].iter().all(|x| *x == 0) && (g[5] == 0xffff || g[5] == 0) {
        return private_v4(embedded); // IPv4 inside IPv6
    }
    if g[0] == 0x64 && g[1] == 0xff9b && g[2..6].iter().all(|x| *x == 0) {
        return private_v4(embedded); // NAT64
    }
    false
}

/// Whether this text is an IP address that belongs to this computer or a local network. Names are judged by
/// `is_private_name`.
pub fn is_private_address(text: &str) -> bool {
    let mut ip = text.trim();
    if ip.starts_with('[') && ip.ends_with(']') {
        ip = &ip[1..ip.len() - 1];
    }
    let ip = ip.split('%').next().unwrap_or("");
    match ip.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => private_v4(v4),
        Ok(IpAddr::V6(v6)) => private_v6(v6),
        Err(_) => false,
    }
}

/// Whether a host name means this computer or a local network: localhost, a local suffix, or a name with no dot.
pub fn is_private_name(name: &str) -> bool {
    let host = name.trim().to_lowercase();
    let host = host.strip_suffix('.').unwrap_or(&host);
    if host.is_empty() {
        return false;
    }
    host == "localhost" || LOCAL_SUFFIXES.iter().any(|s| host.ends_with(s)) || !host.contains('.')
}

#[derive(Debug, PartialEq, Eq)]
pub enum UrlCheck {
    Ok,
    Refused(String),
}

fn refused(reason: &str) -> UrlCheck {
    UrlCheck::Refused(reason.to_owned())
}

/// Judge a web address for the agent. `resolve` turns a host name into the IP addresses it points at.
pub fn check_agent_url(url: &str, resolve: impl Fn(&str) -> Option<Vec<String>>) -> UrlCheck {
    let Ok(parsed) = url::Url::parse(url) else { return refused("That is not a web address.") };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return refused("That is not a web address.");
    }
    // The URL parser has already turned 2130706433, 0x7f.0.0.1 and 127.1 into 127.0.0.1.
    match parsed.host() {
        Some(url::Host::Ipv4(ip)) => return if private_v4(ip) { refused(REFUSED) } else { UrlCheck::Ok },
        Some(url::Host::Ipv6(ip)) => return if private_v6(ip) { refused(REFUSED) } else { UrlCheck::Ok },
        Some(url::Host::Domain(name)) => {
            if is_private_name(name) {
                return refused(REFUSED);
            }
            return match resolve(name) {
                None => UrlCheck::Ok, // It cannot be reached at all, so there is nothing to protect.
                Some(found) if found.iter().any(|a| is_private_address(a)) => refused(REFUSED),
                Some(_) => UrlCheck::Ok,
            };
        }
        None => {}
    }
    refused("That is not a web address.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolves(map: &'static [(&'static str, &'static [&'static str])]) -> impl Fn(&str) -> Option<Vec<String>> {
        move |host| map.iter().find(|(h, _)| *h == host).map(|(_, ips)| ips.iter().map(|s| (*s).to_owned()).collect())
    }

    #[test]
    fn the_private_and_special_ipv4_ranges_are_recognised() {
        for ip in ["127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.1.1", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"] {
            assert!(is_private_address(ip), "{ip}");
        }
    }

    #[test]
    fn ordinary_public_addresses_are_left_alone_including_the_edges_of_the_private_ranges() {
        for ip in ["8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1", "192.167.1.1", "192.169.0.1", "11.0.0.1", "100.63.255.255", "100.128.0.1", "169.253.1.1"] {
            assert!(!is_private_address(ip), "{ip}");
        }
    }

    #[test]
    fn private_ipv6_including_addresses_that_wrap_an_ipv4_one() {
        for ip in ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::abcd%eth0", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:7f00:1", "[::1]", "FE80::1", "64:ff9b::7f00:1"] {
            assert!(is_private_address(ip), "{ip}");
        }
        for ip in ["2001:4860:4860::8888", "2606:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808"] {
            assert!(!is_private_address(ip), "{ip}");
        }
    }

    #[test]
    fn anything_that_is_not_an_address_is_not_private_names_are_judged_separately() {
        for x in ["", "example.com", "not an ip", "999.1.1.1", "1.2.3"] {
            assert!(!is_private_address(x), "{x}");
        }
    }

    #[test]
    fn names_that_mean_this_computer_or_a_local_network() {
        for name in ["localhost", "LOCALHOST", "foo.localhost", "printer.local", "nas.lan", "db.internal", "router.home.arpa", "intranet", "my-pc", "metadata.google.internal", "localhost."] {
            assert!(is_private_name(name), "{name}");
        }
        for name in ["example.com", "www.localhost.example.com", "internal.example.org", "local.dev", "a.b", ""] {
            assert!(!is_private_name(name), "{name}");
        }
    }

    #[test]
    fn a_public_address_is_allowed() {
        assert_eq!(check_agent_url("https://example.com/a", resolves(&[("example.com", &["93.184.216.34"])])), UrlCheck::Ok);
        assert_eq!(check_agent_url("http://93.184.216.34/", resolves(&[])), UrlCheck::Ok);
    }

    #[test]
    fn private_ip_numbers_are_refused_in_every_way_a_browser_accepts_them() {
        for url in ["http://127.0.0.1:8080/", "http://[::1]/", "http://10.1.1.1/admin", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://2130706433/", "http://0x7f.0.0.1/", "http://127.1/", "http://[::ffff:127.0.0.1]/"] {
            assert!(matches!(check_agent_url(url, resolves(&[])), UrlCheck::Refused(_)), "{url}");
        }
    }

    #[test]
    fn private_names_are_refused_without_looking_them_up() {
        let looked = std::cell::Cell::new(0);
        for url in ["http://localhost:3000/", "https://router.local/", "http://intranet/", "http://x.internal/"] {
            let r = check_agent_url(url, |_| {
                looked.set(looked.get() + 1);
                Some(vec!["8.8.8.8".into()])
            });
            assert!(matches!(r, UrlCheck::Refused(_)), "{url}");
        }
        assert_eq!(looked.get(), 0);
    }

    #[test]
    fn a_public_looking_name_that_points_at_a_private_address_is_refused_even_among_several() {
        assert!(matches!(check_agent_url("https://sneaky.example/", resolves(&[("sneaky.example", &["10.0.0.5"])])), UrlCheck::Refused(_)));
        assert!(matches!(check_agent_url("https://mixed.example/", resolves(&[("mixed.example", &["8.8.8.8", "127.0.0.1"])])), UrlCheck::Refused(_)));
    }

    #[test]
    fn a_name_that_cannot_be_found_goes_on_and_things_that_are_not_web_addresses_are_refused() {
        assert_eq!(check_agent_url("https://nowhere.example/", resolves(&[])), UrlCheck::Ok);
        for url in ["file:///c:/x", "javascript:alert(1)", "about:blank", "", "nonsense"] {
            assert!(matches!(check_agent_url(url, resolves(&[])), UrlCheck::Refused(_)), "{url}");
        }
    }

    #[test]
    fn the_reason_is_in_words_a_person_can_follow() {
        let UrlCheck::Refused(why) = check_agent_url("http://localhost:3000/", resolves(&[])) else { panic!() };
        assert!(why.contains("this computer or your local network"));
    }
}
