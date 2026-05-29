/**
 * src/background/index.js — Service Worker (MV3 background)。
 *
 * 职责:
 *   1. chrome.storage.local 写入的队列化 + revision-guarded 协议(stateSaveQueueByKey)—
 *      防止 content script 的 stale snapshot 覆盖 newer state。
 *   2. tab focus / open 协议(popup → background → 跨 tab 聚焦或新开 NotebookLM)。
 *   3. chrome.runtime.onMessage 路由 (SAVE_STATE / LOAD_STATE / SAVE_PREFERENCES /
 *      LOAD_PREFERENCES / APPEND_DEVELOPER_LOG / SET_EXTENSION_ENABLED ...);
 *      完整路由见 onMessage listener + docs/MESSAGE_CONTRACTS.md。
 *   4. 偏好归一化 (normalizePreferences + 8 个 normalizeXxx 子函数 line ~263-410)。
 *      ⚠ MIRROR: 这些 normalizer 在 src/content/content-developer-logger.js 中有
 *      verbatim 复制,改动两处必须同步(Phase 3 会抽到 src/utils/preference-normalizers.js)。
 *   5. 状态历史 / 命名快照 / quota 监控 / sender 校验。
 *
 * SECURITY: 不持有 DOM、不信任 message payload — 必须 sender 校验 + key prefix 校验
 * + revision guard;Storage write 总是回传 usageInfo 给 content-side toast。
 *
 * 测试: tests/background.test.js
 * 契约: docs/MESSAGE_CONTRACTS.md + docs/STORAGE_SCHEMA.md
 */

// Phase 3: shared preference normalizers — 实际实现见 src/utils/preference-normalizers.js。
// MV3 service worker 用 importScripts 同步加载;Node test 环境(tests/background.test.js
// 直接 require 本文件)走 require fallback。两条路径都让 globalThis.NSM_PREFERENCE_NORMALIZERS
// 就位,后面 28+ 处调用点的本地名字通过下方 destructuring 保持不变。
if (typeof importScripts === 'function') {
    importScripts('../utils/preference-normalizers.js');
} else if (typeof require !== 'undefined') {
    require('../utils/preference-normalizers.js');
}
// normalizeCommandShortcutKey is used internally by normalizeCommandShortcutCombo
// (within the utils file itself), so it's intentionally omitted from this destructure.
const {
    normalizePreferenceVersion,
    normalizeWhatsNewSeenVersion,
    normalizeHistoryRetentionLimit,
    normalizeLanguageOverride,
    normalizeCommandShortcutId,
    normalizeCommandShortcutCombo,
    normalizeCommandShortcuts,
    normalizeVisibleQuickViewKinds,
    normalizeAppearancePreferences
} = globalThis.NSM_PREFERENCE_NORMALIZERS;

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

// Best-effort "everything else" usage for projecting a real total. getBytesInUse(null)
// returns the whole chrome.storage.local footprint; we subtract the bytes of the keys THIS
// write owns (they get replaced by the new payload, so counting both double-counts) to get
// the usage of all OTHER notebooks/keys. The caller adds this to the new payload size for a
// projected-total quota ratio. Falls back to 0 — i.e. the historical per-payload behavior —
// whenever getBytesInUse is unavailable or errors, so nothing regresses.
function resolveExtraStorageBytes(existingData, ownedKeys, callback) {
    const local = globalThis.chrome?.storage?.local;
    const getBytesInUse = local && typeof local.getBytesInUse === 'function'
        ? local.getBytesInUse.bind(local)
        : null;
    if (!getBytesInUse) {
        callback(0);
        return;
    }

    let ownedBytes = 0;
    if (existingData && typeof existingData === 'object') {
        for (const ownedKey of ownedKeys) {
            if (Object.prototype.hasOwnProperty.call(existingData, ownedKey)) {
                ownedBytes += getSerializedByteLength({ [ownedKey]: existingData[ownedKey] });
            }
        }
    }

    let settled = false;
    const finish = (value) => {
        if (settled) return;
        settled = true;
        callback(value);
    };
    try {
        getBytesInUse(null, (totalBytes) => {
            if ((globalThis.chrome?.runtime?.lastError) || !Number.isFinite(Number(totalBytes))) {
                finish(0);
                return;
            }
            finish(Math.max(0, Number(totalBytes) - ownedBytes));
        });
    } catch (error) {
        finish(0);
    }
}

// extraBytes = real chrome.storage.local usage OUTSIDE the keys in `payload` (i.e. all
// OTHER notebooks/keys, from getBytesInUse). Defaults to 0 so callers that can't measure
// the real total (no getBytesInUse) keep the historical per-payload behavior exactly —
// the projected total then equals just this write's payload size.
function createStorageUsageInfo(payload, quotaBytes = getStorageQuotaBytes(), extraBytes = 0) {
    const safeExtraBytes = Number.isFinite(Number(extraBytes)) && extraBytes > 0 ? Number(extraBytes) : 0;
    const storageUsageBytes = getSerializedByteLength(payload) + safeExtraBytes;
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

function getNotebookProjectIdFromSenderUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX)) return '';
    return url.slice(NOTEBOOKLM_NOTEBOOK_PREFIX.length).split(/[/?#]/)[0] || '';
}

// Bind a notebook-scoped storage key to the sender tab's own notebook so a content script
// can only read/write its OWN notebook's state/history, not another's. If no project id is
// resolvable from the sender URL (e.g. a bare /notebook/), don't newly reject — a real
// notebook-scoped write can't happen without one anyway.
function senderOwnsNotebookKey(sender, key) {
    const projectId = getNotebookProjectIdFromSenderUrl(sender && sender.tab ? sender.tab.url : '');
    if (!projectId) return true;
    return typeof key === 'string' && key.endsWith(`_${projectId}`);
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
    if (Object.prototype.hasOwnProperty.call(nextPreferences || {}, 'appearance')) {
        const incomingAppearance = nextPreferences.appearance && typeof nextPreferences.appearance === 'object' ? nextPreferences.appearance : {};
        merged.appearance = normalizeAppearancePreferences(
            Object.assign({}, merged.appearance, incomingAppearance)
        );
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

// SAVE_STATE writes a notebook's history under its STATE queue key, while
// APPEND/LOAD_STATE_HISTORY arrive keyed by the HISTORY key. To keep every writer
// of sourcesPlusHistory_<id> on ONE FIFO (no cross-queue lost update), history ops
// serialize under the notebook's STATE queue key derived here.
function getStateKeyFromHistoryKey(historyKey) {
    return `${STATE_KEY_PREFIX}${String(historyKey || '').replace(/^sourcesPlusHistory_/, '')}`;
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
    historyLimit = STATE_HISTORY_LIMIT,
    extraBytes = 0
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
        usageInfo: createStorageUsageInfo(storagePayload, getStorageQuotaBytes(), extraBytes)
    };
}

function trimStateStorageHistory(payloadInfo, historyKey, extraBytes = 0) {
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
        usageInfo: createStorageUsageInfo(payload, getStorageQuotaBytes(), extraBytes),
        historyTrimmed: true
    };
}

function prepareStateStoragePayloadForQuota(payloadInfo, historyKey, extraBytes = 0) {
    if (!isStorageCritical(payloadInfo?.usageInfo)) {
        return payloadInfo;
    }

    const trimmedPayloadInfo = trimStateStorageHistory(payloadInfo, historyKey, extraBytes);
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
        // Resolve real "other keys" usage (best-effort) so the quota ratio reflects the
        // whole chrome.storage.local footprint, not just this one notebook's write.
        resolveExtraStorageBytes(existingData, [key, backupKey, historyKey], (extraBytes) => {
            const initialPayloadInfo = createStateStoragePayload({
                key,
                backupKey,
                historyKey,
                savedState,
                existingHistory,
                reason: request.critical ? 'critical_save' : 'save',
                historyLimit,
                extraBytes
            });
            const payloadInfo = prepareStateStoragePayloadForQuota(initialPayloadInfo, historyKey, extraBytes);
            if (isStorageCritical(payloadInfo.usageInfo)) {
                // Over the critical threshold — but reject ONLY writes that GROW the stored
                // snapshot. A write that shrinks (or keeps) the state must go through, e.g.
                // the user deleting a source to free space; otherwise quota exhaustion is a
                // hard lock with no escape (history trimming above can't always recover it).
                const incomingBytes = getSerializedByteLength(savedState);
                const currentBytes = currentState ? getSerializedByteLength(currentState) : 0;
                if (incomingBytes > currentBytes) {
                    sendResponse(Object.assign({
                        success: false,
                        errorCode: ERROR_CODES.STORAGE_QUOTA_EXCEEDED
                    }, createStorageResponseFields(payloadInfo.usageInfo, {
                        historyEntryCount: payloadInfo.history.length,
                        historyTrimmed: Boolean(payloadInfo.historyTrimmed)
                    })));
                    return;
                }
                // Shrinking/equal write: fall through to writePayload to let the user recover.
            }

            const writePayload = (nextPayloadInfo, didRetry = false) => chrome.storage.local.set(nextPayloadInfo.payload, () => {
                if (chrome.runtime.lastError) {
                    console.error('NotebookLM Source Management background save error:', chrome.runtime.lastError);
                    if (!didRetry && isStorageQuotaError(chrome.runtime.lastError)) {
                        const trimmedPayloadInfo = trimStateStorageHistory(nextPayloadInfo, historyKey, extraBytes);
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
        resolveExtraStorageBytes(data, [key], (extraBytes) => {
            const initialPayload = { [key]: history };
            let nextHistory = history;
            let payload = initialPayload;
            let usageInfo = createStorageUsageInfo(payload, getStorageQuotaBytes(), extraBytes);
            let historyTrimmed = false;
            if (isStorageCritical(usageInfo) && history.length > 1) {
                nextHistory = history.slice(0, 1);
                payload = { [key]: nextHistory };
                usageInfo = createStorageUsageInfo(payload, getStorageQuotaBytes(), extraBytes);
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
    // Wait on the notebook's STATE queue (which serializes SAVE_STATE's history write)
    // so a read never races a pending write of the same sourcesPlusHistory_<id> key.
    const queueKey = getStateKeyFromHistoryKey(request.key);
    const pendingTask = stateSaveQueueByKey.get(queueKey);
    if (!pendingTask) {
        loadStateHistoryNow(request, sendResponse);
        return;
    }

    pendingTask
        .catch(() => null)
        .then(() => loadStateHistoryNow(request, sendResponse));
}

function appendStateHistory(request, sendResponse) {
    // Serialize on the notebook's STATE queue key so APPEND shares one FIFO with
    // SAVE_STATE's history write (prevents a lost-update read-modify-write race).
    enqueueStorageTask(getStateKeyFromHistoryKey(request.key), () => new Promise((resolve) => {
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
        if (!senderOwnsNotebookKey(sender, request.key)) {
            console.warn('NotebookLM Source Management: SAVE_STATE key does not match sender notebook:', request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
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
        if (!senderOwnsNotebookKey(sender, request.key)) {
            console.warn(`NotebookLM Source Management: ${request.type} key does not match sender notebook:`, request.key);
            sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
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
    if (!senderOwnsNotebookKey(sender, request.key)) {
        console.warn('NotebookLM Source Management: LOAD_STATE key does not match sender notebook:', request.key);
        sendResponse({ success: false, errorCode: ERROR_CODES.UNAUTHORIZED_SENDER });
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
        normalizeAppearancePreferences,
        mergePreferences,
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
