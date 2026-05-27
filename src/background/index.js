const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';
const NOTEBOOKLM_URL_PATTERN = 'https://notebooklm.google.com/*';
const NOTEBOOKLM_NOTEBOOK_PREFIX = 'https://notebooklm.google.com/notebook/';
const CHROME_WEB_STORE_DETAIL_URL_PREFIX = 'https://chrome.google.com/webstore/detail/';
const EXTENSION_ENABLED_KEY = 'extensionEnabled';
const PREFERENCES_KEY = 'sourcesPlusPreferences';
const STATE_KEY_PREFIX = 'sourcesPlusState_';
const STATE_HISTORY_KEY_PREFIX = 'sourcesPlusHistory_';
const DEVELOPER_LOG_KEY_PREFIX = 'sourcesPlusDeveloperLogs_';
const STATE_HISTORY_LIMIT = 20;
const HISTORY_RETENTION_LIMIT_OPTIONS = [20, 50, 100];
const QUICK_VIEW_BUTTON_KINDS = ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'];
const DEVELOPER_LOG_LIMIT = 500;
const DEVELOPER_LOG_MAX_BYTES = 512 * 1024;
const DEFAULT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;
const STORAGE_WARNING_RATIO = 0.8;
const STORAGE_CRITICAL_RATIO = 0.95;
const ERROR_CODES = {
    INVALID_STORAGE_KEY: 'invalid_storage_key',
    RUNTIME_FAILURE: 'runtime_failure',
    UNAUTHORIZED_SENDER: 'unauthorized_sender',
    TABS_QUERY_FAILED: 'tabs_query_failed',
    TAB_FOCUS_FAILED: 'tab_focus_failed',
    WINDOW_FOCUS_FAILED: 'window_focus_failed',
    TAB_CREATE_FAILED: 'tab_create_failed',
    STALE_REVISION: 'stale_revision',
    STORAGE_QUOTA_EXCEEDED: 'storage_quota_exceeded'
};
const stateSaveQueueByKey = new Map();

function getStorageQuotaBytes() {
    const quotaBytes = Number(globalThis.chrome?.storage?.local?.QUOTA_BYTES);
    return Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : DEFAULT_STORAGE_QUOTA_BYTES;
}

function getSerializedByteLength(value) {
    let serialized = '';
    try {
        serialized = JSON.stringify(value ?? null);
    } catch (error) {
        serialized = String(value ?? '');
    }

    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(serialized).length;
    }
    return serialized.length;
}

function createStorageUsageInfo(payload, quotaBytes = getStorageQuotaBytes()) {
    const storageUsageBytes = getSerializedByteLength(payload);
    const storageQuotaBytes = Number.isFinite(quotaBytes) && quotaBytes > 0
        ? quotaBytes
        : DEFAULT_STORAGE_QUOTA_BYTES;
    const storageUsageRatio = storageUsageBytes / storageQuotaBytes;
    return {
        storageUsageBytes,
        storageQuotaBytes,
        storageUsageRatio,
        storageWarning: storageUsageRatio >= STORAGE_WARNING_RATIO
    };
}

function isStorageCritical(usageInfo) {
    return Boolean(
        usageInfo &&
        (
            Number(usageInfo.storageUsageRatio) >= STORAGE_CRITICAL_RATIO ||
            Number(usageInfo.storageUsageBytes) > Number(usageInfo.storageQuotaBytes)
        )
    );
}

function isStorageQuotaError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('quota') ||
        message.includes('exceed') ||
        message.includes('maximum') ||
        message.includes('max_bytes');
}

function createStorageResponseFields(usageInfo = {}, extra = {}) {
    return Object.assign({
        storageUsageBytes: Number(usageInfo.storageUsageBytes) || 0,
        storageQuotaBytes: Number(usageInfo.storageQuotaBytes) || getStorageQuotaBytes(),
        storageUsageRatio: Number(usageInfo.storageUsageRatio) || 0,
        storageWarning: Boolean(usageInfo.storageWarning)
    }, extra);
}

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

function normalizePreferences(preferences = {}) {
    return {
        developerModeEnabled: Boolean(preferences?.developerModeEnabled),
        welcomeOnboardingSeenVersion: normalizePreferenceVersion(preferences?.welcomeOnboardingSeenVersion),
        whatsNewSeenVersion: normalizeWhatsNewSeenVersion(preferences?.whatsNewSeenVersion),
        historyRetentionLimit: normalizeHistoryRetentionLimit(preferences?.historyRetentionLimit),
        languageOverride: normalizeLanguageOverride(preferences?.languageOverride),
        commandShortcuts: normalizeCommandShortcuts(preferences?.commandShortcuts),
        visibleQuickViewKinds: normalizeVisibleQuickViewKinds(preferences?.visibleQuickViewKinds),
        appearance: normalizeAppearancePreferences(preferences?.appearance)
    };
}

function normalizePreferenceVersion(value) {
    const version = Number(value);
    if (!Number.isFinite(version) || version < 0) return 0;
    return Math.floor(version);
}

function normalizeWhatsNewSeenVersion(value) {
    if (value == null) return '';
    const text = String(value).trim();
    if (!text) return '';
    if (!/^\d+(?:\.\d+){0,3}$/.test(text)) return '';
    return text.split('.')
        .map((part) => String(Number(part)))
        .join('.');
}

function createPreferenceUsageState(storageData = {}) {
    const data = storageData && typeof storageData === 'object' ? storageData : {};
    const keys = Object.keys(data);
    const hasStoredPreferences = Object.prototype.hasOwnProperty.call(data, PREFERENCES_KEY);
    const hasNotebookData = keys.some((key) => (
        key.startsWith(STATE_KEY_PREFIX) ||
        key.startsWith(STATE_HISTORY_KEY_PREFIX) ||
        key.startsWith(DEVELOPER_LOG_KEY_PREFIX)
    ));
    return {
        hasExistingPluginData: hasStoredPreferences || hasNotebookData,
        hasStoredPreferences
    };
}

function normalizeHistoryRetentionLimit(value) {
    const limit = Number(value);
    return HISTORY_RETENTION_LIMIT_OPTIONS.includes(limit) ? limit : STATE_HISTORY_LIMIT;
}

function normalizeAppearancePreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        hoverSpotlightEnabled: source.hoverSpotlightEnabled !== false
    };
}

function normalizeLanguageOverride(value) {
    const normalized = String(value || 'auto').trim();
    return normalized === 'auto' || normalized === 'en' || normalized === 'es' || normalized === 'zh_CN'
        ? normalized
        : 'auto';
}

function normalizeCommandShortcutId(value) {
    const id = String(value || '').trim();
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : '';
}

function normalizeCommandShortcutKey(value) {
    const key = String(value || '').trim();
    if (!key) return '';
    if (key === ' ') return 'Space';
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
    if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
    if (key.length === 1) return key.toUpperCase();
    return key.replace(/^\w/, (char) => char.toUpperCase()).slice(0, 32);
}

function normalizeCommandShortcutCombo(value) {
    const parts = String(value || '')
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts.length < 2) return '';

    const modifierAliases = new Map([
        ['cmd', 'Meta'],
        ['command', 'Meta'],
        ['meta', 'Meta'],
        ['ctrl', 'Ctrl'],
        ['control', 'Ctrl'],
        ['alt', 'Alt'],
        ['option', 'Alt'],
        ['shift', 'Shift']
    ]);
    const modifiers = new Set();
    let shortcutKey = '';

    parts.forEach((part, index) => {
        const alias = modifierAliases.get(part.toLowerCase());
        if (alias && index < parts.length - 1) {
            modifiers.add(alias);
            return;
        }
        shortcutKey = normalizeCommandShortcutKey(part);
    });

    if (!shortcutKey || modifiers.size === 0) return '';
    return ['Meta', 'Ctrl', 'Alt', 'Shift']
        .filter((modifier) => modifiers.has(modifier))
        .concat(shortcutKey)
        .join('+');
}

function normalizeCommandShortcuts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value).reduce((result, [rawId, rawCombo]) => {
        const id = normalizeCommandShortcutId(rawId);
        const combo = normalizeCommandShortcutCombo(rawCombo);
        if (!id || !combo) return result;
        Object.keys(result).forEach((existingId) => {
            if (result[existingId] === combo && existingId !== id) {
                delete result[existingId];
            }
        });
        result[id] = combo;
        return result;
    }, {});
}

function normalizeVisibleQuickViewKinds(value) {
    if (!Array.isArray(value)) return [...QUICK_VIEW_BUTTON_KINDS];
    const requestedKinds = new Set(value.map((kind) => String(kind || '').trim().toLowerCase()));
    return QUICK_VIEW_BUTTON_KINDS.filter((kind) => requestedKinds.has(kind));
}

function mergeCommandShortcuts(existingShortcuts = {}, nextShortcuts = {}) {
    const merged = normalizeCommandShortcuts(existingShortcuts);
    if (!nextShortcuts || typeof nextShortcuts !== 'object' || Array.isArray(nextShortcuts)) {
        return merged;
    }
    Object.entries(nextShortcuts).forEach(([rawId, rawCombo]) => {
        const id = normalizeCommandShortcutId(rawId);
        if (!id) return;
        const combo = normalizeCommandShortcutCombo(rawCombo);
        if (!combo) {
            delete merged[id];
            return;
        }
        Object.keys(merged).forEach((existingId) => {
            if (merged[existingId] === combo && existingId !== id) {
                delete merged[existingId];
            }
        });
        merged[id] = combo;
    });
    return merged;
}

function mergePreferences(existingPreferences = {}, nextPreferences = {}) {
    const merged = normalizePreferences(existingPreferences);
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'developerModeEnabled')) {
        merged.developerModeEnabled = Boolean(nextPreferences.developerModeEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'welcomeOnboardingSeenVersion')) {
        merged.welcomeOnboardingSeenVersion = normalizePreferenceVersion(nextPreferences.welcomeOnboardingSeenVersion);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'whatsNewSeenVersion')) {
        merged.whatsNewSeenVersion = normalizeWhatsNewSeenVersion(nextPreferences.whatsNewSeenVersion);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'historyRetentionLimit')) {
        merged.historyRetentionLimit = normalizeHistoryRetentionLimit(nextPreferences.historyRetentionLimit);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'languageOverride')) {
        merged.languageOverride = normalizeLanguageOverride(nextPreferences.languageOverride);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'commandShortcuts')) {
        merged.commandShortcuts = mergeCommandShortcuts(merged.commandShortcuts, nextPreferences.commandShortcuts);
    }
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'visibleQuickViewKinds')) {
        merged.visibleQuickViewKinds = normalizeVisibleQuickViewKinds(nextPreferences.visibleQuickViewKinds);
    }
    return normalizePreferences(merged);
}

function getPreferences(sendResponse) {
    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        sendResponse({
            success: true,
            preferences: normalizePreferences(data?.[PREFERENCES_KEY]),
            usageState: createPreferenceUsageState(data)
        });
    });
}

function setPreferencesNow(request, sendResponse) {
    chrome.storage.local.get([PREFERENCES_KEY], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        const preferences = mergePreferences(data?.[PREFERENCES_KEY], request?.preferences);
        chrome.storage.local.set({ [PREFERENCES_KEY]: preferences }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
                return;
            }

            sendResponse({ success: true, preferences });
        });
    });
}

function setPreferences(request, sendResponse) {
    enqueueStorageTask(PREFERENCES_KEY, () => new Promise((resolve) => {
        setPreferencesNow(request, (response) => {
            sendResponse(response);
            resolve(response);
        });
    }));
}

function isValidDeveloperLogKey(key) {
    return typeof key === 'string' &&
        key.startsWith(DEVELOPER_LOG_KEY_PREFIX) &&
        key.length > DEVELOPER_LOG_KEY_PREFIX.length;
}

function normalizeDeveloperLogEntry(entry = {}) {
    return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : String(Date.now()),
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
        level: typeof entry.level === 'string' ? entry.level : 'info',
        category: typeof entry.category === 'string' ? entry.category : 'ui',
        event: typeof entry.event === 'string' ? entry.event : 'unknown_event',
        notebookId: typeof entry.notebookId === 'string' ? entry.notebookId : '',
        details: entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
            ? entry.details
            : {}
    };
}

function trimDeveloperLogs(logs = []) {
    const nextLogs = (Array.isArray(logs) ? logs : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map(normalizeDeveloperLogEntry);

    while (nextLogs.length > DEVELOPER_LOG_LIMIT) {
        nextLogs.shift();
    }
    while (nextLogs.length > 0 && getSerializedByteLength(nextLogs) > DEVELOPER_LOG_MAX_BYTES) {
        nextLogs.shift();
    }
    return nextLogs;
}

function loadDeveloperLogs(request, sendResponse) {
    if (!isValidDeveloperLogKey(request?.key)) {
        sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
        return;
    }

    chrome.storage.local.get([request.key], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        sendResponse({
            success: true,
            logs: trimDeveloperLogs(data?.[request.key] || [])
        });
    });
}

function appendDeveloperLog(request, sendResponse) {
    if (!isValidDeveloperLogKey(request?.key)) {
        sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
        return;
    }

    chrome.storage.local.get([request.key], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        const logs = trimDeveloperLogs([
            ...(Array.isArray(data?.[request.key]) ? data[request.key] : []),
            normalizeDeveloperLogEntry(request.entry)
        ]);
        chrome.storage.local.set({ [request.key]: logs }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
                return;
            }

            sendResponse({ success: true, logs });
        });
    });
}

function clearDeveloperLogs(request, sendResponse) {
    if (!isValidDeveloperLogKey(request?.key)) {
        sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
        return;
    }

    chrome.storage.local.set({ [request.key]: [] }, () => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }

        sendResponse({ success: true, logs: [] });
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
    if (typeof globalThis.structuredClone === 'function') {
        try {
            return globalThis.structuredClone(value);
        } catch (error) {
            // Fall through to JSON cloning for plain persisted state objects.
        }
    }
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

function areStateSnapshotsEquivalent(leftSnapshot, rightSnapshot) {
    const leftSignature = getHistorySnapshotSignature(leftSnapshot);
    const rightSignature = getHistorySnapshotSignature(rightSnapshot);
    return Boolean(leftSignature && rightSignature && leftSignature === rightSignature);
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
        label: typeof entry.label === 'string' ? entry.label.slice(0, 48) : '',
        manual: Boolean(entry.manual),
        snapshot: cloneSerializableData(entry.snapshot)
    };
}

function trimStateHistoryEntries(entries, historyLimit = STATE_HISTORY_LIMIT) {
    const limit = normalizeHistoryRetentionLimit(historyLimit);
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    if (normalizedEntries.length <= limit) return normalizedEntries;

    const manualEntries = normalizedEntries.filter((entry) => entry?.manual);
    if (manualEntries.length >= limit) {
        return manualEntries.slice(0, limit);
    }

    let automaticCount = 0;
    const automaticLimit = limit - manualEntries.length;
    return normalizedEntries.filter((entry) => {
        if (entry?.manual) return true;
        if (automaticCount >= automaticLimit) return false;
        automaticCount += 1;
        return true;
    });
}

function normalizeStateHistoryEntries(entries, historyLimit = STATE_HISTORY_LIMIT) {
    return trimStateHistoryEntries((Array.isArray(entries) ? entries : [])
        .map((entry) => normalizeHistoryEntry(entry))
        .filter(Boolean), historyLimit);
}

function appendHistoryEntry(existingEntries, entry, historyLimit = STATE_HISTORY_LIMIT) {
    const normalizedEntry = normalizeHistoryEntry(entry);
    if (!normalizedEntry) {
        return normalizeStateHistoryEntries(existingEntries, historyLimit);
    }

    const nextSignature = getHistorySnapshotSignature(normalizedEntry.snapshot);
    return trimStateHistoryEntries([
        normalizedEntry,
        ...normalizeStateHistoryEntries(existingEntries, historyLimit).filter((existingEntry) => (
            getHistorySnapshotSignature(existingEntry.snapshot) !== nextSignature
        ))
    ], historyLimit);
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

function createStateStoragePayload({
    key,
    backupKey,
    historyKey,
    savedState,
    existingHistory,
    reason = 'save',
    historyLimit = STATE_HISTORY_LIMIT
}) {
    const storagePayload = { [key]: savedState };
    let history = [];
    if (hasRestorableStateSnapshot(savedState)) {
        storagePayload[backupKey] = savedState;
        history = appendHistoryEntry(
            existingHistory,
            createHistoryEntryFromSnapshot(savedState, reason),
            historyLimit
        );
        storagePayload[historyKey] = history;
    }

    return {
        payload: storagePayload,
        history,
        usageInfo: createStorageUsageInfo(storagePayload)
    };
}

function trimStateStorageHistory(payloadInfo, historyKey) {
    if (!payloadInfo || !Array.isArray(payloadInfo.history) || payloadInfo.history.length <= 1) {
        return payloadInfo;
    }

    const trimmedHistory = payloadInfo.history.slice(0, 1);
    const payload = Object.assign({}, payloadInfo.payload, {
        [historyKey]: trimmedHistory
    });
    return {
        payload,
        history: trimmedHistory,
        usageInfo: createStorageUsageInfo(payload),
        historyTrimmed: true
    };
}

function prepareStateStoragePayloadForQuota(payloadInfo, historyKey) {
    if (!isStorageCritical(payloadInfo?.usageInfo)) {
        return payloadInfo;
    }

    const trimmedPayloadInfo = trimStateStorageHistory(payloadInfo, historyKey);
    return trimmedPayloadInfo || payloadInfo;
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
    chrome.storage.local.get([key, backupKey, historyKey, PREFERENCES_KEY], (existingData) => {
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

        if (currentState && areStateSnapshotsEquivalent(data, currentState)) {
            sendResponse({
                success: true,
                saveRevision: currentRevision,
                savedAt: currentState._savedAt || '',
                skipped: true,
                noChanges: true
            });
            return;
        }

        const savedState = createSavedStateSnapshot(data, currentRevision, baseRevision);
        const existingHistory = existingData && typeof existingData === 'object' ? existingData[historyKey] : [];
        const historyLimit = normalizePreferences(existingData?.[PREFERENCES_KEY]).historyRetentionLimit;
        const initialPayloadInfo = createStateStoragePayload({
            key,
            backupKey,
            historyKey,
            savedState,
            existingHistory,
            reason: request.critical ? 'critical_save' : 'save',
            historyLimit
        });
        const payloadInfo = prepareStateStoragePayloadForQuota(initialPayloadInfo, historyKey);
        if (isStorageCritical(payloadInfo.usageInfo)) {
            sendResponse(Object.assign({
                success: false,
                errorCode: ERROR_CODES.STORAGE_QUOTA_EXCEEDED
            }, createStorageResponseFields(payloadInfo.usageInfo, {
                historyEntryCount: payloadInfo.history.length,
                historyTrimmed: Boolean(payloadInfo.historyTrimmed)
            })));
            return;
        }

        const writePayload = (nextPayloadInfo, didRetry = false) => chrome.storage.local.set(nextPayloadInfo.payload, () => {
            if (chrome.runtime.lastError) {
                console.error('NotebookLM Source Management background save error:', chrome.runtime.lastError);
                if (!didRetry && isStorageQuotaError(chrome.runtime.lastError)) {
                    const trimmedPayloadInfo = trimStateStorageHistory(nextPayloadInfo, historyKey);
                    if (trimmedPayloadInfo !== nextPayloadInfo && !isStorageCritical(trimmedPayloadInfo.usageInfo)) {
                        writePayload(trimmedPayloadInfo, true);
                        return;
                    }
                }

                const isQuotaError = isStorageQuotaError(chrome.runtime.lastError);
                sendResponse(Object.assign({
                    success: false,
                    errorCode: isQuotaError ? ERROR_CODES.STORAGE_QUOTA_EXCEEDED : ERROR_CODES.RUNTIME_FAILURE
                }, createStorageResponseFields(nextPayloadInfo.usageInfo, {
                    historyEntryCount: nextPayloadInfo.history.length,
                    historyTrimmed: Boolean(nextPayloadInfo.historyTrimmed)
                })));
            } else {
                sendResponse(Object.assign({
                    success: true,
                    saveRevision: savedState._saveRevision,
                    savedAt: savedState._savedAt
                }, createStorageResponseFields(nextPayloadInfo.usageInfo, {
                    historyEntryCount: nextPayloadInfo.history.length,
                    historyTrimmed: Boolean(nextPayloadInfo.historyTrimmed)
                })));
            }
        });

        writePayload(payloadInfo);
    });
}

function loadStateHistoryNow(request, sendResponse) {
    const key = request.key;
    chrome.storage.local.get([key, PREFERENCES_KEY], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }
        const historyLimit = normalizePreferences(data?.[PREFERENCES_KEY]).historyRetentionLimit;

        sendResponse({
            success: true,
            history: normalizeStateHistoryEntries(data && typeof data === 'object' ? data[key] : [], historyLimit)
        });
    });
}

function appendStateHistoryNow(request, sendResponse) {
    const key = request.key;
    chrome.storage.local.get([key, PREFERENCES_KEY], (data) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, errorCode: ERROR_CODES.RUNTIME_FAILURE });
            return;
        }
        const historyLimit = normalizePreferences(data?.[PREFERENCES_KEY]).historyRetentionLimit;

        const history = appendHistoryEntry(
            data && typeof data === 'object' ? data[key] : [],
            request.entry,
            historyLimit
        );
        const initialPayload = { [key]: history };
        let nextHistory = history;
        let payload = initialPayload;
        let usageInfo = createStorageUsageInfo(payload);
        let historyTrimmed = false;
        if (isStorageCritical(usageInfo) && history.length > 1) {
            nextHistory = history.slice(0, 1);
            payload = { [key]: nextHistory };
            usageInfo = createStorageUsageInfo(payload);
            historyTrimmed = true;
        }
        if (isStorageCritical(usageInfo)) {
            sendResponse(Object.assign({
                success: false,
                errorCode: ERROR_CODES.STORAGE_QUOTA_EXCEEDED
            }, createStorageResponseFields(usageInfo, {
                historyEntryCount: nextHistory.length,
                historyTrimmed
            })));
            return;
        }

        chrome.storage.local.set(payload, () => {
            if (chrome.runtime.lastError) {
                sendResponse(Object.assign({
                    success: false,
                    errorCode: isStorageQuotaError(chrome.runtime.lastError)
                        ? ERROR_CODES.STORAGE_QUOTA_EXCEEDED
                        : ERROR_CODES.RUNTIME_FAILURE
                }, createStorageResponseFields(usageInfo, {
                    historyEntryCount: nextHistory.length,
                    historyTrimmed
                })));
                return;
            }
            sendResponse(Object.assign({
                success: true,
                history: nextHistory
            }, createStorageResponseFields(usageInfo, {
                historyEntryCount: nextHistory.length,
                historyTrimmed
            })));
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

    if (request.type === 'LOAD_PREFERENCES') {
        getPreferences(sendResponse);
        return true;
    }

    if (request.type === 'SAVE_PREFERENCES') {
        setPreferences(request, sendResponse);
        return true;
    }

    if (
        request.type === 'APPEND_DEVELOPER_LOG' ||
        request.type === 'LOAD_DEVELOPER_LOGS' ||
        request.type === 'CLEAR_DEVELOPER_LOGS'
    ) {
        if (!isAuthorizedNotebookSender(sender)) {
            console.warn('NotebookLM Source Management: Received message from unauthorized sender:', sender);
            sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
            return;
        }
        if (!isValidDeveloperLogKey(request.key)) {
            console.warn(`NotebookLM Source Management: Received ${request.type} with invalid key:`, request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.INVALID_STORAGE_KEY });
            return;
        }
        if (request.type === 'LOAD_DEVELOPER_LOGS') {
            loadDeveloperLogs(request, sendResponse);
            return true;
        }
        if (request.type === 'CLEAR_DEVELOPER_LOGS') {
            clearDeveloperLogs(request, sendResponse);
            return true;
        }
        appendDeveloperLog(request, sendResponse);
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
        PREFERENCES_KEY,
        STATE_HISTORY_KEY_PREFIX,
        DEVELOPER_LOG_KEY_PREFIX,
        STATE_HISTORY_LIMIT,
        HISTORY_RETENTION_LIMIT_OPTIONS,
        DEVELOPER_LOG_LIMIT,
        DEVELOPER_LOG_MAX_BYTES,
        DEFAULT_STORAGE_QUOTA_BYTES,
        STORAGE_WARNING_RATIO,
        STORAGE_CRITICAL_RATIO,
        ERROR_CODES,
        CHROME_WEB_STORE_DETAIL_URL_PREFIX,
        getStorageQuotaBytes,
        getSerializedByteLength,
        createStorageUsageInfo,
        isStorageCritical,
        isStorageQuotaError,
        createStorageResponseFields,
        normalizeHistoryRetentionLimit,
        normalizeLanguageOverride,
        getStateBackupKey,
        getStateHistoryKey,
        getSnapshotSaveRevision,
        normalizeStateHistoryEntries,
        trimStateHistoryEntries,
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
        setExtensionEnabled,
        normalizePreferences,
        isValidDeveloperLogKey,
        normalizeDeveloperLogEntry,
        trimDeveloperLogs,
        getPreferences,
        setPreferences,
        loadDeveloperLogs,
        appendDeveloperLog,
        clearDeveloperLogs
    };
}
