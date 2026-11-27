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
- `LICENSE-parakeet.txt`: Parakeet TDT 0.6B v3 by NVIDIA, CC-BY-4.0, from https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3,
  as sherpa-onnx exports it int8 in `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (the model card in that archive says
  cc-by-4.0, read 2026-11-27). The licence text is SPDX's copy of the legal code; the credit Parakeet asks for is at its
  top and in Settings, Models.
- `LICENSE-pyannote.txt`: pyannote segmentation-3.0 (CNRS), MIT, from https://huggingface.co/pyannote/segmentation-3.0,
  as sherpa-onnx republishes it in `sherpa-onnx-pyannote-segmentation-3-0` (the LICENSE in that archive, read
  2026-11-27). It tells the voices in a meeting apart.
- `LICENSE-3d-speaker.txt`: 3D-Speaker's CAM++ English voice print model (`3dspeaker_speech_campplus_sv_en_voxceleb_16k`),
  Apache-2.0, from https://github.com/modelscope/3D-Speaker (its LICENSE, read 2026-11-27), as sherpa-onnx republishes
  it in its speaker-recongition-models release.
