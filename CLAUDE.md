# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation Map (Authoritative Rules)

Read the relevant doc BEFORE making a change. Each doc is the source of truth for its area and overrides anything below. **This table is the single index of project docs**; for task-by-task routing ("I'm doing X → read Y") see the `nsm-discipline` skill.

| Doc | Source of truth for | Read when |
|---|---|---|
| **[AGENTS.md](AGENTS.md)** | maintenance + workflow rules, verification matrix, project constraints, native-DOM safety, auto-commit/no-push | before any change (always) |
| **[docs/PROJECT_DIRECTORY.md](docs/PROJECT_DIRECTORY.md)** | project map — directory tree, content-script load order (§2), feature-area tree (§3, fastest locator), test tree | locating code, changing structure/files |
| **[UI_GUIDELINES.md](UI_GUIDELINES.md)** | UI / tokens / `.sp-*` components / motion / popup | before any UI or style change |
| **`Changelog Writing Guidelines`** (top of [CHANGELOG.md](CHANGELOG.md)) | changelog entry format, fixed categories, `**影响**` summary rule, no marketing language | before writing CHANGELOG |
| **[docs/STORAGE_SCHEMA.md](docs/STORAGE_SCHEMA.md)** | chrome.storage / sessionStorage keys + persisted schema + migrations | changing a storage key, field, or migration |
| **[docs/MESSAGE_CONTRACTS.md](docs/MESSAGE_CONTRACTS.md)** | popup↔content↔background message types, payloads, sender validation | changing a message type or response shape |
| **[docs/DEVELOPER_LOGGING.md](docs/DEVELOPER_LOGGING.md)** | `developerLog` levels/categories/events + sanitization | writing a `developerLog` call |
| **[docs/SECURITY_THREAT_MODEL.md](docs/SECURITY_THREAT_MODEL.md)** | trust boundaries, attack surface, mitigations, severity calibration | security-relevant changes, hardening, untrusted input |
| **[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)** | release gate + version-sync points | publishing a build |
| **[PRIVACY.md](PRIVACY.md)** | outward privacy statement (permissions, data flow, no remote resources) | changing permissions, data flow, or remote resources |

(This file, **CLAUDE.md**, is the project overview — auto-loaded each session, so it is not listed as a separate "read when".)

## Commands

| Task | Command |
|---|---|
| Lint | `npm run lint` (ESLint flat config; baseline is 0 errors, 0 warnings — do not regress) |
| Unit tests | `npm run test:unit` |
| Single unit test file | `npx jest tests/content/<name>.test.js` |
| Named test in a file | `npx jest tests/content/<name>.test.js -t "<describe or it text>"` |
| Playwright smoke | `npm run test:smoke` (headless by default) |
| Smoke with visible browser (debug only) | `PLAYWRIGHT_HEADLESS=false npm run test:smoke` |
| Install Playwright Chromium once | `npm run playwright:install` |
| Full local CI gate | `npm run verify:full` (lint → unit → smoke; same as the GitHub Actions workflow) |
| Build release zip | `npm run package` |

## Architecture (Big Picture)

### Three independent runtime surfaces

- **Content script** (`src/content/index.js` + ~45 helper modules) — injected into `https://notebooklm.google.com/*`. Mounts a Shadow-DOM manager (`#sources-plus-root`) into Gemini Notebook's source panel. 90% of the code lives here.
- **Background service worker** (`src/background/index.js`) — owns `chrome.storage.local` writes via a queued + revision-guarded protocol; resolves tab focus/open requests from the popup.
- **Toolbar popup** (`src/popup/index.js`) — launcher only. Enables/disables the manager and switches Gemini Notebook source view; the real UI lives in the content panel.

### No bundler — factory + global registration pattern

Content scripts are loaded sequentially per `manifest.json` `content_scripts[0].js`. Each module is an IIFE that:

1. Registers a factory at `globalThis.NSM_CREATE_CONTENT_*`.
2. Also exports the factory via `module.exports` for Jest.

`src/content/index.js` is loaded last; it pulls every `NSM_CREATE_*` and assembles the factory graph by passing deps explicitly.

**When adding a new content module, FOUR files must stay in sync** (the first two are enforced by `tests/manifest-loader-sync.test.js`; the third is per [AGENTS.md](AGENTS.md) line 22-26 and is easy to forget):

1. `manifest.json` — insert in load order
2. `tests/helpers/load-content-module.js` — `require()` line + `delete globalThis.NSM_CREATE_*` in `clearContentGlobals()`
3. `tests/helpers/content-test-harness.js` — append the new global to the `CONTENT_HELPER_GLOBALS` array
4. `docs/PROJECT_DIRECTORY.md` — sections 1 (目录树), 2 (Runtime 加载树), 3 (功能域树 "先看" list)

### Shadow DOM vs global overlay boundary

CSS lives in **three** places by scope:

- **Inside Shadow DOM** (`#sources-plus-root`): manager UI, styled via `NSM_CONTENT_STYLE_TEXT` in [src/content/content-style-text.js](src/content/content-style-text.js). Tokens like `--sp-bg-button`, `--sp-text-primary`, `--sp-shadow-*` are declared on `:host` with light + dark variants.
- **Outside Shadow DOM** (`document.body`, `document.head`): only when Shadow DOM can't reach — native Material overlays, Gemini Notebook dialogs, drag ghosts. Styled via `NSM_GLOBAL_OVERLAY_STYLE_TEXT` (same file, second exported template string).
- **Native Gemini Notebook DOM overrides**: [src/content/styles.css](src/content/styles.css) is injected directly by `manifest.json` `content_scripts[0].css` (NOT a Shadow-DOM/JS template). Scoped under the `.sources-plus-manager-active` class (toggled on `document.documentElement`, NOT the shadow host), it uses `!important` to (a) hide the native source-list containers inside the source panel — via `visibility:hidden`/off-screen, kept in the render tree rather than `display:none` so Angular CDK can still measure overlays — and (b) restyle native Material menus (radius/shadow/dark-mode). This must live in the page, not the Shadow DOM, to override Gemini Notebook's own styles — keep page-level native overrides here, not in the two JS template strings above.
- `:host` tokens DO NOT cascade to `document.body`. For UI living outside the Shadow DOM, either redeclare tokens locally OR inline resolved values + a `@media (prefers-color-scheme: dark)` override. See `.sp-drag-ghost` in content-style-text.js for the resolved-value pattern. The same applies to `@font-face` declarations — Google Symbols must be re-declared in the global block if used outside Shadow DOM.

### State shape (per-notebook)

Persisted in `chrome.storage.local` under `sourcesPlusState_<projectId>` (current) and `sourcesPlusState_<projectId>__backup`.

- `state.groups` is `string[]` — root-level group IDs (NOT group objects).
- `groupsById: Map<id, group>` resolves IDs to `{ id, children, ... }`.
- `group.children` is `{ type: 'source', key } | { type: 'group', id }`[] — object entries.
- `state.ungrouped` is `string[]` — bare source keys at root level.
- `state.isBatchMode: boolean` + `pendingBatchKeys: Set<sourceKey>` is the batch selection model. Group headers do not participate in batch selection.

Background SW writes are revision-guarded; stale writes from content are rejected (smoke test "rejects stale saves without overwriting newer storage state").

### DOM construction and security

All Shadow-DOM UI uses the `el(...)` helper from `src/utils/index.js` — this is the XSS-protection core. ESLint's `no-restricted-syntax` blocks `innerHTML` writes anywhere in `src/`. New components use `el()` + `appendChild` + `createTextNode`.

Gemini Notebook-derived strings (source titles, aria-labels, icon URLs, import JSON) are untrusted input — treat accordingly.

### i18n

Three locales in `_locales/{en,es,zh_CN}/messages.json` — all three MUST share the same key set + placeholder shapes (enforced by `tests/locales.test.js`).

- **Key naming conventions** (project precedent, not lint-enforced):
  - Toasts: `ui_*_toast` — e.g., `ui_batch_ungrouped_toast`, `ui_batch_moved_sources_toast`
  - Commands: `ui_command_*`
  - Popup strings: `popup_*`
- Use **named placeholders**: `$count$` in the message body, `placeholders: { count: { content: "$1" } }`. Call site: `getMessage('key', [String(value)])`.

### Developer logging

`developerLog` has a **4-arg signature**: `(level, category, event, details)`. Valid levels and categories are declared at the top of [src/content/content-developer-logger.js](src/content/content-developer-logger.js). Common case for a user-driven mutation: `developerLog('info', 'source_action', '<event_name>', { count, ... })`.

A 2-arg call silently coerces level/category to fallback strings and discards your payload — verify by inspecting other call sites if uncertain.

### Test pyramid

- **Unit tests** (`tests/content/<module>.test.js`) — Jest, value-in/value-out, mocked DOM via `tests/helpers/load-content-module.js`. Each content module has a focused test file.
- **Integration tests** (`tests/content/content-tree.test.js`, `content-lifecycle.test.js`, etc.) — wire multiple modules via `tests/helpers/content-test-harness.js`.
- **Playwright smoke** (`tests/smoke/*.spec.js`) — real extension context in a Gemini Notebook-style fixture; default headless. For HTML5 DnD scenarios, dispatch synthetic `DragEvent`s via `page.evaluate` — Playwright's `dragTo` does NOT trigger native DataTransfer events. See `extension-smoke.spec.js` "restores an import backup..." and `batch-drag.smoke.spec.js` for the working pattern.

## Non-obvious gotchas

- **Source-list scroll container** is `#sources-list` (`overflow-y: auto` in content-style-text.js). Access via `shadowRoot.getElementById('sources-list')`.
- **Gemini Notebook is a single-page app.** Switching notebooks does NOT trigger a full reload. The content script tears down and rebuilds in place; a full reload is only the last-resort fallback after repeated retries fail.
- **Do not hardcode Gemini Notebook-generated CSS class names.** They are obfuscated and rotate. Use aria attributes, roles, `data-*`, text signals (`label_auto`, "Return to list view"), and relative structure.
- **`computeDropIntent` returns** `{ targetList, insertIndex, targetGroup }`. `targetList` is one of: `state.ungrouped` (string[]), some `group.children` (object[]), or `state.groups` (string[] of group IDs at root level). The entry shape differs — code that splices into `targetList` must handle both string and object entries, and must NOT splice source keys into `state.groups`.
- **`runtime.activeDragGhost`** is set on multi-source dragstart and torn down on dragend (RAF-deferred so the browser finishes capturing the drag image). Cleanup paths: `handleDragEnd` + `clearDragFeedback` as backstop.
- **Manifest version, package.json version, README badge, release zip name, and CHANGELOG version section must all match** on release. AGENTS.md enumerates this gate.

## Project conventions

- Default branch is `main`. Auto-`git commit` is allowed (and expected) for verified coherent changes; auto-`git push` is NOT — wait for explicit user request before pushing. Commit messages should end with the `Co-Authored-By` footer matching the user's global CLAUDE.md when Claude is involved.
- `docs/superpowers/plans/` is gitignored (implementation plans are local working docs). `docs/superpowers/specs/` IS tracked.
- Project-local memory at `~/.claude/projects/-Users-hmy-Desktop-notebooklm-source-management-main/memory/` holds tribal knowledge collected across sessions — `update-checklist.md` has the per-change file update checklist.
