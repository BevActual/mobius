//! Language smarts for the Code app: a language server already on this computer (or in the project's own
//! `node_modules/.bin`), started once per project and language, spoken to in its own protocol over its input and
//! output. The editor sends what a file holds as it changes and asks for completions, hover text, where something is
//! defined, a rename and formatting; the server's problems come back as `mobius:code-problems`. Nothing is
//! downloaded: a language without a server says which program would bring it.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::bridge::Emit;

/// How long a question waits for its answer; a server still starting up can be slow to answer the first.
const ASK_TIMEOUT: Duration = Duration::from_secs(8);
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// A program that was not found is looked for again after this long, not on every keystroke.
const MISSING_AGAIN: Duration = Duration::from_secs(60);
const MAX_ITEMS: usize = 300;

/// A language the editor can be smart about, and the programs that bring it, in the order they are tried.
pub struct Language {
    pub key: &'static str,
    pub name: &'static str,
    programs: &'static [(&'static str, &'static [&'static str])],
}

const TYPESCRIPT: Language = Language { key: "typescript", name: "TypeScript and JavaScript", programs: &[("typescript-language-server", &["--stdio"])] };
const RUST: Language = Language { key: "rust", name: "Rust", programs: &[("rust-analyzer", &[])] };
const PYTHON: Language = Language { key: "python", name: "Python", programs: &[("pyright-langserver", &["--stdio"]), ("basedpyright-langserver", &["--stdio"]), ("pylsp", &[])] };
const GO: Language = Language { key: "go", name: "Go", programs: &[("gopls", &[])] };
const C: Language = Language { key: "c", name: "C and C++", programs: &[("clangd", &[])] };
const CSS: Language = Language { key: "css", name: "CSS", programs: &[("vscode-css-language-server", &["--stdio"])] };
const HTML: Language = Language { key: "html", name: "HTML", programs: &[("vscode-html-language-server", &["--stdio"])] };
const JSON: Language = Language { key: "json", name: "JSON", programs: &[("vscode-json-language-server", &["--stdio"])] };

/// The language of a file, and the name the protocol gives it.
pub fn language_of(path: &str) -> Option<(&'static Language, &'static str)> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "ts" | "mts" | "cts" => (&TYPESCRIPT, "typescript"),
        "tsx" => (&TYPESCRIPT, "typescriptreact"),
        "js" | "mjs" | "cjs" => (&TYPESCRIPT, "javascript"),
        "jsx" => (&TYPESCRIPT, "javascriptreact"),
        "rs" => (&RUST, "rust"),
        "py" | "pyi" => (&PYTHON, "python"),
        "go" => (&GO, "go"),
        "c" | "h" => (&C, "c"),
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => (&C, "cpp"),
        "css" => (&CSS, "css"),
        "scss" => (&CSS, "scss"),
        "less" => (&CSS, "less"),
        "html" | "htm" => (&HTML, "html"),
        "json" => (&JSON, "json"),
        "jsonc" => (&JSON, "jsonc"),
        _ => return None,
    })
}

/// Where a program is: the project's own `node_modules/.bin` first (a project can bring its server), then the path.
fn find_program(dir: &Path, program: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) { [".exe", ".cmd", ".bat"].iter().map(|e| format!("{program}{e}")).collect() } else { vec![program.to_owned()] };
    let local = dir.join("node_modules").join(".bin");
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::iter::once(local).chain(std::env::split_paths(&path)).flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

fn file_uri(path: &Path) -> String {
    url::Url::from_file_path(path).map(String::from).unwrap_or_default()
}

/// A file the server names, as the editor knows it: relative to the project when it is inside, else as it is.
fn project_path(dir: &Path, uri: &str) -> Option<String> {
    let path = url::Url::parse(uri).ok()?.to_file_path().ok()?;
    let root = dir.canonicalize().unwrap_or_else(|_| dir.to_owned());
    let full = path.canonicalize().unwrap_or(path);
    Some(full.strip_prefix(&root).map_or_else(|_| full.to_string_lossy().into_owned(), |p| p.to_string_lossy().replace('\\', "/")))
}

fn write_message(out: &mut impl Write, message: &Value) -> std::io::Result<()> {
    let body = message.to_string();
    write!(out, "Content-Length: {}\r\n\r\n{body}", body.len())?;
    out.flush()
}

/// One message from the server, or `None` when it has ended. Lines that are not headers are passed over.
fn read_message(input: &mut impl BufRead) -> Option<Value> {
    loop {
        let mut length = None;
        loop {
            let mut line = String::new();
            if input.read_line(&mut line).ok()? == 0 {
                return None;
            }
            let line = line.trim_end();
            if line.is_empty() {
                if length.is_some() {
                    break;
                }
                continue;
            }
            if let Some((name, value)) = line.split_once(':')
                && name.trim().eq_ignore_ascii_case("content-length")
            {
                length = value.trim().parse::<usize>().ok();
            }
        }
        let mut body = vec![0u8; length?];
        input.read_exact(&mut body).ok()?;
        if let Ok(value) = serde_json::from_slice(&body) {
            return Some(value);
        }
    }
}

type Waiting = Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>;

/// Why a server is not running: no program for it on this computer, or one that would not start (and what it said).
enum StartError {
    Missing(Option<&'static str>),
    Failed(&'static str, String),
}

struct Server {
    program: String,
    dir: PathBuf,
    child: Mutex<Child>,
    input: Arc<Mutex<ChildStdin>>,
    next: AtomicI64,
    waiting: Waiting,
    alive: Arc<AtomicBool>,
    /// Each open file's version, by its address.
    versions: Mutex<HashMap<String, i64>>,
    /// The latest problems of each file, by its project path.
    problems: Arc<Mutex<HashMap<String, Value>>>,
}

impl Server {
    fn start(dir: &Path, project: &str, language: &Language, emit: &Emit) -> Result<Server, StartError> {
        let (program, args, path) = language.programs.iter().find_map(|(p, a)| find_program(dir, p).map(|path| (*p, *a, path))).ok_or(StartError::Missing(language.programs.first().map(|p| p.0)))?;
        let mut cmd = Command::new(&path);
        cmd.args(args).current_dir(dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        // A program just written (a project's install, or a test's stand-in) can be "busy" for a moment on Linux while
        // another thread's new process still holds the file open, so that one is tried again.
        let mut tries = 0;
        let mut child = loop {
            match cmd.spawn() {
                Err(e) if e.kind() == std::io::ErrorKind::ExecutableFileBusy && tries < 10 => {
                    tries += 1;
                    std::thread::sleep(Duration::from_millis(50));
                }
                other => break other.map_err(|e| StartError::Failed(program, e.to_string()))?,
            }
        };
        let (Some(input), Some(output), Some(mut errors)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err(StartError::Failed(program, "it could not be started".into()));
        };
        // Its error output is read so it never fills up and stops the server; the last of it says why one would not start.
        let said: Arc<Mutex<String>> = Arc::default();
        let kept = Arc::clone(&said);
        let (said_all, heard_all) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let _done = said_all;
            let mut buf = [0u8; 4096];
            while let Ok(n) = errors.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if let Ok(mut said) = kept.lock() {
                    said.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if said.len() > 4000 {
                        let cut = said.len() - 2000;
                        let cut = (cut..said.len()).find(|&i| said.is_char_boundary(i)).unwrap_or(0);
                        said.drain(..cut);
                    }
                }
            }
        });
        let server = Server {
            program: program.to_owned(),
            dir: dir.to_owned(),
            child: Mutex::new(child),
            input: Arc::new(Mutex::new(input)),
            next: AtomicI64::new(1),
            waiting: Arc::default(),
            alive: Arc::new(AtomicBool::new(true)),
            versions: Mutex::default(),
            problems: Arc::default(),
        };
        server.listen(output, project, emit);
        let root = file_uri(dir);
        let init = json!({
            "processId": std::process::id(),
            "clientInfo": { "name": "Mobius" },
            "rootUri": root,
            "workspaceFolders": [{ "uri": root, "name": project }],
            "capabilities": {
                "general": { "positionEncodings": ["utf-16"] },
                "workspace": { "configuration": true, "workspaceFolders": true, "applyEdit": false },
                "textDocument": {
                    "synchronization": { "didSave": false },
                    "completion": { "completionItem": { "snippetSupport": true, "documentationFormat": ["plaintext", "markdown"] }, "contextSupport": true },
                    "hover": { "contentFormat": ["markdown", "plaintext"] },
                    "definition": { "linkSupport": true },
                    "rename": { "prepareSupport": false },
                    "formatting": {},
                    "publishDiagnostics": { "relatedInformation": false },
                },
            },
        });
        server.ask_for("initialize", init, START_TIMEOUT).map_err(|message| {
            server.stop();
            // A server that ended has said all it will once its error output closes; waited for a moment, not longer.
            let _ = heard_all.recv_timeout(Duration::from_millis(500));
            let stderr = said.lock().map(|s| s.trim().lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")).unwrap_or_default();
            StartError::Failed(program, if stderr.is_empty() || message.contains("TypeScript") { message } else { format!("{message}: {stderr}") })
        })?;
        server.tell("initialized", json!({}));
        Ok(server)
    }

    /// Reads what the server sends: answers go to whoever asked, problems to the window, and its own questions get
    /// the plain answers an editor without settings gives.
    fn listen(&self, output: std::process::ChildStdout, project: &str, emit: &Emit) {
        let (waiting, alive, input, problems, dir, emit, project) =
            (Arc::clone(&self.waiting), Arc::clone(&self.alive), Arc::clone(&self.input), Arc::clone(&self.problems), self.dir.clone(), Arc::clone(emit), project.to_owned());
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            while let Some(message) = read_message(&mut reader) {
                let method = message.get("method").and_then(Value::as_str);
                match (message.get("id"), method) {
                    (Some(id), None) => {
                        if let Some(sender) = id.as_i64().and_then(|id| waiting.lock().ok()?.remove(&id)) {
                            let _ = sender.send(message);
                        }
                    }
                    (Some(id), Some(method)) => {
                        let result = match method {
                            "workspace/configuration" => Value::Array(vec![Value::Null; message.pointer("/params/items").and_then(Value::as_array).map_or(0, Vec::len)]),
                            "workspace/workspaceFolders" => json!([{ "uri": file_uri(&dir), "name": project }]),
                            _ => Value::Null,
                        };
                        if let Ok(mut input) = input.lock() {
                            let _ = write_message(&mut *input, &json!({ "jsonrpc": "2.0", "id": id, "result": result }));
                        }
                    }
                    (None, Some("textDocument/publishDiagnostics")) => {
                        let params = message.get("params").cloned().unwrap_or_default();
                        let Some(path) = params.get("uri").and_then(Value::as_str).and_then(|u| project_path(&dir, u)) else { continue };
                        let items = problems_of(&params);
                        if let Ok(mut all) = problems.lock() {
                            all.insert(path.clone(), items.clone());
                        }
                        emit("mobius:code-problems", json!({ "project": project, "path": path, "items": items }));
                    }
                    _ => {}
                }
            }
            alive.store(false, Ordering::SeqCst);
            // Whoever still waits hears at once that no answer will come.
            if let Ok(mut waiting) = waiting.lock() {
                waiting.clear();
            }
        });
    }

    fn tell(&self, method: &str, params: Value) {
        if let Ok(mut input) = self.input.lock() {
            let _ = write_message(&mut *input, &json!({ "jsonrpc": "2.0", "method": method, "params": params }));
        }
    }

    fn ask_for(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(format!("{} has stopped", self.program));
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (sender, answer) = mpsc::channel();
        self.waiting.lock().map_err(|_| "busy")?.insert(id, sender);
        {
            let mut input = self.input.lock().map_err(|_| "busy")?;
            write_message(&mut *input, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).map_err(|_| format!("{} has stopped", self.program))?;
        }
        let reply = answer.recv_timeout(timeout).map_err(|_| {
            if let Ok(mut waiting) = self.waiting.lock() {
                waiting.remove(&id);
            }
            if self.alive.load(Ordering::SeqCst) { format!("{} did not answer in time", self.program) } else { format!("{} has stopped", self.program) }
        })?;
        match reply.get("error") {
            Some(error) => Err(error.get("message").and_then(Value::as_str).unwrap_or("the language server could not answer").to_owned()),
            None => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
        }
    }

    /// Sends a file's whole text: opened the first time, changed after.
    fn sync(&self, path: &Path, language_id: &str, text: &str) {
        let uri = file_uri(path);
        let Ok(mut versions) = self.versions.lock() else { return };
        match versions.get_mut(&uri) {
            Some(version) => {
                *version += 1;
                self.tell("textDocument/didChange", json!({ "textDocument": { "uri": uri, "version": *version }, "contentChanges": [{ "text": text }] }));
            }
            None => {
                versions.insert(uri.clone(), 1);
                self.tell("textDocument/didOpen", json!({ "textDocument": { "uri": uri, "languageId": language_id, "version": 1, "text": text } }));
            }
        }
    }

    fn close(&self, path: &Path) {
        let uri = file_uri(path);
        if self.versions.lock().is_ok_and(|mut v| v.remove(&uri).is_some()) {
            self.tell("textDocument/didClose", json!({ "textDocument": { "uri": uri } }));
        }
    }

    fn stop(&self) {
        if self.alive.load(Ordering::SeqCst) {
            let _ = self.ask_for("shutdown", Value::Null, Duration::from_millis(500));
            self.tell("exit", Value::Null);
        }
        if let Ok(mut child) = self.child.lock() {
            let t = Instant::now();
            while t.elapsed() < Duration::from_millis(500) && matches!(child.try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn problems_of(params: &Value) -> Value {
    let items = params.get("diagnostics").and_then(Value::as_array).map(|all| {
        all.iter()
            .take(MAX_ITEMS)
            .map(|d| {
                let severity = match d.get("severity").and_then(Value::as_u64) {
                    Some(2) => "warning",
                    Some(3) => "info",
                    Some(4) => "hint",
                    _ => "error",
                };
                json!({
                    "line": d.pointer("/range/start/line"), "character": d.pointer("/range/start/character"),
                    "endLine": d.pointer("/range/end/line"), "endCharacter": d.pointer("/range/end/character"),
                    "severity": severity, "message": d.get("message"), "source": d.get("source"), "code": d.get("code"),
                })
            })
            .collect::<Vec<_>>()
    });
    Value::Array(items.unwrap_or_default())
}

/// A snippet as plain text, and where its first stop is: `${1:name}` keeps `name`, `$0` marks where the caret goes.
fn plain_snippet(snippet: &str) -> (String, Option<usize>) {
    let mut out = String::new();
    let mut caret = None;
    let mut chars = snippet.chars().peekable();
    let mut depth = 0;
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(&n) = chars.peek() {
                    out.push(n);
                    chars.next();
                }
            }
            '$' if chars.peek().is_some_and(char::is_ascii_digit) => {
                let mut n = String::new();
                while let Some(&d) = chars.peek().filter(|d| d.is_ascii_digit()) {
                    n.push(d);
                    chars.next();
                }
                if caret.is_none() || n == "0" {
                    caret.get_or_insert(out.encode_utf16().count());
                }
            }
            '$' if chars.peek() == Some(&'{') => {
                chars.next();
                while chars.peek().is_some_and(char::is_ascii_alphanumeric) {
                    chars.next();
                }
                if chars.peek() == Some(&':') {
                    chars.next();
                }
                caret.get_or_insert(out.encode_utf16().count());
                depth += 1;
            }
            '}' if depth > 0 => depth -= 1,
            _ => out.push(c),
        }
    }
    (out, caret)
}

const KINDS: [&str; 26] = ["text", "text", "method", "function", "constructor", "field", "variable", "class", "interface", "module", "property", "unit", "value", "enum", "keyword", "snippet", "color", "file", "reference", "folder", "member", "constant", "struct", "event", "operator", "type"];

fn completions_of(result: &Value) -> Value {
    let items = result.get("items").or(Some(result)).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut items: Vec<(String, Value)> = items
        .iter()
        .filter_map(|item| {
            let label = item.get("label")?.as_str()?.to_owned();
            let edit = item.get("textEdit");
            let raw = edit.and_then(|e| e.get("newText")).or_else(|| item.get("insertText")).and_then(Value::as_str).unwrap_or(&label);
            let (insert, caret) = if item.get("insertTextFormat").and_then(Value::as_u64) == Some(2) { plain_snippet(raw) } else { (raw.to_owned(), None) };
            let range = edit.and_then(|e| e.get("range").or_else(|| e.get("replace")));
            let kind = item.get("kind").and_then(Value::as_u64).and_then(|k| KINDS.get(usize::try_from(k).ok()?)).copied().unwrap_or("text");
            let sort = item.get("sortText").and_then(Value::as_str).unwrap_or(&label).to_owned();
            let documentation = item.get("documentation").map(markdown_of).filter(|d| !d.is_empty());
            Some((sort, json!({ "label": label, "kind": kind, "detail": item.get("detail"), "documentation": documentation, "insert": insert, "caret": caret, "filter": item.get("filterText").and_then(Value::as_str).unwrap_or(&label),
                "from": range.map(|r| json!({ "line": r.pointer("/start/line"), "character": r.pointer("/start/character") })) })))
        })
        .collect();
    items.sort_by(|a, b| a.0.cmp(&b.0));
    Value::Array(items.into_iter().take(MAX_ITEMS).map(|(_, v)| v).collect())
}

/// Hover contents in any of the protocol's shapes, as Markdown.
fn markdown_of(contents: &Value) -> String {
    match contents {
        Value::String(s) => s.clone(),
        Value::Array(all) => all.iter().map(markdown_of).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n"),
        Value::Object(o) => match (o.get("language").and_then(Value::as_str), o.get("value").and_then(Value::as_str)) {
            (Some(language), Some(value)) => format!("```{language}\n{value}\n```"),
            (None, Some(value)) => value.to_owned(),
            _ => String::new(),
        },
        _ => String::new(),
    }
}

fn places_of(dir: &Path, result: &Value) -> Value {
    let all = match result {
        Value::Array(all) => all.clone(),
        Value::Null => vec![],
        one => vec![one.clone()],
    };
    Value::Array(
        all.iter()
            .filter_map(|l| {
                let uri = l.get("targetUri").or_else(|| l.get("uri"))?.as_str()?;
                let range = l.get("targetSelectionRange").or_else(|| l.get("range"))?;
                Some(json!({ "path": project_path(dir, uri)?, "line": range.pointer("/start/line"), "character": range.pointer("/start/character") }))
            })
            .collect(),
    )
}

fn edits_of(edits: &Value) -> Value {
    Value::Array(
        edits
            .as_array()
            .map(|all| {
                all.iter()
                    .map(|e| json!({ "line": e.pointer("/range/start/line"), "character": e.pointer("/range/start/character"), "endLine": e.pointer("/range/end/line"), "endCharacter": e.pointer("/range/end/character"), "text": e.get("newText") }))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// A rename's changes, file by file.
fn workspace_edit_of(dir: &Path, edit: &Value) -> Value {
    let mut files = vec![];
    if let Some(changes) = edit.get("changes").and_then(Value::as_object) {
        for (uri, edits) in changes {
            if let Some(path) = project_path(dir, uri) {
                files.push(json!({ "path": path, "edits": edits_of(edits) }));
            }
        }
    }
    for change in edit.get("documentChanges").and_then(Value::as_array).into_iter().flatten() {
        if let (Some(path), Some(edits)) = (change.pointer("/textDocument/uri").and_then(Value::as_str).and_then(|u| project_path(dir, u)), change.get("edits")) {
            files.push(json!({ "path": path, "edits": edits_of(edits) }));
        }
    }
    Value::Array(files)
}

/// Changes given as lines and UTF-16 columns, made to a text (last first, so earlier places stay put).
pub fn apply_edits(text: &str, edits: &[Value]) -> String {
    let starts: Vec<usize> = std::iter::once(0).chain(text.match_indices('\n').map(|(i, _)| i + 1)).collect();
    let offset = |line: u64, character: u64| -> usize {
        let Some(&start) = usize::try_from(line).ok().and_then(|l| starts.get(l)) else { return text.len() };
        let end = text[start..].find('\n').map_or(text.len(), |i| start + i);
        let mut units = 0u64;
        for (i, c) in text[start..end].char_indices() {
            if units >= character {
                return start + i;
            }
            units += c.len_utf16() as u64;
        }
        end
    };
    let mut spans: Vec<(usize, usize, &str)> = edits
        .iter()
        .filter_map(|e| {
            let n = |k: &str| e.get(k).and_then(Value::as_u64);
            Some((offset(n("line")?, n("character")?), offset(n("endLine")?, n("endCharacter")?), e.get("text").and_then(Value::as_str).unwrap_or("")))
        })
        .collect();
    spans.sort_by_key(|s| std::cmp::Reverse(s.0));
    let mut out = text.to_owned();
    for (from, to, insert) in spans {
        if from <= to && to <= out.len() && out.is_char_boundary(from) && out.is_char_boundary(to) {
            out.replace_range(from..to, insert);
        }
    }
    out
}

type Key = (String, &'static str);

pub struct Languages {
    servers: Mutex<HashMap<Key, Arc<Server>>>,
    /// Servers that are not on this computer or would not start, with what the editor was told, not tried again for a
    /// while (opening a file, or Retry, tries again at once).
    missing: Mutex<HashMap<Key, (Instant, Value)>>,
    emit: Emit,
}

impl Languages {
    pub fn new(emit: Emit) -> Languages {
        Languages { servers: Mutex::default(), missing: Mutex::default(), emit }
    }

    /// The running server for a file's language in a project, started if it is not running yet.
    fn server(&self, dir: &Path, project: &str, file: &str) -> Result<(Arc<Server>, &'static str), Value> {
        let (language, language_id) = language_of(file).ok_or_else(|| json!({ "ok": false, "none": true }))?;
        let key = (project.to_owned(), language.key);
        if let Some(server) = self.servers.lock().ok().and_then(|s| s.get(&key).cloned()).filter(|s| s.alive.load(Ordering::SeqCst)) {
            return Ok((server, language_id));
        }
        if let Some((_, told)) = self.missing.lock().ok().and_then(|m| m.get(&key).cloned()).filter(|(t, _)| t.elapsed() < MISSING_AGAIN) {
            return Err(told);
        }
        match Server::start(dir, project, language, &self.emit) {
            Ok(server) => {
                let server = Arc::new(server);
                let mut servers = self.servers.lock().map_err(|_| json!({ "ok": false, "message": "busy" }))?;
                // Two files of one language opened at once start two; the first one in stays.
                if let Some(first) = servers.get(&key).filter(|s| s.alive.load(Ordering::SeqCst)) {
                    let first = Arc::clone(first);
                    drop(servers);
                    server.stop();
                    return Ok((first, language_id));
                }
                if let Some(old) = servers.insert(key, Arc::clone(&server)) {
                    old.stop();
                }
                Ok((server, language_id))
            }
            Err(why) => {
                let told = match why {
                    StartError::Missing(program) => json!({ "ok": false, "missing": true, "language": language.name, "program": program }),
                    StartError::Failed(program, message) => json!({ "ok": false, "failed": true, "language": language.name, "program": program, "message": message.chars().take(1000).collect::<String>() }),
                };
                if let Ok(mut m) = self.missing.lock() {
                    m.insert(key, (Instant::now(), told.clone()));
                }
                Err(told)
            }
        }
    }

    /// Tells the server what a file holds now (opening it the first time) and says which program answers for it.
    /// `again` tries a server that was not found or would not start straight away (a file just opened, or Retry).
    pub fn sync(&self, dir: &Path, project: &str, file: &str, text: &str, again: bool) -> Value {
        if again && let Ok(mut m) = self.missing.lock() {
            m.retain(|k, _| k.0 != project);
        }
        match self.server(dir, project, file) {
            Ok((server, language_id)) => {
                server.sync(&dir.join(file), language_id, text);
                json!({ "ok": true, "server": server.program })
            }
            Err(e) => e,
        }
    }

    pub fn close(&self, dir: &Path, project: &str, file: &str) -> Value {
        let key = language_of(file).map(|(l, _)| (project.to_owned(), l.key));
        if let Some(server) = key.and_then(|k| self.servers.lock().ok()?.get(&k).cloned()) {
            server.close(&dir.join(file));
        }
        json!({ "ok": true })
    }

    /// Every problem the project's servers know of, file by file.
    pub fn problems(&self, project: &str) -> Value {
        let Ok(servers) = self.servers.lock() else { return json!([]) };
        let mut all = vec![];
        for (_, server) in servers.iter().filter(|(k, _)| k.0 == project) {
            if let Ok(problems) = server.problems.lock() {
                all.extend(problems.iter().filter(|(_, items)| items.as_array().is_some_and(|i| !i.is_empty())).map(|(path, items)| json!({ "path": path, "items": items })));
            }
        }
        Value::Array(all)
    }

    /// A question about a place in a file: `complete`, `hover`, `definition`, `rename` (with the new name) or
    /// `format` (the whole file).
    pub fn ask(&self, dir: &Path, project: &str, file: &str, kind: &str, (line, character): (u64, u64), extra: Option<&str>) -> Value {
        let server = match self.server(dir, project, file) {
            Ok((server, _)) => server,
            Err(e) => return e,
        };
        let document = json!({ "uri": file_uri(&dir.join(file)) });
        let at = json!({ "textDocument": document, "position": { "line": line, "character": character } });
        let answer = match kind {
            "complete" => {
                // A list asked for by typing a character the server waits for (a dot) says so, as some servers answer only then.
                let mut params = at;
                params["context"] = match extra.filter(|c| !c.is_empty()) {
                    Some(c) => json!({ "triggerKind": 2, "triggerCharacter": c }),
                    None => json!({ "triggerKind": 1 }),
                };
                server.ask_for("textDocument/completion", params, ASK_TIMEOUT).map(|r| json!({ "items": completions_of(&r) }))
            }
            "hover" => server.ask_for("textDocument/hover", at, ASK_TIMEOUT).map(|r| json!({ "text": r.get("contents").map(markdown_of).unwrap_or_default() })),
            "definition" => server.ask_for("textDocument/definition", at, ASK_TIMEOUT).map(|r| json!({ "places": places_of(dir, &r) })),
            "rename" => {
                let Some(name) = extra.map(str::trim).filter(|n| !n.is_empty()) else { return json!({ "ok": false, "message": "a new name is needed" }) };
                let mut params = at;
                params["newName"] = json!(name);
                server.ask_for("textDocument/rename", params, ASK_TIMEOUT).map(|r| json!({ "files": workspace_edit_of(dir, &r) }))
            }
            "format" => server
                .ask_for("textDocument/formatting", json!({ "textDocument": document, "options": { "tabSize": 2, "insertSpaces": true, "trimTrailingWhitespace": true, "insertFinalNewline": true } }), ASK_TIMEOUT)
                .map(|r| json!({ "edits": edits_of(&r) })),
            _ => return json!({ "ok": false, "message": "unknown question" }),
        };
        match answer {
            Ok(mut value) => {
                value["ok"] = json!(true);
                value
            }
            Err(message) => json!({ "ok": false, "message": message }),
        }
    }

    /// Stops a project's servers, when another project is opened.
    pub fn stop_project(&self, project: &str) {
        let servers: Vec<Arc<Server>> = self.servers.lock().map(|mut s| {
            let keys: Vec<Key> = s.keys().filter(|k| k.0 == project).cloned().collect();
            keys.iter().filter_map(|k| s.remove(k)).collect()
        }).unwrap_or_default();
        for server in servers {
            server.stop();
        }
    }

    pub fn stop_all(&self) {
        let servers: Vec<Arc<Server>> = self.servers.lock().map(|mut s| s.drain().map(|(_, v)| v).collect()).unwrap_or_default();
        for server in servers {
            server.stop();
        }
    }
}

impl Drop for Languages {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_framed_and_read_back_past_stray_lines() {
        let mut out = Vec::new();
        write_message(&mut out, &json!({ "id": 1, "result": "é" })).unwrap();
        let mut input = b"running 1 test\n".to_vec();
        input.extend_from_slice(&out);
        let mut reader = BufReader::new(&input[..]);
        assert_eq!(read_message(&mut reader).unwrap()["result"], "é");
        assert!(read_message(&mut reader).is_none());
    }

    #[test]
    fn snippets_become_plain_text_with_the_caret_at_the_first_stop() {
        assert_eq!(plain_snippet("log(${1:message})$0"), ("log(message)".to_owned(), Some(4)));
        assert_eq!(plain_snippet("fn $1() {\n\t$0\n}"), ("fn () {\n\t\n}".to_owned(), Some(3)));
        assert_eq!(plain_snippet("a \\$ b"), ("a $ b".to_owned(), None));
    }

    #[test]
    fn edits_land_on_lines_and_utf16_columns_last_first() {
        let text = "let 😀 = a;\nprint(a)\n";
        let edits = [json!({ "line": 0, "character": 9, "endLine": 0, "endCharacter": 10, "text": "total" }), json!({ "line": 1, "character": 6, "endLine": 1, "endCharacter": 7, "text": "total" })];
        assert_eq!(apply_edits(text, &edits), "let 😀 = total;\nprint(total)\n");
    }

    #[test]
    fn hover_and_places_read_every_shape() {
        assert_eq!(markdown_of(&json!([{ "language": "ts", "value": "const a: number" }, "Docs"])), "```ts\nconst a: number\n```\n\nDocs");
        assert_eq!(markdown_of(&json!({ "kind": "markdown", "value": "**b**" })), "**b**");
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.ts"), "").unwrap();
        let uri = file_uri(&dir.path().join("a.ts"));
        let places = places_of(dir.path(), &json!([{ "targetUri": uri, "targetRange": {}, "targetSelectionRange": { "start": { "line": 3, "character": 2 } } }]));
        assert_eq!(places, json!([{ "path": "a.ts", "line": 3, "character": 2 }]));
    }

    #[test]
    fn languages_come_from_the_file_name() {
        assert_eq!(language_of("src/App.tsx").map(|l| (l.0.key, l.1)), Some(("typescript", "typescriptreact")));
        assert_eq!(language_of("main.rs").map(|l| l.1), Some("rust"));
        assert!(language_of("README.md").is_none());
    }

    /// A stand-in server written in JavaScript (the same one the end-to-end test puts in a project), so the whole
    /// conversation is checked where Node is installed.
    #[test]
    fn a_project_server_answers_and_reports_problems() {
        let Some(node) = find_program(Path::new("."), "node") else { return };
        let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/e2e/fixtures/fake-language-server.js");
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node_modules/.bin");
        std::fs::create_dir_all(&bin).unwrap();
        let program = if cfg!(windows) { bin.join("typescript-language-server.cmd") } else { bin.join("typescript-language-server") };
        let script = if cfg!(windows) { format!("@\"{}\" \"{}\" %*\r\n", node.display(), fake.display()) } else { format!("#!/bin/sh\nexec \"{}\" \"{}\" \"$@\"\n", node.display(), fake.display()) };
        std::fs::write(&program, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::write(dir.path().join("a.ts"), "").unwrap();
        let heard: Arc<Mutex<Vec<Value>>> = Arc::default();
        let kept = Arc::clone(&heard);
        let languages = Languages::new(Arc::new(move |name: &str, value: Value| kept.lock().unwrap().push(json!({ "name": name, "value": value }))));
        let text = "const total = 1\ntotal.\nTODO\n";
        let started = languages.sync(dir.path(), "demo", "a.ts", text, false);
        assert_eq!(started["server"], "typescript-language-server", "{started}");
        let t = Instant::now();
        while heard.lock().unwrap().is_empty() && t.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
        let first = heard.lock().unwrap()[0].clone();
        assert_eq!(first["name"], "mobius:code-problems");
        assert_eq!(first["value"]["path"], "a.ts");
        assert_eq!(first["value"]["items"][0]["line"], 2);
        assert_eq!(languages.problems("demo")[0]["items"][0]["message"], "Finish this TODO");
        let items = languages.ask(dir.path(), "demo", "a.ts", "complete", (1, 6), None);
        assert_eq!(items["items"][0]["label"], "toFixed");
        assert_eq!(items["items"][0]["insert"], "toFixed(digits)");
        assert_eq!(languages.ask(dir.path(), "demo", "a.ts", "hover", (0, 7), None)["text"], "```ts\nconst total: number\n```");
        assert_eq!(languages.ask(dir.path(), "demo", "a.ts", "definition", (1, 2), None)["places"][0]["line"], 0);
        let renamed = languages.ask(dir.path(), "demo", "a.ts", "rename", (0, 7), Some("sum"));
        assert_eq!(apply_edits(text, renamed["files"][0]["edits"].as_array().unwrap()), "const sum = 1\nsum.\nTODO\n");
        assert_eq!(languages.sync(dir.path(), "demo", "notes.md", "", false)["none"], true);
        languages.stop_project("demo");
        assert!(languages.problems("demo").as_array().unwrap().is_empty());
    }

    /// A server that is there but will not start says why, and is tried again when asked.
    #[test]
    fn a_server_that_will_not_start_says_why() {
        if cfg!(windows) {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node_modules/.bin");
        std::fs::create_dir_all(&bin).unwrap();
        let program = bin.join("typescript-language-server");
        std::fs::write(&program, "#!/bin/sh\necho 'needs TypeScript 5' >&2\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let languages = Languages::new(Arc::new(|_: &str, _: Value| {}));
        let told = languages.sync(dir.path(), "demo", "a.ts", "", false);
        assert_eq!(told["failed"], true, "{told}");
        assert!(told["message"].as_str().unwrap().contains("needs TypeScript 5"), "{told}");
        std::fs::remove_file(&program).unwrap();
        assert_eq!(languages.sync(dir.path(), "demo", "a.ts", "", false)["failed"], true);
        assert_eq!(languages.sync(dir.path(), "demo", "a.ts", "", true)["missing"], true);
    }
}
