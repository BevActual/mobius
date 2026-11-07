//! `mobius-workspace`: Mobius works on real files in real folders. Before an agent changes anything, the folder is
//! snapshotted into a shadow git store kept outside it, so any change can be rolled back and the folder's own git
//! history (if it has one) is never touched. Modelled on Hermes's checkpoint manager.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]
pub mod checkpoints;
pub mod files;
pub mod notes;
pub mod tasks;
