# Drag Performance Baseline

## Environment

The measurements below were recorded on 2026-07-26 in the local macOS Chromium test environment:

- Chrome/user agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36`
- OS/platform: macOS / `MacIntel` (Node platform: `darwin`)
- CPU model: `Apple M3 Max`; logical processors: `14`
- Samples per case: 5 warm-up and 20 measured drag-start prepare sessions; 10 warm-up and 50 measured manager-active callbacks.
- Before commit: `10edf37517d24824eda0fd9c3615133c3def63af`.

## Method

`npm run benchmark:drag` runs only when `DRAG_BENCHMARK=1`. It uses the existing synthetic Gemini Notebook shell, gives every row a deterministic non-empty title, enables reflow drag mode, and creates exactly two groups. Ten sources are distributed into each group. The 50-item selection combines those 20 grouped rows with two separated deterministic root-row ranges (15 rows each); the single-item origin remains an unselected root source (0091 for the 100-row fixture, 0491 for the 500-row fixture).

Each row-count/selection case uses 5 warm-up and 20 measured drag-start prepare sessions, followed by 10 warm-up and 50 measured manager-active dragover callbacks. CPU measurements use `performance.now()` around synchronous handler/callback work, never adjacent rAF timestamps. Immediately before every prepare, the fixture reproduces the state after the trusted pointerdown that precedes a real next drag: it removes the prior dragend pseudo-hover bridge, reads the source list's `offsetHeight` to settle that restyle outside the timed interval, resets all instrumentation, and asserts that call/write/pending/forced-layout counters are zero. It then snapshots the synchronous dragstart result before fold or dragend work can run. Both `getBoundingClientRect` and `offsetHeight` are geometry reads; only real structural, class, style, or attribute mutations arm a forced-layout-read phase.

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

## Acceptance Comparison

Acceptance is intentionally deferred until the planned drag hot-path changes have an After Optimization measurement collected with the same command and environment.
