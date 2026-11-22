//! A render written as a WAV file: 32-bit float, stereo, the format every editor reads.

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
}
