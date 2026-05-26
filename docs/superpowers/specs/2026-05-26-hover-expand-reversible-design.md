# Reversible Hover-Expand Design

## Summary

Make the existing hover-expand-on-drag interaction symmetric. The previous design opened a collapsed group after 600ms of continuous drag-hover and **kept it open after drag end**. This spec reverses that policy: groups opened by hover are now eligible for automatic collapse during and immediately after the drag, unless the drop landed inside their subtree.

This amends the design decision from [2026-05-26-hover-expand-and-invalid-drop-design.md](docs/superpowers/specs/2026-05-26-hover-expand-and-invalid-drop-design.md). The hover-expand feature has not yet been released; this change happens before merge.

## Goals

- Symmetric timing: hover for 600ms opens, drag-away for 600ms closes.
- Auto-collapse only affects groups opened *by* hover during the current drag — manually expanded groups (chevron-clicked before drag) are untouched.
- Ancestor immunity during nested drags: while the pointer is exploring a descendant of a hover-expanded group, that ancestor stays open.
- Drop landing inside a hover-expanded subtree pins it open permanently (matches the user's intent of "I put the source there, so I want to see it").

## Non-Goals

- Do not change the existing 600ms expand delay.
- Do not change `toggleGroupCollapse`'s collapse animation (already verified working in both paths after the post-shipping fix).
- Do not introduce a different timeout for collapse — symmetric 600ms keeps the mental model simple.
- Do not introduce per-group user preferences ("never auto-collapse this folder"); out of scope.
- Do not change behavior for groups that were already expanded when the drag started.

## User Experience

### Opening (unchanged)

Drag over a collapsed group header for 600ms → group expands. The group is registered as "hover-opened in this drag."

### Reversal — moving the pointer away

When the pointer leaves a hover-opened group's subtree (i.e., the pointer is no longer on that group or any of its descendant groups/sources), a 600ms collapse timer arms for that group. If the pointer returns to the group or any descendant within 600ms, the timer cancels and the group stays open. If 600ms elapse without return, the group collapses via `toggleGroupCollapse` (same animation as click and hover-expand).

### Nested navigation — ancestor immunity

If the user navigates A → B → C (each opening by hover), all three are hover-opened. The pointer being on C means A and B are ancestors of the pointer's current group — neither A nor B's collapse timer arms. Only groups whose subtree no longer contains the pointer arm their collapse timer.

### Drop disposition

When the drop succeeds:
- The "landing group" is the parent group of the drop target. For `into-group` intent, this is `intent.targetGroup`. For `before-source` / `after-source`, it is the parent group of the target source (or null if the source is at root). For `before-group` / `after-group`, it is the parent group of the target group (or null at root).
- Any hover-opened group equal to or an ancestor of the landing group is removed from the hover-opened set — it stays open permanently.
- Any hover-opened group not in the landing ancestor chain collapses immediately (no timer).

### Drag end without a successful drop

`handleDragEnd` and `clearDragFeedback` (which run on Esc-cancel, drop outside any valid target, and as a backstop) collapse any group still in the hover-opened set immediately. All pending hover timers cancel.

### Manually expanded groups

Groups opened via chevron click before the drag started are not in the hover-opened set. They are never affected by this mechanism. The user can chevron-collapse them after the drag if desired.

## Architecture

### Runtime state

The existing `runtime.hoverExpandTimer` field (single in-flight timer pointing at one groupId) is replaced by three fields:

- `runtime.hoverExpandedGroupIds: Set<string>` — groups opened by hover during the current drag.
- `runtime.hoverExpandTimers: Map<string, { kind: 'expand' | 'collapse', timeoutId: number }>` — at most one timer per group at any moment.
- (Re-uses the existing `runtime.activeDragContext` for whether a drag is in progress.)

The Set is the source of truth for "which groups participate in auto-collapse." The Map disambiguates the timer kind so a re-entering pointer can correctly cancel a collapse-in-flight or arm an expand.

### Helper inventory (all private to the factory)

| Helper | Replaces | Behavior |
|---|---|---|
| `armHoverExpandTimerForGroup(groupId)` | part of old `armHoverExpandTimer` | If the group is collapsed and has children and no timer is already armed for this kind/group, schedule a 600ms `executeHoverExpand(groupId)`. |
| `armHoverCollapseTimerForGroup(groupId)` | new | If the group is in `hoverExpandedGroupIds` and no timer is armed for this kind/group, schedule a 600ms `executeHoverCollapse(groupId)`. |
| `cancelHoverTimerForGroup(groupId)` | part of old `cancelHoverExpandTimer` | Clear the entry in `hoverExpandTimers` for that group. |
| `cancelAllHoverTimers()` | full-clear variant | Iterate the Map and clear every entry. Used in dragstart, dragend, drop, clearDragFeedback. |
| `executeHoverExpand(groupId)` | unchanged from original | Call `toggleGroupCollapse(group, container)`; on success, add `groupId` to `hoverExpandedGroupIds`. |
| `executeHoverCollapse(groupId)` | new | Delete `groupId` from `hoverExpandedGroupIds` first (idempotency), then if the group is currently expanded and in the DOM, call `toggleGroupCollapse(group, container)`. |
| `getGroupAncestorChain(groupId)` | new pure helper | Return `string[]` of `groupId` plus all ancestors via `getParentMap()`. Used to detect ancestor immunity and drop-landing immunity. |

### handleDragOver — new per-event logic

After the existing intent-class assignment and invalid-drop check, before the auto-scroll tick:

```
1. Resolve the pointer's current group ancestry:
   pointerGroupContainer = e.target.closest('.group-container')
   pointerGroupId = pointerGroupContainer?.dataset.groupId || null
   ancestorChain = pointerGroupId ? getGroupAncestorChain(pointerGroupId) : []
   ancestorSet = new Set(ancestorChain)

2. For each G in hoverExpandedGroupIds:
   if G ∈ ancestorSet:
       cancelHoverTimerForGroup(G)   // pointer is in G's subtree (or on G), keep open
   else:
       if no collapse timer armed for G:
           armHoverCollapseTimerForGroup(G)

3. For the pointer's own group (if any):
   if pointerGroupId && it's a collapsed group with children:
       armHoverExpandTimerForGroup(pointerGroupId)
   else:
       cancelHoverTimerForGroup(pointerGroupId) (if pointerGroupId is non-null)
       // Non-group target (source row, whitespace): no expand to arm
```

Step 2's order matters: cancel before arming so a same-group dragover doesn't briefly thrash.

### handleDrop — disposition of hover-opened groups

In each successful drop branch (single source, multi source, group), after the state mutation and before `clearDragFeedback`:

```
landingGroupId = resolveDropLandingGroupId(intent, augmentedIntent)
   // null for root-level drops; otherwise the parent group's id

landingAncestors = landingGroupId
   ? new Set(getGroupAncestorChain(landingGroupId))
   : new Set()

for each G in [...hoverExpandedGroupIds]:
   if landingAncestors.has(G):
       hoverExpandedGroupIds.delete(G)   // permanent — leave expanded
   else:
       executeHoverCollapse(G)            // immediate collapse

cancelAllHoverTimers()
```

`resolveDropLandingGroupId` is a small new private helper that reads:
- `into-group` → `intent.targetGroup.id`
- `before-source` / `after-source` → the parent group of `intent.targetList` (which is either `state.ungrouped` or some `group.children`)
- `before-group` / `after-group` → parent of the target group (`parentMap.get(intent.targetGroup?.id)` or null for root)

### handleDragEnd, clearDragFeedback, handleDragLeave (sources-list)

Each calls `cancelAllHoverTimers()`. Additionally, `handleDragEnd` and `clearDragFeedback` collapse remaining hover-opened groups:

```
for each G in [...hoverExpandedGroupIds]:
   executeHoverCollapse(G)
hoverExpandedGroupIds.clear()
```

Note: `executeHoverCollapse` already deletes from the set; the explicit `clear()` at the end is defensive against bugs.

`handleDragLeave` keeps the lighter behavior — only cancels timers, does NOT collapse. Leaving `#sources-list` mid-drag isn't necessarily drag-end (the user could re-enter); collapse should wait for actual drag end.

### handleDragStart — defensive reset

At the start of each dragstart (both source and group branches), call:

```
cancelAllHoverTimers()
hoverExpandedGroupIds.clear()
```

Guards against stale state from an abnormally terminated previous drag.

## Data Flow

### Single-group hover-and-leave

```
t=0    dragover on collapsed A → armHoverExpandTimerForGroup('A')
t=600  expand timer fires → toggleGroupCollapse(A); hoverExpandedGroupIds = {A}
t=...  dragover continues on A → ancestorSet contains A → cancelHoverTimerForGroup('A') (no-op)
t=900  dragover on root-level whitespace → pointerGroupId=null, ancestorSet=∅
       A ∉ ancestorSet → armHoverCollapseTimerForGroup('A')
t=1500 collapse timer fires → executeHoverCollapse('A') → toggleGroupCollapse(A); hoverExpandedGroupIds = ∅
t=...  drop somewhere; clearDragFeedback → cancelAllHoverTimers (already empty), clear set (already empty)
```

### Return-before-collapse

```
t=0    hover-open A
t=900  pointer leaves A → arm collapse timer for A
t=1200 pointer returns to A (within 600ms) → ancestorSet contains A → cancelHoverTimerForGroup('A')
t=...  A stays open
```

### Nested A→B→C path then drop into C

```
hover-open A, B, C in sequence. hoverExpandedGroupIds = {A, B, C}.
drop into C.
landingGroupId = parent of drop target (= C, assuming drop is into-C-as-group).
landingAncestors = {C, B, A} (via getGroupAncestorChain).
For each G in {A,B,C}: G ∈ landingAncestors → delete from set.
Result: all three stay open permanently.
```

### Open A, then drop OUTSIDE A

```
hover-open A. hoverExpandedGroupIds = {A}.
drop into ungrouped or into a sibling group B that is not in A's chain.
landingGroupId = null (ungrouped) or B.
landingAncestors = ∅ or {B} (and B's ancestors), none containing A.
For A: A ∉ landingAncestors → executeHoverCollapse('A') immediately.
Result: A collapses on drop.
```

### Esc-cancel mid-drag

```
hover-open A. hoverExpandedGroupIds = {A}.
User presses Esc. Browser fires dragend (most cases) or just stops; clearDragFeedback runs.
For each G in {A}: executeHoverCollapse('A').
hoverExpandedGroupIds = ∅.
```

## Error Handling

| Case | Behavior |
|------|----------|
| `getParentMap()` returns a Map missing some groupId (stale map) | `getGroupAncestorChain(id)` terminates the walk on missing parent; chain length is bounded by depth or "until missing." Treats missing as root-level. |
| Group deleted mid-drag (impossible via current UI but defensive) | `executeHoverCollapse` re-resolves via `groupsById.get(groupId)`; missing group → no-op. |
| Two hover-collapse timers race (shouldn't happen — Map keyed by groupId) | `armHoverCollapseTimerForGroup` short-circuits when an entry exists for that groupId. |
| Pointer leaves the shadow DOM entirely | `e.target.closest('.group-container')` returns null → `pointerGroupId = null` → all hover-opened groups arm their collapse timers. The 600ms timeout proceeds normally; if user re-enters before 600ms, timers cancel. |
| `cancelAllHoverTimers` called while a timer is mid-fire | The `executeHoverExpand` / `executeHoverCollapse` callbacks delete from the Map first; clearTimeout on an already-fired ID is a no-op. |
| Drop with `intent` of an unrecognized kind | `resolveDropLandingGroupId` returns null → landingAncestors empty → all hover-opened groups collapse. Sensible fallback. |

## Testing

All tests added to the existing `describe('handleDragOver hover-expand', ...)` block in `tests/content/content-tree.test.js`. Use `jest.useFakeTimers()` for deterministic 600ms control.

### Retained (7 from previous shipping)

1. 600ms expand on collapsed group with children → collapsed=false
2. Target change cancels expand timer
3. Already-expanded group → no expand timer
4. Empty collapsed group → no expand timer
5. dragleave on `#sources-list` cancels expand timer
6. dragend cancels expand timer
7. drop cancels expand timer

These continue to verify the expand path unchanged.

### New (7 cases)

8. **Auto-collapse after move-away.** Hover-expand A; advance 600ms (A expands); dragover on a different group/source for 600ms more; assert A.collapsed === true.

9. **Return-before-collapse cancels timer.** Hover-expand A; move pointer away for 300ms; move back to A; advance another 600ms (total 900ms since first leave); assert A.collapsed === false (still open).

10. **Ancestor immunity for descendants.** Hover-expand A; pointer moves onto a source row inside A's children; advance 1000ms; assert A.collapsed === false. (No collapse because pointer is in A's subtree.)

11. **Sibling groups have independent timers.** Hover-expand A and B (sibling collapsed groups, parent = root). Pointer leaves A toward B; B's expand timer should fire on B after 600ms; A's collapse timer should fire on A after 600ms (counted from when pointer left A). Final state: A.collapsed=true, B.collapsed=false.

12. **Drop into hover-expanded subtree leaves it open.** Hover-expand A; drop a source into A (via `into-group` intent). After drop and `clearDragFeedback`, A.collapsed === false.

13. **Drop outside hover-expanded group collapses it.** Hover-expand A; drop a source into ungrouped (not A's descendant). After drop, A.collapsed === true.

14. **dragend without drop collapses hover-opened groups.** Hover-expand A; call handleDragEnd directly (simulating Esc-cancel). Assert A.collapsed === true and `hoverExpandedGroupIds.size === 0`.

### Pure helper test

15. **`getGroupAncestorChain`.** Use the existing factory (which exposes the test harness's `getParentMap` mock). Verify chain ordering: `['C', 'B', 'A']` for C nested under B under A; `['root']` for a root-level group; empty array for unknown id. (Inline test inside the same describe — no new file.)

### Existing tests preserved

The Task 1–5 integration tests (activeDragContext, invalid-drop, prior hover-expand) all continue to pass. The 5 invalid-drop tests are orthogonal to this change.

## Risks and Mitigations

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | `getParentMap` stale | Drag-only window; parentMap rebuilds via `buildParentMap` on every saveState. Stale-during-drag is impossible because no add/move/remove can occur during a drag. |
| R2 | `executeHoverCollapse` mid-drag re-render race | `toggleGroupCollapse` does not call `render()`; only mutates `group.collapsed` + DOM styles. No tree rebuild during animation. |
| R3 | Double-fire (timer + dragend backstop) | `executeHoverCollapse` deletes from set first, then re-resolves group; second call is no-op. |
| R4 | Performance: per-dragover ancestor walks for many open groups | `hoverExpandedGroupIds.size` is bounded by drag depth (typically ≤ 5). Each ancestor chain is also bounded by depth. O(open_groups × depth) per dragover — negligible. |
| R5 | Esc-cancel doesn't fire dragend in some browsers | `clearDragFeedback` is the universal backstop and runs from `handleDrop` and other paths; both call the collapse-and-clear sequence. |
| R6 | Animation timing collision: collapse fires while expand animation still in progress | The `transitionend` listener on the children container is set up in both directions. A collapse triggered mid-expand would set `height: scrollHeight → 0` mid-animation; browser cancels the previous transition and starts the new one. Visually: the children container starts closing from wherever it was. Acceptable. |
| R7 | Auto-collapse interrupts user mid-drag if they pause for >600ms thinking | The trigger requires the pointer to *not* be in the subtree. If the user pauses while still on the group or its descendants, no timer arms. Pausing on whitespace for 600ms while expecting the group to stay open is the rare misalignment; the symmetric mental model makes it predictable. |

## Rollout and Rollback

- No storage schema change.
- No message protocol change.
- No new locale key.
- No new module / manifest / loader / harness change.
- No CSS change (the visual is `toggleGroupCollapse`'s existing animation).

Rollback: revert the changes to `content-tree-interactions.js` and the test additions. The previous "stays expanded after drag end" behavior comes back. No data migration in either direction.

## Verification Matrix

- `npm run lint` → 0 errors, 0 warnings.
- `npm run test:unit` → existing suite passes + 7 new integration cases + 1 pure helper test (total +8).
- `npm run test:smoke` → 18 smokes unchanged; no new smoke (jsdom + fake timers handle this more precisely).
- Manual browser smoke (README append):
  - hover-open a folder during drag, then drag away for 1 second; verify the folder auto-collapses with the same animation
  - hover-open A → hover-open B inside A → drag back out to root, leaving for 1 second; verify both collapse
  - hover-open a folder, drop the source inside; verify the folder stays open

## Documentation Updates

- **CHANGELOG `Unreleased > Added`**: amend the existing "拖拽悬停展开折叠组" entry — remove the trailing "hover 触发的展开在拖动结束后保持，不会自动折回" claim (it's no longer true).
- **CHANGELOG `Unreleased > Changed`**: new entry describing the reversibility (move-away auto-collapse, ancestor immunity, drop-disposition rules).
- **README Development Smoke Checklist**: append one new bullet for the auto-collapse verification.
- **PROJECT_DIRECTORY.md**: no change (no new module, no new feature domain).
- **UI_GUIDELINES.md**: no change (no new component class or token).

## Open Questions

None.

## References

- Predecessor spec (the one this amends): [docs/superpowers/specs/2026-05-26-hover-expand-and-invalid-drop-design.md](docs/superpowers/specs/2026-05-26-hover-expand-and-invalid-drop-design.md)
- Existing hover-expand implementation: `src/content/content-tree-interactions.js` around lines 1091–1139 (helpers) and the augmented handlers
- Existing `toggleGroupCollapse`: `src/content/content-tree-interactions.js:477` (includes the post-shipping animation fix at HEAD `<uncommitted>`)
- `getParentMap` dep: `src/content/content-tree-interactions.js:107` factory resolution
- `isDescendant` is NOT used by this spec (ancestry uses `parentMap` ancestor walk instead — simpler and faster than `isDescendant`'s child-direction walk)
