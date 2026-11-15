# Development setup

## What you need

- **Node 22 or newer** and npm.
- **Rust stable.** On Windows, the MSVC toolchain (install the Visual Studio Build Tools with "Desktop development with
  C++").
- **git.**
- **CMake and Ninja** for the Chromium (CEF) page engine. The Visual Studio Build Tools include both. Without them,
  `npm run app` falls back to the system web view.
- On Linux, the WebKitGTK and GTK development packages Tauri needs (the list is in
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

Windows is the main platform. macOS compiles in CI; Linux runs the Rust and TypeScript tests.

## Get the code

```
git clone https://github.com/BevActual/mobius.git
cd mobius
npm ci
```

## Run it

| Command | What it does |
| --- | --- |
| `npm run app` | Builds everything and opens the real window, to try changes by hand. Uses Chromium (CEF) when it can be built, otherwise the system web view. |
| `npm run app -- --fast` | Skips build steps that have not changed: just the interface and the shell. |
| `npm run app -- --webview` | Uses the system web view instead of Chromium. |
| `npm run dev` | The interface alone in a browser at `http://127.0.0.1:5180`, with no Rust behind it. A preview bridge fills the apps with sample data, so you can work on layout quickly. |

The first CEF build downloads Chromium and takes a while. Later builds are incremental.

## Check your work

| Command | What it does |
| --- | --- |
| `npm test` | Rust tests (`cargo test --workspace`), then the TypeScript unit tests (Vitest) |
| `npm run typecheck` | TypeScript type checking for every workspace |
| `npm run gen:types` | Regenerates the TypeScript types in `packages/shared/src/generated` from the Rust types |
| `npm run check:types` | Fails if the generated types are stale |
| `npm run e2e` | Builds the interface and the shell, then drives the real app with Playwright (hidden window) |
| `npm run readme-shots -w @mobius/desktop` | Retakes the README's picture of every app, light and dark, from the preview ([Screenshots](../writing-docs.md#screenshots)) |
| `npm run ui-shots -w @mobius/desktop` | Retakes the pictures on the [shared controls](shared-controls.md) pages |

See [Testing and CI](testing.md) for running a single end-to-end spec and what runs on GitHub.

## Build an installer

```
npm run package
```

Builds `Mobius_<version>_x64-setup.exe`. See [Releases and updates](releasing.md).

## Repository layout

```
apps/desktop        the React interface, unit tests, end-to-end tests (e2e/) and dev scripts (scripts/)
crates/             the Rust crates: core, agent, host, shell and the apps' logic
packages/shared     the bridge contract and generated types
docs/               these docs, architecture decisions (adr/) and reference notes
scripts/            repo scripts: type generation, packaging
```

[Architecture](architecture.md) explains what each crate does.

## Useful environment variables

| Variable | Effect |
| --- | --- |
| `MOBIUS_NO_UPDATES` | Turns the updater off |
| `MOBIUS_SLOW_MS` | Logs a `[slow]` line to `shell.log` for any checkpoint, tool wait or change lookup slower than this (default 1000 ms; `0` logs all) |
| `MOBIUS_E2E_ANY_BUILD=1` | Lets the end-to-end tests run against a shell build older than the interface build |

## Working with an AI agent

Mobius is built with AI agents that also use Mobius. To let Claude Code launch and drive your build, see
[Driving the app from an agent](driving-the-app.md).
