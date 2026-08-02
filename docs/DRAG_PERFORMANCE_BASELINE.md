# Drag Performance Baseline

## Environment

The Before measurements below were recorded on 2026-07-26 and the final Drag
gate After measurements on 2026-07-27 in the same local macOS Chromium test
environment:

- Chrome/user agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36`
- OS/platform: macOS / `MacIntel` (Node platform: `darwin`)
- CPU model: `Apple M3 Max`; logical processors: `14`
- Samples per case: 5 warm-up and 20 measured drag-start prepare sessions; 10 warm-up and 50 measured manager-active callbacks.
- Before commit: `10edf37517d24824eda0fd9c3615133c3def63af`.
- Final Drag gate commit: `e701c2e6f31c27973f668c67c983227a3286bbc9`.

## Method

`npm run benchmark:drag` runs only when `DRAG_BENCHMARK=1`. It uses the existing synthetic Gemini Notebook shell, gives every row a deterministic non-empty title, enables reflow drag mode, and creates exactly two groups. Ten sources are distributed into each group. The 50-item selection combines those 20 grouped rows with two separated deterministic root-row ranges (15 rows each); the single-item origin remains an unselected root source (0091 for the 100-row fixture, 0491 for the 500-row fixture).

Each row-count/selection case uses 5 warm-up and 20 measured drag-start prepare sessions, followed by 10 warm-up and 50 measured manager-active dragover callbacks. CPU measurements use `performance.now()` around synchronous handler/callback work, never adjacent rAF timestamps. Immediately before every prepare, the fixture reproduces the state after the trusted pointerdown that precedes a real next drag: it removes the prior dragend pseudo-hover bridge, reads the source list's `offsetHeight` to settle that restyle outside the timed interval, resets all instrumentation, and asserts that call/write/pending/forced-layout counters are zero. It then snapshots the synchronous dragstart result before fold or dragend work can run. Both `getBoundingClientRect` and `offsetHeight` are geometry reads; only real structural, class, style, or attribute mutations arm a forced-layout-read phase.

At the 500-row scale, source windowing is part of the contract: the benchmark requires
the complete logical projection (`logicalSourceCount === 500`), active windowing, and
fewer materialized rows than logical rows. It derives the deterministic synthetic
source-key prefix from the initial mounted row, then uses the source-window ordinal to
temporarily mount only the drag origin and nearby non-selected callback targets. The
50-source path selects through those temporary windows, verifies the full logical
selection through `pendingSelected`, and verifies that dragstart carries all 50 keys in
`application/source-keys`. Geometry-read expectations use the recorded materialized
selection subset rather than incorrectly requiring all logical selected sources to be
in the DOM at once. The benchmark output records both logical and materialized selection
counts; the established timing and geometry/query acceptance limits are unchanged.

The isolated-world rAF wrapper assigns a monotonic logical ID to every callback. After the dragstart fold IDs are drained, each dragover must synchronously schedule exactly one new ID; that exact ID is registered before yielding and must complete with exactly one `{ callbackId, duration, callsDelta }` sample. The 10/50 sample ID sets must exactly match their target ID sets. DOM call totals include only measured synchronous prepare deltas plus the exact 50 measured target-callback deltas, excluding fixture setup, fold, dragend, bridge, and unrelated rAF work.

## Before Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | 5.9 / 6.5 | 1 | 0.9 / 1.9 | 609 | 864 | 399 |
| 100 | 50 | 14.7 / 15.2 | 1 | 0.2 / 0.8 | 162 | 1,186 | 142 |
| 500 | 1 | 6.2 / 7.4 | 1 | 1.3 / 2.4 | 607 | 900 | 399 |
| 500 | 50 | 14.9 / 16.9 | 1 | 0.0 / 5.3 | 162 | 1,586 | 142 |

## After Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | 1.8 / 2.0 | 3 | 0.5 / 0.8 | 357 | 20 | 21 |
| 100 | 50 | 10.5 / 11.2 | 3 | 0.7 / 1.2 | 637 | 0 | 21 |
| 500 | 1 | 2.6 / 2.9 | 3 | 0.4 / 1.2 | 757 | 20 | 21 |
| 500 | 50 | 12.2 / 12.9 | 3 | 1.0 / 2.0 | 1,037 | 0 | 21 |

## Acceptance Comparison

All acceptance gates passed:

| Gate | Limit | Result |
| --- | ---: | ---: |
| 500 rows / 50 selected prepare p95 | ≤ 18.59 ms | 12.9 ms |
| 500 rows / 1 selected callback p95 | ≤ 2.64 ms | 1.2 ms |
| 500 rows / 50 selected callback p95 | ≤ 5.83 ms | 2.0 ms |
| Prepare forced-layout phases | ≤ 3 | 3 |
| 100 rows / 1 selected combined geometry/query calls | < 1,872 | 398 |
| 100 rows / 50 selected combined geometry/query calls | < 1,490 | 658 |
| 500 rows / 1 selected combined geometry/query calls | < 1,906 | 798 |
| 500 rows / 50 selected combined geometry/query calls | < 1,890 | 1,058 |

At 500 rows, callback p95 fell from 2.4 ms to 1.2 ms for a single source and
from 5.3 ms to 2.0 ms for 50 selected sources. The 50-selection prepare p95
fell from 16.9 ms to 12.9 ms. Combined geometry/query calls fell by 58.1% for
the single-source case and 44.0% for the 50-source case.

The implementation now batches each drag frame into one geometry snapshot,
pure planning, and a write phase. Clean frames reuse the snapshot; exact root
or nested-scroll deltas patch cached rects, while render, size, mixed, or
unverifiable invalidations rebuild fail closed. Typed source/group maps avoid
per-row selectors. Only rows in the viewport plus one physical row of overscan
animate their reflow transform; shifted offscreen rows use static transforms,
and their static class is retained while a shift is cleared so the base row
transition cannot accidentally animate hundreds of offscreen elements.

Two additional clean 500-row runs confirmed the result before the full matrix:

- Run 1 callback p95: 1.4 ms (single), 1.8 ms (50 selected).
- Run 2 callback p95: 0.7 ms (single), 2.7 ms (50 selected).
