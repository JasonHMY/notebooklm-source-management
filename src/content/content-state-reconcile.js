(function () {
    'use strict';

    function createContentStateReconcile(deps = {}) {
        const {
            normalizeSourceText,
            normalizeTagLabel,
            normalizeTagColor
        } = deps;
        const runtime = deps.runtime || deps;

        function buildSourceLookup(sourceList) {
            const byId = new Map();
            const byLegacyKey = new Map();
            const stableTokenBuckets = new Map();
            const fingerprintBuckets = new Map();
            const titleBuckets = new Map();

            for (const source of sourceList) {
                byId.set(source.key, source.key);
                byLegacyKey.set(source.legacyKey, source.key);

                if (source.stableToken) {
                    if (!stableTokenBuckets.has(source.stableToken)) stableTokenBuckets.set(source.stableToken, []);
                    stableTokenBuckets.get(source.stableToken).push(source.key);
                }
                if (!fingerprintBuckets.has(source.fingerprint)) fingerprintBuckets.set(source.fingerprint, []);
                fingerprintBuckets.get(source.fingerprint).push(source.key);

                if (!titleBuckets.has(source.normalizedTitle)) titleBuckets.set(source.normalizedTitle, []);
                titleBuckets.get(source.normalizedTitle).push(source.key);
            }

            const uniqueByStableToken = new Map();
            const uniqueByFingerprint = new Map();
            const uniqueByTitle = new Map();

            stableTokenBuckets.forEach((keys, stableToken) => {
                if (keys.length === 1) uniqueByStableToken.set(stableToken, keys[0]);
            });
            fingerprintBuckets.forEach((keys, fingerprint) => {
                if (keys.length === 1) uniqueByFingerprint.set(fingerprint, keys[0]);
            });
            titleBuckets.forEach((keys, normalizedTitle) => {
                if (keys.length === 1) uniqueByTitle.set(normalizedTitle, keys[0]);
            });

            return {
                byId,
                byLegacyKey,
                uniqueByStableToken,
                uniqueByFingerprint,
                uniqueByTitle
            };
        }

        function resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord = null) {
            if (!storedKey || !sourceLookup) return null;
            if (sourceLookup.byId.has(storedKey)) return sourceLookup.byId.get(storedKey);
            if (sourceLookup.byLegacyKey.has(storedKey)) return sourceLookup.byLegacyKey.get(storedKey);

            if (sourceRecord && sourceRecord.stableToken && sourceLookup.uniqueByStableToken.has(sourceRecord.stableToken)) {
                return sourceLookup.uniqueByStableToken.get(sourceRecord.stableToken);
            }

            if (sourceRecord && sourceRecord.fingerprint && sourceLookup.uniqueByFingerprint.has(sourceRecord.fingerprint)) {
                return sourceLookup.uniqueByFingerprint.get(sourceRecord.fingerprint);
            }

            const normalizedTitle = normalizeSourceText(
                sourceRecord && (sourceRecord.normalizedTitle || sourceRecord.title)
            );
            if (normalizedTitle && sourceLookup.uniqueByTitle.has(normalizedTitle)) {
                return sourceLookup.uniqueByTitle.get(normalizedTitle);
            }

            return null;
        }

        function snapshotExistingSourceRecords() {
            const sourceRecordsByKey = new Map();
            runtime.sourcesByKey.forEach((source, key) => {
                sourceRecordsByKey.set(key, {
                    enabled: Boolean(source.enabled),
                    title: source.title,
                    normalizedTitle: source.normalizedTitle || normalizeSourceText(source.title),
                    stableToken: source.stableToken || '',
                    fingerprint: source.fingerprint || '',
                    identityType: source.identityType || 'fingerprint'
                });
            });
            return sourceRecordsByKey;
        }

        function remapExistingStateToCurrentSources(sourceLookup, previousState) {
            const nextGroups = [];
            const nextUngrouped = [];
            const nextGroupsById = new Map();
            const nextSourceStateById = new Map();
            const nextSourceTagsById = new Map();
            const seenSourceRefs = new Set();

            runtime.groupsById.forEach((group, groupId) => {
                nextGroupsById.set(groupId, {
                    ...group,
                    children: []
                });
            });

            runtime.groupsById.forEach((group, groupId) => {
                const nextGroup = nextGroupsById.get(groupId);
                if (!nextGroup) return;

                group.children.forEach((child) => {
                    if (child.type === 'group' && nextGroupsById.has(child.id) && child.id !== groupId) {
                        nextGroup.children.push({ type: 'group', id: child.id });
                        return;
                    }

                    if (child.type !== 'source') return;

                    const sourceRecord = previousState.sourceRecordsByKey.get(child.key) || null;
                    const resolvedKey = resolveStoredSourceKey(child.key, sourceLookup, sourceRecord);
                    if (!resolvedKey || seenSourceRefs.has(resolvedKey)) return;

                    nextGroup.children.push({ type: 'source', key: resolvedKey });
                    seenSourceRefs.add(resolvedKey);

                    if (!nextSourceStateById.has(resolvedKey) && sourceRecord) {
                        nextSourceStateById.set(resolvedKey, sourceRecord);
                    }

                    if (!nextSourceTagsById.has(resolvedKey) && previousState.sourceTagsById.has(child.key)) {
                        nextSourceTagsById.set(resolvedKey, [...previousState.sourceTagsById.get(child.key)]);
                    }
                });
            });

            runtime.state.groups.forEach((groupId) => {
                if (nextGroupsById.has(groupId)) {
                    nextGroups.push(groupId);
                }
            });

            runtime.state.ungrouped.forEach((storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || seenSourceRefs.has(resolvedKey)) return;

                nextUngrouped.push(resolvedKey);
                seenSourceRefs.add(resolvedKey);

                if (!nextSourceStateById.has(resolvedKey) && sourceRecord) {
                    nextSourceStateById.set(resolvedKey, sourceRecord);
                }

                if (!nextSourceTagsById.has(resolvedKey) && previousState.sourceTagsById.has(storedKey)) {
                    nextSourceTagsById.set(resolvedKey, [...previousState.sourceTagsById.get(storedKey)]);
                }
            });

            previousState.sourceRecordsByKey.forEach((sourceRecord, storedKey) => {
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || nextSourceStateById.has(resolvedKey)) return;
                nextSourceStateById.set(resolvedKey, sourceRecord);
            });

            previousState.sourceTagsById.forEach((tagIds, storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || nextSourceTagsById.has(resolvedKey)) return;
                nextSourceTagsById.set(resolvedKey, [...tagIds]);
            });

            return {
                groups: nextGroups,
                ungrouped: nextUngrouped,
                groupsById: nextGroupsById,
                sourceStateById: nextSourceStateById,
                sourceTagsById: nextSourceTagsById,
                seenSourceRefs
            };
        }

        function buildResolvedSourceStateById(sourceLookup, loadedState) {
            const resolvedSourceState = new Map();
            if (!loadedState) return resolvedSourceState;

            if (loadedState.sourceStateById) {
                Object.entries(loadedState.sourceStateById).forEach(([storedKey, sourceRecord]) => {
                    const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                    if (resolvedKey && !resolvedSourceState.has(resolvedKey)) {
                        resolvedSourceState.set(resolvedKey, sourceRecord);
                    }
                });
                return resolvedSourceState;
            }

            if (loadedState.legacyEnabledMap) {
                Object.entries(loadedState.legacyEnabledMap).forEach(([legacyKey, enabled]) => {
                    const resolvedKey = resolveStoredSourceKey(legacyKey, sourceLookup);
                    if (resolvedKey && !resolvedSourceState.has(resolvedKey)) {
                        resolvedSourceState.set(resolvedKey, { enabled: Boolean(enabled) });
                    }
                });
            }

            return resolvedSourceState;
        }

        function buildNormalizedTagState(loadedState) {
            const nextTagsById = new Map();
            const rawTagsById = loadedState && typeof loadedState.tagsById === 'object' ? loadedState.tagsById : {};
            const preferredOrder = Array.isArray(loadedState && loadedState.tagOrder) ? loadedState.tagOrder : [];
            const seenTagIds = new Set();
            const nextTagOrder = [];

            const registerTag = (tagId) => {
                if (!tagId || seenTagIds.has(tagId)) return;
                const rawTag = rawTagsById[tagId];
                const label = normalizeTagLabel(rawTag && (rawTag.label || rawTag.title || rawTag.name || ''));
                if (!label) return;
                seenTagIds.add(tagId);
                nextTagOrder.push(tagId);
                nextTagsById.set(tagId, {
                    id: tagId,
                    label,
                    color: normalizeTagColor(rawTag && rawTag.color)
                });
            };

            preferredOrder.forEach(registerTag);
            Object.keys(rawTagsById).forEach(registerTag);

            return { nextTagsById, nextTagOrder };
        }

        function buildResolvedSourceTagsById(sourceLookup, loadedState) {
            const resolvedSourceTags = new Map();
            if (!loadedState || !loadedState.sourceTagsById) return resolvedSourceTags;

            Object.entries(loadedState.sourceTagsById).forEach(([storedKey, rawTagIds]) => {
                const sourceRecord = loadedState.sourceStateById ? loadedState.sourceStateById[storedKey] : null;
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || resolvedSourceTags.has(resolvedKey)) return;

                resolvedSourceTags.set(
                    resolvedKey,
                    Array.from(new Set(Array.isArray(rawTagIds) ? rawTagIds.filter(Boolean) : []))
                );
            });

            return resolvedSourceTags;
        }

        function reconcilePersistedTree(loadedState, sourceLookup) {
            const nextGroupsById = new Map();
            const seenSourceRefs = new Set();
            const rawGroupsById = loadedState && loadedState.groupsById ? loadedState.groupsById : {};

            Object.entries(rawGroupsById).forEach(([groupId, rawGroup]) => {
                nextGroupsById.set(groupId, {
                    ...rawGroup,
                    enabled: rawGroup.enabled !== undefined ? rawGroup.enabled : true,
                    collapsed: rawGroup.collapsed === true,
                    children: []
                });
            });

            Object.entries(rawGroupsById).forEach(([groupId, rawGroup]) => {
                const nextGroup = nextGroupsById.get(groupId);
                if (!nextGroup) return;

                (Array.isArray(rawGroup.children) ? rawGroup.children : []).forEach((child) => {
                    if (child.type === 'group' && nextGroupsById.has(child.id) && child.id !== groupId) {
                        nextGroup.children.push({ type: 'group', id: child.id });
                        return;
                    }

                    if (child.type !== 'source') return;

                    const sourceRecord = loadedState && loadedState.sourceStateById
                        ? loadedState.sourceStateById[child.key]
                        : null;
                    const resolvedKey = resolveStoredSourceKey(child.key, sourceLookup, sourceRecord);
                    if (!resolvedKey || seenSourceRefs.has(resolvedKey)) return;

                    nextGroup.children.push({ type: 'source', key: resolvedKey });
                    seenSourceRefs.add(resolvedKey);
                });
            });

            const nextGroups = Array.isArray(loadedState && loadedState.groups)
                ? loadedState.groups.filter(groupId => nextGroupsById.has(groupId))
                : [];
            const nextUngrouped = [];

            (Array.isArray(loadedState && loadedState.ungrouped) ? loadedState.ungrouped : []).forEach((storedKey) => {
                const sourceRecord = loadedState && loadedState.sourceStateById
                    ? loadedState.sourceStateById[storedKey]
                    : null;
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || seenSourceRefs.has(resolvedKey)) return;

                nextUngrouped.push(resolvedKey);
                seenSourceRefs.add(resolvedKey);
            });

            return {
                groups: nextGroups,
                groupsById: nextGroupsById,
                ungrouped: nextUngrouped,
                seenSourceRefs
            };
        }

        return {
            buildSourceLookup,
            resolveStoredSourceKey,
            snapshotExistingSourceRecords,
            remapExistingStateToCurrentSources,
            buildResolvedSourceStateById,
            buildNormalizedTagState,
            buildResolvedSourceTagsById,
            reconcilePersistedTree
        };
    }

    globalThis.NSM_CREATE_CONTENT_STATE_RECONCILE = createContentStateReconcile;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentStateReconcile;
    }
})();
