# ADR 0006: Finding, downloading and running local models

Status: accepted. Date: 2026-11-03.

## Context

Mobius should run by itself, without a hosted model. llama.cpp is installed on the development machine (Unsloth
Studio keeps a CUDA build) and speaks the OpenAI chat protocol the agent already uses. Someone using Mobius should
not have to know which model fits their graphics card, where to get it, or how to start a server.

## Decision

A new Rust crate, `mobius-runtime`, owns everything about local models. TypeScript only shows the result.

- **Find.** Search Hugging Face (`/api/models`, filtered to GGUF), read the file list of each promising repository
  (`/tree/main`), and rank what the computer can run. With no query it uses the trending and most-downloaded
  lists. Only text models that are not gated are considered.
- **Rank.** `fit::assess` decides whether a file runs fast (entirely in graphics memory, with room for the
  conversation), slower (split with the processor), on the processor alone, or not at all. `fit::recommend`
  keeps one file per repository (the best quality that still fits), then orders by fit, then by
  parameters x quality, then by popularity. Judging a file by its own size, when it disagrees with the name, is what
  keeps helper files and mislabelled repositories out of the top of the list.
- **Download.** Resumable (HTTP `Range`), checked against the SHA-256 Hugging Face publishes, disk space checked
  first, cancellable, stored in the layout Hugging Face's own tools use so the scan finds it.
- **Run.** `llama-server` is a supervised child process: private port on 127.0.0.1, tool calls on, no web page,
  `--fit` left to size the GPU layers. The daemon writes the process id to disk and reaps a leftover from a killed
  run, because Windows does not stop children with their parent.
- **Use.** When the model reports healthy, Electron points the agent at it (no API key is sent).

The window can only name a model by an id from the scan list; the core refuses anything else. Repository names
and file paths are validated in the window, in Electron and again in Rust. Searches and downloads are background
jobs that answer `{job}` at once and report through notifications, so the daemon never stops serving.

## Consequences

- No new dependency on a Python or Node tool to get models.
- The recommendation is a heuristic: parameter counts come from names, memory use is estimated. It is meant to be
  right about what will not fit and reasonable about what is best, and it shows its reasoning (fit badge, size).
- Gated models, other model formats, vision input from the window, speculative decoding and choosing context size
  are not done.
- The agent keeps the loopback address after a restart, so it needs the model started again.
