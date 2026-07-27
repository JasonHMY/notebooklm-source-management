(function () {
    'use strict';

    /**
     * Pure tree-placement Module.
     *
     * The Interface owns placement validation, planning and atomic commit for source/group
     * moves. It deliberately has no DOM, Chrome, persistence, render or toast dependency;
     * callers provide those effects in their Adapters after a changed result.
     */
    function createContentTreePlacement(deps = {}) {
        const getState = deps.getState;
        const getGroupsById = deps.getGroupsById;

        if (typeof getState !== 'function' || typeof getGroupsById !== 'function') {
            throw new Error(
                'GeminiNotebook-Source-Management: createContentTreePlacement requires getState and getGroupsById.'
            );
        }

        function cloneValue(value) {
            if (Array.isArray(value)) {
                return value.map((entry) => cloneValue(entry));
            }
            if (value instanceof Map) {
                return new Map(Array.from(value.entries(), ([key, entry]) => [
                    key,
                    cloneValue(entry)
                ]));
            }
            if (value instanceof Set) {
                return new Set(Array.from(value, (entry) => cloneValue(entry)));
            }
            if (value && typeof value === 'object') {
                const prototype = Object.getPrototypeOf(value);
                const isPlainRecord = prototype === null
                    || Object.getPrototypeOf(prototype) === null;
                if (isPlainRecord) {
                    return Object.fromEntries(
                        Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])
                    );
                }
            }
            return value;
        }

        function cloneTreeEntry(entry) {
            const entryType = getOwnFieldValue(entry, 'type');
            const sourceKey = getOwnFieldValue(entry, 'key');
            const groupId = getOwnFieldValue(entry, 'id');
            if (entryType === 'source' && typeof sourceKey === 'string' && sourceKey) {
                return { type: 'source', key: sourceKey };
            }
            if (entryType === 'group' && typeof groupId === 'string' && groupId) {
                return { type: 'group', id: groupId };
            }
            return cloneValue(entry);
        }

        function cloneTreeEntries(entries) {
            return (Array.isArray(entries) ? entries : []).map((entry) => cloneTreeEntry(entry));
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

        function hasOwnArrayField(record, key) {
            return Array.isArray(getOwnFieldValue(record, key));
        }

        function cloneGroupRecord(group, fallbackId = '') {
            const clonedValue = cloneValue(group && typeof group === 'object' ? group : {});
            const cloned = clonedValue && typeof clonedValue === 'object'
                ? { ...clonedValue }
                : {};
            if (!getOwnFieldValue(cloned, 'id') && fallbackId) cloned.id = fallbackId;
            cloned.children = cloneTreeEntries(getOwnFieldValue(group, 'children', []));
            return cloned;
        }

        function readGroupsMap(groupsInput) {
            if (groupsInput instanceof Map) return groupsInput;
            if (groupsInput && typeof groupsInput === 'object' && !Array.isArray(groupsInput)) {
                return new Map(Object.entries(groupsInput));
            }
            return null;
        }

        function cloneGroupsMap(groupsInput) {
            const inputMap = readGroupsMap(groupsInput);
            if (!inputMap) return null;
            return new Map(Array.from(inputMap.entries(), ([groupId, group]) => [
                groupId,
                cloneGroupRecord(group, groupId)
            ]));
        }

        function readLiveSourceKeys(value) {
            if (value instanceof Set) return value;
            if (Array.isArray(value)) return new Set(value);
            return null;
        }

        function isValidSourceKey(value) {
            return typeof value === 'string' && value.length > 0;
        }

        function collectReachableGroupIds(state, groupsById) {
            const reachable = new Set();
            const pending = [];
            const rawRoot = getOwnFieldValue(state, 'root', []);
            (Array.isArray(rawRoot) ? rawRoot : []).forEach((entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const groupId = getOwnFieldValue(entry, 'id');
                if (entryType === 'group' && groupsById?.has?.(groupId)) {
                    pending.push(groupId);
                }
            });
            while (pending.length > 0) {
                const groupId = pending.pop();
                if (reachable.has(groupId)) continue;
                reachable.add(groupId);
                const group = groupsById.get(groupId);
                const rawChildren = getOwnFieldValue(group, 'children', []);
                (Array.isArray(rawChildren) ? rawChildren : []).forEach((entry) => {
                    const entryType = getOwnFieldValue(entry, 'type');
                    const childGroupId = getOwnFieldValue(entry, 'id');
                    if (
                        entryType === 'group'
                        && groupsById.has(childGroupId)
                        && !reachable.has(childGroupId)
                    ) {
                        pending.push(childGroupId);
                    }
                });
            }
            return reachable;
        }

        function clonePlacementState(stateInput) {
            const clonedValue = stateInput && typeof stateInput === 'object'
                ? cloneValue(stateInput)
                : {};
            const state = clonedValue && typeof clonedValue === 'object'
                ? { ...clonedValue }
                : {};
            const rawRoot = getOwnFieldValue(stateInput, 'root', []);
            const rawUngrouped = getOwnFieldValue(stateInput, 'ungrouped', []);
            state.root = cloneTreeEntries(rawRoot);
            state.ungrouped = Array.isArray(rawUngrouped)
                ? [...rawUngrouped]
                : [];
            return state;
        }

        function createModel(stateInput, groupsInput) {
            return {
                state: clonePlacementState(stateInput),
                groupsById: cloneGroupsMap(groupsInput) || new Map()
            };
        }

        function getLiveState() {
            const state = getState();
            return state && typeof state === 'object' ? state : null;
        }

        function getLiveGroups() {
            const groupsById = getGroupsById();
            return groupsById instanceof Map ? groupsById : null;
        }

        function getLiveModel() {
            const state = getLiveState();
            const groupsById = getLiveGroups();
            if (!state || !groupsById) return null;
            try {
                return createModel(state, groupsById);
            } catch (error) {
                return null;
            }
        }

        function normalizeItem(item) {
            if (item?.kind === 'source' && typeof item.key === 'string' && item.key) {
                return { kind: 'source', key: item.key };
            }
            if (item?.kind === 'group' && typeof item.id === 'string' && item.id) {
                return { kind: 'group', id: item.id };
            }
            return null;
        }

        function normalizeTarget(target) {
            if (!target || typeof target !== 'object') return null;
            if (!Number.isInteger(target.index) || target.index < 0) return null;
            if (target.container === 'root' || target.container === 'ungrouped') {
                return {
                    container: target.container,
                    index: target.index
                };
            }
            if (
                target.container === 'group'
                && typeof target.groupId === 'string'
                && target.groupId
            ) {
                return {
                    container: 'group',
                    groupId: target.groupId,
                    index: target.index
                };
            }
            return null;
        }

        function itemToEntry(item, container) {
            if (item.kind === 'source') {
                return container === 'ungrouped'
                    ? item.key
                    : { type: 'source', key: item.key };
            }
            return { type: 'group', id: item.id };
        }

        function entryMatchesItem(entry, item, container) {
            if (item.kind === 'source') {
                if (container === 'ungrouped') return entry === item.key;
                return entry?.type === 'source' && entry.key === item.key;
            }
            return container !== 'ungrouped'
                && entry?.type === 'group'
                && entry.id === item.id;
        }

        function cloneLocation(location) {
            if (!location) return null;
            const cloned = {
                container: location.container,
                index: location.index
            };
            if (location.groupId) cloned.groupId = location.groupId;
            return cloned;
        }

        function collectItemLocations(model, item) {
            const locations = [];
            const state = model.state;
            const groupsById = model.groupsById;

            if (item.kind === 'source') {
                groupsById.forEach((group, groupId) => {
                    (Array.isArray(group?.children) ? group.children : []).forEach((entry, index) => {
                        if (entryMatchesItem(entry, item, 'group')) {
                            locations.push({ container: 'group', groupId, index });
                        }
                    });
                });
            }

            (Array.isArray(state.root) ? state.root : []).forEach((entry, index) => {
                if (entryMatchesItem(entry, item, 'root')) {
                    locations.push({ container: 'root', index });
                }
            });

            if (item.kind === 'source') {
                (Array.isArray(state.ungrouped) ? state.ungrouped : []).forEach((entry, index) => {
                    if (entryMatchesItem(entry, item, 'ungrouped')) {
                        locations.push({ container: 'ungrouped', index });
                    }
                });
            } else {
                groupsById.forEach((group, groupId) => {
                    (Array.isArray(group?.children) ? group.children : []).forEach((entry, index) => {
                        if (entryMatchesItem(entry, item, 'group')) {
                            locations.push({ container: 'group', groupId, index });
                        }
                    });
                });
            }

            return locations;
        }

        function locateItem(itemInput) {
            const item = normalizeItem(itemInput);
            const model = item ? getLiveModel() : null;
            if (!item || !model) return null;
            return cloneLocation(collectItemLocations(model, item)[0] || null);
        }

        function getTargetList(model, target) {
            if (target.container === 'root') return model.state.root;
            if (target.container === 'ungrouped') return model.state.ungrouped;
            return model.groupsById.get(target.groupId)?.children || null;
        }

        function locationsShareTarget(location, target) {
            if (!location || location.container !== target.container) return false;
            if (target.container !== 'group') return true;
            return location.groupId === target.groupId;
        }

        function removeItemEverywhere(model, item) {
            model.state.root = (Array.isArray(model.state.root) ? model.state.root : [])
                .filter((entry) => !entryMatchesItem(entry, item, 'root'));

            if (item.kind === 'source') {
                model.state.ungrouped = (
                    Array.isArray(model.state.ungrouped) ? model.state.ungrouped : []
                ).filter((entry) => !entryMatchesItem(entry, item, 'ungrouped'));
            }

            model.groupsById.forEach((group) => {
                group.children = (Array.isArray(group.children) ? group.children : [])
                    .filter((entry) => !entryMatchesItem(entry, item, 'group'));
            });
        }

        function hasGroupPath(groupsById, startGroupId, targetGroupId) {
            if (!startGroupId || !targetGroupId) return false;
            const stack = [startGroupId];
            const visited = new Set();
            while (stack.length > 0) {
                const groupId = stack.pop();
                if (!groupId || visited.has(groupId)) continue;
                if (groupId === targetGroupId) return true;
                visited.add(groupId);
                const group = groupsById.get(groupId);
                (Array.isArray(group?.children) ? group.children : []).forEach((entry) => {
                    if (entry?.type === 'group' && entry.id && !visited.has(entry.id)) {
                        stack.push(entry.id);
                    }
                });
            }
            return false;
        }

        function createDirectionalTargetResult(ok, reason, target = null) {
            return {
                ok: Boolean(ok),
                reason,
                target: target ? normalizeTarget(target) : null
            };
        }

        function getDirectionalLocationKey(item) {
            if (item?.kind === 'source') return `source:${item.key}`;
            if (item?.kind === 'group') return `group:${item.id}`;
            return '';
        }

        function createDirectionalLocationIndex(model) {
            const index = new Map();
            const addLocation = (item, location) => {
                const key = getDirectionalLocationKey(item);
                if (!key) return;
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(location);
            };

            (Array.isArray(model?.state?.root) ? model.state.root : [])
                .forEach((entry, entryIndex) => {
                    if (entry?.type === 'source' && entry.key) {
                        addLocation(
                            { kind: 'source', key: entry.key },
                            { container: 'root', index: entryIndex }
                        );
                    } else if (entry?.type === 'group' && entry.id) {
                        addLocation(
                            { kind: 'group', id: entry.id },
                            { container: 'root', index: entryIndex }
                        );
                    }
                });

            (Array.isArray(model?.state?.ungrouped) ? model.state.ungrouped : [])
                .forEach((sourceKey, entryIndex) => {
                    if (typeof sourceKey === 'string' && sourceKey) {
                        addLocation(
                            { kind: 'source', key: sourceKey },
                            { container: 'ungrouped', index: entryIndex }
                        );
                    }
                });

            model?.groupsById?.forEach?.((group, groupId) => {
                (Array.isArray(group?.children) ? group.children : [])
                    .forEach((entry, entryIndex) => {
                        if (entry?.type === 'source' && entry.key) {
                            addLocation(
                                { kind: 'source', key: entry.key },
                                { container: 'group', groupId, index: entryIndex }
                            );
                        } else if (entry?.type === 'group' && entry.id) {
                            addLocation(
                                { kind: 'group', id: entry.id },
                                { container: 'group', groupId, index: entryIndex }
                            );
                        }
                    });
            });
            return index;
        }

        function getDirectionalLocations(model, item, locationIndex = null) {
            if (locationIndex instanceof Map) {
                return locationIndex.get(getDirectionalLocationKey(item)) || [];
            }
            return collectItemLocations(model, item);
        }

        function resolveDirectionalTargetOnModel(
            model,
            item,
            direction,
            { locationIndex = null, validation = null } = {}
        ) {
            if (!model) {
                return createDirectionalTargetResult(false, 'invalid_model');
            }

            const locations = getDirectionalLocations(model, item, locationIndex);
            if (locations.length === 0) {
                return createDirectionalTargetResult(false, 'not_found');
            }
            if (locations.length !== 1) {
                return createDirectionalTargetResult(false, 'ambiguous');
            }

            const from = locations[0];
            const currentList = getTargetList(model, from);
            if (!Array.isArray(currentList)) {
                return createDirectionalTargetResult(false, 'unavailable');
            }

            let target = null;
            if (direction === 'up') {
                if (from.index <= 0) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                target = {
                    container: from.container,
                    ...(from.container === 'group' ? { groupId: from.groupId } : {}),
                    index: from.index - 1
                };
            } else if (direction === 'down') {
                if (from.index >= currentList.length - 1) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                target = {
                    container: from.container,
                    ...(from.container === 'group' ? { groupId: from.groupId } : {}),
                    // Placement targets use the pre-removal slot. Skipping over the next
                    // sibling therefore needs two raw slots; planning adjusts it back by one.
                    index: from.index + 2
                };
            } else if (direction === 'in') {
                if (from.container === 'ungrouped' || from.index <= 0) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                const previousEntry = currentList[from.index - 1];
                if (
                    previousEntry?.type !== 'group'
                    || typeof previousEntry.id !== 'string'
                    || !model.groupsById.has(previousEntry.id)
                ) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                if (
                    item.kind === 'group'
                    && hasGroupPath(model.groupsById, item.id, previousEntry.id)
                ) {
                    return createDirectionalTargetResult(false, 'cycle');
                }
                const previousGroup = model.groupsById.get(previousEntry.id);
                if (!Array.isArray(previousGroup?.children)) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                target = {
                    container: 'group',
                    groupId: previousEntry.id,
                    index: previousGroup.children.length
                };
            } else {
                if (from.container !== 'group' || !from.groupId) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                const parentItem = { kind: 'group', id: from.groupId };
                const parentLocations = getDirectionalLocations(
                    model,
                    parentItem,
                    locationIndex
                );
                if (parentLocations.length !== 1) {
                    return createDirectionalTargetResult(
                        false,
                        parentLocations.length === 0 ? 'unavailable' : 'ambiguous'
                    );
                }
                const parentLocation = parentLocations[0];
                const parentContainer = getTargetList(model, parentLocation);
                if (!Array.isArray(parentContainer)) {
                    return createDirectionalTargetResult(false, 'unavailable');
                }
                target = {
                    container: parentLocation.container,
                    ...(parentLocation.container === 'group'
                        ? { groupId: parentLocation.groupId }
                        : {}),
                    index: parentLocation.index + 1
                };
            }

            const modelValidation = validation || validateWorkingModel(model);
            if (!modelValidation.ok) {
                return createDirectionalTargetResult(
                    false,
                    getValidationFailureReason(modelValidation)
                );
            }
            return createDirectionalTargetResult(true, 'ready', target);
        }

        function resolveDirectionalTarget(itemInput, directionInput) {
            const item = normalizeItem(itemInput);
            if (!item) {
                return createDirectionalTargetResult(false, 'invalid_item');
            }
            const direction = typeof directionInput === 'string'
                ? directionInput.trim().toLowerCase()
                : '';
            if (!['up', 'down', 'in', 'out'].includes(direction)) {
                return createDirectionalTargetResult(false, 'invalid_direction');
            }
            return resolveDirectionalTargetOnModel(getLiveModel(), item, direction);
        }

        function createDirectionalTargetResolver() {
            const model = getLiveModel();
            const locationIndex = model ? createDirectionalLocationIndex(model) : null;
            const validation = model ? validateWorkingModel(model) : null;
            return (itemInput, directionInput) => {
                const item = normalizeItem(itemInput);
                if (!item) {
                    return createDirectionalTargetResult(false, 'invalid_item');
                }
                const direction = typeof directionInput === 'string'
                    ? directionInput.trim().toLowerCase()
                    : '';
                if (!['up', 'down', 'in', 'out'].includes(direction)) {
                    return createDirectionalTargetResult(false, 'invalid_direction');
                }
                return resolveDirectionalTargetOnModel(
                    model,
                    item,
                    direction,
                    { locationIndex, validation }
                );
            };
        }

        function createPlacementFailure(reason, from = null) {
            return {
                ok: false,
                changed: false,
                reason,
                from: cloneLocation(from),
                to: null
            };
        }

        function planPlacementOnModel(model, command) {
            const item = normalizeItem(command?.item);
            const target = normalizeTarget(command?.target);
            if (!item || !target) return createPlacementFailure('invalid_target');
            if (item.kind === 'group' && target.container === 'ungrouped') {
                return createPlacementFailure('invalid_target');
            }

            const locations = collectItemLocations(model, item);
            const from = locations[0] || null;
            if (locations.length === 0) return createPlacementFailure('not_found');

            const targetList = getTargetList(model, target);
            if (!Array.isArray(targetList) || target.index > targetList.length) {
                return createPlacementFailure('invalid_target', from);
            }

            if (
                item.kind === 'group'
                && target.container === 'group'
                && hasGroupPath(model.groupsById, item.id, target.groupId)
            ) {
                return createPlacementFailure('cycle', from);
            }

            const removedBeforeTarget = locations.filter((location) => (
                locationsShareTarget(location, target)
                && location.index < target.index
            )).length;
            const adjustedIndex = target.index - removedBeforeTarget;
            const to = {
                container: target.container,
                index: adjustedIndex,
                ...(target.container === 'group' ? { groupId: target.groupId } : {})
            };

            if (
                locations.length === 1
                && locationsShareTarget(from, target)
                && from.index === adjustedIndex
            ) {
                return {
                    ok: true,
                    changed: false,
                    reason: 'no_change',
                    from: cloneLocation(from),
                    to: cloneLocation(to)
                };
            }

            removeItemEverywhere(model, item);
            const currentTargetList = getTargetList(model, target);
            if (!Array.isArray(currentTargetList) || adjustedIndex > currentTargetList.length) {
                return createPlacementFailure('invalid_target', from);
            }
            currentTargetList.splice(adjustedIndex, 0, itemToEntry(item, target.container));

            return {
                ok: true,
                changed: true,
                reason: 'moved',
                from: cloneLocation(from),
                to: cloneLocation(to)
            };
        }

        function treeEntriesEqual(left, right) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
                return false;
            }
            return left.every((entry, index) => {
                const other = right[index];
                if (entry?.type === 'source' || other?.type === 'source') {
                    return entry?.type === other?.type && entry?.key === other?.key;
                }
                if (entry?.type === 'group' || other?.type === 'group') {
                    return entry?.type === other?.type && entry?.id === other?.id;
                }
                return JSON.stringify(entry) === JSON.stringify(other);
            });
        }

        function stringArraysEqual(left, right) {
            if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
                return false;
            }
            return left.every((entry, index) => entry === right[index]);
        }

        function valuesEqual(left, right) {
            if (Object.is(left, right)) return true;
            if (Array.isArray(left) || Array.isArray(right)) {
                if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
                    return false;
                }
                return left.every((entry, index) => valuesEqual(entry, right[index]));
            }
            if (
                left
                && right
                && typeof left === 'object'
                && typeof right === 'object'
            ) {
                const leftKeys = Object.keys(left).sort();
                const rightKeys = Object.keys(right).sort();
                if (!stringArraysEqual(leftKeys, rightKeys)) return false;
                return leftKeys.every((key) => valuesEqual(left[key], right[key]));
            }
            return false;
        }

        function groupMetadataEqual(left, right) {
            if (!left || !right) return left === right;
            const leftKeys = Object.keys(left)
                .filter((key) => key !== 'children')
                .sort();
            const rightKeys = Object.keys(right)
                .filter((key) => key !== 'children')
                .sort();
            if (!stringArraysEqual(leftKeys, rightKeys)) return false;
            return leftKeys.every((key) => valuesEqual(left[key], right[key]));
        }

        function groupsEqual(leftGroups, rightGroups) {
            if (!(leftGroups instanceof Map) || !(rightGroups instanceof Map)) return false;
            if (leftGroups.size !== rightGroups.size) return false;
            for (const [groupId, leftGroup] of leftGroups) {
                const rightGroup = rightGroups.get(groupId);
                if (
                    !rightGroup
                    || !groupMetadataEqual(leftGroup, rightGroup)
                    || !treeEntriesEqual(leftGroup.children, rightGroup.children)
                ) {
                    return false;
                }
            }
            return true;
        }

        function createPatch(beforeModel, afterModel) {
            const patch = {
                root: treeEntriesEqual(beforeModel.state.root, afterModel.state.root)
                    ? null
                    : cloneTreeEntries(afterModel.state.root),
                ungrouped: stringArraysEqual(
                    beforeModel.state.ungrouped,
                    afterModel.state.ungrouped
                )
                    ? null
                    : [...afterModel.state.ungrouped],
                groupChildrenById: new Map(),
                groupRecordsToSet: new Map(),
                groupIdsToDelete: []
            };

            beforeModel.groupsById.forEach((beforeGroup, groupId) => {
                const afterGroup = afterModel.groupsById.get(groupId);
                if (!afterGroup) {
                    patch.groupIdsToDelete.push(groupId);
                    return;
                }
                if (!groupMetadataEqual(beforeGroup, afterGroup)) {
                    patch.groupRecordsToSet.set(groupId, cloneGroupRecord(afterGroup, groupId));
                    return;
                }
                if (!treeEntriesEqual(beforeGroup.children, afterGroup.children)) {
                    patch.groupChildrenById.set(groupId, cloneTreeEntries(afterGroup.children));
                }
            });

            afterModel.groupsById.forEach((afterGroup, groupId) => {
                if (!beforeModel.groupsById.has(groupId)) {
                    patch.groupRecordsToSet.set(groupId, cloneGroupRecord(afterGroup, groupId));
                }
            });

            return patch;
        }

        function patchHasChanges(patch) {
            return Boolean(
                patch
                && (
                    patch.root !== null
                    || patch.ungrouped !== null
                    || patch.groupChildrenById.size > 0
                    || patch.groupRecordsToSet.size > 0
                    || patch.groupIdsToDelete.length > 0
                )
            );
        }

        function restoreLiveModel(liveState, liveGroups, previous) {
            let restored = true;
            try {
                liveState.root = previous.root;
            } catch (error) {
                restored = false;
            }
            try {
                liveState.ungrouped = previous.ungrouped;
            } catch (error) {
                restored = false;
            }
            try {
                Map.prototype.clear.call(liveGroups);
                previous.groups.forEach(([groupId, group]) => {
                    Map.prototype.set.call(liveGroups, groupId, group);
                });
            } catch (error) {
                restored = false;
            }
            previous.groupChildren.forEach(([group, children]) => {
                try {
                    group.children = children;
                } catch (error) {
                    restored = false;
                }
            });
            return restored;
        }

        function commitPatch(patch) {
            if (!patchHasChanges(patch)) return false;
            const liveState = getLiveState();
            const liveGroups = getLiveGroups();
            if (!liveState || !liveGroups) return false;

            const nextRoot = patch.root === null ? null : cloneTreeEntries(patch.root);
            const nextUngrouped = patch.ungrouped === null ? null : [...patch.ungrouped];
            const recordsToSet = new Map(Array.from(
                patch.groupRecordsToSet.entries(),
                ([groupId, group]) => [groupId, cloneGroupRecord(group, groupId)]
            ));
            const childrenToSet = new Map(Array.from(
                patch.groupChildrenById.entries(),
                ([groupId, children]) => [groupId, cloneTreeEntries(children)]
            ));
            const previous = {
                root: liveState.root,
                ungrouped: liveState.ungrouped,
                groups: Array.from(liveGroups.entries()),
                groupChildren: Array.from(liveGroups.values(), (group) => [
                    group,
                    group?.children
                ])
            };

            try {
                if (nextRoot !== null) liveState.root = nextRoot;
                if (nextUngrouped !== null) liveState.ungrouped = nextUngrouped;
                recordsToSet.forEach((group, groupId) => {
                    Map.prototype.set.call(liveGroups, groupId, group);
                });
                childrenToSet.forEach((children, groupId) => {
                    const group = liveGroups.get(groupId);
                    if (group) group.children = children;
                });
                patch.groupIdsToDelete.forEach((groupId) => {
                    Map.prototype.delete.call(liveGroups, groupId);
                });
                return true;
            } catch (error) {
                try {
                    restoreLiveModel(liveState, liveGroups, previous);
                } catch (rollbackError) {
                    // Native Map/state assignments are expected to be rollback-safe.
                }
                return false;
            }
        }

        function collectModelSourceKeys(model) {
            const sourceKeys = new Set();
            (Array.isArray(model?.state?.root) ? model.state.root : []).forEach((entry) => {
                if (entry?.type === 'source' && entry.key) sourceKeys.add(entry.key);
            });
            (Array.isArray(model?.state?.ungrouped) ? model.state.ungrouped : [])
                .forEach((sourceKey) => {
                    if (typeof sourceKey === 'string' && sourceKey) sourceKeys.add(sourceKey);
                });
            model?.groupsById?.forEach?.((group) => {
                (Array.isArray(group?.children) ? group.children : []).forEach((entry) => {
                    if (entry?.type === 'source' && entry.key) sourceKeys.add(entry.key);
                });
            });
            return sourceKeys;
        }

        function validateWorkingModel(model) {
            return validatePlacementState({
                state: model.state,
                groupsById: model.groupsById,
                liveSourceKeys: collectModelSourceKeys(model)
            });
        }

        function getValidationFailureReason(validation) {
            return validation?.errors?.some((error) => error.code === 'group_cycle')
                ? 'cycle'
                : 'invalid_target';
        }

        function previewPlacement(command) {
            const beforeModel = getLiveModel();
            if (!beforeModel) {
                return {
                    ...createPlacementFailure('invalid_target'),
                    patch: null
                };
            }
            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            const planned = planPlacementOnModel(workingModel, command);
            if (!planned.ok || !planned.changed) {
                return {
                    ...planned,
                    patch: null
                };
            }
            const validation = validateWorkingModel(workingModel);
            if (!validation.ok) {
                return {
                    ...createPlacementFailure(
                        getValidationFailureReason(validation),
                        planned.from
                    ),
                    patch: null
                };
            }
            return {
                ok: true,
                reason: 'ready',
                from: planned.from,
                to: planned.to,
                patch: createPatch(beforeModel, workingModel)
            };
        }

        function applyPlacement(command) {
            const preview = previewPlacement(command);
            if (!preview.ok || preview.reason === 'no_change') {
                return {
                    ok: preview.ok,
                    changed: false,
                    reason: preview.reason,
                    from: preview.from,
                    to: preview.to
                };
            }
            const changed = commitPatch(preview.patch);
            return {
                ok: changed,
                changed,
                reason: changed ? 'moved' : 'invalid_target',
                from: preview.from,
                to: preview.to
            };
        }

        function applyPlacementTransaction(commands) {
            if (!Array.isArray(commands)) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    results: []
                };
            }
            const beforeModel = getLiveModel();
            if (!beforeModel) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    results: []
                };
            }

            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            const results = [];
            let changedCount = 0;

            for (const command of commands) {
                const planned = planPlacementOnModel(workingModel, command);
                results.push(planned);
                if (!planned.ok) {
                    return {
                        ok: false,
                        changed: false,
                        reason: planned.reason,
                        results
                    };
                }
                if (planned.changed) changedCount += 1;
            }

            if (changedCount === 0) {
                return {
                    ok: true,
                    changed: false,
                    reason: 'no_change',
                    results
                };
            }
            const validation = validateWorkingModel(workingModel);
            if (!validation.ok) {
                return {
                    ok: false,
                    changed: false,
                    reason: getValidationFailureReason(validation),
                    results
                };
            }
            const patch = createPatch(beforeModel, workingModel);
            if (!patchHasChanges(patch)) {
                return {
                    ok: true,
                    changed: false,
                    reason: 'no_change',
                    results
                };
            }
            const changed = commitPatch(patch);
            return {
                ok: changed,
                changed,
                reason: changed ? 'committed' : 'invalid_target',
                results
            };
        }

        function applyBatchPlacement(command) {
            const items = Array.isArray(command?.items) ? command.items : [];
            const target = normalizeTarget(command?.target);
            if (!target || items.length === 0) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    moved: [],
                    skipped: items.map((item) => ({ item, reason: 'invalid_target' }))
                };
            }
            const beforeModel = getLiveModel();
            if (!beforeModel) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    moved: [],
                    skipped: items.map((item) => ({ item, reason: 'invalid_target' }))
                };
            }

            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            const targetList = getTargetList(beforeModel, target);
            if (!Array.isArray(targetList) || target.index > targetList.length) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    moved: [],
                    skipped: items.map((item) => ({ item, reason: 'invalid_target' }))
                };
            }

            const decisions = [];
            const accepted = [];
            const seenItems = new Set();
            items.forEach((originalItem) => {
                const item = normalizeItem(originalItem);
                const identity = item
                    ? `${item.kind}:${item.kind === 'source' ? item.key : item.id}`
                    : '';
                let reason = null;
                let locations = [];

                if (!item) {
                    reason = 'invalid_target';
                } else if (seenItems.has(identity)) {
                    reason = 'no_change';
                } else if (item.kind === 'group' && target.container === 'ungrouped') {
                    reason = 'invalid_target';
                } else {
                    seenItems.add(identity);
                    locations = collectItemLocations(beforeModel, item);
                    if (locations.length === 0) {
                        reason = 'not_found';
                    } else if (
                        item.kind === 'group'
                        && target.container === 'group'
                        && hasGroupPath(beforeModel.groupsById, item.id, target.groupId)
                    ) {
                        reason = 'cycle';
                    }
                }

                const decision = {
                    originalItem,
                    item,
                    locations,
                    reason
                };
                decisions.push(decision);
                if (!reason) accepted.push(decision);
            });

            if (accepted.length === 0) {
                const skipped = decisions.map((decision) => ({
                    item: decision.originalItem,
                    reason: decision.reason
                }));
                const firstReason = skipped.find((entry) => entry.reason !== 'no_change')
                    ?.reason
                    || skipped[0]?.reason
                    || 'no_change';
                return {
                    ok: firstReason === 'no_change',
                    changed: false,
                    reason: firstReason,
                    moved: [],
                    skipped
                };
            }

            const removedBeforeTarget = accepted.reduce((count, decision) => (
                count + decision.locations.filter((location) => (
                    locationsShareTarget(location, target)
                    && location.index < target.index
                )).length
            ), 0);
            const adjustedIndex = target.index - removedBeforeTarget;

            accepted.forEach((decision) => {
                removeItemEverywhere(workingModel, decision.item);
            });
            const currentTargetList = getTargetList(workingModel, target);
            if (!Array.isArray(currentTargetList) || adjustedIndex > currentTargetList.length) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_target',
                    moved: [],
                    skipped: decisions.map((decision) => ({
                        item: decision.originalItem,
                        reason: decision.reason || 'invalid_target'
                    }))
                };
            }
            currentTargetList.splice(
                adjustedIndex,
                0,
                ...accepted.map((decision) => itemToEntry(decision.item, target.container))
            );

            const validation = validateWorkingModel(workingModel);
            if (!validation.ok) {
                const reason = getValidationFailureReason(validation);
                return {
                    ok: false,
                    changed: false,
                    reason,
                    moved: [],
                    skipped: decisions.map((decision) => ({
                        item: decision.originalItem,
                        reason: decision.reason || reason
                    }))
                };
            }
            const patch = createPatch(beforeModel, workingModel);
            if (!patchHasChanges(patch)) {
                const failureReason = decisions.find((decision) => (
                    decision.reason && decision.reason !== 'no_change'
                ))?.reason;
                return {
                    ok: !failureReason,
                    changed: false,
                    reason: failureReason || 'no_change',
                    moved: [],
                    skipped: decisions.map((decision) => ({
                        item: decision.originalItem,
                        reason: decision.reason || 'no_change'
                    }))
                };
            }

            const changed = commitPatch(patch);
            const moved = changed
                ? accepted.map((decision) => decision.originalItem)
                : [];
            const skipped = decisions
                .filter((decision) => !changed || decision.reason)
                .map((decision) => ({
                    item: decision.originalItem,
                    reason: decision.reason || 'invalid_target'
                }));
            return {
                ok: changed,
                changed,
                reason: changed
                    ? (skipped.length > 0 ? 'partial' : 'moved')
                    : 'invalid_target',
                moved,
                skipped
            };
        }

        function addGroup(command) {
            const group = command?.group;
            const groupId = typeof group?.id === 'string' ? group.id : '';
            const target = normalizeTarget(command?.target);
            const beforeModel = getLiveModel();
            if (
                !beforeModel
                || !groupId
                || !target
                || target.container === 'ungrouped'
                || beforeModel.groupsById.has(groupId)
                || (target.container === 'group' && target.groupId === groupId)
            ) {
                return createPlacementFailure('invalid_target');
            }

            const targetList = getTargetList(beforeModel, target);
            if (!Array.isArray(targetList) || target.index > targetList.length) {
                return createPlacementFailure('invalid_target');
            }

            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            workingModel.groupsById.set(groupId, cloneGroupRecord(group, groupId));
            const workingTargetList = getTargetList(workingModel, target);
            workingTargetList.splice(target.index, 0, { type: 'group', id: groupId });
            const validation = validatePlacementState({
                state: workingModel.state,
                groupsById: workingModel.groupsById,
                liveSourceKeys: collectModelSourceKeys(beforeModel)
            });
            if (!validation.ok) {
                return createPlacementFailure(getValidationFailureReason(validation));
            }
            const changed = commitPatch(createPatch(beforeModel, workingModel));
            return {
                ok: changed,
                changed,
                reason: changed ? 'inserted' : 'invalid_target',
                from: null,
                to: changed
                    ? {
                        container: target.container,
                        index: target.index,
                        ...(target.container === 'group' ? { groupId: target.groupId } : {})
                    }
                    : null
            };
        }

        function removeSource(command) {
            const item = normalizeItem(command?.item);
            const beforeModel = getLiveModel();
            if (!item || item.kind !== 'source' || !beforeModel) {
                return createPlacementFailure('not_found');
            }
            const locations = collectItemLocations(beforeModel, item);
            if (locations.length === 0) return createPlacementFailure('not_found');

            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            removeItemEverywhere(workingModel, item);
            const validation = validateWorkingModel(workingModel);
            if (!validation.ok) {
                return createPlacementFailure(
                    getValidationFailureReason(validation),
                    locations[0]
                );
            }
            const changed = commitPatch(createPatch(beforeModel, workingModel));
            return {
                ok: changed,
                changed,
                reason: changed ? 'removed' : 'invalid_target',
                from: cloneLocation(locations[0]),
                to: null
            };
        }

        function removeGroup(command) {
            const item = normalizeItem(command?.item);
            const beforeModel = getLiveModel();
            if (
                !item
                || item.kind !== 'group'
                || !beforeModel
                || !beforeModel.groupsById.has(item.id)
            ) {
                return createPlacementFailure('not_found');
            }

            const locations = collectItemLocations(beforeModel, item);
            const doomedGroup = beforeModel.groupsById.get(item.id);
            const directSourceKeys = [];
            const directChildGroupIds = [];
            (Array.isArray(doomedGroup.children) ? doomedGroup.children : []).forEach((entry) => {
                if (entry?.type === 'source' && entry.key) directSourceKeys.push(entry.key);
                if (entry?.type === 'group' && entry.id) directChildGroupIds.push(entry.id);
            });

            const workingModel = createModel(beforeModel.state, beforeModel.groupsById);
            removeItemEverywhere(workingModel, item);

            const promotedSources = new Set();
            directSourceKeys.forEach((sourceKey) => {
                if (promotedSources.has(sourceKey)) return;
                promotedSources.add(sourceKey);
                removeItemEverywhere(workingModel, { kind: 'source', key: sourceKey });
                workingModel.state.ungrouped.push(sourceKey);
            });

            const promotedGroups = new Set();
            directChildGroupIds.forEach((groupId) => {
                if (
                    groupId === item.id
                    || promotedGroups.has(groupId)
                    || !workingModel.groupsById.has(groupId)
                ) {
                    return;
                }
                promotedGroups.add(groupId);
                removeItemEverywhere(workingModel, { kind: 'group', id: groupId });
                workingModel.state.root.push({ type: 'group', id: groupId });
            });

            workingModel.groupsById.delete(item.id);
            const validation = validateWorkingModel(workingModel);
            if (!validation.ok) {
                return createPlacementFailure(
                    getValidationFailureReason(validation),
                    locations[0] || null
                );
            }
            const changed = commitPatch(createPatch(beforeModel, workingModel));
            return {
                ok: changed,
                changed,
                reason: changed ? 'removed' : 'invalid_target',
                from: cloneLocation(locations[0] || null),
                to: null
            };
        }

        function createValidationError(code, item = null) {
            return {
                code,
                item: item ? normalizeItem(item) : null
            };
        }

        function validatePlacementState(modelInput = {}) {
            const model = modelInput && typeof modelInput === 'object' ? modelInput : {};
            const state = model.state;
            const groupsById = readGroupsMap(model.groupsById);
            const liveSourceKeys = readLiveSourceKeys(model.liveSourceKeys);
            const errors = [];

            if (
                !state
                || typeof state !== 'object'
                || !hasOwnArrayField(state, 'root')
                || !hasOwnArrayField(state, 'ungrouped')
                || !groupsById
                || !liveSourceKeys
            ) {
                return {
                    ok: false,
                    errors: [createValidationError('invalid_entry')]
                };
            }

            liveSourceKeys.forEach((sourceKey) => {
                if (!isValidSourceKey(sourceKey)) {
                    errors.push(createValidationError('invalid_entry'));
                }
            });
            groupsById.forEach((group, groupId) => {
                if (liveSourceKeys.has(groupId)) {
                    errors.push(createValidationError('invalid_entry', {
                        kind: 'group',
                        id: groupId
                    }));
                }
            });

            const seenSourceKeys = new Set();
            const seenGroupPlacements = new Set();
            const checkSource = (sourceKey) => {
                const item = { kind: 'source', key: sourceKey };
                if (!isValidSourceKey(sourceKey)) {
                    errors.push(createValidationError('invalid_entry'));
                    return;
                }
                if (seenSourceKeys.has(sourceKey)) {
                    errors.push(createValidationError('duplicate_source', item));
                } else {
                    seenSourceKeys.add(sourceKey);
                }
                if (liveSourceKeys && !liveSourceKeys.has(sourceKey)) {
                    errors.push(createValidationError('unknown_source', item));
                }
            };

            const checkTreeEntry = (entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const sourceKey = getOwnFieldValue(entry, 'key');
                const groupId = getOwnFieldValue(entry, 'id');
                if (entryType === 'source' && typeof sourceKey === 'string' && sourceKey) {
                    checkSource(sourceKey);
                    return;
                }
                if (entryType === 'group' && typeof groupId === 'string' && groupId) {
                    if (!groupsById.has(groupId)) {
                        errors.push(createValidationError('missing_group', {
                            kind: 'group',
                            id: groupId
                        }));
                    } else if (seenGroupPlacements.has(groupId)) {
                        errors.push(createValidationError('invalid_entry', {
                            kind: 'group',
                            id: groupId
                        }));
                    } else {
                        seenGroupPlacements.add(groupId);
                    }
                    return;
                }
                errors.push(createValidationError('invalid_entry'));
            };

            groupsById.forEach((group, groupId) => {
                if (
                    typeof groupId !== 'string'
                    || !groupId
                    || !group
                    || typeof group !== 'object'
                    || getOwnFieldValue(group, 'id') !== groupId
                    || !hasOwnArrayField(group, 'children')
                ) {
                    errors.push(createValidationError('invalid_entry', {
                        kind: 'group',
                        id: groupId
                    }));
                    return;
                }
                getOwnFieldValue(group, 'children', []).forEach(checkTreeEntry);
            });
            state.root.forEach(checkTreeEntry);
            state.ungrouped.forEach((sourceKey) => checkSource(sourceKey));

            const reachableGroupIds = collectReachableGroupIds(state, groupsById);
            groupsById.forEach((group, groupId) => {
                if (!reachableGroupIds.has(groupId)) {
                    errors.push(createValidationError('invalid_entry', {
                        kind: 'group',
                        id: groupId
                    }));
                }
            });

            const colors = new Map();
            groupsById.forEach((group, groupId) => {
                if (colors.has(groupId)) return;
                colors.set(groupId, 'gray');
                const stack = [{
                    groupId,
                    index: 0,
                    children: hasOwnArrayField(group, 'children')
                        ? getOwnFieldValue(group, 'children')
                        : []
                }];
                while (stack.length > 0) {
                    const frame = stack[stack.length - 1];
                    if (frame.index >= frame.children.length) {
                        colors.set(frame.groupId, 'black');
                        stack.pop();
                        continue;
                    }
                    const entry = frame.children[frame.index];
                    frame.index += 1;
                    const entryType = getOwnFieldValue(entry, 'type');
                    const childGroupId = getOwnFieldValue(entry, 'id');
                    if (entryType !== 'group' || !groupsById.has(childGroupId)) continue;
                    const color = colors.get(childGroupId);
                    if (color === 'gray') {
                        errors.push(createValidationError('group_cycle', {
                            kind: 'group',
                            id: childGroupId
                        }));
                        continue;
                    }
                    if (color === 'black') continue;
                    const childGroup = groupsById.get(childGroupId);
                    colors.set(childGroupId, 'gray');
                    stack.push({
                        groupId: childGroupId,
                        index: 0,
                        children: hasOwnArrayField(childGroup, 'children')
                            ? getOwnFieldValue(childGroup, 'children')
                            : []
                    });
                }
            });

            liveSourceKeys.forEach((sourceKey) => {
                if (isValidSourceKey(sourceKey) && !seenSourceKeys.has(sourceKey)) {
                    errors.push(createValidationError('unknown_source', {
                        kind: 'source',
                        key: sourceKey
                    }));
                }
            });

            return {
                ok: errors.length === 0,
                errors
            };
        }

        function invalidNormalizedModel() {
            return {
                ok: false,
                changed: false,
                reason: 'invalid_model',
                state: null,
                groupsById: null,
                liveSourceKeys: null,
                removedDuplicates: 0,
                removedCycles: 0,
                movedOrphans: 0
            };
        }

        function normalizePlacementState(modelInput = {}) {
            const model = modelInput && typeof modelInput === 'object' ? modelInput : {};
            const inputState = model.state;
            const inputGroups = readGroupsMap(model.groupsById);
            const inputLiveSourceKeys = readLiveSourceKeys(model.liveSourceKeys);
            if (
                !inputState
                || typeof inputState !== 'object'
                || !hasOwnArrayField(inputState, 'root')
                || !hasOwnArrayField(inputState, 'ungrouped')
                || !inputGroups
                || !inputLiveSourceKeys
            ) {
                return invalidNormalizedModel();
            }

            for (const [groupId, group] of inputGroups) {
                if (
                    typeof groupId !== 'string'
                    || !groupId
                    || !group
                    || typeof group !== 'object'
                    || getOwnFieldValue(group, 'id') !== groupId
                    || !hasOwnArrayField(group, 'children')
                ) {
                    return invalidNormalizedModel();
                }
            }
            for (const sourceKey of inputLiveSourceKeys) {
                if (!isValidSourceKey(sourceKey)) return invalidNormalizedModel();
            }
            for (const groupId of inputGroups.keys()) {
                if (inputLiveSourceKeys.has(groupId)) return invalidNormalizedModel();
            }

            let nextState;
            let nextGroups;
            try {
                nextState = clonePlacementState(inputState);
                nextGroups = cloneGroupsMap(inputGroups);
            } catch (error) {
                return invalidNormalizedModel();
            }
            const liveSourceKeys = new Set(inputLiveSourceKeys);
            let removedDuplicates = 0;
            let removedCycles = 0;
            let movedOrphans = 0;
            let repaired = false;

            nextState.root = nextState.root.filter((entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const groupId = getOwnFieldValue(entry, 'id');
                const sourceKey = getOwnFieldValue(entry, 'key');
                if (entryType === 'group' && nextGroups.has(groupId)) return true;
                if (
                    entryType === 'source'
                    && typeof sourceKey === 'string'
                    && liveSourceKeys.has(sourceKey)
                ) {
                    return true;
                }
                repaired = true;
                return false;
            });

            nextGroups.forEach((group) => {
                group.children = group.children.filter((entry) => {
                    const entryType = getOwnFieldValue(entry, 'type');
                    const groupId = getOwnFieldValue(entry, 'id');
                    const sourceKey = getOwnFieldValue(entry, 'key');
                    if (entryType === 'group' && nextGroups.has(groupId)) return true;
                    if (
                        entryType === 'source'
                        && typeof sourceKey === 'string'
                        && liveSourceKeys.has(sourceKey)
                    ) {
                        return true;
                    }
                    repaired = true;
                    return false;
                });
            });

            const seenSourceKeys = new Set();
            const claimedGroupIds = new Set();
            const visitingGroupIds = new Set();
            const normalizedGroupIds = new Set();
            const createGroupFrame = (groupId) => {
                const group = nextGroups.get(groupId);
                return {
                    groupId,
                    group,
                    index: 0,
                    children: group.children,
                    nextChildren: []
                };
            };
            const normalizeGroupEdges = (startGroupId) => {
                if (normalizedGroupIds.has(startGroupId)) return;
                visitingGroupIds.add(startGroupId);
                const stack = [createGroupFrame(startGroupId)];
                while (stack.length > 0) {
                    const frame = stack[stack.length - 1];
                    if (frame.index >= frame.children.length) {
                        frame.group.children = frame.nextChildren;
                        visitingGroupIds.delete(frame.groupId);
                        normalizedGroupIds.add(frame.groupId);
                        stack.pop();
                        continue;
                    }

                    const entry = frame.children[frame.index];
                    frame.index += 1;
                    const entryType = getOwnFieldValue(entry, 'type');
                    const sourceKey = getOwnFieldValue(entry, 'key');
                    const childGroupId = getOwnFieldValue(entry, 'id');
                    if (entryType === 'source') {
                        if (seenSourceKeys.has(sourceKey)) {
                            removedDuplicates += 1;
                            repaired = true;
                            continue;
                        }
                        seenSourceKeys.add(sourceKey);
                        frame.nextChildren.push(entry);
                        continue;
                    }
                    if (entryType !== 'group') continue;
                    if (visitingGroupIds.has(childGroupId)) {
                        removedCycles += 1;
                        repaired = true;
                        continue;
                    }
                    if (claimedGroupIds.has(childGroupId)) {
                        repaired = true;
                        continue;
                    }
                    claimedGroupIds.add(childGroupId);
                    frame.nextChildren.push(entry);
                    visitingGroupIds.add(childGroupId);
                    stack.push(createGroupFrame(childGroupId));
                }
            };

            const nextRoot = [];
            nextState.root.forEach((entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const groupId = getOwnFieldValue(entry, 'id');
                if (entryType !== 'group') {
                    nextRoot.push(entry);
                    return;
                }
                if (claimedGroupIds.has(groupId)) {
                    repaired = true;
                    return;
                }
                claimedGroupIds.add(groupId);
                nextRoot.push(entry);
                normalizeGroupEdges(groupId);
            });
            nextState.root = nextRoot;
            nextGroups.forEach((group, groupId) => {
                if (!claimedGroupIds.has(groupId)) {
                    nextGroups.delete(groupId);
                    repaired = true;
                }
            });

            nextState.root = nextState.root.filter((entry) => {
                const entryType = getOwnFieldValue(entry, 'type');
                const sourceKey = getOwnFieldValue(entry, 'key');
                if (entryType === 'group') return true;
                if (seenSourceKeys.has(sourceKey)) {
                    removedDuplicates += 1;
                    repaired = true;
                    return false;
                }
                seenSourceKeys.add(sourceKey);
                return true;
            });

            nextState.ungrouped = nextState.ungrouped.filter((sourceKey) => {
                if (
                    typeof sourceKey !== 'string'
                    || !sourceKey
                    || !liveSourceKeys.has(sourceKey)
                ) {
                    repaired = true;
                    return false;
                }
                if (seenSourceKeys.has(sourceKey)) {
                    removedDuplicates += 1;
                    repaired = true;
                    return false;
                }
                seenSourceKeys.add(sourceKey);
                return true;
            });

            liveSourceKeys.forEach((sourceKey) => {
                if (!seenSourceKeys.has(sourceKey)) {
                    nextState.ungrouped.push(sourceKey);
                    seenSourceKeys.add(sourceKey);
                    movedOrphans += 1;
                    repaired = true;
                }
            });

            const normalizedModel = {
                state: nextState,
                groupsById: nextGroups,
                liveSourceKeys
            };
            const validation = validatePlacementState(normalizedModel);
            if (!validation.ok) return invalidNormalizedModel();

            let structurallyChanged;
            try {
                const originalModel = createModel(inputState, inputGroups);
                structurallyChanged = (
                    !treeEntriesEqual(originalModel.state.root, nextState.root)
                    || !stringArraysEqual(originalModel.state.ungrouped, nextState.ungrouped)
                    || !groupsEqual(originalModel.groupsById, nextGroups)
                );
            } catch (error) {
                return invalidNormalizedModel();
            }

            return {
                ok: true,
                changed: repaired || structurallyChanged,
                state: nextState,
                groupsById: nextGroups,
                liveSourceKeys,
                removedDuplicates,
                removedCycles,
                movedOrphans
            };
        }

        function commitPlacementModel(modelInput) {
            const normalizedModel = modelInput && typeof modelInput === 'object'
                ? modelInput
                : {};
            const validation = validatePlacementState(normalizedModel);
            if (!normalizedModel?.ok || !validation.ok) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_model',
                    validation
                };
            }

            const liveState = getLiveState();
            const liveGroups = getLiveGroups();
            if (!liveState || !liveGroups) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_model',
                    validation: {
                        ok: false,
                        errors: [createValidationError('invalid_entry')]
                    }
                };
            }

            let candidateModel;
            let changed;
            let nextRoot;
            let nextUngrouped;
            let nextGroups;
            try {
                candidateModel = createModel(
                    normalizedModel.state,
                    normalizedModel.groupsById
                );
                const liveModel = createModel(liveState, liveGroups);
                changed = (
                    !treeEntriesEqual(liveModel.state.root, candidateModel.state.root)
                    || !stringArraysEqual(
                        liveModel.state.ungrouped,
                        candidateModel.state.ungrouped
                    )
                    || !groupsEqual(liveModel.groupsById, candidateModel.groupsById)
                );
                nextRoot = cloneTreeEntries(candidateModel.state.root);
                nextUngrouped = [...candidateModel.state.ungrouped];
                nextGroups = cloneGroupsMap(candidateModel.groupsById);
            } catch (error) {
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_model',
                    validation: {
                        ok: false,
                        errors: [createValidationError('invalid_entry')]
                    }
                };
            }
            if (!changed) {
                return {
                    ok: true,
                    changed: false,
                    reason: 'no_change',
                    validation
                };
            }

            const previous = {
                root: liveState.root,
                ungrouped: liveState.ungrouped,
                groups: Array.from(liveGroups.entries()),
                groupChildren: Array.from(liveGroups.values(), (group) => [
                    group,
                    group?.children
                ])
            };

            try {
                liveState.root = nextRoot;
                liveState.ungrouped = nextUngrouped;
                Map.prototype.clear.call(liveGroups);
                nextGroups.forEach((group, groupId) => {
                    Map.prototype.set.call(
                        liveGroups,
                        groupId,
                        cloneGroupRecord(group, groupId)
                    );
                });
            } catch (error) {
                try {
                    restoreLiveModel(liveState, liveGroups, previous);
                } catch (rollbackError) {
                    // Native Map/state assignments are expected to be rollback-safe.
                }
                return {
                    ok: false,
                    changed: false,
                    reason: 'invalid_model',
                    validation: {
                        ok: false,
                        errors: [createValidationError('invalid_entry')]
                    }
                };
            }

            return {
                ok: true,
                changed: true,
                reason: 'committed',
                validation
            };
        }

        function sweepPositionedRootSourcesToBin() {
            const beforeModel = getLiveModel();
            if (!beforeModel) return false;
            const candidateState = clonePlacementState(beforeModel.state);
            const positionedSourceKeys = [];
            candidateState.root = candidateState.root.filter((entry) => {
                if (entry?.type !== 'source' || !isValidSourceKey(entry.key)) {
                    return true;
                }
                positionedSourceKeys.push(entry.key);
                return false;
            });
            candidateState.ungrouped.push(...positionedSourceKeys);

            const normalized = normalizePlacementState({
                state: candidateState,
                groupsById: beforeModel.groupsById,
                liveSourceKeys: collectModelSourceKeys(beforeModel)
            });
            if (!normalized.ok) return false;

            const patch = createPatch(beforeModel, {
                state: normalized.state,
                groupsById: normalized.groupsById
            });
            if (!patchHasChanges(patch)) return false;
            return commitPatch(patch);
        }

        function rebuildParentMap(targetMap) {
            if (!(targetMap instanceof Map)) return targetMap;
            targetMap.clear();
            const groupsById = getLiveGroups();
            const state = getLiveState();
            if (!groupsById || !state) return targetMap;

            const visitedGroupIds = new Set();
            const visitGroup = (startGroupId) => {
                if (visitedGroupIds.has(startGroupId) || !groupsById.has(startGroupId)) return;
                visitedGroupIds.add(startGroupId);
                const startGroup = groupsById.get(startGroupId);
                const stack = [{
                    groupId: startGroupId,
                    index: 0,
                    children: Array.isArray(startGroup?.children)
                        ? startGroup.children
                        : []
                }];
                while (stack.length > 0) {
                    const frame = stack[stack.length - 1];
                    if (frame.index >= frame.children.length) {
                        stack.pop();
                        continue;
                    }
                    const entry = frame.children[frame.index];
                    frame.index += 1;
                    if (entry?.type === 'group' && entry.id) {
                        if (visitedGroupIds.has(entry.id) || !groupsById.has(entry.id)) {
                            continue;
                        }
                        visitedGroupIds.add(entry.id);
                        if (!targetMap.has(entry.id)) {
                            targetMap.set(entry.id, frame.groupId);
                        }
                        const childGroup = groupsById.get(entry.id);
                        stack.push({
                            groupId: entry.id,
                            index: 0,
                            children: Array.isArray(childGroup?.children)
                                ? childGroup.children
                                : []
                        });
                        continue;
                    }
                    if (
                        entry?.type === 'source'
                        && entry.key
                        && !targetMap.has(entry.key)
                    ) {
                        targetMap.set(entry.key, frame.groupId);
                    }
                }
            };
            (Array.isArray(state.root) ? state.root : []).forEach((entry) => {
                if (entry?.type === 'group' && entry.id) visitGroup(entry.id);
            });
            return targetMap;
        }

        return {
            locateItem,
            resolveDirectionalTarget,
            createDirectionalTargetResolver,
            previewPlacement,
            applyPlacement,
            applyBatchPlacement,
            applyPlacementTransaction,
            addGroup,
            removeSource,
            removeGroup,
            validatePlacementState,
            normalizePlacementState,
            commitPlacementModel,
            sweepPositionedRootSourcesToBin,
            rebuildParentMap
        };
    }

    globalThis.NSM_CREATE_CONTENT_TREE_PLACEMENT = createContentTreePlacement;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentTreePlacement;
    }
})();
