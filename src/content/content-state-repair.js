(function () {
    'use strict';

    /**
     * createContentStateRepair(deps) — 持久化 snapshot 的结构性修复候选搜索。
     * 当 current state 比 backup / history 更"贫瘠"(分组里的 source 更少 + 同 groupId
     * 缺失但 title 同名)时,从备份和历史里找一个 superset candidate,合并出一个
     * `{ groups, groupsById, sourceStateById merged with current preference, recomputed ungrouped }`
     * 修复后的 snapshot。优先级:groupedSourceKeys 数量大 + 最新 revision。
     *
     * @param {Object} deps Optional (全部有默认): cloneSerializableData (深克隆), hasRestorableStateSnapshot,
     *   getMapLikeEntries, normalizeStateHistoryEntries, getSnapshotSaveRevision.
     * @returns {{ collectSnapshotGroupedSourceKeys, getSnapshotGroupInfo, isCompatibleStructuralRepairCandidate, createStructurallyRepairedState, findStructuralRepairCandidate }}
     *   `findStructuralRepairCandidate(current, backup, historyEntries)` 没找到时返回 null;
     *   `createStructurallyRepairedState(current, candidate)` 保留 current 的 customHeight /
     *   _saveRevision / _savedAt 不被覆盖。
     */
    function createContentStateRepair(deps = {}) {
        const cloneSerializableData = typeof deps.cloneSerializableData === 'function'
            ? deps.cloneSerializableData
            : (value) => {
                if (value == null) return value;
                if (typeof globalThis.structuredClone === 'function') {
                    try {
                        return globalThis.structuredClone(value);
                    } catch (error) {
                        // Fall through to JSON cloning for plain persisted state objects.
                    }
                }
                try {
                    return JSON.parse(JSON.stringify(value));
                } catch (error) {
                    return value;
                }
            };
        const hasRestorableStateSnapshot = typeof deps.hasRestorableStateSnapshot === 'function'
            ? deps.hasRestorableStateSnapshot
            : () => false;
        const getMapLikeEntries = typeof deps.getMapLikeEntries === 'function'
            ? deps.getMapLikeEntries
            : (value) => {
                if (value instanceof Map) return Array.from(value.entries());
                if (value && typeof value === 'object') return Object.entries(value);
                return [];
            };
        const normalizeStateHistoryEntries = typeof deps.normalizeStateHistoryEntries === 'function'
            ? deps.normalizeStateHistoryEntries
            : (entries) => (Array.isArray(entries) ? entries : []);
        const getSnapshotSaveRevision = typeof deps.getSnapshotSaveRevision === 'function'
            ? deps.getSnapshotSaveRevision
            : (snapshot) => {
                const revision = Number(snapshot?._saveRevision);
                return Number.isFinite(revision) && revision > 0 ? revision : 0;
            };

        function collectSnapshotGroupedSourceKeys(snapshot) {
            const result = new Set();
            const groupsById = snapshot?.groupsById && typeof snapshot.groupsById === 'object'
                ? snapshot.groupsById
                : {};
            // v5: root order is snapshot.root ({type:'group'|'source'}); legacy snapshots
            // may still carry a flat groups id list. Only folder entries hold grouped sources.
            const rootEntries = Array.isArray(snapshot?.root)
                ? snapshot.root
                : (Array.isArray(snapshot?.groups) ? snapshot.groups.map((id) => ({ type: 'group', id })) : []);
            const visitedGroups = new Set();
            const stack = [];
            for (let index = rootEntries.length - 1; index >= 0; index -= 1) {
                const entry = rootEntries[index];
                if (entry?.type === 'group' && entry.id) {
                    stack.push({ kind: 'group', id: entry.id });
                }
            }
            while (stack.length > 0) {
                const task = stack.pop();
                if (task.kind === 'source') {
                    result.add(task.key);
                    continue;
                }
                if (!task.id || visitedGroups.has(task.id)) continue;
                visitedGroups.add(task.id);
                const group = groupsById[task.id];
                const children = Array.isArray(group?.children) ? group.children : [];
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    const child = children[index];
                    if (child?.type === 'source' && child.key) {
                        stack.push({ kind: 'source', key: child.key });
                    } else if (child?.type === 'group' && child.id) {
                        stack.push({ kind: 'group', id: child.id });
                    }
                }
            }
            return result;
        }

        function getSnapshotGroupInfo(snapshot) {
            const groupsById = snapshot?.groupsById && typeof snapshot.groupsById === 'object'
                ? snapshot.groupsById
                : {};
            const groupIds = new Set();
            const titleCounts = new Map();

            getMapLikeEntries(groupsById).forEach(([groupId, group]) => {
                if (groupId) groupIds.add(groupId);
                const title = String(group?.title || '').trim();
                if (title) {
                    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
                }
            });

            return {
                groupIds,
                titleCounts,
                groupedSourceKeys: collectSnapshotGroupedSourceKeys(snapshot)
            };
        }

        function isCompatibleStructuralRepairCandidate(currentState, candidateState) {
            if (!hasRestorableStateSnapshot(currentState) || !hasRestorableStateSnapshot(candidateState)) {
                return false;
            }

            const currentInfo = getSnapshotGroupInfo(currentState);
            const candidateInfo = getSnapshotGroupInfo(candidateState);
            if (candidateInfo.groupedSourceKeys.size <= currentInfo.groupedSourceKeys.size) {
                return false;
            }
            if (candidateInfo.groupIds.size === 0 || currentInfo.groupIds.size === 0) {
                return false;
            }

            const missingGroupIds = Array.from(candidateInfo.groupIds)
                .filter((groupId) => !currentInfo.groupIds.has(groupId));
            if (missingGroupIds.length > 0) {
                const currentTitles = new Map(currentInfo.titleCounts);
                const hasSameTitles = Array.from(candidateInfo.titleCounts.entries()).every(([title, count]) => (
                    (currentTitles.get(title) || 0) >= count
                ));
                if (!hasSameTitles) return false;
            }

            const currentSourceKeys = new Set(getMapLikeEntries(currentState.sourceStateById || {}).map(([sourceKey]) => sourceKey));
            const candidateSourceKeys = new Set(getMapLikeEntries(candidateState.sourceStateById || {}).map(([sourceKey]) => sourceKey));
            return Array.from(candidateInfo.groupedSourceKeys).every((sourceKey) => (
                currentSourceKeys.has(sourceKey) || candidateSourceKeys.has(sourceKey)
            ));
        }

        function createStructurallyRepairedState(currentState, candidateState) {
            const repairedState = cloneSerializableData(currentState || {});
            // v5: take the candidate's heterogeneous root order (legacy fallback to groups).
            const candidateRoot = Array.isArray(candidateState?.root)
                ? candidateState.root
                : (Array.isArray(candidateState?.groups) ? candidateState.groups.map((id) => ({ type: 'group', id })) : []);
            const candidateGroupsById = candidateState?.groupsById && typeof candidateState.groupsById === 'object'
                ? candidateState.groupsById
                : {};
            const currentSourceState = currentState?.sourceStateById && typeof currentState.sourceStateById === 'object'
                ? currentState.sourceStateById
                : {};
            const candidateSourceState = candidateState?.sourceStateById && typeof candidateState.sourceStateById === 'object'
                ? candidateState.sourceStateById
                : {};

            repairedState.root = cloneSerializableData(candidateRoot);
            delete repairedState.groups;
            repairedState.groupsById = cloneSerializableData(candidateGroupsById);
            repairedState.sourceStateById = Object.assign(
                {},
                cloneSerializableData(candidateSourceState),
                cloneSerializableData(currentSourceState)
            );

            const groupedSourceKeys = collectSnapshotGroupedSourceKeys(repairedState);
            // v5: positioned root sources already live in repairedState.root — don't also
            // sweep them into the bin (that would duplicate the key across both lists).
            const positionedRootSourceKeys = new Set(
                (Array.isArray(repairedState.root) ? repairedState.root : [])
                    .filter((entry) => entry && entry.type === 'source' && entry.key)
                    .map((entry) => entry.key)
            );
            const nextUngrouped = [];
            const seenUngrouped = new Set();
            const pushUngrouped = (sourceKey) => {
                if (!sourceKey || groupedSourceKeys.has(sourceKey)
                    || positionedRootSourceKeys.has(sourceKey) || seenUngrouped.has(sourceKey)) return;
                nextUngrouped.push(sourceKey);
                seenUngrouped.add(sourceKey);
            };

            (Array.isArray(candidateState?.ungrouped) ? candidateState.ungrouped : []).forEach(pushUngrouped);
            (Array.isArray(currentState?.ungrouped) ? currentState.ungrouped : []).forEach(pushUngrouped);
            getMapLikeEntries(currentSourceState).forEach(([sourceKey]) => pushUngrouped(sourceKey));
            repairedState.ungrouped = nextUngrouped;

            if (currentState && typeof currentState === 'object') {
                if (currentState.customHeight != null) repairedState.customHeight = currentState.customHeight;
                if (currentState._saveRevision != null) repairedState._saveRevision = currentState._saveRevision;
                if (currentState._savedAt != null) repairedState._savedAt = currentState._savedAt;
            }

            return repairedState;
        }

        function findStructuralRepairCandidate(currentState, backupState, historyEntries = []) {
            if (!hasRestorableStateSnapshot(currentState)) return null;
            const candidates = [];

            if (backupState && backupState !== currentState) {
                candidates.push(backupState);
            }

            normalizeStateHistoryEntries(historyEntries).forEach((entry) => {
                if (entry.snapshot) candidates.push(entry.snapshot);
            });

            return candidates
                .filter((candidate) => isCompatibleStructuralRepairCandidate(currentState, candidate))
                .sort((left, right) => {
                    const leftGroupedCount = collectSnapshotGroupedSourceKeys(left).size;
                    const rightGroupedCount = collectSnapshotGroupedSourceKeys(right).size;
                    if (rightGroupedCount !== leftGroupedCount) return rightGroupedCount - leftGroupedCount;
                    return getSnapshotSaveRevision(right) - getSnapshotSaveRevision(left);
                })[0] || null;
        }

        return {
            collectSnapshotGroupedSourceKeys,
            getSnapshotGroupInfo,
            isCompatibleStructuralRepairCandidate,
            createStructurallyRepairedState,
            findStructuralRepairCandidate
        };
    }

    globalThis.NSM_CREATE_CONTENT_STATE_REPAIR = createContentStateRepair;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentStateRepair;
    }
})();
