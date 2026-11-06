#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use mobius_runtime::hardware::parse_nvidia_smi;

const GIB: u64 = 1024 * 1024 * 1024;

#[test]
fn nvidia_smi_output_is_read_in_bytes() {
    let gpu = parse_nvidia_smi("NVIDIA GeForce RTX 4080 Laptop GPU, 12282, 11337\r\n").unwrap();
    assert_eq!(gpu.name, "NVIDIA GeForce RTX 4080 Laptop GPU");
    assert_eq!(gpu.total, 12282 * 1024 * 1024);
    assert_eq!(gpu.free, 11337 * 1024 * 1024);
    assert!(gpu.total > 11 * GIB);
}

#[test]
fn with_several_gpus_the_one_with_the_most_free_memory_is_used() {
    let gpu = parse_nvidia_smi("Small, 4096, 1000\nBig, 24564, 20000\nMiddle, 8192, 8000\n").unwrap();
    assert_eq!(gpu.name, "Big");
}

#[test]
fn names_may_contain_commas_and_odd_lines_are_skipped() {
    let gpu = parse_nvidia_smi("garbage\n\nNVIDIA A, B Edition, 8192, 8000\nnot, numbers, here\n").unwrap();
    assert_eq!(gpu.name, "NVIDIA A, B Edition");
}

#[test]
fn no_usable_output_means_no_gpu() {
    for text in ["", "\n", "No devices were found", "name, total, free", "x, -5, 3", "x, 100, 200"] {
        assert!(parse_nvidia_smi(text).is_none(), "{text:?}");
    }
}
