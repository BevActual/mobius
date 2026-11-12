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
| **Branch cleanup** ([`branch-cleanup.yml`](../../.github/workflows/branch-cleanup.yml)) | A pull request closes | Deletes the merged branch and its screenshots branch, keeping `main` and the long-lived branches |

To run the Windows suite by hand for one branch or a few files: **Actions › Windows end-to-end › Run workflow**, and
give the spec paths (for example `e2e/mobius2.spec.ts`).

### Screenshots for design review

`e2e/screens.spec.ts` captures every app in light and dark. Each Windows run uploads them as artifacts and publishes
them as one commit on the branch `ci-screens/<branch>`, replaced on every run, so reviewers can open them at
`https://raw.githubusercontent.com/BevActual/mobius/ci-screens/<branch>/<App>-light.png`.

When a pull request merges, the **Branch cleanup** workflow deletes its branch and its `ci-screens/<branch>` branch
(a closed, unmerged pull request loses only the screenshots). `main` and the long-lived branches listed in the
workflow are kept. A deleted branch can be restored from its pull request page.

## When a test fails

Re-run only what failed while you fix it, then run the whole suite once. Don't skip or disable a test to get green;
fix the cause or the test.
