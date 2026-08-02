# Release Checklist

Use this checklist before publishing a new Chrome Web Store build. (This is the executable checklist; AGENTS.md release rules and `docs/PROJECT_DIRECTORY.md` §6 "版本同步点" describe the same version-sync gate at a higher level — keep the three reconciled.)

1. Update the version in `manifest.json` and `package.json`; if `package-lock.json` exists, keep its package version in sync.
2. Update the README version badge to the same version.
3. Move the relevant `CHANGELOG.md` `Unreleased` entries into `## [YYYY-MM-DD] [x.y.z]` using the actual local release date.
4. Run `npm run lint` (baseline is 0 errors, 0 warnings — do not regress), then `npm run test:unit`. (Or `npm run verify:full` to chain lint → unit → smoke, matching the CI gate.)
5. Run `npm run test:smoke` (headless by default; use `PLAYWRIGHT_HEADLESS=false npm run test:smoke` only for interactive debugging).
6. Run `npm run benchmark:drag` and compare every result with `docs/DRAG_PERFORMANCE_BASELINE.md`. The 500-row limits are: 50-selected prepare p95 ≤ 18.59ms, single callback p95 ≤ 2.64ms, 50-selected callback p95 ≤ 5.83ms, and prepare forced-layout phases ≤ 3; the documented geometry/query call limits must also pass.
7. Run `npm run benchmark:manager`. It performs 5 warm-up and 20 measured runs at 100/500/1000/5000 sources. Require synchronous input p95 ≤ 16ms; search, Quick View, Tag filter, and batch-selection p95 ≤ 100ms through 1000 rows and ≤ 250ms at 5000 rows. At 500+ rows, confirm windowing is active, materialized rows stay within `windowEnd - windowStart + pinnedCount`, and logical selection/counts still cover every visible source. Retain the output containing commit SHA, device/CPU, Chromium, p50/p95/max, logical/materialized row counts, and per-sample DOM mutation, querySelector/querySelectorAll, and layout-read counts. The isolated-world instrumentation must report all 15 expected APIs with zero install/restore failures.
8. Run `git diff --check`.
9. Run `npm run package`.
10. Confirm the zip is named `gemininotebook-source-management-<version>.zip`.
11. Confirm the zip contains only extension runtime files:
   - `manifest.json`
   - `src/**`
   - `_locales/**`
   - `PRIVACY.md` when present
12. Load the unpacked extension in Chrome and run a quick manual pass:
   - popup launcher opens the in-page manager
   - source panel injects correctly
   - settings import/export opens
   - folders, search, tags, batch actions, and Undo still work
13. Use the Browser path against a synthetic Notebook fixture for desktop, 240/320px narrow panel, dark mode, and forced-colors screenshots plus interaction QA. Native rename/delete/move must run only in the synthetic fixture; on a signed-in live Gemini Notebook page, limit validation to read-only injection, manager visibility, and sanitized console checks.
