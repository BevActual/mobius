# Agent capabilities: Hermes compared with Mobius

Read from the installed Hermes (`tools/`, `agent/`, `toolsets.py`) on 2026-11-06 and from the Mobius crates. "Have" means
built and tested; "partly" means a first version exists. Hermes is the reference, not a dependency (ADR 0002).

| Capability | Hermes | Mobius | Notes |
|---|---|---|---|
| Model providers, fallback model, streaming | many providers, auxiliary models | OpenAI-compatible, one fallback, local llama.cpp (Mobius installs its own official build for the graphics card, checksum-verified; one-step setup and start with Mobius), Claude subscription through Claude Code, ChatGPT plan through OpenAI's device sign-in and a native Responses transport | have, narrower |
| Approvals (manual / smart / off, floors) | `approval*.py` | same three modes, floors in the core | have |
| Browser tools | CDP, snapshots, vision, vault | list/open/navigate/read/click/type | partly |
| File tools (read, write, patch, search) | `file_tools.py`, guards, lint | `files.list/read/search/write/edit` over one workspace folder, checkpointed, approval-gated | have (lint and per-folder workspaces later) |
| Checkpoints and rollback | shadow git store | taken before every file write or edit; no "undo" button in the interface yet | partly |
| Terminal and background processes | `terminal_tool.py`, process registry | none | gap |
| MCP client (use other tools) | large (`mcp_tool*.py`, OAuth, discovery) | stdio servers from `mcp.json`, tools as `mcp.<server>.<tool>`, one approval capability per server, minimal environment; tested against the reference server | have (no settings page, no HTTP/OAuth transport, no hot reload) |
| MCP server (be used) | yes | Streamable HTTP on 127.0.0.1, bearer token, Host/Origin checks; workspace files, read-only unless the person allows changes (Settings > Advanced > Other apps) | have, narrower (files only) |
| Context compression for long chats | `context_compressor.py`, auxiliary summaries | `mobius-agent/src/compaction.rs`: the model gets a view (old tool output pruned first, then the middle summarised with Hermes's structured prompt, recent tail kept word for word); the transcript is never changed; summary kept per conversation (SQLite v2); a request refused as too long makes room and retries once; window known for local models and Claude, else 128K assumed | have (no separate summary model, no settings for threshold, no manual "compact now") |
| Todo / plan list | `todo_tool.py` | `todo.write`, answered by the engine (no approval), shown as a Plan card | have |
| Clarify (ask the person a question) | `clarify_tool.py` | `ask.person` with up to 6 choices or free text; the turn waits, the question survives a window reload | have (no timeout) |
| Persistent memory | `memory_tool.py` | none | gap |
| Search past sessions | `session_search_tool.py` | none | gap |
| Web search and page extraction | web tools | none | gap |
| Skills (procedures the agent keeps) | `skills_*` | none | later |
| Subagents / delegation | `delegate_tool*.py` | none | later |
| Scheduled jobs | `cronjob_tools.py` | none | later |
| Code execution | `code_execution_tool.py` | none | later |
| Image generation, vision, speech | yes | speech-to-text only | later |

## Order proposed

1. Tool registry as the single surface, with an MCP client behind it (everything below registers there).
2. File tools over workspaces, wired to checkpoints, gated by the approval modes. First user: Notes.
3. ~~Context compression~~, ~~todo and clarify~~ (done).
4. Memory and session search. Web search and extract.
5. Terminal, then skills, subagents and scheduled jobs.
