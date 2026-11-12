# Architecture

Mobius is a Rust application with a web interface. Everything that is not interface is Rust: permissions, tools,
storage, the agent, model providers and each app's logic. The React interface draws and asks; it holds no business
logic and is treated as untrusted.

The reasons are recorded in the [architecture decisions](../adr/README.md), especially
[ADR 0007](../adr/0007-tauri-shell-and-rust-apps.md) (Tauri shell, Rust apps, CEF for the browser).

## Processes

```
┌───────────────────────────── mobius-shell (Tauri, Rust) ─────────────────────────────┐
│                                                                                     │
│  Web view: the React interface (apps/desktop)      Browser pages: Chromium (CEF)     │
│        │  window.mobius bridge                     or the system web view            │
│        ▼                                                                             │
│  mobius-host: validates every call, owns services (mail, calendar, voice, updates,   │
│  secrets, local models), registers the app's tools with the core                     │
│        │  JSON-RPC 2.0, one message per line on stdin/stdout                         │
└────────┼────────────────────────────────────────────────────────────────────────────┘
         ▼
   mobius-cored (child process): mobius-core (permission gate, tool registry, event log)
                                 + mobius-agent (the turn engine and model providers)
```

- **The shell** (`crates/mobius-shell`) is the Tauri app. It opens the window, hosts browser pages, draws the tray and
  menus, and runs the updater.
- **The interface** (`apps/desktop`) is React 19 + TypeScript + Vite. It calls the shell through one bridge,
  `window.mobius`, whose types come from `packages/shared`.
- **The host** (`crates/mobius-host`) sits between the two. It validates every request from the window, runs the
  services that need the operating system, and supervises the core: starts it, restarts it within a budget, and passes
  calls and notifications both ways.
- **The core** (`crates/mobius-cored`) runs as a separate process. It cannot outlive the app: it exits when its input
  closes. Models are called on other threads, so a slow model never makes it unresponsive.

## How a request flows

1. You send a message. The interface calls the bridge; the host forwards it to the core.
2. The agent engine (`mobius-agent`) asks the chosen model and gets back text and tool calls.
3. Every tool call goes through the core's **permission gate** (`mobius-core`). It decides from the approval mode,
   standing rules, per-app and per-project levels, and the **floors** (running commands, deleting files, reading
   secrets, clicking or typing on a page), which are asked about every time. The decision is written to the event log;
   arguments and results are not.
4. Tools the core runs itself run there. Tools that belong to the application (the browser, the apps' files) are
   **external**: the core returns the call to the host, which runs it and sends the result back into the same turn
   ([ADR 0005](../adr/0005-tools-run-by-the-application.md)).
5. Before any file change, `mobius-workspace` takes a **checkpoint** of the workspace in a shadow git store outside it,
   which is what makes Keep, Discard and Rewind possible.
6. The interface receives the turn as events (`agent.event`, `agent.delta`) and draws the conversation and the dashed
   changes.

## Crates and packages

| Path | What it holds |
| --- | --- |
| `crates/mobius-core` | Principals, the permission gate, the tool registry, the event log, the JSON-RPC protocol |
| `crates/mobius-cored` | The core as a separate process |
| `crates/mobius-agent` | Conversation state, the turn engine, model providers, context compaction |
| `crates/mobius-claude` | Claude Pro/Max through the official Claude Code CLI, with Mobius's tools and approvals |
| `crates/mobius-runtime` | Local models: finding and ranking them, downloads, supervising `llama-server` |
| `crates/mobius-host` | What the window may ask for: validation, the bridge, services (mail, calendar accounts, voice, images, projects, schedules, memory, MCP, updates, secrets) |
| `crates/mobius-store` | Small JSON stores (settings, history, bookmarks, bots), written atomically and read defensively |
| `crates/mobius-workspace` | The apps' files (notes, docs, tasks, calendars, sheets and formulas, photos, comments) and checkpoints |
| `crates/mobius-browser` | The browser app: tabs, addresses, downloads, find, page tools, behind an `Engine` trait |
| `crates/mobius-mcp` | The MCP client for connectors in `mcp.json` |
| `crates/mobius-shell` | The Tauri shell; the web view or Chromium (CEF) page engine, tray, menus, updater |
| `apps/desktop` | The React interface, its unit tests, the end-to-end tests and dev scripts |
| `packages/shared` | The bridge contract and the TypeScript types generated from the Rust types |

## Where data lives

The data folder (`%APPDATA%\app.mobius.shell` on Windows) holds `preferences.json` and the other stores, `memory.md`,
`mcp.json`, the `workspace/` folder with every app's files, and `checkpoints/`. Each app keeps plain files: Markdown for
notes, docs, tasks and Knowledge pages; `.ics` for calendars; CSV per sheet; SQLite for databases; JSON for songs and
designs; edits beside photos. The agent reads them with the same file tools a person's edits go through.

Secrets (API keys, sign-in tokens) are kept in the operating system's credential store and never reach the interface.

## Rules that hold everywhere

- The interface is untrusted. Every call it makes is validated in Rust.
- Keys never reach the interface. Browser pages get no bridge.
- Everything that acts (a person, the agent, an MCP server, a plugin) is a principal and passes the same permission
  gate.
- Text from web pages, mail and MCP servers is untrusted data, never instructions.
- Nothing the agent changes is final until the person keeps it.

## Design

The interface follows Apple's Human Interface Guidelines: one look, one sidebar and one review bar in every app. The
layout rules are in [Workspace layout](../design/workspace-layout.md).
