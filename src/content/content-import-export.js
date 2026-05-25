(function () {
    'use strict';

    const IMPORT_EXPORT_FORMAT = 'notebooklm-source-management-config';

    function createContentImportExport(deps = {}) {
        const {
            runtime,
            limits = {},
            developerLog = () => {},
            showToast = () => {},
            getMessage = (key) => key,
            cloneSerializableData,
            normalizeLoadedState,
            hasPersistableManagerState,
            buildPersistableState,
            buildSourceLookup,
            resolveStoredSourceKey,
            buildNormalizedTagState,
            normalizeSourceViewSwitchTarget,
            appendStateHistorySnapshot,
            writeImportBackupSnapshot = () => {},
            restoreInitialLoadedState,
            restoreImportBackupSnapshotFromUi = () => false,
            saveState,
            render = () => {}
        } = deps;

        if (!runtime) {
            throw new Error('NotebookLM Source Management: createContentImportExport requires a runtime context.');
        }
        if (typeof cloneSerializableData !== 'function'
            || typeof normalizeLoadedState !== 'function'
            || typeof hasPersistableManagerState !== 'function'
            || typeof buildPersistableState !== 'function') {
            throw new Error('NotebookLM Source Management: createContentImportExport requires the persistence helpers.');
        }

        const {
            maxFileBytes = 2 * 1024 * 1024,
            maxGroups = 1000,
            maxTags = 500,
            maxSources = 5000,
            maxChildRefs = 10000,
            maxTreeDepth = 50
        } = limits;

        const safeBuildSourceLookup = typeof buildSourceLookup === 'function'
            ? buildSourceLookup
            : () => null;
        const safeResolveStoredSourceKey = typeof resolveStoredSourceKey === 'function'
            ? resolveStoredSourceKey
            : () => '';
        const safeBuildNormalizedTagState = typeof buildNormalizedTagState === 'function'
            ? buildNormalizedTagState
            : () => ({ rawToSafeTagId: new Map() });
        const safeNormalizeSourceView = typeof normalizeSourceViewSwitchTarget === 'function'
            ? normalizeSourceViewSwitchTarget
            : (value) => value || '';

        function getImportConfigLimit(value, fallback) {
            const normalized = Number(value);
            return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
        }

        function getImportConfigTextByteLength(text) {
            if (typeof TextEncoder === 'function') {
                return new TextEncoder().encode(String(text || '')).length;
            }
            return String(text || '').length;
        }

        function unwrapImportConfigPayload(parsedConfig) {
            if (!parsedConfig || typeof parsedConfig !== 'object') return null;
            if (parsedConfig.format === IMPORT_EXPORT_FORMAT && parsedConfig.data) {
                return parsedConfig.data;
            }
            return parsedConfig;
        }

        function getImportGroupTreeValidationError(groupsByIdMap) {
            const maxDepth = getImportConfigLimit(maxTreeDepth, 50);
            const visitStateById = new Map();
            const groupIds = Object.keys(groupsByIdMap || {});

            for (const rootGroupId of groupIds) {
                if (visitStateById.get(rootGroupId) === 'done') continue;
                const stack = [{ groupId: rootGroupId, childIndex: 0, depth: 1 }];

                while (stack.length > 0) {
                    const frame = stack[stack.length - 1];
                    if (frame.depth > maxDepth) return 'too_deep';
                    if (!visitStateById.has(frame.groupId)) {
                        visitStateById.set(frame.groupId, 'visiting');
                    }

                    const group = groupsByIdMap[frame.groupId];
                    const children = Array.isArray(group?.children) ? group.children : [];
                    let advanced = false;
                    while (frame.childIndex < children.length) {
                        const child = children[frame.childIndex];
                        frame.childIndex += 1;
                        if (child?.type !== 'group' || !child.id || !groupsByIdMap[child.id]) continue;
                        const childVisitState = visitStateById.get(child.id);
                        if (child.id === frame.groupId || childVisitState === 'visiting') return 'cycle';
                        if (childVisitState === 'done') continue;
                        stack.push({ groupId: child.id, childIndex: 0, depth: frame.depth + 1 });
                        advanced = true;
                        break;
                    }

                    if (!advanced) {
                        visitStateById.set(frame.groupId, 'done');
                        stack.pop();
                    }
                }
            }

            return null;
        }

        function getImportStateValidationError(importState) {
            const groupsByIdMap = importState && typeof importState.groupsById === 'object' ? importState.groupsById : {};
            const groupEntries = Object.entries(groupsByIdMap);
            const tagCount = Object.keys(importState.tagsById || {}).length;
            const sourceRefs = new Set(Object.keys(importState.sourceStateById || {}));
            let childRefCount = 0;

            if (groupEntries.length > getImportConfigLimit(maxGroups, 1000)) return 'too_large';
            if (tagCount > getImportConfigLimit(maxTags, 500)) return 'too_large';

            for (const [, group] of groupEntries) {
                const children = Array.isArray(group?.children) ? group.children : [];
                childRefCount += children.length;
                if (childRefCount > getImportConfigLimit(maxChildRefs, 10000)) return 'too_large';
                children.forEach((child) => {
                    if (child?.type === 'source' && child.key) sourceRefs.add(child.key);
                });
            }

            (Array.isArray(importState.ungrouped) ? importState.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) sourceRefs.add(sourceKey);
            });
            if (sourceRefs.size > getImportConfigLimit(maxSources, 5000)) return 'too_large';

            return getImportGroupTreeValidationError(groupsByIdMap);
        }

        function collectImportSourceRefs(importState) {
            const refs = new Set();
            const importGroupsById = importState.groupsById || {};
            const visitedGroups = new Set();
            const visitGroup = (groupId) => {
                if (!groupId || visitedGroups.has(groupId)) return;
                visitedGroups.add(groupId);
                const group = importGroupsById[groupId];
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'source' && child.key) {
                        refs.add(child.key);
                        return;
                    }
                    if (child?.type === 'group' && child.id) {
                        visitGroup(child.id);
                    }
                });
            };

            Object.keys(importGroupsById).forEach((groupId) => {
                visitGroup(groupId);
            });
            (Array.isArray(importState.ungrouped) ? importState.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            Object.keys(importState.sourceStateById || {}).forEach((sourceKey) => refs.add(sourceKey));
            return refs;
        }

        function normalizeDiffName(value) {
            return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
        }

        function countNameOverlap(incomingNames, currentNames) {
            let count = 0;
            incomingNames.forEach((name) => {
                if (name && currentNames.has(name)) count += 1;
            });
            return count;
        }

        function buildImportConfigDiff(importState, sourceRefs, matchedSourceDetails) {
            const importedSourceRecords = importState.sourceStateById || {};
            const currentFolderNames = new Set();
            const incomingFolderNames = new Set();
            const currentTagNames = new Set();
            const incomingTagNames = new Set();

            const groupsById = runtime.groupsById;
            const tagsById = runtime.tagsById;
            const sourcesByKey = runtime.sourcesByKey;

            groupsById?.forEach?.((group) => {
                const name = normalizeDiffName(group?.title);
                if (name) currentFolderNames.add(name);
            });
            Object.values(importState.groupsById || {}).forEach((group) => {
                const name = normalizeDiffName(group?.title);
                if (name) incomingFolderNames.add(name);
            });
            tagsById?.forEach?.((tag) => {
                const name = normalizeDiffName(tag?.label);
                if (name) currentTagNames.add(name);
            });
            Object.values(importState.tagsById || {}).forEach((tag) => {
                const name = normalizeDiffName(tag?.label || tag?.title || tag?.name);
                if (name) incomingTagNames.add(name);
            });

            const matchedDetails = Array.isArray(matchedSourceDetails) ? matchedSourceDetails : [];
            let enableCount = 0;
            let disableCount = 0;
            let unchangedCount = 0;
            matchedDetails.forEach((detail) => {
                const sourceRecord = importedSourceRecords[detail.storedKey] || null;
                const currentSource = sourcesByKey?.get?.(detail.resolvedKey);
                if (!sourceRecord || !currentSource) return;
                const nextEnabled = Boolean(sourceRecord.enabled);
                const currentEnabled = Boolean(currentSource.enabled);
                if (nextEnabled && !currentEnabled) {
                    enableCount += 1;
                } else if (!nextEnabled && currentEnabled) {
                    disableCount += 1;
                } else {
                    unchangedCount += 1;
                }
            });

            const normalizedTagState = safeBuildNormalizedTagState(importState);
            const normalizedIdCount = Array.from(normalizedTagState?.rawToSafeTagId?.entries?.() || [])
                .filter(([rawId, safeId]) => rawId !== safeId)
                .length;
            const normalizedIncomingSourceView = safeNormalizeSourceView(importState.sourceViewDisplayKind);
            const normalizedCurrentSourceView = safeNormalizeSourceView(runtime.sourceViewDisplayKind);

            return {
                source: {
                    totalSources: sourceRefs.size,
                    matchedSources: matchedDetails.length,
                    unmatchedSources: sourceRefs.size - matchedDetails.length,
                    enableCount,
                    disableCount,
                    unchangedCount
                },
                folders: {
                    incomingCount: Object.keys(importState.groupsById || {}).length,
                    sameNameCount: countNameOverlap(incomingFolderNames, currentFolderNames),
                    removedCount: Array.from(currentFolderNames).filter((name) => !incomingFolderNames.has(name)).length
                },
                tags: {
                    incomingCount: Object.keys(importState.tagsById || {}).length,
                    sameNameCount: countNameOverlap(incomingTagNames, currentTagNames),
                    removedCount: Array.from(currentTagNames).filter((name) => !incomingTagNames.has(name)).length,
                    normalizedIdCount
                },
                settings: {
                    changesCustomHeight: (importState.customHeight ?? null) !== (runtime.customHeight ?? null),
                    changesSourceViewDisplayKind: Boolean(
                        normalizedIncomingSourceView &&
                        normalizedCurrentSourceView &&
                        normalizedIncomingSourceView !== normalizedCurrentSourceView
                    )
                }
            };
        }

        function parseImportConfigText(text) {
            const rawText = String(text || '').trim();
            if (!rawText) {
                return { ok: false, reason: 'empty' };
            }
            if (getImportConfigTextByteLength(rawText) > getImportConfigLimit(maxFileBytes, 2 * 1024 * 1024)) {
                return { ok: false, reason: 'invalid' };
            }

            try {
                const parsedConfig = JSON.parse(rawText);
                const normalizedState = normalizeLoadedState(unwrapImportConfigPayload(parsedConfig));
                if (!normalizedState || !hasPersistableManagerState(normalizedState)) {
                    return { ok: false, reason: 'invalid' };
                }
                if (getImportStateValidationError(normalizedState)) {
                    return { ok: false, reason: 'invalid' };
                }
                return { ok: true, state: normalizedState };
            } catch (error) {
                return { ok: false, reason: 'invalid' };
            }
        }

        function createExportConfigPayload() {
            const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
            return {
                format: IMPORT_EXPORT_FORMAT,
                formatVersion: 1,
                extensionVersion: manifest.version || '',
                exportedAt: new Date().toISOString(),
                data: buildPersistableState()
            };
        }

        function getExportConfigText() {
            const payload = createExportConfigPayload();
            developerLog('info', 'import_export', 'config_export_created', {
                sourceCount: Object.keys(payload.data?.sourceStateById || {}).length,
                groupCount: Object.keys(payload.data?.groupsById || {}).length,
                tagCount: Object.keys(payload.data?.tagsById || {}).length
            });
            return JSON.stringify(payload, null, 2);
        }

        function previewImportConfig(text) {
            const parsed = parseImportConfigText(text);
            if (!parsed.ok) {
                developerLog('warn', 'import_export', 'config_import_preview_failed', {
                    reason: parsed.reason || 'invalid'
                });
                return parsed;
            }

            const sourcesByKey = runtime.sourcesByKey;
            const sourceLookup = safeBuildSourceLookup(Array.from(sourcesByKey?.values?.() || []));
            const sourceRefs = collectImportSourceRefs(parsed.state);
            const matchedSourceKeys = new Set();
            const matchedSourceDetails = [];
            const unmatchedSourceDetails = [];
            sourceRefs.forEach((storedKey) => {
                const sourceRecord = parsed.state.sourceStateById?.[storedKey] || null;
                const resolvedKey = safeResolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                const detail = {
                    storedKey,
                    resolvedKey: resolvedKey || '',
                    title: sourceRecord?.title || sourceRecord?.normalizedTitle || storedKey
                };
                if (resolvedKey) {
                    matchedSourceKeys.add(resolvedKey);
                    matchedSourceDetails.push(detail);
                } else {
                    unmatchedSourceDetails.push(detail);
                }
            });

            const preview = {
                ok: true,
                state: parsed.state,
                totalSources: sourceRefs.size,
                matchedSources: matchedSourceKeys.size,
                matchedSourceDetails,
                unmatchedSourceDetails,
                groupCount: Object.keys(parsed.state.groupsById || {}).length,
                tagCount: Object.keys(parsed.state.tagsById || {}).length,
                diff: buildImportConfigDiff(parsed.state, sourceRefs, matchedSourceDetails)
            };
            developerLog('info', 'import_export', 'config_import_preview_succeeded', {
                totalSources: preview.totalSources,
                matchedSources: preview.matchedSources,
                unmatchedSources: preview.unmatchedSourceDetails.length,
                groupCount: preview.groupCount,
                tagCount: preview.tagCount
            });
            return preview;
        }

        async function applyImportConfig(text) {
            const preview = previewImportConfig(text);
            if (!preview.ok) {
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: preview.reason || 'invalid'
                });
                showToast(getMessage(preview.reason === 'empty'
                    ? 'ui_settings_import_empty'
                    : 'ui_settings_import_invalid'), { variant: 'error' });
                return preview;
            }

            const importedState = preview.state;
            if (typeof appendStateHistorySnapshot === 'function') {
                await appendStateHistorySnapshot(buildPersistableState(), 'before_import');
            }
            writeImportBackupSnapshot();
            if (importedState.customHeight != null) {
                runtime.customHeight = importedState.customHeight;
                const container = runtime.shadowRoot?.querySelector?.('.sp-container');
                if (container) container.style.height = `${importedState.customHeight}px`;
            }

            const restoreResult = typeof restoreInitialLoadedState === 'function'
                ? restoreInitialLoadedState(importedState)
                : { deferred: false };
            if (restoreResult.deferred) {
                render();
                showToast(getMessage('ui_settings_import_deferred'), { variant: 'info' });
                developerLog('info', 'import_export', 'config_import_deferred', {
                    totalSources: preview.totalSources,
                    matchedSources: preview.matchedSources
                });
                return { ...preview, ok: false, reason: 'deferred' };
            }

            render();
            const saveResult = typeof saveState === 'function'
                ? await saveState({ immediate: true, critical: true })
                : { ok: true };
            if (saveResult && saveResult.ok === false) {
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: saveResult.reason || 'save_failed'
                });
                return { ...preview, ok: false, reason: saveResult.reason || 'save_failed' };
            }
            showToast(getMessage('ui_settings_imported_toast'), {
                variant: 'success',
                actionLabel: getMessage('ui_settings_restore_import_backup'),
                onAction: restoreImportBackupSnapshotFromUi
            });
            developerLog('info', 'import_export', 'config_import_applied', {
                totalSources: preview.totalSources,
                matchedSources: preview.matchedSources,
                groupCount: preview.groupCount,
                tagCount: preview.tagCount
            });
            return preview;
        }

        return {
            IMPORT_EXPORT_FORMAT,
            getExportConfigText,
            parseImportConfigText,
            previewImportConfig,
            applyImportConfig,
            collectImportSourceRefs,
            unwrapImportConfigPayload
        };
    }

    globalThis.NSM_CREATE_CONTENT_IMPORT_EXPORT = createContentImportExport;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentImportExport;
    }
})();
