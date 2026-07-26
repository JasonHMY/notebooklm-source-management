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
     * createContentDeveloperLogger(context) — developer log 流 + 偏好设置存档。
     * 双职责:
     *  - 4-arg `developerLog(level, category, event, details)` — sanitize details
     *    (敏感 key 自动 redacted、超长字段截断、stack 哈希化、循环检测),按 maxEntries +
     *    maxBytes 滚动裁剪并 persist 到 `sourcesPlusDeveloperLogs_<projectId>`。
     *  - 偏好状态 holder + getters/setters — developer mode flag、欢迎/whats-new seen versions、
     *    历史 retention、语言 override、command shortcuts、quick-view 可见 kinds、appearance prefs。
     *    `loadDeveloperPreferences` 从 chrome.storage 读取并 normalize 一次,offers safe defaults。
     *
     * @param {Object} context 命名为 `context`(不是 deps)。所有项可选(都有 fallback):
     *   - chrome: chrome.* runtime(默认 globalThis.chrome)
     *   - getProjectId(): 返回当前 notebook id(默认 '')
     *   - getDiagnosticsInfo(): 拼到 export text 顶部的诊断信息
     *   - now(): ISO 时间戳工厂
     *   - maxEntries: 默认 500 条
     *   - maxBytes: 默认 512KB
     * @returns {Object} ~25 个 fn —
     *   - 主入口: `developerLog(level, category, event, details)` 返回 true/false (写入是否成功)
     *   - 模式 flag: get/setDeveloperModeEnabled, get/setWelcomeOnboardingSeenVersion,
     *     get/setWhatsNewSeenVersion, setOnboardingModalSeenVersions
     *   - 偏好: getPreferenceUsageState, get/setHistoryRetentionLimit, get/setLanguageOverride,
     *     getCommandShortcuts, get/setCommandShortcut, get/setVisibleQuickViewKinds,
     *     get/setHoverSpotlightEnabled
     *   - 日志 IO: loadDeveloperPreferences, loadDeveloperLogs, getDeveloperLogs,
     *     getLatestDeveloperLogAt, getDeveloperLogExportText, clearDeveloperLogs
     *   - 测试 hook: _trimLogsForTest, _sanitizeDetailsForTest
     *   完整 return 块见 line 623。
     */
    function createContentDeveloperLogger(context = {}) {
        const ctx = context && typeof context === 'object' ? context : {};
        const chromeApi = ctx.chrome ?? globalThis.chrome;
        const getProjectId = typeof ctx.getProjectId === 'function' ? ctx.getProjectId : () => '';
        const getDiagnosticsInfo = typeof ctx.getDiagnosticsInfo === 'function' ? ctx.getDiagnosticsInfo : () => ({});
        const now = typeof ctx.now === 'function' ? ctx.now : () => new Date().toISOString();
        const maxEntries = Number.isFinite(Number(ctx.maxEntries)) ? Number(ctx.maxEntries) : 500;
        const maxBytes = Number.isFinite(Number(ctx.maxBytes)) ? Number(ctx.maxBytes) : 512 * 1024;

        const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
        const VALID_CATEGORIES = new Set([
            'settings',
            'persistence',
            'source_sync',
            'source_action',
            'native_action',
            'import_export',
            'view_switch',
            'lifecycle',
            'ui',
            'background'
        ]);
        const SENSITIVE_KEY_PATTERN = /(title|label|name|text|content|body|html|json|url|href|dom|clipboard)/i;
        const HASH_SOURCE_KEYS = new Set(['stableToken', 'fingerprint']);
        const QUICK_VIEW_BUTTON_KINDS = ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'];

        let developerModeEnabled = false;
        let welcomeOnboardingSeenVersion = 0;
        let whatsNewSeenVersion = '';
        let preferenceUsageState = {
            hasExistingPluginData: false,
            hasStoredPreferences: false
        };
        let historyRetentionLimit = 20;
        let languageOverride = 'auto';
        let commandShortcuts = {};
        let visibleQuickViewKinds = [...QUICK_VIEW_BUTTON_KINDS];
        let appearancePreferences = { hoverSpotlightEnabled: true };
        let dragMode = 'classic';
        let developerLogs = [];
        let nextLogSequence = 1;

        // Phase 3: shared preference normalizers — loaded by manifest content_scripts
        // before this file (or via test harness require). Identical destructuring lives
        // in src/background/index.js so any normalize rule change touches only utils.
        // normalizeCommandShortcutKey is used internally by normalizeCommandShortcutCombo
        // (within the utils file itself), so it's intentionally omitted from this destructure.
        const {
            normalizePreferenceVersion,
            normalizeWhatsNewSeenVersion,
            normalizeHistoryRetentionLimit,
            normalizeLanguageOverride,
            normalizeDragMode,
            normalizeCommandShortcutId,
            normalizeCommandShortcutCombo,
            normalizeCommandShortcuts,
            normalizeVisibleQuickViewKinds,
            normalizeAppearancePreferences
        } = globalThis.NSM_PREFERENCE_NORMALIZERS;

        function getNotebookId() {
            return String(getProjectId() || '');
        }

        function getSerializedByteLength(value) {
            const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
            if (typeof TextEncoder !== 'undefined') {
                return new TextEncoder().encode(text).length;
            }
            return unescape(encodeURIComponent(text)).length;
        }

        function hashValue(value) {
            const input = String(value || '');
            let hash = 2166136261;
            for (let index = 0; index < input.length; index += 1) {
                hash ^= input.charCodeAt(index);
                hash = Math.imul(hash, 16777619);
            }
            return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
        }

        function sanitizePrimitive(value, key = '') {
            if (value == null || typeof value === 'boolean' || typeof value === 'number') {
                return value;
            }
            const text = String(value);
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                return text ? '[redacted]' : '';
            }
            return text.length > 500 ? `${text.slice(0, 500)}...` : text;
        }

        function sanitizeError(error) {
            if (!error || typeof error !== 'object') return null;
            const message = String(error.message || '');
            const stack = String(error.stack || '');
            return {
                errorName: String(error.name || 'Error'),
                errorMessage: message.length > 500 ? `${message.slice(0, 500)}...` : message,
                stackHash: stack ? hashValue(stack) : ''
            };
        }

        function sanitizeDetails(value, key = '', depth = 0, seen = new WeakSet()) {
            if (value instanceof Error) return sanitizeError(value);
            if (value == null || typeof value !== 'object') return sanitizePrimitive(value, key);
            if (depth > 4) return '[truncated]';
            if (seen.has(value)) return '[circular]';
            seen.add(value);
            try {
                if (Array.isArray(value)) {
                    return value.slice(0, 25).map((item) => sanitizeDetails(item, key, depth + 1, seen));
                }

                return Object.keys(value).sort().reduce((result, childKey) => {
                    const childValue = value[childKey];
                    if (HASH_SOURCE_KEYS.has(childKey)) {
                        const hashKey = `${childKey}Hash`;
                        result[hashKey] = childValue ? hashValue(childValue) : '';
                        return result;
                    }
                    if (SENSITIVE_KEY_PATTERN.test(childKey)) {
                        result[childKey] = childValue ? '[redacted]' : '';
                        return result;
                    }
                    result[childKey] = sanitizeDetails(childValue, childKey, depth + 1, seen);
                    return result;
                }, {});
            } finally {
                seen.delete(value);
            }
        }

        function normalizeEntry(entry = {}) {
            const timestamp = typeof entry.timestamp === 'string' && entry.timestamp ? entry.timestamp : now();
            const notebookId = typeof entry.notebookId === 'string' ? entry.notebookId : getNotebookId();
            return {
                id: typeof entry.id === 'string' && entry.id
                    ? entry.id
                    : `${timestamp}:${nextLogSequence++}`,
                timestamp,
                level: VALID_LEVELS.has(entry.level) ? entry.level : 'info',
                category: VALID_CATEGORIES.has(entry.category) ? entry.category : 'ui',
                event: String(entry.event || 'unknown_event').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120),
                notebookId,
                details: sanitizeDetails(entry.details || {})
            };
        }

        function trimLogs(entries = developerLogs) {
            const nextLogs = (Array.isArray(entries) ? entries : [])
                .filter((entry) => entry && typeof entry === 'object')
                .map((entry) => normalizeEntry(entry));

            while (nextLogs.length > maxEntries) {
                nextLogs.shift();
            }
            while (nextLogs.length > 0 && getSerializedByteLength(nextLogs) > maxBytes) {
                nextLogs.shift();
            }
            return nextLogs;
        }

        function sendRuntimeMessage(message) {
            if (!chromeApi?.runtime?.sendMessage) {
                return Promise.resolve({ success: false, errorCode: 'runtime_unavailable' });
            }

            return new Promise((resolve) => {
                try {
                    chromeApi.runtime.sendMessage(message, (response) => {
                        if (chromeApi.runtime.lastError) {
                            resolve({
                                success: false,
                                errorCode: 'runtime_message_error'
                            });
                            return;
                        }
                        resolve(response || { success: false, errorCode: 'empty_response' });
                    });
                } catch (error) {
                    resolve({ success: false, errorCode: 'runtime_exception' });
                }
            });
        }

        async function loadDeveloperPreferences() {
            const response = await sendRuntimeMessage({ type: 'LOAD_PREFERENCES' });
            if (response?.success) {
                applyLoadedPreferences(response.preferences);
                applyLoadedPreferenceUsageState(response.usageState);
                if (developerModeEnabled) {
                    await loadDeveloperLogs();
                }
            }
            return developerModeEnabled;
        }

        function applyLoadedPreferences(preferences = {}) {
            developerModeEnabled = Boolean(preferences?.developerModeEnabled);
            welcomeOnboardingSeenVersion = normalizePreferenceVersion(preferences?.welcomeOnboardingSeenVersion);
            whatsNewSeenVersion = normalizeWhatsNewSeenVersion(preferences?.whatsNewSeenVersion);
            historyRetentionLimit = normalizeHistoryRetentionLimit(preferences?.historyRetentionLimit);
            languageOverride = normalizeLanguageOverride(preferences?.languageOverride);
            commandShortcuts = normalizeCommandShortcuts(preferences?.commandShortcuts);
            visibleQuickViewKinds = normalizeVisibleQuickViewKinds(preferences?.visibleQuickViewKinds);
            appearancePreferences = normalizeAppearancePreferences(preferences?.appearance);
            dragMode = normalizeDragMode(preferences?.dragMode);
        }

        function applyLoadedPreferenceUsageState(usageState = {}) {
            preferenceUsageState = {
                hasExistingPluginData: Boolean(usageState?.hasExistingPluginData),
                hasStoredPreferences: Boolean(usageState?.hasStoredPreferences)
            };
        }

        async function savePreferences(nextPreferences = {}) {
            const response = await sendRuntimeMessage({
                type: 'SAVE_PREFERENCES',
                preferences: nextPreferences
            });
            if (!response || response.success === false) {
                throw new Error(response?.errorCode || 'runtime_failure');
            }
            if (response?.success && response.preferences) {
                applyLoadedPreferences(response.preferences);
            }
            if (response?.success && response.usageState) {
                applyLoadedPreferenceUsageState(response.usageState);
            } else if (response?.success) {
                preferenceUsageState = {
                    hasExistingPluginData: true,
                    hasStoredPreferences: true
                };
            }
            return response;
        }

        async function setDeveloperModeEnabled(enabled) {
            const previousValue = developerModeEnabled;
            const nextValue = Boolean(enabled);
            developerModeEnabled = nextValue;
            try {
                await savePreferences({ developerModeEnabled: nextValue });
            } catch (error) {
                developerModeEnabled = previousValue;
                throw error;
            }
            if (developerModeEnabled) {
                await loadDeveloperLogs();
            }
            return developerModeEnabled;
        }

        async function setWelcomeOnboardingSeenVersion(version) {
            const previousValue = welcomeOnboardingSeenVersion;
            const nextValue = normalizePreferenceVersion(version);
            welcomeOnboardingSeenVersion = nextValue;
            try {
                await savePreferences({ welcomeOnboardingSeenVersion: nextValue });
            } catch (error) {
                welcomeOnboardingSeenVersion = previousValue;
                throw error;
            }
            return welcomeOnboardingSeenVersion;
        }

        async function setWhatsNewSeenVersion(version) {
            const previousValue = whatsNewSeenVersion;
            const nextValue = normalizeWhatsNewSeenVersion(version);
            whatsNewSeenVersion = nextValue;
            try {
                await savePreferences({ whatsNewSeenVersion: nextValue });
            } catch (error) {
                whatsNewSeenVersion = previousValue;
                throw error;
            }
            return whatsNewSeenVersion;
        }

        async function setOnboardingModalSeenVersions(nextVersions = {}) {
            const previousWelcomeValue = welcomeOnboardingSeenVersion;
            const previousWhatsNewValue = whatsNewSeenVersion;
            const nextPreferences = {};

            if (Object.prototype.hasOwnProperty.call(nextVersions || {}, 'welcomeOnboardingSeenVersion')) {
                nextPreferences.welcomeOnboardingSeenVersion = normalizePreferenceVersion(nextVersions.welcomeOnboardingSeenVersion);
            }
            if (Object.prototype.hasOwnProperty.call(nextVersions || {}, 'whatsNewSeenVersion')) {
                nextPreferences.whatsNewSeenVersion = normalizeWhatsNewSeenVersion(nextVersions.whatsNewSeenVersion);
            }

            if (Object.prototype.hasOwnProperty.call(nextPreferences, 'welcomeOnboardingSeenVersion')) {
                welcomeOnboardingSeenVersion = nextPreferences.welcomeOnboardingSeenVersion;
            }
            if (Object.prototype.hasOwnProperty.call(nextPreferences, 'whatsNewSeenVersion')) {
                whatsNewSeenVersion = nextPreferences.whatsNewSeenVersion;
            }

            try {
                await savePreferences(nextPreferences);
            } catch (error) {
                welcomeOnboardingSeenVersion = previousWelcomeValue;
                whatsNewSeenVersion = previousWhatsNewValue;
                throw error;
            }

            return {
                welcomeOnboardingSeenVersion,
                whatsNewSeenVersion
            };
        }

        async function setHistoryRetentionLimit(limit) {
            const previousValue = historyRetentionLimit;
            const nextValue = normalizeHistoryRetentionLimit(limit);
            historyRetentionLimit = nextValue;
            try {
                await savePreferences({ historyRetentionLimit: nextValue });
            } catch (error) {
                historyRetentionLimit = previousValue;
                throw error;
            }
            return historyRetentionLimit;
        }

        async function setLanguageOverride(locale) {
            const previousValue = languageOverride;
            const nextValue = normalizeLanguageOverride(locale);
            languageOverride = nextValue;
            try {
                await savePreferences({ languageOverride: nextValue });
            } catch (error) {
                languageOverride = previousValue;
                throw error;
            }
            return languageOverride;
        }

        async function setCommandShortcut(commandId, shortcut) {
            const id = normalizeCommandShortcutId(commandId);
            if (!id) return '';
            const previousShortcuts = cloneCommandShortcuts(commandShortcuts);
            const nextShortcuts = cloneCommandShortcuts(commandShortcuts);
            const normalizedShortcut = normalizeCommandShortcutCombo(shortcut);
            if (!normalizedShortcut) {
                delete nextShortcuts[id];
            } else {
                Object.keys(nextShortcuts).forEach((existingId) => {
                    if (nextShortcuts[existingId] === normalizedShortcut && existingId !== id) {
                        delete nextShortcuts[existingId];
                    }
                });
                nextShortcuts[id] = normalizedShortcut;
            }
            commandShortcuts = nextShortcuts;
            try {
                await savePreferences({ commandShortcuts: { [id]: normalizedShortcut } });
            } catch (error) {
                commandShortcuts = previousShortcuts;
                throw error;
            }
            return getCommandShortcut(id);
        }

        async function setVisibleQuickViewKinds(kinds) {
            const previousKinds = getVisibleQuickViewKinds();
            const nextKinds = normalizeVisibleQuickViewKinds(kinds);
            visibleQuickViewKinds = nextKinds;
            try {
                await savePreferences({ visibleQuickViewKinds: nextKinds });
            } catch (error) {
                visibleQuickViewKinds = previousKinds;
                throw error;
            }
            return getVisibleQuickViewKinds();
        }

        async function setHoverSpotlightEnabled(enabled) {
            const previousValue = appearancePreferences.hoverSpotlightEnabled;
            const nextValue = enabled !== false;
            appearancePreferences = { ...appearancePreferences, hoverSpotlightEnabled: nextValue };
            try {
                await savePreferences({ appearance: { hoverSpotlightEnabled: nextValue } });
            } catch (error) {
                appearancePreferences = { ...appearancePreferences, hoverSpotlightEnabled: previousValue };
                throw error;
            }
            return appearancePreferences.hoverSpotlightEnabled;
        }

        function getHoverSpotlightEnabled() {
            return appearancePreferences.hoverSpotlightEnabled;
        }

        async function setDragMode(mode) {
            const previousValue = dragMode;
            const nextValue = normalizeDragMode(mode);
            dragMode = nextValue;
            try {
                await savePreferences({ dragMode: nextValue });
            } catch (error) {
                dragMode = previousValue;
                throw error;
            }
            return dragMode;
        }

        function getDragMode() {
            return dragMode;
        }

        async function loadDeveloperLogs() {
            const key = storageContract.getDeveloperLogKey(getNotebookId());
            if (!key) {
                developerLogs = [];
                return developerLogs;
            }
            const response = await sendRuntimeMessage({ type: 'LOAD_DEVELOPER_LOGS', key });
            if (response?.success) {
                developerLogs = trimLogs(response.logs || []);
            }
            return getDeveloperLogs();
        }

        function getDeveloperModeEnabled() {
            return developerModeEnabled;
        }

        function getWelcomeOnboardingSeenVersion() {
            return welcomeOnboardingSeenVersion;
        }

        function getWhatsNewSeenVersion() {
            return whatsNewSeenVersion;
        }

        function getPreferenceUsageState() {
            return Object.assign({}, preferenceUsageState);
        }

        function cloneCommandShortcuts(shortcuts = commandShortcuts) {
            return Object.assign({}, normalizeCommandShortcuts(shortcuts));
        }

        function getHistoryRetentionLimit() {
            return historyRetentionLimit;
        }

        function getLanguageOverride() {
            return languageOverride;
        }

        function getCommandShortcuts() {
            return cloneCommandShortcuts(commandShortcuts);
        }

        function getCommandShortcut(commandId) {
            const id = normalizeCommandShortcutId(commandId);
            return id ? commandShortcuts[id] || '' : '';
        }

        function getVisibleQuickViewKinds() {
            return [...visibleQuickViewKinds];
        }

        function getDeveloperLogs() {
            return developerLogs.map((entry) => {
                if (typeof globalThis.structuredClone === 'function') {
                    try {
                        return globalThis.structuredClone(entry);
                    } catch (error) {
                        // Fall through to JSON cloning for plain log entries.
                    }
                }
                return JSON.parse(JSON.stringify(entry));
            });
        }

        function getLatestDeveloperLogAt() {
            return developerLogs.length > 0 ? developerLogs[developerLogs.length - 1].timestamp || '' : '';
        }

        function developerLog(level, category, event, details = {}) {
            if (!developerModeEnabled) return false;
            const entry = normalizeEntry({
                level,
                category,
                event,
                details,
                notebookId: getNotebookId()
            });
            developerLogs = trimLogs([...developerLogs, entry]);
            const key = storageContract.getDeveloperLogKey(getNotebookId());
            if (key) {
                sendRuntimeMessage({
                    type: 'APPEND_DEVELOPER_LOG',
                    key,
                    entry
                }).then((response) => {
                    if (response?.success && Array.isArray(response.logs)) {
                        developerLogs = trimLogs(response.logs);
                    }
                });
            }
            return true;
        }

        async function clearDeveloperLogs() {
            developerLogs = [];
            const key = storageContract.getDeveloperLogKey(getNotebookId());
            if (!key) return true;
            const response = await sendRuntimeMessage({ type: 'CLEAR_DEVELOPER_LOGS', key });
            if (response?.success) {
                developerLogs = [];
                return true;
            }
            return false;
        }

        function getDeveloperLogExportText() {
            return JSON.stringify({
                exportedAt: now(),
                developerModeEnabled,
                diagnostics: getDiagnosticsInfo() || {},
                logs: getDeveloperLogs()
            }, null, 2);
        }

        return {
            developerLog,
            getDeveloperModeEnabled,
            setDeveloperModeEnabled,
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
            getHoverSpotlightEnabled,
            setHoverSpotlightEnabled,
            getDragMode,
            setDragMode,
            loadDeveloperPreferences,
            loadDeveloperLogs,
            getDeveloperLogs,
            getLatestDeveloperLogAt,
            getDeveloperLogExportText,
            clearDeveloperLogs,
            _trimLogsForTest: trimLogs,
            _sanitizeDetailsForTest: sanitizeDetails
        };
    }

    globalThis.NSM_CREATE_CONTENT_DEVELOPER_LOGGER = createContentDeveloperLogger;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentDeveloperLogger;
    }
})();
