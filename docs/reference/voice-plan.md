# Voice plan: free on-device default, two-track meetings

Status: building (Nov 25, 2026). PR A is in two parts: A1 adds `crates/mobius-voice`, a program of its own that
writes down a recording with Whisper and Silero VAD, and `.github/workflows/voice.yml`, which builds, signs and
publishes it. A2 pins what A1's workflow publishes and adds the `device` listener, the downloads and Settings.

A2 (`crates/mobius-host/src/voice_local.rs`): the host downloads the program and the chosen model (base.en, about
161 MB, or small.en, about 376 MB) from the `voice-0.1.0` prerelease, checks each against its pinned SHA-256, runs the
program while it's used and stops it after five idle minutes. The window converts recordings to 16 kHz WAV when the
host asks for one. A new install listens with `device` first and the chat model's server as its fallback; an install
already in use keeps its choice.

B and C (`crates/mobius-audio/src/meeting.rs`, `crates/mobius-host/src/meeting.rs`): a meeting is heard by the host,
not the window, in 16 kHz parts. On Windows the default output device is heard too, through WASAPI loopback, as a
second track held to the microphone's clock: silence is filled in while nothing plays (loopback sends nothing then)
and anything running more than a fifth of a second ahead is dropped. Each part's tracks are written down apart and
merged in time order as "You" and "Others". A line of the microphone's is left out as echo when the other track was
playing for at least 60% of it and an overlapping line of theirs shares at least half its words. Settings, Voice,
Listening has "Hear the other side of calls" (on) where it can be heard. The other track is only written down when
something played in it. Services that give no times get one line per side per part.

## Goal

Meeting notes and dictation work out of the box with no account, no key and no cost to anyone. People who want a
cloud service add their own key. Meetings hear both sides of a call and say who spoke.

## Where things stand (main at 5ad86f5)

- `crates/mobius-host/src/voice.rs`: listening through a speech server the person runs themselves (OpenAI audio
  format, e.g. faster-whisper/Speaches at `127.0.0.1:8000`) or ElevenLabs Scribe (`scribe_v1`, no speaker labels asked
  for). Speaking through a local Kokoro server (`127.0.0.1:8880`) or ElevenLabs.
- `crates/mobius-host/src/bridge.rs` `listen()`: tries `listenWith`, then `listenFallback` (chat | local | elevenlabs | off).
- Defaults in `crates/mobius-store/src/preferences.rs`: `listenWith = chat` (model `whisper-1`), `speakWith = off`.
  The chat default fails for Anthropic, llama.cpp and sign-in plans (`Voice.tsx` `chatCannotListen`).
- Settings UI: `apps/desktop/src/settings/Voice.tsx`. The ElevenLabs key sits in Gateways (`providers.rs`, `voice_only`),
  kept in the OS store through `secrets.rs` (Windows Credential Manager, long values in pieces).
- Meetings: `apps/desktop/src/useMeeting.ts` records the microphone in the window (MediaRecorder), in 2-minute parts,
  each sent through `listen()`. `note-insert.ts` `meetingBlock` writes `## Meeting · time · length` then
  `### Transcript`; `meetingAsk` asks Mobius to add `### Summary` and `### Actions` above it.
- `cpal 0.16` is already in `crates/mobius-audio`. Releases are Windows only today (NSIS); there is no macOS bundle or
  `Info.plist` yet.

## 1. On-device default: sherpa-onnx

Why: Apache-2.0, Windows/macOS/Linux, Rust and C APIs, offline speech-to-text (Whisper, Parakeet, SenseVoice and
others), speaker diarization, and text-to-speech (Piper) in one library.

- A small program, `crates/mobius-voice`, its own workspace (sherpa-onnx's Windows library uses the static C runtime,
  and a crash in the speech code can't take Mobius down). Mobius downloads it like the homeserver: from its own
  prerelease, checked against a pinned SHA-256. `crates/mobius-host/src/voice_local.rs` runs it,
  behind a new `listenWith` value `device`. Runs off the UI thread; one model loaded at a time, dropped after a few idle
  minutes so it doesn't hold memory.
- Words: Whisper models run through sherpa-onnx (see "Whisper's part" below). Exact models are picked in PR A after
  timing them on Andrew's PC.
- Speakers: pyannote segmentation 3.0 plus a CAM++ speaker embedding model (about 45 MB together, per OpenWhispr's
  write-up, which reports about 30 s to label a 45-minute meeting on an M1 Mac). Run once at the end of a meeting
  over the "others" track (see 2).
- Models are not in the installer. They download on first use from sherpa-onnx's GitHub releases, each pinned by
  SHA-256 in code, into the app data folder (`<app data>/voice-models/`). Settings shows size, progress, and Remove.
  A failed or wrong-hash download is deleted and says so.
- Default for new installs becomes `listenWith = device`. Existing installs keep their saved choice; the chat server
  stays as an option.
- Speaking: keep `off` by default. Offer Piper through sherpa-onnx as the on-device voice later (PR F), beside the
  existing local Kokoro server and ElevenLabs.

### Whisper's part

Whisper (OpenAI, MIT code and weights) is the model for the final transcript. sherpa-onnx runs it directly ("for
non-streaming speech recognition"), in every size from tiny to large-v3, turbo and the distil models, with int8
versions. So there's one library for words, speakers and voice, not two.

What we use from Whisper:
- **Accuracy:** the main reason. English-only `.en` models do better than multilingual ones at the small sizes,
  per OpenAI's README.
- **Other languages:** the multilingual models write down many languages (OpenAI's README points to its tokenizer for
  the list). Settings gets a Language choice: Auto or a fixed language.
- **Translate to English:** the multilingual models (not turbo) can turn speech in another language into English
  text. Offer "Translate to English" per meeting. English is the only target Whisper supports.
- **Timing:** Whisper works on 30-second windows. Mobius cuts each track with Silero VAD (in sherpa-onnx) into speech
  segments under 30 s, each with its start time, and writes each segment down. Segment start times are enough to
  merge the two tracks and line speakers up, so we don't depend on word-level timestamps (still unconfirmed for
  Whisper in sherpa-onnx).

Sizes (OpenAI parameters; whisper.cpp disk / memory): tiny 39 M, 75 MiB / ~273 MB; base 74 M, 142 MiB / ~388 MB;
small 244 M, 466 MiB / ~852 MB; medium 769 M, 1.5 GiB / ~2.1 GB; large 1550 M, 2.9 GiB / ~3.9 GB; turbo 809 M.
sherpa-onnx's int8 tiny.en is about 117 MB (encoder 12M + decoder 105M).

Speed: no page gives laptop CPU numbers. OpenAI's relative speeds (tiny ~10x, base ~7x, small ~4x, medium ~2x,
turbo ~8x of large) are on a data-centre GPU. So PR A times base.en, distil-small.en and small.en on Andrew's PC and
picks defaults from that. Starting guess: base.en for dictation (needs to feel instant), small.en or distil-small.en
for meetings (written down in the background during the call), turbo or medium offered for people with a strong
machine.

Live captions: Whisper isn't built for streaming. For live text while the meeting runs, use a streaming model in
sherpa-onnx (the English streaming Zipformer, about 68 MB as int8 for its encoder). Live captions are a rough draft
on screen only; the Whisper pass replaces them in the note. Captions are off by default to save CPU.

whisper.cpp (MIT, Windows/macOS/Linux, Rust bindings via whisper-rs) is the fallback if sherpa-onnx's Whisper turns
out slow on CPU. It adds GPU backends (Vulkan, CUDA, Metal, Core ML, which it says runs the encoder over 3x faster
than CPU on Apple Silicon), built-in VAD, and experimental word timestamps and speaker-turn marks. Cost: a second
native library. Decide in PR A after timing both on the same audio.

## 2. Two-track meeting recording

Capture moves from the window into Rust so it can hear the computer's sound. Two tracks, both written as 16 kHz mono
WAV parts in a temp folder and deleted once the words are back (as today, only the words are kept):

- Track 1, "You": the default microphone through cpal.
- Track 2, "Others": what the computer plays.
  - Windows: cpal turns on WASAPI loopback when an output device is opened as an input (stated in cpal's WASAPI source,
    present by 0.15.3). Use the default output device. Microsoft's loopback page mentions no permission prompt.
    Protected (DRM) audio is silent, which doesn't affect calls.
  - macOS 14.4 and newer: Core Audio process taps (`CATapDescription`, `AudioHardwareCreateProcessTap`, a private
    aggregate device). Needs `NSAudioCaptureUsageDescription` in `Info.plist`; macOS asks once on first recording.
    There is no public API to check the permission first, so a silent tap after start is read as "not allowed" and
    Mobius says how to allow it in System Settings. cpal doesn't do this, so it's a small macOS-only module
    (objc2 / coreaudio bindings).
  - macOS before 14.4: microphone only, with one line in the meeting bar saying the other side isn't heard on this
    version. ScreenCaptureKit (macOS 13+) could cover it later but asks for Screen Recording permission, which is a
    lot to ask for a meeting note, so it waits for demand.
  - Linux: microphone only at first; PipeWire monitor sources later.
- Echo: when the person uses speakers, track 1 also hears the others. Keep it simple first: label track 1 lines
  "You" only where track 2 is quiet at that moment (energy check per word span); recommend headphones in the meeting
  bar. Real echo cancellation only if testing shows it's needed.
- Parts stay 2 minutes, each written down while the next is heard, so the transcript is ready soon after the end.
- Merging: both tracks' words carry timestamps; they are merged in time order. Lines from track 1 are "You". Lines
  from track 2 get "Speaker 1, 2…" from diarization, or names when the calendar event has attendees and the person
  renames a speaker once (the rename applies to the whole transcript).

## 3. Settings › Voice

- Listen with: **This computer (free)** default, ElevenLabs, AssemblyAI, Deepgram, Chat server, Off. Same for the
  fallback. The old "local server" choice stays, renamed "Speech server on this computer", for people who already run one.
- Meetings: "Hear the other side of calls" (on by default where supported), "Label speakers" (on), model size,
  Language (Auto or fixed), "Translate to English" (off), "Live captions" (off).
- Speak with: Off (default), This computer, Speech server on this computer, ElevenLabs.
- Keys: AssemblyAI and Deepgram are added to Gateways as `voice_only` providers next to ElevenLabs, stored in the OS
  store through `secrets.rs` exactly as now. A key goes in and is never shown again; it's sent only to its provider.
  Each row says it bills the person's own account. No provider offers sign-in for other apps, so there is no OAuth.
- Provider calls ask for speaker labels: ElevenLabs Scribe `diarize`, AssemblyAI `speaker_labels`, Deepgram
  `diarize`. Their speakers map onto the same "Speaker N" lines. When a cloud service labels speakers, local
  diarization is skipped.
- Test button per choice stays.

Prices read Nov 24, 2026 (per hour of audio): ElevenLabs Scribe v3 $0.20 ($0.22 live); AssemblyAI $0.21 + $0.02
speaker labels; Deepgram Nova-3 about $0.29 + $0.12 speaker labels. All billed to the person's own key.

## 4. Filling the person's typed notes

Today the transcript lands under `## Meeting`, then Mobius is asked for Summary and Actions. Change:

- Whatever the person types during the meeting stays theirs. The meeting section keeps their notes first, then
  `### Summary`, `### Actions`, `### Transcript`.
- Each typed line gets a time stamp in memory (not in the page) while recording.
- `meetingAsk` changes to: keep every typed line as written and in order; under each one add short sub-points from
  what was said around that time; then write Summary and Actions; change nothing else in the note.
- If the person typed nothing, it behaves as today.
- Nudge: when a calendar event with a call link starts and Mobius is open, show a quiet "Record meeting?" in the
  meeting's note. Never records by itself. (Small, can ride with PR E.)

## 4b. Dictation that cleans itself up (Wispr Flow-style, built in)

Wispr Flow's API is billed to the developer, so Mobius builds the useful parts itself on the on-device Whisper from
PR A. Today dictation exists in the message box (`composer/useDictation.ts`, `holdToTalk` key in `shared/src/keys.ts`,
message box only) and in Notes' Insert menu; both record in the window and send through `listen()`.

- **Dictate anywhere in Mobius (PR H):** the hold-to-talk key works in any focused text field in any Mobius app
  (Notes, Mail, Docs, chat, search boxes). A small pill near the field shows the mic level; letting go inserts the
  words at the cursor. Uses the `device` listener with the fast dictation model, so it costs nothing. Typing into
  other programs outside Mobius is a later, separate step (global hotkey plus OS-level typing).
- **Cleanup (PR I):** after Whisper, the words go to the quick model (or the chat model if no quick model is set)
  with a short fixed prompt: drop filler words ("um", "you know"), apply self-corrections ("6pm, actually 7" becomes
  "7pm"), fix punctuation and capitals, never add content. Guards: if the result adds words that weren't said or
  changes length a lot, the raw words go in instead; if cleanup takes over about 3 s, the raw words go in. Ctrl+Z
  right after brings back the raw words. With no model available, a local rule pass drops common fillers only.
  Setting: "Clean up dictation" on by default. Cost: nothing with a local model; with a cloud model it's a short
  call on the person's own plan.
- **Fits the app (PR I):** the cleanup prompt gets which app and field it's in: Mail writes whole sentences with a
  greeting kept as said; Notes keeps short lines and lists; chat stays casual; a search box gets plain keywords.
- **Your words (PR J):** a personal dictionary in Settings › Voice (names, product terms, spellings) passed to Whisper
  as its prompt (to confirm in sherpa-onnx; whisper.cpp supports it) and to the cleanup prompt. Snippets: a spoken
  trigger such as "my address" expands to saved text, done locally before cleanup. Stored in the app's preferences
  file, not with keys. Later and opt-in: suggest a dictionary word when the person corrects the same word twice.
- **Voice edits (PR K):** with text selected, hold the key and say what to do: "make this a list", "shorter", "more
  formal", "fix the spelling". The chat model rewrites only the selection, shown as a change with Undo. Reuses the
  existing selection actions in Notes (`NoteEditor` `onSelection`) and adds them to Mail and Docs.

Tests: an ignored eval like Mail sort's, run on Andrew's PC: 40 or more recorded dictation cases (fillers,
self-corrections, names, lists) scored on whether the cleaned text keeps the meaning and applies the correction.
Unit tests for the prompt builder, the guards, snippet expansion and Undo.

Risks: cleanup changing meaning (guards plus Undo plus the eval); added delay (quick model, short prompt, 3 s
cutoff); hold-to-talk clashing with existing shortcuts (checked against `keybindings` in PR H).

## 5. PRs, two open at a time

| PR | What | Tests |
|----|------|-------|
| A | sherpa-onnx in Rust: `device` listener with Whisper + VAD segments, model download with SHA-256 pins, Settings choice and default for new installs; time sherpa-onnx Whisper vs whisper.cpp on Andrew's PC | Unit: hash check, bad download deleted, `order()` with `device`, VAD segments under 30 s. Ignored test that transcribes a short WAV fixture. CI builds on Windows. |
| B | Native mic capture for meetings in Rust (replaces MediaRecorder for meetings; dictation unchanged) | Unit: part cutting, temp files deleted. e2e with the preview bridge. |
| C | Windows loopback track + time-ordered merge + "You" lines | Unit: merge order, echo rule on synthetic tracks. Manual check on Andrew's PC with a real call. |
| D | Diarization (local) and provider speaker labels (ElevenLabs, AssemblyAI, Deepgram keys in Gateways) | Unit: label mapping per provider from saved sample responses (no live calls in CI). Ignored test on a two-voice fixture. |
| E | Typed notes filled in + meeting nudge | Unit: `meetingAsk`, typed-line timestamps. e2e: typed lines survive. |
| F | macOS taps (once there's a macOS build) + on-device Piper voice | macOS CI build; manual check on a Mac. |
| G | Live captions (streaming Zipformer), Language and Translate to English choices | Unit: captions replaced by the final transcript. Ignored test translating a short non-English fixture. |

| H | Dictate anywhere in Mobius: app-wide hold-to-talk into any focused field, on-device | e2e: hold key in Notes, Mail and chat fields, words land at the cursor. Shortcut clash check. |
| I | Dictation cleanup + tone per app, with guards and Undo | Unit: prompt builder, guards, Undo. Ignored dictation eval on PC. |
| J | Personal dictionary + snippets | Unit: snippet expansion, dictionary passed to both prompts. |
| K | Voice edits on selected text | Unit: only the selection changes; e2e Undo. |

Order: dictation needs only PR A, and it's what people will use every day, so each round pairs one meeting PR with
one dictation PR:
1. A + B
2. H + C
3. I + D
4. J + E
5. K + G
F once there's a Mac build. One batched PC check before the release that ships C.

## Risks

- Native build size and CI time from sherpa-onnx and onnxruntime. Check in PR A; if too heavy, load the library at
  run time from the models folder instead of linking it.
- Model downloads from GitHub: pinned hashes; Mobius keeps working on other choices if a download fails.
- Speed on slower PCs: meetings are written down in parts during the call; diarization runs once at the end.
- Speaker labels on short turns and cross-talk are weak; "You" versus "Others" from the two tracks is reliable, so it
  comes first.
- Recording other people: the meeting bar says recording is on; Mobius never starts recording by itself.
- macOS permission can't be checked in advance; a silent tap is treated as "not allowed" with clear steps.

## Sources

- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- sherpa-onnx Whisper models: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/whisper/index.html
- sherpa-onnx streaming models: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/index.html
- Whisper: https://github.com/openai/whisper
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- OpenWhispr local diarization write-up: https://openwhispr.com/blog/local-speaker-diarization
- cpal WASAPI host: https://docs.rs/crate/cpal/0.18.1/source/src/host/wasapi/mod.rs
- Windows loopback recording: https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- macOS process taps sample: https://github.com/insidegui/AudioCap
- Pricing: https://elevenlabs.io/pricing/api, https://www.assemblyai.com/pricing.md, https://deepgram.com/pricing
