(function () {
    'use strict';

    function createContentViewState(deps = {}) {
        const ctx = deps && typeof deps === 'object' ? deps : {};
        const runtime = ctx.runtime && typeof ctx.runtime === 'object' ? ctx.runtime : ctx;

        const getState = typeof ctx.getState === 'function'
            ? ctx.getState
            : () => (runtime.state || { groups: [], ungrouped: [], filterQuery: '', activeTagId: null });
        const getGroupsById = typeof ctx.getGroupsById === 'function'
            ? ctx.getGroupsById
            : () => (runtime.groupsById || new Map());
        const getSourcesByKey = typeof ctx.getSourcesByKey === 'function'
            ? ctx.getSourcesByKey
            : () => (runtime.sourcesByKey || new Map());
        const getParentMap = typeof ctx.getParentMap === 'function'
            ? ctx.getParentMap
            : () => (runtime.parentMap || new Map());
        const getShadowRoot = typeof ctx.getShadowRoot === 'function'
            ? ctx.getShadowRoot
            : () => (runtime.shadowRoot || null);
        const getActiveIsolationGroupId = typeof ctx.getActiveIsolationGroupId === 'function'
            ? ctx.getActiveIsolationGroupId
            : () => runtime.activeIsolationGroupId || null;
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
        const getSourceTagIds = typeof ctx.getSourceTagIds === 'function'
            ? ctx.getSourceTagIds
            : () => [];
        const isDescendant = typeof ctx.isDescendant === 'function'
            ? ctx.isDescendant
            : (typeof globalThis.isDescendant === 'function' ? globalThis.isDescendant : () => false);

        function getEffectivelyEnabledSources() {
            const state = getState() || {};
            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            const effectivelyEnabled = new Map();

            const visit = (group, ancestorsEnabled) => {
                if (!group) return;
                const currentEffectivelyEnabled = ancestorsEnabled && Boolean(group.enabled);
                for (const child of group.children || []) {
                    if (child.type === 'source') {
                        const source = sourcesByKey.get(child.key);
                        if (source && source.enabled && currentEffectivelyEnabled) {
                            effectivelyEnabled.set(child.key, true);
                        }
                    } else if (child.type === 'group') {
                        const subGroup = groupsById.get(child.id);
                        if (subGroup) visit(subGroup, currentEffectivelyEnabled);
                    }
                }
            };

            for (const groupId of state.groups || []) {
                const group = groupsById.get(groupId);
                if (group) visit(group, true);
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

            while (parentId) {
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
            while (currentParentId) {
                if (currentParentId === activeIsolationGroupId) {
                    return true;
                }
                currentParentId = parentMap.get(currentParentId);
            }

            return false;
        }

        function sourceMatchesCurrentFilters(source) {
            if (!source) return false;

            const state = getState() || {};
            const filterQuery = String(state.filterQuery || '').toLowerCase();
            if (filterQuery && (!source.lowercaseTitle || !source.lowercaseTitle.includes(filterQuery))) {
                return false;
            }

            if (state.activeTagId && !getSourceTagIds(source.key).includes(state.activeTagId)) {
                return false;
            }

            return true;
        }

        function hasActiveRenderFilters() {
            const state = getState() || {};
            return Boolean(String(state.filterQuery || '').trim() || state.activeTagId);
        }

        function groupHasRenderableDescendant(group) {
            if (!group) return false;

            const groupsById = getGroupsById();
            const sourcesByKey = getSourcesByKey();
            for (const child of group.children || []) {
                if (child.type === 'source') {
                    const source = sourcesByKey.get(child.key);
                    if (source && sourceMatchesCurrentFilters(source)) {
                        return true;
                    }
                    continue;
                }

                const childGroup = groupsById.get(child.id);
                if (childGroup && groupHasRenderableDescendant(childGroup)) {
                    return true;
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

            if (!previousStates) {
                nextStates.forEach((desiredState, sourceKey) => {
                    syncSourceToPage(sourcesByKey.get(sourceKey), desiredState);
                });
                return nextStates;
            }

            nextStates.forEach((desiredState, sourceKey) => {
                if (previousStates.get(sourceKey) !== desiredState) {
                    syncSourceToPage(sourcesByKey.get(sourceKey), desiredState);
                }
            });

            return nextStates;
        }

        return {
            getEffectivelyEnabledSources,
            areAllAncestorsEnabled,
            isSourceEffectivelyEnabled,
            isGroupWithinActiveIsolation,
            isSourceWithinActiveIsolation,
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
            syncSourcesToEffectiveState
        };
    }

    globalThis.NSM_CREATE_CONTENT_VIEW_STATE = createContentViewState;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentViewState;
    }
})();
