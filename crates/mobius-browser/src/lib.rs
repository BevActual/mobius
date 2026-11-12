//! `mobius-browser`: the browser as an application. Tabs, addresses, downloads, find, and the tools the agent uses on
//! pages. It talks to a web engine only through the `Engine` trait, so the engine (the system web view or Chromium) can be replaced without touching anything else.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
pub mod address;
pub mod deps;
pub mod download_names;
pub mod downloads;
pub mod engine;
pub mod favicon;
pub mod find;
pub mod net_rules;
pub mod page_actions;
pub mod session;
pub mod tabs;
pub mod tools;
