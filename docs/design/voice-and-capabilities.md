# Voice, audio and capabilities: ElevenLabs-style features on your own computer

Status: proposal (2026-11-26). What gets built, and in what order, is Andrew's call. Replaces the cloud-first ideas in
[elevenlabs-ideas.md](../reference/elevenlabs-ideas.md); builds on [voice-plan.md](../reference/voice-plan.md).

## The short version

Most of what ElevenLabs sells can run on the person's own computer from open models whose code **and** weights allow
an MIT app to ship them. Almost all of it runs inside the **sherpa-onnx** library Mobius already ships in
`crates/mobius-voice`, with no Python and no GPU required: speaking, transcribing with speaker labels, live
turn-taking, noise removal and music stems. Two things need a GPU and an optional add-on: **cloning a voice** and
**making music**. Sound effects and dubbing-quality translation have no model we can ship yet.

To make this make sense in Settings, voice and audio stop being special cases: every job Mobius can do with a model
(chat, quick answers, pictures, listening, speaking, cleaning audio, and so on) becomes a **capability**, and each
capability picks where it runs: **On this computer**, **A server you run**, or **A service you have a key for**. One
router in the core makes that choice for every capability, and **Best fit** in the message box is its face.

Recommended first round: **read aloud with Kokoro on this computer, better transcription with Parakeet and speaker
labels, and the Capabilities page in Settings** that those two land in.

## What Mobius has today

- `crates/mobius-voice`: a separate program on sherpa-onnx `=2.0.3` (Apache-2.0) with Whisper base.en / small.en and
  Silero VAD, downloaded from the `voice-0.1.0` prerelease and pinned by SHA-256 (`voice_local.rs`). It is the
  default listener on new installs.
- Listening also through the chat model's server (OpenAI format), a speech server you run (faster-whisper/Speaches),
  or ElevenLabs Scribe. Speaking through a Kokoro server you run, or ElevenLabs. Defaults and fallbacks in
  `preferences.rs` (`listenWith`, `speakWith`, and their fallbacks).
- Microphone capture in the window, hold-to-talk (Ctrl+Shift+Space), dictation, meeting recording in Notes.
- `crates/mobius-audio` (cpal) and the Rust music engine, which can play and render audio.
- Settings: **Gateways** (keys, plans, local servers), **Models › Defaults** (Chat, Second, Quick, Images, Listen,
  Speak, Effort), **Models › This computer** (llama.cpp setup), **Voice** (Listening, Speaking).

A useful finding: sherpa-onnx 2.0.0 removed espeak-ng and piper-phonemize (its CHANGELOG, "#4055"). espeak-ng is
GPL-3.0, so the version we pin no longer brings GPL code in with its text-to-speech.

## What each ElevenLabs feature becomes

Licences read from each project's own LICENSE file and model card on 2026-11-26. "Ships" means Mobius may download
and run it. Sizes are published figures where given, otherwise estimates (marked ~). Speeds marked "claim" are the
project's own; none were measured on Andrew's PC yet, which is part of each round's work.

| ElevenLabs feature | Open model to use | Code / weights licence | Size | No GPU? | Runs in |
| --- | --- | --- | --- | --- | --- |
| Text to speech | **Kokoro-82M** | Apache-2.0 / Apache-2.0 | 82M; 92 MB int8 ONNX | Yes | sherpa-onnx |
| Text to speech, tiny | **Kitten TTS nano 0.2** | Apache-2.0 / Apache-2.0 | 15M; under 25 MB | Yes | sherpa-onnx |
| Speech to text, accurate | **Parakeet TDT 0.6B v3** (25 European languages) | Apache-2.0 / CC-BY-4.0 | 0.6B (download to measure) | Yes (~) | sherpa-onnx |
| Speech to text, live | **Moonshine Streaming** small or medium (English) | MIT / MIT | 123M / 245M | Yes | sherpa-onnx |
| Speech to text, more languages | Whisper large-v3-turbo (already the family we ship) | MIT / MIT | 809M | Slow live; fine for files | sherpa-onnx |
| Speech translation | **Canary 1B v2** (English to and from 24 languages) | Apache-2.0 / CC-BY-4.0 | 978M | Slow (~) | sherpa-onnx |
| Who said what | **pyannote segmentation-3.0** (sherpa-onnx's copy) + **3D-Speaker** or **TitaNet** embeddings | MIT / MIT; Apache-2.0; CC-BY-4.0 | ~6 MB + 7–30 MB | Yes | sherpa-onnx |
| Knowing when you've finished talking | **Silero VAD** (shipped) + **Smart Turn v3** | MIT; BSD-2-Clause | 2 MB; 8 MB int8 | Yes ("10 ms", claim) | sherpa-onnx; ONNX Runtime |
| Voice isolator / noise removal | **DeepFilterNet 3** (live mic), **GTCRN** (light) | MIT or Apache-2.0; MIT | small | Yes | Rust crate; sherpa-onnx |
| Music stems | **Spleeter** | MIT / MIT | small | Yes (offline) | sherpa-onnx |
| Voice cloning | **Chatterbox-Turbo** (watermarks every clip) | MIT / MIT | 350M | No | GPU add-on (Python) |
| Voice changer | **OpenVoice V2** tone converter | MIT / MIT | small | Likely | add-on |
| Music | **ACE-Step 1.5** | MIT / MIT | under 4 GB VRAM | No | GPU add-on (Python) |
| Text translation for dubbing | **Opus-MT** per language pair; **MADLAD-400 3B** for rare ones | CC-BY-4.0; Apache-2.0 | ~75M per pair; 3B | Yes (Opus-MT) | ONNX (to confirm) |
| Sound effects | none we can ship | | | | |

**Not shippable** (non-commercial, GPL/AGPL, gated, or unclear): F5-TTS (weights CC-BY-NC), Coqui XTTS-v2 (Coqui Public
Model License), Orpheus (gated, Llama base), Seed-VC (GPL-3.0), Piper's engine (now GPL-3.0 in OHF-Voice/piper1-gpl;
only voices listed in its COMMERCIAL_USE.md are safe, through sherpa-onnx), DiariZen (CC-BY-NC), pyannote
community-1 (gated), the LiveKit turn detector (may only be used with LiveKit Agents), MusicGen (CC-BY-NC), Stable
Audio Open (gated, revenue cap), AudioLDM2 and Tango (non-commercial), SeamlessM4T/Expressive and NLLB
(non-commercial), Demucs weights (its README says their licence "is not clear"), community Roformer/MDX checkpoints
(unverified). `scripts/check-licences.mjs` should get a list of these so they can't slip in.

**Attribution:** CC-BY-4.0 weights (Parakeet, Canary, TitaNet) need credit. They go in `crates/mobius-voice/licences/`
beside the others and in **Settings › About**.

### How it runs

- **Everything in the "sherpa-onnx" rows** goes into the `mobius-voice` program we already build, sign and download.
  Each model downloads on first use, pinned by SHA-256, the same way Whisper does now. The program grows new commands
  (`speak`, `diarize`, `denoise`, `separate`, `stream`); nothing new is installed for the person.
- **The GPU add-on** (cloning, music) is a separate, optional download offered only on a computer with a supported
  graphics card, after saying how big it is (several GB with its runtime). It runs as a local server the same way
  llama.cpp does under Models › This computer, and stops when idle. It is the one place Python is needed; if we later
  find ONNX builds of Chatterbox and ACE-Step, it folds into `mobius-voice`.
- **On Andrew's PC** (RTX 4080 laptop, 12 GB; 32 GB RAM) all of it fits, one large model at a time. On a computer
  without a GPU, everything except cloning and music runs; Kitten replaces Kokoro and Moonshine small replaces
  Parakeet when the computer is slow (decided by the same hardware check llama.cpp setup uses).

### Rules that come with it

- **Cloning needs consent.** Only your own voice: Mobius asks you to read a consent sentence aloud and keeps that
  clip with the voice. Every cloned clip carries Chatterbox's watermark. Cloning is never offered to the agent as a
  tool it can use on its own.
- **Audio is data, not instructions**, as with web pages and mail: words heard in a file or a call never become a
  request to Mobius.
- **Nothing leaves the computer** unless a capability is set to a service; then the capability says so where it is
  chosen and where it runs (a small "Sent to …" note), as Privacy already does for chat.

## Settings: capabilities, not scattered model rows

### Today

```
Connections
  Accounts            Accounts · Model Plans · Connectors
  Gateways            plans you sign in to, API keys, local servers (Ollama, LM Studio, llama.cpp, custom)
Models
  Models              Defaults: Chat, Second, Quick, Images, Listen, Speak, Effort
                      This computer: llama.cpp setup, find and download models
  Voice               Listening (service, fallback, model)  ·  Speaking (service, voice, fallback, read aloud)
  Usage
```

Three places decide what runs where (Defaults, This computer, Voice), and each new job (cleaning audio, music,
translation) would need a fourth. Listen and Speak are in Defaults **and** Voice. Local voice models live in Voice,
local chat models in This computer.

### Proposed

```
Connections
  Accounts            (unchanged)
  Gateways            where models can come from: plans, keys, servers you run, and "This computer"
Models
  Capabilities        one row per capability, each with where it runs and a fallback  <- new home
  This computer       every local model, chat and voice alike: hardware, set up, download, remove
  Usage               (unchanged, now counted per capability too)
```

**Capabilities** is the one page that answers "what does what". Each row is a capability, with a picker that lists
the places it can run, grouped the same way everywhere:

| Capability | What it does | Default | Can also run on |
| --- | --- | --- | --- |
| Chat | Mobius's answers and work | (your choice at setup) | plans, keys, a server you run, This computer |
| Second model | When the first can't answer | off | same |
| Quick | Short questions and checks (Best fit) | off | same |
| Pictures | Makes images | off | keys |
| Listen | Dictation and meetings | This computer (Whisper, Parakeet) | a server you run, keys |
| Speak | Read aloud | This computer (Kokoro) | a server you run, keys |
| Live voice | Talk and be answered | built from Listen + Chat + Speak | |
| Clean up audio | Noise removal, voice isolation | This computer (DeepFilterNet) | |
| Separate stems | Music app | This computer (Spleeter) | |
| Your voice | Cloning, with consent | off; needs the GPU add-on | keys |
| Music | Generate music | off; needs the GPU add-on | keys |
| Translate | Text and speech | This computer (Opus-MT, Canary) | keys |

- Each picker's choices are labelled **On this computer** (with the model's size and whether it is downloaded),
  **A server you run** (any OpenAI-compatible address, Ollama, LM Studio, llama.cpp; Wyoming for voice later), and
  **Your keys** (only services with a key or plan in Gateways). A choice that sends data off the computer says so.
- Choosing an "On this computer" model that isn't downloaded offers the download in place, with its size.
- **Voice** stops being its own section: Listening and Speaking become the Listen and Speak rows, and their extra
  options (read replies aloud, hold-to-talk key, voice name) open from the row. Search still finds "voice",
  "dictation" and "read aloud".
- **Gateways** stays the one place to add a service, so a key is never asked for twice. It gains an **On this
  computer** entry that links to Models › This computer.

### The router

Today each capability has its own code path: the chat model and its fallback in `mobius-agent` (`fallback.rs`), the
quick model and Best fit in the composer (`bestFitQuick`), pictures in their own setting, and `listen()` /
`speak()` in `bridge.rs` with their own `…With` and fallback fields.

Proposed: **one router in the core** that every capability asks.

- It reads one setting per capability: `{ capability: { use: <place>, model, fallback: <place> } }`, migrated from
  today's fields (`listenWith`, `speakWith`, `imageModel`, the quick and second models) so nothing an existing install
  chose changes.
- It knows each place's abilities (a gateway's models, a local model's kind), so a picker only offers what can do
  that capability, and the router never sends a job somewhere that can't do it (today's "the chat server can't
  listen" error goes away).
- It handles fallback the same way for every capability (`should_fall_back` in `fallback.rs` becomes shared), and
  records each call against its capability for Usage.
- **Best fit** becomes "let the router choose": short questions to Quick, the rest to Chat, and later, with the
  person's yes, cheaper or local places for jobs that don't need the best model. The message box's model menu keeps
  showing the place it picked, and each reply still names the model that wrote it.

This is mostly moving and renaming what exists, done in small PRs with the old settings migrated, not a rewrite.

## Recommended rounds

1. **Read aloud and the Capabilities page.** Kokoro (and Kitten for slow computers) in `mobius-voice` as the
   default **Speak** on this computer; a **Listen** button in Notes, Docs, Mail and Reader. Settings gets the
   Capabilities page with Chat, Second, Quick, Pictures, Listen and Speak rows, and Voice folds into it. The router
   starts with Listen and Speak.
2. **Better transcription.** Parakeet v3 as the accurate local listener, speaker labels in meeting notes (pyannote
   segmentation + 3D-Speaker), Moonshine for live captions. Chat, Second and Quick move onto the router.
3. **Live voice.** Talk to Mobius hands-free: Silero VAD + Smart Turn v3 decide when you have finished, the reply
   is spoken and you can interrupt it. All the usual approvals still appear on screen.
4. **Clean-up tools.** Clean up a recording (DeepFilterNet, GTCRN) in Notes and Video; separate stems (Spleeter)
   in Music.
5. **GPU add-on** (only if Andrew wants it): your own voice with consent (Chatterbox-Turbo), and music sketches in the
   Music app (ACE-Step 1.5), landing as dashed clips to Keep or Discard.
6. **Dubbing**, built from rounds 2, 4 and 5 plus Opus-MT/Canary, once those are solid.

Each round measures speed and memory on Andrew's PC and on a computer without a GPU, and adds its models to the
licence list.

## Decisions for Andrew

1. Go ahead with the Capabilities page and the router, folding Voice into it?
2. Is an optional GPU add-on with Python acceptable for cloning and music, or should those wait for ONNX builds?
3. Should read aloud be on by default (the button is there; nothing speaks until pressed) once Kokoro is local?

## Sources (read 2026-11-26)

- Kokoro: huggingface.co/hexgrad/Kokoro-82M, huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX. Kitten:
  huggingface.co/KittenML/kitten-tts-nano-0.2.
- Parakeet v3: huggingface.co/nvidia/parakeet-tdt-0.6b-v3. Canary: huggingface.co/nvidia/canary-1b-v2. Moonshine:
  huggingface.co/UsefulSensors/moonshine-streaming-medium, github.com/moonshine-ai/moonshine (LICENSE).
- pyannote: github.com/pyannote/pyannote-audio, huggingface.co/pyannote/segmentation-3.0. 3D-Speaker:
  github.com/modelscope/3D-Speaker. TitaNet: huggingface.co/nvidia/speakerverification_en_titanet_large. DiariZen:
  huggingface.co/BUT-FIT/diarizen-wavlm-large-s80-md.
- Smart Turn v3: huggingface.co/pipecat-ai/smart-turn-v3. LiveKit: huggingface.co/livekit/turn-detector. Silero VAD:
  github.com/snakers4/silero-vad.
- DeepFilterNet: github.com/Rikorose/DeepFilterNet. GTCRN: github.com/Xiaobin-Rong/gtcrn. RNNoise:
  github.com/xiph/rnnoise. Spleeter: github.com/deezer/spleeter. Demucs: github.com/adefossez/demucs.
- Chatterbox: huggingface.co/ResembleAI/chatterbox, huggingface.co/ResembleAI/chatterbox-turbo. OpenVoice:
  huggingface.co/myshell-ai/OpenVoiceV2. F5-TTS: huggingface.co/SWivid/F5-TTS. XTTS: huggingface.co/coqui/XTTS-v2.
  Seed-VC: github.com/Plachtaa/seed-vc. Piper: github.com/OHF-Voice/piper1-gpl (COPYING, LICENSING.md,
  docs/COMMERCIAL_USE.md).
- ACE-Step 1.5: github.com/ACE-Step/ACE-Step-1.5. MusicGen: huggingface.co/facebook/musicgen-small. Stable Audio
  Open: huggingface.co/stabilityai/stable-audio-open-1.0. AudioLDM2: huggingface.co/cvssp/audioldm2. Tango:
  huggingface.co/declare-lab/tango2.
- Seamless: github.com/facebookresearch/seamless_communication. NLLB: huggingface.co/facebook/nllb-200-distilled-600M.
  MADLAD: huggingface.co/google/madlad400-3b-mt. Opus-MT: huggingface.co/Helsinki-NLP/opus-mt-en-de.
- sherpa-onnx: github.com/k2-fsa/sherpa-onnx (CHANGELOG 2.0.0, 2.0.3), k2-fsa.github.io/sherpa/onnx.
