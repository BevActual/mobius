//! Music's sound engine (docs/reference/music-parity.md, "Where the sound is made").
//!
//! The song file is the contract: [`song::Song`] reads the same `song.json` the window shows. [`render::Renderer`]
//! makes the sound block by block on a sample clock, so the same code serves offline render (export, and comparing
//! with the window's Web Audio version) and, next, the audio thread behind a device stream.
//!
//! [`engine::Engine`] plays it live: a device stream whose audio thread only renders, fed new songs through a
//! wait-free queue and handing back its position and levels through atomics.
//!
//! It plays the synth voice every melodic instrument uses ([`voice`]), the drum kit ([`drum`]) and each track's
//! effects and devices ([`fx`], with [`conv`] for the reverb's room), with each track's volume, pan, mute and solo,
//! through the master. Each is matched against `apps/desktop/src/studio-audio.ts` by `parity/compare.cjs`, which
//! renders a song both ways. Automation and the Session view come next.

pub mod clock;
pub mod conv;
pub mod drum;
pub mod engine;
pub mod fx;
pub mod param;
pub mod render;
pub mod song;
pub mod voice;
pub mod wav;
