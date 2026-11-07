//! An MCP server that only lists tools. The Claude Code CLI learns Mobius's tools from it, but can never run one:
//! every call is refused, and Mobius runs the tools itself under its own approvals.
//! Usage: `mobius-inert-mcp <tools.json>`.
use std::io::{BufRead, Write};

use serde_json::{Value, json};

fn main() {
    let manifest: Value = std::env::args().nth(1).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!([]));
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(row) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = row.get("id").cloned() else { continue };
        let result = match row.get("method").and_then(Value::as_str) {
            Some("initialize") => json!({ "protocolVersion": "2024-11-05", "capabilities": { "tools": {} }, "serverInfo": { "name": "mobius-inert-inventory", "version": "1" } }),
            Some("tools/list") => json!({ "tools": manifest }),
            Some("tools/call") => json!({ "isError": true, "content": [{ "type": "text", "text": "Denied: these tools are run by Mobius, not here." }] }),
            _ => json!({}),
        };
        let _ = writeln!(out, "{}", json!({ "jsonrpc": "2.0", "id": id, "result": result }));
        let _ = out.flush();
    }
}
