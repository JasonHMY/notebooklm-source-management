# Optimization Hardening Baseline

## Environment

- Repository: `GeminiNotebook-Source-Management` (`gemininotebook-source-management@26.6.16`).
- Execution workspace: isolated `codex/optimization-hardening` worktree.
- Verification mode: default npm scripts; Playwright smoke suite ran headlessly with one worker.
- Baseline scope: no runtime, storage, drag, architecture, manifest, or dependency changes.

## Plan Start SHAs

Roadmap Start SHA: `2acbc1af65b394be448119da15312a5ec73634ca`
Storage Plan Start SHA: `050696e5dc3e316a9849140b79b732364c5e070a`

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

Drag Task 2 will create the benchmark record at `docs/superpowers/reports/2026-07-26-drag-benchmark.md`. No counters exist yet and none are inferred here.

## Completed Work

- Captured the unchanged lint, unit, and headless smoke baseline before optimization implementation.
- Established this report as the shared execution ledger for the roadmap and subsequent plan start SHAs.

## Deferred Non-Blocking Observations

- Package verification is intentionally deferred to the roadmap integration gate; it is not part of this unchanged baseline task.
- No source titles, notebook identifiers, private URLs, or other notebook data were captured.
