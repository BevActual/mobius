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
| `mail.spec.ts:124` | After Mark as Unread, the message stays open, or no row reads unread | 5 (2026-11-14) | Apps lead | Fixed by #300 (menu items no longer wait for a frame). It has passed on every run since |
| `code.spec.ts:189`, `mobius2.spec.ts:205`, `approval-modes.spec.ts:184` | The assistant's reply after a tool turn doesn't appear within 5 s | 4 (2026-11-14) | Builder | **Blocker**. Turn timings (#303) and host `[slow]` lines (#309) now log each step. The timings show `tool_result` taking up to 2.7 s, which is the host's checkpoint snapshot. On #349 (approval-modes.spec:184) the first checkpoint of the session took 4.7 s (`write-tree` 3 s), so the first tool waited for it. The host now readies checkpoints (index and objects) while the window loads, so the first turn's checkpoint only has to save. #371 puts CI temp on the runner's fast disk: no checkpoint over 1 s since. Watching for a day |
| `tasks.spec.ts:109` | Started fine, but the Lists sidebar never showed Inbox within 60 s ("Target page closed") | 2 (2026-11-14) | Apps lead | Fixed by #308 (the Inbox was made twice at once through one temp file) |
| `skills.spec.ts:88`, `studio.spec.ts:159`, `video.spec.ts:80`, `slides.spec.ts:111`, `canvas.spec.ts`, `research.spec.ts:85`, `mobius2.spec.ts:167`, `studio.spec.ts:145` | Mobius's change never showed as proposed (dashed) | 9 (2026-11-14, #362) | Builder | **Blocker**. An app read the file as it was before the turn once, and gave up silently if the turn's record wasn't there yet. #309 retries in `useFileReview`, and #316 makes every app retry the same way. On #320, studio's marks still arrived 3.7 s after the turn ended, with no host step over a second. #330 logs whether the page was busy, the read's round trip, and the wait for the turn's start. #330's logs showed the first read raced the end-of-turn checkpoint, so #336 makes reads wait for it and sends host `[slow]` lines to CI. On #342 (research.spec:85) that checkpoint itself took 3.7 s on the Windows runner. #345 cuts it from six git runs to four, turns on Git's file-status caches, and logs each git run or lock wait over 300 ms. On #368 (mobius2.spec:167, the review strip's Keep) the end-of-turn `git add` alone took 4.5 s and a PowerShell call on the same runner timed out after 20 s: the Windows runner itself was starved. On #362 (studio.spec:145) the checkpoint before the turn took 3.2 s (`write-tree` 2.1 s) and the tool waited 2.8 s for it. #371 (CI only) found the cause: the tests' data folders were on the runner's slow OS disk (C:). With temp on its local disk (D:), no checkpoint took over 1 s (worst 0.93 s, was 6.0 s) and each shard ran in 7 to 10 minutes instead of 12. A Defender exclusion barely helped and was left out. Watching for a day |
| `models.spec.ts:158` | Usage showed 3 requests where the test expects 2 after switching to a model on this computer | 2 (2026-11-14, #358) | Builder | Fixed by #366. On the local model's small window the tools and instructions alone came to nearly the share kept for a request, so a new tool (`photos.edit`) tipped the second turn into asking for a summary: a third model call. The conversation now always gets room beyond the tools |
| `views.spec.ts:112` | After Discard, reading `Today.json` failed with "Unexpected end of JSON input" | 1 (2026-11-14, #364) | Builder | Fixed by #369. Git empties a file and then writes it, so a read during a restore found it empty; restores now rename a whole new file into place |
| `learn.spec.ts:52` | Escape didn't close Learn | 1 (2026-11-14, #324) | Builder | Watching |
