(function () {
    'use strict';

    /**
     * createContentSnapshotSignature() — 持久化 snapshot 的稳定签名 + 修订号工具。
     * 用 stable-key-sort + `_saveRevision`/`_savedAt` 剥离来生成 deterministic JSON 签名
     * (`getPersistableSnapshotSignature`),用于 dedupe equivalent saves;同时提供
     * `_saveRevision` 比较(`isStaleStateWrite`)用于 background SW 拒绝过期写入,以及
     * storage quota 错误探测(`isStorageQuotaError`)+ storage metadata 抽取。
     * 无外部 deps;由 createContentPersistence 内部直接 require/取出 factory 调用。
     *
     * @returns {{ isStorageQuotaError, getStorageMetadataFromResponse, getStorageMetadataFromResult, getSnapshotSaveRevision, isStaleStateWrite, getStableComparablePersistableValue, getPersistableSnapshotSignature, arePersistableSnapshotsEquivalent }}
     */
    function createContentSnapshotSignature() {
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

        return {
            isStorageQuotaError,
            getStorageMetadataFromResponse,
            getStorageMetadataFromResult,
            getSnapshotSaveRevision,
            isStaleStateWrite,
            getStableComparablePersistableValue,
            getPersistableSnapshotSignature,
            arePersistableSnapshotsEquivalent
        };
    }

    globalThis.NSM_CREATE_CONTENT_SNAPSHOT_SIGNATURE = createContentSnapshotSignature;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSnapshotSignature;
    }
})();
