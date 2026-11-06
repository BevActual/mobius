//! Bots: named agents with their own instructions and model. Mobius is always first and cannot be changed or removed.
//! A conversation belongs to a bot by its id: `c-<bot>-<random>`, or `c-<random>` for Mobius.
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::file::{read_json, write_json};

pub const MAIN_ID: &str = "main";
pub const MAIN_NAME: &str = "Mobius";
pub const MAX_BOTS: usize = 20;
pub const MAX_NAME: usize = 40;
pub const MAX_INSTRUCTIONS: usize = 4000;
const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

#[derive(Debug, Clone, PartialEq)]
pub struct Bot {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub model: String,
    pub created_ms: i64,
}

impl Bot {
    pub fn to_json(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "instructions": self.instructions, "model": self.model, "createdMs": self.created_ms })
    }
}

pub struct Draft {
    pub name: String,
    pub instructions: String,
    pub model: String,
}

fn one_line(s: &str) -> bool {
    !s.chars().any(|c| c.is_control())
}

pub fn is_bot_id(s: &str) -> bool {
    s == MAIN_ID || (s.len() == 6 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// A bot as the person described it: a plain one-line name, bounded instructions, a model name if any.
pub fn parse_draft(v: &Value) -> Option<Draft> {
    let (name, instructions, model) = (v.get("name")?.as_str()?, v.get("instructions")?.as_str()?, v.get("model")?.as_str()?);
    let (name, model) = (name.trim(), model.trim());
    if name.is_empty() || name.chars().count() > MAX_NAME || !one_line(name) {
        return None;
    }
    if instructions.chars().count() > MAX_INSTRUCTIONS || instructions.contains('\0') {
        return None;
    }
    if model.chars().count() > 200 || !one_line(model) {
        return None;
    }
    Some(Draft { name: name.to_owned(), instructions: instructions.trim().to_owned(), model: model.to_owned() })
}

/// The bot a conversation belongs to, among the bots that exist. Anything else belongs to Mobius.
pub fn bot_of_conversation<'a>(conversation: &str, known: impl IntoIterator<Item = &'a str>) -> String {
    let id = conversation.strip_prefix("c-").and_then(|r| r.get(..7)).filter(|p| p.ends_with('-')).map(|p| &p[..6]);
    match id {
        Some(id) if is_bot_id(id) && known.into_iter().any(|k| k == id) => id.to_owned(),
        _ => MAIN_ID.to_owned(),
    }
}

pub struct Bots {
    file: PathBuf,
    bots: Vec<Bot>,
    clock: Box<dyn Fn() -> i64 + Send>,
}

type Fail = Result<(), String>;

impl Bots {
    pub fn open(file: PathBuf, clock: Box<dyn Fn() -> i64 + Send>) -> Bots {
        let main = Bot { id: MAIN_ID.into(), name: MAIN_NAME.into(), instructions: String::new(), model: String::new(), created_ms: 0 };
        let mut b = Bots { file, bots: vec![main], clock };
        b.load();
        b
    }

    pub fn all(&self) -> &[Bot] {
        &self.bots
    }

    pub fn get(&self, id: &str) -> Option<&Bot> {
        self.bots.iter().find(|b| b.id == id)
    }

    fn name_taken(&self, name: &str, except: Option<&str>) -> Fail {
        let lower = name.to_lowercase();
        if self.bots.iter().any(|b| Some(b.id.as_str()) != except && b.name.to_lowercase() == lower) {
            return Err(format!("There is already a bot called \"{name}\"."));
        }
        Ok(())
    }

    pub fn create(&mut self, value: &Value) -> Result<Bot, String> {
        let draft = parse_draft(value).ok_or("That bot cannot be saved. Give it a short name on one line.")?;
        if self.bots.len() >= MAX_BOTS {
            return Err(format!("You can have up to {MAX_BOTS} bots. Remove one first."));
        }
        self.name_taken(&draft.name, None)?;
        let bot = Bot { id: self.new_id(), name: draft.name, instructions: draft.instructions, model: draft.model, created_ms: (self.clock)() };
        self.bots.push(bot.clone());
        self.save();
        Ok(bot)
    }

    pub fn update(&mut self, id: &str, value: &Value) -> Result<Bot, String> {
        if self.get(id).is_none() {
            return Err("That bot is not there any more.".into());
        }
        if id == MAIN_ID {
            return Err(format!("{MAIN_NAME} is how the agent works without a bot, so it cannot be changed."));
        }
        let draft = parse_draft(value).ok_or("That bot cannot be saved. Give it a short name on one line.")?;
        self.name_taken(&draft.name, Some(id))?;
        let bot = self.bots.iter_mut().find(|b| b.id == id).ok_or("That bot is not there any more.")?;
        (bot.name, bot.instructions, bot.model) = (draft.name, draft.instructions, draft.model);
        let out = bot.clone();
        self.save();
        Ok(out)
    }

    /// Moves a bot one place up or down among the others. Mobius stays first.
    pub fn move_bot(&mut self, id: &str, direction: &str) -> Fail {
        if direction != "up" && direction != "down" {
            return Err("That move is not possible.".into());
        }
        let index = self.bots.iter().position(|b| b.id == id).ok_or("That bot is not there any more.")?;
        if id == MAIN_ID {
            return Err(format!("{MAIN_NAME} stays first."));
        }
        let target = if direction == "up" { index.checked_sub(1) } else { Some(index + 1) };
        match target {
            Some(t) if t >= 1 && t < self.bots.len() => {
                self.bots.swap(index, t);
                self.save();
            }
            _ => {}
        }
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> Fail {
        if id == MAIN_ID {
            return Err(format!("{MAIN_NAME} cannot be removed."));
        }
        if self.get(id).is_none() {
            return Err("That bot is not there any more.".into());
        }
        self.bots.retain(|b| b.id != id);
        self.save();
        Ok(())
    }

    fn new_id(&self) -> String {
        loop {
            let mut bytes = [0u8; 6];
            if getrandom::fill(&mut bytes).is_err() {
                bytes = std::array::from_fn(|i| ((self.bots.len() * 7 + i * 13) % 251) as u8);
            }
            let id: String = bytes.iter().map(|b| ALPHABET[usize::from(*b) % ALPHABET.len()] as char).collect();
            if self.get(&id).is_none() && id != MAIN_ID {
                return id;
            }
        }
    }

    fn save(&self) {
        let rows: Vec<Value> = self.bots.iter().filter(|b| b.id != MAIN_ID).map(Bot::to_json).collect();
        write_json(&self.file, &json!({ "bots": rows }));
    }

    fn load(&mut self) {
        let Some(Value::Object(data)) = read_json(&self.file) else { return };
        let Some(Value::Array(rows)) = data.get("bots") else { return };
        for row in rows.iter().take(MAX_BOTS - 1) {
            let Some(draft) = parse_draft(row) else { continue };
            let Some(id) = row.get("id").and_then(Value::as_str) else { continue };
            if !is_bot_id(id) || id == MAIN_ID || self.get(id).is_some() || self.name_taken(&draft.name, None).is_err() {
                continue;
            }
            let created_ms = row.get("createdMs").and_then(Value::as_i64).unwrap_or(0);
            self.bots.push(Bot { id: id.to_owned(), name: draft.name, instructions: draft.instructions, model: draft.model, created_ms });
        }
    }
}
