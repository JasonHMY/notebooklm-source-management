# Drag Performance Baseline

## Environment

The measurements below were recorded on 2026-07-26 in the local macOS Chromium test environment:

- Chrome/user agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36`
- OS/platform: macOS / `MacIntel` (Node platform: `darwin`)
- CPU model: `Apple M3 Max`; logical processors: `14`
- Samples per case: 5 warm-up and 20 measured drag-start prepare sessions; 10 warm-up and 50 measured manager-active callbacks.

## Method

`npm run benchmark:drag` runs only when `DRAG_BENCHMARK=1`. It uses the existing synthetic Gemini Notebook shell, gives every row a deterministic non-empty title, enables reflow drag mode, and creates exactly two groups. Ten sources are distributed into each group. The 50-item selection combines those 20 grouped rows with two separated deterministic root-row ranges (15 rows each); the single-item origin remains an unselected root source (0091 for the 100-row fixture, 0491 for the 500-row fixture).

Each row-count/selection case uses 5 warm-up and 20 measured drag-start prepare sessions, followed by 10 warm-up and 50 measured manager-active dragover callbacks. CPU measurements use `performance.now()` around synchronous handler/callback work, never adjacent rAF timestamps. Immediately before every prepare, the fixture resets only the pending/count layout phase, then snapshots the synchronous dragstart result before fold or dragend work can run. Both `getBoundingClientRect` and `offsetHeight` are geometry reads; only real structural, class, style, or attribute mutations arm a forced-layout-read phase.

The isolated-world rAF wrapper assigns a monotonic logical ID to every callback. After the dragstart fold IDs are drained, each dragover must synchronously schedule exactly one new ID; that exact ID is registered before yielding and must complete with exactly one `{ callbackId, duration, callsDelta }` sample. The 10/50 sample ID sets must exactly match their target ID sets. DOM call totals include only measured synchronous prepare deltas plus the exact 50 measured target-callback deltas, excluding fixture setup, fold, dragend, bridge, and unrelated rAF work.

## Before Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | 7.1 / 8.0 | 1 | 1.3 / 1.8 | 592 | 902 | 399 |
| 100 | 50 | 16.8 / 17.4 | 1 | 0.2 / 0.9 | 162 | 1,186 | 142 |
| 500 | 1 | 13.0 / 14.2 | 1 | 1.2 / 1.9 | 605 | 900 | 399 |
| 500 | 50 | 23.9 / 25.1 | 1 | 0.0 / 5.7 | 162 | 1,586 | 142 |

## After Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

## Acceptance Comparison

Acceptance is intentionally deferred until the planned drag hot-path changes have an After Optimization measurement collected with the same command and environment.
