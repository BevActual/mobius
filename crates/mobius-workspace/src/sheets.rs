//! Sheets: each workbook is a folder in `<workspace>/sheets`, each of its sheets a CSV file (`Budget.csv`), so any
//! spreadsheet app can open them and the agent can read them as text. A cell starting with `=` is a formula, worked out
//! by [`crate::formula`]. The order of the sheets is kept in `.order` inside the folder.
//!
//! As with notes and tasks, a checkpoint is taken before the agent changes a workbook, so it can be put back.
use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::checkpoints::Checkpoints;
use crate::formula::{Book, cell_name, compute, parse_cell};
use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "sheets";
const ORDER: &str = ".order";
const MAX_FILE: usize = 4 * 1024 * 1024;
const MAX_ROWS: usize = 10_000;
const MAX_COLS: usize = 200;
const MAX_CELL: usize = 10_000;
const MAX_WRITE: usize = 2_000;

// ---- CSV ------------------------------------------------------------------------------------------------------------

/// RFC 4180: commas between cells, quotes around cells with commas, quotes or line breaks, doubled quotes inside.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    cell.push('"');
                    chars.next();
                }
                '"' => quoted = false,
                c => cell.push(c),
            }
            continue;
        }
        match c {
            '"' if cell.is_empty() => quoted = true,
            ',' => row.push(std::mem::take(&mut cell)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            c => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    rows
}

pub fn write_csv(rows: &[Vec<String>]) -> String {
    let mut out = String::new();
    for row in rows {
        let cells: Vec<String> = row
            .iter()
            .map(|c| if c.contains([',', '"', '\n', '\r']) || c.starts_with(' ') || c.ends_with(' ') { format!("\"{}\"", c.replace('"', "\"\"")) } else { c.clone() })
            .collect();
        out.push_str(&cells.join(","));
        out.push('\n');
    }
    out
}

/// Trailing empty cells and rows are not kept, so the file stays as small as what is in it.
fn trim(rows: &mut Vec<Vec<String>>) {
    for row in rows.iter_mut() {
        while row.last().is_some_and(String::is_empty) {
            row.pop();
        }
    }
    while rows.last().is_some_and(Vec::is_empty) {
        rows.pop();
    }
}

fn version_of(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    format!("{h:016x}")
}

fn name_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}

// ---- the store ------------------------------------------------------------------------------------------------------

pub struct Sheets {
    root: PathBuf,
    checkpoints: Checkpoints,
    workspace: PathBuf,
}

pub fn tool_descriptions() -> Vec<Value> {
    vec![
        json!({ "name": "sheets.list", "capability": "sheets.read",
            "description": "List the person's workbooks in the Sheets app and the sheets in each.",
            "input_schema": { "type": "object", "properties": {} } }),
        json!({ "name": "sheets.read", "capability": "sheets.read", "resource_arg": "workbook",
            "description": "Read a sheet in the Sheets app: every cell that is not empty, by its address (A1), with its value worked out and, for a formula, the formula. Answer from these values, never estimate, and say which cells an answer used.",
            "input_schema": { "type": "object", "properties": {
                "workbook": { "type": "string" }, "sheet": { "type": "string", "description": "Leave out for the first sheet." } }, "required": ["workbook"] } }),
        json!({ "name": "sheets.write", "capability": "sheets.write", "resource_arg": "workbook",
            "description": "Set cells in a sheet of the Sheets app, making the workbook or sheet if it is not there. A value starting with = is a formula (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ROUND, ABS, IF, AND, OR, NOT, SUMIF, COUNTIF, CONCAT, LEN, UPPER, LOWER, TRIM; other sheets as Sheet!A1 or 'My sheet'!A1). Prefer a formula to a typed number when a value depends on other cells, so it stays right when they change. An empty value clears a cell.",
            "input_schema": { "type": "object", "properties": {
                "workbook": { "type": "string" }, "sheet": { "type": "string", "description": "Leave out for the first sheet (or Sheet 1 in a new workbook)." },
                "cells": { "type": "object", "description": "Address to value, such as {\"E1\": \"Per person\", \"E2\": \"=D2/People!B1\"}.", "additionalProperties": { "type": "string" } } },
                "required": ["workbook", "cells"] } }),
    ]
}

pub fn is_sheet_tool(name: &str) -> bool {
    tool_descriptions().iter().any(|d| d["name"] == name)
}

impl Sheets {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Sheets {
        let workspace = workspace.into();
        Sheets { root: workspace.join(FOLDER), checkpoints: Checkpoints::new(checkpoint_store), workspace }
    }

    fn folder(&self, workbook: &str) -> Res<PathBuf> {
        if !name_ok(workbook) {
            return Err("that is not a workbook".into());
        }
        let dir = self.root.join(workbook);
        if dir.exists() {
            let real = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
            let root = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
            if real.parent() != Some(root.as_path()) || !real.is_dir() {
                return Err("that is not a workbook".into());
            }
        }
        Ok(dir)
    }

    fn file(&self, workbook: &str, sheet: &str) -> Res<PathBuf> {
        if !name_ok(sheet) {
            return Err("that is not a sheet".into());
        }
        Ok(self.folder(workbook)?.join(format!("{sheet}.csv")))
    }

    /// The sheets of a workbook in their order: as `.order` says, then any others by name.
    pub fn sheets_of(&self, workbook: &str) -> Res<Vec<String>> {
        let dir = self.folder(workbook)?;
        let mut found: Vec<String> = fs::read_dir(&dir)
            .map_err(|_| "that workbook is not there".to_owned())?
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".csv")).map(str::to_owned))
            .filter(|n| name_ok(n))
            .collect();
        found.sort_by_key(|n| n.to_lowercase());
        let order: Vec<String> = fs::read_to_string(dir.join(ORDER)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let mut out: Vec<String> = order.into_iter().filter(|n| found.contains(n)).collect();
        let rest: Vec<String> = found.into_iter().filter(|n| !out.contains(n)).collect();
        out.extend(rest);
        Ok(out)
    }

    fn set_order(&self, workbook: &str, order: &[String]) -> Res<()> {
        fs::write(self.folder(workbook)?.join(ORDER), json!(order).to_string()).map_err(|e| e.to_string())
    }

    fn load(&self, workbook: &str, sheet: &str) -> Res<(Vec<Vec<String>>, String)> {
        let text = fs::read_to_string(self.file(workbook, sheet)?).map_err(|_| "that sheet is not there".to_owned())?;
        if text.len() > MAX_FILE {
            return Err("that sheet is too big".into());
        }
        Ok((parse_csv(&text), version_of(&text)))
    }

    fn store(&self, workbook: &str, sheet: &str, rows: &[Vec<String>]) -> Res<String> {
        let file = self.file(workbook, sheet)?;
        let text = write_csv(rows);
        let temp = file.with_extension("csv.mobius-tmp");
        fs::write(&temp, &text).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(version_of(&text))
    }

    /// Every workbook with its sheets, by name.
    pub fn list(&self) -> Res<Value> {
        let Ok(dir) = fs::read_dir(&self.root) else { return Ok(json!([])) };
        let mut names: Vec<String> = dir.filter_map(Result::ok).filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).filter_map(|e| e.file_name().to_str().map(str::to_owned)).filter(|n| name_ok(n)).collect();
        names.sort_by_key(|n| n.to_lowercase());
        Ok(Value::Array(names.into_iter().filter_map(|n| self.sheets_of(&n).ok().map(|s| json!({ "name": n, "sheets": s }))).collect()))
    }

    /// The whole workbook as text, for formulas that look at other sheets.
    fn book(&self, workbook: &str) -> Res<Vec<(String, Vec<Vec<String>>)>> {
        self.sheets_of(workbook)?.into_iter().map(|s| self.load(workbook, &s).map(|(rows, _)| (s, rows))).collect()
    }

    /// A sheet as typed (`cells`) and as worked out (`values`), with the version to send back with a change.
    pub fn read(&self, workbook: &str, sheet: &str) -> Res<Value> {
        let book = self.book(workbook)?;
        let (rows, version) = self.load(workbook, sheet)?;
        let map: Book = book.iter().map(|(n, r)| (n.as_str(), r.as_slice())).collect();
        let values = compute(&map, sheet);
        Ok(json!({ "workbook": workbook, "sheet": sheet, "sheets": book.iter().map(|(n, _)| n).collect::<Vec<_>>(), "cells": rows, "values": values, "version": version }))
    }

    /// Sets cells, each `(row, column, text)`. Refused when the sheet changed since `expect` (its version when read),
    /// so a change made elsewhere is never overwritten.
    pub fn set_cells(&self, workbook: &str, sheet: &str, changes: &[(usize, usize, String)], expect: Option<&str>) -> Res<Value> {
        let (mut rows, version) = self.load(workbook, sheet)?;
        if expect.is_some_and(|e| e != version) {
            return Err("changed elsewhere".into());
        }
        if changes.len() > MAX_WRITE {
            return Err(format!("at most {MAX_WRITE} cells at once"));
        }
        for (r, c, text) in changes {
            if *r >= MAX_ROWS || *c >= MAX_COLS {
                return Err(format!("a sheet has at most {MAX_ROWS} rows and {MAX_COLS} columns"));
            }
            if text.chars().count() > MAX_CELL {
                return Err("that is too much for one cell".into());
            }
            if rows.len() <= *r {
                rows.resize(r + 1, Vec::new());
            }
            let row = &mut rows[*r];
            if row.len() <= *c {
                row.resize(c + 1, String::new());
            }
            row[*c] = text.replace("\r\n", "\n");
        }
        trim(&mut rows);
        self.store(workbook, sheet, &rows)?;
        self.read(workbook, sheet)
    }

    /// Puts a row (or column) in before `at`, or takes it out. Formulas are not moved with it.
    pub fn shift(&self, workbook: &str, sheet: &str, what: &str, at: usize, insert: bool) -> Res<Value> {
        let (mut rows, _) = self.load(workbook, sheet)?;
        match (what, insert) {
            ("row", true) if at <= rows.len() => rows.insert(at, Vec::new()),
            ("row", false) if at < rows.len() => {
                rows.remove(at);
            }
            ("column", true) => rows.iter_mut().filter(|r| r.len() > at).for_each(|r| r.insert(at, String::new())),
            ("column", false) => rows.iter_mut().filter(|r| r.len() > at).for_each(|r| {
                r.remove(at);
            }),
            ("row", _) => {}
            _ => return Err("a row or a column".into()),
        }
        trim(&mut rows);
        self.store(workbook, sheet, &rows)?;
        self.read(workbook, sheet)
    }

    pub fn create_workbook(&self, name: &str) -> Res<Value> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let base = file_name_for(name.trim());
        let mut chosen = base.clone();
        let mut n = 2;
        while self.root.join(&chosen).exists() {
            chosen = format!("{base} {n}");
            n += 1;
        }
        fs::create_dir(self.root.join(&chosen)).map_err(|e| e.to_string())?;
        self.store(&chosen, "Sheet 1", &[])?;
        self.set_order(&chosen, &["Sheet 1".to_owned()])?;
        Ok(json!({ "name": chosen, "sheet": "Sheet 1" }))
    }

    pub fn add_sheet(&self, workbook: &str, name: &str) -> Res<Value> {
        let mut order = self.sheets_of(workbook)?;
        let base = file_name_for(name.trim());
        let mut chosen = base.clone();
        let mut n = 2;
        while order.iter().any(|s| s.eq_ignore_ascii_case(&chosen)) {
            chosen = format!("{base} {n}");
            n += 1;
        }
        self.store(workbook, &chosen, &[])?;
        order.push(chosen.clone());
        self.set_order(workbook, &order)?;
        Ok(json!({ "workbook": workbook, "sheet": chosen }))
    }

    pub fn rename_sheet(&self, workbook: &str, sheet: &str, name: &str) -> Res<Value> {
        let name = file_name_for(name.trim());
        let mut order = self.sheets_of(workbook)?;
        if order.iter().any(|s| s.eq_ignore_ascii_case(&name) && s != sheet) {
            return Err("there is already a sheet with that name".into());
        }
        fs::rename(self.file(workbook, sheet)?, self.file(workbook, &name)?).map_err(|e| e.to_string())?;
        for s in &mut order {
            if s == sheet {
                s.clone_from(&name);
            }
        }
        self.set_order(workbook, &order)?;
        Ok(json!({ "workbook": workbook, "sheet": name }))
    }

    /// Deletes a sheet, after a checkpoint, so it can be brought back. A workbook keeps at least one.
    pub fn remove_sheet(&self, workbook: &str, sheet: &str) -> Res<Value> {
        let mut order = self.sheets_of(workbook)?;
        if order.len() <= 1 {
            return Err("a workbook keeps at least one sheet".into());
        }
        let _ = self.checkpoints.snapshot(&self.workspace, &format!("before deleting the sheet {workbook}/{sheet}"));
        fs::remove_file(self.file(workbook, sheet)?).map_err(|e| e.to_string())?;
        order.retain(|s| s != sheet);
        self.set_order(workbook, &order)?;
        Ok(json!({ "workbook": workbook, "removed": sheet }))
    }

    /// The agent's tools. A change is checkpointed first, so it can be reviewed and put back.
    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        let text = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let result = match tool {
            "sheets.list" => self.list()?,
            "sheets.read" => {
                let workbook = text("workbook").ok_or("which workbook?")?;
                let sheet = match text("sheet") {
                    Some(s) => s.to_owned(),
                    None => self.sheets_of(workbook)?.into_iter().next().ok_or("that workbook has no sheets")?,
                };
                let got = self.read(workbook, &sheet)?;
                let mut cells = Vec::new();
                let typed = got["cells"].as_array().cloned().unwrap_or_default();
                for (r, row) in typed.iter().enumerate() {
                    for (c, raw) in row.as_array().into_iter().flatten().enumerate() {
                        let raw = raw.as_str().unwrap_or("");
                        if raw.is_empty() {
                            continue;
                        }
                        let value = got["values"][r][c].as_str().unwrap_or("");
                        let mut cell = json!({ "cell": cell_name(r, c), "value": value });
                        if raw.starts_with('=') {
                            cell["formula"] = json!(raw);
                        }
                        cells.push(cell);
                    }
                }
                json!({ "workbook": workbook, "sheet": sheet, "sheets": got["sheets"], "cells": cells })
            }
            "sheets.write" => {
                let workbook = file_name_for(text("workbook").ok_or("which workbook?")?);
                let cells = args.get("cells").and_then(Value::as_object).ok_or("cells is an object of address to value")?;
                let mut changes = Vec::new();
                for (address, value) in cells {
                    let (r, c) = parse_cell(address).ok_or_else(|| format!("{address} is not a cell address"))?;
                    let value = match value {
                        Value::String(s) => s.clone(),
                        Value::Null => String::new(),
                        other => other.to_string(),
                    };
                    changes.push((r, c, value));
                }
                self.checkpoint(&format!("before the agent changed the workbook {workbook}"));
                if !self.root.join(&workbook).is_dir() {
                    self.create_workbook(&workbook)?;
                }
                let sheets = self.sheets_of(&workbook)?;
                let sheet = match text("sheet") {
                    Some(s) if !sheets.iter().any(|x| x == s) => self.add_sheet(&workbook, s)?["sheet"].as_str().unwrap_or(s).to_owned(),
                    Some(s) => s.to_owned(),
                    None => sheets.into_iter().next().ok_or("that workbook has no sheets")?,
                };
                let after = self.set_cells(&workbook, &sheet, &changes, None)?;
                // What the changed cells came to, so the agent can check its formulas.
                let shown: serde_json::Map<String, Value> = changes.iter().map(|(r, c, _)| (cell_name(*r, *c), after["values"][*r][*c].clone())).collect();
                json!({ "workbook": workbook, "sheet": sheet, "values": shown })
            }
            _ => return Err("unknown tool".into()),
        };
        Ok(result.to_string())
    }

    fn checkpoint(&self, why: &str) {
        let _ = self.checkpoints.snapshot(&self.workspace, why);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Sheets) {
        let dir = tempfile::tempdir().unwrap();
        let s = Sheets::new(dir.path().join("workspace"), dir.path().join("checkpoints"));
        (dir, s)
    }

    #[test]
    fn csv_keeps_commas_quotes_and_line_breaks() {
        let rows = vec![vec!["Item".into(), "Note".into()], vec!["Hotel, Lisbon".into(), "He said \"yes\"\nthen left".into()], vec!["=SUM(A1:A2)".into()]];
        let text = write_csv(&rows);
        assert_eq!(text, "Item,Note\n\"Hotel, Lisbon\",\"He said \"\"yes\"\"\nthen left\"\n=SUM(A1:A2)\n");
        assert_eq!(parse_csv(&text), rows);
        assert_eq!(parse_csv("a,b\r\nc,d"), vec![vec!["a", "b"], vec!["c", "d"]]);
    }

    #[test]
    fn workbooks_hold_sheets_in_order_and_cells_are_worked_out() {
        let (_d, s) = store();
        let made = s.create_workbook("Offsite budget").unwrap();
        assert_eq!(made["sheet"], "Sheet 1");
        s.rename_sheet("Offsite budget", "Sheet 1", "Budget").unwrap();
        s.add_sheet("Offsite budget", "People").unwrap();
        assert_eq!(s.sheets_of("Offsite budget").unwrap(), vec!["Budget", "People"]);
        s.set_cells("Offsite budget", "People", &[(0, 0, "People".into()), (0, 1, "8".into())], None).unwrap();
        let read = s.read("Offsite budget", "Budget").unwrap();
        let v = read["version"].as_str().unwrap().to_owned();
        let after = s.set_cells("Offsite budget", "Budget", &[(0, 0, "Total".into()), (0, 1, "6000".into()), (1, 0, "Each".into()), (1, 1, "=B1/People!B1".into())], Some(&v)).unwrap();
        assert_eq!(after["values"][1][1], "750");
        assert!(s.set_cells("Offsite budget", "Budget", &[(0, 0, "x".into())], Some(&v)).unwrap_err().contains("changed elsewhere"));
        s.shift("Offsite budget", "Budget", "row", 0, true).unwrap();
        assert_eq!(s.read("Offsite budget", "Budget").unwrap()["cells"][1][0], "Total");
        assert!(s.remove_sheet("Offsite budget", "People").is_ok());
        assert!(s.remove_sheet("Offsite budget", "Budget").is_err(), "one sheet stays");
        assert!(s.read("../x", "Budget").is_err());
    }

    #[test]
    fn the_agent_reads_values_with_their_formulas_and_writes_cells() {
        let (_d, s) = store();
        let wrote: Value = serde_json::from_str(&s.run("sheets.write", &json!({ "workbook": "Trip", "cells": { "A1": "Hotel", "B1": "320", "A2": "Nights", "B2": "2", "B3": "=B1*B2" } })).unwrap()).unwrap();
        assert_eq!(wrote["values"]["B3"], "640");
        let read: Value = serde_json::from_str(&s.run("sheets.read", &json!({ "workbook": "Trip" })).unwrap()).unwrap();
        assert_eq!(read["sheet"], "Sheet 1");
        assert!(read["cells"].as_array().unwrap().contains(&json!({ "cell": "B3", "value": "640", "formula": "=B1*B2" })));
        s.run("sheets.write", &json!({ "workbook": "Trip", "sheet": "Flights", "cells": { "A1": "=Sheet 1!B3" } })).unwrap_or_default();
        let listed: Value = serde_json::from_str(&s.run("sheets.list", &json!({})).unwrap()).unwrap();
        assert_eq!(listed[0]["sheets"], json!(["Sheet 1", "Flights"]));
        assert!(s.run("sheets.write", &json!({ "workbook": "Trip", "cells": { "nope": "1" } })).is_err());
    }
}
