# Voice

You can talk to Mobius instead of typing, and have its replies read aloud. Both are set up in **Settings › Voice**, and
each has its own service and a fallback if that service cannot answer.

## Dictating

Hold **Ctrl+Space** in the message box and speak; let go to stop. You can also use the **Dictate** button beside the message box.

**Listen with** chooses who turns speech into text:

- **The chat model's server**, when it offers speech to text (OpenAI's does).
- **A speech server on this computer** that speaks OpenAI's audio format, such as
  [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Give its address.
- **ElevenLabs**, with a key added under [Gateways](models-and-gateways.md#paste-an-api-key).

**If that cannot listen** picks what to try next. **Try listening** checks that the chosen service answers.

## Replies read aloud

**Speak with** chooses who reads replies:

- **A speech server on this computer** in OpenAI's audio format, such as [Kokoro](https://github.com/hexgrad/kokoro).
- **ElevenLabs**.
- **Off**.

Pick a **Voice model** and a **Voice** (empty uses the server's own), and a fallback under **If that cannot speak**.
Turn on **Read replies aloud** to hear each new reply as it arrives. Esc or a new message stops it.

## Your keys and your sound

Keys stay inside Mobius's core. The window only sends sound or words and gets words or sound back.
