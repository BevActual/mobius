# Testing and CI

Mobius has three layers of tests. Run the first two before every pull request.

| Layer | Where | Run with |
| --- | --- | --- |
| Rust unit and integration tests | `crates/*/src`, `crates/*/tests` | `cargo test --workspace` (part of `npm test`) |
| TypeScript unit tests (Vitest) | `apps/desktop/src/*.test.ts`, `packages/shared/src/*.test.ts` | `npm test --workspaces --if-present` (part of `npm test`) |
| End-to-end tests (Playwright) | `apps/desktop/e2e/*.spec.ts` | `npm run e2e` |

## Unit tests

Logic that can be tested apart from the screen is kept in plain modules next to the component (`tasks-view.ts` beside
`Tasks.tsx`, `studio-view.ts` beside `Studio.tsx`) and tested there. Prefer adding a unit test to one of these modules
over an end-to-end test when the behaviour is not about the real window.

## End-to-end tests

The end-to-end suite starts the **real** Mobius build (shell, core and interface) with a fresh data folder in test mode,
connects to the window over the web view's debugging port, and drives it as a person would: by role and name, with the
keyboard, and through the bridge. Model calls go to scripted fixture servers (`e2e/*-fixture.ts`), so no API key or
network is needed.

Run everything:

```
npm run e2e
```

Run one spec. The shell carries the interface inside it, so build in this order:

```
npm run build -w @mobius/desktop
cargo build --workspace --bins
cd apps/desktop
npx playwright test e2e/notes.spec.ts
```

The suite refuses to run against a shell built before the interface, since it would test old screens. Set
`MOBIUS_E2E_ANY_BUILD=1` to skip that check.

Pass `--trace off` unless you need traces; turn them on to debug a failure (`--trace on`).

## Continuous integration

| Workflow | When | What |
| --- | --- | --- |
| **Checks** ([`ci.yml`](../../.github/workflows/ci.yml)) | Every push and pull request | Type checking, TypeScript tests, every Rust test, and a check that the generated types match the Rust ones, on Linux |
| **Windows end-to-end** ([`windows-e2e.yml`](../../.github/workflows/windows-e2e.yml)) | Pull requests, pushes to `main`, and by hand | The Playwright suite against the real app on Windows, in three shards, with one summary check named `e2e` |
| **macOS build** ([`macos-build.yml`](../../.github/workflows/macos-build.yml)) | Pull requests and pushes to `main` | Compiles the shell on macOS so macOS-only code is checked. Nothing runs the app there yet |
| **Release** ([`release.yml`](../../.github/workflows/release.yml)) | A `v*` tag | Builds, signs and drafts a release; see [Releases and updates](releasing.md) |
| **Branch cleanup** ([`branch-cleanup.yml`](../../.github/workflows/branch-cleanup.yml)) | A pull request closes | Deletes the merged branch and its screenshots branch, keeping `main` |

To run the Windows suite by hand for one branch or a few files: **Actions › Windows end-to-end › Run workflow**, and
give the spec paths (for example `e2e/mobius2.spec.ts`).

### Screenshots for design review

`e2e/screens.spec.ts` captures every app in light and dark. Each Windows run uploads them as artifacts and publishes
them as one commit on the branch `ci-screens/<branch>`, replaced on every run, so reviewers can open them at
`https://raw.githubusercontent.com/BevActual/mobius/ci-screens/<branch>/<App>-light.png`.

When a pull request merges, the **Branch cleanup** workflow deletes its branch and its `ci-screens/<branch>` branch
(a closed, unmerged pull request loses only the screenshots). `main` is never deleted. A deleted branch can be
restored from its pull request page.

## When a test fails

Re-run only what failed while you fix it, then run the whole suite once. Don't skip or disable a test to get green;
fix the cause or the test.

### Unstable tests

Every re-run of a failed e2e job is written down here, so re-runs stay honest and it is clear where CI time goes.
A test gets **one** re-run per pull request. A test that reaches **three sightings** is a blocker: fix its cause
before the next batch of merges. Remove a row once its fix has landed and it has stayed green for a day.

| Test | Symptom | Seen | Owner | Status |
| --- | --- | --- | --- | --- |
| `mail.spec.ts:124` | After Mark as Unread, the message stays open, or no row reads unread | 5 (2026-11-14) | Apps lead | Fix landed in #300 (menu items no longer wait for a frame). The cause is likely but not yet confirmed; the test logs whether the window draws frames |
| `code.spec.ts:189`, `mobius2.spec.ts:205` | The assistant's reply after a tool turn doesn't appear within 5 s | 3 (2026-11-14) | Builder | **Blocker**: being looked into |
| `tasks.spec.ts:109` | Started fine, but the Lists sidebar never showed Inbox within 60 s ("Target page closed") | 1 (2026-11-14) | Builder | Watching |
| `skills.spec.ts:88` | "Mobius's change" never appeared | 1 (2026-11-14) | Apps lead | Watching |
