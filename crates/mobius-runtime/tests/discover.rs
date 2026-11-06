#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod support;
use mobius_runtime::discover::discover;
use mobius_runtime::fit::{Fit, Hardware};
use mobius_runtime::hub::HubClient;
use support::{Resp, Server};

const GIB: u64 = 1024 * 1024 * 1024;

fn laptop() -> Hardware {
    Hardware { gpu_name: Some("RTX".into()), vram_total: 12 * GIB, vram_free: 11 * GIB, ram_total: 32 * GIB, ram_free: 20 * GIB }
}
fn tree(files: &[(&str, u64)]) -> String {
    let items: Vec<String> = files.iter().map(|(p, s)| format!(r#"{{"type":"file","path":"{p}","size":{s},"lfs":{{"oid":"x","size":{s}}}}}"#)).collect();
    format!("[{}]", items.join(","))
}
fn hub() -> Server {
    Server::start(|req| {
        let p = req.path.as_str();
        if p.starts_with("/api/models?") {
            Resp::json(r#"[
              {"id":"a/Mid-9B-GGUF","downloads":1000,"likes":1,"pipeline_tag":"text-generation","gated":false},
              {"id":"b/Big-70B-GGUF","downloads":9000,"likes":1,"pipeline_tag":"text-generation","gated":false},
              {"id":"c/Voice-GGUF","downloads":99999,"likes":1,"pipeline_tag":"text-to-speech","gated":false},
              {"id":"d/Locked-8B-GGUF","downloads":5,"likes":1,"pipeline_tag":"text-generation","gated":"manual"},
              {"id":"e/Broken-8B-GGUF","downloads":5,"likes":1,"pipeline_tag":"text-generation","gated":false},
              {"id":"a/Mid-9B-GGUF","downloads":1000,"likes":1,"pipeline_tag":"text-generation","gated":false}
            ]"#)
        } else if p.starts_with("/api/models/a/Mid-9B-GGUF/tree") {
            Resp::json(&tree(&[("Mid-9B-Q4_K_M.gguf", 5 * GIB), ("Mid-9B-Q8_0.gguf", 9 * GIB), ("Mid-9B-BF16.gguf", 18 * GIB)]))
        } else if p.starts_with("/api/models/b/Big-70B-GGUF/tree") {
            Resp::json(&tree(&[("Big-70B-Q4_K_M.gguf", 42 * GIB)]))
        } else {
            Resp::status(500, "boom")
        }
    })
}

#[test]
fn searching_gives_ranked_recommendations_for_this_computer() {
    let server = hub();
    let client = HubClient::new(&server.url()).unwrap();
    let found = discover(&client, "mid", &laptop(), 10).unwrap();
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].candidate.repo, "a/Mid-9B-GGUF");
    assert_eq!(found[0].candidate.file, "Mid-9B-Q8_0.gguf", "the best quality that fits");
    assert_eq!(found[0].assessment.fit, Fit::Gpu);
    let paths = server.paths();
    assert!(paths.iter().any(|p| p.contains("search=mid")));
    assert_eq!(paths.iter().filter(|p| p.contains("/a/Mid-9B-GGUF/tree")).count(), 1, "a repository listed twice is looked at once");
    assert!(!paths.iter().any(|p| p.contains("Voice") || p.contains("Locked")), "no time spent on models that cannot be used");
}

#[test]
fn with_no_query_trending_and_popular_lists_are_both_used() {
    let server = hub();
    let client = HubClient::new(&server.url()).unwrap();
    discover(&client, "  ", &laptop(), 10).unwrap();
    let paths = server.paths();
    assert!(paths.iter().any(|p| p.contains("sort=trendingScore")), "{paths:?}");
    assert!(paths.iter().any(|p| p.contains("sort=downloads")), "{paths:?}");
    assert!(!paths.iter().any(|p| p.contains("search=")));
}

#[test]
fn a_repository_that_cannot_be_listed_is_skipped_but_a_dead_hub_is_an_error() {
    let server = hub();
    let client = HubClient::new(&server.url()).unwrap();
    // e/Broken answers 500 for its files; the others still come through.
    assert!(discover(&client, "x", &laptop(), 10).is_ok());
    let dead = Server::start(|_| Resp::status(503, "down"));
    assert!(discover(&HubClient::new(&dead.url()).unwrap(), "x", &laptop(), 10).is_err());
    let all_broken = Server::start(|req| {
        if req.path.starts_with("/api/models?") { Resp::json(r#"[{"id":"a/M-8B-GGUF","downloads":1,"pipeline_tag":"text-generation"}]"#) } else { Resp::status(500, "no") }
    });
    assert!(discover(&HubClient::new(&all_broken.url()).unwrap(), "x", &laptop(), 10).is_err(), "nothing could be looked at");
}

#[test]
fn the_number_of_results_is_limited() {
    let server = hub();
    let client = HubClient::new(&server.url()).unwrap();
    let hardware = Hardware { vram_total: 80 * GIB, vram_free: 80 * GIB, ..laptop() };
    assert_eq!(discover(&client, "x", &hardware, 1).unwrap().len(), 1);
}
