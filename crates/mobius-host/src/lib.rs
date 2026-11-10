//! `mobius-host`: starts the core daemon as a child process and talks to it. No window toolkit in here, so it is
//! tested against the real daemon and a scripted stand-in.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
pub mod access;
pub mod agent;
pub mod memory;
pub mod wiki;
pub mod code_tests;
pub mod code_git;
pub mod code_processes;
pub mod web;
pub mod database;
pub mod terminal;
pub mod workspace_guide;
pub mod turn_history;
pub mod schedules;
pub mod calendar_accounts;
pub mod mail;
pub mod chatgpt;
pub mod mcp_server;
pub mod awake;
pub mod bridge;
mod mcp;
pub mod context;
pub mod endpoints;
pub mod providers;
pub mod context_file;
pub mod secrets;
pub mod models;
pub mod notify;
pub mod process;
pub mod quick_entry;
pub mod protocol;

pub use bridge::{Bridge, BridgeError};
pub use process::{CallError, CoreProcess, Options, Status};
pub use protocol::{RestartBudget, RpcError};
