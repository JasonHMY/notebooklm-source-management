(function () {
    'use strict';

    /**
     * createContentStateReconcile(deps) — 持久化 snapshot ↔ live NotebookLM 源列表的对账层。
     * NotebookLM 重启或重新加载后 source key 可能变动(legacy key 老化 / stableToken 变形 /
     * 同标题多源),这一层负责把存盘的 sourceKey 映射回当前活的 sourceKey:
     *  - `buildSourceLookup` 一次性建索引(byId, byLegacyKey, byElement WeakMap, 多 bucket maps),
     *    再衍生 `uniqueByStableToken/Fingerprint/Title` 用于唯一匹配。
     *  - `resolveStoredSourceKey` / `resolveStoredSourceKeyWithReason` 按优先级 stableToken →
     *    legacy → fingerprint → title 匹配;reason 形如 'matched_by_stable_token' /
     *    'unresolved' / 'duplicate_title' 便于诊断。
     *  - `applySourceRemapsToSnapshot` 用 remap map 重写 snapshot 的 sourceStateById /
     *    sourceTagsById / groups children / ungrouped。
     *  - `reconcilePersistedTree` 是顶层入口:只负责 source-key remap,再把候选树交给
     *    Tree Placement 做 cycle/duplicate/reachability/orphan normalization。
     *
     * @param {Object} deps Required: normalizeSourceText, normalizeTagLabel, normalizeTagColor,
     *   treePlacement.normalizePlacementState. Optional: runtime(从 deps.runtime 或 deps 自身回退)。
     * @returns {Object} 对账 helpers —
     *   - 源 lookup / 匹配:buildSourceLookup, buildSourceMatchReport, resolveStoredSourceKey,
     *     resolveStoredSourceKeyWithReason
     *   - Snapshot remap:applySourceRemapsToSnapshot, collectPersistedSourceRefs,
     *     snapshotExistingSourceRecords, buildSingleSourcePositionalRemap,
     *     remapExistingStateToCurrentSources
     *   - 解析后状态:buildResolvedSourceStateById, buildResolvedSourceTagsById,
     *     buildNormalizedTagState
     *   - 树归一:reconcilePersistedTree
     */
    function createContentStateReconcile(deps = {}) {
        const {
            normalizeSourceText,
            normalizeTagLabel,
            normalizeTagColor,
            treePlacement
        } = deps;
        const runtime = deps.runtime || deps;
        const normalizePlacementState = treePlacement?.normalizePlacementState;

        if (typeof normalizePlacementState !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentStateReconcile requires Tree Placement normalization.');
        }

        function getOwnRecordValue(recordMap, key) {
            if (
                !recordMap
                || (typeof recordMap !== 'object' && typeof recordMap !== 'function')
                || !Object.prototype.hasOwnProperty.call(recordMap, key)
            ) {
                return null;
            }
            return recordMap[key];
        }

        function getOwnFieldValue(record, key, fallbackValue = undefined) {
            if (
                !record
                || (typeof record !== 'object' && typeof record !== 'function')
                || !Object.prototype.hasOwnProperty.call(record, key)
            ) {
                return fallbackValue;
            }
            return record[key];
        }

        function setOwnFieldValue(record, key, value) {
            Object.defineProperty(record, key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value
            });
            return value;
        }

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
            return getOwnFieldValue(sourceRecord, 'stableToken', '')
                || extractStableTokenFromSourceKey(storedKey);
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

            const stableToken = getOwnFieldValue(sourceRecord, 'stableToken', '');
            if (stableToken && sourceLookup.uniqueByStableToken.has(stableToken)) {
                return createResolvedSourceKey(sourceLookup.uniqueByStableToken.get(stableToken), 'stable-token');
            }

            const fingerprint = getOwnFieldValue(sourceRecord, 'fingerprint', '');
            if (fingerprint && sourceLookup.uniqueByFingerprint.has(fingerprint)) {
                const fingerprintKey = sourceLookup.uniqueByFingerprint.get(fingerprint);
                if (canResolveSourceByWeakIdentity(sourceLookup, fingerprintKey, sourceRecord, storedKey)) {
                    return createResolvedSourceKey(fingerprintKey, 'fingerprint');
                }
            }

            const sourceElement = getOwnFieldValue(sourceRecord, 'element', null);
            if (
                sourceElement &&
                sourceLookup.byElement &&
                sourceLookup.byElement.has(sourceElement)
            ) {
                return createResolvedSourceKey(sourceLookup.byElement.get(sourceElement), 'element');
            }

            const normalizedTitle = normalizeSourceText(
                getOwnFieldValue(sourceRecord, 'normalizedTitle', '')
                || getOwnFieldValue(sourceRecord, 'title', '')
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
            const rawGroupsById = getOwnFieldValue(snapshot, 'groupsById', {});
            const groupsById = rawGroupsById && typeof rawGroupsById === 'object'
                ? rawGroupsById
                : {};
            const visitedGroups = new Set();
            const pendingEntries = Object.keys(groupsById)
                .reverse()
                .map((groupId) => ({ type: 'group', id: groupId }));
            while (pendingEntries.length > 0) {
                const entry = pendingEntries.pop();
                const entryType = getOwnFieldValue(entry, 'type');
                const sourceKey = getOwnFieldValue(entry, 'key');
                const groupId = getOwnFieldValue(entry, 'id');
                if (entryType === 'source') {
                    if (sourceKey) refs.add(sourceKey);
                    continue;
                }
                if (
                    entryType !== 'group'
                    || !groupId
                    || visitedGroups.has(groupId)
                    || !Object.prototype.hasOwnProperty.call(groupsById, groupId)
                ) {
                    continue;
                }
                visitedGroups.add(groupId);
                const group = groupsById[groupId];
                const rawChildren = getOwnFieldValue(group, 'children', []);
                const children = Array.isArray(rawChildren) ? rawChildren : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    pendingEntries.push(children[index]);
                }
            }
            const rawRoot = getOwnFieldValue(snapshot, 'root', []);
            (Array.isArray(rawRoot) ? rawRoot : []).forEach((entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const sourceKey = getOwnFieldValue(entry, 'key');
                if (entryType === 'source' && sourceKey) refs.add(sourceKey);
            });
            const rawUngrouped = getOwnFieldValue(snapshot, 'ungrouped', []);
            (Array.isArray(rawUngrouped) ? rawUngrouped : []).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            const rawSourceStateById = getOwnFieldValue(snapshot, 'sourceStateById', {});
            Object.keys(
                rawSourceStateById && typeof rawSourceStateById === 'object'
                    ? rawSourceStateById
                    : {}
            ).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            const rawSourceTagsById = getOwnFieldValue(snapshot, 'sourceTagsById', {});
            Object.keys(
                rawSourceTagsById && typeof rawSourceTagsById === 'object'
                    ? rawSourceTagsById
                    : {}
            ).forEach((sourceKey) => {
                if (sourceKey) refs.add(sourceKey);
            });
            return refs;
        }

        function getSourceRepairTitle(sourceRecord, storedKey) {
            return String(
                getOwnFieldValue(sourceRecord, 'title', '') ||
                getOwnFieldValue(sourceRecord, 'normalizedTitle', '') ||
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

            const stableToken = getOwnFieldValue(sourceRecord, 'stableToken', '');
            if (stableToken) {
                addSourceCandidateBucket(
                    candidates,
                    seenKeys,
                    sourceLookup,
                    sourceLookup.stableTokenBuckets?.get?.(stableToken),
                    'stable-token'
                );
            }

            const fingerprint = getOwnFieldValue(sourceRecord, 'fingerprint', '');
            if (fingerprint) {
                addSourceCandidateBucket(
                    candidates,
                    seenKeys,
                    sourceLookup,
                    sourceLookup.fingerprintBuckets?.get?.(fingerprint),
                    'fingerprint'
                );
            }

            const normalizedTitle = normalizeSourceText(
                getOwnFieldValue(sourceRecord, 'normalizedTitle', '')
                || getOwnFieldValue(sourceRecord, 'title', '')
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
                const sourceRecord = getOwnRecordValue(snapshot?.sourceStateById, storedKey);
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
            const rawGroupsById = getOwnFieldValue(clonedSnapshot, 'groupsById', {});
            const groupsById = rawGroupsById && typeof rawGroupsById === 'object'
                ? rawGroupsById
                : {};

            Object.values(groupsById).forEach((group) => {
                const rawChildren = getOwnFieldValue(group, 'children');
                if (!group || typeof group !== 'object' || !Array.isArray(rawChildren)) return;
                const remappedChildren = rawChildren
                    .map((child) => {
                        const childType = getOwnFieldValue(child, 'type');
                        const childKey = getOwnFieldValue(child, 'key');
                        return childType === 'source'
                            ? { ...child, key: mapSourceKey(childKey) }
                            : child;
                    })
                    .filter((child) => (
                        getOwnFieldValue(child, 'type') !== 'source'
                        || Boolean(getOwnFieldValue(child, 'key'))
                    ));
                setOwnFieldValue(group, 'children', remappedChildren);
            });

            // Preserve every remapped placement candidate. Reachability-aware de-duplication
            // belongs to Tree Placement; doing it here would let an unreachable group that
            // happens to appear first in object order steal a source from its reachable group.
            const rawRoot = getOwnFieldValue(clonedSnapshot, 'root', []);
            const remappedRoot = (Array.isArray(rawRoot) ? rawRoot : [])
                .map((entry) => (
                    getOwnFieldValue(entry, 'type') === 'source'
                        ? {
                            ...entry,
                            key: mapSourceKey(getOwnFieldValue(entry, 'key'))
                        }
                        : entry
                ))
                .filter((entry) => (
                    getOwnFieldValue(entry, 'type') !== 'source'
                    || Boolean(getOwnFieldValue(entry, 'key'))
                ));
            setOwnFieldValue(clonedSnapshot, 'root', remappedRoot);

            const rawUngrouped = getOwnFieldValue(clonedSnapshot, 'ungrouped', []);
            setOwnFieldValue(
                clonedSnapshot,
                'ungrouped',
                (Array.isArray(rawUngrouped) ? rawUngrouped : [])
                    .map(mapSourceKey)
                    .filter(Boolean)
            );

            const rawSourceStateById = getOwnFieldValue(clonedSnapshot, 'sourceStateById', {});
            const sourceStateById = rawSourceStateById && typeof rawSourceStateById === 'object'
                ? rawSourceStateById
                : {};
            const nextSourceStateById = new Map();
            Object.entries(sourceStateById).forEach(([sourceKey, sourceRecord]) => {
                if (sourceRemaps.has(sourceKey)) return;
                nextSourceStateById.set(sourceKey, sourceRecord);
            });
            Object.entries(sourceStateById).forEach(([sourceKey, sourceRecord]) => {
                if (!sourceRemaps.has(sourceKey)) return;
                nextSourceStateById.set(mapSourceKey(sourceKey), sourceRecord);
            });
            setOwnFieldValue(
                clonedSnapshot,
                'sourceStateById',
                Object.fromEntries(nextSourceStateById)
            );

            const rawSourceTagsById = getOwnFieldValue(clonedSnapshot, 'sourceTagsById', {});
            const sourceTagsById = rawSourceTagsById && typeof rawSourceTagsById === 'object'
                ? rawSourceTagsById
                : {};
            const nextSourceTagsById = new Map();
            const mergeTagIds = (targetSourceKey, tagIds) => {
                if (!targetSourceKey) return;
                const currentTagIds = nextSourceTagsById.get(targetSourceKey);
                const nextTagIds = new Set(Array.isArray(currentTagIds)
                    ? currentTagIds
                    : []);
                (Array.isArray(tagIds) ? tagIds : []).forEach((tagId) => {
                    if (tagId) nextTagIds.add(tagId);
                });
                if (nextTagIds.size > 0) {
                    nextSourceTagsById.set(targetSourceKey, Array.from(nextTagIds));
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
            setOwnFieldValue(
                clonedSnapshot,
                'sourceTagsById',
                Object.fromEntries(nextSourceTagsById)
            );

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

        function collectStoredSourceKeysByPlacementPriority(treeState) {
            const orderedKeys = [];
            const seenStoredKeys = new Set();
            const visitedGroupIds = new Set();
            const groupsById = treeState?.groupsById instanceof Map
                ? treeState.groupsById
                : new Map(Object.entries(treeState?.groupsById || {}));
            const appendSourceKey = (storedKey) => {
                if (
                    typeof storedKey !== 'string'
                    || !storedKey
                    || seenStoredKeys.has(storedKey)
                ) {
                    return;
                }
                seenStoredKeys.add(storedKey);
                orderedKeys.push(storedKey);
            };
            const rootEntries = Array.isArray(treeState?.root)
                ? treeState.root
                : (Array.isArray(treeState?.groups)
                    ? treeState.groups.map((id) => ({ type: 'group', id }))
                    : []);
            const pendingEntries = [...rootEntries].reverse();
            while (pendingEntries.length > 0) {
                const entry = pendingEntries.pop();
                const entryType = getOwnFieldValue(entry, 'type');
                const sourceKey = getOwnFieldValue(entry, 'key');
                const groupId = getOwnFieldValue(entry, 'id');
                if (entryType === 'source') {
                    appendSourceKey(sourceKey);
                    continue;
                }
                if (
                    entryType !== 'group'
                    || !groupId
                    || visitedGroupIds.has(groupId)
                    || !groupsById.has(groupId)
                ) {
                    continue;
                }
                visitedGroupIds.add(groupId);
                const group = groupsById.get(groupId);
                const rawChildren = getOwnFieldValue(group, 'children', []);
                const children = Array.isArray(rawChildren) ? rawChildren : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    pendingEntries.push(children[index]);
                }
            }
            (Array.isArray(treeState?.ungrouped) ? treeState.ungrouped : [])
                .forEach(appendSourceKey);
            return orderedKeys;
        }

        function remapExistingStateToCurrentSources(sourceLookup, previousState) {
            const nextRoot = [];
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
                    const childType = getOwnFieldValue(child, 'type');
                    const childGroupId = getOwnFieldValue(child, 'id');
                    const childSourceKey = getOwnFieldValue(child, 'key');
                    if (childType === 'group' && typeof childGroupId === 'string' && childGroupId) {
                        nextGroup.children.push({ type: 'group', id: childGroupId });
                        return;
                    }

                    if (childType !== 'source') return;

                    const sourceRecord = previousState.sourceRecordsByKey.get(childSourceKey) || null;
                    const resolvedKey = resolveCurrentSourceKey(childSourceKey, sourceRecord);
                    if (!resolvedKey) return;

                    nextGroup.children.push({ type: 'source', key: resolvedKey });
                    seenSourceRefs.add(resolvedKey);

                });
            });

            // v5: preserve the heterogeneous root order (root groups + positioned root
            // sources) from the live runtime state, re-resolving source keys to current rows.
            (Array.isArray(runtime.state?.root) ? runtime.state.root : []).forEach((entry) => {
                if (!entry) return;
                const entryType = getOwnFieldValue(entry, 'type');
                const groupId = getOwnFieldValue(entry, 'id');
                const sourceKey = getOwnFieldValue(entry, 'key');
                if (entryType === 'group') {
                    if (groupId && nextGroupsById.has(groupId)) {
                        nextRoot.push({ type: 'group', id: groupId });
                    }
                    return;
                }
                if (entryType !== 'source') return;

                const sourceRecord = previousState.sourceRecordsByKey.get(sourceKey) || null;
                const resolvedKey = resolveCurrentSourceKey(sourceKey, sourceRecord);
                if (!resolvedKey) return;

                nextRoot.push({ type: 'source', key: resolvedKey });
                seenSourceRefs.add(resolvedKey);

            });

            (Array.isArray(runtime.state?.ungrouped) ? runtime.state.ungrouped : []).forEach((storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveCurrentSourceKey(storedKey, sourceRecord);
                if (!resolvedKey) return;

                nextUngrouped.push(resolvedKey);
                seenSourceRefs.add(resolvedKey);

            });

            collectStoredSourceKeysByPlacementPriority({
                root: runtime.state?.root,
                groups: runtime.state?.groups,
                groupsById: runtime.groupsById,
                ungrouped: runtime.state?.ungrouped
            }).forEach((storedKey) => {
                const sourceRecord = previousState.sourceRecordsByKey.get(storedKey) || null;
                const resolvedKey = resolveCurrentSourceKey(storedKey, sourceRecord);
                if (!resolvedKey) return;
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
                root: nextRoot,
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
            const preferredStoredKeys = collectStoredSourceKeysByPlacementPriority(loadedState);
            const registerSourceState = (storedKey, sourceRecord) => {
                if (
                    !sourceRecord
                    || typeof sourceRecord !== 'object'
                    || Array.isArray(sourceRecord)
                ) {
                    return;
                }
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (resolvedKey && !resolvedSourceState.has(resolvedKey)) {
                    resolvedSourceState.set(resolvedKey, sourceRecord);
                }
            };

            if (loadedState.sourceStateById) {
                preferredStoredKeys.forEach((storedKey) => {
                    if (Object.prototype.hasOwnProperty.call(loadedState.sourceStateById, storedKey)) {
                        registerSourceState(storedKey, loadedState.sourceStateById[storedKey]);
                    }
                });
                Object.entries(loadedState.sourceStateById).forEach(([storedKey, sourceRecord]) => {
                    registerSourceState(storedKey, sourceRecord);
                });
                return resolvedSourceState;
            }

            if (loadedState.legacyEnabledMap) {
                preferredStoredKeys.forEach((storedKey) => {
                    if (Object.prototype.hasOwnProperty.call(loadedState.legacyEnabledMap, storedKey)) {
                        registerSourceState(storedKey, {
                            enabled: Boolean(loadedState.legacyEnabledMap[storedKey])
                        });
                    }
                });
                Object.entries(loadedState.legacyEnabledMap).forEach(([legacyKey, enabled]) => {
                    registerSourceState(legacyKey, { enabled: Boolean(enabled) });
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
                if (
                    !tagId
                    || rawToSafeTagId.has(tagId)
                    || !Object.prototype.hasOwnProperty.call(rawTagsById, tagId)
                ) {
                    return;
                }
                const rawTag = rawTagsById[tagId];
                if (!rawTag || typeof rawTag !== 'object' || Array.isArray(rawTag)) return;
                const label = normalizeTagLabel(
                    getOwnFieldValue(rawTag, 'label', '')
                    || getOwnFieldValue(rawTag, 'title', '')
                    || getOwnFieldValue(rawTag, 'name', '')
                );
                if (!label) return;
                const safeTagId = createSafeTagId(tagId, safeTagIds);
                rawToSafeTagId.set(tagId, safeTagId);
                nextTagOrder.push(safeTagId);
                nextTagsById.set(safeTagId, {
                    id: safeTagId,
                    label,
                    color: normalizeTagColor(getOwnFieldValue(rawTag, 'color', ''))
                });
            };

            preferredOrder.forEach(registerTag);
            Object.keys(rawTagsById).forEach(registerTag);

            return { nextTagsById, nextTagOrder, rawToSafeTagId };
        }

        function buildResolvedSourceTagsById(sourceLookup, loadedState, rawToSafeTagId = null) {
            const resolvedSourceTags = new Map();
            if (!loadedState || !loadedState.sourceTagsById) return resolvedSourceTags;

            const registerSourceTags = (storedKey, rawTagIds) => {
                const sourceRecord = getOwnRecordValue(loadedState.sourceStateById, storedKey);
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey || resolvedSourceTags.has(resolvedKey)) return;

                resolvedSourceTags.set(
                    resolvedKey,
                    Array.from(new Set((Array.isArray(rawTagIds) ? rawTagIds : [])
                        .map((tagId) => rawToSafeTagId?.get?.(tagId) || tagId)
                        .filter((tagId) => rawToSafeTagId ? rawToSafeTagIdHasValue(rawToSafeTagId, tagId) : Boolean(tagId))))
                );
            };
            collectStoredSourceKeysByPlacementPriority(loadedState).forEach((storedKey) => {
                if (Object.prototype.hasOwnProperty.call(loadedState.sourceTagsById, storedKey)) {
                    registerSourceTags(storedKey, loadedState.sourceTagsById[storedKey]);
                }
            });
            Object.entries(loadedState.sourceTagsById).forEach(([storedKey, rawTagIds]) => {
                registerSourceTags(storedKey, rawTagIds);
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
            const rawGroupsById = loadedState && loadedState.groupsById ? loadedState.groupsById : {};
            const liveSourceKeys = new Set(
                Array.isArray(sourceLookup?.orderedKeys)
                    ? sourceLookup.orderedKeys
                    : Array.from(sourceLookup?.sourceByKey?.keys?.() || [])
            );

            Object.entries(rawGroupsById).forEach(([groupId, rawGroup]) => {
                nextGroupsById.set(groupId, {
                    ...rawGroup,
                    id: groupId,
                    enabled: getOwnFieldValue(rawGroup, 'enabled', undefined) !== undefined
                        ? getOwnFieldValue(rawGroup, 'enabled')
                        : true,
                    collapsed: getOwnFieldValue(rawGroup, 'collapsed', false) === true,
                    children: []
                });
            });

            Object.entries(rawGroupsById).forEach(([groupId, rawGroup]) => {
                const nextGroup = nextGroupsById.get(groupId);
                if (!nextGroup) return;

                const rawChildren = getOwnFieldValue(rawGroup, 'children', []);
                (Array.isArray(rawChildren) ? rawChildren : []).forEach((child) => {
                    const childType = getOwnFieldValue(child, 'type');
                    const childGroupId = getOwnFieldValue(child, 'id');
                    const childSourceKey = getOwnFieldValue(child, 'key');
                    if (childType === 'group' && typeof childGroupId === 'string' && childGroupId) {
                        nextGroup.children.push({ type: 'group', id: childGroupId });
                        return;
                    }

                    if (childType !== 'source') return;

                    const sourceRecord = getOwnRecordValue(
                        loadedState && loadedState.sourceStateById,
                        childSourceKey
                    );
                    const resolvedKey = resolveStoredSourceKey(
                        childSourceKey,
                        sourceLookup,
                        sourceRecord
                    );
                    if (!resolvedKey) return;

                    nextGroup.children.push({ type: 'source', key: resolvedKey });
                });
            });

            // v5: rebuild the heterogeneous root order ({type:'group'|'source'}) from
            // loadedState.root, preserving positioned root sources. Defensive fallback to
            // the legacy state.groups (root group ids) when an un-migrated shape slips in.
            const nextRoot = [];
            const rawRootEntries = Array.isArray(loadedState && loadedState.root)
                ? loadedState.root
                : (Array.isArray(loadedState && loadedState.groups)
                    ? loadedState.groups.map((id) => ({ type: 'group', id }))
                    : []);
            rawRootEntries.forEach((entry) => {
                if (!entry) return;
                const entryType = getOwnFieldValue(entry, 'type');
                const groupId = getOwnFieldValue(entry, 'id');
                const sourceKey = getOwnFieldValue(entry, 'key');
                if (entryType === 'group') {
                    if (groupId && nextGroupsById.has(groupId)) {
                        nextRoot.push({ type: 'group', id: groupId });
                    }
                    return;
                }
                if (entryType === 'source') {
                    const sourceRecord = getOwnRecordValue(
                        loadedState && loadedState.sourceStateById,
                        sourceKey
                    );
                    const resolvedKey = resolveStoredSourceKey(
                        sourceKey,
                        sourceLookup,
                        sourceRecord
                    );
                    if (!resolvedKey) return;
                    nextRoot.push({ type: 'source', key: resolvedKey });
                }
            });
            const nextUngrouped = [];

            (Array.isArray(loadedState && loadedState.ungrouped) ? loadedState.ungrouped : []).forEach((storedKey) => {
                const sourceRecord = getOwnRecordValue(
                    loadedState && loadedState.sourceStateById,
                    storedKey
                );
                const resolvedKey = resolveStoredSourceKey(storedKey, sourceLookup, sourceRecord);
                if (!resolvedKey) return;

                nextUngrouped.push(resolvedKey);
            });

            const normalized = normalizePlacementState({
                state: {
                    ...(loadedState && typeof loadedState === 'object' ? loadedState : {}),
                    root: nextRoot,
                    ungrouped: nextUngrouped
                },
                groupsById: nextGroupsById,
                liveSourceKeys
            });
            if (!normalized?.ok) {
                return {
                    ok: false,
                    reason: normalized?.reason || 'invalid_model',
                    root: [],
                    groupsById: new Map(),
                    ungrouped: [],
                    seenSourceRefs: new Set()
                };
            }

            return {
                ok: true,
                root: normalized.state.root,
                groupsById: normalized.groupsById,
                ungrouped: normalized.state.ungrouped,
                seenSourceRefs: new Set(normalized.liveSourceKeys),
                normalization: normalized
            };
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
            reconcilePersistedTree
        };
    }

    globalThis.NSM_CREATE_CONTENT_STATE_RECONCILE = createContentStateReconcile;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentStateReconcile;
    }
})();
