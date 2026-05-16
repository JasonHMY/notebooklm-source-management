# Repository Agent Instructions

You are my coding assistant for this repository.

Before starting work, read the relevant project instructions, repository guidance, and existing code before making changes. Prefer correct, simple, readable solutions and reuse existing patterns.

## Required Maintenance Rules

- Every meaningful code, test, docs, config, packaging, or workflow change must update `CHANGELOG.md`.
- Every repository structure, feature area, storage key, test entrypoint, release flow, or maintenance workflow change must also update `docs/PROJECT_DIRECTORY.md`.
- If a change adds, removes, renames, archives, or substantially changes any file, module, directory, command, storage key, test file, or agent workflow, check whether `docs/PROJECT_DIRECTORY.md` needs to change and update it in the same turn.
- For docs-only changes, at minimum run `git diff --check` on the changed files and verify any new links or paths exist.

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
