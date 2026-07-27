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
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const el = typeof deps.el === 'function'
            ? deps.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);
        const syncSearchUi = typeof deps.syncSearchUi === 'function'
            ? deps.syncSearchUi
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
        const shouldRenderGroup = typeof deps.shouldRenderGroup === 'function'
            ? deps.shouldRenderGroup
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
            || typeof searchSemantics.getHighlightTerms !== 'function'
            || typeof searchSemantics.segmentText !== 'function'
        ) {
            throw new Error(
                'GeminiNotebook-Source-Management: Content search semantics are missing.'
            );
        }
        const parseSearchQuery = searchSemantics.parseQuery;
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

        const BATCH_COUNT_MARKER = '__COUNT__';
        const COUNT_UP_DURATION_MS = 320;
        const MOTION_STAGGER_MAX_INDEX = 10;
        const SPOTLIGHT_SURFACE_SELECTOR = '.sp-spotlight-surface';
        let focusedSourceActionMenuKey = null;
        let pendingSourceActionMenuFocus = null;

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

        function updateSearchResultCount(query, count) {
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
            countEl.textContent = getMessage('ui_search_results_count', [String(count)]);
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
            const visitedGroupIds = new Set();
            const visitGroup = (groupId) => {
                if (!groupId || visitedGroupIds.has(groupId)) return false;
                const group = groupsById.get(groupId);
                if (!group) return false;
                visitedGroupIds.add(groupId);

                let hasMatchingDescendant = false;
                (Array.isArray(group.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'source') {
                        const source = sourcesByKey.get(child.key);
                        if (
                            source &&
                            sourceMatchesSearchQuery(source, searchCriteria) &&
                            sourceMatchesCurrentFilters(source)
                        ) {
                            hasMatchingDescendant = true;
                        }
                        return;
                    }

                    if (child?.type === 'group' && visitGroup(child.id)) {
                        hasMatchingDescendant = true;
                    }
                });

                if (hasMatchingDescendant) {
                    expandedGroupIds.add(group.id);
                }
                return hasMatchingDescendant;
            };

            (Array.isArray(groupIds) ? groupIds : []).forEach(visitGroup);
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
            const descendantKeys = [];
            const getKeys = (g) => {
                if (!g) return;
                (Array.isArray(g.children) ? g.children : []).forEach((child) => {
                    if (child.type === 'source') descendantKeys.push(child.key);
                    else getKeys(groupsById.get(child.id));
                });
            };
            getKeys(group);

            const total = descendantKeys.length;
            const on = descendantKeys.filter((key) => {
                return isSourceEffectivelyEnabled(getSourcesByKey().get(key));
            }).length;

            return { on, total };
        }

        function patchNode(target, source) {
            if (target.nodeType !== source.nodeType) {
                target.parentNode.replaceChild(source.cloneNode(true), target);
                return;
            }
            if (target.nodeType === Node.TEXT_NODE) {
                if (target.textContent !== source.textContent) {
                    target.textContent = source.textContent;
                }
                return;
            }
            if (target.nodeName !== source.nodeName) {
                target.parentNode.replaceChild(source.cloneNode(true), target);
                return;
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

            const targetChildren = Array.from(target.childNodes);
            const sourceChildren = Array.from(source.childNodes);
            const maxLength = Math.max(targetChildren.length, sourceChildren.length);

            for (let i = 0; i < maxLength; i++) {
                if (i >= targetChildren.length) {
                    target.appendChild(sourceChildren[i].cloneNode(true));
                } else if (i >= sourceChildren.length) {
                    target.removeChild(targetChildren[i]);
                } else {
                    patchNode(targetChildren[i], sourceChildren[i]);
                }
            }
        }

        function patchChildren(target, sourceFragment) {
            if (!target || !sourceFragment || typeof target.appendChild !== 'function') return;
            const targetChildren = Array.from(target.childNodes || []);
            const sourceChildren = Array.from(sourceFragment.childNodes || []);
            const maxLength = Math.max(targetChildren.length, sourceChildren.length);

            for (let i = 0; i < maxLength; i++) {
                if (i >= targetChildren.length) {
                    target.appendChild(sourceChildren[i].cloneNode(true));
                } else if (i >= sourceChildren.length) {
                    if (typeof target.removeChild === 'function') {
                        target.removeChild(targetChildren[i]);
                    }
                } else {
                    patchNode(targetChildren[i], sourceChildren[i]);
                }
            }
        }

        function renderViewStateBar() {
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
            const sourceViewInfo = getSourceViewInfo() || {};
            const nativeLabelPreview = getNativeLabelImportPreview() || {};
            const nativeLabelImportSummary = getLastNativeLabelImportSummary() || null;

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
                        'aria-label': getMessage('ui_view_source'),
                        style: `top:${Math.round(submenuPosition.top)}px;left:${Math.round(submenuPosition.left)}px;`
                    }, submenuItems.map((item, index) => (
                        el('button', {
                            type: 'button',
                            className: 'sp-source-actions-menu-item',
                            dataset: { sourceKey, action: item.action },
                            role: 'menuitem',
                            style: `--sp-menu-item-index:${index};`,
                            title: item.label,
                            'aria-label': item.label
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
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const listContainer = shadowRoot.querySelector('#sources-list');
            if (!listContainer) return;
            const container = shadowRoot.querySelector('.sp-container');

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
            syncActiveSourceActionMenuState();
            syncSearchUi();
            renderQuickViewRail();

            const doc = getDocument();
            if (!doc) return;
            const fragment = doc.createDocumentFragment();
            const sourceViewInfo = getSourceViewInfo() || {};
            const isNativeLabelView = sourceViewInfo.kind === 'label';
            setContainerNativeLabelViewMode(container, isNativeLabelView);
            renderViewStateBar();
            if (isNativeLabelView) {
                if (typeof deps.onBeforeRowsPatch === 'function') {
                    try { deps.onBeforeRowsPatch(); } catch (_) { /* ignore hook errors */ }
                }
                patchChildren(listContainer, fragment);
                updateSearchResultCount('', 0);
                renderSourceActionMenuLayer();
                return;
            }

            const state = getState() || {};
            const activeFilters = hasActiveRenderFilters();
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const tagsById = getTagsById();
            const pendingBatchKeys = getPendingBatchKeys();
            const activeIsolationGroupId = getActiveIsolationGroupId();
            const rootEntries = Array.isArray(state.root) ? state.root : [];
            const rootGroupIds = activeIsolationGroupId && groupsById.has(activeIsolationGroupId)
                ? [activeIsolationGroupId]
                : rootEntries
                    .filter((entry) => entry && entry.type === 'group' && entry.id)
                    .map((entry) => entry.id);
            const searchCriteria = parseSearchQuery(state.filterQuery || '');
            const sourceTitleHighlightTerms = getSearchHighlightTerms(searchCriteria, 'text');
            const tagHighlightTerms = getSearchHighlightTerms(searchCriteria, 'tag');
            const folderHighlightTerms = getSearchHighlightTerms(searchCriteria, 'folder');
            const searchExpandedGroupIds = collectSearchExpandedGroupIds(rootGroupIds, state.filterQuery);
            let listMotionIndex = 0;
            const countedSearchResultKeys = new Set();

            const getNextListMotionStyle = () => {
                const motionIndex = getCappedMotionIndex(listMotionIndex);
                listMotionIndex += 1;
                return `--sp-list-item-index:${motionIndex};`;
            };

            const renderSourceItem = (source) => {
                if (!source || !sourceMatchesCurrentFilters(source)) return null;
                if (searchCriteria.hasQuery) {
                    countedSearchResultKeys.add(source.key);
                }
                const isGated = !areAllAncestorsEnabled(source.key) || !isSourceWithinActiveIsolation(source.key);
                const isFailed = Boolean(source.isFailed || (source.isDisabled && !source.isLoading));
                const isLoading = source.isLoading;
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

                return el('div', {
                    className: 'source-item sp-list-item-enter sp-spotlight-surface' + extraClasses,
                    draggable: !isFailed && !isLoading ? 'true' : 'false',
                    dataset: { sourceKey: source.key },
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
                            'aria-label': getMessage('ui_source_actions'),
                            'aria-haspopup': 'menu',
                            'aria-expanded': isSourceActionMenuOpen ? 'true' : 'false',
                            disabled: !canOpenActions
                        }, [
                            el('span', { className: 'google-symbols' }, ['more_horiz'])
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
                                className: 'sp-tag-pill' + (state.activeTagId === tag.id ? ' is-active' : ''),
                                dataset: { tagId: tag.id },
                                title: getMessage('ui_tag_filter_active', [tag.label]),
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
                                disabled: isFailed || isLoading || source.hasNativeCheckbox === false
                            })
                            : el('input', {
                                type: 'checkbox',
                                className: 'sp-checkbox',
                                dataset: { sourceKey: source.key },
                                checked: source.enabled,
                                disabled: isFailed || isLoading || source.hasNativeCheckbox === false
                            })
                    ])
                ]);
            };

            const renderGroup = (group, level, ancestorGroupIds = new Set()) => {
                if (!group || ancestorGroupIds.has(group.id) || !shouldRenderGroup(group)) return null;
                const nextAncestorGroupIds = new Set(ancestorGroupIds);
                nextAncestorGroupIds.add(group.id);

                const isGated = !group.enabled || !areAllAncestorsEnabled(group.id) || !isGroupWithinActiveIsolation(group.id);
                const { on, total } = getGroupEffectiveState(group);
                const groupTitle = group.title || getMessage('ui_group_untitled');
                const childrenElements = [];
                const motionStyle = getNextListMotionStyle();
                const isSearchExpanded = searchExpandedGroupIds.has(group.id);
                const isCollapsed = group.collapsed && !isSearchExpanded;
                const groupChildren = Array.isArray(group.children) ? group.children : [];

                groupChildren.forEach((child) => {
                    if (child.type === 'source') {
                        const sourceElement = renderSourceItem(sourcesByKey.get(child.key));
                        if (sourceElement) childrenElements.push(sourceElement);
                        return;
                    }

                    const childGroup = groupsById.get(child.id);
                    if (!childGroup) return;
                    const childElement = renderGroup(childGroup, level + 1, nextAncestorGroupIds);
                    if (childElement) childrenElements.push(childElement);
                });

                if (childrenElements.length === 0 && !activeFilters) {
                    childrenElements.push(el('div', { className: 'sp-empty-state' }, [getMessage('ui_empty_group')]));
                }

                const groupEl = el('div', {
                    className: 'group-container sp-list-item-enter' + (isGated ? ' gated' : '') + (group.isNewlyCreated ? ' sp-folder-enter' : ''),
                    dataset: { groupId: group.id },
                    style: `padding-left: ${level * 20}px;${motionStyle}`
                }, [
                    el('div', { className: 'group-header sp-spotlight-surface', draggable: !state.isBatchMode ? 'true' : 'false', dataset: { dragType: 'group', groupId: group.id } }, [
	                        el('button', {
	                            type: 'button',
	                            className: 'sp-caret' + (isCollapsed ? ' collapsed' : ''),
	                            title: isCollapsed ? getMessage('ui_expand') : getMessage('ui_collapse'),
	                            'aria-label': isCollapsed ? getMessage('ui_expand') : getMessage('ui_collapse')
	                        }, [
                            el('span', { className: 'google-symbols' }, ['arrow_drop_down'])
                        ]),
                        !state.isBatchMode ? el('label', {
                            className: 'sp-toggle-switch',
                            title: group.enabled ? getMessage('ui_disable_group') : getMessage('ui_enable_group')
                        }, [
                            el('input', { type: 'checkbox', className: 'sp-group-toggle-checkbox', dataset: { groupId: group.id }, checked: group.enabled }),
                            el('span', { className: 'sp-toggle-slider' })
                        ]) : '',
                        createGroupTitleIconElement(),
	                        el('span', { className: 'group-title' }, createHighlightedTextChildren(groupTitle, folderHighlightTerms)),
	                        el('span', { className: 'badge' }, [` ${on} / ${total} `]),
	                        el('button', {
	                            type: 'button',
	                            className: 'sp-add-subgroup-button sp-glare-hover',
                            title: getMessage('ui_add_subgroup'),
                            'aria-label': getMessage('ui_add_subgroup')
                        }, [el('span', { className: 'google-symbols' }, ['create_new_folder'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-isolate-button sp-glare-hover' + (activeIsolationGroupId === group.id ? ' is-active' : ''),
                            title: getMessage('ui_isolate_group'),
                            'aria-label': getMessage('ui_isolate_group'),
                            'aria-pressed': activeIsolationGroupId === group.id ? 'true' : 'false'
                        }, [el('span', { className: 'google-symbols' }, ['filter_center_focus'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-edit-button sp-glare-hover',
                            title: getMessage('ui_rename'),
                            'aria-label': getMessage('ui_rename')
                        }, [el('span', { className: 'google-symbols' }, ['edit'])]),
                        el('button', {
                            type: 'button',
                            className: 'sp-delete-button sp-glare-hover',
                            title: getMessage('ui_delete_group'),
                            'aria-label': getMessage('ui_delete_group')
                        }, [el('span', { className: 'google-symbols' }, ['delete'])])
                    ]),
	                    el('div', { className: 'group-children' + (isCollapsed ? ' collapsed' : '') }, childrenElements)
	                ]);

                if (group.isNewlyCreated) {
                    delete group.isNewlyCreated;
                }

                return groupEl;
            };

            if (activeIsolationGroupId) {
                const isolatedGroupElement = renderGroup(groupsById.get(activeIsolationGroupId), 0);
                if (isolatedGroupElement) {
                    fragment.appendChild(isolatedGroupElement);
                }
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
                        if (sourceElement) {
                            fragment.appendChild(sourceElement);
                        }
                    }
                });
            }

            if (!activeIsolationGroupId) {
                const matchingUngrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((key) => {
                    const source = sourcesByKey.get(key);
                    return source && sourceMatchesCurrentFilters(source);
                });

                if (matchingUngrouped.length > 0) {
                    const ungroupedSection = el('div', { className: 'ungrouped-section' });

                    const ungroupedHeader = doc.createElement('h4');
                    ungroupedHeader.className = 'ungrouped-header';
                    ungroupedHeader.textContent = getMessage('ui_ungrouped');
                    ungroupedSection.appendChild(ungroupedHeader);

                    matchingUngrouped.forEach((key) => {
                        const sourceElement = renderSourceItem(sourcesByKey.get(key));
                        if (sourceElement) {
                            ungroupedSection.appendChild(sourceElement);
                        }
                    });

                    fragment.appendChild(ungroupedSection);
                }
            }

            if (fragment.childNodes.length === 0) {
                fragment.appendChild(el('div', { className: 'sp-empty-state' }, [getMessage('ui_no_matching_sources')]));
            }
            updateSearchResultCount(state.filterQuery, countedSearchResultKeys.size);

            // The batch toggle lives in the static toolbar shell (persists across renders),
            // so reflect its pressed/active state here like the other aria-pressed toggles
            // (quick-view, isolate) that are rebuilt per render.
            const batchToggleBtn = shadowRoot?.getElementById?.('sp-batch-action-btn');
            if (batchToggleBtn) {
                const batchActive = Boolean(state.isBatchMode);
                batchToggleBtn.setAttribute('aria-pressed', batchActive ? 'true' : 'false');
                batchToggleBtn.classList.toggle('is-active', batchActive);
            }

            if (state.isBatchMode) {
                const actionBar = el('div', { className: 'sp-batch-action-bar', role: 'toolbar', 'aria-label': getMessage('ui_batch_actions_region') }, [
                    el('button', { className: 'sp-button sp-cancel-batch-btn' }, [getMessage('ui_cancel')]),
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
                ]);
                fragment.appendChild(actionBar);
            }

            const previousBatchCountSnapshot = collectBatchCountSnapshot(listContainer);
            if (typeof deps.onBeforeRowsPatch === 'function') {
                try { deps.onBeforeRowsPatch(); } catch (_) { /* ignore hook errors */ }
            }
            patchChildren(listContainer, fragment);
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
            render
        };
    }

    globalThis.NSM_CREATE_CONTENT_RENDER = createContentRender;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentRender;
    }
})();
