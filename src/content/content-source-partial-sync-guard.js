(function () {
    'use strict';

    function createContentSourcePartialSyncGuard(deps = {}) {
        const URLCtor = deps.URL || globalThis.URL;
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
            if (previousCount === 0 || currentCount >= previousCount) return false;
            if (currentCount === 0) return true;

            const currentKeys = new Set((currentSources || []).map((source) => source.key).filter(Boolean));
            if (currentKeys.size === 0) return true;

            const missingPreviousKeys = [];
            previousSourceRecordsByKey.forEach((sourceRecord, storedKey) => {
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                if (!resolution?.key || !currentKeys.has(resolution.key)) {
                    missingPreviousKeys.push(resolution?.key || storedKey);
                }
            });

            if (missingPreviousKeys.length === 0) return false;

            const recentNativeDeletedSourceKeys = options.recentNativeDeletedSourceKeys instanceof Set
                ? options.recentNativeDeletedSourceKeys
                : null;
            if (
                recentNativeDeletedSourceKeys &&
                missingPreviousKeys.every((key) => recentNativeDeletedSourceKeys.has(key))
            ) {
                missingPreviousKeys.forEach((key) => recentNativeDeletedSourceKeys.delete(key));
                return false;
            }

            return true;
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
            isLikelyRawImportUrlTitle,
            markTransientRawUrlImportSources
        };
    }

    globalThis.NSM_CREATE_CONTENT_SOURCE_PARTIAL_SYNC_GUARD = createContentSourcePartialSyncGuard;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSourcePartialSyncGuard;
    }
})();
