# Licences of what mobius-voice ships with

The Voice workflow (`.github/workflows/voice.yml`) publishes these beside the program and the models in each `voice-*`
prerelease, and `scripts/check-licences.mjs` checks that each one is here.

- `LICENSE-sherpa-onnx.txt`: sherpa-onnx, Apache-2.0, from https://github.com/k2-fsa/sherpa-onnx (read 2026-11-25).
- `LICENSE-whisper.txt`: Whisper by OpenAI, MIT, from https://github.com/openai/whisper (read 2026-11-25).
- `LICENSE-silero-vad.txt`: Silero VAD, MIT, from https://github.com/snakers4/silero-vad (read 2026-11-25).
- `LICENSE-onnxruntime.txt`: onnxruntime, which sherpa-onnx's library links inside it, MIT, Microsoft Corporation:
  `onnxruntime/LICENSE` from the onnxruntime 1.32.0 wheel on PyPI (https://pypi.org/project/onnxruntime/, read
  2026-11-25).
- `LICENSE-kokoro.txt`: Kokoro-82M v1.0 by hexgrad, Apache-2.0, from https://huggingface.co/hexgrad/Kokoro-82M, as
  sherpa-onnx republishes it int8 in `kokoro-int8-multi-lang-v1_0` (the LICENSE in that archive, read 2026-11-26).
- `LICENSE-misaki.txt`: misaki's English word lists (`lexicon-us-en.txt`, `lexicon-gb-en.txt`) by hexgrad, Apache-2.0,
  from https://github.com/hexgrad/misaki, in the same archive (read 2026-11-26). Kitten TTS is not shipped: its
  phonemes need espeak-ng (GPL-3.0).
