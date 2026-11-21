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
| switch to the slowest app | The highest of the six apps' own medians over those 120; over budget, it is measured twice more (ten rounds each) and the median of the three is kept, as CI machines differ by about a third from run to run |
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

The test measures in a 1440 × 900 window: the size of a laptop, and wide enough for Mail and Calendar to show their
panels. The budgets (19 November 2026) are about one and a half times the slower of a run's two tries at that size:
start 2.2 to 3.5 s, a 2,000-page notebook 0.25 to 0.35 s, a switch 145 ms at the median and 0.34 to 0.39 s at the
slowest tenth (Notes and Calendar are the slowest to switch to, at 0.23 and 0.19 s), interface heap 25 MB growing
11 MB over the 120 switches, 3,900 DOM nodes growing 860, core 12 MB.

On 21 November 2026, after #711 and #709, the slowest app's median was 89 to 136 ms (Notes, then Calendar) and the
slowest app got a budget of its own, 150 ms. Its medians over three measures keep a slow machine from failing it.

Notes drew every page of a long notebook each time it opened, which took 0.84 s for 2,000 pages in a smaller window.
It now draws the first 100 and more as the list scrolls. Next is switching itself, which costs over 100 ms even
between simple apps at this size.

## Where switching spends its time

The test also profiles two rounds of switching (12 switches) and prints where the time went, as `[speed profile]`
lines in the log. It maps the time back to source files through the build's source maps. The first profile
(19 November 2026, about 100 ms per switch at 1440 × 900) showed:

- **React and the app's own code** take about 11 ms a switch.
- **The browser's own work** (style, layout and paint, shown as "(program)") takes about 60 ms a switch.
- **Notes** adds about 25 ms to mount its editor (ProseMirror).
- **Playwright's injected script** (`visitNode`, `query`, `getBoundingClientRect` from its locators) makes up much of
  the rest. That is the test's cost, and it falls outside the measured window.

So switching is mostly the price of drawing a whole new app.

**An option, not taken (19 November 2026).** The way to cut switching further is to keep apps the person has visited
mounted but hidden (for example with `content-visibility: hidden`), so going back skips most of the style and layout
work. That would change every app's lifecycle: hidden apps keep their effects running, focus and keys need care, and
memory goes up. All that for a few tens of milliseconds, when about 100 ms is already at the edge of feeling instant.
It stays an option, to revisit if Andrew or a polish pass feels the switch.

The switch budget is 200 ms. The runners vary about twofold: on 19 November 2026 the same code measured a 74 ms
median on one runner and 163 ms on another, which failed a budget of 150 ms. 200 ms sits above the slowest runner yet
below what a real regression (twice the work) gives on it.
