//! The program Mobius runs to listen on this computer: one JSON request per line in, one answer per line out. See
//! `lib.rs` for the requests.

use std::io::{BufRead, Write};

fn main() {
    let cores = std::thread::available_parallelism().map_or(2, std::num::NonZero::get);
    let mut listener = mobius_voice::Listener::new(cores);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let answer = match mobius_voice::parse(&line) {
            Ok(request) => listener.handle(request),
            Err(refused) => refused,
        };
        if writeln!(stdout, "{answer}").and_then(|()| stdout.flush()).is_err() {
            break;
        }
    }
}
