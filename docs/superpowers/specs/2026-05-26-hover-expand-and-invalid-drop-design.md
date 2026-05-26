# Hover-Expand and Invalid-Drop Feedback Design

## Summary

Continue the drag-and-drop polish started in the 2026-05-26 batch-drag spec by adding two functional improvements from that document's deferred Plan B:

1. **Hover-to-expand on collapsed groups.** When the user holds a dragged item over a collapsed group header for 600ms, the group expands automatically. This eliminates the current two-pass workaround (drop on header → release → expand manually → drag again to nested target).
2. **Invalid-drop visual feedback.** When the user drags an item over a position where the drop would be silently rejected (drop a source on itself, drop a group into its own descendant, drop a multi-selected source onto another member of the dragged set, etc.), the drop target now shows a red indicator + `not-allowed` cursor. The drop handler's existing silent-abort logic is unchanged; this spec only surfaces the rejection in dragover feedback.

This is Plan B option 2 from the brainstorming session — the two functional changes only. The pure-polish items from Plan B (wider/animated drop indicators, post-drop animation) are explicitly deferred.

## Goals

- Allow drag gestures to reach nested folder targets in a single motion (no release-and-re-grab).
- Surface invalid drop positions visually during dragover so the user understands why a release will not move the item.
- Keep the change small: no new content-script module, no manifest or loader changes, no new locale keys, no new test files.

## Non-Goals

- Do not change the drop handler's accept/reject decision. Invalid drops are already silently aborted by the existing logic; this spec only adds dragover-time visual feedback.
- Do not auto-collapse a group after a hover-expanded session ends. Once expanded by hover, the group stays expanded until the user explicitly collapses it.
- Do not add a toast or text message for invalid drops. The visual indicator alone is sufficient and matches the project's convention that toast is for success confirmation, not blocking feedback.
- Do not change the existing `.drag-into` / `.drag-over-top` / `.drag-over-bottom` indicators (those are Plan B option's polish items, deferred).
- Do not modify undo semantics. Hover-expand-triggered expansion does not enter the undo stack (current `toggleGroupCollapse` already excludes collapse state from undo).
- Do not introduce keyboard "lift mode" or any other interaction model (Plan C deferral).

## User Experience

### Hover-expand on collapsed groups

- **Trigger:** During dragover, when `dropTarget = closest('.group-container, .source-item')` resolves to a `.group-container` whose corresponding group is `collapsed === true` and has at least one child, a 600ms timer arms.
- **Fire:** If the same group remains the dropTarget for 600ms continuously, the timer calls `toggleGroupCollapse(group, container)`. The group expands in place. The current `intent` (drag-into / drag-over-top / drag-over-bottom) continues to apply based on cursor position.
- **Cancel:** The pending timer is cleared if any of: dropTarget changes to a different element (different group, a source row, or a non-tree target), dragleave fires on `#sources-list`, drop fires, dragend fires, the group becomes non-collapsed by another path, or the user releases.
- **No auto-collapse:** Once a group is hover-expanded, it stays expanded after the drag ends. The user collapses it manually via the chevron if desired.
- **Delay tuning:** 600ms matches macOS Dock spring-loaded folders. Lower would mistrigger; higher would feel unresponsive.

### Invalid-drop feedback

The dragover handler computes whether the current drop would be silently rejected, and if so:

- Adds a `drag-invalid` CSS class on the drop target. **This is additive** — the existing `.drag-into` / `.drag-over-top` / `.drag-over-bottom` intent class also stays on the target so the indicator's position is still computed. `.drag-invalid` only overrides the indicator color and group-header treatment.
- Sets `e.dataTransfer.dropEffect = 'none'` so the browser's native cursor becomes `not-allowed`.
- CSS uses `--sp-accent-danger` (the existing destructive-red token): the indicator line (positioned by the intent class's `::before`/`::after`) is recolored red, `.group-container.drag-invalid > .group-header` gets a faint red background and red outline, cursor is `not-allowed`.

Invalid conditions, by what is being dragged:

| Dragged | Invalid when |
|---|---|
| Single source (not in batch mode) | dropTarget's `data-source-key === draggedSourceKey` |
| Multi sources (batch mode + multi-selection drag) | dropTarget's `data-source-key` is in the dragged keys set, OR intent is `before-group` / `after-group` at top level (the existing Task 11 guard — would target `state.groups` which holds group IDs, not source keys) |
| Single group | `intent.targetGroup === draggedGroup` OR `isDescendant(intent.targetGroup, draggedGroup, groupsById)` |

The drop handler's behavior is unchanged. The handler still silently aborts on these conditions; the new visual just makes the rejection visible before release.

## Architecture

### File changes

Only two files. No new modules, no manifest / loader / harness sync needed.

- `src/content/content-tree-interactions.js` — drag lifecycle wiring + new private helpers.
- `src/content/content-style-text.js` — new `.drag-invalid` CSS in the Shadow DOM block.

### New runtime state in `content-tree-interactions.js`

Two fields added to the `runtime` object (the existing context bag shared across handlers):

- `runtime.hoverExpandTimer = null` — holds `{ groupId, timeoutId }` for the in-flight 600ms timer, or null when no timer is armed.
- `runtime.activeDragContext = null` — set by `handleDragStart`, cleared by `handleDragEnd` and `clearDragFeedback`. Shape: `{ kind: 'source-single' | 'source-multi' | 'group', keys?: string[], draggedGroupId?: string }`. Read by `handleDragOver` to compute invalid-drop status.

### New private helpers in `content-tree-interactions.js`

All four live inside the factory (no exports, no new module). They close over the existing factory-scope deps and `runtime`:

```text
armHoverExpandTimer(dropTarget)
  - dropTarget must be a .group-container
  - resolve group via dropTarget.dataset.groupId -> groupsById
  - skip if not collapsed, no children, or already-armed timer points at same groupId
  - cancelHoverExpandTimer() first; setTimeout(executeHoverExpand(groupId), 600)

cancelHoverExpandTimer()
  - clearTimeout if any; null the field

executeHoverExpand(groupId)
  - runtime.hoverExpandTimer = null
  - resolve group via groupsById
  - if still collapsed and children > 0: toggleGroupCollapse(group, container)

computeIsInvalidDrop({ dropTarget, intent, dragContext })
  -> boolean
  - Pure function. No side effects. Reads only its arguments.
  - Returns true per the table in "Invalid-drop feedback" above.
```

### `handleDragStart` change

After the existing dragstart logic (which writes dataTransfer, builds ghost, etc.), set:

```js
runtime.activeDragContext = selection.isMulti
    ? { kind: 'source-multi', keys: selection.keys }
    : { kind: 'source-single', keys: [selection.keys[0]] };
```

For the group-target branch, set:

```js
runtime.activeDragContext = { kind: 'group', draggedGroupId: key };
```

### `handleDragOver` change

After the existing intent-class assignment block, add two segments:

```text
1. Invalid-drop (additive — intent class stays so the indicator has a position):
   const invalid = computeIsInvalidDrop({ dropTarget, intent, dragContext: runtime.activeDragContext });
   if (invalid) {
       dropTarget.classList.add('drag-invalid');
       e.dataTransfer.dropEffect = 'none';
   } else {
       dropTarget.classList.remove('drag-invalid');
       // dropEffect left at its default 'move' — set by existing code
   }

2. Hover-expand:
   if (dropTarget.classList.contains('group-container')) {
       armHoverExpandTimer(dropTarget);
   } else {
       cancelHoverExpandTimer();
   }
```

The auto-scroll velocity computation block stays as-is.

### `handleDragLeave`, `handleDragEnd`, `handleDrop`, `clearDragFeedback` changes

Each must call `cancelHoverExpandTimer()` in addition to its existing work. `clearDragFeedback`'s class-removal selector list adds `'drag-invalid'`. `handleDragStart` and `handleDragEnd` also manage `runtime.activeDragContext`:

- `handleDragStart`: write context before returning (per branch above).
- `handleDragEnd`: `runtime.activeDragContext = null;` after existing cleanup.
- `clearDragFeedback`: defensive `runtime.activeDragContext = null;` as backstop.

### CSS additions in `content-style-text.js`

In the Shadow DOM block (`NSM_CONTENT_STYLE_TEXT`), adjacent to the existing `.drag-over-top` / `.drag-into` / `.drag-over-bottom` rules:

```css
.drag-invalid {
    cursor: not-allowed;
}
/* Recolor the indicator line from the intent class to red. */
.drag-over-top.drag-invalid::before,
.drag-over-bottom.drag-invalid::after {
    background: var(--sp-accent-danger);
}
/* For drop-into-group intent, the existing rule paints the header background;
   override with red treatment when invalid. */
.group-container.drag-invalid > .group-header {
    background-color: rgba(255, 59, 48, 0.08);
    outline: 1px solid var(--sp-accent-danger);
    outline-offset: -1px;
}
@media (prefers-color-scheme: dark) {
    .group-container.drag-invalid > .group-header {
        background-color: rgba(255, 69, 58, 0.12);
    }
}
```

The compound selectors (`.drag-over-top.drag-invalid`, `.drag-over-bottom.drag-invalid`) reuse the existing pseudo-element positioning + height + opacity from the intent classes; only the `background` color is overridden when `.drag-invalid` is also present. For `.drag-into` intent on a group container, the `.group-container.drag-invalid > .group-header` rule provides the red treatment directly without needing a pseudo-element overlay.

### No new module / manifest / loader / harness changes

This intentionally avoids the four-file content-module sync surface from CLAUDE.md. All work fits inside two existing files.

## Data Flow

### Hover-expand timer lifecycle

```text
dragover on .group-container#g1 (collapsed, has children)
  -> armHoverExpandTimer({ groupId: 'g1' })
       runtime.hoverExpandTimer = { groupId: 'g1', timeoutId: T1 }

dragover on the same .group-container#g1 (continues)
  -> armHoverExpandTimer({ groupId: 'g1' })
       same groupId, timer already armed -> noop

T1 fires (600ms elapsed, still on g1)
  -> executeHoverExpand('g1')
       runtime.hoverExpandTimer = null
       toggleGroupCollapse(group, container)
       group now expanded; dragover continues into the now-visible children

(alternative) dragover moves to .group-container#g2
  -> armHoverExpandTimer({ groupId: 'g2' })
       different groupId -> cancelHoverExpandTimer(); start new T2

(alternative) dragover moves to a .source-item
  -> dropTarget is not .group-container -> cancelHoverExpandTimer()

(alternative) dragleave on #sources-list
  -> handleDragLeave -> cancelHoverExpandTimer()

(alternative) drop or dragend
  -> cancelHoverExpandTimer()
```

### Invalid-drop feedback flow

```text
dragstart
  -> runtime.activeDragContext = { kind, keys?, draggedGroupId? }

dragover on dropTarget
  -> existing intent computation produces drag-into / drag-over-top / drag-over-bottom class
  -> invalid = computeIsInvalidDrop({ dropTarget, intent, dragContext: runtime.activeDragContext })
  -> if invalid:
        remove the intent class, add 'drag-invalid'
        e.dataTransfer.dropEffect = 'none'
     else:
        remove 'drag-invalid' (if present)
        intent class stays

drop
  -> existing handler reads dataTransfer
  -> for invalid cases, the handler's existing guards (isDescendant for groups, allowedMultiIntents for multi, self-drop for single source) silently abort
  -> clearDragFeedback removes all classes including 'drag-invalid'

dragend / clearDragFeedback
  -> runtime.activeDragContext = null
  -> cancelHoverExpandTimer()
```

## Error Handling

| Case | Behavior |
|------|----------|
| Hover-expand timer fires but the group was already collapsed by another path | executeHoverExpand re-checks `group.collapsed === true` before calling toggleGroupCollapse; if not collapsed, no-op. |
| Hover-expand timer fires but the group was deleted mid-drag | groupsById.get returns undefined; no-op. |
| Drop target loses its data-group-id attribute mid-drag | armHoverExpandTimer's groupId resolution returns undefined; no timer is armed. |
| activeDragContext stale from a previous gesture (Esc cancel, cross-window) | handleDragStart always overwrites it. computeIsInvalidDrop tolerates an unrecognized kind by returning false (no false-positive invalid feedback). |
| dragover fires very fast and timer reset would thrash | armHoverExpandTimer short-circuits when the in-flight timer points at the same groupId. No thrash. |
| Multi-source drag where the dropTarget is itself an unrelated source | computeIsInvalidDrop returns false; existing intent class applies; drop proceeds normally. |
| Group drag where targetGroup is null (top-level drop) | computeIsInvalidDrop's group branch checks `intent.targetGroup` truthiness first; returns false for top-level (the move is valid). |

## Testing

All tests use the existing `tests/content/content-tree.test.js` harness pattern (inline mocks for `e.target.closest`, `e.dataTransfer`, dropTarget classList, etc.).

### Invalid-drop test cases (in `describe('handleDragOver invalid-drop feedback', ...)`):

1. **Single source dragged over itself.** dragstart sets activeDragContext for `'source-single'` with `keys: ['A']`. dragover on the source-item dropTarget with `data-source-key='A'` → `drag-invalid` class present, an intent class (`drag-over-top` or `drag-over-bottom`) also present (additive), `dataTransfer.dropEffect === 'none'`.

2. **Group dragged over its own descendant.** dragstart sets `'group'` with `draggedGroupId: 'g1'`. dragover on `.group-container[data-group-id='g2']` where `isDescendant(g2, g1)` is true → `drag-invalid` present alongside the intent class (`drag-into` or `drag-over-*`), dropEffect 'none'.

3. **Multi-source drag where dropTarget is one of the dragged sources.** activeDragContext: `'source-multi'`, `keys: ['A','B','C']`. dragover on source-item `data-source-key='B'` → `drag-invalid` present alongside intent class.

4. **Multi-source drag with intent before-group at top level.** Reproduces the Task 11 R-rejected case. activeDragContext: `'source-multi'`, `keys: ['A','B']`. dragover on `.group-container` with drag-over-top intent that resolves to top-level `before-group` → `drag-invalid` present alongside `drag-over-top`.

5. **Single source dragged over a different source.** No invalid; normal intent class applies alone; dropEffect not changed to 'none'.

### Hover-expand test cases (in `describe('handleDragOver hover-expand', ...)`):

6. **Dragover on collapsed group for full 600ms triggers expand.** Uses `jest.useFakeTimers()`. armHoverExpandTimer arms; advance timers by 600ms; assert `toggleGroupCollapse` called once with the right group.

7. **Dragover changes to different target before 600ms — timer cancelled.** Advance 300ms, then dispatch dragover on a different dropTarget. Advance remaining 600ms. Assert `toggleGroupCollapse` NOT called.

8. **Dragover on an already-expanded group does not arm a timer.** group.collapsed === false. Advance 600ms. Assert no timer scheduled, no toggle call.

9. **Dragover on a collapsed but empty group does not arm a timer.** group.children.length === 0. Advance 600ms. Assert no toggle call.

10. **handleDragLeave on #sources-list cancels pending timer.** Arm timer, advance 300ms, dispatch dragleave with `e.target.id === 'sources-list'`. Advance 600ms. Assert no toggle call.

11. **handleDragEnd cancels pending timer.** Same pattern as 10 but with dragend.

12. **handleDrop cancels pending timer.** Same pattern with drop.

### Existing tests must continue to pass

- All Task 10–12 drag tests (24 unit + 10 integration + 1 smoke) stay green. No semantic change to existing dragover intent computation.
- Lint baseline (0 errors, 0 warnings) must hold.

## Risks and Mitigations

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | dragover high-frequency reset thrash | armHoverExpandTimer short-circuits when current timer's `groupId` matches. Only different-group transitions or non-group targets clear+restart. |
| R2 | Hover-expanded group entering undo history unintentionally | `toggleGroupCollapse` already mutates state without entering undo. No change required. |
| R3 | activeDragContext stale across gestures | dragstart unconditionally overwrites; clearDragFeedback nulls; computeIsInvalidDrop returns false for unknown kind. |
| R4 | `.dragging` and `.drag-invalid` on the same source row in multi-mode | Classes are orthogonal in their styling responsibilities (`.dragging` controls opacity; `.drag-invalid` controls border/cursor/pseudo-element color). No visual conflict; verified by tracing CSS specificity in content-style-text.js. |
| R5 | Esc-cancel of drag does not fire dragend in all browsers | clearDragFeedback runs from multiple paths (drop, dragend, dragleave on root). At worst, a stale activeDragContext persists until next dragstart, which overwrites it. Hover-expand timer survives slightly longer than ideal but cancels on next dragover or dragstart. |
| R6 | hover-expand fires after group was deleted via batch delete mid-drag | executeHoverExpand re-resolves groupsById and re-checks `collapsed === true`; missing group → no-op. |
| R7 | activeDragContext kind not recognized (future drag types) | computeIsInvalidDrop's switch returns false on unknown kind. No false-positive invalid feedback. |
| R8 | toggleGroupCollapse already calls render — does hover-expand cause an extra render mid-drag? | Yes, one render per expansion. This is intentional and matches the user's manual-expand flow. No persistent state mutation outside `group.collapsed`. |

## Rollout and Rollback

- No storage schema change.
- No message protocol change.
- No new locale key.
- No new permission, no new web-accessible resource.
- No new module — manifest, loader, harness, PROJECT_DIRECTORY sections 2/3 untouched.

Rollback path: remove the new private helpers from `content-tree-interactions.js`, revert the four handler additions, remove the `.drag-invalid` CSS block. No data migration in either direction.

## Verification Matrix

- `npm run lint` → 0 errors, 0 warnings (baseline holds).
- `npm run test:unit` → existing suite passes + the 12 new integration cases.
- `npm run test:smoke` → existing 18 smokes all green; **no new smoke added** for this spec (jsdom integration tests cover the visual class assertions and timer behavior with `jest.useFakeTimers()`, which is more precise than Playwright for timer-based UI).
- `npm run verify:full` → all three steps green.
- Manual smoke (README Development Smoke Checklist append):
  - drag a source over a collapsed folder for 1 second; verify folder expands automatically
  - drag a source onto itself; verify the drop indicator turns red and cursor becomes not-allowed
  - drag a group onto one of its descendant subgroups; verify red indicator + not-allowed cursor

## Open Questions

None.

## References

- Brainstorm source: this session, 2026-05-26, Plan B option 2 selection from the batch-drag follow-up.
- Predecessor spec: [docs/superpowers/specs/2026-05-26-batch-drag-and-edge-auto-scroll-design.md](docs/superpowers/specs/2026-05-26-batch-drag-and-edge-auto-scroll-design.md) — the Plan A spec that named this work as Plan B leftovers.
- Existing drag handlers: `src/content/content-tree-interactions.js` `handleDragStart` / `handleDragOver` / `handleDragLeave` / `handleDrop` / `handleDragEnd` / `clearDragFeedback` (around lines 860–1230 at HEAD `52d08f3`).
- Existing isDescendant guard: `src/content/content-tree-interactions.js:1207` (currently in `handleDrop`, used here in `handleDragOver` for visual feedback).
- Existing collapse mechanics: `src/content/content-tree-interactions.js:470` `toggleGroupCollapse`.
- Existing drag indicator CSS: `src/content/content-style-text.js` `.drag-over-top` / `.drag-into` / `.drag-over-bottom` rules.
- Existing accent-danger token: `src/content/content-style-text.js:67` (light: `#ff3b30`) and `:184` (dark: `#ff453a`).
