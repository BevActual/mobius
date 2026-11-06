#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use mobius_runtime::local::scan;
use std::fs;
use std::path::Path;

fn put(root: &Path, rel: &str, bytes: usize) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, vec![0u8; bytes]).unwrap();
}
fn tmp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("mobius-local-{name}-{}", std::process::id()));
    fs::remove_dir_all(&dir).ok();
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn models_in_the_hugging_face_cache_are_found_with_their_repository() {
    let root = tmp("hf");
    put(&root, "models--unsloth--Qwen3.5-9B-GGUF/snapshots/abc123/Qwen3.5-9B-UD-Q4_K_XL.gguf", 400);
    put(&root, "models--unsloth--Qwen3.5-9B-GGUF/snapshots/abc123/mmproj-F16.gguf", 100);
    put(&root, "models--unsloth--Qwen3.5-9B-GGUF/snapshots/abc123/README.md", 5);
    put(&root, "models--unsloth--Qwen3.5-9B-GGUF/blobs/deadbeef", 400);
    let found = scan(std::slice::from_ref(&root));
    assert_eq!(found.len(), 1, "{found:?}");
    let m = &found[0];
    assert_eq!(m.repo.as_deref(), Some("unsloth/Qwen3.5-9B-GGUF"));
    assert_eq!(m.file, "Qwen3.5-9B-UD-Q4_K_XL.gguf");
    assert_eq!(m.quant.as_deref(), Some("UD-Q4_K_XL"));
    assert_eq!(m.size, 400);
    assert_eq!(m.id, "unsloth/Qwen3.5-9B-GGUF/Qwen3.5-9B-UD-Q4_K_XL.gguf");
    assert!(m.path.ends_with("Qwen3.5-9B-UD-Q4_K_XL.gguf"));
    assert!(m.projector.as_ref().unwrap().ends_with("mmproj-F16.gguf"), "the image part comes along");
    fs::remove_dir_all(root).ok();
}

#[test]
fn loose_files_in_ordinary_folders_are_found_too() {
    let root = tmp("loose");
    put(&root, "my-model-Q5_K_M.gguf", 50);
    put(&root, "sub/other-Q4_0.gguf", 70);
    put(&root, "sub/deeper/than/we/look/hidden-Q4_0.gguf", 70);
    put(&root, "empty-Q4_0.gguf", 0);
    put(&root, "notes.txt", 5);
    let mut found = scan(std::slice::from_ref(&root));
    found.sort_by(|a, b| a.file.cmp(&b.file));
    assert_eq!(found.iter().map(|m| m.file.as_str()).collect::<Vec<_>>(), ["my-model-Q5_K_M.gguf", "other-Q4_0.gguf"]);
    assert!(found[0].repo.is_none());
    assert_eq!(found[0].id, found[0].path.to_string_lossy());
    fs::remove_dir_all(root).ok();
}

#[test]
fn split_models_are_one_entry_pointing_at_the_first_part_and_only_when_complete() {
    let root = tmp("split");
    for part in 1..=3 {
        put(&root, &format!("big-Q4_K_M-0000{part}-of-00003.gguf"), 100);
    }
    put(&root, "partial-Q4_K_M-00001-of-00002.gguf", 100);
    let found = scan(std::slice::from_ref(&root));
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].size, 300);
    assert!(found[0].path.ends_with("big-Q4_K_M-00001-of-00003.gguf"));
    fs::remove_dir_all(root).ok();
}

#[test]
fn the_newest_snapshot_wins_and_missing_folders_are_fine() {
    let root = tmp("snap");
    put(&root, "models--a--b-GGUF/snapshots/old/b-Q4_K_M.gguf", 10);
    std::thread::sleep(std::time::Duration::from_millis(30));
    put(&root, "models--a--b-GGUF/snapshots/new/b-Q4_K_M.gguf", 20);
    let found = scan(&[root.clone(), root.join("does-not-exist")]);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].size, 20);
    fs::remove_dir_all(root).ok();
}

#[test]
fn the_same_folder_given_twice_does_not_list_things_twice() {
    let root = tmp("dup");
    put(&root, "m-Q4_K_M.gguf", 10);
    assert_eq!(scan(&[root.clone(), root.clone()]).len(), 1);
    fs::remove_dir_all(root).ok();
}
