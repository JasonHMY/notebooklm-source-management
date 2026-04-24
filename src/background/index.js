const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';
const NOTEBOOKLM_URL_PATTERN = 'https://notebooklm.google.com/*';
const NOTEBOOKLM_NOTEBOOK_PREFIX = 'https://notebooklm.google.com/notebook/';
const CHROME_WEB_STORE_DETAIL_URL_PREFIX = 'https://chrome.google.com/webstore/detail/';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
const STATE_KEY_PREFIX = 'sourcesPlusState_';
const STATE_HISTORY_KEY_PREFIX = 'sourcesPlusHistory_';
const STATE_HISTORY_LIMIT = 5;
const ERROR_CODES = {
    INVALID_STORAGE_KEY: 'invalid_storage_key',
    RUNTIME_FAILURE: 'runtime_failure',
    UNAUTHORIZED_SENDER: 'unauthorized_sender',
    TABS_QUERY_FAILED: 'tabs_query_failed',
    TAB_FOCUS_FAILED: 'tab_focus_failed',
    WINDOW_FOCUS_FAILED: 'window_focus_failed',
    TAB_CREATE_FAILED: 'tab_create_failed',
    STALE_REVISION: 'stale_revision'
};
const stateSaveQueueByKey = new Map();

function isAuthorizedNotebookSender(sender) {
    return Boolean(
        sender &&
        sender.tab &&
        typeof sender.tab.url === 'string' &&
        sender.tab.url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX)
    );
}

function pickPreferredNotebookTab(tabs) {
    if (!Array.isArray(tabs) || tabs.length === 0) return null;
    return tabs.find(tab => typeof tab.url === 'string' && tab.url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX)) || tabs[0];
}

function isNotebookHomeTab(tab) {
    return Boolean(tab && typeof tab.url === 'string' && tab.url.startsWith(NOTEBOOKLM_HOME_URL) && !tab.url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX));
}

function focusTab(tab, action, sendResponse) {
    chrome.tabs.update(tab.id, { active: true }, (updatedTab) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.TAB_FOCUS_FAILED });
            return;
        }

        if (chrome.windows && typeof chrome.windows.update === 'function') {
            chrome.windows.update(tab.windowId, { focused: true }, () => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, errorCode: ERROR_CODES.WINDOW_FOCUS_FAILED });
                    return;
                }

                sendResponse({
                    success: true,
                    action,
                    tabId: (updatedTab && updatedTab.id) || tab.id,
                    url: (updatedTab && updatedTab.url) || tab.url
                });
            });
            return;
        }

        sendResponse({
            success: true,
            action,
            tabId: (updatedTab && updatedTab.id) || tab.id,
            url: (updatedTab && updatedTab.url) || tab.url
        });
    });
}

function openNewNotebookLmHome(sendResponse) {
    chrome.tabs.create({ url: NOTEBOOKLM_HOME_URL }, (tab) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.TAB_CREATE_FAILED });
            return;
        }

        sendResponse({
            success: true,
            action: 'opened-new-home',
            tabId: tab && tab.id,
            url: (tab && tab.url) || NOTEBOOKLM_HOME_URL
        });
    });
}

function getManifestWebStoreFeedbackUrl(manifest = globalThis.chrome?.runtime?.getManifest?.()) {
    const homepageUrl = typeof manifest?.homepage_url === 'string' ? manifest.homepage_url : '';
    if (!homepageUrl) return '';

    try {
        const url = new URL(homepageUrl);
        const path = url.pathname.replace(/\/+$/, '');
        const isChromeWebStoreUrl = (
            (url.hostname === 'chromewebstore.google.com' && path.startsWith('/detail/')) ||
            (url.hostname === 'chrome.google.com' && path.startsWith('/webstore/detail/'))
        );
        if (!isChromeWebStoreUrl) return '';

        return `${url.origin}${path.endsWith('/reviews') ? path : `${path}/reviews`}`;
    } catch (error) {
        return '';
    }
}

function getWebStoreFeedbackUrl(
    extensionId = globalThis.chrome?.runtime?.id,
    manifest = globalThis.chrome?.runtime?.getManifest?.()
) {
    const manifestFeedbackUrl = getManifestWebStoreFeedbackUrl(manifest);
    if (manifestFeedbackUrl) {
        return manifestFeedbackUrl;
    }

    if (typeof extensionId !== 'string' || !extensionId.trim()) {
        return '';
    }
    return `${CHROME_WEB_STORE_DETAIL_URL_PREFIX}${encodeURIComponent(extensionId.trim())}/reviews`;
}

function openWebStoreFeedback(sendResponse) {
    const url = getWebStoreFeedbackUrl();
    if (!url || !chrome.tabs || typeof chrome.tabs.create !== 'function') {
        sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
        return;
    }

    chrome.tabs.create({ url }, (tab) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.TAB_CREATE_FAILED });
            return;
        }

        sendResponse({
            success: true,
            tabId: tab && tab.id,
            url
        });
    });
}

function getExtensionEnabled(sendResponse) {
    chrome.storage.local.get([EXTENSION_ENABLED_KEY], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        sendResponse({
            success: true,
            enabled: data?.[EXTENSION_ENABLED_KEY] !== false
        });
    });
}

function forwardManagerToggleToTab(tabId, enabled, sendResponse) {
    if (typeof tabId !== 'number') {
        sendResponse({ success: true, enabled, forwarded: false });
        return;
    }

    chrome.tabs.sendMessage(tabId, {
        type: enabled ? 'ENABLE_MANAGER' : 'DISABLE_MANAGER'
    }, () => {
        if (chrome.runtime.lastError) {
            sendResponse({
                success: true,
                enabled,
                forwarded: false,
                forwardErrorCode: 'tab_message_failed'
            });
            return;
        }

        sendResponse({ success: true, enabled, forwarded: true });
    });
}

function setExtensionEnabled(request, sendResponse) {
    const enabled = request?.enabled !== false;

    chrome.storage.local.set({ [EXTENSION_ENABLED_KEY]: enabled }, () => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        forwardManagerToggleToTab(request?.tabId, enabled, sendResponse);
    });
}

function openOrFocusNotebookLm(request, sendResponse) {
    const currentTabId = typeof request.currentTabId === 'number' ? request.currentTabId : null;
    const currentContext = typeof request.currentContext === 'string' ? request.currentContext : 'external';

    chrome.tabs.query({ url: NOTEBOOKLM_URL_PATTERN }, (tabs) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.TABS_QUERY_FAILED });
            return;
        }

        const notebookTabs = tabs.filter(tab => typeof tab.url === 'string' && tab.url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX));
        const preferredNotebookTab = pickPreferredNotebookTab(notebookTabs);
        if (preferredNotebookTab) {
            focusTab(preferredNotebookTab, 'focused-existing-notebook', sendResponse);
            return;
        }

        if (currentContext === 'notebook-home') {
            openNewNotebookLmHome(sendResponse);
            return;
        }

        const reusableHomeTab = tabs.find(tab => isNotebookHomeTab(tab) && tab.id !== currentTabId);
        if (reusableHomeTab) {
            focusTab(reusableHomeTab, 'focused-existing-home', sendResponse);
            return;
        }

        openNewNotebookLmHome(sendResponse);
    });
}

function getStateBackupKey(primaryKey) {
    return `${primaryKey}__backup`;
}

function getStateHistoryKey(primaryKey) {
    return `${STATE_HISTORY_KEY_PREFIX}${String(primaryKey || '').replace(/^sourcesPlusState_/, '')}`;
}

function hasRestorableStateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (Array.isArray(snapshot.groups) && snapshot.groups.length > 0) return true;
    if (snapshot.groupsById && Object.keys(snapshot.groupsById).length > 0) return true;
    if (Array.isArray(snapshot.ungrouped) && snapshot.ungrouped.length > 0) return true;
    if (snapshot.sourceStateById && Object.keys(snapshot.sourceStateById).length > 0) return true;
    if (snapshot.tagsById && Object.keys(snapshot.tagsById).length > 0) return true;
    if (Array.isArray(snapshot.tagOrder) && snapshot.tagOrder.length > 0) return true;
    if (snapshot.sourceTagsById && Object.keys(snapshot.sourceTagsById).length > 0) return true;
    return false;
}

function getSnapshotSaveRevision(snapshot) {
    const revision = Number(snapshot?._saveRevision);
    return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function cloneSerializableData(value) {
    if (value == null) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
    }
}

function getStableComparableHistoryValue(value, seenValues = new WeakSet()) {
    if (value == null || typeof value !== 'object') return value;
    if (seenValues.has(value)) return null;
    seenValues.add(value);

    try {
        if (Array.isArray(value)) {
            return value.map((item) => getStableComparableHistoryValue(item, seenValues));
        }

        return Object.keys(value)
            .filter((key) => key !== '_saveRevision' && key !== '_savedAt')
            .sort()
            .reduce((acc, key) => {
                acc[key] = getStableComparableHistoryValue(value[key], seenValues);
                return acc;
            }, {});
    } finally {
        seenValues.delete(value);
    }
}

function getHistorySnapshotSignature(snapshot) {
    try {
        return JSON.stringify(getStableComparableHistoryValue(snapshot || null));
    } catch (error) {
        return '';
    }
}

function getPersistableStateCounts(snapshot) {
    return {
        sourceCount: Object.keys(snapshot?.sourceStateById || {}).length,
        groupCount: Object.keys(snapshot?.groupsById || {}).length,
        tagCount: Object.keys(snapshot?.tagsById || {}).length
    };
}

function normalizeHistoryEntry(entry, fallbackReason = 'save') {
    if (!entry || typeof entry !== 'object' || !entry.snapshot || !hasRestorableStateSnapshot(entry.snapshot)) {
        return null;
    }
    const counts = getPersistableStateCounts(entry.snapshot);
    const createdAt = typeof entry.createdAt === 'string' && entry.createdAt
        ? entry.createdAt
        : new Date().toISOString();
    return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : `history:${createdAt}:${Math.random()}`,
        createdAt,
        reason: typeof entry.reason === 'string' && entry.reason ? entry.reason : fallbackReason,
        sourceCount: Number(entry.sourceCount) || counts.sourceCount,
        groupCount: Number(entry.groupCount) || counts.groupCount,
        tagCount: Number(entry.tagCount) || counts.tagCount,
        saveRevision: Number(entry.saveRevision) || getSnapshotSaveRevision(entry.snapshot),
        snapshot: cloneSerializableData(entry.snapshot)
    };
}

function normalizeStateHistoryEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map((entry) => normalizeHistoryEntry(entry))
        .filter(Boolean)
        .slice(0, STATE_HISTORY_LIMIT);
}

function appendHistoryEntry(existingEntries, entry) {
    const normalizedEntry = normalizeHistoryEntry(entry);
    if (!normalizedEntry) {
        return normalizeStateHistoryEntries(existingEntries);
    }

    const nextSignature = getHistorySnapshotSignature(normalizedEntry.snapshot);
    return [
        normalizedEntry,
        ...normalizeStateHistoryEntries(existingEntries).filter((existingEntry) => (
            getHistorySnapshotSignature(existingEntry.snapshot) !== nextSignature
        ))
    ].slice(0, STATE_HISTORY_LIMIT);
}

function createHistoryEntryFromSnapshot(snapshot, reason = 'save') {
    const counts = getPersistableStateCounts(snapshot);
    const createdAt = new Date().toISOString();
    return normalizeHistoryEntry({
        id: `history:${createdAt}:${getSnapshotSaveRevision(snapshot) || 0}`,
        createdAt,
        reason,
        sourceCount: counts.sourceCount,
        groupCount: counts.groupCount,
        tagCount: counts.tagCount,
        saveRevision: getSnapshotSaveRevision(snapshot),
        snapshot
    }, reason);
}

function getRequestBaseRevision(request) {
    const revision = Number(request?.baseRevision);
    return Number.isFinite(revision) && revision >= 0 ? revision : null;
}

function isStaleStateWrite(incomingState, storedState) {
    const incomingRevision = getSnapshotSaveRevision(incomingState);
    const storedRevision = getSnapshotSaveRevision(storedState);
    return incomingRevision > 0 && storedRevision > 0 && incomingRevision < storedRevision;
}

function isStaleBaseRevision(baseRevision, storedState) {
    const storedRevision = getSnapshotSaveRevision(storedState);
    return baseRevision != null && storedRevision > 0 && baseRevision < storedRevision;
}

function createSavedStateSnapshot(data, currentRevision, baseRevision = null) {
    const snapshot = cloneSerializableData(data || {});
    const incomingRevision = getSnapshotSaveRevision(snapshot);
    const explicitBaseRevision = Number(baseRevision);
    const comparableRevision = Number.isFinite(explicitBaseRevision) && explicitBaseRevision >= 0
        ? explicitBaseRevision
        : incomingRevision;
    const nextRevision = Math.max(currentRevision, comparableRevision) + 1;
    snapshot._saveRevision = nextRevision;
    snapshot._savedAt = new Date().toISOString();
    return snapshot;
}

function pickPreferredStoredState(primaryState, backupState) {
    if (
        hasRestorableStateSnapshot(primaryState) &&
        hasRestorableStateSnapshot(backupState) &&
        getSnapshotSaveRevision(backupState) > getSnapshotSaveRevision(primaryState)
    ) {
        return backupState;
    }

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

function writeStateWithRevisionGuard(request, sendResponse) {
    const key = request.key;
    const data = request.data;
    const backupKey = getStateBackupKey(key);
    const historyKey = getStateHistoryKey(key);
    const baseRevision = getRequestBaseRevision(request);
    chrome.storage.local.get([key, backupKey, historyKey], (existingData) => {
        if (chrome.runtime.lastError) {
            console.error('NotebookLM Source Management background save error:', chrome.runtime.lastError);
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        const currentState = pickPreferredStoredState(
            existingData && typeof existingData === 'object' ? existingData[key] : null,
            existingData && typeof existingData === 'object' ? existingData[backupKey] : null
        );
        const currentRevision = getSnapshotSaveRevision(currentState);

        if (isStaleBaseRevision(baseRevision, currentState)) {
            sendResponse({
                success: false,
                errorCode: ERROR_CODES.STALE_REVISION,
                currentRevision
            });
            return;
        }

        if (baseRevision == null && isStaleStateWrite(data, currentState)) {
            sendResponse({ success: true, stale: true, currentRevision });
            return;
        }

        const savedState = createSavedStateSnapshot(data, currentRevision, baseRevision);
        const storagePayload = { [key]: savedState };
        if (hasRestorableStateSnapshot(savedState)) {
            storagePayload[backupKey] = savedState;
            storagePayload[historyKey] = appendHistoryEntry(
                existingData && typeof existingData === 'object' ? existingData[historyKey] : [],
                createHistoryEntryFromSnapshot(savedState, request.critical ? 'critical_save' : 'save')
            );
        }

        chrome.storage.local.set(storagePayload, () => {
            if (chrome.runtime.lastError) {
                console.error('NotebookLM Source Management background save error:', chrome.runtime.lastError);
                sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            } else {
                sendResponse({
                    success: true,
                    saveRevision: savedState._saveRevision,
                    savedAt: savedState._savedAt
                });
            }
        });
    });
}

function loadStateHistoryNow(request, sendResponse) {
    const key = request.key;
    chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        sendResponse({
            success: true,
            history: normalizeStateHistoryEntries(data && typeof data === 'object' ? data[key] : [])
        });
    });
}

function appendStateHistoryNow(request, sendResponse) {
    const key = request.key;
    chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        const history = appendHistoryEntry(
            data && typeof data === 'object' ? data[key] : [],
            request.entry
        );
        chrome.storage.local.set({ [key]: history }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
                return;
            }
            sendResponse({ success: true, history });
        });
    });
}

function enqueueStorageTask(key, createTask) {
    const previousTask = stateSaveQueueByKey.get(key);

    let storageTask;
    if (previousTask) {
        storageTask = previousTask.catch(() => null).then(createTask);
    } else {
        try {
            storageTask = Promise.resolve(createTask());
        } catch (error) {
            storageTask = Promise.reject(error);
        }
    }

    stateSaveQueueByKey.set(key, storageTask);
    storageTask.finally(() => {
        if (stateSaveQueueByKey.get(key) === storageTask) {
            stateSaveQueueByKey.delete(key);
        }
    }).catch(() => {});

    return storageTask;
}

function enqueueStateWrite(request, sendResponse) {
    enqueueStorageTask(request.key, () => new Promise((resolve) => {
        writeStateWithRevisionGuard(request, (response) => {
            sendResponse(response);
            resolve(response);
        });
    }));
}

function loadStateHistory(request, sendResponse) {
    const pendingTask = stateSaveQueueByKey.get(request.key);
    if (!pendingTask) {
        loadStateHistoryNow(request, sendResponse);
        return;
    }

    pendingTask
        .catch(() => null)
        .then(() => loadStateHistoryNow(request, sendResponse));
}

function appendStateHistory(request, sendResponse) {
    enqueueStorageTask(request.key, () => new Promise((resolve) => {
        appendStateHistoryNow(request, (response) => {
            sendResponse(response);
            resolve(response);
        });
    }));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.type !== 'string') {
        return;
    }

    if (request.type === 'OPEN_OR_FOCUS_NOTEBOOKLM') {
        openOrFocusNotebookLm(request, sendResponse);
        return true;
    }

    if (request.type === 'OPEN_WEB_STORE_FEEDBACK') {
        openWebStoreFeedback(sendResponse);
        return true;
    }

    if (request.type === 'GET_EXTENSION_ENABLED') {
        getExtensionEnabled(sendResponse);
        return true;
    }

    if (request.type === 'SET_EXTENSION_ENABLED') {
        setExtensionEnabled(request, sendResponse);
        return true;
    }

    if (
        request.type !== 'SAVE_STATE' &&
        request.type !== 'LOAD_STATE' &&
        request.type !== 'LOAD_STATE_HISTORY' &&
        request.type !== 'APPEND_STATE_HISTORY'
    ) {
        return;
    }

    if (!isAuthorizedNotebookSender(sender)) {
        console.warn('NotebookLM Source Management: Received message from unauthorized sender:', sender);
        sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
        return;
    }

    if (request.type === 'SAVE_STATE') {
        if (typeof request.key !== 'string' || !request.key.startsWith(STATE_KEY_PREFIX)) {
            console.warn('NotebookLM Source Management: Received SAVE_STATE with invalid key:', request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
            return;
        }

        enqueueStateWrite(request, sendResponse);
        return true;
    }

    if (request.type === 'LOAD_STATE_HISTORY' || request.type === 'APPEND_STATE_HISTORY') {
        if (typeof request.key !== 'string' || !request.key.startsWith(STATE_HISTORY_KEY_PREFIX)) {
            console.warn(`NotebookLM Source Management: Received ${request.type} with invalid key:`, request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
            return;
        }

        if (request.type === 'LOAD_STATE_HISTORY') {
            loadStateHistory(request, sendResponse);
            return true;
        }

        appendStateHistory(request, sendResponse);
        return true;
    }

    if (typeof request.key !== 'string' || !request.key.startsWith(STATE_KEY_PREFIX)) {
        console.warn('NotebookLM Source Management: Received LOAD_STATE with invalid key:', request.key);
        sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
        return;
    }

    const backupKey = getStateBackupKey(request.key);
    chrome.storage.local.get([request.key, backupKey], (data) => {
        if (chrome.runtime.lastError) {
            console.error('NotebookLM Source Management background load error:', chrome.runtime.lastError);
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        const primaryState = data && typeof data === 'object' ? data[request.key] : null;
        const backupState = data && typeof data === 'object' ? data[backupKey] : null;
        const storedData = pickPreferredStoredState(primaryState, backupState);
        sendResponse({ success: true, data: storedData ?? null });
    });
    return true;
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        NOTEBOOKLM_HOME_URL,
        NOTEBOOKLM_NOTEBOOK_PREFIX,
        EXTENSION_ENABLED_KEY,
        STATE_HISTORY_KEY_PREFIX,
        STATE_HISTORY_LIMIT,
        ERROR_CODES,
        CHROME_WEB_STORE_DETAIL_URL_PREFIX,
        getStateBackupKey,
        getStateHistoryKey,
        getSnapshotSaveRevision,
        normalizeStateHistoryEntries,
        appendHistoryEntry,
        createHistoryEntryFromSnapshot,
        getRequestBaseRevision,
        isStaleStateWrite,
        isStaleBaseRevision,
        createSavedStateSnapshot,
        hasRestorableStateSnapshot,
        pickPreferredStoredState,
        isNotebookHomeTab,
        pickPreferredNotebookTab,
        isAuthorizedNotebookSender,
        getManifestWebStoreFeedbackUrl,
        getWebStoreFeedbackUrl,
        openWebStoreFeedback,
        getExtensionEnabled,
        setExtensionEnabled
    };
}
