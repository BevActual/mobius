//! Renaming notebooks, moving pages between them, and the Trash. A page or notebook deleted from Notes goes to
//! `.deleted` beside the notebooks, with its files, comments and kept versions, and comes back from there whole with
//! Restore. When a page or notebook moves, every link to it from another page is written to its new place, and the
//! moved page's own links to pages it left behind still reach them.
use super::{
    COMMENTS, FOLDER, Notes, Res, VERSIONS, file_name_for, files_folder_name, notebook_ok,
    page_link, page_ok, title_of,
};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Where deleted pages and notebooks wait, one folder each.
const DELETED: &str = ".deleted";
/// How long the Trash keeps what was deleted: thirty days, as Apple Notes keeps Recently Deleted.
const KEEP_DELETED_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// The note on each deleted thing: what it was and where it came from.
const ENTRY: &str = "entry.json";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Move a file or folder, trying again for a moment while Windows still has it open (a picture being shown, the
/// search index reading a new file).
fn move_soon(from: &Path, to: &Path) -> Res<()> {
    let mut last = None;
    for wait in [0, 50, 150, 400] {
        std::thread::sleep(std::time::Duration::from_millis(wait));
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    Err(format!(
        "it is in use ({}); close what has it open and try again",
        last.map(|e| e.to_string()).unwrap_or_default()
    ))
}

/// Move `from` to `to` if it is there, making `to`'s folder first.
fn move_if_there(from: &Path, to: &Path) -> Res<()> {
    if !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    move_soon(from, to)
}

/// A link's target as it is written in a page, and where it ends: `<My Plan.md>` (spaces kept, in angle brackets) or
/// `My%20Plan.md` (up to a space or the closing bracket).
pub(super) fn target_at(line: &str, start: usize) -> Option<(usize, usize)> {
    let rest = &line[start..];
    if rest.starts_with('<') {
        let end = rest.find('>')?;
        return Some((start, start + end + 1));
    }
    let end = rest.find(|c: char| c == ')' || c.is_whitespace())?;
    Some((start, start + end))
}

/// How a page at `from` links to the page at `to`: by its file in the same notebook, else `../notebook/file`. Spaces
/// are written `%20`, or kept inside angle brackets when the link was written that way.
fn link_to(from: &str, to: &str, angled: bool) -> String {
    let same = from.split_once('/').map(|f| f.0) == to.split_once('/').map(|t| t.0);
    let plain = if same {
        to.split_once('/').map_or(to, |t| t.1).to_owned()
    } else {
        format!("../{to}")
    };
    if angled {
        format!("<{plain}>")
    } else {
        plain.replace(' ', "%20")
    }
}

/// A page's text with its links to pages written again: each link is read as the page had it at `was` (where it
/// was before a move), the page it reached is mapped by `moved`, and the link is written for the page at `now`.
/// Links in code, pictures and links to anything but a page are left as they are. `None` when nothing changed.
fn relinked(
    content: &str,
    was: &str,
    now: &str,
    moved: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    let notebook = was.split_once('/')?.0;
    let mut out = String::with_capacity(content.len());
    let mut changed = false;
    let mut fenced = false;
    for line in content.split_inclusive('\n') {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
        }
        if fenced || line.trim_start().starts_with("```") {
            out.push_str(line);
            continue;
        }
        let bytes = line.as_bytes();
        let (mut i, mut copied, mut in_code) = (0, 0, false);
        while i < bytes.len() {
            match bytes[i] {
                b'`' => in_code = !in_code,
                b']' if !in_code
                    && bytes.get(i + 1) == Some(&b'(')
                    && !super::is_picture(line, i) =>
                {
                    if let Some((start, end)) = target_at(line, i + 2) {
                        let written = &line[start..end];
                        if let Some(target) = page_link(written, notebook) {
                            let goes = moved(&target).unwrap_or(target);
                            let again = link_to(now, &goes, written.starts_with('<'));
                            if again != written {
                                out.push_str(&line[copied..start]);
                                out.push_str(&again);
                                copied = end;
                                changed = true;
                            }
                        }
                        i = end;
                        continue;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        out.push_str(&line[copied..]);
    }
    changed.then_some(out)
}

impl Notes {
    fn folder_name(&self) -> &str {
        self.root
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(FOLDER)
    }

    /// Every page's path now, for writing links again after a move.
    fn all_pages(&self) -> Vec<String> {
        let mut out = Vec::new();
        for book in fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
        {
            let name = book.file_name().to_string_lossy().into_owned();
            if !notebook_ok(&name) || !book.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            for page in fs::read_dir(book.path())
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
            {
                let path = format!("{name}/{}", page.file_name().to_string_lossy());
                if page.file_type().is_ok_and(|t| t.is_file()) && page_ok(&path, "md").is_some() {
                    out.push(path);
                }
            }
        }
        out
    }

    /// After pages moved: every page's links written again. `was` gives where a page was before (itself if it did
    /// not move) and `moved` where a page that moved went. Markdown stores only. Returns the pages changed.
    fn relink_all(
        &self,
        was: &dyn Fn(&str) -> String,
        moved: &dyn Fn(&str) -> Option<String>,
    ) -> Vec<String> {
        if self.ext != "md" {
            return Vec::new();
        }
        let mut changed = Vec::new();
        for path in self.all_pages() {
            let file = self.root.join(&path);
            let Ok(content) = fs::read_to_string(&file) else {
                continue;
            };
            if let Some(again) = relinked(&content, &was(&path), &path, moved)
                && fs::write(&file, again).is_ok()
            {
                changed.push(path);
            }
        }
        changed
    }

    /// The side folders a page keeps outside its notebook (kept versions, comments), for `path`.
    fn side_paths(&self, path: &str) -> Vec<(&'static str, PathBuf)> {
        let mut out = Vec::new();
        if let Some(v) = self.versions_folder(path) {
            out.push(("versions", v));
        }
        if let Some(c) = self.comments_file(path) {
            out.push(("comments.json", c));
        }
        out
    }

    /// A notebook called `to` from now on, and every link to its pages written to the new name.
    ///
    /// # Errors
    /// When the notebook is not there, the name is not one a folder can have, or another notebook has it.
    pub fn rename_notebook(&self, from: &str, to: &str) -> Res<Value> {
        if !notebook_ok(from) || !self.root.join(from).is_dir() {
            return Err("that notebook is not there".into());
        }
        let to = file_name_for(to);
        if to == from {
            return Ok(json!({ "name": to, "relinked": [] }));
        }
        // `Plan` to `plan` is the same folder where case is not told apart (Windows, macOS): it moves through a
        // name of its own on the way.
        let only_case = to.to_lowercase() == from.to_lowercase();
        if !only_case && self.root.join(&to).exists() {
            return Err("there is a notebook with that name already".into());
        }
        let _ = self.checkpoints.snapshot(
            &self.workspace,
            &format!("before renaming {}/{from}", self.folder_name()),
        );
        for side in ["", VERSIONS, COMMENTS] {
            let base = if side.is_empty() {
                self.root.clone()
            } else {
                self.root.join(side)
            };
            let (a, b) = (base.join(from), base.join(&to));
            if !a.is_dir() {
                continue;
            }
            if only_case {
                let step = base.join(format!(".{to}.renaming"));
                move_soon(&a, &step)?;
                move_soon(&step, &b)?;
            } else {
                move_soon(&a, &b)?;
            }
        }
        let (old, new) = (format!("{from}/"), format!("{to}/"));
        let relinked = self.relink_all(
            &|p| {
                p.strip_prefix(&new)
                    .map_or_else(|| p.to_owned(), |rest| format!("{old}{rest}"))
            },
            &|t| t.strip_prefix(&old).map(|rest| format!("{new}{rest}")),
        );
        Ok(json!({ "name": to, "relinked": relinked }))
    }

    /// The page moved to `notebook` (named as before, or with a number if that name is taken there), with its files,
    /// comments and kept versions; links to it from other pages, and its own links, written for where it is now.
    ///
    /// # Errors
    /// When the page or the notebook is not there, or the page is in use.
    pub fn move_page(&self, path: &str, notebook: &str) -> Res<Value> {
        let file = self.page(path)?;
        if !file.is_file() {
            return Err("that page is not there".into());
        }
        if !notebook_ok(notebook) || !self.root.join(notebook).is_dir() {
            return Err("that notebook is not there".into());
        }
        let (from_book, name) = page_ok(path, self.ext).ok_or("that is not a page")?;
        if from_book == notebook {
            return Ok(json!({ "path": path, "relinked": [] }));
        }
        let stem = name
            .strip_suffix(self.ext)
            .and_then(|s| s.strip_suffix('.'))
            .unwrap_or(name);
        let mut target = format!("{notebook}/{name}");
        let mut n = 2;
        while self.root.join(&target).exists() {
            target = format!("{notebook}/{stem} {n}.{}", self.ext);
            n += 1;
        }
        let _ = self.checkpoints.snapshot(
            &self.workspace,
            &format!("before moving {}/{path}", self.folder_name()),
        );
        // Its files first: while one is in use the page stays where it is, whole.
        if let (Some(a), Some(b)) = (self.files_folder(path), self.files_folder(&target)) {
            move_if_there(&a, &b)?;
        }
        move_soon(&file, &self.root.join(&target))?;
        for ((_, a), (_, b)) in self
            .side_paths(path)
            .into_iter()
            .zip(self.side_paths(&target))
        {
            let _ = move_if_there(&a, &b);
        }
        // A picture's link names the files folder by the page's name: a page renumbered on the way links to its new
        // folder.
        let new_stem = target
            .rsplit_once('/')
            .map_or("", |t| t.1)
            .strip_suffix(&format!(".{}", self.ext))
            .unwrap_or("")
            .to_owned();
        if new_stem != stem && self.ext == "md" {
            let moved = self.root.join(&target);
            if let Ok(content) = fs::read_to_string(&moved) {
                let (a, b) = (
                    files_folder_name(stem).replace(' ', "%20"),
                    files_folder_name(&new_stem).replace(' ', "%20"),
                );
                let _ = fs::write(
                    &moved,
                    content
                        .replace(&format!("]({a}/"), &format!("]({b}/"))
                        .replace(
                            &format!("](<{}/", files_folder_name(stem)),
                            &format!("](<{}/", files_folder_name(&new_stem)),
                        ),
                );
            }
        }
        let relinked = self.relink_all(
            &|p| {
                if p == target {
                    path.to_owned()
                } else {
                    p.to_owned()
                }
            },
            &|t| (t == path).then(|| target.clone()),
        );
        Ok(json!({ "path": target, "relinked": relinked }))
    }

    fn deleted_root(&self) -> PathBuf {
        self.root.join(DELETED)
    }

    /// A new folder in the Trash for one deleted thing, named by when.
    fn new_entry(&self) -> Res<(String, PathBuf)> {
        let base = now_ms();
        for n in 0..1000 {
            let id = if n == 0 {
                base.to_string()
            } else {
                format!("{base}-{n}")
            };
            let dir = self.deleted_root().join(&id);
            if fs::create_dir_all(self.deleted_root()).is_ok() && fs::create_dir(&dir).is_ok() {
                return Ok((id, dir));
            }
        }
        Err("the Trash cannot be used".into())
    }

    /// The page moved to the Trash with its files, comments and kept versions, for thirty days.
    ///
    /// # Errors
    /// When the page is not there or is in use.
    pub fn trash_page(&self, path: &str) -> Res<Value> {
        let file = self.page(path)?;
        if !file.is_file() {
            return Err("that page is not there".into());
        }
        let title = if self.named_by_file || self.ext != "md" {
            path.rsplit_once('/')
                .map_or(path, |p| p.1)
                .rsplit_once('.')
                .map_or(path, |p| p.0)
                .to_owned()
        } else {
            let head: String = fs::read_to_string(&file)
                .unwrap_or_default()
                .chars()
                .take(4000)
                .collect();
            title_of(
                &head,
                path.rsplit_once('/')
                    .map_or(path, |p| p.1)
                    .trim_end_matches(".md"),
            )
        };
        let (id, dir) = self.new_entry()?;
        if let Some(files) = self.files_folder(path)
            && let Err(e) = move_if_there(&files, &dir.join("files"))
        {
            let _ = fs::remove_dir_all(&dir);
            return Err(e);
        }
        if let Err(e) = move_soon(&file, &dir.join(format!("page.{}", self.ext))) {
            // Put its files back: the page stays where it was, whole.
            if let Some(files) = self.files_folder(path) {
                let _ = move_if_there(&dir.join("files"), &files);
            }
            let _ = fs::remove_dir_all(&dir);
            return Err(e);
        }
        for (name, side) in self.side_paths(path) {
            let _ = move_if_there(&side, &dir.join(name));
        }
        let entry = json!({ "kind": "page", "from": path, "title": title, "deletedMs": now_ms() });
        fs::write(dir.join(ENTRY), entry.to_string()).map_err(|e| e.to_string())?;
        Ok(json!({ "id": id, "path": path }))
    }

    /// The notebook and every page in it moved to the Trash, as one thing to restore.
    ///
    /// # Errors
    /// When the notebook is not there or something in it is in use.
    pub fn trash_notebook(&self, name: &str) -> Res<Value> {
        let book = self.root.join(name);
        if !notebook_ok(name) || !book.is_dir() {
            return Err("that notebook is not there".into());
        }
        let pages = fs::read_dir(&book)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|e| {
                page_ok(
                    &format!("{name}/{}", e.file_name().to_string_lossy()),
                    self.ext,
                )
                .is_some()
            })
            .count();
        let (id, dir) = self.new_entry()?;
        if let Err(e) = move_soon(&book, &dir.join("notebook")) {
            let _ = fs::remove_dir_all(&dir);
            return Err(e);
        }
        for (side, name_in) in [(VERSIONS, "versions"), (COMMENTS, "comments")] {
            let _ = move_if_there(&self.root.join(side).join(name), &dir.join(name_in));
        }
        let entry = json!({ "kind": "notebook", "from": name, "title": name, "pages": pages, "deletedMs": now_ms() });
        fs::write(dir.join(ENTRY), entry.to_string()).map_err(|e| e.to_string())?;
        Ok(json!({ "id": id, "name": name }))
    }

    /// What is in the Trash, newest first: `{ id, kind, title, from, deletedMs, pages? }`. Anything kept longer than
    /// thirty days is removed first.
    ///
    /// # Errors
    /// Never for an empty or missing Trash.
    pub fn deleted(&self) -> Res<Value> {
        let now = now_ms();
        let mut out = Vec::new();
        for e in fs::read_dir(self.deleted_root())
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
        {
            let id = e.file_name().to_string_lossy().into_owned();
            let Ok(mut entry) = fs::read_to_string(e.path().join(ENTRY))
                .map_err(|_| ())
                .and_then(|t| serde_json::from_str::<Value>(&t).map_err(|_| ()))
            else {
                continue;
            };
            let when = entry["deletedMs"].as_u64().unwrap_or(0);
            if now.saturating_sub(when) > KEEP_DELETED_MS {
                let _ = fs::remove_dir_all(e.path());
                continue;
            }
            entry["id"] = json!(id);
            out.push(entry);
        }
        out.sort_by_key(|e| std::cmp::Reverse(e["deletedMs"].as_u64().unwrap_or(0)));
        Ok(Value::Array(out))
    }

    fn entry(&self, id: &str) -> Res<(PathBuf, Value)> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit() || c == '-') {
            return Err("that is not in the Trash".into());
        }
        let dir = self.deleted_root().join(id);
        let text = fs::read_to_string(dir.join(ENTRY))
            .map_err(|_| "that is not in the Trash".to_owned())?;
        let entry: Value =
            serde_json::from_str(&text).map_err(|_| "that is not in the Trash".to_owned())?;
        Ok((dir, entry))
    }

    /// The deleted page or notebook put back where it was: a notebook that is gone is made again, and a name taken
    /// meanwhile gets a number.
    ///
    /// # Errors
    /// When it is not in the Trash or cannot be moved back.
    pub fn restore(&self, id: &str) -> Res<Value> {
        let (dir, entry) = self.entry(id)?;
        let from = entry["from"].as_str().unwrap_or("");
        if entry["kind"] == "notebook" {
            let name = file_name_for(from);
            let mut chosen = name.clone();
            let mut n = 2;
            while self.root.join(&chosen).exists() {
                chosen = format!("{name} {n}");
                n += 1;
            }
            move_soon(&dir.join("notebook"), &self.root.join(&chosen))?;
            for (side, name_in) in [(VERSIONS, "versions"), (COMMENTS, "comments")] {
                if !self.root.join(side).join(&chosen).exists() {
                    let _ = move_if_there(&dir.join(name_in), &self.root.join(side).join(&chosen));
                }
            }
            let _ = fs::remove_dir_all(&dir);
            return Ok(json!({ "kind": "notebook", "name": chosen }));
        }
        let (notebook, name) = page_ok(from, self.ext).ok_or("that is not in the Trash")?;
        fs::create_dir_all(self.root.join(notebook)).map_err(|e| e.to_string())?;
        let stem = name
            .strip_suffix(self.ext)
            .and_then(|s| s.strip_suffix('.'))
            .unwrap_or(name);
        let mut target = from.to_owned();
        let mut n = 2;
        while self.root.join(&target).exists()
            || self.files_folder(&target).is_some_and(|f| f.exists())
        {
            target = format!("{notebook}/{stem} {n}.{}", self.ext);
            n += 1;
        }
        move_soon(
            &dir.join(format!("page.{}", self.ext)),
            &self.root.join(&target),
        )?;
        if let Some(files) = self.files_folder(&target) {
            let _ = move_if_there(&dir.join("files"), &files);
        }
        for (name, side) in self.side_paths(&target) {
            if !side.exists() {
                let _ = move_if_there(&dir.join(name), &side);
            }
        }
        let _ = fs::remove_dir_all(&dir);
        Ok(json!({ "kind": "page", "path": target }))
    }

    /// One thing in the Trash gone for good, or (with no id) everything in it.
    ///
    /// # Errors
    /// When the id is not in the Trash.
    pub fn forget(&self, id: Option<&str>) -> Res<Value> {
        match id {
            Some(id) => {
                let (dir, _) = self.entry(id)?;
                fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
            None => {
                let root = self.deleted_root();
                if root.exists() {
                    fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(json!({ "ok": true }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Notes) {
        let dir = TempDir::new().unwrap();
        let notes = Notes::new(dir.path().join("work"), dir.path().join("store"));
        notes.create_notebook("Work").unwrap();
        notes.create_notebook("Home").unwrap();
        (dir, notes)
    }
    fn write(notes: &Notes, path: &str, text: &str) {
        fs::write(notes.root.join(path), text).unwrap();
    }
    fn read(notes: &Notes, path: &str) -> String {
        fs::read_to_string(notes.root.join(path)).unwrap()
    }

    #[test]
    fn links_are_written_again_for_where_pages_are_now() {
        let moved = |t: &str| (t == "Work/Plan.md").then(|| "Home/Plan.md".to_owned());
        // From another page: same notebook as the page now, in angle brackets, with a title.
        assert_eq!(
            relinked(
                "See [plan](Plan.md \"t\").\n",
                "Work/Brief.md",
                "Work/Brief.md",
                &moved
            )
            .unwrap(),
            "See [plan](../Home/Plan.md \"t\").\n"
        );
        assert_eq!(
            relinked(
                "[p](../Work/Plan.md)",
                "Home/Ideas.md",
                "Home/Ideas.md",
                &moved
            )
            .unwrap(),
            "[p](Plan.md)"
        );
        assert_eq!(
            relinked("[p](<../Work/Plan.md>)", "Home/A.md", "Home/A.md", &moved).unwrap(),
            "[p](<Plan.md>)"
        );
        // The moved page's own links to what it left behind.
        assert_eq!(
            relinked(
                "[b](Brief%20one.md)",
                "Work/Plan.md",
                "Home/Plan.md",
                &|_| None
            )
            .unwrap(),
            "[b](../Work/Brief%20one.md)"
        );
        // Code, pictures, the web and unchanged links stay.
        assert!(relinked("`[p](Plan.md)`\n```\n[p](Plan.md)\n```\n![p](Plan.md) [w](https://x.com/Plan.md) [o](Other.md)\n", "Work/B.md", "Work/B.md", &moved).is_none());
    }

    #[test]
    fn a_page_moves_with_its_files_comments_and_versions_and_links_follow_it() {
        let (_d, notes) = setup();
        write(
            &notes,
            "Work/Plan.md",
            "# Plan\n\n![cell](Plan%20files/cell.png) and [brief](Brief.md)\n",
        );
        write(
            &notes,
            "Work/Brief.md",
            "# Brief\n\nSee [the plan](Plan.md).\n",
        );
        write(&notes, "Home/Plan.md", "# Home plan\n");
        fs::create_dir_all(notes.root.join("Work/Plan files")).unwrap();
        write(&notes, "Work/Plan files/cell.png", "png");
        notes
            .set_comments(
                "Work/Plan.md",
                &json!([{ "id": "c1", "text": "hi", "quote": "Plan" }]),
            )
            .unwrap();
        let got = notes.move_page("Work/Plan.md", "Home").unwrap();
        // Home has a Plan already, so this one is Plan 2, and its pictures' folder and links say so.
        assert_eq!(got["path"], "Home/Plan 2.md");
        assert!(!notes.root.join("Work/Plan.md").exists());
        assert_eq!(read(&notes, "Home/Plan 2 files/cell.png"), "png");
        assert_eq!(
            read(&notes, "Home/Plan 2.md"),
            "# Plan\n\n![cell](Plan%202%20files/cell.png) and [brief](../Work/Brief.md)\n"
        );
        assert_eq!(
            read(&notes, "Work/Brief.md"),
            "# Brief\n\nSee [the plan](../Home/Plan%202.md).\n"
        );
        assert_eq!(notes.comments("Home/Plan 2.md").unwrap()[0]["id"], "c1");
        assert_eq!(read(&notes, "Home/Plan.md"), "# Home plan\n");
    }

    #[test]
    fn a_renamed_notebook_keeps_its_pages_and_links_to_them() {
        let (_d, notes) = setup();
        write(&notes, "Work/Plan.md", "# Plan\n\n[brief](Brief.md)\n");
        write(&notes, "Work/Brief.md", "# Brief\n");
        write(
            &notes,
            "Home/Ideas.md",
            "# Ideas\n\n[plan](../Work/Plan.md)\n",
        );
        assert_eq!(
            notes.rename_notebook("Work", "Kestrel").unwrap()["name"],
            "Kestrel"
        );
        assert_eq!(
            read(&notes, "Kestrel/Plan.md"),
            "# Plan\n\n[brief](Brief.md)\n"
        );
        assert_eq!(
            read(&notes, "Home/Ideas.md"),
            "# Ideas\n\n[plan](../Kestrel/Plan.md)\n"
        );
        assert!(
            notes.rename_notebook("Kestrel", "Home").is_err(),
            "a name in use is refused"
        );
        // Only the case changes: the same folder where case is not told apart.
        assert_eq!(
            notes.rename_notebook("Kestrel", "kestrel").unwrap()["name"],
            "kestrel"
        );
        assert!(notes.root.join("kestrel/Plan.md").is_file());
    }

    #[test]
    fn a_deleted_page_waits_in_the_trash_whole_and_comes_back() {
        let (_d, notes) = setup();
        write(
            &notes,
            "Work/Plan.md",
            "# Launch plan\n\n![c](Plan%20files/c.png)\n",
        );
        fs::create_dir_all(notes.root.join("Work/Plan files")).unwrap();
        write(&notes, "Work/Plan files/c.png", "png");
        notes
            .set_comments(
                "Work/Plan.md",
                &json!([{ "id": "c1", "text": "hi", "quote": "Launch" }]),
            )
            .unwrap();
        let id = notes.trash_page("Work/Plan.md").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(
            !notes.root.join("Work/Plan.md").exists()
                && !notes.root.join("Work/Plan files").exists()
        );
        // The Trash is not a notebook, and lists what was deleted.
        assert!(
            notes
                .list()
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .all(|b| b["name"] != DELETED)
        );
        let trash = notes.deleted().unwrap();
        assert_eq!(trash[0]["title"], "Launch plan");
        assert_eq!(trash[0]["from"], "Work/Plan.md");
        // A new page took the name meanwhile: the old one comes back numbered, with its own files.
        write(&notes, "Work/Plan.md", "# New\n");
        assert_eq!(notes.restore(&id).unwrap()["path"], "Work/Plan 2.md");
        assert_eq!(read(&notes, "Work/Plan 2 files/c.png"), "png");
        assert_eq!(notes.comments("Work/Plan 2.md").unwrap()[0]["id"], "c1");
        assert!(notes.deleted().unwrap().as_array().unwrap().is_empty());
        assert!(notes.restore(&id).is_err());
    }

    #[test]
    fn a_deleted_notebook_comes_back_with_its_pages_and_the_trash_forgets() {
        let (_d, notes) = setup();
        write(&notes, "Work/Plan.md", "# Plan\n");
        let id = notes.trash_notebook("Work").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(!notes.root.join("Work").exists());
        assert_eq!(notes.deleted().unwrap()[0]["pages"], 1);
        assert_eq!(notes.restore(&id).unwrap()["name"], "Work");
        assert!(notes.root.join("Work/Plan.md").is_file());
        let a = notes.trash_page("Work/Plan.md").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        notes.trash_notebook("Home").unwrap();
        notes.forget(Some(&a)).unwrap();
        assert_eq!(notes.deleted().unwrap().as_array().unwrap().len(), 1);
        notes.forget(None).unwrap();
        assert!(notes.deleted().unwrap().as_array().unwrap().is_empty());
        assert!(notes.forget(Some("../x")).is_err());
    }

    #[test]
    fn the_trash_keeps_things_thirty_days() {
        let (_d, notes) = setup();
        write(&notes, "Work/Old.md", "# Old\n");
        let id = notes.trash_page("Work/Old.md").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let file = notes.deleted_root().join(&id).join(ENTRY);
        let mut entry: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        entry["deletedMs"] = json!(now_ms() - KEEP_DELETED_MS - 1);
        fs::write(&file, entry.to_string()).unwrap();
        assert!(notes.deleted().unwrap().as_array().unwrap().is_empty());
        assert!(!notes.deleted_root().join(&id).exists());
    }
}
