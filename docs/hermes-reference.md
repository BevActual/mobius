# Hermes reference map

Where to look in Hermes Agent when building each Mobius capability. Paths are relative to the Hermes Agent checkout
(on this machine: `%LOCALAPPDATA%/hermes/hermes-agent`). Listed from a quick directory survey; the contents were not
read in depth, so treat each entry as a pointer, not a spec. Read the area's `AGENTS.md` first.

| Mobius capability | Hermes starting points | Notes for Mobius |
|---|---|---|
| Tool registry and toolsets | `tools/registry.py`, `toolsets.py`, `tools/delegate_tool_toolsets.py` | Gate tools by open app and granted permission |
| Conversation loop | `agent/` (large; `agent_init*.py`, `agent_runtime_helpers*.py`) | Start with a minimal loop; add recovery later |
| Model providers | `agent/anthropic_adapter.py`, `agent/bedrock_adapter.py`, `agent/model_metadata*.py`, `agent/auxiliary_client*.py` | First: OpenAI-compatible and Anthropic |
| Context compression | `agent/context_compressor.py`, `agent/conversation_compression*.py`, `agent/compression_*.py` | The one allowed prefix mutation |
| System prompt and caching | `agent/prompt_builder.py`, `agent/system_prompt.py` | Keep the prefix stable per conversation |
| Permissions and approvals | `tools/approval.py`, `approval_floors.py`, `approval_smart.py`, `approval_human_wait.py` | Maps onto the decision bar and scoped grants |
| Sessions and search | `hermes_state.py`, `hermes_state_messages.py`, `hermes_state_fts.py` | SQLite plus full-text search |
| Memory | `agent/memory_manager.py`, `memory_provider.py`, `memory_context.py` | After the core loop |
| Skills | `tools/skills_tool.py`, top-level `skills/` | Decide on Hermes-skill compatibility |
| Subagents | `agent/subagent_lifecycle.py`, `tools/async_delegation*.py` | Team activity in the conversation panel |
| Checkpoints | `tools/checkpoint_manager.py` | Undo for agent edits; feeds Review |
| Browser tools | `tools/browser_*.py` (CDP, supervisor, snapshot, dialogs) | Mobius owns the browser views directly |
| Scheduling | `cron/` | Much later |
| Backend supervision | `apps/desktop/electron/backend-*.ts` | Pattern for supervising the agent process |
| Desktop shell patterns | `apps/desktop/electron/` (updater, hardening, find-in-page) | Reference for packaging and updates |

## Tests as specifications

Hermes has a very large test suite. For each capability, read the matching tests before writing ours, and port the cases
that describe behaviour Mobius also needs. Examples seen: `tests/e2e/core/security/test_approval_boundary.py`,
`tests/agent/test_413_compression.py`, `tests/acp_adapter/test_approval_isolation.py`.

## Process for every capability

1. Read the Hermes implementation and its tests. Write down what problems it solves and what it got wrong or over-built.
2. Write the Mobius behaviour as tests first (ours, adapted from theirs where valid).
3. Implement narrowly in TypeScript. If a file is a port, add the attribution header.
4. Record the source in this table.
