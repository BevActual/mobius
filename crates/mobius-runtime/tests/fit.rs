#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use mobius_runtime::fit::{Assessment, Candidate, Fit, Hardware, assess, recommend};

const GIB: u64 = 1024 * 1024 * 1024;

fn laptop() -> Hardware {
    Hardware { gpu_name: Some("RTX 4080 Laptop".into()), vram_total: 12 * GIB, vram_free: 11 * GIB, ram_total: 32 * GIB, ram_free: 20 * GIB }
}
fn candidate(repo: &str, file: &str, quant: &str, gib: f64, params: Option<f64>, downloads: u64) -> Candidate {
    Candidate { repo: repo.into(), file: file.into(), quant: quant.into(), size: (gib * GIB as f64) as u64, params_b: params, downloads, likes: 0 }
}

#[test]
fn a_model_that_fits_the_graphics_memory_runs_on_it() {
    let a = assess(5 * GIB, &laptop());
    assert_eq!(a.fit, Fit::Gpu);
    assert!(a.needed >= 5 * GIB, "room for more than the weights");
    assert!(a.needed <= 7 * GIB);
}

#[test]
fn a_model_too_big_for_the_gpu_but_fine_for_memory_is_split() {
    let a = assess(18 * GIB, &laptop());
    assert_eq!(a.fit, Fit::Split);
    assert!(a.gpu_fraction > 0.3 && a.gpu_fraction < 0.7, "{}", a.gpu_fraction);
}

#[test]
fn a_model_that_fits_nowhere_is_too_big() {
    assert_eq!(assess(60 * GIB, &laptop()).fit, Fit::TooBig);
    assert_eq!(assess(0, &laptop()).fit, Fit::TooBig, "an empty file is not a model");
}

#[test]
fn without_a_gpu_everything_is_slow_but_possible_up_to_memory() {
    let cpu = Hardware { gpu_name: None, vram_total: 0, vram_free: 0, ram_total: 16 * GIB, ram_free: 10 * GIB };
    let a = assess(4 * GIB, &cpu);
    assert_eq!(a.fit, Fit::Cpu);
    assert_eq!(assess(12 * GIB, &cpu).fit, Fit::TooBig);
}

#[test]
fn the_edge_of_the_graphics_memory_is_respected() {
    let hw = laptop();
    let weights = 9 * GIB;
    let just_fits = assess(weights, &hw);
    let smaller_card = Hardware { vram_free: just_fits.needed - 1, ..hw.clone() };
    assert_eq!(just_fits.fit, Fit::Gpu);
    assert_eq!(assess(weights, &smaller_card).fit, Fit::Split);
}

#[test]
fn the_recommendation_is_the_best_model_that_fits_entirely_on_the_gpu() {
    let hw = laptop();
    let picks = recommend(
        vec![
            candidate("a/Tiny-1B-GGUF", "t-Q8_0.gguf", "Q8_0", 1.1, Some(1.0), 9_000_000),
            candidate("b/Mid-9B-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 5.6, Some(9.0), 100_000),
            candidate("c/Big-70B-GGUF", "b-Q4_K_M.gguf", "Q4_K_M", 42.0, Some(70.0), 5_000_000),
            candidate("d/Large-32B-GGUF", "l-Q4_K_M.gguf", "Q4_K_M", 19.0, Some(32.0), 300_000),
        ],
        &hw,
        10,
    );
    let names: Vec<&str> = picks.iter().map(|p| p.candidate.repo.as_str()).collect();
    assert_eq!(names[0], "b/Mid-9B-GGUF", "{names:?}");
    assert_eq!(picks[0].assessment.fit, Fit::Gpu);
    assert!(names.contains(&"d/Large-32B-GGUF"));
    assert!(!names.contains(&"c/Big-70B-GGUF"), "something that cannot run is not recommended");
    assert!(picks.windows(2).all(|w| fit_rank(&w[0].assessment) <= fit_rank(&w[1].assessment)), "everything that fits on the GPU comes before anything slower");
}

fn fit_rank(a: &Assessment) -> u8 {
    match a.fit { Fit::Gpu => 0, Fit::Split => 1, Fit::Cpu => 2, Fit::TooBig => 3 }
}

#[test]
fn one_model_is_listed_once_with_the_best_file_for_this_computer() {
    let picks = recommend(
        vec![
            candidate("b/Mid-9B-GGUF", "m-Q2_K.gguf", "Q2_K", 3.4, Some(9.0), 10),
            candidate("b/Mid-9B-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 5.6, Some(9.0), 10),
            candidate("b/Mid-9B-GGUF", "m-Q8_0.gguf", "Q8_0", 9.2, Some(9.0), 10),
            candidate("b/Mid-9B-GGUF", "m-BF16.gguf", "BF16", 17.9, Some(9.0), 10),
        ],
        &laptop(),
        10,
    );
    assert_eq!(picks.len(), 1);
    assert_eq!(picks[0].candidate.file, "m-Q8_0.gguf", "the best quality that still fits the GPU");
}

#[test]
fn a_larger_model_at_a_sensible_quant_beats_a_smaller_one_at_full_precision() {
    let picks = recommend(
        vec![
            candidate("a/Small-4B-GGUF", "s-BF16.gguf", "BF16", 8.0, Some(4.0), 1_000_000),
            candidate("b/Mid-9B-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 5.6, Some(9.0), 1_000),
        ],
        &laptop(),
        10,
    );
    assert_eq!(picks[0].candidate.repo, "b/Mid-9B-GGUF");
}

#[test]
fn popularity_breaks_ties_and_the_list_is_limited() {
    let picks = recommend(
        vec![
            candidate("a/A-8B-GGUF", "a-Q4_K_M.gguf", "Q4_K_M", 5.0, Some(8.0), 10),
            candidate("b/B-8B-GGUF", "b-Q4_K_M.gguf", "Q4_K_M", 5.0, Some(8.0), 5_000_000),
            candidate("c/C-8B-GGUF", "c-Q4_K_M.gguf", "Q4_K_M", 5.0, Some(8.0), 500),
        ],
        &laptop(),
        2,
    );
    assert_eq!(picks.iter().map(|p| p.candidate.repo.as_str()).collect::<Vec<_>>(), ["b/B-8B-GGUF", "c/C-8B-GGUF"]);
}

#[test]
fn a_missing_parameter_count_is_estimated_from_the_file() {
    let picks = recommend(vec![candidate("x/mystery-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 4.9, None, 100)], &laptop(), 5);
    let params = picks[0].params_b;
    assert!((7.0..=10.0).contains(&params), "{params}");
}

#[test]
fn nothing_to_recommend_gives_an_empty_list() {
    assert!(recommend(vec![], &laptop(), 5).is_empty());
    assert!(recommend(vec![candidate("c/Big-70B-GGUF", "b.gguf", "Q4_K_M", 42.0, Some(70.0), 1)], &laptop(), 5).is_empty());
}

#[test]
fn a_file_far_smaller_than_its_name_claims_is_judged_by_its_size() {
    // A 3.6 GiB file in a "27B" repository at "BF16" cannot be 27 billion parameters at 16 bits.
    let picks = recommend(
        vec![
            candidate("x/Huge-27B-GGUF", "helper-BF16.gguf", "BF16", 3.6, Some(27.0), 5_000_000),
            candidate("b/Mid-9B-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 5.6, Some(9.0), 100),
        ],
        &laptop(),
        10,
    );
    assert_eq!(picks[0].candidate.repo, "b/Mid-9B-GGUF", "{:?}", picks.iter().map(|p| (&p.candidate.repo, p.params_b)).collect::<Vec<_>>());
    let helper = picks.iter().find(|p| p.candidate.repo == "x/Huge-27B-GGUF").unwrap();
    assert!(helper.params_b < 3.0, "{}", helper.params_b);
}

#[test]
fn a_file_with_no_quantisation_label_is_judged_by_how_many_bits_it_really_has() {
    // 27B parameters in 6.7 GiB is about two bits each: far from a good model, however big the name.
    let picks = recommend(
        vec![
            candidate("t/Ternary-27B-GGUF", "t.gguf", "", 6.7, Some(27.0), 100),
            candidate("b/Mid-9B-GGUF", "m-Q8_0.gguf", "Q8_0", 9.2, Some(9.0), 100),
        ],
        &laptop(),
        10,
    );
    assert_eq!(picks[0].candidate.repo, "b/Mid-9B-GGUF");
    let ternary = picks.iter().find(|p| p.candidate.repo == "t/Ternary-27B-GGUF").unwrap();
    assert_eq!(ternary.params_b, 27.0, "the name is believed when the size is plausible");
}

#[test]
fn a_size_that_agrees_with_the_name_keeps_the_name() {
    let picks = recommend(vec![candidate("b/Mid-9B-GGUF", "m-Q4_K_M.gguf", "Q4_K_M", 5.6, Some(9.0), 100)], &laptop(), 10);
    assert_eq!(picks[0].params_b, 9.0);
}
