(function () {
    'use strict';

    /**
     * createContentViewState(deps) — 渲染层的 filter / search / isolation / effective-enabled 计算。
     * 不直接画 DOM,只为 createContentRender 提供 predicate 与 derived 状态:
     *  - Effective enabled:`getEffectivelyEnabledSources` + `isSourceEffectivelyEnabled` —
     *    一个 source 真正有效需要所有祖先 group 都 enabled(`areAllAncestorsEnabled`)。
     *    `syncSourcesToEffectiveState` 把结果推回 NotebookLM DOM。
     *  - Isolation 视图:`isGroupWithinActiveIsolation` / `isSourceWithinActiveIsolation` —
     *    只渲染 activeIsolationGroupId 的后代。
     *  - 搜索:委托 searchSemantics 解析"标题词 + tag:xxx + folder:xxx"语法,
     *    `sourceMatchesSearchCriteria` / `groupMatchesSearchCriteria` 做 predicate。
     *    搜索栏 UI:展开/折叠/外点关闭(handleSearchButtonClick / handleSearchOutsideClick /
     *    handleDocumentOutsideClick)。
     *  - Quick view:ungrouped / disabled / recent (7 天内) / issues / tag —
     *    `sourceMatchesQuickView`、`isSourceIssue`、`isSourceRecentlyAdded`。
     *  - 综合 predicate:`sourceMatchesCurrentFilters`, `hasActiveRenderFilters`,
     *    `shouldRenderGroup`(含 groupHasRenderableDescendant 递归)。
     *
     * @param {Object} deps 由 index 注入；独立调用时须传入 searchSemantics，
     *   或先加载会注册 NSM_CREATE_CONTENT_SEARCH_SEMANTICS 的无 bundler helper。其余依赖有 runtime fallback，主要分两类:
     *   - state getters:getState, getGroupsById, getSourcesByKey, getTagsById, getParentMap,
     *     getShadowRoot, getActiveIsolationGroupId, getIsSearchExpanded, setIsSearchExpanded,
     *     getExtensionHost, getNow, getSourceTagIds
     *   - 行为回调:getMessage, render, closeSourceActionMenu, dismissSourceActionMenuAndRender,
     *     getActiveSourceActionSourceKey, syncSourceToPage, isDescendant
     *   完整 deps 取出见 line 5+。
     * @returns {Object} 30+ helpers,大致分组:
     *   - Enabled / isolation:getEffectivelyEnabledSources, areAllAncestorsEnabled,
     *     isSourceEffectivelyEnabled, isGroupWithinActiveIsolation, isSourceWithinActiveIsolation
     *   - Filter orchestration:normalizeQuickViewKind, sourceMatchesQuickView,
     *     isSourceIssue, isSourceRecentlyAdded；query 解析与匹配由 searchSemantics 提供
     *   - 综合 predicate:sourceMatchesCurrentFilters, hasActiveRenderFilters,
     *     groupHasRenderableDescendant, shouldRenderGroup
     *   - 搜索 UI:getSearchUiElements, getCurrentSearchValue, hasCurrentSearchValue,
     *     isSearchUiCurrentlyExpanded, syncSearchUi, expandSearch, collapseSearchIfEmpty,
     *     handleSearchButtonClick, handleSearchCloseButtonClick, handleSearchOutsideClick,
     *     handleDocumentOutsideClick, handleSourceActionMenuViewportChange
     *   - 状态推回:collectEffectiveSourceStates, syncSourcesToEffectiveState, isDescendant
     *   完整 return 块见 line 663。
     */
    function createContentViewState(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};
        const runtime = ctx.runtime && typeof ctx.runtime === 'object' ? ctx.runtime : ctx;

        const getState = typeof ctx.getState === 'function'
            ? ctx.getState
            : () => (runtime.state || { root: [], ungrouped: [], filterQuery: '', activeTagId: null });
        const getGroupsById = typeof ctx.getGroupsById === 'function'
            ? ctx.getGroupsById
            : () => (runtime.groupsById || new Map());
        const getSourcesByKey = typeof ctx.getSourcesByKey === 'function'
            ? ctx.getSourcesByKey
            : () => (runtime.sourcesByKey || new Map());
        const getTagsById = typeof ctx.getTagsById === 'function'
            ? ctx.getTagsById
            : () => (runtime.tagsById || new Map());
        const getParentMap = typeof ctx.getParentMap === 'function'
            ? ctx.getParentMap
            : () => (runtime.parentMap || new Map());
        const getShadowRoot = typeof ctx.getShadowRoot === 'function'
            ? ctx.getShadowRoot
            : () => (runtime.shadowRoot || null);
        const getActiveIsolationGroupId = typeof ctx.getActiveIsolationGroupId === 'function'
            ? ctx.getActiveIsolationGroupId
            : () => runtime.activeIsolationGroupId || null;
        const getNow = typeof ctx.getNow === 'function'
            ? ctx.getNow
            : () => new Date();
        const getIsSearchExpanded = typeof ctx.getIsSearchExpanded === 'function'
            ? ctx.getIsSearchExpanded
            : () => Boolean(runtime.isSearchExpanded);
        const getExtensionHost = typeof ctx.getExtensionHost === 'function'
            ? ctx.getExtensionHost
            : () => runtime.extensionHost || null;
        const setIsSearchExpanded = typeof ctx.setIsSearchExpanded === 'function'
            ? ctx.setIsSearchExpanded
            : (value) => {
                if (runtime && typeof runtime === 'object') {
                    runtime.isSearchExpanded = Boolean(value);
                }
            };
        const getMessage = typeof ctx.getMessage === 'function'
            ? ctx.getMessage
            : (key) => key;
        const render = typeof ctx.render === 'function'
            ? ctx.render
            : () => {};
        const closeSourceActionMenu = typeof ctx.closeSourceActionMenu === 'function'
            ? ctx.closeSourceActionMenu
            : () => {};
        const dismissSourceActionMenuAndRender = typeof ctx.dismissSourceActionMenuAndRender === 'function'
            ? ctx.dismissSourceActionMenuAndRender
            : () => false;
        const getActiveSourceActionSourceKey = typeof ctx.getActiveSourceActionSourceKey === 'function'
            ? ctx.getActiveSourceActionSourceKey
            : () => null;
        const syncSourceToPage = typeof ctx.syncSourceToPage === 'function'
            ? ctx.syncSourceToPage
            : () => {};
        const syncSourceToPageWithResult = typeof ctx.syncSourceToPageWithResult === 'function'
            ? ctx.syncSourceToPageWithResult
            : (source, desiredState) => {
                const started = syncSourceToPage(source, desiredState);
                return Promise.resolve(started === false
                    ? {
                        ok: false,
                        sourceKey: source?.key || '',
                        desiredState: Boolean(desiredState),
                        reason: 'native_selection_sync_not_started'
                    }
                    : {
                        ok: true,
                        sourceKey: source?.key || '',
                        desiredState: Boolean(desiredState),
                        reason: 'native_selection_sync_started'
                    });
            };
        const getSourceTagIds = typeof ctx.getSourceTagIds === 'function'
            ? ctx.getSourceTagIds
            : () => [];
        const createSearchSemantics = typeof globalThis.NSM_CREATE_CONTENT_SEARCH_SEMANTICS === 'function'
            ? globalThis.NSM_CREATE_CONTENT_SEARCH_SEMANTICS
            : null;
        const searchSemantics = ctx.searchSemantics && typeof ctx.searchSemantics === 'object'
            ? ctx.searchSemantics
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
        ) {
            throw new Error(
                'GeminiNotebook-Source-Management: Content search semantics are missing.'
            );
        }
        const parseSearchQuery = searchSemantics.parseQuery;
        const sourceMatchesSearchCriteria = searchSemantics.matchesSource;
        const groupMatchesSearchCriteria = searchSemantics.matchesGroup;
        const isDescendant = typeof ctx.isDescendant === 'function'
            ? ctx.isDescendant
            : (typeof globalThis.isDescendant === 'function' ? globalThis.isDescendant : defaultIsDescendant);
        const QUICK_VIEW_KINDS = new Set(['ungrouped', 'disabled', 'recent', 'issues']);
        const RECENT_SOURCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

        function defaultIsDescendant(possibleChild, possibleParent, groupsById) {
            if (!possibleChild || !possibleParent || possibleChild.id === possibleParent.id) return true;
            if (!groupsById || typeof groupsById.get !== 'function') return false;

            const stack = [possibleParent];
            const visited = new Set();
            while (stack.length > 0) {
                const group = stack.pop();
                if (!group || visited.has(group.id)) continue;
                visited.add(group.id);
                for (const child of group.children || []) {
                    if (child?.type !== 'group') continue;
                    if (child.id === possibleChild.id) return true;
                    if (!visited.has(child.id)) stack.push(groupsById.get(child.id));
                }
            }
            return false;
        }

        function getEffectivelyEnabledSources() {
            const state = getState() || {};
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const effectivelyEnabled = new Map();

            const rootEntries = Array.isArray(state.root)
                ? state.root
                : (Array.isArray(state.groups) ? state.groups.map((id) => ({ type: 'group', id })) : []);
            const stack = [];
            for (let index = rootEntries.length - 1; index >= 0; index -= 1) {
                const entry = rootEntries[index];
                if (entry?.type === 'group') {
                    stack.push({
                        kind: 'group',
                        group: groupsById.get(entry.id),
                        ancestorsEnabled: true,
                        ancestorGroupIds: new Set()
                    });
                } else if (entry?.type === 'source') {
                    stack.push({ kind: 'source', sourceKey: entry.key, effectivelyEnabled: true });
                }
            }

            while (stack.length > 0) {
                const task = stack.pop();
                if (task.kind === 'source') {
                    const source = sourcesByKey.get(task.sourceKey);
                    if (source && source.enabled && task.effectivelyEnabled) {
                        effectivelyEnabled.set(task.sourceKey, true);
                    }
                    continue;
                }
                const group = task.group;
                if (!group || task.ancestorGroupIds.has(group.id)) continue;
                const nextAncestorGroupIds = new Set(task.ancestorGroupIds);
                nextAncestorGroupIds.add(group.id);
                const currentEffectivelyEnabled = task.ancestorsEnabled && Boolean(group.enabled);
                const children = Array.isArray(group.children) ? group.children : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    const child = children[index];
                    if (child?.type === 'source') {
                        stack.push({
                            kind: 'source',
                            sourceKey: child.key,
                            effectivelyEnabled: currentEffectivelyEnabled
                        });
                    } else if (child?.type === 'group') {
                        stack.push({
                            kind: 'group',
                            group: groupsById.get(child.id),
                            ancestorsEnabled: currentEffectivelyEnabled,
                            ancestorGroupIds: nextAncestorGroupIds
                        });
                    }
                }
            }

            for (const sourceKey of state.ungrouped || []) {
                const source = sourcesByKey.get(sourceKey);
                if (source && source.enabled) {
                    effectivelyEnabled.set(sourceKey, true);
                }
            }

            return effectivelyEnabled;
        }

        function areAllAncestorsEnabled(keyOrId) {
            const parentMap = getParentMap();
            const groupsById = getGroupsById();
            let parentId = parentMap.get(keyOrId);
            const visitedParentIds = new Set();

            while (parentId) {
                if (visitedParentIds.has(parentId)) {
                    return false;
                }
                visitedParentIds.add(parentId);
                const parentGroup = groupsById.get(parentId);
                if (!parentGroup || !parentGroup.enabled) {
                    return false;
                }
                parentId = parentMap.get(parentId);
            }

            return true;
        }

        function isSourceEffectivelyEnabled(source) {
            if (!source) return false;
            return Boolean(source.enabled)
                && areAllAncestorsEnabled(source.key)
                && isSourceWithinActiveIsolation(source.key);
        }

        function isGroupWithinActiveIsolation(groupId) {
            const activeIsolationGroupId = getActiveIsolationGroupId();
            if (!activeIsolationGroupId) return true;

            const groupsById = getGroupsById();
            const group = groupsById.get(groupId);
            const isolatedGroup = groupsById.get(activeIsolationGroupId);
            if (!group || !isolatedGroup) return false;
            return isDescendant(group, isolatedGroup, groupsById);
        }

        function isSourceWithinActiveIsolation(sourceKey) {
            const activeIsolationGroupId = getActiveIsolationGroupId();
            if (!activeIsolationGroupId) return true;

            const parentMap = getParentMap();
            let currentParentId = parentMap.get(sourceKey);
            const visitedParentIds = new Set();
            while (currentParentId) {
                if (visitedParentIds.has(currentParentId)) {
                    return false;
                }
                visitedParentIds.add(currentParentId);
                if (currentParentId === activeIsolationGroupId) {
                    return true;
                }
                currentParentId = parentMap.get(currentParentId);
            }

            return false;
        }

        function normalizeQuickViewKind(value) {
            const kind = String(value || '').trim().toLowerCase();
            return QUICK_VIEW_KINDS.has(kind) ? kind : null;
        }

        function isSourceIssue(source) {
            if (!source) return false;
            return Boolean(
                source.isLoading ||
                source.isFailed ||
                (source.isDisabled && !source.isLoading)
            );
        }

        function isSourceRecentlyAdded(source) {
            if (!source?.addedAt) return false;
            const addedAtTime = Date.parse(source.addedAt);
            if (!Number.isFinite(addedAtTime)) return false;
            const now = getNow();
            const nowTime = now instanceof Date ? now.getTime() : Date.parse(now);
            if (!Number.isFinite(nowTime)) return false;
            const ageMs = nowTime - addedAtTime;
            return ageMs >= 0 && ageMs <= RECENT_SOURCE_WINDOW_MS;
        }

        function isSourceExplicitlyOrAncestorDisabled(source) {
            if (!source || isSourceIssue(source)) return false;
            return source.enabled === false || !areAllAncestorsEnabled(source.key);
        }

        function sourceMatchesQuickView(source, quickViewKind) {
            const kind = normalizeQuickViewKind(quickViewKind);
            if (!kind) return true;
            const state = getState() || {};

            if (kind === 'ungrouped') {
                return (Array.isArray(state.ungrouped) ? state.ungrouped : []).includes(source?.key);
            }
            if (kind === 'disabled') {
                return isSourceExplicitlyOrAncestorDisabled(source);
            }
            if (kind === 'recent') {
                return isSourceRecentlyAdded(source);
            }
            if (kind === 'issues') {
                return isSourceIssue(source);
            }
            return true;
        }

        function sourceMatchesCurrentFilters(source) {
            if (!source) return false;

            const state = getState() || {};
            const searchCriteria = parseSearchQuery(state.filterQuery || '');
            if (searchCriteria.hasQuery && !sourceMatchesSearchCriteria(source, searchCriteria)) {
                return false;
            }

            if (!sourceMatchesQuickView(source, state.activeQuickViewKind)) {
                return false;
            }

            if (state.activeTagId && !getSourceTagIds(source.key).includes(state.activeTagId)) {
                return false;
            }

            return true;
        }

        function hasActiveRenderFilters() {
            const state = getState() || {};
            return Boolean(
                parseSearchQuery(state.filterQuery || '').hasQuery ||
                state.activeTagId ||
                normalizeQuickViewKind(state.activeQuickViewKind)
            );
        }

        function groupHasRenderableDescendant(group, ancestorGroupIds = new Set()) {
            if (!group || ancestorGroupIds.has(group.id)) return false;
            const state = getState() || {};
            const searchCriteria = parseSearchQuery(state.filterQuery || '');
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const visitedGroupIds = new Set(ancestorGroupIds);
            const stack = [group];

            while (stack.length > 0) {
                const currentGroup = stack.pop();
                if (!currentGroup || visitedGroupIds.has(currentGroup.id)) continue;
                visitedGroupIds.add(currentGroup.id);
                if (groupMatchesSearchCriteria(currentGroup, searchCriteria)) {
                    return true;
                }

                const children = Array.isArray(currentGroup.children)
                    ? currentGroup.children
                    : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    const child = children[index];
                    if (child?.type === 'source') {
                        const source = sourcesByKey.get(child.key);
                        if (source && sourceMatchesCurrentFilters(source)) {
                            return true;
                        }
                    } else if (child?.type === 'group' && !visitedGroupIds.has(child.id)) {
                        stack.push(groupsById.get(child.id));
                    }
                }
            }

            return false;
        }

        function shouldRenderGroup(group) {
            if (!group) return false;
            if (!hasActiveRenderFilters()) return true;
            return groupHasRenderableDescendant(group);
        }

        function getSearchUiElements() {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return {};

            return {
                controls: shadowRoot.querySelector('.sp-controls'),
                searchCluster: shadowRoot.querySelector('.sp-search-cluster'),
                searchContainer: shadowRoot.querySelector('.sp-search-container'),
                searchInput: shadowRoot.getElementById('sp-search'),
                searchButton: shadowRoot.getElementById('sp-search-btn'),
                searchCloseButton: shadowRoot.getElementById('sp-search-close-btn')
            };
        }

        function getCurrentSearchValue(searchInput) {
            if (searchInput && typeof searchInput.value === 'string') {
                return searchInput.value;
            }

            const state = getState() || {};
            return state.filterQuery || '';
        }

        function hasCurrentSearchValue(searchInput) {
            return Boolean(getCurrentSearchValue(searchInput).trim());
        }

        function isSearchUiCurrentlyExpanded(searchInput) {
            return Boolean(getIsSearchExpanded()) || hasCurrentSearchValue(searchInput);
        }

        function syncSearchUi() {
            const {
                controls,
                searchCluster,
                searchContainer,
                searchInput,
                searchButton,
                searchCloseButton
            } = getSearchUiElements();
            if (
                !controls ||
                !searchCluster ||
                !searchContainer ||
                !searchInput ||
                !searchButton ||
                !searchCloseButton
            ) {
                return;
            }

            const state = getState() || {};
            const expanded = isSearchUiCurrentlyExpanded(searchInput);
            const hasValue = hasCurrentSearchValue(searchInput);
            const label = getMessage('ui_filter_sources');
            const closeLabel = getMessage('ui_cancel');

            controls.classList.toggle('is-search-expanded', expanded);
            controls.classList.toggle('has-active-query', hasValue);
            searchCluster.classList.toggle('is-search-expanded', expanded);
            searchCluster.classList.toggle('has-value', hasValue);
            searchContainer.classList.toggle('is-expanded', expanded);
            searchContainer.classList.toggle('has-value', hasValue);
            if (searchInput.value !== (state.filterQuery || '')) {
                searchInput.value = state.filterQuery || '';
            }
            searchInput.tabIndex = expanded ? 0 : -1;
            searchInput.setAttribute('aria-hidden', expanded ? 'false' : 'true');
            searchButton.setAttribute('title', label);
            searchButton.setAttribute('aria-label', label);
            searchButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            searchCloseButton.classList.toggle('is-visible', expanded);
            searchCloseButton.setAttribute('title', closeLabel);
            searchCloseButton.setAttribute('aria-label', closeLabel);
            searchCloseButton.setAttribute('aria-hidden', expanded ? 'false' : 'true');
            searchCloseButton.tabIndex = expanded ? 0 : -1;

            if (!expanded && typeof searchInput.blur === 'function') {
                searchInput.blur();
            }
        }

        function expandSearch(options = {}) {
            const { focus = false } = options;
            setIsSearchExpanded(true);
            syncSearchUi();

            if (!focus) return;

            const { searchInput } = getSearchUiElements();
            if (searchInput && typeof searchInput.focus === 'function') {
                searchInput.focus();
            }
        }

        function collapseSearchIfEmpty() {
            const { searchInput } = getSearchUiElements();
            if (hasCurrentSearchValue(searchInput)) return false;

            setIsSearchExpanded(false);
            syncSearchUi();
            return true;
        }

        function handleSearchButtonClick(triggerSearch) {
            const { searchInput } = getSearchUiElements();
            if (!isSearchUiCurrentlyExpanded(searchInput)) {
                expandSearch({ focus: true });
                return 'expanded';
            }

            if (!hasCurrentSearchValue(searchInput)) {
                collapseSearchIfEmpty();
                return 'collapsed';
            }

            if (typeof triggerSearch === 'function') {
                triggerSearch();
            }

            return 'searched';
        }

        function handleSearchCloseButtonClick(onClose) {
            const { searchInput } = getSearchUiElements();
            const state = getState() || {};
            const hadValue = hasCurrentSearchValue(searchInput);

            state.filterQuery = '';
            if (searchInput && typeof searchInput.value === 'string') {
                searchInput.value = '';
            }

            setIsSearchExpanded(false);
            syncSearchUi();

            if (typeof onClose === 'function') {
                onClose({ hadValue });
            }

            return hadValue ? 'cleared' : 'collapsed';
        }

        function handleSearchOutsideClick(event) {
            const target = event?.target;
            let didCloseAnyUi = false;

            if (
                getActiveSourceActionSourceKey() &&
                target &&
                typeof target.closest === 'function' &&
                !target.closest('.sp-source-actions-button') &&
                !target.closest('.sp-source-actions-menu')
            ) {
                closeSourceActionMenu();
                didCloseAnyUi = true;
            }

            const { searchCluster, searchInput } = getSearchUiElements();
            if (
                searchCluster &&
                isSearchUiCurrentlyExpanded(searchInput) &&
                !hasCurrentSearchValue(searchInput)
            ) {
                if (target && typeof target.closest === 'function' && target.closest('.sp-search-cluster')) {
                    if (didCloseAnyUi) {
                        render();
                    }
                    return didCloseAnyUi;
                }

                setIsSearchExpanded(false);
                syncSearchUi();
                didCloseAnyUi = true;
            }

            if (didCloseAnyUi) {
                render();
            }

            return didCloseAnyUi;
        }

        function handleDocumentOutsideClick(event) {
            if (!getActiveSourceActionSourceKey()) return false;

            const extensionHost = getExtensionHost();
            if (!extensionHost) return false;

            const composedPath = typeof event?.composedPath === 'function' ? event.composedPath() : [];
            if (Array.isArray(composedPath) && composedPath.includes(extensionHost)) {
                return false;
            }

            return dismissSourceActionMenuAndRender();
        }

        function handleSourceActionMenuViewportChange() {
            return dismissSourceActionMenuAndRender();
        }

        function collectEffectiveSourceStates() {
            const sourcesByKey = getSourcesByKey();
            const effectiveStates = new Map();
            sourcesByKey.forEach((source, sourceKey) => {
                effectiveStates.set(sourceKey, isSourceEffectivelyEnabled(source));
            });
            return effectiveStates;
        }

        function syncSourcesToEffectiveState(previousStates = null) {
            const sourcesByKey = getSourcesByKey();
            const nextStates = collectEffectiveSourceStates();
            const changedSourceKeys = [];
            const confirmations = [];
            nextStates.forEach((desiredState, sourceKey) => {
                if (previousStates && previousStates.get(sourceKey) === desiredState) return;
                changedSourceKeys.push(sourceKey);
                let confirmation;
                try {
                    confirmation = syncSourceToPageWithResult(
                        sourcesByKey.get(sourceKey),
                        desiredState
                    );
                } catch (error) {
                    confirmation = {
                        ok: false,
                        sourceKey,
                        desiredState,
                        reason: error?.reason || error?.message || 'native_selection_sync_error'
                    };
                }
                confirmations.push(Promise.resolve(confirmation)
                    .then((result) => (
                        result?.ok === true
                            ? result
                            : {
                                ok: false,
                                sourceKey,
                                desiredState,
                                reason: result?.reason || 'native_selection_sync_failed'
                            }
                    ))
                    .catch((error) => ({
                        ok: false,
                        sourceKey,
                        desiredState,
                        reason: error?.reason || error?.message || 'native_selection_sync_error'
                    })));
            });

            const confirmation = Promise.all(confirmations).then((results) => {
                const failed = results.filter((result) => result?.ok !== true);
                return {
                    ok: failed.length === 0,
                    changedSourceKeys: changedSourceKeys.slice(),
                    succeeded: results.filter((result) => result?.ok === true),
                    failed,
                    reason: failed.length > 0 ? 'native_selection_sync_failed' : 'confirmed'
                };
            });
            Object.defineProperties(nextStates, {
                changedSourceKeys: {
                    configurable: true,
                    value: changedSourceKeys.slice()
                },
                confirmation: {
                    configurable: true,
                    value: confirmation
                }
            });
            confirmation.then((result) => {
                if (!result.ok) render();
            });
            return nextStates;
        }

        function awaitEffectiveStateSync(syncHandle) {
            const confirmation = syncHandle?.confirmation;
            if (!confirmation || typeof confirmation.then !== 'function') {
                return Promise.resolve({
                    ok: true,
                    changedSourceKeys: [],
                    succeeded: [],
                    failed: [],
                    reason: 'no_native_changes'
                });
            }
            return Promise.resolve(confirmation).catch((error) => ({
                ok: false,
                changedSourceKeys: Array.isArray(syncHandle?.changedSourceKeys)
                    ? syncHandle.changedSourceKeys.slice()
                    : [],
                succeeded: [],
                failed: [{
                    sourceKey: '',
                    reason: error?.reason || error?.message || 'native_selection_sync_error'
                }],
                reason: 'native_selection_sync_failed'
            }));
        }

        function runEffectiveStateTransition(mutate, afterMutate = null) {
            if (typeof mutate !== 'function') {
                return {
                    ok: false,
                    reason: 'invalid_transition',
                    changedSourceKeys: []
                };
            }
            const previousStates = collectEffectiveSourceStates();
            const result = mutate();
            if (result === false) {
                return {
                    ok: false,
                    reason: 'transition_rejected',
                    result,
                    changedSourceKeys: []
                };
            }
            if (typeof afterMutate === 'function') {
                afterMutate(result);
            }
            const nextStates = syncSourcesToEffectiveState(previousStates);
            const changedSourceKeys = [];
            nextStates.forEach((desiredState, sourceKey) => {
                if (previousStates.get(sourceKey) !== desiredState) {
                    changedSourceKeys.push(sourceKey);
                }
            });
            return {
                ok: true,
                result,
                previousStates,
                nextStates,
                changedSourceKeys,
                confirmation: awaitEffectiveStateSync(nextStates)
            };
        }

        return {
            getEffectivelyEnabledSources,
            areAllAncestorsEnabled,
            isSourceEffectivelyEnabled,
            isGroupWithinActiveIsolation,
            isSourceWithinActiveIsolation,
            normalizeQuickViewKind,
            sourceMatchesQuickView,
            isSourceIssue,
            isSourceRecentlyAdded,
            sourceMatchesCurrentFilters,
            hasActiveRenderFilters,
            groupHasRenderableDescendant,
            shouldRenderGroup,
            getSearchUiElements,
            getCurrentSearchValue,
            hasCurrentSearchValue,
            isSearchUiCurrentlyExpanded,
            syncSearchUi,
            expandSearch,
            collapseSearchIfEmpty,
            handleSearchButtonClick,
            handleSearchCloseButtonClick,
            handleSearchOutsideClick,
            handleDocumentOutsideClick,
            handleSourceActionMenuViewportChange,
            collectEffectiveSourceStates,
            syncSourcesToEffectiveState,
            awaitEffectiveStateSync,
            runEffectiveStateTransition,
            isDescendant
        };
    }

    globalThis.NSM_CREATE_CONTENT_VIEW_STATE = createContentViewState;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentViewState;
    }
})();
