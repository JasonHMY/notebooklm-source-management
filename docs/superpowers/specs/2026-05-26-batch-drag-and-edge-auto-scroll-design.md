# Batch Source Drag and Edge Auto-Scroll Design

## Summary

Improve the drag-and-drop experience in the NotebookLM Source Manager content panel by adding two capabilities:

1. **Multi-source batch drag.** When batch mode is on and one or more sources are selected, dragging any selected row carries the entire selection. A minimal pill-shaped ghost shows a drag icon and the count.
2. **Edge auto-scroll.** While dragging, pointer near the top or bottom edge of the source list causes the list to auto-scroll smoothly. The closer to the edge, the faster.

The two changes together remove the most common drag pain points reported by long-list users: having to drag items one at a time, and not being able to reach off-screen drop targets without first dropping, scrolling, and re-grabbing.

This spec corresponds to "Plan A (Surgical)" from the brainstorming session. Hover-to-expand, illegal-drop visuals, drop animation, keyboard lift mode, and other Plan B/C improvements are explicitly out of scope and tracked separately.

## Goals

- In batch mode, allow drag of multiple selected sources in a single gesture.
- Provide a clean, theme-aware visual cue ("3 in a pill") for multi-drag.
- Auto-scroll the source list when the dragged pointer is near the top or bottom edge of `#sources-list`.
- Preserve all existing single-source and group drag behavior with no regressions.
- Keep the change scope narrow: 1 new module, 6 touched files, no storage or message-protocol changes.

## Non-Goals

- Do not allow batch drag for groups (groups have no selection model today).
- Do not auto-expand collapsed folders during drag.
- Do not show "illegal drop" cursors or red indicator lines (Plan B).
- Do not add keyboard "lift and move" (Plan C, tracked under keyboard navigation).
- Do not introduce a new selection mechanism outside of batch mode.
- Do not change the existing undo data model, message contracts, or storage schema.
- Do not add touch-screen drag support.
- Do not auto-scroll any ancestor scroll containers (only `#sources-list`).

## User Experience

### Multi-source drag

- **Entering the gesture.** In batch mode, the source row's `draggable` attribute is true (previously forced to false). Group rows continue to follow the existing draggable rules.
- **What gets dragged.**
  - If batch mode is off, dragging a source drags that one source (unchanged).
  - If batch mode is on and the dragged row is in `pendingBatchKeys`, the dragged set equals all currently selected sources, ordered by their position in `state`.
  - If batch mode is on and the dragged row is **not** in `pendingBatchKeys`, the gesture drags only that one row. The selection set is not modified.
- **Visual.** Selected rows show the standard `.dragging` dim style while drag is in flight. A custom drag image replaces the native one when N >= 2.
- **Drop targets.** All existing intent zones still apply: drop onto a group (`drag-into`), above a source (`drag-over-top`), below a source (`drag-over-bottom`), above or below a group header.
- **After drop.** When at least one source actually moved, a toast announces `已移动 N 项 / Moved N sources / Movidas N fuentes`, batch mode exits, and the selection is cleared. This mirrors the existing move-to-folder modal flow. If the drop turned out to be a no-op (all keys raced out, or the entire target list was the dragged set), nothing is saved, batch mode does not exit, and no toast is shown.

### Drag ghost (multi only)

A single rounded pill, no stacked cards, no source title. Structure:

```
[ drag_indicator  3 ]
```

- Pill, `border-radius: 999px`.
- `drag_indicator` glyph from the local Google Symbols font (16px).
- Count digit at 13px (the default content-panel control text size).
- Padding 8px / 12px.
- Background `--sp-bg-button`, border `--sp-border-medium`, shadow `--sp-shadow-hover-item`.
- All visual styling derives from existing tokens; no new color, radius, shadow, or typography tokens.
- Element is created off-screen at `position: fixed; top: -9999px;` so `setDragImage` can capture it.
- Removed on `dragend` (via a `requestAnimationFrame` tick to allow the browser's screenshot pipeline to finish first).
- If `setDragImage` is unavailable, the browser falls back to the native drag image. The feature is not blocking.

### Edge auto-scroll

- **Container.** `#sources-list` (already `overflow-y: auto`, lives in the Shadow DOM, has a stable id from [content-template.js](src/content/content-template.js)).
- **Edge zone.** 60px from the top or bottom of `#sources-list`'s client rect.
- **Velocity.** `velocity = sign * MAX_SPEED * (1 - distance / EDGE_PX)`, where `sign` is `-1` near the top and `+1` near the bottom. `MAX_SPEED = 14` pixels per animation frame.
- **Driver.** `requestAnimationFrame` loop. One controller instance, restarted (not stacked) on every `dragover` that yields nonzero velocity.
- **Stop conditions.** Any of:
  - `velocity` becomes 0 (pointer left the edge zone).
  - `drop` / `dragend` / `dragleave` on `#sources-list`.
  - The container reaches the top or bottom scroll boundary in the active direction.
  - The shadow root or container becomes unavailable.
- **Scroll method.** `container.scrollBy({ top: velocity, behavior: 'auto' })`. The browser fires fresh `dragover` events after each frame, so the existing indicator logic re-applies naturally.

### Toast and developer logs

- New i18n key `toast_moved_multi_sources` with `{count}` placeholder in `en`, `es`, `zh_CN`.
- New developer-log event `batch_drag_move` with payload `{ count, intent: 'into-group' | 'before-source' | 'after-source' | 'before-group' | 'after-group' }`. Source keys are not logged (consistent with existing sanitization rules in [DEVELOPER_LOGGING.md](docs/DEVELOPER_LOGGING.md)).

## Architecture

### New module: `src/content/content-drag-multi.js`

Follows the existing NSM_* factory pattern. Globally registered as `globalThis.NSM_CREATE_CONTENT_DRAG_MULTI`. Exports a single factory:

```
createContentDragMulti({ document, requestAnimationFrame, cancelAnimationFrame }) -> {
  createMultiDragGhost({ count, root }),
  destroyMultiDragGhost(ghost),
  resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys, sourceOrder }),
  applyMultiSourceDrop({ keys, intent, state, helpers }),
  computeAutoScrollVelocity({ pointerY, containerTop, containerBottom, edgePx, maxSpeed }),
  createAutoScrollController({ getContainer })
}
```

Constraints:

- All DOM construction goes through the shared `el(...)` helper from `src/utils/index.js`. No `innerHTML` writes (project rule enforced by ESLint `no-restricted-syntax`).
- Time-dependent and DOM-dependent helpers are injected (`requestAnimationFrame`, `cancelAnimationFrame`, `getContainer`) so unit tests can run without a real browser.
- Pure helpers (`resolveDragSelection`, `computeAutoScrollVelocity`, `applyMultiSourceDrop`) have no side effects beyond what their caller-provided helpers do.

### Glue: `src/content/content-tree-interactions.js`

- `handleDragStart` (source path): call `resolveDragSelection`. When `isMulti`, write `application/source-keys` (JSON array) plus a backward-compatible `application/source-key = keys[0]`, call `createMultiDragGhost`, call `setDragImage`, add `.dragging` to every selected row.
- `handleDragStart` (group path): unchanged. Does not write `application/source-keys`.
- `handleDragOver`: existing intent logic stays. Additionally call `computeAutoScrollVelocity` against the live container rect and `autoScrollController.tick(velocity)`.
- `handleDragLeave` / `handleDrop` / `handleDragEnd`: call `autoScrollController.stop()` and `destroyMultiDragGhost`.
- `clearDragFeedback`: also calls `autoScrollController.stop()` as a defensive cleanup.
- `handleDrop`: read `application/source-keys` first. If present, route to `applyMultiSourceDrop`. Otherwise fall back to the existing single-source path. The group path is read before either source path (group id wins on collision).

### Render: `src/content/content-render.js`

One expression changes; the group header expression is left alone:

```
// before
draggable: !state.isBatchMode && !isFailed && !isLoading ? 'true' : 'false'   // source row
draggable: !state.isBatchMode ? 'true' : 'false'                              // group header

// after
draggable: !isFailed && !isLoading ? 'true' : 'false'                          // source row (batch mode no longer blocks)
draggable: !state.isBatchMode ? 'true' : 'false'                              // group header — unchanged
```

The group header rule is intentionally preserved. Group rows have no selection model, so a group drag in batch mode would be a single-item operation unrelated to the batch flow. That is a different design discussion and is out of scope here.

### Style: `src/content/content-style-text.js`

Add a small block (estimated ~30 lines):

```
.sp-drag-ghost {
  position: fixed; top: -9999px; left: -9999px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--sp-bg-button);
  border: 1px solid var(--sp-border-medium);
  box-shadow: var(--sp-shadow-hover-item);
  font-size: 13px;
  color: var(--sp-text-primary);
}
.sp-drag-ghost .google-symbols { font-size: 16px; }
.sp-drag-ghost-count { font-weight: 600; }
```

No new tokens. No theme override block needed because all referenced tokens already cascade from `:host` light/dark.

### Manifest and loader

- `manifest.json` content_scripts list: insert `src/content/content-drag-multi.js` **before** `src/content/content-tree-interactions.js` (load order matters because tree-interactions reads `globalThis.NSM_CREATE_CONTENT_DRAG_MULTI` at factory time).
- `tests/helpers/load-content-module.js`: add a `require` and add `NSM_CREATE_CONTENT_DRAG_MULTI` to the clearable globals list.
- `tests/manifest-loader-sync.test.js` will pick up the new entry automatically; the test only requires both lists to stay in sync.

### Wiring in `src/content/index.js`

Where the other factories are assembled, call:

```
const dragMulti = createContentDragMulti({
  document,
  requestAnimationFrame: globalThis.requestAnimationFrame.bind(globalThis),
  cancelAnimationFrame: globalThis.cancelAnimationFrame.bind(globalThis)
});
```

Inject the returned functions into `createContentTreeInteractions(...)` as additional deps. Existing tree-interactions deps are untouched.

### Locale messages

Add to `_locales/en/messages.json`:

```
"toast_moved_multi_sources": {
  "message": "Moved $count$ sources",
  "placeholders": { "count": { "content": "$1" } }
}
```

Equivalent entries in `_locales/es/messages.json` (`Movidas $count$ fuentes`) and `_locales/zh_CN/messages.json` (`已移动 $count$ 项`). If the key is missing at runtime, fall back to the English template, consistent with existing toast patterns.

### Project directory

Append a new line in [docs/PROJECT_DIRECTORY.md](docs/PROJECT_DIRECTORY.md) under the `src/content/` tree:

```
├── content-drag-multi.js
│   └── multi-source drag selection 解析、ghost helper、auto-scroll RAF controller、批量 drop 应用
```

## Data Flow

### Multi-source drop

```
dragstart on source row
  -> resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys, sourceOrder })
       returns { keys, isMulti }
  -> if isMulti:
       e.dataTransfer.setData('application/source-keys', JSON.stringify(keys))
       e.dataTransfer.setData('application/source-key', keys[0])  // back-compat
       ghost = createMultiDragGhost({ count: keys.length, root: shadowRoot })
       e.dataTransfer.setDragImage(ghost, 12, 12)
       keys.forEach(k => row(k)?.classList.add('dragging'))
     else:
       (existing single-source path)

dragover on source list
  -> existing intent computation -> drag-over-top / drag-over-bottom / drag-into class
  -> velocity = computeAutoScrollVelocity({ pointerY, containerTop, containerBottom, edgePx: 60, maxSpeed: 14 })
  -> autoScrollController.tick(velocity)

drop on target
  -> read 'application/group-id' first
       if present, run existing group drop path (no change)
  -> else read 'application/source-keys'
       if present and parseable:
         result = applyMultiSourceDrop({ keys, intent, state, helpers })
         developerLogger.log('batch_drag_move', { count: result.moved, intent: intent.kind })
         if result.moved > 0:
           exitBatchMode()
           saveState()
           render()
           toast(getMessage('toast_moved_multi_sources', { count: result.moved }))
  -> else fall back to existing single-source drop

dragend / drop / dragleave
  -> autoScrollController.stop()
  -> destroyMultiDragGhost(ghost) via rAF tick
  -> clearDragFeedback() (existing)
```

### `applyMultiSourceDrop` ordering

Given keys `[A, B, C]` (already sorted by state order) and an intent `{ list, baseIndex, kind }`:

1. Filter keys to those that still exist in state (skip silently if not).
2. Remove each key from its current parent list. Track original positions for undo only via the existing state-signature mechanism.
3. Compute an effective `insertIndex`:
   - If `intent.kind === 'into-group'`, append to the end of the target group's `children`.
   - Else, start at `baseIndex`. If the item at `baseIndex` is itself a member of the moved set, scan forward until the first non-member or the end of the list.
4. Insert each moved key at `insertIndex + i` (preserves original relative order).
5. Return `{ moved: count, skipped: filteredOut }`.

No `render()` or `saveState()` happens inside `applyMultiSourceDrop`. The caller batches one render and one save per drop, which keeps the cost O(state size) regardless of N.

### Auto-scroll loop lifecycle

```
controller state: { rafId: null, velocity: 0 }

tick(velocity):
  if velocity === 0:
    stop()
    return
  state.velocity = velocity
  if state.rafId !== null: return       // already running, just updated speed
  state.rafId = requestAnimationFrame(step)

step():
  state.rafId = null
  container = getContainer()
  if !container:
    state.velocity = 0
    return
  container.scrollBy({ top: state.velocity, behavior: 'auto' })
  if at-boundary in direction(state.velocity):
    state.velocity = 0
    return
  if state.velocity !== 0:
    state.rafId = requestAnimationFrame(step)

stop():
  if state.rafId !== null:
    cancelAnimationFrame(state.rafId)
    state.rafId = null
  state.velocity = 0
```

This guarantees a single in-flight rAF callback at any time, no stacked loops, and idempotent stop.

## Error Handling

| Case | Handling |
|------|----------|
| Source key in dragged set no longer in state at drop time | Skip it, log skip count to developer log, continue. Toast reports actual moved count. |
| Drop target itself is part of the dragged set | `applyMultiSourceDrop` advances `insertIndex` past contiguous members. If the entire target list is the dragged set, treat as no-op (no saveState, no toast). |
| `setDragImage` not available | Skip ghost, browser uses native drag image, all other paths unaffected. |
| `requestAnimationFrame` unavailable (theoretical, in jsdom unit tests) | The factory accepts `requestAnimationFrame` / `cancelAnimationFrame` as deps. Tests stub them. Production always has them. |
| Container unavailable mid-drag (panel re-attached) | Controller's `step()` reads `getContainer()` fresh on each frame; null container stops the loop silently. |
| Shadow root disconnect during drag | `clearDragFeedback` defensively calls `autoScrollController.stop()`. |
| dataTransfer JSON parse failure on drop | Caught; fall back to single-source path using `application/source-key`. |
| Drop carries both `application/group-id` and `application/source-keys` | Read group id first. Source dragstart never writes group id, so this only happens if a third party DOM injects data; the safer default is "treat as group drop". |

## Testing

### New unit test file: `tests/content/content-drag-multi.test.js`

- `createMultiDragGhost` builds the pill structure for N = 2, 3, 10. No `innerHTML` calls. Count text matches input.
- `destroyMultiDragGhost` is null-safe and detaches the element if attached.
- `resolveDragSelection`:
  - Non-batch mode -> `{ keys: [originKey], isMulti: false }`.
  - Batch on, origin in set, set = {A,B,C}, sourceOrder = [C,A,B] -> `{ keys: [C,A,B], isMulti: true }` (ordered by state, not by set iteration).
  - Batch on, origin not in set -> `{ keys: [originKey], isMulti: false }`. Set is not mutated.
  - Batch on, set empty -> `{ keys: [originKey], isMulti: false }`.
- `applyMultiSourceDrop`:
  - Moves 3 keys across groups preserving relative order.
  - Skips a key that no longer exists.
  - Handles `intent.kind === 'into-group'` (append at end).
  - When `baseIndex` points at a member of the moved set, scans forward to the first non-member.
  - When the target list is entirely the moved set, returns `{ moved: 0 }` and does not mutate state.
  - Does not call `saveState` or `render` itself.
- `computeAutoScrollVelocity`:
  - Pointer above container top -> negative velocity.
  - Pointer below container bottom -> positive velocity.
  - Pointer in middle -> 0.
  - Pointer exactly at top edge -> ~`-maxSpeed`.
  - `edgePx = 0` -> always 0 (defensive).
- `createAutoScrollController`:
  - `tick(positive)` starts the loop, calls `scrollBy` once per frame.
  - `tick(0)` calls `stop()` and clears state.
  - `stop()` is idempotent (calling twice does not crash).
  - Container removed mid-loop -> next `step()` exits cleanly.
  - At boundary -> next `step()` clears velocity.

### Integration in `tests/content/content-tree-interactions.test.js`

- Batch mode on + selection {A, B, C} + dragstart on A -> dataTransfer carries `application/source-keys` with `[A,B,C]`, all three rows get `.dragging`, ghost is created.
- Batch mode off + dragstart on A -> dataTransfer carries only `application/source-key = A`, no ghost.
- Drop with `application/source-keys` routes through `applyMultiSourceDrop`; `exitBatchMode`, `saveState`, `render`, and the toast are each called exactly once.
- Drop with `application/source-key` only continues to use the existing single-source path.
- After multi-drop, `pendingBatchKeys` is empty and `state.isBatchMode === false`.

### Smoke (Playwright) in `tests/smoke/`

Add one new scenario:

1. Mount the manager into the NotebookLM-style fixture.
2. Enter batch mode via the toolbar button.
3. Click three source rows' checkboxes to select them.
4. Programmatically dispatch dragstart on the first selected row, dragover on a target group header (with `drag-into` zone), then drop.
5. Assert that the three sources now belong to the target group in state, and that the success toast text matches the locale.

### Manual smoke checklist additions

Append to README's "Development Smoke Checklist" step 6:

- enter batch mode, select 3 sources, drag one of them into a folder, verify all three move
- in single-source mode, drag any source toward the bottom edge of the list and verify the list auto-scrolls
- drag near the top edge and verify reverse auto-scroll

## Risks and Mitigations

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | Batch checkbox click interpreted as dragstart on the row | dragstart guards: `if (e.target.closest('input[type="checkbox"], .sp-batch-checkbox')) return;` |
| R2 | Partial drop (some keys raced out) leaves selection in a confusing state | After any successful multi-drop, clear `pendingBatchKeys` and exit batch mode. Toast reports actual moved count. |
| R3 | Drop target is itself in the dragged set | `applyMultiSourceDrop` scans past contiguous members; full-overlap is treated as no-op. |
| R4 | dataTransfer ambiguity between group and source paths | Group path is read first, never writes source-keys. Source path always writes both source-keys and source-key. |
| R5 | Auto-scroll loop left running after the gesture ends | `dragend` / `drop` / `dragleave` all call `stop()`, and `clearDragFeedback` is a third backstop. |
| R6 | Conflict with NotebookLM native scroll | Auto-scroll only acts on `#sources-list`. Pointer outside the container yields velocity 0. |
| R7 | Undo expectations | One drop produces one state-signature change, hence one undo entry. `Cmd/Ctrl+Z` reverts the entire batch atomically. Confirmed in unit tests. |
| R8 | Developer log leaks source identity | `batch_drag_move` payload contains `count` and `intent.kind` only, no keys or titles. |
| R9 | Performance with large N (e.g., 50 sources) | One render and one save per drop, regardless of N. Ghost is a single element. |
| R10 | Missing i18n key in production | Locale lookups fall back to the English template via the existing `getMessage` pattern. |

## Rollout and Rollback

- No storage schema changes.
- No message contract changes.
- No new permissions.
- One new locale key per language; missing key falls back gracefully.

Rollback path if needed:

1. Remove `src/content/content-drag-multi.js` from `manifest.json` and from `tests/helpers/load-content-module.js`.
2. Revert the `draggable` expression in `src/content/content-render.js`.
3. Revert the dragstart, dragover, drop, dragend, and `clearDragFeedback` glue changes in `src/content/content-tree-interactions.js`.
4. Remove the `.sp-drag-ghost*` style block from `src/content/content-style-text.js`.
5. Remove the new locale key (optional; harmless if left).
6. Remove the new unit test file and the integration / smoke additions.

No data migration is needed in either direction.

## Verification Matrix

- `npm run lint` -> 0 errors, 0 warnings (current baseline must hold).
- `npm run test:unit` -> existing suite still passes; new `content-drag-multi.test.js` and the new integration assertions pass.
- `npm run test:smoke` -> existing scenarios still pass; new batch-drag scenario passes headlessly.
- `npm run verify:full` -> lint + unit + smoke all pass in one shot.
- Manual smoke: README checklist extended steps pass on a real NotebookLM notebook.

## Open Questions

None at design-approval time. Implementation may surface small clarifications (e.g., exact `EDGE_PX` tuning under different DPI); those are tuning, not design.

## References

- Existing drag handlers: [content-tree-interactions.js:830-892](src/content/content-tree-interactions.js)
- Existing draggable gating: [content-render.js:1249](src/content/content-render.js), [content-render.js:1348](src/content/content-render.js)
- Scroll container: [content-style-text.js:568-581](src/content/content-style-text.js)
- Batch mode state model: `state.isBatchMode` + `pendingBatchKeys` (see `src/content/index.js`)
- Manifest load order rules: [manifest.json](manifest.json) `content_scripts.js`
- Module loader sync test: [tests/manifest-loader-sync.test.js](tests/manifest-loader-sync.test.js)
- Developer logging sanitization rules: [docs/DEVELOPER_LOGGING.md](docs/DEVELOPER_LOGGING.md)
- UI tokens: [UI_GUIDELINES.md](UI_GUIDELINES.md) sections 5.1, 5.2, 5.3, 5.4, 5.5
- Brainstorm origin: this session, 2026-05-26, "Plan A (Surgical)" branch
