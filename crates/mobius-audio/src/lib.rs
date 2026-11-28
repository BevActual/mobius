//! Music's sound engine (docs/reference/music-parity.md, "Where the sound is made").
//!
//! The song file is the contract: [`song::Song`] reads the same `song.json` the window shows. [`render::Renderer`]
//! makes the sound block by block on a sample clock, so the same code serves offline render (export, and comparing
//! with the window's Web Audio version) and, next, the audio thread behind a device stream.
//!
//! [`engine::Engine`] plays it live: a device stream whose audio thread only renders, fed new songs through a
//! wait-free queue and handing back its position and levels through atomics.
//!
//! It plays the synth voice every melodic instrument uses ([`voice`]), the drum kit ([`drum`]), recorded sounds on a
//! Sampler track or a drum pad ([`sampler`]) and each track's
//! effects and devices ([`fx`], with [`conv`] for the reverb's room), with each track's volume, pan, mute and solo,
//! through the master, and the Session view. Each was matched against the window's Web Audio player before it was
//! retired (22 November 2026: the test song 0.23 dB apart on average every 100 ms; drums about 1 dB, from their noise).

pub mod clock;
pub mod conv;
pub mod drum;
pub mod engine;
pub mod fx;
pub mod groove;
pub mod electric;
pub mod mallet;
pub mod meeting;
pub mod midi;
pub mod param;
pub mod record;
pub mod render;
pub mod sample;
pub mod sampler;
pub mod song;
pub mod string;
pub mod voice;
pub mod wavetable;
pub mod wav;
