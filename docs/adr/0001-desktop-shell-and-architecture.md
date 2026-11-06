# ADR 0001: Desktop shell and architecture

Status: accepted (shell). Agent core language: see ADR 0002 and 0003. Code - OSS integration is still proposed.

## Context

Mobius is a morphing desktop environment: browser, documents, notes, code, canvas, tasks and review, with people and
agents sharing artifacts, context, permissions and history. It needs (1) real browser tabs under our own chrome, (2) deep
control of a VS Code-class editor, (3) one consistent rendering engine on Windows, macOS and Linux, and (4) an agent
runtime that can be a separate, supervised process.

## Decision

**Electron** is the shell. UI is **React + TypeScript + Vite**. Code lives in an **npm workspaces** monorepo.

Why not Tauri:
- Tauri 2 renders with WebView2, WKWebView and WebKitGTK. A browser product cannot accept three engines.
- Tauri child webviews (several webviews in one window) sit behind its `unstable` Cargo feature.
- Tauri 3 with CEF gives one Chromium, but it is alpha, its own docs say bundles are "hundreds of megabytes larger" and
  use more memory, and the first build downloads about 1 GB. It removes Tauri's size advantage and keeps its immaturity.
- Code - OSS is TypeScript on Electron. Staying on Electron keeps its code, extension host and patches within reach.
- Hermes Desktop (the app this was designed in) is Electron 44 + React 19 + Vite + Tailwind with a Python agent behind it.
  The split we want (Electron shell, separate agent process) is already proven there.

Revisit if Tauri 3 + CEF reaches stable and a Rust core becomes a hard requirement. The UI and agent core must stay
independent of the shell so the shell is replaceable.

## Process model

| Process | Trust | Responsibility |
|---|---|---|
| Main | trusted | Windows, tab views, permissions, IPC validation, supervising other processes |
| Shell renderer | sandboxed, no Node | React UI (strip, panels, launcher). Reaches main only through the preload bridge |
| Tab views | untrusted | Web pages. No preload, no Node, sandbox, isolated session that denies every permission |
| Agent core (planned) | trusted, separate | Artifacts, context, permissions, history; speaks ACP to Hermes |

Rules enforced in code and by tests:
- The renderer is untrusted input. Everything crossing IPC is validated in `@mobius/shared` (`parseBounds`, `parseTabId`,
  `parseNavigateRequest`) and checked to come from the shell's own webContents.
- Only http(s) is ever loaded into a tab. `javascript:`, `data:`, `file:`, `chrome:` and URLs with credentials are refused.
- `window.open` from a page becomes a new tab for web addresses only. Pages cannot navigate to `file:`.
- Pages see no `require`, `process`, `module`, `Buffer` or `window.mobius`.
- The window uses the OS caption buttons through `titleBarOverlay`, so snap layouts, accessibility and DPI behave natively.

## Embedded browser: how it works

Each tab is a `WebContentsView` drawn by the main process above the shell's DOM. The DOM cannot contain it, so:
- The shell reserves a `SurfaceSlot` and reports its rectangle; main sets the active view's bounds to match.
- Overlays (launcher, future menus over the page) cannot draw above a native view. The slot sends `null` and main hides
  the view while an overlay is open. Hiding is synchronous: it must not wait for a rendering frame (see "Lessons").
- Keyboard shortcuts must work while a page has the keyboard, so main forwards Ctrl/Cmd+K, L, T, W from each tab's
  `before-input-event` to the shell.

## Repository layout

```
apps/desktop      Electron main, preload, React shell, e2e tests
packages/shared   IPC contract and input validation, address resolution (pure, unit-tested)
docs/adr          decisions
```
Planned: `packages/design` (tokens and shell components extracted from the prototypes), `packages/core` (artifact store,
permissions, event log), `packages/agent` (ACP client), `apps/*` surfaces.

## Open decisions (defaults proposed, not yet accepted)

1. **Code workspace.** Default: run Code - OSS as its own surface (its web workbench in a view), controlled by a Mobius
   extension and IPC; fork only when something cannot be done from outside. Alternatives: Monaco only (no extensions) or a
   fork from day one.
2. **Agent core.** Decided in ADR 0002: a native TypeScript agent in its own supervised process (not the main process),
   informed by Hermes Agent (MIT) but not dependent on it. ACP and Hermes backends are optional extras.
3. **Shared state.** Default: SQLite for the artifact store and event log, Yjs for collaboratively edited documents,
   notes and canvas so agents and people edit the same thing.
4. **Updates and packaging.** electron-builder, as Hermes does. Not decided: signing, update channel.

## Lessons from the first slice

- `requestAnimationFrame` is throttled when a window is occluded. A hide message routed through a frame left the native
  page on top of the launcher about one run in five. Layout reporting may coalesce; hiding must be synchronous.
  The shell also sets `backgroundThrottling: false` because agents work while the window is in the background.
- npm 12 blocks install scripts. `electron` and `esbuild` are approved explicitly (`npm install-scripts approve`).
- Playwright serialises `app.evaluate` callbacks, so helpers from the test file do not exist inside the Electron process.
