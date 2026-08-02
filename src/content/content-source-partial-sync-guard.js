(function () {
    'use strict';

    /**
     * createContentSourcePartialSyncGuard(deps) — 防"半截扫描"误删 state 的判定层。
     * NotebookLM 在加载新 source / 切换视图时常出现"DOM 暂时只渲染一部分 sources"的瞬态;
     * 本模块判断:这种瞬态发生时,是否应跳过 sync(保留 previous state)、
     * 并把仍然显示的 raw URL 标 isLoading 占位,避免下次 sync 又"重新发现"。
     *
     * @param {Object} deps Optional: URL (URL ctor, default globalThis.URL);
     *   resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord) —
     *   来自 content-source-resolve;默认返回 unresolved。
     * @returns {{ hasPreviousRecordForCurrentSource, shouldPreserveExistingSourcesDuringPartialSync, isLikelyRawImportUrlTitle, markTransientRawUrlImportSources }}
     *   `shouldPreserveExistingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey, { recentNativeDeletedSourceKeys? })`
     *   返回 true 时 caller 必须放弃这次 sync 写入。
     */
    function createContentSourcePartialSyncGuard(deps = {}) {
        const URLCtor = deps.URL || globalThis.URL;
        let lastStableCompleteMissingObservation = null;
        const resolveStoredSourceKeyWithReason = typeof deps.resolveStoredSourceKeyWithReason === 'function'
            ? deps.resolveStoredSourceKeyWithReason
            : () => ({ key: null, reason: 'unresolved' });

        function hasPreviousRecordForCurrentSource(source, sourceLookup, previousSourceRecordsByKey) {
            if (!source?.key || !previousSourceRecordsByKey || typeof previousSourceRecordsByKey.forEach !== 'function') {
                return false;
            }
            if (previousSourceRecordsByKey.has(source.key)) return true;

            let matched = false;
            previousSourceRecordsByKey.forEach((sourceRecord, storedKey) => {
                if (matched) return;
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                if (resolution?.key === source.key) {
                    matched = true;
                }
            });

            return matched;
        }

        function shouldPreserveExistingSourcesDuringPartialSync(currentSources, sourceLookup, previousSourceRecordsByKey, options = {}) {
            if (!previousSourceRecordsByKey || typeof previousSourceRecordsByKey.forEach !== 'function') return false;
            const previousCount = previousSourceRecordsByKey.size;
            const currentCount = Array.isArray(currentSources) ? currentSources.length : 0;
            if (previousCount === 0) {
                lastStableCompleteMissingObservation = null;
                return false;
            }
            if (currentCount === 0) {
                lastStableCompleteMissingObservation = null;
                return true;
            }

            const currentKeys = new Set((currentSources || []).map((source) => source.key).filter(Boolean));
            if (currentKeys.size === 0) return true;

            const missingPreviousKeys = [];
            previousSourceRecordsByKey.forEach((sourceRecord, storedKey) => {
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                if (!resolution?.key || !currentKeys.has(resolution.key)) {
                    missingPreviousKeys.push(resolution?.key || storedKey);
                }
            });

            if (missingPreviousKeys.length === 0) {
                lastStableCompleteMissingObservation = null;
                return false;
            }

            const recentNativeDeletedSourceKeys = options.recentNativeDeletedSourceKeys instanceof Set
                ? options.recentNativeDeletedSourceKeys
                : null;
            if (
                recentNativeDeletedSourceKeys &&
                missingPreviousKeys.every((key) => recentNativeDeletedSourceKeys.has(key))
            ) {
                missingPreviousKeys.forEach((key) => recentNativeDeletedSourceKeys.delete(key));
                lastStableCompleteMissingObservation = null;
                return false;
            }

            const completeness = ['complete', 'partial', 'virtualized', 'loading'].includes(options.completeness)
                ? options.completeness
                : 'partial';
            if (completeness !== 'complete') {
                lastStableCompleteMissingObservation = null;
                return true;
            }

            const observedIdentityKeys = Array.isArray(options.identityKeys)
                ? options.identityKeys
                    .map((key) => String(key || '').trim())
                    .filter(Boolean)
                : [];
            const identitySignature = Array.from(
                new Set(observedIdentityKeys.length > 0
                    ? observedIdentityKeys
                    : currentKeys)
            ).sort().join('|');
            const missingSignature = missingPreviousKeys.slice().sort().join('|');
            const currentObservation = {
                contextToken: String(options.contextToken || ''),
                identitySignature,
                missingSignature,
                totalHint: Number.isFinite(Number(options.totalHint))
                    ? Number(options.totalHint)
                    : null
            };
            if (
                lastStableCompleteMissingObservation
                && lastStableCompleteMissingObservation.contextToken === currentObservation.contextToken
                && lastStableCompleteMissingObservation.identitySignature === currentObservation.identitySignature
                && lastStableCompleteMissingObservation.missingSignature === currentObservation.missingSignature
                && lastStableCompleteMissingObservation.totalHint === currentObservation.totalHint
            ) {
                lastStableCompleteMissingObservation = null;
                return false;
            }
            lastStableCompleteMissingObservation = currentObservation;
            return true;
        }

        function resetCompleteScanObservation() {
            lastStableCompleteMissingObservation = null;
        }

        function isLikelyRawImportUrlTitle(value) {
            const title = String(value || '').trim();
            if (!/^https?:\/\//i.test(title) || /\s/.test(title)) return false;

            try {
                const parsedUrl = new URLCtor(title);
                return Boolean(
                    ['http:', 'https:'].includes(parsedUrl.protocol) &&
                    parsedUrl.hostname &&
                    parsedUrl.hostname.includes('.')
                );
            } catch (error) {
                return false;
            }
        }

        function markTransientRawUrlImportSources(currentSources, sourceLookup, previousSourceRecordsByKey) {
            if (
                !Array.isArray(currentSources) ||
                !previousSourceRecordsByKey ||
                typeof previousSourceRecordsByKey.forEach !== 'function' ||
                previousSourceRecordsByKey.size === 0
            ) {
                return 0;
            }

            let markedCount = 0;
            currentSources.forEach((source) => {
                if (
                    !source ||
                    source.isLoading ||
                    !source.key ||
                    hasPreviousRecordForCurrentSource(source, sourceLookup, previousSourceRecordsByKey) ||
                    !isLikelyRawImportUrlTitle(source.title)
                ) {
                    return;
                }

                source.isLoading = true;
                source.isDisabled = true;
                source.isFailed = false;
                markedCount += 1;
            });

            return markedCount;
        }

        return {
            hasPreviousRecordForCurrentSource,
            shouldPreserveExistingSourcesDuringPartialSync,
            resetCompleteScanObservation,
            isLikelyRawImportUrlTitle,
            markTransientRawUrlImportSources
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_PARTIAL_SYNC_GUARD = createContentSourcePartialSyncGuard;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourcePartialSyncGuard;
    }
})();
