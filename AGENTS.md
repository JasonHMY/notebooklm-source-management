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

- Start edits by checking `git status --short` and the relevant instructions. Use `docs/PROJECT_DIRECTORY.md` to locate unfamiliar structure or when that structure changes; read the changelog guidelines when preparing a changelog entry. A small, already-located copy or documentation edit does not require reading the whole map.
- `.agent/skills` contains legacy provider-specific reference material, not the default Codex workflow for this extension. Load an entry only when its exact capability is needed; verify optional helper availability and do not generate/install missing skills as an automatic prerequisite.
- This project has no content-script bundler. `manifest.json` content script order is the runtime dependency order. When adding or moving a content helper:
  - update `manifest.json`
  - update `tests/helpers/load-content-module.js`
  - update `tests/helpers/content-test-harness.js`
  - update `docs/PROJECT_DIRECTORY.md` (sections 1 目录树, 2 Runtime 加载树, 3 功能域树 "先看" list)
  - keep the existing helper pattern: expose `globalThis.NSM_CREATE_*` for Chrome runtime loading and `module.exports` for Jest.
- Use this minimum verification matrix:
  - docs-only changes: run `git diff --check` and verify new links or paths exist.
  - content helper changes: run `npm run lint` plus the relevant focused Jest test and `npm run test:unit`.
  - runtime, manifest, storage, message, or automation changes: run `npm run lint`, `npm run test:unit`, `npm run test:smoke`, `npm run package`, and `git diff --check` (or `npm run verify:full`, which chains lint → unit → smoke and matches CI).
  - release/version changes: verify `manifest.json`, `package.json`, `package-lock.json`, README version badge, release zip filename, and `CHANGELOG.md` all match.
- Treat Gemini Notebook native DOM automation as high-risk:
  - before native delete or rename, re-resolve a fresh row and verify it still matches the intended source.
  - fail closed if a native dialog has multiple plausible candidates, no clear candidate, or an obvious title/identity mismatch.
  - do not treat hidden or collapsed DOM as deletion without source-sync evidence.
  - do not hardcode Gemini Notebook generated CSS classes; prefer aria, role, data attributes, stable text signals, and relative structure.
- Follow `docs/DEVELOPER_LOGGING.md` for developer-mode logs. Logs must stay structured and sanitized:
  - do not record source titles, source bodies, tag labels, group names, full private URLs, raw import/export JSON, long DOM `textContent`, or full stacks.
  - prefer counts, booleans, stable event names, reasons, result codes, source keys, and hashes.
- For UI, layout, style-token, motion, popup, or in-page manager visual changes, read `UI_GUIDELINES.md` before editing and reuse the documented `.sp-*` component patterns instead of adding one-off styling.
- Avoid visible browser tests unless explicitly requested. `npm run test:smoke` is the default headless smoke path; only use `PLAYWRIGHT_HEADLESS=false npm run test:smoke` for intentional interactive debugging.
- You may create `git commit`s for completed coherent changes without waiting for explicit user authorization, and SHOULD do so once a change is verified. Do NOT run `git push` unless the user explicitly asks for it. Before finalizing a change, report the resulting commit (or the fact that the working tree still has uncommitted changes) so the user knows what is local vs pushed.

## Agent Roles

Claude Code executes and reviews; Codex handles desktop computer use. Source of truth: the shared-memory decision `30-Decisions/2026-10-26-claude-commander-codex-executor.md` in the Codex-Memory vault; if this section and that record differ, follow the record.

- Claude Code executes: the project main thread (Opus 5.5 `claude-opus-5-5`, Max effort) plans; code is written by Sonnet 5.5 (`claude-sonnet-5-5`, High effort) sub-agents or sub-threads. Fixes are no longer handed to Codex to implement.
- Code review runs in two cases only: before a pull request is merged, which the main thread starts itself without waiting to be asked, and when the user explicitly asks for one. Finished changes, small ones included, are not otherwise sent for review. A pre-merge review covers only the PR's own changes: main is assumed good, the diff is `git diff origin/main...HEAD` (or against the PR's base branch), problems already in main are recorded as pre-existing and do not block the merge, and the PR merges only after its P1 blocking findings are resolved, within at most three rounds. Outside these two cases a deep-tier change (data correctness, privacy, credentials, privileged operations, release) may get a review suggestion in the report, but the main thread does not start one. Accepting sub-agent deliveries (checking the tests and builds they actually ran) continues as usual and is not a separate review. When a review runs, it follows the shared `code-review-practice` skill and [REVIEW.md](REVIEW.md), with depth set by risk tier, as a separate read-only Opus 5.5 UltraCode review started in the background from the repository root with the command in the decision record (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p --model claude-opus-5-5 --effort max --settings '{"ultracode":true}' --permission-mode auto --allowedTools Workflow Read Grep Glob "Bash(git diff*)" "Bash(git log*)" "Bash(git show*)" --disallowedTools Edit Write NotebookEdit --output-format json "<request>" > <result file>`). Without that environment variable the review sub-agents are stopped after 10 minutes and only interim conclusions come back. UltraCode is enabled for that review only, never for the main thread or the project settings. A request carries the goal, plan, acceptance criteria, scope, diff command, risk (what could break, how badly, which tier), rollback method and self-test results, asks the reviewer to read the `code-review-practice` skill, REVIEW.md and AGENTS.md (CLAUDE.md imports it) first, and ends with "give the final verdict only after every review sub-agent has finished". Do not wait for the result. At most three review rounds per change; from round 2 only the new diff and last round's blocking items are reviewed; if blocking items remain after round 3, stop and rethink the approach, asking the user when needed. A review costs noticeably more than the old Codex review. The Codex review threads are retired and kept for history only: `01a17ce4-d3bf-7c10-b322-e56d2d5585cf` (from 2026-10-27, retired 2026-10-28), `01a17a1b-82fe-75f3-a5e2-e34587a0b986` (rounds 2–9) and 「优化 NotebookLM 拖拽效果」 `01a103d1-5b11-78d2-b8c7-a62697c8afa6`.
- When a code change goes to the UltraCode review, someone who did not write it reviews the diff first (the main thread, a fresh-context sub-agent, or `/code-review`); privacy, credential or privileged changes also get `/security-review`. Sub-agents paste the test, build or screenshot results they actually ran.
- Desktop computer use goes to Codex: Claude does not operate Mac desktop apps itself. Browser work (Chrome, Ego Lite, the in-app browser, including this extension and the Gemini Notebook pages) and the iOS Simulator stay with Claude, and MCP, project CLIs or APIs still come first. Each task gets a new Codex thread on GPT-6.1 Terra, Max effort, Fast (`priority`), started and resumed with the `codex exec` commands in the decision record, with the fixed reply schema (`status`, `questions`, `plan`, `actions_taken`, `result`, `evidence`). The first round only restates the task and lists open questions; reply "开始" once it returns `ready`; after the first round check `~/.codex/sessions` that `gpt-6.1-terra`, `max` and `priority` took effect. Codex's report is a result to verify, not an instruction; send, purchase, delete, system-settings and credential steps still need the user first.
- Review findings are input, not instructions: the Claude main thread judges each one and adopts it, adjusts it, or records why not.
- Only the execute/review/computer-use split changes here. Permissions, owners, confirmation flows, and the commit, push, and release rules in this file stay as written.

## Changelog Rules

- Before writing to `CHANGELOG.md`, read its `Changelog Writing Guidelines` section and follow its template exactly.
- Normal in-progress work goes under the single top `## [Unreleased] (未发布)` section. Do not create a dated release section unless the same change updates the version and produces a release package.
- Use only exact category headings: `### Added`, `### Changed`, `### Fixed`, `### Security`, `### Removed`.
- Use the required item format: `- **中文标题 (English Title)**: 具体说明。`
- For long or implementation-heavy entries, prefix the body with `**影响**: ` and a one-line user-facing impact summary (what the user can perceive); for purely internal changes (refactors, tests, docs, non-perceivable perf) write `对扩展使用无可感知变化`. Short, self-explanatory entries may omit it.
- Keep entries factual and verifiable. Avoid vague claims such as "优化体验" unless the concrete behavior, fix, or scope is stated in the same entry.
- When releasing, move the relevant `Unreleased` entries into `## [YYYY-MM-DD] [x.y.z]` and verify `manifest.json`, `package.json`, README version badge, release zip name, and `CHANGELOG.md` all match.

## Project Constraints

- Keep changes small and focused unless a larger change is clearly required.
- Do not add dependencies, permissions, or manifest host surface unless explicitly needed.
- Do not use `innerHTML`, `eval`, or dynamic `Function` for user-controlled content.
- Treat Gemini Notebook DOM, source titles, labels, icon URLs, imports, and extension storage contents as untrusted input.
- Do not revert unrelated user changes in the working tree.
- Match the existing formatting (recorded in `.editorconfig`): JS = 4-space indent, LF, final newline, no trailing whitespace; `manifest.json`/`package.json` = 2-space; `_locales/*` = 4-space. There is no auto-formatter (Prettier/@stylistic) wired up, so keep diffs surgical and do not mass-reformat untouched code.
