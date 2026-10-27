# REVIEW.md

Review rules for this repository. Read this before reviewing any change, whether you are the Codex review thread or a Claude reviewer. Project rules live in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md); this file only adds what a review needs. Source: shared-memory decision `30-Decisions/2026-10-26-claude-commander-codex-executor.md`, section 审核做法.

## Tiers

Pick the tier by what the change touches, not by who wrote it. When unsure, go one tier up.

- **Light**: docs, comments, rule files or wording only. The main thread checks it; it is not sent to Codex on its own.
- **Standard**: ordinary code. Codex reviews this round's diff and the code it directly touches.
- **Deep**: data correctness (state, storage, reconcile/remap, import/export, migrations), privacy, credentials, native actions on Gemini Notebook (delete, rename, any automatic click), or release and store delivery. Codex does a full review against every item below.

## Blocking in this project

- **Native automation**: deleting or renaming without re-resolving a fresh row and verifying its identity; any new automatic click on a native control; clicking a direct-action control such as auto-label or relabel; not failing closed when the target is ambiguous or missing.
- **Data loss**: any path where a source that still exists can lose its folder placement, tags, enabled state or record; a stale write overwriting newer storage; a schema, storage-key or export-format change without a migration and a `docs/STORAGE_SCHEMA.md` update.
- **Privacy**: logs, diagnostics or exports that record source titles or bodies, labels, group names, full private URLs or raw import JSON; new data leaving the device; new permissions or host surface.
- **Security**: `innerHTML`, `eval` or `new Function` with Gemini- or user-derived content; unvalidated import input.
- **Release**: `manifest.json`, `package.json`, `package-lock.json`, README badge, CHANGELOG and zip versions disagree; files outside the allowlist, or conflict copies, in the package.
- **Tests**: a fix whose new tests would also pass on the old code, or an acceptance item that is not actually met.

## Check every round

- Native-click paths and their guards; identity, remap and drop paths; storage writes and the revision guard.
- `developerLog`: 4-argument signature, valid level and category, sanitized details (counts, booleans, reasons, keys).
- i18n: every new key exists in en, es and zh_CN with the same placeholders.
- A new content module keeps `manifest.json`, the test loader, the test harness and `docs/PROJECT_DIRECTORY.md` in sync.
- `CHANGELOG.md` (Unreleased, exact categories) and `docs/PROJECT_DIRECTORY.md` are updated as AGENTS.md requires.
- Reported test runs are real: commands and results are pasted, not summarized.

## Do not report

- Anything ESLint or CI already enforces, and formatting.
- Generated or local files: `package-lock.json` churn, `release/`, `output/`, `coverage/`, `node_modules/`, `docs/superpowers/plans/`, `.claude/`, `*.local.*`, `.vscode/`.
- Naming or style preferences that do not hide behavior (P3 at most).

## Format and limits

- Start with the number of findings and the verdict. If there is nothing, say so.
- Each finding: P1, P2 or P3; blocking or non-blocking; `file:line`; evidence from the code, not guesses from names; impact; fix. Problems this round did not introduce go in a separate "pre-existing" list and do not block the round.
- At most 5 minor (P3) findings per round. Report every location of the same problem at once.
- At most three review rounds per change. From round 2, review only the new diff and whether last round's blocking items are fixed. Do not repeat a finding already raised, or one already declined, without new evidence.
