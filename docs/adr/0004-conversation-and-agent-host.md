# ADR 0004: The conversation, the agent host, and where the key lives

Status: accepted. Builds on ADR 0002 (native agent) and ADR 0003 (Rust core, TypeScript only for the UI).

## Decisions

**The agent is a non-blocking state machine.** `mobius-agent` has three layers. The *engine* runs one turn and never
blocks: it returns the next step (call the model, wait for a person, done). The *host* owns conversations and turns and
answers "what should happen next" as a list of things for its caller to do. The *daemon* (`mobius-cored`) carries those out:
model calls run on worker threads and report back through one channel, so a slow model or a person who has not
decided yet never stops the core answering other requests. The host does no I/O and has no threads, which is why
almost all of its behaviour is tested without a network.

**One question can have several askers.** The core merges identical pending questions into one. A turn that is waiting
therefore cannot assume the question is its own. An answer is collected once and given to every turn waiting on it
(a one-time approval runs one of them, and the other asks again), and cancelling a turn withdraws the question only
if no other turn needs it.

**Everything the window needs to rebuild itself comes from the host.** `agent.history` includes the turn in progress and
`agent.waiting` lists the calls waiting for a person with their arguments, so a reloaded window shows exactly what the
person would have seen.

**Notifications.** The daemon sends JSON-RPC notifications (`agent.delta` for streamed text, `agent.event` for progress).
A response is always written before notifications caused by the same request. The main process validates every
notification before the window sees it.

**The renderer asks; the main process holds.** The window can send a message, stop, answer a question, and save
settings. It cannot call the core. Every payload is validated in the main process, the sender is checked, and the
conversation id, message length, and answer shape have fixed limits.

**The API key.** It is entered once, sent to the core in memory, and stored encrypted with the operating system's secret
store (Electron `safeStorage`). If that is unavailable it is kept only until the app quits, and the settings say so. It is
never returned to the window. A saved key is only ever sent back to the address it was saved for. The core refuses to send
a key over plain http to any machine other than this one, and does not follow redirects.

## Not done yet

- The only tool the agent has is `clock.now`. Browser, document and other tools are the next slice and will arrive as
  tools registered with the core, so they go through the same permission gate.
- Conversations are in memory in the core and are lost when it restarts. Persisting them (and searching them) is next.
- Only OpenAI-compatible servers are supported. Other providers sit behind the same `Provider` trait.
- Replies are shown as plain text. There is no markdown rendering yet.
