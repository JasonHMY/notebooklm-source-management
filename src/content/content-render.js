(function () {
    'use strict';

    /**
     * createContentRender(deps) — Shadow DOM manager 渲染层。
     * 负责列表行 / 分组容器 / 批量条 / 搜索栏 / 视图状态栏 / 快速视图栏 / 源 action 菜单层 / 拖拽 reflow 后的 DOM patch。
     *
     * @param {Object} deps 25+ 项依赖,主要分四类:
     *   - state getters: getState, getGroupsById, getTagsById, getSourcesByKey, getParentMap,
     *     getPendingBatchKeys, getActiveIsolationGroupId, getIsDeletingSources, getVisibleQuickViewKinds
     *   - DOM 工厂: el (XSS-safe text-node-only element factory from src/utils/index.js)
     *   - search/filter: searchSemantics (由 index 注入；独立调用需先加载全局 factory),
     *     sourceMatchesCurrentFilters, areAllAncestorsEnabled,
     *     isSourceWithinActiveIsolation, isGroupWithinActiveIsolation, isSourceEffectivelyEnabled,
     *     shouldRenderGroup, hasActiveRenderFilters, getSourceTagIds, getTagStyleVars
     *   - interaction callbacks: handleInteraction, canOpenSourceActionMenu, syncSearchUi, getMessage
     *   完整 deps 列表见下方 line 6+ 的 destructuring 块。
     * @returns {Object} 主入口 `render()`; 25+ helpers 涵盖 patch (patchNode/patchChildren)、
     *   UI 子区域 (renderQuickViewRail/renderViewStateBar)、源 action 菜单层 (~10 fns)、
     *   icon 工厂 (createSourceGlyphIcon/createSourceIconElement/...)。完整方法名见 line 1487 的 return 块。
     */
    function createContentRender(deps = {}) {
        const QUICK_VIEW_BUTTON_KINDS = ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'];
        const MAX_VISIBLE_TREE_INDENT_LEVEL = 8;
        const TREE_INDENT_STEP_PX = 12;
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || null);
        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || new Map());
        const getTagsById = typeof deps.getTagsById === 'function'
            ? deps.getTagsById
            : () => (deps.tagsById || new Map());
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || new Map());
        const getParentMap = typeof deps.getParentMap === 'function'
            ? deps.getParentMap
            : () => (deps.parentMap || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || new Set());
        const getVisibleQuickViewKinds = typeof deps.getVisibleQuickViewKinds === 'function'
            ? deps.getVisibleQuickViewKinds
            : () => [...QUICK_VIEW_BUTTON_KINDS];
        const getActiveIsolationGroupId = typeof deps.getActiveIsolationGroupId === 'function'
            ? deps.getActiveIsolationGroupId
            : () => (deps.activeIsolationGroupId || null);
        const getIsDeletingSources = typeof deps.getIsDeletingSources === 'function'
            ? deps.getIsDeletingSources
            : () => Boolean(deps.isDeletingSources);
        const getLastBatchDeleteResult = typeof deps.getLastBatchDeleteResult === 'function'
            ? deps.getLastBatchDeleteResult
            : () => null;
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const el = typeof deps.el === 'function'
            ? deps.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);
        const syncSearchUi = typeof deps.syncSearchUi === 'function'
            ? deps.syncSearchUi
            : () => {};
        const updatePanelResizerAria = typeof deps.updatePanelResizerAria === 'function'
            ? deps.updatePanelResizerAria
            : () => {};
        const hasActiveRenderFilters = typeof deps.hasActiveRenderFilters === 'function'
            ? deps.hasActiveRenderFilters
            : () => false;
        const sourceMatchesCurrentFilters = typeof deps.sourceMatchesCurrentFilters === 'function'
            ? deps.sourceMatchesCurrentFilters
            : () => true;
        const areAllAncestorsEnabled = typeof deps.areAllAncestorsEnabled === 'function'
            ? deps.areAllAncestorsEnabled
            : () => true;
        const isSourceWithinActiveIsolation = typeof deps.isSourceWithinActiveIsolation === 'function'
            ? deps.isSourceWithinActiveIsolation
            : () => true;
        const isGroupWithinActiveIsolation = typeof deps.isGroupWithinActiveIsolation === 'function'
            ? deps.isGroupWithinActiveIsolation
            : () => true;
        const isSourceEffectivelyEnabled = typeof deps.isSourceEffectivelyEnabled === 'function'
            ? deps.isSourceEffectivelyEnabled
            : () => true;
        const getSourceTagIds = typeof deps.getSourceTagIds === 'function'
            ? deps.getSourceTagIds
            : () => [];
        const createSearchSemantics = typeof globalThis.NSM_CREATE_CONTENT_SEARCH_SEMANTICS === 'function'
            ? globalThis.NSM_CREATE_CONTENT_SEARCH_SEMANTICS
            : null;
        const searchSemantics = deps.searchSemantics && typeof deps.searchSemantics === 'object'
            ? deps.searchSemantics
            : (createSearchSemantics ? createSearchSemantics({
                getGroupsById,
                getTagsById,
                getParentMap,
                getSourceTagIds
            }) : null);
        if (
            !searchSemantics
            || typeof searchSemantics.parseQuery !== 'function'
            || typeof searchSemantics.matchesSource !== 'function'
            || typeof searchSemantics.matchesGroup !== 'function'
            || typeof searchSemantics.getHighlightTerms !== 'function'
            || typeof searchSemantics.segmentText !== 'function'
        ) {
            throw new Error(
                'GeminiNotebook-Source-Management: Content search semantics are missing.'
            );
        }
        const parseSearchQuery = searchSemantics.parseQuery;
        const groupMatchesSearchQuery = searchSemantics.matchesGroup;
        const getSearchHighlightTerms = searchSemantics.getHighlightTerms;
        const getTagStyleVars = typeof deps.getTagStyleVars === 'function'
            ? deps.getTagStyleVars
            : () => '';
        const handleInteraction = typeof deps.handleInteraction === 'function'
            ? deps.handleInteraction
            : () => {};
        const canOpenSourceActionMenu = typeof deps.canOpenSourceActionMenu === 'function'
            ? deps.canOpenSourceActionMenu
            : () => false;
        const resolveDirectionalTarget = typeof deps.resolveDirectionalTarget === 'function'
            ? deps.resolveDirectionalTarget
            : () => ({ ok: false, reason: 'unavailable', target: null });
        const createDirectionalTargetResolver = typeof deps.createDirectionalTargetResolver === 'function'
            ? deps.createDirectionalTargetResolver
            : null;
        const findSourceActionButton = typeof deps.findSourceActionButton === 'function'
            ? deps.findSourceActionButton
            : () => null;
        const getSourceActionMenuItems = typeof deps.getSourceActionMenuItems === 'function'
            ? deps.getSourceActionMenuItems
            : () => [];
        const getSourceActionSubmenuItems = typeof deps.getSourceActionSubmenuItems === 'function'
            ? deps.getSourceActionSubmenuItems
            : () => [];
        const getSourceActionMenuPosition = typeof deps.getSourceActionMenuPosition === 'function'
            ? deps.getSourceActionMenuPosition
            : () => null;
        const getSourceActionSubmenuPosition = typeof deps.getSourceActionSubmenuPosition === 'function'
            ? deps.getSourceActionSubmenuPosition
            : () => null;
        const syncActiveSourceActionMenuState = typeof deps.syncActiveSourceActionMenuState === 'function'
            ? deps.syncActiveSourceActionMenuState
            : () => false;
        const getActiveSourceActionSourceKey = typeof deps.getActiveSourceActionSourceKey === 'function'
            ? deps.getActiveSourceActionSourceKey
            : () => null;
        const getActiveSourceActionSubmenuAction = typeof deps.getActiveSourceActionSubmenuAction === 'function'
            ? deps.getActiveSourceActionSubmenuAction
            : () => null;
        const getSourceActionMenuPositionState = typeof deps.getSourceActionMenuPositionState === 'function'
            ? deps.getSourceActionMenuPositionState
            : () => null;
        const setSourceActionMenuPosition = typeof deps.setSourceActionMenuPosition === 'function'
            ? deps.setSourceActionMenuPosition
            : () => {};
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : () => {};
        const setActiveSourceActionSubmenuAction = typeof deps.setActiveSourceActionSubmenuAction === 'function'
            ? deps.setActiveSourceActionSubmenuAction
            : () => {};
        const getSourceViewInfo = typeof deps.getSourceViewInfo === 'function'
            ? deps.getSourceViewInfo
            : () => ({ kind: 'unknown', confidence: 0 });
        const getNativeLabelImportPreview = typeof deps.getNativeLabelImportPreview === 'function'
            ? deps.getNativeLabelImportPreview
            : () => ({ ok: false, labelCount: 0, sourceCount: 0 });
        const getLastNativeLabelImportSummary = typeof deps.getLastNativeLabelImportSummary === 'function'
            ? deps.getLastNativeLabelImportSummary
            : () => null;
        const getNativeSelectionSyncFailure = typeof deps.getNativeSelectionSyncFailure === 'function'
            ? deps.getNativeSelectionSyncFailure
            : () => null;
        const retryNativeSelectionSync = typeof deps.retryNativeSelectionSync === 'function'
            ? deps.retryNativeSelectionSync
            : async () => ({ ok: false, reason: 'retry_unavailable' });

        const BATCH_COUNT_MARKER = '__COUNT__';
        const COUNT_UP_DURATION_MS = 320;
        const MOTION_STAGGER_MAX_INDEX = 10;
        const DEFAULT_SOURCE_WINDOW_THRESHOLD = 240;
        const DEFAULT_SOURCE_WINDOW_OVERSCAN = 20;
        const DEFAULT_SOURCE_WINDOW_ROW_HEIGHT = 44;
        const DEFAULT_SOURCE_WINDOW_VIEWPORT_HEIGHT = 600;
        const SPOTLIGHT_SURFACE_SELECTOR = '.sp-spotlight-surface';
        const TREE_ORDER_DIRECTIONS = [
            { direction: 'up', icon: 'arrow_upward', labelKey: 'ui_tree_order_up' },
            { direction: 'down', icon: 'arrow_downward', labelKey: 'ui_tree_order_down' },
            { direction: 'in', icon: 'subdirectory_arrow_right', labelKey: 'ui_tree_order_in' },
            { direction: 'out', icon: 'subdirectory_arrow_left', labelKey: 'ui_tree_order_out' }
        ];
        let focusedSourceActionMenuKey = null;
        let pendingSourceActionMenuFocus = null;
        let isRenderScheduled = false;
        let scheduledRenderFrameId = null;
        let scheduledRenderRunner = null;
        let sourceRenderGeneration = 0;
        let estimatedSourceWindowRowHeight = DEFAULT_SOURCE_WINDOW_ROW_HEIGHT;
        let hasMeasuredSourceWindowRowHeight = false;
        let dragPinnedSourceKeys = new Set();
        let lastVisibleLogicalSourceKeys = [];
        let derivedGroupEffectiveStateCache = new Map();
        let derivedGroupEffectiveStateCohort = null;
        let lastSourceWindowMetadata = {
            active: false,
            logicalTotal: 0,
            logicalVisible: 0,
            logicalSourceCount: 0,
            visibleLogicalSourceCount: 0,
            materializedSources: 0,
            materializedSourceCount: 0,
            renderGeneration: 0,
            start: 0,
            end: 0,
            pinnedCount: 0,
            overscan: DEFAULT_SOURCE_WINDOW_OVERSCAN
        };

        function getSourceWindowThreshold() {
            const configured = Number(deps.sourceWindowThreshold);
            return Number.isFinite(configured)
                ? Math.max(1, Math.floor(configured))
                : DEFAULT_SOURCE_WINDOW_THRESHOLD;
        }

        function invalidateDerivedGroupEffectiveStateCache() {
            derivedGroupEffectiveStateCache = new Map();
            derivedGroupEffectiveStateCohort = null;
        }

        function getFirstMapValue(map) {
            if (!map || typeof map.values !== 'function') return null;
            const iterator = map.values();
            const first = iterator.next();
            return first.done ? null : first.value;
        }

        function ensureDerivedGroupEffectiveStateCohort(
            state,
            groupsById,
            sourcesByKey,
            activeIsolationGroupId
        ) {
            const nextCohort = {
                state,
                groupsById,
                groupsSize: groupsById?.size || 0,
                firstGroup: getFirstMapValue(groupsById),
                sourcesByKey,
                sourcesSize: sourcesByKey?.size || 0,
                firstSource: getFirstMapValue(sourcesByKey),
                activeIsolationGroupId: activeIsolationGroupId || null
            };
            const previous = derivedGroupEffectiveStateCohort;
            const invalidated = (
                !previous
                || previous.state !== nextCohort.state
                || previous.groupsById !== nextCohort.groupsById
                || previous.groupsSize !== nextCohort.groupsSize
                || previous.firstGroup !== nextCohort.firstGroup
                || previous.sourcesByKey !== nextCohort.sourcesByKey
                || previous.sourcesSize !== nextCohort.sourcesSize
                || previous.firstSource !== nextCohort.firstSource
                || previous.activeIsolationGroupId !== nextCohort.activeIsolationGroupId
            );
            if (invalidated) {
                derivedGroupEffectiveStateCache = new Map();
            }
            derivedGroupEffectiveStateCohort = nextCohort;
            return invalidated;
        }

        function getSourceWindowOverscan() {
            const configured = Number(deps.sourceWindowOverscan);
            return Number.isFinite(configured)
                ? Math.max(0, Math.floor(configured))
                : DEFAULT_SOURCE_WINDOW_OVERSCAN;
        }

        function getSourceWindowRowHeight() {
            const configured = Number(deps.sourceWindowRowHeight);
            if (Number.isFinite(configured) && configured > 0) {
                return configured;
            }
            return estimatedSourceWindowRowHeight;
        }

        function updateEstimatedSourceWindowRowHeight(listContainer) {
            if (hasMeasuredSourceWindowRowHeight) {
                return estimatedSourceWindowRowHeight;
            }
            if (!listContainer || typeof listContainer.querySelector !== 'function') {
                return estimatedSourceWindowRowHeight;
            }

            const row = listContainer.querySelector('.source-item:not(.dragging)')
                || listContainer.querySelector('.source-item');
            if (!row || typeof row.getBoundingClientRect !== 'function') {
                return estimatedSourceWindowRowHeight;
            }

            const measuredHeight = Number(row.getBoundingClientRect()?.height);
            if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
                return estimatedSourceWindowRowHeight;
            }

            let marginHeight = 0;
            const win = typeof deps.getWindow === 'function'
                ? deps.getWindow()
                : (typeof window !== 'undefined' ? window : null);
            if (win && typeof win.getComputedStyle === 'function') {
                const style = win.getComputedStyle(row);
                marginHeight = (
                    Number.parseFloat(style?.marginTop || '0')
                    + Number.parseFloat(style?.marginBottom || '0')
                );
                if (!Number.isFinite(marginHeight)) marginHeight = 0;
            }

            const nextHeight = Math.min(160, Math.max(28, measuredHeight + marginHeight));
            estimatedSourceWindowRowHeight = (
                (estimatedSourceWindowRowHeight * 3)
                + nextHeight
            ) / 4;
            hasMeasuredSourceWindowRowHeight = true;
            return estimatedSourceWindowRowHeight;
        }

        function resolveSourceWindowRange(listContainer, logicalSourceCount) {
            const count = Math.max(0, Number(logicalSourceCount) || 0);
            const overscan = getSourceWindowOverscan();
            const active = count >= getSourceWindowThreshold();
            if (!active) {
                return {
                    active: false,
                    start: 0,
                    end: count,
                    overscan,
                    rowHeight: getSourceWindowRowHeight()
                };
            }

            const rowHeight = Math.max(1, getSourceWindowRowHeight());
            const scrollTop = Math.max(0, Number(listContainer?.scrollTop) || 0);
            const viewportHeight = Math.max(
                rowHeight,
                Number(listContainer?.clientHeight) || DEFAULT_SOURCE_WINDOW_VIEWPORT_HEIGHT
            );
            const firstViewportIndex = Math.floor(scrollTop / rowHeight);
            const viewportRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
            const start = Math.max(0, firstViewportIndex - overscan);
            const end = Math.min(
                count,
                firstViewportIndex + viewportRowCount + overscan
            );

            return {
                active: true,
                start,
                end,
                overscan,
                rowHeight
            };
        }

        function resolveSourceKeyFromElement(element) {
            if (!element) return '';
            if (element.dataset?.sourceKey) return String(element.dataset.sourceKey);
            if (typeof element.closest === 'function') {
                const row = element.closest('.source-item');
                if (row?.dataset?.sourceKey) return String(row.dataset.sourceKey);
            }

            let current = element.parentElement || element.parentNode || null;
            let depth = 0;
            while (current && depth < 16) {
                if (current.dataset?.sourceKey && elementHasClass(current, 'source-item')) {
                    return String(current.dataset.sourceKey);
                }
                current = current.parentElement || current.parentNode || null;
                depth += 1;
            }
            return '';
        }

        function isSourceWindowDragActive(listContainer) {
            return Boolean(
                listContainer
                && (
                    elementHasClass(listContainer, 'sp-drag-active')
                    || listContainer.dataset?.dragActive === 'true'
                )
            );
        }

        function collectRenderedDragSourceKeys(listContainer) {
            const keys = new Set();
            if (!listContainer || typeof listContainer.querySelectorAll !== 'function') {
                return keys;
            }

            [
                '.source-item.dragging',
                '.source-item.drag-over-top',
                '.source-item.drag-over-bottom',
                '.source-item.sp-pseudo-hover'
            ].forEach((selector) => {
                Array.from(listContainer.querySelectorAll(selector) || []).forEach((row) => {
                    const sourceKey = resolveSourceKeyFromElement(row);
                    if (sourceKey) keys.add(sourceKey);
                });
            });
            return keys;
        }

        function collectSourceWindowPinnedKeys(listContainer) {
            const pinnedKeys = new Set();
            const activeActionSourceKey = getActiveSourceActionSourceKey();
            if (activeActionSourceKey) pinnedKeys.add(String(activeActionSourceKey));

            const shadowRoot = getShadowRoot();
            const activeElement = shadowRoot?.activeElement || getDocument()?.activeElement || null;
            const focusedSourceKey = resolveSourceKeyFromElement(activeElement);
            if (focusedSourceKey) pinnedKeys.add(focusedSourceKey);

            if (isSourceWindowDragActive(listContainer)) {
                collectRenderedDragSourceKeys(listContainer).forEach((key) => {
                    dragPinnedSourceKeys.add(key);
                });
                dragPinnedSourceKeys.forEach((key) => pinnedKeys.add(key));
            } else {
                dragPinnedSourceKeys = new Set();
            }

            if (typeof deps.getSourceWindowPinnedKeys === 'function') {
                const externalKeys = deps.getSourceWindowPinnedKeys();
                if (externalKeys && typeof externalKeys[Symbol.iterator] === 'function') {
                    for (const key of externalKeys) {
                        if (key) pinnedKeys.add(String(key));
                    }
                }
            }

            return pinnedKeys;
        }

        function shouldMaterializeWindowedSource(sourceKey, ordinal, windowRange, pinnedKeys) {
            if (!windowRange?.active) return true;
            if (pinnedKeys?.has(String(sourceKey || ''))) return true;
            return ordinal >= windowRange.start && ordinal < windowRange.end;
        }

        function updateSourceWindowSpacer(spacer, startOrdinal, endOrdinal, rowHeight) {
            if (!spacer) return spacer;
            const start = Math.max(0, Number(startOrdinal) || 0);
            const end = Math.max(start, Number(endOrdinal) || start);
            const rowCount = Math.max(0, end - start);
            const height = Math.max(0, rowCount * rowHeight);
            const spacerKey = `${start}:${end}`;
            const style = `height:${height}px;min-height:${height}px;pointer-events:none;`;

            if (spacer.dataset) {
                spacer.dataset.sourceWindowSpacerKey = spacerKey;
                spacer.dataset.sourceWindowStart = String(start);
                spacer.dataset.sourceWindowEnd = String(end);
                spacer.dataset.sourceWindowRows = String(rowCount);
            }
            if (typeof spacer.setAttribute === 'function') {
                spacer.setAttribute('data-source-window-spacer-key', spacerKey);
                spacer.setAttribute('data-source-window-start', String(start));
                spacer.setAttribute('data-source-window-end', String(end));
                spacer.setAttribute('data-source-window-rows', String(rowCount));
                spacer.setAttribute('style', style);
            } else if (spacer.attrs) {
                spacer.attrs.style = style;
            }
            return spacer;
        }

        function createSourceWindowSpacer(startOrdinal, endOrdinal, rowHeight) {
            const spacer = el('div', {
                className: 'sp-source-window-spacer',
                role: 'presentation',
                'aria-hidden': 'true'
            });
            return updateSourceWindowSpacer(spacer, startOrdinal, endOrdinal, rowHeight);
        }

        function appendSourceRenderResult(target, result, rowHeight) {
            if (!target || !result) return false;
            const append = Array.isArray(target)
                ? (node) => target.push(node)
                : (node) => target.appendChild(node);
            const children = Array.isArray(target)
                ? target
                : Array.from(target.childNodes || []);

            if (!result.__spSourceWindowOmission) {
                append(result);
                return true;
            }

            const prior = children[children.length - 1] || null;
            if (
                prior
                && elementHasClass(prior, 'sp-source-window-spacer')
                && Number(prior.dataset?.sourceWindowEnd) === result.ordinal
            ) {
                updateSourceWindowSpacer(
                    prior,
                    Number(prior.dataset?.sourceWindowStart) || 0,
                    result.ordinal + 1,
                    rowHeight
                );
                return true;
            }

            append(createSourceWindowSpacer(
                result.ordinal,
                result.ordinal + 1,
                rowHeight
            ));
            return true;
        }

        function setSourceWindowMetadata(listContainer, metadata) {
            lastSourceWindowMetadata = Object.assign({}, metadata);
            if (!listContainer) return lastSourceWindowMetadata;

            const values = {
                sourceWindowingActive: metadata.active ? 'true' : 'false',
                logicalTotal: String(metadata.logicalTotal),
                logicalVisible: String(metadata.logicalVisible),
                logicalSourceCount: String(metadata.logicalSourceCount),
                visibleLogicalSourceCount: String(metadata.visibleLogicalSourceCount),
                materializedSources: String(metadata.materializedSources),
                materializedSourceCount: String(metadata.materializedSourceCount),
                renderGeneration: String(metadata.renderGeneration),
                windowStart: String(metadata.start),
                windowEnd: String(metadata.end),
                sourceWindowStart: String(metadata.start),
                sourceWindowEnd: String(metadata.end),
                pinnedCount: String(metadata.pinnedCount),
                sourceWindowOverscan: String(metadata.overscan),
                pendingSelected: String(metadata.pendingSelected ?? 0),
                visibleSelected: String(metadata.visibleSelected ?? 0),
                hiddenSelected: String(metadata.hiddenSelected ?? 0),
                visibleBatchOperable: String(metadata.visibleBatchOperable ?? 0)
            };
            Object.entries(values).forEach(([key, value]) => {
                if (listContainer.dataset) {
                    listContainer.dataset[key] = value;
                    return;
                }
                const attributeName = `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
                listContainer.setAttribute?.(attributeName, value);
            });
            return lastSourceWindowMetadata;
        }

        function bindSourceWindowingScroll(listContainer) {
            if (
                !listContainer
                || listContainer.__spSourceWindowScrollBound
                || typeof listContainer.addEventListener !== 'function'
            ) {
                return false;
            }

            listContainer.addEventListener('scroll', () => {
                if (listContainer.dataset?.sourceWindowingActive !== 'true') return;
                scheduleRender();
            }, { passive: true });
            listContainer.__spSourceWindowScrollBound = true;
            return true;
        }

        function normalizeVisibleQuickViewKinds(value) {
            if (!Array.isArray(value)) return [...QUICK_VIEW_BUTTON_KINDS];
            const requestedKinds = new Set(value.map((kind) => String(kind || '').trim().toLowerCase()));
            return QUICK_VIEW_BUTTON_KINDS.filter((kind) => requestedKinds.has(kind));
        }

        function getCappedMotionIndex(index) {
            const normalizedIndex = Number.isFinite(index) ? Math.max(0, index) : 0;
            return Math.min(normalizedIndex, MOTION_STAGGER_MAX_INDEX);
        }

        function setElementStyleProperty(element, name, value) {
            if (!element || !element.style) return;
            if (typeof element.style.setProperty === 'function') {
                element.style.setProperty(name, value);
                return;
            }
            element.style[name] = value;
        }

        function removeElementStyleProperty(element, name) {
            if (!element || !element.style) return;
            if (typeof element.style.removeProperty === 'function') {
                element.style.removeProperty(name);
                return;
            }
            delete element.style[name];
        }

        function clearSpotlightSurface(surface) {
            if (!surface) return null;
            if (surface.classList && typeof surface.classList.remove === 'function') {
                surface.classList.remove('is-spotlight-active');
            }
            removeElementStyleProperty(surface, '--sp-spotlight-x');
            removeElementStyleProperty(surface, '--sp-spotlight-y');
            return surface;
        }

        function resolveSpotlightSurface(target) {
            if (!target) return null;
            if (typeof target.closest === 'function') {
                return target.closest(SPOTLIGHT_SURFACE_SELECTOR);
            }
            return null;
        }

        function updateSpotlightSurfaceFromPointer(surface, event) {
            if (!surface || !event || typeof surface.getBoundingClientRect !== 'function') return null;

            const rect = surface.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width || 0, Number(event.clientX) - rect.left));
            const y = Math.max(0, Math.min(rect.height || 0, Number(event.clientY) - rect.top));

            setElementStyleProperty(surface, '--sp-spotlight-x', `${Math.round(x)}px`);
            setElementStyleProperty(surface, '--sp-spotlight-y', `${Math.round(y)}px`);
            if (surface.classList && typeof surface.classList.add === 'function') {
                surface.classList.add('is-spotlight-active');
            }
            return surface;
        }

        function handleSpotlightPointerMove(event, listContainer) {
            if (!listContainer) return null;
            // When the hover-spotlight appearance preference is off, the surface ::before is
            // display:none, so skip the per-move getBoundingClientRect + custom-property writes
            // entirely (zero visual effect for opted-out users).
            const spotlightHost = getShadowRoot()?.host;
            if (spotlightHost && spotlightHost.classList && spotlightHost.classList.contains('sp-appearance-no-spotlight')) {
                return null;
            }
            const surface = resolveSpotlightSurface(event?.target);
            const previousSurface = listContainer.__spActiveSpotlightSurface || null;

            if (!surface) {
                clearSpotlightSurface(previousSurface);
                listContainer.__spActiveSpotlightSurface = null;
                return null;
            }

            if (previousSurface && previousSurface !== surface) {
                clearSpotlightSurface(previousSurface);
            }

            listContainer.__spActiveSpotlightSurface = surface;
            return updateSpotlightSurfaceFromPointer(surface, event);
        }

        function handleSpotlightPointerLeave(event, listContainer) {
            if (!listContainer) return null;
            const previousSurface = listContainer.__spActiveSpotlightSurface || null;
            listContainer.__spActiveSpotlightSurface = null;
            return clearSpotlightSurface(previousSurface);
        }

        function bindSpotlightPointerTracking(listContainer) {
            if (
                !listContainer ||
                listContainer.__spSpotlightTrackingBound ||
                typeof listContainer.addEventListener !== 'function'
            ) {
                return;
            }

            listContainer.addEventListener('pointermove', (event) => handleSpotlightPointerMove(event, listContainer));
            listContainer.addEventListener('pointerleave', (event) => handleSpotlightPointerLeave(event, listContainer));
            listContainer.__spSpotlightTrackingBound = true;
        }

        function getNormalizedSearchQuery(state) {
            return String(state?.filterQuery || '').trim().toLowerCase();
        }

        function sourceMatchesSearchQuery(source, query) {
            const criteria = typeof query === 'string' ? parseSearchQuery(query) : query;
            if (!source || !criteria || !criteria.hasQuery) return false;
            return searchSemantics.matchesSource(source, criteria);
        }

        function createHighlightedTextChildren(value, terms) {
            const text = String(value || '');
            const segments = searchSemantics.segmentText(text, terms);
            if (segments.length === 0) return [text];
            return segments.map((segment) => (
                segment.matched
                    ? el('span', { className: 'sp-search-highlight' }, [segment.text])
                    : segment.text
            ));
        }

        function updateSearchResultCount(query, sourceCount, folderCount = 0) {
            const shadowRoot = getShadowRoot();
            const countEl = shadowRoot?.getElementById?.('sp-search-count');
            if (!countEl) return;
            const criteria = parseSearchQuery(query || '');
            if (!criteria.hasQuery) {
                countEl.hidden = true;
                countEl.textContent = '';
                return;
            }
            countEl.hidden = false;
            countEl.textContent = getMessage('ui_search_results_summary', [
                String(sourceCount),
                String(folderCount)
            ]);
        }

        function collectSearchExpandedGroupIds(groupIds, query = null) {
            const normalizedQuery = query == null
                ? getNormalizedSearchQuery(getState())
                : String(query || '');
            const searchCriteria = parseSearchQuery(normalizedQuery);
            const expandedGroupIds = new Set();
            if (!searchCriteria.hasQuery) return expandedGroupIds;

            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const sourceMatchCache = new Map();
            const descendantMatchByGroupId = new Map();
            const visitStateByGroupId = new Map();
            const roots = Array.isArray(groupIds) ? groupIds : [];

            for (let rootIndex = roots.length - 1; rootIndex >= 0; rootIndex -= 1) {
                const rootGroupId = roots[rootIndex];
                if (!rootGroupId || visitStateByGroupId.get(rootGroupId) === 'done') continue;

                const stack = [{ groupId: rootGroupId, exiting: false }];
                while (stack.length > 0) {
                    const frame = stack.pop();
                    const group = groupsById.get(frame.groupId);
                    if (!group) continue;

                    if (!frame.exiting) {
                        const visitState = visitStateByGroupId.get(group.id);
                        if (visitState === 'done' || visitState === 'visiting') continue;
                        visitStateByGroupId.set(group.id, 'visiting');
                        stack.push({ groupId: group.id, exiting: true });

                        const children = Array.isArray(group.children) ? group.children : [];
                        for (let index = children.length - 1; index >= 0; index -= 1) {
                            const child = children[index];
                            if (child?.type !== 'group') continue;
                            if (visitStateByGroupId.get(child.id) === 'visiting') continue;
                            stack.push({ groupId: child.id, exiting: false });
                        }
                        continue;
                    }

                    let hasMatchingDescendant = false;
                    const children = Array.isArray(group.children) ? group.children : [];
                    for (const child of children) {
                        if (child?.type === 'source') {
                            if (!sourceMatchCache.has(child.key)) {
                                const source = sourcesByKey.get(child.key);
                                sourceMatchCache.set(child.key, Boolean(
                                    source
                                    && sourceMatchesSearchQuery(source, searchCriteria)
                                    && sourceMatchesCurrentFilters(source)
                                ));
                            }
                            if (sourceMatchCache.get(child.key)) {
                                hasMatchingDescendant = true;
                                break;
                            }
                            continue;
                        }

                        if (
                            child?.type === 'group'
                            && descendantMatchByGroupId.get(child.id)
                        ) {
                            hasMatchingDescendant = true;
                            break;
                        }
                    }

                    descendantMatchByGroupId.set(group.id, hasMatchingDescendant);
                    visitStateByGroupId.set(group.id, 'done');
                    if (hasMatchingDescendant) expandedGroupIds.add(group.id);
                }
            }
            return expandedGroupIds;
        }

        function parseCountValue(value) {
            const parsed = Number.parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
            return Number.isFinite(parsed) ? parsed : null;
        }

        function createBatchCountMessageChildren(messageKey, count, countId) {
            const countText = String(count);
            const markerMessage = getMessage(messageKey, [BATCH_COUNT_MARKER]);
            if (typeof markerMessage !== 'string' || !markerMessage.includes(BATCH_COUNT_MARKER)) {
                return [getMessage(messageKey, [countText])];
            }

            const markerIndex = markerMessage.indexOf(BATCH_COUNT_MARKER);
            const prefix = markerMessage.slice(0, markerIndex);
            const suffix = markerMessage.slice(markerIndex + BATCH_COUNT_MARKER.length);
            const children = [];

            if (prefix) children.push(prefix);
            children.push(el('span', {
                className: 'sp-count-up-number',
                dataset: {
                    countId,
                    countValue: countText
                }
            }, [countText]));
            if (suffix) children.push(suffix);

            return children;
        }

        function collectBatchCountSnapshot(container) {
            const snapshot = new Map();
            if (!container || typeof container.querySelectorAll !== 'function') return snapshot;

            Array.from(container.querySelectorAll('.sp-count-up-number[data-count-id]')).forEach((node) => {
                const countId = node?.dataset?.countId || node?.getAttribute?.('data-count-id');
                const rawValue = node?.textContent || node?.dataset?.countValue || node?.getAttribute?.('data-count-value');
                const value = parseCountValue(rawValue);
                if (countId && value !== null) {
                    snapshot.set(countId, value);
                }
            });

            return snapshot;
        }

        function isReducedMotionPreferred() {
            const win = typeof window !== 'undefined' ? window : null;
            return Boolean(
                win &&
                typeof win.matchMedia === 'function' &&
                win.matchMedia('(prefers-reduced-motion: reduce)').matches
            );
        }

        function animateBatchCountElement(element, fromValue, toValue) {
            if (!element || fromValue === toValue) return false;

            const win = typeof window !== 'undefined' ? window : null;
            const requestFrame = win && typeof win.requestAnimationFrame === 'function'
                ? win.requestAnimationFrame.bind(win)
                : null;
            const cancelFrame = win && typeof win.cancelAnimationFrame === 'function'
                ? win.cancelAnimationFrame.bind(win)
                : null;

            if (isReducedMotionPreferred() || !requestFrame) {
                element.textContent = String(toValue);
                return false;
            }

            if (element.__spCountTweenFrame && cancelFrame) {
                cancelFrame(element.__spCountTweenFrame);
            }

            element.textContent = String(fromValue);
            let startTime = null;
            const easeOutCubic = (progress) => 1 - Math.pow(1 - progress, 3);
            const step = (timestamp) => {
                if (startTime === null) startTime = timestamp;
                const progress = Math.min(1, (timestamp - startTime) / COUNT_UP_DURATION_MS);
                const eased = easeOutCubic(progress);
                const nextValue = Math.round(fromValue + ((toValue - fromValue) * eased));
                element.textContent = String(nextValue);

                if (progress < 1) {
                    element.__spCountTweenFrame = requestFrame(step);
                    return;
                }

                element.textContent = String(toValue);
                element.__spCountTweenFrame = null;
            };

            element.__spCountTweenFrame = requestFrame(step);
            return true;
        }

        function animateBatchCountChanges(container, previousSnapshot) {
            if (
                !previousSnapshot ||
                previousSnapshot.size === 0 ||
                !container ||
                typeof container.querySelectorAll !== 'function'
            ) {
                return 0;
            }

            let animatedCount = 0;
            Array.from(container.querySelectorAll('.sp-count-up-number[data-count-id]')).forEach((node) => {
                const countId = node?.dataset?.countId || node?.getAttribute?.('data-count-id');
                if (!countId || !previousSnapshot.has(countId)) return;

                const fromValue = previousSnapshot.get(countId);
                const rawTargetValue = node?.dataset?.countValue || node?.getAttribute?.('data-count-value') || node?.textContent;
                const toValue = parseCountValue(rawTargetValue);
                if (fromValue === null || toValue === null || fromValue === toValue) return;

                if (animateBatchCountElement(node, fromValue, toValue)) {
                    animatedCount += 1;
                }
            });

            return animatedCount;
        }

        function getGroupEffectiveState(group) {
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const visitedGroupIds = new Set();
            const descendantKeys = new Set();
            const stack = group ? [group] : [];

            while (stack.length > 0) {
                const currentGroup = stack.pop();
                if (!currentGroup || visitedGroupIds.has(currentGroup.id)) continue;
                visitedGroupIds.add(currentGroup.id);

                const children = Array.isArray(currentGroup.children)
                    ? currentGroup.children
                    : [];
                for (const child of children) {
                    if (child?.type === 'source') {
                        if (child.key) descendantKeys.add(child.key);
                        continue;
                    }
                    if (child?.type === 'group') {
                        const childGroup = groupsById.get(child.id);
                        if (childGroup) stack.push(childGroup);
                    }
                }
            }

            const total = descendantKeys.size;
            let on = 0;
            descendantKeys.forEach((key) => {
                if (isSourceEffectivelyEnabled(sourcesByKey.get(key))) on += 1;
            });

            return { on, total };
        }

        function getStablePatchKey(node) {
            if (!node || node.nodeType !== 1) return '';
            const dataset = node.dataset || {};
            if (dataset.sourceKey && elementHasClass(node, 'source-item')) {
                return `source:${dataset.sourceKey}`;
            }
            if (dataset.sourceWindowSpacerKey && elementHasClass(node, 'sp-source-window-spacer')) {
                return `source-window:${dataset.sourceWindowSpacerKey}`;
            }
            if (dataset.groupId && elementHasClass(node, 'group-container')) {
                return `group:${dataset.groupId}`;
            }
            if (dataset.quickViewKind) {
                return `quick-view:${dataset.quickViewKind}`;
            }
            const id = node.id || node.getAttribute?.('id');
            if (id) return `id:${id}`;
            if (elementHasClass(node, 'ungrouped-section')) return 'region:ungrouped';
            if (elementHasClass(node, 'sp-batch-action-bar')) return 'region:batch-actions';
            if (elementHasClass(node, 'sp-contextual-empty-list-item')) return 'region:empty';
            return '';
        }

        function patchChildNodeList(target, sourceChildren) {
            if (!target || typeof target.appendChild !== 'function') return;
            const initialChildren = Array.from(target.childNodes || []);
            const usedTargets = new Set();
            const keyedTargets = new Map();
            const unkeyedTargets = [];

            initialChildren.forEach((candidate) => {
                const key = getStablePatchKey(candidate);
                if (!key) {
                    unkeyedTargets.push(candidate);
                    return;
                }
                const bucket = keyedTargets.get(key) || { nodes: [], index: 0 };
                bucket.nodes.push(candidate);
                keyedTargets.set(key, bucket);
            });
            let unkeyedCursor = 0;

            const takeKeyedTarget = (key) => {
                const bucket = keyedTargets.get(key);
                if (!bucket) return null;
                while (bucket.index < bucket.nodes.length) {
                    const candidate = bucket.nodes[bucket.index];
                    bucket.index += 1;
                    if (!usedTargets.has(candidate)) return candidate;
                }
                return null;
            };
            const takeUnkeyedTarget = () => {
                while (unkeyedCursor < unkeyedTargets.length) {
                    const candidate = unkeyedTargets[unkeyedCursor];
                    unkeyedCursor += 1;
                    if (!usedTargets.has(candidate)) return candidate;
                }
                return null;
            };

            sourceChildren.forEach((sourceChild, sourceIndex) => {
                const sourceKey = getStablePatchKey(sourceChild);
                let targetChild = sourceKey
                    ? takeKeyedTarget(sourceKey)
                    : takeUnkeyedTarget();
                const insertionTarget = target.childNodes?.[sourceIndex] || null;

                if (!targetChild) {
                    const clonedChild = sourceChild.cloneNode(true);
                    if (insertionTarget && typeof target.insertBefore === 'function') {
                        target.insertBefore(clonedChild, insertionTarget);
                    } else {
                        target.appendChild(clonedChild);
                    }
                    usedTargets.add(clonedChild);
                    return;
                }

                if (
                    targetChild !== insertionTarget
                    && typeof target.insertBefore === 'function'
                ) {
                    target.insertBefore(targetChild, insertionTarget || null);
                }
                const patchedTarget = patchNode(targetChild, sourceChild);
                usedTargets.add(patchedTarget || targetChild);
            });

            Array.from(target.childNodes || []).forEach((targetChild) => {
                if (!usedTargets.has(targetChild) && typeof target.removeChild === 'function') {
                    target.removeChild(targetChild);
                }
            });
        }

        function patchNode(target, source) {
            if (target.nodeType !== source.nodeType) {
                const replacement = source.cloneNode(true);
                target.parentNode.replaceChild(replacement, target);
                return replacement;
            }
            if (target.nodeType === 3) {
                if (target.textContent !== source.textContent) {
                    target.textContent = source.textContent;
                }
                return target;
            }
            if (target.nodeName !== source.nodeName) {
                const replacement = source.cloneNode(true);
                target.parentNode.replaceChild(replacement, target);
                return replacement;
            }

            const targetAttrs = target.attributes;
            const sourceAttrs = source.attributes;
            for (let i = targetAttrs.length - 1; i >= 0; i--) {
                const name = targetAttrs[i].name;
                if (!source.hasAttribute(name)) {
                    target.removeAttribute(name);
                }
            }
            for (let i = 0; i < sourceAttrs.length; i++) {
                const name = sourceAttrs[i].name;
                const value = sourceAttrs[i].value;
                if (target.getAttribute(name) !== value) {
                    target.setAttribute(name, value);
                }
            }

            if (target.tagName === 'INPUT') {
                if (target.checked !== source.checked) target.checked = source.checked;
                if (target.value !== source.value) target.value = source.value;
                if (target.disabled !== source.disabled) target.disabled = source.disabled;
            }

            const sourceChildren = Array.from(source.childNodes);
            patchChildNodeList(target, sourceChildren);
            return target;
        }

        function patchChildren(target, sourceFragment) {
            if (!target || !sourceFragment || typeof target.appendChild !== 'function') return;
            const sourceChildren = Array.from(sourceFragment.childNodes || []);
            patchChildNodeList(target, sourceChildren);
        }

        function renderViewStateBar(sourceViewInfoOverride = null) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const container = shadowRoot.getElementById('sp-view-state');
            if (!container) return;

            const doc = getDocument();
            const fragment = doc ? doc.createDocumentFragment() : null;
            if (!fragment) return;
            const groupsById = getGroupsById();
            const state = getState() || {};
            const isolatedGroup = getActiveIsolationGroupId() ? groupsById.get(getActiveIsolationGroupId()) : null;
            const activeTag = state.activeTagId ? getTagsById().get(state.activeTagId) : null;
            const sourceViewInfo = sourceViewInfoOverride || getSourceViewInfo() || {};
            const nativeLabelPreview = sourceViewInfo.kind === 'label'
                ? (getNativeLabelImportPreview({ viewInfo: sourceViewInfo }) || {})
                : {};
            const nativeLabelImportSummary = getLastNativeLabelImportSummary() || null;
            const nativeSelectionSyncFailure = getNativeSelectionSyncFailure() || null;

            if (nativeSelectionSyncFailure) {
                const reason = String(
                    nativeSelectionSyncFailure.reason
                    || nativeSelectionSyncFailure.code
                    || 'unknown'
                );
                fragment.appendChild(el('div', {
                    className: 'sp-view-banner sp-view-banner-error',
                    role: 'alert',
                    dataset: { nativeSelectionSyncFailure: 'true' }
                }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [
                            getMessage('ui_native_selection_sync_failed', [reason])
                        ])
                    ]),
                    el('button', {
                        type: 'button',
                        className: 'sp-button sp-view-banner-btn',
                        id: 'sp-retry-native-selection-sync-btn'
                    }, [getMessage('ui_retry')])
                ]));
            }

            if (sourceViewInfo.kind === 'label') {
                fragment.appendChild(el('div', { className: 'sp-view-banner sp-native-label-view-banner' }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [getMessage('ui_native_label_view_active')]),
                        nativeLabelImportSummary
                            ? el('span', { className: 'sp-view-banner-meta' }, [
                                getMessage('ui_import_native_labels_imported_status', [
                                    String(nativeLabelImportSummary.labelCount || 0),
                                    String(nativeLabelImportSummary.sourceCount || 0)
                                ])
                            ])
                            : null
                    ]),
                    el('button', {
                        className: 'sp-button sp-view-banner-btn',
                        id: 'sp-import-native-labels-btn',
                        title: nativeLabelPreview.ok ? null : getMessage('ui_import_native_labels_unavailable')
                    }, [getMessage('ui_import_native_labels')])
                ]));
            }

            if (isolatedGroup) {
                fragment.appendChild(el('div', { className: 'sp-view-banner' }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [getMessage('ui_isolation_active', [isolatedGroup.title])])
                    ]),
                    el('button', { className: 'sp-button sp-view-banner-btn', id: 'sp-clear-isolate-btn' }, [getMessage('ui_exit_isolate')])
                ]));
            }

            if (activeTag) {
                fragment.appendChild(el('div', { className: 'sp-view-banner' }, [
                    el('div', { className: 'sp-view-banner-copy' }, [
                        el('span', { className: 'sp-view-banner-label' }, [getMessage('ui_tag_filter_active', [activeTag.label])])
                    ]),
                    el('button', { className: 'sp-button sp-view-banner-btn', id: 'sp-clear-tag-filter-btn' }, [getMessage('ui_clear_tag_filter')])
                ]));
            }

            container.hidden = fragment.childNodes.length === 0;
            patchChildren(container, fragment);
            const importNativeLabelsButton = container.querySelector?.('#sp-import-native-labels-btn');
            if (importNativeLabelsButton && typeof handleInteraction === 'function') {
                importNativeLabelsButton.onclick = (event) => {
                    event.preventDefault?.();
                    handleInteraction(event);
                };
            }
            const retryNativeSelectionButton = container.querySelector?.(
                '#sp-retry-native-selection-sync-btn'
            );
            if (retryNativeSelectionButton) {
                retryNativeSelectionButton.onclick = async (event) => {
                    event.preventDefault?.();
                    retryNativeSelectionButton.disabled = true;
                    retryNativeSelectionButton.setAttribute?.('aria-busy', 'true');
                    try {
                        await retryNativeSelectionSync(nativeSelectionSyncFailure);
                    } finally {
                        renderViewStateBar();
                    }
                };
            }
        }

        function renderQuickViewRail() {
            const shadowRoot = getShadowRoot();
            const container = shadowRoot?.getElementById?.('sp-quick-view-rail');
            if (!container) return;

            const doc = getDocument();
            const fragment = doc ? doc.createDocumentFragment() : null;
            if (!fragment) return;

            const state = getState() || {};
            const activeQuickViewKind = String(state.activeQuickViewKind || '');
            const hasActiveTag = Boolean(state.activeTagId);
            const visibleQuickViewKinds = normalizeVisibleQuickViewKinds(getVisibleQuickViewKinds());
            const quickViewOptions = [
                ['all', 'ui_quick_view_all'],
                ['ungrouped', 'ui_quick_view_ungrouped'],
                ['disabled', 'ui_quick_view_disabled'],
                ['tag', 'ui_quick_view_tag'],
                ['recent', 'ui_quick_view_recent'],
                ['issues', 'ui_quick_view_issues']
            ].filter(([kind]) => visibleQuickViewKinds.includes(kind));

            container.hidden = quickViewOptions.length === 0;
            quickViewOptions.forEach(([kind, labelKey]) => {
                const active = kind === 'all'
                    ? !activeQuickViewKind && !hasActiveTag
                    : (kind === 'tag' ? hasActiveTag : activeQuickViewKind === kind);
                fragment.appendChild(el('button', {
                    type: 'button',
                    className: 'sp-quick-view-btn sp-glare-hover' + (active ? ' is-active' : ''),
                    dataset: { quickViewKind: kind },
                    'aria-pressed': active ? 'true' : 'false',
                    title: getMessage(labelKey)
                }, [getMessage(labelKey)]));
            });

            patchChildren(container, fragment);
        }

        function setContainerNativeLabelViewMode(container, enabled) {
            if (!container) return;
            const wasEnabled = elementHasClass(container, 'is-native-label-view');
            const classes = String(container.className || '')
                .split(/\s+/)
                .filter((className) => className && className !== 'is-native-label-view');
            if (enabled) {
                classes.push('is-native-label-view');
            }
            container.className = classes.join(' ');
            const dataset = container.dataset || null;
            if (enabled && !wasEnabled) {
                if (dataset && dataset.nativeLabelPreviousHeight == null) {
                    dataset.nativeLabelPreviousHeight = String(container.style?.height || '');
                }
                if (container.style) {
                    container.style.height = '';
                }
            } else if (!enabled && wasEnabled) {
                if (container.style && dataset && Object.prototype.hasOwnProperty.call(dataset, 'nativeLabelPreviousHeight')) {
                    container.style.height = dataset.nativeLabelPreviousHeight || '';
                    delete dataset.nativeLabelPreviousHeight;
                }
            }
        }

        function elementHasClass(element, className) {
            if (!element) return false;
            if (element.classList && typeof element.classList.contains === 'function') {
                if (element.classList.contains(className)) return true;
            }
            return String(element.className || '').split(/\s+/).includes(className);
        }

        function getRenderedSourceActionMenuItems(menu) {
            if (!menu || typeof menu.querySelectorAll !== 'function') return [];
            return Array.from(menu.querySelectorAll('.sp-source-actions-menu-item'))
                .filter((item) => item && typeof item.focus === 'function' && !item.disabled);
        }

        function findRenderedSourceActionMenu(layer, menuKind = 'main') {
            if (!layer || typeof layer.querySelectorAll !== 'function') return null;
            const menus = Array.from(layer.querySelectorAll('.sp-source-actions-menu'));
            return menus.find((menu) => {
                const kind = menu?.dataset?.menuKind;
                if (kind) return kind === menuKind;
                return menuKind === 'submenu'
                    ? elementHasClass(menu, 'sp-source-actions-submenu')
                    : !elementHasClass(menu, 'sp-source-actions-submenu');
            }) || null;
        }

        function focusSourceActionMenuButton(sourceKey) {
            const button = findSourceActionButton(sourceKey);
            if (button && typeof button.focus === 'function') {
                button.focus();
                return button;
            }
            return null;
        }

        function focusSourceActionMenuItem(menuKind = 'main', options = {}) {
            const layer = getSourceActionMenuLayer();
            const menu = findRenderedSourceActionMenu(layer, menuKind);
            const items = getRenderedSourceActionMenuItems(menu);
            if (items.length === 0) return null;

            const target = options.action
                ? items.find((item) => item?.dataset?.action === options.action)
                : items[Math.min(Math.max(Number(options.index) || 0, 0), items.length - 1)];
            if (target && typeof target.focus === 'function') {
                target.focus();
                return target;
            }
            return null;
        }

        function requestSourceActionMenuFocus(menuKind = 'main', options = {}) {
            pendingSourceActionMenuFocus = { menuKind, options };
        }

        function applyPendingSourceActionMenuFocus(sourceKey) {
            if (!sourceKey) {
                focusedSourceActionMenuKey = null;
                pendingSourceActionMenuFocus = null;
                return null;
            }

            if (!pendingSourceActionMenuFocus && focusedSourceActionMenuKey !== sourceKey) {
                requestSourceActionMenuFocus('main', { index: 0 });
            }

            if (!pendingSourceActionMenuFocus) return null;

            const { menuKind, options } = pendingSourceActionMenuFocus;
            pendingSourceActionMenuFocus = null;
            focusedSourceActionMenuKey = sourceKey;
            return focusSourceActionMenuItem(menuKind, options);
        }

        function focusAdjacentSourceActionMenuItem(currentItem, direction) {
            const menu = currentItem?.closest?.('.sp-source-actions-menu');
            const items = getRenderedSourceActionMenuItems(menu);
            if (items.length === 0) return null;

            const currentIndex = Math.max(0, items.indexOf(currentItem));
            let nextIndex = currentIndex;
            if (direction === 'first') nextIndex = 0;
            else if (direction === 'last') nextIndex = items.length - 1;
            else nextIndex = (currentIndex + direction + items.length) % items.length;

            const target = items[nextIndex];
            target?.focus?.();
            return target || null;
        }

        function handleSourceActionMenuKeydown(event) {
            const target = event?.target?.closest?.('.sp-source-actions-menu-item') || event?.target;
            if (!target || !elementHasClass(target, 'sp-source-actions-menu-item')) return false;

            const sourceKey = target.dataset?.sourceKey || getActiveSourceActionSourceKey();
            const action = target.dataset?.action || '';
            if (!sourceKey) return false;

            switch (event.key) {
            case 'Escape':
                event.preventDefault?.();
                closeSourceActionMenu();
                renderSourceActionMenuLayer();
                focusSourceActionMenuButton(sourceKey);
                return true;
            case 'ArrowDown':
                event.preventDefault?.();
                focusAdjacentSourceActionMenuItem(target, 1);
                return true;
            case 'ArrowUp':
                event.preventDefault?.();
                focusAdjacentSourceActionMenuItem(target, -1);
                return true;
            case 'Home':
                event.preventDefault?.();
                focusAdjacentSourceActionMenuItem(target, 'first');
                return true;
            case 'End':
                event.preventDefault?.();
                focusAdjacentSourceActionMenuItem(target, 'last');
                return true;
            case 'ArrowRight': {
                const submenuItems = getSourceActionSubmenuItems(sourceKey, action);
                if (submenuItems.length === 0) return false;
                event.preventDefault?.();
                setActiveSourceActionSubmenuAction(action);
                requestSourceActionMenuFocus('submenu', { index: 0 });
                renderSourceActionMenuLayer();
                return true;
            }
            case 'ArrowLeft': {
                const parentAction = getActiveSourceActionSubmenuAction();
                const currentMenu = target.closest?.('.sp-source-actions-menu');
                if (!parentAction || (!elementHasClass(currentMenu, 'sp-source-actions-submenu') && parentAction !== action)) {
                    return false;
                }
                event.preventDefault?.();
                setActiveSourceActionSubmenuAction(null);
                requestSourceActionMenuFocus('main', { action: parentAction });
                renderSourceActionMenuLayer();
                return true;
            }
            default:
                return false;
            }
        }

        function getSourceActionMenuLayer() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return null;

            let layer = shadowRoot.getElementById('sp-source-actions-layer');
            if (layer) return layer;

            const doc = getDocument();
            if (!doc) return null;
            layer = doc.createElement('div');
            layer.id = 'sp-source-actions-layer';
            layer.className = 'sp-source-actions-layer';
            if (typeof handleInteraction === 'function') {
                layer.addEventListener('click', handleInteraction);
            }
            layer.addEventListener('keydown', handleSourceActionMenuKeydown);
            shadowRoot.appendChild(layer);
            return layer;
        }

        function renderSourceActionMenuLayer() {
            const layer = getSourceActionMenuLayer();
            if (
                !layer ||
                !layer.childNodes ||
                typeof layer.appendChild !== 'function' ||
                typeof layer.removeChild !== 'function'
            ) {
                return;
            }

            const doc = getDocument();
            if (!doc) return;

            const fragment = doc.createDocumentFragment();
            const sourceKey = getActiveSourceActionSourceKey();
            const source = sourceKey ? getSourcesByKey().get(sourceKey) : null;

            const menuItems = getSourceActionMenuItems(sourceKey);
            const submenuAction = getActiveSourceActionSubmenuAction();
            const submenuItems = getSourceActionSubmenuItems(sourceKey, submenuAction);
            const submenuParentIndex = menuItems.findIndex((item) => item.action === submenuAction);
            const submenuParent = menuItems[submenuParentIndex] || null;
            const menuPosition = getSourceActionMenuPositionState();

            if (sourceKey && source && canOpenSourceActionMenu(source)) {
                const actionButton = findSourceActionButton(sourceKey);
                setSourceActionMenuPosition(getSourceActionMenuPosition(actionButton, menuItems.length));
            }

            const activeMenuPosition = getSourceActionMenuPositionState() || menuPosition;
            if (sourceKey && source && activeMenuPosition && canOpenSourceActionMenu(source)) {
                fragment.appendChild(el('div', {
                    className: 'sp-source-actions-menu' + (activeMenuPosition.placement === 'top' ? ' is-top' : ''),
                    role: 'menu',
                    dataset: { menuKind: 'main' },
                    'aria-label': getMessage('ui_source_actions'),
                    style: `top:${Math.round(activeMenuPosition.top)}px;left:${Math.round(activeMenuPosition.left)}px;`
                }, menuItems.map((item, index) => (
                    el('button', {
                        type: 'button',
                        className: 'sp-source-actions-menu-item' +
                            (item.kind === 'submenu' ? ' is-parent' : '') +
                            (submenuAction === item.action ? ' is-expanded' : ''),
                        dataset: { sourceKey, action: item.action },
                        role: 'menuitem',
                        disabled: item.disabled ? true : null,
                        style: `--sp-menu-item-index:${index};`,
                        title: item.label,
                        'aria-label': item.label,
                        'aria-disabled': item.disabled ? 'true' : null,
                        'aria-haspopup': item.kind === 'submenu' ? 'menu' : null,
                        'aria-expanded': item.kind === 'submenu'
                            ? (submenuAction === item.action ? 'true' : 'false')
                            : null
                    }, [
                        el('span', { className: 'sp-source-actions-menu-item-content' }, [
                            el('span', { className: 'google-symbols' }, [item.icon]),
                            el('span', { className: 'sp-source-actions-menu-label' }, [item.label])
                        ]),
                        item.kind === 'submenu'
                            ? el('span', { className: 'google-symbols sp-source-actions-menu-chevron' }, ['chevron_right'])
                            : ''
                    ])
                ))));

                const submenuPosition = getSourceActionSubmenuPosition(
                    activeMenuPosition,
                    submenuParentIndex,
                    submenuItems.length
                );
                if (submenuItems.length > 0 && submenuPosition) {
                    fragment.appendChild(el('div', {
                        className: 'sp-source-actions-menu sp-source-actions-submenu' +
                            (submenuPosition.horizontalPlacement === 'left' ? ' is-left' : ''),
                        role: 'menu',
                        dataset: { menuKind: 'submenu' },
                        'aria-label': submenuParent?.label || getMessage('ui_source_actions'),
                        style: `top:${Math.round(submenuPosition.top)}px;left:${Math.round(submenuPosition.left)}px;`
                    }, submenuItems.map((item, index) => (
                        el('button', {
                            type: 'button',
                            className: 'sp-source-actions-menu-item',
                            dataset: {
                                sourceKey,
                                action: item.action,
                                ...(item.direction ? { treeDirection: item.direction } : {})
                            },
                            role: 'menuitem',
                            disabled: item.disabled ? true : null,
                            style: `--sp-menu-item-index:${index};`,
                            title: item.label,
                            'aria-label': item.label,
                            'aria-disabled': item.disabled ? 'true' : null
                        }, [
                            el('span', { className: 'sp-source-actions-menu-item-content' }, [
                                el('span', { className: 'google-symbols' }, [item.icon]),
                                el('span', { className: 'sp-source-actions-menu-label' }, [item.label])
                            ])
                        ])
                    ))));
                }
            }

            patchChildren(layer, fragment);
            applyPendingSourceActionMenuFocus(sourceKey);
        }

        function createSourceGlyphIcon(iconName, iconColorClass) {
            return el('mat-icon', { className: `${iconColorClass || 'icon-color'} mat-icon google-symbols` }, [iconName]);
        }

        function createGroupTitleIconElement() {
            return el('span', { className: 'sp-group-title-icon', 'aria-hidden': 'true' }, [
                el('span', { className: 'google-symbols' }, ['folder'])
            ]);
        }

        function replaceSourceIconWithFallback(imageElement, source) {
            if (!imageElement || imageElement.__spFallbackApplied) return;
            imageElement.__spFallbackApplied = true;

            const parent = imageElement.parentNode;
            if (!parent) return;

            const fallbackIcon = createSourceGlyphIcon(source.iconName, source.iconColorClass);
            if (typeof parent.replaceChildren === 'function') {
                parent.replaceChildren(fallbackIcon);
                return;
            }

            if (Array.isArray(parent.childNodes)) {
                parent.childNodes.length = 0;
            }
            if (Array.isArray(parent.children)) {
                parent.children.length = 0;
            }
            if (typeof parent.appendChild === 'function') {
                parent.appendChild(fallbackIcon);
            }
        }

        function handleSourceIconImageError(event) {
            const imageElement = event?.target;
            if (!imageElement || imageElement.__spFallbackApplied) return;

            const className = typeof imageElement.className === 'string' ? imageElement.className : '';
            const isSourceIconImage = Boolean(
                imageElement.classList?.contains?.('source-icon-image') ||
                className.split(/\s+/).includes('source-icon-image')
            );
            if (!isSourceIconImage) return;

            const closestSourceRow = typeof imageElement.closest === 'function'
                ? imageElement.closest('.source-item')
                : null;
            const sourceKey = imageElement.dataset?.sourceKey || closestSourceRow?.dataset?.sourceKey || '';
            const source = (sourceKey && getSourcesByKey().get(sourceKey)) || {
                iconName: imageElement.dataset?.fallbackIconName || 'article',
                iconColorClass: imageElement.dataset?.fallbackIconColorClass || ''
            };

            replaceSourceIconWithFallback(imageElement, source);
        }

        function bindSourceIconFallbackDelegation(listContainer) {
            if (
                !listContainer ||
                listContainer.__spSourceIconFallbackBound ||
                typeof listContainer.addEventListener !== 'function'
            ) {
                return;
            }

            listContainer.addEventListener('error', handleSourceIconImageError, true);
            listContainer.__spSourceIconFallbackBound = true;
        }

        function createSourceIconElement(source, isFailed = false) {
            if (source?.isLoading) {
                return el('div', { className: 'sp-spinner' });
            }

            if (isFailed) {
                return createSourceGlyphIcon('error', source?.iconColorClass);
            }

            if (!source?.iconImageUrl) {
                return createSourceGlyphIcon(source?.iconName || 'article', source?.iconColorClass);
            }

            const imageEl = el('img', {
                className: 'source-icon-image',
                src: source.iconImageUrl,
                alt: '',
                draggable: 'false',
                referrerpolicy: 'no-referrer',
                dataset: {
                    sourceKey: source.key || '',
                    fallbackIconName: source.iconName || 'article',
                    fallbackIconColorClass: source.iconColorClass || ''
                }
            });
            if (typeof imageEl.addEventListener === 'function') {
                imageEl.addEventListener('error', (event) => handleSourceIconImageError({
                    target: event?.target || imageEl
                }));
            }
            return imageEl;
        }

        function render() {
            const performanceNow = () => {
                const win = typeof deps.getWindow === 'function'
                    ? deps.getWindow()
                    : (typeof window !== 'undefined' ? window : null);
                return typeof win?.performance?.now === 'function'
                    ? win.performance.now()
                    : Date.now();
            };
            const renderStartedAt = performanceNow();
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const listContainer = shadowRoot.querySelector('#sources-list');
            if (!listContainer) return;
            const container = shadowRoot.querySelector('.sp-container');
            sourceRenderGeneration += 1;

            // Reconcile batch selection against live sources: a selected source can vanish
            // (NotebookLM native delete / SPA rescan) without an explicit user-delete, leaving
            // a ghost key that inflates the delete-count badge and "Deleting N" toast. The set
            // is tiny and only non-empty in batch mode, so this prune is cheap.
            if (getState().isBatchMode) {
                const pendingBatchKeys = getPendingBatchKeys();
                const sourcesByKey = getSourcesByKey();
                if (pendingBatchKeys && typeof pendingBatchKeys.delete === 'function' && sourcesByKey) {
                    for (const batchKey of pendingBatchKeys) {
                        if (!sourcesByKey.has(batchKey)) pendingBatchKeys.delete(batchKey);
                    }
                }
            }
            bindSourceIconFallbackDelegation(listContainer);
            bindSpotlightPointerTracking(listContainer);
            bindSourceWindowingScroll(listContainer);
            updateEstimatedSourceWindowRowHeight(listContainer);
            syncActiveSourceActionMenuState();
            syncSearchUi();
            renderQuickViewRail();

            const doc = getDocument();
            if (!doc) return;
            const fragment = doc.createDocumentFragment();
            const sourceViewInfo = getSourceViewInfo() || {};
            const isNativeLabelView = sourceViewInfo.kind === 'label';
            setContainerNativeLabelViewMode(container, isNativeLabelView);
            updatePanelResizerAria(container, shadowRoot.querySelector('.sp-resizer'));
            renderViewStateBar(sourceViewInfo);
            if (isNativeLabelView) {
                if (typeof deps.onBeforeRowsPatch === 'function') {
                    try { deps.onBeforeRowsPatch(); } catch (_) { /* ignore hook errors */ }
                }
                patchChildren(listContainer, fragment);
                updateSearchResultCount('', 0);
                setSourceWindowMetadata(listContainer, {
                    active: false,
                    logicalTotal: 0,
                    logicalVisible: 0,
                    logicalSourceCount: 0,
                    visibleLogicalSourceCount: 0,
                    materializedSources: 0,
                    materializedSourceCount: 0,
                    renderGeneration: sourceRenderGeneration,
                    start: 0,
                    end: 0,
                    pinnedCount: 0,
                    overscan: getSourceWindowOverscan()
                });
                lastVisibleLogicalSourceKeys = [];
                renderSourceActionMenuLayer();
                return;
            }

            const state = getState() || {};
            const renderDirectionalTargetResolver = !state.isBatchMode
                && createDirectionalTargetResolver
                ? createDirectionalTargetResolver()
                : resolveDirectionalTarget;
            const activeFilters = hasActiveRenderFilters();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const sourceContextIndexRebuilt = (
                typeof searchSemantics.ensureSourceContextIndex === 'function'
                && searchSemantics.ensureSourceContextIndex(sourcesByKey)
            );
            const parentMap = getParentMap();
            const tagsById = getTagsById();
            const pendingBatchKeys = getPendingBatchKeys();
            const activeIsolationGroupId = getActiveIsolationGroupId();
            const rootEntries = Array.isArray(state.root) ? state.root : [];
            const derivedGroupCacheInvalidated = ensureDerivedGroupEffectiveStateCohort(
                state,
                groupsById,
                sourcesByKey,
                activeIsolationGroupId
            );
            const sourceFilterMatchCache = new Map();
            const sourceEffectiveStateCache = new Map();
            const groupEffectiveStateCache = new Map(derivedGroupEffectiveStateCache);
            let recomputedGroupEffectiveStateCount = 0;
            let sourceFilterMatchCount = 0;
            const matchesCurrentFilters = (source) => {
                if (!source?.key) return false;
                if (!sourceFilterMatchCache.has(source.key)) {
                    const matches = Boolean(sourceMatchesCurrentFilters(source));
                    sourceFilterMatchCache.set(source.key, matches);
                    if (matches) sourceFilterMatchCount += 1;
                }
                return sourceFilterMatchCache.get(source.key);
            };
            const getCachedSourceEffectiveState = (source) => {
                if (!source?.key) return false;
                if (!sourceEffectiveStateCache.has(source.key)) {
                    sourceEffectiveStateCache.set(
                        source.key,
                        Boolean(isSourceEffectivelyEnabled(source))
                    );
                }
                return sourceEffectiveStateCache.get(source.key);
            };
            const getCachedGroupEffectiveState = (group) => {
                if (!group?.id) return { on: 0, total: 0 };
                if (groupEffectiveStateCache.has(group.id)) {
                    return groupEffectiveStateCache.get(group.id);
                }

                const visitedGroupIds = new Set();
                const descendantKeys = new Set();
                const stack = [group];
                while (stack.length > 0) {
                    const currentGroup = stack.pop();
                    if (!currentGroup || visitedGroupIds.has(currentGroup.id)) continue;
                    visitedGroupIds.add(currentGroup.id);
                    const children = Array.isArray(currentGroup.children)
                        ? currentGroup.children
                        : [];
                    for (const child of children) {
                        if (child?.type === 'source') {
                            if (child.key) descendantKeys.add(child.key);
                            continue;
                        }
                        if (child?.type === 'group') {
                            const childGroup = groupsById.get(child.id);
                            if (childGroup) stack.push(childGroup);
                        }
                    }
                }

                let on = 0;
                descendantKeys.forEach((sourceKey) => {
                    if (getCachedSourceEffectiveState(sourcesByKey.get(sourceKey))) on += 1;
                });
                const result = { on, total: descendantKeys.size };
                groupEffectiveStateCache.set(group.id, result);
                return result;
            };
            groupsById.forEach((group, groupId) => {
                if (!group || groupEffectiveStateCache.has(groupId)) return;
                const visitStateByGroupId = new Map();
                const stack = [{ groupId, exiting: false }];
                while (stack.length > 0) {
                    const frame = stack.pop();
                    const currentGroup = groupsById.get(frame.groupId);
                    if (!currentGroup) continue;

                    if (!frame.exiting) {
                        const visitState = visitStateByGroupId.get(currentGroup.id);
                        if (visitState === 'done' || visitState === 'visiting') continue;
                        visitStateByGroupId.set(currentGroup.id, 'visiting');
                        stack.push({ groupId: currentGroup.id, exiting: true });
                        const children = Array.isArray(currentGroup.children)
                            ? currentGroup.children
                            : [];
                        for (let index = children.length - 1; index >= 0; index -= 1) {
                            const child = children[index];
                            if (
                                child?.type === 'group'
                                && !groupEffectiveStateCache.has(child.id)
                                && visitStateByGroupId.get(child.id) !== 'visiting'
                            ) {
                                stack.push({ groupId: child.id, exiting: false });
                            }
                        }
                        continue;
                    }

                    let on = 0;
                    let total = 0;
                    const directSourceKeys = new Set();
                    const children = Array.isArray(currentGroup.children)
                        ? currentGroup.children
                        : [];
                    for (const child of children) {
                        if (child?.type === 'source') {
                            if (!child.key || directSourceKeys.has(child.key)) continue;
                            directSourceKeys.add(child.key);
                            total += 1;
                            if (getCachedSourceEffectiveState(sourcesByKey.get(child.key))) on += 1;
                            continue;
                        }
                        if (child?.type === 'group') {
                            const childState = groupEffectiveStateCache.get(child.id);
                            if (childState) {
                                on += childState.on;
                                total += childState.total;
                            }
                        }
                    }
                    groupEffectiveStateCache.set(currentGroup.id, { on, total });
                    recomputedGroupEffectiveStateCount += 1;
                    visitStateByGroupId.set(currentGroup.id, 'done');
                }
            });
            derivedGroupEffectiveStateCache = new Map(groupEffectiveStateCache);
            const rootGroupIds = activeIsolationGroupId && groupsById.has(activeIsolationGroupId)
                ? [activeIsolationGroupId]
                : rootEntries
                    .filter((entry) => entry && entry.type === 'group' && entry.id)
                    .map((entry) => entry.id);
            const searchCriteria = parseSearchQuery(state.filterQuery || '');
            const renderableGroupIds = new Set();
            const baseSetupCompletedAt = performanceNow();
            if (activeFilters) {
                const renderabilityByGroupId = new Map();
                const visitStateByGroupId = new Map();
                groupsById.forEach((group, groupId) => {
                    if (!group || visitStateByGroupId.get(groupId) === 'done') return;
                    const stack = [{ groupId, exiting: false }];
                    while (stack.length > 0) {
                        const frame = stack.pop();
                        const currentGroup = groupsById.get(frame.groupId);
                        if (!currentGroup) continue;

                        if (!frame.exiting) {
                            const visitState = visitStateByGroupId.get(currentGroup.id);
                            if (visitState === 'done' || visitState === 'visiting') continue;
                            visitStateByGroupId.set(currentGroup.id, 'visiting');
                            stack.push({ groupId: currentGroup.id, exiting: true });
                            const children = Array.isArray(currentGroup.children)
                                ? currentGroup.children
                                : [];
                            for (let index = children.length - 1; index >= 0; index -= 1) {
                                const child = children[index];
                                if (
                                    child?.type === 'group'
                                    && visitStateByGroupId.get(child.id) !== 'visiting'
                                ) {
                                    stack.push({ groupId: child.id, exiting: false });
                                }
                            }
                            continue;
                        }

                        let renderable = typeof searchSemantics.matchesGroup === 'function'
                            && searchSemantics.matchesGroup(currentGroup, searchCriteria);
                        const children = Array.isArray(currentGroup.children)
                            ? currentGroup.children
                            : [];
                        for (const child of children) {
                            if (renderable) break;
                            if (child?.type === 'source') {
                                renderable = matchesCurrentFilters(sourcesByKey.get(child.key));
                            } else if (child?.type === 'group') {
                                renderable = Boolean(renderabilityByGroupId.get(child.id));
                            }
                        }

                        renderabilityByGroupId.set(currentGroup.id, renderable);
                        visitStateByGroupId.set(currentGroup.id, 'done');
                        if (renderable) renderableGroupIds.add(currentGroup.id);
                    }
                });
            }
            const renderabilityCompletedAt = performanceNow();
            const sourceTitleHighlightTerms = getSearchHighlightTerms(searchCriteria, 'text');
            const tagHighlightTerms = getSearchHighlightTerms(searchCriteria, 'tag');
            const folderHighlightTerms = getSearchHighlightTerms(searchCriteria, 'folder');
            const searchExpandedGroupIds = collectSearchExpandedGroupIds(rootGroupIds, state.filterQuery);
            const pendingInitialRenamePathGroupIds = new Set();
            groupsById.forEach((group, groupId) => {
                if (!group?.isPendingInitialRename) return;
                const seenGroupIds = new Set();
                let currentGroupId = groupId;
                while (
                    currentGroupId
                    && groupsById.has(currentGroupId)
                    && !seenGroupIds.has(currentGroupId)
                ) {
                    seenGroupIds.add(currentGroupId);
                    pendingInitialRenamePathGroupIds.add(currentGroupId);
                    currentGroupId = parentMap.get(currentGroupId) || null;
                }
            });
            const setupCompletedAt = performanceNow();
            const countedSearchResultKeys = new Set();
            const countedSearchResultGroupIds = new Set();
            const visibleBatchOperableKeys = new Set();
            const visibleSourceKeysForWindow = [];
            const visibleSourceKeySetForWindow = new Set();
            const appendVisibleSourceKeyForWindow = (sourceKey) => {
                if (!sourceKey || visibleSourceKeySetForWindow.has(sourceKey)) return;
                const source = sourcesByKey.get(sourceKey);
                if (!source || !matchesCurrentFilters(source)) return;
                visibleSourceKeySetForWindow.add(sourceKey);
                visibleSourceKeysForWindow.push(sourceKey);
                if (searchCriteria.hasQuery) {
                    countedSearchResultKeys.add(sourceKey);
                }
                if (state.isBatchMode) {
                    const isFailed = Boolean(
                        source.isFailed
                        || (source.isDisabled && !source.isLoading)
                    );
                    if (
                        !source.isDisabled
                        && !isFailed
                        && !source.isLoading
                        && source.hasNativeCheckbox !== false
                    ) {
                        visibleBatchOperableKeys.add(sourceKey);
                    }
                }
            };
            const collectVisibleGroupSourceKeysForWindow = (rootGroup) => {
                if (!rootGroup) return;
                const visitedGroupIds = new Set();
                const stack = [{ kind: 'group', group: rootGroup }];
                while (stack.length > 0) {
                    const task = stack.pop();
                    if (task.kind === 'source') {
                        appendVisibleSourceKeyForWindow(task.sourceKey);
                        continue;
                    }

                    const group = task.group;
                    if (!group || visitedGroupIds.has(group.id)) continue;
                    visitedGroupIds.add(group.id);
                    if (
                        !pendingInitialRenamePathGroupIds.has(group.id)
                        && activeFilters
                        && !renderableGroupIds.has(group.id)
                    ) {
                        continue;
                    }

                    const isCollapsed = (
                        group.collapsed
                        && !searchExpandedGroupIds.has(group.id)
                        && !pendingInitialRenamePathGroupIds.has(group.id)
                    );
                    if (isCollapsed) continue;

                    const children = Array.isArray(group.children) ? group.children : [];
                    for (let index = children.length - 1; index >= 0; index -= 1) {
                        const child = children[index];
                        if (child?.type === 'source') {
                            stack.push({ kind: 'source', sourceKey: child.key });
                        } else if (child?.type === 'group') {
                            const childGroup = groupsById.get(child.id);
                            if (childGroup) stack.push({ kind: 'group', group: childGroup });
                        }
                    }
                }
            };

            if (activeIsolationGroupId) {
                collectVisibleGroupSourceKeysForWindow(groupsById.get(activeIsolationGroupId));
                rootEntries.forEach((entry) => {
                    if (
                        entry?.type === 'group'
                        && entry.id !== activeIsolationGroupId
                        && pendingInitialRenamePathGroupIds.has(entry.id)
                    ) {
                        collectVisibleGroupSourceKeysForWindow(groupsById.get(entry.id));
                    }
                });
            } else {
                rootEntries.forEach((entry) => {
                    if (entry?.type === 'source') {
                        appendVisibleSourceKeyForWindow(entry.key);
                    } else if (entry?.type === 'group') {
                        collectVisibleGroupSourceKeysForWindow(groupsById.get(entry.id));
                    }
                });
                (Array.isArray(state.ungrouped) ? state.ungrouped : [])
                    .forEach(appendVisibleSourceKeyForWindow);
            }
            const logicalProjectionCompletedAt = performanceNow();

            if (sourceFilterMatchCache.size < sourcesByKey.size) {
                sourcesByKey.forEach((source, sourceKey) => {
                    if (!sourceFilterMatchCache.has(sourceKey)) {
                        matchesCurrentFilters(source);
                    }
                });
            }
            const logicalFilteredSourceTotal = sourceFilterMatchCount;
            const projectionCompletedAt = performanceNow();
            const sourceWindowRange = resolveSourceWindowRange(
                listContainer,
                visibleSourceKeysForWindow.length
            );
            const sourceWindowPinnedKeys = new Set(
                Array.from(collectSourceWindowPinnedKeys(listContainer))
                    .filter((sourceKey) => sourcesByKey.has(sourceKey))
            );
            const sourceWindowOrdinalByKey = new Map(
                visibleSourceKeysForWindow.map((sourceKey, ordinal) => [sourceKey, ordinal])
            );
            lastVisibleLogicalSourceKeys = visibleSourceKeysForWindow.slice();
            let materializedSourceCount = 0;
            let listMotionIndex = 0;

            const getNextListMotionStyle = () => {
                const motionIndex = getCappedMotionIndex(listMotionIndex);
                listMotionIndex += 1;
                return `--sp-list-item-index:${motionIndex};`;
            };

            const joinAccessibleTreePath = (parentPath, ownTitle) => (
                parentPath ? `${parentPath} / ${ownTitle}` : ownTitle
            );

            const getGroupAncestorAccessiblePath = (groupId) => {
                const ancestorTitles = [];
                const visitedGroupIds = new Set([groupId]);
                let parentGroupId = parentMap.get(groupId) || null;
                while (
                    parentGroupId
                    && groupsById.has(parentGroupId)
                    && !visitedGroupIds.has(parentGroupId)
                ) {
                    visitedGroupIds.add(parentGroupId);
                    const parentGroup = groupsById.get(parentGroupId);
                    ancestorTitles.push(parentGroup?.title || getMessage('ui_group_untitled'));
                    parentGroupId = parentMap.get(parentGroupId) || null;
                }
                return ancestorTitles.reverse().join(' / ');
            };

            const renderSourceItem = (source, isVisibleInTree = true, parentPath = '') => {
                if (!source || !matchesCurrentFilters(source)) return null;
                if (searchCriteria.hasQuery) {
                    countedSearchResultKeys.add(source.key);
                }
                const isGated = !areAllAncestorsEnabled(source.key) || !isSourceWithinActiveIsolation(source.key);
                const isFailed = Boolean(source.isFailed || (source.isDisabled && !source.isLoading));
                const isLoading = source.isLoading;
                if (
                    state.isBatchMode
                    && isVisibleInTree
                    && !source.isDisabled
                    && !isFailed
                    && !isLoading
                    && source.hasNativeCheckbox !== false
                ) {
                    visibleBatchOperableKeys.add(source.key);
                }
                const sourceWindowOrdinal = sourceWindowOrdinalByKey.has(source.key)
                    ? sourceWindowOrdinalByKey.get(source.key)
                    : -1;
                const isSourceWindowPinned = sourceWindowPinnedKeys.has(source.key);
                if (
                    sourceWindowRange.active
                    && !isVisibleInTree
                    && !isSourceWindowPinned
                ) {
                    return null;
                }
                if (
                    isVisibleInTree
                    && sourceWindowOrdinal >= 0
                    && !shouldMaterializeWindowedSource(
                        source.key,
                        sourceWindowOrdinal,
                        sourceWindowRange,
                        sourceWindowPinnedKeys
                    )
                ) {
                    return {
                        __spSourceWindowOmission: true,
                        ordinal: sourceWindowOrdinal
                    };
                }
                materializedSourceCount += 1;
                const showSourceActionButton = !state.isBatchMode;
                const canOpenActions = canOpenSourceActionMenu(source);
                const isSourceActionMenuOpen = canOpenActions && getActiveSourceActionSourceKey() === source.key;
                const orderedSourceTags = getSourceTagIds(source.key)
                    .map((tagId) => tagsById.get(tagId))
                    .filter(Boolean);

                let extraClasses = '';
                if (isGated) extraClasses += ' gated';
                if (isFailed) extraClasses += ' failed-source';
                if (isLoading) extraClasses += ' loading-source';
                if (state.isBatchMode && pendingBatchKeys.has(source.key)) extraClasses += ' selected-for-batch';

                let titleAttr = false;
                if (isFailed) titleAttr = getMessage('ui_source_import_failed');
                if (isLoading) titleAttr = getMessage('ui_source_parsing');
                const motionStyle = getNextListMotionStyle();
                const sourceTitle = source.title || getMessage('ui_source_untitled');
                const sourcePath = joinAccessibleTreePath(parentPath, sourceTitle);

                return el('div', {
                    className: 'source-item sp-list-item-enter sp-spotlight-surface' + extraClasses,
                    role: 'listitem',
                    'aria-label': sourcePath,
                    'aria-posinset': sourceWindowOrdinal >= 0
                        ? String(sourceWindowOrdinal + 1)
                        : null,
                    'aria-setsize': sourceWindowOrdinal >= 0
                        ? String(visibleSourceKeysForWindow.length)
                        : null,
                    draggable: !isFailed && !isLoading ? 'true' : 'false',
                    dataset: {
                        sourceKey: source.key,
                        sourceWindowOrdinal: sourceWindowOrdinal >= 0
                            ? String(sourceWindowOrdinal)
                            : ''
                    },
                    style: motionStyle,
                    title: titleAttr
                }, [
                    el('div', { className: 'icon-container' }, [
                        createSourceIconElement(source, isFailed)
                    ]),
                    showSourceActionButton ? el('div', {
                        className: 'sp-source-actions-anchor' + (isSourceActionMenuOpen ? ' is-open' : '')
                    }, [
                        el('button', {
                            type: 'button',
                            className: 'sp-source-actions-button sp-glare-hover',
                            dataset: { sourceKey: source.key },
                            title: getMessage('ui_source_actions'),
                            'aria-label': getMessage('ui_source_actions_for', [sourcePath]),
                            'aria-haspopup': 'menu',
                            'aria-expanded': isSourceActionMenuOpen ? 'true' : 'false',
                            disabled: !canOpenActions
                        }, [
                            el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['more_horiz'])
                        ])
                    ]) : el('div', {
                        className: 'sp-source-actions-anchor sp-source-actions-placeholder',
                        'aria-hidden': 'true'
                    }),
                    el('div', { className: 'title-container' }, [
                        el('div', { className: 'source-title-text' }, createHighlightedTextChildren(source.title, sourceTitleHighlightTerms)),
                        isLoading ? el('div', {
                            className: 'source-loading-status',
                            role: 'status',
                            'aria-live': 'polite'
                        }, [getMessage('ui_source_parsing')]) : '',
                        orderedSourceTags.length > 0 ? el('div', { className: 'source-tag-list' }, orderedSourceTags.map((tag) => (
                            el('button', {
                                type: 'button',
                                className: 'sp-tag-pill' + (state.activeTagId === tag.id ? ' is-active' : ''),
                                dataset: { tagId: tag.id },
                                title: getMessage('ui_tag_filter_active', [tag.label]),
                                'aria-pressed': state.activeTagId === tag.id ? 'true' : 'false',
                                style: getTagStyleVars(tag, state.activeTagId === tag.id)
                            }, createHighlightedTextChildren(tag.label, tagHighlightTerms))
                        ))) : ''
                    ]),
                    el('div', { className: 'checkbox-container' }, [
                        state.isBatchMode
                            ? el('input', {
                                type: 'checkbox',
                                className: 'sp-batch-checkbox sp-checkbox',
                                dataset: { sourceKey: source.key },
                                checked: pendingBatchKeys.has(source.key),
                                'aria-label': getMessage('ui_batch_select_source', [sourcePath]),
                                disabled: isFailed || isLoading || source.hasNativeCheckbox === false
                            })
                            : el('input', {
                                type: 'checkbox',
                                className: 'sp-checkbox',
                                dataset: { sourceKey: source.key },
                                checked: source.enabled,
                                'aria-label': getMessage('ui_source_enabled_checkbox', [sourcePath]),
                                disabled: isFailed || isLoading || source.hasNativeCheckbox === false
                            })
                    ])
                ]);
            };

            const appendWindowedSourceSequence = (
                target,
                sourceKeys,
                parentPath = ''
            ) => {
                if (!target || !Array.isArray(sourceKeys) || sourceKeys.length === 0) {
                    return 0;
                }
                const append = Array.isArray(target)
                    ? (node) => target.push(node)
                    : (node) => target.appendChild(node);
                let appendedCount = 0;
                if (
                    sourceWindowRange.active
                    && sourceKeys === visibleSourceKeysForWindow
                ) {
                    const materializedOrdinals = new Set();
                    for (
                        let ordinal = sourceWindowRange.start;
                        ordinal < sourceWindowRange.end;
                        ordinal += 1
                    ) {
                        materializedOrdinals.add(ordinal);
                    }
                    sourceWindowPinnedKeys.forEach((sourceKey) => {
                        const ordinal = sourceWindowOrdinalByKey.get(sourceKey);
                        if (ordinal !== undefined) materializedOrdinals.add(ordinal);
                    });
                    const sortedOrdinals = Array.from(materializedOrdinals)
                        .filter((ordinal) => (
                            ordinal >= 0 && ordinal < sourceKeys.length
                        ))
                        .sort((left, right) => left - right);
                    let cursor = 0;
                    sortedOrdinals.forEach((ordinal) => {
                        if (ordinal > cursor) {
                            append(createSourceWindowSpacer(
                                cursor,
                                ordinal,
                                sourceWindowRange.rowHeight
                            ));
                            appendedCount += 1;
                        }
                        const sourceElement = renderSourceItem(
                            sourcesByKey.get(sourceKeys[ordinal]),
                            true,
                            parentPath
                        );
                        if (sourceElement && !sourceElement.__spSourceWindowOmission) {
                            append(sourceElement);
                            appendedCount += 1;
                        }
                        cursor = ordinal + 1;
                    });
                    if (cursor < sourceKeys.length) {
                        append(createSourceWindowSpacer(
                            cursor,
                            sourceKeys.length,
                            sourceWindowRange.rowHeight
                        ));
                        appendedCount += 1;
                    }
                    return appendedCount;
                }
                let omissionStart = null;
                let omissionEnd = null;
                const flushOmission = () => {
                    if (omissionStart === null || omissionEnd === null) return;
                    append(createSourceWindowSpacer(
                        omissionStart,
                        omissionEnd,
                        sourceWindowRange.rowHeight
                    ));
                    appendedCount += 1;
                    omissionStart = null;
                    omissionEnd = null;
                };

                sourceKeys.forEach((sourceKey) => {
                    const ordinal = sourceWindowOrdinalByKey.get(sourceKey);
                    const shouldMaterialize = ordinal === undefined
                        || shouldMaterializeWindowedSource(
                            sourceKey,
                            ordinal,
                            sourceWindowRange,
                            sourceWindowPinnedKeys
                        );
                    if (!shouldMaterialize) {
                        if (omissionStart === null) omissionStart = ordinal;
                        omissionEnd = ordinal + 1;
                        return;
                    }

                    flushOmission();
                    const sourceElement = renderSourceItem(
                        sourcesByKey.get(sourceKey),
                        true,
                        parentPath
                    );
                    if (sourceElement && !sourceElement.__spSourceWindowOmission) {
                        append(sourceElement);
                        appendedCount += 1;
                    }
                });
                flushOmission();
                return appendedCount;
            };

            const createRenderedGroupElement = (
                group,
                level,
                childrenElements,
                motionStyle,
                groupPath,
                hasLogicalChildren = childrenElements.length > 0
            ) => {
                const isGated = !group.enabled || !areAllAncestorsEnabled(group.id) || !isGroupWithinActiveIsolation(group.id);
                const { on, total } = getCachedGroupEffectiveState(group);
                const groupTitle = group.title || getMessage('ui_group_untitled');
                if (
                    searchCriteria.hasQuery
                    && groupMatchesSearchQuery(group, searchCriteria)
                ) {
                    countedSearchResultGroupIds.add(group.id);
                }
                const isSearchExpanded = searchExpandedGroupIds.has(group.id);
                const isPendingRenameExpanded = pendingInitialRenamePathGroupIds.has(group.id);
                const isCollapsed = group.collapsed && !isSearchExpanded && !isPendingRenameExpanded;
                const groupChildrenId = `sp-group-children-${String(group.id)}`;
                const treeOrderControls = !state.isBatchMode
                    ? el('div', {
                        className: 'sp-tree-order-controls',
                        role: 'group',
                        'aria-label': getMessage('ui_tree_order')
                    }, TREE_ORDER_DIRECTIONS.map(({ direction, icon, labelKey }) => {
                        const resolution = renderDirectionalTargetResolver(
                            { kind: 'group', id: group.id },
                            direction
                        );
                        const disabled = !resolution?.ok;
                        const label = getMessage(labelKey);
                        return el('button', {
                            type: 'button',
                            className: 'sp-tree-order-button sp-glare-hover',
                            dataset: { groupId: group.id, treeDirection: direction },
                            title: label,
                            'aria-label': label,
                            'aria-disabled': disabled ? 'true' : null,
                            disabled: disabled ? true : null
                        }, [el('span', { className: 'google-symbols' }, [icon])]);
                    }))
                    : '';

                if (!hasLogicalChildren && childrenElements.length === 0 && !activeFilters) {
                    childrenElements.push(el('div', {
                        className: 'sp-empty-list-item',
                        role: 'listitem'
                    }, [
                        el('div', {
                            className: 'sp-empty-state',
                            role: 'status'
                        }, [getMessage('ui_empty_group')])
                    ]));
                }

                const groupEl = el('div', {
                    className: 'group-container sp-list-item-enter' + (isGated ? ' gated' : '') + (group.isNewlyCreated ? ' sp-folder-enter' : ''),
                    role: 'listitem',
                    'aria-label': groupPath,
                    dataset: {
                        groupId: group.id,
                        treeDepth: String(level)
                    },
                    style: `--sp-tree-indent:${Math.min(level, MAX_VISIBLE_TREE_INDENT_LEVEL) * TREE_INDENT_STEP_PX}px;${motionStyle}`
                }, [
                    el('div', { className: 'group-header sp-spotlight-surface', draggable: !state.isBatchMode ? 'true' : 'false', dataset: { dragType: 'group', groupId: group.id } }, [
	                        el('button', {
	                            type: 'button',
	                            className: 'sp-caret' + (isCollapsed ? ' collapsed' : ''),
	                            title: isCollapsed ? getMessage('ui_expand') : getMessage('ui_collapse'),
	                            'aria-label': getMessage(
                                    isCollapsed ? 'ui_expand_group_named' : 'ui_collapse_group_named',
                                    [groupPath]
                                ),
                                'aria-expanded': isCollapsed ? 'false' : 'true',
                                'aria-controls': groupChildrenId
	                        }, [
                            el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['arrow_drop_down'])
                        ]),
                        !state.isBatchMode ? el('label', {
                            className: 'sp-toggle-switch',
                            title: group.enabled ? getMessage('ui_disable_group') : getMessage('ui_enable_group')
                        }, [
                            el('input', {
                                type: 'checkbox',
                                className: 'sp-group-toggle-checkbox',
                                dataset: { groupId: group.id },
                                checked: group.enabled,
                                'aria-label': getMessage(
                                    group.enabled ? 'ui_disable_group_named' : 'ui_enable_group_named',
                                    [groupPath]
                                )
                            }),
                            el('span', { className: 'sp-toggle-slider' })
                        ]) : '',
                        createGroupTitleIconElement(),
                        el('span', { className: 'group-title' }, createHighlightedTextChildren(groupTitle, folderHighlightTerms)),
                        el('span', { className: 'badge' }, [` ${on} / ${total} `]),
                            treeOrderControls,
	                        el('button', {
	                            type: 'button',
                            className: 'sp-add-subgroup-button sp-glare-hover',
                            title: getMessage('ui_add_subgroup'),
                            'aria-label': getMessage('ui_add_subgroup_to', [groupPath])
                        }, [el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['create_new_folder'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-isolate-button sp-glare-hover' + (activeIsolationGroupId === group.id ? ' is-active' : ''),
                            title: getMessage('ui_isolate_group'),
                            'aria-label': getMessage('ui_isolate_group_named', [groupPath]),
                            'aria-pressed': activeIsolationGroupId === group.id ? 'true' : 'false'
                        }, [el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['filter_center_focus'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-edit-button sp-glare-hover',
                            title: getMessage('ui_rename'),
                            'aria-label': getMessage('ui_rename_group_named', [groupPath])
                        }, [el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['edit'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-delete-button sp-glare-hover',
                            title: getMessage('ui_delete_group'),
                            'aria-label': getMessage('ui_delete_group_named', [groupPath])
                        }, [el('span', { className: 'google-symbols', 'aria-hidden': 'true' }, ['delete'])])
                    ]),
	                    el('div', {
                            id: groupChildrenId,
                            className: 'group-children' + (isCollapsed ? ' collapsed' : ''),
                            role: 'list',
                            'aria-hidden': isCollapsed ? 'true' : 'false',
                            inert: isCollapsed ? true : null
                        }, childrenElements)
	                ]);

                if (group.isNewlyCreated) {
                    delete group.isNewlyCreated;
                }

                return groupEl;
            };

            const renderGroup = (rootGroup, rootLevel, ancestorsVisible = true) => {
                if (!rootGroup) return null;

                let renderedRoot = null;
                const stack = [{
                    kind: 'group-enter',
                    group: rootGroup,
                    level: rootLevel,
                    ancestorGroupIds: new Set(),
                    ancestorsVisible,
                    parentPath: getGroupAncestorAccessiblePath(rootGroup.id),
                    parentFrame: null
                }];

                while (stack.length > 0) {
                    const task = stack.pop();
                    if (task.kind === 'source') {
                        const source = sourcesByKey.get(task.sourceKey);
                        const sourceElement = renderSourceItem(
                            source,
                            task.isVisibleInTree,
                            task.parentPath
                        );
                        if (source && matchesCurrentFilters(source)) {
                            task.parentFrame.hasLogicalChildren = true;
                        }
                        appendSourceRenderResult(
                            task.parentFrame.childrenElements,
                            sourceElement,
                            sourceWindowRange.rowHeight
                        );
                        continue;
                    }

                    if (task.kind === 'group-exit') {
                        const groupElement = createRenderedGroupElement(
                            task.frame.group,
                            task.frame.level,
                            task.frame.childrenElements,
                            task.frame.motionStyle,
                            task.frame.groupPath,
                            task.frame.hasLogicalChildren
                        );
                        if (task.frame.parentFrame) {
                            if (groupElement) task.frame.parentFrame.childrenElements.push(groupElement);
                        } else {
                            renderedRoot = groupElement;
                        }
                        continue;
                    }

                    const group = task.group;
                    if (
                        !group
                        || task.ancestorGroupIds.has(group.id)
                        || (
                            !pendingInitialRenamePathGroupIds.has(group.id)
                            && activeFilters
                            && !renderableGroupIds.has(group.id)
                        )
                    ) {
                        continue;
                    }

                    const isSearchExpanded = searchExpandedGroupIds.has(group.id);
                    const isPendingRenameExpanded = pendingInitialRenamePathGroupIds.has(group.id);
                    const isCollapsed = group.collapsed && !isSearchExpanded && !isPendingRenameExpanded;
                    const childrenVisible = task.ancestorsVisible && !isCollapsed;
                    const nextAncestorGroupIds = new Set(task.ancestorGroupIds);
                    nextAncestorGroupIds.add(group.id);
                    const groupTitle = group.title || getMessage('ui_group_untitled');
                    const groupPath = joinAccessibleTreePath(task.parentPath, groupTitle);
                    const frame = {
                        group,
                        level: task.level,
                        childrenElements: [],
                        motionStyle: getNextListMotionStyle(),
                        groupPath,
                        hasLogicalChildren: false,
                        parentFrame: task.parentFrame
                    };
                    stack.push({ kind: 'group-exit', frame });

                    const children = Array.isArray(group.children) ? group.children : [];
                    for (let index = children.length - 1; index >= 0; index -= 1) {
                        const child = children[index];
                        if (child?.type === 'source') {
                            stack.push({
                                kind: 'source',
                                sourceKey: child.key,
                                isVisibleInTree: childrenVisible,
                                parentPath: groupPath,
                                parentFrame: frame
                            });
                        } else if (child?.type === 'group') {
                            stack.push({
                                kind: 'group-enter',
                                group: groupsById.get(child.id),
                                level: task.level + 1,
                                ancestorGroupIds: nextAncestorGroupIds,
                                ancestorsVisible: childrenVisible,
                                parentPath: groupPath,
                                parentFrame: frame
                            });
                        }
                    }
                }

                return renderedRoot;
            };

            if (activeIsolationGroupId) {
                const renderedRootGroupIds = new Set();
                const isolatedGroupElement = renderGroup(groupsById.get(activeIsolationGroupId), 0);
                if (isolatedGroupElement) {
                    fragment.appendChild(isolatedGroupElement);
                    renderedRootGroupIds.add(activeIsolationGroupId);
                }
                rootEntries.forEach((entry) => {
                    if (
                        entry?.type !== 'group'
                        || renderedRootGroupIds.has(entry.id)
                        || !pendingInitialRenamePathGroupIds.has(entry.id)
                    ) {
                        return;
                    }
                    const pendingGroupElement = renderGroup(groupsById.get(entry.id), 0);
                    if (pendingGroupElement) {
                        fragment.appendChild(pendingGroupElement);
                        renderedRootGroupIds.add(entry.id);
                    }
                });
            } else if (!rootEntries.some((entry) => entry?.type === 'group')) {
                const ungroupedKeys = Array.isArray(state.ungrouped)
                    ? state.ungrouped
                    : [];
                appendWindowedSourceSequence(
                    fragment,
                    ungroupedKeys.length === 0
                        ? visibleSourceKeysForWindow
                        : rootEntries
                            .filter((entry) => entry?.type === 'source')
                            .map((entry) => entry.key)
                            .filter((sourceKey) => visibleSourceKeySetForWindow.has(sourceKey))
                );
            } else {
                rootEntries.forEach((entry) => {
                    if (!entry) return;
                    if (entry.type === 'group') {
                        const groupElement = renderGroup(groupsById.get(entry.id), 0);
                        if (groupElement) {
                            fragment.appendChild(groupElement);
                        }
                        return;
                    }
                    if (entry.type === 'source') {
                        const sourceElement = renderSourceItem(sourcesByKey.get(entry.key));
                        appendSourceRenderResult(
                            fragment,
                            sourceElement,
                            sourceWindowRange.rowHeight
                        );
                    }
                });
            }

            if (!activeIsolationGroupId) {
                const matchingUngrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((key) => {
                    const source = sourcesByKey.get(key);
                    return source && matchesCurrentFilters(source);
                });

                if (matchingUngrouped.length > 0) {
                    const ungroupedSection = el('div', {
                        className: 'ungrouped-section',
                        role: 'listitem'
                    });

                    const ungroupedHeader = doc.createElement('h4');
                    ungroupedHeader.className = 'ungrouped-header';
                    ungroupedHeader.textContent = getMessage('ui_ungrouped');
                    ungroupedSection.appendChild(ungroupedHeader);

                    const ungroupedList = el('div', {
                        className: 'ungrouped-list',
                        role: 'list',
                        'aria-label': getMessage('ui_ungrouped')
                    });
                    appendWindowedSourceSequence(
                        ungroupedList,
                        rootEntries.length === 0
                            && matchingUngrouped.length === visibleSourceKeysForWindow.length
                            ? visibleSourceKeysForWindow
                            : matchingUngrouped,
                        getMessage('ui_ungrouped')
                    );
                    ungroupedSection.appendChild(ungroupedList);

                    fragment.appendChild(ungroupedSection);
                }
            }

            if (fragment.childNodes.length === 0) {
                let messageKey = 'ui_no_matching_sources';
                let actionKey = '';
                let actionClass = '';

                const activeFilterCount = (
                    Number(Boolean(searchCriteria.hasQuery))
                    + Number(Boolean(activeIsolationGroupId))
                    + Number(Boolean(state.activeTagId || state.activeQuickViewKind))
                );
                if (sourcesByKey.size === 0) {
                    messageKey = 'ui_empty_no_sources';
                } else if (activeFilterCount > 1) {
                    messageKey = 'ui_empty_filter_results';
                    actionKey = 'ui_clear_filters';
                    actionClass = 'sp-empty-clear-filters-btn';
                } else if (activeIsolationGroupId) {
                    messageKey = 'ui_empty_isolation_results';
                    actionKey = 'ui_show_all_sources';
                    actionClass = 'sp-empty-clear-isolation-btn';
                } else if (searchCriteria.hasQuery) {
                    messageKey = 'ui_empty_search_results';
                    actionKey = 'ui_clear_search';
                    actionClass = 'sp-empty-clear-search-btn';
                } else if (state.activeTagId || state.activeQuickViewKind) {
                    messageKey = 'ui_empty_filter_results';
                    actionKey = 'ui_clear_filters';
                    actionClass = 'sp-empty-clear-filters-btn';
                }

                const emptyStatusChildren = [
                    el('span', { className: 'sp-contextual-empty-copy' }, [getMessage(messageKey)])
                ];
                if (actionKey) {
                    emptyStatusChildren.push(el('button', {
                        type: 'button',
                        className: `sp-button sp-glare-hover ${actionClass}`
                    }, [getMessage(actionKey)]));
                }
                fragment.appendChild(el('div', {
                    className: 'sp-contextual-empty-list-item',
                    role: 'listitem'
                }, [
                    el('div', {
                        className: 'sp-empty-state sp-contextual-empty-state',
                        role: 'status'
                    }, emptyStatusChildren)
                ]));
            }
            updateSearchResultCount(
                state.filterQuery,
                countedSearchResultKeys.size,
                countedSearchResultGroupIds.size
            );

            // The batch toggle lives in the static toolbar shell (persists across renders),
            // so reflect its pressed/active state here like the other aria-pressed toggles
            // (quick-view, isolate) that are rebuilt per render.
            const batchToggleBtn = shadowRoot?.getElementById?.('sp-batch-action-btn');
            if (batchToggleBtn) {
                const batchActive = Boolean(state.isBatchMode);
                batchToggleBtn.setAttribute('aria-pressed', batchActive ? 'true' : 'false');
                batchToggleBtn.classList.toggle('is-active', batchActive);
            }

            let batchPendingSelectedCount = 0;
            let batchVisibleSelectedCount = 0;
            let batchHiddenSelectedCount = 0;
            if (state.isBatchMode) {
                const allVisibleSelected = visibleBatchOperableKeys.size > 0
                    && Array.from(visibleBatchOperableKeys).every((key) => pendingBatchKeys.has(key));
                const visibleSelectedCount = Array.from(visibleBatchOperableKeys)
                    .filter((key) => pendingBatchKeys.has(key))
                    .length;
                const hiddenSelectedCount = Math.max(0, pendingBatchKeys.size - visibleSelectedCount);
                batchPendingSelectedCount = pendingBatchKeys.size;
                batchVisibleSelectedCount = visibleSelectedCount;
                batchHiddenSelectedCount = hiddenSelectedCount;
                const lastBatchDeleteResult = getLastBatchDeleteResult();
                const hasUnsafeLocalReconcileFailure = Boolean(
                    Array.isArray(lastBatchDeleteResult?.failed)
                    && lastBatchDeleteResult.failed.some(
                        (entry) => entry?.reason === 'native_delete_local_apply_failed'
                    )
                );
                const hasRetryableBatchDelete = Boolean(
                    pendingBatchKeys.size > 0
                    && !hasUnsafeLocalReconcileFailure
                    && (
                        (Array.isArray(lastBatchDeleteResult?.failed) && lastBatchDeleteResult.failed.length > 0)
                        || (
                            Array.isArray(lastBatchDeleteResult?.unattempted)
                            && lastBatchDeleteResult.unattempted.length > 0
                        )
                    )
                );
                const actionBar = el('div', {
                    className: 'sp-batch-action-bar',
                    role: 'listitem'
                }, [
                    el('div', {
                        className: 'sp-batch-toolbar',
                        role: 'toolbar',
                        'aria-label': getMessage('ui_batch_actions_region')
                    }, [
                        el('button', { className: 'sp-button sp-cancel-batch-btn' }, [getMessage('ui_cancel')]),
                        el('span', {
                            className: 'sp-batch-selection-count',
                            role: 'status',
                            'aria-live': 'polite',
                            'aria-atomic': 'true'
                        }, [getMessage('ui_batch_selection_breakdown', [
                            String(visibleSelectedCount),
                            String(hiddenSelectedCount)
                        ])]),
                        el('button', {
                            className: 'sp-button sp-glare-hover sp-batch-select-visible-btn',
                            disabled: visibleBatchOperableKeys.size === 0 || allVisibleSelected || getIsDeletingSources()
                        }, [getMessage('ui_batch_select_visible')]),
                        el('button', {
                            className: 'sp-button sp-glare-hover sp-batch-clear-selection-btn',
                            disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                        }, [getMessage('ui_batch_clear_selection')]),
                        el('button', {
                            className: 'sp-button sp-glare-hover sp-batch-clear-hidden-selection-btn',
                            disabled: hiddenSelectedCount === 0 || getIsDeletingSources()
                        }, [getMessage('ui_batch_clear_hidden_selection', [String(hiddenSelectedCount)])]),
                        hasRetryableBatchDelete
                            ? el('button', {
                                className: 'sp-button sp-glare-hover sp-batch-retry-remaining-btn',
                                disabled: getIsDeletingSources()
                            }, [getMessage('ui_batch_retry_remaining', [String(pendingBatchKeys.size)])])
                            : null,
                        el('div', { className: 'sp-batch-actions' }, [
                            el('button', {
                                className: 'sp-button sp-glare-hover sp-batch-add-folder-btn',
                                disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                            }, [getMessage('ui_batch_add')]),
                            el('button', {
                                className: 'sp-button sp-glare-hover sp-batch-add-tags-btn',
                                disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                            }, [getMessage('ui_batch_add_tags_title')]),
                            el('button', {
                                className: 'sp-button sp-glare-hover sp-batch-remove-tags-btn',
                                disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                            }, [getMessage('ui_batch_remove_tags_title')]),
                            el('button', {
                                className: 'sp-button sp-glare-hover sp-batch-ungroup-btn',
                                disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                            }, [getMessage('ui_move_to_ungrouped')]),
                            el('button', {
                                className: 'sp-button sp-glare-hover sp-confirm-delete-btn',
                                disabled: pendingBatchKeys.size === 0 || getIsDeletingSources()
                            }, getIsDeletingSources()
                                ? [getMessage('ui_deleting')]
                                : createBatchCountMessageChildren('ui_delete_count', pendingBatchKeys.size, 'batch-delete'))
                        ])
                    ])
                ]);
                fragment.appendChild(actionBar);
            }
            const fragmentCompletedAt = performanceNow();

            const windowStart = Math.min(
                sourceWindowRange.start,
                visibleSourceKeysForWindow.length
            );
            const windowEnd = Math.min(
                Math.max(windowStart, sourceWindowRange.end),
                visibleSourceKeysForWindow.length
            );
            setSourceWindowMetadata(listContainer, {
                active: sourceWindowRange.active,
                logicalTotal: logicalFilteredSourceTotal,
                logicalVisible: visibleSourceKeysForWindow.length,
                logicalSourceCount: logicalFilteredSourceTotal,
                visibleLogicalSourceCount: visibleSourceKeysForWindow.length,
                materializedSources: materializedSourceCount,
                materializedSourceCount,
                renderGeneration: sourceRenderGeneration,
                start: windowStart,
                end: windowEnd,
                pinnedCount: sourceWindowPinnedKeys.size,
                overscan: sourceWindowRange.overscan,
                pendingSelected: batchPendingSelectedCount,
                visibleSelected: batchVisibleSelectedCount,
                hiddenSelected: batchHiddenSelectedCount,
                visibleBatchOperable: visibleBatchOperableKeys.size
            });
            const previousBatchCountSnapshot = collectBatchCountSnapshot(listContainer);
            if (typeof deps.onBeforeRowsPatch === 'function') {
                try { deps.onBeforeRowsPatch(); } catch (_) { /* ignore hook errors */ }
            }
            patchChildren(listContainer, fragment);
            const patchCompletedAt = performanceNow();
            const renderPhaseValues = {
                sourceContextIndexRebuilt: sourceContextIndexRebuilt ? 1 : 0,
                derivedGroupCacheInvalidated: derivedGroupCacheInvalidated ? 1 : 0,
                recomputedGroupEffectiveStateCount,
                setupFilterEvaluationCount: sourceFilterMatchCache.size,
                renderBaseSetupMs: baseSetupCompletedAt - renderStartedAt,
                renderGroupRenderabilityMs:
                    renderabilityCompletedAt - baseSetupCompletedAt,
                renderSetupFinalizeMs: setupCompletedAt - renderabilityCompletedAt,
                renderSetupMs: setupCompletedAt - renderStartedAt,
                renderLogicalProjectionMs: logicalProjectionCompletedAt - setupCompletedAt,
                renderProjectionFinalizeMs: projectionCompletedAt - logicalProjectionCompletedAt,
                renderProjectionMs: projectionCompletedAt - renderStartedAt,
                renderFragmentMs: fragmentCompletedAt - projectionCompletedAt,
                renderPatchMs: patchCompletedAt - fragmentCompletedAt,
                renderTotalMs: patchCompletedAt - renderStartedAt
            };
            Object.entries(renderPhaseValues).forEach(([key, value]) => {
                if (listContainer.dataset) {
                    listContainer.dataset[key] = Number(value).toFixed(3);
                }
            });
            animateBatchCountChanges(listContainer, previousBatchCountSnapshot);
            renderSourceActionMenuLayer();

            // Post-render hook: when a drag is in progress, the reflow session's
            // tracked sibling shifts (inline `transform: translateY(N)`) can be lost
            // because patchNode may replace elements or rewrite their style attribute
            // during reconciliation. The session.shiftedItems Map still tracks the
            // correct shifts by key, but the DOM no longer reflects them — siblings
            // visually snap back to their layout positions one frame. The hook lets
            // tree-interactions re-apply current shifts to the freshly-patched DOM
            // (idempotent: applyReflow skips entries whose prev === delta).
            // Non-drag callers can leave deps.onAfterRender undefined → cheap no-op.
            if (typeof deps.onAfterRender === 'function') {
                try { deps.onAfterRender(); } catch (_) { /* ignore hook errors */ }
            }
        }

        function scheduleRender(options = {}) {
            const win = typeof deps.getWindow === 'function'
                ? deps.getWindow()
                : (typeof window !== 'undefined' ? window : null);
            const requestFrame = win && typeof win.requestAnimationFrame === 'function'
                ? win.requestAnimationFrame.bind(win)
                : null;
            const cancelFrame = win && typeof win.cancelAnimationFrame === 'function'
                ? win.cancelAnimationFrame.bind(win)
                : null;
            const flushImmediately = options?.flushImmediately === true;
            const runScheduledRender = () => {
                if (!isRenderScheduled) return false;
                isRenderScheduled = false;
                if (scheduledRenderFrameId !== null) {
                    if (cancelFrame) cancelFrame(scheduledRenderFrameId);
                    scheduledRenderFrameId = null;
                }
                scheduledRenderRunner = null;
                render();
                return true;
            };
            if (isRenderScheduled) {
                // A scroll or another interaction may already own the next frame.
                // An immediate search executes that same runner now rather
                // than adding another render or inheriting a delayed rAF callback.
                if (flushImmediately && typeof scheduledRenderRunner === 'function') {
                    return scheduledRenderRunner();
                }
                return false;
            }
            if (!requestFrame || flushImmediately) {
                render();
                return true;
            }

            isRenderScheduled = true;
            scheduledRenderRunner = runScheduledRender;
            scheduledRenderFrameId = requestFrame(runScheduledRender);
            return true;
        }

        return {
            createBatchCountMessageChildren,
            collectBatchCountSnapshot,
            animateBatchCountElement,
            animateBatchCountChanges,
            clearSpotlightSurface,
            updateSpotlightSurfaceFromPointer,
            handleSpotlightPointerMove,
            handleSpotlightPointerLeave,
            bindSpotlightPointerTracking,
            getNormalizedSearchQuery,
            createHighlightedTextChildren,
            updateSearchResultCount,
            collectSearchExpandedGroupIds,
            getGroupEffectiveState,
            resolveSourceWindowRange,
            collectSourceWindowPinnedKeys,
            shouldMaterializeWindowedSource,
            createSourceWindowSpacer,
            appendSourceRenderResult,
            setSourceWindowMetadata,
            getSourceWindowMetadata: () => Object.assign({}, lastSourceWindowMetadata),
            getVisibleLogicalSourceKeys: () => lastVisibleLogicalSourceKeys.slice(),
            invalidateDerivedGroupEffectiveStateCache,
            bindSourceWindowingScroll,
            patchNode,
            patchChildren,
            renderQuickViewRail,
            renderViewStateBar,
            getSourceActionMenuLayer,
            renderSourceActionMenuLayer,
            getRenderedSourceActionMenuItems,
            findRenderedSourceActionMenu,
            focusSourceActionMenuItem,
            focusSourceActionMenuButton,
            handleSourceActionMenuKeydown,
            createSourceGlyphIcon,
            createGroupTitleIconElement,
            replaceSourceIconWithFallback,
            handleSourceIconImageError,
            bindSourceIconFallbackDelegation,
            createSourceIconElement,
            scheduleRender,
            isRenderScheduled: () => isRenderScheduled,
            render
        };
    }

    globalThis.NSM_CREATE_CONTENT_RENDER = createContentRender;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentRender;
    }
})();
