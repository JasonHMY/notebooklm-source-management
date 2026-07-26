(function () {
    'use strict';

    function createStorageContract() {
        const STORAGE_SCHEMA_VERSION = 5;
        const IMPORT_EXPORT_FORMAT = 'notebooklm-source-management-config';
        const IMPORT_EXPORT_FORMAT_VERSION = 1;
        const STATE_KEY_PREFIX = 'sourcesPlusState_';
        const STATE_HISTORY_KEY_PREFIX = 'sourcesPlusHistory_';
        const RECOVERY_KEY_PREFIX = 'sourcesPlusRecovery_';
        const DEVELOPER_LOG_KEY_PREFIX = 'sourcesPlusDeveloperLogs_';

        function getStateKey(projectId) {
            return projectId ? `${STATE_KEY_PREFIX}${projectId}` : '';
        }

        function getStateBackupKey(stateKey) {
            return stateKey ? `${stateKey}__backup` : '';
        }

        function getStateHistoryKey(stateKey) {
            const value = String(stateKey || '');
            return value.startsWith(STATE_KEY_PREFIX)
                ? `${STATE_HISTORY_KEY_PREFIX}${value.slice(STATE_KEY_PREFIX.length)}`
                : '';
        }

        function getStateKeyFromHistoryKey(historyKey) {
            const value = String(historyKey || '');
            return value.startsWith(STATE_HISTORY_KEY_PREFIX)
                ? `${STATE_KEY_PREFIX}${value.slice(STATE_HISTORY_KEY_PREFIX.length)}`
                : '';
        }

        function getRecoveryKey(projectId) {
            return projectId ? `${RECOVERY_KEY_PREFIX}${projectId}` : '';
        }

        function getDeveloperLogKey(projectId) {
            return projectId ? `${DEVELOPER_LOG_KEY_PREFIX}${projectId}` : '';
        }

        function isNotebookScopedKeyForProject(key, prefix, projectId) {
            if (!projectId || typeof prefix !== 'string' || !prefix) return false;
            return key === `${prefix}${projectId}`;
        }

        function getStateSchemaCompatibility(value) {
            if (value == null) return 'legacy';
            if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';
            if (!Object.prototype.hasOwnProperty.call(value, 'schemaVersion')) return 'legacy';

            const schemaVersion = value.schemaVersion;
            if (!Number.isInteger(schemaVersion) || schemaVersion < 1) return 'invalid';
            if (schemaVersion === 1) return 'legacy';
            if (schemaVersion <= STORAGE_SCHEMA_VERSION) return 'supported';
            return 'future';
        }

        return Object.freeze({
            STORAGE_SCHEMA_VERSION,
            IMPORT_EXPORT_FORMAT,
            IMPORT_EXPORT_FORMAT_VERSION,
            STATE_KEY_PREFIX,
            STATE_HISTORY_KEY_PREFIX,
            RECOVERY_KEY_PREFIX,
            DEVELOPER_LOG_KEY_PREFIX,
            getStateKey,
            getStateBackupKey,
            getStateHistoryKey,
            getStateKeyFromHistoryKey,
            getRecoveryKey,
            getDeveloperLogKey,
            isNotebookScopedKeyForProject,
            getStateSchemaCompatibility
        });
    }

    globalThis.NSM_CREATE_STORAGE_CONTRACT = createStorageContract;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createStorageContract;
    }
})();
