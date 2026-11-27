# Better models for Mobius: what to take from Unsloth, steering and weight editing

Status: proposal, 27 November 2026. Asked by Andrew: "look into stuff like this and adapt it for what would make Mobius
useful" (Unsloth, Heretic, and the newer ways people change what a model does, down to editing its weights).

## The short version

| Idea | What it is | For Mobius | When |
|---|---|---|---|
| **Unsloth Dynamic GGUFs** | Quantised files that pick a precision for each layer, so they lose less at the same size | Prefer them in the local model picker. They are plain GGUF files, so `llama-server` runs them unchanged | First, small |
| **A Mobius adapter (LoRA)** | A small add-on to a local model, trained on Mobius's own tools and tasks (mail sort, tool calls, Inbox rows) | A local model that uses Mobius's tools as well as a much bigger one. Trained with Unsloth, loaded with `llama-server --lora` | After the experiment below says it is worth it |
| **Steering (control vectors)** | Nudging a model at run time along a direction found from example pairs ("brief" vs "wordy") | A Tone or Length dial for local models, no retraining | Later, small |
| **A tuned embedding model** | Fine-tuning the small model that turns text into vectors | Better matches when the optional embeddings arrive ([shaping-mobius.md](shaping-mobius.md)) | With embeddings |
| **Heretic / abliteration** | Removing a model's refusals by cutting a "refusal direction" out of its weights | **Not adopted.** Its goal works against an agent with your mail and files, and it is AGPL-3.0 | No |
| **Knowledge editing (ROME, MEMIT, AlphaEdit)** | Rewriting single facts inside the weights | **Not adopted.** Fragile, and Mobius already keeps facts outside the model (memory and the local index), where you can see and undo them | No |

The first step is an experiment that costs nothing: run the existing mail-sort test against local models on Andrew's
PC, standard quant against Unsloth's. Its numbers decide whether adapters are worth building.

## What each one is, from its own docs

### Unsloth

Unsloth is two things: a way to train models cheaply, and a publisher of compressed model files.

- **Dynamic GGUFs.** Unsloth chooses the quantisation of each layer for each model, rather than one level for all.
  - Their page claims their v3.1 files (November 2026) give "10-15% increased accuracy" and "50% less token usage"
    against other quants of the same size.
  - On Gemma 3 27B (MMLU, 5-shot), their Q4_K_XL scores 71.47 against 71.5 for the full model. Google's own QAT file
    scores 70.64.
  - They "work with most inference engines including llama.cpp", which is what Mobius runs.
  - They warn that "1-bit should not be used for agentic use-cases".
- **Training.**
  - It supports LoRA, QLoRA, full fine-tuning and reinforcement learning (GRPO). It trains vision, audio and
    embedding models too.
  - It exports straight to GGUF.
  - Small models train in 8 GB of graphics memory (Gemma 4 E2B). Andrew's RTX 4080 has 12 GB, which fits LoRA
    training of models up to roughly 8B parameters.
  - It runs on Windows.
- **Licence.**
  - The core package is Apache-2.0.
  - Unsloth Studio and some optional parts are AGPL-3.0, so Mobius never embeds them.
  - Using Unsloth as a separate tool to train, or downloading their GGUF files, is fine.
  - Each model file also carries its base model's licence (Qwen is Apache-2.0; Gemma and Llama have their own
    terms). The picker should show it, and the default should be an Apache or MIT model.

### Steering with control vectors (llama.cpp)

- `llama-server` already takes `--control-vector-scaled FILE:SCALE` and `--control-vector-layer-range`.
  - llama.cpp's `cvector-generator` makes a vector from pairs of example prompts. From what I know of the tool, it
    takes the main direction of the difference between the model's hidden states on each side; its README could not
    be loaded to confirm this.
  - Changing the scale today means restarting the server. llama.cpp issue #10685 asks for `/cvectors` to change it
    live, as `/lora-adapters` already does for LoRA, and a pull request for it is open.
- **For Mobius:** a Length dial (Brief / Normal / Thorough) and a Tone dial (Plain / Warm) for local models.
  - Vectors are made once per model on Mobius's side and shipped as small files.
  - Until the live endpoint lands, a change takes effect at the next model start.
  - This only works on local models. Hosted models keep using instructions in the prompt.

### LoRA adapters in llama-server

- `--lora FILE`, `--lora-scaled FILE:SCALE`, and `--lora-init-without-apply` (load now, turn on later through
  `POST /lora-adapters`; a scale of 0 turns one off).
- So one base model can carry a "Mobius tools" adapter, switched on for agent turns and off for plain writing,
  without loading a second model.

### Heretic and abliteration

- Heretic finds a "refusal direction": the difference between the model's state on "harmful" and "harmless" prompts.
  It then removes that direction from the attention and MLP output weights. It uses Optuna to search for settings
  that remove the most refusals while keeping the model closest (by KL divergence) to the original. Heretic 2 adds
  "Arbitrary-Rank Ablation".
- **Why not for Mobius:**
  - Mobius's agent reads mail and web pages written by strangers and can start on its own when mail arrives
    (#956). A model with its refusals removed is easier to turn with injected instructions.
  - Removing refusals adds nothing an agent in your own workspace needs.
  - Heretic is AGPL-3.0, which this project does not embed.
- **What is worth taking is the method.** Finding a direction from contrasting examples and adjusting it is the same
  idea as steering above, used for helpful traits (brevity, plain language) instead of removing safety.

### Editing facts in the weights

- ROME, MEMIT and later AlphaEdit change single facts ("X works at Y") by editing a few weight matrices.
- Surveys report the edits leak into unrelated answers, fade or conflict as they pile up, and are hard to undo
  individually.
- Mobius's design keeps what it knows about you outside the model: memory, Knowledge and the local index. You can
  read, correct and delete those, and they work with any model, hosted or local. That stays the plan.

## How a Mobius adapter would be made (later round, if the experiment supports it)

1. **What it learns.**
   - Mobius's own tool calls: the right tool, well-formed arguments, asking before anything that sends or deletes.
   - Mail sort groups.
   - Inbox-style short results.
2. **Where the examples come from.**
   - A large hosted model writes them through Mobius's real tools in a test workspace, as the e2e fixtures do.
   - The person's own Keep and Discard choices are a second source, but only if they opt in. They never leave the
     computer, and they are never used by default.
3. **Training.** Unsloth QLoRA on Andrew's PC, exported to a GGUF LoRA file.
4. **Checking it.**
   - The mail-sort test (54 labelled emails, `crates/mobius-host/tests/mail_sort_eval.rs`).
   - A new tool-use test built the same way.
   - An adapter ships only if it beats the same base model without it, and does not get worse at asking before risky
     steps.
5. **Shipping.**
   - An optional download beside the model, off by default, in Settings > Models.
   - Mobius loads it with `--lora-init-without-apply` and turns it on for agent turns.

## First experiment (small, no cost)

- **Code:** let `mail_sort_eval` also call an OpenAI-compatible local endpoint (`MOBIUS_SORT_EVAL_LOCAL=http://127.0.0.1:PORT`),
  next to the Claude models it compares today. This is a test-only change that can be built and checked in CI.
- **Run, on Andrew's PC through Launch** (local models only, nothing paid):
  - The same small Apache-licensed model, about 4B parameters, in a standard Q4_K_M file and in Unsloth's
    Dynamic Q4 file.
  - One larger local model that fits the 4080.
- **It answers three questions:**
  - Do Unsloth's files sort mail measurably better at the same size?
  - How far is a small local model from the hosted quick model?
  - Is that gap big enough that an adapter is worth building?
- **About an hour on the PC.** It reads only the 54 sample emails in the test, never Andrew's mail.

## Decisions for Andrew

1. **Run the first experiment on your PC?** A real-model run, which the project otherwise avoids while building.
   It is local only and costs nothing. Recommended: yes.
2. **Prefer Unsloth Dynamic files in the local model picker?** When a model has one, Mobius shows it first, with the
   model's own licence. Recommended: yes, once the experiment shows no loss.
3. **Heretic and weight editing stay out.** Recommended: agree.
4. **Adapters and steering:** decided after the experiment. Training needs Python and Unsloth installed on your PC,
   which would be its own yes.

## Sources (read 27 November 2026)

- Unsloth Dynamic GGUFs: https://unsloth.ai/docs/basics/dynamic-3.0-ggufs
- Unsloth package and licence: https://pypi.org/project/unsloth/2026.8.1/, changelog https://unsloth.ai/docs/new/changelog
- Heretic: https://github.com/p-e-w/heretic, README v1.0.1 https://raw.githubusercontent.com/p-e-w/heretic/v1.0.1/README.md
- llama-server flags: https://manpages.debian.org/unstable/llama.cpp-tools/llama-server.1.en.html
- Live control vectors request: https://github.com/ggml-org/llama.cpp/issues/10685
- Knowledge editing surveys: https://arxiv.org/pdf/2310.19704, https://arxiv.org/html/2406.01436v1
