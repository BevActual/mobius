# ElevenLabs ideas for Mobius

> Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Links point at the repo copies.

Nov 10, 2026

## The short version

ElevenLabs is now three things: **ElevenCreative** (speech, music, sound effects and video in a Studio editor), **ElevenAgents** (voice and chat agents you build, test and monitor) and **ElevenAPI** (the models underneath). Almost everything they make is about one idea Mobius doesn't have yet: **you can talk to it, and it can talk back, well**.

My recommendation is to take three things first:

1. **Talk to Mobius.** A hold-to-talk key and a voice mode in the right panel, with real turn-taking.
2. **Listen to anything.** A Listen button in every app that reads a page, a mail thread or your morning desk aloud.
3. **A Meetings app.** It was already next on the app roadmap. Live transcript with who said what, and actions land dashed in Tasks and Calendar.

After that, the Studio audio tools (generate music, sound effects and voiceover as dashed clips) fit the Ableton-style Studio almost one to one.

## What ElevenLabs makes now

| Product | What it does | Worth noticing |
| --- | --- | --- |
| Eleven v4 voices (Sep 2026) | Text to speech in 90+ languages | Audio tags like \[whispers\] or \[sarcastically\] set the tone of a line |
| Eleven Realtime (Oct 2026) | Speech to speech for agents | Low enough delay to feel like a conversation |
| Scribe v2 and v2 Realtime | Speech to text | Who said what, timestamps on every word, live mode |
| ElevenAgents | Voice and chat agents | Turn-taking, tools, knowledge base, visual workflows, simulations and automated tests before going live, guardrails, analytics, channels for phone, chat, email, WhatsApp and SMS |
| Agents Architect (Oct 2026) | An AI that reviews an agent's setup | A second opinion before you ship a bot |
| Music v2 / v2.5 and the ElevenMusic app | Songs with vocals, stems, inpainting a section, genre changes mid-track | Regenerate one part of a track without touching the rest |
| Sound effects, Voice changer, Voice isolator | Effects up to 30 s, change a voice, strip background noise | Small tools that each save a real job |
| Voice design and cloning | Describe a voice or clone your own | Every bot could have its own voice |
| Dubbing v2 (May 2026) | Translate speech in video, keeping the speaker's tone and timing | Sync-aware translation |
| Studio 4.0 (Sep 2026) | Timeline editor for audio and video | Edit the script and the audio regenerates in the same voice. Review links with timestamped comments. A Studio Agent that drafts and places clips |
| ElevenReader and GenFM | Read-aloud app; turns a document into a two-host podcast | Listening as a way to get through reading |

## Ideas, and where each one lives in Mobius

### 1. Talk to Mobius (shell and right panel)

- **Hold a key to talk** from anywhere, and the words go into the Mobius panel of the app you're in, so "move this to Friday" in Calendar means this event.
- **Voice mode** in the panel: Mobius answers out loud and you can interrupt it, like their agents' turn-taking. On Home, it is a spoken conversation with Mobius and its bots.
- **The rules don't change because you spoke.** Changes still arrive dashed. Paying, sending, deleting and running commands still stop and ask on screen, and saying "keep" or "discard" works as a button press.
- **Built from:** Scribe v2 Realtime for listening, Eleven v4 or Realtime for speaking.

### 2. Mobius speaks with a voice you choose (Settings and Bots)

- Pick Mobius's voice in Settings, or describe one ("calm, a bit dry") with voice design.
- **Each bot gets its own voice**, so on Home you can tell who's talking without looking.
- Audio tags let Mobius sound different when something needs you ("Needs you" is said plainly, a finished bot sounds pleased).

### 3. Listen to anything (every app)

- A **Listen** button in Mail, Docs, Wiki, Browser reader and Notes, like ElevenReader built in.
- **Morning and evening moments** on the Home desk can be played as a short spoken brief, or as a two-voice show of your day in the GenFM style.

### 4. Dictation that you edit as text (Notes, Mail, Docs)

- Speak into a note or a reply, then fix it as text. Mobius can tidy it as a dashed rewrite you Keep or Discard, the same as Rewrite in place.

### 5. Meetings app (new app, already on the roadmap)

- Live transcript with speakers and timestamps, live captions, and a summary.
- Decisions and to-dos land **dashed** in Tasks and Calendar with a link back to the moment they were said, like the Linked from card.
- Meeting notes go to Notes or the team's Wiki page, again dashed until Keep.

### 6. Studio gets ElevenLabs' audio tools (Studio)

- **Generate a clip** from a prompt (music, a sting, a sound effect) and it lands as a dashed clip on the timeline, with stems as separate tracks.
- **Regenerate one section** of a clip (inpainting) from the clip menu: "Try another" for just bars 9 to 16.
- **Voiceover track**: type the script, pick a voice, and editing the words regenerates the audio.
- **Clean up a recording** with voice isolation. Their review links with timestamped comments map to Mobius's comment pins on the timeline.

### 7. Translate a video or recording (Files and Studio)

- "Make a Portuguese version" on a video in Files or Studio produces a dubbed copy, dashed in Files until Keep.

### 8. Test a bot before it runs (Bots)

- Borrow their **simulations**: before a bot is switched on, Mobius runs it against a few made-up situations and shows what it would have done, including ones that should stop and ask.
- An Architect-style **review** of a new bot's rules, and simple stats per bot (how often it finished, how often it needed you).

### 9. A bot that answers the phone (later: Phone and Messages)

- Their agents work over phone, WhatsApp and SMS. Mobius's Messages app and the Hermes gateway are where this would live, with the rule that a bot calling or texting someone outside always asks first.

## How it would be built

- **An ElevenLabs connector in Extensions**, with the API key held in Settings. The Rust side makes the calls so the key never sits in the web view.
- **Microphone** through the web view inside the Tauri window, with a clear "listening" state in the shell so it's never on without you knowing.
- **Local fallback** for listening (an on-device speech model) so dictation works offline and nothing leaves the PC unless you allow it. ElevenLabs offers a zero-retention mode for the cloud side.
- **Cost** is per character spoken and per minute heard, so Listen and voice mode should show when they're using paid voice.

## Running voice on the PC

Andrew's PC (i9-14900HX, RTX 4080 Laptop with 12 GB, 32 GB RAM) can run nearly all of the voice work on its own. Music is the exception, which it can run, but not at ElevenLabs' quality.

| Job | Runs on this PC? | Models to try | Notes |
| --- | --- | --- | --- |
| Listening (speech to text) | Yes, easily | Whisper large-v3-turbo, Parakeet, Moonshine | Faster than real time on the GPU; small models even on CPU |
| Reading aloud | Yes, easily | Kokoro, Piper | Light enough to run beside everything else |
| Expressive voice and cloning your own voice | Yes | Chatterbox, F5-TTS, Orpheus | Fits in 12 GB; a second or two to start |
| Live conversation | Mostly | Local listening and speaking, Claude in the cloud for thinking | Speech-to-speech models like Moshi just fit in 12 GB when compressed |
| Music and sound effects | Yes, but slower and rougher | MusicGen, Stable Audio Open, ACE-Step | Good for sketches; ElevenLabs for finished clips |
| Dubbing | Not really |  | Keep it on ElevenLabs |

The catch is that 12 GB is shared, so Mobius should load one big voice model at a time and unload it when idle. Most people's PCs are weaker than this one, so each job needs a cloud option too.

### Gateways connect, Models decide (Settings)

**What the app has today** (read from the code on main, 2026-11-10): **Providers** holds one key per service (OpenAI, Anthropic, Gemini, OpenRouter, Groq and others, plus Ollama, LM Studio and llama.cpp on this computer). **Model › Server** picks one provider, address and model, with a Second model as fallback. **Model › This computer** already checks the graphics card, installs llama.cpp, suggests models that fit and downloads them. And voice dictation already exists: **Model › Server › Voice dictation** sends your recording to the same server as the chat model (whisper-1 by default). That works on OpenAI or Groq, but not on Anthropic or a local llama.cpp, because those servers have no speech model.

### Voice through the model gateways

**What to change:** give voice its own **Model › Voice** page, so each voice job (Listening, Speaking, later Conversation and Music) picks its own provider and model instead of riding on the chat server. Then Claude can do the thinking while OpenAI, ElevenLabs or this computer does the voice. Add **ElevenLabs** to Providers. It doesn't speak the OpenAI chat format, so the Providers list needs a kind of provider that only does voice. Extend **This computer** with voice models the same way it does chat models: the same hardware check, suggestions and download, then run a local speech server (a faster-whisper or Kokoro server that speaks the OpenAI audio format, so the existing dictation code works unchanged). Keep the current dictation row as the Listening job's default, so nothing breaks.

## Things to be careful about

- **Voice cloning needs consent.** Only clone your own voice, and say so in Settings.
- **Audio from a page or a mail is data, not instructions**, the same injection rule as in Browser.
- Some figures differ between sources (language and voice counts, launch dates, prices), so the table uses ElevenLabs' own pages where they disagree.

## Open questions for Andrew

- Which ElevenLabs features caught your eye? I'll go deeper on those.
- Should Mobius rely on ElevenLabs for voice, or keep voice swappable so another provider or an on-device model can be used?

## Sources

- [ElevenLabs home](https://elevenlabs.io), [Agents](https://elevenlabs.io/agents), [Music](https://elevenlabs.io/music), [Studio](https://elevenlabs.io/studio), [Text to speech](https://elevenlabs.io/text-to-speech), [Blog](https://elevenlabs.io/blog)
- [ElevenLabs timeline (Script by AI)](https://www.scriptbyai.com/elevenlabs-timeline/)
- [ElevenLabs review 2026 (OneClickAI)](https://oneclickai.io/blog/elevenlabs-review-2026)
- [ElevenMusic launch (ChatAI)](https://www.chatai.com/posts/elevenlabs-debuts-elevenmusic-as-it-expands-beyond-voice-ai)
- [Dubbing v2 (ChatAI)](https://www.chatai.com/posts/elevenlabs-new-dubbing-v2-brings-emotion-preserving-ai-translation-to-video)
- Earlier research: [Mobius: rival agents and target apps](rival-agents.md)
