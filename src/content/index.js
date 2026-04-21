(function () {
    'use strict';

    // --- Selectors & Dependencies ---
    const contentConfig = globalThis.NSM_CONTENT_CONFIG;
    const sourceDescriptorHelpers = globalThis.NSM_SOURCE_DESCRIPTOR_HELPERS;
    const contentStyleText = globalThis.NSM_CONTENT_STYLE_TEXT;
    const globalOverlayStyleText = globalThis.NSM_GLOBAL_OVERLAY_STYLE_TEXT;
    const createManagerShell = globalThis.NSM_CREATE_MANAGER_SHELL;
    const createContentPanelDom = globalThis.NSM_CREATE_CONTENT_PANEL_DOM;
    const createContentSourceActions = globalThis.NSM_CREATE_CONTENT_SOURCE_ACTIONS;
    const createContentTags = globalThis.NSM_CREATE_CONTENT_TAGS;
    const createContentStateReconcile = globalThis.NSM_CREATE_CONTENT_STATE_RECONCILE;
    const createContentPersistence = globalThis.NSM_CREATE_CONTENT_PERSISTENCE;
    const createContentModals = globalThis.NSM_CREATE_CONTENT_MODALS;
    const createContentRender = globalThis.NSM_CREATE_CONTENT_RENDER;
    const createContentViewState = globalThis.NSM_CREATE_CONTENT_VIEW_STATE;
    const createContentTreeInteractions = globalThis.NSM_CREATE_CONTENT_TREE_INTERACTIONS;
    const createContentSourceSync = globalThis.NSM_CREATE_CONTENT_SOURCE_SYNC;

    if (
        !contentConfig ||
        !sourceDescriptorHelpers ||
        typeof contentStyleText !== 'string' ||
        typeof globalOverlayStyleText !== 'string' ||
        typeof createManagerShell !== 'function' ||
        typeof createContentPanelDom !== 'function' ||
        typeof createContentSourceActions !== 'function' ||
        typeof createContentTags !== 'function' ||
        typeof createContentStateReconcile !== 'function' ||
        typeof createContentPersistence !== 'function' ||
        typeof createContentModals !== 'function' ||
        typeof createContentRender !== 'function' ||
        typeof createContentViewState !== 'function' ||
        typeof createContentTreeInteractions !== 'function' ||
        typeof createContentSourceSync !== 'function'
    ) {
        throw new Error('NotebookLM Source Management: Content helpers are missing.');
    }

    const {
        DEPS,
        SOURCE_CHECKBOX_SELECTOR,
        STORAGE_SCHEMA_VERSION,
        GLOBAL_OVERLAY_STYLE_ID,
        ROUTE_REINIT_MAX_ATTEMPTS,
        ROUTE_REINIT_RETRY_DELAY_MS
    } = contentConfig;
    const {
        createSourceDescriptor,
        extractSourceIdentitySnapshot,
        extractSourceIconImageUrl,
        isManageableSourceIdentity,
        normalizeSourceText
    } = sourceDescriptorHelpers;

    // --- State Management ---
    let state = {
        groups: [], // Holds top-level group IDs
        ungrouped: [],
        filterQuery: '',
        isBatchMode: false,
        tagOrder: [],
        activeTagId: null
    };
    let pendingBatchKeys = new Set();
    let isDeletingSources = false;
    let groupsById = new Map(); // Flat map of ALL group objects for easy lookup
    let sourcesByKey = new Map();
    let tagsById = new Map();
    let sourceTagsById = new Map();
    let keyByElement = new WeakMap();
    let shadowRoot = null;
    let projectId = getProjectId();
    let parentMap = new Map();
    let isSyncingState = false;
    let clickQueue = [];
    let isProcessingQueue = false;
    let freshRowCache = null;
    let customHeight = null; // Store user defined height
    let scrollObserver = null; // Store MutationObserver globally for teardown
    let extensionHost = null;
    let managerStatusReason = 'manager_not_ready';
    let isExtensionEnabled = true;
    let focusHighlightTimeout = null;
    let pendingStorageUpgrade = false;
    let activeRouteRecoveryToken = 0;
    let routeRecoveryTimeout = null;
    let activeManagerInstanceToken = 0;
    let activeLoadStateRequestId = null;
    let nextLoadStateRequestId = 1;
    let activeIsolationGroupId = null;
    let isSearchExpanded = false;
    let pendingInitialLoadedState = null;
    let isAwaitingInitialStateLoad = false;
    let sourceDetailViewRequested = false;
    let sourceDetailViewReadySuppressionUntil = 0;
    let pendingPanelReattachState = null;
    let attachedSourcePanel = null;
    let attachedPanelHeader = null;
    let observedNativeScrollArea = null;
    let panelResizeObserver = null;
    let panelLifecycleAnimationFrame = null;
    let panelLifecycleTimeout = null;
    let panelLifecycleObserver = null;
    const MANAGER_ACTIVE_CLASS = 'sources-plus-manager-active';

    // --- Helper Functions ---

    function cloneSerializableData(value) {
        if (value == null) return value;
        if (typeof globalThis.structuredClone === 'function') {
            try {
                return globalThis.structuredClone(value);
            } catch (error) {
                // Fallback to JSON cloning for plain persisted state objects.
            }
        }
        return JSON.parse(JSON.stringify(value));
    }

    const runtimeContext = {};

    function bindRuntimeProperty(name, getter, setter) {
        const descriptor = {
            enumerable: true,
            configurable: true,
            get: getter
        };
        if (typeof setter === 'function') {
            descriptor.set = setter;
        }
        Object.defineProperty(runtimeContext, name, descriptor);
    }

    bindRuntimeProperty('state', () => state, (value) => { state = value; });
    bindRuntimeProperty('pendingBatchKeys', () => pendingBatchKeys, (value) => { pendingBatchKeys = value; });
    bindRuntimeProperty('isDeletingSources', () => isDeletingSources, (value) => { isDeletingSources = value; });
    bindRuntimeProperty('groupsById', () => groupsById, (value) => { groupsById = value; });
    bindRuntimeProperty('sourcesByKey', () => sourcesByKey, (value) => { sourcesByKey = value; });
    bindRuntimeProperty('tagsById', () => tagsById, (value) => { tagsById = value; });
    bindRuntimeProperty('sourceTagsById', () => sourceTagsById, (value) => { sourceTagsById = value; });
    bindRuntimeProperty('keyByElement', () => keyByElement, (value) => { keyByElement = value; });
    bindRuntimeProperty('shadowRoot', () => shadowRoot, (value) => { shadowRoot = value; });
    bindRuntimeProperty('projectId', () => projectId, (value) => { projectId = value; });
    bindRuntimeProperty('parentMap', () => parentMap, (value) => { parentMap = value; });
    bindRuntimeProperty('isSyncingState', () => isSyncingState, (value) => { isSyncingState = value; });
    bindRuntimeProperty('clickQueue', () => clickQueue, (value) => { clickQueue = value; });
    bindRuntimeProperty('isProcessingQueue', () => isProcessingQueue, (value) => { isProcessingQueue = value; });
    bindRuntimeProperty('freshRowCache', () => freshRowCache, (value) => { freshRowCache = value; });
    bindRuntimeProperty('customHeight', () => customHeight, (value) => { customHeight = value; });
    bindRuntimeProperty('scrollObserver', () => scrollObserver, (value) => { scrollObserver = value; });
    bindRuntimeProperty('extensionHost', () => extensionHost, (value) => { extensionHost = value; });
    bindRuntimeProperty('managerStatusReason', () => managerStatusReason, (value) => { managerStatusReason = value; });
    bindRuntimeProperty('focusHighlightTimeout', () => focusHighlightTimeout, (value) => { focusHighlightTimeout = value; });
    bindRuntimeProperty('pendingStorageUpgrade', () => pendingStorageUpgrade, (value) => { pendingStorageUpgrade = value; });
    bindRuntimeProperty('activeRouteRecoveryToken', () => activeRouteRecoveryToken, (value) => { activeRouteRecoveryToken = value; });
    bindRuntimeProperty('routeRecoveryTimeout', () => routeRecoveryTimeout, (value) => { routeRecoveryTimeout = value; });
    bindRuntimeProperty('activeManagerInstanceToken', () => activeManagerInstanceToken, (value) => { activeManagerInstanceToken = value; });
    bindRuntimeProperty('activeLoadStateRequestId', () => activeLoadStateRequestId, (value) => { activeLoadStateRequestId = value; });
    bindRuntimeProperty('nextLoadStateRequestId', () => nextLoadStateRequestId, (value) => { nextLoadStateRequestId = value; });
    bindRuntimeProperty('activeIsolationGroupId', () => activeIsolationGroupId, (value) => { activeIsolationGroupId = value; });
    bindRuntimeProperty('isSearchExpanded', () => isSearchExpanded, (value) => { isSearchExpanded = value; });
    bindRuntimeProperty('pendingInitialLoadedState', () => pendingInitialLoadedState, (value) => { pendingInitialLoadedState = value; });
    bindRuntimeProperty('isAwaitingInitialStateLoad', () => isAwaitingInitialStateLoad, (value) => { isAwaitingInitialStateLoad = value; });
    bindRuntimeProperty('sourceDetailViewRequested', () => sourceDetailViewRequested, (value) => { sourceDetailViewRequested = Boolean(value); });
    bindRuntimeProperty('sourceDetailViewReadySuppressionUntil', () => sourceDetailViewReadySuppressionUntil, (value) => { sourceDetailViewReadySuppressionUntil = Number(value) || 0; });
    bindRuntimeProperty('pendingPanelReattachState', () => pendingPanelReattachState, (value) => { pendingPanelReattachState = value; });
    bindRuntimeProperty('attachedSourcePanel', () => attachedSourcePanel, (value) => { attachedSourcePanel = value; });
    bindRuntimeProperty('attachedPanelHeader', () => attachedPanelHeader, (value) => { attachedPanelHeader = value; });
    bindRuntimeProperty('observedNativeScrollArea', () => observedNativeScrollArea, (value) => { observedNativeScrollArea = value; });
    bindRuntimeProperty('panelResizeObserver', () => panelResizeObserver, (value) => { panelResizeObserver = value; });
    bindRuntimeProperty('panelLifecycleAnimationFrame', () => panelLifecycleAnimationFrame, (value) => { panelLifecycleAnimationFrame = value; });
    bindRuntimeProperty('panelLifecycleTimeout', () => panelLifecycleTimeout, (value) => { panelLifecycleTimeout = value; });
    bindRuntimeProperty('panelLifecycleObserver', () => panelLifecycleObserver, (value) => { panelLifecycleObserver = value; });
    bindRuntimeProperty('debouncedPanelLifecycleSync', () => debouncedPanelLifecycleSync);
    bindRuntimeProperty('syncManagerWithPanelLifecycle', () => syncManagerWithPanelLifecycle);

    const panelDomModule = createContentPanelDom({
        runtime: runtimeContext,
        document,
        window,
        MutationObserver,
        ResizeObserver,
        setTimeout: (...args) => setTimeout(...args),
        clearTimeout: (...args) => clearTimeout(...args),
        DEPS
    });
    const {
        findElement,
        queryAllElements,
        waitForElement,
        findSourcePanel,
        findSourcePanelContent,
        getSourcePanelHeader,
        getElementComputedStyle,
        isTransparentColor,
        resolveSourcePanelSurfaceColor,
        applySourcePanelSurfaceColor,
        getElementBoundingRect,
        hasRenderableBox,
        isElementRenderable,
        isSourcePanelCollapsed,
        isSourcePanelRenderable,
        isManagerAttachedToPanel,
        clearScheduledPanelLifecycleSync,
        schedulePanelLifecycleSync,
        handleSourcePanelHeaderInteraction,
        bindPanelLifecycleHooks
    } = panelDomModule;

    const tagsModule = createContentTags({
        runtime: runtimeContext,
        showToast: (...args) => showToast(...args),
        getMessage
    });
    const {
        normalizeTagLabel,
        normalizeTagColor,
        getDefaultTagColor,
        normalizeTagColorInputValue,
        getSerializedTag,
        getTagColorRgb,
        getTagColorRgba,
        getTagStyleVars,
        getTagColorPreviewStyle,
        generateTagId,
        getSortedTagIds,
        getSourceTagIds,
        getTagUsageCounts,
        findExistingTagIdByLabel,
        createTag,
        updateTag,
        setSourceTagIds,
        deleteTag
    } = tagsModule;

    const stateReconcileModule = createContentStateReconcile({
        runtime: runtimeContext,
        normalizeSourceText,
        normalizeTagLabel,
        normalizeTagColor
    });
    const {
        buildSourceLookup,
        resolveStoredSourceKey,
        snapshotExistingSourceRecords,
        remapExistingStateToCurrentSources,
        buildResolvedSourceStateById,
        buildNormalizedTagState,
        buildResolvedSourceTagsById,
        reconcilePersistedTree
    } = stateReconcileModule;

    const sourceActionsModule = createContentSourceActions({
        getDocument: () => document,
        getWindow: () => window,
        getState: () => state,
        getSourcesByKey: () => sourcesByKey,
        getShadowRoot: () => shadowRoot,
        getDEPS: () => DEPS,
        getMessage,
        showToast: (...args) => showToast(...args),
        render: (...args) => render(...args),
        sourceMatchesCurrentFilters: (...args) => sourceMatchesCurrentFilters(...args),
        resolveFreshRowEntry: (...args) => resolveFreshRowEntry(...args),
        renderTagModal: (...args) => renderTagModal(...args),
        renderMoveToFolderModal: (...args) => renderMoveToFolderModal(...args),
        markSourceDetailViewRequested: () => {
            const suppressReadyStateUntil = Date.now() + 1500;
            sourceDetailViewRequested = true;
            sourceDetailViewReadySuppressionUntil = suppressReadyStateUntil;
            if (extensionHost || shadowRoot || scrollObserver) {
                suspendManagerForSourceDetailView();
                sourceDetailViewReadySuppressionUntil = suppressReadyStateUntil;
            }
            setTimeout(() => {
                if (sourceDetailViewRequested && Date.now() >= sourceDetailViewReadySuppressionUntil) {
                    schedulePanelLifecycleSync({ immediate: true });
                }
            }, 1550);
        },
        findElement: (...args) => findElement(...args)
    });
    const {
        canOpenSourceActionMenu,
        getViewportSize,
        findSourceActionButton,
        getSourceActionMenuItems,
        getSourceActionSubmenuItems,
        getSourceActionMenuHeight,
        getSourceActionMenuPosition,
        getSourceActionSubmenuPosition,
        closeSourceActionMenu,
        dismissSourceActionMenuAndRender,
        toggleSourceActionMenu,
        syncActiveSourceActionMenuState,
        findNativeSourceMenuButton,
        getNativeMenuItemMetadata,
        getNativeMenuItemFingerprint,
        queryNativeMenuItems,
        getNativeSourceDetailsMenuItemScore,
        findNativeSourceDetailsMenuItem,
        resolveFreshSourceRow,
        createSyntheticActivationEvent,
        dispatchSyntheticActivation,
        isSourceDetailsTargetCandidate,
        collectSourceDetailsCandidates,
        getSourceDetailsTargetScore,
        triggerNativeSourceDetailsDirect,
        waitForNativeMenuItems,
        triggerNativeSourceDetailsViaNativeMenu,
        triggerNativeSourceMenu,
        openNativeSourceDetails,
        handleSourceActionSelection,
        getSourceActionInvokers,
        setSourceActionInvoker,
        getActiveSourceActionSourceKey,
        setActiveSourceActionSourceKey,
        getActiveSourceActionSubmenuAction,
        setActiveSourceActionSubmenuAction,
        getSourceActionMenuPositionState,
        setSourceActionMenuPosition,
        resetSourceActionInvokers
    } = sourceActionsModule;

    const viewStateModule = createContentViewState({
        runtime: runtimeContext,
        getState: () => state,
        getGroupsById: () => groupsById,
        getSourcesByKey: () => sourcesByKey,
        getParentMap: () => parentMap,
        getShadowRoot: () => shadowRoot,
        getActiveIsolationGroupId: () => activeIsolationGroupId,
        getIsSearchExpanded: () => isSearchExpanded,
        getExtensionHost: () => extensionHost,
        setIsSearchExpanded: (value) => { isSearchExpanded = Boolean(value); },
        getMessage,
        render: (...args) => render(...args),
        closeSourceActionMenu,
        dismissSourceActionMenuAndRender,
        getActiveSourceActionSourceKey,
        syncSourceToPage: (...args) => syncSourceToPage(...args),
        getSourceTagIds,
        isDescendant
    });
    const {
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
    } = viewStateModule;

    const modalsModule = createContentModals({
        getDocument: () => document,
        getShadowRoot: () => shadowRoot,
        getState: () => state,
        getGroupsById: () => groupsById,
        getTagsById: () => tagsById,
        getSourceTagsById: () => sourceTagsById,
        getPendingBatchKeys: () => pendingBatchKeys,
        getSourcesByKey: () => sourcesByKey,
        getMessage,
        el: (...args) => el(...args),
        closeSourceActionMenu,
        render: (...args) => render(...args),
        saveState: (...args) => saveState(...args),
        buildParentMap: (...args) => buildParentMap(...args),
        removeSourceFromTree: (...args) => removeSourceFromTree(...args),
        createTag,
        updateTag,
        deleteTag,
        getTagUsageCounts,
        getSourceTagIds,
        setSourceTagIds,
        normalizeTagColor,
        normalizeTagColorInputValue,
        getDefaultTagColor,
        getTagColorPreviewStyle
    });
    const {
        renderMoveToFolderModal,
        closeMoveToFolderModal,
        executeMoveToFolder,
        closeTagModal,
        createTagColorControl,
        createTagEditor,
        renderTagModal
    } = modalsModule;

    const sourceSyncModule = createContentSourceSync({
        runtime: runtimeContext,
        getDocument: () => document,
        getWindow: () => window,
        getDEPS: () => DEPS,
        getMessage,
        queryAllElements: (...args) => queryAllElements(...args),
        findElement: (...args) => findElement(...args),
        findSourcePanel: (...args) => findSourcePanel(...args),
        isSourcePanelRenderable: (...args) => isSourcePanelRenderable(...args),
        isManageableSourceIdentity,
        hasPreservableManagerSnapshot: (...args) => hasPreservableManagerSnapshot(...args),
        isSourceEffectivelyEnabled: (...args) => isSourceEffectivelyEnabled(...args),
        createSourceDescriptor,
        extractSourceIdentitySnapshot,
        buildSourceLookup,
        buildResolvedSourceStateById,
        buildNormalizedTagState,
        buildResolvedSourceTagsById,
        reconcilePersistedTree,
        snapshotExistingSourceRecords,
        remapExistingStateToCurrentSources,
        setSourceTagIds,
        syncSourceToPage: (...args) => syncSourceToPage(...args),
        buildParentMap: (...args) => buildParentMap(...args),
        saveState: (...args) => saveState(...args),
        render: (...args) => render(...args),
        suspendManagerForSourceDetailView: (...args) => suspendManagerForSourceDetailView(...args),
        flushPendingInitialLoadedState: (...args) => flushPendingInitialLoadedState(...args),
        debounce
    });
    const {
        isFreshRowCacheEntryMatch,
        resolveFreshRowEntry,
        findFreshCheckbox,
        getSourceElements,
        getManageableSourceElements,
        hasRenderableSourceRows,
        getSourcePanelState,
        isSourcePanelManageable,
        isSourceDetailViewPanel,
        scanAndSyncSources,
        handleDomChanges,
        debouncedScanAndSync
    } = sourceSyncModule;

    const renderModule = createContentRender({
        getDocument: () => document,
        getShadowRoot: () => shadowRoot,
        getState: () => state,
        getGroupsById: () => groupsById,
        getTagsById: () => tagsById,
        getSourcesByKey: () => sourcesByKey,
        getPendingBatchKeys: () => pendingBatchKeys,
        getActiveIsolationGroupId: () => activeIsolationGroupId,
        getIsDeletingSources: () => isDeletingSources,
        getMessage,
        el: (...args) => el(...args),
        syncSearchUi: (...args) => syncSearchUi(...args),
        hasActiveRenderFilters: (...args) => hasActiveRenderFilters(...args),
        sourceMatchesCurrentFilters: (...args) => sourceMatchesCurrentFilters(...args),
        areAllAncestorsEnabled: (...args) => areAllAncestorsEnabled(...args),
        isSourceWithinActiveIsolation: (...args) => isSourceWithinActiveIsolation(...args),
        isGroupWithinActiveIsolation: (...args) => isGroupWithinActiveIsolation(...args),
        isSourceEffectivelyEnabled: (...args) => isSourceEffectivelyEnabled(...args),
        shouldRenderGroup: (...args) => shouldRenderGroup(...args),
        getSourceTagIds,
        getTagStyleVars,
        handleInteraction: (...args) => handleInteraction(...args),
        canOpenSourceActionMenu,
        findSourceActionButton,
        getSourceActionMenuItems,
        getSourceActionSubmenuItems,
        getSourceActionMenuPosition,
        getSourceActionSubmenuPosition,
        syncActiveSourceActionMenuState,
        getActiveSourceActionSourceKey,
        getActiveSourceActionSubmenuAction,
        getSourceActionMenuPositionState,
        setSourceActionMenuPosition
    });
    const {
        getGroupEffectiveState,
        patchNode,
        patchChildren,
        renderViewStateBar,
        getSourceActionMenuLayer,
        renderSourceActionMenuLayer,
        createSourceGlyphIcon,
        createGroupTitleIconElement,
        replaceSourceIconWithFallback,
        createSourceIconElement,
        render
    } = renderModule;

    const persistenceModule = createContentPersistence(Object.assign(Object.create(runtimeContext), {
        chrome,
        debounce,
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
        normalizeSourceText,
        getSourceTagIds,
        getSerializedTag,
        scanAndSyncSources: (...args) => scanAndSyncSources(...args),
        findSourcePanel: (...args) => findSourcePanel(...args),
        isSourcePanelRenderable: (...args) => isSourcePanelRenderable(...args),
        getSourcePanelState: (...args) => getSourcePanelState(...args),
        hasRenderableSourceRows: (...args) => hasRenderableSourceRows(...args),
        render: (...args) => render(...args),
        cloneSerializableData,
        getSourceElements: (...args) => getSourceElements(...args),
        getManageableSourceElements: (...args) => getManageableSourceElements(...args)
    }));
    const {
        hasRestorableStateSnapshot,
        getStateBackupKey,
        pickPreferredStoredState,
        writeStateToLocalStorage,
        sendStateToStorage,
        flushPendingStateSave,
        cancelPendingStateSave,
        invalidateManagerInstance,
        isLiveManagerLoadRequest,
        buildPersistableState,
        saveState,
        handlePageLifecyclePersistence,
        normalizeLoadedState,
        hasPreservableManagerSnapshot,
        canPersistManagerState,
        hasPersistedSourceRefs,
        hasPersistableManagerState,
        capturePendingPanelReattachState,
        restoreInitialLoadedState,
        flushPendingInitialLoadedState,
        applyLoadedStateToManager,
        loadState
    } = persistenceModule;

    const treeInteractionsModule = createContentTreeInteractions({
        runtime: runtimeContext,
        getState: () => state,
        getGroupsById: () => groupsById,
        getSourcesByKey: () => sourcesByKey,
        getPendingBatchKeys: () => pendingBatchKeys,
        getParentMap: () => parentMap,
        getClickQueue: () => clickQueue,
        getKeyByElement: () => keyByElement,
        getShadowRoot: () => shadowRoot,
        getDocument: () => document,
        getWindow: () => window,
        getSetTimeout: () => setTimeout,
        getDEPS: () => DEPS,
        getSourceCheckboxSelector: () => SOURCE_CHECKBOX_SELECTOR,
        getMessage,
        showToast: (...args) => showToast(...args),
        render: (...args) => render(...args),
        saveState: (...args) => saveState(...args),
        buildParentMap: (...args) => buildParentMap(...args),
        isSourceEffectivelyEnabled: (...args) => isSourceEffectivelyEnabled(...args),
        collectEffectiveSourceStates: (...args) => collectEffectiveSourceStates(...args),
        syncSourcesToEffectiveState: (...args) => syncSourcesToEffectiveState(...args),
        executeBatchDelete: (...args) => executeBatchDelete(...args),
        renderMoveToFolderModal: (...args) => renderMoveToFolderModal(...args),
        getSourceActionInvokers,
        handleSourceActionSelection,
        toggleSourceActionMenu,
        closeSourceActionMenu,
        findFreshCheckbox,
        resolveFreshRowEntry,
        setSourceTagIds,
        renderTagModal: (...args) => renderTagModal(...args),
        isDescendant,
        getIsProcessingQueue: () => isProcessingQueue,
        setIsProcessingQueue: (value) => { isProcessingQueue = Boolean(value); },
        getIsSyncingState: () => isSyncingState,
        setIsSyncingState: (value) => { isSyncingState = Boolean(value); },
        getActiveIsolationGroupId: () => activeIsolationGroupId,
        setActiveIsolationGroupId: (value) => { activeIsolationGroupId = value; },
        getIsDeletingSources: () => isDeletingSources
    });
    const {
        handleAddNewGroup,
        syncSourceToPage,
        processClickQueue,
        findParentGroupOfSource,
        removeSourceFromTree,
        removeGroupFromTree,
        toggleGroupCollapse,
        handleInteraction,
        handleOriginalCheckboxChange,
        triggerRename,
        handleDragStart,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        handleDragEnd
    } = treeInteractionsModule;

    function getProjectId() {
        const pathSegments = window.location.pathname.split('/');
        const notebookIndex = pathSegments.indexOf('notebook');
        if (notebookIndex > -1 && notebookIndex + 1 < pathSegments.length) {
            return pathSegments[notebookIndex + 1];
        }
        return null;
    }

    let toastTimeout = null;
    function showToast(message) {
        let toast = shadowRoot.querySelector('.sp-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'sp-toast';
            shadowRoot.appendChild(toast);
        }
        toast.textContent = message;
        
        // Force reflow to restart animation if needed
        toast.classList.remove('show');
        void toast.offsetWidth; 
        toast.classList.add('show');
        
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function showCrashBanner(message) {
        const existingError = document.getElementById('sp-error-banner');
        if (existingError) return;
        const banner = el('div', {
            id: 'sp-error-banner',
            style: 'position: fixed; top: 0; left: 0; right: 0; background: #ea4335; ' +
                   'color: white; padding: 12px; text-align: center; z-index: 999999; ' +
                   'font-family: "Google Sans", sans-serif; box-shadow: 0 2px 4px rgba(0,0,0,0.2);'
        }, [
            el('strong', {}, [getMessage('ui_crash_banner_prefix') + ' ']),
            message + ' ',
            el('button', {
                id: 'sp-dismiss-error',
                style: 'background: rgba(255,255,255,0.2); border: 1px solid white; color: white; border-radius: 4px; padding: 4px 8px; margin-left: 12px; cursor: pointer;'
            }, [getMessage('ui_dismiss')])
        ]);

        document.body.prepend(banner);
        document.getElementById('sp-dismiss-error').addEventListener('click', () => banner.remove());
    }

    function attachScrollObserverToPanel(sourcePanel) {
        if (!scrollObserver || !sourcePanel) {
            observedNativeScrollArea = null;
            return;
        }

        const nextObservedArea = findElement(DEPS.scroll, sourcePanel) || sourcePanel;
        if (!nextObservedArea || observedNativeScrollArea === nextObservedArea) {
            return;
        }

        try {
            scrollObserver.disconnect();
            scrollObserver.observe(nextObservedArea, { childList: true, subtree: true });
            observedNativeScrollArea = nextObservedArea;
        } catch (error) {
            observedNativeScrollArea = null;
            console.error('NotebookLM Source Management: Failed to observe source panel', error);
        }
    }

    function getManagerStatus() {
        if (!isExtensionEnabled) {
            managerStatusReason = projectId ? 'extension_disabled' : 'not_on_notebook_page';
            return {
                ready: false,
                reason: managerStatusReason
            };
        }

        const sourcePanel = findSourcePanel();
        const panelState = getSourcePanelState(sourcePanel);
        const isReady = Boolean(
            shadowRoot &&
            shadowRoot.host &&
            shadowRoot.host.isConnected &&
            shadowRoot.querySelector('.sp-container') &&
            sourcePanel &&
            panelState.state === 'ready' &&
            isManagerAttachedToPanel(sourcePanel)
        );

        if (isReady) {
            managerStatusReason = 'ready';
            return { ready: true, reason: 'ready' };
        }

        if (!projectId) {
            managerStatusReason = 'not_on_notebook_page';
            return { ready: false, reason: 'not_on_notebook_page' };
        }

        if (!sourcePanel) {
            managerStatusReason = 'source_panel_missing';
            return { ready: false, reason: 'source_panel_missing' };
        }

        if (panelState.state === 'collapsed' || panelState.state === 'missing') {
            managerStatusReason = 'manager_not_ready';
            return { ready: false, reason: 'manager_not_ready' };
        }

        return { ready: false, reason: managerStatusReason || 'manager_not_ready' };
    }

    function requestExtensionEnabledStatus() {
        return new Promise((resolve) => {
            if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
                resolve(true);
                return;
            }

            try {
                chrome.runtime.sendMessage({ type: 'GET_EXTENSION_ENABLED' }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(true);
                        return;
                    }

                    if (!response || response.success === false) {
                        resolve(true);
                        return;
                    }

                    resolve(response.enabled !== false);
                });
            } catch (error) {
                resolve(true);
            }
        });
    }

    function disableManagerRuntime() {
        isExtensionEnabled = false;
        teardown();
        managerStatusReason = projectId ? 'extension_disabled' : 'not_on_notebook_page';
    }

    function enableManagerRuntime() {
        isExtensionEnabled = true;
        managerStatusReason = projectId ? 'manager_not_ready' : 'not_on_notebook_page';
        syncManagerWithPanelLifecycle();
    }

    function focusManagerPanel() {
        const status = getManagerStatus();
        if (!status.ready) {
            return { success: false, reason: status.reason };
        }

        const container = shadowRoot.querySelector('.sp-container');
        shadowRoot.host.scrollIntoView({ behavior: 'smooth', block: 'start' });

        container.classList.remove('sp-focus-ring');
        void container.offsetWidth;
        container.classList.add('sp-focus-ring');

        if (focusHighlightTimeout) {
            clearTimeout(focusHighlightTimeout);
        }

        focusHighlightTimeout = setTimeout(() => {
            if (container && container.classList) {
                container.classList.remove('sp-focus-ring');
            }
        }, 1800);

        return { success: true };
    }

    function handleManagerMessage(request, sender, sendResponse) {
        if (!request || typeof request.type !== 'string') return;

        if (request.type === 'GET_MANAGER_STATUS') {
            sendResponse(getManagerStatus());
            return;
        }

        if (request.type === 'FOCUS_MANAGER') {
            sendResponse(focusManagerPanel());
            return;
        }

        if (request.type === 'DISABLE_MANAGER') {
            disableManagerRuntime();
            sendResponse({ success: true, disabled: true });
            return;
        }

        if (request.type === 'ENABLE_MANAGER') {
            enableManagerRuntime();
            sendResponse({
                success: true,
                enabled: true,
                attempted: Boolean(projectId)
            });
        }
    }

    function buildParentMap() {
        parentMap.clear();
        groupsById.forEach(group => {
            group.children.forEach(child => {
                parentMap.set(child.id || child.key, group.id);
            });
        });
    }

    // --- Batch Delete Deletion Engine ---
    async function executeBatchDelete() {
        if (pendingBatchKeys.size === 0 || isDeletingSources) return;
        isDeletingSources = true;

        const keysToDelete = Array.from(pendingBatchKeys);
        const total = keysToDelete.length;
        let deletedCount = 0;

        showToast(getMessage('ui_deleting_count', [total.toString()]));

        for (const key of keysToDelete) {
            const source = sourcesByKey.get(key);
            if (!source || source.isDisabled) continue;

            // Step 1: Find and click the native more options button
            let nativeMoreBtn = findElement(DEPS.moreBtn, source.element);

            // Fallback: If disconnected, try to re-query the DOM
            if (!nativeMoreBtn || !document.body.contains(nativeMoreBtn)) {
                const freshCheckbox = findFreshCheckbox(key);
                if (freshCheckbox) {
                    const freshRow = freshCheckbox.closest(DEPS.row[0]) || freshCheckbox.closest(DEPS.row[1]);
                    if (freshRow) {
                        nativeMoreBtn = findElement(DEPS.moreBtn, freshRow);
                    }
                }
            }

            if (!nativeMoreBtn) continue;

            nativeMoreBtn.click();

            // Step 2: Wait for the CDK overlay menu to appear and contain the Delete option
            try {
                // The delay is important to let the UI react (framework animation/rendering)
                await new Promise(resolve => setTimeout(resolve, 150));

                // Usually the delete button has an aria-label="Delete" or text content "Delete" / "移除"
                // The exact DOM structure depends on NotebookLM's locale. We look for a menu item
                // containing the delete icon or the word "delete" (case insensitive in english).
                const menuItems = document.querySelectorAll('.cdk-overlay-container [role="menuitem"]');
                let deleteMenuItem = null;
                for (const item of menuItems) {
                    const iconText = (item.querySelector('mat-icon')?.textContent || '').trim().toLowerCase();
                    if (iconText === 'delete' || iconText === 'delete_forever' || iconText === 'remove_circle') {
                        deleteMenuItem = item;
                        break;
                    }
                    const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();
                    const testId = item.getAttribute('data-testid') || '';
                    if (ariaLabel.includes('delete') || ariaLabel.includes('remove') || testId.includes('delete') || testId.includes('remove')) {
                        deleteMenuItem = item;
                        break;
                    }
                    const text = item.textContent.toLowerCase();
                    if (text.includes('delete') || text.includes('remove') ||
                        text.includes('删除') || text.includes('移除') ||
                        text.includes('supprimer') || text.includes('löschen') || text.includes('eliminar') ||
                        text.includes('削除') || text.includes('삭제')) {
                        deleteMenuItem = item;
                        break;
                    }
                }

                if (deleteMenuItem) {
                    deleteMenuItem.click();

                    // Wait for the confirmation dialog to appear after clicking delete
                    await new Promise(resolve => setTimeout(resolve, 150));

                    const dialogs = document.querySelectorAll('mat-dialog-container, [role="dialog"], .cdk-dialog-container');
                    let confirmBtn = null;
                    for (const dialog of dialogs) {
                        const buttons = dialog.querySelectorAll('button');
                        const cancelPatterns = /cancel|取消|annuler|abbrechen|cancelar|キャンセル|취소/;

                        for (const btn of buttons) {
                            const btnText = btn.textContent.toLowerCase();
                            if (cancelPatterns.test(btnText)) continue;

                            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                            const isPrimaryButton = btn.className.includes('primary') || btn.className.includes('warn');
                            const hasCheckIcon = btn.querySelector('mat-icon')?.textContent.trim() === 'check';
                            const deleteConfirmPattern = /delete|remove|削除|삭제|删除|移除|supprimer|löschen|eliminar|yes|ok|confirm|确定|确认/;

                            if (isPrimaryButton || hasCheckIcon || deleteConfirmPattern.test(btnText) || deleteConfirmPattern.test(ariaLabel)) {
                                confirmBtn = btn;
                                break;
                            }
                        }

                        if (!confirmBtn && buttons.length > 0) {
                            const warnBtn = Array.from(buttons).find(b => {
                                const t = b.textContent.toLowerCase();
                                return !cancelPatterns.test(t) && (b.className.includes('warn') || b.className.includes('primary'));
                            });
                            if (warnBtn) {
                                confirmBtn = warnBtn;
                            }
                        }

                        if (confirmBtn) break;
                    }

                    if (confirmBtn) {
                        confirmBtn.click();
                        deletedCount++;
                        // Limit delay to 50ms for hyper-fast batch delete visual effect while still allowing DOM tear down
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } else {
                        console.warn(`NotebookLM Source Management: Could not find confirmation button in dialog for source key: ${key}`);
                        // Try to close dialog by clicking escape or backdrop if possible, fallback to body click
                        document.body.click();
                    }

                } else {
                    // Close menu if delete button wasn't found (safety)
                    document.body.click();
                    console.warn(`NotebookLM Source Management: Could not find delete menu item for source key: ${key}`);
                }
            } catch (err) {
                console.error("NotebookLM Source Management: Error during automated deletion step", err);
                document.body.click(); // ensure menu is closed
            }
        }

        // Cleanup after all deletions are processed
        isDeletingSources = false;
        pendingBatchKeys.clear();
        state.isBatchMode = false;
        closeSourceActionMenu();

        showToast(getMessage('ui_deleted_toast', [deletedCount.toString()]));
        render(); // The heartbeat observer will catch the actual DOM removals eventually
    }
    // ==========================================
    // DATA AND UTILS
    // ==========================================
    // --- Initialization & Observation ---
    const debouncedPanelLifecycleSync = debounce(() => {
        try {
            syncManagerWithPanelLifecycle();
        } catch (error) {
            console.error("NotebookLM Source Management: Error syncing panel lifecycle.", error);
        }
    }, 80);

    // --- Lifecycle Management ---
    function removeGlobalOverlayStyle() {
        const globalStyle = document.getElementById(GLOBAL_OVERLAY_STYLE_ID);
        if (globalStyle && typeof globalStyle.remove === 'function') {
            globalStyle.remove();
        }
    }

    function setNativeSourceListHidden(hidden) {
        const root = document.documentElement;
        if (!root || !root.classList) return;

        if (hidden) {
            root.classList.add(MANAGER_ACTIVE_CLASS);
            return;
        }

        root.classList.remove(MANAGER_ACTIVE_CLASS);
    }

    function resetManagerRuntimeState() {
        groupsById.clear();
        sourcesByKey.clear();
        tagsById.clear();
        sourceTagsById.clear();
        parentMap.clear();
        keyByElement = new WeakMap();
        state.groups = [];
        state.ungrouped = [];
        state.filterQuery = '';
        state.isBatchMode = false;
        state.tagOrder = [];
        state.activeTagId = null;
        pendingBatchKeys.clear();
        activeIsolationGroupId = null;
        isSearchExpanded = false;
        closeSourceActionMenu();
        isSyncingState = false;
        clickQueue = [];
        isProcessingQueue = false;
        freshRowCache = null;
        pendingStorageUpgrade = false;
        pendingInitialLoadedState = null;
        isAwaitingInitialStateLoad = false;
        sourceDetailViewRequested = false;
        sourceDetailViewReadySuppressionUntil = 0;
        attachedSourcePanel = null;
        observedNativeScrollArea = null;
        managerStatusReason = 'manager_not_ready';
    }

    function cleanupManagerResources() {
        clearScheduledPanelLifecycleSync();
        invalidateManagerInstance();
        if (routeRecoveryTimeout) {
            clearTimeout(routeRecoveryTimeout);
            routeRecoveryTimeout = null;
        }
        if (scrollObserver) {
            scrollObserver.disconnect();
            scrollObserver = null;
        }
        observedNativeScrollArea = null;
        document.removeEventListener('change', handleOriginalCheckboxChange, true);
        document.removeEventListener('click', handleDocumentOutsideClick, true);
        if (shadowRoot && typeof shadowRoot.removeEventListener === 'function') {
            shadowRoot.removeEventListener('scroll', handleSourceActionMenuViewportChange, true);
        }
        if (shadowRoot && shadowRoot.host) {
            shadowRoot.host.remove();
            shadowRoot = null;
        }
        extensionHost = null;
        if (focusHighlightTimeout) {
            clearTimeout(focusHighlightTimeout);
            focusHighlightTimeout = null;
        }
        if (window && typeof window.removeEventListener === 'function') {
            window.removeEventListener('pagehide', handlePageLifecyclePersistence);
            window.removeEventListener('resize', handleSourceActionMenuViewportChange);
        }
        document.removeEventListener('visibilitychange', handlePageLifecyclePersistence);
        cancelPendingStateSave();
        removeGlobalOverlayStyle();
        setNativeSourceListHidden(false);
        resetManagerRuntimeState();
    }

    function detachManagerForPanelCollapse() {
        flushPendingStateSave();
        pendingPanelReattachState = capturePendingPanelReattachState();
        cleanupManagerResources();
    }

    function suspendManagerForSourceDetailView() {
        flushPendingStateSave();
        pendingPanelReattachState = capturePendingPanelReattachState();
        cleanupManagerResources();
        sourceDetailViewRequested = true;
        managerStatusReason = 'source_detail_view';
    }

    function teardown() {
        bindPanelLifecycleHooks(null);
        if (routeRecoveryTimeout) {
            clearTimeout(routeRecoveryTimeout);
            routeRecoveryTimeout = null;
        }
        cleanupManagerResources();
        pendingPanelReattachState = null;
    }

    function completeInitialStateLoad() {
        isAwaitingInitialStateLoad = false;

        if (!pendingInitialLoadedState || getSourcePanelState(findSourcePanel()).state !== 'ready') {
            return;
        }

        const pendingRestore = flushPendingInitialLoadedState();
        if (pendingRestore.deferred) {
            return;
        }

        render();
        if (pendingRestore.shouldUpgradeStorage) {
            pendingStorageUpgrade = false;
            saveState();
        }
    }

    function syncManagerWithPanelLifecycle() {
        if (!projectId || !isExtensionEnabled) {
            if (!projectId) {
                managerStatusReason = 'not_on_notebook_page';
                return;
            }

            managerStatusReason = 'extension_disabled';
            return;
        }

        const sourcePanel = findSourcePanel();
        const hasManagerInstance = Boolean(extensionHost || shadowRoot || scrollObserver);
        const panelState = getSourcePanelState(sourcePanel);

        if (!sourcePanel) {
            if (hasManagerInstance) {
                detachManagerForPanelCollapse();
            }
            bindPanelLifecycleHooks(null);
            sourceDetailViewRequested = false;
            managerStatusReason = 'source_panel_missing';
            return;
        }

        bindPanelLifecycleHooks(sourcePanel);

        if (panelState.state === 'collapsed') {
            if (hasManagerInstance) {
                detachManagerForPanelCollapse();
            }
            sourceDetailViewRequested = false;
            managerStatusReason = 'manager_not_ready';
            return;
        }

        if (panelState.state === 'detail') {
            if (hasManagerInstance) {
                suspendManagerForSourceDetailView();
            } else {
                managerStatusReason = 'source_detail_view';
            }
            return;
        }

        if (isManagerAttachedToPanel(sourcePanel)) {
            attachScrollObserverToPanel(sourcePanel);
            applySourcePanelSurfaceColor(extensionHost, sourcePanel);
            if (panelState.state === 'ready') {
                completeInitialStateLoad();
                managerStatusReason = 'ready';
            } else {
                managerStatusReason = 'manager_not_ready';
            }
            return;
        }

        if (hasManagerInstance) {
            detachManagerForPanelCollapse();
        }

        if (panelState.state === 'ready' || panelState.state === 'loading') {
            init(sourcePanel);
        }
    }

    function shouldReloadForRouteRecovery(targetProjectId, recoveryToken) {
        if (recoveryToken !== activeRouteRecoveryToken) {
            return false;
        }

        if (projectId !== targetProjectId || getProjectId() !== targetProjectId) {
            return false;
        }

        if (document.visibilityState && document.visibilityState !== 'visible') {
            return false;
        }

        const sourcePanel = findSourcePanel();
        return !sourcePanel || !isSourcePanelRenderable(sourcePanel);
    }

    function recoverManagerForRoute(targetProjectId, attempt = 0, recoveryToken = activeRouteRecoveryToken) {
        waitForElement(DEPS.panel, {
            observerRoot: document.body,
            timeoutMs: ROUTE_REINIT_RETRY_DELAY_MS
        }).then((panel) => {
            if (recoveryToken !== activeRouteRecoveryToken) return;

            bindPanelLifecycleHooks(panel);

            if (panel && isSourcePanelRenderable(panel) && getProjectId() === targetProjectId) {
                init(panel);
                return;
            }

            if (attempt + 1 >= ROUTE_REINIT_MAX_ATTEMPTS) {
                if (shouldReloadForRouteRecovery(targetProjectId, recoveryToken) && window.location && typeof window.location.reload === 'function') {
                    window.location.reload();
                }
                return;
            }

            if (routeRecoveryTimeout) {
                clearTimeout(routeRecoveryTimeout);
            }
            routeRecoveryTimeout = setTimeout(() => {
                routeRecoveryTimeout = null;
                recoverManagerForRoute(targetProjectId, attempt + 1, recoveryToken);
            }, ROUTE_REINIT_RETRY_DELAY_MS);
        });
    }

    function handleRouteChanged() {
        const newProjectId = getProjectId();
        if (!newProjectId) {
            if (projectId) {
                console.log(`NotebookLM Source Management: Route changed from notebook ${projectId} to a non-notebook page. Tearing down.`);
                flushPendingStateSave();
                activeRouteRecoveryToken += 1;
                projectId = null;
                teardown();
                managerStatusReason = 'not_on_notebook_page';
            }
            return;
        }

        if (!isExtensionEnabled) {
            if (newProjectId !== projectId) {
                activeRouteRecoveryToken += 1;
                projectId = newProjectId;
                teardown();
            }
            managerStatusReason = 'extension_disabled';
            return;
        }

        if (newProjectId !== projectId) {
            console.log(`NotebookLM Source Management: Route changed from ${projectId} to ${newProjectId}. Reinitializing manager.`);
            flushPendingStateSave();
            activeRouteRecoveryToken += 1;
            projectId = newProjectId;
            managerStatusReason = 'manager_not_ready';
            teardown();
            recoverManagerForRoute(newProjectId, 0, activeRouteRecoveryToken);
        }
    }

    function init(sourcePanel) {
        if (!isSourcePanelRenderable(sourcePanel)) {
            managerStatusReason = 'manager_not_ready';
            return;
        }

        if (getSourcePanelState(sourcePanel).state === 'detail') {
            managerStatusReason = 'source_detail_view';
            return;
        }

        activeManagerInstanceToken += 1;
        activeLoadStateRequestId = null;
        const managerInstanceToken = activeManagerInstanceToken;

        bindPanelLifecycleHooks(sourcePanel);

        const extensionRoot = document.createElement('div');
        extensionRoot.id = 'sources-plus-root';
        applySourcePanelSurfaceColor(extensionRoot, sourcePanel);
        extensionHost = extensionRoot;
        shadowRoot = extensionRoot.attachShadow({ mode: 'open' });
        managerStatusReason = 'manager_not_ready';
        const style = document.createElement('style');
        style.textContent = contentStyleText;
        shadowRoot.appendChild(style);

        const containerHtml = createManagerShell(el, chrome);
        shadowRoot.appendChild(containerHtml);

        if (window && typeof window.addEventListener === 'function') {
            window.addEventListener('pagehide', handlePageLifecyclePersistence);
            window.addEventListener('resize', handleSourceActionMenuViewportChange);
        }
        document.addEventListener('visibilitychange', handlePageLifecyclePersistence);

        // Handle Resizing
        const container = shadowRoot.querySelector('.sp-container');
        const resizer = shadowRoot.querySelector('.sp-resizer');
        let startY, startHeight;

        resizer.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10);
            document.documentElement.addEventListener('mousemove', doDrag, false);
            document.documentElement.addEventListener('mouseup', stopDrag, false);
            container.style.userSelect = 'none'; // Prevent text selection during drag
        });

        function doDrag(e) {
            const newHeight = Math.max(150, startHeight + (e.clientY - startY));
            container.style.height = `${newHeight}px`;
        }

        function stopDrag() {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
            container.style.userSelect = '';
            customHeight = parseInt(container.style.height, 10);
            saveState({ immediate: true }); // Save the new height immediately
        }

        shadowRoot.getElementById('sp-new-group-btn').addEventListener('click', () => handleAddNewGroup());
        shadowRoot.getElementById('sp-manage-tags-btn').addEventListener('click', () => renderTagModal());

        shadowRoot.getElementById('sp-batch-action-btn').addEventListener('click', () => {
            if (isDeletingSources) return;
            state.isBatchMode = !state.isBatchMode;
            pendingBatchKeys.clear();
            closeSourceActionMenu();
            render();
        });

        const searchInput = shadowRoot.getElementById('sp-search');
        const handleSearchInput = debounce(() => { render(); }, 300);

        // Immediate search trigger
        const triggerImmediateSearch = () => {
            state.filterQuery = searchInput.value;
            render();
        };

        searchInput.addEventListener('input', (event) => {
            state.filterQuery = event.target.value;
            handleSearchInput();
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerImmediateSearch();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleSearchCloseButtonClick(() => {
                    render();
                });
            }
        });
        shadowRoot.getElementById('sp-search-btn').addEventListener('click', (event) => {
            event.preventDefault();
            handleSearchButtonClick(triggerImmediateSearch);
        });
        shadowRoot.getElementById('sp-search-close-btn').addEventListener('click', (event) => {
            event.preventDefault();
            handleSearchCloseButtonClick(() => {
                render();
            });
        });
        shadowRoot.addEventListener('click', handleSearchOutsideClick);
        shadowRoot.addEventListener('scroll', handleSourceActionMenuViewportChange, true);
        document.addEventListener('click', handleDocumentOutsideClick, true);
        syncSearchUi();

        const listContainer = shadowRoot.querySelector('#sources-list');
        const viewStateContainer = shadowRoot.getElementById('sp-view-state');
        viewStateContainer.addEventListener('click', handleInteraction);
        listContainer.addEventListener('click', handleInteraction);
        listContainer.addEventListener('change', handleInteraction);
        listContainer.addEventListener('dragstart', handleDragStart);
        listContainer.addEventListener('dragover', handleDragOver);
        listContainer.addEventListener('dragleave', handleDragLeave);
        listContainer.addEventListener('drop', handleDrop);
        listContainer.addEventListener('dragend', handleDragEnd);

        const panelHeader = sourcePanel.querySelector('.panel-header') || sourcePanel.firstElementChild || sourcePanel;
        if (panelHeader) {
            panelHeader.insertAdjacentElement('afterend', extensionRoot);
            setNativeSourceListHidden(true);
            attachedSourcePanel = sourcePanel;
            managerStatusReason = 'ready';
            document.addEventListener('change', handleOriginalCheckboxChange, true);

            // --- Global Native Glassmorphism Injection ---
            if (!document.getElementById(GLOBAL_OVERLAY_STYLE_ID)) {
                const globalStyle = document.createElement('style');
                globalStyle.id = GLOBAL_OVERLAY_STYLE_ID;
                globalStyle.textContent = globalOverlayStyleText;
                document.head.appendChild(globalStyle);
            }

            // 1. Precise DOM Observation
            scrollObserver = new MutationObserver(handleDomChanges);
            attachScrollObserverToPanel(sourcePanel);

            // 2. Removed CPU-intensive Heartbeat Polling
            // Relying purely on MutationObserver is much more efficient.

            const reattachState = pendingPanelReattachState
                ? normalizeLoadedState(cloneSerializableData(pendingPanelReattachState))
                : null;
            pendingPanelReattachState = null;

            if (reattachState) {
                applyLoadedStateToManager(reattachState);
                completeInitialStateLoad();
                saveState({ immediate: true });
                return;
            }

            isAwaitingInitialStateLoad = true;
            loadState((loadedState) => {
                applyLoadedStateToManager(loadedState);
                completeInitialStateLoad();
            }, {
                expectedProjectId: projectId,
                instanceToken: managerInstanceToken
            });
        } else {
            attachedSourcePanel = null;
            managerStatusReason = 'panel_header_missing';
            showCrashBanner(getMessage('ui_crash_missing_header'));
        }
    }

    // --- Main execution ---
    if (chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
        chrome.runtime.onMessage.addListener(handleManagerMessage);
    }

    if (projectId) {
        requestExtensionEnabledStatus().then((enabled) => {
            isExtensionEnabled = enabled;
            if (!enabled) {
                managerStatusReason = 'extension_disabled';
                return;
            }

            return waitForElement(DEPS.panel).then(panel => {
                if (!panel) {
                    managerStatusReason = 'source_panel_missing';
                    showCrashBanner(getMessage('ui_crash_missing_panel'));
                    return;
                }
                bindPanelLifecycleHooks(panel);
                if (!isSourcePanelRenderable(panel)) {
                    managerStatusReason = 'manager_not_ready';
                    return;
                }
                if (getSourcePanelState(panel).state === 'detail') {
                    managerStatusReason = 'source_detail_view';
                    return;
                }
                init(panel);
            }).catch(err => {
                console.error("NotebookLM Source Management init error:", err);
                managerStatusReason = 'manager_not_ready';
                showCrashBanner(getMessage('ui_crash_init_error'));
            });
        });
    }

    // Monitor for SPA route changes via History API interception
    let currentUrl = location.href;
    const onRouteChange = () => {
        if (location.href !== currentUrl) {
            currentUrl = location.href;
            handleRouteChanged();
        }
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        onRouteChange();
    };
    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        onRouteChange();
    };
    window.addEventListener('popstate', onRouteChange);

    // Narrower observer for panel lifecycle only (no subtree attribute watching)
    panelLifecycleObserver = new MutationObserver(() => {
        schedulePanelLifecycleSync();
    });
    const sourcePanelParent = findSourcePanel()?.parentElement || document.body;
    panelLifecycleObserver.observe(sourcePanelParent, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });

    // Expose internals for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            areAllAncestorsEnabled,
            buildPersistableState,
            createTag,
            createGroupTitleIconElement,
            createSourceDescriptor,
            createSourceIconElement,
            deleteTag,
            extractSourceIconImageUrl,
            findFreshCheckbox,
            getTagStyleVars,
            getSourceTagIds,
            groupHasRenderableDescendant,
            hasActiveRenderFilters,
            isSourceEffectivelyEnabled,
            normalizeTagColor,
            normalizeLoadedState,
            processClickQueue,
            removeGroupFromTree,
            scanAndSyncSources,
            setSourceTagIds,
            shouldRenderGroup,
            sourceMatchesCurrentFilters,
            syncSourceToPage,
            updateTag,
            parentMap,
            groupsById,
            tagsById,
            sourceTagsById,
            executeBatchDelete,
            executeMoveToFolder,
            loadState,
            pendingBatchKeys,
            sourcesByKey,
            state,
            DEPS,
            saveState,
            flushPendingStateSave,
            getManagerStatus,
            focusManagerPanel,
            handleAddNewGroup,
            handleManagerMessage,
            handlePageLifecyclePersistence,
            handleRouteChanged,
            hasPersistedSourceRefs,
            hasRenderableSourceRows,
            findSourcePanel,
            findSourcePanelContent,
            bindPanelLifecycleHooks,
            getSourcePanelState,
            isManagerAttachedToPanel,
            isSourcePanelCollapsed,
            isSourcePanelRenderable,
            isSourcePanelManageable,
            recoverManagerForRoute,
            restoreInitialLoadedState,
            resolveSourcePanelSurfaceColor,
            schedulePanelLifecycleSync,
            syncManagerWithPanelLifecycle,
            toggleSourceActionMenu,
            closeSourceActionMenu,
            handleSourceActionSelection,
            _applySourcePanelSurfaceColorForTest: applySourcePanelSurfaceColor,
            _getClickQueueLength: () => clickQueue.length,
            _getIsDeletingSources: () => isDeletingSources,
            _getIsSyncingState: () => isSyncingState,
            _setIsDeletingSources: (val) => { isDeletingSources = val; },
            _getFreshRowCache: () => freshRowCache,
            _getPendingStorageUpgrade: () => pendingStorageUpgrade,
            _getPendingInitialLoadedState: () => pendingInitialLoadedState,
            _getAwaitingInitialStateLoadForTest: () => isAwaitingInitialStateLoad,
            _getPendingPanelReattachStateForTest: () => pendingPanelReattachState,
            _getAttachedSourcePanelForTest: () => attachedSourcePanel,
            _getAttachedPanelHeaderForTest: () => attachedPanelHeader,
            _getObservedNativeScrollAreaForTest: () => observedNativeScrollArea,
            _getPanelResizeObserverForTest: () => panelResizeObserver,
            _getExtensionEnabledForTest: () => isExtensionEnabled,
            _flushPendingInitialLoadedStateForTest: flushPendingInitialLoadedState,
            _debouncedScanAndSyncForTest: () => {
                debouncedScanAndSync();
                if (typeof debouncedScanAndSync.flush === 'function') {
                    debouncedScanAndSync.flush();
                }
            },
            _setCustomHeight: (val) => { customHeight = val; },
            _setManagerStatusReason: (val) => { managerStatusReason = val; },
            _setProjectId: (val) => { projectId = val; },
            _setAwaitingInitialStateLoadForTest: (val) => { isAwaitingInitialStateLoad = Boolean(val); },
            _setSourceDetailViewRequestedForTest: (val) => { sourceDetailViewRequested = Boolean(val); },
            _setSourceDetailViewReadySuppressionUntilForTest: (val) => { sourceDetailViewReadySuppressionUntil = Number(val) || 0; },
            _completeInitialStateLoadForTest: completeInitialStateLoad,
            _setAttachedSourcePanelForTest: (val) => { attachedSourcePanel = val; },
            _getActiveIsolationGroupId: () => activeIsolationGroupId,
            _setActiveIsolationGroupId: (val) => { activeIsolationGroupId = val; },
            _getIsSearchExpanded: () => isSearchExpanded,
            _setIsSearchExpanded: (val) => { isSearchExpanded = val; },
            _getActiveSourceActionSourceKey: () => getActiveSourceActionSourceKey(),
            _setActiveSourceActionSourceKey: (val) => { setActiveSourceActionSourceKey(val); },
            _getActiveSourceActionSubmenuAction: () => getActiveSourceActionSubmenuAction(),
            _setActiveSourceActionSubmenuAction: (val) => { setActiveSourceActionSubmenuAction(val); },
            _getSourceActionMenuItemsForTest: (sourceKey) => getSourceActionMenuItems(sourceKey),
            _getSourceActionSubmenuItemsForTest: (sourceKey, submenuAction) => getSourceActionSubmenuItems(sourceKey, submenuAction),
            _triggerNativeSourceDetailsDirectForTest: (sourceKey) => triggerNativeSourceDetailsDirect(sourceKey),
            _triggerNativeSourceDetailsViaNativeMenuForTest: (sourceKey) => triggerNativeSourceDetailsViaNativeMenu(sourceKey),
            _setSourceActionInvokerForTest: (name, fn) => {
                setSourceActionInvoker(name, fn);
            },
            _handleInteractionForTest: handleInteraction,
            _setShadowRootForTest: (val) => { shadowRoot = val; extensionHost = val && val.host ? val.host : null; },
            _setExtensionEnabledForTest: (val) => { isExtensionEnabled = Boolean(val); },
            _setManagerRuntimeForTest: ({ extensionHost: nextHost = null, shadowRoot: nextShadowRoot = null } = {}) => {
                extensionHost = nextHost;
                shadowRoot = nextShadowRoot;
            },
            _showCrashBannerForTest: showCrashBanner,
            _syncSearchUi: syncSearchUi,
            _handleSearchButtonClick: handleSearchButtonClick,
            _handleSearchOutsideClick: handleSearchOutsideClick,
            _resetState: () => {
                clearScheduledPanelLifecycleSync();
                invalidateManagerInstance();
                nextLoadStateRequestId = 1;
                state.groups = [];
                state.ungrouped = [];
                state.filterQuery = '';
                state.isBatchMode = false;
                pendingBatchKeys.clear();
                isDeletingSources = false;
                groupsById.clear();
                sourcesByKey.clear();
                tagsById.clear();
                sourceTagsById.clear();
                parentMap.clear();
                customHeight = null;
                projectId = null;
                shadowRoot = document.createElement('div').attachShadow({ mode: 'open' }); // Mock shadowRoot for testing showToast
                extensionHost = shadowRoot.host;
                freshRowCache = null;
                clickQueue = [];
                isProcessingQueue = false;
                isSyncingState = false;
                cancelPendingStateSave();
                clearScheduledPanelLifecycleSync();
                pendingStorageUpgrade = false;
                pendingInitialLoadedState = null;
                isAwaitingInitialStateLoad = false;
                sourceDetailViewRequested = false;
                sourceDetailViewReadySuppressionUntil = 0;
                pendingPanelReattachState = null;
                attachedSourcePanel = null;
                attachedPanelHeader = null;
                observedNativeScrollArea = null;
                managerStatusReason = 'manager_not_ready';
                isExtensionEnabled = true;
                setNativeSourceListHidden(false);
                if (panelResizeObserver) {
                    panelResizeObserver.disconnect();
                    panelResizeObserver = null;
                }
                activeRouteRecoveryToken = 0;
                routeRecoveryTimeout = null;
                state.tagOrder = [];
                state.activeTagId = null;
                activeIsolationGroupId = null;
                isSearchExpanded = false;
                closeSourceActionMenu();
                resetSourceActionInvokers();
                if (focusHighlightTimeout) {
                    clearTimeout(focusHighlightTimeout);
                    focusHighlightTimeout = null;
                }
                if (
                    chrome.runtime &&
                    chrome.runtime.sendMessage &&
                    typeof chrome.runtime.sendMessage.mockClear === 'function'
                ) {
                    chrome.runtime.sendMessage.mockClear();
                }
            }
        };
    }

})();
