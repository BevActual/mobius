#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod support;
use mobius_runtime::hub::{HubClient, HubError, RepoFile, RepoSummary, Sort, candidates_from, files_of_model, parse_search, parse_tree, valid_repo_id};
use support::{Resp, Server};

const GIB: u64 = 1024 * 1024 * 1024;

#[test]
fn search_results_are_read_and_unwanted_ones_flagged() {
    let json = r#"[
      {"id":"unsloth/Qwen3.5-9B-GGUF","downloads":1200,"likes":55,"pipeline_tag":"image-text-to-text","gated":false,"private":false,"tags":["gguf"]},
      {"id":"audio-cpp/audio.cpp-gguf","downloads":8000000,"likes":299,"pipeline_tag":"text-to-speech","gated":false},
      {"id":"meta/Llama-gated-GGUF","downloads":5,"likes":1,"pipeline_tag":"text-generation","gated":"manual"},
      {"id":"x/no-tag-GGUF","downloads":7},
      {"id":"bad id with spaces","downloads":1},
      {"downloads":1},
      "junk"
    ]"#;
    let repos = parse_search(json).unwrap();
    let ids: Vec<&str> = repos.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["unsloth/Qwen3.5-9B-GGUF", "audio-cpp/audio.cpp-gguf", "meta/Llama-gated-GGUF", "x/no-tag-GGUF"], "ids that are not repository names are dropped");
    assert_eq!(repos[0].downloads, 1200);
    assert_eq!(repos[0].likes, 55);
    assert!(!repos[0].gated);
    assert!(repos[2].gated, "any gating other than false counts");
    assert!(repos[0].is_text_model());
    assert!(!repos[1].is_text_model(), "a speech model is not a chat model");
    assert!(repos[3].is_text_model(), "unknown is allowed");
    assert!(parse_search("not json").is_err());
    assert!(parse_search("{}").is_err(), "a list was expected");
}

#[test]
fn repository_names_are_checked_before_they_go_into_an_address() {
    for ok in ["unsloth/Qwen3.5-9B-GGUF", "a/b", "Org_1/model.v2-GGUF"] {
        assert!(valid_repo_id(ok), "{ok}");
    }
    for bad in ["", "noslash", "a/b/c", "../etc/passwd", "a/..", "a/b?x=1", "a/b#frag", "a /b", "a/b\\c", "/b", "a/", "a/b%2f", "http://evil/x", &"a".repeat(200)] {
        assert!(!valid_repo_id(bad), "{bad}");
    }
}

#[test]
fn a_file_listing_is_read_with_sizes_and_hashes() {
    let json = r#"[
      {"type":"file","path":"Qwen3.5-9B-Q4_K_M.gguf","size":5600000000,"lfs":{"oid":"abc123","size":5600000000}},
      {"type":"file","path":"README.md","size":900},
      {"type":"directory","path":"BF16"},
      {"type":"file","path":"BF16/model-00001-of-00002.gguf","size":10000,"lfs":{"oid":"def","size":10000}},
      {"type":"file","path":"../escape.gguf","size":1},
      {"type":"file","path":"nested/../escape.gguf","size":1},
      {"type":"file","path":"C:\\x.gguf","size":1}
    ]"#;
    let files = parse_tree(json).unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["Qwen3.5-9B-Q4_K_M.gguf", "README.md", "BF16/model-00001-of-00002.gguf"], "directories and paths that climb out are dropped");
    assert_eq!(files[0].size, 5_600_000_000);
    assert_eq!(files[0].sha256.as_deref(), Some("abc123"));
    assert_eq!(files[1].sha256, None);
}

fn repo(id: &str) -> RepoSummary {
    RepoSummary { id: id.into(), downloads: 42, likes: 3, pipeline_tag: Some("text-generation".into()), gated: false }
}
fn file(path: &str, size: u64) -> RepoFile {
    RepoFile { path: path.into(), size, sha256: None }
}

#[test]
fn candidates_are_the_runnable_files_of_a_repository() {
    let files = vec![
        file("Qwen3.5-9B-Q4_K_M.gguf", 5 * GIB),
        file("Qwen3.5-9B-UD-Q8_0.gguf", 9 * GIB),
        file("mmproj-F16.gguf", GIB / 2),
        file("README.md", 10),
        file("imatrix_unsloth.gguf", 100),
    ];
    let found = candidates_from(&repo("unsloth/Qwen3.5-9B-GGUF"), &files);
    let names: Vec<&str> = found.iter().map(|c| c.file.as_str()).collect();
    assert_eq!(names, ["Qwen3.5-9B-Q4_K_M.gguf", "Qwen3.5-9B-UD-Q8_0.gguf"]);
    assert_eq!(found[1].quant, "UD-Q8_0");
    assert_eq!(found[0].params_b, Some(9.0));
    assert_eq!(found[0].downloads, 42);
    assert_eq!(found[0].repo, "unsloth/Qwen3.5-9B-GGUF");
}

#[test]
fn split_files_count_as_one_model_with_the_total_size_and_only_when_complete() {
    let files = vec![
        file("Q4_K_M/big-Q4_K_M-00001-of-00003.gguf", 10 * GIB),
        file("Q4_K_M/big-Q4_K_M-00002-of-00003.gguf", 10 * GIB),
        file("Q4_K_M/big-Q4_K_M-00003-of-00003.gguf", 5 * GIB),
        file("Q8_0/big-Q8_0-00001-of-00002.gguf", 20 * GIB),
    ];
    let found = candidates_from(&repo("x/Big-70B-GGUF"), &files);
    assert_eq!(found.len(), 1, "the Q8_0 set is missing a part");
    assert_eq!(found[0].file, "Q4_K_M/big-Q4_K_M-00001-of-00003.gguf");
    assert_eq!(found[0].size, 25 * GIB);
    assert_eq!(found[0].quant, "Q4_K_M");
}

#[test]
fn a_file_with_no_quantisation_label_is_kept_but_unlabelled() {
    let found = candidates_from(&repo("x/m-GGUF"), &[file("model.gguf", GIB)]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].quant, "");
}

#[test]
fn gated_and_non_text_repositories_give_no_candidates() {
    let mut gated = repo("x/m-GGUF");
    gated.gated = true;
    assert!(candidates_from(&gated, &[file("m-Q4_K_M.gguf", GIB)]).is_empty());
    let mut speech = repo("x/tts-GGUF");
    speech.pipeline_tag = Some("text-to-speech".into());
    assert!(candidates_from(&speech, &[file("m-Q4_K_M.gguf", GIB)]).is_empty());
}

#[test]
fn searching_asks_the_hub_with_the_query_encoded() {
    let server = Server::start(|_| Resp::json(r#"[{"id":"a/b-GGUF","downloads":1}]"#));
    let client = HubClient::new(&server.url()).unwrap();
    let found = client.search("qwen 3.5 & more/é", Sort::Downloads, 500).unwrap();
    assert_eq!(found.len(), 1);
    let path = server.paths().remove(0);
    assert!(path.starts_with("/api/models?"), "{path}");
    assert!(path.contains("search=qwen%203.5%20%26%20more%2F%C3%A9"), "{path}");
    assert!(path.contains("filter=gguf"), "{path}");
    assert!(path.contains("sort=downloads"), "{path}");
    assert!(path.contains("limit=50"), "never more than fifty at once: {path}");
    client.search("", Sort::Trending, 5).unwrap();
    let path = server.paths().remove(1);
    assert!(path.contains("sort=trendingScore") && !path.contains("search="), "{path}");
}

#[test]
fn listing_files_uses_the_tree_endpoint_and_refuses_odd_repository_names() {
    let server = Server::start(|req| {
        if req.path.starts_with("/api/models/a/b-GGUF/tree/main") { Resp::json(r#"[{"type":"file","path":"m-Q4_K_M.gguf","size":10}]"#) } else { Resp::status(404, "no") }
    });
    let client = HubClient::new(&server.url()).unwrap();
    assert_eq!(client.files("a/b-GGUF").unwrap().len(), 1);
    assert!(matches!(client.files("../../etc"), Err(HubError::BadRepo)));
    assert_eq!(server.paths().len(), 1, "the bad name never reached the network");
    assert!(matches!(client.files("a/missing"), Err(HubError::Status(404))));
}

#[test]
fn trouble_is_reported_not_followed_or_swallowed() {
    let redirect = Server::start(|_| Resp::status(302, "").with("Location", "http://127.0.0.1:1/elsewhere"));
    assert!(matches!(HubClient::new(&redirect.url()).unwrap().search("x", Sort::Downloads, 5), Err(HubError::Status(302))));
    let limited = Server::start(|_| Resp::status(429, "slow down"));
    assert!(matches!(HubClient::new(&limited.url()).unwrap().search("x", Sort::Downloads, 5), Err(HubError::Status(429))));
    let huge = Server::start(|_| Resp::bytes(200, vec![b' '; 9 * 1024 * 1024]));
    assert!(HubClient::new(&huge.url()).unwrap().search("x", Sort::Downloads, 5).is_err(), "an enormous answer is refused");
    let junk = Server::start(|_| Resp::json("<html>"));
    assert!(matches!(HubClient::new(&junk.url()).unwrap().search("x", Sort::Downloads, 5), Err(HubError::Format(_))));
    assert!(HubClient::new("ftp://x").is_err());
    assert!(HubClient::new("http://example.com").is_err(), "plain http is only for this computer");
    assert!(HubClient::new("https://huggingface.co").is_ok());
}

#[test]
fn all_the_parts_of_a_chosen_model_are_picked_from_the_listing() {
    let files = vec![
        file("README.md", 1),
        file("Q4_K_M/big-Q4_K_M-00002-of-00003.gguf", 2),
        file("Q4_K_M/big-Q4_K_M-00001-of-00003.gguf", 1),
        file("Q4_K_M/big-Q4_K_M-00003-of-00003.gguf", 3),
        file("Q8_0/big-Q8_0-00001-of-00002.gguf", 1),
        file("small-Q4_K_M.gguf", 9),
        file("mmproj-F16.gguf", 5),
    ];
    let parts = files_of_model(&files, "Q4_K_M/big-Q4_K_M-00001-of-00003.gguf").unwrap();
    assert_eq!(parts.iter().map(|p| p.path.as_str()).collect::<Vec<_>>(), ["Q4_K_M/big-Q4_K_M-00001-of-00003.gguf", "Q4_K_M/big-Q4_K_M-00002-of-00003.gguf", "Q4_K_M/big-Q4_K_M-00003-of-00003.gguf"]);
    assert_eq!(files_of_model(&files, "small-Q4_K_M.gguf").unwrap().len(), 1);
    assert!(files_of_model(&files, "Q8_0/big-Q8_0-00001-of-00002.gguf").is_none(), "a part is missing");
    assert!(files_of_model(&files, "Q4_K_M/big-Q4_K_M-00002-of-00003.gguf").is_none(), "ask for the first part");
    assert!(files_of_model(&files, "mmproj-F16.gguf").is_none(), "the image part is not a model");
    assert!(files_of_model(&files, "README.md").is_none());
    assert!(files_of_model(&files, "not-in-the-list.gguf").is_none());
}
