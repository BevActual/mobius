//! Claude through the official Claude Code CLI, on the person's Claude Pro/Max subscription.
//!
//! Ported from Nous Research's `claude-subscription-directsdk` Hermes plugin (MIT,
//! https://github.com/NousResearch/hermes-official-plugins/tree/main/claude-subscription-directsdk). Each model request
//! starts the unmodified `claude` program with its own tools, memory and settings off; Mobius's tools are offered
//! through an inert MCP server, and a loopback relay lets exactly one request reach Anthropic. Mobius then runs the
//! tools itself, under its own approvals. Sign-in belongs to the CLI: Mobius never reads its credentials.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod cli;
pub mod copilot;
pub mod frames;
pub mod provider;
pub mod relay;
