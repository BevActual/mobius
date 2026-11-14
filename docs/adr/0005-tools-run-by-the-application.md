# ADR 0005: Tools run by the application, and the browser tools

Status: accepted. Builds on ADR 0004.

## Context

The agent's tools must go through the core's permission gate (ADR 0002), but the things it needs to act on first, the
browser tabs, live in the Electron main process, not in Rust. The core is single threaded and must stay responsive, so it
cannot wait inside a tool handler for Electron to load a page.

## Decisions

**External tools.** A tool can be registered as `external`. The core still does everything it does for any tool: checks the
permission, asks a person when needed, and writes to the event log. When a call is allowed it returns `Dispatch` instead of
running anything, and the engine hands the call out (`Step::RunTool`). The daemon sends it to the application as a JSON-RPC
request (`host.tool`), keeps the turn waiting, and carries on with other work. The application's reply (`result` or `error`)
is matched to the request id and fed back into the same turn. Arguments and results are never written to the event log.

**The application registers its tools.** On every start of the core, the main process calls `tools.register_external`. The
core forgets them when it restarts, so they are registered again each time it becomes ready. A tool cannot take the name of
one the core runs itself. A connector started or stopped while Mobius runs registers its tools then, or takes them
back with `tools.unregister_external`, which only ever removes a tool the application registered.

**Approve a site, not a page.** A tool can say its resource is the *origin* (scheme, host, port) of an address argument.
`browser.open` asks about `https://example.com`, so "Always allow" covers that site and nothing else. Only plain
`http`/`https` origins qualify: user names, backslashes, whitespace, control characters and non-ASCII hosts are refused
before anyone is asked. The application also refuses hosts that a person and the browser would read differently
(`127.1`, `3232235777`), so the site that was approved is the site that opens.

**Page text is data.** `browser.read` returns the visible text of a tab, read from an isolated world so the page's own
scripts cannot influence the result. The result carries a notice that it is untrusted, the tool description says so, the
default system prompt says so, and nothing in the page can change what is allowed: every further action still goes through
the gate. This reduces the risk from prompt injection. It does not remove it, because a model can still be talked into
asking for something harmless-looking; the person is the backstop.

**Tool call ids are not trusted to be unique.** Some servers reuse them between turns or within one reply. Ids are made
unique inside a reply, and the window treats a repeated id on a finished call as a new call.

## Tools

| Tool | Capability | Scope | Notes |
| --- | --- | --- | --- |
| `browser.tabs` | `browser.list` | none | Lists tab ids, titles and addresses. |
| `browser.open` | `browser.navigate` | origin | Opens a new tab and waits up to 15 s for it to load. |
| `browser.read` | `browser.read` | none | Visible text, capped at 20,000 characters. |

## Not done yet

- `browser.read` is not scoped to a site, because the core cannot know which site a tab is showing. The card shows the tab
  id only. Scoping it needs the application to tell the core, which is a design of its own.
- No clicking, typing or form filling. Those need much stricter approval.
- The tool timeout is 30 s and the core has no timer of its own: if the application dies, the core dies with it, but if the
  application stays alive and never answers, the person has to press Stop.
