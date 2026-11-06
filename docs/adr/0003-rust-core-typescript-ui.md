# ADR 0003: Rust core, TypeScript for the interface only

Status: accepted. Amends ADR 0001 (stack) and ADR 0002 (agent core language).

## Context

ADR 0002 decided Mobius is its own agent, informed by Hermes Agent, and proposed a TypeScript agent core. We then
compared languages component by component against Mobius's targets and the user's preference for the best technology
for each job over the quickest start. Targets: Windows, macOS and Linux desktops, a headless team server, and
phones and tablets (confirmed in direction; TV is explicitly out). MCP is used in both directions: Mobius connects to
external tool servers as a client and exposes its own applications to any agent as a server.

## Decision

**TypeScript is for the user interface. Everything that is not interface is Rust.**

| Layer | Language | Why |
|---|---|---|
| Interface (React renderer) | TypeScript | Chromium-bound; the editors we embed (Monaco, ProseMirror) are JavaScript |
| Electron main process | TypeScript, kept thin | Electron's API is Node. It is an adapter (windows, views, IPC), not logic. |
| Code - OSS extension glue | TypeScript | VS Code's extension API is TypeScript. Required, not chosen. |
| **Workspace core**: store, event log, permissions, tool registry, MCP, sync | **Rust** | One implementation shared by the desktop sidecar, a team server and mobile apps (UniFFI), and WebAssembly where needed. Memory safe. Crash-safe SQLite. |
| **Agent**: providers, loop, context | **Rust** (planned, next) | Same core, one binary everywhere. Prompts and tool schemas are data, not code. |
| Sandbox for tool execution | **Rust** (planned) | OS-level confinement (AppContainer and job objects, Landlock and seccomp, macOS sandbox). Security-critical. |
| Indexing and search | **Rust** (planned) | CPU and disk heavy, long-running |
| Collaboration | Yjs in the interface, `yrs` in the core | Editor bindings exist only for JS Yjs; `yrs` speaks the same protocol |
| Python | Edge only | A sandboxed code-execution tool, and an optional Hermes backend. Never the core. |

Plugins are not tied to a language: MCP servers over stdio (any language), skills as markdown plus scripts, and
possibly WebAssembly components later.

## Why the permission gate lives in Rust

Anything that acts in a workspace is a `Principal` (person, agent, MCP server, plugin). Every action passes one gate
in the core. If the check lived in the same process as the agent loop, a bug or a prompt injection could bypass it.
Because the agent can only act through the core, it cannot. The gate also gives Mobius's permission model a single
auditable place: ask, approve once, approve for the session, approve always, reject, and revoke.

## What is built (first slice)

- `crates/mobius-core`: model, pure permission policy, SQLite store, tool registry and `Core`, JSON-RPC protocol.
- `crates/mobius-cored`: the core as a separate process speaking JSON-RPC 2.0 over stdin and stdout, one message per line.
- Types generated from Rust to TypeScript with ts-rs into `packages/shared/src/generated`; `npm run check:types` fails
  when they drift.
- `apps/desktop/electron/core-process.ts`: starts, supervises and restarts the core; the renderer sees only its status.

### Rules the core enforces (each has a test, and the key ones were checked by breaking them)

- A person acting directly is never gated. Everyone else is asked unless a grant covers the action.
- A matching deny always wins. Deny-by-default for everything else.
- **Floors**: `process.exec`, `fs.delete` and `secrets.read` can only be approved one use at a time, never for the
  session or always. (Inspired by the idea of approval floors in Hermes; not ported from it.)
- One-time approvals are used up on first use and expire after five minutes.
- The resource an action touches is read from the tool's arguments by the core, so a caller cannot misdeclare it. A call
  that cannot name its resource is refused, not guessed. A resource can never be a wildcard pattern.
- Identical unanswered questions are merged, and at most 100 can be pending, so an agent cannot bury the user in prompts.
- The event log is append-only (enforced by database triggers), never records tool arguments, and survives a hard kill.
- Always-grants persist; session and one-time grants do not survive a restart.
- A tool that fails or panics cannot take the core down.
- The protocol validates everything from outside: size limits (1 MiB per line, 256 KiB of arguments), strict fields,
  validated names, and storage errors never leak onto the wire.

## Consequences and costs

- Two toolchains (Cargo and npm). CI needs Rust builds on three platforms; the core must be bundled and signed with the app.
- Slower early iteration than TypeScript alone; the agent loop will change often and now changes in Rust.
- Windows sandboxing is weaker and harder than on Linux; it is a project of its own.
- The data model in the core is the thing most costly to get wrong. Mitigation: it is small, schema-first (generated
  types), and covered by behaviour tests, and the first slice deliberately holds only permissions, events and tools.

## Not done yet

The agent loop and providers, the MCP client and server, the sandbox, the indexer, real application tools, sync, the
packaging of the core into the app bundle, and mobile bindings. Pending requests are not persisted across a restart (a
stale request id cannot be resolved, by design). Session grants end when the core restarts.

## Dependency policy

Pin and commit lockfiles (`package-lock.json`, `Cargo.lock`). Install scripts stay blocked except for the few we approve
(`electron`, `esbuild`). Hermes pins every dependency exactly after a supply-chain incident on PyPI; we follow the spirit
of that for both ecosystems.
