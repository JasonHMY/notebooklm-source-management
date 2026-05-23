(function () {
    'use strict';

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
            throw new Error('NotebookLM Source Management: createContentStateApply requires a runtime context.');
        }
        if (typeof cloneSerializableData !== 'function'
            || typeof normalizeLoadedState !== 'function'
            || typeof hasPersistableManagerState !== 'function') {
            throw new Error('NotebookLM Source Management: createContentStateApply requires cloneSerializableData, normalizeLoadedState and hasPersistableManagerState.');
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

            state.groups = Array.isArray(normalizedState.groups) ? [...normalizedState.groups] : [];
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

            const knownSourceKeys = new Set(state.ungrouped);
            const visitGroupSources = (groupId) => {
                const group = groupsById?.get?.(groupId);
                if (!group || !Array.isArray(group.children)) return;
                group.children.forEach((child) => {
                    if (child?.type === 'source' && child.key) {
                        knownSourceKeys.add(child.key);
                    } else if (child?.type === 'group' && child.id) {
                        visitGroupSources(child.id);
                    }
                });
            };
            state.groups.forEach(visitGroupSources);
            sourcesByKey?.forEach?.((source, sourceKey) => {
                if (!knownSourceKeys.has(sourceKey)) {
                    state.ungrouped.push(sourceKey);
                    knownSourceKeys.add(sourceKey);
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
