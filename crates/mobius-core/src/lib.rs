//! Mobius core: the trusted layer that holds the workspace's truth and enforces its rules.
//!
//! Everything that acts in a workspace (a person in the UI, the agent, an MCP server, a plugin) is a
//! [`model::Principal`] and passes through the same permission gate. The core owns the event log.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod builtin;
pub mod core;
pub mod model;
pub mod permissions;
pub mod rpc;
pub mod signins;
pub mod store;
