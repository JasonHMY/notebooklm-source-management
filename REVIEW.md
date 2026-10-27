# Review instructions

Read this before reviewing any change in this repository. Use the shared `code-review-practice` skill (`~/.agents/skills/code-review-practice`) for the general method: tiers, finding format, round limits and answering findings. This file adds only what is specific to this project; the project rules are in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md), and both override the skill.

## Deep tier here

Treat these as deep: state, storage, reconcile/remap, import/export and migrations; anything that clicks or deletes on the Gemini Notebook page; permissions, privacy and logging; packaging and store releases.

## What counts as blocking (P1) here

- **Native automation**: deleting or renaming without re-resolving a fresh row and verifying its identity; any new automatic click on a native control; clicking a direct-action control such as auto-label or relabel; not failing closed when the target is ambiguous or missing.
- **Data loss**: any path where a source that still exists can lose its folder placement, tags, enabled state or record; a stale write overwriting newer storage; a schema, storage-key or export-format change without a migration and a `docs/STORAGE_SCHEMA.md` update.
- **Privacy**: logs, diagnostics or exports that record source titles or bodies, labels, group names, full private URLs or raw import JSON; new data leaving the device; new permissions or host surface.
- **Security**: `innerHTML`, `eval` or `new Function` with Gemini- or user-derived content; unvalidated import input.
- **Release**: `manifest.json`, `package.json`, `package-lock.json`, README badge, CHANGELOG and zip versions disagree; files outside the allowlist, or conflict copies, in the package.
- **Tests**: a fix whose new tests would also pass on the old code, or an acceptance item that is not actually met.

Style, naming and refactoring suggestions are P3 at most.

## Always check

- Native-click paths and their guards; identity, remap and drop paths; storage writes and the revision guard.
- `developerLog`: 4-argument signature, valid level and category, sanitized details (counts, booleans, reasons, keys).
- i18n: every new key exists in en, es and zh_CN with the same placeholders.
- A new content module keeps `manifest.json`, the test loader, the test harness and `docs/PROJECT_DIRECTORY.md` in sync.
- `CHANGELOG.md` (Unreleased, exact categories) and `docs/PROJECT_DIRECTORY.md` are updated as AGENTS.md requires.
- Reported test runs are real: commands and results are pasted, not summarized.

## Do not report

- Anything ESLint or CI already enforces, and formatting.
- Generated or local files: `package-lock.json` churn, `release/`, `output/`, `coverage/`, `node_modules/`, `docs/superpowers/plans/`, `.claude/`, `*.local.*`, `.vscode/`.

## Limits and evidence

- At most 5 P3 findings per review.
- Cite `file:line` for every behavior claim; don't infer behavior from names.
