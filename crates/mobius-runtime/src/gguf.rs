//! Reading what a model file is from its name: quantisation, split parts, parameter count.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// Weights that can be loaded and run.
    Model,
    /// The image part of a vision model. Useful beside a model, never a model on its own.
    Projector,
    Other,
}

pub fn classify(path: &str) -> FileKind {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    if !name.ends_with(".gguf") {
        return FileKind::Other;
    }
    if name.contains("mmproj") {
        FileKind::Projector
    } else if name.contains("imatrix") || name.starts_with("ggml-vocab") || path.to_ascii_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).any(|word| HELPER_WORDS.contains(&word)) {
        FileKind::Other
    } else {
        FileKind::Model
    }
}

/// Files with these words in their path belong beside a model (speeding it up, tuning it) and are not models.
const HELPER_WORDS: [&str; 9] = ["draft", "mtp", "dflash", "eagle", "eagle3", "medusa", "lora", "adapter", "adapters"];

fn is_quant_token(token: &str) -> bool {
    let t = token.to_ascii_uppercase();
    if matches!(t.as_str(), "BF16" | "F16" | "F32" | "MXFP4") {
        return true;
    }
    let rest = t.strip_prefix("IQ").or_else(|| t.strip_prefix('Q'));
    let Some(rest) = rest else { return false };
    let mut chars = rest.chars();
    match chars.next() {
        Some(digit @ '1'..='8') => {
            let _ = digit;
            let tail = chars.as_str();
            tail.is_empty() || (tail.starts_with('_') && tail.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
        }
        _ => false,
    }
}

/// The quantisation label in a file path (`Q4_K_M`, `UD-Q4_K_XL`, `BF16`), upper-cased.
pub fn parse_quant(path: &str) -> Option<String> {
    for segment in path.rsplit('/') {
        let tokens: Vec<&str> = segment.split(['-', '.']).collect();
        for (at, token) in tokens.iter().enumerate().rev() {
            if is_quant_token(token) {
                let upper = token.to_ascii_uppercase();
                let dynamic = at > 0 && tokens[at - 1].eq_ignore_ascii_case("UD");
                return Some(if dynamic { format!("UD-{upper}") } else { upper });
            }
        }
    }
    None
}

/// `(part, of)` for files split into several parts, such as `model-00002-of-00005.gguf`.
pub fn parse_shard(path: &str) -> Option<(u32, u32)> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let at = name.find("-of-")?;
    let before = &name[..at];
    let after = &name[at + 4..];
    let digits_before: String = before.chars().rev().take_while(char::is_ascii_digit).collect::<Vec<_>>().into_iter().rev().collect();
    let digits_after: String = after.chars().take_while(char::is_ascii_digit).collect();
    if digits_before.len() != 5 || digits_after.len() != 5 {
        return None;
    }
    let part: u32 = digits_before.parse().ok()?;
    let total: u32 = digits_after.parse().ok()?;
    (part >= 1 && part <= total).then_some((part, total))
}

/// Billions of parameters, when the repository name says (`Qwen3.5-9B`, `Mixtral-8x7B`, `gemma-3-270m`).
pub fn params_from_name(repo: &str) -> Option<f64> {
    let name = repo.rsplit('/').next().unwrap_or(repo).as_bytes();
    let number = |from: usize| -> Option<(f64, usize)> {
        let mut end = from;
        while end < name.len() && name[end].is_ascii_digit() {
            end += 1;
        }
        if end == from {
            return None;
        }
        if end + 1 < name.len() && name[end] == b'.' && name[end + 1].is_ascii_digit() {
            end += 1;
            while end < name.len() && name[end].is_ascii_digit() {
                end += 1;
            }
        }
        let text = std::str::from_utf8(&name[from..end]).ok()?;
        Some((text.parse().ok()?, end))
    };
    let ends_word = |at: usize| at >= name.len() || !name[at].is_ascii_alphanumeric();
    for start in 0..name.len() {
        if !name[start].is_ascii_digit() || (start > 0 && name[start - 1].is_ascii_alphanumeric()) {
            continue;
        }
        let Some((first, mut end)) = number(start) else { continue };
        let mut value = first;
        if end < name.len() && name[end] == b'x' {
            let Some((second, after)) = number(end + 1) else { continue };
            value = first * second;
            end = after;
            if end < name.len() && matches!(name[end], b'b' | b'B') && ends_word(end + 1) {
                return Some(value);
            }
            continue;
        }
        if end < name.len() && ends_word(end + 1) {
            match name[end] {
                b'b' | b'B' => return Some(value),
                b'm' | b'M' => return Some(value / 1000.0),
                _ => {}
            }
        }
    }
    None
}

fn base_label(quant: &str) -> (&str, bool) {
    match quant.strip_prefix("UD-") {
        Some(rest) => (rest, true),
        None => (quant, false),
    }
}

/// About how many bits each weight takes in this quantisation.
fn known_bits(quant: &str) -> Option<f64> {
    match base_label(&quant.to_ascii_uppercase()).0.to_owned().as_str() {
        "F32" => Some(32.0),
        "F16" | "BF16" => Some(16.0),
        "Q8_0" | "Q8_K_XL" => Some(8.5),
        "Q6_K" => Some(6.6),
        "Q6_K_L" => Some(6.7),
        "Q6_K_XL" => Some(6.8),
        "Q5_0" | "Q5_K_S" => Some(5.5),
        "Q5_K_M" => Some(5.7),
        "Q5_K_L" | "Q5_K_XL" => Some(5.8),
        "Q4_0" => Some(4.5),
        "Q4_1" => Some(5.0),
        "Q4_K_S" => Some(4.6),
        "Q4_K_M" => Some(4.9),
        "Q4_K_L" | "Q4_K_XL" => Some(5.0),
        "MXFP4" => Some(4.3),
        "IQ4_NL" => Some(4.5),
        "IQ4_XS" => Some(4.3),
        "Q3_K_S" => Some(3.5),
        "Q3_K_M" => Some(3.9),
        "Q3_K_L" => Some(4.1),
        "Q3_K_XL" => Some(4.2),
        "IQ3_M" => Some(3.7),
        "IQ3_S" => Some(3.4),
        "IQ3_XS" => Some(3.3),
        "IQ3_XXS" => Some(3.1),
        "Q2_K" | "Q2_K_S" => Some(2.6),
        "Q2_K_XL" => Some(2.9),
        "IQ2_M" => Some(2.7),
        "IQ2_S" => Some(2.5),
        "IQ2_XS" => Some(2.3),
        "IQ2_XXS" => Some(2.1),
        "IQ1_M" => Some(1.8),
        "IQ1_S" => Some(1.6),
        _ => None,
    }
}

/// About how many bits each weight takes in this quantisation (4 when the label is not recognised).
pub fn bits_per_weight(quant: &str) -> f64 {
    known_bits(quant).unwrap_or(4.0)
}

/// Whether the label is one this module knows the size of.
pub fn is_known_quant(quant: &str) -> bool {
    known_bits(quant).is_some()
}

/// A rough 0 to 1 score for what a model keeps of the original at this many bits per weight.
pub fn quality_from_bits(bits: f64, dynamic: bool) -> f64 {
    let bits = bits.clamp(0.5, 16.0);
    let mut score = 1.0 - 0.5 * (1.0 - (bits / 16.0).sqrt());
    // Quality falls off a cliff below about three and a half bits.
    if bits < 3.5 {
        score *= (bits / 3.5).powi(2);
    }
    if dynamic { (score + 0.01).min(1.0) } else { score }
}

/// A rough 0 to 1 score for how much a quantisation keeps of the original model.
pub fn quality(quant: &str) -> f64 {
    quality_from_bits(bits_per_weight(quant), base_label(&quant.to_ascii_uppercase()).1)
}
