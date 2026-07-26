(function () {
    'use strict';

    if (
        typeof globalThis.NSM_CREATE_STORAGE_CONTRACT !== 'function'
        && typeof require !== 'undefined'
    ) {
        require('../utils/storage-contract.js');
    }
    const storageContract = globalThis.NSM_CREATE_STORAGE_CONTRACT();

    /**
     * createContentPersistence(context) — chrome.storage.local 持久层 + load/save 队列 + 历史 + recovery。
     * 最大的 content module,集中了所有持久化决策:
     *  - Build / 序列化:`buildPersistableState` 把 runtime(groups/groupsById/sourcesByKey/tagsById/...)
     *    展平成 plain JSON snapshot,带 _saveRevision/_savedAt + schemaVersion。
     *  - 写入路径:`enqueueStateSave` debounce 写;`saveState` 一次性写;
     *    `sendStateToStorage` 经 chrome.runtime 走 SW 队列(SW 用 _saveRevision 拒绝过期);
     *    `writeStateToLocalStorage` 是 local fallback。两条路径都同时把 backup snapshot 落盘。
     *  - 读取路径:`loadState` 拉取 primary + backup + history,经
     *    `pickPreferredStoredState` 选最佳,`normalizeLoadedState` 兼容老 schema,
     *    最后 `applyLoadedStateToManager` 调下游 state-apply 灌回 runtime。
     *  - 历史:`appendStateHistorySnapshot` per-notebook ring buffer(retention 来自
     *    getHistoryRetentionLimit);`getStateHistoryEntries` 是 UI history panel 数据源。
     *  - Recovery:`writeRecoverySnapshot` / `readRecoverySnapshot` /
     *    `detectRecoverySnapshotAvailability` 处理崩溃恢复。
     *  - Save status 流:saving/saved/failed/stale/recovery_available — 通过 onSaveStatusChange 回调。
     *
     * @param {Object} context 命名为 `context`(不是 deps)。完整 deps 见 line 4+ 的 const 块,主要分类:
     *   - chrome / storageSchemaVersion / debounce
     *   - state getters: getState (lazy), state initial,getHistoryRetentionLimit
     *   - normalize / build helpers: normalizeSourceText, getSourceTagIds, getSerializedTag,
     *     buildNormalizedTagState, appendGroupChildIfAcyclic, cloneSerializableData
     *   - NotebookLM 侧:scanAndSyncSources, findSourcePanel, getSourcePanelState, hasRenderableSourceRows
     *   - UI 回调:render, getMessage, showToast, developerLog, onSaveStatusChange
     *   - 内部依赖:globalThis.NSM_CREATE_CONTENT_SNAPSHOT_SIGNATURE(必须先加载)
     * @returns {Object} ~40+ 方法,分四类:
     *   - 序列化 / 比较:buildPersistableState, preparePersistableSnapshot, prepareRuntimeSaveSnapshot,
     *     hasRestorableStateSnapshot, hasPersistableManagerState, getBestPersistableSnapshot,
     *     getSnapshotSaveRevision, normalizeLoadedState
     *   - 存储 IO:writeStateToLocalStorage, sendStateToStorage, enqueueStateSave,
     *     waitForPendingStateSave, flushPendingStateSave, cancelPendingStateSave, saveState
     *   - History / Backup:getStateBackupKey, getStateHistoryKey, get/setStateHistoryEntries,
     *     loadStateHistory, appendStateHistorySnapshot, pickPreferredStoredState
     *   - Recovery:getRecoveryKey, write/read/clearRecoverySnapshot, detectRecoverySnapshotAvailability,
     *     handlePageLifecyclePersistence
     *   - Load / Apply 流:loadState, applyLoadedStateToManager, restoreInitialLoadedState,
     *     flushPendingInitialLoadedState, restorePersistedSnapshotWithoutDom, shouldDeferInitialRestore,
     *     capturePendingPanelReattachState, isLiveManagerLoadRequest, invalidateManagerInstance
     *   - 状态查询:getSaveStatus, setSaveStatus, hasPreservableManagerSnapshot, canPersistManagerState,
     *     hasPersistedSourceRefs, getPersistedSourceRefCount
     *   完整 return 块见 line 1648。
     */
    function createContentPersistence(context = {}) {
        const ctx = context && typeof context === 'object' ? context : {};
        const chromeApi = ctx.chrome ?? globalThis.chrome;
        const debounceFn = ctx.debounce ?? globalThis.debounce;
        const storageSchemaVersion = ctx.storageSchemaVersion
            ?? storageContract.STORAGE_SCHEMA_VERSION;
        const normalizeSourceText = typeof ctx.normalizeSourceText === 'function'
            ? ctx.normalizeSourceText
            : (value) => String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();
        const getSourceTagIds = typeof ctx.getSourceTagIds === 'function' ? ctx.getSourceTagIds : () => [];
        const getSerializedTag = typeof ctx.getSerializedTag === 'function' ? ctx.getSerializedTag : (tag) => tag;
        const buildNormalizedTagState = typeof ctx.buildNormalizedTagState === 'function'
            ? ctx.buildNormalizedTagState
            : null;
        const appendGroupChildIfAcyclic = typeof ctx.appendGroupChildIfAcyclic === 'function'
            ? ctx.appendGroupChildIfAcyclic
            : null;
        const scanAndSyncSources = typeof ctx.scanAndSyncSources === 'function' ? ctx.scanAndSyncSources : () => false;
        const findSourcePanel = typeof ctx.findSourcePanel === 'function' ? ctx.findSourcePanel : () => null;
        const getSourcePanelState = typeof ctx.getSourcePanelState === 'function'
            ? ctx.getSourcePanelState
            : () => ({ state: 'ready' });
        const hasRenderableSourceRows = typeof ctx.hasRenderableSourceRows === 'function' ? ctx.hasRenderableSourceRows : () => false;
        const render = typeof ctx.render === 'function' ? ctx.render : () => {};
        const getMessage = typeof ctx.getMessage === 'function' ? ctx.getMessage : (key) => key;
        const showToast = typeof ctx.showToast === 'function' ? ctx.showToast : () => {};
        const developerLog = typeof ctx.developerLog === 'function' ? ctx.developerLog : () => false;
        const getHistoryRetentionLimit = typeof ctx.getHistoryRetentionLimit === 'function'
            ? ctx.getHistoryRetentionLimit
            : () => 20;
        const onSaveStatusChange = typeof ctx.onSaveStatusChange === 'function'
            ? ctx.onSaveStatusChange
            : () => {};
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

        const createSnapshotSignatureFactory = globalThis.NSM_CREATE_CONTENT_SNAPSHOT_SIGNATURE;
        if (typeof createSnapshotSignatureFactory !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentPersistence requires NSM_CREATE_CONTENT_SNAPSHOT_SIGNATURE to be loaded first.');
        }
        const {
            isStorageQuotaError,
            getStorageMetadataFromResponse,
            getStorageMetadataFromResult,
            getSnapshotSaveRevision,
            isStaleStateWrite,
            getPersistableSnapshotSignature,
            arePersistableSnapshotsEquivalent
        } = createSnapshotSignatureFactory();

        const getState = () => {
            if (!ctx.state || typeof ctx.state !== 'object') {
                ctx.state = {
                    root: [],
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

        const createStateRepairFactory = globalThis.NSM_CREATE_CONTENT_STATE_REPAIR;
        if (typeof createStateRepairFactory !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentPersistence requires NSM_CREATE_CONTENT_STATE_REPAIR to be loaded first.');
        }
        const {
            collectSnapshotGroupedSourceKeys,
            createStructurallyRepairedState,
            findStructuralRepairCandidate
        } = createStateRepairFactory({
            cloneSerializableData,
            hasRestorableStateSnapshot,
            getMapLikeEntries,
            normalizeStateHistoryEntries,
            getSnapshotSaveRevision
        });

        const normalizeSourceViewDisplayKind = (value) => (
            value === 'label' || value === 'list' ? value : ''
        );

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
            if (typeof ctx.lastKnownSaveRevision !== 'number') {
                ctx.lastKnownSaveRevision = 0;
            }
        };

        ensureStorageState();
        let saveQueueTail = null;
        let nextClientSaveId = 1;
        const saveRevisionByStateKey = new Map();
        let futureSchemaWriteBlocked = false;
        let schemaWriteScopeProjectId = '';
        let schemaWriteScopeInstanceToken = null;
        let schemaWriteScopeGeneration = 0;

        const DEFAULT_SAVE_STATUS = {
            state: 'idle',
            lastSavedAt: '',
            lastSaveRevision: 0,
            lastError: '',
            currentRevision: 0,
            recoveryAvailable: false,
            recoveryCreatedAt: '',
            clientSaveId: '',
            storageUsageBytes: 0,
            storageQuotaBytes: 0,
            storageUsageRatio: 0,
            storageWarning: false,
            lastStorageError: '',
            historyEntryCount: 0,
            lastStaleLocalRevision: 0,
            lastStaleRemoteRevision: 0,
            lastStaleDetectedAt: ''
        };

        function getSaveStatus() {
            if (!ctx.saveStatus || typeof ctx.saveStatus !== 'object') {
                ctx.saveStatus = { ...DEFAULT_SAVE_STATUS };
            }
            return ctx.saveStatus;
        }

        function setSaveStatus(nextStatus = {}) {
            const currentStatus = getSaveStatus();
            ctx.saveStatus = Object.assign({}, currentStatus, nextStatus);
            try {
                onSaveStatusChange(cloneSerializableData(ctx.saveStatus));
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Save status update failed:', error);
            }
            return ctx.saveStatus;
        }

        function getSessionStorage() {
            const storage = ctx.sessionStorage
                || globalThis.sessionStorage
                || globalThis.window?.sessionStorage;
            return storage && typeof storage.getItem === 'function' ? storage : null;
        }

        const stateKeyForProject = (projectId = ctx.projectId) => (
            storageContract.getStateKey(projectId)
        );

        function getProjectIdFromStateKey(stateKey) {
            const value = String(stateKey || '');
            return value.startsWith(storageContract.STATE_KEY_PREFIX)
                ? value.slice(storageContract.STATE_KEY_PREFIX.length)
                : '';
        }

        function getSaveRevisionForStateKey(stateKey = stateKeyForProject()) {
            if (!stateKey) return 0;
            return Number(saveRevisionByStateKey.get(stateKey)) || 0;
        }

        function setSaveRevisionForStateKey(stateKey, revision) {
            if (!stateKey) return 0;
            const nextRevision = Math.max(
                getSaveRevisionForStateKey(stateKey),
                Number(revision) || 0
            );
            saveRevisionByStateKey.set(stateKey, nextRevision);
            if (stateKey === stateKeyForProject()) {
                ctx.lastKnownSaveRevision = nextRevision;
            }
            return nextRevision;
        }

        function rememberSnapshotSaveRevision(snapshot, stateKey = stateKeyForProject()) {
            const revision = getSnapshotSaveRevision(snapshot);
            return setSaveRevisionForStateKey(stateKey, revision);
        }

        function preparePersistableSnapshot(rawSnapshot, stateKey = stateKeyForProject()) {
            const snapshot = cloneSerializableData(rawSnapshot || {});
            const nextRevision = Math.max(
                getSaveRevisionForStateKey(stateKey),
                getSnapshotSaveRevision(snapshot)
            ) + 1;
            setSaveRevisionForStateKey(stateKey, nextRevision);
            snapshot._saveRevision = nextRevision;
            snapshot._savedAt = new Date().toISOString();
            return snapshot;
        }

        function prepareRuntimeSaveSnapshot(rawSnapshot) {
            const snapshot = cloneSerializableData(rawSnapshot || {});
            delete snapshot._saveRevision;
            delete snapshot._savedAt;
            return snapshot;
        }

        function createClientSaveId(projectId = ctx.projectId) {
            const prefix = String(projectId || 'project');
            const value = `${prefix}:${Date.now()}:${nextClientSaveId}`;
            nextClientSaveId += 1;
            return value;
        }

        const recoveryKeyForProject = (projectId = ctx.projectId) => (
            storageContract.getRecoveryKey(projectId)
        );

        function resolveRecoveryKey(projectIdOrRecoveryKey = ctx.projectId) {
            const value = String(projectIdOrRecoveryKey || '');
            if (value.startsWith(storageContract.RECOVERY_KEY_PREFIX)) return value;
            return recoveryKeyForProject(value);
        }

        function isImportOwnedRecovery(recovery) {
            return Boolean(
                recovery
                && [
                    'import_pending',
                    'import_ack_unknown',
                    'import_rollback_required'
                ].includes(recovery.reason)
            );
        }

        function writeRecoverySnapshot(rawSnapshot, options = {}) {
            const storage = getSessionStorage();
            const key = resolveRecoveryKey(options.recoveryKey || ctx.projectId);
            if (!storage || !key || !rawSnapshot) return false;
            if (options.expectedClientSaveId) {
                const currentRecovery = readRecoverySnapshot(key);
                if (
                    currentRecovery?.clientSaveId
                    && currentRecovery.clientSaveId !== options.expectedClientSaveId
                ) {
                    return false;
                }
            }

            const payload = {
                snapshot: cloneSerializableData(rawSnapshot),
                baseRevision: options.baseRevision == null
                    ? getSaveRevisionForStateKey()
                    : (Number(options.baseRevision) || 0),
                createdAt: new Date().toISOString(),
                reason: typeof options.reason === 'string' ? options.reason : 'critical_save',
                clientSaveId: typeof options.clientSaveId === 'string'
                    ? options.clientSaveId
                    : createClientSaveId(),
                failed: Boolean(options.failed)
            };

            try {
                storage.setItem(key, JSON.stringify(payload));
                if (key === recoveryKeyForProject()) {
                    setSaveStatus({
                        recoveryAvailable: true,
                        recoveryCreatedAt: payload.createdAt
                    });
                }
                developerLog('info', 'persistence', 'recovery_snapshot_written', {
                    reason: payload.reason,
                    baseRevision: payload.baseRevision,
                    failed: payload.failed
                });
                return payload;
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Recovery snapshot write failed:', error);
                developerLog('error', 'persistence', 'recovery_snapshot_write_failed', { error });
                return false;
            }
        }

        function readRecoverySnapshot(projectIdOrRecoveryKey = ctx.projectId) {
            const storage = getSessionStorage();
            const key = resolveRecoveryKey(projectIdOrRecoveryKey);
            if (!storage || !key) return null;

            try {
                const rawValue = storage.getItem(key);
                if (!rawValue) return null;
                const parsed = JSON.parse(rawValue);
                if (!parsed || typeof parsed !== 'object' || !parsed.snapshot) return null;
                return parsed;
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Recovery snapshot read failed:', error);
                return null;
            }
        }

        function clearRecoverySnapshot(projectIdOrRecoveryKey = ctx.projectId, options = {}) {
            const storage = getSessionStorage();
            const key = resolveRecoveryKey(projectIdOrRecoveryKey);
            if (!storage || !key) return false;

            try {
                if (options.expectedClientSaveId) {
                    const currentRecovery = readRecoverySnapshot(key);
                    if (
                        currentRecovery?.clientSaveId
                        && currentRecovery.clientSaveId !== options.expectedClientSaveId
                    ) {
                        return false;
                    }
                }
                storage.removeItem(key);
                if (key === recoveryKeyForProject()) {
                    setSaveStatus({
                        recoveryAvailable: false,
                        recoveryCreatedAt: ''
                    });
                }
                return true;
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Recovery snapshot clear failed:', error);
                return false;
            }
        }

        function detectRecoverySnapshotAvailability(loadedState = null) {
            const recovery = readRecoverySnapshot();
            if (!recovery) {
                setSaveStatus({
                    recoveryAvailable: false,
                    recoveryCreatedAt: ''
                });
                return false;
            }

            if (isImportOwnedRecovery(recovery)) {
                setSaveStatus({
                    state: 'recovery_available',
                    recoveryAvailable: true,
                    recoveryCreatedAt: recovery.createdAt || '',
                    lastError: 'recovery_available'
                });
                return true;
            }

            if (loadedState && arePersistableSnapshotsEquivalent(recovery.snapshot, loadedState)) {
                clearRecoverySnapshot();
                return false;
            }

            const loadedRevision = getSnapshotSaveRevision(loadedState);
            const recoveryBaseRevision = Number(recovery.baseRevision) || 0;
            const shouldOfferRecovery = !loadedState || recovery.failed || loadedRevision <= recoveryBaseRevision;
            if (shouldOfferRecovery) {
                setSaveStatus({
                    state: 'recovery_available',
                    recoveryAvailable: true,
                    recoveryCreatedAt: recovery.createdAt || '',
                    lastError: 'recovery_available'
                });
                return true;
            }

            clearRecoverySnapshot();
            return false;
        }

        function getSnapshotSavedAtTimestamp(snapshot) {
            const timestamp = Date.parse(
                typeof snapshot?._savedAt === 'string' ? snapshot._savedAt : ''
            );
            return Number.isFinite(timestamp) ? timestamp : 0;
        }

        function compareRawStateAuthority(primaryState, backupState) {
            const hasPrimary = primaryState != null;
            const hasBackup = backupState != null;
            if (!hasPrimary && !hasBackup) return 0;
            if (hasPrimary && !hasBackup) return 1;
            if (!hasPrimary && hasBackup) return -1;

            const primaryRevision = getSnapshotSaveRevision(primaryState);
            const backupRevision = getSnapshotSaveRevision(backupState);
            if (primaryRevision !== backupRevision) {
                return primaryRevision > backupRevision ? 1 : -1;
            }

            const primarySavedAt = getSnapshotSavedAtTimestamp(primaryState);
            const backupSavedAt = getSnapshotSavedAtTimestamp(backupState);
            if (primarySavedAt !== backupSavedAt) {
                return primarySavedAt > backupSavedAt ? 1 : -1;
            }

            return 0;
        }

        function pickAuthoritativeRawState(primaryState, backupState) {
            const authorityComparison = compareRawStateAuthority(primaryState, backupState);
            if (authorityComparison < 0) return backupState;
            if (authorityComparison > 0) return primaryState;

            const backupCompatibility = storageContract.getStateSchemaCompatibility(backupState);
            if (backupCompatibility === 'future' || backupCompatibility === 'invalid') {
                return backupState;
            }
            return primaryState ?? backupState ?? null;
        }

        function hasRestorableStateSnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return false;
            if (Array.isArray(snapshot.groups) && snapshot.groups.length > 0) return true;
            if (Array.isArray(snapshot.root) && snapshot.root.length > 0) return true;
            if (snapshot.groupsById && getMapLikeEntries(snapshot.groupsById).length > 0) return true;
            if (Array.isArray(snapshot.ungrouped) && snapshot.ungrouped.length > 0) return true;
            if (snapshot.sourceStateById && getMapLikeEntries(snapshot.sourceStateById).length > 0) return true;
            if (snapshot.tagsById && getMapLikeEntries(snapshot.tagsById).length > 0) return true;
            if (Array.isArray(snapshot.tagOrder) && snapshot.tagOrder.length > 0) return true;
            if (snapshot.sourceTagsById && getMapLikeEntries(snapshot.sourceTagsById).length > 0) return true;
            return false;
        }

        const historyKeyForProject = (projectId = ctx.projectId) => (
            storageContract.getStateHistoryKey(stateKeyForProject(projectId))
        );

        function getStateHistorySnapshotSignature(snapshot) {
            return getPersistableSnapshotSignature(snapshot);
        }

        function getPersistableStateCounts(snapshot) {
            return {
                sourceCount: getMapLikeEntries(snapshot?.sourceStateById || {}).length,
                groupCount: getMapLikeEntries(snapshot?.groupsById || {}).length,
                tagCount: getMapLikeEntries(snapshot?.tagsById || {}).length
            };
        }

        function normalizeStateHistoryEntries(entries) {
            const list = Array.isArray(entries) ? entries : [];
            return trimStateHistoryEntries(list
                .filter((entry) => entry && typeof entry === 'object' && entry.snapshot && hasPersistableManagerState(entry.snapshot))
                .map((entry) => ({
                    id: typeof entry.id === 'string' && entry.id ? entry.id : `history-${Date.now()}-${Math.random()}`,
                    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
                    reason: typeof entry.reason === 'string' ? entry.reason : 'manual',
                    sourceCount: Number(entry.sourceCount) || getPersistableStateCounts(entry.snapshot).sourceCount,
                    groupCount: Number(entry.groupCount) || getPersistableStateCounts(entry.snapshot).groupCount,
                    tagCount: Number(entry.tagCount) || getPersistableStateCounts(entry.snapshot).tagCount,
                    saveRevision: getSnapshotSaveRevision(entry.snapshot) || Number(entry.saveRevision) || 0,
                    label: typeof entry.label === 'string' ? entry.label.slice(0, 48) : '',
                    manual: Boolean(entry.manual),
                    snapshot: cloneSerializableData(entry.snapshot)
                })));
        }

        function setStateHistoryEntries(entries) {
            ctx.stateHistoryEntries = normalizeStateHistoryEntries(entries);
            return ctx.stateHistoryEntries;
        }

        function getStateHistoryEntries() {
            return normalizeStateHistoryEntries(ctx.stateHistoryEntries || []);
        }

        function loadStateHistory(projectId = ctx.projectId) {
            const key = historyKeyForProject(projectId);
            if (!key) {
                return Promise.resolve(setStateHistoryEntries([]));
            }

            const readLocalHistory = () => new Promise((resolve) => {
                if (!chromeApi?.storage?.local?.get) {
                    resolve(setStateHistoryEntries([]));
                    return;
                }

                try {
                    chromeApi.storage.local.get([key], (data) => {
                        if (chromeApi.runtime?.lastError) {
                            resolve(setStateHistoryEntries([]));
                            return;
                        }
                        resolve(setStateHistoryEntries(data?.[key] || []));
                    });
                } catch (error) {
                    resolve(setStateHistoryEntries([]));
                }
            });

            if (!chromeApi?.runtime?.sendMessage) {
                return readLocalHistory();
            }

            return new Promise((resolve) => {
                try {
                    chromeApi.runtime.sendMessage({ type: 'LOAD_STATE_HISTORY', key }, (response) => {
                        if (chromeApi.runtime.lastError || !response || response.success === false) {
                            readLocalHistory().then(resolve);
                            return;
                        }
                        resolve(setStateHistoryEntries(response.history || []));
                    });
                } catch (error) {
                    readLocalHistory().then(resolve);
                }
            });
        }

        function normalizeHistoryRetentionLimit(value) {
            const limit = Number(value);
            return limit === 20 || limit === 50 || limit === 100 ? limit : 20;
        }

        function trimStateHistoryEntries(entries) {
            const limit = normalizeHistoryRetentionLimit(getHistoryRetentionLimit());
            const normalizedEntries = Array.isArray(entries) ? entries : [];
            if (normalizedEntries.length <= limit) return normalizedEntries;
            const manualEntries = normalizedEntries.filter((entry) => entry?.manual);
            if (manualEntries.length >= limit) return manualEntries.slice(0, limit);
            let automaticCount = 0;
            const automaticLimit = limit - manualEntries.length;
            return normalizedEntries.filter((entry) => {
                if (entry?.manual) return true;
                if (automaticCount >= automaticLimit) return false;
                automaticCount += 1;
                return true;
            });
        }

        function appendStateHistorySnapshot(snapshot = buildPersistableState(), reason = 'manual', options = {}) {
            if (!ctx.projectId || !hasPersistableManagerState(snapshot)) {
                return Promise.resolve(getStateHistoryEntries());
            }

            const key = historyKeyForProject();
            const payloadSnapshot = cloneSerializableData(snapshot);
            const normalizedOptions = options && typeof options === 'object' ? options : {};
            const counts = getPersistableStateCounts(payloadSnapshot);
            const entry = {
                id: `${ctx.projectId}:${Date.now()}`,
                createdAt: new Date().toISOString(),
                reason,
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount,
                saveRevision: getSnapshotSaveRevision(payloadSnapshot),
                label: typeof normalizedOptions.label === 'string' ? normalizedOptions.label.slice(0, 48) : '',
                manual: Boolean(normalizedOptions.manual),
                snapshot: payloadSnapshot
            };
            developerLog('info', 'persistence', 'history_snapshot_append_requested', {
                reason,
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount,
                saveRevision: entry.saveRevision
            });

            const appendLocally = () => new Promise((resolve, reject) => {
                if (!chromeApi?.storage?.local?.get || !chromeApi?.storage?.local?.set) {
                    reject(new Error('storage_unavailable'));
                    return;
                }

                try {
                    chromeApi.storage.local.get([key], (data) => {
                        if (chromeApi.runtime?.lastError) {
                            reject(new Error('runtime_message_error'));
                            return;
                        }
                        const existingEntries = normalizeStateHistoryEntries(data?.[key] || []);
                        const nextSignature = getStateHistorySnapshotSignature(payloadSnapshot);
                        const nextEntries = [
                            entry,
                            ...existingEntries.filter((item) => (
                                getStateHistorySnapshotSignature(item.snapshot) !== nextSignature
                            ))
                        ];
                        const trimmedEntries = trimStateHistoryEntries(nextEntries);
                        chromeApi.storage.local.set({ [key]: trimmedEntries }, () => {
                            if (chromeApi.runtime?.lastError) {
                                reject(new Error('runtime_message_error'));
                                return;
                            }
                            resolve(setStateHistoryEntries(trimmedEntries));
                        });
                    });
                } catch (error) {
                    reject(error);
                }
            });

            if (!chromeApi?.runtime?.sendMessage) {
                return appendLocally();
            }

            return new Promise((resolve, reject) => {
                try {
                    chromeApi.runtime.sendMessage({
                        type: 'APPEND_STATE_HISTORY',
                        key,
                        entry
                    }, (response) => {
                        if (response && response.success === false) {
                            reject(new Error(response.errorCode || 'runtime_failure'));
                            return;
                        }
                        if (chromeApi.runtime.lastError || !response) {
                            appendLocally().then(resolve).catch((error) => {
                                reject(error instanceof Error ? error : new Error(response?.errorCode || 'runtime_message_error'));
                            });
                            return;
                        }
                        resolve(setStateHistoryEntries(response.history || []));
                    });
                } catch (error) {
                    appendLocally().then(resolve).catch(reject);
                }
            });
        }

        function pickPreferredStoredState(primaryState, backupState, historyEntries = []) {
            ctx.pendingStructuralStateRepair = null;
            const authorityComparison = compareRawStateAuthority(primaryState, backupState);
            let selectedState = null;
            if (authorityComparison < 0) {
                rememberSnapshotSaveRevision(backupState);
                selectedState = backupState;
            } else if (authorityComparison > 0) {
                rememberSnapshotSaveRevision(primaryState);
                selectedState = primaryState;
            } else if (hasRestorableStateSnapshot(primaryState)) {
                rememberSnapshotSaveRevision(primaryState);
                selectedState = primaryState;
            } else if (hasRestorableStateSnapshot(backupState)) {
                rememberSnapshotSaveRevision(backupState);
                if (primaryState && typeof primaryState === 'object' && primaryState.customHeight != null) {
                    selectedState = {
                        ...backupState,
                        customHeight: primaryState.customHeight
                    };
                } else {
                    selectedState = backupState;
                }
            } else {
                selectedState = primaryState ?? null;
            }

            const repairCandidate = findStructuralRepairCandidate(selectedState, backupState, historyEntries);
            if (repairCandidate) {
                const repairedState = createStructurallyRepairedState(selectedState, repairCandidate);
                const beforeCount = collectSnapshotGroupedSourceKeys(selectedState).size;
                const afterCount = collectSnapshotGroupedSourceKeys(repairedState).size;
                ctx.pendingStructuralStateRepair = {
                    repairedAt: new Date().toISOString(),
                    beforeGroupedSourceCount: beforeCount,
                    afterGroupedSourceCount: afterCount,
                    candidateRevision: getSnapshotSaveRevision(repairCandidate),
                    currentRevision: getSnapshotSaveRevision(selectedState),
                    reason: 'empty_group_children_repaired'
                };
                ctx.lastStructuralStateRepair = cloneSerializableData(ctx.pendingStructuralStateRepair);
                rememberSnapshotSaveRevision(repairedState);
                return repairedState;
            }

            return selectedState;
        }

        function writeStateToLocalStorage(key, data) {
            if (!chromeApi?.storage?.local?.set) {
                return Promise.resolve({ ok: false, reason: 'local_storage_unavailable' });
            }

            return new Promise((resolve) => {
                const backupKey = storageContract.getStateBackupKey(key);
                const writePayload = () => {
                    const payload = { [key]: data };
                    if (hasRestorableStateSnapshot(data)) {
                        payload[backupKey] = data;
                    }

                    chromeApi.storage.local.set(payload, () => {
                        if (chromeApi.runtime?.lastError) {
                            console.warn('GeminiNotebook-Source-Management: Local storage write failed:', chromeApi.runtime.lastError);
                            resolve({
                                ok: false,
                                reason: isStorageQuotaError(chromeApi.runtime.lastError)
                                    ? 'storage_quota_exceeded'
                                    : 'local_storage_error'
                            });
                            return;
                        }
                        resolve({ ok: true });
                    });
                };

                const handleExistingState = (existingData) => {
                    const currentState = pickAuthoritativeRawState(
                        existingData && typeof existingData === 'object' ? existingData[key] : null,
                        existingData && typeof existingData === 'object' ? existingData[backupKey] : null
                    );

                    if (isStaleStateWrite(data, currentState)) {
                        resolve({ ok: true, stale: true });
                        return;
                    }

                    const incomingRevision = getSnapshotSaveRevision(data);
                    const storedRevision = getSnapshotSaveRevision(currentState);
                    if (
                        incomingRevision > 0 &&
                        incomingRevision === storedRevision &&
                        !arePersistableSnapshotsEquivalent(data, currentState)
                    ) {
                        resolve({
                            ok: false,
                            reason: 'equal_revision_conflict'
                        });
                        return;
                    }

                    writePayload();
                };

                try {
                    if (chromeApi.storage.local.get) {
                        chromeApi.storage.local.get([key, backupKey], (existingData) => {
                            if (chromeApi.runtime?.lastError) {
                                console.warn('GeminiNotebook-Source-Management: Local storage revision check failed:', chromeApi.runtime.lastError);
                                resolve({ ok: false, reason: 'local_storage_revision_check_error' });
                                return;
                            }
                            handleExistingState(existingData);
                        });
                        return;
                    }

                    writePayload();
                } catch (error) {
                    console.warn('GeminiNotebook-Source-Management: Local storage write threw:', error);
                    resolve({ ok: false, reason: 'local_storage_exception' });
                }
            });
        }

        function sendStateToRuntimeStorage(key, data, options = {}) {
            if (!chromeApi?.runtime?.sendMessage) {
                return Promise.resolve({ ok: false, reason: 'runtime_unavailable' });
            }

            return new Promise((resolve) => {
                try {
                    chromeApi.runtime.sendMessage({
                        type: 'SAVE_STATE',
                        key,
                        data,
                        baseRevision: Number(options.baseRevision) || 0,
                        clientSaveId: options.clientSaveId || '',
                        critical: Boolean(options.critical)
                    }, (response) => {
                        if (chromeApi.runtime.lastError) {
                            console.error('GeminiNotebook-Source-Management 通信失败:', chromeApi.runtime.lastError);
                            resolve({ ok: false, reason: 'runtime_message_error' });
                            return;
                        }

                        if (!response || typeof response.success !== 'boolean') {
                            resolve({ ok: false, reason: 'empty_response' });
                            return;
                        }

                        const storageMetadata = getStorageMetadataFromResponse(response);
                        if (response.success === false) {
                            console.warn('GeminiNotebook-Source-Management: SAVE_STATE rejected by background:', response.errorCode || 'unknown_error');
                            if (response.errorCode === 'stale_revision') {
                                const currentRevision = Number(response.currentRevision) || 0;
                                resolve({
                                    ok: false,
                                    reason: 'stale_revision',
                                    stale: true,
                                    currentRevision,
                                    ...storageMetadata
                                });
                                return;
                            }
                            resolve({
                                ok: false,
                                reason: response.errorCode || response.reason || 'runtime_failure',
                                ...storageMetadata
                            });
                            return;
                        }

                        resolve({
                            ok: true,
                            stale: Boolean(response.stale),
                            saveRevision: Number(response.saveRevision) || 0,
                            savedAt: response.savedAt || '',
                            ...storageMetadata
                        });
                        return;
                    });
                } catch (error) {
                    console.warn('GeminiNotebook-Source-Management: Context invalidated. Please refresh the page.', error);
                    resolve({ ok: false, reason: 'runtime_exception' });
                }
            });
        }

        async function sendStateToStorage(key, data, options = {}) {
            const { allowLocalFallback = true } = options;
            const runtimeResult = await sendStateToRuntimeStorage(key, data, options);
            if (runtimeResult.ok) {
                return { ok: true, localResult: { skipped: true }, runtimeResult };
            }
            if (runtimeResult.stale || runtimeResult.reason === 'stale_revision') {
                return {
                    ok: false,
                    reason: 'stale_revision',
                    localResult: { skipped: true, reason: 'stale_revision' },
                    runtimeResult
                };
            }
            if (runtimeResult.reason === 'storage_quota_exceeded') {
                return {
                    ok: false,
                    reason: 'storage_quota_exceeded',
                    localResult: { skipped: true, reason: 'storage_quota_exceeded' },
                    runtimeResult
                };
            }
            if (runtimeResult.reason !== 'runtime_unavailable') {
                const reason = runtimeResult.reason || 'save_failed';
                return {
                    ok: false,
                    reason,
                    localResult: { skipped: true, reason },
                    runtimeResult
                };
            }

            if (!allowLocalFallback) {
                return {
                    ok: false,
                    reason: 'runtime_unavailable',
                    localResult: {
                        skipped: true,
                        reason: 'runtime_unavailable'
                    },
                    runtimeResult
                };
            }

            const localData = data && data._saveRevision
                ? data
                : preparePersistableSnapshot(data, options.stateKey);
            const localResult = await writeStateToLocalStorage(key, localData);
            if (localResult.stale) {
                return {
                    ok: false,
                    reason: 'stale_revision',
                    localResult,
                    runtimeResult
                };
            }
            if (localResult.reason === 'equal_revision_conflict') {
                return {
                    ok: false,
                    reason: 'equal_revision_conflict',
                    localResult,
                    runtimeResult
                };
            }
            if (localResult.ok) {
                return { ok: true, localResult, runtimeResult, localData };
            }

            return {
                ok: false,
                reason: runtimeResult.reason || localResult.reason || 'save_failed',
                localResult,
                runtimeResult
            };
        }

        function notifyCriticalSaveFailure(result) {
            if (result?.ok) return;
            const messageKey = result?.reason === 'stale_revision'
                ? 'ui_save_stale_failed'
                : result?.reason === 'storage_quota_exceeded'
                    ? 'ui_save_quota_failed'
                    : 'ui_save_failed';
            showToast(getMessage(messageKey), { variant: 'error' });
        }

        function enqueueStateSave(key, rawSnapshot, options = {}) {
            const projectId = getProjectIdFromStateKey(key) || String(ctx.projectId || '');
            const clientSaveId = createClientSaveId(projectId);
            const saveSnapshot = prepareRuntimeSaveSnapshot(rawSnapshot);
            const recoverySnapshot = prepareRuntimeSaveSnapshot(
                options.recoveryFallbackSnapshot || saveSnapshot
            );
            const operation = Object.freeze({
                projectId,
                stateKey: key,
                recoveryKey: recoveryKeyForProject(projectId),
                instanceToken: ctx.activeManagerInstanceToken,
                clientSaveId,
                saveSnapshot,
                recoverySnapshot
            });
            const operationOptions = Object.freeze({ ...options });
            const requestedScopeGeneration = schemaWriteScopeGeneration;
            const preserveExistingImportRecovery = (
                operationOptions.reason === 'page_lifecycle'
                && isImportOwnedRecovery(readRecoverySnapshot(operation.recoveryKey))
            );
            const counts = getPersistableStateCounts(operation.saveSnapshot);
            developerLog('debug', 'persistence', 'state_save_requested', {
                clientSaveId,
                critical: Boolean(operationOptions.critical),
                immediate: Boolean(operationOptions.immediate),
                reason: operationOptions.reason || '',
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount
            });
            if (operationOptions.critical && !preserveExistingImportRecovery) {
                writeRecoverySnapshot(operation.recoverySnapshot, {
                    recoveryKey: operation.recoveryKey,
                    baseRevision: getSaveRevisionForStateKey(operation.stateKey),
                    reason: operationOptions.recoveryFallbackSnapshot
                        ? 'import_pending'
                        : (operationOptions.reason || 'critical_save'),
                    clientSaveId: operation.clientSaveId,
                    failed: false
                });
            }
            const isCurrentOperationContext = () => (
                ctx.projectId === operation.projectId
                && ctx.activeManagerInstanceToken === operation.instanceToken
            );
            const getScopeInvalidationResult = (phase) => {
                if (
                    requestedScopeGeneration === schemaWriteScopeGeneration
                    && !futureSchemaWriteBlocked
                ) {
                    return null;
                }
                if (
                    phase === 'completion'
                    && !futureSchemaWriteBlocked
                    && !isCurrentOperationContext()
                ) {
                    return null;
                }
                return {
                    ok: false,
                    reason: futureSchemaWriteBlocked ? 'unsupported_schema' : 'save_scope_changed',
                    skipped: true
                };
            };
            const runSave = () => {
                if (
                    operationOptions.reason === 'page_lifecycle'
                    && isImportOwnedRecovery(readRecoverySnapshot(operation.recoveryKey))
                ) {
                    return Promise.resolve({
                        ok: false,
                        reason: 'import_recovery_owned',
                        skipped: true
                    });
                }
                const blockedResult = getScopeInvalidationResult('dispatch');
                if (blockedResult) {
                    return Promise.resolve(blockedResult);
                }
                const baseRevision = getSaveRevisionForStateKey(operation.stateKey);
                const dispatchedSnapshot = operation.saveSnapshot;
                if (isCurrentOperationContext()) {
                    setSaveStatus({
                        state: 'saving',
                        lastError: '',
                        clientSaveId: operation.clientSaveId
                    });
                }
                return sendStateToStorage(operation.stateKey, dispatchedSnapshot, Object.assign({}, operationOptions, {
                        baseRevision,
                        clientSaveId: operation.clientSaveId,
                        stateKey: operation.stateKey
                    }))
                    .then((result) => {
                        const invalidatedResult = getScopeInvalidationResult('completion');
                        if (invalidatedResult) {
                            return invalidatedResult;
                        }
                        const storageMetadata = getStorageMetadataFromResult(result);
                        const hasStorageMetadata = storageMetadata.storageQuotaBytes > 0 || storageMetadata.storageUsageBytes > 0;
                        const currentStatus = getSaveStatus();
                        if (result.ok) {
                            const saveRevision = result.runtimeResult?.saveRevision
                                || getSnapshotSaveRevision(result.localData)
                                || getSnapshotSaveRevision(dispatchedSnapshot)
                                || getSaveRevisionForStateKey(operation.stateKey);
                            const savedAt = result.runtimeResult?.savedAt
                                || result.localData?._savedAt
                                || dispatchedSnapshot._savedAt
                                || new Date().toISOString();
                            setSaveRevisionForStateKey(operation.stateKey, saveRevision);
                            if (isCurrentOperationContext()) {
                                setSaveStatus({
                                    state: 'saved',
                                    lastSavedAt: savedAt,
                                    lastSaveRevision: saveRevision,
                                    currentRevision: saveRevision,
                                    lastError: '',
                                    clientSaveId: operation.clientSaveId,
                                    storageUsageBytes: hasStorageMetadata ? storageMetadata.storageUsageBytes : currentStatus.storageUsageBytes,
                                    storageQuotaBytes: hasStorageMetadata ? storageMetadata.storageQuotaBytes : currentStatus.storageQuotaBytes,
                                    storageUsageRatio: hasStorageMetadata ? storageMetadata.storageUsageRatio : currentStatus.storageUsageRatio,
                                    storageWarning: hasStorageMetadata ? storageMetadata.storageWarning : currentStatus.storageWarning,
                                    lastStorageError: '',
                                    historyEntryCount: hasStorageMetadata ? storageMetadata.historyEntryCount : currentStatus.historyEntryCount,
                                    lastStaleLocalRevision: 0,
                                    lastStaleRemoteRevision: 0,
                                    lastStaleDetectedAt: ''
                                });
                            }
                            if (
                                operationOptions.critical
                                && !preserveExistingImportRecovery
                                && result.runtimeResult?.ok === true
                                && (
                                    !operationOptions.recoveryFallbackSnapshot
                                    || isCurrentOperationContext()
                                )
                            ) {
                                clearRecoverySnapshot(operation.recoveryKey, {
                                    expectedClientSaveId: operation.clientSaveId
                                });
                            }
                            developerLog('info', 'persistence', 'state_save_succeeded', {
                                clientSaveId: operation.clientSaveId,
                                saveRevision,
                                storageWarning: Boolean(storageMetadata.storageWarning),
                                storageUsageBytes: storageMetadata.storageUsageBytes,
                                storageQuotaBytes: storageMetadata.storageQuotaBytes
                            });
                        } else {
                            const staleRemoteRevision = result.reason === 'stale_revision'
                                ? Number(result.runtimeResult?.currentRevision)
                                    || getSaveRevisionForStateKey(operation.stateKey)
                                : currentStatus.lastStaleRemoteRevision || 0;
                            if (
                                result.reason === 'stale_revision'
                                && staleRemoteRevision > getSaveRevisionForStateKey(operation.stateKey)
                            ) {
                                setSaveRevisionForStateKey(operation.stateKey, staleRemoteRevision);
                            }
                            const lastStorageError = result.reason === 'storage_quota_exceeded'
                                ? 'storage_quota_exceeded'
                                : currentStatus.lastStorageError || '';
                            const staleLocalRevision = result.reason === 'stale_revision'
                                ? baseRevision
                                : currentStatus.lastStaleLocalRevision || 0;
                            const staleDetectedAt = result.reason === 'stale_revision'
                                ? new Date().toISOString()
                                : currentStatus.lastStaleDetectedAt || '';
                            if (isCurrentOperationContext()) {
                                setSaveStatus({
                                    state: result.reason === 'stale_revision' ? 'stale' : 'failed',
                                    lastError: result.reason || 'save_failed',
                                    currentRevision: result.runtimeResult?.currentRevision
                                        || getSaveRevisionForStateKey(operation.stateKey),
                                    clientSaveId: operation.clientSaveId,
                                    storageUsageBytes: hasStorageMetadata ? storageMetadata.storageUsageBytes : currentStatus.storageUsageBytes,
                                    storageQuotaBytes: hasStorageMetadata ? storageMetadata.storageQuotaBytes : currentStatus.storageQuotaBytes,
                                    storageUsageRatio: hasStorageMetadata ? storageMetadata.storageUsageRatio : currentStatus.storageUsageRatio,
                                    storageWarning: hasStorageMetadata ? storageMetadata.storageWarning : currentStatus.storageWarning,
                                    lastStorageError,
                                    historyEntryCount: hasStorageMetadata ? storageMetadata.historyEntryCount : currentStatus.historyEntryCount,
                                    lastStaleLocalRevision: staleLocalRevision,
                                    lastStaleRemoteRevision: staleRemoteRevision,
                                    lastStaleDetectedAt: staleDetectedAt
                                });
                            }
                            if (
                                operationOptions.critical
                                && !preserveExistingImportRecovery
                            ) {
                                const isAmbiguousAck = [
                                    'runtime_message_error',
                                    'empty_response',
                                    'runtime_exception'
                                ].includes(result.reason);
                                writeRecoverySnapshot(operation.recoverySnapshot, {
                                    recoveryKey: operation.recoveryKey,
                                    baseRevision,
                                    reason: isAmbiguousAck && operationOptions.recoveryFallbackSnapshot
                                        ? 'import_ack_unknown'
                                        : operationOptions.recoveryFallbackSnapshot
                                            ? 'import_rollback_required'
                                            : (result.reason || 'save_failed'),
                                    clientSaveId: operation.clientSaveId,
                                    expectedClientSaveId: operation.clientSaveId,
                                    failed: true
                                });
                            }
                            developerLog('warn', 'persistence', 'state_save_failed', {
                                clientSaveId: operation.clientSaveId,
                                reason: result.reason || 'save_failed',
                                staleLocalRevision,
                                staleRemoteRevision,
                                storageWarning: Boolean(storageMetadata.storageWarning),
                                storageUsageBytes: storageMetadata.storageUsageBytes,
                                storageQuotaBytes: storageMetadata.storageQuotaBytes
                            });
                        }
                        if (operationOptions.critical && isCurrentOperationContext()) {
                            notifyCriticalSaveFailure(result);
                        }
                        return result;
                    });
            };

            if (!saveQueueTail) {
                const immediateSave = runSave();
                saveQueueTail = immediateSave;
                immediateSave.finally(() => {
                    if (saveQueueTail === immediateSave) {
                        saveQueueTail = null;
                    }
                }).catch(() => {});
                return immediateSave;
            }

            const queuedSave = saveQueueTail
                .catch(() => ({ ok: false }))
                .then(runSave);
            saveQueueTail = queuedSave;
            queuedSave.finally(() => {
                if (saveQueueTail === queuedSave) {
                    saveQueueTail = null;
                }
            }).catch(() => {});
            return queuedSave;
        }

        function waitForPendingStateSave() {
            return saveQueueTail || Promise.resolve({ ok: true });
        }

        function prepareAndQueueStateSave(key, snapshot, options = {}) {
            return enqueueStateSave(key, snapshot, options);
        }

        function saveLifecycleSnapshot(key, rawSnapshot) {
            return prepareAndQueueStateSave(key, rawSnapshot, {
                immediate: true,
                critical: true,
                reason: 'page_lifecycle',
                recordUndo: false,
                allowLocalFallback: false
            });
        }

        const debouncedStorageSet = typeof debounceFn === 'function'
            ? debounceFn((key, data) => {
                return prepareAndQueueStateSave(key, data);
            }, 1500)
            : Object.assign((key, data) => {
                return prepareAndQueueStateSave(key, data);
            }, {
                flush: () => false,
                cancel: () => {}
            });

        function flushPendingStateSave() {
            if (typeof debouncedStorageSet.flush === 'function') {
                const flushResult = debouncedStorageSet.flush();
                if (flushResult && typeof flushResult.then === 'function') {
                    return flushResult;
                }
                return waitForPendingStateSave();
            }
            return waitForPendingStateSave();
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
                // Source keys can be attacker-influenced after an import round-trip.
                // Writing sourceStateById['__proto__'] = record reassigns the plain object's
                // prototype instead of adding an own key, corrupting it; skip such keys.
                if (sourceKey === '__proto__' || sourceKey === 'constructor' || sourceKey === 'prototype') {
                    return;
                }
                const sourceRecord = {
                    enabled: Boolean(source.enabled),
                    title: source.title,
                    normalizedTitle: source.normalizedTitle || normalizeSourceText(source.title),
                    stableToken: source.stableToken || '',
                    fingerprint: source.fingerprint || '',
                    identityType: source.identityType || 'fingerprint'
                };
                if (source.nativeLabelTitle) {
                    sourceRecord.nativeLabelTitle = source.nativeLabelTitle;
                }
                if (source.addedAt) {
                    sourceRecord.addedAt = source.addedAt;
                }
                sourceStateById[sourceKey] = sourceRecord;

                const tagIds = getSourceTagIds(sourceKey);
                if (tagIds.length > 0) {
                    persistedSourceTagsById[sourceKey] = tagIds;
                }
            });

            const persistableState = {
                schemaVersion: storageSchemaVersion,
                root: Array.isArray(state.root) ? state.root : [],
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
            const sourceViewDisplayKind = normalizeSourceViewDisplayKind(ctx.sourceViewDisplayKind) || 'list';
            persistableState.sourceViewDisplayKind = sourceViewDisplayKind;
            return persistableState;
        }

        function getBestPersistableSnapshot() {
            const currentDisplayKind = normalizeSourceViewDisplayKind(ctx.sourceViewDisplayKind) || 'list';

            if (ctx.pendingInitialLoadedState && hasPersistableManagerState(ctx.pendingInitialLoadedState)) {
                const snapshot = cloneSerializableData(ctx.pendingInitialLoadedState);
                snapshot.sourceViewDisplayKind = currentDisplayKind;
                return snapshot;
            }

            if (ctx.pendingPanelReattachState && hasPersistableManagerState(ctx.pendingPanelReattachState)) {
                const snapshot = cloneSerializableData(ctx.pendingPanelReattachState);
                snapshot.sourceViewDisplayKind = currentDisplayKind;
                return snapshot;
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
            const key = storageContract.getStateKey(ctx.projectId);
            const persistableState = buildPersistableState();

            if (immediate) {
                cancelPendingStateSave();
                return prepareAndQueueStateSave(key, persistableState, options);
            }

            debouncedStorageSet(key, persistableState);
            return waitForPendingStateSave();
        }

        function handlePageLifecyclePersistence(event) {
            if (event?.type === 'visibilitychange' && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
                return;
            }

            if (futureSchemaWriteBlocked) {
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

            const key = storageContract.getStateKey(ctx.projectId);
            return saveLifecycleSnapshot(key, persistableState);
        }

        // state.root is heterogeneous: { type:'group', id } | { type:'source', key }.
        // Untrusted on import/backup round-trips, so drop anything that is not a
        // well-formed entry (mirrors the group.children defensive reads elsewhere).
        function normalizeRootEntries(value) {
            if (!Array.isArray(value)) return [];
            const entries = [];
            value.forEach((entry) => {
                if (!entry || typeof entry !== 'object') return;
                if (entry.type === 'group' && typeof entry.id === 'string' && entry.id) {
                    entries.push({ type: 'group', id: entry.id });
                } else if (entry.type === 'source' && typeof entry.key === 'string' && entry.key) {
                    entries.push({ type: 'source', key: entry.key });
                }
            });
            return entries;
        }

        // customHeight is later written straight into style.height; an imported/persisted
        // non-numeric or non-positive value would leave a type-confused string in storage.
        // Coerce to a finite positive number or null (the resize handle + CSS still enforce
        // the view-specific min/max at interaction/render time).
        function normalizeCustomHeight(value) {
            const height = Number(value);
            return Number.isFinite(height) && height > 0 ? height : null;
        }

        function normalizeLoadedState(stateData) {
            if (stateData == null) return null;
            const schemaCompatibility = storageContract.getStateSchemaCompatibility(stateData);
            if (
                schemaCompatibility === 'future'
                || schemaCompatibility === 'invalid'
            ) {
                return null;
            }
            rememberSnapshotSaveRevision(stateData);
            const sourceViewDisplayKind = normalizeSourceViewDisplayKind(stateData.sourceViewDisplayKind);

            if (stateData.schemaVersion === storageSchemaVersion) {
                ctx.pendingStorageUpgrade = Boolean(ctx.pendingStructuralStateRepair);
                const normalizedState = {
                    schemaVersion: storageSchemaVersion,
                    root: normalizeRootEntries(stateData.root),
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: normalizeCustomHeight(stateData.customHeight),
                    tagsById: stateData.tagsById || {},
                    tagOrder: Array.isArray(stateData.tagOrder) ? stateData.tagOrder : [],
                    sourceTagsById: stateData.sourceTagsById || {}
                };
                if (sourceViewDisplayKind) {
                    normalizedState.sourceViewDisplayKind = sourceViewDisplayKind;
                }
                return normalizedState;
            }

            ctx.pendingStorageUpgrade = true;
            if (stateData.schemaVersion === 4) {
                const normalizedState = {
                    schemaVersion: storageSchemaVersion,
                    root: (Array.isArray(stateData.groups) ? stateData.groups : [])
                        .map((id) => ({ type: 'group', id })),
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: normalizeCustomHeight(stateData.customHeight),
                    tagsById: stateData.tagsById || {},
                    tagOrder: Array.isArray(stateData.tagOrder) ? stateData.tagOrder : [],
                    sourceTagsById: stateData.sourceTagsById || {}
                };
                if (sourceViewDisplayKind) {
                    normalizedState.sourceViewDisplayKind = sourceViewDisplayKind;
                }
                return normalizedState;
            }

            if (stateData.schemaVersion === 3) {
                const normalizedState = {
                    schemaVersion: storageSchemaVersion,
                    root: (Array.isArray(stateData.groups) ? stateData.groups : [])
                        .map((id) => ({ type: 'group', id })),
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: normalizeCustomHeight(stateData.customHeight),
                    tagsById: stateData.tagsById || {},
                    tagOrder: Array.isArray(stateData.tagOrder) ? stateData.tagOrder : [],
                    sourceTagsById: stateData.sourceTagsById || {}
                };
                if (sourceViewDisplayKind) {
                    normalizedState.sourceViewDisplayKind = sourceViewDisplayKind;
                }
                return normalizedState;
            }

            if (stateData.schemaVersion === 2) {
                return {
                    schemaVersion: storageSchemaVersion,
                    root: (Array.isArray(stateData.groups) ? stateData.groups : [])
                        .map((id) => ({ type: 'group', id })),
                    groupsById: stateData.groupsById || {},
                    ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                    sourceStateById: stateData.sourceStateById || {},
                    customHeight: normalizeCustomHeight(stateData.customHeight),
                    tagsById: {},
                    tagOrder: [],
                    sourceTagsById: {}
                };
            }

            return {
                schemaVersion: storageSchemaVersion,
                root: (Array.isArray(stateData.groups) ? stateData.groups : [])
                    .map((id) => ({ type: 'group', id })),
                groupsById: stateData.groupsById || {},
                ungrouped: Array.isArray(stateData.ungrouped) ? stateData.ungrouped : [],
                legacyEnabledMap: stateData.enabledMap || {},
                customHeight: stateData.customHeight ?? null,
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            };
        }

        function isUnsupportedFutureSchema(stateData) {
            return storageContract.getStateSchemaCompatibility(stateData) === 'future';
        }

        function isSupportedOrLegacyState(stateData) {
            const compatibility = storageContract.getStateSchemaCompatibility(stateData);
            return compatibility === 'supported' || compatibility === 'legacy';
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
            if (
                futureSchemaWriteBlocked
                || !ctx.projectId
                || ctx.managerStatusReason === 'source_detail_view'
            ) {
                return false;
            }

            const sourcePanel = findSourcePanel();
            const panelState = getSourcePanelState(sourcePanel);
            if (panelState.state === 'missing' || panelState.state === 'collapsed') {
                return true;
            }

            if (panelState.state === 'loading') {
                const sourceViewKind = ctx.sourceViewInfo?.kind || ctx.sourceViewKind || '';
                return sourceViewKind === 'label' && hasPersistableManagerState(buildPersistableState());
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

        function getPersistedSourceRefCount(loadedState) {
            if (!loadedState || typeof loadedState !== 'object') return 0;
            const sourceKeys = new Set();

            getMapLikeEntries(loadedState.sourceStateById || {}).forEach(([sourceKey]) => {
                if (sourceKey) sourceKeys.add(sourceKey);
            });
            getMapLikeValues(loadedState.groupsById || {}).forEach((group) => {
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'source' && child.key) sourceKeys.add(child.key);
                });
            });
            (Array.isArray(loadedState.ungrouped) ? loadedState.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) sourceKeys.add(sourceKey);
            });

            return sourceKeys.size;
        }

        function hasPersistableManagerState(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return false;
            if (hasPersistedSourceRefs(snapshot)) return true;
            if (Array.isArray(snapshot.groups) && snapshot.groups.length > 0) return true;
            if (Array.isArray(snapshot.root) && snapshot.root.length > 0) return true;
            if (snapshot.groupsById && getMapLikeEntries(snapshot.groupsById).length > 0) return true;
            if (snapshot.tagsById && getMapLikeEntries(snapshot.tagsById).length > 0) return true;
            if (Array.isArray(snapshot.tagOrder) && snapshot.tagOrder.length > 0) return true;
            return snapshot.customHeight != null;
        }

        function restorePersistedSnapshotWithoutDom(loadedState) {
            if (!loadedState || typeof loadedState !== 'object' || !hasPersistedSourceRefs(loadedState)) {
                return false;
            }

            const state = getState();
            const sourcesByKey = ctx.sourcesByKey instanceof Map ? ctx.sourcesByKey : null;
            const groupsById = ctx.groupsById instanceof Map ? ctx.groupsById : null;
            const tagsById = ctx.tagsById instanceof Map ? ctx.tagsById : null;
            const sourceTagsById = ctx.sourceTagsById instanceof Map ? ctx.sourceTagsById : null;
            if (!sourcesByKey || !groupsById || !tagsById || !sourceTagsById) {
                return false;
            }

            const sourceRecords = getMapLikeEntries(loadedState.sourceStateById || {});
            const sourceKeys = new Set(sourceRecords.map(([sourceKey]) => sourceKey));
            const seenSourceRefs = new Set();

            sourcesByKey.clear();
            sourceRecords.forEach(([sourceKey, sourceRecord]) => {
                const title = String(sourceRecord?.title || getMessage('ui_source_untitled'));
                const normalizedTitle = sourceRecord?.normalizedTitle || normalizeSourceText(title);
                sourcesByKey.set(sourceKey, {
                    key: sourceKey,
                    legacyKey: sourceKey,
                    title,
                    normalizedTitle,
                    lowercaseTitle: normalizedTitle,
                    ariaLabel: '',
                    stableToken: sourceRecord?.stableToken || '',
                    fingerprint: sourceRecord?.fingerprint || '',
                    identityType: sourceRecord?.identityType || 'fingerprint',
                    element: null,
                    iconName: 'article',
                    iconColorClass: '',
                    iconImageUrl: '',
                    checkbox: null,
                    hasNativeCheckbox: false,
                    isLoading: false,
                    isDisabled: false,
                    enabled: sourceRecord?.enabled !== false,
                    nativeLabelTitle: sourceRecord?.nativeLabelTitle || '',
                    addedAt: sourceRecord?.addedAt || '',
                    isPendingNativeHydration: true
                });
            });

            groupsById.clear();
            getMapLikeEntries(loadedState.groupsById || {}).forEach(([groupId, rawGroup]) => {
                if (!rawGroup || typeof rawGroup !== 'object') return;
                groupsById.set(groupId, {
                    ...rawGroup,
                    id: rawGroup.id || groupId,
                    enabled: rawGroup.enabled !== undefined ? rawGroup.enabled : true,
                    collapsed: rawGroup.collapsed === true,
                    children: []
                });
            });

            getMapLikeEntries(loadedState.groupsById || {}).forEach(([groupId, rawGroup]) => {
                const nextGroup = groupsById.get(groupId);
                if (!nextGroup) return;

                (Array.isArray(rawGroup?.children) ? rawGroup.children : []).forEach((child) => {
                    if (
                        child?.type === 'group' &&
                        (
                            appendGroupChildIfAcyclic
                                ? appendGroupChildIfAcyclic(groupsById, groupId, child.id)
                                : appendGroupChildIfAcyclicLocal(groupsById, groupId, child.id)
                        )
                    ) {
                        return;
                    }

                    if (child?.type === 'source' && sourceKeys.has(child.key) && !seenSourceRefs.has(child.key)) {
                        nextGroup.children.push({ type: 'source', key: child.key });
                        seenSourceRefs.add(child.key);
                    }
                });
            });

            state.root = [];
            (Array.isArray(loadedState.root) ? loadedState.root : []).forEach((entry) => {
                if (entry?.type === 'group' && groupsById.has(entry.id)) {
                    state.root.push({ type: 'group', id: entry.id });
                } else if (
                    entry?.type === 'source' &&
                    sourceKeys.has(entry.key) &&
                    !seenSourceRefs.has(entry.key)
                ) {
                    state.root.push({ type: 'source', key: entry.key });
                    seenSourceRefs.add(entry.key);
                }
            });
            state.ungrouped = [];
            (Array.isArray(loadedState.ungrouped) ? loadedState.ungrouped : []).forEach((sourceKey) => {
                if (!sourceKeys.has(sourceKey) || seenSourceRefs.has(sourceKey)) return;
                state.ungrouped.push(sourceKey);
                seenSourceRefs.add(sourceKey);
            });
            sourceRecords.forEach(([sourceKey]) => {
                if (seenSourceRefs.has(sourceKey)) return;
                state.ungrouped.push(sourceKey);
                seenSourceRefs.add(sourceKey);
            });

            tagsById.clear();
            const normalizedTagState = buildNormalizedTagState ? buildNormalizedTagState(loadedState) : null;
            const rawToSafeTagId = normalizedTagState?.rawToSafeTagId || null;
            if (normalizedTagState) {
                normalizedTagState.nextTagsById.forEach((tag, tagId) => {
                    tagsById.set(tagId, tag);
                });
                state.tagOrder = normalizedTagState.nextTagOrder;
            } else {
                getMapLikeEntries(loadedState.tagsById || {}).forEach(([tagId, tag]) => {
                    if (tag && typeof tag === 'object') {
                        tagsById.set(tagId, { ...tag, id: tag.id || tagId });
                    }
                });
                state.tagOrder = (Array.isArray(loadedState.tagOrder) ? loadedState.tagOrder : [])
                    .filter((tagId) => tagsById.has(tagId));
            }

            sourceTagsById.clear();
            getMapLikeEntries(loadedState.sourceTagsById || {}).forEach(([sourceKey, tagIds]) => {
                if (!sourceKeys.has(sourceKey)) return;
                const validTagIds = (Array.isArray(tagIds) ? tagIds : [])
                    .map((tagId) => rawToSafeTagId?.get?.(tagId) || tagId)
                    .filter((tagId) => tagsById.has(tagId));
                if (validTagIds.length > 0) {
                    sourceTagsById.set(sourceKey, validTagIds);
                }
            });

            if (state.activeTagId && !tagsById.has(state.activeTagId)) {
                state.activeTagId = null;
            }

            return true;
        }

        function appendGroupChildIfAcyclicLocal(groupsById, parentGroupId, childGroupId) {
            const parentGroup = groupsById.get(parentGroupId);
            if (!parentGroup || !childGroupId || childGroupId === parentGroupId || !groupsById.has(childGroupId)) {
                return false;
            }

            const stack = [childGroupId];
            const visited = new Set();
            while (stack.length > 0) {
                const groupId = stack.pop();
                if (!groupId || visited.has(groupId)) continue;
                if (groupId === parentGroupId) return false;
                visited.add(groupId);

                const group = groupsById.get(groupId);
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'group' && child.id && !visited.has(child.id)) {
                        stack.push(child.id);
                    }
                });
            }

            parentGroup.children.push({ type: 'group', id: childGroupId });
            return true;
        }

        function capturePendingPanelReattachState() {
            const bestSnapshot = getBestPersistableSnapshot();
            return hasPersistableManagerState(bestSnapshot) ? bestSnapshot : null;
        }

        function shouldDeferInitialRestore(loadedState) {
            if (!loadedState || !hasPersistedSourceRefs(loadedState)) return false;

            const sourcePanel = findSourcePanel();
            const panelState = getSourcePanelState(sourcePanel);
            if (!hasRenderableSourceRows(sourcePanel) || panelState.state !== 'ready') {
                return true;
            }

            const persistedSourceCount = getPersistedSourceRefCount(loadedState);
            const currentSourceCount = getManageableSourceElements(sourcePanel).length;
            return Boolean(
                persistedSourceCount > 0 &&
                currentSourceCount > 0 &&
                currentSourceCount < persistedSourceCount &&
                ((Number(panelState.loadingRows) || 0) > 0 || (Number(panelState.failedRows) || 0) > 0)
            );
        }

        function restoreInitialLoadedState(loadedState) {
            if (!hasPersistableManagerState(loadedState) && hasPersistableManagerState(buildPersistableState())) {
                ctx.pendingInitialLoadedState = null;
                return { deferred: false, shouldUpgradeStorage: false };
            }

            if (shouldDeferInitialRestore(loadedState)) {
                ctx.pendingInitialLoadedState = loadedState;
                restorePersistedSnapshotWithoutDom(loadedState);
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

            if (shouldDeferInitialRestore(ctx.pendingInitialLoadedState)) {
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
            if (
                schemaWriteScopeProjectId !== expectedProjectId
                || schemaWriteScopeInstanceToken !== expectedInstanceToken
            ) {
                schemaWriteScopeGeneration += 1;
                futureSchemaWriteBlocked = false;
                schemaWriteScopeProjectId = expectedProjectId;
                schemaWriteScopeInstanceToken = expectedInstanceToken;
                const currentSaveStatus = getSaveStatus();
                if (
                    currentSaveStatus.state === 'failed'
                    && currentSaveStatus.lastError === 'unsupported_schema'
                ) {
                    setSaveStatus({
                        state: 'idle',
                        lastError: ''
                    });
                }
            }
            const requestId = ctx.nextLoadStateRequestId++;
            ctx.activeLoadStateRequestId = requestId;
            const key = storageContract.getStateKey(expectedProjectId);

            const finalizeLoadedState = (primaryState, backupState = null, historyEntries = []) => {
                if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                    return;
                }

                if (ctx.activeLoadStateRequestId === requestId) {
                    ctx.activeLoadStateRequestId = null;
                }

                const authoritativeRawState = pickAuthoritativeRawState(primaryState, backupState);
                const authoritativeCompatibility = storageContract.getStateSchemaCompatibility(authoritativeRawState);
                if (authoritativeCompatibility === 'future' || authoritativeCompatibility === 'invalid') {
                    schemaWriteScopeGeneration += 1;
                    futureSchemaWriteBlocked = true;
                    ctx.pendingStorageUpgrade = false;
                    ctx.pendingStructuralStateRepair = null;
                    cancelPendingStateSave();
                    setSaveStatus({
                        state: 'failed',
                        lastError: 'unsupported_schema'
                    });
                    callback(null);
                    return;
                }

                const safePrimaryState = isSupportedOrLegacyState(primaryState) ? primaryState : null;
                const safeBackupState = isSupportedOrLegacyState(backupState) ? backupState : null;
                const safeHistoryEntries = (Array.isArray(historyEntries) ? historyEntries : [])
                    .filter((entry) => isSupportedOrLegacyState(entry?.snapshot));
                const rawState = pickPreferredStoredState(
                    safePrimaryState,
                    safeBackupState,
                    safeHistoryEntries
                );
                const loadedState = normalizeLoadedState(rawState);
                detectRecoverySnapshotAvailability(rawState);
                if (loadedState && loadedState.customHeight != null) {
                    ctx.customHeight = loadedState.customHeight;
                    const container = ctx.shadowRoot?.querySelector('.sp-container');
                    if (container) container.style.height = `${ctx.customHeight}px`;
                }

                callback(loadedState);
            };

            const readLocalState = () => {
                if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                    return;
                }
                if (!chromeApi?.storage?.local?.get) {
                    ctx.pendingStorageUpgrade = false;
                    if (ctx.activeLoadStateRequestId === requestId) {
                        ctx.activeLoadStateRequestId = null;
                    }
                    callback(null);
                    return;
                }
                try {
                    const backupKey = storageContract.getStateBackupKey(key);
                    const historyKey = storageContract.getStateHistoryKey(
                        storageContract.getStateKey(expectedProjectId)
                    );
                    chromeApi.storage.local.get([key, backupKey, historyKey], (data) => {
                        if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                            return;
                        }

                        if (chromeApi.runtime?.lastError) {
                            console.warn('GeminiNotebook-Source-Management: Local storage fallback load failed:', chromeApi.runtime.lastError);
                            ctx.pendingStorageUpgrade = false;
                            if (ctx.activeLoadStateRequestId === requestId) {
                                ctx.activeLoadStateRequestId = null;
                            }
                            callback(null);
                            return;
                        }

                        const primaryState = data && typeof data === 'object' ? data[key] : null;
                        const backupState = data && typeof data === 'object' ? data[backupKey] : null;
                        const historyEntries = data && typeof data === 'object' ? data[historyKey] : [];
                        finalizeLoadedState(primaryState, backupState, historyEntries);
                    });
                    return;
                } catch (error) {
                    console.warn('GeminiNotebook-Source-Management: Local storage fallback load threw:', error);
                    ctx.pendingStorageUpgrade = false;
                    if (ctx.activeLoadStateRequestId === requestId) {
                        ctx.activeLoadStateRequestId = null;
                    }
                    callback(null);
                }
            };

            if (!chromeApi?.runtime?.sendMessage) {
                readLocalState();
                return;
            }

            try {
                chromeApi.runtime.sendMessage({ type: 'LOAD_STATE', key }, (response) => {
                    if (!isLiveManagerLoadRequest(expectedProjectId, expectedInstanceToken, requestId)) {
                        return;
                    }

                    if (chromeApi.runtime.lastError) {
                        console.warn('GeminiNotebook-Source-Management 未能连接后台，使用本地只读回退:', chromeApi.runtime.lastError);
                        Promise.resolve().then(readLocalState);
                        return;
                    }

                    if (response && response.success === false) {
                        console.warn('GeminiNotebook-Source-Management: LOAD_STATE rejected by background:', response.errorCode || 'unknown_error');
                        ctx.pendingStorageUpgrade = false;
                        if (ctx.activeLoadStateRequestId === requestId) {
                            ctx.activeLoadStateRequestId = null;
                        }
                        callback(null);
                        return;
                    }

                    if (!response || typeof response !== 'object') {
                        ctx.pendingStorageUpgrade = false;
                        if (ctx.activeLoadStateRequestId === requestId) {
                            ctx.activeLoadStateRequestId = null;
                        }
                        callback(null);
                        return;
                    }

                    const hasRawPrimary = Object.prototype.hasOwnProperty.call(response, 'primaryState');
                    finalizeLoadedState(
                        hasRawPrimary ? response.primaryState : response.data,
                        hasRawPrimary ? response.backupState : null,
                        Array.isArray(response.history) ? response.history : []
                    );
                });
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Context invalidated during load. Using local read fallback.', error);
                readLocalState();
            }
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
            getStateBackupKey: storageContract.getStateBackupKey,
            getStateHistoryKey: historyKeyForProject,
            getStateHistoryEntries,
            setStateHistoryEntries,
            loadStateHistory,
            appendStateHistorySnapshot,
            pickPreferredStoredState,
            pickAuthoritativeRawState,
            writeStateToLocalStorage,
            sendStateToStorage,
            enqueueStateSave,
            waitForPendingStateSave,
            preparePersistableSnapshot,
            prepareRuntimeSaveSnapshot,
            getSnapshotSaveRevision,
            getSaveStatus,
            setSaveStatus,
            getRecoveryKey: recoveryKeyForProject,
            writeRecoverySnapshot,
            readRecoverySnapshot,
            clearRecoverySnapshot,
            detectRecoverySnapshotAvailability,
            flushPendingStateSave,
            cancelPendingStateSave,
            invalidateManagerInstance,
            isLiveManagerLoadRequest,
            buildPersistableState,
            getBestPersistableSnapshot,
            saveState,
            handlePageLifecyclePersistence,
            normalizeLoadedState,
            isUnsupportedFutureSchema,
            hasPreservableManagerSnapshot,
            canPersistManagerState,
            hasPersistedSourceRefs,
            getPersistedSourceRefCount,
            hasPersistableManagerState,
            restorePersistedSnapshotWithoutDom,
            shouldDeferInitialRestore,
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
