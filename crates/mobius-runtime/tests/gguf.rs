#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use mobius_runtime::gguf::{FileKind, classify, parse_quant, parse_shard, params_from_name, quality, bits_per_weight};

#[test]
fn quantisation_is_read_from_common_file_names() {
    let cases = [
        ("Qwen3.5-9B-Q4_K_M.gguf", "Q4_K_M"),
        ("Qwen3.5-9B-UD-Q4_K_XL.gguf", "UD-Q4_K_XL"),
        ("gemma-3-12b-it-IQ4_XS.gguf", "IQ4_XS"),
        ("llama-3.1-8b-instruct.Q8_0.gguf", "Q8_0"),
        ("Qwen3.5-9B-BF16.gguf", "BF16"),
        ("model-f16.gguf", "F16"),
        ("gpt-oss-20b-MXFP4.gguf", "MXFP4"),
        ("phi-4-Q2_K.gguf", "Q2_K"),
        ("tiny-Q3_K_S.gguf", "Q3_K_S"),
        ("Q6_K/model-00001-of-00002.gguf", "Q6_K"),
    ];
    for (name, expected) in cases {
        assert_eq!(parse_quant(name).as_deref(), Some(expected), "{name}");
    }
    for name in ["README.md", "model.gguf", "Qwen3-Q9.gguf", ""] {
        assert_eq!(parse_quant(name), None, "{name}");
    }
}

#[test]
fn model_names_are_not_mistaken_for_quantisations() {
    // "Qwen3" and "Q4" inside other words are not quantisation labels.
    assert_eq!(parse_quant("Qwen3-4B-Instruct-Q5_K_M.gguf").as_deref(), Some("Q5_K_M"));
    assert_eq!(parse_quant("Mixtral-8x7B-v0.1.gguf"), None);
}

#[test]
fn split_files_are_recognised() {
    assert_eq!(parse_shard("model-Q4_K_M-00002-of-00005.gguf"), Some((2, 5)));
    assert_eq!(parse_shard("Q8_0/Qwen-00001-of-00003.gguf"), Some((1, 3)));
    assert_eq!(parse_shard("model-Q4_K_M.gguf"), None);
    assert_eq!(parse_shard("model-00000-of-00003.gguf"), None, "numbering starts at one");
    assert_eq!(parse_shard("model-00004-of-00003.gguf"), None, "a part cannot be beyond the total");
}

#[test]
fn files_are_sorted_into_models_projectors_and_other() {
    assert_eq!(classify("Qwen3.5-9B-UD-Q4_K_XL.gguf"), FileKind::Model);
    assert_eq!(classify("mmproj-F16.gguf"), FileKind::Projector);
    assert_eq!(classify("MMPROJ-BF16.gguf"), FileKind::Projector);
    assert_eq!(classify("Qwen-mmproj-f32.gguf"), FileKind::Projector);
    assert_eq!(classify("imatrix_unsloth.gguf_file"), FileKind::Other);
    assert_eq!(classify("README.md"), FileKind::Other);
    assert_eq!(classify("model.safetensors"), FileKind::Other);
    assert_eq!(classify("BF16/model-00001-of-00002.gguf"), FileKind::Model);
}

#[test]
fn parameter_counts_come_from_the_name_when_there_is_one() {
    assert_eq!(params_from_name("unsloth/Qwen3.5-9B-GGUF"), Some(9.0));
    assert_eq!(params_from_name("bartowski/Llama-3.2-1B-Instruct-GGUF"), Some(1.0));
    assert_eq!(params_from_name("x/Mixtral-8x7B-Instruct-GGUF"), Some(56.0));
    assert_eq!(params_from_name("x/gemma-3-270m-it-GGUF"), Some(0.27));
    assert_eq!(params_from_name("x/Qwen3-30B-A3B-GGUF"), Some(30.0), "total, not the active part");
    assert_eq!(params_from_name("x/SmolLM2-1.7B-GGUF"), Some(1.7));
    assert_eq!(params_from_name("x/some-model-GGUF"), None);
    assert_eq!(params_from_name("x/model-v2-GGUF"), None);
}

#[test]
fn bigger_precision_means_more_bits_and_higher_quality() {
    let order = ["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"];
    for pair in order.windows(2) {
        assert!(bits_per_weight(pair[0]) < bits_per_weight(pair[1]), "{pair:?}");
        assert!(quality(pair[0]) < quality(pair[1]), "{pair:?}");
    }
    assert!(quality("UD-Q4_K_XL") >= quality("Q4_K_M"), "dynamic quants are at least as good");
    assert!(quality("Q4_K_M") > quality("IQ3_XS"));
    assert!(quality("nonsense") > 0.0 && quality("nonsense") < quality("Q4_K_M"), "an unknown label is not trusted");
    assert!(quality("BF16") <= 1.0);
}

#[test]
fn helper_files_that_are_not_models_in_their_own_right_are_left_out() {
    for name in [
        "Qwen3.8-27B-Uncensored-draft-Q8_0.gguf",
        "MTP/mtp-Qwen3.8-27B-Q4_0.gguf",
        "dflash-Qwen3.8-27B-BF16.gguf",
        "model-eagle3-Q4_K_M.gguf",
        "medusa-heads-F16.gguf",
        "my-lora-adapter-F16.gguf",
        "ggml-vocab-llama.gguf",
        "adapters/style-Q8_0.gguf",
    ] {
        assert_eq!(classify(name), FileKind::Other, "{name}");
    }
    for name in ["Qwen3.5-9B-Q4_K_M.gguf", "drafting-assistant-7B-Q4_K_M.gguf", "Llama-3.1-8B-Instruct-Q4_K_M.gguf"] {
        assert_eq!(classify(name), FileKind::Model, "{name}: a word that merely starts with a helper name is a model");
    }
}
