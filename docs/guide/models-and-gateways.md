# Models and gateways

Mobius does not come with its own AI. You choose where its answers come from, and you can use a different model for
each job. Two places in Settings handle this:

- **Gateways** connects services: a plan you sign in to, an API key, or a server on your computer.
- **Models** chooses which model does what.

## Gateways

### Sign in to a plan you already have

| Plan | How it works |
| --- | --- |
| **ChatGPT** | **Sign in…** opens OpenAI's own "Sign in with ChatGPT" page in your browser. Mobius never sees your password; it keeps a token that refreshes itself. Use counts against your ChatGPT plan. |
| **Claude Pro or Max** | Uses the official **Claude Code** program, which must be installed. **Sign in…** opens Claude Code's own sign-in; come back and choose **Check again** when it is done. Use counts against your Claude plan's limits. Mobius keeps its own tools and approvals. |
| **GitHub Copilot** | Uses GitHub's official **Copilot CLI**, which must be installed (`winget install GitHub.Copilot`). **Sign in with GitHub** shows a short code: enter it on the GitHub page that opens and approve Mobius. Use counts against your Copilot plan's premium requests. Mobius keeps its own tools and approvals; the CLI's own tools are always switched off. |
| **OpenRouter** | **Sign in…** uses OpenRouter's own sign-in to create a key for Mobius, so you don't have to copy one. |

### Paste an API key

**Settings › Gateways › API keys** has a row for each service. Paste a key once; it is kept in the Windows credential
store, never shown again, and only ever sent to its own service.

Services with a ready-made entry: OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Groq, Together AI, Mistral,
xAI, Fireworks AI, Hugging Face, Cerebras, Perplexity, Cohere, Moonshot AI (Kimi), Alibaba Cloud (Qwen), Z.ai (GLM) and
NVIDIA. Each row links to the page where you create a key. When a service does not list its own models, Mobius offers
the ones it knows for that service, and you can still type any other model name.

**Azure OpenAI** and **Amazon Bedrock** live at an address of your own: when you add the key, also give your Azure
resource name or your AWS region (such as `us-west-2`). Bedrock takes a Bedrock API key, made in the Bedrock console.

**Sign in instead of pasting a key.** OpenRouter and Hugging Face have a **Sign in…** button. OpenRouter opens its
page and hands Mobius a key. Hugging Face shows a short code: check it matches on Hugging Face's page and approve
Mobius. If Hugging Face later stops accepting the sign-in, remove the key and sign in again.

### A server on your computer, or any other server

- **Ollama**, **LM Studio** and **llama.cpp** each have an entry with their usual local address. No key is needed.
- **Custom server** takes any address that speaks the OpenAI chat format, and a model name.

### Instructions

**Instructions** under Gateways adds text the agent always follows, for every model.

## A model for each job

**Settings › Models › Defaults**:

| Row | What it is for |
| --- | --- |
| **Chat model** | The model Mobius talks to. Also switchable from the message box. |
| **Second model** | Asked when the first is busy, down or cannot be reached. |
| **Quick model** | Quick jobs, such as checking a step under the Auto permission before it runs. |
| **Images** | Makes pictures for Photo, Design and Slides when you ask. Pictures are saved to Photo. |
| **Listen** | Turns your speech into text when you dictate. See [Voice](voice.md). |
| **Speak** | Reads replies aloud. See [Voice](voice.md). |
| **Effort** | How hard a reasoning model is asked to think. Also in the message box. |

## What it costs

**Settings › Usage** counts the tokens each model call uses and estimates what it cost, by day and by model, service or
app, with a CSV export. See [Settings › Usage](settings.md#usage).

## Models on this computer

**Settings › Models › This computer** runs models locally with [llama.cpp](https://github.com/ggml-org/llama.cpp), so
nothing you ask leaves your computer.

- **Set up a local model** does everything in one step: installs the engine in the build for your graphics card,
  picks a model that fits, downloads it and starts it.
- **Your computer** shows the graphics card and memory a model has to fit in.
- **Find models** searches Hugging Face, or lets Mobius suggest what will run well here.
- **On this computer** lists downloaded models. Run one to use it for the agent.
- **Context size** sets how much text a local model keeps in view. More uses more graphics memory.

The engine is the official llama.cpp release, checked against its published checksum before it is used. Downloaded
models are shared by all [profiles](privacy-and-profiles.md#profiles).

## Long conversations

When a conversation grows past what the model can hold, Mobius gives the model a shorter view: old tool output goes
first, then the middle is summarised, and the most recent part is kept word for word. Your transcript itself is never
changed.
