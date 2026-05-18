(function () {
    'use strict';

    function createContentNativeLabelImportController(deps = {}) {
        const normalizeSourceText = typeof deps.normalizeSourceText === 'function'
            ? deps.normalizeSourceText
            : (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

        function getComparableNativeImportLabelTitle(value) {
            return normalizeSourceText(String(value || '').replace(/\s+/g, ' ').trim()).toLowerCase();
        }

        function findReusableNativeLabelImportGroup(labelTitle, groupsById) {
            const comparableTitle = getComparableNativeImportLabelTitle(labelTitle);
            if (!comparableTitle || !groupsById || typeof groupsById.values !== 'function') return null;
            return Array.from(groupsById.values()).find((group) => (
                group?.nativeLabelTitle &&
                getComparableNativeImportLabelTitle(group.nativeLabelTitle) === comparableTitle
            )) || null;
        }

        function resolveNativeLabelPreviewSourceKey(descriptor, sourcesByKey) {
            if (!descriptor) return '';
            if (descriptor.key && sourcesByKey?.has?.(descriptor.key)) return descriptor.key;
            if (descriptor.legacyKey && sourcesByKey?.has?.(descriptor.legacyKey)) return descriptor.legacyKey;

            const findUniqueSourceMatch = (predicate) => {
                const matches = [];
                sourcesByKey?.forEach?.((source, sourceKey) => {
                    if (predicate(source, sourceKey)) matches.push(sourceKey);
                });
                return matches.length === 1 ? matches[0] : '';
            };

            if (descriptor.stableToken) {
                const stableTokenMatch = findUniqueSourceMatch((source) => source?.stableToken === descriptor.stableToken);
                if (stableTokenMatch) return stableTokenMatch;
            }
            if (descriptor.fingerprint) {
                const fingerprintMatch = findUniqueSourceMatch((source) => source?.fingerprint === descriptor.fingerprint);
                if (fingerprintMatch) return fingerprintMatch;
            }
            const normalizedTitle = normalizeSourceText(descriptor.title || descriptor.normalizedTitle || '');
            if (normalizedTitle) {
                const titleMatch = findUniqueSourceMatch((source) => (
                    normalizeSourceText(source?.title || source?.normalizedTitle || '') === normalizedTitle
                ));
                if (titleMatch) return titleMatch;
            }
            return descriptor.key || descriptor.legacyKey || '';
        }

        function createNativeLabelPreviewSourceRecord(descriptor, nativeLabelTitle, sourceKey) {
            if (!descriptor || !sourceKey) return null;
            return Object.assign({}, descriptor, {
                key: sourceKey,
                sourceViewKind: 'label',
                nativeLabelTitle: nativeLabelTitle || descriptor.nativeLabelTitle || '',
                enabled: typeof descriptor.enabled === 'boolean' ? descriptor.enabled : true
            });
        }

        function ensureNativeLabelPreviewSources(label, depsForSourceInsert = {}) {
            const {
                sourcesByKey,
                sourceTagsById,
                keyByElement
            } = depsForSourceInsert || {};
            if (!label || !Array.isArray(label.sourceRecords) || !sourcesByKey) return 0;
            let addedCount = 0;
            label.sourceRecords.forEach((sourceRecord) => {
                const sourceKey = sourceRecord?.key;
                if (!sourceKey) return;
                const nativeLabelTitle = label.title || sourceRecord.nativeLabelTitle || '';
                if (sourcesByKey.has(sourceKey)) {
                    const existingSource = sourcesByKey.get(sourceKey);
                    if (existingSource && nativeLabelTitle && !existingSource.nativeLabelTitle) {
                        existingSource.nativeLabelTitle = nativeLabelTitle;
                    }
                    return;
                }
                const hydratedSource = Object.assign({}, sourceRecord, {
                    nativeLabelTitle,
                    enabled: typeof sourceRecord.enabled === 'boolean' ? sourceRecord.enabled : true
                });
                sourcesByKey.set(sourceKey, hydratedSource);
                if (sourceTagsById && !sourceTagsById.has(sourceKey)) {
                    sourceTagsById.set(sourceKey, []);
                }
                if (hydratedSource.element && keyByElement && typeof keyByElement.set === 'function') {
                    keyByElement.set(hydratedSource.element, sourceKey);
                }
                addedCount += 1;
            });
            return addedCount;
        }

        function createImportedNativeLabelGroupId(labelTitle, usedIds = new Set()) {
            const slug = normalizeSourceText(labelTitle)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 40) || 'label';
            let candidate = `native_label_${slug}`;
            let index = 2;
            while (usedIds.has(candidate)) {
                candidate = `native_label_${slug}_${index}`;
                index += 1;
            }
            usedIds.add(candidate);
            return candidate;
        }

        return {
            getComparableNativeImportLabelTitle,
            findReusableNativeLabelImportGroup,
            resolveNativeLabelPreviewSourceKey,
            createNativeLabelPreviewSourceRecord,
            ensureNativeLabelPreviewSources,
            createImportedNativeLabelGroupId
        };
    }

    globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_CONTROLLER = createContentNativeLabelImportController;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentNativeLabelImportController;
    }
})();
