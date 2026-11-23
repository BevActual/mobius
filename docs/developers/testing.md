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

**Adding or removing an agent tool.** The agent's built-in tools are listed, in the order the shell registers them,
in `crates/mobius-host/tests/agent-tools.txt`. The bridge tests and the e2e suite both check against it. After changing
the tools, run `npm run snapshot:tools` and commit the file with your change.

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

**Times of day.** CI runs around the clock, in UTC. A test that makes data for today must work at any hour: give
an event or reminder a time relative to now (an hour from now) or the whole day, never a fixed hour such as 23:30, which
stops being "coming" late in the evening. The interface and the shell both read the real clock, so the e2e page clock
is not frozen: freezing only the page would put it out of step with the shell's own times.

`e2e/speed.spec.ts` measures start, switching apps, a long list and memory after long use against budgets; see
[Speed](speed.md).

## Continuous integration

| Workflow | When | What |
| --- | --- | --- |
| **Checks** ([`ci.yml`](../../.github/workflows/ci.yml)) | Each pull request (on its merge with `main`) and each commit on `main` | Type checking, TypeScript tests, every Rust test, and a check that the generated types match the Rust ones, on Linux |
| **Windows end-to-end** ([`windows-e2e.yml`](../../.github/workflows/windows-e2e.yml)) | Pull requests, pushes to `main`, and by hand | The Playwright suite against the real app on Windows, in three shards, with one summary check named `e2e` |
| **macOS build** ([`macos-build.yml`](../../.github/workflows/macos-build.yml)) | Pull requests and pushes to `main` | Compiles the shell on macOS so macOS-only code is checked. Nothing runs the app there yet |
| **Release** ([`release.yml`](../../.github/workflows/release.yml)) | A `v*` tag | Builds, signs and drafts a release; see [Releases and updates](releasing.md) |
| **Branch cleanup** ([`branch-cleanup.yml`](../../.github/workflows/branch-cleanup.yml)) | A pull request closes; Mondays, and by hand | On close, deletes the branch (merged or not) and its screenshot branches. The weekly sweep deletes screenshot branches whose pull request is not open, and any branch with no open pull request whose last commit is over a week old, listing each in the run's summary. Keeps `main`, `shell/demo-recording` and `claude/` branches |

A newer push to a pull request cancels that pull request's older runs. On `main` nothing is cancelled: each commit
runs on its own, so two merges a few seconds apart are both tested. A branch with no pull request isn't checked, so
open one, even as a draft.

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

In CI a failed e2e test gets one more try by itself (`retries: 1`). Each shard's run summary lists the tests that
failed on both tries and the ones that only passed on the second, from `scripts/e2e-summary.mjs`. A test that needed
its second try still counts as a sighting, and it goes in the table below, so the table is filled from what CI saw.
Beyond that automatic try, a test gets **one** re-run of the job per pull request. A test that reaches **three sightings** is a blocker: fix its cause
before the next batch of merges. Remove a row once its fix has landed and it has stayed green for a day.

| Test | Symptom | Seen | Owner | Status |
| --- | --- | --- | --- | --- |
| `mail.spec.ts:124` | After Mark as Unread, the message stays open, or no row reads unread | 5 (2026-11-14) | Apps lead | Fixed by #300 (menu items no longer wait for a frame). It has passed on every run since |
| `code.spec.ts:189`, `mobius2.spec.ts:205`, `approval-modes.spec.ts:184` | The assistant's reply after a tool turn doesn't appear within 5 s | 4 (2026-11-14) | Builder | Fixed by #371. Turn timings (#303) and host `[slow]` lines (#309) now log each step. The timings show `tool_result` taking up to 2.7 s, which is the host's checkpoint snapshot. On #349 (approval-modes.spec:184) the first checkpoint of the session took 4.7 s (`write-tree` 3 s), so the first tool waited for it. The host now readies checkpoints (index and objects) while the window loads, so the first turn's checkpoint only has to save. #371 puts CI temp on the runner's fast disk: no checkpoint over 1 s since. No sighting in the 128 Windows runs from #371 to 2026-11-15 22:05 UTC |
| `tasks.spec.ts:109` | Started fine, but the Lists sidebar never showed Inbox within 60 s ("Target page closed") | 2 (2026-11-14) | Apps lead | Fixed by #308 (the Inbox was made twice at once through one temp file) |
| `skills.spec.ts:88`, `studio.spec.ts:159`, `video.spec.ts:80`, `slides.spec.ts:111`, `canvas.spec.ts`, `research.spec.ts:85`, `mobius2.spec.ts:167`, `studio.spec.ts:145` | Mobius's change never showed as proposed (dashed) | 9 (2026-11-14, #362) | Builder | Fixed by #371. An app read the file as it was before the turn once, and gave up silently if the turn's record wasn't there yet. #309 retries in `useFileReview`, and #316 makes every app retry the same way. On #320, studio's marks still arrived 3.7 s after the turn ended, with no host step over a second. #330 logs whether the page was busy, the read's round trip, and the wait for the turn's start. #330's logs showed the first read raced the end-of-turn checkpoint, so #336 makes reads wait for it and sends host `[slow]` lines to CI. On #342 (research.spec:85) that checkpoint itself took 3.7 s on the Windows runner. #345 cuts it from six git runs to four, turns on Git's file-status caches, and logs each git run or lock wait over 300 ms. On #368 (mobius2.spec:167, the review strip's Keep) the end-of-turn `git add` alone took 4.5 s and a PowerShell call on the same runner timed out after 20 s: the Windows runner itself was starved. On #362 (studio.spec:145) the checkpoint before the turn took 3.2 s (`write-tree` 2.1 s) and the tool waited 2.8 s for it. #371 (CI only) found the cause: the tests' data folders were on the runner's slow OS disk (C:). With temp on its local disk (D:), no checkpoint took over 1 s (worst 0.93 s, was 6.0 s) and each shard ran in 7 to 10 minutes instead of 12. The Defender exclusion alone barely helped; beside temp on D: it keeps the rest under a second (without it 7 took over 1 s, worst 1.4 s). No sighting in the 128 Windows runs from #371 to 2026-11-15 22:05 UTC |
| `models.spec.ts:158` | Usage showed 3 requests where the test expects 2 after switching to a model on this computer | 2 (2026-11-14, #358) | Builder | Fixed by #366. On the local model's small window the tools and instructions alone came to nearly the share kept for a request, so a new tool (`photos.edit`) tipped the second turn into asking for a summary: a third model call. The conversation now always gets room beyond the tools |
| `views.spec.ts:112` | After Discard, reading `Today.json` failed with "Unexpected end of JSON input" | 1 (2026-11-14, #364) | Builder | Fixed by #369. Git empties a file and then writes it, so a read during a restore found it empty; restores now rename a whole new file into place |
| `database.spec.ts:27` | After `db.execute` the database showed no "Mobius changed this database" bar | 4 (2026-11-15, #362, #374, shell/drive-tools, main at 777c608) | Builder | Fixed by #397: its `db.execute` turn followed a turn that changed nothing, so both had one start checkpoint and one turn id, and the first turn being kept hid the second's bar. No sighting in the 102 Windows runs from #397 (03:38) to 22:05 UTC. #374 turned off `core.untrackedCache` and `core.fscache`, but main still failed after it (2026-11-15 01:48 UTC). The host itself lists no changed file: the window's `marks:` line says "0 file(s) changed" after the `db.execute` turn. That turn comes right after a turn that changed nothing (`db.query`), so until #397 both turns shared one start checkpoint. The UPDATE leaves the file the same size, so Git sees the change only through its modified time. Next: watch whether #397 (a turn of its own) changes it, and log the database file's size and time beside each checkpoint |
| `tasks.spec.ts:152` | The task's details didn't show beside the list | 1 (2026-11-15, app/music-demo) | Apps lead | Watching. The pull request doesn't touch Tasks, and it passed on its re-run |
| `mobius-host` `device_sign_in.rs` (a page off the service is never opened) | Checks: the stand-in server replied before reading the request, so the client's write was sometimes reset | 1 (2026-11-15, main at 07:20) | Builder | Fixed by #449. The stand-in server now reads the whole request first. Locally it failed 2 of 300 runs before and 0 of 300 after |
| `studio.spec.ts:192` | After Try another, Pause was no longer visible: the song had stopped | 4 (2026-11-15: #406 at 04:10, main at 22:05 and 22:31, a PR at 22:42; all before #463 landed at 23:15) | Music lead | Fixed by #463 (test only). No sighting since, to 2026-11-16 04:08 UTC. Loop was off, so four bars at 112 bpm ended 8.6 s after Space, before Try another's change came in on a slow runner. The script also had no answer for the extra model call Try another's turn makes, so that turn failed and added time. The test now turns Loop on first, as the demo does, and scripts that answer |
| `code.spec.ts:141` | After Commit, the Changes bar still said "3 changes" when the 5 s wait ran out | 8 (2026-11-18 to 2026-11-21, passed on retry each time) | Builder | Fix in #700. Commit and the status re-read took seven git processes, each a process start on the Windows runner; now three. Any git call over 1 s is logged, and a failed Code test prints the Changes bar |
| `agent-app.spec.ts:43` | The page view wasn't shown yet when read once; or Ctrl+K went to the web page and the launcher never opened (60 s timeout) | 2 (2026-11-19, 2026-11-20) | Builder | Fix in #700. The test waits for the page view, and opens the launcher from the Go button |
| `speed.spec.ts:180` | A figure over its budget: switch apps (2, before #626), first visit (1), a long list (1); then switch to the slowest app over 150 ms (3: 152, 156, 168 ms scaled) | 7 (2026-11-19 to 2026-11-22, main at 02:30 UTC) | Builder | Switch budget set by #626, and #701 made switching faster. The slowest are now Calendar (median 182 to 239 ms as measured) and Notes (170 to 247 ms); Notes is the slowest in nearly every run, at 1.6 to 2 times the median switch, with no app-side hotspot in a profile. #762 sets the budget to 180 ms to fit the runners' spread (passing runs 105 to 143 ms); see [Speed](speed.md) |
| `studio.spec.ts:89`, `:218`, `:406`, `:522`, `:568` | "Target page, context or browser has been closed" on a click after the window hung, each at its 1-minute timeout | 3 (2026-11-22: app/music-mixer 00:17, main 02:30, app/music-clip-loops 03:10) | Builder | Fix in #760 (test only). Not a hang: Music reopens the last song a moment after it starts, turning the songs list into a tab behind the Library, and a click aimed mid-switch waited on a hidden or detached row for the test's minute. `openSong` now retries until its click lands |
| `studio.spec.ts:329` | "Target page closed" on a click | 1 (2026-11-22, after #760) | Builder | Watching. A different test from the five #760 fixed |
| `shell.spec.ts:33` | "Target page closed" while clicking, as the window resized | 2 (2026-11-20 shell/narrow-left-dock, 2026-11-22) | Builder | Watching. One more sighting makes it a blocker |
| `speed.spec.ts` (DOM node growth) | DOM growth over its budget on app/calendar-look | 1 (2026-11-22) | Builder | Fixed by #846: not flaky but a real leak. Every Docs or Notes visit kept its editor's Markdown reader in the shared `marked` instance (about 105 nodes a visit). Main now grows 169 nodes, and the budget is 400 (see [Speed](speed.md)) |
| Checks (Rust tests), main | The job hit its 45-minute limit | 1 (main, 2026-11-22) | Builder | Fixed by #845: a deadlock in `sync_pairs` (a lock held while waiting on itself), 1 in 180 under load locally with a backtrace; 0 in 240 after |
| `mobius-host` `local_drive` (stale-version test) | Checks: the version read was older than the one just written | 2 (2026-11-22) | Builder | Fixed by #810 |
| Homeserver build, signing | SignTool: "the file is in use" | 1 (2026-11-22) | Builder | Watching. The runner, not the change |
| Windows end-to-end, screens job | The screenshot push to `ci-screens/main` was refused: two main runs pushed at once ("cannot lock ref", "fatal error in commit_refs_rules") | 2 (main, 2026-11-21) | Builder | Fix in this change: the push tries again up to four times |
| `calendar.spec.ts:419` | The person's coming meetings in the Person panel were empty | 3 (main, 2026-11-19 23:24 to 23:35 UTC) | Builder | Fixed by #636. The test's meeting ended at 23:30 UTC, so after that hour it was no longer "coming". It now runs all day |
| `agent.spec.ts:293`, `approval-modes.spec.ts:184`, `calendar.spec.ts:304`, `canvas.spec.ts:128` | Four unrelated tests failed together in one shard | 1 (main, 2026-11-20 00:16 UTC) | Builder | Watching. No change on main touched them, and the next main run was green: most likely a starved runner |
| `mobius-host` `browser::a_bad_mcp_file_changes_nothing_and_is_reported`, `browser::becoming_ready_registers_the_browser_tools_with_the_core` | Checks: both failed together | 1 (2026-11-19, app/messages-tools) | Builder | Watching. Green on the PR's next push, so possibly the PR's own change |
| `learn.spec.ts:52` | Escape didn't close Learn | 1 (2026-11-14, #324) | Builder | Watching |
| `shell.spec.ts:96` | After New tab, the tab strip still showed 1 tab, not 2 | 1 (2026-11-15, #387) | Builder | Watching. #387 doesn't touch the browser, and it passed on its one re-run |
| A `mobius-host` lib test (unknown) | Checks: the type check's second `cargo test --lib` run failed after the full Rust test step had passed, with no test name shown | 1 (2026-11-15, #391) | Builder | Watching. #391 is docs only and passed on its one re-run. 25 local runs of the host lib tests found nothing. The type check now runs only the type-export tests, and prints the test output if they fail |
| `mobius-runtime` `server.rs:200` (a leftover server from a previous run is stopped) | Checks: the port was still reachable after the leftover server was stopped | 1 (2026-11-15, main) | Builder | Fixed (2026-11-15). The other tests in the file start servers on free ports at the same time, so the freed port can be taken at once; the test now checks the process ended |
| `mobius-host` `bridge.rs:942` (removing all data empties the data folder) | Checks: "1 items could not be removed" | 1 (2026-11-14, fix/warm-checkpoints) | Builder | Fixed by this change. Something still writing into the folder as it was emptied made one removal fail; Remove all data now takes up to five passes, which also covers a file held a moment on Windows |
