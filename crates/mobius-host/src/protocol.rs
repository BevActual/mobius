//! The pieces of the wire protocol that do not need a process: reading bounded lines and the restart budget.
use std::io::{self, BufRead, Read};

use serde::Serialize;
use serde_json::Value;

/// The longest message accepted from the core. A longer one is dropped, never held in memory.
pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

/// What the core said about a failed call.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

/// One line read from the core.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    Text(String),
    /// A line over the limit. The rest of it was skipped.
    TooLong,
    Eof,
}

pub fn read_bounded_line(reader: &mut impl BufRead, limit: usize) -> io::Result<Line> {
    let mut buffer = Vec::new();
    let read = reader.by_ref().take(limit as u64 + 1).read_until(b'\n', &mut buffer)?;
    if read == 0 {
        return Ok(Line::Eof);
    }
    if buffer.last() == Some(&b'\n') {
        buffer.pop();
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }
        return Ok(Line::Text(String::from_utf8_lossy(&buffer).into_owned()));
    }
    if buffer.len() <= limit {
        return Ok(Line::Text(String::from_utf8_lossy(&buffer).into_owned()));
    }
    loop {
        let mut chunk = Vec::new();
        let n = reader.by_ref().take(64 * 1024).read_until(b'\n', &mut chunk)?;
        if n == 0 || chunk.last() == Some(&b'\n') {
            return Ok(Line::TooLong);
        }
    }
}

const BACKOFF_MS: [u64; 5] = [200, 400, 800, 1600, 3200];
const WINDOW_MS: u64 = 60_000;

/// How long to wait before restarting a crashed process, and when to stop trying: five restarts within a minute
/// means something is wrong that restarting will not fix.
#[derive(Debug, Default)]
pub struct RestartBudget {
    restarts: Vec<u64>,
}

impl RestartBudget {
    /// The delay before the next restart, or `None` when the budget is spent.
    pub fn next(&mut self, now_ms: u64) -> Option<u64> {
        self.restarts.retain(|at| now_ms.saturating_sub(*at) < WINDOW_MS);
        let delay = *BACKOFF_MS.get(self.restarts.len())?;
        self.restarts.push(now_ms);
        Some(delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn the_restart_delays_grow_and_then_run_out() {
        let mut budget = RestartBudget::default();
        let delays: Vec<_> = (0..6).map(|i| budget.next(1000 + i)).collect();
        assert_eq!(delays, vec![Some(200), Some(400), Some(800), Some(1600), Some(3200), None]);
    }

    #[test]
    fn restarts_older_than_a_minute_are_forgotten() {
        let mut budget = RestartBudget::default();
        for i in 0..5 {
            assert!(budget.next(i).is_some());
        }
        assert_eq!(budget.next(59_999), None, "just inside the window");
        assert_eq!(budget.next(60_000), Some(3200), "the first one has aged out, four others have not");
        assert_eq!(budget.next(200_000), Some(200), "all aged out");
    }

    #[test]
    fn lines_are_split_and_line_endings_removed() {
        let mut r = Cursor::new(b"one\r\ntwo\nthree".to_vec());
        assert_eq!(read_bounded_line(&mut r, 100).unwrap(), Line::Text("one".into()));
        assert_eq!(read_bounded_line(&mut r, 100).unwrap(), Line::Text("two".into()));
        assert_eq!(read_bounded_line(&mut r, 100).unwrap(), Line::Text("three".into()), "an input that ends mid-line");
        assert_eq!(read_bounded_line(&mut r, 100).unwrap(), Line::Eof);
    }

    #[test]
    fn a_line_over_the_limit_is_skipped_without_losing_the_next_one() {
        let mut data = vec![b'x'; 300_000];
        data.extend_from_slice(b"\nok\n");
        let mut r = Cursor::new(data);
        assert_eq!(read_bounded_line(&mut r, 1000).unwrap(), Line::TooLong);
        assert_eq!(read_bounded_line(&mut r, 1000).unwrap(), Line::Text("ok".into()));
    }

    #[test]
    fn a_line_exactly_at_the_limit_is_kept() {
        let mut data = vec![b'y'; 10];
        data.push(b'\n');
        let mut r = Cursor::new(data);
        assert_eq!(read_bounded_line(&mut r, 10).unwrap(), Line::Text("y".repeat(10)));
        let mut over = Cursor::new(b"zzzzzzzzzzz\n".to_vec());
        assert_eq!(read_bounded_line(&mut over, 10).unwrap(), Line::TooLong);
    }
}
