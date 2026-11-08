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
    /// The pages' file extension, `md` unless another kind of file is kept this way (designs are `json`).
    ext: &'static str,
    /// What a new page holds, from its title.
    starter: fn(&str) -> String,
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

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// What a new design holds: one empty phone-sized frame. See `apps/desktop/src/design-format.ts` for the format.
pub fn design_starter(_title: &str) -> String {
    "{\n  \"version\": 1,\n  \"styles\": [],\n  \"frames\": [\n    { \"id\": \"f1\", \"name\": \"Frame 1\", \"x\": 0, \"y\": 0, \"w\": 393, \"h\": 852, \"fill\": \"#ffffff\", \"radius\": 0, \"children\": [] }\n  ]\n}\n".to_owned()
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
        Notes { root: workspace.join(folder), checkpoints: Checkpoints::new(checkpoint_store), workspace, named_by_file: false, ext: "md", starter: markdown_starter }
    }

    /// Pages called by their file names, as Slides calls its decks.
    pub fn named_by_file(mut self) -> Notes {
        self.named_by_file = true;
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
                let head: String = fs::read_to_string(entry.path()).unwrap_or_default().chars().take(4000).collect();
                let title = if self.named_by_file { stem.to_owned() } else { title_of(&head, stem) };
                pages.push(json!({ "path": path, "title": title, "modified": modified_ms(&entry.path()) }));
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

    /// Delete a page. A checkpoint is taken first, so it can be brought back.
    pub fn remove_page(&self, path: &str) -> Res<Value> {
        let file = self.page(path)?;
        if !file.is_file() {
            return Err("that page is not there".into());
        }
        let folder = self.root.file_name().and_then(|f| f.to_str()).unwrap_or(FOLDER);
        let checkpoint = self.checkpoints.snapshot(&self.workspace, &format!("before deleting {folder}/{path}")).is_ok();
        fs::remove_file(&file).map_err(|e| e.to_string())?;
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
}
