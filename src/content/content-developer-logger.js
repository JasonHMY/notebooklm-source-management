(function () {
    'use strict';

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

        let developerModeEnabled = false;
        let welcomeOnboardingSeenVersion = 0;
        let whatsNewSeenVersion = 0;
        let historyRetentionLimit = 20;
        let languageOverride = 'auto';
        let developerLogs = [];
        let nextLogSequence = 1;

        function getNotebookId() {
            return String(getProjectId() || '');
        }

        function getDeveloperLogKey(projectId = getNotebookId()) {
            return projectId ? `sourcesPlusDeveloperLogs_${projectId}` : '';
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
                if (developerModeEnabled) {
                    await loadDeveloperLogs();
                }
            }
            return developerModeEnabled;
        }

        function applyLoadedPreferences(preferences = {}) {
            developerModeEnabled = Boolean(preferences?.developerModeEnabled);
            welcomeOnboardingSeenVersion = normalizePreferenceVersion(preferences?.welcomeOnboardingSeenVersion);
            whatsNewSeenVersion = normalizePreferenceVersion(preferences?.whatsNewSeenVersion);
            historyRetentionLimit = normalizeHistoryRetentionLimit(preferences?.historyRetentionLimit);
            languageOverride = normalizeLanguageOverride(preferences?.languageOverride);
        }

        async function savePreferences(nextPreferences = {}) {
            const response = await sendRuntimeMessage({
                type: 'SAVE_PREFERENCES',
                preferences: nextPreferences
            });
            if (response?.success && response.preferences) {
                applyLoadedPreferences(response.preferences);
            }
            return response;
        }

        async function setDeveloperModeEnabled(enabled) {
            developerModeEnabled = Boolean(enabled);
            await savePreferences({ developerModeEnabled });
            if (developerModeEnabled) {
                await loadDeveloperLogs();
            }
            return developerModeEnabled;
        }

        async function setWelcomeOnboardingSeenVersion(version) {
            welcomeOnboardingSeenVersion = normalizePreferenceVersion(version);
            await savePreferences({ welcomeOnboardingSeenVersion });
            return welcomeOnboardingSeenVersion;
        }

        async function setWhatsNewSeenVersion(version) {
            whatsNewSeenVersion = normalizePreferenceVersion(version);
            await savePreferences({ whatsNewSeenVersion });
            return whatsNewSeenVersion;
        }

        async function setHistoryRetentionLimit(limit) {
            historyRetentionLimit = normalizeHistoryRetentionLimit(limit);
            await savePreferences({ historyRetentionLimit });
            return historyRetentionLimit;
        }

        async function setLanguageOverride(locale) {
            languageOverride = normalizeLanguageOverride(locale);
            await savePreferences({ languageOverride });
            return languageOverride;
        }

        async function loadDeveloperLogs() {
            const key = getDeveloperLogKey();
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

        function normalizePreferenceVersion(value) {
            const version = Number(value);
            if (!Number.isFinite(version) || version < 0) return 0;
            return Math.floor(version);
        }

        function normalizeHistoryRetentionLimit(value) {
            const limit = Number(value);
            return limit === 20 || limit === 50 || limit === 100 ? limit : 20;
        }

        function normalizeLanguageOverride(value) {
            const normalized = String(value || 'auto').trim();
            return normalized === 'auto' || normalized === 'en' || normalized === 'es' || normalized === 'zh_CN'
                ? normalized
                : 'auto';
        }

        function getHistoryRetentionLimit() {
            return historyRetentionLimit;
        }

        function getLanguageOverride() {
            return languageOverride;
        }

        function getDeveloperLogs() {
            return developerLogs.map((entry) => JSON.parse(JSON.stringify(entry)));
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
            const key = getDeveloperLogKey();
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
            const key = getDeveloperLogKey();
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
            getHistoryRetentionLimit,
            setHistoryRetentionLimit,
            getLanguageOverride,
            setLanguageOverride,
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
