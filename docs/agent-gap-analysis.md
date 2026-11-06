# Agent capabilities: Hermes compared with Mobius

Read from the installed Hermes (`tools/`, `agent/`, `toolsets.py`) on 2026-11-06 and from the Mobius crates. "Have" means
built and tested; "partly" means a first version exists. Hermes is the reference, not a dependency (ADR 0002).

| Capability | Hermes | Mobius | Notes |
|---|---|---|---|
| Model providers, fallback model, streaming | many providers, auxiliary models | OpenAI-compatible, one fallback, local llama.cpp | have, narrower |
| Approvals (manual / smart / off, floors) | `approval*.py` | same three modes, floors in the core | have |
| Browser tools | CDP, snapshots, vision, vault | list/open/navigate/read/click/type | partly |
| File tools (read, write, patch, search) | `file_tools.py`, guards, lint | `files.list/read/search/write/edit` over one workspace folder, checkpointed, approval-gated | have (lint and per-folder workspaces later) |
| Checkpoints and rollback | shadow git store | taken before every file write or edit; no "undo" button in the interface yet | partly |
| Terminal and background processes | `terminal_tool.py`, process registry | none | gap |
| MCP client (use other tools) | large (`mcp_tool*.py`, OAuth, discovery) | stdio servers from `mcp.json`, tools as `mcp.<server>.<tool>`, one approval capability per server, minimal environment; tested against the reference server | have (no settings page, no HTTP/OAuth transport, no hot reload) |
| MCP server (be used) | yes | none | gap |
| Context compression for long chats | `compression_marker`, auxiliary summaries | none | **gap, long conversations will fail** |
| Todo / plan list | `todo_tool.py` | none | gap |
| Clarify (ask the person a question) | `clarify_tool.py` | none | gap |
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
3. Context compression, then todo and clarify (they change how long tasks feel).
4. Memory and session search. Web search and extract.
5. Terminal, then skills, subagents and scheduled jobs.
