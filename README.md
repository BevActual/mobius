# Mobius

A morphing desktop environment for people and agents. Design prototypes live in `../mobius-design`; this is the real app.

Everything that is not interface is Rust. See `docs/adr/`.

MIT licensed (see [LICENSE](LICENSE)). Windows releases are signed under the [code signing policy](docs/CODE_SIGNING_POLICY.md):
free code signing provided by SignPath.io, certificate by SignPath Foundation.

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

Requirements: Node 22+, Rust stable (MSVC on Windows), git. Chromium (CEF) also needs CMake and Ninja, which the
Visual Studio Build Tools include.

```
npm run app                 # build everything and open the real window, to try changes by hand
npm run dev                 # the interface alone in a browser at 127.0.0.1:5180 (no Rust behind it)
npm test                    # Rust tests, then TypeScript unit tests
npm run e2e                 # builds the shell and drives the real app with Playwright (hidden window)
                            # one spec: npm run build -w @mobius/desktop, cargo build --workspace --bins, then
                            # npx playwright test e2e/x.spec.ts in apps/desktop (in that order: the shell carries the interface)
npm run gen:types           # regenerate TypeScript types from the Rust types
npm run check:types         # fail if the generated types are stale
npm run typecheck
```

On GitHub, **Checks** (`.github/workflows/ci.yml`) runs the types, the TypeScript tests and every Rust test on Linux for
every push and pull request. **Windows end-to-end** (`.github/workflows/windows-e2e.yml`) runs the Playwright suite
against the real app on Windows for pull requests and pushes to `main`, and by hand for a branch or a few test files.

**Driving the real app from Claude Code.** `apps/desktop/scripts/drive-mcp.mjs` is a dev-only MCP server (stdio) that
starts the build from this clone (`target/debug`, or `target/release` when asked) and drives its window through the web
view's debugging port, as the end-to-end tests do: no screen capture or OS permission is needed. Its tools are
`launch` (a fresh data folder, or a kept one by name; optionally a scripted model's URL), `screenshot`, `snapshot` (the
accessibility tree), `click` (by role and name, or text), `type`, `press`, `open_app`, `hook` (resize, theme, notices)
and `close`. It runs in test mode with a data folder of its own; your real data is used only with `realData: true`.
Build first (`npm run build -w @mobius/desktop`, then `cargo build --workspace --bins`), then register it once:

```
claude mcp add --scope project mobius-drive -- node apps/desktop/scripts/drive-mcp.mjs
```

(This writes `.mcp.json` at the root, so any Claude Code session in the clone can use it. Node must be on the PATH.)


`npm run app -- --webview` uses the system web view instead of Chromium.
