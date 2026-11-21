//! Renders a song file to WAV with the engine, for comparing with the window's export:
//! `cargo run -p mobius-audio --example render -- song.json out.wav`.

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let (Some(input), Some(output)) = (args.get(1), args.get(2)) else {
        return Err("usage: render <song.json> <out.wav>".to_owned());
    };
    let text = std::fs::read_to_string(input).map_err(|e| e.to_string())?;
    let song = mobius_audio::song::Song::parse(&text)?;
    let (left, right) = mobius_audio::render::render_song(&song, 44_100);
    let mut file = std::io::BufWriter::new(std::fs::File::create(output).map_err(|e| e.to_string())?);
    mobius_audio::wav::write(&mut file, &left, &right, 44_100).map_err(|e| e.to_string())
}
