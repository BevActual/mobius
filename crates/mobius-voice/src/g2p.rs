//! Words to the sounds Kokoro speaks, without espeak-ng (GPL-3.0, which sherpa-onnx 2.0 dropped).
//!
//! Kokoro reads phonemes in misaki's alphabet (Apache-2.0): `ˈ` and `ˌ` mark stress, and `A I O W Y` stand for the
//! diphthongs in "day", "my", "go", "now" and "boy". sherpa-onnx's own lexicon path skips any word its word list
//! (`lexicon-us-en.txt`, about 178,000 words) lacks, so a read-aloud note would drop names, plurals and numbers. Here
//! each word is found in that list, or built from a word in it ("wanted" from "want"), or spelled out, or, last of all,
//! sounded out from its letters, so no word is ever left silent.

use std::collections::HashMap;

/// The word list: a word to its phonemes, run together ("tulip" to "tˈuləp").
#[derive(Default)]
pub struct Lexicon {
    words: HashMap<String, String>,
}

impl Lexicon {
    /// Read the list: one word a line, then its phonemes, each a token on its own ("tulip t ˈ u l ə p").
    #[must_use]
    pub fn parse(text: &str) -> Lexicon {
        let mut words = HashMap::new();
        for line in text.lines() {
            let mut parts = line.split_whitespace();
            let (Some(word), Some(first)) = (parts.next(), parts.next()) else { continue };
            let sounds: String = std::iter::once(first).chain(parts).collect();
            words.entry(word.to_lowercase()).or_insert(sounds);
        }
        Lexicon { words }
    }

    fn get(&self, word: &str) -> Option<&str> {
        self.words.get(word).map(String::as_str)
    }

    /// One word's phonemes: from the list, built from a word in it, spelled out (short capitals, "PDF"), or sounded out.
    #[must_use]
    pub fn word(&self, word: &str) -> String {
        let lower = word.to_lowercase();
        if let Some(found) = self.get(&lower) {
            return found.to_owned();
        }
        if (2..=5).contains(&word.chars().count()) && word.chars().all(|c| c.is_ascii_uppercase()) {
            return self.spell(&lower);
        }
        if let Some(built) = self.inflected(&lower) {
            return built;
        }
        if let Some(both) = self.compound(&lower) {
            return both;
        }
        sound_out(&lower)
    }

    fn spell(&self, word: &str) -> String {
        word.chars().map(|c| if c == 'a' { "ˈA".to_owned() } else { self.get(&c.to_string()).map_or_else(|| sound_out(&c.to_string()), str::to_owned) }).collect::<Vec<_>>().join(" ")
    }

    /// A word made from one in the list with an ending English adds: -'s, -s, -es, -ies, -ed, -ing, -ly, -er, -est.
    fn inflected(&self, word: &str) -> Option<String> {
        let stem = |s: &str| -> Option<String> { self.get(s).map(str::to_owned).or_else(|| self.compound(s)) };
        let try_stems = |cut: &str, extra: &[&str]| -> Option<String> {
            let base = word.strip_suffix(cut)?;
            if base.chars().count() < 2 {
                return None;
            }
            let mut tries = vec![base.to_owned()];
            for e in extra {
                tries.push(format!("{base}{e}"));
            }
            // A doubled last letter ("stopped", "running").
            let chars: Vec<char> = base.chars().collect();
            if chars.len() >= 3 && chars[chars.len() - 1] == chars[chars.len() - 2] {
                tries.push(chars[..chars.len() - 1].iter().collect());
            }
            tries.iter().find_map(|t| stem(t))
        };
        if let Some(base) = word.strip_suffix("'s").or_else(|| word.strip_suffix('\'')) {
            return self.get(base).map(plural).or_else(|| (!base.is_empty()).then(|| plural(&self.word(base))));
        }
        if let Some(s) = word.strip_suffix("ies").filter(|b| b.chars().count() >= 2).and_then(|b| stem(&format!("{b}y"))) {
            return Some(plural(&s));
        }
        if let Some(s) = try_stems("es", &[]) {
            return Some(plural(&s));
        }
        if !word.ends_with("ss") {
            if let Some(s) = try_stems("s", &[]) {
                return Some(plural(&s));
            }
        }
        if let Some(s) = word.strip_suffix("ied").filter(|b| b.chars().count() >= 2).and_then(|b| stem(&format!("{b}y"))) {
            return Some(format!("{s}d"));
        }
        if let Some(s) = try_stems("ed", &["e"]) {
            return Some(past(&s));
        }
        if let Some(s) = try_stems("ing", &["e"]) {
            return Some(format!("{s}ɪŋ"));
        }
        if let Some(s) = word.strip_suffix("ily").filter(|b| b.chars().count() >= 2).and_then(|b| stem(&format!("{b}y"))) {
            return Some(format!("{}əli", s.strip_suffix('i').unwrap_or(&s)));
        }
        if let Some(s) = try_stems("ly", &["le"]) {
            return Some(format!("{s}li"));
        }
        if let Some(s) = try_stems("est", &["e"]) {
            return Some(format!("{s}ᵻst"));
        }
        if let Some(s) = try_stems("er", &["e"]) {
            return Some(format!("{s}əɹ"));
        }
        None
    }

    /// Two words from the list run together ("notebook", "worktime"), each at least three letters, the longest first
    /// part tried first. The second keeps only lighter stress.
    fn compound(&self, word: &str) -> Option<String> {
        let chars: Vec<char> = word.chars().collect();
        if chars.len() < 6 || !chars.iter().all(char::is_ascii_alphabetic) {
            return None;
        }
        (3..=chars.len() - 3).rev().find_map(|at| {
            let (a, b): (String, String) = (chars[..at].iter().collect(), chars[at..].iter().collect());
            Some(format!("{}{}", self.get(&a)?, self.get(&b)?.replace('ˈ', "ˌ")))
        })
    }
}

const VOICELESS: &[char] = &['p', 't', 'k', 'f', 'θ'];
const HISSING: &[char] = &['s', 'z', 'ʃ', 'ʒ', 'ʧ', 'ʤ'];

fn last_sound(s: &str) -> char {
    s.chars().rev().find(|c| !matches!(c, 'ˈ' | 'ˌ' | 'ː')).unwrap_or(' ')
}

/// The -s ending: "s" after a voiceless sound, "ᵻz" after a hissing one, "z" otherwise.
fn plural(s: &str) -> String {
    let last = last_sound(s);
    if HISSING.contains(&last) {
        format!("{s}ᵻz")
    } else if VOICELESS.contains(&last) {
        format!("{s}s")
    } else {
        format!("{s}z")
    }
}

/// The -ed ending: "ᵻd" after t or d, "t" after a voiceless sound, "d" otherwise.
fn past(s: &str) -> String {
    let last = last_sound(s);
    if matches!(last, 't' | 'd' | 'ɾ') {
        format!("{}ᵻd", s.strip_suffix('ɾ').map_or_else(|| s.to_owned(), |b| format!("{b}t")))
    } else if VOICELESS.contains(&last) || matches!(last, 's' | 'ʃ' | 'ʧ') {
        format!("{s}t")
    } else {
        format!("{s}d")
    }
}

/// Sounding out a word no list has, from its letters: the common English spellings, longest first, with the stress on
/// the first vowel. Rough, but it says a name rather than skipping it.
#[must_use]
pub fn sound_out(word: &str) -> String {
    const RULES: &[(&str, &str)] = &[
        ("tion", "ʃən"), ("sion", "ʒən"), ("ough", "O"), ("augh", "ɔ"), ("eigh", "A"), ("igh", "I"), ("tch", "ʧ"),
        ("sch", "sk"), ("que", "k"), ("ph", "f"), ("sh", "ʃ"), ("ch", "ʧ"), ("th", "θ"), ("wh", "w"), ("ck", "k"),
        ("ng", "ŋ"), ("qu", "kw"), ("kn", "n"), ("wr", "ɹ"), ("gh", "ɡ"), ("ee", "i"), ("ea", "i"), ("ie", "i"),
        ("oo", "u"), ("ou", "W"), ("ow", "O"), ("oi", "Y"), ("oy", "Y"), ("ai", "A"), ("ay", "A"), ("au", "ɔ"),
        ("aw", "ɔ"), ("ei", "A"), ("ey", "A"), ("eu", "ju"), ("ew", "ju"), ("ue", "u"), ("oa", "O"), ("ar", "ɑɹ"),
        ("or", "ɔɹ"), ("er", "əɹ"), ("ir", "ɜɹ"), ("ur", "ɜɹ"), ("a", "æ"), ("e", "ɛ"), ("i", "ɪ"), ("o", "ɑ"),
        ("u", "ʌ"), ("y", "i"), ("b", "b"), ("c", "k"), ("d", "d"), ("f", "f"), ("g", "ɡ"), ("h", "h"), ("j", "ʤ"),
        ("k", "k"), ("l", "l"), ("m", "m"), ("n", "n"), ("p", "p"), ("q", "k"), ("r", "ɹ"), ("s", "s"), ("t", "t"),
        ("v", "v"), ("w", "w"), ("x", "ks"), ("z", "z"),
    ];
    const VOWELS: &[char] = &['æ', 'ɛ', 'ɪ', 'ɑ', 'ʌ', 'i', 'u', 'ə', 'ɜ', 'ɔ', 'A', 'I', 'O', 'W', 'Y'];
    let letters: Vec<char> = word.chars().filter(char::is_ascii_alphabetic).map(|c| c.to_ascii_lowercase()).collect();
    let mut out = String::new();
    let mut i = 0;
    while i < letters.len() {
        let rest: String = letters[i..].iter().collect();
        // A silent e at the end ("cake"), and a long vowel before consonant + e ("Mobius" stays short; "time" is long).
        if rest == "e" && i > 1 {
            break;
        }
        let long = letters.len() >= 3 && i + 2 == letters.len() - 1 && letters[letters.len() - 1] == 'e' && !"aeiou".contains(letters[i + 1]);
        let Some((spelling, sound)) = RULES.iter().find(|(s, _)| rest.starts_with(s)) else {
            i += 1;
            continue;
        };
        let sound = match (long, *spelling) {
            (true, "a") => "A",
            (true, "e") => "i",
            (true, "i" | "y") => "I",
            (true, "o") => "O",
            (true, "u") => "u",
            _ => sound,
        };
        // A vowel letter at the end of a syllable before another vowel sounds long ("Mobius": mO-bi-əs).
        let next_vowel = letters.get(i + spelling.len()).is_some_and(|c| "aeiou".contains(*c));
        let sound = match (*spelling, next_vowel) {
            ("o", false) if letters.get(i + 2).is_some_and(|c| "aeiouy".contains(*c)) && letters.get(i + 1).is_some_and(|c| !"aeiouy".contains(*c)) => "O",
            ("i", true) => "i",
            ("u", true) | ("u", false) if i > 0 && i + 1 < letters.len() && letters.get(i + 1) == Some(&'s') && i + 2 == letters.len() => "ə",
            _ => sound,
        };
        out.push_str(sound);
        i += spelling.len();
    }
    match out.char_indices().find(|(_, c)| VOWELS.contains(c)) {
        Some((at, _)) => format!("{}ˈ{}", &out[..at], &out[at..]),
        None => out,
    }
}

/// What a whole number says: "twelve", "one thousand two hundred", and years as people read them ("twenty twenty-seven").
#[must_use]
pub fn number_words(digits: &str) -> String {
    let Ok(n) = digits.parse::<u64>() else { return digits.chars().map(|c| ONES[c.to_digit(10).unwrap_or(0) as usize]).collect::<Vec<_>>().join(" ") };
    if digits.len() == 4 && (1100..=2099).contains(&n) && !(2000..=2009).contains(&n) && n % 100 != 0 {
        let low = n % 100;
        return format!("{} {}", below_hundred(n / 100), if low < 10 { format!("oh {}", ONES[usize::try_from(low).unwrap_or(0)]) } else { below_hundred(low) });
    }
    count_words(n)
}

/// A count in words, never read as a year: "one thousand nine hundred five".
#[must_use]
pub fn count_words(n: u64) -> String {
    if n == 0 {
        return "zero".to_owned();
    }
    let mut parts = Vec::new();
    let mut rest = n;
    for (size, name) in [(1_000_000_000_000, "trillion"), (1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")] {
        if rest >= size {
            parts.push(format!("{} {name}", below_thousand(rest / size)));
            rest %= size;
        }
    }
    if rest > 0 {
        parts.push(below_thousand(rest));
    }
    parts.join(" ")
}

const ONES: [&str; 20] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

fn below_hundred(n: u64) -> String {
    let n = usize::try_from(n % 100).unwrap_or(0);
    if n < 20 {
        ONES[n].to_owned()
    } else if n % 10 == 0 {
        TENS[n / 10].to_owned()
    } else {
        format!("{} {}", TENS[n / 10], ONES[n % 10])
    }
}

fn below_thousand(n: u64) -> String {
    match (n / 100, n % 100) {
        (0, r) => below_hundred(r),
        (h, 0) => format!("{} hundred", ONES[usize::try_from(h).unwrap_or(0)]),
        (h, r) => format!("{} hundred {}", ONES[usize::try_from(h).unwrap_or(0)], below_hundred(r)),
    }
}

/// Punctuation Kokoro knows (its tokens.txt), which shapes the pauses and the tune.
const MARKS: &[char] = &[';', ':', ',', '.', '!', '?', '—', '…', '"', '(', ')', '“', '”'];

/// A text as sentences of phonemes, each at most `max_chars` long, for one generation at a time.
#[must_use]
pub fn sentences(lexicon: &Lexicon, text: &str) -> Vec<String> {
    let text = text.replace(['’', '‘'], "'").replace(" - ", " — ").replace("--", "—");
    let mut out = Vec::new();
    let mut now = String::new();
    let push_word = |now: &mut String, sounds: &str| {
        if !now.is_empty() && !now.ends_with(['(', '“']) {
            now.push(' ');
        }
        now.push_str(sounds);
    };
    let say_words = |now: &mut String, words: &str| {
        for w in words.split_whitespace() {
            push_word(now, &lexicon.word(w));
        }
    };
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_alphabetic() {
            let start = i;
            while i < chars.len() && (chars[i].is_alphabetic() || (chars[i] == '\'' && chars.get(i + 1).is_some_and(|n| n.is_alphabetic()))) {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            push_word(&mut now, &lexicon.word(&word));
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || (chars[i] == ',' && chars.get(i + 1).is_some_and(char::is_ascii_digit) && chars.get(i + 3).is_some_and(char::is_ascii_digit))) {
                i += 1;
            }
            let whole: String = chars[start..i].iter().filter(|c| c.is_ascii_digit()).collect();
            // "1,905" is a count, "1905" a year.
            let words = if chars[start..i].contains(&',') { whole.parse().map_or_else(|_| number_words(&whole), count_words) } else { number_words(&whole) };
            say_words(&mut now, &words);
            if chars.get(i) == Some(&'.') && chars.get(i + 1).is_some_and(char::is_ascii_digit) {
                i += 1;
                let start = i;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                push_word(&mut now, &lexicon.word("point"));
                for d in &chars[start..i] {
                    push_word(&mut now, &lexicon.word(ONES[d.to_digit(10).unwrap_or(0) as usize]));
                }
            }
            if chars.get(i) == Some(&'%') {
                push_word(&mut now, &lexicon.word("percent"));
                i += 1;
            }
            continue;
        }
        if MARKS.contains(&c) {
            if c == '(' || c == '“' {
                push_word(&mut now, &c.to_string());
            } else {
                now.push(c);
            }
            if matches!(c, '.' | '!' | '?' | '…') && !now.trim().is_empty() {
                out.push(std::mem::take(&mut now));
            }
        } else if c == '&' {
            push_word(&mut now, &lexicon.word("and"));
        } else if c == '\n' && chars.get(i + 1) == Some(&'\n') && !now.trim().is_empty() {
            if !now.ends_with(MARKS) {
                now.push('.');
            }
            out.push(std::mem::take(&mut now));
        }
        i += 1;
    }
    if !now.trim().is_empty() {
        out.push(now);
    }
    out.into_iter().map(|s| s.trim().to_owned()).filter(|s| s.chars().any(char::is_alphabetic)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> Lexicon {
        Lexicon::parse("tulip t ˈ u l ə p\nwant w ˈ ɑ n t\nwalk w ˈ ɔ k\nbox b ˈ ɑ k s\nnote n ˈ O t\nbook b ˈ ʊ k\nthe ð i\nplant p l ˈ æ n t\nstop s t ˈ ɑ p\ncity s ˈ ɪ ɾ i\nmake m ˈ A k\np p ˈ i\nd d ˈ i\nf ˈ ɛ f\npoint p ˈ Y n t\nfive f ˈ I v\nand ˈ æ n d\npercent p ə ɹ s ˈ ɛ n t\n")
    }

    #[test]
    fn a_word_in_the_list_is_read_from_it() {
        assert_eq!(list().word("Tulip"), "tˈuləp");
    }

    #[test]
    fn endings_are_added_to_a_word_in_the_list() {
        let l = list();
        assert_eq!(l.word("tulips"), "tˈuləps");
        assert_eq!(l.word("boxes"), "bˈɑksᵻz");
        assert_eq!(l.word("notes"), "nˈOts");
        assert_eq!(l.word("wanted"), "wˈɑntᵻd");
        assert_eq!(l.word("walked"), "wˈɔkt");
        assert_eq!(l.word("stopped"), "stˈɑpt");
        assert_eq!(l.word("making"), "mˈAkɪŋ");
        assert_eq!(l.word("cities"), "sˈɪɾiz");
        assert_eq!(l.word("tulip's"), "tˈuləps");
    }

    #[test]
    fn two_words_run_together_are_both_said() {
        assert_eq!(list().word("notebook"), "nˈOtbˌʊk");
    }

    #[test]
    fn short_capitals_are_spelled_out() {
        assert_eq!(list().word("PDF"), "pˈi dˈi ˈɛf");
    }

    #[test]
    fn a_word_no_list_has_is_sounded_out_not_skipped() {
        let mobius = list().word("Mobius");
        assert!(mobius.starts_with("mˈO"), "{mobius}");
        assert!(mobius.ends_with("s"), "{mobius}");
        assert_eq!(sound_out("time"), "tˈIm");
        assert_eq!(sound_out("shop"), "ʃˈɑp");
        assert!(!sound_out("Zyx").is_empty());
    }

    #[test]
    fn numbers_and_years_are_said_as_people_say_them() {
        assert_eq!(number_words("0"), "zero");
        assert_eq!(number_words("42"), "forty two");
        assert_eq!(number_words("1200"), "one thousand two hundred");
        assert_eq!(count_words(1905), "one thousand nine hundred five");
        assert_eq!(number_words("12000"), "twelve thousand");
        assert_eq!(number_words("2027"), "twenty twenty seven");
        assert_eq!(number_words("1905"), "nineteen oh five");
        assert_eq!(number_words("2005"), "two thousand five");
        assert_eq!(number_words("1000000"), "one million");
    }

    #[test]
    fn a_text_becomes_sentences_with_their_punctuation() {
        let l = list();
        let got = sentences(&l, "Plant the tulips. The 5% point, and more!\n\nThe box");
        assert_eq!(got.len(), 3, "{got:?}");
        assert_eq!(got[0], "plˈænt ði tˈuləps.");
        assert!(got[1].starts_with("ði fˈIv pəɹsˈɛnt pˈYnt,"), "{}", got[1]);
        assert!(got[1].ends_with('!'));
        assert_eq!(got[2], "ði bˈɑks");
    }

    #[test]
    fn a_decimal_is_read_digit_by_digit_after_point() {
        let got = sentences(&list(), "5.5");
        assert_eq!(got, vec!["fˈIv pˈYnt fˈIv".to_owned()]);
    }

    #[test]
    fn text_with_no_words_is_nothing_to_say() {
        assert!(sentences(&list(), " ... !! ").is_empty());
    }
}
