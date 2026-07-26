# Drag Performance Baseline

## Environment

The measurements below were recorded on 2026-07-26 in the local macOS Chromium test environment:

- Chrome/user agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36`
- OS/platform: macOS / `MacIntel` (Node platform: `darwin`)
- CPU model: `Apple M3 Max`; logical processors: `14`
- Samples per case: 5 warm-up and 20 measured drag-start prepare sessions; 10 warm-up and 50 measured manager-active callbacks.

## Method

`npm run benchmark:drag` runs only when `DRAG_BENCHMARK=1`. It uses the existing synthetic Gemini Notebook shell, gives every row a deterministic non-empty title, enables reflow drag mode, and creates exactly two groups. Ten sources are distributed into each group. The 50-item selection combines those 20 grouped rows with two separated deterministic root-row ranges (15 rows each); the single-item origin remains an unselected root source (0091 for the 100-row fixture, 0491 for the 500-row fixture).

Each row-count/selection case uses 5 warm-up and 20 measured drag-start prepare sessions, followed by 10 warm-up and 50 measured manager-active dragover callbacks. CPU measurements use `performance.now()` around synchronous handler/callback work, never adjacent rAF timestamps. The fixture counts `getBoundingClientRect`, `querySelector`, and `querySelectorAll`; it also marks the first geometry read after an observed DOM write as a forced-layout-read phase. Only rAF callbacks that are manager-active and change a DOM counter are included.

## Before Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | 6.4 / 7.0 | 1 | 1.0 / 1.8 | 626 | 31,450 | 68,084 |
| 100 | 50 | 13.5 / 14.2 | 1 | 0.2 / 0.8 | 187 | 34,920 | 67,827 |
| 500 | 1 | 24.8 / 25.9 | 1 | 1.1 / 1.9 | 640 | 153,031 | 336,887 |
| 500 | 50 | 22.1 / 22.8 | 1 | 0.0 / 4.9 | 187 | 157,320 | 336,627 |

## After Optimization

| Rows | Selection | Prepare p50 / p95 (ms) | Prepare forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

## Acceptance Comparison

Acceptance is intentionally deferred until the planned drag hot-path changes have an After Optimization measurement collected with the same command and environment.
