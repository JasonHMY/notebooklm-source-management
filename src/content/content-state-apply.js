(function () {
    'use strict';

    /**
     * createContentStateApply(deps) — 把持久化 snapshot 灌回 runtime 状态对象。
     * 用 `applyPersistableSnapshotToRuntime(snapshot)` 把 normalized state 的
     * groups / ungrouped / tagOrder / groupsById / tagsById / sourceTagsById / sourceStateById /
     * customHeight 全量同步到 runtime。树结构先由 Tree Placement pure normalize + atomic
     * commit,再 rebuild parent map,最后调用 `syncSourceToPage` 把 enabled 推回 Gemini Notebook。
     * 是 undo/redo、配置导入/回滚、手动历史恢复、恢复快照与来源修复共用的最后一步；
     * 初始 LOAD_STATE 仍由 persistence 的 DOM-aware / no-DOM staging 路径处理。
     *
     * @param {Object} deps Required: runtime, cloneSerializableData, normalizeLoadedState,
     *   hasPersistableManagerState, treePlacement.normalizePlacementState/commitPlacementModel.
     *   Optional: buildParentMap, syncSourceToPage, isSourceEffectivelyEnabled.
     * @returns {{ applyPersistableSnapshotToRuntime }} 返回 true 表示 snapshot 已应用,false 表示
     *   snapshot 缺失或不是 persistable shape。
     */
    function createContentStateApply(deps = {}) {
        const {
            cloneSerializableData,
            normalizeLoadedState,
            hasPersistableManagerState,
            buildParentMap,
            syncSourceToPage,
            isSourceEffectivelyEnabled,
            treePlacement
        } = deps;
        const runtime = deps.runtime || deps;

        if (!runtime) {
            throw new Error('GeminiNotebook-Source-Management: createContentStateApply requires a runtime context.');
        }
        if (typeof cloneSerializableData !== 'function'
            || typeof normalizeLoadedState !== 'function'
            || typeof hasPersistableManagerState !== 'function'
            || typeof treePlacement?.normalizePlacementState !== 'function'
            || typeof treePlacement?.commitPlacementModel !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentStateApply requires persistence helpers and Tree Placement.');
        }

        const refreshParentMap = typeof buildParentMap === 'function'
            ? buildParentMap
            : () => {};
        const pushSourceToPage = typeof syncSourceToPage === 'function'
            ? syncSourceToPage
            : () => {};
        const computeEffectiveEnabled = typeof isSourceEffectivelyEnabled === 'function'
            ? isSourceEffectivelyEnabled
            : () => true;

        function isPlainRecord(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            try {
                const prototype = Object.getPrototypeOf(value);
                return prototype === null || Object.getPrototypeOf(prototype) === null;
            } catch (error) {
                return false;
            }
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

        function applyPersistableSnapshotToRuntime(snapshot) {
            let normalizedState;
            try {
                normalizedState = normalizeLoadedState(cloneSerializableData(snapshot));
            } catch (error) {
                return false;
            }
            if (!normalizedState || !hasPersistableManagerState(normalizedState)) return false;

            const state = runtime.state;
            const pendingBatchKeys = runtime.pendingBatchKeys;
            const groupsById = runtime.groupsById;
            const tagsById = runtime.tagsById;
            const sourceTagsById = runtime.sourceTagsById;
            const sourcesByKey = runtime.sourcesByKey;
            const shadowRoot = runtime.shadowRoot;
            const candidateGroupsById = new Map();
            const candidateTagsById = new Map();
            const candidateSourceTagsById = new Map();
            const candidateSourceUpdates = [];
            const candidateTagOrder = [];
            const candidateSourceViewDisplayKind = normalizedState.sourceViewDisplayKind === 'label'
                ? 'label'
                : (normalizedState.sourceViewDisplayKind === 'list' ? 'list' : null);
            try {
                if (
                    (normalizedState.groupsById != null
                        && !isPlainRecord(normalizedState.groupsById))
                    || (normalizedState.tagsById != null
                        && !isPlainRecord(normalizedState.tagsById))
                    || (normalizedState.sourceTagsById != null
                        && !isPlainRecord(normalizedState.sourceTagsById))
                    || (normalizedState.sourceStateById != null
                        && !isPlainRecord(normalizedState.sourceStateById))
                ) {
                    throw new TypeError('invalid state record map');
                }
                Object.entries(normalizedState.groupsById || {}).forEach(([groupId, group]) => {
                    if (!isPlainRecord(group)) {
                        throw new TypeError('invalid group record');
                    }
                    const clonedGroup = cloneSerializableData(group);
                    const candidateGroup = {
                        ...clonedGroup,
                        id: groupId,
                        enabled: getOwnField(group, 'enabled', true) !== false,
                        collapsed: getOwnField(group, 'collapsed', false) === true,
                        children: (Array.isArray(getOwnField(group, 'children'))
                            ? getOwnField(group, 'children')
                            : [])
                            .map((child) => cloneSerializableData(child))
                    };
                    if (Object.prototype.hasOwnProperty.call(group, 'title')) {
                        candidateGroup.title = typeof group.title === 'string' ? group.title : '';
                    }
                    if (Object.prototype.hasOwnProperty.call(group, 'nativeLabelTitle')) {
                        candidateGroup.nativeLabelTitle = typeof group.nativeLabelTitle === 'string'
                            ? group.nativeLabelTitle
                            : '';
                    }
                    delete candidateGroup.isNewlyCreated;
                    candidateGroupsById.set(groupId, candidateGroup);
                });
                Object.entries(normalizedState.tagsById || {}).forEach(([tagId, tag]) => {
                    if (!tagId || !isPlainRecord(tag)) {
                        throw new TypeError('invalid tag record');
                    }
                    candidateTagsById.set(tagId, {
                        ...cloneSerializableData(tag),
                        id: tagId
                    });
                });
                const seenTagOrderIds = new Set();
                (Array.isArray(normalizedState.tagOrder) ? normalizedState.tagOrder : [])
                    .forEach((tagId) => {
                        if (
                            typeof tagId === 'string'
                            && candidateTagsById.has(tagId)
                            && !seenTagOrderIds.has(tagId)
                        ) {
                            seenTagOrderIds.add(tagId);
                            candidateTagOrder.push(tagId);
                        }
                    });
                candidateTagsById.forEach((tag, tagId) => {
                    if (!seenTagOrderIds.has(tagId)) candidateTagOrder.push(tagId);
                });
                Object.entries(normalizedState.sourceTagsById || {}).forEach(
                    ([sourceKey, tagIds]) => {
                        if (!sourcesByKey?.has?.(sourceKey) || !Array.isArray(tagIds)) return;
                        const validTagIds = Array.from(new Set(tagIds.filter((tagId) => (
                            typeof tagId === 'string' && candidateTagsById.has(tagId)
                        ))));
                        if (validTagIds.length > 0) {
                            candidateSourceTagsById.set(sourceKey, validTagIds);
                        }
                    }
                );
                Object.entries(normalizedState.sourceStateById || {}).forEach(
                    ([sourceKey, sourceState]) => {
                        if (!isPlainRecord(sourceState)) {
                            throw new TypeError('invalid source state record');
                        }
                        const source = sourcesByKey?.get?.(sourceKey);
                        if (!source) return;
                        const addedAt = getOwnField(sourceState, 'addedAt', '');
                        candidateSourceUpdates.push({
                            source,
                            enabled: Boolean(getOwnField(sourceState, 'enabled', false)),
                            addedAt: typeof addedAt === 'string' && addedAt
                                ? addedAt
                                : (source.addedAt || '')
                        });
                    }
                );
            } catch (error) {
                return false;
            }

            const normalizedPlacement = treePlacement.normalizePlacementState({
                state: {
                    ...normalizedState,
                    root: Array.isArray(normalizedState.root) ? normalizedState.root : [],
                    ungrouped: Array.isArray(normalizedState.ungrouped)
                        ? normalizedState.ungrouped
                        : []
                },
                groupsById: candidateGroupsById,
                liveSourceKeys: new Set(Array.from(sourcesByKey?.keys?.() || []))
            });
            if (!normalizedPlacement?.ok) return false;

            let beforeRuntime;
            try {
                const container = shadowRoot?.querySelector?.('.sp-container') || null;
                beforeRuntime = {
                    placement: {
                        ok: true,
                        state: {
                            ...state,
                            root: cloneSerializableData(Array.isArray(state.root) ? state.root : []),
                            ungrouped: Array.isArray(state.ungrouped) ? [...state.ungrouped] : []
                        },
                        groupsById: new Map(Array.from(
                            groupsById?.entries?.() || [],
                            ([groupId, group]) => [groupId, cloneSerializableData(group)]
                        )),
                        liveSourceKeys: new Set(Array.from(sourcesByKey?.keys?.() || []))
                    },
                    tagOrder: Array.isArray(state.tagOrder) ? [...state.tagOrder] : [],
                    isBatchMode: Boolean(state.isBatchMode),
                    activeTagId: state.activeTagId ?? null,
                    pendingBatchKeys: Array.from(pendingBatchKeys || []),
                    tagsById: new Map(Array.from(tagsById?.entries?.() || [])),
                    sourceTagsById: new Map(Array.from(
                        sourceTagsById?.entries?.() || [],
                        ([sourceKey, tagIds]) => [
                            sourceKey,
                            Array.isArray(tagIds) ? [...tagIds] : tagIds
                        ]
                    )),
                    sourceStateByKey: new Map(Array.from(
                        sourcesByKey?.entries?.() || [],
                        ([sourceKey, source]) => [
                            sourceKey,
                            {
                                enabled: source?.enabled,
                                addedAt: source?.addedAt
                            }
                        ]
                    )),
                    customHeight: runtime.customHeight,
                    sourceViewDisplayKind: runtime.sourceViewDisplayKind,
                    container,
                    containerHeight: container?.style?.height
                };
            } catch (error) {
                return false;
            }

            const rollbackRuntime = () => {
                let restored = false;
                try {
                    const placementRollback = treePlacement.commitPlacementModel(beforeRuntime.placement);
                    restored = Boolean(placementRollback?.ok);

                    state.tagOrder = [...beforeRuntime.tagOrder];
                    state.isBatchMode = beforeRuntime.isBatchMode;
                    state.activeTagId = beforeRuntime.activeTagId;
                    if (pendingBatchKeys && typeof pendingBatchKeys.clear === 'function') {
                        pendingBatchKeys.clear();
                        beforeRuntime.pendingBatchKeys.forEach((sourceKey) => pendingBatchKeys.add(sourceKey));
                    }

                    if (tagsById && typeof tagsById.clear === 'function') {
                        tagsById.clear();
                        beforeRuntime.tagsById.forEach((tag, tagId) => tagsById.set(tagId, tag));
                    }
                    if (sourceTagsById && typeof sourceTagsById.clear === 'function') {
                        sourceTagsById.clear();
                        beforeRuntime.sourceTagsById.forEach((tagIds, sourceKey) => {
                            sourceTagsById.set(sourceKey, tagIds);
                        });
                    }
                    beforeRuntime.sourceStateByKey.forEach((sourceState, sourceKey) => {
                        const source = sourcesByKey?.get?.(sourceKey);
                        if (!source) return;
                        source.enabled = sourceState.enabled;
                        source.addedAt = sourceState.addedAt;
                    });
                    runtime.customHeight = beforeRuntime.customHeight;
                    runtime.sourceViewDisplayKind = beforeRuntime.sourceViewDisplayKind;
                    if (beforeRuntime.container?.style) {
                        beforeRuntime.container.style.height = beforeRuntime.containerHeight || '';
                    }
                    refreshParentMap();
                    sourcesByKey?.forEach?.((source) => {
                        try {
                            pushSourceToPage(source, computeEffectiveEnabled(source));
                        } catch (error) {
                            // Runtime state is authoritative; a later source sync retries DOM hydration.
                        }
                    });
                } catch (error) {
                    restored = false;
                }
                return restored;
            };

            try {
                const placementCommit = treePlacement.commitPlacementModel(normalizedPlacement);
                if (!placementCommit?.ok) return false;

                state.tagOrder = candidateTagOrder;
                state.isBatchMode = false;
                if (pendingBatchKeys && typeof pendingBatchKeys.clear === 'function') {
                    pendingBatchKeys.clear();
                }

                if (tagsById && typeof tagsById.clear === 'function') {
                    tagsById.clear();
                    candidateTagsById.forEach((tag, tagId) => {
                        tagsById.set(tagId, tag);
                    });
                }

                if (sourceTagsById && typeof sourceTagsById.clear === 'function') {
                    sourceTagsById.clear();
                    candidateSourceTagsById.forEach((tagIds, sourceKey) => {
                        sourceTagsById.set(sourceKey, tagIds);
                    });
                }

                candidateSourceUpdates.forEach(({ source, enabled, addedAt }) => {
                    source.enabled = enabled;
                    source.addedAt = addedAt;
                });

                if (state.activeTagId && !tagsById?.has?.(state.activeTagId)) {
                    state.activeTagId = null;
                }

                runtime.customHeight = normalizedState.customHeight ?? null;
                if (candidateSourceViewDisplayKind) {
                    runtime.sourceViewDisplayKind = candidateSourceViewDisplayKind;
                }
                const container = shadowRoot?.querySelector?.('.sp-container');
                if (container) {
                    container.style.height = runtime.customHeight == null
                        ? ''
                        : `${runtime.customHeight}px`;
                }

                refreshParentMap();
                sourcesByKey?.forEach?.((source) => {
                    pushSourceToPage(source, computeEffectiveEnabled(source));
                });
                return true;
            } catch (error) {
                rollbackRuntime();
                return false;
            }
        }

        return {
            applyPersistableSnapshotToRuntime
        };
    }

    globalThis.NSM_CREATE_CONTENT_STATE_APPLY = createContentStateApply;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentStateApply;
    }
})();
