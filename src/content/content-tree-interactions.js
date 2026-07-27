(function () {
    'use strict';

    /**
     * createContentTreeInteractions(deps) — tree 视图所有交互的主控:
     * 单击 / 勾选 / batch select 推进、checkbox propagation up/down、
     * group 折叠展开、跨 group 拖拽 (HTML5 DnD)、reflow shift 动画补丁、
     * batch move/delete/move-to-ungrouped 一阶段处理、native click queue 投递。
     * 与 content-source-actions(右键菜单)互补,本模块管 row 主体与拖拽。
     *
     * @param {Object} deps 50+ 项依赖(完整 destructuring 见 line 4+),大致五类:
     *   - state / 索引: runtime, getState / getGroupsById / getSourcesByKey /
     *     getPendingBatchKeys / getParentMap / getClickQueue / getKeyByElement
     *   - 环境: getShadowRoot / getDocument / getWindow / getSetTimeout / getDEPS /
     *     getSourceCheckboxSelector
     *   - i18n / 通知 / 渲染: getMessage, showToast, showUndoableToast, render, saveState
     *   - 派发到其他子系统: isSourceEffectivelyEnabled,
     *     collectEffectiveSourceStates, syncSourcesToEffectiveState,
     *     executeBatchDelete, renderMoveToFolderModal
     *   - 拖拽配套: 一组 drag feedback / reflow helpers 在内部组装,
     *     依赖 runtime.activeDragGhost 等运行时句柄
     * @returns {Object} tree and drag helpers。group 操作 (handleAddNewGroup /
     *   toggleGroupCollapse),source 操作 (syncSourceToPage / findParentGroupOfSource /
     *   canMoveSourceToUngrouped / moveSourceToUngrouped),
     *   batch 操作 (collectSourceKeysInTreeOrder / executeBatchMoveToUngrouped /
     *   isBatchOperableSource),交互入口 (handleInteraction /
     *   handleOriginalCheckboxChange / triggerRename / processClickQueue),
     *   完整拖拽生命周期 (handleDragStart / handleDragOver / handleDragLeave /
     *   handleDrop / handleDragEnd / clearDragFeedback / computeDropIntent /
     *   applyReflowAfterRender),以及树形位置 (getGroupAncestorChain /
     *   resolveSiblingKeys / resolveVisibleAnchorInsertIndex)。完整 return 块见文件末尾。
     */
    function createContentTreeInteractions(deps = {}) {
        const runtime = deps.runtime || deps;
        const NATIVE_SELECTION_SYNC_RETRY_LIMIT = 6;
        const TREE_ORDER_STATUS_KEYS = {
            up: 'ui_tree_order_moved_up_status',
            down: 'ui_tree_order_moved_down_status',
            in: 'ui_tree_order_moved_in_status',
            out: 'ui_tree_order_moved_out_status'
        };

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
        const createContentTreePlacementFactory = globalThis.NSM_CREATE_CONTENT_TREE_PLACEMENT
            || (
                typeof require === 'function'
                    ? require('./content-tree-placement.js')
                    : null
            );
        const treePlacement = deps.treePlacement
            || runtime.treePlacement
            || (
                typeof createContentTreePlacementFactory === 'function'
                    ? createContentTreePlacementFactory({
                        getState,
                        getGroupsById
                    })
                    : null
            );
        const getClickQueue = typeof deps.getClickQueue === 'function'
            ? deps.getClickQueue
            : () => (deps.clickQueue || runtime.clickQueue || []);
        const getKeyByElement = typeof deps.getKeyByElement === 'function'
            ? deps.getKeyByElement
            : () => (deps.keyByElement || runtime.keyByElement || new WeakMap());
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || runtime.shadowRoot || null);
        // Drag mode preference ('classic' blue-line / 'reflow' avoidance Beta). Default
        // 'reflow' here keeps the new engine active when no getter is injected (unit tests
        // that predate the toggle); production index.js injects the real getDragMode, whose
        // own default is 'classic'.
        const getDragMode = typeof deps.getDragMode === 'function'
            ? deps.getDragMode
            : () => 'reflow';
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

        const FILTERED_LAST_VISIBLE_POLICY = 'anchor-relative';

        function toVisibleIdentity(entry) {
            if (typeof entry === 'string' && entry) {
                return { type: 'source', key: entry };
            }
            if (!entry || typeof entry !== 'object') return null;
            if (entry.type === 'source' && typeof entry.key === 'string' && entry.key) {
                return { type: 'source', key: entry.key };
            }
            if (entry.type === 'group' && typeof entry.id === 'string' && entry.id) {
                return { type: 'group', id: entry.id };
            }
            return null;
        }

        function sameIdentity(left, right) {
            if (!left || !right || left.type !== right.type) return false;
            if (left.type === 'source') {
                return typeof left.key === 'string'
                    && typeof right.key === 'string'
                    && left.key === right.key;
            }
            if (left.type === 'group') {
                return typeof left.id === 'string'
                    && typeof right.id === 'string'
                    && left.id === right.id;
            }
            return false;
        }

        function resolveVisibleAnchorInsertIndex({
            fullList,
            visibleIdentities,
            anchorIdentity,
            edge,
            lastVisiblePolicy
        } = {}) {
            if (!Array.isArray(fullList) || !Array.isArray(visibleIdentities)) return null;
            if (fullList.length === 0) return 0;
            if (edge !== 'before' && edge !== 'after') return null;
            if (lastVisiblePolicy !== 'anchor-relative' && lastVisiblePolicy !== 'container-end') {
                return null;
            }
            if (!visibleIdentities.some((item) => sameIdentity(item, anchorIdentity))) {
                return null;
            }
            const fullIndex = fullList.findIndex((entry) => (
                sameIdentity(toVisibleIdentity(entry), anchorIdentity)
            ));
            if (fullIndex < 0) return null;
            if (
                edge === 'after'
                && lastVisiblePolicy === 'container-end'
                && sameIdentity(visibleIdentities[visibleIdentities.length - 1], anchorIdentity)
            ) {
                return fullList.length;
            }
            return edge === 'after' ? fullIndex + 1 : fullIndex;
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
        //   3. If no group contains the pointer → host = root list (state.root; the empty
        //      bottom bin / state.ungrouped is resolved as a separate trailing drop zone).
        //   4. Slot detection: for each non-folded child element, compare its un-shifted
        //      mid-Y against clientY; the first whose mid-Y > clientY becomes the insert slot.
        //      All visible elements past clientY → insert after the last visible anchor in
        //      the full target list (anchor-relative filtered-slot policy).
        //
        // Un-shifted bounds means `rect.top - extractInlineTranslateY(el)`: subtract any
        // active reflow shift so the detection is stable while siblings are translateY'd.
        //
        // RETURNS: { targetGroup, targetList, insertIndex, targetGroupId, kind, ... } | null
        //   INVARIANT — `targetList` is HETEROGENEOUS, shape depends on target:
        //     - state.ungrouped   → string[] of source keys (the bottom bin)
        //     - group.children    → object[] of { type: 'source', key } | { type: 'group', id }
        //     - state.root        → object[] of { type: 'source', key } | { type: 'group', id }
        //                           (root folders AND positioned root sources, interleaved)
        //   Callers that splice into targetList MUST pick entry shape per target:
        //   object entries for state.root / group.children, bare keys for state.ungrouped.
        //   See CLAUDE.md "Non-obvious gotchas" and resolveSiblingKeys above for
        //   an example of polymorphic targetList consumption.
        // Classic drag mode never positions a loose source at a root index — such a drop
        // is demoted to the bottom ungrouped bin (26.5.26 behavior). The raw geometry
        // resolver below is unchanged; this wrapper applies the mode gate at the single
        // exit so both single- and multi-source drops (which reuse one intent) are covered.
        // Group reorder at root and source-into-folder are NOT demoted.
        function normalizeSemanticDropTarget(target) {
            if (
                !target
                || typeof target !== 'object'
                || !Number.isInteger(target.index)
                || target.index < 0
            ) {
                return null;
            }
            if (target.container === 'root' || target.container === 'ungrouped') {
                return {
                    container: target.container,
                    index: target.index
                };
            }
            if (
                target.container === 'group'
                && typeof target.groupId === 'string'
                && target.groupId
            ) {
                return {
                    container: 'group',
                    groupId: target.groupId,
                    index: target.index
                };
            }
            return null;
        }

        function getSemanticDropTargetFromMarkers(intent) {
            if (!intent || !Number.isInteger(intent.insertIndex) || intent.insertIndex < 0) {
                return null;
            }
            const groupId = (
                typeof intent.targetGroupId === 'string'
                && intent.targetGroupId
            )
                ? intent.targetGroupId
                : (
                    typeof intent.targetGroup?.id === 'string'
                    && intent.targetGroup.id
                        ? intent.targetGroup.id
                        : ''
                );
            if (groupId) {
                if (intent.isRootList || intent.isUngroupedBin) return null;
                return {
                    container: 'group',
                    groupId,
                    index: intent.insertIndex
                };
            }
            if (intent.isRootList && intent.isUngroupedBin) return null;
            if (intent.isUngroupedBin) {
                return {
                    container: 'ungrouped',
                    index: intent.insertIndex
                };
            }
            if (intent.isRootList) {
                return {
                    container: 'root',
                    index: intent.insertIndex
                };
            }
            return null;
        }

        function semanticDropTargetsEqual(left, right) {
            if (!left || !right || left.container !== right.container) return false;
            if (left.index !== right.index) return false;
            if (left.container !== 'group') return true;
            return left.groupId === right.groupId;
        }

        function resolveSemanticDropTarget(intent) {
            if (!intent || typeof intent !== 'object') return null;
            const declaredGroupId = (
                typeof intent.targetGroupId === 'string'
                && intent.targetGroupId
            )
                ? intent.targetGroupId
                : '';
            const objectGroupId = (
                typeof intent.targetGroup?.id === 'string'
                && intent.targetGroup.id
            )
                ? intent.targetGroup.id
                : '';
            if (
                declaredGroupId
                && objectGroupId
                && declaredGroupId !== objectGroupId
            ) {
                return null;
            }
            const hasExplicitTarget = Object.prototype.hasOwnProperty.call(intent, 'target');
            const explicitTarget = normalizeSemanticDropTarget(intent.target);
            const markerTarget = getSemanticDropTargetFromMarkers(intent);
            if (hasExplicitTarget && !explicitTarget) return null;
            if (!explicitTarget) return markerTarget;
            if (
                Number.isInteger(intent.insertIndex)
                && intent.insertIndex !== explicitTarget.index
            ) {
                return null;
            }
            if (markerTarget && !semanticDropTargetsEqual(explicitTarget, markerTarget)) {
                return null;
            }
            if (
                explicitTarget.container === 'group'
                && (intent.isRootList || intent.isUngroupedBin)
            ) {
                return null;
            }
            if (
                explicitTarget.container === 'root'
                && intent.isUngroupedBin
            ) {
                return null;
            }
            if (
                explicitTarget.container === 'ungrouped'
                && intent.isRootList
            ) {
                return null;
            }
            return explicitTarget;
        }

        function attachSemanticDropTarget(intent) {
            if (!intent) return null;
            const target = resolveSemanticDropTarget(intent);
            return target
                ? {
                    ...intent,
                    target
                }
                : null;
        }

        function rebuildPlacementParentMap() {
            if (!treePlacement || typeof treePlacement.rebuildParentMap !== 'function') {
                return false;
            }
            treePlacement.rebuildParentMap(getParentMap());
            return true;
        }

        function computeDropIntent(args) {
            const geometrySnapshot = args && args.geometrySnapshot
                ? args.geometrySnapshot
                : readDragGeometry({
                    rootElement: args && args.rootElement,
                    session: runtime.dragReflowSession || null
                });
            const intent = computeDropIntentRaw({
                ...(args || {}),
                geometrySnapshot
            });
            const semanticIntent = attachSemanticDropTarget(intent);
            if (getDragMode() !== 'classic') return semanticIntent;
            if (!semanticIntent || !semanticIntent.isRootList) return semanticIntent;
            const ctx = args && args.activeDragContext;
            const isSourceDrag = !!ctx && (ctx.kind === 'source-single' || ctx.kind === 'source-multi');
            if (!isSourceDrag) return semanticIntent;
            const ungrouped = args && args.state && Array.isArray(args.state.ungrouped) ? args.state.ungrouped : [];
            return {
                kind: 'after-source',
                targetGroup: null,
                targetList: ungrouped,
                insertIndex: ungrouped.length,
                targetGroupId: null,
                hostGroupContainerEl: null,
                slotKey: null,
                isUngroupedBin: true,
                target: {
                    container: 'ungrouped',
                    index: ungrouped.length
                }
            };
        }

        const DRAG_GEOMETRY_SELECTOR = [
            '.source-item[data-source-key]',
            '.group-container[data-group-id]',
            '.group-header',
            '.group-children',
            '.ungrouped-section',
            '.sp-ungroup-dropzone'
        ].join(', ');
        let dragGeometryDomGeneration = 0;
        let pendingDragScrollPatch = null;

        function copyRect(rect) {
            if (!rect) return null;
            const top = Number(rect.top);
            const bottom = Number(rect.bottom);
            const left = Number(rect.left);
            const right = Number(rect.right);
            const width = Number(rect.width);
            const height = Number(rect.height);
            if (
                !Number.isFinite(top)
                || !Number.isFinite(bottom)
                || !Number.isFinite(left)
                || !Number.isFinite(right)
                || !Number.isFinite(width)
                || !Number.isFinite(height)
            ) {
                return null;
            }
            return { top, bottom, left, right, width, height };
        }

        function translateRect(rect, deltaY) {
            if (!rect || !Number.isFinite(deltaY) || deltaY === 0) return rect;
            return {
                top: rect.top + deltaY,
                bottom: rect.bottom + deltaY,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height
            };
        }

        function translateRectBy(rect, deltaX, deltaY) {
            if (!rect) return rect;
            const x = Number.isFinite(deltaX) ? deltaX : 0;
            const y = Number.isFinite(deltaY) ? deltaY : 0;
            if (x === 0 && y === 0) return rect;
            return {
                top: rect.top + y,
                bottom: rect.bottom + y,
                left: rect.left + x,
                right: rect.right + x,
                width: rect.width,
                height: rect.height
            };
        }

        function translateGeometryEntry(entry, deltaX, deltaY) {
            if (!entry) return;
            entry.visualRect = translateRectBy(entry.visualRect, deltaX, deltaY);
            entry.layoutRect = translateRectBy(entry.layoutRect, deltaX, deltaY);
        }

        function translateGeometrySnapshot(snapshot, rootRect, deltaX, deltaY) {
            for (const source of snapshot.sourceEntries.values()) {
                translateGeometryEntry(source, deltaX, deltaY);
            }
            for (const group of snapshot.groups.values()) {
                translateGeometryEntry(group, deltaX, deltaY);
                translateGeometryEntry(group.header, deltaX, deltaY);
                translateGeometryEntry(group.children, deltaX, deltaY);
            }
            if (snapshot.bin) {
                snapshot.bin.visualRect = translateRectBy(
                    snapshot.bin.visualRect,
                    deltaX,
                    deltaY
                );
                snapshot.bin.layoutRect = translateRectBy(
                    snapshot.bin.layoutRect,
                    deltaX,
                    deltaY
                );
            }
            snapshot.rootRect = rootRect;
        }

        function resolveScrollPatchPlan(snapshot, scrollDeltas) {
            if (!snapshot || !(scrollDeltas instanceof Map)) return null;
            const plan = [];
            for (const [target, delta] of scrollDeltas) {
                if (
                    !target
                    || !delta
                    || !Number.isFinite(delta.left)
                    || !Number.isFinite(delta.top)
                ) {
                    return null;
                }
                if (target === snapshot.rootElement) {
                    plan.push({
                        kind: 'root',
                        deltaX: -delta.left,
                        deltaY: -delta.top
                    });
                    continue;
                }
                const groupId = snapshot.groupIdByChildrenElement instanceof Map
                    ? snapshot.groupIdByChildrenElement.get(target)
                    : null;
                const group = groupId ? snapshot.groups.get(groupId) : null;
                if (
                    !group
                    || !group.children
                    || group.children.element !== target
                    || (
                        typeof snapshot.rootElement.contains === 'function'
                        && !snapshot.rootElement.contains(target)
                    )
                ) {
                    return null;
                }
                let currentRect = null;
                try {
                    currentRect = copyRect(target.getBoundingClientRect());
                } catch (_) {
                    return null;
                }
                if (
                    !currentRect
                    || !sameResizeBox(currentRect, group.children.visualRect)
                ) {
                    return null;
                }
                plan.push({
                    kind: 'group-children',
                    groupId,
                    deltaX: -delta.left,
                    deltaY: -delta.top
                });
            }
            return plan;
        }

        function applyScrollGeometryPatch(snapshot, plan) {
            if (!snapshot || !Array.isArray(plan)) return false;
            for (const patch of plan) {
                if (patch.kind === 'root') {
                    translateGeometrySnapshot(
                        snapshot,
                        snapshot.rootRect,
                        patch.deltaX,
                        patch.deltaY
                    );
                    continue;
                }
                for (const source of snapshot.sourceEntries.values()) {
                    const parentGroup = source.parentGroupId
                        ? snapshot.groups.get(source.parentGroupId) || null
                        : null;
                    if (
                        source.parentGroupId === patch.groupId
                        || groupIsDescendantOf(parentGroup, patch.groupId, snapshot.groups)
                    ) {
                        translateGeometryEntry(source, patch.deltaX, patch.deltaY);
                    }
                }
                for (const group of snapshot.groups.values()) {
                    if (!groupIsDescendantOf(group, patch.groupId, snapshot.groups)) continue;
                    translateGeometryEntry(group, patch.deltaX, patch.deltaY);
                    translateGeometryEntry(group.header, patch.deltaX, patch.deltaY);
                    translateGeometryEntry(group.children, patch.deltaX, patch.deltaY);
                }
            }
            return true;
        }

        function getOwnShiftY(element) {
            return extractInlineTranslateY(element);
        }

        function getInheritedShiftY(element, rootElement) {
            let total = 0;
            let cursor = element && element.parentElement;
            const seen = new Set();
            while (cursor && cursor !== rootElement && !seen.has(cursor)) {
                seen.add(cursor);
                total += getOwnShiftY(cursor);
                cursor = cursor.parentElement;
            }
            return total;
        }

        function getAncestorGroupId(element, rootElement) {
            let cursor = element && element.parentElement;
            const seen = new Set();
            while (cursor && cursor !== rootElement && !seen.has(cursor)) {
                seen.add(cursor);
                if (
                    cursor.classList
                    && typeof cursor.classList.contains === 'function'
                    && cursor.classList.contains('group-container')
                ) {
                    return cursor.dataset ? cursor.dataset.groupId || null : null;
                }
                cursor = cursor.parentElement;
            }
            return null;
        }

        function createGeometryEntry({
            type,
            key,
            element,
            visualRect,
            rootElement
        }) {
            const ownShiftY = getOwnShiftY(element);
            const inheritedShiftY = getInheritedShiftY(element, rootElement);
            return {
                identity: type === 'group'
                    ? { type: 'group', id: key }
                    : { type: 'source', key },
                element,
                visualRect,
                isFolded: Boolean(
                    element
                    && element.classList
                    && typeof element.classList.contains === 'function'
                    && element.classList.contains('sp-drag-folded')
                ),
                ownShiftY,
                inheritedShiftY,
                layoutRect: translateRect(visualRect, -(ownShiftY + inheritedShiftY))
            };
        }

        function readDragGeometry({ rootElement, session } = {}) {
            runtime.dragGeometryReadCount = (Number(runtime.dragGeometryReadCount) || 0) + 1;
            const cached = runtime.dragGeometrySnapshot;
            let rootRect = null;
            if (
                runtime.dragGeometryDirty === true
                && runtime.dragGeometryInvalidationKind === 'scroll'
                && pendingDragScrollPatch
                && pendingDragScrollPatch.snapshot === cached
                && pendingDragScrollPatch.rootElement === rootElement
                && pendingDragScrollPatch.session === session
                && pendingDragScrollPatch.domGeneration === dragGeometryDomGeneration
                && cached
                && cached.rootElement === rootElement
                && cached.session === session
                && cached.domGeneration === dragGeometryDomGeneration
            ) {
                try {
                    rootRect = copyRect(rootElement.getBoundingClientRect());
                } catch (_) {
                    rootRect = null;
                }
                const previousRootRect = cached.rootRect;
                const deltaX = previousRootRect && rootRect
                    ? rootRect.left - previousRootRect.left
                    : 0;
                const deltaY = previousRootRect && rootRect
                    ? rootRect.top - previousRootRect.top
                    : 0;
                const isPureViewportTranslation = Boolean(
                    previousRootRect
                    && rootRect
                    && rootRect.width === previousRootRect.width
                    && rootRect.height === previousRootRect.height
                    && rootRect.right - previousRootRect.right === deltaX
                    && rootRect.bottom - previousRootRect.bottom === deltaY
                );
                const scrollPatchPlan = isPureViewportTranslation
                    ? resolveScrollPatchPlan(cached, pendingDragScrollPatch.deltas)
                    : null;
                if (scrollPatchPlan) {
                    translateGeometrySnapshot(
                        cached,
                        rootRect,
                        deltaX,
                        deltaY
                    );
                    if (applyScrollGeometryPatch(cached, scrollPatchPlan)) {
                        pendingDragScrollPatch = null;
                        runtime.dragGeometryDirty = false;
                        runtime.dragGeometryInvalidationKind = null;
                        runtime.dragGeometryLastInvalidation = null;
                        return cached;
                    }
                }
            }
            if (runtime.dragGeometryDirty === true) {
                pendingDragScrollPatch = null;
            }
            if (
                runtime.dragGeometryDirty === false
                && cached
                && cached.rootElement === rootElement
                && cached.session === session
            ) {
                try {
                    rootRect = copyRect(rootElement.getBoundingClientRect());
                } catch (_) {
                    runtime.dragGeometryDirty = true;
                    return null;
                }
                if (!rootRect) {
                    runtime.dragGeometryDirty = true;
                    return null;
                }
                const previousRootRect = cached.rootRect;
                if (
                    previousRootRect
                    && rootRect.top === previousRootRect.top
                    && rootRect.bottom === previousRootRect.bottom
                    && rootRect.left === previousRootRect.left
                    && rootRect.right === previousRootRect.right
                    && rootRect.width === previousRootRect.width
                    && rootRect.height === previousRootRect.height
                ) {
                    cached.rootRect = rootRect;
                    return cached;
                }
                const deltaX = previousRootRect
                    ? rootRect.left - previousRootRect.left
                    : 0;
                const deltaY = previousRootRect
                    ? rootRect.top - previousRootRect.top
                    : 0;
                const isPureViewportTranslation = Boolean(
                    previousRootRect
                    && rootRect.width === previousRootRect.width
                    && rootRect.height === previousRootRect.height
                    && rootRect.right - previousRootRect.right === deltaX
                    && rootRect.bottom - previousRootRect.bottom === deltaY
                );
                if (isPureViewportTranslation) {
                    translateGeometrySnapshot(
                        cached,
                        rootRect,
                        deltaX,
                        deltaY
                    );
                    return cached;
                }
                runtime.dragGeometryDirty = true;
            }
            if (
                !rootElement
                || typeof rootElement.getBoundingClientRect !== 'function'
                || typeof rootElement.querySelectorAll !== 'function'
            ) {
                runtime.dragGeometryDirty = true;
                return null;
            }

            let elements = null;
            const rectByElement = new Map();
            try {
                rootRect = rootRect || copyRect(rootElement.getBoundingClientRect());
                if (!rootRect) throw new Error('invalid root rect');
                elements = Array.from(rootElement.querySelectorAll(DRAG_GEOMETRY_SELECTOR));
                for (const element of elements) {
                    if (!element || rectByElement.has(element)) continue;
                    if (typeof element.getBoundingClientRect !== 'function') {
                        throw new Error('geometry element missing rect reader');
                    }
                    const rect = copyRect(element.getBoundingClientRect());
                    if (!rect) throw new Error('invalid geometry rect');
                    rectByElement.set(element, rect);
                }
            } catch (_) {
                runtime.dragGeometryDirty = true;
                return null;
            }

            const sourceElements = new Map();
            const groupElements = new Map();
            const sourceEntries = new Map();
            const groups = new Map();
            const groupHeaders = [];
            const groupChildren = [];
            let binElement = null;
            let dropzoneElement = null;

            for (const element of elements) {
                if (!element || !element.classList) continue;
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('source-item')
                ) {
                    const key = element.dataset ? element.dataset.sourceKey : null;
                    if (!key || sourceElements.has(key)) continue;
                    sourceElements.set(key, element);
                    const entry = createGeometryEntry({
                        type: 'source',
                        key,
                        element,
                        visualRect: rectByElement.get(element),
                        rootElement
                    });
                    entry.parentGroupId = getAncestorGroupId(element, rootElement);
                    sourceEntries.set(key, entry);
                    continue;
                }
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('group-container')
                ) {
                    const id = element.dataset ? element.dataset.groupId : null;
                    if (!id || groupElements.has(id)) continue;
                    groupElements.set(id, element);
                    const entry = createGeometryEntry({
                        type: 'group',
                        key: id,
                        element,
                        visualRect: rectByElement.get(element),
                        rootElement
                    });
                    entry.parentGroupId = getAncestorGroupId(element, rootElement);
                    entry.header = null;
                    entry.children = null;
                    entry.items = [];
                    groups.set(id, entry);
                    continue;
                }
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('group-header')
                ) {
                    groupHeaders.push(element);
                    continue;
                }
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('group-children')
                ) {
                    groupChildren.push(element);
                    continue;
                }
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('ungrouped-section')
                ) {
                    binElement = element;
                    continue;
                }
                if (
                    typeof element.classList.contains === 'function'
                    && element.classList.contains('sp-ungroup-dropzone')
                ) {
                    dropzoneElement = element;
                }
            }

            const createBandEntry = (element) => {
                if (!element) return null;
                const ownShiftY = getOwnShiftY(element);
                const inheritedShiftY = getInheritedShiftY(element, rootElement);
                const visualRect = rectByElement.get(element);
                return {
                    element,
                    visualRect,
                    ownShiftY,
                    inheritedShiftY,
                    layoutRect: translateRect(visualRect, -(ownShiftY + inheritedShiftY))
                };
            };

            for (const headerElement of groupHeaders) {
                const parent = headerElement.parentElement;
                const id = parent && parent.dataset ? parent.dataset.groupId : null;
                const group = id ? groups.get(id) : null;
                if (group && !group.header) group.header = createBandEntry(headerElement);
            }
            for (const childrenElement of groupChildren) {
                const parent = childrenElement.parentElement;
                const id = parent && parent.dataset ? parent.dataset.groupId : null;
                const group = id ? groups.get(id) : null;
                if (group && !group.children) group.children = createBandEntry(childrenElement);
            }

            const rootItems = [];
            const binItems = [];
            for (const element of elements) {
                const sourceKey = element && element.dataset
                    ? element.dataset.sourceKey
                    : null;
                const groupId = element && element.dataset
                    ? element.dataset.groupId
                    : null;
                const entry = sourceKey
                    ? sourceEntries.get(sourceKey)
                    : (groupId ? groups.get(groupId) : null);
                if (!entry || entry.element !== element) continue;
                if (entry.element.parentElement === rootElement) {
                    rootItems.push(entry);
                } else if (sourceKey && binElement && entry.element.parentElement === binElement) {
                    entry.inBin = true;
                    binItems.push(entry);
                } else if (entry.parentGroupId) {
                    const parentGroup = groups.get(entry.parentGroupId);
                    if (
                        parentGroup
                        && parentGroup.children
                        && entry.element.parentElement === parentGroup.children.element
                    ) {
                        parentGroup.items.push(entry);
                    }
                }
            }

            const snapshot = {
                rootElement,
                session,
                domGeneration: dragGeometryDomGeneration,
                rootRect,
                bin: binElement
                    ? {
                        element: binElement,
                        visualRect: rectByElement.get(binElement),
                        layoutRect: translateRect(
                            rectByElement.get(binElement),
                            -getInheritedShiftY(binElement, rootElement)
                        ),
                        items: binItems
                    }
                    : null,
                groups,
                groupIdByChildrenElement: new Map(
                    Array.from(groups.entries())
                        .filter(([, group]) => group && group.children && group.children.element)
                        .map(([groupId, group]) => [group.children.element, groupId])
                ),
                rootItems,
                sourceElements,
                groupElements,
                sourceEntries,
                dropzoneElement
            };
            try {
                refreshDragGeometryLifecycleTargets(snapshot);
            } catch (_) {
                runtime.dragGeometryDirty = true;
                return null;
            }
            runtime.dragGeometrySnapshot = snapshot;
            runtime.dragGeometryDirty = false;
            runtime.dragGeometryInvalidationKind = null;
            runtime.dragGeometryLastInvalidation = null;
            pendingDragScrollPatch = null;
            return snapshot;
        }

        function invalidateDragGeometry(reason, {
            schedule = true,
            scrollTarget = null,
            scrollDeltaLeft = 0,
            scrollDeltaTop = 0
        } = {}) {
            const normalizedReason = typeof reason === 'string' && reason
                ? reason
                : 'unspecified';
            const wasDirty = runtime.dragGeometryDirty === true;
            if (normalizedReason === 'render_rows_replaced') {
                dragGeometryDomGeneration += 1;
            }
            const canRecordScroll = Boolean(
                (
                    normalizedReason === 'scroll_position_changed'
                    || normalizedReason === 'auto_scroll'
                )
                && scrollTarget
                && Number.isFinite(scrollDeltaLeft)
                && Number.isFinite(scrollDeltaTop)
                && (
                    (scrollDeltaLeft !== 0)
                    || (scrollDeltaTop !== 0)
                )
            );
            const cached = runtime.dragGeometrySnapshot;
            const canStartScrollPatch = Boolean(
                canRecordScroll
                && !wasDirty
                && cached
                && cached.domGeneration === dragGeometryDomGeneration
            );
            const canExtendScrollPatch = Boolean(
                canRecordScroll
                && wasDirty
                && runtime.dragGeometryInvalidationKind === 'scroll'
                && pendingDragScrollPatch
                && pendingDragScrollPatch.snapshot === cached
                && pendingDragScrollPatch.domGeneration === dragGeometryDomGeneration
            );
            if (canStartScrollPatch || canExtendScrollPatch) {
                if (canStartScrollPatch) {
                    pendingDragScrollPatch = {
                        snapshot: cached,
                        rootElement: cached.rootElement,
                        session: cached.session,
                        domGeneration: dragGeometryDomGeneration,
                        deltas: new Map()
                    };
                }
                const priorDelta = pendingDragScrollPatch.deltas.get(scrollTarget)
                    || { left: 0, top: 0 };
                pendingDragScrollPatch.deltas.set(scrollTarget, {
                    left: priorDelta.left + scrollDeltaLeft,
                    top: priorDelta.top + scrollDeltaTop
                });
                runtime.dragGeometryInvalidationKind = 'scroll';
            } else {
                pendingDragScrollPatch = null;
                runtime.dragGeometryInvalidationKind = wasDirty ? 'mixed' : 'non_scroll';
            }
            runtime.dragGeometryDirty = true;
            runtime.dragGeometryLastInvalidation = normalizedReason;
            if (schedule) scheduleDragFrameFromLatestPointer();
        }

        function getEntryMidY(entry) {
            const rect = entry && entry.visualRect;
            return rect ? rect.top + rect.height / 2 : Number.POSITIVE_INFINITY;
        }

        function isFoldedGeometryEntry(entry) {
            return Boolean(entry && entry.isFolded);
        }

        function identityForEntry(entry) {
            return entry && entry.identity ? entry.identity : null;
        }

        function resolveSlotIntent({
            candidates,
            targetList,
            targetGroup,
            targetGroupId,
            hostGroupContainerEl,
            clientY,
            isRootList,
            isUngroupedBin,
            activeDragContext,
            ungrouped
        }) {
            let beforeIndex = -1;
            for (let index = 0; index < candidates.length; index += 1) {
                if (getEntryMidY(candidates[index]) > clientY) {
                    beforeIndex = index;
                    break;
                }
            }
            if (candidates.length === 0) {
                const insertIndex = resolveVisibleAnchorInsertIndex({
                    fullList: targetList,
                    visibleIdentities: [],
                    anchorIdentity: null,
                    edge: 'after',
                    lastVisiblePolicy: FILTERED_LAST_VISIBLE_POLICY
                });
                if (insertIndex === null) return null;
                return {
                    kind: targetGroup ? 'into-group' : 'after-source',
                    targetGroup,
                    targetList,
                    insertIndex,
                    targetGroupId,
                    hostGroupContainerEl,
                    slotKey: null,
                    ...(isRootList ? { isRootList: true } : {}),
                    ...(isUngroupedBin ? { isUngroupedBin: true } : {})
                };
            }
            if (beforeIndex >= 0) {
                const slot = candidates[beforeIndex];
                const identity = identityForEntry(slot);
                const insertIndex = resolveVisibleAnchorInsertIndex({
                    fullList: targetList,
                    visibleIdentities: [identity],
                    anchorIdentity: identity,
                    edge: 'before',
                    lastVisiblePolicy: FILTERED_LAST_VISIBLE_POLICY
                });
                if (insertIndex === null) return null;
                return {
                    kind: identity.type === 'group' ? 'before-group' : 'before-source',
                    targetGroup,
                    targetList,
                    insertIndex,
                    targetGroupId,
                    hostGroupContainerEl,
                    slotKey: identity.type === 'group' ? identity.id : identity.key,
                    ...(isRootList ? { isRootList: true } : {}),
                    ...(isUngroupedBin ? { isUngroupedBin: true } : {})
                };
            }

            if (
                isRootList
                && activeDragContext
                && (activeDragContext.kind === 'source-single' || activeDragContext.kind === 'source-multi')
                && ungrouped.length === 0
            ) {
                return {
                    kind: 'after-source',
                    targetGroup: null,
                    targetList: ungrouped,
                    insertIndex: 0,
                    targetGroupId: null,
                    hostGroupContainerEl: null,
                    slotKey: null,
                    isEmptyBinTrailing: true,
                    isUngroupedBin: true
                };
            }

            const last = candidates[candidates.length - 1];
            const identity = identityForEntry(last);
            const insertIndex = resolveVisibleAnchorInsertIndex({
                fullList: targetList,
                visibleIdentities: [identity],
                anchorIdentity: identity,
                edge: 'after',
                lastVisiblePolicy: FILTERED_LAST_VISIBLE_POLICY
            });
            if (insertIndex === null) return null;
            return {
                kind: identity.type === 'group' ? 'after-group' : 'after-source',
                targetGroup,
                targetList,
                insertIndex,
                targetGroupId,
                hostGroupContainerEl,
                slotKey: identity.type === 'group' ? identity.id : identity.key,
                ...(isRootList ? { isRootList: true } : {}),
                ...(isUngroupedBin ? { isUngroupedBin: true } : {})
            };
        }

        function computeDropIntentRaw({
            clientX,
            clientY,
            state,
            groupsById,
            parentMap,
            activeDragContext,
            prevIntent,
            geometrySnapshot
        }) {
            if (
                typeof clientY !== 'number'
                || !geometrySnapshot
                || !geometrySnapshot.rootRect
            ) {
                return null;
            }
            const rootRect = geometrySnapshot.rootRect;
            if (clientY < rootRect.top || clientY >= rootRect.bottom) return null;
            const stateObj = state || {};
            const root = Array.isArray(stateObj.root) ? stateObj.root : [];
            const ungrouped = Array.isArray(stateObj.ungrouped) ? stateObj.ungrouped : [];

            if (
                ungrouped.length > 0
                && geometrySnapshot.bin
                && geometrySnapshot.bin.visualRect
            ) {
                const binRect = geometrySnapshot.bin.visualRect;
                if (clientY >= binRect.top && clientY < binRect.bottom) {
                    return resolveSlotIntent({
                        candidates: geometrySnapshot.bin.items.filter((entry) => !isFoldedGeometryEntry(entry)),
                        targetList: ungrouped,
                        targetGroup: null,
                        targetGroupId: null,
                        hostGroupContainerEl: null,
                        clientY,
                        isUngroupedBin: true,
                        activeDragContext,
                        ungrouped
                    });
                }
            }

            const HYSTERESIS_PX = 8;
            const stickyGroupId = prevIntent && prevIntent.kind === 'into-group'
                ? prevIntent.targetGroupId
                : null;
            const getDepth = (groupId) => {
                if (!groupId || !(parentMap instanceof Map)) return 0;
                let depth = 0;
                let cursor = groupId;
                const seen = new Set([cursor]);
                while (true) {
                    const parent = parentMap.get(cursor);
                    if (!parent || seen.has(parent)) break;
                    seen.add(parent);
                    cursor = parent;
                    depth += 1;
                }
                return depth;
            };
            const getTopAncestor = (groupId) => {
                if (!groupId || !(parentMap instanceof Map)) return groupId;
                let cursor = groupId;
                const seen = new Set([cursor]);
                while (true) {
                    const parent = parentMap.get(cursor);
                    if (!parent || seen.has(parent)) break;
                    seen.add(parent);
                    cursor = parent;
                }
                return cursor;
            };

            const excludedTopIds = new Set();
            if (typeof clientX === 'number') {
                for (const [groupId, groupGeometry] of geometrySnapshot.groups) {
                    if (groupGeometry.parentGroupId) continue;
                    const group = groupsById instanceof Map ? groupsById.get(groupId) : null;
                    if (!group || !group.collapsed || !groupGeometry.header) continue;
                    if (isFoldedGeometryEntry(groupGeometry)) continue;
                    const rect = groupGeometry.header.layoutRect;
                    if (!rect || clientY < rect.top || clientY >= rect.bottom) continue;
                    if (clientX < rect.left + rect.width / 2) excludedTopIds.add(groupId);
                }
            }

            let chosenGeometry = null;
            let chosenDepth = -1;
            for (const [groupId, groupGeometry] of geometrySnapshot.groups) {
                if (isFoldedGeometryEntry(groupGeometry)) continue;
                if (excludedTopIds.has(getTopAncestor(groupId))) continue;
                const rect = groupGeometry.layoutRect;
                if (!rect) continue;
                const buffer = stickyGroupId === groupId ? HYSTERESIS_PX : 0;
                if (clientY < rect.top - buffer || clientY >= rect.bottom + buffer) continue;
                const depth = getDepth(groupId);
                if (depth > chosenDepth) {
                    chosenGeometry = groupGeometry;
                    chosenDepth = depth;
                }
            }

            let hostGeometry = null;
            let hostGroup = null;
            if (chosenGeometry) {
                const groupId = chosenGeometry.identity.id;
                const group = groupsById instanceof Map ? groupsById.get(groupId) : null;
                if (!group) return null;
                const buffer = stickyGroupId === groupId ? HYSTERESIS_PX : 0;
                const headerRect = chosenGeometry.header && chosenGeometry.header.layoutRect;
                if (
                    headerRect
                    && clientY >= headerRect.top - buffer
                    && clientY < headerRect.bottom + buffer
                ) {
                    return {
                        kind: 'into-group',
                        targetGroup: group,
                        targetList: Array.isArray(group.children) ? group.children : [],
                        insertIndex: 0,
                        targetGroupId: group.id,
                        hostGroupContainerEl: chosenGeometry.element,
                        slotKey: null
                    };
                }

                if (activeDragContext && activeDragContext.kind === 'group') {
                    const parentGroupId = chosenGeometry.parentGroupId;
                    if (parentGroupId) {
                        hostGeometry = geometrySnapshot.groups.get(parentGroupId) || null;
                        hostGroup = groupsById instanceof Map ? groupsById.get(parentGroupId) : null;
                    }
                } else {
                    const childrenRect = chosenGeometry.children && chosenGeometry.children.layoutRect;
                    if (
                        childrenRect
                        && clientY >= childrenRect.top
                        && clientY < childrenRect.bottom
                    ) {
                        const groupChildren = Array.isArray(group.children)
                            ? group.children
                            : [];
                        if (groupChildren.length === 0) {
                            return {
                                kind: 'into-group',
                                targetGroup: group,
                                targetList: groupChildren,
                                insertIndex: 0,
                                targetGroupId: group.id,
                                hostGroupContainerEl: chosenGeometry.element,
                                slotKey: null
                            };
                        }
                        hostGeometry = chosenGeometry;
                        hostGroup = group;
                    } else {
                        return {
                            kind: 'into-group',
                            targetGroup: group,
                            targetList: Array.isArray(group.children) ? group.children : [],
                            insertIndex: 0,
                            targetGroupId: group.id,
                            hostGroupContainerEl: chosenGeometry.element,
                            slotKey: null
                        };
                    }
                }
            }

            if (hostGeometry && hostGroup) {
                return resolveSlotIntent({
                    candidates: hostGeometry.items.filter((entry) => !isFoldedGeometryEntry(entry)),
                    targetList: Array.isArray(hostGroup.children)
                        ? hostGroup.children
                        : [],
                    targetGroup: hostGroup,
                    targetGroupId: hostGroup.id,
                    hostGroupContainerEl: hostGeometry.element,
                    clientY,
                    activeDragContext,
                    ungrouped
                });
            }

            return resolveSlotIntent({
                candidates: geometrySnapshot.rootItems.filter((entry) => !isFoldedGeometryEntry(entry)),
                targetList: root,
                targetGroup: null,
                targetGroupId: null,
                hostGroupContainerEl: null,
                clientY,
                isRootList: true,
                activeDragContext,
                ungrouped
            });
        }

        if (typeof runtime.activeDragContext === 'undefined') {
            runtime.activeDragContext = null;
        }
        if (typeof runtime.dragGeometryDirty !== 'boolean') {
            runtime.dragGeometryDirty = true;
        }
        if (typeof runtime.dragGeometrySnapshot === 'undefined') {
            runtime.dragGeometrySnapshot = null;
        }
        if (!(runtime.hoverExpandedGroupIds instanceof Set)) {
            runtime.hoverExpandedGroupIds = new Set();
        }
        if (!(runtime.hoverExpandTimers instanceof Map)) {
            runtime.hoverExpandTimers = new Map();
        }

        let dragGeometryLifecycleEpoch = 0;
        let dragGeometryLifecycle = null;
        let deferredFoldEpoch = 0;
        let deferredFoldRafId = null;
        const pendingGroupExpandSettles = new WeakMap();


        function cancelDeferredDragFold() {
            deferredFoldEpoch += 1;
            if (
                deferredFoldRafId != null
                && typeof globalThis.cancelAnimationFrame === 'function'
            ) {
                try { globalThis.cancelAnimationFrame(deferredFoldRafId); } catch (_) {}
            }
            deferredFoldRafId = null;
        }

        function applyDragFold(session, rootElement) {
            if (
                !session
                || runtime.dragReflowSession !== session
                || !runtime.activeDragContext
                || !dragReflow
                || typeof dragReflow.foldDraggedItems !== 'function'
            ) {
                return;
            }
            dragReflow.foldDraggedItems({ session, rootElement });
            invalidateDragGeometry('drag_items_folded');
        }

        function scheduleDeferredDragFold(session, rootElement) {
            cancelDeferredDragFold();
            const raf = typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame
                : null;
            if (!raf) {
                applyDragFold(session, rootElement);
                return;
            }
            const epoch = deferredFoldEpoch;
            deferredFoldRafId = raf(() => {
                deferredFoldRafId = null;
                if (epoch !== deferredFoldEpoch) return;
                applyDragFold(session, getSourceListContainer());
            });
        }

        function readScrollPosition(element) {
            return {
                top: Number(element && element.scrollTop) || 0,
                left: Number(element && element.scrollLeft) || 0
            };
        }

        function teardownDragGeometryLifecycle() {
            dragGeometryLifecycleEpoch += 1;
            const lifecycle = dragGeometryLifecycle;
            dragGeometryLifecycle = null;
            if (!lifecycle) return;
            if (
                lifecycle.rootElement
                && typeof lifecycle.rootElement.removeEventListener === 'function'
            ) {
                lifecycle.rootElement.removeEventListener(
                    'scroll',
                    lifecycle.onScroll,
                    true
                );
            }
            if (
                lifecycle.resizeObserver
                && typeof lifecycle.resizeObserver.disconnect === 'function'
            ) {
                lifecycle.resizeObserver.disconnect();
            }
        }

        function installDragGeometryLifecycle(rootElement) {
            teardownDragGeometryLifecycle();
            if (!rootElement) return;
            const epoch = dragGeometryLifecycleEpoch;
            const scrollPositions = new WeakMap();
            const observedElements = new Set();
            const resizeBaselines = new WeakMap();
            scrollPositions.set(rootElement, readScrollPosition(rootElement));

            const isCurrent = () => Boolean(
                dragGeometryLifecycle
                && dragGeometryLifecycle.epoch === epoch
                && dragGeometryLifecycle.rootElement === rootElement
                && runtime.activeDragContext
            );
            const onScroll = (event) => {
                if (!isCurrent()) return;
                const target = event && event.target ? event.target : rootElement;
                if (
                    target !== rootElement
                    && typeof rootElement.contains === 'function'
                    && !rootElement.contains(target)
                ) {
                    return;
                }
                const next = readScrollPosition(target);
                const previous = scrollPositions.get(target);
                scrollPositions.set(target, next);
                if (!previous) {
                    invalidateDragGeometry('scroll_position_changed');
                    return;
                }
                if (previous.top === next.top && previous.left === next.left) {
                    return;
                }
                invalidateDragGeometry('scroll_position_changed', {
                    scrollTarget: target,
                    scrollDeltaLeft: next.left - previous.left,
                    scrollDeltaTop: next.top - previous.top
                });
            };

            const windowObj = getWindow();
            const ResizeObserverCtor = deps.ResizeObserver
                || (windowObj && windowObj.ResizeObserver)
                || globalThis.ResizeObserver;

            dragGeometryLifecycle = {
                epoch,
                rootElement,
                onScroll,
                resizeObserver: null,
                ResizeObserverCtor,
                observedElements,
                scrollPositions,
                resizeBaselines
            };
            if (typeof rootElement.addEventListener === 'function') {
                rootElement.addEventListener('scroll', onScroll, {
                    capture: true,
                    passive: true
                });
            }
        }

        function handleAutoScrollDidScroll({
            container,
            before,
            after
        } = {}) {
            if (
                !runtime.activeDragContext
                || !container
                || !Number.isFinite(before)
                || !Number.isFinite(after)
                || before === after
            ) {
                return;
            }
            const lifecycle = dragGeometryLifecycle;
            const isScopedContainer = Boolean(
                lifecycle
                && lifecycle.rootElement
                && (
                    container === lifecycle.rootElement
                    || (
                        typeof lifecycle.rootElement.contains === 'function'
                        && lifecycle.rootElement.contains(container)
                    )
                )
            );
            if (
                !isScopedContainer
                || !(lifecycle.scrollPositions instanceof WeakMap)
            ) {
                invalidateDragGeometry('auto_scroll');
                return;
            }

            const previous = lifecycle.scrollPositions.get(container);
            const next = readScrollPosition(container);
            if (
                previous
                && previous.top === next.top
                && previous.left === next.left
            ) {
                // A synchronous native scroll event already advanced the
                // lifecycle baseline and invalidated this exact movement.
                return;
            }
            lifecycle.scrollPositions.set(container, next);
            if (
                previous
                && previous.top === before
                && previous.left === next.left
                && next.top === after
            ) {
                invalidateDragGeometry('auto_scroll', {
                    scrollTarget: container,
                    scrollDeltaLeft: 0,
                    scrollDeltaTop: after - before
                });
                return;
            }
            // An unknown/mixed movement cannot be patched safely. Mark dirty
            // through the same seam and let the next frame rebuild geometry.
            invalidateDragGeometry('auto_scroll');
        }

        function readResizeBorderBox(entry) {
            if (!entry || !entry.borderBoxSize) return null;
            const borderBox = Array.isArray(entry.borderBoxSize)
                ? entry.borderBoxSize[0]
                : entry.borderBoxSize;
            const width = Number(borderBox && borderBox.inlineSize);
            const height = Number(borderBox && borderBox.blockSize);
            return Number.isFinite(width) && Number.isFinite(height)
                ? { width, height }
                : null;
        }

        function sameResizeBox(left, right) {
            return Boolean(
                left
                && right
                && Math.abs(left.width - right.width) < 0.5
                && Math.abs(left.height - right.height) < 0.5
            );
        }

        function ensureDragResizeObserver(lifecycle, isCurrent) {
            if (
                lifecycle.resizeObserver
                || typeof lifecycle.ResizeObserverCtor !== 'function'
            ) {
                return lifecycle.resizeObserver;
            }
            lifecycle.resizeObserver = new lifecycle.ResizeObserverCtor((entries) => {
                if (!isCurrent()) return;
                const reports = Array.isArray(entries) ? entries : Array.from(entries || []);
                let geometryChanged = false;
                for (const entry of reports) {
                    if (
                        !entry
                        || !entry.target
                        || !lifecycle.observedElements.has(entry.target)
                    ) {
                        continue;
                    }
                    const reportedSize = readResizeBorderBox(entry);
                    const baseline = lifecycle.resizeBaselines.get(entry.target);
                    if (!reportedSize || !sameResizeBox(reportedSize, baseline)) {
                        geometryChanged = true;
                        if (reportedSize) {
                            lifecycle.resizeBaselines.set(entry.target, reportedSize);
                        }
                    }
                }
                if (geometryChanged) {
                    invalidateDragGeometry('resize_observer_report');
                }
            });
            return lifecycle.resizeObserver;
        }

        function refreshDragGeometryLifecycleElements(
            rootElement,
            targetSizes
        ) {
            const lifecycle = dragGeometryLifecycle;
            if (
                !lifecycle
                || lifecycle.rootElement !== rootElement
                || lifecycle.epoch !== dragGeometryLifecycleEpoch
            ) {
                return;
            }
            const isCurrent = () => Boolean(
                dragGeometryLifecycle === lifecycle
                && lifecycle.epoch === dragGeometryLifecycleEpoch
                && runtime.activeDragContext
            );
            const nextObservedElements = new Set(targetSizes.keys());
            for (const [targetElement, size] of targetSizes) {
                lifecycle.resizeBaselines.set(targetElement, size);
                if (targetElement === rootElement) continue;
                lifecycle.scrollPositions.set(
                    targetElement,
                    readScrollPosition(targetElement)
                );
            }
            const resizeObserver = ensureDragResizeObserver(lifecycle, isCurrent);
            for (const targetElement of nextObservedElements) {
                if (
                    resizeObserver
                    && typeof resizeObserver.observe === 'function'
                    && !lifecycle.observedElements.has(targetElement)
                ) {
                    try {
                        resizeObserver.observe(targetElement);
                        lifecycle.observedElements.add(targetElement);
                    } catch (_) { /* detached child; next render invalidates */ }
                }
            }
            for (const observedElement of lifecycle.observedElements) {
                if (nextObservedElements.has(observedElement)) continue;
                if (
                    resizeObserver
                    && typeof resizeObserver.unobserve === 'function'
                ) {
                    try { resizeObserver.unobserve(observedElement); } catch (_) {}
                }
                lifecycle.observedElements.delete(observedElement);
                lifecycle.resizeBaselines.delete(observedElement);
            }
        }

        function refreshDragGeometryLifecycleTargets(snapshot) {
            if (!snapshot || !(snapshot.groups instanceof Map)) return;
            const targetSizes = new Map();
            if (snapshot.rootElement && snapshot.rootRect) {
                targetSizes.set(snapshot.rootElement, {
                    width: snapshot.rootRect.width,
                    height: snapshot.rootRect.height
                });
            }
            for (const group of snapshot.groups.values()) {
                if (
                    group
                    && group.children
                    && group.children.element
                    && group.children.visualRect
                ) {
                    targetSizes.set(group.children.element, {
                        width: group.children.visualRect.width,
                        height: group.children.visualRect.height
                    });
                }
            }
            refreshDragGeometryLifecycleElements(
                snapshot.rootElement,
                targetSizes
            );
        }

        const autoScrollController = dragMulti && typeof dragMulti.createAutoScrollController === 'function'
            ? dragMulti.createAutoScrollController({
                getContainer: () => {
                    const root = getShadowRoot();
                    return root && typeof root.getElementById === 'function' ? root.getElementById('sources-list') : null;
                },
                onDidScroll: handleAutoScrollDidScroll
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
            throw new Error('GeminiNotebook-Source-Management: createContentTreeInteractions requires NSM_CREATE_CONTENT_NATIVE_CHECKBOX_SYNC to be loaded first.');
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
            if (
                (parentGroupId && !parent)
                || !treePlacement
                || typeof treePlacement.addGroup !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
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

            const target = parentGroupId
                ? {
                    container: 'group',
                    groupId: parentGroupId,
                    index: Array.isArray(parent.children) ? parent.children.length : 0
                }
                : {
                    container: 'root',
                    index: Array.isArray(state.root) ? state.root.length : 0
                };
            const result = treePlacement.addGroup({
                group: newGroup,
                target
            });
            if (!result?.ok || !result.changed) return false;

            rebuildPlacementParentMap();
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

            // v5: walk the unified root array (root folders + positioned root sources
            // interleaved), mirroring render()'s root walk, then the bottom bin.
            (Array.isArray(state.root) ? state.root : []).forEach((entry) => {
                if (!entry) return;
                if (entry.type === 'group' && entry.id) {
                    visitGroup(entry.id);
                } else if (entry.type === 'source' && entry.key) {
                    orderedKeys.push(entry.key);
                }
            });
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
            const parentMap = getParentMap();
            if (
                !(parentMap instanceof Map)
                || !treePlacement
                || typeof treePlacement.locateItem !== 'function'
                || typeof treePlacement.applyBatchPlacement !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            const items = [];
            try {
                collectSourceKeysInTreeOrder().forEach((sourceKey) => {
                    const source = sourcesByKey.get(sourceKey);
                    if (!selectedKeys.has(sourceKey) || !isBatchOperableSource(source)) return;
                    const location = treePlacement.locateItem({
                        kind: 'source',
                        key: sourceKey
                    });
                    if (location && location.container !== 'ungrouped') {
                        items.push({ kind: 'source', key: sourceKey });
                    }
                });
            } catch (error) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            if (items.length === 0) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            let result;
            try {
                result = treePlacement.applyBatchPlacement({
                    items,
                    target: {
                        container: 'ungrouped',
                        index: Array.isArray(state.ungrouped) ? state.ungrouped.length : 0
                    }
                });
            } catch (error) {
                result = null;
            }
            const movedKeys = Array.isArray(result?.moved)
                ? result.moved
                    .filter((item) => item?.kind === 'source' && item.key)
                    .map((item) => item.key)
                : [];
            if (!result?.ok || !result.changed || movedKeys.length === 0) {
                showToast(getMessage('ui_batch_no_sources_changed'), { variant: 'info' });
                return false;
            }

            treePlacement.rebuildParentMap(parentMap);
            finishSuccessfulBatchOperation('ui_batch_ungrouped_toast', movedKeys.length);
            return true;
        }

        function finishKeyboardTreeMove(messageKey) {
            closeSourceActionMenu();
            rebuildPlacementParentMap();
            render();
            saveState({ immediate: true, critical: true });
            showUndoableToast(getMessage(messageKey), { variant: 'success' });
        }

        function getDirectionalContainerLength(location) {
            if (!location) return 0;
            if (location.container === 'root') {
                return Array.isArray(getState()?.root) ? getState().root.length : 0;
            }
            if (location.container === 'ungrouped') {
                return Array.isArray(getState()?.ungrouped) ? getState().ungrouped.length : 0;
            }
            if (location.container === 'group' && location.groupId) {
                const group = getGroupsById().get(location.groupId);
                return Array.isArray(group?.children) ? group.children.length : 0;
            }
            return 0;
        }

        function isDirectionalFocusCandidate(control) {
            if (!control || typeof control.focus !== 'function' || control.disabled) return false;
            const ariaDisabled = control.getAttribute?.('aria-disabled')
                ?? control.attrs?.['aria-disabled']
                ?? null;
            if (ariaDisabled === 'true') return false;
            if (control.closest?.('.group-children.collapsed')) return false;
            if (
                typeof control.getClientRects === 'function'
                && control.getClientRects().length === 0
            ) {
                return false;
            }
            return true;
        }

        function focusDirectionalCandidate(control) {
            if (!isDirectionalFocusCandidate(control)) return null;
            control.focus();
            return control;
        }

        function restoreDirectionalTreeOrderFocus(item, direction, result = {}) {
            const root = getShadowRoot();
            if (!root || typeof root.querySelectorAll !== 'function') return null;
            const controls = item?.kind === 'source'
                ? Array.from(root.querySelectorAll('.sp-source-actions-button'))
                : Array.from(root.querySelectorAll('.sp-tree-order-button'));
            const exactControl = controls.find((candidate) => {
                if (item?.kind === 'source') {
                    return candidate?.dataset?.sourceKey === item.key;
                }
                return (
                    candidate?.dataset?.groupId === item?.id
                    && candidate?.dataset?.treeDirection === direction
                );
            }) || null;
            const focusedExactControl = focusDirectionalCandidate(exactControl);
            if (focusedExactControl) return focusedExactControl;

            if (item?.kind === 'group') {
                const alternateControl = controls.find((candidate) => (
                    candidate?.dataset?.groupId === item.id
                    && isDirectionalFocusCandidate(candidate)
                )) || null;
                const focusedAlternateControl = focusDirectionalCandidate(alternateControl);
                if (focusedAlternateControl) return focusedAlternateControl;
            }

            const fallbackGroupIds = [
                item?.kind === 'group' ? item.id : null,
                result?.to?.groupId || null,
                result?.from?.groupId || null
            ].filter((groupId, index, allIds) => (
                groupId && allIds.indexOf(groupId) === index
            ));
            const groupContainers = Array.from(root.querySelectorAll('.group-container'));
            for (const groupId of fallbackGroupIds) {
                const groupContainer = groupContainers.find((candidate) => (
                    candidate?.dataset?.groupId === groupId
                ));
                const caret = groupContainer?.querySelector?.('.sp-caret') || null;
                const focusedCaret = focusDirectionalCandidate(caret);
                if (focusedCaret) return focusedCaret;
            }

            const shellFallback = typeof root.getElementById === 'function'
                ? root.getElementById('sp-new-group-btn')
                : null;
            return focusDirectionalCandidate(shellFallback);
        }

        function announceDirectionalTreeOrder(direction, location) {
            const messageKey = TREE_ORDER_STATUS_KEYS[direction];
            const total = getDirectionalContainerLength(location);
            const position = Number.isInteger(location?.index) ? location.index + 1 : 0;
            if (!messageKey || position <= 0 || total <= 0 || position > total) return false;
            const root = getShadowRoot();
            const status = root && typeof root.getElementById === 'function'
                ? root.getElementById('sp-tree-order-status')
                : null;
            if (!status) return false;
            status.textContent = getMessage(messageKey, [String(position), String(total)]);
            return true;
        }

        function executeDirectionalTreeMove(item, direction) {
            if (
                !treePlacement
                || typeof treePlacement.resolveDirectionalTarget !== 'function'
                || typeof treePlacement.applyPlacement !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
                return false;
            }

            const resolution = treePlacement.resolveDirectionalTarget(item, direction);
            if (!resolution?.ok || !resolution.target) return false;

            const result = treePlacement.applyPlacement({
                item,
                target: resolution.target
            });
            if (!result?.ok || !result.changed || !result.to) return false;

            closeSourceActionMenu();
            rebuildPlacementParentMap();
            render();
            saveState({ immediate: true, critical: true });
            restoreDirectionalTreeOrderFocus(item, direction, result);
            announceDirectionalTreeOrder(direction, result.to);
            return true;
        }

        function canMoveSourceToUngrouped(sourceKey) {
            const source = getSourcesByKey().get(sourceKey);
            return Boolean(isBatchOperableSource(source) && findParentGroupOfSource(sourceKey));
        }

        function moveSourceToUngrouped(sourceKey) {
            const state = getState();
            if (
                !canMoveSourceToUngrouped(sourceKey)
                || !treePlacement
                || typeof treePlacement.applyPlacement !== 'function'
                || typeof treePlacement.rebuildParentMap !== 'function'
            ) {
                showToast(getMessage('ui_keyboard_move_unavailable'), { variant: 'info' });
                return false;
            }

            const result = treePlacement.applyPlacement({
                item: { kind: 'source', key: sourceKey },
                target: {
                    container: 'ungrouped',
                    index: Array.isArray(state.ungrouped) ? state.ungrouped.length : 0
                }
            });
            if (!result?.ok || !result.changed) return false;

            finishKeyboardTreeMove('ui_keyboard_moved_ungrouped_toast');
            return true;
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
            const pendingSettle = pendingGroupExpandSettles.get(childrenContainer);
            if (pendingSettle) {
                childrenContainer.removeEventListener('transitionend', pendingSettle);
                pendingGroupExpandSettles.delete(childrenContainer);
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

                const settleExpandedChildren = (event) => {
                    if (event?.target && event.target !== childrenContainer) return;
                    if (event?.propertyName && event.propertyName !== 'height') return;
                    childrenContainer.removeEventListener(
                        'transitionend',
                        settleExpandedChildren
                    );
                    pendingGroupExpandSettles.delete(childrenContainer);
                    if (group.collapsed) return;
                    childrenContainer.style.height = 'auto';
                    childrenContainer.style.overflow = 'visible';
                };
                pendingGroupExpandSettles.set(
                    childrenContainer,
                    settleExpandedChildren
                );
                childrenContainer.addEventListener(
                    'transitionend',
                    settleExpandedChildren
                );
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
            const directionalControl = target.closest('[data-tree-direction]');
            const isolationGroupId = getActiveIsolationGroupId();

            if (directionalControl) {
                const direction = directionalControl.dataset?.treeDirection;
                const item = directionalControl.dataset?.sourceKey
                    ? { kind: 'source', key: directionalControl.dataset.sourceKey }
                    : { kind: 'group', id: directionalControl.dataset?.groupId };
                executeDirectionalTreeMove(item, direction);
                return;
            }

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
                    console.error('GeminiNotebook-Source-Management: Failed to prepare native label import preview.', error);
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

            if (target.closest('.group-header') && !target.closest('.sp-caret, .sp-toggle-switch, .sp-tree-order-controls, .sp-tree-order-button, .sp-add-subgroup-button, .sp-isolate-button, .sp-edit-button, .sp-delete-button, input')) {
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
                if (
                    !group
                    || !treePlacement
                    || typeof treePlacement.removeGroup !== 'function'
                    || typeof treePlacement.rebuildParentMap !== 'function'
                ) {
                    return;
                }
                const groupChildren = Array.isArray(group.children) ? group.children : [];

                if (groupChildren.length > 0) {
                    const windowObj = getWindow();
                    const deleteContents = windowObj?.confirm?.(
                        getMessage('ui_delete_group_confirm_non_empty', [group.title, getMessage('ui_ungrouped')])
                    );
                    if (!deleteContents) return;
                }

                const result = treePlacement.removeGroup({
                    item: { kind: 'group', id: groupId }
                });
                if (!result?.ok || !result.changed) return;

                if (getActiveIsolationGroupId() === groupId) {
                    setActiveIsolationGroupId(null);
                }
                rebuildPlacementParentMap();
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
            cancelDeferredDragFold();
            teardownDragGeometryLifecycle();
            _cancelPendingDragOver();
            runtime.dragGeometrySnapshot = null;
            invalidateDragGeometry('drag_start_preflight', { schedule: false });
            const sourceTarget = e.target.closest('.source-item');
            const groupTarget = e.target.closest('.group-header');
            const setTimeoutFn = getSetTimeout();

            cancelAllHoverTimers();
            restoreTransientHoverExpandedGroups();

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
            //     transform: translateY(N) on siblings to "open the slot".
            //     .sp-drop-shift-static is the same geometry for offscreen rows,
            //     without their transform transition. Either lingering class =
            //     visible visual offset until the page reloads.
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
                // One tree walk recovers every descendant drag marker. Five
                // separate selector sweeps scaled dragstart with the full
                // manager size even though the common path returns no nodes.
                const stale = _preflightList.querySelectorAll([
                    '.sp-drop-flying',
                    '.sp-drop-landing',
                    '.sp-drag-unfolding',
                    '.sp-pseudo-hover',
                    '.sp-hover-expand-pending',
                    '.sp-drag-cancelled',
                    '.sp-drag-folded',
                    '.sp-drop-shift',
                    '.sp-drop-shift-static',
                    '.drag-into',
                    '.drag-invalid',
                    '.dragging',
                    '.sp-drag-guide'
                ].join(', '));
                if (stale && typeof stale.forEach === 'function') {
                    stale.forEach((node) => {
                        if (!node || !node.classList || typeof node.classList.remove !== 'function') return;
                        const hadFolded = typeof node.classList.contains === 'function'
                            && node.classList.contains('sp-drag-folded');
                        const hadShift = typeof node.classList.contains === 'function'
                            && (
                                node.classList.contains('sp-drop-shift')
                                || node.classList.contains('sp-drop-shift-static')
                            );
                        const hadGuide = typeof node.classList.contains === 'function'
                            && node.classList.contains('sp-drag-guide');
                        node.classList.remove('sp-drop-flying');
                        node.classList.remove('sp-drop-landing');
                        node.classList.remove('sp-drag-unfolding');
                        node.classList.remove('sp-pseudo-hover');
                        // Hover-expand build-up cue + cancel-shake cue: linger when a
                        // prior drag was interrupted (tab-switch / blur) before their
                        // own timers / setTimeout removed them — clear so the new drag
                        // doesn't show a stale outline or replay a shake.
                        node.classList.remove('sp-hover-expand-pending');
                        node.classList.remove('sp-drag-cancelled');
                        node.classList.remove('sp-drag-folded');
                        node.classList.remove('sp-drop-shift');
                        node.classList.remove('sp-drop-shift-static');
                        node.classList.remove('drag-into');
                        node.classList.remove('drag-invalid');
                        node.classList.remove('dragging');
                        node.classList.remove('sp-drag-guide');
                        if (hadFolded && node.style) {
                            node.style.height = '';
                            node.style.opacity = '';
                        }
                        if (hadShift && node.style) {
                            node.style.transform = '';
                        }
                        if (
                            hadGuide
                            && node.style
                            && typeof node.style.removeProperty === 'function'
                        ) {
                            node.style.removeProperty('--sp-slot-comp');
                        }
                    });
                }

                // Keep a lingering host-level .sp-drag-active for this valid
                // replacement drag. Removing it here and adding it again below
                // forces every row under its descendant selectors to restyle.
                // Guarded/cancelled starts clear it before returning.
            }

            const _clearPreflightDragActive = () => {
                if (
                    _preflightList
                    && _preflightList.classList
                    && typeof _preflightList.classList.remove === 'function'
                ) {
                    _preflightList.classList.remove('sp-drag-active');
                }
            };

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
                    _clearPreflightDragActive();
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    return;
                }
            }

            if (sourceTarget) {
                const key = sourceTarget.dataset.sourceKey;
                if (!key) {
                    _clearPreflightDragActive();
                    return;
                }

                if (typeof e.target.closest === 'function'
                    && e.target.closest('input[type="checkbox"], .sp-batch-checkbox')) {
                    _clearPreflightDragActive();
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

                // Prepare reflow before building the drag ghost. The footprint probe
                // owns three batched layout-read phases; running the ghost's pointer
                // offset read first would create a fourth forced-layout phase in the
                // same synchronous dragstart. The probe restores the row completely
                // before returning, so cloning/capturing the native drag image remains
                // safe. Classic mode keeps its existing no-probe path.
                let preparedReflowSession = null;
                const preparedReflowRoot = getSourceListContainer();
                installDragGeometryLifecycle(preparedReflowRoot);
                if (getDragMode() !== 'classic' && dragReflow && typeof dragReflow.prepareDragSession === 'function') {
                    preparedReflowSession = dragReflow.prepareDragSession({
                        draggedKeys: keys,
                        originKey: key,
                        draggedType: 'source',
                        rootElement: preparedReflowRoot
                    });
                    runtime.dragReflowSession = preparedReflowSession;
                }

                try {
                    if (dragMulti && typeof dragMulti.createMultiDragGhost === 'function') {
                        const doc = getDocument();
                        const root = doc && doc.body ? doc.body : null;
                        const sourcesListEl = getSourceListContainer();
                        const sourceClones = keys.slice(0, 3).map((rowKey) => {
                            const preparedElement = preparedReflowSession
                                && preparedReflowSession.preparedElements instanceof Map
                                ? preparedReflowSession.preparedElements.get(rowKey) || null
                                : null;
                            if (
                                !preparedElement
                                && (!sourcesListEl || typeof sourcesListEl.querySelector !== 'function')
                            ) {
                                return null;
                            }
                            const original = preparedElement
                                || sourcesListEl.querySelector(`[data-source-key="${cssEscape(rowKey)}"]`);
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
                            if (sourcesListEl) {
                                const originEl = (
                                    preparedReflowSession
                                    && preparedReflowSession.preparedElements instanceof Map
                                        ? preparedReflowSession.preparedElements.get(key) || null
                                        : null
                                ) || (
                                    typeof sourcesListEl.querySelector === 'function'
                                        ? sourcesListEl.querySelector(`[data-source-key="${cssEscape(key)}"]`)
                                        : null
                                );
                                const cachedRect = preparedReflowSession?.itemMetrics?.get(key)?.visualRect;
                                const rect = cachedRect && Number(cachedRect.width) > 0
                                    ? cachedRect
                                    : (
                                        !preparedReflowSession
                                        && originEl
                                        && typeof originEl.getBoundingClientRect === 'function'
                                            ? originEl.getBoundingClientRect()
                                            : null
                                    );
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
                } finally {
                    if (preparedReflowSession?.preparedElements instanceof Map) {
                        preparedReflowSession.preparedElements.clear();
                    }
                    if (preparedReflowSession) {
                        preparedReflowSession.preparedElements = null;
                    }
                }

                // Classic mode has no avoidance reflow — skip session + fold so the dragged
                // row stays in place and feedback is the blue insertion line (26.5.26).
                if (preparedReflowSession) {
                    // Fold MUST be deferred to next frame via RAF (NOT sync) — running fold
                    // inside the dragstart handler turns the drag source into a 0×0 box
                    // (.sp-drag-folded has pointer-events: none + padding/margin/border 0,
                    // plus we set inline height:0 opacity:0) before Chrome finalizes drag
                    // initiation, and Chrome silently cancels the drag operation when the
                    // source rect is zero. RAF defers fold until after Chrome has captured
                    // the ghost + seeded the drag, at which point the source is safe to hide.
                    // Accepted trade-off: one-frame visual overlap of ghost over origin row.
                    scheduleDeferredDragFold(
                        preparedReflowSession,
                        preparedReflowRoot
                    );
                }
                // Mark the list actively dragging so CSS suppresses Chrome's frozen
                // native :hover on the origin folder's guide bar — the blue bar should
                // follow .drag-into (the target folder), not stay stuck on the source.
                const _activeListSrc = getSourceListContainer();
                if (_activeListSrc && _activeListSrc.classList && typeof _activeListSrc.classList.add === 'function') {
                    _activeListSrc.classList.add('sp-drag-active');
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
                    // See source branch: mark active so the guide bar follows .drag-into.
                    const _activeListGrp = getSourceListContainer();
                    installDragGeometryLifecycle(_activeListGrp);
                    if (_activeListGrp && _activeListGrp.classList && typeof _activeListGrp.classList.add === 'function') {
                        _activeListGrp.classList.add('sp-drag-active');
                    }
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
                    if (getDragMode() !== 'classic' && dragReflow && typeof dragReflow.prepareDragSession === 'function') {
                        const rootElement = getSourceListContainer();
                        const session = dragReflow.prepareDragSession({
                            draggedKeys: [key],
                            originKey: key,
                            draggedType: 'group',
                            rootElement
                        });
                        runtime.dragReflowSession = session;
                        // RAF-deferred fold (same reason as source branch — sync fold would
                        // turn the drag source into a 0×0 box during dragstart, which Chrome
                        // can cancel as "invalid drag source").
                        scheduleDeferredDragFold(session, rootElement);
                    }
                } else {
                    _clearPreflightDragActive();
                }
                return;
            }
            _clearPreflightDragActive();
        }

        function computeIsInvalidDrop({
            intent,
            dragContext,
            groupsById = getGroupsById()
        }) {
            if (!intent || typeof intent !== 'object' || !dragContext) return false;

            if (dragContext.kind === 'source-single') {
                const draggedKey = Array.isArray(dragContext.keys) ? dragContext.keys[0] : null;
                if (!draggedKey) return false;
                if (intent.kind === 'before-source' || intent.kind === 'after-source') {
                    return intent.slotKey === draggedKey;
                }
                // v5: a source positioned before/after a root group is a valid state.root
                // insert (handleDrop splices { type:'source', key } into state.root). Not invalid.
                return false;
            }

            if (dragContext.kind === 'source-multi') {
                const keys = Array.isArray(dragContext.keys) ? dragContext.keys : [];
                if (keys.length === 0) return false;
                const draggedSet = new Set(keys);

                if (intent.kind === 'before-source' || intent.kind === 'after-source') {
                    return draggedSet.has(intent.slotKey);
                }
                // v5: a positioned root drop before/after a root group is valid for multi-source
                // too — Tree Placement emits canonical object entries into state.root.
                return false;
            }

            if (dragContext.kind === 'group') {
                const draggedGroupId = dragContext.draggedGroupId;
                if (!draggedGroupId) return false;
                const targetGroup = intent.targetGroup;
                if (!targetGroup) {
                    // v5: a root-host before/after-source slot targets state.root (isRootList) —
                    // a folder dropped adjacent to a positioned root source is a valid
                    // { type:'group' } insert into state.root (handleDrop supports it), so allow it.
                    // Only the bottom ungrouped bin rejects a group (folders never enter the bin).
                    if (intent.isRootList) return false;
                    if (intent.kind === 'before-source' || intent.kind === 'after-source') return true;
                    return false;
                }
                if (targetGroup.id === draggedGroupId) return true;
                const draggedGroup = groupsById.get(draggedGroupId);
                if (!draggedGroup) return false;
                return isDescendant(targetGroup, draggedGroup, groupsById);
            }

            return false;
        }

        function resolveVisibleSiblingEntries(intent, geometrySnapshot) {
            if (!intent || !geometrySnapshot) return [];
            if (intent.isUngroupedBin) {
                return geometrySnapshot.bin && Array.isArray(geometrySnapshot.bin.items)
                    ? geometrySnapshot.bin.items
                    : [];
            }
            if (intent.targetGroupId) {
                const group = geometrySnapshot.groups.get(intent.targetGroupId);
                return group && Array.isArray(group.items) ? group.items : [];
            }
            return Array.isArray(geometrySnapshot.rootItems)
                ? geometrySnapshot.rootItems
                : [];
        }

        function isDraggedIdentity(identity, dragContext, draggedSourceKeys = null) {
            if (!identity || !dragContext) return false;
            if (identity.type === 'group') {
                return dragContext.kind === 'group'
                    && dragContext.draggedGroupId === identity.id;
            }
            return (
                (dragContext.kind === 'source-single' || dragContext.kind === 'source-multi')
                && (
                    draggedSourceKeys instanceof Set
                        ? draggedSourceKeys.has(identity.key)
                        : (
                            Array.isArray(dragContext.keys)
                            && dragContext.keys.includes(identity.key)
                        )
                )
            );
        }

        function addTypedShift(
            shifts,
            identity,
            delta,
            dragContext,
            draggedSourceKeys = null,
            currentShifts = null,
            plannedShiftDeltas = null,
            animate = false,
            animatedShiftKeys = null
        ) {
            if (!identity || !Number.isFinite(delta) || delta <= 0) return;
            if (isDraggedIdentity(identity, dragContext, draggedSourceKeys)) return;
            if (identity.type === 'group') {
                if (!shifts.groups.has(identity.id)) {
                    shifts.groups.set(identity.id, delta);
                    if (
                        currentShifts
                        && currentShifts.groups instanceof Map
                        && plannedShiftDeltas
                        && plannedShiftDeltas.groups instanceof Map
                    ) {
                        const change = delta - (Number(currentShifts.groups.get(identity.id)) || 0);
                        if (change !== 0) plannedShiftDeltas.groups.set(identity.id, change);
                    }
                }
                if (animate && animatedShiftKeys && animatedShiftKeys.groups instanceof Set) {
                    animatedShiftKeys.groups.add(identity.id);
                }
                return;
            }
            if (!shifts.sources.has(identity.key)) {
                shifts.sources.set(identity.key, delta);
                if (
                    currentShifts
                    && currentShifts.sources instanceof Map
                    && plannedShiftDeltas
                    && plannedShiftDeltas.sources instanceof Map
                ) {
                    const change = delta - (Number(currentShifts.sources.get(identity.key)) || 0);
                    if (change !== 0) plannedShiftDeltas.sources.set(identity.key, change);
                }
            }
            if (animate && animatedShiftKeys && animatedShiftKeys.sources instanceof Set) {
                animatedShiftKeys.sources.add(identity.key);
            }
        }

        function shouldAnimateReflowEntry(entry, geometrySnapshot, slotHeight) {
            const rect = entry && entry.visualRect;
            const rootRect = geometrySnapshot && geometrySnapshot.rootRect;
            if (!rect || !rootRect) return false;
            const rowRect = entry.identity && entry.identity.type === 'group'
                ? entry.header && entry.header.visualRect
                : rect;
            const rowHeight = Math.max(0, Number(rowRect && rowRect.height) || 0);
            const overscan = Math.min(
                Math.max(0, Number(slotHeight) || 0),
                rowHeight
            );
            return (
                rect.bottom >= rootRect.top - overscan
                && rect.top <= rootRect.bottom + overscan
            );
        }

        function planReflowShifts({
            intent,
            pointer,
            geometrySnapshot,
            dragContext,
            session
        }) {
            const shifts = {
                sources: new Map(),
                groups: new Map()
            };
            if (!session || getDragMode() === 'classic') return shifts;
            const currentShifts = {
                sources: session.shiftedSourceItems instanceof Map
                    ? session.shiftedSourceItems
                    : new Map(),
                groups: session.shiftedGroupItems instanceof Map
                    ? session.shiftedGroupItems
                    : new Map()
            };
            const plannedShiftDeltas = {
                sources: new Map(),
                groups: new Map()
            };
            const animatedShiftKeys = {
                sources: new Set(),
                groups: new Set()
            };
            Object.defineProperty(shifts, '_shiftDeltaPlan', {
                configurable: true,
                value: {
                    deltas: plannedShiftDeltas,
                    bases: currentShifts,
                    baseSizes: {
                        sources: currentShifts.sources.size,
                        groups: currentShifts.groups.size
                    },
                    animatedKeys: animatedShiftKeys
                }
            });
            const recordRemovedShifts = () => {
                for (const [sourceKey, delta] of currentShifts.sources) {
                    if (!shifts.sources.has(sourceKey)) {
                        plannedShiftDeltas.sources.set(sourceKey, -(Number(delta) || 0));
                    }
                }
                for (const [groupId, delta] of currentShifts.groups) {
                    if (!shifts.groups.has(groupId)) {
                        plannedShiftDeltas.groups.set(groupId, -(Number(delta) || 0));
                    }
                }
            };
            const slotHeight = Number(session.totalDraggedHeight) || 0;
            if (!intent || slotHeight <= 0) {
                recordRemovedShifts();
                return shifts;
            }
            const draggedSourceKeys = session.draggedKeys instanceof Set
                ? session.draggedKeys
                : null;

            const visibleSiblingEntries = resolveVisibleSiblingEntries(
                intent,
                geometrySnapshot
            );
            const slotType = (
                intent.kind === 'before-group'
                || intent.kind === 'after-group'
            )
                ? 'group'
                : 'source';
            const startsAfterSlot = (
                intent.kind === 'after-group'
                || intent.kind === 'after-source'
            );
            let shiftStarted = !intent.slotKey && intent.kind === 'into-group';
            for (const entry of visibleSiblingEntries) {
                if (isFoldedGeometryEntry(entry)) continue;
                const identity = identityForEntry(entry);
                if (!identity) continue;
                const matchesSlot = Boolean(
                    intent.slotKey
                    && identity.type === slotType
                    && (
                        slotType === 'group'
                            ? identity.id === intent.slotKey
                            : identity.key === intent.slotKey
                    )
                );
                if (matchesSlot) {
                    shiftStarted = true;
                    if (startsAfterSlot) continue;
                }
                if (shiftStarted) {
                    addTypedShift(
                        shifts,
                        identity,
                        slotHeight,
                        dragContext,
                        draggedSourceKeys,
                        currentShifts,
                        plannedShiftDeltas,
                        shouldAnimateReflowEntry(entry, geometrySnapshot, slotHeight),
                        animatedShiftKeys
                    );
                }
            }

            if (intent.targetGroupId) {
                let cursor = geometrySnapshot.groups.get(intent.targetGroupId) || null;
                const seen = new Set();
                while (cursor && !seen.has(cursor.identity.id)) {
                    seen.add(cursor.identity.id);
                    const parent = cursor.parentGroupId
                        ? geometrySnapshot.groups.get(cursor.parentGroupId) || null
                        : null;
                    const siblings = parent ? parent.items : geometrySnapshot.rootItems;
                    const cursorIndex = siblings.indexOf(cursor);
                    if (cursorIndex >= 0) {
                        for (let index = cursorIndex + 1; index < siblings.length; index += 1) {
                            addTypedShift(
                                shifts,
                                identityForEntry(siblings[index]),
                                slotHeight,
                                dragContext,
                                draggedSourceKeys,
                                currentShifts,
                                plannedShiftDeltas,
                                shouldAnimateReflowEntry(
                                    siblings[index],
                                    geometrySnapshot,
                                    slotHeight
                                ),
                                animatedShiftKeys
                            );
                        }
                    }
                    cursor = parent;
                }
            }
            recordRemovedShifts();
            return shifts;
        }

        function resolvePointerOverCollapsedGroupId({
            clientY,
            groupsById,
            geometrySnapshot
        }) {
            if (
                typeof clientY !== 'number'
                || !(groupsById instanceof Map)
                || !geometrySnapshot
                || !(geometrySnapshot.groups instanceof Map)
            ) {
                return null;
            }
            for (const [groupId, geometry] of geometrySnapshot.groups) {
                const group = groupsById.get(groupId);
                if (!group || !group.collapsed) continue;
                if (!Array.isArray(group.children) || group.children.length === 0) continue;
                if (isFoldedGeometryEntry(geometry)) continue;
                const rect = geometry.header && geometry.header.visualRect;
                if (!rect || clientY < rect.top || clientY >= rect.bottom) continue;
                return groupId;
            }
            return null;
        }

        function resolveFeedbackElement(intent, geometrySnapshot) {
            if (!intent || !intent.slotKey || !geometrySnapshot) return null;
            if (intent.kind === 'before-group' || intent.kind === 'after-group') {
                return geometrySnapshot.groupElements.get(intent.slotKey) || null;
            }
            return geometrySnapshot.sourceElements.get(intent.slotKey) || null;
        }

        function planDragFrame({
            pointer,
            geometrySnapshot,
            state,
            groupsById,
            parentMap,
            dragContext,
            previousIntent
        }) {
            const intent = computeDropIntent({
                clientX: pointer && pointer.clientX,
                clientY: pointer && pointer.clientY,
                rootElement: geometrySnapshot && geometrySnapshot.rootElement,
                state,
                groupsById,
                parentMap,
                activeDragContext: dragContext,
                prevIntent: previousIntent,
                geometrySnapshot
            });
            const isInvalid = computeIsInvalidDrop({ intent, dragContext });
            const feedback = {
                intoElement: null,
                invalidElement: null,
                lineElement: null,
                lineClass: null,
                guideElement: null,
                guideHeight: 0,
                showUngroupDropzone: Boolean(intent && intent.isEmptyBinTrailing),
                pointerGroupId: null,
                pointerGroupElement: null,
                pointerAncestorSet: new Set(),
                autoScrollVelocity: 0
            };
            if (intent) {
                if (intent.kind === 'into-group') {
                    feedback.intoElement = intent.hostGroupContainerEl || null;
                }
                const slotElement = resolveFeedbackElement(intent, geometrySnapshot);
                if (isInvalid) {
                    feedback.invalidElement = intent.kind === 'into-group'
                        ? intent.hostGroupContainerEl || null
                        : slotElement;
                } else if (
                    getDragMode() === 'classic'
                    && intent.kind !== 'into-group'
                    && slotElement
                ) {
                    feedback.lineElement = slotElement;
                    feedback.lineClass = (
                        intent.kind === 'before-source' || intent.kind === 'before-group'
                    )
                        ? 'drag-over-top'
                        : 'drag-over-bottom';
                }
                if (
                    getDragMode() !== 'classic'
                    && !isInvalid
                    && intent.targetGroupId
                ) {
                    const groupGeometry = geometrySnapshot.groups.get(intent.targetGroupId);
                    feedback.guideElement = groupGeometry && groupGeometry.children
                        ? groupGeometry.children.element
                        : null;
                    feedback.guideHeight = runtime.dragReflowSession
                        ? Number(runtime.dragReflowSession.totalDraggedHeight) || 0
                        : 0;
                }

                const isSourceDrag = dragContext
                    && (dragContext.kind === 'source-single' || dragContext.kind === 'source-multi');
                const collapsedGroupId = isSourceDrag
                    ? resolvePointerOverCollapsedGroupId({
                        clientY: pointer && pointer.clientY,
                        groupsById,
                        geometrySnapshot
                    })
                    : null;
                feedback.pointerGroupId = intent.targetGroupId || collapsedGroupId;
                if (feedback.pointerGroupId) {
                    const pointerGeometry = geometrySnapshot.groups.get(feedback.pointerGroupId);
                    feedback.pointerGroupElement = pointerGeometry ? pointerGeometry.element : null;
                    feedback.pointerAncestorSet = new Set(
                        getGroupAncestorChain(feedback.pointerGroupId)
                    );
                }
            }

            if (
                geometrySnapshot
                && geometrySnapshot.rootRect
                && dragMulti
                && typeof dragMulti.computeAutoScrollVelocity === 'function'
            ) {
                feedback.autoScrollVelocity = dragMulti.computeAutoScrollVelocity({
                    pointerY: pointer && pointer.clientY,
                    containerTop: geometrySnapshot.rootRect.top,
                    containerBottom: geometrySnapshot.rootRect.bottom,
                    edgePx: dragMulti.EDGE_PX,
                    maxSpeed: dragMulti.MAX_SPEED
                });
            }

            return {
                intent,
                isInvalid,
                dropEffect: intent && !isInvalid ? 'move' : 'none',
                shifts: planReflowShifts({
                    intent,
                    pointer,
                    geometrySnapshot,
                    dragContext,
                    session: runtime.dragReflowSession
                }),
                feedback,
                geometrySnapshot
            };
        }

        function isSupportedDragContext(dragContext) {
            if (!dragContext || typeof dragContext !== 'object') return false;
            if (dragContext.kind === 'source-single') {
                return Boolean(
                    Array.isArray(dragContext.keys)
                    && dragContext.keys.length === 1
                    && typeof dragContext.keys[0] === 'string'
                    && dragContext.keys[0]
                );
            }
            if (dragContext.kind === 'source-multi') {
                if (!Array.isArray(dragContext.keys) || dragContext.keys.length < 2) {
                    return false;
                }
                const validKeys = dragContext.keys.filter((key) => (
                    typeof key === 'string' && key
                ));
                return (
                    validKeys.length === dragContext.keys.length
                    && new Set(validKeys).size === validKeys.length
                );
            }
            if (dragContext.kind === 'group') {
                return Boolean(
                    typeof dragContext.draggedGroupId === 'string'
                    && dragContext.draggedGroupId
                );
            }
            return false;
        }

        function multiSourcePayloadMatchesDragContext(sourceKey, keys) {
            const dragContext = runtime.activeDragContext;
            if (
                !sourceKey
                || !Array.isArray(keys)
                || keys.length < 2
                || !isSupportedDragContext(dragContext)
                || dragContext.kind !== 'source-multi'
                || sourceKey !== keys[0]
                || dragContext.keys.length !== keys.length
            ) {
                return false;
            }
            const uniqueKeys = new Set();
            for (let index = 0; index < keys.length; index += 1) {
                const key = keys[index];
                if (
                    typeof key !== 'string'
                    || !key
                    || uniqueKeys.has(key)
                    || dragContext.keys[index] !== key
                ) {
                    return false;
                }
                uniqueKeys.add(key);
            }
            return true;
        }

        function resolveSynchronousDropEffect({
            clientX,
            clientY,
            geometrySnapshot,
            geometryDirty,
            state,
            groupsById,
            activeDragContext,
            parentMap,
            prevIntent
        } = {}) {
            if (
                !isSupportedDragContext(activeDragContext)
                || !Number.isFinite(clientX)
                || !Number.isFinite(clientY)
            ) {
                return 'none';
            }
            const hasUsableSnapshot = Boolean(
                geometryDirty === false
                && geometrySnapshot
                && geometrySnapshot === runtime.dragGeometrySnapshot
                && geometrySnapshot.rootElement
                && geometrySnapshot.rootRect
                && geometrySnapshot.domGeneration === dragGeometryDomGeneration
                && geometrySnapshot.session === (runtime.dragReflowSession || null)
            );
            if (!hasUsableSnapshot) return 'move';

            try {
                const intent = computeDropIntent({
                    clientX,
                    clientY,
                    rootElement: geometrySnapshot.rootElement,
                    state,
                    groupsById,
                    parentMap,
                    activeDragContext,
                    prevIntent,
                    geometrySnapshot
                });
                return (
                    intent
                    && !computeIsInvalidDrop({
                        intent,
                        dragContext: activeDragContext,
                        groupsById
                    })
                )
                    ? 'move'
                    : 'none';
            } catch (_) {
                // A clean cached snapshot should be pure to consume. If its
                // shape is unexpectedly unusable, keep native feedback
                // conservative; handleDrop performs the fail-closed fresh read.
                return 'move';
            }
        }

        function patchGeometryEntryVisual(entry, deltaY, { inherited = false } = {}) {
            if (!entry || !entry.visualRect) return false;
            entry.visualRect = translateRect(entry.visualRect, deltaY);
            if (inherited) entry.inheritedShiftY += deltaY;
            else entry.ownShiftY += deltaY;
            return true;
        }

        function groupIsDescendantOf(groupEntry, ancestorGroupId, groups) {
            let cursor = groupEntry;
            const seen = new Set();
            while (cursor && cursor.parentGroupId && !seen.has(cursor.parentGroupId)) {
                if (cursor.parentGroupId === ancestorGroupId) return true;
                seen.add(cursor.parentGroupId);
                cursor = groups.get(cursor.parentGroupId) || null;
            }
            return false;
        }

        function patchGeometryTransformDeltas({
            geometrySnapshot,
            shiftDeltas
        }) {
            if (!geometrySnapshot || !shiftDeltas) return false;
            let complete = true;
            const sourceDeltas = shiftDeltas.sources instanceof Map
                ? shiftDeltas.sources
                : new Map();
            const groupDeltas = shiftDeltas.groups instanceof Map
                ? shiftDeltas.groups
                : new Map();
            for (const [groupId, rawDelta] of groupDeltas) {
                const delta = Number(rawDelta) || 0;
                if (delta === 0) continue;
                const group = geometrySnapshot.groups.get(groupId);
                if (!group) {
                    complete = false;
                    continue;
                }
                patchGeometryEntryVisual(group, delta);
                if (group.header) {
                    group.header.visualRect = translateRect(group.header.visualRect, delta);
                    group.header.inheritedShiftY += delta;
                }
                if (group.children) {
                    group.children.visualRect = translateRect(group.children.visualRect, delta);
                    group.children.inheritedShiftY += delta;
                }
                for (const source of geometrySnapshot.sourceEntries.values()) {
                    if (source.parentGroupId === groupId) {
                        patchGeometryEntryVisual(source, delta, { inherited: true });
                        continue;
                    }
                    const parent = source.parentGroupId
                        ? geometrySnapshot.groups.get(source.parentGroupId)
                        : null;
                    if (parent && groupIsDescendantOf(parent, groupId, geometrySnapshot.groups)) {
                        patchGeometryEntryVisual(source, delta, { inherited: true });
                    }
                }
                for (const descendant of geometrySnapshot.groups.values()) {
                    if (!groupIsDescendantOf(descendant, groupId, geometrySnapshot.groups)) continue;
                    patchGeometryEntryVisual(descendant, delta, { inherited: true });
                    if (descendant.header) {
                        descendant.header.visualRect = translateRect(
                            descendant.header.visualRect,
                            delta
                        );
                        descendant.header.inheritedShiftY += delta;
                    }
                    if (descendant.children) {
                        descendant.children.visualRect = translateRect(
                            descendant.children.visualRect,
                            delta
                        );
                        descendant.children.inheritedShiftY += delta;
                    }
                }
            }
            for (const [sourceKey, rawDelta] of sourceDeltas) {
                const delta = Number(rawDelta) || 0;
                if (delta === 0) continue;
                const source = geometrySnapshot.sourceEntries.get(sourceKey);
                if (!source) {
                    complete = false;
                    continue;
                }
                patchGeometryEntryVisual(source, delta);
            }
            return complete;
        }

        function patchGeometryTransforms({
            geometrySnapshot,
            previousSourceShifts,
            previousGroupShifts,
            nextShifts
        }) {
            if (!geometrySnapshot || !nextShifts) return false;
            const shiftDeltas = {
                sources: new Map(),
                groups: new Map()
            };
            const collectShiftDeltas = (previous, next, deltas) => {
                for (const [key, nextDelta] of next) {
                    const delta = (Number(nextDelta) || 0)
                        - (Number(previous.get(key)) || 0);
                    if (delta !== 0) deltas.set(key, delta);
                }
                for (const [key, previousDelta] of previous) {
                    if (next.has(key)) continue;
                    const delta = -(Number(previousDelta) || 0);
                    if (delta !== 0) deltas.set(key, delta);
                }
            };
            collectShiftDeltas(
                previousSourceShifts,
                nextShifts.sources instanceof Map ? nextShifts.sources : new Map(),
                shiftDeltas.sources
            );
            collectShiftDeltas(
                previousGroupShifts,
                nextShifts.groups instanceof Map ? nextShifts.groups : new Map(),
                shiftDeltas.groups
            );
            return patchGeometryTransformDeltas({
                geometrySnapshot,
                shiftDeltas
            });
        }

        function clearAppliedDragFeedback() {
            const prior = runtime.dragFeedbackElements;
            if (!prior || typeof prior !== 'object') return;
            const removeClass = (element, ...classNames) => {
                if (element && element.classList && typeof element.classList.remove === 'function') {
                    element.classList.remove(...classNames);
                }
            };
            removeClass(prior.intoElement, 'drag-into');
            removeClass(prior.invalidElement, 'drag-invalid');
            removeClass(prior.lineElement, 'drag-over-top', 'drag-over-bottom');
            removeClass(prior.guideElement, 'sp-drag-guide');
            if (
                prior.guideElement
                && prior.guideElement.style
                && typeof prior.guideElement.style.removeProperty === 'function'
            ) {
                prior.guideElement.style.removeProperty('--sp-slot-comp');
            }
            runtime.dragFeedbackElements = null;
        }

        function applyHoverLifecycleFeedback(feedback) {
            const ancestorSet = feedback.pointerAncestorSet instanceof Set
                ? feedback.pointerAncestorSet
                : new Set();
            for (const [groupId, timerEntry] of runtime.hoverExpandTimers) {
                if (
                    timerEntry
                    && timerEntry.kind === 'expand'
                    && groupId !== feedback.pointerGroupId
                ) {
                    cancelHoverTimerForGroup(groupId);
                }
            }
            if (runtime.hoverExpandedGroupIds.size > 0) {
                for (const groupId of Array.from(runtime.hoverExpandedGroupIds)) {
                    if (ancestorSet.has(groupId)) cancelHoverTimerForGroup(groupId);
                    else armHoverCollapseTimerForGroup(groupId);
                }
            }
            if (!feedback.pointerGroupId) return;
            const group = getGroupsById().get(feedback.pointerGroupId);
            if (
                group
                && group.collapsed
                && Array.isArray(group.children)
                && group.children.length > 0
            ) {
                armHoverExpandTimerForGroup(
                    feedback.pointerGroupId,
                    feedback.pointerGroupElement
                );
            } else {
                cancelHoverTimerForGroup(feedback.pointerGroupId);
            }
        }

        function applyDragFramePlan(plan) {
            if (!plan || !plan.geometrySnapshot) return;
            const snapshot = plan.geometrySnapshot;
            const feedback = plan.feedback || {};
            const session = runtime.dragReflowSession;
            clearAppliedDragFeedback();

            if (
                feedback.intoElement
                && feedback.intoElement.classList
                && typeof feedback.intoElement.classList.add === 'function'
            ) {
                feedback.intoElement.classList.add('drag-into');
            }
            if (
                feedback.invalidElement
                && feedback.invalidElement.classList
                && typeof feedback.invalidElement.classList.add === 'function'
            ) {
                feedback.invalidElement.classList.add('drag-invalid');
            }
            if (
                feedback.lineElement
                && feedback.lineClass
                && feedback.lineElement.classList
                && typeof feedback.lineElement.classList.add === 'function'
            ) {
                feedback.lineElement.classList.add(feedback.lineClass);
            }
            if (
                feedback.guideElement
                && feedback.guideElement.classList
                && typeof feedback.guideElement.classList.add === 'function'
            ) {
                feedback.guideElement.classList.add('sp-drag-guide');
                if (
                    feedback.guideHeight > 0
                    && feedback.guideElement.style
                    && typeof feedback.guideElement.style.setProperty === 'function'
                ) {
                    feedback.guideElement.style.setProperty(
                        '--sp-slot-comp',
                        `${feedback.guideHeight}px`
                    );
                }
            }
            runtime.dragFeedbackElements = {
                intoElement: feedback.intoElement || null,
                invalidElement: feedback.invalidElement || null,
                lineElement: feedback.lineElement || null,
                guideElement: feedback.guideElement || null
            };

            let transformPatchComplete = true;
            if (
                session
                && dragReflow
                && typeof dragReflow.applyReflow === 'function'
                && plan.shifts
            ) {
                const supportsAppliedShiftDeltas = (
                    dragReflow.supportsAppliedShiftDeltas === true
                );
                const previousSourceShifts = session.shiftedSourceItems instanceof Map
                    ? (
                        supportsAppliedShiftDeltas
                            ? null
                            : new Map(session.shiftedSourceItems)
                    )
                    : new Map();
                const previousGroupShifts = session.shiftedGroupItems instanceof Map
                    ? (
                        supportsAppliedShiftDeltas
                            ? null
                            : new Map(session.shiftedGroupItems)
                    )
                    : new Map();
                const result = dragReflow.applyReflow({
                    session,
                    shifts: plan.shifts,
                    rootElement: snapshot.rootElement,
                    sourceElements: snapshot.sourceElements,
                    groupElements: snapshot.groupElements
                });
                transformPatchComplete = supportsAppliedShiftDeltas
                    ? patchGeometryTransformDeltas({
                        geometrySnapshot: snapshot,
                        shiftDeltas: result && result.appliedShiftDeltas
                    })
                    : patchGeometryTransforms({
                        geometrySnapshot: snapshot,
                        previousSourceShifts,
                        previousGroupShifts,
                        nextShifts: plan.shifts
                    });
                transformPatchComplete = Boolean(
                    transformPatchComplete
                    && result
                    && result.complete !== false
                );
            } else if (
                plan.shifts
                && (
                    (plan.shifts.sources instanceof Map && plan.shifts.sources.size > 0)
                    || (plan.shifts.groups instanceof Map && plan.shifts.groups.size > 0)
                )
            ) {
                transformPatchComplete = false;
            }

            if (session) {
                session.currentIntent = plan.intent ? { ...plan.intent } : null;
            }
            const shouldShowUngroupDropzone = Boolean(feedback.showUngroupDropzone);
            if (shouldShowUngroupDropzone !== Boolean(snapshot.dropzoneElement)) {
                _setUngroupDropzoneVisible(
                    shouldShowUngroupDropzone,
                    snapshot
                );
                invalidateDragGeometry('ungroup_dropzone_changed', { schedule: false });
            }
            applyHoverLifecycleFeedback(feedback);
            if (autoScrollController) {
                autoScrollController.tick(Number(feedback.autoScrollVelocity) || 0);
            }

            if (!transformPatchComplete) {
                invalidateDragGeometry('transform_patch_incomplete', { schedule: false });
            }
        }

        // dragover can fire well above 60Hz; collapsing computeDropIntent + reflow
        // + auto-scroll into per-frame batches keeps the main thread free on large
        // / deeply-nested lists. preventDefault stays on the synchronous path —
        // deferring it would set dropEffect='none' for the frame and suppress drop.
        let _pendingDragOverArgs = null;
        let _pendingDragOverRafId = null;
        let _lastDragOverArgs = null;
        function _cancelScheduledDragOverRaf() {
            if (_pendingDragOverRafId != null
                && typeof globalThis.cancelAnimationFrame === 'function') {
                try { globalThis.cancelAnimationFrame(_pendingDragOverRafId); } catch (_) { /* ignore */ }
            }
            _pendingDragOverRafId = null;
        }
        function _cancelPendingDragOver() {
            _cancelScheduledDragOverRaf();
            _pendingDragOverArgs = null;
            _lastDragOverArgs = null;
        }
        function _scheduleDragOverArgs(args) {
            _pendingDragOverArgs = args;
            if (_pendingDragOverRafId != null) return;
            const raf = typeof globalThis.requestAnimationFrame === 'function'
                ? globalThis.requestAnimationFrame
                : null;
            const flush = () => {
                const pendingArgs = _pendingDragOverArgs;
                _pendingDragOverRafId = null;
                _pendingDragOverArgs = null;
                if (!pendingArgs) return;
                _processDragOver(pendingArgs);
            };
            if (!raf) {
                flush();
            } else {
                _pendingDragOverRafId = raf(flush);
            }
        }
        function scheduleDragFrameFromLatestPointer() {
            if (!runtime.activeDragContext || !_lastDragOverArgs) return;
            if (typeof globalThis.requestAnimationFrame !== 'function') return;
            _scheduleDragOverArgs({ ..._lastDragOverArgs });
        }
        // Drop / dragend are the terminus of the drag lifecycle and must see the
        // latest computed intent + applied reflow before mutating state. If a
        // dragover RAF is still pending (e.g. synthetic-event drag in smoke tests
        // dispatches dragover→drop in the same tick), cancel it and run the
        // computation synchronously now so handleDrop reads the up-to-date
        // currentIntent / reflow.
        function _flushPendingDragOver() {
            if (_pendingDragOverArgs == null) return null;
            return flushDragFrameNow({
                pointer: _pendingDragOverArgs,
                reason: 'pending_dragover'
            });
        }
        function flushDragFrameNow({
            pointer = null,
            reason = 'synchronous_flush'
        } = {}) {
            const args = pointer || _pendingDragOverArgs || _lastDragOverArgs;
            if (!args || !runtime.activeDragContext) return null;
            _cancelScheduledDragOverRaf();
            _pendingDragOverArgs = null;
            runtime.dragFrameLastFlushReason = typeof reason === 'string'
                ? reason
                : 'synchronous_flush';
            return _processDragOver({
                clientX: args.clientX,
                clientY: args.clientY
            });
        }
        function handleDragOver(e) {
            e.preventDefault();
            const dropEffect = resolveSynchronousDropEffect({
                clientX: e.clientX,
                clientY: e.clientY,
                geometrySnapshot: runtime.dragGeometrySnapshot,
                geometryDirty: runtime.dragGeometryDirty,
                state: getState(),
                groupsById: getGroupsById(),
                activeDragContext: runtime.activeDragContext,
                parentMap: getParentMap(),
                prevIntent: runtime.dragReflowSession
                    ? runtime.dragReflowSession.currentIntent
                    : null
            });
            if (e.dataTransfer) {
                try { e.dataTransfer.dropEffect = dropEffect; } catch (_) {}
            }
            // Snapshot only the fields we read downstream. The DragEvent itself
            // is not safe to retain past the current event tick.
            _lastDragOverArgs = {
                clientX: e.clientX,
                clientY: e.clientY
            };
            _scheduleDragOverArgs({ ..._lastDragOverArgs });
        }
        // During a drag, find the COLLAPSED folder whose header is visually under the
        // pointer. Intentionally decoupled from computeDropIntent's drop resolution: the
        // X-split left-half corridor (a deliberate escape that routes a source drag to a
        // root-level reorder) and the empty-ungrouped root fallback both return
        // hostGroupContainerEl=null, but the folder the cursor is physically over must
        // still arm hover-expand so a dwell opens it (after which its children render and
        // normal slot detection takes over). Uses the raw rect (on-screen position incl.
        // any reflow transform) — we want what the user visually sees under the cursor.
        // Returns null when the pointer isn't over a collapsed, non-empty folder header.
        function _processDragOver(args) {
            const sourceListEl = getSourceListContainer();
            const geometrySnapshot = readDragGeometry({
                rootElement: sourceListEl,
                session: runtime.dragReflowSession || null
            });
            if (!geometrySnapshot) {
                const priorSnapshot = runtime.dragGeometrySnapshot;
                if (priorSnapshot) {
                    const invalidPlan = {
                        intent: null,
                        isInvalid: true,
                        dropEffect: 'none',
                        shifts: {
                            sources: new Map(),
                            groups: new Map()
                        },
                        feedback: {
                            showUngroupDropzone: false,
                            pointerGroupId: null,
                            pointerAncestorSet: new Set(),
                            autoScrollVelocity: 0
                        },
                        geometrySnapshot: priorSnapshot
                    };
                    applyDragFramePlan(invalidPlan);
                    return invalidPlan;
                } else {
                    clearAppliedDragFeedback();
                    if (runtime.dragReflowSession) {
                        runtime.dragReflowSession.currentIntent = null;
                        if (
                            dragReflow
                            && typeof dragReflow.clearReflow === 'function'
                            && sourceListEl
                        ) {
                            dragReflow.clearReflow({
                                session: runtime.dragReflowSession,
                                rootElement: sourceListEl
                            });
                        }
                    }
                    cancelAllHoverTimers();
                    _setUngroupDropzoneVisible(false);
                    if (autoScrollController) autoScrollController.stop();
                }
                return null;
            }
            const plan = planDragFrame({
                pointer: {
                    clientX: args && args.clientX,
                    clientY: args && args.clientY
                },
                geometrySnapshot,
                state: getState(),
                groupsById: getGroupsById(),
                parentMap: getParentMap(),
                dragContext: runtime.activeDragContext,
                previousIntent: runtime.dragReflowSession
                    ? runtime.dragReflowSession.currentIntent
                    : null
            });
            applyDragFramePlan(plan);
            return plan;
        }

        // Transient "drop to ungroup" hint shown in the bottom slot opened by reflow
        // when a source drag hovers below all root content and the bin (state.ungrouped)
        // is empty. Mounted as a direct child of #sources-list AFTER the root entries so
        // it sits in the opened trailing slot; styled by .sp-ungroup-dropzone in
        // content-style-text.js (Shadow DOM). Idempotent: re-entrant frames reuse the
        // existing node. Torn down on leave / dragend via _setUngroupDropzoneVisible(false).
        // el(...) is not in scope in this module (and not wired through its deps), so the
        // node is built via getDocument().createElement + createTextNode — never innerHTML.
        function _setUngroupDropzoneVisible(visible, geometrySnapshot = null) {
            const listEl = geometrySnapshot && geometrySnapshot.rootElement
                ? geometrySnapshot.rootElement
                : getSourceListContainer();
            if (!listEl) return;
            const existing = geometrySnapshot
                ? geometrySnapshot.dropzoneElement
                : (
                    typeof listEl.querySelector === 'function'
                        ? listEl.querySelector('.sp-ungroup-dropzone')
                        : null
                );
            if (!visible) {
                if (existing && typeof listEl.removeChild === 'function') {
                    try { listEl.removeChild(existing); } catch (_) { /* already detached */ }
                }
                if (geometrySnapshot) geometrySnapshot.dropzoneElement = null;
                return;
            }
            if (existing) return;
            if (typeof listEl.appendChild !== 'function') return;
            const documentObj = getDocument();
            if (!documentObj || typeof documentObj.createElement !== 'function') return;
            const zone = documentObj.createElement('div');
            zone.className = 'sp-ungroup-dropzone';
            if (typeof documentObj.createTextNode === 'function') {
                zone.appendChild(documentObj.createTextNode(getMessage('ui_drop_to_ungroup_hint')));
            } else {
                zone.textContent = getMessage('ui_drop_to_ungroup_hint');
            }
            listEl.appendChild(zone);
            if (geometrySnapshot) geometrySnapshot.dropzoneElement = zone;
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
                // Drop any dragover work queued for the next frame: the pointer has
                // left the list, so letting it run would re-arm a hover-expand timer
                // (the RAF flush calls armHoverExpandTimerForGroup). clearDragFeedback
                // is the only other cancel site and only fires on drop/dragend.
                _cancelPendingDragOver();
                _setUngroupDropzoneVisible(false);
            }
        }

        // BACKSTOP path of the drag-ghost cleanup contract — invoked by
        // handleDragEnd (primary) AND directly on edge-case terminations
        // (e.g. dragexit, error fall-through). Idempotent. Tears down visual
        // feedback (.dragging/.drag-into/.drag-invalid), stops autoscroll,
        // cancels pending dragover RAF, clears activeDragContext + hover
        // state. The third cleanup path is in content-drag-multi.js
        // destroyMultiDragGhost (called from handleDragEnd below).
        function clearDragFeedback(root = getShadowRoot()) {
            let count = 0;
            if (root && typeof root.querySelectorAll === 'function') {
                const nodes = Array.from(root.querySelectorAll('.dragging, .drag-into, .drag-invalid, .drag-over-top, .drag-over-bottom'));
                nodes.forEach((node) => {
                    if (node?.classList && typeof node.classList.remove === 'function') {
                        node.classList.remove('dragging', 'drag-into', 'drag-invalid', 'drag-over-top', 'drag-over-bottom');
                    }
                });
                count = nodes.length;
                // Tear down the per-frame folder guide (blue bar + slot extension) so it
                // doesn't linger after the drag ends.
                Array.from(root.querySelectorAll('.sp-drag-guide')).forEach((node) => {
                    if (node?.classList && typeof node.classList.remove === 'function') {
                        node.classList.remove('sp-drag-guide');
                    }
                    if (node?.style && typeof node.style.removeProperty === 'function') {
                        node.style.removeProperty('--sp-slot-comp');
                    }
                });
            }
            if (autoScrollController) autoScrollController.stop();
            // Drop any dragover work that was queued for the next frame — running
            // it after the drag terminated would touch DOM with stale intent.
            _cancelPendingDragOver();
            cancelDeferredDragFold();
            teardownDragGeometryLifecycle();
            _setUngroupDropzoneVisible(false);
            runtime.activeDragContext = null;
            cancelAllHoverTimers();
            restoreTransientHoverExpandedGroups();
            runtime.dragGeometrySnapshot = null;
            invalidateDragGeometry('drag_ended', { schedule: false });
            return count;
        }

        function teardownDragInteractions() {
            _cancelPendingDragOver();
            cancelDeferredDragFold();
            teardownDragGeometryLifecycle();
            if (autoScrollController && typeof autoScrollController.stop === 'function') {
                autoScrollController.stop();
            }
            runtime.activeDragContext = null;
            cancelAllHoverTimers();
            restoreTransientHoverExpandedGroups();
            if (
                runtime.activeDragGhost
                && dragMulti
                && typeof dragMulti.destroyMultiDragGhost === 'function'
            ) {
                try { dragMulti.destroyMultiDragGhost(runtime.activeDragGhost); } catch (_) {}
            }
            runtime.activeDragGhost = null;
            runtime.dragReflowSession = null;
            runtime.dragFeedbackElements = null;
            runtime.dragGeometrySnapshot = null;
            invalidateDragGeometry('manager_teardown', { schedule: false });
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
            invalidateDragGeometry('hover_timer_cancelled');
            if (typeof clearTimeout === 'function' && entry.timeoutId !== null && entry.timeoutId !== undefined) {
                clearTimeout(entry.timeoutId);
            }
            // If this was a pending expand, drop the visual cue too.
            // Cancellation reasons: pointer moved off the group, drag ended,
            // a sibling group's expand timer claimed the slot, etc.
            if (entry.kind === 'expand' && entry.containerEl
                && entry.containerEl.classList
                && typeof entry.containerEl.classList.remove === 'function') {
                entry.containerEl.classList.remove('sp-hover-expand-pending');
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

        function restoreTransientHoverExpandedGroups() {
            if (runtime.hoverExpandedGroupIds.size === 0) return 0;
            const openedIds = Array.from(runtime.hoverExpandedGroupIds);
            const groupsById = getGroupsById();
            const root = getShadowRoot();
            let restored = 0;
            for (const groupId of openedIds) {
                const group = groupsById.get(groupId);
                if (group && !group.collapsed) {
                    group.collapsed = true;
                    restored += 1;
                }
                const container = root && typeof root.querySelector === 'function'
                    ? root.querySelector(
                        `.group-container[data-group-id="${cssEscape(groupId)}"]`
                    )
                    : null;
                if (!container || typeof container.querySelector !== 'function') continue;
                const caret = container.querySelector('.sp-caret');
                const children = container.querySelector('.group-children');
                if (caret?.classList && typeof caret.classList.add === 'function') {
                    caret.classList.add('collapsed');
                }
                if (children?.classList && typeof children.classList.add === 'function') {
                    children.classList.add('collapsed');
                }
                const pendingSettle = children
                    ? pendingGroupExpandSettles.get(children)
                    : null;
                if (pendingSettle) {
                    children.removeEventListener('transitionend', pendingSettle);
                    pendingGroupExpandSettles.delete(children);
                }
                if (children?.style) {
                    children.style.height = '';
                    children.style.overflow = '';
                }
            }
            runtime.hoverExpandedGroupIds.clear();
            if (restored > 0) {
                saveState({ immediate: true });
            }
            return restored;
        }

        function executeHoverExpand(groupId) {
            invalidateDragGeometry('hover_expand_started', { schedule: false });
            // Drop the pending-cue class on whatever container we tracked when
            // the timer was armed — the actual expand is about to happen, so
            // the "about to open" outline should give way to the open state.
            const _expandEntry = runtime.hoverExpandTimers.get(groupId);
            if (_expandEntry && _expandEntry.kind === 'expand' && _expandEntry.containerEl
                && _expandEntry.containerEl.classList
                && typeof _expandEntry.containerEl.classList.remove === 'function') {
                _expandEntry.containerEl.classList.remove('sp-hover-expand-pending');
            }
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
                // Hover-expand happens MID-DRAG. toggleGroupCollapse runs the click-style
                // animated open, which leaves .group-children at inline overflow:hidden +
                // a fixed pixel height until an async transitionend (~one motion-slow later)
                // restores height:auto / overflow:visible. During that window the drag
                // reflow's translateY slot-opening is CLIPPED and the fixed-height container
                // can't grow, so dragging into the just-opened folder shows no avoidance and
                // the drop slot (mid-list or trailing) never opens. Settle the container to
                // its drag-ready state immediately so reflow works the instant it opens.
                const childrenEl = typeof container.querySelector === 'function'
                    ? container.querySelector('.group-children')
                    : null;
                if (childrenEl && childrenEl.style) {
                    const pendingSettle = pendingGroupExpandSettles.get(childrenEl);
                    if (pendingSettle) {
                        childrenEl.removeEventListener(
                            'transitionend',
                            pendingSettle
                        );
                        pendingGroupExpandSettles.delete(childrenEl);
                    }
                    childrenEl.style.height = 'auto';
                    childrenEl.style.overflow = 'visible';
                }
                invalidateDragGeometry('hover_expand_completed');
            }
        }

        function armHoverExpandTimerForGroup(groupId, knownContainerEl = null) {
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

            // Visual cue: paint a 1000ms outline build-up on the host
            // group-container so the user sees "this group is about to open"
            // during the wait. The class is removed either when the timer
            // fires (executeHoverExpand) or when cancelHoverTimerForGroup
            // runs (pointer moved elsewhere) — see both call sites.
            // Delay was raised from 600ms after users reported accidental
            // hover-opens while dragging past collapsed folders.
            let _armContainerEl = knownContainerEl;
            if (!_armContainerEl) {
                const _armRoot = getShadowRoot();
                if (_armRoot && typeof _armRoot.querySelector === 'function') {
                    _armContainerEl = _armRoot.querySelector(`.group-container[data-group-id="${cssEscape(groupId)}"]`);
                }
            }
            if (_armContainerEl && _armContainerEl.classList
                && typeof _armContainerEl.classList.add === 'function') {
                _armContainerEl.classList.add('sp-hover-expand-pending');
            }

            const timeoutId = setTimeoutFn(() => executeHoverExpand(groupId), 1000);
            runtime.hoverExpandTimers.set(groupId, { kind: 'expand', timeoutId, containerEl: _armContainerEl });
            invalidateDragGeometry('hover_expand_armed');
        }

        function armHoverCollapseTimerForGroup(groupId) {
            if (!groupId) return;
            if (!runtime.hoverExpandedGroupIds.has(groupId)) return;

            const existing = runtime.hoverExpandTimers.get(groupId);
            if (existing && existing.kind === 'collapse') return;
            if (existing) cancelHoverTimerForGroup(groupId);

            const setTimeoutFn = getSetTimeout();
            if (typeof setTimeoutFn !== 'function') return;
            const timeoutId = setTimeoutFn(() => executeHoverCollapse(groupId), 1000);
            runtime.hoverExpandTimers.set(groupId, { kind: 'collapse', timeoutId });
            invalidateDragGeometry('hover_collapse_armed');
        }

        function executeHoverCollapse(groupId) {
            invalidateDragGeometry('hover_collapse_started', { schedule: false });
            runtime.hoverExpandTimers.delete(groupId);
            if (!runtime.hoverExpandedGroupIds.has(groupId)) return;
            runtime.hoverExpandedGroupIds.delete(groupId);

            const groupsById = getGroupsById();
            const group = groupsById.get(groupId);
            if (!group) return;
            if (group.collapsed) return;
            if (!Array.isArray(group.children) || group.children.length === 0) return;
            const root = getShadowRoot();
            const container = root && typeof root.querySelector === 'function'
                ? root.querySelector(`.group-container[data-group-id="${cssEscape(groupId)}"]`)
                : null;
            if (container) {
                toggleGroupCollapse(group, container);
                invalidateDragGeometry('hover_collapse_completed');
                return;
            }
            // DOM unreachable (external state sync rebuilt/removed the node mid-drag).
            // We've already dropped groupId from hoverExpandedGroupIds, so without
            // this the group would stay permanently expanded with nothing tracking
            // it. Collapse in state — the next render() reconciles the DOM from
            // group.collapsed. State is the source of truth; the DOM is its product.
            group.collapsed = true;
            saveState({ immediate: true });
            invalidateDragGeometry('hover_collapse_completed');
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

        function cleanupReflowSession() {
            if (dragReflow && runtime.dragReflowSession) {
                if (typeof dragReflow.clearReflow === 'function') {
                    dragReflow.clearReflow({
                        session: runtime.dragReflowSession,
                        rootElement: getSourceListContainer()
                    });
                }
                // Cancellation cue: cleanupReflowSession only runs when the drag
                // ended WITHOUT a successful drop (handleDrop's success path nulls
                // dragReflowSession before reaching dragend). Add .sp-drag-cancelled
                // to the dragged rows so the CSS shake + red glow plays in parallel
                // with the unfold grow-back, giving explicit "this didn't land"
                // feedback. The class self-clears after 240ms (animation 200ms +
                // shadow fade-out 240ms ≈ same lifetime as the unfold tail).
                const _cancelRoot = getSourceListContainer();
                const _cancelSetTimeout = getSetTimeout();
                const _cancelledNodes = [];
                if (_cancelRoot && runtime.dragReflowSession.draggedKeys
                    && typeof _cancelRoot.querySelector === 'function') {
                    for (const key of runtime.dragReflowSession.draggedKeys) {
                        if (typeof key !== 'string' || !key) continue;
                        const safe = cssEscape(key);
                        const draggedType = runtime.dragReflowSession.draggedType;
                        const el = draggedType === 'source'
                            ? _cancelRoot.querySelector(`[data-source-key="${safe}"]`)
                            : (
                                draggedType === 'group'
                                    ? _cancelRoot.querySelector(`[data-group-id="${safe}"]`)
                                    : (
                                        _cancelRoot.querySelector(`[data-source-key="${safe}"]`)
                                        || _cancelRoot.querySelector(`[data-group-id="${safe}"]`)
                                    )
                            );
                        if (el && el.classList && typeof el.classList.add === 'function') {
                            el.classList.add('sp-drag-cancelled');
                            _cancelledNodes.push(el);
                        }
                    }
                }
                if (typeof dragReflow.unfoldDraggedItems === 'function') {
                    // animated:true → smooth grow-back on --sp-motion-base (180ms). Pairs with clearReflow's
                    // sibling translateY transition so cancel (esc / drop outside) feels
                    // like the row "settles" back into the list instead of snapping.
                    dragReflow.unfoldDraggedItems({
                        session: runtime.dragReflowSession,
                        rootElement: getSourceListContainer(),
                        animated: true
                    });
                }
                if (_cancelledNodes.length > 0 && typeof _cancelSetTimeout === 'function') {
                    _cancelSetTimeout(() => {
                        for (const node of _cancelledNodes) {
                            if (node && node.classList && typeof node.classList.remove === 'function') {
                                node.classList.remove('sp-drag-cancelled');
                            }
                        }
                    }, 240);
                }
                runtime.dragReflowSession = null;
            }
        }

        function getTypedDragRowKey(element) {
            if (!element || !element.dataset || !element.classList) return null;
            if (
                typeof element.classList.contains === 'function'
                && element.classList.contains('source-item')
                && element.dataset.sourceKey
            ) {
                return `source:${element.dataset.sourceKey}`;
            }
            if (
                typeof element.classList.contains === 'function'
                && element.classList.contains('group-container')
                && element.dataset.groupId
            ) {
                return `group:${element.dataset.groupId}`;
            }
            return null;
        }

        function handleDrop(e) {
            // Flush any dragover RAF still in flight so handleDrop reads the
            // up-to-date intent + reflow rather than a one-frame-stale snapshot.
            _flushPendingDragOver();
            if (runtime.dragGeometryDirty === true && _lastDragOverArgs) {
                flushDragFrameNow({
                    pointer: _lastDragOverArgs,
                    reason: 'drop_after_geometry_invalidation'
                });
            }
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
                    const _preEls = _preDropRoot.querySelectorAll(
                        '.source-item[data-source-key], .group-container[data-group-id]'
                    );
                    for (const _pEl of _preEls) {
                        if (!_pEl || typeof _pEl.getBoundingClientRect !== 'function') continue;
                        const _pKey = getTypedDragRowKey(_pEl);
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
                if (draggedGroupId && (sourceKey || sourceKeysRaw)) {
                    clearDragFeedback();
                    return;
                }
                const semanticTarget = resolveSemanticDropTarget(intent);

                if (
                    runtime.activeDragContext?.kind === 'source-multi'
                    && !sourceKeysRaw
                ) {
                    clearDragFeedback();
                    return;
                }

                if (sourceKeysRaw) {
                    const dragContext = runtime.activeDragContext;
                    if (
                        !isSupportedDragContext(dragContext)
                        || dragContext.kind !== 'source-multi'
                        || sourceKeysRaw !== JSON.stringify(dragContext.keys)
                    ) {
                        clearDragFeedback();
                        return;
                    }
                    let keys = null;
                    try { keys = JSON.parse(sourceKeysRaw); } catch (err) { keys = null; }
                    if (!multiSourcePayloadMatchesDragContext(sourceKey, keys)) {
                        clearDragFeedback();
                        return;
                    }
                    {
                        // v5: a multi-source drop may also position between root entries
                        // (before/after a root group), which Tree Placement commits into
                        // state.root — keep this in sync with computeIsInvalidDrop, which
                        // no longer rejects top-level before-group/after-group source drops.
                        const allowedMultiIntents = new Set([
                            'into-group', 'before-source', 'after-source', 'before-group', 'after-group'
                        ]);
                        if (!allowedMultiIntents.has(intentKind)) {
                            clearDragFeedback();
                            return;
                        }
                        if (
                            !semanticTarget
                            || !treePlacement
                            || typeof treePlacement.applyBatchPlacement !== 'function'
                            || typeof treePlacement.rebuildParentMap !== 'function'
                        ) {
                            clearDragFeedback();
                            return;
                        }
                        const augmentedIntent = {
                            kind: intentKind,
                            targetList: intent.targetList,
                            insertIndex: intent.insertIndex,
                            targetGroup: intent.targetGroup,
                            targetGroupId: intent.targetGroupId || intent.targetGroup?.id || null,
                            isRootList: Boolean(intent.isRootList),
                            target: semanticTarget
                        };
                        clearReflowBeforeMutation();
                        let result = null;
                        try {
                            result = treePlacement.applyBatchPlacement({
                                items: keys.map((key) => ({ kind: 'source', key })),
                                target: semanticTarget
                            });
                        } catch (error) {
                            result = null;
                        }
                        const movedKeys = Array.isArray(result?.moved)
                            ? result.moved
                                .filter((item) => item?.kind === 'source' && item.key)
                                .map((item) => item.key)
                            : [];
                        if (result?.ok && result.changed && movedKeys.length > 0) {
                            developerLog('info', 'source_action', 'batch_drag_move', {
                                count: movedKeys.length,
                                intent: intentKind
                            });
                            state.isBatchMode = false;
                            pendingBatchKeys.clear();
                            rebuildPlacementParentMap();
                            saveState({ immediate: true, critical: true });
                            render();
                            showToast(getMessage('ui_batch_moved_sources_toast', [String(movedKeys.length)]));
                            disposeHoverOpenedGroupsAfterDrop(intent, augmentedIntent);
                            applyDropLandingAndFlash(
                                movedKeys,
                                e.clientX,
                                e.clientY,
                                _preDropRects,
                                'source'
                            );
                        }
                        clearDragFeedback();
                        return;
                    }
                }

                const augmentedIntent = {
                    kind: intentKind,
                    targetList: intent.targetList,
                    insertIndex: intent.insertIndex,
                    targetGroup: intent.targetGroup,
                    target: semanticTarget
                };
                const item = sourceKey
                    ? { kind: 'source', key: sourceKey }
                    : (
                        draggedGroupId
                            ? { kind: 'group', id: draggedGroupId }
                            : null
                    );
                if (
                    !item
                    || !semanticTarget
                    || !treePlacement
                    || typeof treePlacement.applyPlacement !== 'function'
                    || typeof treePlacement.rebuildParentMap !== 'function'
                ) {
                    clearDragFeedback();
                    return;
                }
                clearReflowBeforeMutation();
                let result;
                try {
                    result = treePlacement.applyPlacement({
                        item,
                        target: semanticTarget
                    });
                } catch (error) {
                    clearDragFeedback();
                    return;
                }
                if (!result?.ok || !result.changed) {
                    clearDragFeedback();
                    return;
                }

                rebuildPlacementParentMap();
                render();
                saveState({ immediate: true, critical: true });
                disposeHoverOpenedGroupsAfterDrop(intent, augmentedIntent);
                clearDragFeedback();
                applyDropLandingAndFlash(
                    sourceKey ? [sourceKey] : (draggedGroupId ? [draggedGroupId] : []),
                    e.clientX, e.clientY,
                    _preDropRects,
                    sourceKey ? 'source' : (draggedGroupId ? 'group' : null)
                );
                // Discoverability hint: when a source drop lands in the bottom ungrouped
                // bin via the trailing drop zone (targetGroup null, slotKey null, and NOT a
                // positioned root drop), render() places it at the BOTTOM of the list, below
                // all root content — far from the cursor. Surface a toast + scroll the
                // ungrouped header into view so the user can find their source. An empty-root
                // positioned drop also has slotKey null but carries isRootList, so it is
                // excluded here (the source stays at root, not the bin).
                if (
                    sourceKey
                    && result.to?.container === 'ungrouped'
                    && intent.slotKey == null
                ) {
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
        function applyDropLandingAndFlash(
            landedKeys,
            _cursorX,
            _cursorY,
            preRects,
            landedType = null
        ) {
            // Classic mode has no fly-in / FLIP landing animation (26.5.26 dropped instantly).
            if (getDragMode() === 'classic') return;
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
                rootElement.querySelectorAll(
                    '.source-item[data-source-key], .group-container[data-group-id]'
                ).forEach((row) => {
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
            const _rawLandedSet = new Set(Array.isArray(landedKeys) ? landedKeys : []);
            const _landedSet = new Set(
                landedType
                    ? Array.from(_rawLandedSet, (key) => `${landedType}:${key}`)
                    : []
            );
            if (preRects && typeof preRects.get === 'function' && typeof rootElement.querySelectorAll === 'function') {
                const _flipEls = rootElement.querySelectorAll(
                    '.source-item[data-source-key], .group-container[data-group-id]'
                );
                for (const _flipEl of _flipEls) {
                    if (!_flipEl || !_flipEl.classList || !_flipEl.style) continue;
                    const _flipKey = getTypedDragRowKey(_flipEl);
                    if (!_flipKey) continue;
                    const _rawFlipKey = _flipKey.slice(_flipKey.indexOf(':') + 1);
                    if (
                        _landedSet.has(_flipKey)
                        || (!landedType && _rawLandedSet.has(_rawFlipKey))
                    ) {
                        continue; // landed items use the opacity path below
                    }
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
                const safe = cssEscape(key);
                const el = landedType === 'source'
                    ? rootElement.querySelector(`[data-source-key="${safe}"]`)
                    : (
                        landedType === 'group'
                            ? rootElement.querySelector(`[data-group-id="${safe}"]`)
                            : (
                                rootElement.querySelector(`[data-source-key="${safe}"]`)
                                || rootElement.querySelector(`[data-group-id="${safe}"]`)
                            )
                    );
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

        // CROSS-REF: PRIMARY path of the drag-ghost cleanup contract (3 paths).
        // This function handles the normal dragend lifecycle. The other two:
        //   - clearDragFeedback (above) — backstop, idempotent, used both
        //     standalone and as part of this function's body.
        //   - content-drag-multi.destroyMultiDragGhost — multi-source ghost
        //     teardown, invoked below via dragMulti.destroyMultiDragGhost.
        // Modifying any of the three requires checking the other two.
        function handleDragEnd(e) {
            // Flush any dragover RAF so the upcoming clearDragFeedback /
            // unfoldDraggedItems path reads a fully-applied reflow state.
            _flushPendingDragOver();
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
            // Post-drop hover hint. Chrome's native :hover stays stuck on whichever DOM
            // element was under the cursor at dragstart and does not refresh until the
            // user moves the mouse for real (HTML5 drag freezes hover; the W3C security
            // model also forbids untrusted MouseEvents from re-triggering native :hover
            // hit-testing). Combined with this project's in-place patchChildren render,
            // that means the "row that was under the cursor at dragstart" can now be
            // displaying a totally different source after drop — and it stays visually
            // hovered until a real mousemove arrives. Two layered mechanisms collaborate:
            //
            //   (1) `.sp-pseudo-hover` JS class on the cursor-under element AND
            //       `.sp-drag-active` on #sources-list. The pseudo class re-paints the
            //       hover affordance on the element actually under the cursor; the
            //       drag-active class lets the stylesheet suppress the stale native
            //       :hover (the rule lives in content-style-text.js next to
            //       `.sp-pseudo-hover`). Both classes are cleared the first time a
            //       trusted pointer event fires, so native :hover takes over seamlessly.
            //   (2) Synthetic `mousemove` dispatch (best-effort) — some Chrome versions
            //       partially honor isTrusted=false events for hover hit-testing; if it
            //       works, native :hover snaps back on the next paint and (1)'s capture
            //       listener will tear down on the user's first real movement anyway.
            //       The listener gates on `event.isTrusted` so our own synthetic
            //       dispatch does NOT immediately tear down (1) and leave the user with
            //       neither pseudo nor refreshed native :hover.
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
                    if (_endList.classList && typeof _endList.classList.add === 'function') {
                        _endList.classList.add('sp-drag-active');
                    }
                }
                const _clearPseudo = () => {
                    if (_endList && _endList.classList && typeof _endList.classList.remove === 'function') {
                        _endList.classList.remove('sp-drag-active');
                    }
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
                    const _onCleanup = (evt) => {
                        // Gate on isTrusted so the synthetic mousemove dispatched below
                        // does not tear down the very state we just installed. Only real
                        // user pointer activity should hand control back to native :hover.
                        if (evt && evt.isTrusted === false) return;
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
                // Best-effort: dispatch a synthetic mousemove at the cursor position to
                // poke Chrome's hover hit-test path. isTrusted is false so most browsers
                // will not actually refresh native :hover, but the dispatch is cheap and
                // harmless — `.sp-pseudo-hover` + `.sp-drag-active` are doing the real
                // work. The capture _onCleanup ignores this event because of the
                // isTrusted gate above.
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

        // Called by content-render's `render()` end-of-cycle hook. When a drag is
        // active and the reflow session has tracked shifts, the DOM that
        // patchChildren just produced may not carry the inline transforms anymore
        // (patchNode can rewrite the style attribute or replace elements during
        // reconciliation). Re-apply the tracked shifts so siblings stay at their
        // visually-shifted positions across the render. Idempotent: if shifts
        // already match (prev === delta) applyReflow skips per-element work.
        function applyReflowAfterRender() {
            if (!runtime.activeDragContext && !runtime.dragReflowSession) return;
            const rootElement = getSourceListContainer();
            if (!rootElement) return;
            const sourceElements = new Map();
            const groupElements = new Map();
            const groupChildrenElements = [];
            if (typeof rootElement.querySelectorAll === 'function') {
                const freshElements = Array.from(rootElement.querySelectorAll([
                    '.source-item[data-source-key]',
                    '.group-container[data-group-id]',
                    '.group-children'
                ].join(', ')));
                for (const element of freshElements) {
                    if (!element || !element.classList) continue;
                    if (element.classList.contains('source-item')) {
                        const key = element.dataset ? element.dataset.sourceKey : null;
                        if (key && !sourceElements.has(key)) sourceElements.set(key, element);
                    } else if (element.classList.contains('group-container')) {
                        const id = element.dataset ? element.dataset.groupId : null;
                        if (id && !groupElements.has(id)) groupElements.set(id, element);
                    } else if (element.classList.contains('group-children')) {
                        groupChildrenElements.push(element);
                    }
                }
            }
            const cachedSnapshot = runtime.dragGeometrySnapshot;
            const lifecycleTargetSizes = new Map();
            if (
                cachedSnapshot
                && cachedSnapshot.rootElement === rootElement
                && cachedSnapshot.rootRect
            ) {
                lifecycleTargetSizes.set(rootElement, {
                    width: cachedSnapshot.rootRect.width,
                    height: cachedSnapshot.rootRect.height
                });
                for (const childrenElement of groupChildrenElements) {
                    const groupId = childrenElement
                        && childrenElement.parentElement
                        && childrenElement.parentElement.dataset
                        ? childrenElement.parentElement.dataset.groupId
                        : null;
                    const priorChildren = groupId
                        ? cachedSnapshot.groups.get(groupId)?.children
                        : null;
                    if (priorChildren && priorChildren.visualRect) {
                        lifecycleTargetSizes.set(childrenElement, {
                            width: priorChildren.visualRect.width,
                            height: priorChildren.visualRect.height
                        });
                    }
                }
            }
            refreshDragGeometryLifecycleElements(
                rootElement,
                lifecycleTargetSizes
            );
            if (!runtime.dragReflowSession || !dragReflow) return;
            if (typeof dragReflow.applyReflow !== 'function') return;

            const liveSourceShifts = runtime.dragReflowSession.shiftedSourceItems;
            const liveGroupShifts = runtime.dragReflowSession.shiftedGroupItems;
            const hasTypedShifts = (
                liveSourceShifts instanceof Map
                && liveSourceShifts.size > 0
            ) || (
                liveGroupShifts instanceof Map
                && liveGroupShifts.size > 0
            );
            if (hasTypedShifts) {
                const shifts = {
                    sources: liveSourceShifts instanceof Map
                        ? new Map(liveSourceShifts)
                        : new Map(),
                    groups: liveGroupShifts instanceof Map
                        ? new Map(liveGroupShifts)
                        : new Map()
                };
                if (liveSourceShifts instanceof Map) liveSourceShifts.clear();
                if (liveGroupShifts instanceof Map) liveGroupShifts.clear();
                Object.defineProperty(shifts, '_shiftDeltaPlan', {
                    configurable: true,
                    value: {
                        deltas: {
                            sources: new Map(shifts.sources),
                            groups: new Map(shifts.groups)
                        },
                        bases: {
                            sources: liveSourceShifts,
                            groups: liveGroupShifts
                        },
                        baseSizes: {
                            sources: liveSourceShifts instanceof Map
                                ? liveSourceShifts.size
                                : 0,
                            groups: liveGroupShifts instanceof Map
                                ? liveGroupShifts.size
                                : 0
                        },
                        // The render invalidated geometry, so prior viewport
                        // membership is no longer trustworthy. Re-apply every
                        // shift statically; the already-scheduled fresh drag
                        // frame will promote only viewport-near rows.
                        animatedKeys: {
                            sources: new Set(),
                            groups: new Set()
                        }
                    }
                });
                dragReflow.applyReflow({
                    session: runtime.dragReflowSession,
                    shifts,
                    rootElement,
                    sourceElements,
                    groupElements
                });
                return;
            }
            const live = runtime.dragReflowSession.shiftedItems;
            if (!(live instanceof Map) || live.size === 0) return;
            // render() rebuilt the rows, so the fresh nodes carry no inline
            // transform — but session.shiftedItems still records the shift values.
            // Snapshot those values, then CLEAR the live Map so applyReflow's
            // `prev === delta` short-circuit sees prev === undefined for every key
            // and actually re-writes translateY onto the new nodes (it repopulates
            // session.shiftedItems as it applies). Passing the live Map directly as
            // `shifts` no-ops: every entry trivially equals itself, so the diff loop
            // skips every row and the shift is lost across the render.
            const snapshot = new Map(live);
            live.clear();
            dragReflow.applyReflow({
                session: runtime.dragReflowSession,
                shifts: snapshot,
                rootElement
            });
        }

        // Classic mode cannot represent positioned root sources, so switching to classic
        // sweeps any { type:'source' } entries out of state.root into the bottom ungrouped
        // bin (preserving relative order). This Adapter delegates the idempotent transaction
        // to Tree Placement and returns true iff live state changed. Called by the setDragMode
        // wrapper and on load when mode is classic.
        function sweepPositionedRootSourcesToBin(state) {
            if (!state || typeof state !== 'object') return false;
            if (state === getState()) {
                return Boolean(
                    treePlacement
                    && typeof treePlacement.sweepPositionedRootSourcesToBin === 'function'
                    && treePlacement.sweepPositionedRootSourcesToBin()
                );
            }
            if (typeof createContentTreePlacementFactory !== 'function') return false;
            const placementForState = createContentTreePlacementFactory({
                getState: () => state,
                getGroupsById
            });
            return Boolean(placementForState.sweepPositionedRootSourcesToBin());
        }

        return {
            handleAddNewGroup,
            syncSourceToPage,
            processClickQueue,
            findParentGroupOfSource,
            isBatchOperableSource,
            collectSourceKeysInTreeOrder,
            executeBatchMoveToUngrouped,
            canMoveSourceToUngrouped,
            moveSourceToUngrouped,
            executeDirectionalTreeMove,
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
            getGroupAncestorChain,
            resolveSiblingKeys,
            resolveVisibleAnchorInsertIndex,
            computeDropIntent,
            readDragGeometry,
            computeDropIntentRaw,
            planDragFrame,
            applyDragFramePlan,
            resolveSynchronousDropEffect,
            invalidateDragGeometry,
            flushDragFrameNow,
            teardownDragInteractions,
            restoreTransientHoverExpandedGroups,
            sweepPositionedRootSourcesToBin,
            applyReflowAfterRender
        };
    }

    globalThis.NSM_CREATE_CONTENT_TREE_INTERACTIONS = createContentTreeInteractions;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentTreeInteractions;
    }
}());
