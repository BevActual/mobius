//! WAV files: a render written as 32-bit float stereo, the format every editor reads, and a sound read back for an
//! audio clip (8, 16, 24 or 32-bit PCM or 32-bit float, any number of channels: one is heard on both sides, past two
//! the first two are kept).

use std::io::Write;

/// Writes `left` and `right` as a 32-bit float stereo WAV.
///
/// # Errors
/// When writing fails.
pub fn write(out: &mut impl Write, left: &[f32], right: &[f32], sample_rate: u32) -> std::io::Result<()> {
    let frames = left.len().min(right.len());
    let data = u32::try_from(frames * 8).map_err(|_| std::io::Error::other("The render is too long for a WAV file."))?;
    out.write_all(b"RIFF")?;
    out.write_all(&(36 + data).to_le_bytes())?;
    out.write_all(b"WAVEfmt ")?;
    out.write_all(&16u32.to_le_bytes())?;
    out.write_all(&3u16.to_le_bytes())?; // IEEE float
    out.write_all(&2u16.to_le_bytes())?;
    out.write_all(&sample_rate.to_le_bytes())?;
    out.write_all(&(sample_rate * 8).to_le_bytes())?;
    out.write_all(&8u16.to_le_bytes())?;
    out.write_all(&32u16.to_le_bytes())?;
    out.write_all(b"data")?;
    out.write_all(&data.to_le_bytes())?;
    let mut bytes = Vec::with_capacity(frames * 8);
    for i in 0..frames {
        bytes.extend_from_slice(&left[i].to_le_bytes());
        bytes.extend_from_slice(&right[i].to_le_bytes());
    }
    out.write_all(&bytes)
}

/// The largest sound read for a clip: about 45 minutes of 48 kHz stereo float.
pub const MAX_READ: usize = 1024 * 1024 * 1024;

/// A sound read from a WAV file, left and right, at its own rate.
#[derive(Debug, Clone, PartialEq)]
pub struct Sound {
    pub rate: f64,
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}

/// Reads a WAV file's sound.
///
/// # Errors
/// When the bytes are not a WAV file of a kind it reads.
pub fn read(bytes: &[u8]) -> Result<Sound, String> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("that is not a WAV file".into());
    }
    let u16_at = |b: &[u8], i: usize| b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]));
    let u32_at = |b: &[u8], i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]));
    let (mut format, mut data) = (None, None);
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32_at(bytes, at + 4).unwrap_or(0) as usize;
        let body = &bytes[at + 8..(at + 8).saturating_add(size).min(bytes.len())];
        match id {
            b"fmt " => format = Some(body),
            b"data" => data = Some(body),
            _ => {}
        }
        // Chunks are padded to an even length.
        at = at.saturating_add(8).saturating_add(size).saturating_add(size & 1);
    }
    let (Some(fmt), Some(data)) = (format, data) else {
        return Err("the WAV file has no sound in it".into());
    };
    let tag = u16_at(fmt, 0).ok_or("the WAV file's format is cut short")?;
    let channels = usize::from(u16_at(fmt, 2).unwrap_or(0));
    let rate = u32_at(fmt, 4).unwrap_or(0);
    let bits = u16_at(fmt, 14).unwrap_or(0);
    // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its sub-format.
    let tag = if tag == 0xFFFE { u16_at(fmt, 24).unwrap_or(0) } else { tag };
    if channels == 0 || !(1000..=768_000).contains(&rate) {
        return Err("the WAV file's channels or rate are out of range".into());
    }
    let width = match (tag, bits) {
        (1, 8) => 1,
        (1, 16) => 2,
        (1, 24) => 3,
        (1 | 3, 32) => 4,
        _ => return Err(format!("Music reads 8, 16, 24 or 32-bit PCM and 32-bit float WAV, not format {tag} at {bits} bits")),
    };
    let float = tag == 3;
    let frame = width * channels;
    let frames = data.len() / frame;
    let sample = |s: &[u8]| -> f32 {
        match width {
            1 => (f32::from(s[0]) - 128.0) / 128.0,
            2 => f32::from(i16::from_le_bytes([s[0], s[1]])) / 32_768.0,
            3 => (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0,
            _ if float => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
            _ => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
        }
    };
    let (mut left, mut right) = (Vec::with_capacity(frames), Vec::with_capacity(frames));
    for f in data.chunks_exact(frame) {
        let l = sample(&f[..width]);
        left.push(l);
        right.push(if channels > 1 { sample(&f[width..2 * width]) } else { l });
    }
    Ok(Sound { rate: f64::from(rate), left, right })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    #[test]
    fn a_wav_has_its_header_and_every_sample() {
        let mut out = Vec::new();
        super::write(&mut out, &[0.5, -0.5], &[0.25, 0.0], 48_000).unwrap();
        assert_eq!(&out[..4], b"RIFF");
        assert_eq!(out.len(), 44 + 16);
        assert_eq!(f32::from_le_bytes(out[44..48].try_into().unwrap()), 0.5);
        assert_eq!(f32::from_le_bytes(out[48..52].try_into().unwrap()), 0.25);
    }

    #[test]
    fn a_written_wav_reads_back_the_same() {
        let mut out = Vec::new();
        super::write(&mut out, &[0.5, -0.5, 0.125], &[0.25, 0.0, -1.0], 44_100).unwrap();
        let sound = super::read(&out).unwrap();
        assert_eq!(sound.rate, 44_100.0);
        assert_eq!(sound.left, [0.5, -0.5, 0.125]);
        assert_eq!(sound.right, [0.25, 0.0, -1.0]);
    }

    /// A WAV of `channels` channels of `bits`-bit PCM, with an odd chunk before the sound to skip.
    fn pcm(bits: u16, channels: u16, samples: &[u8]) -> Vec<u8> {
        let mut b = b"RIFF\0\0\0\0WAVEJUNK\x03\0\0\0abc\0fmt \x10\0\0\0".to_vec();
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&channels.to_le_bytes());
        b.extend_from_slice(&22_050u32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&(channels * bits / 8).to_le_bytes());
        b.extend_from_slice(&bits.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&u32::try_from(samples.len()).unwrap().to_le_bytes());
        b.extend_from_slice(samples);
        b
    }

    #[test]
    fn pcm_of_each_width_reads_as_floats_and_mono_plays_on_both_sides() {
        let s16 = super::read(&pcm(16, 1, &[0x00, 0x40, 0x00, 0xC0])).unwrap();
        assert_eq!(s16.rate, 22_050.0);
        assert_eq!(s16.left, [0.5, -0.5]);
        assert_eq!(s16.right, s16.left);
        let s24 = super::read(&pcm(24, 2, &[0, 0, 0x40, 0, 0, 0xC0])).unwrap();
        assert_eq!((s24.left[0], s24.right[0]), (0.5, -0.5));
        let s8 = super::read(&pcm(8, 1, &[192, 64])).unwrap();
        assert_eq!(s8.left, [0.5, -0.5]);
        assert!(super::read(&pcm(12, 1, &[0, 0])).is_err());
        assert!(super::read(b"RIFF\0\0\0\0WAVE").is_err());
    }
}
