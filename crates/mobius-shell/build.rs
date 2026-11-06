fn main() {
    // Tauri embeds the interface at compile time. If it has not been built yet, an empty folder keeps the rest of the
    // workspace compiling; `npm run build:tauri -w @mobius/desktop` fills it.
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/dist/tauri");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(&dist);
        let _ = std::fs::write(dist.join("index.html"), "<!doctype html><title>Mobius</title><p>Interface not built yet.");
    }
    tauri_build::build();
}
