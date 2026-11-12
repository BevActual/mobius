# Contributing to Mobius

Thanks for your interest. Mobius is an early preview and changes quickly, so the most useful things right now are:

- **Bug reports.** What you did, what you expected, what happened, and your Windows version. A screenshot helps.
- **Ideas.** Open an issue that describes the problem you'd like Mobius to solve, not only the feature.
- **Small, focused pull requests.** For anything larger, open an issue first so we can agree on the approach.

By contributing you agree that your work is released under the [MIT license](LICENSE).

## Principles

- **Refine before adding.** Improving the apps that exist comes before new apps.
- **One look.** Follow Apple's Human Interface Guidelines and the existing components (sidebar, menus, review bar)
  instead of inventing new ones.
- **The person decides.** Anything the agent changes must be reviewable and undoable. Sending, paying, deleting and
  running commands always ask.
- **Rust for everything that isn't interface.** Permissions, tools, storage and model providers live in the core.

## Getting set up

You need Node 22+, Rust stable (the MSVC toolchain on Windows) and git. The Chromium (CEF) engine also needs CMake and
Ninja, which the Visual Studio Build Tools include.

```
npm ci
npm run app                 # build everything and open the real window, to try changes by hand
npm run dev                 # the interface alone in a browser at 127.0.0.1:5180 (no Rust behind it)
npm test                    # Rust tests, then TypeScript unit tests
npm run e2e                 # builds the shell and drives the real app with Playwright (hidden window)
npm run gen:types           # regenerate TypeScript types from the Rust types
npm run check:types         # fail if the generated types are stale
npm run typecheck
```

`npm run app -- --webview` uses the system web view instead of Chromium.

To run one end-to-end spec: `npm run build -w @mobius/desktop`, then `cargo build --workspace --bins`, then
`npx playwright test e2e/x.spec.ts` in `apps/desktop` (in that order: the shell carries the interface).

## How the code is organised

```
crates/mobius-core       permissions, event log, tools, JSON-RPC protocol
crates/mobius-cored      the core as a separate process (JSON-RPC over stdin/stdout)
crates/mobius-agent      the agent turn engine and model providers
crates/mobius-runtime    local models (llama.cpp) and downloads
crates/mobius-host       what the window may ask for: validation, bridge, services
crates/mobius-store      small JSON stores (settings, history, bookmarks, ...)
crates/mobius-browser    the browser app, behind an Engine trait
crates/mobius-workspace  checkpoints of real folders, for rolling back agent changes
crates/mobius-shell      the Tauri shell; web view or Chromium (CEF) engine
apps/desktop             the React interface and the end-to-end tests
packages/shared          IPC contract + types generated from the Rust core
```

Architecture decisions are in [`docs/adr/`](docs/adr).

## Checks

On GitHub, **Checks** (`.github/workflows/ci.yml`) runs the types, the TypeScript tests and every Rust test on Linux for
every push and pull request. **Windows end-to-end** (`.github/workflows/windows-e2e.yml`) runs the Playwright suite
against the real app on Windows. Please make sure `npm test` and `npm run typecheck` pass before opening a pull request.

## Driving the real app from Claude Code

`apps/desktop/scripts/drive-mcp.mjs` is a dev-only MCP server (stdio) that starts the build from this clone and drives
its window through the web view's debugging port, as the end-to-end tests do. Its tools are `launch`, `screenshot`,
`snapshot`, `click`, `type`, `press`, `open_app`, `hook` and `close`. It runs in test mode with a data folder of its
own; your real data is used only with `realData: true`. Build first, then register it once:

```
claude mcp add --scope project mobius-drive -- node apps/desktop/scripts/drive-mcp.mjs
```

## Security

Please don't report security problems in public issues. Use
[GitHub's private vulnerability reporting](https://github.com/BevActual/mobius/security/advisories/new) instead.
