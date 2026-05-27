# Repository Agent Instructions

You are my coding assistant for this repository.

Before starting work, read the relevant project instructions, repository guidance, and existing code before making changes. Prefer correct, simple, readable solutions and reuse existing patterns.

## Required Maintenance Rules

- Every meaningful code, test, docs, config, packaging, or workflow change must update `CHANGELOG.md`.
- Every repository structure, feature area, storage key, test entrypoint, release flow, or maintenance workflow change must also update `docs/PROJECT_DIRECTORY.md`.
- If a change adds, removes, renames, archives, or substantially changes any file, module, directory, command, storage key, test file, or agent workflow, check whether `docs/PROJECT_DIRECTORY.md` needs to change and update it in the same turn.
- For docs-only changes, at minimum run `git diff --check` on the changed files and verify any new links or paths exist.
- Pure read-only inspection, status reporting, or analysis with no file changes does not require a changelog entry.

## Project-Specific Workflow Rules

- Start every code, test, docs, config, packaging, or workflow task by checking:
  - `AGENTS.md`
  - `docs/PROJECT_DIRECTORY.md`
  - the `Changelog Writing Guidelines` section at the top of `CHANGELOG.md`
  - `git status --short`
- This project has no content-script bundler. `manifest.json` content script order is the runtime dependency order. When adding or moving a content helper:
  - update `manifest.json`
  - update `tests/helpers/load-content-module.js`
  - update `tests/helpers/content-test-harness.js`
  - keep the existing helper pattern: expose `globalThis.NSM_CREATE_*` for Chrome runtime loading and `module.exports` for Jest.
- Use this minimum verification matrix:
  - docs-only changes: run `git diff --check` and verify new links or paths exist.
  - content helper changes: run the relevant focused Jest test plus `npm run test:unit`.
  - runtime, manifest, storage, message, or automation changes: run `npm run test:unit`, `npm run test:smoke`, `npm run package`, and `git diff --check`.
  - release/version changes: verify `manifest.json`, `package.json`, `package-lock.json`, README version badge, release zip filename, and `CHANGELOG.md` all match.
- Treat NotebookLM native DOM automation as high-risk:
  - before native delete or rename, re-resolve a fresh row and verify it still matches the intended source.
  - fail closed if a native dialog has multiple plausible candidates, no clear candidate, or an obvious title/identity mismatch.
  - do not treat hidden or collapsed DOM as deletion without source-sync evidence.
  - do not hardcode NotebookLM generated CSS classes; prefer aria, role, data attributes, stable text signals, and relative structure.
- Follow `docs/DEVELOPER_LOGGING.md` for developer-mode logs. Logs must stay structured and sanitized:
  - do not record source titles, source bodies, tag labels, group names, full private URLs, raw import/export JSON, long DOM `textContent`, or full stacks.
  - prefer counts, booleans, stable event names, reasons, result codes, source keys, and hashes.
- For UI, layout, style-token, motion, popup, or in-page manager visual changes, read `UI_GUIDELINES.md` before editing and reuse the documented `.sp-*` component patterns instead of adding one-off styling.
- Avoid visible browser tests unless explicitly requested. `npm run test:smoke` is the default headless smoke path; only use `PLAYWRIGHT_HEADLESS=false npm run test:smoke` for intentional interactive debugging.
- You may create `git commit`s for completed coherent changes without waiting for explicit user authorization, and SHOULD do so once a change is verified. Do NOT run `git push` unless the user explicitly asks for it. Before finalizing a change, report the resulting commit (or the fact that the working tree still has uncommitted changes) so the user knows what is local vs pushed.

## Changelog Rules

- Before writing to `CHANGELOG.md`, read its `Changelog Writing Guidelines` section and follow its template exactly.
- Normal in-progress work goes under the single top `## [Unreleased] (未发布)` section. Do not create a dated release section unless the same change updates the version and produces a release package.
- Use only exact category headings: `### Added`, `### Changed`, `### Fixed`, `### Security`, `### Removed`.
- Use the required item format: `- **中文标题 (English Title)**: 具体说明。`
- Keep entries factual and verifiable. Avoid vague claims such as "优化体验" unless the concrete behavior, fix, or scope is stated in the same entry.
- When releasing, move the relevant `Unreleased` entries into `## [YYYY-MM-DD] [x.y.z]` and verify `manifest.json`, `package.json`, README version badge, release zip name, and `CHANGELOG.md` all match.

## Project Constraints

- Keep changes small and focused unless a larger change is clearly required.
- Do not add dependencies, permissions, or manifest host surface unless explicitly needed.
- Do not hardcode NotebookLM generated CSS classes; prefer aria, role, data attributes, stable text signals, and relative structure.
- Do not use `innerHTML`, `eval`, or dynamic `Function` for user-controlled content.
- Treat NotebookLM DOM, source titles, labels, icon URLs, imports, and extension storage contents as untrusted input.
- Do not revert unrelated user changes in the working tree.
