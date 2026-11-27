# Voice

You can talk to Mobius instead of typing, and have replies and pages read aloud. Both are set up in **Settings ›
Models**: **Capabilities** has a Listen and a Speak row saying where each runs, and **Listening** and **Speaking** below
it hold their options. Each has its own service and a fallback if that service cannot answer.

## Dictating

Hold **Ctrl+Shift+Space** in the message box and speak; let go to stop. A quick tap starts listening instead, and another tap stops it. You can also use the **Dictate** button beside the message box. In Notes, **+ › Record a meeting** listens to a whole
meeting with the same service and writes it into the page ([Notes](../apps/write-and-plan.md)).

**Listen with** chooses who turns speech into text:

- **The chat model's server**, when it offers speech to text (OpenAI's does).
- **A speech server on this computer** that speaks OpenAI's audio format, such as
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Give its address.
- **ElevenLabs**, with a key added under [Gateways](models-and-gateways.md#paste-an-api-key).

**If that cannot listen** picks what to try next. **Try listening** checks that the chosen service answers.

## Replies read aloud

**Speak with** chooses who reads aloud:

- **This computer (free)**: Kokoro, downloaded once (about 155 MB) with **Set up**, then nothing read aloud leaves this
  computer. Pick one of its voices, American or British, under **Voice**. New installs start here; nothing is read
  until you press Listen or Read aloud.
- **A speech server on this computer** in OpenAI's audio format, such as [Kokoro](https://github.com/hexgrad/kokoro).
- **ElevenLabs**.
- **Off**.

For a server, pick a **Voice model** and a **Voice** (empty uses the server's own), and a fallback under **If that
cannot speak**. Turn on **Read replies aloud** to hear each new reply as it arrives. Esc or a new message stops it.

## Listen

**Listen** (the speaker in the toolbar) reads what is open aloud: a note, a document, a message in Mail, an article in
Reader. A long page is read in parts, so the first is heard in a moment. Press it again, or Esc, to stop. If nothing is
set up to speak, it says so, with **Set up speaking**.

## Your keys and your sound

Keys stay inside Mobius's core. The window only sends sound or words and gets words or sound back.
