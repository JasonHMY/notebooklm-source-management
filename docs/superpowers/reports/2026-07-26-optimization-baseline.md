# Optimization Hardening Baseline

## Environment

- Repository: `GeminiNotebook-Source-Management` (`gemininotebook-source-management@26.6.16`).
- Execution workspace: isolated `codex/optimization-hardening` worktree.
- Verification mode: default npm scripts; Playwright smoke suite ran headlessly with one worker.
- Baseline scope: no runtime, storage, drag, architecture, manifest, or dependency changes.

## Plan Start SHAs

Roadmap Start SHA: `2acbc1af65b394be448119da15312a5ec73634ca`
Storage Plan Start SHA: `050696e5dc3e316a9849140b79b732364c5e070a`
Drag Plan Start SHA: `083985bbaec2a7b1df99eabccff926e96967a624`

## Commands and Results

| Command | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS | ESLint completed with 0 errors and 0 warnings. |
| `npm run test:unit` | PASS | 46 of 46 suites passed; 1,137 of 1,137 tests passed; 0 snapshots. Existing tests intentionally emit expected diagnostic console output for failure-path coverage. |
| `npm run test:smoke` | PASS | 20 of 20 Playwright smoke tests passed in the default headless configuration. |

## Confirmed Failing Contracts

No planned red test was executed in this baseline, so none of the following is an observed failure. The future red-test contracts are recorded here as planned/unexecuted work only:

- Storage: `rejects a wrapped config with an unknown formatVersion`; `rejects an unknown envelope instead of treating data as a bare state`; `rejects a schema newer than v5 without scheduling a storage upgrade`; critical-import rollback; lifecycle and disable; queue ordering; manual retention; cross-notebook and concurrent lost-update; and the storage-contract module.
- Drag: filtered last-visible `resolveVisibleAnchorInsertIndex` mapping; Classic cross-notebook/load-path invariant; reflow box-model; drag geometry read/write budget; stationary-pointer auto-scroll; and pending-rAF native `dropEffect` feedback.
- Architecture: `applyPlacement moves a source from bin to root using object entry shape`; `applyPlacement removes stale duplicates from every old container`; `applyPlacement reports no_change without mutation`; `applyPlacement rejects a group-to-descendant cycle atomically`; `applyBatchPlacement preserves source order`; `applyPlacementTransaction rejects all commands when one command is invalid`; `addGroup commits the group record and root edge atomically`; `addGroup commits a nested subgroup record and parent edge atomically`; `removeSource clears every stale duplicate`; `removeGroup sends direct sources to the bin and promotes child groups to root in order`; `normalizePlacementState applies group-root-bin precedence`; `normalizePlacementState returns a new Map and never mutates import input`; `commitPlacementModel revalidates its carried liveSourceKeys and rejects a tampered normalized model without live state/Map mutation`; `sweepPositionedRootSourcesToBin is stable and idempotent`; plus the planned drag Adapter, batch/modal Adapter, normalization-consistency, search-semantics, keyboard domain/UI, and preferences-separation red-test contracts.

## Drag Benchmark Reference

The same-machine Before/After method and full counters are recorded in
`docs/DRAG_PERFORMANCE_BASELINE.md`. The final Drag gate at verified runtime
commit `e701c2e6f31c27973f668c67c983227a3286bbc9` produced:

| Rows | Selection | Prepare p50 / p95 (ms) | Forced-layout phases max | Callback p50 / p95 (ms) | getBoundingClientRect | querySelector | querySelectorAll |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | 1.8 / 2.0 | 3 | 0.5 / 0.8 | 357 | 20 | 21 |
| 100 | 50 | 10.5 / 11.2 | 3 | 0.7 / 1.2 | 637 | 0 | 21 |
| 500 | 1 | 2.6 / 2.9 | 3 | 0.4 / 1.2 | 757 | 20 | 21 |
| 500 | 50 | 12.2 / 12.9 | 3 | 1.0 / 2.0 | 1,037 | 0 | 21 |

All declared gates passed: 500-row/50-selection prepare p95 was 12.9 ms
(limit 18.59 ms); 500-row callback p95 was 1.2 ms for one selected source
(limit 2.64 ms) and 2.0 ms for 50 selected sources (limit 5.83 ms); forced
layout stayed at 3 phases; combined geometry/query calls were 398, 658, 798,
and 1,058, all below their respective Before baselines.

## Completed Work

- Captured the unchanged lint, unit, and headless smoke baseline before optimization implementation.
- Established this report as the shared execution ledger for the roadmap and subsequent plan start SHAs.
- Completed the Storage Integrity workflow through verified commit `39bdfa04b49cd939be8d20f66adc16c4d607a66f` (Storage plan start: `050696e5dc3e316a9849140b79b732364c5e070a`).
- Storage final verification passed: lint (0 errors, 0 warnings); focused Jest runs (232 of 232 and 275 of 275); unit tests (47 of 47 suites, 1,218 of 1,218 tests); isolated default-headless smoke (20 of 20); package (65 files); and security, package-surface, commit-range, and diff checks.
- Storage final review is clean: the four review findings were addressed, with no new Critical or Important breakage.
- Completed the Drag Correctness & Performance workflow through verified runtime commit `e701c2e6f31c27973f668c67c983227a3286bbc9` (Drag plan start: `083985bbaec2a7b1df99eabccff926e96967a624`).
- Drag final verification passed: the six-suite focused matrix (535 of 535); lint (0 errors, 0 warnings); unit tests (47 of 47 suites, 1,365 of 1,365 tests); authoritative headless smoke (25 passed, 1 opt-in benchmark skipped); Chromium layout/restore checks (5 of 5); package (65 files); working-tree and start-SHA range diff checks; and the four-case performance budget above. The restricted sandbox could not launch Chromium during the chained `verify:full` command, so the same smoke suite was rerun in the approved Chromium environment and passed in full.
- Drag final independent review found no P0/P1 issue. Its clean-snapshot positive-path, Classic normalization, snapshot-staleness, and `DataTransfer` lifetime P2 coverage gaps were added before the final commit.
- Drag rollback checks passed: Classic migration writes a restorable `before_classic_mode_sweep` history snapshot before its critical save and retains recovery on save failure; fold/unfold remains reflow-only, shared intent/auto-scroll/`dropEffect` implementations remain outside that Beta gate, Classic and Reflow intent/`dropEffect` paths have explicit coverage, and stationary-pointer auto-scroll refresh has its own regression tests.

## Deferred Non-Blocking Observations

- Architecture & Accessibility has not started; its start SHA will be captured immediately before its characterization task.
- No source titles, notebook identifiers, private URLs, or other notebook data were captured.
