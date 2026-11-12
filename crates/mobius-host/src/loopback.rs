//! The one-time page on this computer that a browser sign-in comes back to (OAuth's loopback redirect). It listens on
//! 127.0.0.1 only, only while the sign-in is waiting, and only accepts the `state` it sent. Anything else (a favicon,
//! a stray page, an old link) is turned away and the wait goes on.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

pub fn random_text(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|e| format!("No randomness for the sign-in: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// The S256 code challenge for a verifier: base64url of its SHA-256, without padding.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A version 4 UUID, as text.
pub fn uuid() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

fn page(title: &str, text: &str) -> String {
    let escape = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{t}</title><style>body{{font:15px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#222;background:#f5f5f7}}@media(prefers-color-scheme:dark){{body{{color:#eee;background:#1c1c1e}}}}main{{max-width:28rem;text-align:center}}h1{{font-size:20px}}</style></head><body><main><h1>{t}</h1><p>{x}</p></main></body></html>",
        t = escape(title),
        x = escape(text)
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(body.as_bytes())).and_then(|()| stream.flush());
}

pub struct Callback {
    listener: TcpListener,
    path: &'static str,
    port: u16,
}

impl Callback {
    /// Listen on a free port of 127.0.0.1 for `path`.
    pub fn listen(path: &'static str) -> Result<Callback, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not listen for the sign-in: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        Ok(Callback { listener, path, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Wait for the browser to come back with `state`, then let `finish` turn its query into the result. A declined
    /// sign-in (`error=...`) ends the wait with an error; so do `cancel` and running out of time.
    pub fn wait<T>(&self, service: &str, state: &str, cancel: &AtomicBool, max_wait: Duration, mut finish: impl FnMut(&HashMap<String, String>) -> Result<T, String>) -> Result<T, String> {
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            if started.elapsed() > max_wait {
                return Err(format!("The sign-in timed out after {} minutes. Try again.", max_wait.as_secs() / 60));
            }
            match self.listener.accept() {
                Ok((mut stream, _)) => {
                    let Some(query) = self.read(&mut stream) else { continue };
                    if query.get("state").map(String::as_str) != Some(state) {
                        respond(&mut stream, "400 Bad Request", &page("This sign-in is out of date", "Start the sign-in again from Mobius Settings."));
                        continue;
                    }
                    if let Some(error) = query.get("error") {
                        respond(&mut stream, "200 OK", &page("Sign-in cancelled", "You can close this tab and go back to Mobius."));
                        return Err(if error == "access_denied" { format!("The sign-in was declined on {service}.") } else { format!("{service} stopped the sign-in ({}).", error.chars().take(60).collect::<String>()) });
                    }
                    let result = finish(&query);
                    match &result {
                        Ok(_) => respond(&mut stream, "200 OK", &page("You're signed in", "You can close this tab and go back to Mobius.")),
                        Err(e) => respond(&mut stream, "200 OK", &page("Sign-in didn't finish", e)),
                    }
                    return result;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("The sign-in stopped listening: {e}")),
            }
        }
    }

    /// The query of a request for the callback path; other paths get a 404 and `None`.
    fn read(&self, stream: &mut TcpStream) -> Option<HashMap<String, String>> {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut line = String::new();
        BufReader::new(Read::by_ref(stream).take(8 * 1024)).read_line(&mut line).ok()?;
        let target = line.split_whitespace().nth(1).unwrap_or("");
        match url::Url::parse(&format!("http://127.0.0.1{target}")).ok().filter(|u| u.path() == self.path) {
            Some(u) => Some(u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect()),
            None => {
                respond(stream, "404 Not Found", &page("Not here", "This address is only for signing in to Mobius."));
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_base64url_sha256() {
        // The example from RFC 7636, appendix B.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn a_uuid_is_version_4() {
        let id = uuid().unwrap();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
    }
}
