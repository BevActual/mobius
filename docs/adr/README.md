# Architecture decisions

Each architecture decision record (ADR) states a decision, the context that led to it, and what it costs. They are
kept as written; a later ADR that changes an earlier one says so at the top of both.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-desktop-shell-and-architecture.md) | Desktop shell and architecture | Accepted; the shell choice (Electron) is superseded by 0007 |
| [0002](0002-native-agent-informed-by-hermes.md) | Mobius is its own agent, informed by Hermes Agent | Accepted direction; language amended by 0003 |
| [0003](0003-rust-core-typescript-ui.md) | Rust core, TypeScript for the interface only | Accepted |
| [0004](0004-conversation-and-agent-host.md) | The conversation, the agent host, and where the key lives | Accepted |
| [0005](0005-tools-run-by-the-application.md) | Tools run by the application, and the browser tools | Accepted |
| [0006](0006-local-models.md) | Finding, downloading and running local models | Accepted |
| [0007](0007-tauri-shell-and-rust-apps.md) | Tauri shell, Rust apps, CEF for the browser | Accepted; current shell decision |
| [0008](0008-shared-controls-on-base-ui.md) | Shared controls on Base UI, styled with tokens | Accepted |

For how these fit together today, read [Architecture](../developers/architecture.md).

## Writing a new ADR

Copy the shape of an existing one: a title `# ADR NNNN: <decision>`, a `Status:` line, then **Context**, **Decision**
and **Consequences** (or **Risks**). Number it after the last one, and add it to the table above in the same pull
request. Open one when a choice is hard to reverse or will surprise someone later: a new process, a storage format, a
dependency on an outside service, a change to the permission model.
