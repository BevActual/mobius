//! `mobius-store`: what the application remembers between runs. Each store is one small JSON file, written atomically,
//! read back field by field so a damaged or hostile file falls back to safe values instead of failing.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
pub mod appearance;
pub mod archive;
pub mod bookmarks;
pub mod bots;
pub mod file;
pub mod history;
pub mod keys;
pub mod preferences;
pub mod settings;
pub mod web;
