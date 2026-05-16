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
        const buildNormalizedTagState = typeof ctx.buildNormalizedTagState === 'function'
            ? ctx.buildNormalizedTagState
            : null;
        const appendGroupChildIfAcyclic = typeof ctx.appendGroupChildIfAcyclic === 'function'
            ? ctx.appendGroupChildIfAcyclic
            : null;
        const scanAndSyncSources = typeof ctx.scanAndSyncSources === 'function' ? ctx.scanAndSyncSources : () => false;
        const findSourcePanel = typeof ctx.findSourcePanel === 'function' ? ctx.findSourcePanel : () => null;
        const isSourcePanelRenderable = typeof ctx.isSourcePanelRenderable === 'function' ? ctx.isSourcePanelRenderable : () => true;
        const getSourcePanelState = typeof ctx.getSourcePanelState === 'function'
            ? ctx.getSourcePanelState
            : () => ({ state: 'ready' });
        const hasRenderableSourceRows = typeof ctx.hasRenderableSourceRows === 'function' ? ctx.hasRenderableSourceRows : () => false;
        const render = typeof ctx.render === 'function' ? ctx.render : () => {};
        const getMessage = typeof ctx.getMessage === 'function' ? ctx.getMessage : (key) => key;
        const showToast = typeof ctx.showToast === 'function' ? ctx.showToast : () => {};
        const developerLog = typeof ctx.developerLog === 'function' ? ctx.developerLog : () => false;
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
            if (typeof ctx.lastKnownSaveRevision !== 'number') {
                ctx.lastKnownSaveRevision = 0;
            }
        };

        ensureStorageState();
        let saveQueueTail = null;
        let nextClientSaveId = 1;

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

        function isStorageQuotaError(error) {
            const message = String(error?.message || error || '').toLowerCase();
            return message.includes('quota') ||
                message.includes('exceed') ||
                message.includes('maximum') ||
                message.includes('max_bytes');
        }

        function getStorageMetadataFromResponse(response = {}) {
            return {
                storageUsageBytes: Number(response.storageUsageBytes) || 0,
                storageQuotaBytes: Number(response.storageQuotaBytes) || 0,
                storageUsageRatio: Number(response.storageUsageRatio) || 0,
                storageWarning: Boolean(response.storageWarning),
                historyEntryCount: Number(response.historyEntryCount) || 0,
                historyTrimmed: Boolean(response.historyTrimmed)
            };
        }

        function getStorageMetadataFromResult(result = {}) {
            const runtimeResult = result.runtimeResult || {};
            const localResult = result.localResult || {};
            return getStorageMetadataFromResponse(
                runtimeResult.storageQuotaBytes || runtimeResult.storageUsageBytes
                    ? runtimeResult
                    : localResult
            );
        }

        function setSaveStatus(nextStatus = {}) {
            const currentStatus = getSaveStatus();
            ctx.saveStatus = Object.assign({}, currentStatus, nextStatus);
            try {
                onSaveStatusChange(cloneSerializableData(ctx.saveStatus));
            } catch (error) {
                console.warn('NotebookLM Source Management: Save status update failed:', error);
            }
            return ctx.saveStatus;
        }

        function getSessionStorage() {
            const storage = ctx.sessionStorage
                || globalThis.sessionStorage
                || globalThis.window?.sessionStorage;
            return storage && typeof storage.getItem === 'function' ? storage : null;
        }

        function getSnapshotSaveRevision(snapshot) {
            const revision = Number(snapshot?._saveRevision);
            return Number.isFinite(revision) && revision > 0 ? revision : 0;
        }

        function isStaleStateWrite(incomingState, storedState) {
            const incomingRevision = getSnapshotSaveRevision(incomingState);
            const storedRevision = getSnapshotSaveRevision(storedState);
            return incomingRevision > 0 && storedRevision > 0 && incomingRevision < storedRevision;
        }

        function getStableComparablePersistableValue(value, seenValues = new WeakSet()) {
            if (value == null || typeof value !== 'object') return value;
            if (seenValues.has(value)) return null;
            seenValues.add(value);

            try {
                if (Array.isArray(value)) {
                    return value.map((item) => getStableComparablePersistableValue(item, seenValues));
                }

                return Object.keys(value)
                    .filter((key) => key !== '_saveRevision' && key !== '_savedAt')
                    .sort()
                    .reduce((acc, key) => {
                        acc[key] = getStableComparablePersistableValue(value[key], seenValues);
                        return acc;
                    }, {});
            } finally {
                seenValues.delete(value);
            }
        }

        function getPersistableSnapshotSignature(snapshot) {
            try {
                return JSON.stringify(getStableComparablePersistableValue(snapshot || null));
            } catch (error) {
                return '';
            }
        }

        function arePersistableSnapshotsEquivalent(leftSnapshot, rightSnapshot) {
            const leftSignature = getPersistableSnapshotSignature(leftSnapshot);
            const rightSignature = getPersistableSnapshotSignature(rightSnapshot);
            return Boolean(leftSignature && rightSignature && leftSignature === rightSignature);
        }

        function rememberSnapshotSaveRevision(snapshot) {
            const revision = getSnapshotSaveRevision(snapshot);
            if (revision > ctx.lastKnownSaveRevision) {
                ctx.lastKnownSaveRevision = revision;
            }
            return ctx.lastKnownSaveRevision;
        }

        function preparePersistableSnapshot(rawSnapshot) {
            const snapshot = cloneSerializableData(rawSnapshot || {});
            const nextRevision = Math.max(
                Number(ctx.lastKnownSaveRevision) || 0,
                getSnapshotSaveRevision(snapshot)
            ) + 1;
            ctx.lastKnownSaveRevision = nextRevision;
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

        function createClientSaveId() {
            const prefix = String(ctx.projectId || 'project');
            const value = `${prefix}:${Date.now()}:${nextClientSaveId}`;
            nextClientSaveId += 1;
            return value;
        }

        function getRecoveryKey(projectId = ctx.projectId) {
            return projectId ? `sourcesPlusRecovery_${projectId}` : '';
        }

        function writeRecoverySnapshot(rawSnapshot, options = {}) {
            const storage = getSessionStorage();
            const key = getRecoveryKey();
            if (!storage || !key || !rawSnapshot) return false;

            const payload = {
                snapshot: cloneSerializableData(rawSnapshot),
                baseRevision: Number(ctx.lastKnownSaveRevision) || 0,
                createdAt: new Date().toISOString(),
                reason: typeof options.reason === 'string' ? options.reason : 'critical_save',
                clientSaveId: typeof options.clientSaveId === 'string' ? options.clientSaveId : createClientSaveId(),
                failed: Boolean(options.failed)
            };

            try {
                storage.setItem(key, JSON.stringify(payload));
                setSaveStatus({
                    recoveryAvailable: true,
                    recoveryCreatedAt: payload.createdAt
                });
                developerLog('info', 'persistence', 'recovery_snapshot_written', {
                    reason: payload.reason,
                    baseRevision: payload.baseRevision,
                    failed: payload.failed
                });
                return payload;
            } catch (error) {
                console.warn('NotebookLM Source Management: Recovery snapshot write failed:', error);
                developerLog('error', 'persistence', 'recovery_snapshot_write_failed', { error });
                return false;
            }
        }

        function readRecoverySnapshot(projectId = ctx.projectId) {
            const storage = getSessionStorage();
            const key = getRecoveryKey(projectId);
            if (!storage || !key) return null;

            try {
                const rawValue = storage.getItem(key);
                if (!rawValue) return null;
                const parsed = JSON.parse(rawValue);
                if (!parsed || typeof parsed !== 'object' || !parsed.snapshot) return null;
                return parsed;
            } catch (error) {
                console.warn('NotebookLM Source Management: Recovery snapshot read failed:', error);
                return null;
            }
        }

        function clearRecoverySnapshot(projectId = ctx.projectId) {
            const storage = getSessionStorage();
            const key = getRecoveryKey(projectId);
            if (!storage || !key) return false;

            try {
                storage.removeItem(key);
                setSaveStatus({
                    recoveryAvailable: false,
                    recoveryCreatedAt: ''
                });
                return true;
            } catch (error) {
                console.warn('NotebookLM Source Management: Recovery snapshot clear failed:', error);
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

        function getComparableStoredState(primaryState, backupState) {
            const primaryRevision = getSnapshotSaveRevision(primaryState);
            const backupRevision = getSnapshotSaveRevision(backupState);
            if (
                hasRestorableStateSnapshot(primaryState) &&
                hasRestorableStateSnapshot(backupState) &&
                backupRevision > primaryRevision
            ) {
                return backupState;
            }
            return primaryState;
        }

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

        function getStateHistoryKey(projectId = ctx.projectId) {
            return projectId ? `sourcesPlusHistory_${projectId}` : '';
        }

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

        function collectSnapshotGroupedSourceKeys(snapshot) {
            const result = new Set();
            const groupsById = snapshot?.groupsById && typeof snapshot.groupsById === 'object'
                ? snapshot.groupsById
                : {};
            const rootGroupIds = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
            const visitedGroups = new Set();

            const walkGroup = (groupId) => {
                if (!groupId || visitedGroups.has(groupId)) return;
                visitedGroups.add(groupId);
                const group = groupsById[groupId];
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'source' && child.key) {
                        result.add(child.key);
                    } else if (child?.type === 'group' && child.id) {
                        walkGroup(child.id);
                    }
                });
            };

            rootGroupIds.forEach(walkGroup);
            return result;
        }

        function getSnapshotGroupInfo(snapshot) {
            const groupsById = snapshot?.groupsById && typeof snapshot.groupsById === 'object'
                ? snapshot.groupsById
                : {};
            const groupIds = new Set();
            const titleCounts = new Map();

            getMapLikeEntries(groupsById).forEach(([groupId, group]) => {
                if (groupId) groupIds.add(groupId);
                const title = String(group?.title || '').trim();
                if (title) {
                    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
                }
            });

            return {
                groupIds,
                titleCounts,
                groupedSourceKeys: collectSnapshotGroupedSourceKeys(snapshot)
            };
        }

        function isCompatibleStructuralRepairCandidate(currentState, candidateState) {
            if (!hasRestorableStateSnapshot(currentState) || !hasRestorableStateSnapshot(candidateState)) {
                return false;
            }

            const currentInfo = getSnapshotGroupInfo(currentState);
            const candidateInfo = getSnapshotGroupInfo(candidateState);
            if (candidateInfo.groupedSourceKeys.size <= currentInfo.groupedSourceKeys.size) {
                return false;
            }
            if (candidateInfo.groupIds.size === 0 || currentInfo.groupIds.size === 0) {
                return false;
            }

            const missingGroupIds = Array.from(candidateInfo.groupIds)
                .filter((groupId) => !currentInfo.groupIds.has(groupId));
            if (missingGroupIds.length > 0) {
                const currentTitles = new Map(currentInfo.titleCounts);
                const hasSameTitles = Array.from(candidateInfo.titleCounts.entries()).every(([title, count]) => (
                    (currentTitles.get(title) || 0) >= count
                ));
                if (!hasSameTitles) return false;
            }

            const currentSourceKeys = new Set(getMapLikeEntries(currentState.sourceStateById || {}).map(([sourceKey]) => sourceKey));
            const candidateSourceKeys = new Set(getMapLikeEntries(candidateState.sourceStateById || {}).map(([sourceKey]) => sourceKey));
            return Array.from(candidateInfo.groupedSourceKeys).every((sourceKey) => (
                currentSourceKeys.has(sourceKey) || candidateSourceKeys.has(sourceKey)
            ));
        }

        function createStructurallyRepairedState(currentState, candidateState) {
            const repairedState = cloneSerializableData(currentState || {});
            const candidateGroups = Array.isArray(candidateState?.groups) ? candidateState.groups : [];
            const candidateGroupsById = candidateState?.groupsById && typeof candidateState.groupsById === 'object'
                ? candidateState.groupsById
                : {};
            const currentSourceState = currentState?.sourceStateById && typeof currentState.sourceStateById === 'object'
                ? currentState.sourceStateById
                : {};
            const candidateSourceState = candidateState?.sourceStateById && typeof candidateState.sourceStateById === 'object'
                ? candidateState.sourceStateById
                : {};

            repairedState.groups = cloneSerializableData(candidateGroups);
            repairedState.groupsById = cloneSerializableData(candidateGroupsById);
            repairedState.sourceStateById = Object.assign(
                {},
                cloneSerializableData(candidateSourceState),
                cloneSerializableData(currentSourceState)
            );

            const groupedSourceKeys = collectSnapshotGroupedSourceKeys(repairedState);
            const nextUngrouped = [];
            const seenUngrouped = new Set();
            const pushUngrouped = (sourceKey) => {
                if (!sourceKey || groupedSourceKeys.has(sourceKey) || seenUngrouped.has(sourceKey)) return;
                nextUngrouped.push(sourceKey);
                seenUngrouped.add(sourceKey);
            };

            (Array.isArray(candidateState?.ungrouped) ? candidateState.ungrouped : []).forEach(pushUngrouped);
            (Array.isArray(currentState?.ungrouped) ? currentState.ungrouped : []).forEach(pushUngrouped);
            getMapLikeEntries(currentSourceState).forEach(([sourceKey]) => pushUngrouped(sourceKey));
            repairedState.ungrouped = nextUngrouped;

            if (currentState && typeof currentState === 'object') {
                if (currentState.customHeight != null) repairedState.customHeight = currentState.customHeight;
                if (currentState._saveRevision != null) repairedState._saveRevision = currentState._saveRevision;
                if (currentState._savedAt != null) repairedState._savedAt = currentState._savedAt;
            }

            return repairedState;
        }

        function findStructuralRepairCandidate(currentState, backupState, historyEntries = []) {
            if (!hasRestorableStateSnapshot(currentState)) return null;
            const candidates = [];

            if (backupState && backupState !== currentState) {
                candidates.push(backupState);
            }

            normalizeStateHistoryEntries(historyEntries).forEach((entry) => {
                if (entry.snapshot) candidates.push(entry.snapshot);
            });

            return candidates
                .filter((candidate) => isCompatibleStructuralRepairCandidate(currentState, candidate))
                .sort((left, right) => {
                    const leftGroupedCount = collectSnapshotGroupedSourceKeys(left).size;
                    const rightGroupedCount = collectSnapshotGroupedSourceKeys(right).size;
                    if (rightGroupedCount !== leftGroupedCount) return rightGroupedCount - leftGroupedCount;
                    return getSnapshotSaveRevision(right) - getSnapshotSaveRevision(left);
                })[0] || null;
        }

        function normalizeStateHistoryEntries(entries) {
            const list = Array.isArray(entries) ? entries : [];
            return list
                .filter((entry) => entry && typeof entry === 'object' && entry.snapshot && hasPersistableManagerState(entry.snapshot))
                .slice(0, 5)
                .map((entry) => ({
                    id: typeof entry.id === 'string' && entry.id ? entry.id : `history-${Date.now()}-${Math.random()}`,
                    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
                    reason: typeof entry.reason === 'string' ? entry.reason : 'manual',
                    sourceCount: Number(entry.sourceCount) || getPersistableStateCounts(entry.snapshot).sourceCount,
                    groupCount: Number(entry.groupCount) || getPersistableStateCounts(entry.snapshot).groupCount,
                    tagCount: Number(entry.tagCount) || getPersistableStateCounts(entry.snapshot).tagCount,
                    saveRevision: getSnapshotSaveRevision(entry.snapshot) || Number(entry.saveRevision) || 0,
                    snapshot: cloneSerializableData(entry.snapshot)
                }));
        }

        function setStateHistoryEntries(entries) {
            ctx.stateHistoryEntries = normalizeStateHistoryEntries(entries);
            return ctx.stateHistoryEntries;
        }

        function getStateHistoryEntries() {
            return normalizeStateHistoryEntries(ctx.stateHistoryEntries || []);
        }

        function loadStateHistory(projectId = ctx.projectId) {
            const key = getStateHistoryKey(projectId);
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

        function appendStateHistorySnapshot(snapshot = buildPersistableState(), reason = 'manual') {
            if (!ctx.projectId || !hasPersistableManagerState(snapshot)) {
                return Promise.resolve(getStateHistoryEntries());
            }

            const key = getStateHistoryKey();
            const payloadSnapshot = cloneSerializableData(snapshot);
            const counts = getPersistableStateCounts(payloadSnapshot);
            const entry = {
                id: `${ctx.projectId}:${Date.now()}`,
                createdAt: new Date().toISOString(),
                reason,
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount,
                saveRevision: getSnapshotSaveRevision(payloadSnapshot),
                snapshot: payloadSnapshot
            };
            developerLog('info', 'persistence', 'history_snapshot_append_requested', {
                reason,
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount,
                saveRevision: entry.saveRevision
            });

            const appendLocally = () => new Promise((resolve) => {
                if (!chromeApi?.storage?.local?.get || !chromeApi?.storage?.local?.set) {
                    resolve(getStateHistoryEntries());
                    return;
                }

                try {
                    chromeApi.storage.local.get([key], (data) => {
                        if (chromeApi.runtime?.lastError) {
                            resolve(getStateHistoryEntries());
                            return;
                        }
                        const existingEntries = normalizeStateHistoryEntries(data?.[key] || []);
                        const nextSignature = getStateHistorySnapshotSignature(payloadSnapshot);
                        const nextEntries = [
                            entry,
                            ...existingEntries.filter((item) => (
                                getStateHistorySnapshotSignature(item.snapshot) !== nextSignature
                            ))
                        ].slice(0, 5);
                        chromeApi.storage.local.set({ [key]: nextEntries }, () => {
                            if (chromeApi.runtime?.lastError) {
                                resolve(getStateHistoryEntries());
                                return;
                            }
                            resolve(setStateHistoryEntries(nextEntries));
                        });
                    });
                } catch (error) {
                    resolve(getStateHistoryEntries());
                }
            });

            if (!chromeApi?.runtime?.sendMessage) {
                return appendLocally();
            }

            return new Promise((resolve) => {
                try {
                    chromeApi.runtime.sendMessage({
                        type: 'APPEND_STATE_HISTORY',
                        key,
                        entry
                    }, (response) => {
                        if (chromeApi.runtime.lastError || !response || response.success === false) {
                            resolve(getStateHistoryEntries());
                            return;
                        }
                        resolve(setStateHistoryEntries(response.history || []));
                    });
                } catch (error) {
                    resolve(getStateHistoryEntries());
                }
            });
        }

        function pickPreferredStoredState(primaryState, backupState, historyEntries = []) {
            ctx.pendingStructuralStateRepair = null;
            const preferredPrimaryState = getComparableStoredState(primaryState, backupState);
            let selectedState = null;
            if (preferredPrimaryState !== primaryState) {
                rememberSnapshotSaveRevision(preferredPrimaryState);
                selectedState = preferredPrimaryState;
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
                const backupKey = `${key}__backup`;
                const writePayload = () => {
                    const payload = { [key]: data };
                    if (hasRestorableStateSnapshot(data)) {
                        payload[backupKey] = data;
                    }

                    chromeApi.storage.local.set(payload, () => {
                        if (chromeApi.runtime?.lastError) {
                            console.warn('NotebookLM Source Management: Local storage write failed:', chromeApi.runtime.lastError);
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
                    const currentState = pickPreferredStoredState(
                        existingData && typeof existingData === 'object' ? existingData[key] : null,
                        existingData && typeof existingData === 'object' ? existingData[backupKey] : null
                    );

                    if (isStaleStateWrite(data, currentState)) {
                        resolve({ ok: true, stale: true });
                        return;
                    }

                    writePayload();
                };

                try {
                    if (chromeApi.storage.local.get) {
                        chromeApi.storage.local.get([key, backupKey], (existingData) => {
                            if (chromeApi.runtime?.lastError) {
                                console.warn('NotebookLM Source Management: Local storage revision check failed:', chromeApi.runtime.lastError);
                                resolve({ ok: false, reason: 'local_storage_revision_check_error' });
                                return;
                            }
                            handleExistingState(existingData);
                        });
                        return;
                    }

                    writePayload();
                } catch (error) {
                    console.warn('NotebookLM Source Management: Local storage write threw:', error);
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
                            console.error('NotebookLM Source Management 通信失败:', chromeApi.runtime.lastError);
                            resolve({ ok: false, reason: 'runtime_message_error' });
                            return;
                        }

                        if (response && response.success === false) {
                            console.warn('NotebookLM Source Management: SAVE_STATE rejected by background:', response.errorCode || 'unknown_error');
                            const storageMetadata = getStorageMetadataFromResponse(response);
                            if (response.errorCode === 'stale_revision') {
                                const currentRevision = Number(response.currentRevision) || 0;
                                if (currentRevision > ctx.lastKnownSaveRevision) {
                                    ctx.lastKnownSaveRevision = currentRevision;
                                }
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
                                reason: response.errorCode || 'runtime_failure',
                                ...storageMetadata
                            });
                            return;
                        }

                        const saveRevision = Number(response?.saveRevision) || 0;
                        const storageMetadata = getStorageMetadataFromResponse(response);
                        if (saveRevision > ctx.lastKnownSaveRevision) {
                            ctx.lastKnownSaveRevision = saveRevision;
                        }
                        resolve({
                            ok: true,
                            stale: Boolean(response?.stale),
                            saveRevision,
                            savedAt: response?.savedAt || '',
                            ...storageMetadata
                        });
                    });
                } catch (error) {
                    console.warn('NotebookLM Source Management: Context invalidated. Please refresh the page.', error);
                    resolve({ ok: false, reason: 'runtime_exception' });
                }
            });
        }

        async function sendStateToStorage(key, data, options = {}) {
            const { skipRuntimeMessage = false } = options;
            if (!skipRuntimeMessage) {
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

                const localData = data && data._saveRevision ? data : preparePersistableSnapshot(data);
                const localResult = await writeStateToLocalStorage(key, localData);
                if (localResult.stale) {
                    return {
                        ok: false,
                        reason: 'stale_revision',
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

            const localData = data && data._saveRevision ? data : preparePersistableSnapshot(data);
            const localResult = await writeStateToLocalStorage(key, localData);
            if (localResult.stale) {
                return {
                    ok: false,
                    reason: 'stale_revision',
                    localResult,
                    runtimeResult: { skipped: true, reason: 'runtime_skipped' }
                };
            }
            if (localResult.ok) {
                return {
                    ok: true,
                    localResult,
                    localData,
                    runtimeResult: { skipped: true, reason: 'runtime_skipped' }
                };
            }

            return {
                ok: false,
                reason: localResult.reason || 'save_failed',
                localResult,
                runtimeResult: { skipped: true, reason: 'runtime_skipped' }
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
            const clientSaveId = createClientSaveId();
            const snapshot = prepareRuntimeSaveSnapshot(rawSnapshot);
            const counts = getPersistableStateCounts(snapshot);
            developerLog('debug', 'persistence', 'state_save_requested', {
                clientSaveId,
                critical: Boolean(options.critical),
                immediate: Boolean(options.immediate),
                reason: options.reason || '',
                sourceCount: counts.sourceCount,
                groupCount: counts.groupCount,
                tagCount: counts.tagCount
            });
            if (options.critical) {
                writeRecoverySnapshot(snapshot, {
                    reason: options.reason || 'critical_save',
                    clientSaveId
                });
            }
            const runSave = () => {
                const baseRevision = Number(ctx.lastKnownSaveRevision) || 0;
                const saveSnapshot = options.skipRuntimeMessage
                    ? preparePersistableSnapshot(snapshot)
                    : snapshot;
                setSaveStatus({
                    state: 'saving',
                    lastError: '',
                    clientSaveId
                });
                return sendStateToStorage(key, saveSnapshot, Object.assign({}, options, {
                        baseRevision,
                        clientSaveId
                    }))
                    .then((result) => {
                        const storageMetadata = getStorageMetadataFromResult(result);
                        const hasStorageMetadata = storageMetadata.storageQuotaBytes > 0 || storageMetadata.storageUsageBytes > 0;
                        const currentStatus = getSaveStatus();
                        if (result.ok) {
                            const saveRevision = result.runtimeResult?.saveRevision
                                || getSnapshotSaveRevision(result.localData)
                                || getSnapshotSaveRevision(saveSnapshot)
                                || ctx.lastKnownSaveRevision;
                            const savedAt = result.runtimeResult?.savedAt || result.localData?._savedAt || saveSnapshot._savedAt || new Date().toISOString();
                            if (saveRevision > ctx.lastKnownSaveRevision) {
                                ctx.lastKnownSaveRevision = saveRevision;
                            }
                            setSaveStatus({
                                state: 'saved',
                                lastSavedAt: savedAt,
                                lastSaveRevision: saveRevision,
                                currentRevision: saveRevision,
                                lastError: '',
                                clientSaveId,
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
                            if (options.critical) {
                                clearRecoverySnapshot();
                            }
                            developerLog('info', 'persistence', 'state_save_succeeded', {
                                clientSaveId,
                                saveRevision,
                                storageWarning: Boolean(storageMetadata.storageWarning),
                                storageUsageBytes: storageMetadata.storageUsageBytes,
                                storageQuotaBytes: storageMetadata.storageQuotaBytes
                            });
                        } else {
                            const lastStorageError = result.reason === 'storage_quota_exceeded'
                                ? 'storage_quota_exceeded'
                                : getSaveStatus().lastStorageError || '';
                            const staleRemoteRevision = result.reason === 'stale_revision'
                                ? Number(result.runtimeResult?.currentRevision) || ctx.lastKnownSaveRevision
                                : currentStatus.lastStaleRemoteRevision || 0;
                            const staleLocalRevision = result.reason === 'stale_revision'
                                ? baseRevision
                                : currentStatus.lastStaleLocalRevision || 0;
                            const staleDetectedAt = result.reason === 'stale_revision'
                                ? new Date().toISOString()
                                : currentStatus.lastStaleDetectedAt || '';
                            setSaveStatus({
                                state: result.reason === 'stale_revision' ? 'stale' : 'failed',
                                lastError: result.reason || 'save_failed',
                                currentRevision: result.runtimeResult?.currentRevision || ctx.lastKnownSaveRevision,
                                clientSaveId,
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
                            if (options.critical) {
                                writeRecoverySnapshot(saveSnapshot, {
                                    reason: result.reason || 'save_failed',
                                    clientSaveId,
                                    failed: true
                                });
                            }
                            developerLog('warn', 'persistence', 'state_save_failed', {
                                clientSaveId,
                                reason: result.reason || 'save_failed',
                                staleLocalRevision,
                                staleRemoteRevision,
                                storageWarning: Boolean(storageMetadata.storageWarning),
                                storageUsageBytes: storageMetadata.storageUsageBytes,
                                storageQuotaBytes: storageMetadata.storageQuotaBytes
                            });
                        }
                        if (options.critical) {
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

        function saveLifecycleSnapshotToLocalStorage(key, rawSnapshot) {
            writeRecoverySnapshot(rawSnapshot, { reason: 'page_lifecycle' });
            return prepareAndQueueStateSave(key, rawSnapshot, {
                skipRuntimeMessage: true,
                critical: true,
                reason: 'page_lifecycle',
                recordUndo: false
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
                sourceStateById[sourceKey] = sourceRecord;

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
                return prepareAndQueueStateSave(key, persistableState, options);
            }

            debouncedStorageSet(key, persistableState);
            return waitForPendingStateSave();
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
            return saveLifecycleSnapshotToLocalStorage(key, persistableState);
        }

        function normalizeLoadedState(stateData) {
            if (!stateData || typeof stateData !== 'object') return null;
            rememberSnapshotSaveRevision(stateData);

            if (stateData.schemaVersion === storageSchemaVersion) {
                ctx.pendingStorageUpgrade = Boolean(ctx.pendingStructuralStateRepair);
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

            state.groups = (Array.isArray(loadedState.groups) ? loadedState.groups : [])
                .filter((groupId) => groupsById.has(groupId));
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
                detectRecoverySnapshotAvailability(rawState);
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
                    const historyKey = getStateHistoryKey(expectedProjectId);
                    chromeApi.storage.local.get([key, backupKey, historyKey], (data) => {
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
                        const historyEntries = data && typeof data === 'object' ? data[historyKey] : [];
                        finalizeLoadedState(pickPreferredStoredState(primaryState, backupState, historyEntries));
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
            getBestPersistableSnapshot,
            saveState,
            handlePageLifecyclePersistence,
            normalizeLoadedState,
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
