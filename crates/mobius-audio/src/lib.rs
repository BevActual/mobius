//! Music's sound engine (docs/reference/music-parity.md, "Where the sound is made").
//!
//! The song file is the contract: [`song::Song`] reads the same `song.json` the window shows. [`render::Renderer`]
//! makes the sound block by block on a sample clock, so the same code serves offline render (export, and comparing
//! with the window's Web Audio version) and, next, the audio thread behind a device stream.
//!
//! This first part plays the synth voice every melodic instrument uses ([`voice`]), with each track's volume, pan,
//! mute and solo, through the master. Drums, effects and automation come next, matched one by one against
//! `apps/desktop/src/studio-audio.ts`.

pub mod clock;
pub mod param;
pub mod render;
pub mod song;
pub mod voice;
pub mod wav;
