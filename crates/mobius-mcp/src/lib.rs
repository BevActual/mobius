//! MCP client: start the servers a person configured, list their tools, and call them. Everything a server returns is
//! untrusted text. Whether a call may happen is decided by the core, not here.
pub mod client;
pub mod config;
pub mod hub;
pub mod server;
