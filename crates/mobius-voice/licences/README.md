# Licences of what mobius-voice ships with

The Voice workflow (`.github/workflows/voice.yml`) publishes these beside the program and the models in each `voice-*`
prerelease, and `scripts/check-licences.mjs` checks that each one is here.

- `LICENSE-sherpa-onnx.txt`: sherpa-onnx, Apache-2.0, from https://github.com/k2-fsa/sherpa-onnx (read 2026-11-25).
- `LICENSE-whisper.txt`: Whisper by OpenAI, MIT, from https://github.com/openai/whisper (read 2026-11-25).
- `LICENSE-silero-vad.txt`: Silero VAD, MIT, from https://github.com/snakers4/silero-vad (read 2026-11-25).
- onnxruntime, which sherpa-onnx's library links inside it: the workflow fetches its `LICENSE` from
  https://github.com/microsoft/onnxruntime when it publishes, and stops unless it is the MIT licence.
