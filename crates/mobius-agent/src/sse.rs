//! Server-sent events: turns a byte stream into the `data:` payload of each event.
//!
//! Works on bytes and only decodes complete lines, so a multi-byte character split across reads is safe, and a peer
//! that never sends a newline cannot make it buffer without bound.

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_EVENT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub struct SseParser {
    line: Vec<u8>,
    line_overflowed: bool,
    skip_lf: bool,
    data: Vec<String>,
    has_data: bool,
    event_bytes: usize,
}

impl SseParser {
    pub fn new() -> Self {
        SseParser::default()
    }

    /// Feed bytes; returns the data payload of every event completed by them.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut events = Vec::new();
        for &byte in bytes {
            if byte == b'\n' && self.skip_lf {
                self.skip_lf = false;
                continue;
            }
            self.skip_lf = false;
            match byte {
                b'\r' => {
                    self.skip_lf = true;
                    self.end_line(&mut events);
                }
                b'\n' => self.end_line(&mut events),
                _ if self.line.len() >= MAX_LINE_BYTES => self.line_overflowed = true,
                _ => self.line.push(byte),
            }
        }
        events
    }

    /// The stream ended: return a final event that was not followed by a blank line.
    pub fn finish(&mut self) -> Option<String> {
        let mut events = Vec::new();
        if !self.line.is_empty() || self.line_overflowed {
            self.end_line(&mut events);
        }
        if self.has_data {
            events.push(self.data.join("\n"));
            self.reset_event();
        }
        events.into_iter().next()
    }

    fn reset_event(&mut self) {
        self.data.clear();
        self.has_data = false;
        self.event_bytes = 0;
    }

    fn end_line(&mut self, events: &mut Vec<String>) {
        let raw = std::mem::take(&mut self.line);
        if std::mem::take(&mut self.line_overflowed) {
            return;
        }
        let line = String::from_utf8_lossy(&raw);
        if line.is_empty() {
            if self.has_data {
                events.push(self.data.join("\n"));
            }
            self.reset_event();
            return;
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (&*line, ""),
        };
        if field == "data" && self.event_bytes + value.len() <= MAX_EVENT_BYTES {
            self.event_bytes += value.len();
            self.data.push(value.to_owned());
            self.has_data = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(chunks: &[&str]) -> Vec<String> {
        let mut p = SseParser::new();
        let mut out = Vec::new();
        for c in chunks {
            out.extend(p.push(c.as_bytes()));
        }
        out.extend(p.finish());
        out
    }

    #[test]
    fn each_event_is_its_data() {
        assert_eq!(all(&["data: one\n\ndata: two\n\n"]), ["one", "two"]);
    }
    #[test]
    fn events_split_across_chunks_are_joined() {
        assert_eq!(all(&["da", "ta: hel", "lo\n", "\ndata: wor", "ld\n\n"]), ["hello", "world"]);
    }
    #[test]
    fn crlf_and_cr_line_endings_work() {
        assert_eq!(all(&["data: a\r\n\r\ndata: b\r\n\r\n"]), ["a", "b"]);
    }
    #[test]
    fn a_space_after_the_colon_is_optional_and_only_one_is_stripped() {
        assert_eq!(all(&["data:x\n\ndata:  y\n\n"]), ["x", " y"]);
    }
    #[test]
    fn multiple_data_lines_in_one_event_are_joined_with_newlines() {
        assert_eq!(all(&["data: a\ndata: b\n\n"]), ["a\nb"]);
    }
    #[test]
    fn comments_and_other_fields_are_ignored() {
        assert_eq!(all(&[": keep-alive\n\nevent: ping\nid: 4\nretry: 100\ndata: real\n\n"]), ["real"]);
    }
    #[test]
    fn an_event_with_no_data_produces_nothing() {
        assert_eq!(all(&["event: ping\n\n\n\n"]), Vec::<String>::new());
    }
    #[test]
    fn a_final_event_without_its_blank_line_is_still_delivered() {
        assert_eq!(all(&["data: last\n"]), ["last"]);
        assert_eq!(all(&["data: last"]), ["last"]);
    }
    #[test]
    fn a_multibyte_character_split_across_chunks_survives() {
        let bytes = "data: caf\u{e9} \u{1F600}\n\n".as_bytes();
        let mut p = SseParser::new();
        let mut out = Vec::new();
        for b in bytes.chunks(1) {
            out.extend(p.push(b));
        }
        assert_eq!(out, ["caf\u{e9} \u{1F600}"]);
    }
    #[test]
    fn a_line_that_never_ends_cannot_grow_without_bound() {
        let mut p = SseParser::new();
        let chunk = vec![b'a'; 64 * 1024];
        for _ in 0..200 {
            p.push(&chunk);
        }
        assert!(p.finish().is_none_or(|d| d.len() <= 1024 * 1024), "memory stays bounded");
    }
}
