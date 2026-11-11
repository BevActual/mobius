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
npm run gen:types           # regenerate TypeScript types from the Rust types
npm run check:types         # fail if the generated types are stale
npm run typecheck
```

On GitHub, **Checks** (`.github/workflows/ci.yml`) runs the types, the TypeScript tests and every Rust test on Linux for
every push and pull request. **Windows end-to-end** (`.github/workflows/windows-e2e.yml`) runs the Playwright suite
against the real app on Windows for pull requests and pushes to `main`, and by hand for a branch or a few test files.


`npm run app -- --webview` uses the system web view instead of Chromium.
