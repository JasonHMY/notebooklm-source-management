(function () {
    'use strict';

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
            const rootGroupIds = Array.isArray(snapshot?.groups) ? snapshot.groups : [];
            const visitedGroups = new Set();

            const walkGroup = (groupId) => {
                if (!groupId || visitedGroups.has(groupId)) return;
                visitedGroups.add(groupId);
                const group = groupsById[groupId];
                (Array.isArray(group?.children) ? group.children : []).forEach((child) => {
                    if (child?.type === 'source' && child.key) {
                        result.add(child.key);
                    } else if (child?.type === 'group' && child.id) {
                        walkGroup(child.id);
                    }
                });
            };

            rootGroupIds.forEach(walkGroup);
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
            const candidateGroups = Array.isArray(candidateState?.groups) ? candidateState.groups : [];
            const candidateGroupsById = candidateState?.groupsById && typeof candidateState.groupsById === 'object'
                ? candidateState.groupsById
                : {};
            const currentSourceState = currentState?.sourceStateById && typeof currentState.sourceStateById === 'object'
                ? currentState.sourceStateById
                : {};
            const candidateSourceState = candidateState?.sourceStateById && typeof candidateState.sourceStateById === 'object'
                ? candidateState.sourceStateById
                : {};

            repairedState.groups = cloneSerializableData(candidateGroups);
            repairedState.groupsById = cloneSerializableData(candidateGroupsById);
            repairedState.sourceStateById = Object.assign(
                {},
                cloneSerializableData(candidateSourceState),
                cloneSerializableData(currentSourceState)
            );

            const groupedSourceKeys = collectSnapshotGroupedSourceKeys(repairedState);
            const nextUngrouped = [];
            const seenUngrouped = new Set();
            const pushUngrouped = (sourceKey) => {
                if (!sourceKey || groupedSourceKeys.has(sourceKey) || seenUngrouped.has(sourceKey)) return;
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
