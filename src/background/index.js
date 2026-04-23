const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';
const NOTEBOOKLM_URL_PATTERN = 'https://notebooklm.google.com/*';
const NOTEBOOKLM_NOTEBOOK_PREFIX = 'https://notebooklm.google.com/notebook/';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
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
    const baseRevision = getRequestBaseRevision(request);
    chrome.storage.local.get([key, backupKey], (existingData) => {
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

function enqueueStateWrite(request, sendResponse) {
    const key = request.key;
    const createTask = () => new Promise((resolve) => {
        writeStateWithRevisionGuard(request, (response) => {
            sendResponse(response);
            resolve(response);
        });
    });
    const previousTask = stateSaveQueueByKey.get(key);

    if (!previousTask) {
        const saveTask = createTask();
        stateSaveQueueByKey.set(key, saveTask);
        saveTask.finally(() => {
            if (stateSaveQueueByKey.get(key) === saveTask) {
                stateSaveQueueByKey.delete(key);
            }
        }).catch(() => {});
        return;
    }

    const saveTask = previousTask
        .catch(() => null)
        .then(createTask);
    stateSaveQueueByKey.set(key, saveTask);
    saveTask.finally(() => {
        if (stateSaveQueueByKey.get(key) === saveTask) {
            stateSaveQueueByKey.delete(key);
        }
    }).catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.type !== 'string') {
        return;
    }

    if (request.type === 'OPEN_OR_FOCUS_NOTEBOOKLM') {
        openOrFocusNotebookLm(request, sendResponse);
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

    if (request.type !== 'SAVE_STATE' && request.type !== 'LOAD_STATE') {
        return;
    }

    if (!isAuthorizedNotebookSender(sender)) {
        console.warn('NotebookLM Source Management: Received message from unauthorized sender:', sender);
        sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
        return;
    }

    if (request.type === 'SAVE_STATE') {
        if (typeof request.key !== 'string' || !request.key.startsWith('sourcesPlusState_')) {
            console.warn('NotebookLM Source Management: Received SAVE_STATE with invalid key:', request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
            return;
        }

        enqueueStateWrite(request, sendResponse);
        return true;
    }

    if (typeof request.key !== 'string' || !request.key.startsWith('sourcesPlusState_')) {
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
        ERROR_CODES,
        getStateBackupKey,
        getSnapshotSaveRevision,
        getRequestBaseRevision,
        isStaleStateWrite,
        isStaleBaseRevision,
        createSavedStateSnapshot,
        hasRestorableStateSnapshot,
        pickPreferredStoredState,
        isNotebookHomeTab,
        pickPreferredNotebookTab,
        isAuthorizedNotebookSender,
        getExtensionEnabled,
        setExtensionEnabled
    };
}
