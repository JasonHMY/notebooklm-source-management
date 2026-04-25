(function () {
    'use strict';

    const CONTENT_INSTANCE_KEY = '__NSM_CONTENT_SCRIPT_INSTANCE__';
    const previousContentInstance = globalThis[CONTENT_INSTANCE_KEY];
    if (previousContentInstance && typeof previousContentInstance.destroy === 'function') {
        try {
            previousContentInstance.destroy('reinitialized');
        } catch (error) {
            console.warn('NotebookLM Source Management: Failed to tear down previous content instance.', error);
        }
    }

    const contentInstance = {
        destroyed: false,
        destroy: null
    };
    globalThis[CONTENT_INSTANCE_KEY] = contentInstance;

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
        IMPORT_CONFIG_MAX_FILE_BYTES,
        IMPORT_CONFIG_MAX_GROUPS,
        IMPORT_CONFIG_MAX_TAGS,
        IMPORT_CONFIG_MAX_SOURCES,
        IMPORT_CONFIG_MAX_CHILD_REFS,
        IMPORT_CONFIG_MAX_TREE_DEPTH,
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
    let currentUrl = getCurrentLocationHref();
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
    let nativeRenameWatcherTimeout = null;
    let stateHistoryEntries = [];
    let sourceViewKind = 'unknown';
    let sourceViewConfidence = 0;
    let sourceViewInfo = null;
    let lastSourceViewChangedAt = '';
    let lastSourceViewTransition = null;
    let lastNativeSourceListHidden = false;
    let lastNativeSourceListHiddenAt = '';
    let lastNativeLabelImportSummary = null;
    const NATIVE_ACTION_FAILURE_HISTORY_LIMIT = 5;
    let nativeActionFailureHistory = [];
    const MANAGER_ACTIVE_CLASS = 'sources-plus-manager-active';
    const NATIVE_RENAME_WATCHER_INTERVAL_MS = 250;
    const NATIVE_RENAME_WATCHER_DURATION_MS = 5000;

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
    bindRuntimeProperty('stateHistoryEntries', () => stateHistoryEntries, (value) => { stateHistoryEntries = Array.isArray(value) ? value : []; });
    bindRuntimeProperty('sourceViewKind', () => sourceViewKind, (value) => { sourceViewKind = String(value || 'unknown'); });
    bindRuntimeProperty('sourceViewConfidence', () => sourceViewConfidence, (value) => { sourceViewConfidence = Number(value) || 0; });
    bindRuntimeProperty('sourceViewInfo', () => sourceViewInfo, (value) => { sourceViewInfo = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('lastSourceViewChangedAt', () => lastSourceViewChangedAt, (value) => { lastSourceViewChangedAt = String(value || ''); });
    bindRuntimeProperty('lastSourceViewTransition', () => lastSourceViewTransition, (value) => { lastSourceViewTransition = value && typeof value === 'object' ? value : null; });
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
        getTagColorPresets,
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
        resolveStoredSourceKeyWithReason,
        buildSourceMatchReport,
        applySourceRemapsToSnapshot,
        snapshotExistingSourceRecords,
        buildSingleSourcePositionalRemap,
        remapExistingStateToCurrentSources,
        buildResolvedSourceStateById,
        buildNormalizedTagState,
        buildResolvedSourceTagsById,
        reconcilePersistedTree,
        appendGroupChildIfAcyclic
    } = stateReconcileModule;

    const sourceActionsModule = createContentSourceActions({
        getDocument: () => document,
        getWindow: () => window,
        getState: () => state,
        getSourcesByKey: () => sourcesByKey,
        getShadowRoot: () => shadowRoot,
        getDEPS: () => DEPS,
        getMessage,
        runtime: runtimeContext,
        showToast: (...args) => showToast(...args),
        render: (...args) => render(...args),
        sourceMatchesCurrentFilters: (...args) => sourceMatchesCurrentFilters(...args),
        resolveFreshRowEntry: (...args) => resolveFreshRowEntry(...args),
        getSourceElements: () => getSourceElements(findSourcePanel() || document),
        renderTagModal: (...args) => renderTagModal(...args),
        renderMoveToFolderModal: (...args) => renderMoveToFolderModal(...args),
        canMoveSourceToUngrouped: (...args) => canMoveSourceToUngrouped(...args),
        moveSourceToUngrouped: (...args) => moveSourceToUngrouped(...args),
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
        onNativeSourceRenameStarted: (...args) => startNativeRenameWatcher(...args),
        recordNativeActionFailure: (details) => {
            const failure = Object.assign({
                occurredAt: new Date().toISOString()
            }, details || {});
            nativeActionFailureHistory.unshift(failure);
            if (nativeActionFailureHistory.length > NATIVE_ACTION_FAILURE_HISTORY_LIMIT) {
                nativeActionFailureHistory = nativeActionFailureHistory.slice(0, NATIVE_ACTION_FAILURE_HISTORY_LIMIT);
            }
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
        queryNativeDialogs,
        getNativeDialogMetadata,
        getNativeDialogFingerprint,
        isNativeDeleteConfirmDialog,
        findNativeDeleteConfirmDialogs,
        getNativeDeleteMenuItemScore,
        getNativeRenameMenuItemScore,
        scoreNativeMenuItemAction,
        findNativeActionMenuItem,
        findNativeDeleteMenuItem,
        findNativeRenameMenuItem,
        findNativeDeleteConfirmButton,
        getNativeSourceDetailsMenuItemScore,
        findNativeSourceDetailsMenuItem,
        resolveFreshSourceRow,
        createSyntheticActivationEvent,
        dispatchSyntheticActivation,
        isSourceDetailsTargetCandidate,
        collectSourceDetailsCandidates,
        getSourceDetailsTargetScore,
        triggerNativeSourceDetailsDirectWithResult,
        triggerNativeSourceDetailsDirect,
        waitForNativeMenuItems,
        waitForNativeDialogs,
        triggerNativeSourceDetailsViaNativeMenuWithResult,
        triggerNativeSourceDetailsViaNativeMenu,
        triggerNativeSourceRenameWithResult,
        triggerNativeSourceRename,
        deleteNativeSource,
        getNativeActionFailureMessage,
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
        getTagsById: () => tagsById,
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
        parseSearchQuery,
        sourceMatchesSearchCriteria,
        groupMatchesSearchCriteria,
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
        getWindow: () => window,
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
        showToast: (...args) => showToast(...args),
        showUndoableToast: (...args) => showUndoableToast(...args),
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
        getExportConfigText: (...args) => getExportConfigText(...args),
        previewImportConfig: (...args) => previewImportConfig(...args),
        applyImportConfig: (...args) => applyImportConfig(...args),
        getSourceRepairReport: (...args) => getSourceRepairReport(...args),
        getSourceRepairOptions: (...args) => getSourceRepairOptions(...args),
        applySourceRepairRemaps: (...args) => applySourceRepairRemaps(...args),
        getStateHistoryEntries: (...args) => getStateHistoryEntries(...args),
        restoreStateHistoryEntry: (...args) => restoreStateHistoryEntryFromUi(...args),
        applyNativeLabelImport: (...args) => applyNativeLabelImport(...args),
        getDiagnosticsInfo: (...args) => getDiagnosticsInfo(...args),
        getDiagnosticsText: (...args) => getDiagnosticsText(...args),
        renderSaveStatus: (...args) => renderSaveStatus(...args),
        normalizeTagColor,
        normalizeTagColorInputValue,
        getDefaultTagColor,
        getTagColorPreviewStyle
    });
    const {
        renderMoveToFolderModal,
        closeMoveToFolderModal,
        executeMoveToFolder,
        collectMoveFolderOptions,
        closeTagModal,
        closeBatchTagModal,
        executeBatchTagUpdate,
        renderBatchTagModal,
        createTagColorControl,
        createTagEditor,
        getModalFocusableElements,
        focusModalInitialElement,
        handleModalKeyboardEvent,
        bindModalKeyboardNavigation,
        rememberModalFocusRestoreTarget,
        restoreModalFocus,
        closeManagedModal,
        prepareModalOpen,
        createModalItemStaggerStyle,
        getTagColorPresets: getModalTagColorPresets,
        closeSettingsModal,
        renderSettingsModal,
        getImportPreviewMessage,
        renderNativeLabelImportModal,
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
        resolveStoredSourceKeyWithReason,
        buildResolvedSourceStateById,
        buildNormalizedTagState,
        buildResolvedSourceTagsById,
        reconcilePersistedTree,
        snapshotExistingSourceRecords,
        remapExistingStateToCurrentSources,
        setSourceTagIds,
        syncSourceToPage: (...args) => syncSourceToPage(...args),
        buildParentMap: (...args) => buildParentMap(...args),
        buildPersistableState: (...args) => buildPersistableState(...args),
        saveState: (options = {}) => saveState(Object.assign({}, options, { recordUndo: false })),
        render: (...args) => render(...args),
        suspendManagerForSourceDetailView: (...args) => suspendManagerForSourceDetailView(...args),
        flushPendingInitialLoadedState: (...args) => flushPendingInitialLoadedState(...args),
        debounce
    });
    const {
        isFreshRowCacheEntryMatch,
        resolveFreshRowEntry,
        findFreshCheckbox,
        getSourceViewInfo,
        detectSourceView,
        getSourceEntries,
        getSourceElements,
        getManageableSourceElements,
        hasRenderableSourceRows,
        getSourcePanelState,
        isSourcePanelManageable,
        isSourceDetailViewPanel,
        scanAndSyncSources,
        handleDomChanges,
        debouncedScanAndSync,
        getPersistableStateSignature,
        shouldSaveAfterMutationSync,
        getMutationRelevance
    } = sourceSyncModule;

    function clearNativeRenameWatcher() {
        if (nativeRenameWatcherTimeout) {
            clearTimeout(nativeRenameWatcherTimeout);
            nativeRenameWatcherTimeout = null;
        }
    }

    function runNativeRenameSyncPass(initialSignature) {
        if (isAwaitingInitialStateLoad) return false;
        if (getSourcePanelState(findSourcePanel()).state !== 'ready') return false;

        const previousSignature = getPersistableStateSignature();
        scanAndSyncSources({}, false);
        render();
        const nextSignature = getPersistableStateSignature();
        if (
            shouldSaveAfterMutationSync(previousSignature, nextSignature) ||
            (
                initialSignature != null &&
                nextSignature != null &&
                initialSignature !== nextSignature
            )
        ) {
            saveState({ immediate: true, critical: true, recordUndo: false });
            return true;
        }

        return false;
    }

    function startNativeRenameWatcher(sourceKey) {
        if (!sourceKey || !sourcesByKey.has(sourceKey)) return false;

        clearNativeRenameWatcher();
        const initialSignature = getPersistableStateSignature();
        const startedAt = Date.now();

        const tick = () => {
            if (Date.now() - startedAt > NATIVE_RENAME_WATCHER_DURATION_MS) {
                clearNativeRenameWatcher();
                return;
            }

            if (runNativeRenameSyncPass(initialSignature)) {
                clearNativeRenameWatcher();
                return;
            }

            nativeRenameWatcherTimeout = setTimeout(tick, NATIVE_RENAME_WATCHER_INTERVAL_MS);
        };

        nativeRenameWatcherTimeout = setTimeout(tick, NATIVE_RENAME_WATCHER_INTERVAL_MS);
        return true;
    }

    const renderModule = createContentRender({
        getDocument: () => document,
        getShadowRoot: () => shadowRoot,
        getState: () => state,
        getGroupsById: () => groupsById,
        getTagsById: () => tagsById,
        getSourcesByKey: () => sourcesByKey,
        getParentMap: () => parentMap,
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
        setSourceActionMenuPosition,
        closeSourceActionMenu,
        setActiveSourceActionSubmenuAction,
        getSourceViewInfo: () => getSourceViewInfo(findSourcePanel()),
        getNativeLabelImportPreview: (...args) => getNativeLabelImportPreview(...args),
        getLastNativeLabelImportSummary: () => lastNativeLabelImportSummary
    });
    const {
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
        parseSearchQuery: parseRenderSearchQuery,
        sourceMatchesSearchQuery,
        getSearchHighlightTerms,
        createHighlightedTextChildren,
        updateSearchResultCount,
        collectSearchExpandedGroupIds,
        getGroupEffectiveState,
        patchNode,
        patchChildren,
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
    } = renderModule;

    const persistenceModule = createContentPersistence(Object.assign(Object.create(runtimeContext), {
        chrome,
        debounce,
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
        normalizeSourceText,
        getMessage,
        showToast: (...args) => showToast(...args),
        onSaveStatusChange: (status) => renderSaveStatus(status),
        getSourceTagIds,
        getSerializedTag,
        buildNormalizedTagState,
        appendGroupChildIfAcyclic,
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
        getStateHistoryKey,
        getStateHistoryEntries,
        setStateHistoryEntries,
        loadStateHistory,
        appendStateHistorySnapshot,
        pickPreferredStoredState,
        writeStateToLocalStorage,
        sendStateToStorage,
        enqueueStateSave,
        waitForPendingStateSave,
        preparePersistableSnapshot,
        prepareRuntimeSaveSnapshot,
        getSnapshotSaveRevision,
        getSaveStatus,
        setSaveStatus,
        getRecoveryKey,
        writeRecoverySnapshot,
        readRecoverySnapshot,
        clearRecoverySnapshot,
        detectRecoverySnapshotAvailability,
        flushPendingStateSave,
        cancelPendingStateSave,
        invalidateManagerInstance,
        isLiveManagerLoadRequest,
        buildPersistableState,
        saveState: persistState,
        handlePageLifecyclePersistence,
        normalizeLoadedState,
        hasPreservableManagerSnapshot,
        canPersistManagerState,
        hasPersistedSourceRefs,
        hasPersistableManagerState,
        restorePersistedSnapshotWithoutDom,
        capturePendingPanelReattachState,
        restoreInitialLoadedState,
        flushPendingInitialLoadedState,
        applyLoadedStateToManager,
        loadState
    } = persistenceModule;

    const UNDO_STACK_LIMIT = 20;
    let undoStack = [];
    let undoBaselineSnapshot = null;
    let undoBaselineSignature = '';
    let isApplyingUndoSnapshot = false;

    function getUndoSnapshotSignature(snapshot) {
        try {
            return JSON.stringify(snapshot || null);
        } catch (error) {
            return '';
        }
    }

    function getCurrentUndoSnapshot() {
        try {
            return cloneSerializableData(buildPersistableState());
        } catch (error) {
            console.warn('NotebookLM Source Management: Could not capture undo snapshot.', error);
            return null;
        }
    }

    function setUndoBaselineSnapshot(snapshot = null) {
        const nextSnapshot = snapshot ? cloneSerializableData(snapshot) : getCurrentUndoSnapshot();
        undoBaselineSnapshot = nextSnapshot;
        undoBaselineSignature = getUndoSnapshotSignature(nextSnapshot);
        return Boolean(nextSnapshot);
    }

    function resetUndoHistoryBaseline(snapshot = null) {
        undoStack = [];
        setUndoBaselineSnapshot(snapshot);
    }

    function recordUndoBaselineForSave(nextSnapshot, options = {}) {
        const shouldRecordUndo = options.recordUndo !== false && !isApplyingUndoSnapshot;
        const nextSignature = getUndoSnapshotSignature(nextSnapshot);

        if (
            shouldRecordUndo &&
            undoBaselineSnapshot &&
            undoBaselineSignature &&
            nextSignature &&
            nextSignature !== undoBaselineSignature
        ) {
            undoStack.push(cloneSerializableData(undoBaselineSnapshot));
            if (undoStack.length > UNDO_STACK_LIMIT) {
                undoStack.splice(0, undoStack.length - UNDO_STACK_LIMIT);
            }
        }

        undoBaselineSnapshot = cloneSerializableData(nextSnapshot);
        undoBaselineSignature = nextSignature;
    }

    function saveState(options = {}) {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        if (projectId) {
            const nextSnapshot = getCurrentUndoSnapshot();
            if (nextSnapshot) {
                recordUndoBaselineForSave(nextSnapshot, normalizedOptions);
            }
        }
        return persistState(normalizedOptions);
    }

    function applyPersistableSnapshotToRuntime(snapshot) {
        const normalizedState = normalizeLoadedState(cloneSerializableData(snapshot));
        if (!normalizedState || !hasPersistableManagerState(normalizedState)) return false;

        state.groups = Array.isArray(normalizedState.groups) ? [...normalizedState.groups] : [];
        state.ungrouped = Array.isArray(normalizedState.ungrouped) ? [...normalizedState.ungrouped] : [];
        state.tagOrder = Array.isArray(normalizedState.tagOrder) ? [...normalizedState.tagOrder] : [];
        state.isBatchMode = false;
        pendingBatchKeys.clear();

        groupsById.clear();
        Object.entries(normalizedState.groupsById || {}).forEach(([groupId, group]) => {
            groupsById.set(groupId, cloneSerializableData(group));
        });

        tagsById.clear();
        Object.entries(normalizedState.tagsById || {}).forEach(([tagId, tag]) => {
            tagsById.set(tagId, cloneSerializableData(tag));
        });

        sourceTagsById.clear();
        Object.entries(normalizedState.sourceTagsById || {}).forEach(([sourceKey, tagIds]) => {
            sourceTagsById.set(sourceKey, Array.isArray(tagIds) ? [...tagIds] : []);
        });

        Object.entries(normalizedState.sourceStateById || {}).forEach(([sourceKey, sourceState]) => {
            const source = sourcesByKey.get(sourceKey);
            if (!source) return;
            source.enabled = Boolean(sourceState.enabled);
            source.title = sourceState.title || source.title;
            source.normalizedTitle = sourceState.normalizedTitle || normalizeSourceText(source.title);
            source.stableToken = sourceState.stableToken || source.stableToken || '';
            source.fingerprint = sourceState.fingerprint || source.fingerprint || '';
            source.identityType = sourceState.identityType || source.identityType || 'fingerprint';
        });

        const knownSourceKeys = new Set(state.ungrouped);
        const visitGroupSources = (groupId) => {
            const group = groupsById.get(groupId);
            if (!group || !Array.isArray(group.children)) return;
            group.children.forEach((child) => {
                if (child?.type === 'source' && child.key) {
                    knownSourceKeys.add(child.key);
                } else if (child?.type === 'group' && child.id) {
                    visitGroupSources(child.id);
                }
            });
        };
        state.groups.forEach(visitGroupSources);
        sourcesByKey.forEach((source, sourceKey) => {
            if (!knownSourceKeys.has(sourceKey)) {
                state.ungrouped.push(sourceKey);
                knownSourceKeys.add(sourceKey);
            }
        });

        if (state.activeTagId && !tagsById.has(state.activeTagId)) {
            state.activeTagId = null;
        }

        if (normalizedState.customHeight != null) {
            customHeight = normalizedState.customHeight;
            const container = shadowRoot?.querySelector?.('.sp-container');
            if (container) container.style.height = `${customHeight}px`;
        }

        buildParentMap();
        sourcesByKey.forEach((source) => {
            syncSourceToPage(source, isSourceEffectivelyEnabled(source));
        });
        return true;
    }

    function undoLastOperation() {
        const snapshot = undoStack.pop();
        if (!snapshot) {
            showToast(getMessage('ui_undo_empty'), { variant: 'info' });
            return false;
        }

        isApplyingUndoSnapshot = true;
        try {
            if (!applyPersistableSnapshotToRuntime(snapshot)) {
                showToast(getMessage('ui_undo_empty'), { variant: 'info' });
                return false;
            }

            closeSourceActionMenu();
            render();
            saveState({ immediate: true, critical: true, recordUndo: false });
            setUndoBaselineSnapshot(snapshot);
            showToast(getMessage('ui_undo_toast'), { variant: 'success' });
            return true;
        } finally {
            isApplyingUndoSnapshot = false;
        }
    }

    function isEditableUndoTarget(target) {
        if (!target) return false;
        const tagName = String(target.tagName || '').toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
        if (target.isContentEditable) return true;
        return Boolean(target.closest?.('[contenteditable="true"]'));
    }

    function handleUndoKeydown(event) {
        const key = String(event?.key || '').toLowerCase();
        if (key !== 'z' || (!event.metaKey && !event.ctrlKey) || event.shiftKey || event.altKey) {
            return;
        }
        if (isEditableUndoTarget(event.target)) return;

        event.preventDefault?.();
        event.stopPropagation?.();
        undoLastOperation();
    }

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
        showUndoableToast: (...args) => showUndoableToast(...args),
        render: (...args) => render(...args),
        saveState: (...args) => saveState(...args),
        buildParentMap: (...args) => buildParentMap(...args),
        isSourceEffectivelyEnabled: (...args) => isSourceEffectivelyEnabled(...args),
        collectEffectiveSourceStates: (...args) => collectEffectiveSourceStates(...args),
        syncSourcesToEffectiveState: (...args) => syncSourcesToEffectiveState(...args),
        executeBatchDelete: (...args) => executeBatchDelete(...args),
        renderMoveToFolderModal: (...args) => renderMoveToFolderModal(...args),
        renderBatchTagModal: (...args) => renderBatchTagModal(...args),
        getSourceActionInvokers,
        handleSourceActionSelection,
        applyNativeLabelImportFromUi: (...args) => applyNativeLabelImportFromUi(...args),
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
        getDropIntent,
        getSourceTreePosition,
        getGroupTreePosition,
        isNoopTreeMove
    } = treeInteractionsModule;

    function getNativeLabelImportPreview() {
        const viewInfo = sourceViewInfo || { kind: sourceViewKind, confidence: sourceViewConfidence };
        if (viewInfo.kind !== 'label') {
            return {
                ok: false,
                reason: 'not_label_view',
                labelCount: 0,
                sourceCount: 0,
                labels: []
            };
        }

        const labelsByTitle = new Map();
        sourcesByKey.forEach((source, sourceKey) => {
            const title = String(source?.nativeLabelTitle || '').replace(/\s+/g, ' ').trim();
            if (!title || !sourceKey) return;
            const normalizedTitle = normalizeSourceText(title).toLowerCase();
            if (!labelsByTitle.has(normalizedTitle)) {
                labelsByTitle.set(normalizedTitle, {
                    title,
                    sourceKeys: [],
                    sourceTitles: []
                });
            }
            const label = labelsByTitle.get(normalizedTitle);
            label.sourceKeys.push(sourceKey);
            label.sourceTitles.push(source?.title || source?.normalizedTitle || sourceKey);
        });

        const labels = Array.from(labelsByTitle.values())
            .map((label) => {
                const existingGroup = Array.from(groupsById.values()).find((group) => (
                    normalizeSourceText(group?.title || '').toLowerCase() === normalizeSourceText(label.title).toLowerCase()
                ));
                return Object.assign({}, label, {
                    sourceCount: label.sourceKeys.length,
                    existingGroupId: existingGroup?.id || null,
                    action: existingGroup ? 'reuse' : 'create'
                });
            })
            .filter((label) => label.sourceCount > 0)
            .sort((left, right) => left.title.localeCompare(right.title));

        const sourceCount = labels.reduce((total, label) => total + label.sourceCount, 0);
        return {
            ok: labels.length > 0,
            reason: labels.length > 0 ? 'ready' : 'no_native_labels',
            labelCount: labels.length,
            sourceCount,
            labels
        };
    }

    function createImportedNativeLabelGroupId(labelTitle, usedIds = new Set(groupsById.keys())) {
        const slug = normalizeSourceText(labelTitle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40) || 'label';
        let candidate = `native_label_${slug}`;
        let index = 2;
        while (usedIds.has(candidate)) {
            candidate = `native_label_${slug}_${index}`;
            index += 1;
        }
        usedIds.add(candidate);
        return candidate;
    }

    function applyNativeLabelImport(previewOverride = null) {
        const preview = previewOverride && typeof previewOverride === 'object'
            ? previewOverride
            : getNativeLabelImportPreview();
        if (!preview.ok) {
            showToast(getMessage('ui_import_native_labels_unavailable'), { variant: 'info' });
            return false;
        }

        const usedGroupIds = new Set(groupsById.keys());
        const previewLabels = Array.isArray(preview.labels) ? preview.labels : [];
        previewLabels.forEach((label) => {
            const sourceKeys = Array.isArray(label?.sourceKeys) ? label.sourceKeys : [];
            let group = label.existingGroupId ? groupsById.get(label.existingGroupId) : null;
            if (!group) {
                group = {
                    id: createImportedNativeLabelGroupId(label.title, usedGroupIds),
                    title: label.title,
                    children: [],
                    enabled: true,
                    collapsed: false,
                    isNewlyCreated: true
                };
                groupsById.set(group.id, group);
                if (!state.groups.includes(group.id)) {
                    state.groups.push(group.id);
                }
            }

            sourceKeys.forEach((sourceKey) => {
                if (!sourcesByKey.has(sourceKey)) return;
                removeSourceFromTree(sourceKey);
                if (!group.children.some((child) => child?.type === 'source' && child.key === sourceKey)) {
                    group.children.push({ type: 'source', key: sourceKey });
                }
            });
        });

        buildParentMap();
        lastNativeLabelImportSummary = {
            labelCount: Number(preview.labelCount) || previewLabels.length,
            sourceCount: Number(preview.sourceCount) || previewLabels.reduce((total, label) => total + (Number(label.sourceCount) || 0), 0),
            importedAt: new Date().toISOString(),
            labels: previewLabels.map((label) => ({
                title: label.title || '',
                sourceCount: Number(label.sourceCount) || 0,
                action: label.action || (label.existingGroupId ? 'reuse' : 'create')
            }))
        };
        render();
        saveState({ immediate: true, critical: true });
        showUndoableToast(getMessage('ui_import_native_labels_applied', [
            String(lastNativeLabelImportSummary.labelCount),
            String(lastNativeLabelImportSummary.sourceCount)
        ]), { variant: 'success' });
        return true;
    }

    function applyNativeLabelImportFromUi() {
        if (sourceViewInfo?.kind === 'label' || sourceViewKind === 'label') {
            scanAndSyncSources({}, false);
        }
        const preview = getNativeLabelImportPreview();
        renderNativeLabelImportModal(preview);
        return preview.ok;
    }

    function getProjectId() {
        const pathSegments = window.location.pathname.split('/');
        const notebookIndex = pathSegments.indexOf('notebook');
        if (notebookIndex > -1 && notebookIndex + 1 < pathSegments.length) {
            return pathSegments[notebookIndex + 1];
        }
        return null;
    }

    function getCurrentLocationHref() {
        if (window.location && typeof window.location.href === 'string') {
            return window.location.href;
        }
        if (globalThis.location && typeof globalThis.location.href === 'string') {
            return globalThis.location.href;
        }
        return '';
    }

    let toastTimeout = null;
    let activeToastItem = null;
    const toastQueue = [];
    const TOAST_DEFAULT_DURATION_MS = 3000;
    const TOAST_ACTION_DURATION_MS = 5000;

    function normalizeToastOptions(options = {}) {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        const variant = ['info', 'success', 'error'].includes(normalizedOptions.variant)
            ? normalizedOptions.variant
            : 'info';
        return {
            variant,
            actionLabel: typeof normalizedOptions.actionLabel === 'string' ? normalizedOptions.actionLabel : '',
            onAction: typeof normalizedOptions.onAction === 'function' ? normalizedOptions.onAction : null,
            durationMs: Number.isFinite(normalizedOptions.durationMs) && normalizedOptions.durationMs > 0
                ? normalizedOptions.durationMs
                : null
        };
    }

    function ensureToastElement() {
        if (!shadowRoot) return null;
        let toast = shadowRoot.querySelector('.sp-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'sp-toast sp-toast-info';
            shadowRoot.appendChild(toast);
        }
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        return toast;
    }

    function clearToastTimeout() {
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }
    }

    function hideActiveToast(showNext = true) {
        const toast = shadowRoot?.querySelector?.('.sp-toast');
        if (toast) {
            toast.classList.remove('show');
        }
        clearToastTimeout();
        activeToastItem = null;
        if (showNext && toastQueue.length > 0) {
            toastTimeout = setTimeout(() => {
                toastTimeout = null;
                showNextToast();
            }, 120);
        }
    }

    function showNextToast() {
        if (activeToastItem || toastQueue.length === 0) return;
        const toast = ensureToastElement();
        if (!toast) return;

        const item = toastQueue.shift();
        activeToastItem = item;
        toast.className = `sp-toast sp-toast-${item.variant}`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');

        const messageNode = document.createElement('span');
        messageNode.className = 'sp-toast-message';
        messageNode.textContent = item.message;
        const children = [messageNode];

        if (item.actionLabel && item.onAction) {
            const actionButton = document.createElement('button');
            actionButton.type = 'button';
            actionButton.className = 'sp-toast-action';
            actionButton.textContent = item.actionLabel;
            actionButton.addEventListener('click', () => {
                try {
                    item.onAction();
                } finally {
                    hideActiveToast(true);
                }
            });
            children.push(actionButton);
        }

        toast.replaceChildren(...children);
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');

        const duration = item.durationMs || (item.actionLabel ? TOAST_ACTION_DURATION_MS : TOAST_DEFAULT_DURATION_MS);
        clearToastTimeout();
        toastTimeout = setTimeout(() => hideActiveToast(true), duration);
    }

    function showToast(message, options = {}) {
        const text = String(message || '').trim();
        if (!text) return;
        toastQueue.push(Object.assign({ message: text }, normalizeToastOptions(options)));
        showNextToast();
    }

    function showUndoableToast(message, options = {}) {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        if (
            undoStack.length === 0 ||
            normalizedOptions.actionLabel ||
            normalizedOptions.onAction
        ) {
            showToast(message, options);
            return;
        }

        showToast(message, Object.assign({}, normalizedOptions, {
            actionLabel: getMessage('ui_undo_action'),
            onAction: undoLastOperation
        }));
    }

    function getSaveStatusMessageKey(statusState) {
        switch (statusState) {
            case 'saving':
                return 'ui_save_status_saving';
            case 'saved':
                return 'ui_save_status_saved';
            case 'failed':
                return 'ui_save_status_failed';
            case 'stale':
                return 'ui_save_status_stale';
            case 'recovery_available':
                return 'ui_save_status_recovery';
            default:
                return '';
        }
    }

    function clearElementChildren(element) {
        if (!element) return;
        if (typeof element.replaceChildren === 'function') {
            element.replaceChildren();
            return;
        }
        while (element.firstChild && typeof element.removeChild === 'function') {
            element.removeChild(element.firstChild);
        }
        if (Array.isArray(element.childNodes)) {
            element.childNodes.length = 0;
        }
        if (Array.isArray(element.children)) {
            element.children.length = 0;
        }
    }

    function appendSaveStatusAction(container, labelKey, handler, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className || 'sp-save-status-action';
        button.textContent = getMessage(labelKey);
        button.addEventListener('click', (event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            handler();
        });
        container.appendChild(button);
        return button;
    }

    function retryCurrentSave() {
        return saveState({ immediate: true, critical: true, recordUndo: false });
    }

    function refreshForLatestState() {
        try {
            const locationObject = (typeof window !== 'undefined' && window.location)
                || globalThis.location;
            if (locationObject && typeof locationObject.reload === 'function') {
                locationObject.reload();
                return true;
            }
        } catch (error) {
            console.warn('NotebookLM Source Management: Failed to reload after stale save.', error);
        }
        return false;
    }

    function restoreRecoverySnapshotFromUi() {
        const recovery = readRecoverySnapshot();
        if (!recovery?.snapshot) {
            showToast(getMessage('ui_recovery_unavailable'), { variant: 'error' });
            setSaveStatus({ state: 'idle', recoveryAvailable: false, recoveryCreatedAt: '' });
            return false;
        }

        if (!applyPersistableSnapshotToRuntime(recovery.snapshot)) {
            showToast(getMessage('ui_recovery_restore_failed'), { variant: 'error' });
            return false;
        }

        closeSourceActionMenu();
        render();
        saveState({ immediate: true, critical: true, recordUndo: false });
        showToast(getMessage('ui_recovery_restored'), { variant: 'success' });
        return true;
    }

    function dismissRecoverySnapshotFromUi() {
        clearRecoverySnapshot();
        setSaveStatus({
            state: 'idle',
            lastError: '',
            recoveryAvailable: false,
            recoveryCreatedAt: ''
        });
        renderSaveStatus();
        return true;
    }

    function renderSaveStatus(status = null) {
        if (!shadowRoot) return null;
        const container = typeof shadowRoot.getElementById === 'function'
            ? shadowRoot.getElementById('sp-settings-save-status')
            : shadowRoot.querySelector?.('#sp-settings-save-status');
        if (!container) return null;
        const section = typeof shadowRoot.getElementById === 'function'
            ? shadowRoot.getElementById('sp-settings-save-status-section')
            : shadowRoot.querySelector?.('#sp-settings-save-status-section');

        const saveStatus = status || getSaveStatus();
        const stateName = saveStatus?.state || 'idle';
        const messageKey = getSaveStatusMessageKey(stateName);
        const shouldShow = Boolean(messageKey && stateName !== 'idle');

        if (section) {
            section.hidden = !shouldShow;
        }
        container.hidden = !shouldShow;
        container.className = `sp-save-status sp-save-status-${stateName}`;
        if (typeof container.setAttribute === 'function') {
            container.setAttribute('role', stateName === 'failed' || stateName === 'stale' ? 'alert' : 'status');
            container.setAttribute('aria-live', stateName === 'failed' || stateName === 'stale' ? 'assertive' : 'polite');
        }
        clearElementChildren(container);

        if (!shouldShow) return container;

        if (typeof container.appendChild !== 'function') {
            container.textContent = getMessage(messageKey);
            return container;
        }

        const label = document.createElement('span');
        label.className = 'sp-save-status-label';
        label.textContent = getMessage(messageKey);
        container.appendChild(label);

        if (stateName === 'failed' || stateName === 'stale') {
            appendSaveStatusAction(container, 'ui_save_status_retry', retryCurrentSave);
        }
        if (stateName === 'stale') {
            appendSaveStatusAction(container, 'ui_save_status_refresh', refreshForLatestState, 'sp-save-status-action sp-save-status-action-muted');
        }
        if (stateName === 'recovery_available') {
            appendSaveStatusAction(container, 'ui_recovery_restore', restoreRecoverySnapshotFromUi);
            appendSaveStatusAction(container, 'ui_recovery_dismiss', dismissRecoverySnapshotFromUi, 'sp-save-status-action sp-save-status-action-muted');
        }

        return container;
    }

    function getDiagnosticsInfo() {
        const saveStatus = getSaveStatus ? getSaveStatus() : {};
        const recovery = readRecoverySnapshot ? readRecoverySnapshot() : null;
        const importBackup = readImportBackupSnapshot();
        const latestNativeFailure = nativeActionFailureHistory[0] || null;
        return {
            notebookId: projectId || '',
            sourceCount: sourcesByKey.size,
            groupCount: groupsById.size,
            tagCount: tagsById.size,
            sourceViewKind: sourceViewKind || 'unknown',
            sourceViewConfidence: Number(sourceViewConfidence) || 0,
            lastSourceViewChangedAt: lastSourceViewChangedAt || '',
            lastSourceViewTransition: lastSourceViewTransition ? Object.assign({}, lastSourceViewTransition) : null,
            nativeSourceListHidden: Boolean(lastNativeSourceListHidden),
            lastNativeSourceListHiddenAt: lastNativeSourceListHiddenAt || '',
            lastNativeLabelImportSummary: lastNativeLabelImportSummary
                ? Object.assign({}, lastNativeLabelImportSummary, {
                    labels: Array.isArray(lastNativeLabelImportSummary.labels)
                        ? lastNativeLabelImportSummary.labels.map((label) => Object.assign({}, label))
                        : []
                })
                : null,
            saveRevision: saveStatus.lastSaveRevision || getSnapshotSaveRevision(buildPersistableState()),
            savedAt: saveStatus.lastSavedAt || '',
            saveStatus: saveStatus.state || 'idle',
            lastSaveError: saveStatus.lastError || '',
            storageUsageBytes: Number(saveStatus.storageUsageBytes) || 0,
            storageQuotaBytes: Number(saveStatus.storageQuotaBytes) || 0,
            storageUsageRatio: Number(saveStatus.storageUsageRatio) || 0,
            storageWarning: Boolean(saveStatus.storageWarning),
            lastStorageError: saveStatus.lastStorageError || '',
            lastStaleLocalRevision: Number(saveStatus.lastStaleLocalRevision) || 0,
            lastStaleRemoteRevision: Number(saveStatus.lastStaleRemoteRevision) || 0,
            lastStaleDetectedAt: saveStatus.lastStaleDetectedAt || '',
            historyEntryCount: Array.isArray(stateHistoryEntries)
                ? stateHistoryEntries.length
                : Number(saveStatus.historyEntryCount) || 0,
            recoveryAvailable: Boolean(recovery),
            recoveryCreatedAt: recovery?.createdAt || '',
            recoveryBaseRevision: Number(recovery?.baseRevision) || 0,
            importBackupAvailable: Boolean(importBackup),
            importBackupCreatedAt: importBackup?.createdAt || '',
            importBackupCounts: importBackup ? {
                sourceCount: Number(importBackup.sourceCount) || 0,
                groupCount: Number(importBackup.groupCount) || 0,
                tagCount: Number(importBackup.tagCount) || 0
            } : null,
            lastNativeActionFailure: latestNativeFailure,
            nativeActionFailureHistory: nativeActionFailureHistory.map((failure) => Object.assign({}, failure))
        };
    }

    function getDiagnosticsText() {
        return JSON.stringify(getDiagnosticsInfo(), null, 2);
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
            scrollObserver.observe(nextObservedArea, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: [
                    'aria-label',
                    'title',
                    'alt',
                    'data-source-id',
                    'data-document-id',
                    'data-doc-id',
                    'data-file-id',
                    'data-drive-id',
                    'data-resource-id',
                    'data-testid',
                    'href',
                    'aria-expanded',
                    'class',
                    'hidden',
                    'style'
                ]
            });
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
    const NON_BLOCKING_BATCH_DELETE_FAILURE_REASONS = new Set([
        'source_missing',
        'source_unavailable'
    ]);

    function shouldStopBatchDeleteAfterFailure(reason) {
        return !NON_BLOCKING_BATCH_DELETE_FAILURE_REASONS.has(reason || '');
    }

    async function executeBatchDelete() {
        if (pendingBatchKeys.size === 0 || isDeletingSources) return;
        isDeletingSources = true;
        render();

        const keysToDelete = Array.from(pendingBatchKeys);
        const total = keysToDelete.length;
        let deletedCount = 0;
        let failedCount = 0;
        let firstFailureReason = '';

        try {
            showToast(getMessage('ui_deleting_count', [total.toString()]), { variant: 'info' });

            for (const key of keysToDelete) {
                try {
                    const result = await deleteNativeSource(key);
                    if (result && result.deleted) {
                        deletedCount++;
                    } else {
                        const reason = result?.reason || 'native_delete_error';
                        failedCount++;
                        if (!firstFailureReason) {
                            firstFailureReason = reason;
                        }
                        if (shouldStopBatchDeleteAfterFailure(reason)) {
                            break;
                        }
                    }
                } catch (error) {
                    failedCount++;
                    if (!firstFailureReason) {
                        firstFailureReason = 'native_delete_error';
                    }
                    console.error('NotebookLM Source Management: Error during automated deletion step', error);
                }
            }
        } finally {
            isDeletingSources = false;
            pendingBatchKeys.clear();
            state.isBatchMode = false;
            closeSourceActionMenu();

            try {
                if (deletedCount > 0) {
                    showToast(getMessage('ui_deleted_toast', [deletedCount.toString()]), { variant: 'success' });
                }
                if (failedCount > 0) {
                    showToast(getNativeActionFailureMessage('delete', firstFailureReason), { variant: 'error' });
                }
            } finally {
                render(); // The heartbeat observer will catch the actual DOM removals eventually
            }
        }
    }

    const IMPORT_EXPORT_FORMAT = 'notebooklm-source-management-config';

    function getSessionStorageObject() {
        const storage = globalThis.sessionStorage || window?.sessionStorage;
        return storage && typeof storage.getItem === 'function' ? storage : null;
    }

    function getImportBackupKey(targetProjectId = projectId) {
        return targetProjectId ? `sourcesPlusImportBackup_${targetProjectId}` : '';
    }

    function getPersistableStateCounts(snapshot) {
        return {
            sourceCount: Object.keys(snapshot?.sourceStateById || {}).length,
            groupCount: Object.keys(snapshot?.groupsById || {}).length,
            tagCount: Object.keys(snapshot?.tagsById || {}).length
        };
    }

    function getSourceRepairReport(snapshot = buildPersistableState()) {
        const sourceLookup = buildSourceLookup(Array.from(sourcesByKey.values()));
        return buildSourceMatchReport(snapshot, sourceLookup);
    }

    function getSourceRepairOptions() {
        return Array.from(sourcesByKey.values()).map((source) => ({
            key: source.key,
            title: source.title || source.normalizedTitle || source.key
        }));
    }

    function applySourceRepairRemaps(remaps) {
        const sourceRemaps = remaps instanceof Map
            ? remaps
            : new Map(Object.entries(remaps || {}).filter(([, value]) => Boolean(value)));
        if (sourceRemaps.size === 0) {
            showToast(getMessage('ui_source_repair_no_selection'), { variant: 'info' });
            return Promise.resolve(false);
        }

        const currentSnapshot = cloneSerializableData(buildPersistableState());
        const repairedSnapshot = applySourceRemapsToSnapshot(currentSnapshot, sourceRemaps);
        return Promise.resolve(appendStateHistorySnapshot(currentSnapshot, 'before_source_repair'))
            .then(() => {
                if (!applyPersistableSnapshotToRuntime(repairedSnapshot)) {
                    showToast(getMessage('ui_source_repair_failed'), { variant: 'error' });
                    return false;
                }

                closeSourceActionMenu();
                render();
                return Promise.resolve(saveState({ immediate: true, critical: true, recordUndo: false }))
                    .then((result) => {
                        if (result && result.ok === false) {
                            showToast(getMessage('ui_source_repair_failed'), { variant: 'error' });
                            return false;
                        }
                        return loadStateHistory().then(() => {
                            showToast(getMessage('ui_source_repair_applied'), { variant: 'success' });
                            return true;
                        });
                    });
            })
            .catch((error) => {
                console.warn('NotebookLM Source Management: Source repair failed:', error);
                showToast(getMessage('ui_source_repair_failed'), { variant: 'error' });
                return false;
            });
    }

    function writeImportBackupSnapshot(reason = 'before_import') {
        const storage = getSessionStorageObject();
        const key = getImportBackupKey();
        if (!storage || !key) return null;

        const snapshot = cloneSerializableData(buildPersistableState());
        const payload = Object.assign({
            snapshot,
            createdAt: new Date().toISOString(),
            reason
        }, getPersistableStateCounts(snapshot));

        try {
            storage.setItem(key, JSON.stringify(payload));
            return payload;
        } catch (error) {
            console.warn('NotebookLM Source Management: Import backup write failed:', error);
            return null;
        }
    }

    function readImportBackupSnapshot(targetProjectId = projectId) {
        const storage = getSessionStorageObject();
        const key = getImportBackupKey(targetProjectId);
        if (!storage || !key) return null;

        try {
            const rawValue = storage.getItem(key);
            if (!rawValue) return null;
            const parsed = JSON.parse(rawValue);
            if (!parsed || typeof parsed !== 'object' || !parsed.snapshot) return null;
            return parsed;
        } catch (error) {
            console.warn('NotebookLM Source Management: Import backup read failed:', error);
            return null;
        }
    }

    function clearImportBackupSnapshot(targetProjectId = projectId) {
        const storage = getSessionStorageObject();
        const key = getImportBackupKey(targetProjectId);
        if (!storage || !key) return false;

        try {
            storage.removeItem(key);
            return true;
        } catch (error) {
            console.warn('NotebookLM Source Management: Import backup clear failed:', error);
            return false;
        }
    }

    function restoreImportBackupSnapshotFromUi() {
        const backup = readImportBackupSnapshot();
        if (!backup?.snapshot) {
            showToast(getMessage('ui_settings_import_backup_unavailable'), { variant: 'error' });
            return false;
        }

        if (!applyPersistableSnapshotToRuntime(backup.snapshot)) {
            showToast(getMessage('ui_settings_import_backup_restore_failed'), { variant: 'error' });
            return false;
        }

        closeSourceActionMenu();
        render();
        return Promise.resolve(saveState({ immediate: true, critical: true, recordUndo: false }))
            .then((result) => {
                if (result && result.ok === false) {
                    showToast(getMessage('ui_settings_import_backup_restore_failed'), { variant: 'error' });
                    return false;
                }
                clearImportBackupSnapshot();
                showToast(getMessage('ui_settings_import_backup_restored'), { variant: 'success' });
                return true;
            })
            .catch((error) => {
                console.warn('NotebookLM Source Management: Import backup restore save failed:', error);
                showToast(getMessage('ui_settings_import_backup_restore_failed'), { variant: 'error' });
                return false;
            });
    }

    function restoreStateHistoryEntryFromUi(historyEntryId) {
        const entry = stateHistoryEntries.find((item) => item?.id === historyEntryId);
        if (!entry?.snapshot) {
            showToast(getMessage('ui_history_restore_failed'), { variant: 'error' });
            return Promise.resolve(false);
        }

        const currentSnapshot = cloneSerializableData(buildPersistableState());
        return Promise.resolve(appendStateHistorySnapshot(currentSnapshot, 'before_history_restore'))
            .then(() => {
                if (!applyPersistableSnapshotToRuntime(entry.snapshot)) {
                    showToast(getMessage('ui_history_restore_failed'), { variant: 'error' });
                    return false;
                }

                closeSourceActionMenu();
                render();
                return Promise.resolve(saveState({ immediate: true, critical: true, recordUndo: false }))
                    .then((result) => {
                        if (result && result.ok === false) {
                            showToast(getMessage('ui_history_restore_failed'), { variant: 'error' });
                            return false;
                        }
                        return loadStateHistory().then(() => {
                            showToast(getMessage('ui_history_restored'), { variant: 'success' });
                            return true;
                        });
                    });
            })
            .catch((error) => {
                console.warn('NotebookLM Source Management: History restore failed:', error);
                showToast(getMessage('ui_history_restore_failed'), { variant: 'error' });
                return false;
            });
    }

    function createExportConfigPayload() {
        const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
        return {
            format: IMPORT_EXPORT_FORMAT,
            formatVersion: 1,
            extensionVersion: manifest.version || '',
            exportedAt: new Date().toISOString(),
            data: buildPersistableState()
        };
    }

    function getExportConfigText() {
        return JSON.stringify(createExportConfigPayload(), null, 2);
    }

    function unwrapImportConfigPayload(parsedConfig) {
        if (!parsedConfig || typeof parsedConfig !== 'object') return null;
        if (parsedConfig.format === IMPORT_EXPORT_FORMAT && parsedConfig.data) {
            return parsedConfig.data;
        }
        return parsedConfig;
    }

    function parseImportConfigText(text) {
        const rawText = String(text || '').trim();
        if (!rawText) {
            return { ok: false, reason: 'empty' };
        }
        if (getImportConfigTextByteLength(rawText) > getImportConfigLimit(IMPORT_CONFIG_MAX_FILE_BYTES, 2 * 1024 * 1024)) {
            return { ok: false, reason: 'invalid' };
        }

        try {
            const parsedConfig = JSON.parse(rawText);
            const normalizedState = normalizeLoadedState(unwrapImportConfigPayload(parsedConfig));
            if (!normalizedState || !hasPersistableManagerState(normalizedState)) {
                return { ok: false, reason: 'invalid' };
            }
            if (getImportStateValidationError(normalizedState)) {
                return { ok: false, reason: 'invalid' };
            }
            return { ok: true, state: normalizedState };
        } catch (error) {
            return { ok: false, reason: 'invalid' };
        }
    }

    function getImportConfigLimit(value, fallback) {
        const normalized = Number(value);
        return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
    }

    function getImportConfigTextByteLength(text) {
        if (typeof TextEncoder === 'function') {
            return new TextEncoder().encode(String(text || '')).length;
        }
        return String(text || '').length;
    }

    function getImportStateValidationError(importState) {
        const groupsById = importState && typeof importState.groupsById === 'object' ? importState.groupsById : {};
        const groupEntries = Object.entries(groupsById);
        const tagCount = Object.keys(importState.tagsById || {}).length;
        const sourceRefs = new Set(Object.keys(importState.sourceStateById || {}));
        let childRefCount = 0;

        if (groupEntries.length > getImportConfigLimit(IMPORT_CONFIG_MAX_GROUPS, 1000)) return 'too_large';
        if (tagCount > getImportConfigLimit(IMPORT_CONFIG_MAX_TAGS, 500)) return 'too_large';

        for (const [, group] of groupEntries) {
            const children = Array.isArray(group?.children) ? group.children : [];
            childRefCount += children.length;
            if (childRefCount > getImportConfigLimit(IMPORT_CONFIG_MAX_CHILD_REFS, 10000)) return 'too_large';
            children.forEach((child) => {
                if (child?.type === 'source' && child.key) sourceRefs.add(child.key);
            });
        }

        (Array.isArray(importState.ungrouped) ? importState.ungrouped : []).forEach((sourceKey) => {
            if (sourceKey) sourceRefs.add(sourceKey);
        });
        if (sourceRefs.size > getImportConfigLimit(IMPORT_CONFIG_MAX_SOURCES, 5000)) return 'too_large';

        return getImportGroupTreeValidationError(groupsById);
    }

    function getImportGroupTreeValidationError(groupsById) {
        const maxDepth = getImportConfigLimit(IMPORT_CONFIG_MAX_TREE_DEPTH, 50);
        const visitStateById = new Map();
        const groupIds = Object.keys(groupsById || {});

        for (const rootGroupId of groupIds) {
            if (visitStateById.get(rootGroupId) === 'done') continue;
            const stack = [{ groupId: rootGroupId, childIndex: 0, depth: 1 }];

            while (stack.length > 0) {
                const frame = stack[stack.length - 1];
                if (frame.depth > maxDepth) return 'too_deep';
                if (!visitStateById.has(frame.groupId)) {
                    visitStateById.set(frame.groupId, 'visiting');
                }

                const group = groupsById[frame.groupId];
                const children = Array.isArray(group?.children) ? group.children : [];
                let advanced = false;
                while (frame.childIndex < children.length) {
                    const child = children[frame.childIndex];
                    frame.childIndex += 1;
                    if (child?.type !== 'group' || !child.id || !groupsById[child.id]) continue;
                    const childVisitState = visitStateById.get(child.id);
                    if (child.id === frame.groupId || childVisitState === 'visiting') return 'cycle';
                    if (childVisitState === 'done') continue;
                    stack.push({ groupId: child.id, childIndex: 0, depth: frame.depth + 1 });
                    advanced = true;
                    break;
                }

                if (!advanced) {
                    visitStateById.set(frame.groupId, 'done');
                    stack.pop();
                }
            }
        }

        return null;
    }

    function collectImportSourceRefs(importState) {
        const refs = new Set();
        const groupsById = importState.groupsById || {};
        const visitedGroups = new Set();
        const visitGroup = (groupId) => {
            if (!groupId || visitedGroups.has(groupId)) return;
            visitedGroups.add(groupId);
            const group = groupsById[groupId];
            (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                if (child?.type === 'source' && child.key) {
                    refs.add(child.key);
                    return;
                }
                if (child?.type === 'group' && child.id) {
                    visitGroup(child.id);
                }
            });
        };

        Object.keys(groupsById).forEach((groupId) => {
            visitGroup(groupId);
        });
        (Array.isArray(importState.ungrouped) ? importState.ungrouped : []).forEach((sourceKey) => {
            if (sourceKey) refs.add(sourceKey);
        });
        Object.keys(importState.sourceStateById || {}).forEach((sourceKey) => refs.add(sourceKey));
        return refs;
    }

    function previewImportConfig(text) {
        const parsed = parseImportConfigText(text);
        if (!parsed.ok) return parsed;

        const sourceLookup = buildSourceLookup(Array.from(sourcesByKey.values()));
        const sourceRefs = collectImportSourceRefs(parsed.state);
        const matchedSourceKeys = new Set();
        const matchedSourceDetails = [];
        const unmatchedSourceDetails = [];
        sourceRefs.forEach((storedKey) => {
            const sourceRecord = parsed.state.sourceStateById?.[storedKey] || null;
            const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
            const detail = {
                storedKey,
                resolvedKey: resolvedKey || '',
                title: sourceRecord?.title || sourceRecord?.normalizedTitle || storedKey
            };
            if (resolvedKey) {
                matchedSourceKeys.add(resolvedKey);
                matchedSourceDetails.push(detail);
            } else {
                unmatchedSourceDetails.push(detail);
            }
        });

        return {
            ok: true,
            state: parsed.state,
            totalSources: sourceRefs.size,
            matchedSources: matchedSourceKeys.size,
            matchedSourceDetails,
            unmatchedSourceDetails,
            groupCount: Object.keys(parsed.state.groupsById || {}).length,
            tagCount: Object.keys(parsed.state.tagsById || {}).length
        };
    }

    async function applyImportConfig(text) {
        const preview = previewImportConfig(text);
        if (!preview.ok) {
            showToast(getMessage(preview.reason === 'empty'
                ? 'ui_settings_import_empty'
                : 'ui_settings_import_invalid'), { variant: 'error' });
            return preview;
        }

        const importedState = preview.state;
        await appendStateHistorySnapshot(buildPersistableState(), 'before_import');
        writeImportBackupSnapshot();
        if (importedState.customHeight != null) {
            customHeight = importedState.customHeight;
            const container = shadowRoot?.querySelector?.('.sp-container');
            if (container) container.style.height = `${customHeight}px`;
        }

        const restoreResult = restoreInitialLoadedState(importedState);
        if (restoreResult.deferred) {
            render();
            showToast(getMessage('ui_settings_import_deferred'), { variant: 'info' });
            return { ...preview, ok: false, reason: 'deferred' };
        }

        render();
        const saveResult = await saveState({ immediate: true, critical: true });
        if (saveResult && saveResult.ok === false) {
            return { ...preview, ok: false, reason: saveResult.reason || 'save_failed' };
        }
        showToast(getMessage('ui_settings_imported_toast'), {
            variant: 'success',
            actionLabel: getMessage('ui_settings_restore_import_backup'),
            onAction: restoreImportBackupSnapshotFromUi
        });
        return preview;
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

        lastNativeSourceListHidden = Boolean(hidden);
        lastNativeSourceListHiddenAt = new Date().toISOString();
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
        sourceViewKind = 'unknown';
        sourceViewConfidence = 0;
        sourceViewInfo = null;
        lastSourceViewChangedAt = '';
        lastSourceViewTransition = null;
        lastNativeSourceListHidden = false;
        lastNativeSourceListHiddenAt = '';
        lastNativeLabelImportSummary = null;
        resetUndoHistoryBaseline();
    }

    function removeStaleManagerRoots(keepRoot = extensionHost) {
        if (!document || typeof document.querySelectorAll !== 'function') return;
        Array.from(document.querySelectorAll('#sources-plus-root')).forEach((root) => {
            if (!root || root === keepRoot) return;
            if (typeof root.remove === 'function') {
                root.remove();
            }
        });
    }

    function cleanupManagerResources() {
        clearScheduledPanelLifecycleSync();
        clearNativeRenameWatcher();
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
        document.removeEventListener('keydown', handleUndoKeydown, true);
        document.removeEventListener('click', handleDocumentOutsideClick, true);
        if (shadowRoot && typeof shadowRoot.removeEventListener === 'function') {
            shadowRoot.removeEventListener('scroll', handleSourceActionMenuViewportChange, true);
        }
        if (shadowRoot && shadowRoot.host) {
            if (typeof shadowRoot.host.remove === 'function') {
                shadowRoot.host.remove();
            }
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
            saveState({ recordUndo: false });
        }
        resetUndoHistoryBaseline();
    }

    function syncRouteWithCurrentLocation() {
        const latestUrl = getCurrentLocationHref();
        const latestProjectId = getProjectId();

        if (latestUrl !== currentUrl) {
            currentUrl = latestUrl;
        }

        if (latestProjectId === projectId) {
            return false;
        }

        handleRouteChanged();
        return true;
    }

    function syncManagerWithPanelLifecycle() {
        if (syncRouteWithCurrentLocation()) {
            return;
        }

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
            const previousSourceViewKind = sourceViewKind || 'unknown';
            const currentSourceViewInfo = getSourceViewInfo(sourcePanel);
            setNativeSourceListHidden(currentSourceViewInfo.kind === 'list');
            attachScrollObserverToPanel(sourcePanel);
            applySourcePanelSurfaceColor(extensionHost, sourcePanel);
            if (panelState.state === 'ready') {
                completeInitialStateLoad();
                managerStatusReason = 'ready';
            } else {
                managerStatusReason = 'manager_not_ready';
            }
            if (currentSourceViewInfo.kind !== previousSourceViewKind) {
                if (!isAwaitingInitialStateLoad && panelState.state === 'ready') {
                    scanAndSyncSources({}, false);
                }
                render();
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
        currentUrl = getCurrentLocationHref();
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

        removeStaleManagerRoots();
        if (isManagerAttachedToPanel(sourcePanel)) {
            attachScrollObserverToPanel(sourcePanel);
            applySourcePanelSurfaceColor(extensionHost, sourcePanel);
            completeInitialStateLoad();
            managerStatusReason = 'ready';
            return;
        }

        if (extensionHost || shadowRoot || scrollObserver) {
            cleanupManagerResources();
            removeStaleManagerRoots();
        }

        activeManagerInstanceToken += 1;
        activeLoadStateRequestId = null;
        const managerInstanceToken = activeManagerInstanceToken;

        bindPanelLifecycleHooks(sourcePanel);

        const extensionRoot = document.createElement('div');
        extensionRoot.id = 'sources-plus-root';
        applySourcePanelSurfaceColor(extensionRoot, sourcePanel);
        const initialSourceViewInfo = getSourceViewInfo(sourcePanel);
        extensionHost = extensionRoot;
        shadowRoot = extensionRoot.attachShadow({ mode: 'open' });
        managerStatusReason = 'manager_not_ready';
        const style = document.createElement('style');
        style.textContent = contentStyleText;
        shadowRoot.appendChild(style);

        const containerHtml = createManagerShell(el, chrome);
        shadowRoot.appendChild(containerHtml);
        renderSaveStatus();

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
            const minHeight = container.classList?.contains('is-native-label-view') ? 48 : 150;
            const newHeight = Math.max(minHeight, startHeight + (e.clientY - startY));
            container.style.height = `${newHeight}px`;
        }

        function stopDrag() {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
            container.style.userSelect = '';
            customHeight = parseInt(container.style.height, 10);
            saveState({ immediate: true, critical: true }); // Save the new height immediately
        }

        shadowRoot.getElementById('sp-settings-btn').addEventListener('click', () => {
            loadStateHistory().finally(() => renderSettingsModal());
        });
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
        document.addEventListener('keydown', handleUndoKeydown, true);
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
            setNativeSourceListHidden(initialSourceViewInfo.kind === 'list');
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
                saveState({ immediate: true, critical: true, recordUndo: false });
                resetUndoHistoryBaseline();
                return;
            }

            isAwaitingInitialStateLoad = true;
            loadState((loadedState) => {
                applyLoadedStateToManager(loadedState);
                completeInitialStateLoad();
                resetUndoHistoryBaseline();
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
    const onRouteChange = () => {
        const nextUrl = getCurrentLocationHref();
        if (nextUrl !== currentUrl) {
            currentUrl = nextUrl;
            handleRouteChanged();
        }
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const patchedPushState = function (...args) {
        originalPushState.apply(this, args);
        onRouteChange();
    };
    const patchedReplaceState = function (...args) {
        originalReplaceState.apply(this, args);
        onRouteChange();
    };
    history.pushState = patchedPushState;
    history.replaceState = patchedReplaceState;
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);

    // Observe a stable root so route-driven NotebookLM body swaps still trigger recovery.
    panelLifecycleObserver = new MutationObserver(() => {
        onRouteChange();
        schedulePanelLifecycleSync();
    });
    panelLifecycleObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'data-testid']
    });

    function destroyContentInstance() {
        if (contentInstance.destroyed) return;
        contentInstance.destroyed = true;

        try {
            teardown();
        } catch (error) {
            console.warn('NotebookLM Source Management: Content teardown failed.', error);
        }

        try {
            if (
                chrome.runtime &&
                chrome.runtime.onMessage &&
                typeof chrome.runtime.onMessage.removeListener === 'function'
            ) {
                chrome.runtime.onMessage.removeListener(handleManagerMessage);
            }
        } catch (error) {
            console.warn('NotebookLM Source Management: Runtime listener cleanup failed.', error);
        }

        if (history.pushState === patchedPushState) {
            history.pushState = originalPushState;
        }
        if (history.replaceState === patchedReplaceState) {
            history.replaceState = originalReplaceState;
        }
        window.removeEventListener('popstate', onRouteChange);
        window.removeEventListener('hashchange', onRouteChange);

        if (panelLifecycleObserver) {
            panelLifecycleObserver.disconnect();
            panelLifecycleObserver = null;
        }
        if (globalThis[CONTENT_INSTANCE_KEY] === contentInstance) {
            delete globalThis[CONTENT_INSTANCE_KEY];
        }
    }

    contentInstance.destroy = destroyContentInstance;

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
            getTagColorPresets,
            getSourceTagIds,
            groupHasRenderableDescendant,
            handleSourceIconImageError,
            bindSourceIconFallbackDelegation,
            hasActiveRenderFilters,
            isSourceEffectivelyEnabled,
            normalizeTagColor,
            normalizeLoadedState,
            processClickQueue,
            resolveStoredSourceKeyWithReason,
            buildSourceMatchReport,
            applySourceRemapsToSnapshot,
            buildSingleSourcePositionalRemap,
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
            executeBatchMoveToUngrouped,
            canMoveSourceToUngrouped,
            moveSourceToUngrouped,
            deleteNativeSource,
            openNativeSourceDetails,
            createExportConfigPayload,
            getExportConfigText,
            parseImportConfigText,
            previewImportConfig,
            applyImportConfig,
            getImportBackupKey,
            getSourceRepairReport,
            getSourceRepairOptions,
            applySourceRepairRemaps,
            getStateHistoryKey,
            getStateHistoryEntries,
            loadStateHistory,
            appendStateHistorySnapshot,
            restoreStateHistoryEntryFromUi,
            writeImportBackupSnapshot,
            readImportBackupSnapshot,
            clearImportBackupSnapshot,
            restoreImportBackupSnapshotFromUi,
            renderSettingsModal,
            undoLastOperation,
            executeMoveToFolder,
            executeBatchTagUpdate,
            renderBatchTagModal,
            collectMoveFolderOptions,
            loadState,
            pendingBatchKeys,
            sourcesByKey,
            state,
            DEPS,
            saveState,
            enqueueStateSave,
            waitForPendingStateSave,
            preparePersistableSnapshot,
            prepareRuntimeSaveSnapshot,
            getSnapshotSaveRevision,
            getSaveStatus,
            setSaveStatus,
            getRecoveryKey,
            writeRecoverySnapshot,
            readRecoverySnapshot,
            clearRecoverySnapshot,
            detectRecoverySnapshotAvailability,
            flushPendingStateSave,
            renderSaveStatus,
            restoreRecoverySnapshotFromUi,
            dismissRecoverySnapshotFromUi,
            getDiagnosticsInfo,
            getDiagnosticsText,
            getManagerStatus,
            focusManagerPanel,
            handleAddNewGroup,
            handleManagerMessage,
            handlePageLifecyclePersistence,
            handleRouteChanged,
            hasPersistedSourceRefs,
            restorePersistedSnapshotWithoutDom,
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
            getSourceViewInfo,
            detectSourceView,
            getSourceEntries,
            getNativeLabelImportPreview,
            applyNativeLabelImport,
            applyNativeLabelImportFromUi,
            toggleSourceActionMenu,
            closeSourceActionMenu,
            handleSourceActionSelection,
            getNativeDialogMetadata,
            getNativeDialogFingerprint,
            isNativeDeleteConfirmDialog,
            findNativeDeleteConfirmDialogs,
            getNativeDeleteMenuItemScore,
            getNativeRenameMenuItemScore,
            scoreNativeMenuItemAction,
            findNativeActionMenuItem,
            findNativeDeleteMenuItem,
            findNativeRenameMenuItem,
            findNativeDeleteConfirmButton,
            findNativeSourceDetailsMenuItem,
            triggerNativeSourceDetailsDirectWithResult,
            triggerNativeSourceDetailsViaNativeMenuWithResult,
            triggerNativeSourceRenameWithResult,
            getNativeActionFailureMessage,
            _createBatchCountMessageChildrenForTest: createBatchCountMessageChildren,
            _collectBatchCountSnapshotForTest: collectBatchCountSnapshot,
            _animateBatchCountElementForTest: animateBatchCountElement,
            _animateBatchCountChangesForTest: animateBatchCountChanges,
            _clearSpotlightSurfaceForTest: clearSpotlightSurface,
            _updateSpotlightSurfaceFromPointerForTest: updateSpotlightSurfaceFromPointer,
            _handleSpotlightPointerMoveForTest: handleSpotlightPointerMove,
            _handleSpotlightPointerLeaveForTest: handleSpotlightPointerLeave,
            _bindSpotlightPointerTrackingForTest: bindSpotlightPointerTracking,
            _getNormalizedSearchQueryForTest: getNormalizedSearchQuery,
            _parseSearchQueryForTest: parseSearchQuery,
            _parseRenderSearchQueryForTest: parseRenderSearchQuery,
            _sourceMatchesSearchQueryForTest: sourceMatchesSearchQuery,
            _createHighlightedTextChildrenForTest: createHighlightedTextChildren,
            _getSearchHighlightTermsForTest: getSearchHighlightTerms,
            _collectSearchExpandedGroupIdsForTest: collectSearchExpandedGroupIds,
            _clearDragFeedbackForTest: clearDragFeedback,
            _getDropIntentForTest: getDropIntent,
            _getSourceTreePositionForTest: getSourceTreePosition,
            _getGroupTreePositionForTest: getGroupTreePosition,
            _isNoopTreeMoveForTest: isNoopTreeMove,
            _getRenderedSourceActionMenuItemsForTest: getRenderedSourceActionMenuItems,
            _findRenderedSourceActionMenuForTest: findRenderedSourceActionMenu,
            _focusSourceActionMenuItemForTest: focusSourceActionMenuItem,
            _focusSourceActionMenuButtonForTest: focusSourceActionMenuButton,
            _handleSourceActionMenuKeydownForTest: handleSourceActionMenuKeydown,
            _applySourcePanelSurfaceColorForTest: applySourcePanelSurfaceColor,
            _queryNativeDialogsForTest: queryNativeDialogs,
            _waitForNativeDialogsForTest: waitForNativeDialogs,
            _getPersistableStateSignatureForTest: getPersistableStateSignature,
            _shouldSaveAfterMutationSyncForTest: shouldSaveAfterMutationSync,
            _getMutationRelevanceForTest: getMutationRelevance,
            _handleDomChangesForTest: handleDomChanges,
            _startNativeRenameWatcherForTest: startNativeRenameWatcher,
            _runNativeRenameSyncPassForTest: runNativeRenameSyncPass,
            _clearNativeRenameWatcherForTest: clearNativeRenameWatcher,
            _getModalFocusableElementsForTest: getModalFocusableElements,
            _focusModalInitialElementForTest: focusModalInitialElement,
            _handleModalKeyboardEventForTest: handleModalKeyboardEvent,
            _bindModalKeyboardNavigationForTest: bindModalKeyboardNavigation,
            _rememberModalFocusRestoreTargetForTest: rememberModalFocusRestoreTarget,
            _restoreModalFocusForTest: restoreModalFocus,
            _closeManagedModalForTest: closeManagedModal,
            _prepareModalOpenForTest: prepareModalOpen,
            _createModalItemStaggerStyleForTest: createModalItemStaggerStyle,
            _closeBatchTagModalForTest: closeBatchTagModal,
            _getModalTagColorPresetsForTest: () => getModalTagColorPresets(),
            _getClickQueueLength: () => clickQueue.length,
            _getIsDeletingSources: () => isDeletingSources,
            _getIsSyncingState: () => isSyncingState,
            _showToastForTest: showToast,
            _showUndoableToastForTest: showUndoableToast,
            _getToastQueueLengthForTest: () => toastQueue.length,
            _getActiveToastItemForTest: () => activeToastItem,
            _hideActiveToastForTest: hideActiveToast,
            _getUndoStackLengthForTest: () => undoStack.length,
            _resetUndoHistoryBaselineForTest: resetUndoHistoryBaseline,
            _setUndoBaselineSnapshotForTest: setUndoBaselineSnapshot,
            _handleUndoKeydownForTest: handleUndoKeydown,
            _isEditableUndoTargetForTest: isEditableUndoTarget,
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
            _destroyContentInstanceForTest: destroyContentInstance,
            _flushPendingInitialLoadedStateForTest: flushPendingInitialLoadedState,
            _debouncedScanAndSyncForTest: (options) => {
                debouncedScanAndSync(options);
                if (typeof debouncedScanAndSync.flush === 'function') {
                    debouncedScanAndSync.flush();
                }
            },
            _setCustomHeight: (val) => { customHeight = val; },
            _setManagerStatusReason: (val) => { managerStatusReason = val; },
            _setProjectId: (val) => {
                projectId = val;
                if (window.location && typeof window.location === 'object') {
                    window.location.pathname = typeof val === 'string' && val
                        ? `/notebook/${val}`
                        : '/';
                }
                currentUrl = getCurrentLocationHref();
            },
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
            _triggerNativeSourceDetailsDirectResultForTest: (sourceKey) => triggerNativeSourceDetailsDirectWithResult(sourceKey),
            _triggerNativeSourceDetailsViaNativeMenuForTest: (sourceKey) => triggerNativeSourceDetailsViaNativeMenu(sourceKey),
            _triggerNativeSourceDetailsViaNativeMenuResultForTest: (sourceKey) => triggerNativeSourceDetailsViaNativeMenuWithResult(sourceKey),
            _triggerNativeSourceRenameForTest: (sourceKey) => triggerNativeSourceRename(sourceKey),
            _triggerNativeSourceRenameResultForTest: (sourceKey) => triggerNativeSourceRenameWithResult(sourceKey),
            _setSourceActionInvokerForTest: (name, fn) => {
                setSourceActionInvoker(name, fn);
            },
            _handleInteractionForTest: handleInteraction,
            _handleDropForTest: handleDrop,
            _handleDragEndForTest: handleDragEnd,
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
                toastQueue.length = 0;
                activeToastItem = null;
                clearToastTimeout();
                isDeletingSources = false;
                nativeActionFailureHistory = [];
                if (runtimeContext.recentNativeDeletedSourceKeys instanceof Set) {
                    runtimeContext.recentNativeDeletedSourceKeys.clear();
                }
                groupsById.clear();
                sourcesByKey.clear();
                tagsById.clear();
                sourceTagsById.clear();
                parentMap.clear();
                customHeight = null;
                projectId = null;
                currentUrl = getCurrentLocationHref();
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
                sourceViewKind = 'unknown';
                sourceViewConfidence = 0;
                sourceViewInfo = null;
                lastSourceViewChangedAt = '';
                lastSourceViewTransition = null;
                lastNativeLabelImportSummary = null;
                isExtensionEnabled = true;
                setNativeSourceListHidden(false);
                if (panelResizeObserver) {
                    panelResizeObserver.disconnect();
                    panelResizeObserver = null;
                }
                activeRouteRecoveryToken = 0;
                routeRecoveryTimeout = null;
                stateHistoryEntries = [];
                state.tagOrder = [];
                state.activeTagId = null;
                activeIsolationGroupId = null;
                isSearchExpanded = false;
                closeSourceActionMenu();
                resetUndoHistoryBaseline();
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
