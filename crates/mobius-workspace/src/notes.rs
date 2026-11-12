//! Notes: notebooks are folders and pages are Markdown files under `<workspace>/notes`, so a page is a real file the
//! person can open anywhere and the assistant's file tools reach it too. A page's title is its first `# ` heading.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::{Value, json};

use crate::checkpoints::Checkpoints;

type Res<T> = Result<T, String>;

pub const FOLDER: &str = "notes";
pub const MAX_PAGE: usize = 1024 * 1024;
const MAX_NAME: usize = 80;
const MAX_PAGES: usize = 2000;
const MAX_HITS: usize = 100;

pub struct Notes {
    root: PathBuf,
    checkpoints: Checkpoints,
    workspace: PathBuf,
    /// Pages are called by their file name rather than their first heading (a deck's first slide is not its name).
    named_by_file: bool,
    /// Whether pages named by their file still take files beside them (Slides' pictures). Pages named by title always do.
    takes_files: bool,
    /// The pages' file extension, `md` unless another kind of file is kept this way (designs are `json`).
    ext: &'static str,
    /// What a new page holds, from its title.
    starter: fn(&str) -> String,
    /// Whether a save keeps what the page held before, for History. Off where history comes from elsewhere (Wiki).
    keeps_versions: bool,
}

/// Remove a folder: now, or, while Windows still has something in it open (a virus scan or the search index reading a new
/// file can hold it for seconds), moved out of the way at once into the hidden `.trash` beside it and removed as soon as
/// Windows lets go, so the page's files never outlive the page where the person can see them.
fn remove_dir_soon(dir: &Path, trash: &Path) {
    let mut refused = None;
    for wait in [0, 50, 150] {
        std::thread::sleep(std::time::Duration::from_millis(wait));
        match fs::remove_dir_all(dir) {
            Ok(()) => return,
            Err(_) if !dir.exists() => return,
            Err(e) => refused = Some(e),
        }
    }
    // Say why, and who has it: the next run of the log shows what to fix rather than a folder that was not removed.
    let holders = holders_of(dir);
    eprintln!(
        "[mobius] could not remove {} yet ({}); held by {}",
        dir.display(),
        refused.map(|e| format!("{:?}: {e}", e.kind())).unwrap_or_default(),
        if holders.is_empty() { "no program Windows can name".to_owned() } else { holders.join(", ") }
    );
    let _ = fs::create_dir_all(trash);
    let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("files");
    let parked = trash.join(format!("{stamp}-{name}"));
    let left = if fs::rename(dir, &parked).is_ok() { parked } else { dir.to_path_buf() };
    // Tried every tenth of a second, so it goes the moment it is let go, for up to half a minute.
    std::thread::spawn(move || {
        for _ in 0..300 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if fs::remove_dir_all(&left).is_ok() || !left.exists() {
                return;
            }
        }
        eprintln!("[mobius] could not remove {} (still in use; held by {})", left.display(), holders_of(&left).join(", "));
    });
}

/// The programs holding any file in a folder open, as "name (pid)", from Windows' Restart Manager. Empty elsewhere.
fn holders_of(dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in fs::read_dir(&d).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() { stack.push(path) } else if files.len() < 64 { files.push(path) }
        }
    }
    holders(&files)
}

/// Who holds a file open, as "name (pid)": the shell fills this in with Windows' Restart Manager (it may use the system's
/// C APIs; this crate does not), so a refused delete says which program to blame.
pub static FILE_HOLDERS: std::sync::OnceLock<fn(&[PathBuf]) -> Vec<String>> = std::sync::OnceLock::new();

fn holders(files: &[PathBuf]) -> Vec<String> {
    FILE_HOLDERS.get().map(|find| find(files)).unwrap_or_default()
}

fn markdown_starter(title: &str) -> String {
    format!("# {title}\n\n")
}

/// A name a person typed, made safe to use as one file or folder name on every system.
pub fn file_name_for(title: &str) -> String {
    const RESERVED: [&str; 22] = ["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"];
    let cleaned: String = title.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c }).collect();
    let mut name: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_NAME).collect();
    name = name.trim_matches(|c: char| c == '.' || c == ' ').to_owned();
    if name.is_empty() || RESERVED.contains(&name.to_lowercase().as_str()) {
        name = format!("Untitled{}", if name.is_empty() { String::new() } else { format!(" {name}") });
    }
    name
}

/// The first `# ` heading, else the file name without `.md`.
pub fn title_of(content: &str, file_stem: &str) -> String {
    content.lines().map(str::trim).find_map(|l| l.strip_prefix("# ").map(str::trim).filter(|t| !t.is_empty())).unwrap_or(file_stem).chars().take(200).collect()
}

/// How many links to other pages one page may give the list.
const MAX_LINKS: usize = 100;

/// The other pages a page links to, as Markdown links that work in any editor: `[Plan](Plan.md)` in the same
/// notebook, `[Plan](../Home/Plan.md)` in another, spaces written `%20`. Given as `notebook/page.md`, each once, in
/// the order they come. Web links, pictures, files and links in code are not pages. The same rules as `linksIn` in
/// `apps/desktop/src/note-links.ts`.
pub fn links_in(content: &str, from: &str) -> Vec<String> {
    let Some((notebook, _)) = from.split_once('/') else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    let mut fenced = false;
    for line in content.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut in_code = false;
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'`' => in_code = !in_code,
                b']' if !in_code && bytes.get(i + 1) == Some(&b'(') && !is_picture(line, i) => {
                    if let Some(end) = line[i + 2..].find(')') {
                        let target = line[i + 2..i + 2 + end].split_whitespace().next().unwrap_or("");
                        if let Some(page) = page_link(target, notebook)
                            && page != from
                            && !out.contains(&page)
                            && out.len() < MAX_LINKS
                        {
                            out.push(page);
                        }
                        i += 2 + end;
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
    out
}

/// Whether the `]` at `close` ends a picture's `![…]`.
fn is_picture(line: &str, close: usize) -> bool {
    line[..close].rfind('[').is_some_and(|open| open > 0 && line.as_bytes()[open - 1] == b'!')
}

/// A link's target as `notebook/page.md`, when it is a page: `Plan.md` (this notebook) or `../Home/Plan.md`.
fn page_link(target: &str, notebook: &str) -> Option<String> {
    let target = unescape(target.trim_matches(['<', '>']))?;
    if target.contains(':') || target.starts_with('/') || target.contains('\\') || !target.ends_with(".md") {
        return None;
    }
    let path = match target.strip_prefix("../") {
        Some(rest) => rest.to_owned(),
        None => format!("{notebook}/{}", target.strip_prefix("./").unwrap_or(&target)),
    };
    page_ok(&path, "md").is_some().then_some(path)
}

/// How many tags one page may give the sidebar.
const MAX_TAGS: usize = 50;

/// The `#tags` in a page, as Bear writes them: a `#` at the start of a word, then a letter, then letters, digits, `_`,
/// `-` or `/` (`#kestrel/p2`). Headings (`# Title`), `\#`, links (`page#part`) and code are not tags. The first spelling
/// is kept, a tag written twice in other case is one tag, and they come sorted. The same rules as `tagsIn` in
/// `apps/desktop/src/note-tags.ts`.
pub fn tags_in(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut fenced = false;
    for line in content.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut code = false;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c == '`' {
                code = !code;
            } else if c == '#' && !code && (i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(') && chars.get(i + 1).is_some_and(|n| n.is_alphabetic()) {
                let mut j = i + 1;
                while j < chars.len() && (chars[j].is_alphanumeric() || matches!(chars[j], '_' | '-' | '/')) {
                    j += 1;
                }
                let tag: String = chars[i + 1..j].iter().collect::<String>().trim_end_matches(['-', '/']).chars().take(60).collect();
                if !out.iter().any(|t| t.to_lowercase() == tag.to_lowercase()) && out.len() < MAX_TAGS {
                    out.push(tag);
                }
                i = j;
                continue;
            }
            i += 1;
        }
    }
    out.sort_by_key(|t| t.to_lowercase());
    out
}

/// The first line of a page's text under its title, without Markdown marks, for the list. Empty when there is none.
pub fn preview_of(content: &str) -> String {
    let mut fenced = false;
    let mut titled = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced || t.is_empty() || t.starts_with("|") || t == "---" {
            continue;
        }
        if !titled && t.starts_with("# ") {
            titled = true;
            continue;
        }
        let mut s = t.trim_start_matches('#').trim_start_matches('>').trim();
        for mark in ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "- ", "* ", "+ "] {
            if let Some(rest) = s.strip_prefix(mark) {
                s = rest;
                break;
            }
        }
        let s = s.trim_start_matches(|c: char| c.is_ascii_digit()).strip_prefix(". ").unwrap_or(s);
        let plain = strip_inline_marks(s);
        if !plain.is_empty() {
            return plain.chars().take(120).collect();
        }
    }
    String::new()
}

/// `**bold**`, `_it_`, `` `code` `` and `[words](link)` as their words.
fn strip_inline_marks(s: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '[' && let Some(close) = chars[i..].iter().position(|&x| x == ']').map(|p| p + i) && chars.get(close + 1) == Some(&'(') && let Some(end) = chars[close..].iter().position(|&x| x == ')').map(|p| p + close) {
            out.extend(&chars[i + 1..close]);
            i = end + 1;
            continue;
        }
        if !matches!(c, '*' | '_' | '`' | '~' | '\\') {
            out.push(c);
        }
        i += 1;
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// What a new design holds: one empty phone-sized frame. See `apps/desktop/src/design-format.ts` for the format.
pub fn design_starter(_title: &str) -> String {
    "{\n  \"version\": 1,\n  \"styles\": [],\n  \"frames\": [\n    { \"id\": \"f1\", \"name\": \"Frame 1\", \"x\": 0, \"y\": 0, \"w\": 393, \"h\": 852, \"fill\": \"#ffffff\", \"radius\": 0, \"children\": [] }\n  ]\n}\n".to_owned()
}

/// What a new Canvas board holds: nothing on it yet. See `apps/desktop/src/board-format.ts`.
pub fn board_starter(_title: &str) -> String {
    "{\n  \"version\": 1,\n  \"items\": []\n}\n".to_owned()
}

/// What a new view holds: the tiles most people want first. See `apps/desktop/src/views-format.ts` for the format.
pub fn view_starter(_title: &str) -> String {
    "{\n  \"version\": 1,\n  \"tiles\": [\n    {\"id\":\"t1\",\"kind\":\"mobius\",\"size\":\"wide\"},\n    {\"id\":\"t2\",\"kind\":\"tasks\",\"size\":\"small\",\"show\":\"today\"},\n    {\"id\":\"t3\",\"kind\":\"calendar\",\"size\":\"small\",\"show\":\"today\"},\n    {\"id\":\"t4\",\"kind\":\"mail\",\"size\":\"small\"},\n    {\"id\":\"t5\",\"kind\":\"notes\",\"size\":\"small\"}\n  ]\n}\n".to_owned()
}

/// What a new song holds: tempo, key and length, and no tracks yet. See `apps/desktop/src/song-format.ts`.
pub fn song_starter(_title: &str) -> String {
    "{\n  \"version\": 1,\n  \"tempo\": 112,\n  \"key\": \"A minor\",\n  \"bars\": 8,\n  \"tracks\": []\n}\n".to_owned()
}

/// A notebook name or a `notebook/page.md` path, checked by shape before it touches the disk.
fn notebook_ok(name: &str) -> bool {
    !name.is_empty() && name == file_name_for(name) && !name.starts_with('.')
}
fn page_ok<'a>(path: &'a str, ext: &str) -> Option<(&'a str, &'a str)> {
    let (notebook, file) = path.split_once('/')?;
    let stem = file.strip_suffix(ext)?.strip_suffix('.')?;
    (notebook_ok(notebook) && !stem.is_empty() && stem == file_name_for(stem) && !file.contains('/')).then_some((notebook, file))
}

impl Notes {
    pub fn new(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>) -> Notes {
        Notes::in_folder(workspace, checkpoint_store, FOLDER)
    }

    /// The same kind of store in another folder of the workspace: Docs keeps its documents in `docs/<folder>/<doc>.md`.
    pub fn in_folder(workspace: impl Into<PathBuf>, checkpoint_store: impl Into<PathBuf>, folder: &str) -> Notes {
        let workspace = workspace.into();
        Notes { root: workspace.join(folder), checkpoints: Checkpoints::new(checkpoint_store), workspace, named_by_file: false, takes_files: false, ext: "md", starter: markdown_starter, keeps_versions: true }
    }

    /// Saves keep no versions of their own: the store's history comes from the workspace checkpoints alone.
    pub fn without_kept_versions(mut self) -> Notes {
        self.keeps_versions = false;
        self
    }

    /// Pages called by their file names, as Slides calls its decks.
    pub fn named_by_file(mut self) -> Notes {
        self.named_by_file = true;
        self
    }

    /// Pages named by their file that still take files beside them, as Slides keeps a deck's pictures in `<deck> files/`.
    pub fn with_files(mut self) -> Notes {
        self.takes_files = true;
        self
    }

    /// Pages that are another kind of file, such as designs kept as JSON, each new one holding `starter(title)`.
    pub fn of_files(mut self, ext: &'static str, starter: fn(&str) -> String) -> Notes {
        self.ext = ext;
        self.starter = starter;
        self.named_by_file = true;
        self
    }

    fn ensure(&self) -> Res<()> {
        fs::create_dir_all(&self.root).map_err(|e| format!("the folder cannot be used: {e}"))
    }

    /// The real path of a page, refusing anything that is not a plain `notebook/page.md` inside the notes folder.
    fn page(&self, path: &str) -> Res<PathBuf> {
        page_ok(path, self.ext).ok_or("that is not a page")?;
        let full = self.root.join(path);
        let parent = full.parent().ok_or("that is not a page")?;
        if parent.exists() {
            let real_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
            let real_root = fs::canonicalize(&self.root).map_err(|e| e.to_string())?;
            if real_parent.parent() != Some(real_root.as_path()) {
                return Err("that is not a page".into());
            }
        }
        Ok(full)
    }

    /// Every notebook with its pages, notebooks by name, pages newest first.
    pub fn list(&self) -> Res<Value> {
        self.ensure()?;
        let mut notebooks = Vec::new();
        let mut count = 0;
        let mut dirs: Vec<_> = fs::read_dir(&self.root).map_err(|e| e.to_string())?.filter_map(Result::ok).filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).collect();
        dirs.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
        for dir in dirs {
            let name = dir.file_name().to_string_lossy().into_owned();
            if !notebook_ok(&name) {
                continue;
            }
            let mut pages = Vec::new();
            for entry in fs::read_dir(dir.path()).map_err(|e| e.to_string())?.filter_map(Result::ok) {
                let file = entry.file_name().to_string_lossy().into_owned();
                let path = format!("{name}/{file}");
                if !entry.file_type().is_ok_and(|t| t.is_file()) || page_ok(&path, self.ext).is_none() || count >= MAX_PAGES {
                    continue;
                }
                count += 1;
                let stem = file.strip_suffix(self.ext).and_then(|f| f.strip_suffix('.')).unwrap_or(&file);
                let content = fs::read_to_string(entry.path()).unwrap_or_default();
                let head: String = content.chars().take(4000).collect();
                let title = if self.named_by_file { stem.to_owned() } else { title_of(&head, stem) };
                let mut row = json!({ "path": path, "title": title, "modified": modified_ms(&entry.path()) });
                // Markdown pages say how they start and what they are tagged with, for the list; JSON files do not.
                if self.ext == "md" && !self.named_by_file {
                    row["preview"] = json!(preview_of(&head));
                    row["tags"] = json!(tags_in(&content));
                    row["links"] = json!(links_in(&content, &path));
                }
                pages.push(row);
            }
            pages.sort_by(|a, b| b["modified"].as_u64().cmp(&a["modified"].as_u64()).then(a["path"].as_str().cmp(&b["path"].as_str())));
            notebooks.push(json!({ "name": name, "pages": pages }));
        }
        Ok(Value::Array(notebooks))
    }

    pub fn read(&self, path: &str) -> Res<Value> {
        let file = self.page(path)?;
        let content = fs::read_to_string(&file).map_err(|_| "that page is not there".to_owned())?;
        Ok(json!({ "path": path, "content": content, "modified": modified_ms(&file) }))
    }

    /// Save what the person typed. Refused if the page changed on disk since `base` (its `modified` when read), so an
    /// edit the assistant made meanwhile is never overwritten silently.
    pub fn save(&self, path: &str, content: &str, base: Option<u64>) -> Res<Value> {
        if content.len() > MAX_PAGE {
            return Err("that page is too long".into());
        }
        let file = self.page(path)?;
        if !file.parent().is_some_and(Path::is_dir) {
            return Err("that notebook is not there".into());
        }
        if let Some(base) = base
            && file.exists()
            && modified_ms(&file) != base
        {
            return Err("changed elsewhere".into());
        }
        if self.ext == "md"
            && self.keeps_versions
            && let Ok(before) = fs::read_to_string(&file)
            && before != content
        {
            self.keep_version(path, &before, modified_ms(&file));
        }
        let temp = file.with_extension("md.mobius-tmp");
        fs::write(&temp, content).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        Ok(json!({ "path": path, "modified": modified_ms(&file) }))
    }

    pub fn create_notebook(&self, name: &str) -> Res<Value> {
        self.ensure()?;
        let name = file_name_for(name);
        let mut chosen = name.clone();
        let mut n = 2;
        while self.root.join(&chosen).exists() {
            chosen = format!("{name} {n}");
            n += 1;
        }
        fs::create_dir(self.root.join(&chosen)).map_err(|e| e.to_string())?;
        Ok(json!({ "name": chosen }))
    }

    /// A new page titled `title` in `notebook`, never replacing one that exists.
    pub fn create_page(&self, notebook: &str, title: &str) -> Res<Value> {
        if !notebook_ok(notebook) || !self.root.join(notebook).is_dir() {
            return Err("that notebook is not there".into());
        }
        let stem = file_name_for(title);
        let ext = self.ext;
        let mut path = format!("{notebook}/{stem}.{ext}");
        let mut n = 2;
        while self.root.join(&path).exists() {
            path = format!("{notebook}/{stem} {n}.{ext}");
            n += 1;
        }
        let shown = if title.trim().is_empty() { "Untitled" } else { title.trim() };
        let content = (self.starter)(shown);
        let file = self.page(&path)?;
        fs::OpenOptions::new().write(true).create_new(true).open(&file).and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes())).map_err(|e| e.to_string())?;
        Ok(json!({ "path": path, "content": content, "modified": modified_ms(&file) }))
    }

    /// Delete a page, its files folder and its comments. A checkpoint is taken first, so it can be brought back. Its kept versions
    /// stay in `.versions` on purpose: a page made again with the same name, or put back, has its History still.
    pub fn remove_page(&self, path: &str) -> Res<Value> {
        let file = self.page(path)?;
        if !file.is_file() {
            return Err("that page is not there".into());
        }
        let folder = self.root.file_name().and_then(|f| f.to_str()).unwrap_or(FOLDER);
        let checkpoint = self.checkpoints.snapshot(&self.workspace, &format!("before deleting {folder}/{path}")).is_ok();
        fs::remove_file(&file).map_err(|e| e.to_string())?;
        // Comments are about this page's words, so they go with it (a new page of the same name starts without them).
        if let Some(comments) = self.comments_file(path) {
            let _ = fs::remove_file(comments);
        }
        if let Some(files) = self.files_folder(path).filter(|f| f.is_dir()) {
            remove_dir_soon(&files, &self.root.join(".trash"));
        }
        Ok(json!({ "removed": path, "checkpoint": checkpoint }))
    }

    /// Pages whose title or text contains every word of the query (case-insensitive), title matches first.
    pub fn search(&self, query: &str) -> Res<Value> {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).take(10).collect();
        if words.is_empty() {
            return Ok(json!([]));
        }
        let mut hits = Vec::new();
        for notebook in self.list()?.as_array().into_iter().flatten() {
            for page in notebook["pages"].as_array().into_iter().flatten() {
                let path = page["path"].as_str().unwrap_or("");
                let Ok(text) = fs::read_to_string(self.root.join(path)) else { continue };
                let (lower, title) = (text.to_lowercase(), page["title"].as_str().unwrap_or("").to_lowercase());
                if !words.iter().all(|w| lower.contains(w) || title.contains(w)) {
                    continue;
                }
                let line = text.lines().find(|l| words.iter().any(|w| l.to_lowercase().contains(w))).unwrap_or("").trim().chars().take(160).collect::<String>();
                let in_title = words.iter().all(|w| title.contains(w));
                hits.push((in_title, json!({ "path": path, "title": page["title"], "notebook": notebook["name"], "line": line })));
            }
        }
        hits.sort_by_key(|h| !h.0);
        Ok(Value::Array(hits.into_iter().take(MAX_HITS).map(|h| h.1).collect()))
    }

    /// Where a page's kept versions live: `<folder>/.versions/<notebook>/<page>/<ms>.md`. The leading dot keeps the
    /// folder out of the notebook list.
    fn versions_folder(&self, path: &str) -> Option<PathBuf> {
        let (notebook, file) = page_ok(path, self.ext)?;
        Some(self.root.join(VERSIONS).join(notebook).join(file.strip_suffix(".md")?))
    }

    /// Keep what a page held before a save, at most one version every few minutes (typing saves often), and only the
    /// newest `MAX_KEPT`.
    fn keep_version(&self, path: &str, before: &str, when_ms: u64) {
        let Some(folder) = self.versions_folder(path) else { return };
        let mut kept = kept_times(&folder);
        if kept.last().is_some_and(|last| when_ms.saturating_sub(*last) < KEEP_EVERY_MS) {
            return;
        }
        if fs::create_dir_all(&folder).is_err() || fs::write(folder.join(format!("{when_ms}.md")), before).is_err() {
            return;
        }
        kept.push(when_ms);
        for old in kept.iter().take(kept.len().saturating_sub(MAX_KEPT)) {
            let _ = fs::remove_file(folder.join(format!("{old}.md")));
        }
    }

    /// A page's earlier versions, newest first: the ones kept as the person typed, and the page as it was at each
    /// workspace checkpoint (taken before Mobius changes files and before a delete). Versions that are the same as the
    /// page now, or as the version after them, are left out.
    pub fn versions(&self, path: &str) -> Res<Value> {
        let file = self.page(path)?;
        let now = fs::read_to_string(&file).map_err(|_| "that page is not there".to_owned())?;
        let mut found: Vec<(u64, String, &str)> = Vec::new();
        if let Some(folder) = self.versions_folder(path) {
            for when in kept_times(&folder) {
                if let Ok(text) = fs::read_to_string(folder.join(format!("{when}.md"))) {
                    found.push((when, text, "kept"));
                }
            }
        }
        let folder = self.root.file_name().and_then(|f| f.to_str()).unwrap_or(FOLDER);
        if let Ok(list) = self.checkpoints.list(&self.workspace, 40) {
            for c in list {
                if let Ok(Some(text)) = self.checkpoints.read_at(&self.workspace, &c.id, &format!("{folder}/{path}")) {
                    found.push((c.when * 1000, text, "checkpoint"));
                }
            }
        }
        found.sort_by_key(|b| std::cmp::Reverse(b.0));
        let mut out = Vec::new();
        let mut last = now.clone();
        for (when, text, source) in found {
            if text == last || text == now {
                continue;
            }
            out.push(json!({ "whenMs": when, "content": text, "source": source }));
            last = text;
            if out.len() >= MAX_VERSIONS {
                break;
            }
        }
        Ok(Value::Array(out))
    }

    /// The folder beside a page that holds what was added to it: `Battery.md` keeps its pictures in `Battery files/`,
    /// as other Markdown apps do, so the page's links work outside Mobius too.
    fn files_folder(&self, path: &str) -> Option<PathBuf> {
        let (notebook, file) = page_ok(path, self.ext)?;
        Some(self.root.join(notebook).join(files_folder_name(file.strip_suffix(".md")?)))
    }

    /// Add a file to a page: saved in the page's files folder under a safe name (never replacing one there), and the
    /// link to put in the page returned as `ref`, relative to the page and with spaces written `%20`.
    pub fn attach(&self, path: &str, name: &str, base64: &str) -> Res<Value> {
        if self.ext != "md" || (self.named_by_file && !self.takes_files) {
            return Err("only pages take files".into());
        }
        let page = self.page(path)?;
        if !page.is_file() {
            return Err("that page is not there".into());
        }
        if base64.len() > MAX_ATTACHMENT / 3 * 4 + 4 {
            return Err("that file is too big to add (20 MB at most)".into());
        }
        let bytes = from_base64(base64).ok_or("that file could not be read")?;
        if bytes.len() > MAX_ATTACHMENT {
            return Err("that file is too big to add (20 MB at most)".into());
        }
        let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
        let (stem, ext) = match leaf.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() && !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()) => (s, Some(e.to_ascii_lowercase())),
            _ => (leaf, None),
        };
        let stem = file_name_for(stem);
        let named = |n: u32| {
            let s = if n < 2 { stem.clone() } else { format!("{stem} {n}") };
            ext.as_ref().map_or(s.clone(), |e| format!("{s}.{e}"))
        };
        let folder = self.files_folder(path).ok_or("that is not a page")?;
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let mut n = 1;
        let chosen = loop {
            let candidate = named(n);
            match fs::OpenOptions::new().write(true).create_new(true).open(folder.join(&candidate)) {
                Ok(mut f) => {
                    if let Err(e) = std::io::Write::write_all(&mut f, &bytes) {
                        drop(f);
                        let _ = fs::remove_file(folder.join(&candidate));
                        return Err(e.to_string());
                    }
                    break candidate;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && n < 1000 => n += 1,
                Err(e) => return Err(e.to_string()),
            }
        };
        let dir = folder.file_name().and_then(|f| f.to_str()).unwrap_or_default();
        Ok(json!({ "path": path, "ref": format!("{}/{}", dir, chosen).replace(' ', "%20"), "name": chosen, "image": ext.as_deref().is_some_and(|e| image_type(e).is_some()) }))
    }

    /// A file a page links to, as a `data:` address the editor can show. Only files in the page's own files folder are
    /// given: a link that leaves it (`..`, a full path, a drive) is refused.
    pub fn asset(&self, path: &str, reference: &str) -> Res<Value> {
        let folder = self.files_folder(path).ok_or("that is not a page")?;
        let dir = folder.file_name().and_then(|f| f.to_str()).unwrap_or_default().to_owned();
        let decoded = unescape(reference).ok_or("that file is not one of this page's")?;
        let leaf = decoded.strip_prefix(&format!("{dir}/")).ok_or("that file is not one of this page's")?;
        if leaf.is_empty() || leaf.starts_with('.') || leaf.contains(['/', '\\', ':']) || leaf.contains("..") {
            return Err("that file is not one of this page's".into());
        }
        let file = folder.join(leaf);
        let size = fs::metadata(&file).map_err(|_| "that file is not there".to_owned())?.len();
        if size > MAX_ATTACHMENT as u64 {
            return Err("that file is too big to show".into());
        }
        let ext = leaf.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        let kind = image_type(&ext).unwrap_or("application/octet-stream");
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        Ok(json!({ "dataUrl": format!("data:{kind};base64,{}", to_base64(&bytes)), "size": size }))
    }

    /// Where a page's comments are kept: `<folder>/.comments/<notebook>/<page>.json`, so the page itself stays only
    /// what was written.
    fn comments_file(&self, path: &str) -> Option<PathBuf> {
        let (notebook, file) = page_ok(path, self.ext)?;
        Some(self.root.join(COMMENTS).join(notebook).join(format!("{}.json", file.strip_suffix(".md")?)))
    }

    /// A page's comments, as kept: a list of `{ id, quote, text, by, whenMs, resolved }`. None yet is an empty list.
    pub fn comments(&self, path: &str) -> Res<Value> {
        self.page(path)?;
        let file = self.comments_file(path).ok_or("that is not a page")?;
        match fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str::<Value>(&text).ok().filter(Value::is_array).map_or_else(|| Ok(json!([])), Ok),
            Err(_) => Ok(json!([])),
        }
    }

    /// Keep a page's comments. Each is checked: a short id, the quoted words it is about, what was said, who said it.
    pub fn set_comments(&self, path: &str, comments: &Value) -> Res<Value> {
        let page = self.page(path)?;
        if !page.is_file() {
            return Err("that page is not there".into());
        }
        let list = comments.as_array().ok_or("comments are a list")?;
        if list.len() > MAX_COMMENTS {
            return Err("that page has too many comments".into());
        }
        let text = |c: &Value, key: &str, max: usize| c.get(key).and_then(Value::as_str).filter(|t| t.len() <= max).map(str::to_owned);
        let mut kept = Vec::with_capacity(list.len());
        for c in list {
            let id = text(c, "id", 40).filter(|i| !i.is_empty() && i.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')).ok_or("a comment needs an id")?;
            let said = text(c, "text", 4000).ok_or("a comment needs its words")?;
            let quote = text(c, "quote", 1000).unwrap_or_default();
            let by = text(c, "by", 40).unwrap_or_else(|| "you".into());
            let when = c.get("whenMs").and_then(Value::as_u64).unwrap_or(0);
            let resolved = c.get("resolved").and_then(Value::as_bool).unwrap_or(false);
            let mut one = json!({ "id": id, "quote": quote, "text": said, "by": by, "whenMs": when, "resolved": resolved });
            // A reply names the comment it answers.
            if let Some(to) = text(c, "replyTo", 40).filter(|i| !i.is_empty() && i.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')) {
                one["replyTo"] = json!(to);
            }
            kept.push(one);
        }
        let file = self.comments_file(path).ok_or("that is not a page")?;
        if kept.is_empty() {
            let _ = fs::remove_file(&file);
        } else {
            fs::create_dir_all(file.parent().ok_or("that is not a page")?).map_err(|e| e.to_string())?;
            let temp = file.with_extension("json.mobius-tmp");
            fs::write(&temp, serde_json::to_string_pretty(&kept).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            fs::rename(&temp, &file).map_err(|e| e.to_string())?;
        }
        Ok(json!({ "path": path, "comments": kept }))
    }

    /// Answer a comment on a page: the reply is kept under it, about the same words. A reply to a reply answers the
    /// comment that started the thread.
    pub fn reply_to_comment(&self, path: &str, id: &str, words: &str, by: &str, when_ms: u64) -> Res<Value> {
        let mut list = self.comments(path)?.as_array().cloned().unwrap_or_default();
        let parent = list.iter().find(|c| c["id"] == id).cloned().ok_or("there is no comment with that id on this page")?;
        let root = parent["replyTo"].as_str().unwrap_or(id).to_owned();
        let words = words.trim();
        if words.is_empty() {
            return Err("a reply needs its words".into());
        }
        let new_id = format!("r{when_ms:x}{}", list.len());
        list.push(json!({ "id": new_id, "quote": parent["quote"], "text": words, "by": by, "whenMs": when_ms, "resolved": false, "replyTo": root }));
        self.set_comments(path, &Value::Array(list))?;
        Ok(json!({ "path": path, "id": new_id, "replyTo": root }))
    }

    /// Resolve a comment, or open it again; its replies go with it.
    pub fn resolve_comment(&self, path: &str, id: &str, resolved: bool) -> Res<Value> {
        let mut list = self.comments(path)?.as_array().cloned().unwrap_or_default();
        let root = list.iter().find(|c| c["id"] == id).map(|c| c["replyTo"].as_str().unwrap_or(id).to_owned()).ok_or("there is no comment with that id on this page")?;
        for c in &mut list {
            if c["id"] == root.as_str() || c["replyTo"] == root.as_str() {
                c["resolved"] = json!(resolved);
            }
        }
        self.set_comments(path, &Value::Array(list))?;
        Ok(json!({ "path": path, "id": root, "resolved": resolved }))
    }

    /// Every page with comments, and its comments: for "answer the comments" with no page named.
    pub fn all_comments(&self) -> Res<Value> {
        let mut out = Vec::new();
        for notebook in self.list()?.as_array().cloned().unwrap_or_default() {
            for page in notebook["pages"].as_array().cloned().unwrap_or_default() {
                let Some(path) = page["path"].as_str() else { continue };
                let comments = self.comments(path)?;
                if comments.as_array().is_some_and(|c| !c.is_empty()) {
                    out.push(json!({ "page": path, "title": page["title"], "comments": comments }));
                }
            }
        }
        Ok(Value::Array(out))
    }

    /// Save a copy of a page for someone else, in the workspace's `Exports` folder (never replacing a file there):
    /// `html` is the page as one file with its pictures inside (made by the window), `md` the page's Markdown with its
    /// files folder copied beside it.
    pub fn export(&self, path: &str, kind: &str, html: Option<&str>) -> Res<Value> {
        let page = self.page(path)?;
        let content = fs::read_to_string(&page).map_err(|_| "that page is not there".to_owned())?;
        let stem = page.file_stem().and_then(|f| f.to_str()).unwrap_or("Untitled").to_owned();
        let title = file_name_for(&title_of(&content, &stem));
        let folder = self.workspace.join(EXPORTS);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let (body, ext) = match kind {
            "html" => (html.filter(|h| h.len() <= MAX_PAGE * 30).ok_or("there is nothing to export")?.to_owned(), "html"),
            "md" => (content, "md"),
            _ => return Err("that kind of export is not known".into()),
        };
        let mut n = 1;
        let name = loop {
            let candidate = if n < 2 { format!("{title}.{ext}") } else { format!("{title} {n}.{ext}") };
            match fs::OpenOptions::new().write(true).create_new(true).open(folder.join(&candidate)) {
                Ok(mut f) => {
                    if let Err(e) = std::io::Write::write_all(&mut f, body.as_bytes()) {
                        drop(f);
                        let _ = fs::remove_file(folder.join(&candidate));
                        return Err(e.to_string());
                    }
                    break candidate;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && n < 1000 => n += 1,
                Err(e) => return Err(e.to_string()),
            }
        };
        // A Markdown copy takes its pictures and files along, so its links still work.
        if ext == "md"
            && let Some(files) = self.files_folder(path).filter(|f| f.is_dir())
        {
            let made_stem = name.strip_suffix(".md").unwrap_or(&name);
            let target = folder.join(files_folder_name(made_stem));
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            for entry in fs::read_dir(&files).map_err(|e| e.to_string())?.filter_map(Result::ok) {
                // A file already there (a folder of the same name the person made) is left as it is.
                if entry.file_type().is_ok_and(|t| t.is_file()) && !target.join(entry.file_name()).exists() {
                    let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
                    if let Ok(mut f) = fs::OpenOptions::new().write(true).create_new(true).open(target.join(entry.file_name()))
                        && std::io::Write::write_all(&mut f, &bytes).is_err()
                    {
                        drop(f);
                        let _ = fs::remove_file(target.join(entry.file_name()));
                    }
                }
            }
            if made_stem != stem {
                let from = files_folder_name(&stem).replace(' ', "%20");
                let to = files_folder_name(made_stem).replace(' ', "%20");
                let fixed = fs::read_to_string(folder.join(&name)).map_err(|e| e.to_string())?.replace(&format!("]({from}/"), &format!("]({to}/"));
                fs::write(folder.join(&name), fixed).map_err(|e| e.to_string())?;
            }
        }
        Ok(json!({ "path": path, "saved": format!("{EXPORTS}/{name}"), "name": name }))
    }
}

const VERSIONS: &str = ".versions";
const COMMENTS: &str = ".comments";
/// Where exported copies go, in the workspace, so Files shows them.
pub const EXPORTS: &str = "Exports";
const MAX_COMMENTS: usize = 500;
/// Typing saves every moment; a version is kept at most this often.
const KEEP_EVERY_MS: u64 = 5 * 60 * 1000;
const MAX_KEPT: usize = 50;
const MAX_VERSIONS: usize = 30;
pub const MAX_ATTACHMENT: usize = 20 * 1024 * 1024;

/// A link's `%XX` escapes written out (`%20` is a space); `None` if they do not make UTF-8 text.
fn unescape(link: &str) -> Option<String> {
    let bytes = link.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(hex) = link.get(i + 1..i + 3)
            && let Ok(b) = u8::from_str_radix(hex, 16)
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `Battery` keeps its files in `Battery files`.
pub fn files_folder_name(page_stem: &str) -> String {
    format!("{page_stem} files")
}

/// The times of a page's kept versions, oldest first.
fn kept_times(folder: &Path) -> Vec<u64> {
    let mut times: Vec<u64> = fs::read_dir(folder).into_iter().flatten().filter_map(Result::ok).filter_map(|e| e.file_name().to_str()?.strip_suffix(".md")?.parse().ok()).collect();
    times.sort_unstable();
    times
}

fn image_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(B64[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Plain or `data:…;base64,` text back to bytes; `None` if it is not base64.
fn from_base64(text: &str) -> Option<Vec<u8>> {
    let body = text.split_once(";base64,").map_or(text, |(_, b)| b);
    let mut out = Vec::with_capacity(body.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for c in body.bytes().filter(|c| !c.is_ascii_whitespace()) {
        if c == b'=' {
            break;
        }
        let v = B64.iter().position(|&b| b == c)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Notes) {
        let dir = TempDir::new().unwrap();
        let notes = Notes::new(dir.path().join("work"), dir.path().join("store"));
        (dir, notes)
    }

    #[test]
    fn tags_are_words_that_start_with_a_hash() {
        let page = "# Plan #intitle\n\nCall Sam #kestrel/p2 and #Supplier.\n## Heading\nSee page#part, \\#escaped, `#code` and #42.\n```\n#fenced\n```\n(#inbrackets) #supplier again #trail-\n";
        assert_eq!(tags_in(page), vec!["inbrackets", "intitle", "kestrel/p2", "Supplier", "trail"]);
        assert!(tags_in("# Only a title\n").is_empty());
    }

    #[test]
    fn the_preview_is_the_first_line_under_the_title_without_marks() {
        assert_eq!(preview_of("# Plan\n\n- [ ] Call **Sam** about [the packs](https://x.example)\n"), "Call Sam about the packs");
        assert_eq!(preview_of("# Plan\n\n## Week one\n"), "Week one");
        assert_eq!(preview_of("# Plan\n\n1. First `step`\n"), "First step");
        assert_eq!(preview_of("# Plan\n"), "");
        assert_eq!(preview_of("No title, just words\n"), "No title, just words");
    }

    #[test]
    fn the_list_gives_each_page_its_preview_and_tags() -> Result<(), String> {
        let (_dir, notes) = setup();
        notes.create_notebook("Work")?;
        notes.save("Work/Plan.md", "# Plan\n\nShip it #launch\n", None)?;
        let list = notes.list()?;
        let page = &list[0]["pages"][0];
        assert_eq!(page["preview"], "Ship it #launch");
        assert_eq!(page["tags"], json!(["launch"]));
        Ok(())
    }

    #[test]
    fn names_are_made_safe_on_every_system() {
        assert_eq!(file_name_for("Trip: Paris / Rome?"), "Trip Paris Rome");
        assert_eq!(file_name_for("  ..hidden.. "), "hidden");
        assert_eq!(file_name_for(""), "Untitled");
        assert_eq!(file_name_for("CON"), "Untitled CON");
        assert_eq!(file_name_for("a\u{0}b\nc"), "a b c");
        assert_eq!(file_name_for(&"x".repeat(300)).len(), MAX_NAME);
    }

    #[test]
    fn a_notebook_and_pages_are_real_folders_and_files() -> Result<(), String> {
        let (d, n) = setup();
        assert_eq!(n.create_notebook("Work")?["name"], "Work");
        assert_eq!(n.create_notebook("Work")?["name"], "Work 2");
        let page = n.create_page("Work", "Plans for May")?;
        assert_eq!(page["path"], "Work/Plans for May.md");
        assert_eq!(n.create_page("Work", "Plans for May")?["path"], "Work/Plans for May 2.md");
        assert_eq!(std::fs::read_to_string(d.path().join("work/notes/Work/Plans for May.md")).unwrap(), "# Plans for May\n\n");
        let list = n.list()?;
        assert_eq!(list[0]["name"], "Work");
        assert_eq!(list[0]["pages"].as_array().unwrap().len(), 2);
        assert_eq!(list[1]["name"], "Work 2");
        Ok(())
    }

    #[test]
    fn the_title_is_the_first_heading_or_the_file_name() {
        assert_eq!(title_of("intro\n# Real title\n# Second", "file"), "Real title");
        assert_eq!(title_of("no heading", "file"), "file");
        assert_eq!(title_of("#   \n", "file"), "file");
        let (_d, n) = setup();
        n.create_notebook("A").unwrap();
        n.save("A/x.md", "# Groceries\n- milk", None).unwrap();
        assert_eq!(n.list().unwrap()[0]["pages"][0]["title"], "Groceries");
    }

    #[test]
    fn only_plain_pages_inside_notes_can_be_read_or_written() {
        let (d, n) = setup();
        n.create_notebook("A").unwrap();
        std::fs::write(d.path().join("work/secret.md"), "s").unwrap();
        for bad in ["../secret.md", "A/../../secret.md", "A/b/c.md", "A/x.txt", "x.md", "A/.md", "/A/x.md", "A\\x.md", ".git/x.md", "A/CON.md"] {
            assert!(n.read(bad).is_err(), "{bad}");
            assert!(n.save(bad, "x", None).is_err(), "{bad}");
            assert!(n.remove_page(bad).is_err(), "{bad}");
        }
        assert!(n.save("Nope/x.md", "x", None).unwrap_err().contains("notebook"));
        assert!(n.create_page("../A", "x").is_err());
        assert!(n.create_page("Missing", "x").is_err());
    }

    #[test]
    fn a_notebook_that_links_elsewhere_is_not_followed() {
        let (d, n) = setup();
        n.create_notebook("A").unwrap();
        let outside = d.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("s.md"), "# private").unwrap();
        let link = d.path().join("work").join("notes").join("Linked");
        #[cfg(windows)]
        let linked = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        // A junction needs no special rights on Windows, so failing to make one is a broken test, not a skip.
        assert!(linked || !cfg!(windows), "could not make the junction");
        if !linked {
            return;
        }
        assert!(n.read("Linked/s.md").is_err());
        assert!(n.save("Linked/new.md", "x", None).is_err());
        assert!(!outside.join("new.md").exists());
    }

    #[test]
    fn a_save_does_not_overwrite_a_change_made_elsewhere() {
        let (d, n) = setup();
        n.create_notebook("A").unwrap();
        let first = n.create_page("A", "P").unwrap();
        let base = first["modified"].as_u64();
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::write(d.path().join("work/notes/A/P.md"), "# P\nby the assistant").unwrap();
        assert_eq!(n.save("A/P.md", "# P\nby the person", base).unwrap_err(), "changed elsewhere");
        assert!(n.read("A/P.md").unwrap()["content"].as_str().unwrap().contains("assistant"));
        let now = n.read("A/P.md").unwrap()["modified"].as_u64();
        n.save("A/P.md", "# P\nby the person", now).unwrap();
        assert!(n.read("A/P.md").unwrap()["content"].as_str().unwrap().contains("person"));
        assert!(n.save("A/P.md", &"x".repeat(MAX_PAGE + 1), None).is_err());
    }

    #[test]
    fn a_deleted_page_can_be_brought_back_from_its_checkpoint() {
        if std::process::Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let (d, n) = setup();
        n.create_notebook("A").unwrap();
        n.save("A/keep.md", "# Keep\nimportant", None).unwrap();
        assert_eq!(n.remove_page("A/keep.md").unwrap()["checkpoint"], true);
        assert!(n.read("A/keep.md").is_err());
        let ws = std::fs::canonicalize(d.path().join("work")).unwrap();
        let cp = Checkpoints::new(d.path().join("store"));
        let last = cp.list(&ws, 1).unwrap();
        cp.restore(&ws, &last[0].id).unwrap();
        assert!(n.read("A/keep.md").unwrap()["content"].as_str().unwrap().contains("important"));
    }

    #[test]
    fn search_needs_every_word_and_puts_title_matches_first() {
        let (_d, n) = setup();
        n.create_notebook("A").unwrap();
        n.save("A/one.md", "# Shopping\nbuy oat milk", None).unwrap();
        n.save("A/two.md", "# Milk recipes\npancakes", None).unwrap();
        n.save("A/three.md", "# Other\nnothing", None).unwrap();
        let hits = n.search("milk").unwrap();
        let paths: Vec<_> = hits.as_array().unwrap().iter().map(|h| h["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["A/two.md", "A/one.md"]);
        assert_eq!(hits[1]["line"], "buy oat milk");
        assert_eq!(n.search("oat milk").unwrap().as_array().unwrap().len(), 1);
        assert_eq!(n.search("   ").unwrap(), json!([]));
    }

    #[test]
    fn other_kinds_of_file_are_kept_the_same_way() {
        let dir = TempDir::new().unwrap();
        let designs = Notes::in_folder(dir.path().join("work"), dir.path().join("store"), "designs").of_files("json", design_starter);
        designs.create_notebook("Trip app").unwrap();
        let made = designs.create_page("Trip app", "Home").unwrap();
        assert_eq!(made["path"], "Trip app/Home.json");
        assert!(made["content"].as_str().unwrap().contains("\"frames\""));
        std::fs::write(dir.path().join("work/designs/Trip app/notes.md"), "# not a design").unwrap();
        let list = designs.list().unwrap();
        assert_eq!(list[0]["pages"].as_array().unwrap().len(), 1);
        assert_eq!(list[0]["pages"][0]["title"], "Home");
        assert!(designs.read("Trip app/notes.md").is_err());
    }

    #[test]
    fn a_save_keeps_what_the_page_held_before_and_versions_list_it_newest_first() {
        let (_d, notes) = setup();
        notes.create_notebook("Work").unwrap();
        let page = notes.create_page("Work", "Plan").unwrap();
        let path = page["path"].as_str().unwrap();
        notes.save(path, "# Plan\n\nfirst\n", None).unwrap();
        // Typing straight after does not keep another version: one at most every few minutes.
        notes.save(path, "# Plan\n\nsecond\n", None).unwrap();
        let v = notes.versions(path).unwrap();
        let v = v.as_array().unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0]["content"], "# Plan\n\n");
        assert_eq!(v[0]["source"], "kept");
        // An older kept version shows after it; one the same as the page now is left out.
        let folder = notes.versions_folder(path).unwrap();
        fs::write(folder.join("1000.md"), "# Plan\n\nsecond\n").unwrap();
        fs::write(folder.join("500.md"), "# Plan\n\nzero\n").unwrap();
        let v = notes.versions(path).unwrap();
        let texts: Vec<&str> = v.as_array().unwrap().iter().map(|x| x["content"].as_str().unwrap()).collect();
        assert_eq!(texts, vec!["# Plan\n\n", "# Plan\n\nzero\n"]);
        // The versions folder is not a notebook.
        let list = notes.list().unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_file_added_to_a_page_sits_beside_it_and_is_given_back_only_from_there() {
        let (_d, notes) = setup();
        notes.create_notebook("Work").unwrap();
        let path = notes.create_page("Work", "Battery").unwrap()["path"].as_str().unwrap().to_owned();
        let png = to_base64(b"\x89PNG fake");
        let first = notes.attach(&path, "../../photo one.PNG", &png).unwrap();
        assert_eq!(first["ref"], "Battery%20files/photo%20one.png");
        assert_eq!(first["image"], true);
        let again = notes.attach(&path, "photo one.png", &format!("data:image/png;base64,{png}")).unwrap();
        assert_eq!(again["ref"], "Battery%20files/photo%20one%202.png");
        let shown = notes.asset(&path, "Battery%20files/photo%20one.png").unwrap();
        assert_eq!(notes.asset(&path, "Battery files/photo%20%6Fne.png").unwrap()["dataUrl"], shown["dataUrl"]);
        assert!(notes.asset(&path, "Battery%20files/%2E%2E%2FBattery.md").is_err());
        assert_eq!(shown["dataUrl"], format!("data:image/png;base64,{png}"));
        for bad in ["Battery files/../Battery.md", "../notes/x.png", "/etc/passwd", "C:/x.png", "Battery files/sub/x.png", "Other files/x.png", "Battery files/.hidden"] {
            assert!(notes.asset(&path, bad).is_err(), "{bad} should be refused");
        }
        assert!(notes.attach("../x.md", "a.png", &png).is_err());
        assert!(notes.attach(&path, "big.bin", &"A".repeat(MAX_ATTACHMENT / 3 * 4 + 8)).is_err());
        // The list still has one page, and deleting the page takes its files with it.
        assert_eq!(notes.list().unwrap()[0]["pages"].as_array().unwrap().len(), 1);
        notes.remove_page(&path).unwrap();
        assert!(!notes.root.join("Work/Battery files").exists());
    }

    #[test]
    fn a_deck_takes_pictures_beside_it_and_they_go_when_it_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let plain = Notes::in_folder(dir.path().join("workspace"), dir.path().join("checkpoints"), "slides").named_by_file();
        let slides = Notes::in_folder(dir.path().join("workspace"), dir.path().join("checkpoints"), "slides").named_by_file().with_files();
        slides.create_notebook("Presentations").unwrap();
        let path = slides.create_page("Presentations", "Kickoff").unwrap()["path"].as_str().unwrap().to_owned();
        let png = to_base64(b"\x89PNG fake");
        assert!(plain.attach(&path, "site.png", &png).is_err(), "a store named by file takes no files unless asked");
        let added = slides.attach(&path, "site.png", &png).unwrap();
        assert_eq!(added["ref"], "Kickoff%20files/site.png");
        assert_eq!(slides.asset(&path, "Kickoff%20files/site.png").unwrap()["dataUrl"], format!("data:image/png;base64,{png}"));
        for bad in ["../x.md", "../../notes/Work/Battery.md", "/etc/passwd"] {
            assert!(slides.attach(bad, "a.png", &png).is_err(), "{bad} should be refused");
        }
        for bad in ["Kickoff files/../Kickoff.md", "../notes/x.png", "Other files/x.png"] {
            assert!(slides.asset(&path, bad).is_err(), "{bad} should be refused");
        }
        // The files folder is not a deck, and deleting the deck takes it along.
        assert_eq!(slides.list().unwrap()[0]["pages"].as_array().unwrap().len(), 1);
        slides.remove_page(&path).unwrap();
        assert!(!dir.path().join("workspace/slides/Presentations/Kickoff files").exists());
    }

    #[test]
    fn base64_goes_there_and_back() {
        for bytes in [&b""[..], b"a", b"ab", b"abc", b"abcd", &[0, 255, 128, 7, 9]] {
            assert_eq!(from_base64(&to_base64(bytes)).unwrap(), bytes);
        }
        assert_eq!(to_base64(b"Man"), "TWFu");
        assert!(from_base64("not*base64").is_none());
    }


    #[test]
    fn links_to_other_pages_are_markdown_links_to_their_files() {
        let page = "# Plan\n\nSee [the notes](Supplier%20notes.md), [groceries](../Home/Groceries.md) and [again](<Supplier notes.md>).\n\
            Not [the web](https://x.example/a.md), ![a picture](Plan%20files/a.md), [a file](Plan%20files/q.pdf), `[code](Code.md)`,\n\
            [escape](../../etc/x.md), [self](Plan.md) or [deep](../a/b/c.md).\n```\n[fenced](Fenced.md)\n```\n";
        assert_eq!(links_in(page, "Work/Plan.md"), vec!["Work/Supplier notes.md", "Home/Groceries.md"]);
    }


    #[test]
    fn a_store_without_kept_versions_keeps_none() {
        let dir = TempDir::new().unwrap();
        let wiki = Notes::in_folder(dir.path().join("work"), dir.path().join("store"), "wiki").without_kept_versions();
        wiki.create_notebook("Team").unwrap();
        let path = wiki.create_page("Team", "Battery").unwrap()["path"].as_str().unwrap().to_owned();
        wiki.save(&path, "# Battery\n\nnew\n", None).unwrap();
        assert!(!dir.path().join("work/wiki/.versions").exists());
    }


    #[test]
    fn comments_are_kept_beside_the_page_and_checked() {
        let (_d, notes) = setup();
        notes.create_notebook("Work").unwrap();
        let path = notes.create_page("Work", "Plan").unwrap()["path"].as_str().unwrap().to_owned();
        assert_eq!(notes.comments(&path).unwrap(), json!([]));
        let one = json!([{ "id": "c1", "quote": "the 23rd", "text": "Is that firm?", "by": "you", "whenMs": 5, "extra": 1 }]);
        notes.set_comments(&path, &one).unwrap();
        let back = notes.comments(&path).unwrap();
        assert_eq!(back[0]["text"], "Is that firm?");
        assert_eq!(back[0]["resolved"], false);
        assert!(back[0].get("extra").is_none());
        assert_eq!(fs::read_to_string(notes.root.join("Work/Plan.md")).unwrap(), "# Plan\n\n");
        assert!(notes.set_comments(&path, &json!([{ "id": "../x", "text": "no" }])).is_err());
        assert!(notes.set_comments(&path, &json!([{ "id": "c2" }])).is_err());
        assert!(notes.set_comments("../x.md", &one).is_err());
        notes.set_comments(&path, &json!([])).unwrap();
        assert_eq!(notes.comments(&path).unwrap(), json!([]));
        // Deleting the page takes its comments; a new page of the same name starts without them.
        notes.set_comments(&path, &one).unwrap();
        notes.remove_page(&path).unwrap();
        let again = notes.create_page("Work", "Plan").unwrap()["path"].as_str().unwrap().to_owned();
        assert_eq!(notes.comments(&again).unwrap(), json!([]));
        assert_eq!(notes.list().unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_comment_is_answered_under_it_and_resolved_with_its_replies() {
        let (_d, notes) = setup();
        notes.create_notebook("Work").unwrap();
        let path = notes.create_page("Work", "Plan").unwrap()["path"].as_str().unwrap().to_owned();
        notes.create_page("Work", "Quiet").unwrap();
        notes.set_comments(&path, &json!([{ "id": "c1", "quote": "the 23rd", "text": "Is that firm?", "by": "you", "whenMs": 5 }])).unwrap();
        let reply = notes.reply_to_comment(&path, "c1", " Yes, signed off on Monday. ", "Mobius", 9).unwrap();
        let first = reply["id"].as_str().unwrap().to_owned();
        // A reply to the reply joins the same thread.
        assert_eq!(notes.reply_to_comment(&path, &first, "Thanks", "you", 10).unwrap()["replyTo"], "c1");
        let back = notes.comments(&path).unwrap();
        assert_eq!(back.as_array().unwrap().len(), 3);
        assert_eq!(back[1], json!({ "id": first, "quote": "the 23rd", "text": "Yes, signed off on Monday.", "by": "Mobius", "whenMs": 9, "resolved": false, "replyTo": "c1" }));
        assert!(notes.reply_to_comment(&path, "c9", "No such", "Mobius", 11).is_err());
        assert!(notes.reply_to_comment(&path, "c1", "  ", "Mobius", 11).is_err());
        // Resolving a reply resolves the thread it is in.
        notes.resolve_comment(&path, &first, true).unwrap();
        assert!(notes.comments(&path).unwrap().as_array().unwrap().iter().all(|c| c["resolved"] == true));
        let all = notes.all_comments().unwrap();
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["page"], path.as_str());
        assert_eq!(all[0]["title"], "Plan");
    }

    #[test]
    fn an_export_is_a_new_file_in_exports_with_the_pages_files_beside_it() {
        let (dir, notes) = setup();
        notes.create_notebook("Work").unwrap();
        let path = notes.create_page("Work", "Battery").unwrap()["path"].as_str().unwrap().to_owned();
        let pic = notes.attach(&path, "cell.png", &to_base64(b"png")).unwrap()["ref"].as_str().unwrap().to_owned();
        notes.save(&path, &format!("# Battery pack\n\n![cell]({pic})\n"), None).unwrap();
        let md = notes.export(&path, "md", None).unwrap();
        assert_eq!(md["saved"], "Exports/Battery pack.md");
        let out = dir.path().join("work/Exports");
        assert_eq!(fs::read(out.join("Battery pack files/cell.png")).unwrap(), b"png");
        assert_eq!(fs::read_to_string(out.join("Battery pack.md")).unwrap(), "# Battery pack\n\n![cell](Battery%20pack%20files/cell.png)\n");
        let html = notes.export(&path, "html", Some("<h1>Battery pack</h1>")).unwrap();
        assert_eq!(html["saved"], "Exports/Battery pack.html");
        // A files folder already there under the copy's name keeps what it holds.
        fs::create_dir_all(out.join("Battery pack 2 files")).unwrap();
        fs::write(out.join("Battery pack 2 files/cell.png"), b"mine").unwrap();
        assert_eq!(notes.export(&path, "md", None).unwrap()["saved"], "Exports/Battery pack 2.md");
        assert_eq!(fs::read(out.join("Battery pack 2 files/cell.png")).unwrap(), b"mine");
        assert!(notes.export(&path, "exe", None).is_err());
        assert!(notes.export(&path, "html", None).is_err());
    }

}

#[cfg(all(test, windows))]
mod remove_soon_tests {
    use super::remove_dir_soon;
    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn a_files_folder_held_open_by_another_program_is_removed_as_soon_as_it_is_let_go() {
        let dir = tempfile::tempdir().unwrap();
        let files = dir.path().join("Work").join("Battery files");
        std::fs::create_dir_all(&files).unwrap();
        std::fs::write(files.join("cell.png"), b"png").unwrap();
        // As a virus scan can: the new file open for reading, sharing reading only, so neither it nor its folder can go yet.
        let held = std::fs::OpenOptions::new().read(true).share_mode(1).open(files.join("cell.png")).unwrap();
        remove_dir_soon(&files, &dir.path().join(".trash"));
        // Longer than the old code waited before giving up for good.
        std::thread::sleep(std::time::Duration::from_millis(2000));
        drop(held);
        let trash = dir.path().join(".trash");
        for _ in 0..80 {
            let parked = std::fs::read_dir(&trash).map(|d| d.count()).unwrap_or(0);
            if !files.exists() && parked == 0 { return; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        panic!("the files folder was not removed once the file was let go");
    }
}
