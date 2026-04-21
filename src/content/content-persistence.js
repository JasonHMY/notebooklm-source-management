(function () {
    'use strict';

    function createContentPersistence(context = {}) {
        const ctx = context && typeof context === 'object' ? context : {};
        const chromeApi = ctx.chrome ?? globalThis.chrome;
        const debounceFn = ctx.debounce ?? globalThis.debounce;
        const storageSchemaVersion = ctx.storageSchemaVersion
            ?? globalThis.NSM_CONTENT_CONFIG?.STORAGE_SCHEMA_VERSION
            ?? 3;
        const normalizeSourceText = typeof ctx.normalizeSourceText === 'function'
            ? ctx.normalizeSourceText
            : (value) => String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();
        const getSourceTagIds = typeof ctx.getSourceTagIds === 'function' ? ctx.getSourceTagIds : () => [];
        const getSerializedTag = typeof ctx.getSerializedTag === 'function' ? ctx.getSerializedTag : (tag) => tag;
        const scanAndSyncSources = typeof ctx.scanAndSyncSources === 'function' ? ctx.scanAndSyncSources : () => false;
        const findSourcePanel = typeof ctx.findSourcePanel === 'function' ? ctx.findSourcePanel : () => null;
        const isSourcePanelRenderable = typeof ctx.isSourcePanelRenderable === 'function' ? ctx.isSourcePanelRenderable : () => true;
        const getSourcePanelState = typeof ctx.getSourcePanelState === 'function'
            ? ctx.getSourcePanelState
            : () => ({ state: 'ready' });
        const hasRenderableSourceRows = typeof ctx.hasRenderableSourceRows === 'function' ? ctx.hasRenderableSourceRows : () => false;
        const render = typeof ctx.render === 'function' ? ctx.render : () => {};
        const cloneSerializableData = typeof ctx.cloneSerializableData === 'function'
            ? ctx.cloneSerializableData
            : (value) => {
                if (value == null) return value;
                if (typeof globalThis.structuredClone === 'function') {
                    try {
                        return globalThis.structuredClone(value);
                    } catch (error) {
                        // Fall through to JSON cloning for plain persisted state objects.
                    }
                }
                return JSON.parse(JSON.stringify(value));
            };

        const getState = () => {
            if (!ctx.state || typeof ctx.state !== 'object') {
                ctx.state = {
                    groups: [],
                    ungrouped: [],
                    tagOrder: [],
                    activeTagId: null
                };
            }
            return ctx.state;
        };

        const getMapLikeEntries = (value) => {
            if (value instanceof Map) return Array.from(value.entries());
            if (value && typeof value === 'object') return Object.entries(value);
            return [];
        };

        const getMapLikeValues = (value) => {
            if (value instanceof Map) return Array.from(value.values());
            if (value && typeof value === 'object') return Object.values(value);
            return [];
        };

        const hasMapLikeKey = (value, key) => {
            if (value instanceof Map) return value.has(key);
            if (value && typeof value === 'object') {
                return Object.prototype.hasOwnProperty.call(value, key);
            }
            return false;
        };

        const ensureStorageState = () => {
            if (typeof ctx.pendingStorageUpgrade !== 'boolean') {
                ctx.pendingStorageUpgrade = false;
            }
            if (typeof ctx.activeManagerInstanceToken !== 'number') {
                ctx.activeManagerInstanceToken = 0;
            }
            if (ctx.activeLoadStateRequestId == null) {
                ctx.activeLoadStateRequestId = null;
            }
            if (typeof ctx.nextLoadStateRequestId !== 'number') {
                ctx.nextLoadStateRequestId = 1;
            }
            if (typeof ctx.isAwaitingInitialStateLoad !== 'boolean') {
                ctx.isAwaitingInitialStateLoad = false;
            }
        };

        ensureStorageState();

        function hasRestorableStateSnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return false;
            if (Array.isArray(snapshot.groups) && snapshot.groups.length > 0) return true;
            if (snapshot.groupsById && getMapLikeEntries(snapshot.groupsById).length > 0) return true;
            if (Array.isArray(snapshot.ungrouped) && snapshot.ungrouped.length > 0) return true;
            if (snapshot.sourceStateById && getMapLikeEntries(snapshot.sourceStateById).length > 0) return true;
            if (snapshot.tagsById && getMapLikeEntries(snapshot.tagsById).length > 0) return true;
            if (Array.isArray(snapshot.tagOrder) && snapshot.tagOrder.length > 0) return true;
            if (snapshot.sourceTagsById && getMapLikeEntries(snapshot.sourceTagsById).length > 0) return true;
            return false;
        }

        function getStateBackupKey(primaryKey) {
            return `${primaryKey}__backup`;
        }

        function pickPreferredStoredState(primaryState, backupState) {
            if (hasRestorableStateSnapshot(primaryState)) {
                return primaryState;
            }

            if (hasRestorableStateSnapshot(backupState)) {
                if (primaryState && typeof primaryState === 'object' && primaryState.customHeight != null) {
                    return {
                        ...backupState,
                        customHeight: primaryState.customHeight
                    };
                }
                return backupState;
            }

            return primaryState ?? null;
        }

        function writeStateToLocalStorage(key, data) {
            if (!chromeApi?.storage?.local?.set) return;

            const payload = { [key]: data };
            if (hasRestorableStateSnapshot(data)) {
                payload[`${key}__backup`] = data;
            }

            try {
                chromeApi.storage.local.set(payload, () => {
                    if (chromeApi.runtime?.lastError) {
                        console.warn('NotebookLM Source Management: Local storage write failed:', chromeApi.runtime.lastError);
                    }
                });
            } catch (error) {
                console.warn('NotebookLM Source Management: Local storage write threw:', error);
            }
        }

        function sendStateToStorage(key, data, options = {}) {
            const { skipRuntimeMessage = false } = options;
            writeStateToLocalStorage(key, data);

            if (skipRuntimeMessage) {
                return;
            }

            if (!chromeApi?.runtime?.sendMessage) {
                return;
            }

            try {
                chromeApi.runtime.sendMessage({ type: 'SAVE_STATE', key, data }, (response) => {
                    if (chromeApi.runtime.lastError) {
                        console.error('NotebookLM Source Management 通信失败:', chromeApi.runtime.lastError);
                        return;
                    }

                    if (response && response.success === false) {
                        console.warn('NotebookLM Source Management: SAVE_STATE rejected by background:', response.errorCode || 'unknown_error');
                    }
                });
            } catch (error) {
                console.warn('NotebookLM Source Management: Context invalidated. Please refresh the page.', error);
            }
        }

        const debouncedStorageSet = typeof debounceFn === 'function'
            ? debounceFn((key, data) => {
                sendStateToStorage(key, data);
            }, 1500)
            : Object.assign((key, data) => {
                sendStateToStorage(key, data);
            }, {
                flush: () => false,
                cancel: () => {}
            });

        function flushPendingStateSave() {
            if (typeof debouncedStorageSet.flush === 'function') {
                return debouncedStorageSet.flush();
            }
            return false;
        }

        function cancelPendingStateSave() {
            if (typeof debouncedStorageSet.cancel === 'function') {
                debouncedStorageSet.cancel();
            }
        }

        function invalidateManagerInstance() {
            ctx.activeManagerInstanceToken += 1;
            ctx.activeLoadStateRequestId = null;
        }

        function isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, expectedRequestId) {
            return Boolean(
                ctx.projectId &&
                expectedProjectId &&
                ctx.projectId === expectedProjectId &&
                expectedInstanceToken === ctx.activeManagerInstanceToken &&
                expectedRequestId === ctx.activeLoadStateRequestId &&
                ctx.shadowRoot &&
                (!ctx.shadowRoot.host || ctx.shadowRoot.host.isConnected !== false)
            );
        }

        function buildPersistableState() {
            const state = getState();
            const sourcesByKey = ctx.sourcesByKey instanceof Map ? ctx.sourcesByKey : new Map(getMapLikeEntries(ctx.sourcesByKey));
            const tagsById = ctx.tagsById instanceof Map ? ctx.tagsById : new Map(getMapLikeEntries(ctx.tagsById));
            const groupsById = ctx.groupsById instanceof Map ? ctx.groupsById : new Map(getMapLikeEntries(ctx.groupsById));
            const sourceStateById = {};
            const persistedSourceTagsById = {};

            sourcesByKey.forEach((source, sourceKey) => {
                sourceStateById[sourceKey] = {
                    enabled: Boolean(source.enabled),
                    title: source.title,
                    normalizedTitle: source.normalizedTitle || normalizeSourceText(source.title),
                    stableToken: source.stableToken || '',
                    fingerprint: source.fingerprint || '',
                    identityType: source.identityType || 'fingerprint'
                };

                const tagIds = getSourceTagIds(sourceKey);
                if (tagIds.length > 0) {
                    persistedSourceTagsById[sourceKey] = tagIds;
                }
            });

            return {
                schemaVersion: storageSchemaVersion,
                groups: Array.isArray(state.groups) ? state.groups : [],
                groupsById: Object.fromEntries(groupsById),
                ungrouped: Array.isArray(state.ungrouped) ? state.ungrouped : [],
                sourceStateById,
                customHeight: ctx.customHeight ?? null,
                tagsById: Object.fromEntries(
                    Array.from(tagsById.entries())
                        .map(([tagId, tag]) => [tagId, getSerializedTag(tag)])
                        .filter(([, tag]) => Boolean(tag))
                ),
                tagOrder: Array.isArray(state.tagOrder) ? state.tagOrder.filter((tagId) => hasMapLikeKey(tagsById, tagId)) : [],
                sourceTagsById: persistedSourceTagsById
            };
        }

        function getBestPersistableSnapshot() {
            if (ctx.pendingInitialLoadedState && hasPersistableManagerState(ctx.pendingInitialLoadedState)) {
                return cloneSerializableData(ctx.pendingInitialLoadedState);
            }

            if (ctx.pendingPanelReattachState && hasPersistableManagerState(ctx.pendingPanelReattachState)) {
                return cloneSerializableData(ctx.pendingPanelReattachState);
            }

            const liveSnapshot = buildPersistableState();
            if (hasPersistableManagerState(liveSnapshot)) {
                return cloneSerializableData(liveSnapshot);
            }

            return liveSnapshot;
        }

        function saveState(options = {}) {
            if (!ctx.projectId || !canPersistManagerState()) return;
            const { immediate = false } = options;
            const key = `sourcesPlusState_${ctx.projectId}`;
            const persistableState = buildPersistableState();

            if (immediate) {
                cancelPendingStateSave();
                sendStateToStorage(key, persistableState);
                return;
            }

            debouncedStorageSet(key, persistableState);
        }

        function handlePageLifecyclePersistence(event) {
            if (event?.type === 'visibilitychange' && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
                return;
            }

            flushPendingStateSave();

            if (!ctx.projectId) {
                return;
            }

            const persistableState = getBestPersistableSnapshot();
            if (!canPersistManagerState() && !hasPersistableManagerState(persistableState)) {
                return;
            }

            const key = `sourcesPlusState_${ctx.projectId}`;
            writeStateToLocalStorage(key, persistableState);
        }

        function normalizeLoadedState(stateData) {
            if (!stateData || typeof stateData !== 'object') return null;

            if (stateData.schemaVersion === storageSchemaVersion) {
                ctx.pendingStorageUpgrade = false;
                return {
                    schemaVersion: storageSchemaVersion,
                    groups: Array.isArray(stateData.groups) ? stateData.groups : [],
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: stateData.customHeight ?? null,
                    tagsById: stateData.tagsById || {},
                    tagOrder: Array.isArray(stateData.tagOrder) ? stateData.tagOrder : [],
                    sourceTagsById: stateData.sourceTagsById || {}
                };
            }

            ctx.pendingStorageUpgrade = true;
            if (stateData.schemaVersion === 2) {
                return {
                    schemaVersion: 2,
                    groups: Array.isArray(stateData.groups) ? stateData.groups : [],
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: stateData.customHeight ?? null,
                    tagsById: {},
                    tagOrder: [],
                    sourceTagsById: {}
                };
            }

            return {
                schemaVersion: 1,
                groups: Array.isArray(stateData.groups) ? stateData.groups : [],
                groupsById: stateData.groupsById || {},
                ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                legacyEnabledMap: stateData.enabledMap || {},
                customHeight: stateData.customHeight ?? null,
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            };
        }

        function hasPreservableManagerSnapshot() {
            if (ctx.pendingInitialLoadedState && hasPersistableManagerState(ctx.pendingInitialLoadedState)) {
                return true;
            }

            if (ctx.pendingPanelReattachState && hasPersistableManagerState(ctx.pendingPanelReattachState)) {
                return true;
            }

            return hasPersistableManagerState(buildPersistableState());
        }

        function canPersistManagerState() {
            if (!ctx.projectId || ctx.managerStatusReason === 'source_detail_view') {
                return false;
            }

            const sourcePanel = findSourcePanel();
            const panelState = getSourcePanelState(sourcePanel);
            if (panelState.state === 'missing' || panelState.state === 'collapsed') {
                return true;
            }

            return panelState.state === 'ready';
        }

        function hasPersistedSourceRefs(loadedState) {
            if (!loadedState || typeof loadedState !== 'object') return false;

            const hasGroupedSources = getMapLikeValues(loadedState.groupsById || {}).some((group) => (
                Array.isArray(group?.children) && group.children.some((child) => child?.type === 'source')
            ));
            if (hasGroupedSources) return true;

            if (Array.isArray(loadedState.ungrouped) && loadedState.ungrouped.length > 0) {
                return true;
            }

            return Boolean(
                loadedState.sourceStateById &&
                getMapLikeEntries(loadedState.sourceStateById).length > 0
            );
        }

        function hasPersistableManagerState(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return false;
            if (hasPersistedSourceRefs(snapshot)) return true;
            if (Array.isArray(snapshot.groups) && snapshot.groups.length > 0) return true;
            if (snapshot.groupsById && getMapLikeEntries(snapshot.groupsById).length > 0) return true;
            if (snapshot.tagsById && getMapLikeEntries(snapshot.tagsById).length > 0) return true;
            if (Array.isArray(snapshot.tagOrder) && snapshot.tagOrder.length > 0) return true;
            return snapshot.customHeight != null;
        }

        function capturePendingPanelReattachState() {
            const bestSnapshot = getBestPersistableSnapshot();
            return hasPersistableManagerState(bestSnapshot) ? bestSnapshot : null;
        }

        function restoreInitialLoadedState(loadedState) {
            if (
                loadedState &&
                hasPersistedSourceRefs(loadedState) &&
                (
                    !hasRenderableSourceRows() ||
                    getSourcePanelState(findSourcePanel()).state !== 'ready'
                )
            ) {
                ctx.pendingInitialLoadedState = loadedState;
                return { deferred: true, shouldUpgradeStorage: false };
            }

            const shouldUpgradeStorage = scanAndSyncSources(loadedState, true);
            ctx.pendingInitialLoadedState = null;
            return { deferred: false, shouldUpgradeStorage };
        }

        function flushPendingInitialLoadedState() {
            if (!ctx.pendingInitialLoadedState) {
                return { restored: false, deferred: false, shouldUpgradeStorage: false };
            }

            if (!hasRenderableSourceRows() || getSourcePanelState(findSourcePanel()).state !== 'ready') {
                return { restored: false, deferred: true, shouldUpgradeStorage: false };
            }

            const shouldUpgradeStorage = scanAndSyncSources(ctx.pendingInitialLoadedState, true);
            ctx.pendingInitialLoadedState = null;
            return { restored: true, deferred: false, shouldUpgradeStorage };
        }

        function applyLoadedStateToManager(loadedState) {
            if (!ctx.shadowRoot || (ctx.shadowRoot.host && ctx.shadowRoot.host.isConnected === false)) {
                return;
            }

            if (loadedState && loadedState.customHeight != null) {
                ctx.customHeight = loadedState.customHeight;
                const container = ctx.shadowRoot?.querySelector('.sp-container');
                if (container) container.style.height = `${ctx.customHeight}px`;
            }

            const initialRestore = restoreInitialLoadedState(loadedState);
            if (initialRestore.deferred) {
                render();
                return;
            }

            render();
            if (initialRestore.shouldUpgradeStorage) {
                ctx.pendingStorageUpgrade = false;
                saveState();
            }
        }

        function loadState(callback, options = {}) {
            if (!ctx.projectId) {
                ctx.pendingStorageUpgrade = false;
                ctx.isAwaitingInitialStateLoad = false;
                return callback(null);
            }

            const expectedProjectId = typeof options.expectedProjectId === 'string' ? options.expectedProjectId : ctx.projectId;
            const expectedInstanceToken = typeof options.instanceToken === 'number' ? options.instanceToken : ctx.activeManagerInstanceToken;
            const requestId = ctx.nextLoadStateRequestId++;
            ctx.activeLoadStateRequestId = requestId;
            const key = `sourcesPlusState_${expectedProjectId}`;

            const finalizeLoadedState = (rawState) => {
                if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                    return;
                }

                if (ctx.activeLoadStateRequestId === requestId) {
                    ctx.activeLoadStateRequestId = null;
                }

                const loadedState = normalizeLoadedState(rawState);
                if (loadedState && loadedState.customHeight != null) {
                    ctx.customHeight = loadedState.customHeight;
                    const container = ctx.shadowRoot?.querySelector('.sp-container');
                    if (container) container.style.height = `${ctx.customHeight}px`;
                }

                callback(loadedState);
            };

            const fallbackToRuntimeLoad = () => {
                if (!chromeApi?.runtime?.sendMessage) {
                    ctx.pendingStorageUpgrade = false;
                    if (ctx.activeLoadStateRequestId === requestId) {
                        ctx.activeLoadStateRequestId = null;
                    }
                    return callback(null);
                }

                try {
                    chromeApi.runtime.sendMessage({ type: 'LOAD_STATE', key }, (response) => {
                        if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                            return;
                        }

                        if (ctx.activeLoadStateRequestId === requestId) {
                            ctx.activeLoadStateRequestId = null;
                        }

                        if (chromeApi.runtime.lastError) {
                            console.warn('NotebookLM Source Management 未能连接后台:', chromeApi.runtime.lastError);
                            ctx.pendingStorageUpgrade = false;
                            return callback(null);
                        }

                        if (response && response.success === false) {
                            console.warn('NotebookLM Source Management: LOAD_STATE rejected by background:', response.errorCode || 'unknown_error');
                            ctx.pendingStorageUpgrade = false;
                            return callback(null);
                        }

                        finalizeLoadedState(response && response.data);
                    });
                } catch (error) {
                    console.warn('NotebookLM Source Management: Context invalidated during load. Please refresh the page.', error);
                    ctx.pendingStorageUpgrade = false;
                    if (ctx.activeLoadStateRequestId === requestId) {
                        ctx.activeLoadStateRequestId = null;
                    }
                    callback(null);
                }
            };

            if (chromeApi?.storage?.local?.get) {
                try {
                    const backupKey = getStateBackupKey(key);
                    chromeApi.storage.local.get([key, backupKey], (data) => {
                        if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                            return;
                        }

                        if (chromeApi.runtime?.lastError) {
                            console.warn('NotebookLM Source Management: Local storage load failed, falling back to runtime messaging:', chromeApi.runtime.lastError);
                            fallbackToRuntimeLoad();
                            return;
                        }

                        const primaryState = data && typeof data === 'object' ? data[key] : null;
                        const backupState = data && typeof data === 'object' ? data[backupKey] : null;
                        finalizeLoadedState(pickPreferredStoredState(primaryState, backupState));
                    });
                    return;
                } catch (error) {
                    console.warn('NotebookLM Source Management: Local storage load threw, falling back to runtime messaging:', error);
                }
            }

            fallbackToRuntimeLoad();
        }

        function getSourceElements(parent = typeof document !== 'undefined' ? document : null) {
            if (typeof ctx.getSourceElements === 'function') {
                return ctx.getSourceElements(parent);
            }
            return [];
        }

        function getManageableSourceElements(parent = typeof document !== 'undefined' ? document : null) {
            if (typeof ctx.getManageableSourceElements === 'function') {
                return ctx.getManageableSourceElements(parent);
            }
            return getSourceElements(parent);
        }

        return {
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
            getBestPersistableSnapshot,
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
        };
    }

    globalThis.NSM_CREATE_CONTENT_PERSISTENCE = createContentPersistence;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentPersistence;
    }
})();
