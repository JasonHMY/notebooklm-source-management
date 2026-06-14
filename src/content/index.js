/**
 * src/content/index.js — content-script assembly hub & runtime owner.
 *
 * Loaded LAST in manifest.json content_scripts[0].js. Every `content-*` helper before it
 * registers a factory on `globalThis.NSM_CREATE_CONTENT_*` (and `module.exports` for Jest);
 * this file pulls those factories and wires the dependency graph by passing deps explicitly
 * (there is no bundler — load order IS dependency order).
 *
 * Responsibilities concentrated here (it is intentionally large; the runtime state below is
 * shared by closure across most of these, which is why it is not split into more modules):
 *  - Runtime state ownership: groupsById / sourcesByKey / parentMap / pendingBatchKeys /
 *    state{groups,ungrouped,isBatchMode,...} / customHeight / sourceView* / save status.
 *    (Getter/setter binding helpers live in content-runtime-state.js.)
 *  - Lifecycle: init / mount / teardown / cleanupManagerResources / route-change recovery /
 *    panel reattach (NotebookLM is an SPA — switch ≠ reload; see content-panel-dom.js).
 *  - Message routing from popup/background: the handler table is built HERE and passed to
 *    content-message-router.js, which only dispatches against it.
 *  - Native source actions + batch handlers, modal orchestration callbacks, the resizer,
 *    command-shortcut handling, and content-error/diagnostics wiring.
 *  - The dependency-assembly graph: createContent*({ ...deps }) calls that build the module
 *    instances and destructure their returned methods into this closure.
 *  - A large test-only surface (`_*ForTest` / `_*`) on the returned object, consumed by the
 *    Jest harness (tests/helpers/content-test-harness.js); these mirror internal closures and
 *    are NOT part of any production contract.
 *
 * CSS lives in THREE places by scope (see CLAUDE.md "Shadow DOM vs global overlay boundary"):
 *  - src/content/styles.css — manifest-injected, hides/overrides native NotebookLM DOM
 *    (must be in the page, not the Shadow DOM).
 *  - NSM_CONTENT_STYLE_TEXT — the Shadow-DOM manager UI (content-style-text.js).
 *  - NSM_GLOBAL_OVERLAY_STYLE_TEXT — global overlays the Shadow DOM can't reach (drag ghost,
 *    native Material menus), same file.
 */
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
    const createContentDeveloperLogger = globalThis.NSM_CREATE_CONTENT_DEVELOPER_LOGGER;
    const createContentRuntimeState = globalThis.NSM_CREATE_CONTENT_RUNTIME_STATE;
    const createContentMessageRouter = globalThis.NSM_CREATE_CONTENT_MESSAGE_ROUTER;
    const createContentToastStatus = globalThis.NSM_CREATE_CONTENT_TOAST_STATUS;
    const createContentToast = globalThis.NSM_CREATE_CONTENT_TOAST;
    const createContentStateApply = globalThis.NSM_CREATE_CONTENT_STATE_APPLY;
    const createContentUndoHistory = globalThis.NSM_CREATE_CONTENT_UNDO_HISTORY;
    const createContentImportExport = globalThis.NSM_CREATE_CONTENT_IMPORT_EXPORT;
    const createContentDiagnostics = globalThis.NSM_CREATE_CONTENT_DIAGNOSTICS;
    const createContentSourceViewSwitchController = globalThis.NSM_CREATE_CONTENT_SOURCE_VIEW_SWITCH_CONTROLLER;
    const createContentNativeLabelImport = globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT;
    const createContentNativeLabelImportController = globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_CONTROLLER;
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
        typeof createContentDeveloperLogger !== 'function' ||
        typeof createContentRuntimeState !== 'function' ||
        typeof createContentMessageRouter !== 'function' ||
        typeof createContentToastStatus !== 'function' ||
        typeof createContentToast !== 'function' ||
        typeof createContentStateApply !== 'function' ||
        typeof createContentUndoHistory !== 'function' ||
        typeof createContentImportExport !== 'function' ||
        typeof createContentDiagnostics !== 'function' ||
        typeof createContentSourceViewSwitchController !== 'function' ||
        typeof createContentNativeLabelImport !== 'function' ||
        typeof createContentNativeLabelImportController !== 'function' ||
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
    // INVARIANT: state.root is a heterogeneous ordered array of root-level entries
    // ({ type:'group', id } | { type:'source', key }) — same shape as group.children.
    // state.ungrouped is string[] of bare source keys in the bottom "Ungrouped" bin.
    // A root source is in state.root XOR state.ungrouped. See CLAUDE.md "State shape".
    let state = {
        root: [], // Heterogeneous root entries: { type:'group', id } | { type:'source', key }.
        ungrouped: [],
        filterQuery: '',
        isBatchMode: false,
        tagOrder: [],
        activeTagId: null,
        activeQuickViewKind: null
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
    let nativeDocumentListenersBound = false;
    let nativeRenameWatcherTimeout = null;
    let stateHistoryEntries = [];
    let sourceViewKind = 'unknown';
    let sourceViewConfidence = 0;
    let sourceViewInfo = null;
    let sourceViewDisplayKind = 'list';
    let lastSourceViewChangedAt = '';
    let lastSourceViewTransition = null;
    let lastNativeSourceListHidden = false;
    let lastNativeSourceListHiddenAt = '';
    let lastNativeLabelImportSummary = null;
    let lastNativeSelectionSyncFailure = null;
    let lastViewSwitchAttempt = null;
    let viewSwitchInProgress = false;
    let lastSkippedStructuralSourceSync = null;
    let pendingStructuralStateRepair = null;
    let lastStructuralStateRepair = null;
    let developerPreferencesLoadPromise = null;
    let welcomeOnboardingPromptedThisSession = false;
    let whatsNewPromptedThisSession = false;
    const NATIVE_ACTION_FAILURE_HISTORY_LIMIT = 5;
    let nativeActionFailureHistory = [];
    const MANAGER_ACTIVE_CLASS = 'sources-plus-manager-active';
    const NATIVE_RENAME_WATCHER_INTERVAL_MS = 250;
    const NATIVE_RENAME_WATCHER_DURATION_MS = 5000;
    const CURRENT_WELCOME_ONBOARDING_VERSION = 1;
    const WHATS_NEW_ENABLED = true;
    const SOURCE_VIEW_LIST = 'list';
    const SOURCE_VIEW_LABEL = 'label';
    const QUICK_VIEW_KINDS = new Set(['ungrouped', 'disabled', 'recent', 'issues']);
    const SOURCE_VIEW_SWITCH_CONFIRM_TIMEOUT_MS = 1600;
    const SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS = 80;
    const NATIVE_LABEL_MENU_RETURN_TIMEOUT_MS = 800;
    const SOURCE_VIEW_SWITCH_PATTERNS = {
        [SOURCE_VIEW_LIST]: [
            /\blist\s*view\b/i,
            /\bview\s*as\s*list\b/i,
            /\bsources?\s*list\b/i,
            /\bsource[_-]?view[_-]?list\b/i,
            /\bview[_-]?list\b/i,
            /\bview_list\b/i,
            /\bformat_list_bulleted\b/i,
            /列表视图|列表|清单/
        ],
        [SOURCE_VIEW_LABEL]: [
            /\blabel\s*view\b/i,
            /\blabels?\s*view\b/i,
            /\bsource[_-]?view[_-]?label\b/i,
            /\bview[_-]?label\b/i,
            /\blabel[_-]?view\b/i,
            /\blabel\s*&\s*categorize\b/i,
            /\bcategor(?:y|ies|ize)\b/i,
            /\borgan(?:ize|ise)\b/i,
            /\b(?:topic|theme|cluster)\b/i,
            /\bgroup\s*view\b/i,
            /\bview\s*by\s*label\b/i,
            /\blabel_auto\b/i,
            /标签视图|标签|分类|分组|整理|组织|归类|按主题|主题/
        ]
    };
    const NATIVE_LABEL_ACTION_MENU_TRIGGER_PATTERN = /\blabel_auto\b|\bauto[-\s]?label\b|\bre[-\s]?label\b|自动.*标签|重新.*标签|按主题/i;
    const NATIVE_LABEL_RETURN_TO_LIST_PATTERN = /\breturn\s+to\s+list\s+view\b|\bback\s+to\s+list\s+view\b|\bswitch\s+to\s+list\s+view\b|\bview\s+as\s+list\b|返回.*列表|回到.*列表|列表视图|volver.*lista|vista\s+de\s+lista/i;

    // --- Helper Functions ---

    const toastStatusModule = createContentToastStatus();
    const {
        normalizeToastOptions,
        getToastDuration,
        getSaveStatusMessageKey,
        clearElementChildren
    } = toastStatusModule;
    const diagnosticsModule = createContentDiagnostics();
    const {
        clonePlainObject,
        cloneNativeLabelImportSummary,
        getContentErrorLogDetails,
        getUnhandledRejectionLogDetails,
        stringifyDiagnostics
    } = diagnosticsModule;
    const sourceViewSwitchController = createContentSourceViewSwitchController({
        SOURCE_VIEW_LIST,
        SOURCE_VIEW_LABEL
    });
    const {
        normalizeSourceViewSwitchTarget,
        isConcreteSourceViewKind,
        getFallbackSourceViewDisplayKind,
        buildSourceDisplayViewInfo,
        buildSourceViewStatusFields,
        createLastViewSwitchAttempt,
        finishViewSwitchAttempt: finishViewSwitchAttemptRecord
    } = sourceViewSwitchController;
    const nativeLabelImportController = createContentNativeLabelImportController({
        normalizeSourceText
    });
    const {
        getComparableNativeImportLabelTitle,
        findReusableNativeLabelImportGroup: findReusableNativeLabelImportGroupRecord,
        resolveNativeLabelPreviewSourceKey: resolveNativeLabelPreviewSourceKeyRecord,
        createNativeLabelPreviewSourceRecord: createNativeLabelPreviewSourceRecordRecord,
        ensureNativeLabelPreviewSources: ensureNativeLabelPreviewSourcesRecord,
        createImportedNativeLabelGroupId: createImportedNativeLabelGroupIdRecord
    } = nativeLabelImportController;

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

    const { runtimeContext, bindRuntimeProperty } = createContentRuntimeState();

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
    bindRuntimeProperty('sourceViewDisplayKind', () => sourceViewDisplayKind, (value) => { sourceViewDisplayKind = value === SOURCE_VIEW_LABEL ? SOURCE_VIEW_LABEL : SOURCE_VIEW_LIST; });
    bindRuntimeProperty('lastSourceViewChangedAt', () => lastSourceViewChangedAt, (value) => { lastSourceViewChangedAt = String(value || ''); });
    bindRuntimeProperty('lastSourceViewTransition', () => lastSourceViewTransition, (value) => { lastSourceViewTransition = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('lastNativeSelectionSyncFailure', () => lastNativeSelectionSyncFailure, (value) => { lastNativeSelectionSyncFailure = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('lastViewSwitchAttempt', () => lastViewSwitchAttempt, (value) => { lastViewSwitchAttempt = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('viewSwitchInProgress', () => viewSwitchInProgress, (value) => { viewSwitchInProgress = Boolean(value); });
    bindRuntimeProperty('lastSkippedStructuralSourceSync', () => lastSkippedStructuralSourceSync, (value) => { lastSkippedStructuralSourceSync = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('pendingStructuralStateRepair', () => pendingStructuralStateRepair, (value) => { pendingStructuralStateRepair = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('lastStructuralStateRepair', () => lastStructuralStateRepair, (value) => { lastStructuralStateRepair = value && typeof value === 'object' ? value : null; });
    bindRuntimeProperty('debouncedPanelLifecycleSync', () => debouncedPanelLifecycleSync);
    bindRuntimeProperty('syncManagerWithPanelLifecycle', () => syncManagerWithPanelLifecycle);

    const toastModule = createContentToast({
        runtime: runtimeContext,
        document,
        setTimeout: (...args) => setTimeout(...args),
        clearTimeout: (...args) => clearTimeout(...args),
        normalizeToastOptions,
        getToastDuration,
        getMessage,
        getUndoStack: () => (undoHistoryModule ? undoHistoryModule.getUndoStack() : []),
        runUndo: () => undoLastOperation()
    });
    const {
        hideActiveToast,
        showToast,
        showUndoableToast
    } = toastModule;

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
        resolveSourcePanelSurfaceColor,
        applySourcePanelSurfaceColor,
        isSourcePanelCollapsed,
        isSourcePanelRenderable,
        isManagerAttachedToPanel,
        clearScheduledPanelLifecycleSync,
        schedulePanelLifecycleSync,
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
        getTagColorPresets,
        getTagStyleVars,
        getTagColorPreviewStyle,
        getSourceTagIds,
        getTagUsageCounts,
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

    const developerLoggerModule = createContentDeveloperLogger({
        chrome,
        getProjectId: () => projectId || '',
        getDiagnosticsInfo: () => getDiagnosticsInfo()
    });
    const {
        developerLog,
        getDeveloperModeEnabled,
        setDeveloperModeEnabled,
        getHoverSpotlightEnabled,
        setHoverSpotlightEnabled,
        getDragMode,
        setDragMode,
        getWelcomeOnboardingSeenVersion,
        setWelcomeOnboardingSeenVersion,
        getWhatsNewSeenVersion,
        setWhatsNewSeenVersion,
        setOnboardingModalSeenVersions,
        getPreferenceUsageState,
        getHistoryRetentionLimit,
        setHistoryRetentionLimit,
        getLanguageOverride,
        setLanguageOverride,
        getCommandShortcuts,
        getCommandShortcut,
        setCommandShortcut,
        getVisibleQuickViewKinds,
        setVisibleQuickViewKinds,
        loadDeveloperPreferences,
        loadDeveloperLogs,
        getDeveloperLogs,
        getLatestDeveloperLogAt,
        getDeveloperLogExportText,
        clearDeveloperLogs
    } = developerLoggerModule;

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
        developerLog: (...args) => developerLog(...args),
        render: (...args) => render(...args),
        sourceMatchesCurrentFilters: (...args) => sourceMatchesCurrentFilters(...args),
        resolveFreshRowEntry: (...args) => resolveFreshRowEntry(...args),
        extractSourceIdentitySnapshot,
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
        onNativeSourceDeleteAccepted: (...args) => handleNativeSourceDeleteAccepted(...args),
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

    function handleNativeSourceDeleteAccepted(sourceKey) {
        if (!sourceKey || !sourcesByKey.has(sourceKey)) return false;

        const source = sourcesByKey.get(sourceKey);
        removeSourceFromTree(sourceKey);
        sourcesByKey.delete(sourceKey);
        sourceTagsById.delete(sourceKey);
        pendingBatchKeys.delete(sourceKey);

        if (runtimeContext.keyByElement instanceof WeakMap && source?.element) {
            runtimeContext.keyByElement.delete(source.element);
        }

        buildParentMap();
        saveState({ immediate: true, critical: true });
        return true;
    }

    const {
        canOpenSourceActionMenu,
        findSourceActionButton,
        getSourceActionMenuItems,
        getSourceActionSubmenuItems,
        getSourceActionMenuPosition,
        getSourceActionSubmenuPosition,
        closeSourceActionMenu,
        dismissSourceActionMenuAndRender,
        toggleSourceActionMenu,
        syncActiveSourceActionMenuState,
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
        findNativeSourceDetailsMenuItem,
        triggerNativeSourceDetailsDirectWithResult,
        triggerNativeSourceDetailsDirect,
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
        areAllAncestorsEnabled,
        isSourceEffectivelyEnabled,
        isGroupWithinActiveIsolation,
        isSourceWithinActiveIsolation,
        parseSearchQuery,
        sourceMatchesCurrentFilters,
        hasActiveRenderFilters,
        groupHasRenderableDescendant,
        shouldRenderGroup,
        isSearchUiCurrentlyExpanded,
        syncSearchUi,
        expandSearch,
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
        getDeveloperModeEnabled: (...args) => getDeveloperModeEnabled(...args),
        setDeveloperModeEnabled: (...args) => setDeveloperModeEnabled(...args),
        getHoverSpotlightEnabled,
        setHoverSpotlightEnabled: async (enabled) => {
            const result = await setHoverSpotlightEnabled(enabled);
            applyAppearancePreferencesToHost();
            return result;
        },
        getDragMode,
        setDragMode: (mode) => applyDragModeChange(mode),
        markWelcomeOnboardingSeen: () => markWelcomeOnboardingSeen(),
        getDeveloperLogExportText: (...args) => getDeveloperLogExportText(...args),
        clearDeveloperLogs: (...args) => clearDeveloperLogs(...args),
        renderSaveStatus: (...args) => renderSaveStatus(...args),
        getCommandPaletteCommands: (...args) => getCommandPaletteCommands(...args),
        executeCommandPaletteCommand: (...args) => executeCommandPaletteCommand(...args),
        getCommandShortcut: (...args) => getCommandShortcut(...args),
        setCommandShortcut: (...args) => setCommandShortcut(...args),
        getCommandShortcutComboFromEvent: (...args) => getCommandShortcutComboFromEvent(...args),
        formatCommandShortcut: (...args) => formatCommandShortcut(...args),
        getVisibleQuickViewKinds: (...args) => getVisibleQuickViewKinds(...args),
        setVisibleQuickViewKinds: (...args) => setVisibleQuickViewKinds(...args),
        getHistoryRetentionLimit: (...args) => getHistoryRetentionLimit(...args),
        setHistoryRetentionLimit: (...args) => setHistoryRetentionLimit(...args),
        createManualRestorePoint: (...args) => createManualRestorePoint(...args),
        getLanguageOverride: (...args) => getLanguageOverride(...args),
        setLanguageOverride: (...args) => setLanguageOverrideFromUi(...args),
        markWhatsNewSeen: () => markWhatsNewSeen(),
        applyTagQuickFilter: (...args) => applyTagQuickFilter(...args),
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
        renderNativeLabelImportModal,
        renderWelcomeModal,
        renderWhatsNewModal,
        renderTagFilterModal,
        closeTagFilterModal,
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
        developerLog: (...args) => developerLog(...args),
        render: (...args) => render(...args),
        suspendManagerForSourceDetailView: (...args) => suspendManagerForSourceDetailView(...args),
        flushPendingInitialLoadedState: (...args) => flushPendingInitialLoadedState(...args),
        debounce
    });
    const {
        resolveFreshRowEntry,
        findFreshCheckbox,
        getSourceViewInfo,
        detectSourceView,
        beginSourceViewPass,
        endSourceViewPass,
        getSourceEntries,
        getCollapsedNativeLabelGroupSummaries,
        expandCollapsedNativeLabelGroups,
        restoreNativeLabelExpansionControls,
        getSourceElements,
        getManageableSourceElements,
        hasRenderableSourceRows,
        getSourcePanelState,
        isSourcePanelManageable,
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
        getVisibleQuickViewKinds: (...args) => getVisibleQuickViewKinds(...args),
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
        getSourceViewInfo: () => getSourceDisplayViewInfo(findSourcePanel()),
        getNativeLabelImportPreview: (...args) => getNativeLabelImportPreview(...args),
        getLastNativeLabelImportSummary: () => lastNativeLabelImportSummary,
        // Post-render hook: re-apply active drag reflow shifts after render() rebuilds
        // the DOM. Without this, when render() runs mid-drag (notebookLM SPA sync,
        // hover-expand setState), patchNode may strip inline transforms from siblings
        // — the session.shiftedItems Map still tracks correct deltas but the DOM
        // doesn't reflect them, causing visible snap-back one frame. Lazy lookup of
        // treeInteractionsModule because it's wired AFTER renderModule below; the
        // hook only fires inside render() which can't run before both are wired.
        onAfterRender: () => {
            if (treeInteractionsModule && typeof treeInteractionsModule.applyReflowAfterRender === 'function') {
                treeInteractionsModule.applyReflowAfterRender();
            }
        }
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
        collectSearchExpandedGroupIds,
        getRenderedSourceActionMenuItems,
        findRenderedSourceActionMenu,
        focusSourceActionMenuItem,
        focusSourceActionMenuButton,
        handleSourceActionMenuKeydown,
        createGroupTitleIconElement,
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
        developerLog: (...args) => developerLog(...args),
        getHistoryRetentionLimit: (...args) => getHistoryRetentionLimit(...args),
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
        getStateHistoryKey,
        getStateHistoryEntries,
        loadStateHistory,
        appendStateHistorySnapshot,
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
        buildPersistableState,
        saveState: persistState,
        handlePageLifecyclePersistence,
        normalizeLoadedState,
        hasPreservableManagerSnapshot,
        hasPersistedSourceRefs,
        hasPersistableManagerState,
        hasRestorableStateSnapshot,
        restorePersistedSnapshotWithoutDom,
        capturePendingPanelReattachState,
        restoreInitialLoadedState,
        flushPendingInitialLoadedState,
        applyLoadedStateToManager,
        loadState
    } = persistenceModule;

    const UNDO_STACK_LIMIT = 20;

    const stateApplyModule = createContentStateApply({
        runtime: runtimeContext,
        cloneSerializableData,
        normalizeLoadedState,
        hasPersistableManagerState,
        normalizeSourceText,
        buildParentMap: (...args) => buildParentMap(...args),
        syncSourceToPage: (...args) => syncSourceToPage(...args),
        isSourceEffectivelyEnabled: (...args) => isSourceEffectivelyEnabled(...args)
    });
    const { applyPersistableSnapshotToRuntime } = stateApplyModule;

    const undoHistoryModule = createContentUndoHistory({
        cloneSerializableData,
        buildPersistableState: (...args) => buildPersistableState(...args),
        applyPersistableSnapshotToRuntime,
        showToast: (...args) => showToast(...args),
        getMessage,
        closeSourceActionMenu: (...args) => closeSourceActionMenu(...args),
        render: (...args) => render(...args),
        runSaveAfterUndo: (options) => saveState(options),
        stackLimit: UNDO_STACK_LIMIT
    });
    const {
        getCurrentUndoSnapshot,
        setUndoBaselineSnapshot,
        resetUndoHistoryBaseline,
        recordUndoBaselineForSave,
        undoLastOperation
    } = undoHistoryModule;

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

    const dragMulti = typeof globalThis.NSM_CREATE_CONTENT_DRAG_MULTI === 'function'
        ? globalThis.NSM_CREATE_CONTENT_DRAG_MULTI({
            getDocument: () => document,
            requestAnimationFrame: globalThis.requestAnimationFrame
                ? globalThis.requestAnimationFrame.bind(globalThis)
                : null,
            cancelAnimationFrame: globalThis.cancelAnimationFrame
                ? globalThis.cancelAnimationFrame.bind(globalThis)
                : null
        })
        : null;

    const dragReflow = typeof globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW === 'function'
        ? globalThis.NSM_CREATE_CONTENT_DRAG_REFLOW({})
        : null;

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
        getDragMode: () => getDragMode(),
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
        developerLog: (...args) => developerLog(...args),
        dragMulti,
        dragReflow,
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
        getIsDeletingSources: () => isDeletingSources,
        getCurrentSourceViewKind: () => {
            const panel = findSourcePanel();
            const info = getSourceViewInfo(panel);
            if (
                sourceViewDisplayKind === SOURCE_VIEW_LIST &&
                info?.kind === SOURCE_VIEW_LABEL &&
                lastNativeSourceListHidden
            ) {
                return SOURCE_VIEW_LIST;
            }
            return info?.kind || sourceViewKind || 'unknown';
        },
        recordNativeSelectionSyncFailure: (details) => {
            if (!details) {
                lastNativeSelectionSyncFailure = null;
                return;
            }
            lastNativeSelectionSyncFailure = Object.assign({
                occurredAt: new Date().toISOString()
            }, details || {});
        }
    });
    const {
        handleAddNewGroup,
        syncSourceToPage,
        processClickQueue,
        removeSourceFromTree,
        executeBatchMoveToUngrouped,
        canMoveSourceToUngrouped,
        moveSourceToUngrouped,
        removeGroupFromTree,
        handleInteraction,
        handleOriginalCheckboxChange,
        handleDragStart,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        handleDragEnd,
        clearDragFeedback,
        getSourceTreePosition,
        getGroupTreePosition,
        isNoopTreeMove
    } = treeInteractionsModule;

    const nativeLabelImportModule = createContentNativeLabelImport({
        getComparableNativeImportLabelTitle
    });
    const {
        previewContainsTitles: nativeLabelPreviewContainsTitles,
        getIncompleteSummaries: getIncompleteNativeLabelImportSummaries
    } = nativeLabelImportModule;

    function findReusableNativeLabelImportGroup(labelTitle) {
        return findReusableNativeLabelImportGroupRecord(labelTitle, groupsById);
    }

    function resolveNativeLabelPreviewSourceKey(descriptor) {
        return resolveNativeLabelPreviewSourceKeyRecord(descriptor, sourcesByKey);
    }

    function createNativeLabelPreviewSourceRecord(descriptor, nativeLabelTitle, sourceKey) {
        return createNativeLabelPreviewSourceRecordRecord(descriptor, nativeLabelTitle, sourceKey);
    }

    function ensureNativeLabelPreviewSources(label) {
        return ensureNativeLabelPreviewSourcesRecord(label, {
            sourcesByKey,
            sourceTagsById,
            keyByElement
        });
    }

    function getNativeLabelImportPreview(options = {}) {
        const sourcePanel = options?.panel || findSourcePanel();
        const viewInfo = options?.viewInfo || (sourcePanel ? getSourceViewInfo(sourcePanel) : sourceViewInfo) || { kind: sourceViewKind, confidence: sourceViewConfidence };
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
        const seenSourceIds = new Map();
        const seenLegacyKeys = new Map();
        const sourceEntries = sourcePanel
            ? getSourceEntries(sourcePanel, { includeHiddenNativeLabelRows: true })
            : [];
        sourceEntries.forEach((entry) => {
            const title = String(entry?.nativeLabelTitle || '').replace(/\s+/g, ' ').trim();
            if (!title || !entry?.row) return;
            const descriptor = createSourceDescriptor(entry.row, seenSourceIds, seenLegacyKeys);
            const sourceKey = resolveNativeLabelPreviewSourceKey(descriptor);
            if (!sourceKey) return;
            const normalizedTitle = getComparableNativeImportLabelTitle(title);
            if (!labelsByTitle.has(normalizedTitle)) {
                labelsByTitle.set(normalizedTitle, {
                    title,
                    sourceKeys: [],
                    sourceTitles: [],
                    sourceRecords: [],
                    sourceKeySet: new Set()
                });
            }
            const label = labelsByTitle.get(normalizedTitle);
            if (label.sourceKeySet.has(sourceKey)) return;
            const existingSource = sourcesByKey.get(sourceKey);
            const sourceRecord = existingSource || createNativeLabelPreviewSourceRecord(descriptor, title, sourceKey);
            label.sourceKeySet.add(sourceKey);
            label.sourceKeys.push(sourceKey);
            label.sourceTitles.push(existingSource?.title || descriptor?.title || descriptor?.normalizedTitle || sourceKey);
            if (sourceRecord) {
                label.sourceRecords.push(sourceRecord);
            }
        });

        const labels = Array.from(labelsByTitle.values())
            .map((label) => {
                const existingGroup = findReusableNativeLabelImportGroup(label.title);
                const { sourceKeySet: _sourceKeySet, ...publicLabel } = label;
                return Object.assign({}, publicLabel, {
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
        return createImportedNativeLabelGroupIdRecord(labelTitle, usedIds);
    }

    function applyNativeLabelImport(previewOverride = null) {
        const preview = previewOverride && typeof previewOverride === 'object'
            ? previewOverride
            : getNativeLabelImportPreview();
        if (!preview.ok) {
            showToast(getMessage('ui_import_native_labels_unavailable'), { variant: 'info' });
            return false;
        }

        buildParentMap();
        const usedGroupIds = new Set(groupsById.keys());
        const previewLabels = Array.isArray(preview.labels) ? preview.labels : [];
        const importedLabels = [];
        let importedSourceCount = 0;
        let skippedExistingAssignmentCount = 0;
        let previewSourceAddedCount = 0;
        previewLabels.forEach((label) => {
            const sourceKeys = Array.isArray(label?.sourceKeys) ? label.sourceKeys : [];
            let group = label.existingGroupId ? groupsById.get(label.existingGroupId) : null;
            const targetGroupId = group?.id || null;
            previewSourceAddedCount += ensureNativeLabelPreviewSources(label);
            const importableSourceKeys = sourceKeys.filter((sourceKey) => {
                if (!sourcesByKey.has(sourceKey)) return false;
                const currentParentId = parentMap.get(sourceKey);
                if (currentParentId && currentParentId !== targetGroupId) {
                    skippedExistingAssignmentCount += 1;
                    return false;
                }
                return true;
            });
            if (importableSourceKeys.length === 0) return;

            const labelAction = group ? 'reuse' : 'create';
            if (!group) {
                group = {
                    id: createImportedNativeLabelGroupId(label.title, usedGroupIds),
                    title: label.title,
                    nativeLabelTitle: label.title || '',
                    children: [],
                    enabled: true,
                    collapsed: false,
                    isNewlyCreated: true
                };
                groupsById.set(group.id, group);
                // v5: root folders live in state.root as { type:'group', id } entries
                // (state.groups was removed). Folders never go into the ungrouped bin.
                state.root = Array.isArray(state.root) ? state.root : [];
                if (!state.root.some((entry) => entry?.type === 'group' && entry.id === group.id)) {
                    state.root.push({ type: 'group', id: group.id });
                }
            }
            if (label.title) {
                group.nativeLabelTitle = label.title;
            }

            importableSourceKeys.forEach((sourceKey) => {
                removeSourceFromTree(sourceKey);
                if (!group.children.some((child) => child?.type === 'source' && child.key === sourceKey)) {
                    group.children.push({ type: 'source', key: sourceKey });
                }
            });
            importedSourceCount += importableSourceKeys.length;
            importedLabels.push({
                title: label.title || '',
                sourceCount: importableSourceKeys.length,
                action: labelAction
            });
        });

        buildParentMap();
        lastNativeLabelImportSummary = {
            labelCount: importedLabels.length,
            sourceCount: importedSourceCount,
            skippedExistingAssignmentCount,
            previewSourceAddedCount,
            importedAt: new Date().toISOString(),
            labels: importedLabels
        };
        render();
        saveState({ immediate: true, critical: true });
        showUndoableToast(getMessage('ui_import_native_labels_applied', [
            String(lastNativeLabelImportSummary.labelCount),
            String(lastNativeLabelImportSummary.sourceCount)
        ]), { variant: 'success' });
        return true;
    }

    function waitForNativeLabelExpansionDelay(delayMs = 150) {
        return new Promise((resolve) => {
            const timeoutFn = typeof window?.setTimeout === 'function' ? window.setTimeout : setTimeout;
            timeoutFn(resolve, delayMs);
        });
    }

    async function waitForNativeLabelExpansionForImport(options = {}) {
        const maxAttempts = Number.isFinite(options.maxAttempts) ? Math.max(1, Math.floor(options.maxAttempts)) : 8;
        const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.floor(options.delayMs)) : 150;
        const expectedLabelTitles = Array.isArray(options.expectedLabelTitles) ? options.expectedLabelTitles : [];
        const expectedSummaries = Array.isArray(options.expectedSummaries) ? options.expectedSummaries : [];
        let preview = null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            await waitForNativeLabelExpansionDelay(delayMs);
            preview = getNativeLabelImportPreview(options);
            if (
                preview?.ok &&
                nativeLabelPreviewContainsTitles(preview, expectedLabelTitles) &&
                getIncompleteNativeLabelImportSummaries(preview, expectedSummaries).length === 0
            ) {
                return preview;
            }
        }
        return preview;
    }

    async function applyNativeLabelImportFromUi() {
        let preview = null;
        const sourcePanel = findSourcePanel();
        const currentSourceViewInfo = getSourceViewInfo(sourcePanel);
        const currentSourceViewKind = currentSourceViewInfo?.kind || sourceViewInfo?.kind || sourceViewKind;
        developerLog('info', 'import_export', 'native_label_preview_started', {
            viewKind: currentSourceViewKind || 'unknown'
        });
        if (currentSourceViewKind === 'label') {
            const collapsedLabelSummaries = getCollapsedNativeLabelGroupSummaries(sourcePanel);
            preview = getNativeLabelImportPreview({ panel: sourcePanel, viewInfo: currentSourceViewInfo });
            if (preview?.sourceCount > 0 && collapsedLabelSummaries.length > 0) {
                developerLog('debug', 'source_sync', 'hidden_label_rows_collected', {
                    labelCount: preview.labelCount,
                    sourceCount: preview.sourceCount
                });
            }
            const incompleteSummaries = getIncompleteNativeLabelImportSummaries(preview, collapsedLabelSummaries);
            if (incompleteSummaries.length > 0) {
                developerLog('warn', 'import_export', 'native_label_preview_incomplete', {
                    reason: 'missing_or_incomplete_label',
                    labelCount: Number(preview?.labelCount) || 0,
                    sourceCount: Number(preview?.sourceCount) || 0,
                    incompleteLabelCount: incompleteSummaries.length
                });
                const expansionResult = expandCollapsedNativeLabelGroups(sourcePanel, {
                    onlyTitles: incompleteSummaries.map((summary) => summary.title).filter(Boolean)
                });
                if (expansionResult?.clickedCount > 0) {
                    developerLog('info', 'native_action', 'native_label_expand_fallback_used', {
                        labelCount: expansionResult.clickedCount,
                        reason: 'preview_incomplete'
                    });
                    preview = await waitForNativeLabelExpansionForImport({
                        panel: sourcePanel,
                        viewInfo: currentSourceViewInfo,
                        expectedLabelTitles: expansionResult.titles,
                        expectedSummaries: incompleteSummaries
                    });
                    const restoreResult = restoreNativeLabelExpansionControls(expansionResult.clickedControls || []);
                    if (restoreResult.failedCount > 0) {
                        developerLog('warn', 'native_action', 'native_label_expand_restore_failed', {
                            failedCount: restoreResult.failedCount,
                            restoredCount: restoreResult.clickedCount
                        });
                    }
                } else {
                    preview = getNativeLabelImportPreview({ panel: sourcePanel, viewInfo: currentSourceViewInfo });
                }
            }
        }
        if (!preview) {
            preview = getNativeLabelImportPreview();
        }
        developerLog(preview?.ok ? 'info' : 'warn', 'import_export', 'native_label_preview_ready', {
            result: preview?.ok ? 'ready' : 'unavailable',
            reason: preview?.reason || 'unknown',
            labelCount: Number(preview?.labelCount) || 0,
            sourceCount: Number(preview?.sourceCount) || 0
        });
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
            sourceViewDisplayKind: sourceViewDisplayKind || SOURCE_VIEW_LIST,
            sourceViewConfidence: Number(sourceViewConfidence) || 0,
            lastSourceViewChangedAt: lastSourceViewChangedAt || '',
            lastSourceViewTransition: clonePlainObject(lastSourceViewTransition),
            nativeSourceListHidden: Boolean(lastNativeSourceListHidden),
            lastNativeSourceListHiddenAt: lastNativeSourceListHiddenAt || '',
            lastNativeSelectionSyncFailure: clonePlainObject(lastNativeSelectionSyncFailure),
            lastSkippedStructuralSourceSync: clonePlainObject(lastSkippedStructuralSourceSync),
            lastStructuralStateRepair: clonePlainObject(lastStructuralStateRepair),
            lastViewSwitchAttempt: clonePlainObject(lastViewSwitchAttempt),
            lastNativeLabelImportSummary: cloneNativeLabelImportSummary(lastNativeLabelImportSummary),
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
            developerModeEnabled: getDeveloperModeEnabled(),
            developerLogCount: getDeveloperLogs().length,
            latestDeveloperLogAt: getLatestDeveloperLogAt(),
            lastNativeActionFailure: latestNativeFailure,
            nativeActionFailureHistory: nativeActionFailureHistory.map((failure) => Object.assign({}, failure))
        };
    }

    function getDiagnosticsText() {
        return stringifyDiagnostics(getDiagnosticsInfo());
    }

    function getMessageLocaleSetter() {
        return typeof globalThis.NSM_SET_MESSAGE_LOCALE_OVERRIDE === 'function'
            ? globalThis.NSM_SET_MESSAGE_LOCALE_OVERRIDE
            : null;
    }

    function applyAppearancePreferencesToHost() {
        if (!extensionHost || !extensionHost.classList) return;
        if (getHoverSpotlightEnabled()) {
            extensionHost.classList.remove('sp-appearance-no-spotlight');
        } else {
            extensionHost.classList.add('sp-appearance-no-spotlight');
        }
    }

    // Persist a drag-mode change, then (when switching to classic) sweep any positioned
    // root sources into the bottom ungrouped bin and re-render — classic mode cannot
    // represent sources placed between folders. Used by the settings toggle and the
    // What's-New "enable Beta" button.
    async function applyDragModeChange(mode) {
        const result = await setDragMode(mode);
        if (getDragMode() === 'classic'
            && treeInteractionsModule
            && typeof treeInteractionsModule.sweepPositionedRootSourcesToBin === 'function'
            && treeInteractionsModule.sweepPositionedRootSourcesToBin(state)) {
            buildParentMap();
            render();
            saveState();
        }
        return result;
    }

    function applyLanguageOverrideFromPreferences() {
        const setLocaleOverride = getMessageLocaleSetter();
        if (!setLocaleOverride) return Promise.resolve(getLanguageOverride());
        return Promise.resolve(setLocaleOverride(getLanguageOverride()))
            .catch(() => getLanguageOverride());
    }

    function setLocalizedButton(button, labelKey) {
        if (!button) return;
        button.textContent = getMessage(labelKey);
    }

    function refreshLocalizedStaticUi() {
        if (!shadowRoot) return;
        const settingsButton = shadowRoot.getElementById('sp-settings-btn');
        if (settingsButton) {
            settingsButton.setAttribute('title', getMessage('ui_settings'));
            settingsButton.setAttribute('aria-label', getMessage('ui_settings'));
        }
        setLocalizedButton(shadowRoot.getElementById('sp-new-group-btn'), 'ui_new_group');
        setLocalizedButton(shadowRoot.getElementById('sp-manage-tags-btn'), 'ui_manage_tags');
        setLocalizedButton(shadowRoot.getElementById('sp-batch-action-btn'), 'ui_batch_action');
        const searchButton = shadowRoot.getElementById('sp-search-btn');
        if (searchButton) {
            searchButton.setAttribute('title', getMessage('ui_filter_sources'));
            searchButton.setAttribute('aria-label', getMessage('ui_filter_sources'));
        }
        const searchInput = shadowRoot.getElementById('sp-search');
        if (searchInput) {
            searchInput.setAttribute('placeholder', getMessage('ui_filter_sources_v2'));
            searchInput.setAttribute('aria-label', getMessage('ui_filter_sources'));
        }
        const closeSearchButton = shadowRoot.getElementById('sp-search-close-btn');
        if (closeSearchButton) {
            closeSearchButton.setAttribute('title', getMessage('ui_cancel'));
            closeSearchButton.setAttribute('aria-label', getMessage('ui_cancel'));
        }
        renderSaveStatus();
        render();
    }

    function ensureDeveloperPreferencesLoaded() {
        if (!developerPreferencesLoadPromise) {
            developerPreferencesLoadPromise = Promise.resolve(loadDeveloperPreferences())
                .then(() => applyLanguageOverrideFromPreferences())
                .then(() => { applyAppearancePreferencesToHost(); })
                .then(() => {
                    refreshLocalizedStaticUi();
                    return getDeveloperModeEnabled();
                })
                .catch(() => null);
        }
        return developerPreferencesLoadPromise;
    }

    function normalizeDottedVersion(value) {
        const text = String(value || '').trim();
        if (!/^\d+(?:\.\d+){0,3}$/.test(text)) return '';
        return text.split('.')
            .map((part) => String(Number(part)))
            .join('.');
    }

    function getCurrentWhatsNewVersion() {
        return normalizeDottedVersion(globalThis.chrome?.runtime?.getManifest?.()?.version) || '0';
    }

    function compareDottedVersions(leftVersion, rightVersion) {
        const left = normalizeDottedVersion(leftVersion);
        const right = normalizeDottedVersion(rightVersion);
        if (!right) return 0;
        if (!left) return -1;
        const leftParts = left.split('.').map((part) => Number(part));
        const rightParts = right.split('.').map((part) => Number(part));
        const length = Math.max(leftParts.length, rightParts.length);
        for (let index = 0; index < length; index += 1) {
            const leftPart = leftParts[index] || 0;
            const rightPart = rightParts[index] || 0;
            if (leftPart > rightPart) return 1;
            if (leftPart < rightPart) return -1;
        }
        return 0;
    }

    function hasSeenCurrentWhatsNewVersion() {
        return compareDottedVersions(getWhatsNewSeenVersion(), getCurrentWhatsNewVersion()) >= 0;
    }

    function markWelcomeOnboardingSeen() {
        welcomeOnboardingPromptedThisSession = true;
        const usageState = typeof getPreferenceUsageState === 'function' ? getPreferenceUsageState() : {};
        const shouldMarkWhatsNewSeen = !usageState.hasExistingPluginData && typeof setOnboardingModalSeenVersions === 'function';
        const savePromise = shouldMarkWhatsNewSeen
            ? setOnboardingModalSeenVersions({
                welcomeOnboardingSeenVersion: CURRENT_WELCOME_ONBOARDING_VERSION,
                whatsNewSeenVersion: getCurrentWhatsNewVersion()
            })
            : setWelcomeOnboardingSeenVersion(CURRENT_WELCOME_ONBOARDING_VERSION);
        return Promise.resolve(savePromise)
            .catch(() => false);
    }

    function markWhatsNewSeen() {
        whatsNewPromptedThisSession = true;
        const savePromise = typeof setOnboardingModalSeenVersions === 'function'
            ? setOnboardingModalSeenVersions({
                welcomeOnboardingSeenVersion: CURRENT_WELCOME_ONBOARDING_VERSION,
                whatsNewSeenVersion: getCurrentWhatsNewVersion()
            })
            : setWhatsNewSeenVersion(getCurrentWhatsNewVersion());
        return Promise.resolve(savePromise)
            .catch(() => false);
    }

    function maybeRenderWhatsNew() {
        if (
            !WHATS_NEW_ENABLED ||
            whatsNewPromptedThisSession ||
            !shadowRoot ||
            typeof renderWhatsNewModal !== 'function'
        ) {
            return Promise.resolve(false);
        }

        return ensureDeveloperPreferencesLoaded().then(() => {
            const usageState = typeof getPreferenceUsageState === 'function' ? getPreferenceUsageState() : {};
            if (
                whatsNewPromptedThisSession ||
                !usageState.hasExistingPluginData ||
                hasSeenCurrentWhatsNewVersion()
            ) {
                return false;
            }
            whatsNewPromptedThisSession = true;
            return renderWhatsNewModal();
        });
    }

    function maybeRenderWelcomeOnboarding() {
        if (welcomeOnboardingPromptedThisSession || !shadowRoot || typeof renderWelcomeModal !== 'function') {
            return Promise.resolve(false);
        }

        return ensureDeveloperPreferencesLoaded().then(() => {
            const usageState = typeof getPreferenceUsageState === 'function' ? getPreferenceUsageState() : {};
            if (
                welcomeOnboardingPromptedThisSession ||
                usageState.hasExistingPluginData ||
                getWelcomeOnboardingSeenVersion() >= CURRENT_WELCOME_ONBOARDING_VERSION
            ) {
                return false;
            }
            welcomeOnboardingPromptedThisSession = true;
            return renderWelcomeModal();
        });
    }

    function maybeRenderOnboardingModals() {
        return maybeRenderWelcomeOnboarding()
            .then((didRenderWelcome) => (didRenderWelcome ? true : maybeRenderWhatsNew()));
    }

    function getDefaultRestorePointLabel() {
        return new Date().toLocaleString();
    }

    function createManualRestorePoint(label) {
        const normalizedLabel = String(label || '').trim().slice(0, 48) || getDefaultRestorePointLabel().slice(0, 48);
        return Promise.resolve(appendStateHistorySnapshot(buildPersistableState(), 'manual_restore_point', {
            label: normalizedLabel,
            manual: true
        }))
            .then(() => loadStateHistory())
            .then(() => {
                showToast(getMessage('ui_history_restore_point_created'), { variant: 'success' });
                return true;
            })
            .catch(() => {
                showToast(getMessage('ui_history_restore_point_failed'), { variant: 'error' });
                return false;
            });
    }

    function setLanguageOverrideFromUi(locale) {
        return Promise.resolve(setLanguageOverride(locale))
            .then(() => applyLanguageOverrideFromPreferences())
            .then(() => {
                refreshLocalizedStaticUi();
                showToast(getMessage('ui_settings_language_updated'), { variant: 'success' });
                return getLanguageOverride();
            })
            .catch(() => {
                showToast(getMessage('ui_settings_language_update_failed'), { variant: 'error' });
                return getLanguageOverride();
            });
    }

    function handleContentErrorLog(event) {
        developerLog('error', 'lifecycle', 'content_error', getContentErrorLogDetails(event));
    }

    function handleUnhandledRejectionLog(event) {
        developerLog('error', 'lifecycle', 'unhandled_rejection', getUnhandledRejectionLogDetails(event));
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
                    'role',
                    'aria-busy',
                    'aria-live',
                    'data-state',
                    'data-status',
                    'aria-expanded',
                    'aria-checked',
                    'checked',
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
        const isManagerUiMounted = Boolean(
            shadowRoot &&
            shadowRoot.host &&
            shadowRoot.host.isConnected &&
            shadowRoot.querySelector('.sp-container') &&
            sourcePanel &&
            isManagerAttachedToPanel(sourcePanel)
        );
        const isManagerUiOperable = Boolean(
            isManagerUiMounted &&
            panelState.state !== 'collapsed' &&
            panelState.state !== 'missing' &&
            panelState.state !== 'detail'
        );

        if (isManagerUiOperable) {
            attachedSourcePanel = sourcePanel;
            managerStatusReason = 'ready';
            return Object.assign({ ready: true, reason: 'ready' }, getSourceViewStatusFields(sourcePanel));
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

    function getSourceDisplayViewInfo(panel = findSourcePanel(), detectedInfo = null) {
        const nativeInfo = detectedInfo || getSourceViewInfo(panel) || {};
        const preferredDisplayKind = normalizeSourceViewSwitchTarget(sourceViewDisplayKind);
        const displayKind = isConcreteSourceViewKind(preferredDisplayKind)
            ? preferredDisplayKind
            : (isConcreteSourceViewKind(nativeInfo.kind) ? nativeInfo.kind : SOURCE_VIEW_LIST);
        return buildSourceDisplayViewInfo(nativeInfo, displayKind);
    }

    function applySourceViewDisplayMode(viewKind, panel = findSourcePanel(), detectedInfo = null) {
        sourceViewDisplayKind = normalizeSourceViewSwitchTarget(viewKind);
        const displayInfo = getSourceDisplayViewInfo(panel, detectedInfo);
        setNativeSourceListHidden(displayInfo.kind === SOURCE_VIEW_LIST);
        return displayInfo;
    }

    function getSourceViewStatusFields(sourcePanel) {
        const nativeInfo = sourcePanel ? getSourceViewInfo(sourcePanel) : (sourceViewInfo || {});
        const displayInfo = getSourceDisplayViewInfo(sourcePanel, nativeInfo);
        return buildSourceViewStatusFields(nativeInfo, displayInfo);
    }

    function getNativeViewSwitchText(element) {
        if (!element) return '';
        const values = [];
        const attrs = [
            'aria-label',
            'title',
            'data-testid',
            'data-tooltip',
            'aria-description',
            'alt',
            'data-mat-icon-name',
            'data-icon-name',
            'data-icon',
            'fonticon',
            'fontIcon',
            'font-icon',
            'svgicon',
            'svgIcon',
            'ng-reflect-font-icon',
            'ng-reflect-svg-icon',
            'icon',
            'name',
            'class'
        ];
        const collect = (node) => {
            if (!node) return;
            if (typeof node.textContent === 'string') values.push(node.textContent);
            attrs.forEach((attr) => {
                const value = node.getAttribute?.(attr);
                if (value) values.push(value);
            });
        };
        collect(element);
        if (typeof element.querySelectorAll === 'function') {
            try {
                Array.from(element.querySelectorAll([
                    'mat-icon',
                    '.mat-icon',
                    '.material-icons',
                    '.material-symbols-outlined',
                    '.material-symbols-rounded',
                    '[aria-label]',
                    '[title]',
                    '[data-testid]',
                    '[data-mat-icon-name]',
                    '[data-icon-name]',
                    '[data-icon]',
                    '[fonticon]',
                    '[fontIcon]',
                    '[font-icon]',
                    '[svgicon]',
                    '[svgIcon]',
                    '[ng-reflect-font-icon]',
                    '[ng-reflect-svg-icon]',
                    '[icon]',
                    '[name]'
                ].join(','))).slice(0, 12).forEach(collect);
            } catch (error) {
                // Ignore selector differences in NotebookLM's runtime DOM.
            }
        }
        const text = values
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        const normalizedIconText = text.replace(/[-\s]+/g, '_');
        return `${text} ${normalizedIconText}`.replace(/\s+/g, ' ').trim();
    }

    function isNativeViewSwitchCandidateVisible(element, options = {}) {
        if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
        if (options.includeHidden) return true;
        const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(element)
            : null;
        return !style || (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function isInsideNativeSourceRow(element) {
        if (!element) return false;
        if (typeof element.closest === 'function' && element.closest([
            '[data-testid="source-item"]',
            '.single-source-container',
            '[data-source-id]',
            '[data-document-id]',
            '[data-doc-id]',
            '[data-file-id]',
            '[data-drive-id]',
            '[data-resource-id]'
        ].join(','))) {
            return true;
        }
        let cursor = element;
        let depth = 0;
        while (cursor && depth < 8) {
            const classText = getElementClassText(cursor);
            if (
                /\bsource-stretched-button\b/.test(classText) ||
                /\bsource-title\b/.test(classText) ||
                /\bsource-item-more-button\b/.test(classText) ||
                /\blabel-auto-button\b/.test(classText) ||
                /\bsingle-source-container\b/.test(classText) ||
                /\bsource-item\b/.test(classText) ||
                /\bsource-row\b/.test(classText) ||
                /\blabel-row\b/.test(classText)
            ) {
                return true;
            }
            cursor = cursor.parentElement || cursor.parentNode || null;
            depth += 1;
        }
        return false;
    }

    function getElementClassText(element) {
        const classAttr = element?.getAttribute?.('class');
        if (classAttr) return String(classAttr).toLowerCase();
        const className = element?.className;
        if (typeof className === 'string') return className.toLowerCase();
        if (typeof className?.baseVal === 'string') return className.baseVal.toLowerCase();
        return '';
    }

    function isInsideNativeTransientMenu(element) {
        let cursor = element;
        let depth = 0;
        while (cursor && depth < 10) {
            if (isElementInsideExtensionRoot(cursor)) return false;
            const role = String(cursor.getAttribute?.('role') || '').toLowerCase();
            if (['menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(role)) {
                return true;
            }
            const classText = getElementClassText(cursor);
            if (
                classText.includes('mat-mdc-menu') ||
                classText.includes('mat-menu') ||
                classText.includes('cdk-overlay-pane')
            ) {
                return true;
            }
            cursor = cursor.parentElement || cursor.parentNode || null;
            depth += 1;
        }
        return false;
    }

    function isElementInsideExtensionRoot(element) {
        if (!element) return false;
        if (element.id === 'sources-plus-root') return true;
        return Boolean(element.closest?.('#sources-plus-root'));
    }

    function isElementWithinNativeSourcePanel(element, sourcePanel) {
        if (!element || !sourcePanel) return false;
        if (element === sourcePanel) return true;
        if (typeof sourcePanel.contains === 'function') {
            try {
                return Boolean(sourcePanel.contains(element));
            } catch (error) {
                // Fall back to parent traversal for framework-owned or mocked nodes.
            }
        }

        let cursor = element.parentElement || element.parentNode || null;
        let depth = 0;
        while (cursor && depth < 32) {
            if (cursor === sourcePanel) return true;
            cursor = cursor.parentElement || cursor.parentNode || null;
            depth += 1;
        }
        return false;
    }

    function isCheckboxLikeNativeControl(element) {
        if (!element) return false;
        const tagName = String(element.tagName || '').toLowerCase();
        const type = String(element.type || element.getAttribute?.('type') || '').toLowerCase();
        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        if ((tagName === 'input' && type === 'checkbox') || role === 'checkbox') return true;
        if (tagName === 'mat-checkbox') return true;
        try {
            return Boolean(element.matches?.('input[type="checkbox"], [role="checkbox"], mat-checkbox, .mat-checkbox, .mat-mdc-checkbox, .mdc-checkbox'));
        } catch (error) {
            return false;
        }
    }

    function isNativeLabelCheckboxChangeTarget(element, sourcePanel) {
        if (!sourcePanel || !element) return false;
        if (isElementInsideExtensionRoot(element)) return false;
        if (!isCheckboxLikeNativeControl(element)) return false;
        if (isInsideNativeSourceRow(element)) return false;
        if (!isElementWithinNativeSourcePanel(element, sourcePanel)) return false;
        return getSourceViewInfo(sourcePanel)?.kind === SOURCE_VIEW_LABEL;
    }

    function syncNativeLabelSelectionsFromCurrentPanel(options = {}) {
        const sourcePanel = findSourcePanel();
        if (!sourcePanel || getSourceViewInfo(sourcePanel)?.kind !== SOURCE_VIEW_LABEL) {
            return false;
        }

        if (scrollObserver && typeof scrollObserver.takeRecords === 'function') {
            const pendingMutations = scrollObserver.takeRecords();
            if (pendingMutations && pendingMutations.length > 0) {
                handleDomChanges(pendingMutations);
            }
        }

        const previousPersistableSignature = getPersistableStateSignature();
        scanAndSyncSources({}, false);
        if (pendingInitialLoadedState) {
            pendingInitialLoadedState = cloneSerializableData(buildPersistableState());
        }
        render();

        const nextPersistableSignature = getPersistableStateSignature();
        if (shouldSaveAfterMutationSync(previousPersistableSignature, nextPersistableSignature)) {
            if (options.saveImmediately) {
                saveState({ immediate: true, critical: true });
            } else {
                saveState();
            }
        }
        return true;
    }

    function handleNativeCheckboxChange(event) {
        handleOriginalCheckboxChange(event);

        const sourcePanel = findSourcePanel();
        if (!isNativeLabelCheckboxChangeTarget(event?.target, sourcePanel)) {
            return;
        }

        syncNativeLabelSelectionsFromCurrentPanel({ saveImmediately: true });
    }

    function bindNativeDocumentListeners() {
        if (nativeDocumentListenersBound) return;
        document.addEventListener('click', handleNativeSourceViewSwitchClick, true);
        document.addEventListener('change', handleNativeCheckboxChange, true);
        if (window && typeof window.addEventListener === 'function') {
            window.addEventListener('click', handleNativeSourceViewSwitchClick, true);
            window.addEventListener('change', handleNativeCheckboxChange, true);
        }
        nativeDocumentListenersBound = true;
    }

    function unbindNativeDocumentListeners() {
        if (!nativeDocumentListenersBound) return;
        document.removeEventListener('click', handleNativeSourceViewSwitchClick, true);
        document.removeEventListener('change', handleNativeCheckboxChange, true);
        if (window && typeof window.removeEventListener === 'function') {
            window.removeEventListener('click', handleNativeSourceViewSwitchClick, true);
            window.removeEventListener('change', handleNativeCheckboxChange, true);
        }
        nativeDocumentListenersBound = false;
    }

    function getClickedNativeSourceViewKind(target, sourcePanel) {
        if (!target || !sourcePanel) return null;
        let cursor = target;
        let depth = 0;
        while (cursor && depth < 8) {
            if (isElementInsideExtensionRoot(cursor)) return null;
            if (
                isElementWithinNativeSourcePanel(cursor, sourcePanel) &&
                isNativeViewSwitchClickCandidate(cursor)
            ) {
                const listScore = scoreNativeViewSwitchCandidate(cursor, SOURCE_VIEW_LIST, { includeHidden: true, sourcePanel });
                const labelScore = scoreNativeViewSwitchCandidate(cursor, SOURCE_VIEW_LABEL, { includeHidden: true, sourcePanel });
                if (listScore > 0 || labelScore > 0) {
                    return listScore >= labelScore ? SOURCE_VIEW_LIST : SOURCE_VIEW_LABEL;
                }
            }
            cursor = cursor.parentElement || cursor.parentNode || null;
            depth += 1;
        }
        return null;
    }

    function isNativeViewSwitchClickCandidate(element) {
        if (!element || isInsideNativeSourceRow(element)) return false;
        const dataTestId = String(element.getAttribute?.('data-testid') || '').toLowerCase();
        if (dataTestId.includes('source-label-group') || dataTestId.includes('source-item')) return false;

        const tagName = String(element.tagName || '').toLowerCase();
        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        if (
            tagName === 'button' ||
            ['button', 'tab', 'radio', 'switch', 'menuitemradio'].includes(role)
        ) {
            return true;
        }

        const controlText = [
            dataTestId,
            element.getAttribute?.('aria-label') || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('class') || ''
        ].join(' ');
        return /\bsource[-_ ]?view\b|\bview[-_ ]?(?:list|label)\b|\b(?:list|label)[-_ ]?view\b|\blabel_auto\b|\bview_list\b|\bformat_list_bulleted\b/i.test(controlText);
    }

    function handleNativeSourceViewSwitchClick(event) {
        const sourcePanel = findSourcePanel();
        const targetViewKind = getClickedNativeSourceViewKind(event?.target, sourcePanel);
        if (!targetViewKind) return;

        if (targetViewKind === SOURCE_VIEW_LIST) {
            syncNativeLabelSelectionsFromCurrentPanel({ saveImmediately: true });
        }

        if (viewSwitchInProgress) return;

        getSourceViewInfo(sourcePanel);

        setTimeout(() => {
            const refreshedSourcePanel = findSourcePanel() || sourcePanel;
            const refreshedInfo = getSourceViewInfo(refreshedSourcePanel);
            const displayInfo = applySourceViewDisplayMode(targetViewKind, refreshedSourcePanel, refreshedInfo);
            const shouldPreserveSyncedLabelSelections = targetViewKind === SOURCE_VIEW_LIST;
            if (
                !shouldPreserveSyncedLabelSelections &&
                !isAwaitingInitialStateLoad &&
                getSourcePanelState(refreshedSourcePanel).state === 'ready'
            ) {
                scanAndSyncSources({}, false);
            }
            render();
            persistSourceViewDisplayKind(displayInfo.displayKind, {
                persistSourceViewDisplayKind: true
            });
        }, SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS);
    }

    function scoreNativeViewSwitchCandidate(element, targetViewKind, options = {}) {
        const isLabelHeaderAction = targetViewKind === SOURCE_VIEW_LABEL &&
            isNativeLabelActionMenuTrigger(element, options.sourcePanel || findSourcePanel(), {
                includeHidden: Boolean(options.includeHidden)
            });
        if (!isNativeViewSwitchCandidateVisible(element, options) || (!isLabelHeaderAction && isInsideNativeSourceRow(element))) return 0;
        if (typeof element.closest === 'function' && element.closest('#sources-plus-root')) return 0;
        if (options.rejectTransientMenus && isInsideNativeTransientMenu(element)) return 0;
        const text = getNativeViewSwitchText(element);
        if (!text) return 0;
        const targetPatterns = SOURCE_VIEW_SWITCH_PATTERNS[targetViewKind] || [];
        const otherKind = targetViewKind === SOURCE_VIEW_LABEL ? SOURCE_VIEW_LIST : SOURCE_VIEW_LABEL;
        const otherPatterns = SOURCE_VIEW_SWITCH_PATTERNS[otherKind] || [];
        const targetMatches = targetPatterns.filter((pattern) => pattern.test(text)).length;
        if (targetMatches === 0) return 0;
        const otherMatches = otherPatterns.filter((pattern) => pattern.test(text)).length;
        return (targetMatches * 10) - (otherMatches * 3);
    }

    function getNativeSourceViewSwitchSearchRoots(sourcePanel) {
        const roots = [];
        const seen = new Set();
        const addRoot = (root) => {
            if (!root || seen.has(root) || typeof root.querySelectorAll !== 'function') return;
            seen.add(root);
            roots.push(root);
        };
        addRoot(sourcePanel);
        addRoot(sourcePanel?.parentElement);
        addRoot(sourcePanel?.parentElement?.parentElement);
        return roots;
    }

    function findNativeSourceViewSwitchButton(targetViewKind, options = {}) {
        const sourcePanel = findSourcePanel();
        if (!sourcePanel || typeof sourcePanel.querySelectorAll !== 'function') return null;
        const selectors = [
            'button',
            '[role="button"]',
            '[role="tab"]',
            '[role="radio"]',
            '[role="switch"]',
            '[role="menuitemradio"]',
            '[aria-selected]',
            '[aria-checked]',
            '[aria-label]',
            '[title]',
            '[data-testid]'
        ];
        const seen = new Set();
        const candidates = getNativeSourceViewSwitchSearchRoots(sourcePanel)
            .flatMap((root) => Array.from(root.querySelectorAll(selectors.join(','))))
            .filter((element) => {
                if (!element || seen.has(element)) return false;
                seen.add(element);
                return true;
            });
        return candidates
            .map((element) => ({
                element,
                score: scoreNativeViewSwitchCandidate(element, targetViewKind, Object.assign({}, options, {
                    sourcePanel,
                    rejectTransientMenus: true
                }))
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score)[0]?.element || null;
    }

    function hasElementClass(element, className) {
        return getElementClassText(element)
            .split(/\s+/)
            .filter(Boolean)
            .includes(className);
    }

    function isInsideNativeSourceEntryOutsideLabelHeader(element) {
        if (!element) return false;
        let cursor = element;
        let depth = 0;
        while (cursor && depth < 8) {
            if (hasElementClass(cursor, 'label-row')) return false;
            const dataTestId = String(cursor.getAttribute?.('data-testid') || '').toLowerCase();
            if (dataTestId.includes('source-item')) return true;
            if (
                hasElementClass(cursor, 'source-stretched-button') ||
                hasElementClass(cursor, 'source-title') ||
                hasElementClass(cursor, 'single-source-container') ||
                hasElementClass(cursor, 'source-row') ||
                hasElementClass(cursor, 'source-item')
            ) {
                return true;
            }
            cursor = cursor.parentElement || cursor.parentNode || null;
            depth += 1;
        }
        return false;
    }

    function isNativeLabelActionMenuTrigger(element, sourcePanel, options = {}) {
        if (!element || isElementInsideExtensionRoot(element)) return false;
        if (!isElementWithinNativeSourcePanel(element, sourcePanel)) return false;
        if (!isNativeViewSwitchCandidateVisible(element, options)) return false;
        if (isInsideNativeSourceEntryOutsideLabelHeader(element)) return false;

        const tagName = String(element.tagName || '').toLowerCase();
        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        if (tagName !== 'button' && role !== 'button') return false;

        const classText = getElementClassText(element);
        const text = getNativeViewSwitchText(element);
        const hasMenuSignal = (
            String(element.getAttribute?.('aria-haspopup') || '').toLowerCase() === 'menu' ||
            classText.includes('mat-mdc-menu-trigger') ||
            classText.includes('mat-menu-trigger')
        );
        const hasLabelActionSignal = (
            hasElementClass(element, 'label-auto-button') ||
            NATIVE_LABEL_ACTION_MENU_TRIGGER_PATTERN.test(text)
        );
        if (options.requireMenuSignal && !hasMenuSignal) return false;
        return hasLabelActionSignal;
    }

    function findNativeLabelActionMenuTrigger(sourcePanel) {
        if (!sourcePanel || typeof sourcePanel.querySelectorAll !== 'function') return null;
        const selectors = [
            'button',
            '[role="button"]',
            '[aria-haspopup="menu"]',
            '[aria-label]',
            '[title]'
        ];
        const seen = new Set();
        const candidates = getNativeSourceViewSwitchSearchRoots(sourcePanel)
            .flatMap((root) => Array.from(root.querySelectorAll(selectors.join(','))))
            .filter((element) => {
                if (!element || seen.has(element)) return false;
                seen.add(element);
                return true;
            });
        return candidates.find((element) => isNativeLabelActionMenuTrigger(element, sourcePanel, {
            requireMenuSignal: true
        })) || null;
    }

    function findNativeLabelViewEntryPoint(sourcePanel, options = {}) {
        if (!sourcePanel || typeof sourcePanel.querySelectorAll !== 'function') return null;
        const selectors = [
            'button',
            '[role="button"]',
            '[aria-label]',
            '[title]'
        ];
        const seen = new Set();
        const candidates = getNativeSourceViewSwitchSearchRoots(sourcePanel)
            .flatMap((root) => Array.from(root.querySelectorAll(selectors.join(','))))
            .filter((element) => {
                if (!element || seen.has(element)) return false;
                seen.add(element);
                return true;
            });
        return candidates.find((element) => isNativeLabelActionMenuTrigger(element, sourcePanel, {
            includeHidden: Boolean(options.includeHidden),
            requireMenuSignal: false
        })) || null;
    }

    function findNativeLabelReturnToListMenuItem() {
        if (!document || typeof document.querySelectorAll !== 'function') return null;
        const selectors = [
            '.cdk-overlay-pane button',
            '.cdk-overlay-pane [role="menuitem"]',
            '.mat-mdc-menu-panel button',
            '.mat-mdc-menu-panel [role="menuitem"]',
            '[role="menu"] button',
            '[role="menuitem"]'
        ];
        const seen = new Set();
        const candidates = Array.from(document.querySelectorAll(selectors.join(',')))
            .filter((element) => {
                if (!element || seen.has(element)) return false;
                seen.add(element);
                return true;
            });
        return candidates.find((element) => (
            !isElementInsideExtensionRoot(element) &&
            isInsideNativeTransientMenu(element) &&
            isNativeViewSwitchCandidateVisible(element) &&
            NATIVE_LABEL_RETURN_TO_LIST_PATTERN.test(getNativeViewSwitchText(element))
        )) || null;
    }

    function waitForNativeLabelReturnToListMenuItem() {
        const maxAttempts = Math.max(1, Math.ceil(NATIVE_LABEL_MENU_RETURN_TIMEOUT_MS / SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS));
        let attempts = 0;
        return new Promise((resolve) => {
            const check = () => {
                attempts += 1;
                const menuItem = findNativeLabelReturnToListMenuItem();
                if (menuItem || attempts >= maxAttempts) {
                    resolve(menuItem || null);
                    return;
                }
                setTimeout(check, SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS);
            };
            check();
        });
    }

    function dismissNativeTransientMenu() {
        if (typeof document?.dispatchEvent !== 'function' || typeof KeyboardEvent !== 'function') return;
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Escape'
            }));
        } catch (error) {
            // Best-effort cleanup only.
        }
    }

    function clickNativeLabelActionMenuReturnToList(sourcePanel) {
        const trigger = findNativeLabelActionMenuTrigger(sourcePanel);
        if (!trigger) return null;
        if (!clickNativeSourceViewSwitchButton(trigger)) {
            return Promise.resolve({
                nativeClicked: false,
                nativeSwitchReason: 'native_label_menu_open_failed'
            });
        }
        return waitForNativeLabelReturnToListMenuItem().then((menuItem) => {
            if (!menuItem) {
                dismissNativeTransientMenu();
                return {
                    nativeClicked: false,
                    nativeSwitchReason: 'native_label_menu_return_item_missing'
                };
            }
            const nativeClicked = clickNativeSourceViewSwitchButton(menuItem);
            return {
                nativeClicked,
                nativeSwitchReason: nativeClicked
                    ? 'clicked_label_menu_return_to_list'
                    : 'native_label_menu_return_click_failed'
            };
        });
    }

    function clickNativeSourceViewSwitchButton(button) {
        if (!button) return false;
        if (typeof button.click === 'function') {
            button.click();
            return true;
        }
        if (typeof button.dispatchEvent === 'function' && typeof MouseEvent === 'function') {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        }
        return false;
    }

    function updateLastViewSwitchAttempt(details) {
        lastViewSwitchAttempt = createLastViewSwitchAttempt(details);
        return lastViewSwitchAttempt;
    }

    function finishViewSwitchAttempt(result, startedAtMs) {
        viewSwitchInProgress = false;
        lastViewSwitchAttempt = finishViewSwitchAttemptRecord(lastViewSwitchAttempt, Object.assign({
            sourceViewDisplayKind: normalizeSourceViewSwitchTarget(sourceViewDisplayKind)
        }, result || {}), startedAtMs);
        developerLog(result?.success ? 'info' : 'warn', 'view_switch', result?.success ? 'source_view_switch_succeeded' : 'source_view_switch_failed', {
            targetViewKind: result?.viewKind || 'unknown',
            nativeClicked: Boolean(result?.nativeClicked),
            nativeSwitchReason: result?.nativeSwitchReason || '',
            reason: result?.reason || '',
            sourceViewDisplayKind: result?.sourceViewDisplayKind || '',
            durationMs: lastViewSwitchAttempt.durationMs
        });
        return Object.assign({
            viewSwitchDurationMs: lastViewSwitchAttempt.durationMs
        }, result || {});
    }

    function persistSourceViewDisplayKind(displayKind, options = {}) {
        if (options.persistSourceViewDisplayKind === false) return;
        if (displayKind !== SOURCE_VIEW_LIST && displayKind !== SOURCE_VIEW_LABEL) return;
        try {
            saveState({ immediate: true, recordUndo: false });
        } catch (error) {
            console.warn('NotebookLM Source Management: Failed to persist source view preference.', error);
        }
    }

    function finalizeSourceViewSwitchSuccess(nextViewKind, sourcePanel, confirmedInfo, meta = {}) {
        attachScrollObserverToPanel(sourcePanel);
        const displayInfo = applySourceViewDisplayMode(nextViewKind, sourcePanel, confirmedInfo);
        if (getSourcePanelState(sourcePanel).state === 'ready') {
            scanAndSyncSources({}, false);
        }
        render();
        persistSourceViewDisplayKind(displayInfo.displayKind, meta);

        setTimeout(() => {
            try {
                syncManagerWithPanelLifecycle();
            } catch (error) {
                console.warn('NotebookLM Source Management: Failed to sync after source view switch.', error);
            }
        }, 120);

        return finishViewSwitchAttempt({
            success: true,
            viewKind: nextViewKind,
            clicked: Boolean(meta.nativeClicked),
            nativeClicked: Boolean(meta.nativeClicked),
            nativeSwitchReason: meta.nativeSwitchReason || '',
            alreadyActive: Boolean(meta.nativeAlreadyActive),
            detectedSourceViewKind: confirmedInfo?.kind || 'unknown',
            confirmedSourceViewKind: confirmedInfo?.kind || 'unknown',
            sourceViewDisplayKind: displayInfo.displayKind
        }, meta.startedAtMs || Date.now());
    }

    function finalizeSourceViewSwitchFailure(nextViewKind, sourcePanel, detectedInfo, meta = {}) {
        const fallbackDisplayKind = getFallbackSourceViewDisplayKind(detectedInfo || meta.currentInfo, sourceViewDisplayKind);
        const displayInfo = applySourceViewDisplayMode(fallbackDisplayKind, sourcePanel, detectedInfo || meta.currentInfo);
        render();
        const reason = meta.reason || (meta.nativeClicked ? 'native_view_switch_not_confirmed' : meta.nativeSwitchReason);
        return finishViewSwitchAttempt({
            success: false,
            viewKind: nextViewKind,
            clicked: Boolean(meta.nativeClicked),
            nativeClicked: Boolean(meta.nativeClicked),
            nativeSwitchReason: meta.nativeClicked ? 'native_view_switch_not_confirmed' : meta.nativeSwitchReason,
            nativeSwitchAttemptReason: meta.nativeSwitchReason,
            alreadyActive: Boolean(meta.nativeAlreadyActive),
            detectedSourceViewKind: detectedInfo?.kind || meta.currentInfo?.kind || 'unknown',
            sourceViewDisplayKind: displayInfo.displayKind,
            reason,
            errorMessageKey: meta.errorMessageKey || 'popup_source_view_switch_failed'
        }, meta.startedAtMs || Date.now());
    }

    function finalizeSourceViewSwitchDisplayOverride(nextViewKind, sourcePanel, detectedInfo, meta = {}) {
        let expansionResult = null;
        if (
            nextViewKind === SOURCE_VIEW_LIST &&
            (detectedInfo?.kind || meta.currentInfo?.kind) === SOURCE_VIEW_LABEL
        ) {
            expansionResult = expandCollapsedNativeLabelGroups(sourcePanel, {
                ignoreManagerSuppression: true
            });
        }
        const displayInfo = applySourceViewDisplayMode(nextViewKind, sourcePanel, detectedInfo || meta.currentInfo);
        render();
        persistSourceViewDisplayKind(displayInfo.displayKind, meta);
        if (expansionResult?.clickedCount > 0) {
            setTimeout(() => {
                try {
                    freshRowCache = null;
                    if (!isAwaitingInitialStateLoad && getSourcePanelState(sourcePanel).state === 'ready') {
                        scanAndSyncSources({}, false);
                    }
                    render();
                } catch (error) {
                    console.warn('NotebookLM Source Management: Failed to refresh sources after hidden label expansion.', error);
                }
            }, 350);
        }
        return finishViewSwitchAttempt({
            success: true,
            viewKind: nextViewKind,
            clicked: Boolean(meta.nativeClicked),
            nativeClicked: Boolean(meta.nativeClicked),
            nativeSwitchReason: meta.nativeSwitchReason || 'display_override',
            nativeSwitchAttemptReason: meta.nativeSwitchReason || '',
            alreadyActive: Boolean(meta.nativeAlreadyActive),
            detectedSourceViewKind: detectedInfo?.kind || meta.currentInfo?.kind || 'unknown',
            confirmedSourceViewKind: displayInfo.displayKind,
            sourceViewDisplayKind: displayInfo.displayKind,
            displayOverride: true,
            expandedNativeLabelGroups: Number(expansionResult?.clickedCount) || 0
        }, meta.startedAtMs || Date.now());
    }

    function waitForConfirmedSourceView(nextViewKind, sourcePanel, currentInfo, meta = {}) {
        const startedAtMs = meta.startedAtMs || Date.now();
        const maxAttempts = Math.max(1, Math.ceil(SOURCE_VIEW_SWITCH_CONFIRM_TIMEOUT_MS / SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS));
        let attempts = 0;

        return new Promise((resolve) => {
            const check = () => {
                attempts += 1;
                const refreshedSourcePanel = findSourcePanel() || sourcePanel;
                const refreshedInfo = getSourceViewInfo(refreshedSourcePanel);
                if (refreshedInfo?.kind === nextViewKind) {
                    resolve(finalizeSourceViewSwitchSuccess(nextViewKind, refreshedSourcePanel, refreshedInfo, Object.assign({}, meta, {
                        startedAtMs,
                        currentInfo
                    })));
                    return;
                }

                if (attempts >= maxAttempts) {
                    if (nextViewKind === SOURCE_VIEW_LIST && currentInfo?.kind === SOURCE_VIEW_LABEL) {
                        resolve(finalizeSourceViewSwitchDisplayOverride(nextViewKind, refreshedSourcePanel, refreshedInfo, Object.assign({}, meta, {
                            startedAtMs,
                            currentInfo,
                            nativeSwitchReason: 'native_view_switch_not_confirmed'
                        })));
                        return;
                    }
                    resolve(finalizeSourceViewSwitchFailure(nextViewKind, refreshedSourcePanel, refreshedInfo, Object.assign({}, meta, {
                        startedAtMs,
                        currentInfo,
                        reason: 'native_view_switch_not_confirmed'
                    })));
                    return;
                }

                setTimeout(check, SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS);
            };

            setTimeout(check, SOURCE_VIEW_SWITCH_CONFIRM_INTERVAL_MS);
        });
    }

    function completeSourceViewSwitchAfterNativeAttempt(nextViewKind, sourcePanel, currentInfo, switchMeta, meta = {}) {
        const startedAtMs = meta.startedAtMs || Date.now();
        const nativeClicked = Boolean(meta.nativeClicked);
        const nativeAlreadyActive = Boolean(meta.nativeAlreadyActive);
        const nativeSwitchReason = meta.nativeSwitchReason || '';

        if (!nativeAlreadyActive && !nativeClicked) {
            viewSwitchInProgress = false;
            if (nextViewKind === SOURCE_VIEW_LIST && currentInfo?.kind === SOURCE_VIEW_LABEL) {
                return finalizeSourceViewSwitchDisplayOverride(nextViewKind, sourcePanel, currentInfo, Object.assign({}, switchMeta, {
                    startedAtMs,
                    currentInfo,
                    nativeClicked: false,
                    nativeSwitchReason,
                    nativeAlreadyActive: false
                }));
            }
            return finalizeSourceViewSwitchFailure(nextViewKind, sourcePanel, currentInfo, Object.assign({}, switchMeta, {
                startedAtMs,
                currentInfo,
                nativeClicked: false,
                nativeSwitchReason,
                nativeAlreadyActive: false,
                reason: nativeSwitchReason
            }));
        }

        viewSwitchInProgress = !nativeAlreadyActive;
        const refreshedSourcePanel = findSourcePanel() || sourcePanel;
        const refreshedInfo = getSourceViewInfo(refreshedSourcePanel);
        const confirmedSourceViewKind = refreshedInfo?.kind || 'unknown';
        if (confirmedSourceViewKind !== nextViewKind) {
            if (nativeClicked) {
                return waitForConfirmedSourceView(nextViewKind, refreshedSourcePanel, currentInfo, Object.assign({}, switchMeta, {
                    startedAtMs,
                    nativeClicked,
                    nativeSwitchReason,
                    nativeAlreadyActive
                }));
            }

            return finalizeSourceViewSwitchFailure(nextViewKind, refreshedSourcePanel, refreshedInfo, Object.assign({}, switchMeta, {
                startedAtMs,
                currentInfo,
                nativeClicked,
                nativeSwitchReason,
                nativeAlreadyActive,
                reason: 'native_view_switch_not_confirmed'
            }));
        }
        const switchResult = finalizeSourceViewSwitchSuccess(nextViewKind, refreshedSourcePanel, refreshedInfo, Object.assign({}, switchMeta, {
            startedAtMs,
            nativeClicked,
            nativeSwitchReason,
            nativeAlreadyActive
        }));
        if (nativeClicked && nextViewKind === SOURCE_VIEW_LABEL && !nativeAlreadyActive) {
            return waitForNativeLabelExpansionDelay(180).then(() => switchResult);
        }
        return switchResult;
    }

    function switchNativeSourceView(targetViewKind, options = {}) {
        const startedAtMs = Date.now();
        const nextViewKind = normalizeSourceViewSwitchTarget(targetViewKind);
        const switchMeta = {
            persistSourceViewDisplayKind: options.persistSourceViewDisplayKind !== false
        };
        if (!isExtensionEnabled) {
            return {
                success: false,
                reason: 'extension_disabled',
                errorMessageKey: 'popup_reason_extension_disabled'
            };
        }

        const sourcePanel = findSourcePanel();
        if (!sourcePanel) {
            return {
                success: false,
                reason: 'source_panel_missing',
                errorMessageKey: 'popup_reason_source_panel_missing'
            };
        }

        const currentInfo = getSourceViewInfo(sourcePanel);
        updateLastViewSwitchAttempt({
            targetViewKind: nextViewKind,
            detectedSourceViewKind: currentInfo?.kind || 'unknown',
            sourceViewDisplayKind: normalizeSourceViewSwitchTarget(sourceViewDisplayKind)
        });
        if (
            nextViewKind === SOURCE_VIEW_LIST &&
            currentInfo?.kind === SOURCE_VIEW_LABEL
        ) {
            syncNativeLabelSelectionsFromCurrentPanel({ saveImmediately: true });
        }
        const nativeAlreadyActive = currentInfo?.kind === nextViewKind;
        let nativeClicked = false;
        let nativeSwitchReason = nativeAlreadyActive ? 'already_active' : '';
        if (!nativeAlreadyActive) {
            let switchButton = findNativeSourceViewSwitchButton(nextViewKind);
            let usedHiddenSwitchFallback = false;
            if (!switchButton && nextViewKind === SOURCE_VIEW_LABEL) {
                switchButton = findNativeLabelViewEntryPoint(sourcePanel);
            }
            if (!switchButton) {
                switchButton = findNativeSourceViewSwitchButton(nextViewKind, { includeHidden: true });
                usedHiddenSwitchFallback = Boolean(switchButton);
            }
            if (!switchButton && nextViewKind === SOURCE_VIEW_LABEL) {
                switchButton = findNativeLabelViewEntryPoint(sourcePanel, { includeHidden: true });
                usedHiddenSwitchFallback = Boolean(switchButton);
            }
            if (switchButton) {
                viewSwitchInProgress = true;
                nativeClicked = clickNativeSourceViewSwitchButton(switchButton);
                if (!nativeClicked) {
                    viewSwitchInProgress = false;
                }
                nativeSwitchReason = nativeClicked
                    ? (usedHiddenSwitchFallback ? 'clicked_hidden' : 'clicked')
                    : 'source_view_switch_click_failed';
            } else if (nextViewKind === SOURCE_VIEW_LIST && currentInfo?.kind === SOURCE_VIEW_LABEL) {
                const labelMenuSwitch = clickNativeLabelActionMenuReturnToList(sourcePanel);
                if (labelMenuSwitch) {
                    viewSwitchInProgress = true;
                    return labelMenuSwitch.then((result) => completeSourceViewSwitchAfterNativeAttempt(
                        nextViewKind,
                        sourcePanel,
                        currentInfo,
                        switchMeta,
                        {
                            startedAtMs,
                            nativeClicked: Boolean(result?.nativeClicked),
                            nativeSwitchReason: result?.nativeSwitchReason || 'native_label_menu_switch_failed',
                            nativeAlreadyActive: false
                        }
                    ));
                }
                nativeSwitchReason = 'source_view_switch_control_missing';
            } else {
                nativeSwitchReason = 'source_view_switch_control_missing';
            }
        }

        return completeSourceViewSwitchAfterNativeAttempt(nextViewKind, sourcePanel, currentInfo, switchMeta, {
            startedAtMs,
            nativeClicked,
            nativeSwitchReason,
            nativeAlreadyActive
        });
    }

    function getLoadedSourceViewDisplayKind(loadedState) {
        const viewKind = loadedState?.sourceViewDisplayKind;
        return viewKind === SOURCE_VIEW_LABEL || viewKind === SOURCE_VIEW_LIST ? viewKind : null;
    }

    function restorePersistedSourceViewDisplayKind(loadedState) {
        const targetViewKind = getLoadedSourceViewDisplayKind(loadedState);
        if (!targetViewKind) return false;

        const sourcePanel = findSourcePanel();
        if (!sourcePanel) return false;

        const currentInfo = getSourceViewInfo(sourcePanel);
        if (currentInfo?.kind === targetViewKind) {
            applySourceViewDisplayMode(targetViewKind, sourcePanel, currentInfo);
            render();
            return false;
        }

        const result = switchNativeSourceView(targetViewKind, {
            persistSourceViewDisplayKind: false
        });
        if (result && typeof result.then === 'function') {
            result.catch((error) => {
                console.warn('NotebookLM Source Management: Failed to restore source view preference.', error);
            });
        }
        return true;
    }

    function normalizeQuickViewKind(value) {
        const kind = String(value || '').trim().toLowerCase();
        return QUICK_VIEW_KINDS.has(kind) ? kind : null;
    }

    function clearViewLevelSelection() {
        activeIsolationGroupId = null;
        state.activeTagId = null;
    }

    function applyQuickViewKind(kind) {
        const normalizedKind = normalizeQuickViewKind(kind);
        clearViewLevelSelection();
        state.activeQuickViewKind = normalizedKind;
        closeSourceActionMenu();
        render();
        return true;
    }

    function applyTagQuickFilter(tagId) {
        const normalizedTagId = String(tagId || '');
        if (!normalizedTagId || !tagsById.has(normalizedTagId)) return false;
        activeIsolationGroupId = null;
        state.activeQuickViewKind = null;
        state.activeTagId = normalizedTagId;
        closeSourceActionMenu();
        render();
        return true;
    }

    function handleQuickViewRailClick(event) {
        const target = event?.target;
        const button = target && typeof target.closest === 'function'
            ? target.closest('.sp-quick-view-btn')
            : target;
        if (!button || !button.dataset) return false;

        const kind = String(button.dataset.quickViewKind || '');
        event?.preventDefault?.();
        if (kind === 'tag') {
            if (tagsById.size === 0) {
                showToast(getMessage('ui_no_tags'), { variant: 'info' });
                return false;
            }
            closeSourceActionMenu();
            return renderTagFilterModal();
        }
        return applyQuickViewKind(kind === 'all' ? null : kind);
    }

    function commandMatchesPaletteQuery(command, query) {
        const terms = String(query || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        if (terms.length === 0) return true;
        const haystack = [
            command.id,
            command.action,
            command.title,
            command.subtitle,
            command.icon,
            ...(Array.isArray(command.keywords) ? command.keywords : [])
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return terms.every((term) => haystack.includes(term));
    }

    function normalizeCommandShortcutKeyFromEvent(event) {
        const key = String(event?.key || '').trim();
        if (!key || key === 'Dead') return '';
        const modifierOnlyKeys = new Set(['Meta', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'OS']);
        if (modifierOnlyKeys.has(key)) return '';
        if (key === ' ') return 'Space';
        if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
        if (key.length === 1) return key.toUpperCase();
        const aliases = {
            esc: 'Escape',
            escape: 'Escape',
            spacebar: 'Space',
            space: 'Space',
            return: 'Enter',
            enter: 'Enter',
            del: 'Delete',
            delete: 'Delete',
            backspace: 'Backspace',
            tab: 'Tab'
        };
        const lower = key.toLowerCase();
        if (aliases[lower]) return aliases[lower];
        return key.replace(/^\w/, (char) => char.toUpperCase()).slice(0, 32);
    }

    function getCommandShortcutComboFromEvent(event) {
        if (!event || event.isComposing) return '';
        const shortcutKey = normalizeCommandShortcutKeyFromEvent(event);
        if (!shortcutKey) return '';
        const modifiers = [];
        if (event.metaKey) modifiers.push('Meta');
        if (event.ctrlKey) modifiers.push('Ctrl');
        if (event.altKey) modifiers.push('Alt');
        if (event.shiftKey) modifiers.push('Shift');
        if (modifiers.length === 0) return '';
        return modifiers.concat(shortcutKey).join('+');
    }

    function formatCommandShortcut(shortcut) {
        const parts = String(shortcut || '')
            .split('+')
            .map((part) => part.trim())
            .filter(Boolean);
        const labels = {
            Meta: '⌘',
            Ctrl: 'Ctrl',
            Alt: '⌥',
            Shift: '⇧',
            Space: 'Space'
        };
        return parts.map((part) => labels[part] || part).join(' ');
    }

    function getCommandPaletteCommands(query = '') {
        const trimmedQuery = String(query || '').trim();
        const selectedCount = pendingBatchKeys.size;
        const batchEnabled = Boolean(state.isBatchMode && selectedCount > 0 && !isDeletingSources);
        const commands = [];

        if (trimmedQuery) {
            commands.push({
                id: 'search-sources',
                action: 'search-sources',
                icon: 'search',
                title: getMessage('ui_command_search_sources_for', [trimmedQuery]),
                subtitle: getMessage('ui_command_search_sources_subtitle'),
                payload: { query: trimmedQuery },
                keywords: ['search', 'filter', trimmedQuery]
            });
        } else {
            commands.push({
                id: 'search-sources',
                action: 'search-sources',
                icon: 'search',
                title: getMessage('ui_command_search_sources'),
                subtitle: getMessage('ui_command_search_sources_subtitle'),
                payload: { query: '' },
                keywords: ['search', 'filter']
            });
        }

        [
            ['all', 'ui_quick_view_all', 'select_all'],
            ['ungrouped', 'ui_quick_view_ungrouped', 'folder_off'],
            ['disabled', 'ui_quick_view_disabled', 'visibility_off'],
            ['tag', 'ui_quick_view_tag', 'label'],
            ['recent', 'ui_quick_view_recent', 'schedule'],
            ['issues', 'ui_quick_view_issues', 'error']
        ].forEach(([kind, labelKey, icon]) => {
            commands.push({
                id: `quick-view-${kind}`,
                action: 'quick-view',
                icon,
                title: getMessage(labelKey),
                subtitle: getMessage('ui_command_quick_view_subtitle'),
                payload: { kind },
                keywords: ['quick view', kind]
            });
        });

        commands.push(
            {
                id: 'switch-source-view-list',
                action: 'switch-source-view',
                icon: 'view_list',
                title: getMessage('ui_command_switch_list_view'),
                subtitle: getMessage('popup_source_view_label'),
                payload: { kind: SOURCE_VIEW_LIST },
                keywords: ['list', 'source view']
            },
            {
                id: 'switch-source-view-label',
                action: 'switch-source-view',
                icon: 'label_auto',
                title: getMessage('ui_command_switch_label_view'),
                subtitle: getMessage('popup_source_view_label'),
                payload: { kind: SOURCE_VIEW_LABEL },
                keywords: ['label', 'source view']
            },
            {
                id: 'batch-move-folder',
                action: 'batch-move-folder',
                icon: 'drive_file_move',
                title: getMessage('ui_command_batch_move_folder'),
                subtitle: batchEnabled ? getMessage('ui_command_batch_count', [String(selectedCount)]) : getMessage('ui_command_disabled_batch_hint'),
                disabled: !batchEnabled
            },
            {
                id: 'batch-add-tags',
                action: 'batch-add-tags',
                icon: 'new_label',
                title: getMessage('ui_command_batch_add_tags'),
                subtitle: batchEnabled ? getMessage('ui_command_batch_count', [String(selectedCount)]) : getMessage('ui_command_disabled_batch_hint'),
                disabled: !batchEnabled
            },
            {
                id: 'batch-remove-tags',
                action: 'batch-remove-tags',
                icon: 'label_off',
                title: getMessage('ui_command_batch_remove_tags'),
                subtitle: batchEnabled ? getMessage('ui_command_batch_count', [String(selectedCount)]) : getMessage('ui_command_disabled_batch_hint'),
                disabled: !batchEnabled
            },
            {
                id: 'batch-move-ungrouped',
                action: 'batch-move-ungrouped',
                icon: 'drive_file_move_rtl',
                title: getMessage('ui_command_batch_move_ungrouped'),
                subtitle: batchEnabled ? getMessage('ui_command_batch_count', [String(selectedCount)]) : getMessage('ui_command_disabled_batch_hint'),
                disabled: !batchEnabled
            },
            {
                id: 'manage-tags',
                action: 'manage-tags',
                icon: 'sell',
                title: getMessage('ui_command_manage_tags'),
                subtitle: getMessage('ui_manage_tags')
            },
            {
                id: 'open-settings',
                action: 'open-settings',
                icon: 'settings',
                title: getMessage('ui_command_open_settings'),
                subtitle: getMessage('ui_settings')
            }
        );

        if (!trimmedQuery) return commands;
        const searchCommand = commands[0];
        return [
            searchCommand,
            ...commands.slice(1).filter((command) => commandMatchesPaletteQuery(command, trimmedQuery))
        ];
    }

    function getCommandPaletteCommandById(commandId) {
        const id = String(commandId || '');
        if (!id) return null;
        return getCommandPaletteCommands('')
            .find((command) => command && command.id === id) || null;
    }

    function getCommandPaletteCommandForShortcut(shortcut) {
        const combo = String(shortcut || '');
        if (!combo) return null;
        const shortcuts = typeof getCommandShortcuts === 'function' ? getCommandShortcuts() : {};
        const commandId = Object.keys(shortcuts || {})
            .find((id) => shortcuts[id] === combo);
        return commandId ? getCommandPaletteCommandById(commandId) : null;
    }

    function isCommandPaletteModalOpen() {
        return isManagedModalOpen('sp-command-palette-modal');
    }

    function isManagedModalOpen(modalId) {
        const expectedId = String(modalId || '');
        if (!expectedId) return false;
        const modal = shadowRoot?.getElementById?.(expectedId);
        return Boolean(
            modal &&
            (
                modal.id === expectedId ||
                modal.getAttribute?.('id') === expectedId
            )
        );
    }

    function closeModalCommandIfOpen(modalId, closeModal) {
        if (!isManagedModalOpen(modalId)) return false;
        if (typeof closeModal === 'function') {
            closeModal({ immediate: true, restoreFocus: false });
        }
        return true;
    }

    function handleCommandShortcutKeydown(event) {
        if (!event || event.defaultPrevented || event.repeat || !isExtensionEnabled) return false;
        if (isCommandPaletteModalOpen()) return false;
        if (isEditableUndoTarget(event.target)) return false;

        const shortcut = getCommandShortcutComboFromEvent(event);
        const command = getCommandPaletteCommandForShortcut(shortcut);
        if (!command || command.disabled) return false;

        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        closeSourceActionMenu();
        return executeCommandPaletteCommand(command.action, Object.assign({}, command, {
            triggeredByShortcut: true
        }));
    }

    function executeCommandPaletteCommand(action, command = {}) {
        const commandAction = String(action || command.action || '');
        const payload = command.payload || {};
        const triggeredByShortcut = Boolean(command.triggeredByShortcut);
        if (command.disabled) return false;

        if (commandAction === 'search-sources') {
            if (triggeredByShortcut && isSearchUiCurrentlyExpanded()) {
                handleSearchCloseButtonClick(() => {
                    closeSourceActionMenu();
                    render();
                });
                return true;
            }
            state.filterQuery = String(payload.query || '');
            expandSearch({ focus: true });
            closeSourceActionMenu();
            render();
            return true;
        }

        if (commandAction === 'quick-view') {
            if (payload.kind === 'tag') {
                if (triggeredByShortcut && closeModalCommandIfOpen('sp-tag-filter-modal', closeTagFilterModal)) {
                    return true;
                }
                return tagsById.size > 0 ? renderTagFilterModal() : false;
            }
            const normalizedKind = payload.kind === 'all' ? null : normalizeQuickViewKind(payload.kind);
            if (triggeredByShortcut && normalizedKind && state.activeQuickViewKind === normalizedKind) {
                return applyQuickViewKind(null);
            }
            return applyQuickViewKind(normalizedKind);
        }

        if (commandAction === 'switch-source-view') {
            Promise.resolve(switchNativeSourceView(payload.kind)).catch((error) => {
                console.warn('NotebookLM Source Management: Source view command failed.', error);
            });
            return true;
        }

        if (commandAction === 'batch-move-folder') {
            if (!state.isBatchMode || pendingBatchKeys.size === 0) return false;
            if (triggeredByShortcut && closeModalCommandIfOpen('sp-move-modal', closeMoveToFolderModal)) return true;
            renderMoveToFolderModal(Array.from(pendingBatchKeys));
            return true;
        }
        if (commandAction === 'batch-add-tags') {
            if (!state.isBatchMode || pendingBatchKeys.size === 0) return false;
            if (triggeredByShortcut && closeModalCommandIfOpen('sp-batch-tag-modal', closeBatchTagModal)) return true;
            renderBatchTagModal('add', Array.from(pendingBatchKeys));
            return true;
        }
        if (commandAction === 'batch-remove-tags') {
            if (!state.isBatchMode || pendingBatchKeys.size === 0) return false;
            if (triggeredByShortcut && closeModalCommandIfOpen('sp-batch-tag-modal', closeBatchTagModal)) return true;
            renderBatchTagModal('remove', Array.from(pendingBatchKeys));
            return true;
        }
        if (commandAction === 'batch-move-ungrouped') {
            if (!state.isBatchMode || pendingBatchKeys.size === 0) return false;
            executeBatchMoveToUngrouped();
            return true;
        }
        if (commandAction === 'manage-tags') {
            if (triggeredByShortcut && closeModalCommandIfOpen('sp-tag-modal', closeTagModal)) return true;
            renderTagModal();
            return true;
        }
        if (commandAction === 'open-settings') {
            if (triggeredByShortcut && closeModalCommandIfOpen('sp-settings-modal', closeSettingsModal)) return true;
            loadStateHistory().finally(() => renderSettingsModal());
            return true;
        }

        return false;
    }

    function handleManagerMessage(request, sender, sendResponse) {
        return managerMessageRouter.handleMessage(request, sender, sendResponse);
    }

    const managerMessageRouter = createContentMessageRouter({
        handlers: {
            GET_MANAGER_STATUS: () => getManagerStatus(),
            FOCUS_MANAGER: () => focusManagerPanel(),
            SWITCH_SOURCE_VIEW: (request) => switchNativeSourceView(request.viewKind),
            DISABLE_MANAGER: () => {
                disableManagerRuntime();
                return { success: true, disabled: true };
            },
            ENABLE_MANAGER: () => {
                enableManagerRuntime();
                return {
                    success: true,
                    enabled: true,
                    attempted: Boolean(projectId)
                };
            }
        },
        onAsyncError: (error, request) => {
            if (request?.type === 'SWITCH_SOURCE_VIEW') {
                console.warn('NotebookLM Source Management: Failed to switch source view.', error);
                viewSwitchInProgress = false;
                return {
                    success: false,
                    reason: 'source_view_switch_failed',
                    errorMessageKey: 'popup_source_view_switch_failed'
                };
            }
            console.warn('NotebookLM Source Management: Content message handler failed.', error);
            return { success: false, reason: 'message_handler_failed' };
        }
    });

    function buildParentMap() {
        parentMap.clear();
        groupsById.forEach(group => {
            (Array.isArray(group.children) ? group.children : []).forEach(child => {
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

    const importExportModule = createContentImportExport({
        runtime: runtimeContext,
        limits: {
            maxFileBytes: IMPORT_CONFIG_MAX_FILE_BYTES,
            maxGroups: IMPORT_CONFIG_MAX_GROUPS,
            maxTags: IMPORT_CONFIG_MAX_TAGS,
            maxSources: IMPORT_CONFIG_MAX_SOURCES,
            maxChildRefs: IMPORT_CONFIG_MAX_CHILD_REFS,
            maxTreeDepth: IMPORT_CONFIG_MAX_TREE_DEPTH
        },
        developerLog: (...args) => developerLog(...args),
        showToast: (...args) => showToast(...args),
        getMessage,
        cloneSerializableData,
        normalizeLoadedState,
        hasPersistableManagerState,
        buildPersistableState: (...args) => buildPersistableState(...args),
        applyPersistableSnapshotToRuntime,
        buildSourceLookup,
        resolveStoredSourceKey,
        buildNormalizedTagState,
        normalizeSourceViewSwitchTarget,
        appendStateHistorySnapshot: (...args) => appendStateHistorySnapshot(...args),
        writeImportBackupSnapshot: (...args) => writeImportBackupSnapshot(...args),
        restoreInitialLoadedState: (...args) => restoreInitialLoadedState(...args),
        restoreImportBackupSnapshotFromUi: (...args) => restoreImportBackupSnapshotFromUi(...args),
        saveState: (...args) => saveState(...args),
        render: (...args) => render(...args)
    });
    const {
        getExportConfigText,
        parseImportConfigText,
        previewImportConfig,
        applyImportConfig
    } = importExportModule;

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
        state.root = [];
        state.ungrouped = [];
        state.filterQuery = '';
        state.isBatchMode = false;
        state.tagOrder = [];
        state.activeTagId = null;
        state.activeQuickViewKind = null;
        pendingBatchKeys.clear();
        isDeletingSources = false;
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
        lastNativeSelectionSyncFailure = null;
        lastViewSwitchAttempt = null;
        viewSwitchInProgress = false;
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
        document.removeEventListener('keydown', handleUndoKeydown, true);
        document.removeEventListener('keydown', handleCommandShortcutKeydown, true);
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
        developerLog('info', 'lifecycle', 'manager_teardown', {
            hadShadowRoot: Boolean(shadowRoot),
            hadSourcePanel: Boolean(attachedSourcePanel)
        });
        bindPanelLifecycleHooks(null);
        if (routeRecoveryTimeout) {
            clearTimeout(routeRecoveryTimeout);
            routeRecoveryTimeout = null;
        }
        cleanupManagerResources();
        sourceViewDisplayKind = SOURCE_VIEW_LIST;
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
            attachedSourcePanel = sourcePanel;
            if (viewSwitchInProgress) {
                managerStatusReason = 'ready';
                return;
            }
            const previousSourceViewKind = sourceViewKind || 'unknown';
            const currentSourceViewInfo = getSourceViewInfo(sourcePanel);
            const nativeSourceViewChanged = currentSourceViewInfo.kind !== previousSourceViewKind;
            if (
                nativeSourceViewChanged &&
                (currentSourceViewInfo.kind === SOURCE_VIEW_LIST || currentSourceViewInfo.kind === SOURCE_VIEW_LABEL)
            ) {
                sourceViewDisplayKind = currentSourceViewInfo.kind;
            }
            const currentDisplayViewInfo = getSourceDisplayViewInfo(sourcePanel, currentSourceViewInfo);
            setNativeSourceListHidden(currentDisplayViewInfo.kind === 'list');
            attachScrollObserverToPanel(sourcePanel);
            applySourcePanelSurfaceColor(extensionHost, sourcePanel);
            if (panelState.state === 'ready') {
                completeInitialStateLoad();
            }
            managerStatusReason = 'ready';
            if (nativeSourceViewChanged) {
                if (!isAwaitingInitialStateLoad && panelState.state === 'ready') {
                    scanAndSyncSources({}, false);
                    persistSourceViewDisplayKind(currentSourceViewInfo.kind, {
                        persistSourceViewDisplayKind: true
                    });
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
                developerLog('info', 'lifecycle', 'route_left_notebook', { hadProject: true });
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
            developerLog('info', 'lifecycle', 'route_changed_notebook', {
                hadPreviousProject: Boolean(projectId),
                hasNewProject: Boolean(newProjectId)
            });
            console.log(`NotebookLM Source Management: Route changed from ${projectId} to ${newProjectId}. Reinitializing manager.`);
            flushPendingStateSave();
            activeRouteRecoveryToken += 1;
            projectId = newProjectId;
            managerStatusReason = 'manager_not_ready';
            teardown();
            recoverManagerForRoute(newProjectId, 0, activeRouteRecoveryToken);
        }
    }

    // Keyboard step for the panel resizer separator. Mirrors doDrag's min-height clamp;
    // returns null for non-arrow keys so the keydown handler can ignore them.
    function resolveKeyboardResizeHeight(currentHeight, key, minHeight) {
        const RESIZE_STEP_PX = 16;
        const base = Number.isFinite(Number(currentHeight)) ? Number(currentHeight) : minHeight;
        if (key === 'ArrowDown') return Math.max(minHeight, base + RESIZE_STEP_PX);
        if (key === 'ArrowUp') return Math.max(minHeight, base - RESIZE_STEP_PX);
        return null;
    }

    function init(sourcePanel) {
        if (!isSourcePanelRenderable(sourcePanel)) {
            managerStatusReason = 'manager_not_ready';
            developerLog('warn', 'lifecycle', 'manager_mount_skipped', { reason: 'panel_not_renderable' });
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
            maybeRenderOnboardingModals().catch(() => {});
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
        if (initialSourceViewInfo.kind === SOURCE_VIEW_LIST || initialSourceViewInfo.kind === SOURCE_VIEW_LABEL) {
            sourceViewDisplayKind = initialSourceViewInfo.kind;
        }
        const initialDisplayViewInfo = getSourceDisplayViewInfo(sourcePanel, initialSourceViewInfo);
        extensionHost = extensionRoot;
        shadowRoot = extensionRoot.attachShadow({ mode: 'open' });
        applyAppearancePreferencesToHost();
        managerStatusReason = 'manager_not_ready';
        const style = document.createElement('style');
        style.textContent = contentStyleText;
        shadowRoot.appendChild(style);

        const containerHtml = createManagerShell(el, getMessage);
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

        // Keyboard resize: the resizer is a focusable role="separator"; ArrowUp/ArrowDown
        // step the panel height (clamped to the same per-view minimum doDrag uses) and persist.
        resizer.addEventListener('keydown', (e) => {
            const minHeight = container.classList?.contains('is-native-label-view') ? 48 : 150;
            const currentHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10);
            const nextHeight = resolveKeyboardResizeHeight(currentHeight, e.key, minHeight);
            if (nextHeight == null) return;
            e.preventDefault();
            container.style.height = `${nextHeight}px`;
            customHeight = nextHeight;
            saveState({ immediate: true, critical: true });
        });

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
        bindNativeDocumentListeners();
        document.addEventListener('keydown', handleCommandShortcutKeydown, true);
        document.addEventListener('keydown', handleUndoKeydown, true);
        syncSearchUi();

        const listContainer = shadowRoot.querySelector('#sources-list');
        const viewStateContainer = shadowRoot.getElementById('sp-view-state');
        shadowRoot.getElementById('sp-quick-view-rail').addEventListener('click', handleQuickViewRailClick);
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
            setNativeSourceListHidden(initialDisplayViewInfo.kind === 'list');
            attachedSourcePanel = sourcePanel;
            managerStatusReason = 'ready';
            developerLog('info', 'lifecycle', 'manager_mounted', {
                sourceViewKind: initialDisplayViewInfo.kind || 'unknown'
            });
            bindNativeDocumentListeners();

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
                restorePersistedSourceViewDisplayKind(reattachState);
                saveState({ immediate: true, critical: true, recordUndo: false });
                resetUndoHistoryBaseline();
                maybeRenderOnboardingModals().catch(() => {});
                return;
            }

            isAwaitingInitialStateLoad = true;
            loadState((loadedState) => {
                applyLoadedStateToManager(loadedState);
                completeInitialStateLoad();
                restorePersistedSourceViewDisplayKind(loadedState);
                resetUndoHistoryBaseline();
                maybeRenderOnboardingModals().catch(() => {});
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
    ensureDeveloperPreferencesLoaded().catch(() => {});
    window.addEventListener('error', handleContentErrorLog);
    window.addEventListener('unhandledrejection', handleUnhandledRejectionLog);

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

    // NotebookLM is a SPA — switching notebooks does NOT trigger a full reload.
    // On route change, the content script tears down + reinitializes in place
    // via teardown() + the route-changed handler above. Full reload is only
    // the last-resort fallback after repeated reattach retries fail. See
    // handleRouteChanged + scheduleReinitialize, CLAUDE.md "Non-obvious gotchas".
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

        window.removeEventListener('error', handleContentErrorLog);
        window.removeEventListener('unhandledrejection', handleUnhandledRejectionLog);

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
        unbindNativeDocumentListeners();
        if (globalThis[CONTENT_INSTANCE_KEY] === contentInstance) {
            delete globalThis[CONTENT_INSTANCE_KEY];
        }
    }

    contentInstance.destroy = destroyContentInstance;

    // Expose internals for testing (module.exports only exists under Jest; the Chrome
    // runtime never enters this block). Split into productionApi (mirrors of the module's
    // real methods, used by integration tests) and testSurface (the _* accessors/setters
    // that reach internal closures) so the real surface isn't drowned by the test surface.
    if (typeof module !== 'undefined' && module.exports) {
        const productionApi = {
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
            hasPersistableManagerState,
            hasRestorableStateSnapshot,
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
            getCommandPaletteCommands,
            executeCommandPaletteCommand,
            applyQuickViewKind,
            applyTagQuickFilter,
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
            developerLog,
            getDeveloperModeEnabled,
            setDeveloperModeEnabled,
            getWelcomeOnboardingSeenVersion,
            setWelcomeOnboardingSeenVersion,
            getWhatsNewSeenVersion,
            setWhatsNewSeenVersion,
            getPreferenceUsageState,
            setOnboardingModalSeenVersions,
            getHistoryRetentionLimit,
            setHistoryRetentionLimit,
            getLanguageOverride,
            setLanguageOverride,
            markWelcomeOnboardingSeen,
            maybeRenderWelcomeOnboarding,
            markWhatsNewSeen,
            maybeRenderWhatsNew,
            maybeRenderOnboardingModals,
            createManualRestorePoint,
            setLanguageOverrideFromUi,
            loadDeveloperPreferences,
            loadDeveloperLogs,
            getDeveloperLogs,
            getDeveloperLogExportText,
            clearDeveloperLogs,
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
            beginSourceViewPass,
            endSourceViewPass,
            getSourceEntries,
            expandCollapsedNativeLabelGroups,
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
        };

        const testSurface = {
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
            _handleNativeCheckboxChangeForTest: handleNativeCheckboxChange,
            _handleNativeSourceViewSwitchClickForTest: handleNativeSourceViewSwitchClick,
            _getCommandPaletteCommandsForTest: getCommandPaletteCommands,
            _executeCommandPaletteCommandForTest: executeCommandPaletteCommand,
            _applyQuickViewKindForTest: applyQuickViewKind,
            _applyTagQuickFilterForTest: applyTagQuickFilter,
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
            _getToastQueueLengthForTest: () => toastModule.getToastQueueLength(),
            _getActiveToastItemForTest: () => toastModule.getActiveToastItem(),
            _hideActiveToastForTest: hideActiveToast,
            _getUndoStackLengthForTest: () => undoHistoryModule.getUndoStackLength(),
            _resetUndoHistoryBaselineForTest: resetUndoHistoryBaseline,
            _setUndoBaselineSnapshotForTest: setUndoBaselineSnapshot,
            _handleUndoKeydownForTest: handleUndoKeydown,
            _handleCommandShortcutKeydownForTest: handleCommandShortcutKeydown,
            _getCommandShortcutComboFromEventForTest: getCommandShortcutComboFromEvent,
            _formatCommandShortcutForTest: formatCommandShortcut,
            _getCommandShortcutsForTest: getCommandShortcuts,
            _getCommandPaletteCommandForShortcutForTest: getCommandPaletteCommandForShortcut,
            _hasCommandPaletteModalForTest: isCommandPaletteModalOpen,
            _setCommandShortcutForTest: setCommandShortcut,
            _getVisibleQuickViewKindsForTest: getVisibleQuickViewKinds,
            _setVisibleQuickViewKindsForTest: setVisibleQuickViewKinds,
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
            _resolveKeyboardResizeHeightForTest: (currentHeight, key, minHeight) => resolveKeyboardResizeHeight(currentHeight, key, minHeight),
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
            _setViewSwitchInProgressForTest: (val) => { viewSwitchInProgress = Boolean(val); },
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
                state.root = [];
                state.ungrouped = [];
                state.filterQuery = '';
                state.isBatchMode = false;
                state.activeQuickViewKind = null;
                pendingBatchKeys.clear();
                toastModule.resetToastState();
                isDeletingSources = false;
                nativeActionFailureHistory = [];
                if (runtimeContext.recentNativeDeletedSourceKeys instanceof Set) {
                    runtimeContext.recentNativeDeletedSourceKeys.clear();
                }
                if (runtimeContext.recentNativeDeletedSourceIdentityKeys instanceof Set) {
                    runtimeContext.recentNativeDeletedSourceIdentityKeys.clear();
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
                developerPreferencesLoadPromise = null;
                welcomeOnboardingPromptedThisSession = false;
                whatsNewPromptedThisSession = false;
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
                sourceViewDisplayKind = SOURCE_VIEW_LIST;
                lastSourceViewChangedAt = '';
                lastSourceViewTransition = null;
                lastNativeLabelImportSummary = null;
                lastNativeSelectionSyncFailure = null;
                lastViewSwitchAttempt = null;
                viewSwitchInProgress = false;
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
                state.activeQuickViewKind = null;
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

        module.exports = Object.assign({}, productionApi, testSurface);
    }

})();
