//! The formulas of Sheets: `=SUM(B2:B4)`, `=D2/People!B1`, `=IF(A1>0,"yes","no")`. A cell that starts with `=` is a
//! formula; anything else is a number if it reads as one, or text. Formulas are worked out here, once, so the window
//! and the agent see the same numbers.
use std::collections::HashMap;

/// What a cell holds once worked out.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Empty,
    Num(f64),
    Text(String),
    Bool(bool),
    Err(&'static str),
}

impl Val {
    pub fn show(&self) -> String {
        match self {
            Val::Empty => String::new(),
            Val::Num(n) => show_number(*n),
            Val::Text(t) => t.clone(),
            Val::Bool(b) => if *b { "TRUE".into() } else { "FALSE".into() },
            Val::Err(e) => (*e).to_owned(),
        }
    }
    fn num(&self) -> Result<f64, &'static str> {
        match self {
            Val::Empty => Ok(0.0),
            Val::Num(n) => Ok(*n),
            Val::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
            Val::Text(t) => number(t).ok_or("#VALUE!"),
            Val::Err(e) => Err(e),
        }
    }
    fn truth(&self) -> Result<bool, &'static str> {
        match self {
            Val::Bool(b) => Ok(*b),
            Val::Text(t) if t.eq_ignore_ascii_case("true") => Ok(true),
            Val::Text(t) if t.eq_ignore_ascii_case("false") => Ok(false),
            Val::Err(e) => Err(e),
            other => other.num().map(|n| n != 0.0),
        }
    }
    fn text(&self) -> Result<String, &'static str> {
        match self {
            Val::Err(e) => Err(e),
            other => Ok(other.show()),
        }
    }
}

/// Up to ten decimal places, without trailing zeros, the way a spreadsheet shows a number by default.
pub fn show_number(n: f64) -> String {
    if !n.is_finite() {
        return "#NUM!".into();
    }
    if n == n.trunc() && n.abs() < 1e15 {
        return format!("{n:.0}");
    }
    let s = format!("{n:.10}");
    s.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// A number as people type one: `1,200.50`, `$40`, `12%`, `-3`. Text that is not a number is `None`.
pub fn number(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let (t, percent) = t.strip_suffix('%').map_or((t, false), |r| (r.trim_end(), true));
    let (negative, t) = t.strip_prefix('-').map_or((false, t), |r| (true, r.trim_start()));
    let t = t.strip_prefix(['$', '€', '£', '¥']).unwrap_or(t);
    let plain: String = t.chars().filter(|c| *c != ',').collect();
    if plain.is_empty() || !plain.chars().all(|c| c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
        return None;
    }
    let n: f64 = plain.parse().ok()?;
    let n = if negative { -n } else { n };
    Some(if percent { n / 100.0 } else { n })
}

/// `A1` → (row 0, column 0). Columns run A..Z, AA..ZZ and so on.
pub fn parse_cell(text: &str) -> Option<(usize, usize)> {
    let t = text.trim().trim_start_matches('$');
    let letters: String = t.chars().take_while(char::is_ascii_alphabetic).collect();
    let rest = t[letters.len()..].trim_start_matches('$');
    if letters.is_empty() || letters.len() > 3 || rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let col = letters.chars().fold(0usize, |acc, c| acc * 26 + (c.to_ascii_uppercase() as usize - 'A' as usize + 1)) - 1;
    let row: usize = rest.parse().ok()?;
    (row >= 1).then(|| (row - 1, col))
}

pub fn column_name(mut col: usize) -> String {
    let mut out = Vec::new();
    loop {
        out.push((b'A' + u8::try_from(col % 26).unwrap_or(0)) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    out.iter().rev().collect()
}

pub fn cell_name(row: usize, col: usize) -> String {
    format!("{}{}", column_name(col), row + 1)
}

// ---- parsing ------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    /// A name, a cell (`B2`), a range end, a function, or a sheet (`People!`).
    Word(String),
    Sheet(String),
    Op(char),
    Le,
    Ge,
    Ne,
    Colon,
    Comma,
    Open,
    Close,
}

fn tokens(text: &str) -> Result<Vec<Tok>, &'static str> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' => i += 1,
            '0'..='9' | '.' => {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') && chars.get(i + 1).is_some_and(|c| c.is_ascii_digit() || *c == '-' || *c == '+') {
                    i += 2;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                let s: String = chars[start..i].iter().collect();
                out.push(Tok::Num(s.parse().map_err(|_| "#VALUE!")?));
            }
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match chars.get(i) {
                        None => return Err("#VALUE!"),
                        Some('"') if chars.get(i + 1) == Some(&'"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('"') => {
                            i += 1;
                            break;
                        }
                        Some(ch) => {
                            s.push(*ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Str(s));
            }
            '\'' => {
                // 'My sheet'!A1
                let mut s = String::new();
                i += 1;
                while i < chars.len() && chars[i] != '\'' {
                    s.push(chars[i]);
                    i += 1;
                }
                if chars.get(i + 1) != Some(&'!') {
                    return Err("#REF!");
                }
                i += 2;
                out.push(Tok::Sheet(s));
            }
            '+' | '-' | '*' | '/' | '^' | '&' | '=' | '%' => {
                out.push(Tok::Op(c));
                i += 1;
            }
            '<' => {
                match chars.get(i + 1) {
                    Some('=') => out.push(Tok::Le),
                    Some('>') => out.push(Tok::Ne),
                    _ => {
                        out.push(Tok::Op('<'));
                        i += 1;
                        continue;
                    }
                }
                i += 2;
            }
            '>' => {
                if chars.get(i + 1) == Some(&'=') {
                    out.push(Tok::Ge);
                    i += 2;
                } else {
                    out.push(Tok::Op('>'));
                    i += 1;
                }
            }
            ':' => {
                out.push(Tok::Colon);
                i += 1;
            }
            ',' | ';' => {
                out.push(Tok::Comma);
                i += 1;
            }
            '(' => {
                out.push(Tok::Open);
                i += 1;
            }
            ')' => {
                out.push(Tok::Close);
                i += 1;
            }
            c if c.is_alphanumeric() || c == '_' || c == '$' => {
                let start = i;
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$' || chars[i] == '.') {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                if chars.get(i) == Some(&'!') {
                    i += 1;
                    out.push(Tok::Sheet(word));
                } else {
                    out.push(Tok::Word(word));
                }
            }
            _ => return Err("#NAME?"),
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq)]
enum Expr {
    Num(f64),
    Str(String),
    Bool(bool),
    Cell(Option<String>, usize, usize),
    Range(Option<String>, (usize, usize), (usize, usize)),
    Neg(Box<Expr>),
    Percent(Box<Expr>),
    Bin(&'static str, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

struct Parser {
    toks: Vec<Tok>,
    at: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at)
    }
    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.at).cloned();
        self.at += 1;
        t
    }
    // comparison < concatenation < additive < multiplicative < power < unary < percent < primary
    fn compare(&mut self) -> Result<Expr, &'static str> {
        let mut left = self.concat()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op('=')) => "=",
                Some(Tok::Op('<')) => "<",
                Some(Tok::Op('>')) => ">",
                Some(Tok::Le) => "<=",
                Some(Tok::Ge) => ">=",
                Some(Tok::Ne) => "<>",
                _ => return Ok(left),
            };
            self.at += 1;
            left = Expr::Bin(op, Box::new(left), Box::new(self.concat()?));
        }
    }
    fn concat(&mut self) -> Result<Expr, &'static str> {
        let mut left = self.additive()?;
        while self.peek() == Some(&Tok::Op('&')) {
            self.at += 1;
            left = Expr::Bin("&", Box::new(left), Box::new(self.additive()?));
        }
        Ok(left)
    }
    fn additive(&mut self) -> Result<Expr, &'static str> {
        let mut left = self.multiplicative()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op('+')) => "+",
                Some(Tok::Op('-')) => "-",
                _ => return Ok(left),
            };
            self.at += 1;
            left = Expr::Bin(op, Box::new(left), Box::new(self.multiplicative()?));
        }
    }
    fn multiplicative(&mut self) -> Result<Expr, &'static str> {
        let mut left = self.power()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op('*')) => "*",
                Some(Tok::Op('/')) => "/",
                _ => return Ok(left),
            };
            self.at += 1;
            left = Expr::Bin(op, Box::new(left), Box::new(self.power()?));
        }
    }
    fn power(&mut self) -> Result<Expr, &'static str> {
        let base = self.unary()?;
        if self.peek() == Some(&Tok::Op('^')) {
            self.at += 1;
            return Ok(Expr::Bin("^", Box::new(base), Box::new(self.power()?)));
        }
        Ok(base)
    }
    fn unary(&mut self) -> Result<Expr, &'static str> {
        match self.peek() {
            Some(Tok::Op('-')) => {
                self.at += 1;
                Ok(Expr::Neg(Box::new(self.unary()?)))
            }
            Some(Tok::Op('+')) => {
                self.at += 1;
                self.unary()
            }
            _ => self.percent(),
        }
    }
    fn percent(&mut self) -> Result<Expr, &'static str> {
        let mut e = self.primary()?;
        while self.peek() == Some(&Tok::Op('%')) {
            self.at += 1;
            e = Expr::Percent(Box::new(e));
        }
        Ok(e)
    }
    fn reference(&mut self, sheet: Option<String>, word: &str) -> Result<Expr, &'static str> {
        let start = parse_cell(word).ok_or("#NAME?")?;
        if self.peek() == Some(&Tok::Colon) {
            self.at += 1;
            let end = match self.next() {
                Some(Tok::Word(w)) => parse_cell(&w).ok_or("#REF!")?,
                _ => return Err("#REF!"),
            };
            let (r0, r1) = (start.0.min(end.0), start.0.max(end.0));
            let (c0, c1) = (start.1.min(end.1), start.1.max(end.1));
            return Ok(Expr::Range(sheet, (r0, c0), (r1, c1)));
        }
        Ok(Expr::Cell(sheet, start.0, start.1))
    }
    fn primary(&mut self) -> Result<Expr, &'static str> {
        match self.next().ok_or("#VALUE!")? {
            Tok::Num(n) => Ok(Expr::Num(n)),
            Tok::Str(s) => Ok(Expr::Str(s)),
            Tok::Open => {
                let e = self.compare()?;
                if self.next() != Some(Tok::Close) {
                    return Err("#VALUE!");
                }
                Ok(e)
            }
            Tok::Sheet(sheet) => match self.next() {
                Some(Tok::Word(w)) => self.reference(Some(sheet), &w),
                _ => Err("#REF!"),
            },
            Tok::Word(w) => {
                if self.peek() == Some(&Tok::Open) {
                    self.at += 1;
                    let mut args = Vec::new();
                    if self.peek() == Some(&Tok::Close) {
                        self.at += 1;
                        return Ok(Expr::Call(w.to_ascii_uppercase(), args));
                    }
                    loop {
                        args.push(self.compare()?);
                        match self.next() {
                            Some(Tok::Comma) => {}
                            Some(Tok::Close) => break,
                            _ => return Err("#VALUE!"),
                        }
                    }
                    return Ok(Expr::Call(w.to_ascii_uppercase(), args));
                }
                match w.to_ascii_uppercase().as_str() {
                    "TRUE" => Ok(Expr::Bool(true)),
                    "FALSE" => Ok(Expr::Bool(false)),
                    _ => self.reference(None, &w),
                }
            }
            _ => Err("#VALUE!"),
        }
    }
}

fn parse(formula: &str) -> Result<Expr, &'static str> {
    let mut p = Parser { toks: tokens(formula)?, at: 0 };
    let e = p.compare()?;
    if p.at != p.toks.len() {
        return Err("#VALUE!");
    }
    Ok(e)
}

// ---- working out --------------------------------------------------------------------------------------------------

/// A workbook's sheets, by name, as the text in their cells.
pub type Book<'a> = HashMap<&'a str, &'a [Vec<String>]>;

const MAX_DEPTH: usize = 200;
const MAX_RANGE: usize = 100_000;

/// Works out every cell of one sheet, remembering what it has worked out so each cell is done once.
pub struct Calc<'a> {
    book: &'a Book<'a>,
    done: HashMap<(String, usize, usize), Val>,
    busy: Vec<(String, usize, usize)>,
}

impl<'a> Calc<'a> {
    pub fn new(book: &'a Book<'a>) -> Calc<'a> {
        Calc { book, done: HashMap::new(), busy: Vec::new() }
    }

    fn sheet_key(&self, sheet: &str) -> Option<&'a str> {
        self.book.keys().find(|k| k.eq_ignore_ascii_case(sheet)).copied()
    }

    pub fn cell(&mut self, sheet: &str, row: usize, col: usize) -> Val {
        let Some(sheet) = self.sheet_key(sheet) else { return Val::Err("#REF!") };
        let key = (sheet.to_owned(), row, col);
        if let Some(v) = self.done.get(&key) {
            return v.clone();
        }
        if self.busy.contains(&key) || self.busy.len() > MAX_DEPTH {
            return Val::Err("#CYCLE!");
        }
        let raw = self.book[sheet].get(row).and_then(|r| r.get(col)).map_or("", String::as_str);
        let value = if let Some(formula) = raw.strip_prefix('=') {
            self.busy.push(key.clone());
            let v = match parse(formula) {
                Ok(e) => self.eval(sheet, &e),
                Err(e) => Val::Err(e),
            };
            self.busy.pop();
            v
        } else if raw.trim().is_empty() {
            Val::Empty
        } else if let Some(n) = number(raw) {
            Val::Num(n)
        } else {
            Val::Text(raw.to_owned())
        };
        self.done.insert(key, value.clone());
        value
    }

    fn range(&mut self, here: &str, sheet: Option<&String>, from: (usize, usize), to: (usize, usize)) -> Result<Vec<Val>, &'static str> {
        let sheet = sheet.map_or(here, String::as_str).to_owned();
        let count = (to.0 - from.0 + 1) * (to.1 - from.1 + 1);
        if count > MAX_RANGE {
            return Err("#REF!");
        }
        // Only the rows the sheet has: a whole-column range like A1:A1000 stays cheap.
        let rows = self.sheet_key(&sheet).map_or(0, |k| self.book[k].len());
        let mut out = Vec::new();
        for r in from.0..=to.0.min(rows.saturating_sub(1)) {
            for c in from.1..=to.1 {
                out.push(self.cell(&sheet, r, c));
            }
        }
        Ok(out)
    }

    /// The values an argument stands for: a range gives all of its cells.
    fn values(&mut self, here: &str, e: &Expr) -> Result<Vec<Val>, &'static str> {
        match e {
            Expr::Range(sheet, from, to) => self.range(here, sheet.as_ref(), *from, *to),
            other => Ok(vec![self.eval(here, other)]),
        }
    }

    fn numbers(&mut self, here: &str, args: &[Expr]) -> Result<Vec<f64>, &'static str> {
        let mut out = Vec::new();
        for a in args {
            let from_range = matches!(a, Expr::Range(..));
            for v in self.values(here, a)? {
                match v {
                    Val::Err(e) => return Err(e),
                    Val::Num(n) => out.push(n),
                    // In a range, text and empty cells are left out, as spreadsheets do.
                    Val::Text(_) | Val::Empty | Val::Bool(_) if from_range => {}
                    other => out.push(other.num()?),
                }
            }
        }
        Ok(out)
    }

    fn eval(&mut self, here: &str, e: &Expr) -> Val {
        match self.eval_inner(here, e) {
            Ok(v) => v,
            Err(err) => Val::Err(err),
        }
    }

    fn eval_inner(&mut self, here: &str, e: &Expr) -> Result<Val, &'static str> {
        Ok(match e {
            Expr::Num(n) => Val::Num(*n),
            Expr::Str(s) => Val::Text(s.clone()),
            Expr::Bool(b) => Val::Bool(*b),
            Expr::Cell(sheet, r, c) => {
                let v = self.cell(sheet.as_deref().unwrap_or(here), *r, *c);
                if let Val::Err(e) = v { return Err(e) }
                v
            }
            Expr::Range(..) => return Err("#VALUE!"),
            Expr::Neg(x) => Val::Num(-self.eval_inner(here, x)?.num()?),
            Expr::Percent(x) => Val::Num(self.eval_inner(here, x)?.num()? / 100.0),
            Expr::Bin(op, a, b) => {
                let (a, b) = (self.eval_inner(here, a)?, self.eval_inner(here, b)?);
                match *op {
                    "&" => Val::Text(a.text()? + &b.text()?),
                    "+" => Val::Num(a.num()? + b.num()?),
                    "-" => Val::Num(a.num()? - b.num()?),
                    "*" => Val::Num(a.num()? * b.num()?),
                    "/" => {
                        let d = b.num()?;
                        if d == 0.0 {
                            return Err("#DIV/0!");
                        }
                        Val::Num(a.num()? / d)
                    }
                    "^" => Val::Num(a.num()?.powf(b.num()?)),
                    op => {
                        let order = match (&a, &b) {
                            (Val::Text(x), Val::Text(y)) => x.to_lowercase().cmp(&y.to_lowercase()),
                            (Val::Text(_), _) => std::cmp::Ordering::Greater,
                            (_, Val::Text(_)) => std::cmp::Ordering::Less,
                            _ => a.num()?.partial_cmp(&b.num()?).unwrap_or(std::cmp::Ordering::Equal),
                        };
                        use std::cmp::Ordering::{Equal, Greater, Less};
                        Val::Bool(match op {
                            "=" => order == Equal,
                            "<>" => order != Equal,
                            "<" => order == Less,
                            ">" => order == Greater,
                            "<=" => order != Greater,
                            _ => order != Less,
                        })
                    }
                }
            }
            Expr::Call(name, args) => self.call(here, name, args)?,
        })
    }

    fn call(&mut self, here: &str, name: &str, args: &[Expr]) -> Result<Val, &'static str> {
        let want = |n: usize| if args.len() == n { Ok(()) } else { Err("#VALUE!") };
        Ok(match name {
            "SUM" => Val::Num(self.numbers(here, args)?.iter().sum()),
            "AVERAGE" => {
                let n = self.numbers(here, args)?;
                if n.is_empty() {
                    return Err("#DIV/0!");
                }
                Val::Num(n.iter().sum::<f64>() / n.len() as f64)
            }
            "MIN" => Val::Num(self.numbers(here, args)?.into_iter().reduce(f64::min).unwrap_or(0.0)),
            "MAX" => Val::Num(self.numbers(here, args)?.into_iter().reduce(f64::max).unwrap_or(0.0)),
            "COUNT" => {
                let mut n = 0;
                for a in args {
                    n += self.values(here, a)?.iter().filter(|v| matches!(v, Val::Num(_))).count();
                }
                Val::Num(n as f64)
            }
            "COUNTA" => {
                let mut n = 0;
                for a in args {
                    n += self.values(here, a)?.iter().filter(|v| !matches!(v, Val::Empty)).count();
                }
                Val::Num(n as f64)
            }
            "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
                if args.is_empty() || args.len() > 2 {
                    return Err("#VALUE!");
                }
                let x = self.eval_inner(here, &args[0])?.num()?;
                let places = match args.get(1) {
                    Some(p) => self.eval_inner(here, p)?.num()?.trunc(),
                    None => 0.0,
                };
                let f = 10f64.powf(places);
                let scaled = x * f;
                let r = match name {
                    "ROUND" => (scaled + if scaled >= 0.0 { 1e-9 } else { -1e-9 }).round(),
                    "ROUNDUP" => if scaled >= 0.0 { scaled.ceil() } else { scaled.floor() },
                    _ => scaled.trunc(),
                };
                Val::Num(r / f)
            }
            "ABS" => {
                want(1)?;
                Val::Num(self.eval_inner(here, &args[0])?.num()?.abs())
            }
            "IF" => {
                if args.len() < 2 || args.len() > 3 {
                    return Err("#VALUE!");
                }
                if self.eval_inner(here, &args[0])?.truth()? {
                    self.eval_inner(here, &args[1])?
                } else {
                    match args.get(2) {
                        Some(e) => self.eval_inner(here, e)?,
                        None => Val::Bool(false),
                    }
                }
            }
            "AND" | "OR" => {
                let mut all = Vec::new();
                for a in args {
                    for v in self.values(here, a)? {
                        if !matches!(v, Val::Empty) {
                            all.push(v.truth()?);
                        }
                    }
                }
                Val::Bool(if name == "AND" { all.iter().all(|b| *b) } else { all.iter().any(|b| *b) })
            }
            "NOT" => {
                want(1)?;
                Val::Bool(!self.eval_inner(here, &args[0])?.truth()?)
            }
            "CONCAT" | "CONCATENATE" => {
                let mut s = String::new();
                for a in args {
                    for v in self.values(here, a)? {
                        s.push_str(&v.text()?);
                    }
                }
                Val::Text(s)
            }
            "LEN" => {
                want(1)?;
                Val::Num(self.eval_inner(here, &args[0])?.text()?.chars().count() as f64)
            }
            "UPPER" | "LOWER" | "TRIM" => {
                want(1)?;
                let t = self.eval_inner(here, &args[0])?.text()?;
                Val::Text(match name {
                    "UPPER" => t.to_uppercase(),
                    "LOWER" => t.to_lowercase(),
                    _ => t.split_whitespace().collect::<Vec<_>>().join(" "),
                })
            }
            "SUMIF" | "COUNTIF" => {
                if args.len() < 2 || args.len() > 3 {
                    return Err("#VALUE!");
                }
                let range = self.values(here, &args[0])?;
                let test = self.eval_inner(here, &args[1])?;
                let summed = match args.get(2) {
                    Some(r) => self.values(here, r)?,
                    None => range.clone(),
                };
                let (mut sum, mut count) = (0.0, 0.0);
                for (i, v) in range.iter().enumerate() {
                    if matches_criterion(v, &test) {
                        count += 1.0;
                        if let Some(Val::Num(n)) = summed.get(i) {
                            sum += n;
                        }
                    }
                }
                Val::Num(if name == "SUMIF" { sum } else { count })
            }
            _ => return Err("#NAME?"),
        })
    }
}

/// SUMIF's test: a value to equal, or `">10"`, `"<>done"` and the like.
fn matches_criterion(v: &Val, test: &Val) -> bool {
    let text = test.show();
    let (op, rest) = ["<=", ">=", "<>", "<", ">", "="].iter().find_map(|op| text.strip_prefix(op).map(|r| (*op, r))).unwrap_or(("=", text.as_str()));
    match (v.num().ok().filter(|_| !matches!(v, Val::Text(_) | Val::Empty)), number(rest)) {
        (Some(a), Some(b)) => match op {
            "<=" => a <= b,
            ">=" => a >= b,
            "<>" => a != b,
            "<" => a < b,
            ">" => a > b,
            _ => a == b,
        },
        _ => {
            let same = v.show().eq_ignore_ascii_case(rest);
            if op == "<>" { !same } else { op == "=" && same }
        }
    }
}

/// Every cell of a sheet worked out, as shown.
pub fn compute(book: &Book<'_>, sheet: &str) -> Vec<Vec<String>> {
    let mut calc = Calc::new(book);
    let rows = book.get(sheet).map_or(0, |s| s.len());
    let width = book.get(sheet).map_or(0, |s| s.iter().map(Vec::len).max().unwrap_or(0));
    (0..rows).map(|r| (0..width).map(|c| calc.cell(sheet, r, c).show()).collect()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(rows: &[&[&str]]) -> Vec<Vec<String>> {
        rows.iter().map(|r| r.iter().map(|c| (*c).to_owned()).collect()).collect()
    }

    #[test]
    fn numbers_and_names_read_as_people_write_them() {
        assert_eq!(number("1,200.50"), Some(1200.5));
        assert_eq!(number("$40"), Some(40.0));
        assert_eq!(number("12%"), Some(0.12));
        assert_eq!(number("-3"), Some(-3.0));
        assert_eq!(number("Hotel"), None);
        assert_eq!(parse_cell("B2"), Some((1, 1)));
        assert_eq!(parse_cell("$AA$10"), Some((9, 26)));
        assert_eq!(parse_cell("A0"), None);
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(27), "AB");
        assert_eq!(cell_name(1, 3), "D2");
        assert_eq!(show_number(0.1 + 0.2), "0.3");
        assert_eq!(show_number(1e20), "100000000000000000000");
    }

    #[test]
    fn the_budget_from_the_design_works_out() {
        let budget = sheet(&[
            &["Item", "Qty", "Unit", "Total", "Per person"],
            &["Hotel", "14", "320", "=B2*C2", "=ROUND(D2/People!$B$1,2)"],
            &["Terrace venue", "1", "620", "=B3*C3", "=ROUND(D3/People!B1,2)"],
            &["Lunch", "=People!B1", "$40", "=B4*C4", "=ROUND(D4/People!B1,2)"],
            &["Total", "", "", "=SUM(D2:D4)", "=SUM(E2:E4)"],
            &["Left", "", "", "=6000-D5", "=IF(D6<0,\"over\",\"within budget\")"],
        ]);
        let people = sheet(&[&["People", "8"]]);
        let book: Book = [("Budget", budget.as_slice()), ("People", people.as_slice())].into_iter().collect();
        let out = compute(&book, "Budget");
        assert_eq!(out[1][3], "4480");
        assert_eq!(out[3][3], "320");
        assert_eq!(out[4][3], "5420");
        assert_eq!(out[4][4], "677.5");
        assert_eq!(out[5][3], "580");
        assert_eq!(out[5][4], "within budget");
    }

    #[test]
    fn functions_errors_and_loops() {
        let s = sheet(&[
            &["3", "x", "", "=A1/C1", "=A1+B1"],
            &["5", "done", "=A3", "=C2", "=NOPE(1)"],
            &["=C2", "=AVERAGE(A1:A2)", "=COUNT(A1:B2)", "=COUNTA(A1:B2)", "=MAX(A1:A2)&\" max\""],
            &["=SUMIF(A1:A2,\">4\")", "=COUNTIF(B1:B2,\"done\")", "=AND(A1>1,A2>4)", "=OR(FALSE,0)", "=UPPER(B2)&LEN(B2)"],
            &["=2^3^2", "=-2^2", "=50%*10", "=\"a\"=\"A\"", "=ROUND(2.5)+ROUND(-2.5)"],
        ]);
        let book: Book = [("S", s.as_slice())].into_iter().collect();
        let out = compute(&book, "S");
        assert_eq!(out[0][3], "#DIV/0!");
        assert_eq!(out[0][4], "#VALUE!", "text in arithmetic");
        assert_eq!(out[1][2], "#CYCLE!");
        assert_eq!(out[2][0], "#CYCLE!");
        assert_eq!(out[1][4], "#NAME?");
        assert_eq!((out[2][1].as_str(), out[2][2].as_str(), out[2][3].as_str(), out[2][4].as_str()), ("4", "2", "4", "5 max"));
        assert_eq!((out[3][0].as_str(), out[3][1].as_str(), out[3][2].as_str(), out[3][3].as_str(), out[3][4].as_str()), ("5", "1", "TRUE", "FALSE", "DONE4"));
        assert_eq!((out[4][0].as_str(), out[4][1].as_str(), out[4][2].as_str(), out[4][3].as_str(), out[4][4].as_str()), ("512", "4", "5", "TRUE", "0"));
        let missing: Book = [("S", sheet(&[&["=Other!A1"]]).leak() as &[Vec<String>])].into_iter().collect();
        assert_eq!(compute(&missing, "S")[0][0], "#REF!");
    }
}
