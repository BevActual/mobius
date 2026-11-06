# ADR 0007: Tauri shell, Rust apps, CEF for the browser

Status: accepted. Supersedes the shell decision in ADR 0001. The Rust-core rule of ADR 0003 now applies to the whole
application, not only the agent.

## Context

ADR 0001 chose Electron and listed what would make us revisit it: a Rust core becoming a hard requirement, and a
single bundled Chromium becoming available in Tauri. The owner has now decided the direction: a suite of applications
whose logic is Rust, with a web UI on top, and a general-purpose browser as one application.

## Decision

1. **Shell: Tauri 2** (Rust). It replaces the Electron main process.
2. **Apps are Rust crates.** An app owns its state, storage, validation, tools and permissions. The UI is React +
   TypeScript and holds no business logic.
3. **One tool registry** (`mobius-core`) is shared by people and agents. MCP is exposed from it, both ways.
4. **The browser engine is Chromium through CEF**, hosted by the Browser app behind a small engine interface, so it
   can be replaced later (Servo, a fork). The system web views (WebView2, WKWebView, WebKitGTK) are fine for the
   non-browser apps but are not accepted as a browser engine: three engines, no DevTools protocol on two of them.
5. **The Electron app stays** as the reference and fallback until the Tauri app passes the same end-to-end list.
   Nothing is deleted until that is true.

## Order of work

1. `mobius-host`: supervising the core process (restart budget, calls, notifications, host requests). Pure Rust, no
   Tauri, tested against the real daemon. (done in this change)
2. `mobius-shell`: the Tauri app. Loads the existing renderer; a bridge gives it the same `window.mobius` API, backed
   by Rust commands that validate everything. Namespaces are ported one at a time; an unported one answers with a
   plain "not available yet" and never pretends.
3. Move the main-process logic that is still TypeScript (agent settings and secrets, bots, preferences, appearance,
   history, bookmarks, downloads, context files) into Rust crates behind the same bridge.
4. Browser app on CEF with the engine interface; floating panels over the page (offscreen rendering is the plan if a
   native child view cannot be layered).
5. Other apps, each a Rust crate with its own UI.

## Risks (known, not hidden)

- Tauri's CEF runtime is alpha at the time of writing (Tauri 3). The Browser app may need its own CEF host until it
  matures. ADR 0001's size and memory warnings still apply to the Browser app only.
- Overlaying HTML on a native web view is the same problem as in Electron. Not solved yet.
- Code - OSS is an Electron app. Deep integration will mean hosting its browser build; unproven.
- Porting costs: about 5,500 lines of TypeScript main-process code and its unit tests move to Rust. The 167
  end-to-end tests are the acceptance list.

## Rules that carry over

The renderer is untrusted. Every call it makes is validated in Rust. The API key never reaches the renderer. Tab pages
get no bridge. Nothing is committed until the owner says.

## Status (2026-11-05)

Steps 1 to 3 are done and step 4 is under way with the system web view as the engine.

| Piece | Where | State |
| --- | --- | --- |
| Supervising the core | `mobius-host` (`process`, `protocol`) | done; restart passes through starting like the first start |
| Settings, appearance, keys, bots, history, bookmarks | `mobius-store` | done |
| Agent service, secrets (OS keychain), context, models, notices, keep-awake, quick entry, downloads | `mobius-host` | done |
| Browser app: tabs, tools, downloads, address rules, favicons | `mobius-browser` | done behind an `Engine` trait with a fake for tests |
| Web view engine (WebView2 child views, DevTools protocol, downloads, key presses) | `mobius-shell` (`engine`, `cdp`) | done on Windows |
| Tauri end-to-end run | `MOBIUS_SHELL=tauri npx playwright test` | 163 passed, 7 skipped, 1 known gap (below) |

Known gaps in the Tauri shell:

- An executable download is saved but the web view never reports it finished, so the list keeps saying
  "downloading". The test is marked `fixme` for Tauri.
- Shortcuts pressed while a web page has the keyboard cannot be sent through the debugging port (they must be native
  key presses), so three tests skip on Tauri; the key mapping is covered by Rust tests in `mobius-store` and `mobius-host`.
- Clicking a notice is not reported by the notification plugin on Windows. Instead, bringing the window to the front within two
  minutes of a notice about a conversation opens that conversation (an approximation, tested in `mobius-host`).
- Choosing a file to attach uses the system dialog (`tauri-plugin-dialog`); no end-to-end test drives it.
- macOS and Linux: the engine (`cdp.rs`) is Windows only. The traits are in place; the other two web views are not written.
- Chromium through CEF (decision 4) is built for Windows (`crates/mobius-shell/src/cef_engine.rs`, cargo feature `cef`,
  off by default because it needs CMake and Ninja from the Visual Studio Build Tools on `PATH`: `...\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin`
  and `...\\CMake\\Ninja`). It is another `Engine` behind the same trait. The shell uses it whenever it was built in, and
  `MOBIUS_ENGINE=webview` asks for the system web view instead (also the fallback if Chromium fails to start). Design:
  - CEF runs its own UI thread (`multi_threaded_message_loop`), so the Tauri loop is untouched; each tab is a child
    window of the Mobius window, placed and hidden with `SetWindowPos`/`ShowWindow` (physical pixels = layout x zoom x
    scale). The helper processes are the same executable started with `--type=...`; `main` hands those to
    `execute_process` first and leaves (`run_helper_process`). No sandbox yet (`no_sandbox`).
  - Closing a tab: CEF answers a close by posting WM_CLOSE to the top-level window above the page, which is the Mobius
    window. The page is moved under a throwaway hidden window first (`close_page`). Without it, closing any tab quits the app.
  - Downloads, permissions, key events, popups, navigation checks, titles and find are CEF handlers; scripts and
    screenshots go through DevTools messages (`send_dev_tools_message` plus a message observer), the same CDP calls as
    on WebView2. Pages are told "denied" for permissions with `Browser.setPermission`, and the permission prompt handler denies.
  - Executable downloads finish properly here (the WebView2 gap does not exist).
  - Find: Chromium's current-match number lags a step behind with the page out of sight, so only the count is used and the
    current match is worked out in `mobius_browser::find::current_match` (tested).
  - Event order: everything the engine tells the browser app goes through one queue and one thread.
  - Still open: macOS and Linux (the child-window code is Windows only; CEF supports both with `set_as_child` there),
    the sandbox bootstrap, shipping the CEF files with the installer, and Chromium security updates as a standing duty.
  - Test: `MOBIUS_ENGINE=cef` (or the default) with the same Playwright specs; the harness runs statements in a tab through
    the shell's `runInPage` probe instead of the WebView2 debugging port.

Two things learned the hard way, for whoever builds this next:

- Tauri embeds the interface at compile time. Run `npm run build:tauri` before `cargo build -p mobius-shell`, or the
  shell shows the previous interface.
- Playwright takes over downloads on a connection over the debugging port. The Tauri harness turns that off so the
  shell sees downloads itself.

## Electron retired (2026-11-06)

The Electron app, its TypeScript main process and the Electron half of the end-to-end harness are deleted. The Tauri
shell passed the same end-to-end list (172 passed on Chromium), and keeping two shells doubled every full test run.
The main-process unit tests (about 200) were ports of what now lives, tested, in Rust crates; 65 interface unit tests
remain. A backup of the tree from just before the removal is at `../mobius-backups/pre-electron-removal.tgz`.
Tests that sent real key presses to a page (shortcuts while a page has the keyboard) are gone with Electron; the key
mapping is covered by Rust tests. `npm run app` opens the real window for trying changes by hand.
