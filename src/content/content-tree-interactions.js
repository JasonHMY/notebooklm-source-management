(function () {
    'use strict';

    function createContentTreeInteractions(deps = {}) {
        const runtime = deps.runtime || deps;
        const NATIVE_SELECTION_SYNC_RETRY_LIMIT = 6;

        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || runtime.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || runtime.groupsById || new Map());
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || runtime.sourcesByKey || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || runtime.pendingBatchKeys || new Set());
        const getParentMap = typeof deps.getParentMap === 'function'
            ? deps.getParentMap
            : () => (deps.parentMap || runtime.parentMap || new Map());
        const getClickQueue = typeof deps.getClickQueue === 'function'
            ? deps.getClickQueue
            : () => (deps.clickQueue || runtime.clickQueue || []);
        const getKeyByElement = typeof deps.getKeyByElement === 'function'
            ? deps.getKeyByElement
            : () => (deps.keyByElement || runtime.keyByElement || new WeakMap());
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || runtime.shadowRoot || null);
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (deps.document || runtime.document || globalThis.document || null);
        const getWindow = typeof deps.getWindow === 'function'
            ? deps.getWindow
            : () => (deps.window || runtime.window || globalThis.window || null);
        const getSetTimeout = typeof deps.getSetTimeout === 'function'
            ? deps.getSetTimeout
            : () => (deps.setTimeout || runtime.setTimeout || globalThis.setTimeout || null);
        const getDEPS = typeof deps.getDEPS === 'function'
            ? deps.getDEPS
            : () => (deps.DEPS || runtime.DEPS || {});
        const getSourceCheckboxSelector = typeof deps.getSourceCheckboxSelector === 'function'
            ? deps.getSourceCheckboxSelector
            : () => (deps.SOURCE_CHECKBOX_SELECTOR || runtime.SOURCE_CHECKBOX_SELECTOR || '.sp-checkbox');
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key, args) => {
                if (typeof runtime.getMessage === 'function') return runtime.getMessage(key, args);
                return key;
            };
        const showToast = typeof deps.showToast === 'function'
            ? deps.showToast
            : (typeof runtime.showToast === 'function' ? runtime.showToast : () => {});
        const showUndoableToast = typeof deps.showUndoableToast === 'function'
            ? deps.showUndoableToast
            : showToast;
        const render = typeof deps.render === 'function'
            ? deps.render
            : (typeof runtime.render === 'function' ? runtime.render : () => {});
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
            : (typeof runtime.saveState === 'function' ? runtime.saveState : () => {});
        const buildParentMap = typeof deps.buildParentMap === 'function'
            ? deps.buildParentMap
            : (typeof runtime.buildParentMap === 'function' ? runtime.buildParentMap : () => {});
        const isSourceEffectivelyEnabled = typeof deps.isSourceEffectivelyEnabled === 'function'
            ? deps.isSourceEffectivelyEnabled
            : (typeof runtime.isSourceEffectivelyEnabled === 'function' ? runtime.isSourceEffectivelyEnabled : () => true);
        const collectEffectiveSourceStates = typeof deps.collectEffectiveSourceStates === 'function'
            ? deps.collectEffectiveSourceStates
            : (typeof runtime.collectEffectiveSourceStates === 'function' ? runtime.collectEffectiveSourceStates : () => new Map());
        const syncSourcesToEffectiveState = typeof deps.syncSourcesToEffectiveState === 'function'
            ? deps.syncSourcesToEffectiveState
            : (typeof runtime.syncSourcesToEffectiveState === 'function' ? runtime.syncSourcesToEffectiveState : () => {});
        const executeBatchDelete = typeof deps.executeBatchDelete === 'function'
            ? deps.executeBatchDelete
            : (typeof runtime.executeBatchDelete === 'function' ? runtime.executeBatchDelete : () => {});
        const renderMoveToFolderModal = typeof deps.renderMoveToFolderModal === 'function'
            ? deps.renderMoveToFolderModal
            : (typeof runtime.renderMoveToFolderModal === 'function' ? runtime.renderMoveToFolderModal : () => {});
        const renderBatchTagModal = typeof deps.renderBatchTagModal === 'function'
            ? deps.renderBatchTagModal
            : (typeof runtime.renderBatchTagModal === 'function' ? runtime.renderBatchTagModal : () => {});
        const getSourceActionInvokers = typeof deps.getSourceActionInvokers === 'function'
            ? deps.getSourceActionInvokers
            : () => (deps.sourceActionInvokers || runtime.sourceActionInvokers || {});
        const handleSourceActionSelection = typeof deps.handleSourceActionSelection === 'function'
            ? deps.handleSourceActionSelection
            : (typeof runtime.handleSourceActionSelection === 'function' ? runtime.handleSourceActionSelection : () => {});
        const applyNativeLabelImportFromUi = typeof deps.applyNativeLabelImportFromUi === 'function'
            ? deps.applyNativeLabelImportFromUi
            : (typeof runtime.applyNativeLabelImportFromUi === 'function' ? runtime.applyNativeLabelImportFromUi : () => false);
        const toggleSourceActionMenu = typeof deps.toggleSourceActionMenu === 'function'
            ? deps.toggleSourceActionMenu
            : (typeof runtime.toggleSourceActionMenu === 'function' ? runtime.toggleSourceActionMenu : () => {});
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : (typeof runtime.closeSourceActionMenu === 'function' ? runtime.closeSourceActionMenu : () => {});
        const findFreshCheckbox = typeof deps.findFreshCheckbox === 'function'
            ? deps.findFreshCheckbox
            : (typeof runtime.findFreshCheckbox === 'function' ? runtime.findFreshCheckbox : () => null);
        const resolveFreshRowEntry = typeof deps.resolveFreshRowEntry === 'function'
            ? deps.resolveFreshRowEntry
            : (typeof runtime.resolveFreshRowEntry === 'function' ? runtime.resolveFreshRowEntry : null);
        const isDescendant = typeof deps.isDescendant === 'function'
            ? deps.isDescendant
            : (typeof runtime.isDescendant === 'function' ? runtime.isDescendant : () => false);
        const getIsProcessingQueue = typeof deps.getIsProcessingQueue === 'function'
            ? deps.getIsProcessingQueue
            : () => Boolean(deps.isProcessingQueue ?? runtime.isProcessingQueue);
        const setIsProcessingQueue = typeof deps.setIsProcessingQueue === 'function'
            ? deps.setIsProcessingQueue
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'isProcessingQueue')) {
                    deps.runtime.isProcessingQueue = Boolean(value);
                } else {
                    deps.isProcessingQueue = Boolean(value);
                }
            };
        const getIsSyncingState = typeof deps.getIsSyncingState === 'function'
            ? deps.getIsSyncingState
            : () => Boolean(deps.isSyncingState ?? runtime.isSyncingState);
        const setIsSyncingState = typeof deps.setIsSyncingState === 'function'
            ? deps.setIsSyncingState
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'isSyncingState')) {
                    deps.runtime.isSyncingState = Boolean(value);
                } else {
                    deps.isSyncingState = Boolean(value);
                }
            };
        const getActiveIsolationGroupId = typeof deps.getActiveIsolationGroupId === 'function'
            ? deps.getActiveIsolationGroupId
            : () => (deps.activeIsolationGroupId ?? runtime.activeIsolationGroupId ?? null);
        const setActiveIsolationGroupId = typeof deps.setActiveIsolationGroupId === 'function'
            ? deps.setActiveIsolationGroupId
            : (value) => {
                if (deps.runtime && Object.prototype.hasOwnProperty.call(deps.runtime, 'activeIsolationGroupId')) {
                    deps.runtime.activeIsolationGroupId = value;
                } else {
                    deps.activeIsolationGroupId = value;
                }
            };
        const getIsDeletingSources = typeof deps.getIsDeletingSources === 'function'
            ? deps.getIsDeletingSources
            : () => Boolean(deps.isDeletingSources ?? runtime.isDeletingSources);
        const getCurrentSourceViewKind = typeof deps.getCurrentSourceViewKind === 'function'
            ? deps.getCurrentSourceViewKind
            : () => (deps.sourceViewKind || runtime.sourceViewKind || null);
        const recordNativeSelectionSyncFailure = typeof deps.recordNativeSelectionSyncFailure === 'function'
            ? deps.recordNativeSelectionSyncFailure
            : () => {};
        const developerLog = typeof deps.developerLog === 'function'
            ? deps.developerLog
            : (typeof runtime.developerLog === 'function' ? runtime.developerLog : () => false);

        const dragMulti = (typeof deps.dragMulti === 'object' && deps.dragMulti)
            ? deps.dragMulti
            : (typeof runtime.dragMulti === 'object' && runtime.dragMulti
                ? runtime.dragMulti
                : (typeof globalThis.NSM_CREATE_CONTENT_DRAG_MULTI === 'function'
                    ? globalThis.NSM_CREATE_CONTENT_DRAG_MULTI({})
                    : null));

        const dragReflow = (typeof deps.dragReflow === 'object' && deps.dragReflow)
            ? deps.dragReflow
            : (typeof runtime.dragReflow === 'object' && runtime.dragReflow
                ? runtime.dragReflow
                : (typeof globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW === 'function'
                    ? globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW({})
                    : null));

        function getSourceListContainer() {
            const root = getShadowRoot();
            return root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
        }

        function resolveSiblingKeys(intent) {
            if (!intent) return [];
            const list = Array.isArray(intent.targetList) ? intent.targetList : null;
            if (!list) return [];
            return list.map((entry) => {
                if (typeof entry === 'string') return entry;
                if (entry && typeof entry === 'object') {
                    if (entry.type === 'source') return entry.key;
                    if (entry.type === 'group') return entry.id;
                }
                return null;
            }).filter(Boolean);
        }

        const extractInlineTranslateY = dragReflow && typeof dragReflow.extractInlineTranslateY === 'function'
            ? dragReflow.extractInlineTranslateY
            : function fallbackExtractInlineTranslateY(el) {
                if (!el || !el.style) return 0;
                const t = el.style.transform || '';
                if (!t) return 0;
                const m = t.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
                return m ? parseFloat(m[1]) : 0;
            };

        // Resolve drop-intent geometrically from pointer-Y, independent of e.target.closest().
        // Returns null when no list / no candidates match.
        //
        // Algorithm:
        //   1. One pass query for `.group-container` + `.source-item` under rootElement.
        //   2. Pick the deepest group-container whose un-shifted bounds enclose clientY.
        //      - If pointer in its `.group-header` band → kind='into-group', insertIndex=0
        //        (source lands at the TOP of the folder so the user sees it immediately
        //        when the folder is expanded — matches user intuition of "I added this
        //        source to this folder, where is it?").
        //      - If pointer in its `.group-children` band AND children empty → kind='into-group',
        //        insertIndex=0 (only one position possible).
        //      - Otherwise host = group.children, find slot within children DOM.
        //   3. If no group contains the pointer → host = root list (state.groups + ungrouped).
        //   4. Slot detection: for each non-folded child element, compare its un-shifted
        //      mid-Y against clientY; the first whose mid-Y > clientY becomes the insert slot.
        //      All elements past clientY → insertIndex = childCount.
        //
        // Un-shifted bounds means `rect.top - extractInlineTranslateY(el)`: subtract any
        // active reflow shift so the detection is stable while siblings are translateY'd.
        function computeDropIntent({ clientX, clientY, rootElement, state, groupsById, parentMap, activeDragContext }) {
            if (typeof clientY !== 'number' || !rootElement || typeof rootElement.querySelectorAll !== 'function') {
                return null;
            }
            // Reject cursors outside the source-list viewport entirely — handleDragOver bubbles
            // up from anywhere in the panel; without this we'd compute a phantom slot when the
            // cursor is over the chat / studio / outer chrome.
            if (typeof rootElement.getBoundingClientRect === 'function') {
                const rootRect = rootElement.getBoundingClientRect();
                if (rootRect && (clientY < rootRect.top || clientY >= rootRect.bottom)) {
                    return null;
                }
            }
            const stateObj = state || {};
            const groups = stateObj.groups = Array.isArray(stateObj.groups) ? stateObj.groups : [];
            const ungrouped = stateObj.ungrouped = Array.isArray(stateObj.ungrouped) ? stateObj.ungrouped : [];

            // Find the deepest group-container whose children-area encloses clientY.
            const containers = rootElement.querySelectorAll('.group-container');
            const containerList = containers && typeof containers.forEach === 'function'
                ? Array.from(containers)
                : (Array.isArray(containers) ? containers : []);

            const getDepth = (groupId) => {
                if (!groupId || !parentMap || typeof parentMap.get !== 'function') return 0;
                let depth = 0;
                let cursor = groupId;
                const seen = new Set([cursor]);
                while (true) {
                    const p = parentMap.get(cursor);
                    if (!p || seen.has(p)) break;
                    seen.add(p);
                    depth += 1;
                    cursor = p;
                }
                return depth;
            };

            const unshiftedRect = (el) => {
                if (!el || typeof el.getBoundingClientRect !== 'function') return null;
                const rect = el.getBoundingClientRect();
                if (!rect || typeof rect.top !== 'number' || typeof rect.height !== 'number') return null;
                const shift = extractInlineTranslateY(el);
                return {
                    top: rect.top - shift,
                    bottom: rect.bottom - shift,
                    height: rect.height,
                    left: typeof rect.left === 'number' ? rect.left : 0,
                    width: typeof rect.width === 'number' ? rect.width : 0
                };
            };

            // Pick deepest container that contains pointer.
            //
            // For TOP-LEVEL group containers, apply a left/right X-split rule
            // RESTRICTED TO COLLAPSED FOLDERS' HEADER STRIPS:
            // - folder is COLLAPSED + cursor on header, LEFT HALF (X < header.left
            //   + header.width / 2) → treated as OUTSIDE the container. User is
            //   signalling "this folder should sibling-reorder, I'm not trying to
            //   enter it". chosenContainer = null → root-level slot detection →
            //   source goes to ungrouped, group is reordered.
            // - folder is COLLAPSED + cursor on header, RIGHT HALF (X >= midX) →
            //   INSIDE. User wants into-group behavior. hover-expand timer arms.
            // - folder is EXPANDED → X-split DOES NOT APPLY at all. Cursor over
            //   the header resolves to into-group (header drop), cursor over the
            //   children area resolves to slot detection or into-group sentinel
            //   normally.
            // - cursor BELOW the header (children area / gap) on ANY folder →
            //   X-split DOES NOT APPLY (same as above — pass 1 only ever fires
            //   when cursor Y is in header's Y range).
            //
            // Why collapsed-only: an expanded folder has its sources visible to
            // the user, so the natural escape gesture is Y position (gap between
            // folders / above-below). Forcing left-half exclusion on expanded
            // headers fights user intuition that "the header is a valid drop
            // target — clicking/dragging the header should add to the folder".
            // Collapsed folders only show their header — the children aren't on
            // screen, so the user has no Y corridor inside; X-split is the only
            // generous escape route, and applying it there matches the visual
            // signal that the folder is a single "chip" the user can drop near.
            //
            // Why header-only (within collapsed): the X-split corridor is a
            // gesture about the folder AS A UNIT — "I'm dragging near/around this
            // folder, not into it". The header is the only part that visually
            // represents the folder as a unit. Even when collapsed there's no
            // children area, but keeping the header-only restriction means future
            // hover-expand or other geometry changes don't accidentally extend
            // the corridor beyond where the user can see the folder strip.
            //
            // Rationale for the X-split corridor itself: top-level group headers
            // span the full panel width (~350-450px), so a left/right split gives
            // the user a generous physical corridor on the left to express
            // "between groups" / "at root level". The previous attempt (8px edge
            // zones at top/bottom of each container) was too small — most of the
            // group's Y-range was still "inside" and the user kept triggering
            // hover-expand by accident.
            //
            // Nested groups INHERIT their top-level ancestor's X-split exclusion:
            // when a user moves cursor into the left-half corridor of a collapsed
            // top-level group A's header (rare but possible if A holds nested
            // groups that get drag-folded out), any nested group B inside A is
            // also excluded so cursor over B does NOT sneakily route into B.
            const _isTopLevelGroup = (gid) => {
                if (!gid) return false;
                if (!parentMap || typeof parentMap.get !== 'function') return true;
                const p = parentMap.get(gid);
                return !p;
            };
            const _hasClientX = typeof clientX === 'number';

            // Pass 1: identify top-level groups whose X-split rule excludes them
            // at the current cursor position. Only COLLAPSED top-level folders
            // participate — expanded folders are skipped because the user has
            // visual access to the children and uses Y-axis gaps for escape, not
            // header X position. X-split is evaluated against the HEADER's rect
            // so cursor must be in the header's Y range for the corridor to fire.
            // Cached so pass 2 can apply inheritance to nested groups without
            // re-querying ancestor rects.
            const _xSplitExcludedTopIds = new Set();
            if (_hasClientX) {
                const _groupsByIdSafe = groupsById && typeof groupsById.get === 'function'
                    ? groupsById : null;
                for (const container of containerList) {
                    if (!container || !container.dataset) continue;
                    const _gid = container.dataset.groupId;
                    if (!_gid) continue;
                    if (!_isTopLevelGroup(_gid)) continue;
                    if (container.classList && container.classList.contains('sp-drag-folded')) continue;
                    const _grp = _groupsByIdSafe ? _groupsByIdSafe.get(_gid) : null;
                    if (!_grp || !_grp.collapsed) continue;
                    const _headerEl = typeof container.querySelector === 'function'
                        ? container.querySelector('.group-header')
                        : null;
                    if (!_headerEl) continue;
                    const _hr = unshiftedRect(_headerEl);
                    if (!_hr || _hr.width <= 0) continue;
                    if (clientY < _hr.top || clientY >= _hr.bottom) continue;
                    const _midX = _hr.left + _hr.width / 2;
                    if (clientX < _midX) _xSplitExcludedTopIds.add(_gid);
                }
            }

            // Pass 2: pick deepest container that contains pointer AND isn't excluded
            // (directly or via top-level ancestor) by X-split.
            let chosenContainer = null;
            let chosenDepth = -1;
            for (const container of containerList) {
                if (!container || !container.dataset) continue;
                if (container.classList && container.classList.contains('sp-drag-folded')) continue;
                const r = unshiftedRect(container);
                if (!r) continue;
                if (clientY < r.top || clientY >= r.bottom) continue;

                // Resolve this container's top-level ancestor (self if already top-level)
                // and skip if that ancestor is in the X-split excluded set.
                let _topAncestorId = container.dataset.groupId;
                if (parentMap && typeof parentMap.get === 'function') {
                    const _seen = new Set([_topAncestorId]);
                    while (true) {
                        const _pid = parentMap.get(_topAncestorId);
                        if (!_pid || _seen.has(_pid)) break;
                        _seen.add(_pid);
                        _topAncestorId = _pid;
                    }
                }
                if (_xSplitExcludedTopIds.has(_topAncestorId)) continue;

                const d = getDepth(container.dataset.groupId);
                if (d > chosenDepth) {
                    chosenContainer = container;
                    chosenDepth = d;
                }
            }

            let host = null;
            let hostGroup = null;
            let hostContainerEl = null;

            if (chosenContainer) {
                const groupId = chosenContainer.dataset && chosenContainer.dataset.groupId;
                const groupObj = groupId && groupsById && typeof groupsById.get === 'function'
                    ? groupsById.get(groupId)
                    : null;
                if (!groupObj) return null;

                const headerEl = typeof chosenContainer.querySelector === 'function'
                    ? chosenContainer.querySelector('.group-header')
                    : null;
                const childrenEl = typeof chosenContainer.querySelector === 'function'
                    ? chosenContainer.querySelector('.group-children')
                    : null;

                // Pointer in group-header → into-group sentinel.
                if (headerEl) {
                    const headerR = unshiftedRect(headerEl);
                    if (headerR && clientY >= headerR.top && clientY < headerR.bottom) {
                        return {
                            kind: 'into-group',
                            targetGroup: groupObj,
                            targetList: Array.isArray(groupObj.children) ? groupObj.children : (groupObj.children = []),
                            insertIndex: 0,
                            targetGroupId: groupObj.id,
                            hostGroupContainerEl: chosenContainer,
                            slotKey: null
                        };
                    }
                }

                // Group drag override: cursor inside another group's body (but NOT on its
                // header) should mean "reorder at THAT group's sibling level", NOT "nest
                // dragged group inside it". Without this, dragging a folder over another
                // folder always nested — users couldn't reorder folders by drag. Header
                // drops still nest (handled above). Resolve host as chosenContainer's parent
                // group (or root if chosenContainer is top-level), then fall through to slot
                // detection so the chosen container itself becomes a slot candidate.
                const _isGroupDrag = activeDragContext && activeDragContext.kind === 'group';
                if (_isGroupDrag) {
                    const _parentGroupId = parentMap && typeof parentMap.get === 'function'
                        ? parentMap.get(groupId)
                        : null;
                    if (_parentGroupId) {
                        const _parentGroup = groupsById && typeof groupsById.get === 'function'
                            ? groupsById.get(_parentGroupId)
                            : null;
                        if (_parentGroup) {
                            host = Array.isArray(_parentGroup.children) ? _parentGroup.children : (_parentGroup.children = []);
                            hostGroup = _parentGroup;
                            hostContainerEl = typeof rootElement.querySelector === 'function'
                                ? rootElement.querySelector('[data-group-id="' + String(_parentGroupId).replace(/"/g, '\\"') + '"]')
                                : null;
                        }
                    }
                    // else: chosenContainer is top-level → host stays null → slot detection
                    // below uses root list (state.ungrouped + state.groups view via DOM).
                } else if (childrenEl) {
                    const childrenR = unshiftedRect(childrenEl);
                    if (childrenR && clientY >= childrenR.top && clientY < childrenR.bottom) {
                        const groupChildren = Array.isArray(groupObj.children) ? groupObj.children : (groupObj.children = []);
                        // Empty children area → user clearly wants 'into-group'.
                        if (groupChildren.length === 0) {
                            return {
                                kind: 'into-group',
                                targetGroup: groupObj,
                                targetList: groupChildren,
                                insertIndex: 0,
                                targetGroupId: groupObj.id,
                                hostGroupContainerEl: chosenContainer,
                                slotKey: null
                            };
                        }
                        host = groupChildren;
                        hostGroup = groupObj;
                        hostContainerEl = chosenContainer;
                    } else {
                        // Pointer is inside container but not header / not children-area.
                        // Treat as into-group (gap between header and children).
                        const groupChildren = Array.isArray(groupObj.children) ? groupObj.children : (groupObj.children = []);
                        return {
                            kind: 'into-group',
                            targetGroup: groupObj,
                            targetList: groupChildren,
                            insertIndex: 0,
                            targetGroupId: groupObj.id,
                            hostGroupContainerEl: chosenContainer,
                            slotKey: null
                        };
                    }
                } else {
                    // No children-area element; treat container as into-group sentinel.
                    const groupChildren = Array.isArray(groupObj.children) ? groupObj.children : (groupObj.children = []);
                    return {
                        kind: 'into-group',
                        targetGroup: groupObj,
                        targetList: groupChildren,
                        insertIndex: 0,
                        targetGroupId: groupObj.id,
                        hostGroupContainerEl: chosenContainer,
                        slotKey: null
                    };
                }
            }

            // Build the DOM children list for slot detection.
            let childElements;
            if (host) {
                // Inside a group: direct children of .group-children — both .source-item and .group-container at depth+1.
                const groupChildrenEl = hostContainerEl && typeof hostContainerEl.querySelector === 'function'
                    ? hostContainerEl.querySelector('.group-children')
                    : null;
                if (!groupChildrenEl || typeof groupChildrenEl.querySelectorAll !== 'function') {
                    childElements = [];
                } else {
                    // Use selector that matches direct children only via :scope > * if available;
                    // fall back to all descendants but filter to entries owned by this group via dataset checks.
                    const allDesc = groupChildrenEl.querySelectorAll(':scope > .group-container, :scope > .source-item');
                    childElements = allDesc && typeof allDesc.forEach === 'function'
                        ? Array.from(allDesc)
                        : (Array.isArray(allDesc) ? allDesc : []);
                }
            } else {
                // Root host. The state model has groups and ungrouped as two separate lists.
                // Use the children directly under rootElement.
                const rootChildren = typeof rootElement.querySelectorAll === 'function'
                    ? rootElement.querySelectorAll(':scope > .group-container, :scope > .source-item')
                    : [];
                childElements = rootChildren && typeof rootChildren.forEach === 'function'
                    ? Array.from(rootChildren)
                    : (Array.isArray(rootChildren) ? rootChildren : []);
            }

            // Filter out folded items (they have height 0 / no meaningful position) and
            // resolve a stable per-element key + kind. Tracking children flat so the index
            // we use for downstream reflow matches the host array (parent.children) ordering.
            const candidates = [];
            for (const el of childElements) {
                if (!el || typeof el.getBoundingClientRect !== 'function') continue;
                if (el.classList && el.classList.contains('sp-drag-folded')) continue;
                const isSrc = el.classList && el.classList.contains('source-item');
                const isGrp = el.classList && el.classList.contains('group-container');
                if (!isSrc && !isGrp) continue;
                const key = isSrc
                    ? (el.dataset ? el.dataset.sourceKey : null)
                    : (el.dataset ? el.dataset.groupId : null);
                if (!key) continue;
                candidates.push({ el, key, kind: isSrc ? 'source' : 'group' });
            }

            // Slot match: first candidate whose VISUAL mid-Y > clientY → insert before it.
            // Uses raw rect (no shift subtraction) so when a sibling has been translateY'd
            // down to "open" a slot above it, the pointer crosses its new visual mid sooner
            // — symmetric with the downward-avoidance case. Stability: a sibling only has
            // shift != 0 when intent.insertIndex routes through (or before) it; once cursor
            // crosses its visual mid moving down, intent flips, sibling unshifts on the
            // next frame, its visual mid returns to layout mid (no longer > clientY) —
            // single latching transition per shift state, no oscillation.
            let beforeIndex = -1;
            for (let i = 0; i < candidates.length; i += 1) {
                const el = candidates[i].el;
                if (!el || typeof el.getBoundingClientRect !== 'function') continue;
                const rect = el.getBoundingClientRect();
                if (!rect || typeof rect.top !== 'number' || typeof rect.height !== 'number') continue;
                const midY = rect.top + rect.height / 2;
                if (midY > clientY) {
                    beforeIndex = i;
                    break;
                }
            }

            // Resolve insertIndex against the actual targetList (state.groups / state.ungrouped / group.children).
            // For group host: insert position in host array is the index of the slot key (or list length for after-last).
            // For root host: insertIndex is in state.groups or state.ungrouped depending on slot kind.
            if (host) {
                if (candidates.length === 0) {
                    return {
                        kind: 'into-group',
                        targetGroup: hostGroup,
                        targetList: host,
                        insertIndex: 0,
                        targetGroupId: hostGroup.id,
                        hostGroupContainerEl: hostContainerEl,
                        slotKey: null
                    };
                }
                if (beforeIndex >= 0) {
                    const slot = candidates[beforeIndex];
                    const slotKind = slot.kind === 'source' ? 'before-source' : 'before-group';
                    // Find slot's index in host array (group.children).
                    let hostIndex = -1;
                    for (let i = 0; i < host.length; i += 1) {
                        const entry = host[i];
                        if (!entry) continue;
                        if (slot.kind === 'source' && entry.type === 'source' && entry.key === slot.key) { hostIndex = i; break; }
                        if (slot.kind === 'group' && entry.type === 'group' && entry.id === slot.key) { hostIndex = i; break; }
                    }
                    return {
                        kind: slotKind,
                        targetGroup: hostGroup,
                        targetList: host,
                        insertIndex: hostIndex >= 0 ? hostIndex : 0,
                        targetGroupId: hostGroup.id,
                        hostGroupContainerEl: hostContainerEl,
                        slotKey: slot.key
                    };
                }
                // pointer past all children → after-last
                const last = candidates[candidates.length - 1];
                return {
                    kind: last.kind === 'group' ? 'after-group' : 'after-source',
                    targetGroup: hostGroup,
                    targetList: host,
                    insertIndex: host.length,
                    targetGroupId: hostGroup.id,
                    hostGroupContainerEl: hostContainerEl,
                    slotKey: last.key
                };
            }

            // Root host: targetList depends on slot neighbor type.
            if (candidates.length === 0) {
                return {
                    kind: 'after-source',
                    targetGroup: null,
                    targetList: ungrouped,
                    insertIndex: 0,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: null
                };
            }
            // Auto-route across slot/drag-kind mismatch at the root.
            //
            // Root contains both ungrouped sources (state.ungrouped: string[]) and groups
            // (state.groups: string[]) — they live in separate state arrays. When the
            // cursor lands in a "wrong-kind" slot for the drag (e.g. source drag over a
            // group slot, or group drag over an ungrouped source slot), we auto-route to
            // the nearest same-kind neighbor so the drop lands somewhere sensible. Without
            // routing the drop would be invalid (splice mismatched id into the wrong array).
            const isSourceDrag = activeDragContext
                && (activeDragContext.kind === 'source-single' || activeDragContext.kind === 'source-multi');
            const isGroupDrag = activeDragContext && activeDragContext.kind === 'group';

            if (beforeIndex >= 0) {
                const slot = candidates[beforeIndex];
                if (slot.kind === 'source') {
                    if (isGroupDrag) {
                        // Group drag over a source slot — route to nearest group neighbor.
                        const routed = routeToNearestNeighborKind({
                            candidates, beforeIndex, targetCandidateKind: 'group',
                            targetList: groups, clientY, unshiftedRect
                        });
                        if (routed) return routed;
                    }
                    const ungroupedIndex = ungrouped.indexOf(slot.key);
                    return {
                        kind: 'before-source',
                        targetGroup: null,
                        targetList: ungrouped,
                        insertIndex: ungroupedIndex >= 0 ? ungroupedIndex : 0,
                        targetGroupId: null,
                        hostGroupContainerEl: null,
                        slotKey: slot.key
                    };
                }
                // slot.kind === 'group'
                if (isSourceDrag) {
                    const routed = routeToNearestNeighborKind({
                        candidates, beforeIndex, targetCandidateKind: 'source',
                        targetList: ungrouped, clientY, unshiftedRect
                    });
                    if (routed) return routed;
                }
                const groupsIndex = groups.indexOf(slot.key);
                return {
                    kind: 'before-group',
                    targetGroup: null,
                    targetList: groups,
                    insertIndex: groupsIndex >= 0 ? groupsIndex : 0,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: slot.key
                };
            }

            // After all root children.
            const lastRoot = candidates[candidates.length - 1];
            if (lastRoot.kind === 'group') {
                if (isSourceDrag) {
                    const routed = routeToNearestNeighborKind({
                        candidates, beforeIndex: candidates.length, targetCandidateKind: 'source',
                        targetList: ungrouped, clientY, unshiftedRect
                    });
                    if (routed) return routed;
                }
                const groupsIndex = groups.indexOf(lastRoot.key);
                return {
                    kind: 'after-group',
                    targetGroup: null,
                    targetList: groups,
                    insertIndex: groupsIndex >= 0 ? groupsIndex + 1 : groups.length,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: lastRoot.key
                };
            }
            // lastRoot.kind === 'source'
            if (isGroupDrag) {
                const routed = routeToNearestNeighborKind({
                    candidates, beforeIndex: candidates.length, targetCandidateKind: 'group',
                    targetList: groups, clientY, unshiftedRect
                });
                if (routed) return routed;
            }
            const ungroupedIndex = ungrouped.indexOf(lastRoot.key);
            return {
                kind: 'after-source',
                targetGroup: null,
                targetList: ungrouped,
                insertIndex: ungroupedIndex >= 0 ? ungroupedIndex + 1 : ungrouped.length,
                targetGroupId: null,
                hostGroupContainerEl: null,
                slotKey: lastRoot.key
            };
        }

        // Find the nearest candidate of a given kind at root (by distance from cursor to
        // its un-shifted vertical mid-Y) and produce a before/after intent against the
        // correct state list. Used by computeDropIntent to auto-route across
        // source-slot / group-slot mismatches at the root (where ungrouped and groups
        // live in separate arrays). Returns null when no candidate of the requested kind
        // exists — caller falls through to a same-kind intent that computeIsInvalidDrop
        // will then flag as invalid.
        function routeToNearestNeighborKind({ candidates, beforeIndex, targetCandidateKind, targetList, clientY, unshiftedRect }) {
            if (!candidates || candidates.length === 0) return null;
            if (!Array.isArray(targetList)) return null;
            const isSourceKindEarly = targetCandidateKind === 'source';
            // Empty target list (e.g. user drags a source between two top-level groups but
            // state.ungrouped is empty so there's no nearest-source neighbor). Without this
            // fallback the route returns null → caller falls to before-group/after-group
            // intent → computeIsInvalidDrop flags it invalid → drop is silently rejected.
            // Instead, return a slotKey-less intent that splices into the (empty) targetList
            // at index 0. handleDrop will then place the source into state.ungrouped, even
            // if that means it visually lands wherever the ungrouped region renders rather
            // than where the cursor was — a successful drop is better than a silent reject.
            if (targetList.length === 0) {
                return {
                    kind: isSourceKindEarly ? 'after-source' : 'after-group',
                    targetGroup: null,
                    targetList,
                    insertIndex: 0,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: null
                };
            }
            let upHit = null;
            for (let i = beforeIndex - 1; i >= 0; i -= 1) {
                if (candidates[i] && candidates[i].kind === targetCandidateKind) {
                    upHit = candidates[i];
                    break;
                }
            }
            let downHit = null;
            for (let i = beforeIndex; i < candidates.length; i += 1) {
                if (candidates[i] && candidates[i].kind === targetCandidateKind) {
                    downHit = candidates[i];
                    break;
                }
            }
            const dist = (hit) => {
                if (!hit) return Infinity;
                const r = unshiftedRect(hit.el);
                if (!r) return Infinity;
                return Math.abs((r.top + r.height / 2) - clientY);
            };
            const upDist = dist(upHit);
            const downDist = dist(downHit);
            if (!upHit && !downHit) {
                // No same-kind neighbor in `candidates` but targetList isn't empty (some
                // sources exist in state.ungrouped, just none in the rendered slot region).
                // Append to targetList's end so drop still works.
                return {
                    kind: isSourceKindEarly ? 'after-source' : 'after-group',
                    targetGroup: null,
                    targetList,
                    insertIndex: targetList.length,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: null
                };
            }
            const isSourceKind = targetCandidateKind === 'source';
            // Up-neighbor → after; down-neighbor → before. Prefer the closer one.
            if (upHit && (!downHit || upDist <= downDist)) {
                const key = upHit.key;
                const idx = targetList.indexOf(key);
                return {
                    kind: isSourceKind ? 'after-source' : 'after-group',
                    targetGroup: null,
                    targetList,
                    insertIndex: idx >= 0 ? idx + 1 : targetList.length,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: key
                };
            }
            const key = downHit.key;
            const idx = targetList.indexOf(key);
            return {
                kind: isSourceKind ? 'before-source' : 'before-group',
                targetGroup: null,
                targetList,
                insertIndex: idx >= 0 ? idx : 0,
                targetGroupId: null,
                hostGroupContainerEl: null,
                slotKey: key
            };
        }

        if (typeof runtime.activeDragContext === 'undefined') {
            runtime.activeDragContext = null;
        }
        if (!(runtime.hoverExpandedGroupIds instanceof Set)) {
            runtime.hoverExpandedGroupIds = new Set();
        }
        if (!(runtime.hoverExpandTimers instanceof Map)) {
            runtime.hoverExpandTimers = new Map();
        }

        const autoScrollController = dragMulti && typeof dragMulti.createAutoScrollController === 'function'
            ? dragMulti.createAutoScrollController({
                getContainer: () => {
                    const root = getShadowRoot();
                    return root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
                }
            })
            : null;

        function cssEscape(value) {
            const raw = typeof value === 'string' ? value : String(value ?? '');
            if (typeof globalThis.CSS === 'object' && globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
                try { return globalThis.CSS.escape(raw); } catch (err) { /* fall through */ }
            }
            return raw.replace(/(["\\])/g, '\\$1');
        }

        const createContentNativeCheckboxSyncFactory = globalThis.NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC;
        if (typeof createContentNativeCheckboxSyncFactory !== 'function') {
            throw new Error('NotebookLM Source Management: createContentTreeInteractions requires NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC to be loaded first.');
        }
        const {
            getNativeCheckboxState,
            shouldToggleNativeCheckbox,
            resolveDetachedRowEntry
        } = createContentNativeCheckboxSyncFactory({ findFreshCheckbox, resolveFreshRowEntry });

        function createUniqueGroupId(groupsById) {
            const baseId = `group_${Date.now()}`;
            if (!groupsById.has(baseId)) return baseId;

            let suffix = 1;
            let candidate = `${baseId}_${suffix}`;
            while (groupsById.has(candidate)) {
                suffix += 1;
                candidate = `${baseId}_${suffix}`;
            }
            return candidate;
        }

        function handleAddNewGroup(parentGroupId = null) {
            const state = getState();
            const groupsById = getGroupsById();
            const parent = parentGroupId ? groupsById.get(parentGroupId) : null;
            if (parentGroupId && !parent) {
                return false;
            }

            const newGroup = {
                id: createUniqueGroupId(groupsById),
                title: parentGroupId ? getMessage('ui_new_subgroup') : getMessage('ui_new_group'),
                children: [],
                enabled: true,
                collapsed: false,
                isNewlyCreated: true
            };

            groupsById.set(newGroup.id, newGroup);
            if (parentGroupId) {
                parent.children.push({ type: 'group', id: newGroup.id });
            } else {
                state.groups = Array.isArray(state.groups) ? state.groups : [];
                state.groups.push(newGroup.id);
            }

            buildParentMap();
            render();
            saveState({ immediate: true, critical: true });
            return true;
        }

        function syncSourceToPage(source, desiredState, options = {}) {
            if (!source) return false;

            const documentObj = getDocument();
            const currentSourceViewKind = options.currentSourceViewKind || getCurrentSourceViewKind();
            if (currentSourceViewKind === 'label') {
                recordNativeSelectionSyncFailure({
                    sourceKey: source.key || '',
                    reason: 'not_list_view',
                    detectedSourceViewKind: currentSourceViewKind
                });
                return false;
            }

            let checkbox = null;
            if (options.preferStoredCheckbox && source.checkbox && documentObj?.body?.contains?.(source.checkbox)) {
                checkbox = source.checkbox;
            } else if (options.preferStoredCheckbox) {
                checkbox = source.element?.querySelector?.(getSourceCheckboxSelector()) || null;
            } else {
                const resolvedEntry = resolveDetachedRowEntry(source);
                if (resolvedEntry?.checkbox) {
                    checkbox = resolvedEntry.checkbox;
                    source.element = resolvedEntry.row || source.element;
                    source.checkbox = resolvedEntry.checkbox;
                } else {
                    checkbox = source.element?.querySelector?.(getSourceCheckboxSelector()) || null;
                }
            }

            if (!checkbox || !documentObj?.body?.contains?.(checkbox)) {
                if (options.retryOnMissingCheckbox === true && currentSourceViewKind !== 'label') {
                    getClickQueue().push({
                        checkbox: null,
                        desiredState,
                        sourceKey: source.key,
                        retryOnMissing: true,
                        attempts: 0
                    });
                    if (!getIsProcessingQueue()) processClickQueue();
                    return true;
                }

                recordNativeSelectionSyncFailure({
                    sourceKey: source.key || '',
                    reason: 'native_checkbox_missing',
                    detectedSourceViewKind: currentSourceViewKind || 'unknown'
                });
                return false;
            }

            if (shouldToggleNativeCheckbox(checkbox, desiredState)) {
                getClickQueue().push({ checkbox, desiredState, sourceKey: source.key });
            }

            recordNativeSelectionSyncFailure(null);
            if (!getIsProcessingQueue()) processClickQueue();
            return true;
        }

        function processClickQueue() {
            const clickQueue = getClickQueue();
            const documentObj = getDocument();
            const setTimeoutFn = getSetTimeout();

            if (clickQueue.length === 0) {
                setIsProcessingQueue(false);
                setIsSyncingState(false);
                return;
            }

            setIsProcessingQueue(true);
            setIsSyncingState(true);

            const batchSize = 5;
            for (let i = 0; i < batchSize && clickQueue.length > 0; i++) {
                const item = clickQueue.shift();
                let checkbox = item.checkbox;

                if (!checkbox || !documentObj?.body?.contains?.(checkbox)) {
                    const freshCheckbox = findFreshCheckbox(item.sourceKey);
                    if (freshCheckbox) {
                        checkbox = freshCheckbox;
                    } else if (item.retryOnMissing && Number(item.attempts) < NATIVE_SELECTION_SYNC_RETRY_LIMIT) {
                        clickQueue.push(Object.assign({}, item, {
                            attempts: Number(item.attempts) + 1
                        }));
                        continue;
                    } else {
                        recordNativeSelectionSyncFailure({
                            sourceKey: item.sourceKey || '',
                            reason: 'native_checkbox_missing_during_queue',
                            detectedSourceViewKind: getCurrentSourceViewKind() || 'unknown'
                        });
                        continue;
                    }
                }

                if (shouldToggleNativeCheckbox(checkbox, item.desiredState)) {
                    recordNativeSelectionSyncFailure(null);
                    checkbox.click();
                }
            }

            if (typeof setTimeoutFn === 'function') {
                setTimeoutFn(processClickQueue, 20);
            }
        }

        function findParentGroupOfSource(key) {
            const parentMap = getParentMap();
            const groupsById = getGroupsById();
            const parentId = parentMap.get(key);
            return parentId ? (groupsById.get(parentId) || null) : null;
        }

        function removeSourceFromTree(key) {
            const state = getState();
            const parentGroup = findParentGroupOfSource(key);
            if (parentGroup) {
                parentGroup.children = (Array.isArray(parentGroup.children) ? parentGroup.children : [])
                    .filter((c) => c.type === 'group' || c.key !== key);
            } else {
                state.ungrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((k) => k !== key);
            }
        }

        function isBatchOperableSource(source) {
            return Boolean(source && !source.isDisabled && !source.isLoading);
        }

        function collectSourceKeysInTreeOrder() {
            const state = getState();
            const groupsById = getGroupsById();
            const orderedKeys = [];
            const visitGroup = (groupId) => {
                const group = groupsById.get(groupId);
                if (!group || !Array.isArray(group.children)) return;
                group.children.forEach((child) => {
                    if (child.type === 'source' && child.key) {
                        orderedKeys.push(child.key);
                    } else if (child.type === 'group' && child.id) {
                        visitGroup(child.id);
                    }
                });
            };

            (Array.isArray(state.groups) ? state.groups : []).forEach(visitGroup);
            (Array.isArray(state.ungrouped) ? state.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) orderedKeys.push(sourceKey);
            });
            return orderedKeys;
        }

        function finishSuccessfulBatchOperation(messageKey, count) {
            const state = getState();
            const pendingBatchKeys = getPendingBatchKeys();
            pendingBatchKeys.clear();
            state.isBatchMode = false;
            closeSourceActionMenu();
            saveState({ immediate: true, critical: true });
            render();
            showUndoableToast(getMessage(messageKey, [String(count)]), { variant: 'success' });
        }

        function executeBatchMoveToUngrouped() {
            const state = getState();
            const sourcesByKey = getSourcesByKey();
            const pendingBatchKeys = getPendingBatchKeys();
            const selectedKeys = new Set(pendingBatchKeys);
            const movableKeys = collectSourceKeysInTreeOrder().filter((sourceKey) => {
                const source = sourcesByKey.get(sourceKey);
                return selectedKeys.has(sourceKey) &&
                    isBatchOperableSource(source) &&
                    Boolean(findParentGroupOfSource(sourceKey));
            });

            if (movableKeys.length === 0) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            movableKeys.forEach((sourceKey) => {
                removeSourceFromTree(sourceKey);
                if (!state.ungrouped.includes(sourceKey)) {
                    state.ungrouped.push(sourceKey);
                }
            });
            buildParentMap();
            finishSuccessfulBatchOperation('ui_batch_ungrouped_toast', movableKeys.length);
            return true;
        }

        function finishKeyboardTreeMove(messageKey) {
            closeSourceActionMenu();
            buildParentMap();
            render();
            saveState({ immediate: true, critical: true });
            showUndoableToast(getMessage(messageKey), { variant: 'success' });
        }

        function canMoveSourceToUngrouped(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            return Boolean(isBatchOperableSource(source) && findParentGroupOfSource(sourceKey));
        }

        function moveSourceToUngrouped(sourceKey) {
            const state = getState();
            if (!canMoveSourceToUngrouped(sourceKey)) {
                showToast(getMessage('ui_keyboard_move_unavailable'), { variant: 'info' });
                return false;
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            removeSourceFromTree(sourceKey);
            if (!state.ungrouped.includes(sourceKey)) {
                state.ungrouped.push(sourceKey);
            }
            finishKeyboardTreeMove('ui_keyboard_moved_ungrouped_toast');
            return true;
        }

        function removeGroupFromTree(id) {
            const state = getState();
            const groupsById = getGroupsById();
            state.groups = (Array.isArray(state.groups) ? state.groups : []).filter((gid) => gid !== id);
            groupsById.forEach((group) => {
                group.children = (Array.isArray(group.children) ? group.children : []).filter((c) => c.id !== id);
            });
        }

        function toggleGroupCollapse(group, groupContainer) {
            if (!group || !groupContainer) return;
            const save = saveState;
            group.collapsed = !group.collapsed;

            const caret = groupContainer.querySelector('.sp-caret');
            const childrenContainer = groupContainer.querySelector('.group-children');
            if (!caret || !childrenContainer) {
                save({ immediate: true });
                return;
            }

            if (group.collapsed) {
                caret.classList.add('collapsed');
                childrenContainer.style.overflow = 'hidden';
                childrenContainer.style.height = `${childrenContainer.scrollHeight}px`;
                childrenContainer.offsetHeight;
                childrenContainer.style.height = '0px';
                childrenContainer.classList.add('collapsed');
            } else {
                caret.classList.remove('collapsed');
                childrenContainer.style.overflow = 'hidden';
                childrenContainer.style.height = '0px';
                childrenContainer.classList.remove('collapsed');
                childrenContainer.offsetHeight;
                childrenContainer.style.height = `${childrenContainer.scrollHeight}px`;

                childrenContainer.addEventListener('transitionend', function handler() {
                    childrenContainer.style.height = 'auto';
                    childrenContainer.style.overflow = 'visible';
                    childrenContainer.removeEventListener('transitionend', handler);
                });
            }

            save({ immediate: true });
        }

        function handleInteraction(event) {
            const state = getState();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const pendingBatchKeys = getPendingBatchKeys();
            const target = event.target;
            const groupContainer = target.closest('.group-container');
            const groupId = groupContainer?.dataset.groupId;
            const sourceRow = target.closest('.source-item');
            const sourceKey = sourceRow?.dataset.sourceKey;
            const sourceActionsButton = target.closest('.sp-source-actions-button');
            const sourceActionsMenuItem = target.closest('.sp-source-actions-menu-item');
            const isolationGroupId = getActiveIsolationGroupId();

            if (sourceActionsMenuItem) {
                handleSourceActionSelection(sourceActionsMenuItem.dataset.sourceKey, sourceActionsMenuItem.dataset.action);
                render();
                return;
            }

            if (sourceActionsButton) {
                toggleSourceActionMenu(sourceActionsButton.dataset.sourceKey, sourceActionsButton);
                render();
                return;
            }

            if (target.closest('.sp-tag-pill')) {
                const tagId = target.closest('.sp-tag-pill').dataset.tagId;
                state.activeTagId = state.activeTagId === tagId ? null : tagId;
                state.activeQuickViewKind = null;
                render();
                return;
            }

            if (target.closest('#sp-clear-isolate-btn')) {
                const oldStates = collectEffectiveSourceStates();
                setActiveIsolationGroupId(null);
                syncSourcesToEffectiveState(oldStates);
                render();
                showToast(getMessage('ui_isolation_cleared_toast'));
                return;
            }

            if (target.closest('#sp-clear-tag-filter-btn')) {
                state.activeTagId = null;
                render();
                return;
            }

            if (target.closest('#sp-import-native-labels-btn')) {
                Promise.resolve(applyNativeLabelImportFromUi()).catch((error) => {
                    console.error('NotebookLM Source Management: Failed to prepare native label import preview.', error);
                });
                return;
            }

            if (target.closest('.sp-add-subgroup-button')) {
                handleAddNewGroup(groupId);
                return;
            }
            if (target.closest('.sp-caret')) {
                toggleGroupCollapse(groupsById.get(groupId), groupContainer);
                return;
            }
            if (target.closest('.sp-isolate-button')) {
                const oldStates = collectEffectiveSourceStates();
                setActiveIsolationGroupId(isolationGroupId === groupId ? null : groupId);
                syncSourcesToEffectiveState(oldStates);
                render();
                showToast(
                    getActiveIsolationGroupId()
                        ? getMessage('ui_isolated_toast', [groupsById.get(groupId)?.title])
                        : getMessage('ui_isolation_cleared_toast')
                );
                return;
            }

            if (target.classList.contains('sp-group-toggle-checkbox')) {
                const targetGroupId = target.dataset.groupId;
                const group = groupsById.get(targetGroupId);
                if (group) {
                    const oldEffectiveStates = collectEffectiveSourceStates();
                    group.enabled = target.checked;
                    syncSourcesToEffectiveState(oldEffectiveStates);
                    saveState({ immediate: true, critical: true });
                    render();
                }
                return;
            }

            const batchCheckbox = target.closest('.sp-batch-checkbox');
            if (batchCheckbox) {
                const batchSourceKey = batchCheckbox.dataset.sourceKey;
                const source = batchSourceKey ? sourcesByKey.get(batchSourceKey) : null;

                if (!source || source.isDisabled || source.isLoading) {
                    if (batchSourceKey) {
                        pendingBatchKeys.delete(batchSourceKey);
                    }
                    if (typeof batchCheckbox.checked === 'boolean') {
                        batchCheckbox.checked = false;
                    }
                    render();
                    return;
                }

                if (batchCheckbox.checked) {
                    pendingBatchKeys.add(batchSourceKey);
                } else {
                    pendingBatchKeys.delete(batchSourceKey);
                }
                render();
                return;
            }

            if (target.classList.contains('sp-checkbox')) {
                const checkboxSourceKey = target.dataset.sourceKey;
                if (checkboxSourceKey) {
                    const source = sourcesByKey.get(checkboxSourceKey);
                    if (source && !source.isDisabled) {
                        source.enabled = target.checked;
                        syncSourceToPage(source, isSourceEffectivelyEnabled(source), {
                            retryOnMissingCheckbox: true
                        });
                        saveState({ immediate: true, critical: true });
                        render();
                    }
                }
                return;
            }

            if (target.closest('.group-header') && !target.closest('.sp-caret, .sp-toggle-switch, .sp-add-subgroup-button, .sp-isolate-button, .sp-edit-button, .sp-delete-button, input')) {
                toggleGroupCollapse(groupsById.get(groupId), groupContainer);
                return;
            }

            if (sourceRow && !target.closest('.sp-source-actions-anchor, .sp-source-actions-menu, .sp-tag-pill, input, .sp-batch-checkbox')) {
                const source = sourcesByKey.get(sourceKey);

                if (!source || source.isDisabled) {
                    return;
                }

                if (state.isBatchMode) {
                    if (source.isLoading) {
                        return;
                    }

                    if (pendingBatchKeys.has(sourceKey)) {
                        pendingBatchKeys.delete(sourceKey);
                    } else {
                        pendingBatchKeys.add(sourceKey);
                    }
                    render();
                    return;
                }

                if (target.closest('.icon-container') && !source.isLoading) {
                    getSourceActionInvokers().openNativeDetails(sourceKey);
                    return;
                }

                const checkbox = sourceRow.querySelector('.sp-checkbox');

                if (sourceKey && checkbox) {
                    checkbox.checked = !checkbox.checked;

                    if (source) {
                        source.enabled = checkbox.checked;
                        syncSourceToPage(source, isSourceEffectivelyEnabled(source), {
                            retryOnMissingCheckbox: true
                        });
                        saveState({ immediate: true, critical: true });
                        render();
                    }
                }
                return;
            }

            if (target.closest('.sp-cancel-batch-btn')) {
                state.isBatchMode = false;
                pendingBatchKeys.clear();
                render();
                return;
            }

            if (target.closest('.sp-confirm-delete-btn') && !getIsDeletingSources() && pendingBatchKeys.size > 0) {
                executeBatchDelete();
                return;
            }

            if (target.closest('.sp-batch-ungroup-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                executeBatchMoveToUngrouped();
                return;
            }

            if (target.closest('.sp-batch-add-tags-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                renderBatchTagModal('add', pendingBatchKeys);
                return;
            }

            if (target.closest('.sp-batch-remove-tags-btn') && pendingBatchKeys.size > 0 && !getIsDeletingSources()) {
                renderBatchTagModal('remove', pendingBatchKeys);
                return;
            }

            if (target.closest('.sp-batch-add-folder-btn') && pendingBatchKeys.size > 0) {
                renderMoveToFolderModal(pendingBatchKeys);
                return;
            }

            const editButton = target.closest('.sp-edit-button');
            if (editButton) {
                triggerRename(groupContainer);
                return;
            }

            const deleteButton = target.closest('.sp-delete-button');
            if (deleteButton) {
                const group = groupsById.get(groupId);
                if (!group) return;
                const groupChildren = Array.isArray(group.children) ? group.children : [];

                if (groupChildren.length === 0) {
                    removeGroupFromTree(groupId);
                    groupsById.delete(groupId);
                } else {
                    const windowObj = getWindow();
                    const deleteContents = windowObj?.confirm?.(
                        getMessage('ui_delete_group_confirm_non_empty', [group.title, getMessage('ui_ungrouped')])
                    );

                    if (deleteContents) {
                        const extractChildren = (g) => {
                            (Array.isArray(g.children) ? g.children : []).forEach((c) => {
                                if (c.type === 'source') {
                                    state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
                                    state.ungrouped.push(c.key);
                                } else {
                                    state.groups = Array.isArray(state.groups) ? state.groups : [];
                                    state.groups.push(c.id);
                                }
                            });
                        };
                        extractChildren(group);
                        removeGroupFromTree(groupId);
                        groupsById.delete(groupId);
                    } else {
                        return;
                    }
                }

                if (getActiveIsolationGroupId() === groupId) {
                    setActiveIsolationGroupId(null);
                }
                buildParentMap();
                saveState({ immediate: true, critical: true });
                render();
            }
        }

        function handleOriginalCheckboxChange(event) {
            if (getIsSyncingState()) return;
            const checkbox = event.target;
            const DEPS = getDEPS();
            const keyByElement = getKeyByElement();
            const shadowRoot = getShadowRoot();
            const sourcesByKey = getSourcesByKey();

            let validCheckbox = false;
            const checkboxSelectors = Array.isArray(DEPS.checkbox) ? DEPS.checkbox : [getSourceCheckboxSelector()];
            for (const sel of checkboxSelectors) {
                if (checkbox.matches?.(sel)) {
                    validCheckbox = true;
                    break;
                }
            }
            if (!validCheckbox) return;

            let sourceRow = null;
            const rowSelectors = Array.isArray(DEPS.row) ? DEPS.row : [];
            for (const sel of rowSelectors) {
                sourceRow = checkbox.closest(sel);
                if (sourceRow) break;
            }

            if (!sourceRow) return;
            const key = keyByElement.get(sourceRow);
            if (key) {
                const source = sourcesByKey.get(key);
                const checkboxState = getNativeCheckboxState(checkbox);
                if (checkboxState === null) return;
                if (source && source.enabled !== checkboxState) {
                    source.enabled = checkboxState;
                    const desiredState = isSourceEffectivelyEnabled(source);

                    const virtualCheckbox = shadowRoot?.querySelector?.(`.sp-checkbox[data-source-key="${key}"]`);
                    if (virtualCheckbox) {
                        virtualCheckbox.checked = source.enabled;
                    }

                    if (checkboxState !== desiredState) {
                        syncSourceToPage(source, desiredState);
                    }

                    saveState({ immediate: true, critical: true });
                    render();
                }
            }
        }

        function triggerRename(groupContainer) {
            const documentObj = getDocument();
            const groupsById = getGroupsById();
            const groupId = groupContainer.dataset.groupId;
            const group = groupsById.get(groupId);
            if (!group || !documentObj?.createElement) return;

            const titleSpan = groupContainer.querySelector('.group-title');
            const originalTitle = group.title;
            const input = documentObj.createElement('input');
            input.type = 'text';
            input.value = originalTitle;
            titleSpan.replaceChildren(input);
            input.focus();
            input.select();

            const cleanup = () => {
                input.removeEventListener('blur', handleSave);
                input.removeEventListener('keydown', handleKey);
                render();
            };
            const handleSave = () => {
                const newTitle = input.value.trim();
                if (newTitle) group.title = newTitle;
                cleanup();
                saveState({ immediate: true, critical: true });
            };
            const handleKey = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    group.title = originalTitle;
                    cleanup();
                }
            };

            input.addEventListener('blur', handleSave);
            input.addEventListener('keydown', handleKey);
        }

        function handleDragStart(e) {
            const sourceTarget = e.target.closest('.source-item');
            const groupTarget = e.target.closest('.group-header');
            const setTimeoutFn = getSetTimeout();

            cancelAllHoverTimers();
            runtime.hoverExpandedGroupIds.clear();

            // Preflight clean: defensively recover from any state the previous drag
            // may have left behind. dragend is supposed to clean everything up, but
            // browser-level drag interruption (window blur, Esc race, page nav,
            // crash) can skip dragend entirely — leaving classes + inline styles +
            // runtime state in a half-broken configuration. The next dragstart is
            // our only chance to recover before the user notices something is off.
            //
            // Two tiers of leftovers to handle:
            //
            // (A) Transient animation classes from a recent drop's 800ms cleanup
            //     window. .sp-drop-flying / .sp-drop-landing / .sp-drag-unfolding
            //     each carry their own transition rule (e.g., 200ms transform);
            //     if any survive into this new dragstart they'd slow the new
            //     drag's fold from instant to 200ms, causing visible jitter.
            //     .sp-pseudo-hover is post-drop hover-stuck rescue — stale copies
            //     would visually stick to whatever row they were applied to.
            //
            // (B) Drag-active state classes that should ONLY exist mid-drag.
            //     .sp-drag-folded keeps a row at height:0 + opacity:0 +
            //     pointer-events:none — if it lingers, the row is invisible AND
            //     un-draggable, which manifests to the user as "I can't drag this
            //     source anymore". .sp-drop-shift carries an inline
            //     transform: translateY(N) on siblings to "open the slot" —
            //     lingering shift = visible visual offset until the page reloads.
            //     .drag-into / .drag-invalid / .dragging are visual indicators
            //     that handleDragOver / dragstart's setTimeout set; if dragend
            //     didn't clean them, they linger as stale highlights.
            //
            // Strip every class in both tiers + reset the inline style backing
            // them so the new drag starts from a known-clean visual state. Costs
            // nothing on the common path (querySelectorAll returns 0 nodes when
            // the previous drag cleaned up correctly).
            const _preflightList = getSourceListContainer();
            if (_preflightList && typeof _preflightList.querySelectorAll === 'function') {
                const stale = _preflightList.querySelectorAll(
                    '.sp-drop-flying, .sp-drop-landing, .sp-drag-unfolding, .sp-pseudo-hover'
                );
                if (stale && typeof stale.forEach === 'function') {
                    stale.forEach((node) => {
                        if (!node || !node.classList || typeof node.classList.remove !== 'function') return;
                        node.classList.remove('sp-drop-flying');
                        node.classList.remove('sp-drop-landing');
                        node.classList.remove('sp-drag-unfolding');
                        node.classList.remove('sp-pseudo-hover');
                    });
                }

                // (B1) .sp-drag-folded: lingering = source stuck invisible + un-draggable.
                // Clear class + restore inline height/opacity so the row reappears at
                // its natural size. The new drag's RAF-deferred foldDraggedItems will
                // re-apply on the right source(s) a frame later if needed.
                const lingeringFolded = _preflightList.querySelectorAll('.sp-drag-folded');
                if (lingeringFolded && typeof lingeringFolded.forEach === 'function') {
                    lingeringFolded.forEach((node) => {
                        if (!node || !node.classList || typeof node.classList.remove !== 'function') return;
                        node.classList.remove('sp-drag-folded');
                        if (node.style) {
                            node.style.height = '';
                            node.style.opacity = '';
                        }
                    });
                }

                // (B2) .sp-drop-shift: lingering = siblings visually offset by translateY.
                // Clear class + reset inline transform. New drag's reflow re-applies
                // shifts on the correct siblings.
                const lingeringShift = _preflightList.querySelectorAll('.sp-drop-shift');
                if (lingeringShift && typeof lingeringShift.forEach === 'function') {
                    lingeringShift.forEach((node) => {
                        if (!node || !node.classList || typeof node.classList.remove !== 'function') return;
                        node.classList.remove('sp-drop-shift');
                        if (node.style) {
                            node.style.transform = '';
                        }
                    });
                }

                // (B3) .drag-into / .drag-invalid / .dragging: stale visual highlights.
                const lingeringFeedback = _preflightList.querySelectorAll('.drag-into, .drag-invalid, .dragging');
                if (lingeringFeedback && typeof lingeringFeedback.forEach === 'function') {
                    lingeringFeedback.forEach((node) => {
                        if (!node || !node.classList || typeof node.classList.remove !== 'function') return;
                        node.classList.remove('drag-into');
                        node.classList.remove('drag-invalid');
                        node.classList.remove('dragging');
                    });
                }
            }

            // Reset runtime drag state defensively. A previous drag interrupted
            // before dragend would leave these lingering, and the new drag's own
            // assignments below would simply overwrite — but overwriting silently
            // drops references to any DOM cleanup the old session was responsible
            // for. We've already cleaned the DOM classes above; now drop the stale
            // session/ghost/context refs cleanly. autoScrollController.stop is the
            // matching teardown for any stuck scroll loop.
            if (runtime.dragReflowSession) {
                runtime.dragReflowSession = null;
            }
            if (runtime.activeDragGhost && dragMulti && typeof dragMulti.destroyMultiDragGhost === 'function') {
                try { dragMulti.destroyMultiDragGhost(runtime.activeDragGhost); } catch (_) { /* ignore detach race */ }
                runtime.activeDragGhost = null;
            }
            if (runtime.activeDragContext) {
                runtime.activeDragContext = null;
            }
            if (autoScrollController && typeof autoScrollController.stop === 'function') {
                autoScrollController.stop();
            }

            // Edit-mode guard: when cursor is inside an editable control (rename input,
            // textarea, contenteditable region), suppress the drag. Otherwise dragging
            // a text selection across the row's draggable boundary triggers dragstart
            // on the outer .source-item / .group-header — interrupting the edit AND
            // starting an unwanted drag. The native rename input created by
            // triggerRename() has no draggable="false", so this guard is the only
            // protection. preventDefault tells the browser not to enter the drag
            // lifecycle at all (cursor remains in text-select mode for the input).
            if (e.target && typeof e.target.closest === 'function') {
                const _editable = e.target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
                if (_editable) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    return;
                }
            }

            if (sourceTarget) {
                const key = sourceTarget.dataset.sourceKey;
                if (!key) return;

                if (typeof e.target.closest === 'function'
                    && e.target.closest('input[type="checkbox"], .sp-batch-checkbox')) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    return;
                }

                const state = getState();
                const pendingBatchKeys = getPendingBatchKeys();
                const hasResolver = dragMulti && typeof dragMulti.resolveDragSelection === 'function';
                const sourceOrder = hasResolver ? collectSourceKeysInTreeOrder() : [];

                const selection = hasResolver
                    ? dragMulti.resolveDragSelection({
                        originKey: key,
                        isBatchMode: Boolean(state.isBatchMode),
                        pendingBatchKeys,
                        sourceOrder
                    })
                    : { keys: [key], isMulti: false };

                const keys = Array.isArray(selection?.keys) && selection.keys.length > 0
                    ? selection.keys
                    : [key];

                runtime.activeDragContext = selection.isMulti
                    ? { kind: 'source-multi', keys: keys.slice() }
                    : { kind: 'source-single', keys: [keys[0]] };

                e.dataTransfer.setData('application/source-key', keys[0]);
                if (selection.isMulti) {
                    e.dataTransfer.setData('application/source-keys', JSON.stringify(keys));
                }
                e.dataTransfer.effectAllowed = 'move';

                if (dragMulti && typeof dragMulti.createMultiDragGhost === 'function') {
                    const doc = getDocument();
                    const root = doc && doc.body ? doc.body : null;
                    const sourcesListEl = getSourceListContainer();
                    const sourceClones = keys.slice(0, 3).map((rowKey) => {
                        if (!sourcesListEl || typeof sourcesListEl.querySelector !== 'function') return null;
                        const original = sourcesListEl.querySelector(`[data-source-key="${cssEscape(rowKey)}"]`);
                        if (!original) return null;
                        return typeof dragMulti.cloneSourceItem === 'function'
                            ? dragMulti.cloneSourceItem(original)
                            : null;
                    }).filter(Boolean);
                    const ghost = dragMulti.createMultiDragGhost({
                        count: keys.length,
                        sourceClones,
                        root
                    });
                    if (ghost && typeof e.dataTransfer.setDragImage === 'function') {
                        let offsetX = 12;
                        let offsetY = 12;
                        if (sourcesListEl && typeof sourcesListEl.querySelector === 'function') {
                            const originEl = sourcesListEl.querySelector(`[data-source-key="${cssEscape(key)}"]`);
                            const rect = originEl && typeof originEl.getBoundingClientRect === 'function'
                                ? originEl.getBoundingClientRect()
                                : null;
                            if (rect && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
                                offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                                offsetY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                            }
                        }
                        try {
                            e.dataTransfer.setDragImage(ghost, offsetX, offsetY);
                        } catch (err) { /* ignore setDragImage failure */ }
                        runtime.activeDragGhost = ghost;
                    }
                }

                if (dragReflow && typeof dragReflow.prepareDragSession === 'function') {
                    const rootElement = getSourceListContainer();
                    const session = dragReflow.prepareDragSession({
                        draggedKeys: keys,
                        rootElement
                    });
                    runtime.dragReflowSession = session;
                    // Fold MUST be deferred to next frame via RAF (NOT sync) — running fold
                    // inside the dragstart handler turns the drag source into a 0×0 box
                    // (.sp-drag-folded has pointer-events: none + padding/margin/border 0,
                    // plus we set inline height:0 opacity:0) before Chrome finalizes drag
                    // initiation, and Chrome silently cancels the drag operation when the
                    // source rect is zero. RAF defers fold until after Chrome has captured
                    // the ghost + seeded the drag, at which point the source is safe to hide.
                    // Accepted trade-off: one-frame visual overlap of ghost over origin row.
                    const raf = typeof globalThis.requestAnimationFrame === 'function'
                        ? globalThis.requestAnimationFrame
                        : null;
                    if (raf) {
                        raf(() => {
                            if (dragReflow.foldDraggedItems) {
                                dragReflow.foldDraggedItems({
                                    session,
                                    rootElement: getSourceListContainer()
                                });
                            }
                        });
                    } else if (typeof dragReflow.foldDraggedItems === 'function') {
                        dragReflow.foldDraggedItems({ session, rootElement });
                    }
                }
                if (typeof setTimeoutFn === 'function') {
                    setTimeoutFn(() => {
                        if (selection.isMulti) {
                            const root = getShadowRoot();
                            if (root && typeof root.querySelector === 'function') {
                                keys.forEach((rowKey) => {
                                    const row = root.querySelector(`.source-item[data-source-key="${cssEscape(rowKey)}"]`);
                                    if (row && row.classList && typeof row.classList.add === 'function') {
                                        row.classList.add('dragging');
                                    }
                                });
                            } else if (sourceTarget.classList && typeof sourceTarget.classList.add === 'function') {
                                sourceTarget.classList.add('dragging');
                            }
                        } else if (sourceTarget.classList && typeof sourceTarget.classList.add === 'function') {
                            sourceTarget.classList.add('dragging');
                        }
                    }, 0);
                }
                return;
            }

            if (groupTarget) {
                const key = groupTarget.dataset.groupId;
                if (key) {
                    e.dataTransfer.setData('application/group-id', key);
                    runtime.activeDragContext = { kind: 'group', draggedGroupId: key };
                    e.dataTransfer.effectAllowed = 'move';
                    if (typeof setTimeoutFn === 'function') {
                        setTimeoutFn(() => groupTarget.classList.add('dragging'), 0);
                    }
                    // Initialize drag-reflow session for group drag too. The session lets
                    // dragover apply sibling translateY shifts ("open a slot for the
                    // dragged group") and dragend cleanup unfold it. Without this block,
                    // group drags had no avoid animation — siblings would not move out of
                    // the dragged group's way at all. Find the group-container element by
                    // its data-group-id and pass its id as the draggedKey; prepareDragSession
                    // measures its full offsetHeight (header + children area).
                    if (dragReflow && typeof dragReflow.prepareDragSession === 'function') {
                        const rootElement = getSourceListContainer();
                        const session = dragReflow.prepareDragSession({
                            draggedKeys: [key],
                            rootElement
                        });
                        runtime.dragReflowSession = session;
                        // RAF-deferred fold (same reason as source branch — sync fold would
                        // turn the drag source into a 0×0 box during dragstart, which Chrome
                        // can cancel as "invalid drag source").
                        const raf = typeof globalThis.requestAnimationFrame === 'function'
                            ? globalThis.requestAnimationFrame
                            : null;
                        if (raf) {
                            raf(() => {
                                if (dragReflow.foldDraggedItems) {
                                    dragReflow.foldDraggedItems({
                                        session,
                                        rootElement: getSourceListContainer()
                                    });
                                }
                            });
                        } else if (typeof dragReflow.foldDraggedItems === 'function') {
                            dragReflow.foldDraggedItems({ session, rootElement });
                        }
                    }
                }
            }
        }

        function computeIsInvalidDrop({ intent, dragContext }) {
            if (!intent || typeof intent !== 'object' || !dragContext) return false;

            if (dragContext.kind === 'source-single') {
                const draggedKey = Array.isArray(dragContext.keys) ? dragContext.keys[0] : null;
                if (!draggedKey) return false;
                if (intent.kind === 'before-source' || intent.kind === 'after-source') {
                    return intent.slotKey === draggedKey;
                }
                // Top-level before-group / after-group — would splice the source key into
                // state.groups at an index computed against state.groups (semantically wrong).
                // Reject symmetrically with the source-multi guard below.
                const isAtTopLevel = intent.targetGroup == null;
                const isBeforeOrAfter = intent.kind === 'before-group' || intent.kind === 'after-group';
                if (isAtTopLevel && isBeforeOrAfter) return true;
                return false;
            }

            if (dragContext.kind === 'source-multi') {
                const keys = Array.isArray(dragContext.keys) ? dragContext.keys : [];
                if (keys.length === 0) return false;
                const draggedSet = new Set(keys);

                if (intent.kind === 'before-source' || intent.kind === 'after-source') {
                    return draggedSet.has(intent.slotKey);
                }
                // Top-level before-group / after-group intent — would splice source keys into state.groups
                const isAtTopLevel = intent.targetGroup == null;
                const isBeforeOrAfter = intent.kind === 'before-group' || intent.kind === 'after-group';
                if (isAtTopLevel && isBeforeOrAfter) return true;

                return false;
            }

            if (dragContext.kind === 'group') {
                const draggedGroupId = dragContext.draggedGroupId;
                if (!draggedGroupId) return false;
                const targetGroup = intent.targetGroup;
                if (!targetGroup) {
                    // Root host. Source-typed slots would splice the group id into
                    // state.ungrouped (string[]) using an index computed against ungrouped —
                    // schema mismatch. Reject so the user sees the invalid outline.
                    if (intent.kind === 'before-source' || intent.kind === 'after-source') return true;
                    return false;
                }
                if (targetGroup.id === draggedGroupId) return true;
                const groupsById = getGroupsById();
                const draggedGroup = groupsById.get(draggedGroupId);
                if (!draggedGroup) return false;
                return isDescendant(targetGroup, draggedGroup, groupsById);
            }

            return false;
        }

        function handleDragOver(e) {
            e.preventDefault();
            const sourceListEl = getSourceListContainer();
            const intent = computeDropIntent({
                clientX: e.clientX,
                clientY: e.clientY,
                rootElement: sourceListEl,
                state: getState(),
                groupsById: getGroupsById(),
                parentMap: getParentMap(),
                activeDragContext: runtime.activeDragContext
            });

            if (intent) {
                const isInvalid = computeIsInvalidDrop({
                    intent,
                    dragContext: runtime.activeDragContext
                });

                // Single sweep to clear stale .drag-into / .drag-invalid markers.
                if (sourceListEl && typeof sourceListEl.querySelectorAll === 'function') {
                    const stale = sourceListEl.querySelectorAll('.drag-into, .drag-invalid');
                    if (stale && typeof stale.forEach === 'function') {
                        stale.forEach((node) => {
                            if (node && node.classList && typeof node.classList.remove === 'function') {
                                node.classList.remove('drag-into', 'drag-invalid');
                            }
                        });
                    }
                }

                // Apply current frame's markers.
                if (intent.kind === 'into-group' && intent.hostGroupContainerEl
                    && intent.hostGroupContainerEl.classList
                    && typeof intent.hostGroupContainerEl.classList.add === 'function') {
                    intent.hostGroupContainerEl.classList.add('drag-into');
                }
                if (isInvalid) {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                    if (intent.kind === 'into-group') {
                        if (intent.hostGroupContainerEl && intent.hostGroupContainerEl.classList
                            && typeof intent.hostGroupContainerEl.classList.add === 'function') {
                            intent.hostGroupContainerEl.classList.add('drag-invalid');
                        }
                    } else if (intent.slotKey && sourceListEl && typeof sourceListEl.querySelector === 'function') {
                        // before-/after-source uses data-source-key; before-/after-group uses data-group-id.
                        const slotAttr = (intent.kind === 'before-group' || intent.kind === 'after-group')
                            ? 'data-group-id'
                            : 'data-source-key';
                        const slotEl = sourceListEl.querySelector(`[${slotAttr}="${cssEscape(intent.slotKey)}"]`);
                        if (slotEl && slotEl.classList && typeof slotEl.classList.add === 'function') {
                            slotEl.classList.add('drag-invalid');
                        }
                    }
                }

                // Reflow: compute sibling shifts from host list, push them to the layout.
                if (dragReflow && runtime.dragReflowSession && typeof dragReflow.computeReflow === 'function') {
                    const siblingKeys = resolveSiblingKeys(intent);
                    // intent.insertIndex is now an actual index (0 for into-group = top of
                    // folder, slot index for before/after-source). No longer need the
                    // special-case for into-group since 0 is a valid index that opens the
                    // slot at the top of children — matching the drop position.
                    const insertIndexForReflow = typeof intent.insertIndex === 'number' && intent.insertIndex >= 0
                        ? intent.insertIndex
                        : siblingKeys.length;
                    const shifts = dragReflow.computeReflow({
                        session: runtime.dragReflowSession,
                        insertIndex: insertIndexForReflow,
                        siblingKeys,
                        rootElement: sourceListEl
                    });
                    // Cross-host shift extension: when host is a group's children, the
                    // dragged item's fold shrinks the group container's layout height,
                    // so root-level siblings below it shift UP. Meanwhile the group's
                    // own children get translateY(+slotHeight) from the reflow above —
                    // they visually overflow past the group container's edge and
                    // overlap with the next group's header. To keep the list visually
                    // static below the cursor, also shift every "subsequent sibling of
                    // host's ancestor chain" (i.e. each level's siblings after the host
                    // path, walking up until we reach #sources-list). This handles
                    // nested groups too.
                    if (intent.targetGroup && intent.hostGroupContainerEl
                        && runtime.dragReflowSession && sourceListEl) {
                        const _refSession = runtime.dragReflowSession;
                        const _slotHeight = _refSession.totalDraggedHeight;
                        if (typeof _slotHeight === 'number' && _slotHeight > 0) {
                            // Walk up the host's DOM ancestor chain, shifting each level's
                            // later DOM siblings. host group-container → .group-children
                            // (skip) → ancestor group-container → ... → #sources-list (stop).
                            let _cursorEl = intent.hostGroupContainerEl;
                            while (_cursorEl && _cursorEl !== sourceListEl) {
                                let _sibling = _cursorEl.nextElementSibling;
                                while (_sibling) {
                                    const _isSrc = _sibling.classList
                                        && _sibling.classList.contains('source-item');
                                    const _isGrp = _sibling.classList
                                        && _sibling.classList.contains('group-container');
                                    if (_isSrc || _isGrp) {
                                        const _key = _isSrc
                                            ? (_sibling.dataset && _sibling.dataset.sourceKey)
                                            : (_sibling.dataset && _sibling.dataset.groupId);
                                        if (_key && !_refSession.draggedKeys.has(_key) && !shifts.has(_key)) {
                                            shifts.set(_key, _slotHeight);
                                        }
                                    }
                                    _sibling = _sibling.nextElementSibling;
                                }
                                // Climb one layout level. host's parent is .group-children
                                // (if nested) or #sources-list (if top-level). When parent
                                // is #sources-list we've already shifted top-level siblings.
                                const _parentEl = _cursorEl.parentElement;
                                if (!_parentEl || _parentEl === sourceListEl) break;
                                // parent is .group-children → climb to its enclosing .group-container.
                                _cursorEl = _parentEl.parentElement;
                            }
                        }
                    }
                    // Root-level visual shift: when intent has no targetGroup (cursor is in
                    // root-level corridor, e.g. left-half of a top-level group, or in the gap
                    // between groups, or above an empty ungrouped section) the host array can
                    // be empty (e.g. source dragged but state.ungrouped is []) so the per-host
                    // sibling shifts above produced an empty Map. Without any shifts the user
                    // sees no avoidance — the groups stay flush together and there's no
                    // visible "slot" being opened. Iterate the sources-list direct children
                    // here and shift every one whose visual mid-Y is below the cursor by
                    // +slotHeight. Result: cursor in top half of group A → A, B, C all push
                    // down (slot opens above A). Cursor in bottom half of group A → only B,
                    // C push down (slot opens between A and B). Matches user intuition:
                    // "wherever I hover, everything below shifts to make room".
                    if (!intent.targetGroup && sourceListEl && runtime.dragReflowSession
                        && typeof sourceListEl.querySelectorAll === 'function') {
                        const _rootSession = runtime.dragReflowSession;
                        const _rootSlotHeight = _rootSession.totalDraggedHeight;
                        if (typeof _rootSlotHeight === 'number' && _rootSlotHeight > 0) {
                            const _rootKids = sourceListEl.querySelectorAll(':scope > .source-item, :scope > .group-container');
                            _rootKids.forEach((kid) => {
                                if (!kid || !kid.classList) return;
                                if (kid.classList.contains('sp-drag-folded')) return;
                                if (typeof kid.getBoundingClientRect !== 'function') return;
                                const _kr = kid.getBoundingClientRect();
                                if (!_kr || typeof _kr.top !== 'number' || typeof _kr.height !== 'number') return;
                                const _kMidY = _kr.top + _kr.height / 2;
                                if (_kMidY <= e.clientY) return; // child is above cursor → not affected
                                const _kIsSrc = kid.classList.contains('source-item');
                                const _kKey = _kIsSrc
                                    ? (kid.dataset && kid.dataset.sourceKey)
                                    : (kid.dataset && kid.dataset.groupId);
                                if (!_kKey || _rootSession.draggedKeys.has(_kKey)) return;
                                if (!shifts.has(_kKey)) shifts.set(_kKey, _rootSlotHeight);
                            });
                        }
                    }
                    if (typeof dragReflow.applyReflow === 'function') {
                        dragReflow.applyReflow({
                            session: runtime.dragReflowSession,
                            shifts,
                            rootElement: sourceListEl
                        });
                    }
                    runtime.dragReflowSession.currentIntent = { ...intent };
                }

                // Hover-expand: derive pointerGroupId from the host group-container we already resolved.
                const pointerGroupId = intent.hostGroupContainerEl && intent.hostGroupContainerEl.dataset
                    ? intent.hostGroupContainerEl.dataset.groupId
                    : null;
                const ancestorChain = pointerGroupId ? getGroupAncestorChain(pointerGroupId) : [];
                const ancestorSet = new Set(ancestorChain);

                if (runtime.hoverExpandedGroupIds.size > 0) {
                    const openedIds = Array.from(runtime.hoverExpandedGroupIds);
                    for (const G of openedIds) {
                        if (ancestorSet.has(G)) {
                            cancelHoverTimerForGroup(G);
                        } else {
                            armHoverCollapseTimerForGroup(G);
                        }
                    }
                }

                if (pointerGroupId) {
                    const groupsById = getGroupsById();
                    const pointerGroup = groupsById.get(pointerGroupId);
                    if (pointerGroup && pointerGroup.collapsed && Array.isArray(pointerGroup.children) && pointerGroup.children.length > 0) {
                        armHoverExpandTimerForGroup(pointerGroupId);
                    } else {
                        cancelHoverTimerForGroup(pointerGroupId);
                    }
                }
            } else {
                cancelAllHoverTimers();
            }

            if (autoScrollController && dragMulti && typeof dragMulti.computeAutoScrollVelocity === 'function') {
                const root = getShadowRoot();
                const list = root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
                if (list && typeof list.getBoundingClientRect === 'function') {
                    const listRect = list.getBoundingClientRect();
                    const velocity = dragMulti.computeAutoScrollVelocity({
                        pointerY: e.clientY,
                        containerTop: listRect.top,
                        containerBottom: listRect.bottom,
                        edgePx: dragMulti.EDGE_PX,
                        maxSpeed: dragMulti.MAX_SPEED
                    });
                    autoScrollController.tick(velocity);
                }
            }
        }

        function handleDragLeave(e) {
            const dropTarget = e.target.closest('.group-container, .source-item');
            if (dropTarget) {
                dropTarget.classList.remove('drag-into', 'drag-invalid');
            }
            if (e.target && e.target.id === 'sources-list' && autoScrollController) {
                autoScrollController.stop();
            }
            if (e.target && e.target.id === 'sources-list') {
                cancelAllHoverTimers();
            }
        }

        function clearDragFeedback(root = getShadowRoot()) {
            let count = 0;
            if (root && typeof root.querySelectorAll === 'function') {
                const nodes = Array.from(root.querySelectorAll('.dragging, .drag-into, .drag-invalid'));
                nodes.forEach((node) => {
                    if (node?.classList && typeof node.classList.remove === 'function') {
                        node.classList.remove('dragging', 'drag-into', 'drag-invalid');
                    }
                });
                count = nodes.length;
            }
            if (autoScrollController) autoScrollController.stop();
            runtime.activeDragContext = null;
            cancelAllHoverTimers();
            if (runtime.hoverExpandedGroupIds.size > 0) {
                const openedIds = Array.from(runtime.hoverExpandedGroupIds);
                for (const G of openedIds) {
                    executeHoverCollapse(G);
                }
                runtime.hoverExpandedGroupIds.clear();
            }
            return count;
        }

        function getGroupAncestorChain(groupId) {
            if (!groupId || typeof groupId !== 'string') return [];
            const parentMap = getParentMap();
            const chain = [groupId];
            let cursor = groupId;
            const seen = new Set([groupId]);
            while (parentMap && typeof parentMap.get === 'function') {
                const parent = parentMap.get(cursor);
                if (!parent || seen.has(parent)) break;
                chain.push(parent);
                seen.add(parent);
                cursor = parent;
            }
            return chain;
        }

        function cancelHoverTimerForGroup(groupId) {
            const entry = runtime.hoverExpandTimers.get(groupId);
            if (!entry) return;
            if (typeof clearTimeout === 'function' && entry.timeoutId !== null && entry.timeoutId !== undefined) {
                clearTimeout(entry.timeoutId);
            }
            runtime.hoverExpandTimers.delete(groupId);
        }

        function cancelAllHoverTimers() {
            if (runtime.hoverExpandTimers.size === 0) return;
            const ids = Array.from(runtime.hoverExpandTimers.keys());
            for (const id of ids) {
                cancelHoverTimerForGroup(id);
            }
        }

        function executeHoverExpand(groupId) {
            runtime.hoverExpandTimers.delete(groupId);
            const groupsById = getGroupsById();
            const group = groupsById.get(groupId);
            if (!group) return;
            if (!group.collapsed) return;
            if (!Array.isArray(group.children) || group.children.length === 0) return;
            const root = getShadowRoot();
            if (!root || typeof root.querySelector !== 'function') return;
            const container = root.querySelector(`.group-container[data-group-id="${cssEscape(groupId)}"]`);
            if (!container) return;
            toggleGroupCollapse(group, container);
            if (!group.collapsed) {
                runtime.hoverExpandedGroupIds.add(groupId);
            }
        }

        function armHoverExpandTimerForGroup(groupId) {
            if (!groupId) return;
            const groupsById = getGroupsById();
            const group = groupsById.get(groupId);
            if (!group) return;
            if (!group.collapsed) return;
            if (!Array.isArray(group.children) || group.children.length === 0) return;

            const existing = runtime.hoverExpandTimers.get(groupId);
            if (existing && existing.kind === 'expand') {
                cancelExpandTimersForOtherGroups(groupId);
                return;
            }
            if (existing) cancelHoverTimerForGroup(groupId);
            cancelExpandTimersForOtherGroups(groupId);

            const setTimeoutFn = getSetTimeout();
            if (typeof setTimeoutFn !== 'function') return;
            const timeoutId = setTimeoutFn(() => executeHoverExpand(groupId), 600);
            runtime.hoverExpandTimers.set(groupId, { kind: 'expand', timeoutId });
        }

        function armHoverCollapseTimerForGroup(groupId) {
            if (!groupId) return;
            if (!runtime.hoverExpandedGroupIds.has(groupId)) return;

            const existing = runtime.hoverExpandTimers.get(groupId);
            if (existing && existing.kind === 'collapse') return;
            if (existing) cancelHoverTimerForGroup(groupId);

            const setTimeoutFn = getSetTimeout();
            if (typeof setTimeoutFn !== 'function') return;
            const timeoutId = setTimeoutFn(() => executeHoverCollapse(groupId), 600);
            runtime.hoverExpandTimers.set(groupId, { kind: 'collapse', timeoutId });
        }

        function executeHoverCollapse(groupId) {
            runtime.hoverExpandTimers.delete(groupId);
            if (!runtime.hoverExpandedGroupIds.has(groupId)) return;
            runtime.hoverExpandedGroupIds.delete(groupId);

            const groupsById = getGroupsById();
            const group = groupsById.get(groupId);
            if (!group) return;
            if (group.collapsed) return;
            if (!Array.isArray(group.children) || group.children.length === 0) return;
            const root = getShadowRoot();
            if (!root || typeof root.querySelector !== 'function') return;
            const container = root.querySelector(`.group-container[data-group-id="${cssEscape(groupId)}"]`);
            if (!container) return;
            toggleGroupCollapse(group, container);
        }

        function cancelExpandTimersForOtherGroups(keepGroupId) {
            if (runtime.hoverExpandTimers.size === 0) return;
            const idsToCancel = [];
            runtime.hoverExpandTimers.forEach((entry, id) => {
                if (id !== keepGroupId && entry && entry.kind === 'expand') {
                    idsToCancel.push(id);
                }
            });
            for (const id of idsToCancel) {
                cancelHoverTimerForGroup(id);
            }
        }

        function resolveDropLandingGroupId(intent, augmentedIntent) {
            const probe = augmentedIntent || intent || {};
            const kind = probe.kind;
            const targetGroup = probe.targetGroup;
            if (kind === 'into-group') {
                return targetGroup && targetGroup.id ? targetGroup.id : null;
            }
            if (kind === 'before-source' || kind === 'after-source') {
                return targetGroup && targetGroup.id ? targetGroup.id : null;
            }
            if (kind === 'before-group' || kind === 'after-group') {
                return targetGroup && targetGroup.id ? targetGroup.id : null;
            }
            return null;
        }

        function disposeHoverOpenedGroupsAfterDrop(intent, augmentedIntent) {
            if (runtime.hoverExpandedGroupIds.size === 0) return;
            const landingId = resolveDropLandingGroupId(intent, augmentedIntent);
            const landingAncestors = landingId ? new Set(getGroupAncestorChain(landingId)) : new Set();

            const openedIds = Array.from(runtime.hoverExpandedGroupIds);
            for (const G of openedIds) {
                if (landingAncestors.has(G)) {
                    runtime.hoverExpandedGroupIds.delete(G);
                } else {
                    executeHoverCollapse(G);
                }
            }
            cancelAllHoverTimers();
        }

        function getSourceTreePosition(sourceKey) {
            const state = getState();
            const parentGroup = findParentGroupOfSource(sourceKey);
            if (parentGroup) {
                return {
                    list: parentGroup.children,
                    index: parentGroup.children.findIndex((child) => child.type === 'source' && child.key === sourceKey),
                    parentGroup
                };
            }

            state.ungrouped = Array.isArray(state.ungrouped) ? state.ungrouped : [];
            return {
                list: state.ungrouped,
                index: state.ungrouped.indexOf(sourceKey),
                parentGroup: null
            };
        }

        function getGroupTreePosition(groupId) {
            const state = getState();
            const groupsById = getGroupsById();
            const parentId = getParentMap().get(groupId);
            if (parentId) {
                const parentGroup = groupsById.get(parentId);
                return {
                    list: parentGroup?.children || [],
                    index: parentGroup?.children?.findIndex((child) => child.type === 'group' && child.id === groupId) ?? -1,
                    parentGroup: parentGroup || null
                };
            }

            state.groups = Array.isArray(state.groups) ? state.groups : [];
            return {
                list: state.groups,
                index: state.groups.indexOf(groupId),
                parentGroup: null
            };
        }

        function getNormalizedInsertionIndex(targetList, insertIndex, originalPosition = null) {
            const list = Array.isArray(targetList) ? targetList : [];
            let nextIndex = Number.isInteger(insertIndex) && insertIndex >= 0 ? insertIndex : list.length;
            if (originalPosition && originalPosition.list === list && nextIndex > originalPosition.index) {
                nextIndex -= 1;
            }
            const maxIndex = originalPosition && originalPosition.list === list
                ? Math.max(0, list.length - 1)
                : list.length;
            return Math.max(0, Math.min(nextIndex, maxIndex));
        }

        function isNoopTreeMove(originalPosition, targetList, insertIndex) {
            if (!originalPosition || originalPosition.index < 0) return true;
            const nextIndex = getNormalizedInsertionIndex(targetList, insertIndex, originalPosition);
            return originalPosition.list === targetList && originalPosition.index === nextIndex;
        }

        function cleanupReflowSession() {
            if (dragReflow && runtime.dragReflowSession) {
                if (typeof dragReflow.clearReflow === 'function') {
                    dragReflow.clearReflow({
                        session: runtime.dragReflowSession,
                        rootElement: getSourceListContainer()
                    });
                }
                if (typeof dragReflow.unfoldDraggedItems === 'function') {
                    // animated:true → smooth 200ms grow-back. Pairs with clearReflow's
                    // sibling translateY transition so cancel (esc / drop outside) feels
                    // like the row "settles" back into the list instead of snapping.
                    dragReflow.unfoldDraggedItems({
                        session: runtime.dragReflowSession,
                        rootElement: getSourceListContainer(),
                        animated: true
                    });
                }
                runtime.dragReflowSession = null;
            }
        }

        function handleDrop(e) {
            let reflowClearedForMutation = false;
            const clearReflowBeforeMutation = () => {
                if (reflowClearedForMutation) return;
                if (dragReflow && runtime.dragReflowSession && typeof dragReflow.clearReflow === 'function') {
                    dragReflow.clearReflow({
                        session: runtime.dragReflowSession,
                        rootElement: getSourceListContainer()
                    });
                    reflowClearedForMutation = true;
                }
            };
            const finalizeReflow = () => {
                if (dragReflow && runtime.dragReflowSession) {
                    if (!reflowClearedForMutation && typeof dragReflow.clearReflow === 'function') {
                        dragReflow.clearReflow({
                            session: runtime.dragReflowSession,
                            rootElement: getSourceListContainer()
                        });
                    }
                    if (typeof dragReflow.unfoldDraggedItems === 'function') {
                        dragReflow.unfoldDraggedItems({
                            session: runtime.dragReflowSession,
                            rootElement: getSourceListContainer()
                        });
                    }
                    runtime.dragReflowSession = null;
                }
            };
            try {
                cancelAllHoverTimers();
                const state = getState();
                const groupsById = getGroupsById();
                const sourcesByKey = getSourcesByKey();
                const pendingBatchKeys = getPendingBatchKeys();
                e.preventDefault();

                // Snapshot every visible source-item / group-container's pre-drop
                // visual top (reflects current inline transform shift from reflow).
                // Used by applyDropLandingAndFlash to FLIP siblings smoothly from
                // their drop-time positions to the new layout after render(),
                // eliminating the visible "snap" frame.
                const _preDropRoot = getSourceListContainer();
                const _preDropRects = new Map();
                if (_preDropRoot && typeof _preDropRoot.querySelectorAll === 'function') {
                    const _preEls = _preDropRoot.querySelectorAll('[data-source-key], [data-group-id]');
                    for (const _pEl of _preEls) {
                        if (!_pEl || typeof _pEl.getBoundingClientRect !== 'function') continue;
                        const _pKey = _pEl.dataset && (_pEl.dataset.sourceKey || _pEl.dataset.groupId);
                        if (!_pKey) continue;
                        const _pRect = _pEl.getBoundingClientRect();
                        if (_pRect) _preDropRects.set(_pKey, _pRect.top);
                    }
                }

                // Prefer the intent computed during the last dragover (set on currentIntent);
                // fall back to a one-shot computeDropIntent against e.clientY if absent.
                let intent = runtime.dragReflowSession && runtime.dragReflowSession.currentIntent
                    ? runtime.dragReflowSession.currentIntent
                    : null;
                if (!intent) {
                    intent = computeDropIntent({
                        clientX: e.clientX,
                        clientY: e.clientY,
                        rootElement: getSourceListContainer(),
                        state,
                        groupsById,
                        parentMap: getParentMap(),
                        activeDragContext: runtime.activeDragContext
                    });
                }
                if (!intent) {
                    clearDragFeedback();
                    return;
                }
                const intentKind = intent.kind;

                const sourceKey = e.dataTransfer.getData('application/source-key');
                const sourceKeysRaw = e.dataTransfer.getData('application/source-keys');
                const draggedGroupId = e.dataTransfer.getData('application/group-id');

                if (sourceKeysRaw && dragMulti && typeof dragMulti.applyMultiSourceDrop === 'function') {
                    let keys = null;
                    try { keys = JSON.parse(sourceKeysRaw); } catch (err) { keys = null; }
                    if (Array.isArray(keys) && keys.length >= 2) {
                        const allowedMultiIntents = new Set(['into-group', 'before-source', 'after-source']);
                        if (!allowedMultiIntents.has(intentKind)) {
                            clearDragFeedback();
                            return;
                        }
                        const augmentedIntent = {
                            kind: intentKind,
                            targetList: intent.targetList,
                            insertIndex: intent.insertIndex,
                            targetGroup: intent.targetGroup,
                            targetGroupId: intent.targetGroup ? intent.targetGroup.id : null
                        };
                        clearReflowBeforeMutation();
                        const result = dragMulti.applyMultiSourceDrop({
                            keys,
                            intent: augmentedIntent,
                            state,
                            helpers: {
                                sourceExists: (key) => sourcesByKey.has(key),
                                getGroupById: (id) => groupsById.get(id) || null,
                                removeSourceFromParent: (key) => removeSourceFromTree(key)
                            }
                        });
                        if (result && result.moved > 0) {
                            developerLog('info', 'source_action', 'batch_drag_move', { count: result.moved, intent: intentKind });
                            state.isBatchMode = false;
                            pendingBatchKeys.clear();
                            buildParentMap();
                            saveState({ immediate: true, critical: true });
                            render();
                            showToast(getMessage('ui_batch_moved_sources_toast', [String(result.moved)]));
                            disposeHoverOpenedGroupsAfterDrop(intent, augmentedIntent);
                            applyDropLandingAndFlash(Array.isArray(keys) ? keys : [], e.clientX, e.clientY, _preDropRects);
                        }
                        clearDragFeedback();
                        return;
                    }
                }

                let didMove = false;
                const augmentedIntent = {
                    kind: intentKind,
                    targetList: intent.targetList,
                    insertIndex: intent.insertIndex,
                    targetGroup: intent.targetGroup
                };

                if (sourceKey) {
                    const originalPosition = getSourceTreePosition(sourceKey);
                    if (isNoopTreeMove(originalPosition, intent.targetList, intent.insertIndex)) {
                        clearDragFeedback();
                        return;
                    }
                    const insertionIndex = getNormalizedInsertionIndex(intent.targetList, intent.insertIndex, originalPosition);
                    clearReflowBeforeMutation();
                    removeSourceFromTree(sourceKey);
                    if (intent.targetGroup) {
                        intent.targetGroup.children.splice(insertionIndex, 0, { type: 'source', key: sourceKey });
                    } else {
                        state.ungrouped.splice(insertionIndex, 0, sourceKey);
                    }
                    didMove = true;
                } else if (draggedGroupId) {
                    const draggedGroupObj = groupsById.get(draggedGroupId);
                    if (!draggedGroupObj) {
                        clearDragFeedback();
                        return;
                    }
                    if (intent.targetGroup && isDescendant(intent.targetGroup, draggedGroupObj, groupsById)) {
                        clearDragFeedback();
                        return;
                    }
                    const originalPosition = getGroupTreePosition(draggedGroupId);
                    if (isNoopTreeMove(originalPosition, intent.targetList, intent.insertIndex)) {
                        clearDragFeedback();
                        return;
                    }
                    const insertionIndex = getNormalizedInsertionIndex(intent.targetList, intent.insertIndex, originalPosition);
                    clearReflowBeforeMutation();
                    removeGroupFromTree(draggedGroupId);
                    if (intent.targetGroup) {
                        intent.targetGroup.children.splice(insertionIndex, 0, { type: 'group', id: draggedGroupId });
                    } else {
                        state.groups.splice(insertionIndex, 0, draggedGroupId);
                    }
                    didMove = true;
                }

                if (!didMove) {
                    clearDragFeedback();
                    return;
                }
                buildParentMap();
                render();
                saveState({ immediate: true, critical: true });
                disposeHoverOpenedGroupsAfterDrop(intent, augmentedIntent);
                clearDragFeedback();
                applyDropLandingAndFlash(
                    sourceKey ? [sourceKey] : (draggedGroupId ? [draggedGroupId] : []),
                    e.clientX, e.clientY,
                    _preDropRects
                );
                // Discoverability hint: when a source drop falls back to the ungrouped
                // section via the root-corridor route (intent.slotKey === null is the
                // routeToNearestNeighborKind fallback marker), the source lands in the
                // ungrouped region — which render() places at the BOTTOM of the list,
                // below all groups. User just dropped between two groups in the root
                // corridor and now the source visually appears far below where their
                // cursor was — confusing without a hint. Surface a toast + scroll the
                // ungrouped header into view so user can find their source.
                if (sourceKey && intent && intent.targetGroup == null && intent.slotKey == null) {
                    try { showToast(getMessage('ui_keyboard_moved_ungrouped_toast')); } catch (_) {}
                    const _listAfter = getSourceListContainer();
                    if (_listAfter && typeof _listAfter.querySelector === 'function') {
                        const _ungroupedHeader = _listAfter.querySelector('.ungrouped-header');
                        if (_ungroupedHeader && typeof _ungroupedHeader.scrollIntoView === 'function') {
                            try { _ungroupedHeader.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
                        }
                    }
                }
            } finally {
                finalizeReflow();
            }
        }

        // Drop visual feedback: dropped rows get a direction-neutral opacity 0→1 fade-in
        // (180ms cubic-bezier), siblings get a FLIP transform animation from their pre-drop
        // visual position to the new layout. Together the two animations give a coherent
        // "everything settles into place" beat without the directional baggage of the
        // earlier `.sp-drop-flying` (cursor-release → slot, read as "from the right") and
        // `.sp-drop-landing` (scaleY 0 → 1, read as "growing from top") effects. cursorX /
        // cursorY parameters retained for backward compatibility with callers — no longer
        // used because opacity fade-in needs no positional input.
        function applyDropLandingAndFlash(landedKeys, _cursorX, _cursorY, preRects) {
            if (!Array.isArray(landedKeys) || landedKeys.length === 0) return;
            const rootElement = getSourceListContainer();
            if (!rootElement || typeof rootElement.querySelector !== 'function') return;
            const setTimeoutFn = getSetTimeout();

            // Suppress `.sp-list-item-enter` on the just-rendered list. That class triggers
            // a staggered (index * 18ms delay) opacity 0→1 + scale(0.985)→1 entrance
            // animation per row — fine for first list mount, but render() reapplies it to
            // EVERY row after drop's patchNode rewrites their class attribute, producing a
            // visible "all sources shimmer slightly" effect that reads as a flash. Drop is
            // a reorder (no genuinely-new rows), so silencing this animation is correct:
            // the dragged element's fly-in / scaleY landing carries the only motion the
            // user needs to see. Done synchronously before paint so the animation never
            // actually starts.
            if (typeof rootElement.querySelectorAll === 'function') {
                const _enterEls = rootElement.querySelectorAll('.sp-list-item-enter');
                if (_enterEls && typeof _enterEls.forEach === 'function') {
                    _enterEls.forEach((node) => {
                        if (node && node.classList && typeof node.classList.remove === 'function') {
                            node.classList.remove('sp-list-item-enter');
                        }
                    });
                }
            }

            // Suppress the `.source-item` / `.group-header` base CSS transition on transform
            // (`transform var(--sp-motion-base) var(--sp-ease-standard)` = 180ms) for EVERY
            // visible row before any further style changes. Why: `clearReflowBeforeMutation`
            // earlier cleared sibling inline `transform: translateY(N)` to '', which is a
            // computed-value change that the base CSS transition rule would auto-animate.
            // For siblings whose new layout exactly matches their drag-time visual (delta = 0,
            // skipped by sibling FLIP below), this auto-transition makes them visually slide
            // translateY(N) → 0 over 180ms — the "microscopic upward slide" the user reports
            // as "all sources micro-move after drop". Setting inline `transition: none` here
            // takes precedence over the CSS rule and squashes that auto-transition. The two
            // animation paths we DO want (sibling FLIP and dragged fly-in/scaleY) explicitly
            // restore inline `transition` to '' on the rows they animate, so .sp-drop-shift /
            // .sp-drop-flying class transitions can take effect. After paint, an RAF callback
            // restores inline transition on all rows so future hover/etc. transitions work.
            const _suppressedRows = [];
            if (typeof rootElement.querySelectorAll === 'function') {
                rootElement.querySelectorAll('[data-source-key], [data-group-id]').forEach((row) => {
                    if (!row || !row.style) return;
                    row.style.transition = 'none';
                    _suppressedRows.push(row);
                });
            }

            // Sibling FLIP: animate non-landed elements from their pre-drop visual
            // position (captured BEFORE state mutation + render) to their new layout
            // position. Without this, when render() rebuilds the DOM, sibling elements
            // that had reflow translateY shift visually SNAP from "shifted" to "layout"
            // — perceived as a jank frame at drop time, even though the dragged item
            // itself is already animating smoothly via fly-in. This block makes every
            // visible row's drop-time motion smooth, in parallel with the dragged
            // element's fly-in/scaleY animation.
            const _landedSet = new Set(Array.isArray(landedKeys) ? landedKeys : []);
            if (preRects && typeof preRects.get === 'function' && typeof rootElement.querySelectorAll === 'function') {
                const _flipEls = rootElement.querySelectorAll('[data-source-key], [data-group-id]');
                for (const _flipEl of _flipEls) {
                    if (!_flipEl || !_flipEl.classList || !_flipEl.style) continue;
                    const _flipKey = _flipEl.dataset && (_flipEl.dataset.sourceKey || _flipEl.dataset.groupId);
                    if (!_flipKey) continue;
                    if (_landedSet.has(_flipKey)) continue; // landed items use fly-in / scaleY below
                    if (typeof _flipEl.getBoundingClientRect !== 'function') continue;
                    const _oldTop = preRects.get(_flipKey);
                    if (typeof _oldTop !== 'number') continue; // newly inserted / no snapshot
                    const _newRect = _flipEl.getBoundingClientRect();
                    if (!_newRect) continue;
                    const _delta = _oldTop - _newRect.top;
                    if (Math.abs(_delta) < 1) continue;
                    // FLIP: jump back to pre-drop visual position, force a reflow, then
                    // clear the inline transform with .sp-drop-shift's 200ms transition
                    // active — element animates from its old visual spot to the new layout.
                    // Note: inline `transition: none` was set on this element above; the
                    // initial translateY(delta) is therefore an instant jump (no auto
                    // animation), then we restore inline transition to '' so .sp-drop-shift's
                    // CSS rule takes effect for the subsequent transform = '' change.
                    _flipEl.style.transform = `translateY(${_delta}px)`;
                    void _flipEl.offsetHeight; // force layout flush + commit intermediate
                    _flipEl.classList.add('sp-drop-shift');
                    _flipEl.style.transition = ''; // restore so .sp-drop-shift rule applies
                    _flipEl.style.transform = '';
                    if (typeof setTimeoutFn === 'function') {
                        const _flipCleanup = ((target) => () => {
                            if (target && target.classList && typeof target.classList.remove === 'function') {
                                target.classList.remove('sp-drop-shift');
                            }
                        })(_flipEl);
                        setTimeoutFn(_flipCleanup, 240);
                    }
                }
            }
            // Landed-element fade-in: gentle opacity 0→1 over 180ms.
            //
            // Direction-neutral by design — uses opacity only (no transform / scaleY /
            // slide-from-X) to avoid the "from right" appearance that the previous
            // `.sp-drop-flying` FLIP and `.sp-drop-landing` scaleY-from-zero produced.
            // Both of those carried a visible direction (cursor-release → slot, top →
            // expanded) that the user disliked. Opacity alone reads as "appearing into
            // place" — directionless, but still gives the drop a coherent finishing beat
            // that pairs with sibling FLIP's transform motion.
            //
            // Transform is intentionally left untouched here so the post-drop pseudo-hover
            // CSS rule (`transform: scale(1.01)`) can still apply normally when
            // handleDragEnd adds `.sp-pseudo-hover` to the cursor-under element.
            //
            // Element currently has inline `transition: none` from the _suppressedRows
            // loop above. Sequence:
            //   1. jump to opacity 0 instantly (transition still none → no animation)
            //   2. force layout flush so the 0 commits before transition activates
            //   3. switch to `transition: opacity 180ms` and target opacity ''
            //      → browser animates from 0 to natural over 180ms
            //   4. after 220ms setTimeout, clear inline transition so the base
            //      `.source-item` transition rule (covers background/box-shadow/etc.)
            //      regains effect for subsequent hover / focus changes.
            for (const key of landedKeys) {
                if (typeof key !== 'string' || !key) continue;
                const safe = key.replace(/"/g, '\\"');
                const el = rootElement.querySelector(`[data-source-key="${safe}"]`)
                    || rootElement.querySelector(`[data-group-id="${safe}"]`);
                if (!el || !el.style) continue;
                el.style.opacity = '0';
                void el.offsetHeight; // force layout flush so opacity 0 commits
                el.style.transition = 'opacity 180ms cubic-bezier(0.2, 0, 0, 1)';
                el.style.opacity = '';
                if (typeof setTimeoutFn === 'function') {
                    const _landedCleanup = ((target) => () => {
                        if (target && target.style) {
                            target.style.transition = '';
                        }
                    })(el);
                    setTimeoutFn(_landedCleanup, 220);
                }
            }

            // After sync code completes and the browser paints once, restore inline
            // transition='' on rows that did NOT get FLIP/fly-in applied (delta=0 siblings,
            // newly-inserted rows, etc.). They've been frozen at their layout positions
            // with no spurious base-transition animation. After paint, they should respond
            // to future hover/focus/etc. with the default CSS transitions again.
            const _rafRestore = typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame
                : null;
            const _restoreFn = () => {
                for (const _row of _suppressedRows) {
                    if (_row && _row.style && _row.style.transition === 'none') {
                        _row.style.transition = '';
                    }
                }
            };
            if (_rafRestore) {
                // Double-RAF: first ensures the suppression paint commits; second ensures
                // we don't race with a transition that started in this paint.
                _rafRestore(() => _rafRestore(_restoreFn));
            } else if (typeof setTimeoutFn === 'function') {
                setTimeoutFn(_restoreFn, 30);
            }
        }

        function handleDragEnd(e) {
            // clearDragFeedback is the single source of truth for cleanup that's
            // common to ALL drag terminations (drop, cancel, esc, dragend race):
            //   - cancelAllHoverTimers
            //   - collapse hover-expanded groups (the auto-opened ones during drag)
            //   - autoScrollController.stop
            //   - runtime.activeDragContext = null
            //   - remove .dragging / .drag-into / .drag-invalid classes from DOM
            // Previously handleDragEnd duplicated steps 1, 2, 3, 4 inline before
            // calling clearDragFeedback — harmless (idempotent) but obscured the
            // ownership contract. Now we delegate cleanly and let handleDragEnd
            // focus on dragend-only concerns: ghost destroy, reflow session
            // teardown, pseudo-hover + synthetic mousemove for post-drop :hover
            // refresh.
            clearDragFeedback();
            if (runtime.activeDragGhost && dragMulti && typeof dragMulti.destroyMultiDragGhost === 'function') {
                const ghost = runtime.activeDragGhost;
                runtime.activeDragGhost = null;
                const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame : null;
                if (raf) {
                    raf(() => dragMulti.destroyMultiDragGhost(ghost));
                } else {
                    dragMulti.destroyMultiDragGhost(ghost);
                }
            }
            cleanupReflowSession();
            // Post-drop hover hint: Chrome's native :hover stays stuck on whichever DOM
            // element was under the cursor at dragstart (regardless of layout changes that
            // happened during drag), and pointer-events flicker alone doesn't reliably
            // invalidate Chrome's hover-state cache. Two layered mechanisms now collaborate:
            //
            //   (1) Synthetic `mousemove` dispatch (primary) — walks Chrome through the
            //       hover-update path explicitly, so native :hover snaps to the cursor's
            //       actual current element on the next paint.
            //   (2) `.sp-pseudo-hover` JS class (redundancy) — applies hover styling to
            //       whatever element is currently under the cursor; cleared on the first
            //       genuine user pointer event. Acts as a safety net for browsers / cases
            //       where (1) doesn't fully take effect (synthetic events have
            //       isTrusted=false; some hover paths are gated on trusted events).
            //
            // The pseudo class is cleared the moment any of {mousemove, mouseover,
            // mousedown} fires after dragend — the synthetic mousemove from (1)
            // typically triggers (2)'s cleanup in the same frame, so the user rarely
            // sees the pseudo class visually. If the synthetic dispatch fails, the
            // pseudo class remains visible until the user moves the mouse for real.
            const _endList = getSourceListContainer();
            if (_endList && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
                const _shadow = typeof getShadowRoot === 'function' ? getShadowRoot() : null;
                const _doc = typeof getDocument === 'function' ? getDocument() : null;
                let _target = null;
                if (_shadow && typeof _shadow.elementFromPoint === 'function') {
                    _target = _shadow.elementFromPoint(e.clientX, e.clientY);
                }
                if (!_target && _doc && typeof _doc.elementFromPoint === 'function') {
                    _target = _doc.elementFromPoint(e.clientX, e.clientY);
                }
                const _hoverable = _target && typeof _target.closest === 'function'
                    ? _target.closest('.source-item, .group-header')
                    : null;
                if (_hoverable && _hoverable.classList && typeof _hoverable.classList.add === 'function') {
                    _hoverable.classList.add('sp-pseudo-hover');
                }
                const _clearPseudo = () => {
                    if (!_endList || typeof _endList.querySelectorAll !== 'function') return;
                    const _stale = _endList.querySelectorAll('.sp-pseudo-hover');
                    if (_stale && typeof _stale.forEach === 'function') {
                        _stale.forEach((node) => {
                            if (node && node.classList && typeof node.classList.remove === 'function') {
                                node.classList.remove('sp-pseudo-hover');
                            }
                        });
                    }
                };
                if (_doc && typeof _doc.addEventListener === 'function') {
                    const _onCleanup = () => {
                        try {
                            _doc.removeEventListener('mousemove', _onCleanup, true);
                            _doc.removeEventListener('mouseover', _onCleanup, true);
                            _doc.removeEventListener('mousedown', _onCleanup, true);
                        } catch (_) {}
                        _clearPseudo();
                    };
                    _doc.addEventListener('mousemove', _onCleanup, true);
                    _doc.addEventListener('mouseover', _onCleanup, true);
                    _doc.addEventListener('mousedown', _onCleanup, true);
                }
                // Dispatch a synthetic mousemove at the cursor's actual position to force
                // Chrome to recompute :hover. Target is the element from elementFromPoint
                // (preferred — guarantees the event lands on what's actually under the
                // cursor in the Shadow DOM); falls back to _hoverable if elementFromPoint
                // returned a deeper child. The MouseEvent bubbles to document where the
                // _onCleanup capture listener catches it and clears `.sp-pseudo-hover`,
                // letting native :hover (now refreshed) take over seamlessly.
                const _dispatchTarget = _target || _hoverable;
                if (_dispatchTarget && typeof _dispatchTarget.dispatchEvent === 'function') {
                    try {
                        _dispatchTarget.dispatchEvent(new MouseEvent('mousemove', {
                            clientX: e.clientX,
                            clientY: e.clientY,
                            bubbles: true,
                            cancelable: true,
                            view: typeof globalThis.window !== 'undefined' ? globalThis.window : null
                        }));
                    } catch (_) { /* ignore synthetic dispatch failure */ }
                }
                const _setTimeoutEnd = typeof getSetTimeout === 'function' ? getSetTimeout() : null;
                if (typeof _setTimeoutEnd === 'function') {
                    _setTimeoutEnd(_clearPseudo, 1500);
                }
            }
        }

        return {
            handleAddNewGroup,
            syncSourceToPage,
            processClickQueue,
            findParentGroupOfSource,
            removeSourceFromTree,
            isBatchOperableSource,
            collectSourceKeysInTreeOrder,
            executeBatchMoveToUngrouped,
            canMoveSourceToUngrouped,
            moveSourceToUngrouped,
            removeGroupFromTree,
            toggleGroupCollapse,
            handleInteraction,
            handleOriginalCheckboxChange,
            triggerRename,
            handleDragStart,
            handleDragOver,
            handleDragLeave,
            handleDrop,
            handleDragEnd,
            clearDragFeedback,
            getSourceTreePosition,
            getGroupTreePosition,
            isNoopTreeMove,
            getGroupAncestorChain,
            resolveSiblingKeys,
            computeDropIntent
        };
    }

    globalThis.NSM_CREATE_CONTENT_TREE_INTERACTIONS = createContentTreeInteractions;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentTreeInteractions;
    }
}());
