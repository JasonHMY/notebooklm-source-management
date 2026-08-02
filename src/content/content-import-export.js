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
     * createContentImportExport(deps) — JSON 导入/导出 + 预览 + 应用流。
     * 导出:`getExportConfigText()` → wrap 成 `{ format, version, data: persistableState }`。
     * 导入:`parseImportConfigText` 校验大小/上限/Tree Placement shape →
     * `previewImportConfig` 做 source fingerprint 匹配并产出完整 canonical runtime snapshot,
     * 把缺失/冲突 source 列成报表;`applyImportConfig` 把同一 prepared state 交给
     * state-apply Adapter,再写历史快照 + saveState + 显示 undo toast。
     * limits 来自 deps.limits(maxFileBytes/maxGroups/maxTags/maxSources/maxChildRefs/maxTreeDepth)。
     *
     * @param {Object} deps Required: runtime, cloneSerializableData, normalizeLoadedState,
     *   hasPersistableManagerState, buildPersistableState, applyPersistableSnapshotToRuntime,
     *   treePlacement.validatePlacementState/normalizePlacementState, saveState.
     *   Optional: limits, developerLog, showToast, getMessage, buildSourceLookup, resolveStoredSourceKey,
     *   buildNormalizedTagState, normalizeSourceViewSwitchTarget, appendStateHistorySnapshot,
     *   writeImportBackupSnapshot, restoreImportBackupSnapshotFromUi, render.
     * @returns {{ IMPORT_EXPORT_FORMAT, IMPORT_EXPORT_FORMAT_VERSION, getExportConfigText, parseImportConfigText, previewImportConfig, applyImportConfig, collectImportSourceRefs, unwrapImportConfigPayload }}
     */
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
            applyPersistableSnapshotToRuntime,
            rollbackImportSnapshot = () => false,
            restoreImportBackupSnapshotFromUi = () => false,
            saveState,
            render = () => {},
            treePlacement
        } = deps;

        if (!runtime) {
            throw new Error('GeminiNotebook-Source-Management: createContentImportExport requires a runtime context.');
        }
        if (typeof cloneSerializableData !== 'function'
            || typeof normalizeLoadedState !== 'function'
            || typeof hasPersistableManagerState !== 'function'
            || typeof buildPersistableState !== 'function'
            || typeof applyPersistableSnapshotToRuntime !== 'function'
            || typeof saveState !== 'function'
            || typeof treePlacement?.validatePlacementState !== 'function'
            || typeof treePlacement?.normalizePlacementState !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentImportExport requires persistence helpers and Tree Placement.');
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
            : buildFallbackNormalizedTagState;
        const safeNormalizeSourceView = typeof normalizeSourceViewSwitchTarget === 'function'
            ? normalizeSourceViewSwitchTarget
            : (value) => value || '';

        function mapImportFailureReason({ saveReason, rolledBack }) {
            if (!rolledBack) return 'rollback_failed';
            if ([
                'runtime_message_error',
                'runtime_exception',
                'empty_response'
            ].includes(saveReason)) {
                return 'import_ack_unknown';
            }
            if (saveReason === 'storage_quota_exceeded') {
                return 'storage_quota_exceeded';
            }
            return 'save_failed';
        }

        function getOwnRecord(recordMap, key) {
            if (
                !recordMap
                || (typeof recordMap !== 'object' && typeof recordMap !== 'function')
                || !Object.prototype.hasOwnProperty.call(recordMap, key)
            ) {
                return null;
            }
            return recordMap[key];
        }

        function getOwnField(record, key, fallbackValue = undefined) {
            if (
                !record
                || (typeof record !== 'object' && typeof record !== 'function')
                || !Object.prototype.hasOwnProperty.call(record, key)
            ) {
                return fallbackValue;
            }
            return record[key];
        }

        function setOwnField(record, key, value) {
            Object.defineProperty(record, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value
            });
            return value;
        }

        function getImportPreviewFingerprint(preview) {
            return JSON.stringify({
                state: preview?.state || null,
                matched: (Array.isArray(preview?.matchedSourceDetails)
                    ? preview.matchedSourceDetails
                    : []).map((detail) => [detail.storedKey, detail.resolvedKey]),
                unmatched: (Array.isArray(preview?.unmatchedSourceDetails)
                    ? preview.unmatchedSourceDetails
                    : []).map((detail) => detail.storedKey),
                diff: preview?.diff || null
            });
        }

        function getPersistableSnapshotFingerprint(snapshot) {
            return JSON.stringify(snapshot || null);
        }

        function getImportTransientFingerprint(transientState = captureImportTransientState()) {
            return JSON.stringify({
                activeTagId: transientState?.activeTagId ?? null,
                isBatchMode: Boolean(transientState?.isBatchMode),
                pendingBatchKeys: (Array.isArray(transientState?.pendingBatchKeys)
                    ? transientState.pendingBatchKeys
                    : []).map((sourceKey) => String(sourceKey)).sort()
            });
        }

        function captureImportTransientState() {
            return {
                activeTagId: runtime.state?.activeTagId ?? null,
                isBatchMode: Boolean(runtime.state?.isBatchMode),
                pendingBatchKeys: Array.from(runtime.pendingBatchKeys || [])
            };
        }

        function restoreImportTransientState(transientState) {
            if (!transientState || !runtime.state) return;
            runtime.state.activeTagId = transientState.activeTagId;
            runtime.state.isBatchMode = transientState.isBatchMode;
            if (runtime.pendingBatchKeys && typeof runtime.pendingBatchKeys.clear === 'function') {
                runtime.pendingBatchKeys.clear();
                transientState.pendingBatchKeys.forEach((sourceKey) => {
                    runtime.pendingBatchKeys.add(sourceKey);
                });
            }
        }

        function safeRender() {
            try {
                render();
            } catch (error) {
                // The runtime snapshot result remains authoritative; callers receive the failure.
            }
        }

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
            if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) return null;
            const hasEnvelopeMarker = ['format', 'formatVersion', 'data']
                .some((key) => Object.prototype.hasOwnProperty.call(parsedConfig, key));
            if (!hasEnvelopeMarker) return parsedConfig;
            if (
                parsedConfig.format !== storageContract.IMPORT_EXPORT_FORMAT
                || parsedConfig.formatVersion !== storageContract.IMPORT_EXPORT_FORMAT_VERSION
                || !parsedConfig.data
                || typeof parsedConfig.data !== 'object'
                || Array.isArray(parsedConfig.data)
            ) {
                return null;
            }
            return parsedConfig.data;
        }

        function getImportGroupTreeDepthError(groupsByIdMap) {
            const maxDepth = getImportConfigLimit(maxTreeDepth, 50);
            const maxDepthById = new Map();
            const groupIds = Object.keys(groupsByIdMap || {});

            for (const startGroupId of groupIds) {
                if (maxDepthById.has(startGroupId)) continue;
                const visiting = new Set([startGroupId]);
                const stack = [{
                    groupId: startGroupId,
                    childIndex: 0,
                    maxDepth: 1
                }];

                while (stack.length > 0) {
                    const frame = stack[stack.length - 1];
                    const group = groupsByIdMap[frame.groupId];
                    const rawChildren = getOwnField(group, 'children', []);
                    const children = Array.isArray(rawChildren) ? rawChildren : [];
                    let advanced = false;
                    while (frame.childIndex < children.length) {
                        const child = children[frame.childIndex];
                        frame.childIndex += 1;
                        const childType = getOwnField(child, 'type');
                        const childGroupId = getOwnField(child, 'id');
                        if (
                            childType !== 'group'
                            || !childGroupId
                            || !Object.prototype.hasOwnProperty.call(groupsByIdMap, childGroupId)
                            || visiting.has(childGroupId)
                        ) {
                            continue;
                        }
                        if (maxDepthById.has(childGroupId)) {
                            frame.maxDepth = Math.max(
                                frame.maxDepth,
                                1 + maxDepthById.get(childGroupId)
                            );
                            if (frame.maxDepth > maxDepth) return 'too_deep';
                            continue;
                        }
                        visiting.add(childGroupId);
                        stack.push({
                            groupId: childGroupId,
                            childIndex: 0,
                            maxDepth: 1
                        });
                        advanced = true;
                        break;
                    }

                    if (!advanced) {
                        if (frame.maxDepth > maxDepth) return 'too_deep';
                        maxDepthById.set(frame.groupId, frame.maxDepth);
                        visiting.delete(frame.groupId);
                        stack.pop();
                        const parentFrame = stack[stack.length - 1];
                        if (parentFrame) {
                            parentFrame.maxDepth = Math.max(
                                parentFrame.maxDepth,
                                1 + frame.maxDepth
                            );
                            if (parentFrame.maxDepth > maxDepth) return 'too_deep';
                        }
                    }
                }
            }

            return null;
        }

        function getImportStateValidationError(importState) {
            const rawGroupsById = getOwnField(importState, 'groupsById', {});
            const groupsByIdMap = rawGroupsById && typeof rawGroupsById === 'object'
                ? rawGroupsById
                : {};
            const groupEntries = Object.entries(groupsByIdMap);
            const rawTagsById = getOwnField(importState, 'tagsById', {});
            const rawSourceStateById = getOwnField(importState, 'sourceStateById', {});
            const rawSourceTagsById = getOwnField(importState, 'sourceTagsById', {});
            const tagCount = Object.keys(
                rawTagsById && typeof rawTagsById === 'object' ? rawTagsById : {}
            ).length;
            const sourceRefs = new Set([
                ...Object.keys(
                    rawSourceStateById && typeof rawSourceStateById === 'object'
                        ? rawSourceStateById
                        : {}
                ),
                ...Object.keys(
                    rawSourceTagsById && typeof rawSourceTagsById === 'object'
                        ? rawSourceTagsById
                        : {}
                )
            ]);
            let childRefCount = 0;

            if (groupEntries.length > getImportConfigLimit(maxGroups, 1000)) return 'too_large';
            if (tagCount > getImportConfigLimit(maxTags, 500)) return 'too_large';

            for (const [, group] of groupEntries) {
                const rawChildren = getOwnField(group, 'children', []);
                const children = Array.isArray(rawChildren) ? rawChildren : [];
                childRefCount += children.length;
                if (childRefCount > getImportConfigLimit(maxChildRefs, 10000)) return 'too_large';
                children.forEach((child) => {
                    const childType = getOwnField(child, 'type');
                    const childKey = getOwnField(child, 'key');
                    if (childType === 'source' && childKey) sourceRefs.add(childKey);
                });
            }

            const rawUngrouped = getOwnField(importState, 'ungrouped', []);
            (Array.isArray(rawUngrouped) ? rawUngrouped : []).forEach((sourceKey) => {
                if (sourceKey) sourceRefs.add(sourceKey);
            });
            const rawRoot = getOwnField(importState, 'root', []);
            (Array.isArray(rawRoot) ? rawRoot : []).forEach((entry) => {
                const entryType = getOwnField(entry, 'type');
                const sourceKey = getOwnField(entry, 'key');
                if (entryType === 'source' && sourceKey) sourceRefs.add(sourceKey);
            });
            if (sourceRefs.size > getImportConfigLimit(maxSources, 5000)) return 'too_large';

            return getImportGroupTreeDepthError(groupsByIdMap);
        }

        function collectImportSourceRefs(importState) {
            const refs = new Set();
            const rawGroupsById = getOwnField(importState, 'groupsById', {});
            const importGroupsById = rawGroupsById && typeof rawGroupsById === 'object'
                ? rawGroupsById
                : {};
            const visitedGroups = new Set();
            const stack = Object.keys(importGroupsById)
                .reverse()
                .map((groupId) => ({ kind: 'group', id: groupId }));
            while (stack.length > 0) {
                const task = stack.pop();
                if (task.kind === 'source') {
                    refs.add(task.key);
                    continue;
                }
                if (!task.id || visitedGroups.has(task.id)) continue;
                visitedGroups.add(task.id);
                const group = importGroupsById[task.id];
                const rawChildren = getOwnField(group, 'children', []);
                const children = Array.isArray(rawChildren) ? rawChildren : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    const child = children[index];
                    const childType = getOwnField(child, 'type');
                    const childKey = getOwnField(child, 'key');
                    const childGroupId = getOwnField(child, 'id');
                    if (childType === 'source' && childKey) {
                        stack.push({ kind: 'source', key: childKey });
                    } else if (childType === 'group' && childGroupId) {
                        stack.push({ kind: 'group', id: childGroupId });
                    }
                }
            }
            const rawUngrouped = getOwnField(importState, 'ungrouped', []);
            (Array.isArray(rawUngrouped) ? rawUngrouped : []).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            const rawRoot = getOwnField(importState, 'root', []);
            (Array.isArray(rawRoot) ? rawRoot : []).forEach((entry) => {
                const entryType = getOwnField(entry, 'type');
                const sourceKey = getOwnField(entry, 'key');
                if (entryType === 'source' && sourceKey) refs.add(sourceKey);
            });
            const rawSourceStateById = getOwnField(importState, 'sourceStateById', {});
            Object.keys(
                rawSourceStateById && typeof rawSourceStateById === 'object'
                    ? rawSourceStateById
                    : {}
            ).forEach((sourceKey) => refs.add(sourceKey));
            const rawSourceTagsById = getOwnField(importState, 'sourceTagsById', {});
            Object.keys(
                rawSourceTagsById && typeof rawSourceTagsById === 'object'
                    ? rawSourceTagsById
                    : {}
            ).forEach((sourceKey) => refs.add(sourceKey));
            return refs;
        }

        function isPlainRecord(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            try {
                const prototype = Object.getPrototypeOf(value);
                return prototype === null || Object.getPrototypeOf(prototype) === null;
            } catch (error) {
                return false;
            }
        }

        function hasValidSourceStateRecords(importState) {
            const sourceStateById = importState?.sourceStateById;
            if (sourceStateById == null) return true;
            return isPlainRecord(sourceStateById)
                && Object.values(sourceStateById).every((sourceRecord) => (
                    isPlainRecord(sourceRecord)
                ));
        }

        function createFallbackSafeTagId(rawTagId, usedTagIds) {
            const rawText = String(rawTagId || '').trim();
            const sanitizedText = rawText
                .replace(/[^A-Za-z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 80);
            const base = /^[A-Za-z0-9_-]{1,80}$/.test(rawText)
                ? rawText
                : (sanitizedText || 'tag_imported');
            let candidate = base;
            let suffix = 1;
            while (usedTagIds.has(candidate)) {
                const suffixText = `_${suffix}`;
                candidate = `${base.slice(0, Math.max(1, 80 - suffixText.length))}${suffixText}`;
                suffix += 1;
            }
            usedTagIds.add(candidate);
            return candidate;
        }

        function buildFallbackNormalizedTagState(importState) {
            const rawTagsById = isPlainRecord(importState?.tagsById)
                ? importState.tagsById
                : {};
            const preferredOrder = Array.isArray(importState?.tagOrder)
                ? importState.tagOrder
                : [];
            const nextTagsById = new Map();
            const nextTagOrder = [];
            const rawToSafeTagId = new Map();
            const usedTagIds = new Set();
            const registerTag = (rawTagId) => {
                if (
                    typeof rawTagId !== 'string'
                    || !rawTagId
                    || rawToSafeTagId.has(rawTagId)
                    || !Object.prototype.hasOwnProperty.call(rawTagsById, rawTagId)
                ) {
                    return;
                }
                const rawTag = rawTagsById[rawTagId];
                if (!isPlainRecord(rawTag)) return;
                const label = String(
                    getOwnField(rawTag, 'label', '')
                    || getOwnField(rawTag, 'title', '')
                    || getOwnField(rawTag, 'name', '')
                )
                    .trim()
                    .replace(/\s+/g, ' ')
                    .slice(0, 48);
                if (!label) return;
                const safeTagId = createFallbackSafeTagId(rawTagId, usedTagIds);
                const rawColor = String(getOwnField(rawTag, 'color', ''))
                    .trim()
                    .toUpperCase();
                const normalizedColor = /^#?[0-9A-F]{6}$/.test(rawColor)
                    ? (rawColor.startsWith('#') ? rawColor : `#${rawColor}`)
                    : '';
                rawToSafeTagId.set(rawTagId, safeTagId);
                nextTagOrder.push(safeTagId);
                nextTagsById.set(safeTagId, {
                    id: safeTagId,
                    label,
                    ...(normalizedColor ? { color: normalizedColor } : {})
                });
            };
            preferredOrder.forEach(registerTag);
            Object.keys(rawTagsById).forEach(registerTag);
            return {
                nextTagsById,
                nextTagOrder,
                rawToSafeTagId
            };
        }

        function canonicalizeImportGroups(groupsById) {
            return Object.fromEntries(Object.entries(groupsById || {}).map(([groupId, group]) => {
                const clonedGroup = cloneSerializableData(group);
                const canonicalGroup = {
                    ...clonedGroup,
                    id: groupId,
                    enabled: getOwnField(group, 'enabled', true) !== false,
                    collapsed: getOwnField(group, 'collapsed', false) === true,
                    children: (Array.isArray(getOwnField(group, 'children'))
                        ? getOwnField(group, 'children')
                        : [])
                        .map((child) => cloneSerializableData(child))
                };
                if (Object.prototype.hasOwnProperty.call(group || {}, 'title')) {
                    canonicalGroup.title = typeof group.title === 'string' ? group.title : '';
                }
                if (Object.prototype.hasOwnProperty.call(group || {}, 'nativeLabelTitle')) {
                    canonicalGroup.nativeLabelTitle = typeof group.nativeLabelTitle === 'string'
                        ? group.nativeLabelTitle
                        : '';
                }
                delete canonicalGroup.isNewlyCreated;
                delete canonicalGroup.isPendingInitialRename;
                delete canonicalGroup.pendingInitialRenameDraft;
                delete canonicalGroup.pendingInitialRenameFocusReturnSelector;
                delete canonicalGroup.pendingInitialRenameCollapsedAncestorIds;
                delete canonicalGroup.isPendingInitialRenameRender;
                return [groupId, canonicalGroup];
            }));
        }

        function toPlainPlacementState(normalizedPlacement) {
            const groupsById = Object.fromEntries(
                Array.from(normalizedPlacement.groupsById, ([groupId, group]) => [
                    groupId,
                    {
                        ...cloneSerializableData(group),
                        id: groupId,
                        children: (Array.isArray(getOwnField(group, 'children'))
                            ? getOwnField(group, 'children')
                            : [])
                            .map((child) => cloneSerializableData(child))
                    }
                ])
            );
            return {
                ...cloneSerializableData(normalizedPlacement.state),
                groupsById
            };
        }

        function normalizeImportPlacementState(rawImportState, normalizedState) {
            const rawImportRoot = getOwnField(rawImportState, 'root');
            const normalizedRoot = getOwnField(normalizedState, 'root', []);
            const normalizedLegacyGroups = getOwnField(normalizedState, 'groups', []);
            const rawImportUngrouped = getOwnField(rawImportState, 'ungrouped');
            const normalizedUngrouped = getOwnField(normalizedState, 'ungrouped', []);
            const validationState = {
                ...normalizedState,
                root: Array.isArray(rawImportRoot)
                    ? rawImportRoot
                    : (Array.isArray(normalizedRoot)
                        ? normalizedRoot
                        : (Array.isArray(normalizedLegacyGroups)
                            ? normalizedLegacyGroups.map((id) => ({ type: 'group', id }))
                            : [])),
                ungrouped: Array.isArray(rawImportUngrouped)
                    ? rawImportUngrouped
                    : (Array.isArray(normalizedUngrouped)
                        ? normalizedUngrouped
                        : [])
            };
            const rawImportGroupsById = getOwnField(rawImportState, 'groupsById');
            const validationGroupsById = rawImportGroupsById
                && typeof rawImportGroupsById === 'object'
                && !Array.isArray(rawImportGroupsById)
                ? rawImportGroupsById
                : getOwnField(normalizedState, 'groupsById', {});
            const liveSourceKeys = collectImportSourceRefs(validationState);
            const validation = treePlacement.validatePlacementState({
                state: validationState,
                groupsById: validationGroupsById,
                liveSourceKeys
            });
            const fatalCodes = new Set(['invalid_entry', 'missing_group', 'group_cycle']);
            if (validation.errors.some((error) => fatalCodes.has(error.code))) {
                return {
                    ok: false,
                    reason: 'invalid',
                    validation
                };
            }

            const normalizedPlacement = treePlacement.normalizePlacementState({
                state: validationState,
                groupsById: validationGroupsById || {},
                liveSourceKeys
            });
            if (!normalizedPlacement?.ok) {
                return {
                    ok: false,
                    reason: 'invalid',
                    validation
                };
            }
            return {
                ok: true,
                state: toPlainPlacementState(normalizedPlacement),
                validation,
                normalization: normalizedPlacement
            };
        }

        function remapImportSnapshotSourceKeys(snapshot, matchedSourceDetails) {
            const remaps = new Map();
            (Array.isArray(matchedSourceDetails) ? matchedSourceDetails : []).forEach((detail) => {
                if (detail?.storedKey && detail?.resolvedKey && detail.storedKey !== detail.resolvedKey) {
                    remaps.set(detail.storedKey, detail.resolvedKey);
                }
            });
            const nextSnapshot = cloneSerializableData(snapshot);
            const mapSourceKey = (sourceKey) => remaps.get(sourceKey) || sourceKey;

            const rawGroupsById = getOwnField(nextSnapshot, 'groupsById', {});
            const groupsById = rawGroupsById && typeof rawGroupsById === 'object'
                ? rawGroupsById
                : {};
            Object.values(groupsById).forEach((group) => {
                const rawChildren = getOwnField(group, 'children');
                if (!group || typeof group !== 'object' || !Array.isArray(rawChildren)) return;
                setOwnField(group, 'children', rawChildren.map((child) => (
                    getOwnField(child, 'type') === 'source'
                        ? {
                            ...child,
                            key: mapSourceKey(getOwnField(child, 'key'))
                        }
                        : child
                )));
            });
            const rawRoot = getOwnField(nextSnapshot, 'root', []);
            setOwnField(
                nextSnapshot,
                'root',
                (Array.isArray(rawRoot) ? rawRoot : [])
                    .map((entry) => (
                        getOwnField(entry, 'type') === 'source'
                            ? {
                                ...entry,
                                key: mapSourceKey(getOwnField(entry, 'key'))
                            }
                            : entry
                    ))
            );
            const rawUngrouped = getOwnField(nextSnapshot, 'ungrouped', []);
            setOwnField(
                nextSnapshot,
                'ungrouped',
                (Array.isArray(rawUngrouped) ? rawUngrouped : []).map(mapSourceKey)
            );

            const nextSourceStateById = new Map();
            const rawSourceStateById = getOwnField(nextSnapshot, 'sourceStateById', {});
            Object.entries(
                rawSourceStateById && typeof rawSourceStateById === 'object'
                    ? rawSourceStateById
                    : {}
            ).forEach(([sourceKey, sourceRecord]) => {
                nextSourceStateById.set(mapSourceKey(sourceKey), sourceRecord);
            });
            setOwnField(
                nextSnapshot,
                'sourceStateById',
                Object.fromEntries(nextSourceStateById)
            );

            const nextSourceTagsById = new Map();
            const rawSourceTagsById = getOwnField(nextSnapshot, 'sourceTagsById', {});
            Object.entries(
                rawSourceTagsById && typeof rawSourceTagsById === 'object'
                    ? rawSourceTagsById
                    : {}
            ).forEach(([sourceKey, tagIds]) => {
                const targetKey = mapSourceKey(sourceKey);
                nextSourceTagsById.set(targetKey, Array.from(new Set([
                    ...(Array.isArray(nextSourceTagsById.get(targetKey))
                        ? nextSourceTagsById.get(targetKey)
                        : []),
                    ...(Array.isArray(tagIds) ? tagIds : [])
                ])));
            });
            setOwnField(
                nextSnapshot,
                'sourceTagsById',
                Object.fromEntries(nextSourceTagsById)
            );
            return nextSnapshot;
        }

        function prepareImportStateForRuntime(importState, matchedSourceDetails) {
            const remappedState = remapImportSnapshotSourceKeys(importState, matchedSourceDetails);
            const liveSourceKeys = new Set(Array.from(runtime.sourcesByKey?.keys?.() || []));
            const canonicalGroupsById = canonicalizeImportGroups(remappedState.groupsById);
            const normalizedPlacement = treePlacement.normalizePlacementState({
                state: remappedState,
                groupsById: canonicalGroupsById,
                liveSourceKeys
            });
            if (!normalizedPlacement?.ok) return null;

            let normalizedTagState;
            try {
                normalizedTagState = safeBuildNormalizedTagState(remappedState);
            } catch (error) {
                return null;
            }
            if (
                !(normalizedTagState?.nextTagsById instanceof Map)
                || !Array.isArray(normalizedTagState.nextTagOrder)
                || !(normalizedTagState.rawToSafeTagId instanceof Map)
            ) {
                return null;
            }
            const canonicalTagsById = new Map();
            normalizedTagState.nextTagsById.forEach((tag, tagId) => {
                if (typeof tagId !== 'string' || !tagId || !isPlainRecord(tag)) return;
                canonicalTagsById.set(tagId, {
                    ...cloneSerializableData(tag),
                    id: tagId
                });
            });
            const canonicalTagOrder = Array.from(new Set(normalizedTagState.nextTagOrder))
                .filter((tagId) => canonicalTagsById.has(tagId));
            canonicalTagsById.forEach((tag, tagId) => {
                if (!canonicalTagOrder.includes(tagId)) canonicalTagOrder.push(tagId);
            });

            const canonicalSourceStateById = new Map();
            Object.entries(remappedState.sourceStateById || {}).forEach(([sourceKey, sourceRecord]) => {
                if (!liveSourceKeys.has(sourceKey) || !isPlainRecord(sourceRecord)) return;
                const nextRecord = {
                    enabled: Boolean(getOwnField(sourceRecord, 'enabled', false))
                };
                const addedAt = getOwnField(sourceRecord, 'addedAt', '');
                if (typeof addedAt === 'string' && addedAt) {
                    nextRecord.addedAt = addedAt;
                }
                canonicalSourceStateById.set(sourceKey, nextRecord);
            });

            const canonicalSourceTagsById = new Map();
            Object.entries(remappedState.sourceTagsById || {}).forEach(([sourceKey, rawTagIds]) => {
                if (!liveSourceKeys.has(sourceKey) || !Array.isArray(rawTagIds)) return;
                const safeTagIds = Array.from(new Set(rawTagIds
                    .map((rawTagId) => normalizedTagState.rawToSafeTagId.get(rawTagId))
                    .filter((tagId) => canonicalTagsById.has(tagId))));
                if (safeTagIds.length > 0) {
                    canonicalSourceTagsById.set(sourceKey, safeTagIds);
                }
            });
            const hasSourceViewDisplayKind = Object.prototype.hasOwnProperty.call(
                remappedState,
                'sourceViewDisplayKind'
            );
            const normalizedSourceViewDisplayKind = hasSourceViewDisplayKind
                ? safeNormalizeSourceView(remappedState.sourceViewDisplayKind)
                : '';
            const canonicalSourceViewDisplayKind = normalizedSourceViewDisplayKind === 'label'
                ? 'label'
                : (normalizedSourceViewDisplayKind === 'list' ? 'list' : null);
            const canonicalPlacementState = toPlainPlacementState(normalizedPlacement);
            delete canonicalPlacementState.sourceViewDisplayKind;

            return {
                ...canonicalPlacementState,
                tagsById: Object.fromEntries(canonicalTagsById),
                tagOrder: canonicalTagOrder,
                sourceStateById: Object.fromEntries(canonicalSourceStateById),
                sourceTagsById: Object.fromEntries(canonicalSourceTagsById),
                ...(canonicalSourceViewDisplayKind
                    ? { sourceViewDisplayKind: canonicalSourceViewDisplayKind }
                    : {})
            };
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

        function buildImportConfigDiff(
            importState,
            sourceRefs,
            matchedSourceDetails,
            rawImportState = importState
        ) {
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
                const sourceRecord = getOwnRecord(importedSourceRecords, detail.resolvedKey)
                    || getOwnRecord(importedSourceRecords, detail.storedKey);
                const currentSource = sourcesByKey?.get?.(detail.resolvedKey);
                if (!sourceRecord || !currentSource) return;
                const nextEnabled = Boolean(getOwnField(sourceRecord, 'enabled', false));
                const currentEnabled = Boolean(currentSource.enabled);
                if (nextEnabled && !currentEnabled) {
                    enableCount += 1;
                } else if (!nextEnabled && currentEnabled) {
                    disableCount += 1;
                } else {
                    unchangedCount += 1;
                }
            });

            const normalizedTagState = safeBuildNormalizedTagState(rawImportState);
            const normalizedIdCount = Array.from(normalizedTagState?.rawToSafeTagId?.entries?.() || [])
                .filter(([rawId, safeId]) => rawId !== safeId)
                .length;
            const hasIncomingSourceView = Object.prototype.hasOwnProperty.call(
                importState,
                'sourceViewDisplayKind'
            );
            const normalizedIncomingSourceView = hasIncomingSourceView
                ? safeNormalizeSourceView(importState.sourceViewDisplayKind)
                : '';
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
                        hasIncomingSourceView &&
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
                const importState = unwrapImportConfigPayload(parsedConfig);
                if (!importState) {
                    return { ok: false, reason: 'invalid' };
                }
                const normalizedState = normalizeLoadedState(importState);
                if (
                    !normalizedState
                    || !hasPersistableManagerState(normalizedState)
                    || !hasValidSourceStateRecords(normalizedState)
                ) {
                    return { ok: false, reason: 'invalid' };
                }
                if (getImportStateValidationError(normalizedState)) {
                    return { ok: false, reason: 'invalid' };
                }
                const placement = normalizeImportPlacementState(importState, normalizedState);
                if (!placement.ok) {
                    return { ok: false, reason: 'invalid' };
                }
                return { ok: true, state: placement.state };
            } catch (error) {
                return { ok: false, reason: 'invalid' };
            }
        }

        function createExportConfigPayload() {
            const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
            return {
                format: storageContract.IMPORT_EXPORT_FORMAT,
                formatVersion: storageContract.IMPORT_EXPORT_FORMAT_VERSION,
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
            const matchedDetailsByResolvedKey = new Map();
            sourceRefs.forEach((storedKey) => {
                const sourceRecord = getOwnRecord(parsed.state.sourceStateById, storedKey);
                const resolvedKey = safeResolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                const detail = {
                    storedKey,
                    resolvedKey: resolvedKey || '',
                    title: getOwnField(sourceRecord, 'title', '')
                        || getOwnField(sourceRecord, 'normalizedTitle', '')
                        || storedKey
                };
                if (resolvedKey) {
                    matchedSourceKeys.add(resolvedKey);
                    matchedSourceDetails.push(detail);
                    if (!matchedDetailsByResolvedKey.has(resolvedKey)) {
                        matchedDetailsByResolvedKey.set(resolvedKey, []);
                    }
                    matchedDetailsByResolvedKey.get(resolvedKey).push(detail);
                } else {
                    unmatchedSourceDetails.push(detail);
                }
            });
            const conflictingSourceDetails = Array.from(matchedDetailsByResolvedKey.values())
                .filter((details) => details.length > 1)
                .flat();
            if (conflictingSourceDetails.length > 0) {
                developerLog('warn', 'import_export', 'config_import_preview_failed', {
                    reason: 'source_remap_conflict',
                    conflictingSources: conflictingSourceDetails.length
                });
                return {
                    ok: false,
                    reason: 'invalid',
                    conflictingSourceDetails
                };
            }
            const preparedState = prepareImportStateForRuntime(
                parsed.state,
                matchedSourceDetails
            );
            if (!preparedState) {
                developerLog('warn', 'import_export', 'config_import_preview_failed', {
                    reason: 'invalid_placement'
                });
                return { ok: false, reason: 'invalid' };
            }

            const preview = {
                ok: true,
                state: preparedState,
                totalSources: sourceRefs.size,
                matchedSources: matchedSourceKeys.size,
                matchedSourceDetails,
                unmatchedSourceDetails,
                groupCount: Object.keys(preparedState.groupsById || {}).length,
                tagCount: Object.keys(preparedState.tagsById || {}).length,
                diff: buildImportConfigDiff(
                    preparedState,
                    sourceRefs,
                    matchedSourceDetails,
                    parsed.state
                )
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
            const startingProjectId = String(runtime.projectId || '');
            const startingInstanceToken = runtime.activeManagerInstanceToken;
            const isStartingContextCurrent = () => (
                String(runtime.projectId || '') === startingProjectId
                && runtime.activeManagerInstanceToken === startingInstanceToken
            );
            const createStaleContextResult = (preview) => ({
                ...preview,
                ok: false,
                reason: 'deferred',
                staleContext: true
            });
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

            let historyBaselineSnapshot;
            let historyBaselineTransientFingerprint;
            try {
                historyBaselineSnapshot = cloneSerializableData(buildPersistableState());
                historyBaselineTransientFingerprint = getImportTransientFingerprint();
                if (typeof appendStateHistorySnapshot === 'function') {
                    await appendStateHistorySnapshot(historyBaselineSnapshot, 'before_import');
                }
            } catch (error) {
                if (!isStartingContextCurrent()) {
                    return createStaleContextResult(preview);
                }
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: 'history_write_failed'
                });
                showToast(getMessage('ui_save_failed'), { variant: 'error' });
                return {
                    ...preview,
                    ok: false,
                    reason: 'save_failed',
                    historyFailed: true
                };
            }
            if (!isStartingContextCurrent()) {
                return createStaleContextResult(preview);
            }
            const refreshedPreview = previewImportConfig(text);
            if (
                !refreshedPreview.ok
                || getImportPreviewFingerprint(refreshedPreview) !== getImportPreviewFingerprint(preview)
            ) {
                developerLog('warn', 'import_export', 'config_import_apply_deferred', {
                    reason: 'preview_changed'
                });
                return {
                    ...preview,
                    ok: false,
                    reason: 'deferred',
                    staleSources: true
                };
            }
            let beforeImportSnapshot;
            let beforeImportTransientState;
            try {
                beforeImportSnapshot = cloneSerializableData(buildPersistableState());
                beforeImportTransientState = captureImportTransientState();
            } catch (error) {
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: 'snapshot_capture_failed'
                });
                showToast(getMessage('ui_settings_import_invalid'), { variant: 'error' });
                return { ...preview, ok: false, reason: 'invalid' };
            }
            if (
                getPersistableSnapshotFingerprint(beforeImportSnapshot)
                !== getPersistableSnapshotFingerprint(historyBaselineSnapshot)
                || getImportTransientFingerprint(beforeImportTransientState)
                !== historyBaselineTransientFingerprint
            ) {
                developerLog('warn', 'import_export', 'config_import_apply_deferred', {
                    reason: 'runtime_changed_during_history'
                });
                return {
                    ...preview,
                    ok: false,
                    reason: 'deferred',
                    staleState: true
                };
            }
            const importedState = refreshedPreview.state;
            let importBackupAvailable = false;
            try {
                importBackupAvailable = Boolean(writeImportBackupSnapshot());
            } catch (error) {
                importBackupAvailable = false;
            }
            let applied = false;
            try {
                applied = Boolean(applyPersistableSnapshotToRuntime(importedState));
            } catch (error) {
                applied = false;
            }
            if (!applied) {
                if (!isStartingContextCurrent()) {
                    return createStaleContextResult(preview);
                }
                let rolledBack = false;
                try {
                    rolledBack = Boolean(rollbackImportSnapshot(beforeImportSnapshot));
                } catch (error) {
                    rolledBack = false;
                }
                if (rolledBack) restoreImportTransientState(beforeImportTransientState);
                safeRender();
                showToast(getMessage('ui_settings_import_invalid'), { variant: 'error' });
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: 'invalid_placement',
                    totalSources: preview.totalSources,
                    matchedSources: preview.matchedSources,
                    rolledBack
                });
                return { ...preview, ok: false, reason: 'invalid', rolledBack };
            }

            try {
                render();
            } catch (error) {
                let rolledBack = false;
                try {
                    rolledBack = Boolean(rollbackImportSnapshot(beforeImportSnapshot));
                } catch (rollbackError) {
                    rolledBack = false;
                }
                if (rolledBack) restoreImportTransientState(beforeImportTransientState);
                safeRender();
                showToast(getMessage('ui_settings_import_invalid'), { variant: 'error' });
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: 'render_failed',
                    rolledBack
                });
                return { ...preview, ok: false, reason: 'invalid', rolledBack };
            }
            let appliedRuntimeFingerprint;
            let appliedTransientFingerprint;
            try {
                appliedRuntimeFingerprint = getPersistableSnapshotFingerprint(buildPersistableState());
                appliedTransientFingerprint = getImportTransientFingerprint();
            } catch (error) {
                let rolledBack = false;
                try {
                    rolledBack = Boolean(rollbackImportSnapshot(beforeImportSnapshot));
                } catch (rollbackError) {
                    rolledBack = false;
                }
                if (rolledBack) restoreImportTransientState(beforeImportTransientState);
                safeRender();
                showToast(getMessage('ui_settings_import_invalid'), { variant: 'error' });
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason: 'snapshot_capture_failed',
                    rolledBack
                });
                return { ...preview, ok: false, reason: 'invalid', rolledBack };
            }
            let saveResult;
            try {
                saveResult = await saveState({
                    immediate: true,
                    critical: true,
                    recoveryFallbackSnapshot: beforeImportSnapshot,
                    allowLocalFallback: false
                });
            } catch (error) {
                saveResult = { ok: false, reason: 'runtime_exception' };
            }
            if (!isStartingContextCurrent()) {
                return createStaleContextResult(preview);
            }
            const saveReason = saveResult?.reason || (
                saveResult?.ok === true ? 'completed' : 'empty_response'
            );
            let runtimeChangedDuringSave = true;
            try {
                runtimeChangedDuringSave = (
                    getPersistableSnapshotFingerprint(buildPersistableState())
                    !== appliedRuntimeFingerprint
                    || getImportTransientFingerprint() !== appliedTransientFingerprint
                );
            } catch (error) {
                runtimeChangedDuringSave = true;
            }
            if (runtimeChangedDuringSave) {
                safeRender();
                developerLog('warn', 'import_export', 'config_import_apply_deferred', {
                    reason: 'runtime_changed_during_save',
                    saveReason,
                    rolledBack: false
                });
                return {
                    ...preview,
                    ok: false,
                    reason: 'deferred',
                    staleState: true,
                    rolledBack: false
                };
            }
            if (!saveResult || saveResult.ok !== true) {
                let rolledBack = false;
                try {
                    rolledBack = Boolean(rollbackImportSnapshot(beforeImportSnapshot));
                } catch (error) {
                    rolledBack = false;
                }
                if (rolledBack) restoreImportTransientState(beforeImportTransientState);
                const reason = mapImportFailureReason({
                    saveReason,
                    rolledBack
                });
                safeRender();
                developerLog('warn', 'import_export', 'config_import_apply_failed', {
                    reason,
                    saveReason,
                    rolledBack
                });
                return { ...preview, ok: false, reason, rolledBack };
            }
            const successToastOptions = { variant: 'success' };
            if (importBackupAvailable) {
                Object.assign(successToastOptions, {
                    actionLabel: getMessage('ui_settings_restore_import_backup'),
                    onAction: () => (
                        isStartingContextCurrent()
                            ? restoreImportBackupSnapshotFromUi()
                            : false
                    )
                });
            }
            showToast(getMessage('ui_settings_imported_toast'), successToastOptions);
            developerLog('info', 'import_export', 'config_import_applied', {
                totalSources: preview.totalSources,
                matchedSources: preview.matchedSources,
                groupCount: preview.groupCount,
                tagCount: preview.tagCount
            });
            return preview;
        }

        return {
            IMPORT_EXPORT_FORMAT: storageContract.IMPORT_EXPORT_FORMAT,
            IMPORT_EXPORT_FORMAT_VERSION: storageContract.IMPORT_EXPORT_FORMAT_VERSION,
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
