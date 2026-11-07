//! The Mobius agent: provider-neutral conversation state, a tool-using turn engine, and model providers.
//!
//! The agent never touches the workspace directly. Every tool call goes through `mobius_core::core::Core`, so the
//! permission gate applies to the agent exactly as it applies to anyone else.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod compaction;
pub mod conversations;
pub mod engine;
pub mod fallback;
pub mod host;
pub mod message;
pub mod openai;
pub mod provider;
pub mod responses;
pub mod review;
pub mod sse;
