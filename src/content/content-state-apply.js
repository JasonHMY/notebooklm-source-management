(function () {
    'use strict';

    /**
     * createContentStateApply(deps) — 把持久化 snapshot 灌回 runtime 状态对象。
     * 用 `applyPersistableSnapshotToRuntime(snapshot)` 把 normalized state 的
     * groups / ungrouped / tagOrder / groupsById / tagsById / sourceTagsById / sourceStateById /
     * customHeight 全量同步到 runtime + 调用 `syncSourceToPage` 把 enabled 推回 NotebookLM 原生 DOM。
     * 是 undo / import / SW state push 三条恢复路径共用的最后一步。
     *
     * @param {Object} deps Required: runtime, cloneSerializableData, normalizeLoadedState, hasPersistableManagerState.
     *   Optional: normalizeSourceText, buildParentMap, syncSourceToPage, isSourceEffectivelyEnabled.
     * @returns {{ applyPersistableSnapshotToRuntime }} 返回 true 表示 snapshot 已应用,false 表示
     *   snapshot 缺失或不是 persistable shape。
     */
    function createContentStateApply(deps = {}) {
        const {
            cloneSerializableData,
            normalizeLoadedState,
            hasPersistableManagerState,
            normalizeSourceText,
            buildParentMap,
            syncSourceToPage,
            isSourceEffectivelyEnabled
        } = deps;
        const runtime = deps.runtime || deps;

        if (!runtime) {
            throw new Error('GeminiNotebook-Source-Management: createContentStateApply requires a runtime context.');
        }
        if (typeof cloneSerializableData !== 'function'
            || typeof normalizeLoadedState !== 'function'
            || typeof hasPersistableManagerState !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentStateApply requires cloneSerializableData, normalizeLoadedState and hasPersistableManagerState.');
        }

        const normalizeText = typeof normalizeSourceText === 'function'
            ? normalizeSourceText
            : (value) => String(value || '');
        const refreshParentMap = typeof buildParentMap === 'function'
            ? buildParentMap
            : () => {};
        const pushSourceToPage = typeof syncSourceToPage === 'function'
            ? syncSourceToPage
            : () => {};
        const computeEffectiveEnabled = typeof isSourceEffectivelyEnabled === 'function'
            ? isSourceEffectivelyEnabled
            : () => true;

        function applyPersistableSnapshotToRuntime(snapshot) {
            const normalizedState = normalizeLoadedState(cloneSerializableData(snapshot));
            if (!normalizedState || !hasPersistableManagerState(normalizedState)) return false;

            const state = runtime.state;
            const pendingBatchKeys = runtime.pendingBatchKeys;
            const groupsById = runtime.groupsById;
            const tagsById = runtime.tagsById;
            const sourceTagsById = runtime.sourceTagsById;
            const sourcesByKey = runtime.sourcesByKey;
            const shadowRoot = runtime.shadowRoot;

            state.root = Array.isArray(normalizedState.root) ? [...normalizedState.root] : [];
            state.ungrouped = Array.isArray(normalizedState.ungrouped) ? [...normalizedState.ungrouped] : [];
            state.tagOrder = Array.isArray(normalizedState.tagOrder) ? [...normalizedState.tagOrder] : [];
            state.isBatchMode = false;
            if (pendingBatchKeys && typeof pendingBatchKeys.clear === 'function') {
                pendingBatchKeys.clear();
            }

            if (groupsById && typeof groupsById.clear === 'function') {
                groupsById.clear();
                Object.entries(normalizedState.groupsById || {}).forEach(([groupId, group]) => {
                    groupsById.set(groupId, cloneSerializableData(group));
                });
            }

            if (tagsById && typeof tagsById.clear === 'function') {
                tagsById.clear();
                Object.entries(normalizedState.tagsById || {}).forEach(([tagId, tag]) => {
                    tagsById.set(tagId, cloneSerializableData(tag));
                });
            }

            if (sourceTagsById && typeof sourceTagsById.clear === 'function') {
                sourceTagsById.clear();
                Object.entries(normalizedState.sourceTagsById || {}).forEach(([sourceKey, tagIds]) => {
                    sourceTagsById.set(sourceKey, Array.isArray(tagIds) ? [...tagIds] : []);
                });
            }

            Object.entries(normalizedState.sourceStateById || {}).forEach(([sourceKey, sourceState]) => {
                const source = sourcesByKey?.get?.(sourceKey);
                if (!source) return;
                source.enabled = Boolean(sourceState.enabled);
                source.title = sourceState.title || source.title;
                source.normalizedTitle = sourceState.normalizedTitle || normalizeText(source.title);
                source.stableToken = sourceState.stableToken || source.stableToken || '';
                source.fingerprint = sourceState.fingerprint || source.fingerprint || '';
                source.identityType = sourceState.identityType || source.identityType || 'fingerprint';
                source.addedAt = sourceState.addedAt || source.addedAt || '';
            });

            // Defense-in-depth: enforce the v5 invariant that each source key lives in
            // exactly one of group.children / state.root / state.ungrouped, even if the
            // snapshot is malformed (e.g. a key duplicated across root and the bin). Folder
            // membership wins, then positioned root sources, then the bin; orphans sweep in.
            const seenSourceRefs = new Set();
            const visitGroupSources = (groupId) => {
                const group = groupsById?.get?.(groupId);
                if (!group || !Array.isArray(group.children)) return;
                group.children.forEach((child) => {
                    if (child?.type === 'source' && child.key) {
                        seenSourceRefs.add(child.key);
                    } else if (child?.type === 'group' && child.id) {
                        visitGroupSources(child.id);
                    }
                });
            };
            // Pass 1: collect every grouped source key reachable from the root folders.
            (Array.isArray(state.root) ? state.root : []).forEach((entry) => {
                if (entry?.type === 'group' && entry.id) visitGroupSources(entry.id);
            });
            // Pass 2: keep root folder entries + first-seen positioned root sources only.
            state.root = (Array.isArray(state.root) ? state.root : []).filter((entry) => {
                if (entry?.type === 'group' && entry.id) return true;
                if (entry?.type === 'source' && entry.key && !seenSourceRefs.has(entry.key)) {
                    seenSourceRefs.add(entry.key);
                    return true;
                }
                return false;
            });
            // De-dup the bin against anything already placed in a folder or at root.
            state.ungrouped = (Array.isArray(state.ungrouped) ? state.ungrouped : []).filter((sourceKey) => {
                if (!sourceKey || seenSourceRefs.has(sourceKey)) return false;
                seenSourceRefs.add(sourceKey);
                return true;
            });
            // Orphan sweep: any live source not placed anywhere lands in the bin.
            sourcesByKey?.forEach?.((source, sourceKey) => {
                if (!seenSourceRefs.has(sourceKey)) {
                    state.ungrouped.push(sourceKey);
                    seenSourceRefs.add(sourceKey);
                }
            });

            if (state.activeTagId && !tagsById?.has?.(state.activeTagId)) {
                state.activeTagId = null;
            }

            if (normalizedState.customHeight != null) {
                runtime.customHeight = normalizedState.customHeight;
                const container = shadowRoot?.querySelector?.('.sp-container');
                if (container) container.style.height = `${normalizedState.customHeight}px`;
            }

            refreshParentMap();
            sourcesByKey?.forEach?.((source) => {
                pushSourceToPage(source, computeEffectiveEnabled(source));
            });
            return true;
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
