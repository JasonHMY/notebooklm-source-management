# Architecture and Gotchas

Read on demand when changing runtime code. Rules, verification and the doc index live in [AGENTS.md](../AGENTS.md); the file map and load order live in [PROJECT_DIRECTORY.md](PROJECT_DIRECTORY.md).

## Three independent runtime surfaces

- **Content script** (`src/content/index.js` plus the helper modules loaded before it; the authoritative list and order is `manifest.json` `content_scripts[0].js`, mapped in [PROJECT_DIRECTORY.md](PROJECT_DIRECTORY.md) §2) — injected into `https://notebook.google.com/*` (current) and `https://notebooklm.google.com/*` (compatibility). Mounts a Shadow-DOM manager (`#sources-plus-root`) into Gemini Notebook's source panel. 90% of the code lives here.
- **Background service worker** (`src/background/index.js`) — owns `chrome.storage.local` writes via a queued + revision-guarded protocol; resolves tab focus/open requests from the popup.
- **Toolbar popup** (`src/popup/index.js`) — launcher only. Enables/disables the manager and switches Gemini Notebook source view; the real UI lives in the content panel.

## No bundler — factory + global registration pattern

Content scripts are loaded sequentially per `manifest.json` `content_scripts[0].js`. Each module is an IIFE that:

1. Registers a factory at `globalThis.NSM_CREATE_CONTENT_*`.
2. Also exports the factory via `module.exports` for Jest.

`src/content/index.js` is loaded last; it pulls every `NSM_CREATE_*` and assembles the factory graph by passing deps explicitly.

Adding a content module touches four files; the list is in [AGENTS.md](../AGENTS.md) § Project-Specific Workflow Rules. `tests/manifest-loader-sync.test.js` enforces the first two (`manifest.json` and `tests/helpers/load-content-module.js`, which needs both the `require()` line and the `delete globalThis.NSM_CREATE_*` in `clearContentGlobals()`); the third, appending the global to `CONTENT_HELPER_GLOBALS` in `tests/helpers/content-test-harness.js`, is easy to forget.

## Shadow DOM vs global overlay boundary

CSS lives in **three** places by scope:

- **Inside Shadow DOM** (`#sources-plus-root`): manager UI, styled via `NSM_CONTENT_STYLE_TEXT` in [src/content/content-style-text.js](../src/content/content-style-text.js). Tokens like `--sp-bg-button`, `--sp-text-primary`, `--sp-shadow-*` are declared on `:host` with light + dark variants.
- **Outside Shadow DOM** (`document.body`, `document.head`): only when Shadow DOM can't reach — native Material overlays, Gemini Notebook dialogs, drag ghosts. Styled via `NSM_GLOBAL_OVERLAY_STYLE_TEXT` (same file, second exported template string).
- **Native Gemini Notebook DOM overrides**: [src/content/styles.css](../src/content/styles.css) is injected directly by `manifest.json` `content_scripts[0].css` (NOT a Shadow-DOM/JS template). Scoped under the `.sources-plus-manager-active` class (toggled on `document.documentElement`, NOT the shadow host), it uses `!important` to (a) hide the native source-list containers inside the source panel — via `visibility:hidden`/off-screen, kept in the render tree rather than `display:none` so Angular CDK can still measure overlays — and (b) restyle native Material menus (radius/shadow/dark-mode). This must live in the page, not the Shadow DOM, to override Gemini Notebook's own styles — keep page-level native overrides here, not in the two JS template strings above.
- `:host` tokens DO NOT cascade to `document.body`. For UI living outside the Shadow DOM, either redeclare tokens locally OR inline resolved values + a `@media (prefers-color-scheme: dark)` override. See `.sp-drag-ghost` in content-style-text.js for the resolved-value pattern. The same applies to `@font-face` declarations — Google Symbols must be re-declared in the global block if used outside Shadow DOM.

## State shape (per-notebook)

Persisted in `chrome.storage.local` under `sourcesPlusState_<projectId>` (current) and `sourcesPlusState_<projectId>__backup`.

- `state.root` is the ordered root layer: `({ type: 'group', id } | { type: 'source', key })[]`. Root folders and positioned root sources interleave in display order. It replaced the flat `groups: string[]` in schema v5; `state.groups` only appears as a legacy fallback for unmigrated data, so never write to it.
- `groupsById: Map<id, group>` resolves IDs to `{ id, children, ... }` (a plain object in persisted JSON).
- `group.children` uses the same object entries as `state.root`.
- `state.ungrouped` is `string[]` — bare source keys in the bottom Ungrouped bin. A root-level source is in `state.root` (positioned) or `state.ungrouped` (bin), never both.
- `state.isBatchMode: boolean` + `pendingBatchKeys: Set<sourceKey>` is the batch selection model. Group headers do not participate in batch selection.

Background SW writes are revision-guarded; stale writes from content are rejected (smoke test "rejects stale saves without overwriting newer storage state").

## DOM construction and security

All Shadow-DOM UI uses the `el(...)` helper from `src/utils/index.js` — this is the XSS-protection core. ESLint's `no-restricted-syntax` blocks `innerHTML` writes anywhere in `src/`. New components use `el()` + `appendChild` + `createTextNode`.

Gemini Notebook-derived strings (source titles, aria-labels, icon URLs, import JSON) are untrusted input — treat accordingly.

## i18n

Three locales in `_locales/{en,es,zh_CN}/messages.json` — all three MUST share the same key set + placeholder shapes (enforced by `tests/locales.test.js`).

- **Key naming conventions** (project precedent, not lint-enforced):
  - Toasts: `ui_*_toast` — e.g., `ui_batch_ungrouped_toast`, `ui_batch_moved_sources_toast`
  - Commands: `ui_command_*`
  - Popup strings: `popup_*`
- Use **named placeholders**: `$count$` in the message body, `placeholders: { count: { content: "$1" } }`. Call site: `getMessage('key', [String(value)])`.

## Developer logging

`developerLog` has a **4-arg signature**: `(level, category, event, details)`. Valid levels and categories are declared at the top of [src/content/content-developer-logger.js](../src/content/content-developer-logger.js). Common case for a user-driven mutation: `developerLog('info', 'source_action', '<event_name>', { count, ... })`.

A 2-arg call silently coerces level/category to fallback strings and discards your payload — verify by inspecting other call sites if uncertain.

## Test pyramid

- **Unit tests** (`tests/content/<module>.test.js`) — Jest, value-in/value-out, mocked DOM via `tests/helpers/load-content-module.js`. Each content module has a focused test file.
- **Integration tests** (`tests/content/content-tree.test.js`, `content-lifecycle.test.js`, etc.) — wire multiple modules via `tests/helpers/content-test-harness.js`.
- **Playwright smoke** (`tests/smoke/*.spec.js`) — real extension context in a Gemini Notebook-style fixture; default headless. Source and folder drags are pointer-only from the six-dot `.sp-drag-handle` in both drag modes (3px start threshold in `src/content/content-drag-pointer.js`), so drive them with real `page.mouse` down/move/up on the handle — not synthetic `DragEvent`s or `dragTo`. See `pointer-drag.smoke.spec.js` and `extension-smoke.spec.js` "restores an import backup and preserves dragged source ordering after reload" for the working pattern.

## Non-obvious gotchas

- **Source-list scroll container** is `#sources-list` (`overflow-y: auto` in content-style-text.js). Access via `shadowRoot.getElementById('sources-list')`.
- **Gemini Notebook is a single-page app.** Switching notebooks does NOT trigger a full reload. The content script tears down and rebuilds in place; a full reload is only the last-resort fallback after repeated retries fail.
- **`computeDropIntent` returns** `{ targetList, insertIndex, targetGroup, ... }`. `targetList` is one of: `state.ungrouped` (string[] of source keys), some `group.children`, or `state.root` (both object entries). The entry shape differs — code that splices into `targetList` must insert bare keys into `state.ungrouped` and `{ type, ... }` objects into `state.root` / `group.children`.
- **`runtime.activeDragGhost`** holds the ghost of the current pointer drag: `mountPointerGhost` sets it when a source or folder drag starts; `cancelDrag`, `applyPointerDropLanding` and `teardownDragInteractions` clear it, and `handleDragEnd` also does.
