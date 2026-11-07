//! Running models on this computer: finding and ranking them, and supervising `llama-server`.

pub mod discover;
pub mod download;
pub mod engine;
pub mod fit;
pub mod gguf;
pub mod hardware;
pub mod hub;
pub mod local;
pub mod server;
