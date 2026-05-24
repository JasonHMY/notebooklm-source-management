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
            const byElement = new WeakMap();
            const sourceByKey = new Map();
            const orderedKeys = [];
            const legacyKeyBuckets = new Map();
            const stableTokenBuckets = new Map();
            const fingerprintBuckets = new Map();
            const titleBuckets = new Map();

            for (const source of sourceList) {
                byId.set(source.key, source.key);
                byLegacyKey.set(source.legacyKey, source.key);
                sourceByKey.set(source.key, source);
                orderedKeys.push(source.key);
                if (source.element && typeof source.element === 'object') {
                    byElement.set(source.element, source.key);
                }

                if (source.legacyKey) {
                    if (!legacyKeyBuckets.has(source.legacyKey)) legacyKeyBuckets.set(source.legacyKey, []);
                    legacyKeyBuckets.get(source.legacyKey).push(source.key);
                }
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
                byElement,
                sourceByKey,
                orderedKeys,
                legacyKeyBuckets,
                stableTokenBuckets,
                fingerprintBuckets,
                titleBuckets,
                uniqueByStableToken,
                uniqueByFingerprint,
                uniqueByTitle
            };
        }

        function createResolvedSourceKey(key, reason) {
            return { key: key || null, reason: key ? reason : 'unresolved' };
        }

        function normalizeStableTokenForComparison(value) {
            return String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
        }

        function areStableTokensCompatible(storedStableToken, candidateStableToken) {
            const storedToken = normalizeStableTokenForComparison(storedStableToken);
            const candidateToken = normalizeStableTokenForComparison(candidateStableToken);
            if (!storedToken || !candidateToken) return true;
            if (storedToken === candidateToken) return true;
            return candidateToken.endsWith(`-${storedToken}`) || storedToken.endsWith(`-${candidateToken}`);
        }

        function extractStableTokenFromSourceKey(sourceKey) {
            const value = String(sourceKey || '');
            return value.startsWith('source_id_') ? value.slice('source_id_'.length) : '';
        }

        function getStoredStableToken(sourceRecord = null, storedKey = '') {
            return sourceRecord?.stableToken || extractStableTokenFromSourceKey(storedKey);
        }

        function canResolveSourceByWeakIdentity(sourceLookup, candidateKey, sourceRecord = null, storedKey = '') {
            if (!candidateKey || !sourceRecord) return Boolean(candidateKey);
            const candidateSource = sourceLookup?.sourceByKey?.get?.(candidateKey) || null;
            const storedStableToken = getStoredStableToken(sourceRecord, storedKey);
            if (!storedStableToken && candidateSource?.stableToken) {
                return false;
            }
            if (
                storedStableToken &&
                candidateSource?.stableToken &&
                !areStableTokensCompatible(storedStableToken, candidateSource.stableToken)
            ) {
                return false;
            }
            return true;
        }

        function resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord = null) {
            if (!storedKey || !sourceLookup) return createResolvedSourceKey(null, 'unresolved');
            if (sourceLookup.byId.has(storedKey)) return createResolvedSourceKey(sourceLookup.byId.get(storedKey), 'id');
            if (sourceLookup.byLegacyKey.has(storedKey)) return createResolvedSourceKey(sourceLookup.byLegacyKey.get(storedKey), 'legacy');

            if (sourceRecord && sourceRecord.stableToken && sourceLookup.uniqueByStableToken.has(sourceRecord.stableToken)) {
                return createResolvedSourceKey(sourceLookup.uniqueByStableToken.get(sourceRecord.stableToken), 'stable-token');
            }

            if (sourceRecord && sourceRecord.fingerprint && sourceLookup.uniqueByFingerprint.has(sourceRecord.fingerprint)) {
                const fingerprintKey = sourceLookup.uniqueByFingerprint.get(sourceRecord.fingerprint);
                if (canResolveSourceByWeakIdentity(sourceLookup, fingerprintKey, sourceRecord, storedKey)) {
                    return createResolvedSourceKey(fingerprintKey, 'fingerprint');
                }
            }

            if (
                sourceRecord &&
                sourceRecord.element &&
                sourceLookup.byElement &&
                sourceLookup.byElement.has(sourceRecord.element)
            ) {
                return createResolvedSourceKey(sourceLookup.byElement.get(sourceRecord.element), 'element');
            }

            const normalizedTitle = normalizeSourceText(
                sourceRecord && (sourceRecord.normalizedTitle || sourceRecord.title)
            );
            if (normalizedTitle && sourceLookup.uniqueByTitle.has(normalizedTitle)) {
                const titleKey = sourceLookup.uniqueByTitle.get(normalizedTitle);
                if (canResolveSourceByWeakIdentity(sourceLookup, titleKey, sourceRecord, storedKey)) {
                    return createResolvedSourceKey(titleKey, 'unique-title');
                }
            }

            return createResolvedSourceKey(null, 'unresolved');
        }

        function resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord = null) {
            return resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord).key;
        }

        function collectPersistedSourceRefs(snapshot) {
            const refs = new Set();
            const groupsById = snapshot && typeof snapshot.groupsById === 'object' ? snapshot.groupsById : {};
            const visitedGroups = new Set();

            const visitGroup = (groupId) => {
                if (!groupId || visitedGroups.has(groupId)) return;
                visitedGroups.add(groupId);
                const group = groupsById[groupId];
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

            Object.keys(groupsById).forEach(visitGroup);
            (Array.isArray(snapshot?.ungrouped) ? snapshot.ungrouped : []).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            Object.keys(snapshot?.sourceStateById || {}).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            return refs;
        }

        function getSourceRepairTitle(sourceRecord, storedKey) {
            return String(
                sourceRecord?.title ||
                sourceRecord?.normalizedTitle ||
                storedKey ||
                ''
            );
        }

        function createSourceCandidateDetail(sourceLookup, sourceKey, reason) {
            const source = sourceLookup?.sourceByKey?.get?.(sourceKey) || null;
            return {
                key: sourceKey,
                title: source?.title || source?.normalizedTitle || sourceKey,
                reason
            };
        }

        function addSourceCandidate(candidates, seenKeys, sourceLookup, sourceKey, reason) {
            if (!sourceKey || seenKeys.has(sourceKey)) return;
            seenKeys.add(sourceKey);
            candidates.push(createSourceCandidateDetail(sourceLookup, sourceKey, reason));
        }

        function addSourceCandidateBucket(candidates, seenKeys, sourceLookup, bucket, reason) {
            (Array.isArray(bucket) ? bucket : []).forEach((sourceKey) => {
                addSourceCandidate(candidates, seenKeys, sourceLookup, sourceKey, reason);
            });
        }

        function getSourceRepairCandidates(storedKey, sourceLookup, sourceRecord = null) {
            const candidates = [];
            const seenKeys = new Set();
            if (!sourceLookup) return candidates;

            addSourceCandidateBucket(
                candidates,
                seenKeys,
                sourceLookup,
                sourceLookup.legacyKeyBuckets?.get?.(storedKey),
                'legacy'
            );

            if (sourceRecord?.stableToken) {
                addSourceCandidateBucket(
                    candidates,
                    seenKeys,
                    sourceLookup,
                    sourceLookup.stableTokenBuckets?.get?.(sourceRecord.stableToken),
                    'stable-token'
                );
            }

            if (sourceRecord?.fingerprint) {
                addSourceCandidateBucket(
                    candidates,
                    seenKeys,
                    sourceLookup,
                    sourceLookup.fingerprintBuckets?.get?.(sourceRecord.fingerprint),
                    'fingerprint'
                );
            }

            const normalizedTitle = normalizeSourceText(
                sourceRecord && (sourceRecord.normalizedTitle || sourceRecord.title)
            );
            if (normalizedTitle) {
                addSourceCandidateBucket(
                    candidates,
                    seenKeys,
                    sourceLookup,
                    sourceLookup.titleBuckets?.get?.(normalizedTitle),
                    'unique-title'
                );
            }

            return candidates;
        }

        function buildSourceMatchReport(snapshot, sourceLookup) {
            const sourceRefs = collectPersistedSourceRefs(snapshot);
            const matched = [];
            const unmatched = [];
            const ambiguous = [];

            sourceRefs.forEach((storedKey) => {
                const sourceRecord = snapshot?.sourceStateById?.[storedKey] || null;
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                const baseItem = {
                    storedKey,
                    title: getSourceRepairTitle(sourceRecord, storedKey),
                    reason: resolution.reason || 'unresolved',
                    resolvedKey: resolution.key || '',
                    candidates: []
                };

                if (resolution.key) {
                    matched.push(baseItem);
                    return;
                }

                const candidates = getSourceRepairCandidates(storedKey, sourceLookup, sourceRecord);
                if (candidates.length > 0) {
                    ambiguous.push({
                        ...baseItem,
                        reason: candidates[0]?.reason || 'ambiguous',
                        candidates
                    });
                    return;
                }

                unmatched.push(baseItem);
            });

            return {
                totalSources: sourceRefs.size,
                matchedSources: matched.length,
                unmatchedSources: unmatched.length,
                ambiguousSources: ambiguous.length,
                matched,
                unmatched,
                ambiguous
            };
        }

        function normalizeSourceRemaps(remaps) {
            if (remaps instanceof Map) {
                return new Map(Array.from(remaps.entries()).filter(([from, to]) => from && to && from !== to));
            }
            if (Array.isArray(remaps)) {
                return new Map(remaps
                    .map((entry) => Array.isArray(entry)
                        ? entry
                        : [entry?.storedKey || entry?.from || entry?.sourceKey, entry?.resolvedKey || entry?.to || entry?.targetKey])
                    .filter(([from, to]) => from && to && from !== to));
            }
            if (remaps && typeof remaps === 'object') {
                return new Map(Object.entries(remaps).filter(([from, to]) => from && to && from !== to));
            }
            return new Map();
        }

        function applySourceRemapsToSnapshot(snapshot, remaps) {
            const sourceRemaps = normalizeSourceRemaps(remaps);
            const baseSnapshot = snapshot || {};
            let clonedSnapshot;
            if (typeof globalThis.structuredClone === 'function') {
                try {
                    clonedSnapshot = globalThis.structuredClone(baseSnapshot);
                } catch (error) {
                    // Fall through to JSON cloning for plain persisted snapshots.
                }
            }
            if (!clonedSnapshot) {
                clonedSnapshot = JSON.parse(JSON.stringify(baseSnapshot));
            }
            if (sourceRemaps.size === 0) return clonedSnapshot;

            const mapSourceKey = (sourceKey) => sourceRemaps.get(sourceKey) || sourceKey;
            const seenTreeSourceRefs = new Set();
            const groupsById = clonedSnapshot.groupsById && typeof clonedSnapshot.groupsById === 'object'
                ? clonedSnapshot.groupsById
                : {};

            Object.values(groupsById).forEach((group) => {
                if (!group || !Array.isArray(group.children)) return;
                const nextChildren = [];
                (Array.isArray(group.children) ? group.children : []).forEach((child) => {
                    if (child?.type !== 'source') {
                        nextChildren.push(child);
                        return;
                    }
                    const nextKey = mapSourceKey(child.key);
                    if (!nextKey || seenTreeSourceRefs.has(nextKey)) return;
                    seenTreeSourceRefs.add(nextKey);
                    nextChildren.push({ ...child, key: nextKey });
                });
                group.children = nextChildren;
            });

            clonedSnapshot.ungrouped = (Array.isArray(clonedSnapshot.ungrouped) ? clonedSnapshot.ungrouped : [])
                .map(mapSourceKey)
                .filter((sourceKey) => {
                    if (!sourceKey || seenTreeSourceRefs.has(sourceKey)) return false;
                    seenTreeSourceRefs.add(sourceKey);
                    return true;
                });

            const sourceStateById = clonedSnapshot.sourceStateById && typeof clonedSnapshot.sourceStateById === 'object'
                ? clonedSnapshot.sourceStateById
                : {};
            const nextSourceStateById = {};
            Object.entries(sourceStateById).forEach(([sourceKey, sourceRecord]) => {
                if (sourceRemaps.has(sourceKey)) return;
                nextSourceStateById[sourceKey] = sourceRecord;
            });
            Object.entries(sourceStateById).forEach(([sourceKey, sourceRecord]) => {
                if (!sourceRemaps.has(sourceKey)) return;
                nextSourceStateById[mapSourceKey(sourceKey)] = sourceRecord;
            });
            clonedSnapshot.sourceStateById = nextSourceStateById;

            const sourceTagsById = clonedSnapshot.sourceTagsById && typeof clonedSnapshot.sourceTagsById === 'object'
                ? clonedSnapshot.sourceTagsById
                : {};
            const nextSourceTagsById = {};
            const mergeTagIds = (targetSourceKey, tagIds) => {
                if (!targetSourceKey) return;
                const nextTagIds = new Set(Array.isArray(nextSourceTagsById[targetSourceKey])
                    ? nextSourceTagsById[targetSourceKey]
                    : []);
                (Array.isArray(tagIds) ? tagIds : []).forEach((tagId) => {
                    if (tagId) nextTagIds.add(tagId);
                });
                if (nextTagIds.size > 0) {
                    nextSourceTagsById[targetSourceKey] = Array.from(nextTagIds);
                }
            };
            Object.entries(sourceTagsById).forEach(([sourceKey, tagIds]) => {
                if (sourceRemaps.has(sourceKey)) return;
                mergeTagIds(sourceKey, tagIds);
            });
            Object.entries(sourceTagsById).forEach(([sourceKey, tagIds]) => {
                if (!sourceRemaps.has(sourceKey)) return;
                mergeTagIds(mapSourceKey(sourceKey), tagIds);
            });
            clonedSnapshot.sourceTagsById = nextSourceTagsById;

            return clonedSnapshot;
        }

        function snapshotExistingSourceRecords() {
            const sourceRecordsByKey = new Map();
            let domIndex = 0;
            runtime.sourcesByKey.forEach((source, key) => {
                sourceRecordsByKey.set(key, {
                    enabled: Boolean(source.enabled),
                    title: source.title,
                    normalizedTitle: source.normalizedTitle || normalizeSourceText(source.title),
                    stableToken: source.stableToken || '',
                    fingerprint: source.fingerprint || '',
                    identityType: source.identityType || 'fingerprint',
                    addedAt: source.addedAt || '',
                    element: source.element || null,
                    domIndex
                });
                domIndex++;
            });
            return sourceRecordsByKey;
        }

        function buildSingleSourcePositionalRemap(sourceLookup, previousState) {
            const orderedKeys = Array.isArray(sourceLookup?.orderedKeys) ? sourceLookup.orderedKeys : [];
            const sourceRecordsByKey = previousState?.sourceRecordsByKey;
            if (!sourceRecordsByKey || typeof sourceRecordsByKey.entries !== 'function' || orderedKeys.length === 0) {
                return new Map();
            }

            const previousEntries = Array.from(sourceRecordsByKey.entries())
                .sort((left, right) => {
                    const leftIndex = Number(left[1]?.domIndex);
                    const rightIndex = Number(right[1]?.domIndex);
                    if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex)) return leftIndex - rightIndex;
                    if (Number.isFinite(leftIndex)) return -1;
                    if (Number.isFinite(rightIndex)) return 1;
                    return 0;
                });
            if (previousEntries.length !== orderedKeys.length) {
                return new Map();
            }

            const resolvedByOldKey = new Map();
            const resolvedReasonByOldKey = new Map();
            const resolvedCurrentKeys = new Set();
            let hasDuplicateResolution = false;
            previousEntries.forEach(([storedKey, sourceRecord]) => {
                const resolution = resolveStoredSourceKeyWithReason(storedKey, sourceLookup, sourceRecord);
                if (!resolution.key) return;
                if (resolvedCurrentKeys.has(resolution.key)) {
                    hasDuplicateResolution = true;
                    return;
                }
                resolvedByOldKey.set(storedKey, resolution.key);
                resolvedReasonByOldKey.set(storedKey, resolution.reason);
                resolvedCurrentKeys.add(resolution.key);
            });
            if (hasDuplicateResolution) {
                return new Map();
            }

            const unresolvedEntries = previousEntries
                .map(([storedKey, sourceRecord], index) => ({ storedKey, sourceRecord, index }))
                .filter(({ storedKey }) => !resolvedByOldKey.has(storedKey));
            if (unresolvedEntries.length !== 1) {
                return new Map();
            }

            const [{ storedKey, sourceRecord, index }] = unresolvedEntries;
            const candidateKey = orderedKeys[index];
            if (!candidateKey || resolvedCurrentKeys.has(candidateKey)) {
                return new Map();
            }

            const candidateSource = sourceLookup.sourceByKey?.get?.(candidateKey) || null;
            const storedStableToken = getStoredStableToken(sourceRecord, storedKey);
            if (candidateSource?.stableToken && !storedStableToken) {
                return new Map();
            }
            if (
                candidateSource?.stableToken &&
                storedStableToken &&
                !areStableTokensCompatible(storedStableToken, candidateSource.stableToken)
            ) {
                return new Map();
            }

            const strongAnchorReasons = new Set(['id', 'legacy', 'stable-token', 'fingerprint', 'element']);
            const hasStrongAnchorAtIndex = (entryIndex) => {
                if (entryIndex < 0 || entryIndex >= previousEntries.length) return false;
                const previousKey = previousEntries[entryIndex][0];
                const resolvedKey = resolvedByOldKey.get(previousKey);
                const resolvedReason = resolvedReasonByOldKey.get(previousKey);
                return Boolean(
                    resolvedKey &&
                    resolvedKey === orderedKeys[entryIndex] &&
                    strongAnchorReasons.has(resolvedReason)
                );
            };
            const hasAdjacentAnchor = previousEntries.length === 1 ||
                hasStrongAnchorAtIndex(index - 1) ||
                hasStrongAnchorAtIndex(index + 1);
            if (!hasAdjacentAnchor) {
                return new Map();
            }

            return new Map([[
                storedKey,
                {
                    key: candidateKey,
                    reason: 'position-single-unresolved'
                }
            ]]);
        }

        function remapExistingStateToCurrentSources(sourceLookup, previousState) {
            const nextGroups = [];
            const nextUngrouped = [];
            const nextGroupsById = new Map();
            const nextSourceStateById = new Map();
            const nextSourceTagsById = new Map();
            const seenSourceRefs = new Set();
            const positionalRemap = buildSingleSourcePositionalRemap(sourceLookup, previousState);
            const resolveCurrentSourceKey = (storedKey, sourceRecord) => (
                resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord) ||
                positionalRemap.get(storedKey)?.key ||
                null
            );

            runtime.groupsById.forEach((group, groupId) => {
                nextGroupsById.set(groupId, {
                    ...group,
                    children: []
                });
            });

            runtime.groupsById.forEach((group, groupId) => {
                const nextGroup = nextGroupsById.get(groupId);
                if (!nextGroup) return;

                (Array.isArray(group.children) ? group.children : []).forEach((child) => {
                    if (child.type === 'group' && appendGroupChildIfAcyclic(nextGroupsById, groupId, child.id)) {
                        return;
                    }

                    if (child.type !== 'source') return;

                    const sourceRecord = previousState.sourceRecordsByKey.get(child.key) || null;
                    const resolvedKey = resolveCurrentSourceKey(child.key, sourceRecord);
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

            (Array.isArray(runtime.state?.groups) ? runtime.state.groups : []).forEach((groupId) => {
                if (nextGroupsById.has(groupId)) {
                    nextGroups.push(groupId);
                }
            });

            (Array.isArray(runtime.state?.ungrouped) ? runtime.state.ungrouped : []).forEach((storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveCurrentSourceKey(storedKey, sourceRecord);
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
                const resolvedKey = resolveCurrentSourceKey(storedKey, sourceRecord);
                if (!resolvedKey || nextSourceStateById.has(resolvedKey)) return;
                nextSourceStateById.set(resolvedKey, sourceRecord);
            });

            previousState.sourceTagsById.forEach((tagIds, storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveCurrentSourceKey(storedKey, sourceRecord);
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
            const rawToSafeTagId = new Map();
            const safeTagIds = new Set();
            const nextTagOrder = [];

            const registerTag = (tagId) => {
                if (!tagId || rawToSafeTagId.has(tagId)) return;
                const rawTag = rawTagsById[tagId];
                const label = normalizeTagLabel(rawTag && (rawTag.label || rawTag.title || rawTag.name || ''));
                if (!label) return;
                const safeTagId = createSafeTagId(tagId, safeTagIds);
                rawToSafeTagId.set(tagId, safeTagId);
                nextTagOrder.push(safeTagId);
                nextTagsById.set(safeTagId, {
                    id: safeTagId,
                    label,
                    color: normalizeTagColor(rawTag && rawTag.color)
                });
            };

            preferredOrder.forEach(registerTag);
            Object.keys(rawTagsById).forEach(registerTag);

            return { nextTagsById, nextTagOrder, rawToSafeTagId };
        }

        function buildResolvedSourceTagsById(sourceLookup, loadedState, rawToSafeTagId = null) {
            const resolvedSourceTags = new Map();
            if (!loadedState || !loadedState.sourceTagsById) return resolvedSourceTags;

            Object.entries(loadedState.sourceTagsById).forEach(([storedKey, rawTagIds]) => {
                const sourceRecord = loadedState.sourceStateById ? loadedState.sourceStateById[storedKey] : null;
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || resolvedSourceTags.has(resolvedKey)) return;

                resolvedSourceTags.set(
                    resolvedKey,
                    Array.from(new Set((Array.isArray(rawTagIds) ? rawTagIds : [])
                        .map((tagId) => rawToSafeTagId?.get?.(tagId) || tagId)
                        .filter((tagId) => rawToSafeTagId ? rawToSafeTagIdHasValue(rawToSafeTagId, tagId) : Boolean(tagId))))
                );
            });

            return resolvedSourceTags;
        }

        function rawToSafeTagIdHasValue(rawToSafeTagId, safeTagId) {
            if (!safeTagId) return false;
            for (const value of rawToSafeTagId.values()) {
                if (value === safeTagId) return true;
            }
            return false;
        }

        function createSafeTagId(rawTagId, usedTagIds) {
            const rawText = String(rawTagId || '').trim();
            const safePattern = /^[A-Za-z0-9_-]{1,80}$/;
            const sanitizedText = rawText
                .replace(/[^A-Za-z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 80);
            const base = safePattern.test(rawText)
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
                    if (child.type === 'group' && appendGroupChildIfAcyclic(nextGroupsById, groupId, child.id)) {
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

        function hasGroupPathToTarget(groupsById, startGroupId, targetGroupId) {
            if (!startGroupId || !targetGroupId || startGroupId === targetGroupId) return true;
            const stack = [startGroupId];
            const visited = new Set();

            while (stack.length > 0) {
                const groupId = stack.pop();
                if (!groupId || visited.has(groupId)) continue;
                if (groupId === targetGroupId) return true;
                visited.add(groupId);

                const group = groupsById.get(groupId);
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'group' && child.id && !visited.has(child.id)) {
                        stack.push(child.id);
                    }
                });
            }

            return false;
        }

        function appendGroupChildIfAcyclic(groupsById, parentGroupId, childGroupId) {
            const parentGroup = groupsById.get(parentGroupId);
            if (!parentGroup || !childGroupId || childGroupId === parentGroupId || !groupsById.has(childGroupId)) {
                return false;
            }
            if (hasGroupPathToTarget(groupsById, childGroupId, parentGroupId)) {
                return false;
            }
            parentGroup.children.push({ type: 'group', id: childGroupId });
            return true;
        }

        return {
            buildSourceLookup,
            buildSourceMatchReport,
            resolveStoredSourceKey,
            resolveStoredSourceKeyWithReason,
            applySourceRemapsToSnapshot,
            collectPersistedSourceRefs,
            snapshotExistingSourceRecords,
            buildSingleSourcePositionalRemap,
            remapExistingStateToCurrentSources,
            buildResolvedSourceStateById,
            buildNormalizedTagState,
            buildResolvedSourceTagsById,
            reconcilePersistedTree,
            appendGroupChildIfAcyclic
        };
    }

    globalThis.NSM_CREATE_CONTENT_STATE_RECONCILE = createContentStateReconcile;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentStateReconcile;
    }
})();
