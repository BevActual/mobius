# ADR 0002: Mobius is its own agent, informed by Hermes Agent

Status: accepted direction. Implementation details open (see "Open questions"). Language: amended by ADR 0003 (Rust, not TypeScript).
Supersedes the "agent core" default in ADR 0001, which proposed an ACP client to Hermes.

## Context

Mobius is meant to be its own AI agent, not a front end for someone else's. Hermes Agent (Nous Research) is a mature
agent platform and is MIT licensed, so we may read it, learn from it, and copy or port code from it with attribution.
It is large: about 900,000 lines of Python outside tests (agent 145k, tools 129k, gateway 124k, CLI 295k, plugins 89k)
and about 1.5 million lines of tests. We cannot and should not port that.

## Decision

1. **The Mobius agent core is native** (language: see ADR 0003, Rust), in its own supervised process, in this repo.
   It ships without a Python runtime and has no runtime dependency on Hermes.
2. **Hermes is a reference and a source of tested behaviour, not a dependency.** For every capability we build, we first
   read how Hermes solves it, port the lessons and the relevant test cases, and adapt to Mobius's model (applications,
   shared artifacts, people and agents in one workspace).
3. **The agent sits behind an `AgentBackend` interface.** The native agent is the default. ACP and Hermes's own backend
   remain optional, additional backends ("bring your own agent"). Mobius's app tools are exposed through its own tool
   registry and, for outside agents, as an MCP server passed in ACP `session/new` (the spec takes `cwd` and `mcpServers`).
4. **Build narrow.** Do not chase Hermes's breadth (about 20 messaging platforms, cron, voice, learning graph). Build the
   core loop and the parts only Mobius needs, then grow at the edges.

## Design lessons taken from Hermes (its AGENTS.md)

- **Per-conversation prompt caching is sacred.** Do not mutate past context, swap toolsets, reload memory or rebuild the
  system prompt mid-conversation; the one exception is compression. Design the context builder so the prefix is stable.
- **A narrow waist.** Every tool is sent on every model call, so the bar for a new core tool is high. Capability arrives
  at the edges: skills, plugins, and service-gated tools. Mobius app tools must be gated by which app is open and which
  permissions are granted, not always-on.
- Behaviour-contract tests over implementation tests, and E2E tests with real imports against a temp home directory.

## Where Mobius deliberately differs from Hermes

- **Applications are first-class.** Tools operate documents, a canvas, a browser, review. Context is explicit and attached
  by the user or by an approved agent action; nothing is implicit.
- **People and agents share one artifact store** with permissions and history, so edits by either are reviewable.
- **Permissions are a product surface** (decision bar, scoped grants), not only a prompt to a terminal user.
- The shell is the primary interface; there is no CLI-first assumption.

## Licensing and attribution policy (not legal advice)

- Hermes Agent is MIT, copyright (c) 2025 Nous Research. MIT requires keeping the copyright and permission notice with
  copies or substantial portions.
- Any file that is a port or close adaptation carries a header naming the Hermes source file, and `THIRD_PARTY_NOTICES.md`
  carries the full MIT text. Ideas and short snippets need no header, but we still note the source in the reference map.
- Check each directory before copying: Hermes bundles plugins, optional skills and dependencies that may carry their own
  licences. This has not been checked yet.
- The MIT licence does not grant the Hermes or Nous names and branding. Mobius uses its own.

## Open questions

- Which model providers ship first. Proposal: any OpenAI-compatible endpoint (covers your local Unsloth server) and
  Anthropic.
- Whether the native agent persists sessions in SQLite with full-text search (as Hermes does) from the start. Proposal: yes.
- Whether to port Hermes tests as acceptance specs. Proposal: yes, selectively, per capability (see the reference map).
- Whether Mobius should read and write Hermes-compatible skills, so existing skills work. Not decided.
