# Speed

Mobius has speed budgets for four things a person feels: how long it takes to start, to switch apps, to open a long
list, and how much memory it holds after long use. Every pull request measures them in the end-to-end suite
(`apps/desktop/e2e/speed.spec.ts`) on the Windows CI machine. A figure over its budget fails the test.

## The measures

| Measure | What it times or counts |
| --- | --- |
| first start | From starting the program to its window drawn with the Go button and shortcuts ready, on a new data folder (the web view makes its profile) |
| start | The same, on the second start with that folder: the start a person has every day |
| open a long list | Opening Notes with a 2,000-page notebook: from the Enter in the launcher to the first frame with the Notebooks panel drawn |
| switch to an app, first visit | Median of the first switch into Tasks, Calendar, Mail, Docs and Files |
| switch apps | Median of 120 switches between six apps already visited (20 rounds) |
| switch apps, slowest tenth | The 90th percentile of those 120 |
| interface memory after long use | The interface's JavaScript heap after a garbage collection, after the 120 switches |
| interface memory growth over long use | That heap minus the heap before the 120 switches: memory a long session piles up |
| DOM nodes after long use, and their growth | The same for the page's DOM nodes, which show views that are never let go |
| core memory after long use, and its growth | The core process's working set, as the system counts it |

Switch times use the page's own clock: from the key event's time stamp to the first animation frame with the app's
panel visible, so Playwright's polling is not part of the figure. An hour of use is compressed into 120 switches; what
grows across them and is not given back is what an hour would pile up.

## Reading the figures

Each run's figures are in the run summary of the shard that ran `speed.spec.ts` (Actions › Windows end-to-end › the
run › Summary), in a table beside its budget. They come from a debug build on a shared CI machine, so they are slower
than a release build on a person's computer. Compare them with each other, not with a stopwatch at home.

## Budgets

Budgets are in `apps/desktop/e2e/speed-budgets.json`, set from what CI measured with room for the machine's ups and
downs. A budget of 0 is measured only. Lower a budget when a fix makes something faster, so it stays fast; raise one
only with a reason in the pull request.

The first budgets (19 November 2026) are about one and a half times the first CI run: start 2.3 s, first start 3.0 s,
a 2,000-page notebook 0.84 s, a switch 47 ms at the median but 0.84 s at the slowest tenth (going back to Notes draws
every page of the long notebook again), interface heap 25 MB growing 10 MB over the 120 switches, 3,900 DOM nodes
growing 860, core 12 MB. The slowest, Notes' long list, is the first to fix.
