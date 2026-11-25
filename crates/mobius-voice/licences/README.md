# Licences of what mobius-voice ships with

The Voice workflow (`.github/workflows/voice.yml`) publishes these beside the program and the models in each `voice-*`
prerelease, and `scripts/check-licences.mjs` checks that each one is here.

- `LICENSE-sherpa-onnx.txt`: sherpa-onnx, Apache-2.0, from https://github.com/k2-fsa/sherpa-onnx (read 2026-11-25).
- `LICENSE-whisper.txt`: Whisper by OpenAI, MIT, from https://github.com/openai/whisper (read 2026-11-25).
- `LICENSE-silero-vad.txt`: Silero VAD, MIT, from https://github.com/snakers4/silero-vad (read 2026-11-25).
- `LICENSE-onnxruntime.txt`: onnxruntime, which sherpa-onnx's library links inside it, MIT, Microsoft Corporation:
  `onnxruntime/LICENSE` from the onnxruntime 1.32.0 wheel on PyPI (https://pypi.org/project/onnxruntime/, read
  2026-11-25).
