const TREE_PLACEMENT_MODULE_PATH = '../../src/content/content-tree-placement.js';

const cloneSerializable = (value) => JSON.parse(JSON.stringify(value));

function snapshotGroups(groupsById) {
    return Array.from(groupsById.entries(), ([groupId, group]) => [
        groupId,
        cloneSerializable(group)
    ]);
}

function snapshotLiveModel(state, groupsById) {
    return {
        state: cloneSerializable(state),
        groups: snapshotGroups(groupsById)
    };
}

function countSourcePlacements(sourceKey, state, groupsById) {
    let count = 0;
    (Array.isArray(state.root) ? state.root : []).forEach((entry) => {
        if (entry?.type === 'source' && entry.key === sourceKey) count += 1;
    });
    (Array.isArray(state.ungrouped) ? state.ungrouped : []).forEach((key) => {
        if (key === sourceKey) count += 1;
    });
    groupsById.forEach((group) => {
        (Array.isArray(group.children) ? group.children : []).forEach((entry) => {
            if (entry?.type === 'source' && entry.key === sourceKey) count += 1;
        });
    });
    return count;
}

describe('content-tree-placement factory', () => {
    let createContentTreePlacement;

    beforeEach(() => {
        jest.resetModules();
        createContentTreePlacement = require(TREE_PLACEMENT_MODULE_PATH);
    });

    function createHarness({
        state = {},
        groupsById = new Map()
    } = {}) {
        const liveState = {
            root: [],
            ungrouped: [],
            ...state
        };
        const liveGroupsById = groupsById instanceof Map
            ? groupsById
            : new Map(Object.entries(groupsById));
        const treePlacement = createContentTreePlacement({
            getState: () => liveState,
            getGroupsById: () => liveGroupsById
        });
        return {
            state: liveState,
            groupsById: liveGroupsById,
            treePlacement
        };
    }

    it('applyPlacement moves a source from bin to root using object entry shape', () => {
        const group = { id: 'g1', title: 'Folder', children: [] };
        const { state, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: ['source-a']
            },
            groupsById: new Map([['g1', group]])
        });

        const result = treePlacement.applyPlacement({
            item: { kind: 'source', key: 'source-a' },
            target: { container: 'root', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'moved'
        }));
        expect(result.from).toEqual(expect.objectContaining({
            container: 'ungrouped',
            index: 0
        }));
        expect(result.to).toEqual(expect.objectContaining({
            container: 'root',
            index: 1
        }));
        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'source-a' }
        ]);
        expect(state.ungrouped).toEqual([]);
    });

    it('applyPlacement removes stale duplicates from every old container', () => {
        const groupA = {
            id: 'group-a',
            children: [{ type: 'source', key: 'duplicate' }]
        };
        const groupB = {
            id: 'group-b',
            children: [{ type: 'source', key: 'duplicate' }]
        };
        const targetGroup = {
            id: 'target',
            children: [{ type: 'source', key: 'target-existing' }]
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'group-a' },
                    { type: 'source', key: 'duplicate' },
                    { type: 'group', id: 'group-b' },
                    { type: 'group', id: 'target' }
                ],
                ungrouped: ['duplicate']
            },
            groupsById: new Map([
                ['group-a', groupA],
                ['group-b', groupB],
                ['target', targetGroup]
            ])
        });

        const result = treePlacement.applyPlacement({
            item: { kind: 'source', key: 'duplicate' },
            target: { container: 'group', groupId: 'target', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'moved'
        }));
        expect(state.root).toEqual([
            { type: 'group', id: 'group-a' },
            { type: 'group', id: 'group-b' },
            { type: 'group', id: 'target' }
        ]);
        expect(state.ungrouped).toEqual([]);
        expect(groupsById.get('group-a').children).toEqual([]);
        expect(groupsById.get('group-b').children).toEqual([]);
        expect(groupsById.get('target').children).toEqual([
            { type: 'source', key: 'target-existing' },
            { type: 'source', key: 'duplicate' }
        ]);
        expect(countSourcePlacements('duplicate', state, groupsById)).toBe(1);
    });

    it('applyPlacement reports no_change without mutation', () => {
        const group = { id: 'g1', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'g1' },
                    { type: 'source', key: 'source-a' },
                    { type: 'source', key: 'source-b' }
                ],
                ungrouped: []
            },
            groupsById: new Map([['g1', group]])
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;
        const groupRef = groupsById.get('g1');
        const groupChildrenRef = group.children;
        const before = snapshotLiveModel(state, groupsById);
        const mapClearSpy = jest.spyOn(groupsById, 'clear');
        const mapSetSpy = jest.spyOn(groupsById, 'set');
        const mapDeleteSpy = jest.spyOn(groupsById, 'delete');

        const result = treePlacement.applyPlacement({
            item: { kind: 'source', key: 'source-a' },
            target: { container: 'root', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: false,
            reason: 'no_change'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(groupsById.get('g1')).toBe(groupRef);
        expect(group.children).toBe(groupChildrenRef);
        expect(mapClearSpy).not.toHaveBeenCalled();
        expect(mapSetSpy).not.toHaveBeenCalled();
        expect(mapDeleteSpy).not.toHaveBeenCalled();
    });

    it('applyPlacement rejects a group-to-descendant cycle atomically', () => {
        const parent = {
            id: 'parent',
            children: [{ type: 'group', id: 'child' }]
        };
        const child = { id: 'child', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'parent' }],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent', parent],
                ['child', child]
            ])
        });
        const rootRef = state.root;
        const parentChildrenRef = parent.children;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.applyPlacement({
            item: { kind: 'group', id: 'parent' },
            target: { container: 'group', groupId: 'child', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'cycle'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(parent.children).toBe(parentChildrenRef);
    });

    it('applyPlacement refuses to commit while an unrelated duplicate keeps the model invalid', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'source', key: 'duplicate' }],
                ungrouped: ['source-a', 'duplicate']
            }
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.applyPlacement({
            item: { kind: 'source', key: 'source-a' },
            target: { container: 'root', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_target'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
    });

    it('applyBatchPlacement preserves source order', () => {
        const targetGroup = {
            id: 'target',
            children: [{ type: 'source', key: 'existing' }]
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'target' }],
                ungrouped: ['A', 'B', 'C']
            },
            groupsById: new Map([['target', targetGroup]])
        });
        const items = [
            { kind: 'source', key: 'C' },
            { kind: 'source', key: 'A' },
            { kind: 'source', key: 'B' }
        ];

        const result = treePlacement.applyBatchPlacement({
            items,
            target: { container: 'group', groupId: 'target', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'moved',
            moved: items,
            skipped: []
        }));
        expect(groupsById.get('target').children).toEqual([
            { type: 'source', key: 'C' },
            { type: 'source', key: 'A' },
            { type: 'source', key: 'B' },
            { type: 'source', key: 'existing' }
        ]);
        expect(state.ungrouped).toEqual([]);
    });

    it('applyBatchPlacement corrects a same-container block index and preserves no-op references', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [],
                ungrouped: ['A', 'B', 'C', 'D']
            }
        });
        const items = [
            { kind: 'source', key: 'B' },
            { kind: 'source', key: 'C' }
        ];

        const moved = treePlacement.applyBatchPlacement({
            items,
            target: { container: 'ungrouped', index: 4 }
        });

        expect(moved).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'moved',
            moved: items,
            skipped: []
        }));
        expect(state.ungrouped).toEqual(['A', 'D', 'B', 'C']);

        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;
        const noChange = treePlacement.applyBatchPlacement({
            items,
            target: { container: 'ungrouped', index: 2 }
        });

        expect(noChange).toEqual(expect.objectContaining({
            ok: true,
            changed: false,
            reason: 'no_change',
            moved: []
        }));
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(state.ungrouped).toEqual(['A', 'D', 'B', 'C']);
    });

    it('applyBatchPlacement does not hide a missing item behind an accepted no-op', () => {
        const { state, treePlacement } = createHarness({
            state: {
                root: [],
                ungrouped: ['A']
            }
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;

        const result = treePlacement.applyBatchPlacement({
            items: [
                { kind: 'source', key: 'A' },
                { kind: 'source', key: 'missing' }
            ],
            target: { container: 'ungrouped', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'not_found',
            moved: []
        }));
        expect(result.skipped).toEqual(expect.arrayContaining([
            {
                item: { kind: 'source', key: 'A' },
                reason: 'no_change'
            },
            {
                item: { kind: 'source', key: 'missing' },
                reason: 'not_found'
            }
        ]));
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(state.ungrouped).toEqual(['A']);
    });

    it('applyBatchPlacement accounts for every input when the atomic commit fails', () => {
        const targetGroup = Object.freeze({
            id: 'target',
            children: []
        });
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'target' }],
                ungrouped: ['A']
            },
            groupsById: new Map([['target', targetGroup]])
        });
        const item = { kind: 'source', key: 'A' };
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.applyBatchPlacement({
            items: [item],
            target: { container: 'group', groupId: 'target', index: 0 }
        });

        expect(result).toEqual({
            ok: false,
            changed: false,
            reason: 'invalid_target',
            moved: [],
            skipped: [{
                item,
                reason: 'invalid_target'
            }]
        });
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
    });

    it('applyPlacementTransaction rejects all commands when one command is invalid', () => {
        const group = { id: 'group-a', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'group-a' }],
                ungrouped: ['source-a']
            },
            groupsById: new Map([['group-a', group]])
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;
        const groupRef = groupsById.get('group-a');
        const groupChildrenRef = group.children;
        const before = snapshotLiveModel(state, groupsById);
        const mapClearSpy = jest.spyOn(groupsById, 'clear');
        const mapSetSpy = jest.spyOn(groupsById, 'set');
        const mapDeleteSpy = jest.spyOn(groupsById, 'delete');

        const result = treePlacement.applyPlacementTransaction([
            {
                item: { kind: 'source', key: 'source-a' },
                target: { container: 'root', index: 1 }
            },
            {
                item: { kind: 'source', key: 'missing-source' },
                target: { container: 'root', index: 2 }
            }
        ]);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'not_found'
        }));
        expect(result.results).toHaveLength(2);
        expect(result.results[0]).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'moved'
        }));
        expect(result.results[1]).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'not_found'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(groupsById.get('group-a')).toBe(groupRef);
        expect(group.children).toBe(groupChildrenRef);
        expect(mapClearSpy).not.toHaveBeenCalled();
        expect(mapSetSpy).not.toHaveBeenCalled();
        expect(mapDeleteSpy).not.toHaveBeenCalled();
    });

    it('applyPlacementTransaction reports no_change when valid commands net back to the original model', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [],
                ungrouped: ['A', 'B']
            }
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;

        const result = treePlacement.applyPlacementTransaction([
            {
                item: { kind: 'source', key: 'A' },
                target: { container: 'root', index: 0 }
            },
            {
                item: { kind: 'source', key: 'A' },
                target: { container: 'ungrouped', index: 0 }
            }
        ]);

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: false,
            reason: 'no_change'
        }));
        expect(result.results).toHaveLength(2);
        expect(result.results.every((entry) => entry.changed === true)).toBe(true);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(state).toEqual({ root: [], ungrouped: ['A', 'B'] });
    });

    it('addGroup commits the group record and root edge atomically', () => {
        const existingGroup = { id: 'existing', children: [] };
        const newGroup = {
            id: 'new-root',
            title: 'New root',
            children: [],
            enabled: true,
            collapsed: false
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'existing' },
                    { type: 'source', key: 'source-a' }
                ],
                ungrouped: []
            },
            groupsById: new Map([['existing', existingGroup]])
        });

        const result = treePlacement.addGroup({
            group: newGroup,
            target: { container: 'root', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'inserted'
        }));
        expect(groupsById.get('new-root')).toEqual(newGroup);
        expect(state.root).toEqual([
            { type: 'group', id: 'existing' },
            { type: 'group', id: 'new-root' },
            { type: 'source', key: 'source-a' }
        ]);
    });

    it('addGroup commits a nested subgroup record and parent edge atomically', () => {
        const parent = {
            id: 'parent',
            children: [
                { type: 'source', key: 'source-a' },
                { type: 'group', id: 'tail' }
            ]
        };
        const tail = { id: 'tail', children: [] };
        const subgroup = {
            id: 'subgroup',
            title: 'Nested subgroup',
            children: [],
            enabled: true,
            collapsed: false
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'parent' }],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent', parent],
                ['tail', tail]
            ])
        });

        const result = treePlacement.addGroup({
            group: subgroup,
            target: { container: 'group', groupId: 'parent', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'inserted'
        }));
        expect(groupsById.get('subgroup')).toEqual(subgroup);
        expect(groupsById.get('parent').children).toEqual([
            { type: 'source', key: 'source-a' },
            { type: 'group', id: 'subgroup' },
            { type: 'group', id: 'tail' }
        ]);
        expect(state.root).toEqual([{ type: 'group', id: 'parent' }]);
    });

    it('addGroup rejects a new record that would close a cycle without adding its record or edge', () => {
        const parent = { id: 'parent', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'parent' }],
                ungrouped: []
            },
            groupsById: new Map([['parent', parent]])
        });
        const rootRef = state.root;
        const parentChildrenRef = parent.children;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.addGroup({
            group: {
                id: 'new',
                children: [{ type: 'group', id: 'parent' }]
            },
            target: { container: 'group', groupId: 'parent', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'cycle'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(parent.children).toBe(parentChildrenRef);
        expect(groupsById.has('new')).toBe(false);
    });

    it('addGroup rejects a new record that would give an existing child group two parents', () => {
        const parent = {
            id: 'parent',
            children: [{ type: 'group', id: 'child' }]
        };
        const child = { id: 'child', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'parent' }],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent', parent],
                ['child', child]
            ])
        });
        const rootRef = state.root;
        const parentChildrenRef = parent.children;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.addGroup({
            group: {
                id: 'new',
                children: [{ type: 'group', id: 'child' }]
            },
            target: { container: 'root', index: 1 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_target'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(parent.children).toBe(parentChildrenRef);
        expect(groupsById.has('new')).toBe(false);
    });

    it('addGroup rejects a prefilled source that is not in the current live source universe', () => {
        const { state, groupsById, treePlacement } = createHarness();
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.addGroup({
            group: {
                id: 'new',
                children: [{ type: 'source', key: 'ghost' }]
            },
            target: { container: 'root', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_target'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById.has('new')).toBe(false);
    });

    it('addGroup rolls back its new record when a frozen parent rejects the tree edge', () => {
        const parent = Object.freeze({
            id: 'parent',
            children: []
        });
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'parent' }],
                ungrouped: []
            },
            groupsById: new Map([['parent', parent]])
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const before = snapshotLiveModel(state, groupsById);

        const result = treePlacement.addGroup({
            group: {
                id: 'new',
                children: []
            },
            target: { container: 'group', groupId: 'parent', index: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_target'
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById.get('parent')).toBe(parent);
        expect(groupsById.has('new')).toBe(false);
    });

    it('removeSource clears every stale duplicate', () => {
        const groupA = {
            id: 'group-a',
            children: [
                { type: 'source', key: 'duplicate' },
                { type: 'source', key: 'group-keep' },
                { type: 'source', key: 'duplicate' }
            ]
        };
        const groupB = {
            id: 'group-b',
            children: [{ type: 'source', key: 'duplicate' }]
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'group-a' },
                    { type: 'source', key: 'duplicate' },
                    { type: 'group', id: 'group-b' }
                ],
                ungrouped: ['duplicate', 'bin-keep', 'duplicate']
            },
            groupsById: new Map([
                ['group-a', groupA],
                ['group-b', groupB]
            ])
        });

        const result = treePlacement.removeSource({
            item: { kind: 'source', key: 'duplicate' }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'removed'
        }));
        expect(state.root).toEqual([
            { type: 'group', id: 'group-a' },
            { type: 'group', id: 'group-b' }
        ]);
        expect(state.ungrouped).toEqual(['bin-keep']);
        expect(groupsById.get('group-a').children).toEqual([
            { type: 'source', key: 'group-keep' }
        ]);
        expect(groupsById.get('group-b').children).toEqual([]);
        expect(countSourcePlacements('duplicate', state, groupsById)).toBe(0);
    });

    it('removeGroup sends direct sources to the bin and promotes child groups to root in order', () => {
        const parent = {
            id: 'parent',
            children: [
                { type: 'source', key: 'parent-source' },
                { type: 'group', id: 'doomed' },
                { type: 'group', id: 'parent-sibling' }
            ]
        };
        const doomed = {
            id: 'doomed',
            children: [
                { type: 'source', key: 'source-1' },
                { type: 'group', id: 'child-a' },
                { type: 'source', key: 'source-2' },
                { type: 'group', id: 'child-b' }
            ]
        };
        const childA = { id: 'child-a', children: [] };
        const childB = { id: 'child-b', children: [] };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'existing-root' },
                    { type: 'group', id: 'parent' }
                ],
                ungrouped: ['existing-bin']
            },
            groupsById: new Map([
                ['existing-root', { id: 'existing-root', children: [] }],
                ['parent', parent],
                ['doomed', doomed],
                ['parent-sibling', { id: 'parent-sibling', children: [] }],
                ['child-a', childA],
                ['child-b', childB]
            ])
        });

        const result = treePlacement.removeGroup({
            item: { kind: 'group', id: 'doomed' }
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'removed'
        }));
        expect(state.ungrouped).toEqual([
            'existing-bin',
            'source-1',
            'source-2'
        ]);
        expect(state.root).toEqual([
            { type: 'group', id: 'existing-root' },
            { type: 'group', id: 'parent' },
            { type: 'group', id: 'child-a' },
            { type: 'group', id: 'child-b' }
        ]);
        expect(groupsById.get('parent').children).toEqual([
            { type: 'source', key: 'parent-source' },
            { type: 'group', id: 'parent-sibling' }
        ]);
        expect(groupsById.has('doomed')).toBe(false);
        expect(groupsById.get('child-a')).toEqual(childA);
        expect(groupsById.get('child-b')).toEqual(childB);
    });

    it('normalizePlacementState applies group-root-bin precedence', () => {
        const inputState = {
            root: [
                { type: 'group', id: 'group-a' },
                { type: 'source', key: 'duplicate' },
                { type: 'source', key: 'root-only' }
            ],
            ungrouped: [
                'duplicate',
                'root-only',
                'bin-only'
            ],
            filterQuery: 'preserve-me'
        };
        const inputGroups = new Map([[
            'group-a',
            {
                id: 'group-a',
                children: [{ type: 'source', key: 'duplicate' }]
            }
        ]]);
        const liveSourceKeys = new Set([
            'duplicate',
            'root-only',
            'bin-only',
            'orphan'
        ]);
        const inputRootRef = inputState.root;
        const inputUngroupedRef = inputState.ungrouped;
        const inputGroupRef = inputGroups.get('group-a');
        const inputGroupChildrenRef = inputGroupRef.children;
        const { treePlacement } = createHarness();

        const result = treePlacement.normalizePlacementState({
            state: inputState,
            groupsById: inputGroups,
            liveSourceKeys
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            removedDuplicates: 3,
            removedCycles: 0,
            movedOrphans: 1
        }));
        expect(result.state).toEqual({
            root: [
                { type: 'group', id: 'group-a' },
                { type: 'source', key: 'root-only' }
            ],
            ungrouped: ['bin-only', 'orphan'],
            filterQuery: 'preserve-me'
        });
        expect(result.state).not.toBe(inputState);
        expect(result.state.root).not.toBe(inputRootRef);
        expect(result.state.ungrouped).not.toBe(inputUngroupedRef);
        expect(result.groupsById).toBeInstanceOf(Map);
        expect(result.groupsById).not.toBe(inputGroups);
        expect(result.groupsById.get('group-a')).not.toBe(inputGroupRef);
        expect(result.groupsById.get('group-a').children).not.toBe(inputGroupChildrenRef);
        expect(result.groupsById.get('group-a').children).toEqual([
            { type: 'source', key: 'duplicate' }
        ]);
        expect(result.liveSourceKeys).toEqual(liveSourceKeys);
        expect(result.liveSourceKeys).not.toBe(liveSourceKeys);
    });

    it('normalizePlacementState returns a new Map and never mutates import input', () => {
        const inputState = {
            root: [
                { type: 'group', id: 'group-a' },
                { type: 'source', key: 'duplicate' }
            ],
            ungrouped: ['duplicate', 'orphan'],
            activeQuickViewKind: 'recent'
        };
        const inputGroups = {
            'group-a': {
                id: 'group-a',
                children: [{ type: 'source', key: 'duplicate' }]
            }
        };
        const liveSourceKeys = ['duplicate', 'orphan'];
        const beforeState = cloneSerializable(inputState);
        const beforeGroups = cloneSerializable(inputGroups);
        const beforeLiveSourceKeys = [...liveSourceKeys];
        const { treePlacement } = createHarness();

        const result = treePlacement.normalizePlacementState({
            state: inputState,
            groupsById: inputGroups,
            liveSourceKeys
        });

        expect(result.ok).toBe(true);
        expect(result.state).not.toBe(inputState);
        expect(result.state.root).not.toBe(inputState.root);
        expect(result.state.ungrouped).not.toBe(inputState.ungrouped);
        expect(result.groupsById).toBeInstanceOf(Map);
        expect(result.groupsById.get('group-a')).not.toBe(inputGroups['group-a']);
        expect(result.groupsById.get('group-a').children).not.toBe(inputGroups['group-a'].children);
        expect(result.liveSourceKeys).toBeInstanceOf(Set);
        expect(inputState).toEqual(beforeState);
        expect(inputGroups).toEqual(beforeGroups);
        expect(liveSourceKeys).toEqual(beforeLiveSourceKeys);
    });

    it('normalizePlacementState gives only reachable groups precedence and rescues hidden sources', () => {
        const { treePlacement } = createHarness();
        const result = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'source', key: 'duplicate' }],
                ungrouped: ['duplicate']
            },
            groupsById: new Map([[
                'unreachable',
                {
                    id: 'unreachable',
                    children: [
                        { type: 'source', key: 'duplicate' },
                        { type: 'source', key: 'hidden-only' }
                    ]
                }
            ]]),
            liveSourceKeys: new Set(['duplicate', 'hidden-only'])
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            removedDuplicates: 1,
            movedOrphans: 1
        }));
        expect(result.groupsById.has('unreachable')).toBe(false);
        expect(result.state.root).toEqual([
            { type: 'source', key: 'duplicate' }
        ]);
        expect(result.state.ungrouped).toEqual(['hidden-only']);
        expect(treePlacement.validatePlacementState(result)).toEqual({
            ok: true,
            errors: []
        });
    });

    it('normalizePlacementState keeps the first visible group edge and removes later duplicate parents', () => {
        const { treePlacement } = createHarness();
        const result = treePlacement.normalizePlacementState({
            state: {
                root: [
                    { type: 'group', id: 'parent-a' },
                    { type: 'group', id: 'parent-b' },
                    { type: 'group', id: 'child' }
                ],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent-a', {
                    id: 'parent-a',
                    children: [{ type: 'group', id: 'child' }]
                }],
                ['parent-b', {
                    id: 'parent-b',
                    children: [{ type: 'group', id: 'child' }]
                }],
                ['child', {
                    id: 'child',
                    children: []
                }]
            ]),
            liveSourceKeys: new Set()
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true
        }));
        expect(result.state.root).toEqual([
            { type: 'group', id: 'parent-a' },
            { type: 'group', id: 'parent-b' }
        ]);
        expect(result.groupsById.get('parent-a').children).toEqual([
            { type: 'group', id: 'child' }
        ]);
        expect(result.groupsById.get('parent-b').children).toEqual([]);
        expect(treePlacement.validatePlacementState(result)).toEqual({
            ok: true,
            errors: []
        });
    });

    it.each([
        {
            label: 'invalid root entry',
            expectedCode: 'invalid_entry',
            state: { root: ['not-an-entry'], ungrouped: [] },
            groupsById: new Map(),
            liveSourceKeys: new Set()
        },
        {
            label: 'duplicate source placement',
            expectedCode: 'duplicate_source',
            state: {
                root: [{ type: 'source', key: 'duplicate' }],
                ungrouped: ['duplicate']
            },
            groupsById: new Map(),
            liveSourceKeys: new Set(['duplicate'])
        },
        {
            label: 'missing group record',
            expectedCode: 'missing_group',
            state: {
                root: [{ type: 'group', id: 'missing' }],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set()
        },
        {
            label: 'group cycle',
            expectedCode: 'group_cycle',
            state: {
                root: [{ type: 'group', id: 'a' }],
                ungrouped: []
            },
            groupsById: new Map([
                ['a', { id: 'a', children: [{ type: 'group', id: 'b' }] }],
                ['b', { id: 'b', children: [{ type: 'group', id: 'a' }] }]
            ]),
            liveSourceKeys: new Set()
        },
        {
            label: 'unknown source',
            expectedCode: 'unknown_source',
            state: {
                root: [{ type: 'source', key: 'ghost' }],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set()
        },
        {
            label: 'missing live source placement',
            expectedCode: 'unknown_source',
            state: {
                root: [],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set(['orphan'])
        },
        {
            label: 'invalid live source universe entry',
            expectedCode: 'invalid_entry',
            state: {
                root: [],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set([null])
        },
        {
            label: 'unreachable group record',
            expectedCode: 'invalid_entry',
            state: {
                root: [],
                ungrouped: []
            },
            groupsById: new Map([[
                'unreachable',
                { id: 'unreachable', children: [] }
            ]]),
            liveSourceKeys: new Set()
        },
        {
            label: 'duplicate root group edge',
            expectedCode: 'invalid_entry',
            state: {
                root: [
                    { type: 'group', id: 'duplicate' },
                    { type: 'group', id: 'duplicate' }
                ],
                ungrouped: []
            },
            groupsById: new Map([[
                'duplicate',
                { id: 'duplicate', children: [] }
            ]]),
            liveSourceKeys: new Set()
        },
        {
            label: 'group with two parents',
            expectedCode: 'invalid_entry',
            state: {
                root: [
                    { type: 'group', id: 'parent-a' },
                    { type: 'group', id: 'parent-b' }
                ],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent-a', {
                    id: 'parent-a',
                    children: [{ type: 'group', id: 'child' }]
                }],
                ['parent-b', {
                    id: 'parent-b',
                    children: [{ type: 'group', id: 'child' }]
                }],
                ['child', { id: 'child', children: [] }]
            ]),
            liveSourceKeys: new Set()
        }
    ])('validatePlacementState reports $label without mutating the model', ({
        expectedCode,
        state,
        groupsById,
        liveSourceKeys
    }) => {
        const { treePlacement } = createHarness();
        const beforeState = cloneSerializable(state);
        const beforeGroups = snapshotGroups(groupsById);
        const beforeLiveSourceKeys = [...liveSourceKeys];

        const result = treePlacement.validatePlacementState({
            state,
            groupsById,
            liveSourceKeys
        });

        expect(result.ok).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: expectedCode })
        ]));
        expect(state).toEqual(beforeState);
        expect(snapshotGroups(groupsById)).toEqual(beforeGroups);
        expect([...liveSourceKeys]).toEqual(beforeLiveSourceKeys);
    });

    it('validation, normalization and commit fail closed for null models or blank group identity', () => {
        const { treePlacement } = createHarness();

        expect(() => treePlacement.validatePlacementState(null)).not.toThrow();
        expect(treePlacement.validatePlacementState(null)).toEqual({
            ok: false,
            errors: [{
                code: 'invalid_entry',
                item: null
            }]
        });
        expect(() => treePlacement.normalizePlacementState(null)).not.toThrow();
        expect(treePlacement.normalizePlacementState(null)).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_model'
        }));
        expect(() => treePlacement.commitPlacementModel(null)).not.toThrow();
        expect(treePlacement.commitPlacementModel(null)).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_model'
        }));

        const invalidIdentity = treePlacement.validatePlacementState({
            state: { root: [], ungrouped: [] },
            groupsById: new Map([['', { id: '', children: [] }]]),
            liveSourceKeys: new Set()
        });
        expect(invalidIdentity).toEqual(expect.objectContaining({
            ok: false,
            errors: expect.arrayContaining([
                expect.objectContaining({ code: 'invalid_entry' })
            ])
        }));
    });

    it('normalizePlacementState removes only the closing cycle edge and preserves legal siblings', () => {
        const { treePlacement } = createHarness();
        const result = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'group', id: 'a' }],
                ungrouped: []
            },
            groupsById: new Map([
                ['a', {
                    id: 'a',
                    children: [{ type: 'group', id: 'b' }]
                }],
                ['b', {
                    id: 'b',
                    children: [
                        { type: 'source', key: 'before' },
                        { type: 'group', id: 'a' },
                        { type: 'group', id: 'd' },
                        { type: 'source', key: 'after' }
                    ]
                }],
                ['d', { id: 'd', children: [] }]
            ]),
            liveSourceKeys: new Set(['before', 'after'])
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            removedCycles: 1
        }));
        expect(result.groupsById.get('b').children).toEqual([
            { type: 'source', key: 'before' },
            { type: 'group', id: 'd' },
            { type: 'source', key: 'after' }
        ]);
        expect(treePlacement.validatePlacementState(result)).toEqual({
            ok: true,
            errors: []
        });
    });

    it('validation, normalization and parent mapping handle a deeply nested untrusted tree iteratively', () => {
        const groupCount = 12_000;
        const groupsById = new Map();
        for (let index = 0; index < groupCount; index += 1) {
            groupsById.set(`g-${index}`, {
                id: `g-${index}`,
                children: index + 1 < groupCount
                    ? [{ type: 'group', id: `g-${index + 1}` }]
                    : []
            });
        }
        const state = {
            root: [{ type: 'group', id: 'g-0' }],
            ungrouped: []
        };
        const { treePlacement } = createHarness({ state, groupsById });

        expect(() => treePlacement.validatePlacementState({
            state,
            groupsById,
            liveSourceKeys: new Set()
        })).not.toThrow();
        expect(treePlacement.validatePlacementState({
            state,
            groupsById,
            liveSourceKeys: new Set()
        })).toEqual({
            ok: true,
            errors: []
        });

        let normalized;
        expect(() => {
            normalized = treePlacement.normalizePlacementState({
                state,
                groupsById,
                liveSourceKeys: new Set()
            });
        }).not.toThrow();
        expect(normalized).toEqual(expect.objectContaining({
            ok: true,
            changed: false
        }));

        const parentMap = new Map();
        expect(() => treePlacement.rebuildParentMap(parentMap)).not.toThrow();
        expect(parentMap.size).toBe(groupCount - 1);
        expect(parentMap.get(`g-${groupCount - 1}`)).toBe(`g-${groupCount - 2}`);
    });

    it('commitPlacementModel revalidates its carried liveSourceKeys and rejects a tampered normalized model without live state/Map mutation', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'source', key: 'live-current' }],
                ungrouped: [],
                filterQuery: 'runtime-state'
            },
            groupsById: new Map([[
                'live-group',
                { id: 'live-group', children: [] }
            ]])
        });
        const normalized = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'source', key: 'source-a' }],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set(['source-a'])
        });
        expect(normalized.ok).toBe(true);
        expect(normalized.liveSourceKeys.delete('source-a')).toBe(true);

        const stateRootRef = state.root;
        const stateUngroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;
        const liveGroupRef = groupsById.get('live-group');
        const liveGroupChildrenRef = liveGroupRef.children;
        const before = snapshotLiveModel(state, groupsById);
        const mapClearSpy = jest.spyOn(groupsById, 'clear');
        const mapSetSpy = jest.spyOn(groupsById, 'set');
        const mapDeleteSpy = jest.spyOn(groupsById, 'delete');

        const result = treePlacement.commitPlacementModel(normalized);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_model',
            validation: expect.objectContaining({
                ok: false,
                errors: expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unknown_source',
                        item: {
                            kind: 'source',
                            key: 'source-a'
                        }
                    })
                ])
            })
        }));
        expect(snapshotLiveModel(state, groupsById)).toEqual(before);
        expect(state.root).toBe(stateRootRef);
        expect(state.ungrouped).toBe(stateUngroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(groupsById.get('live-group')).toBe(liveGroupRef);
        expect(liveGroupRef.children).toBe(liveGroupChildrenRef);
        expect(mapClearSpy).not.toHaveBeenCalled();
        expect(mapSetSpy).not.toHaveBeenCalled();
        expect(mapDeleteSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['deleted', (normalized) => { delete normalized.liveSourceKeys; }],
        ['null', (normalized) => { normalized.liveSourceKeys = null; }],
        ['plain object', (normalized) => { normalized.liveSourceKeys = {}; }]
    ])('commitPlacementModel rejects a %s carried liveSourceKeys context', (_label, tamper) => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [],
                ungrouped: ['live-current']
            }
        });
        const normalized = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'source', key: 'candidate' }],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set(['candidate'])
        });
        expect(normalized.ok).toBe(true);
        tamper(normalized);
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;

        const result = treePlacement.commitPlacementModel(normalized);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_model'
        }));
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(state).toEqual({ root: [], ungrouped: ['live-current'] });
    });

    it('commitPlacementModel rejects a candidate that drops a carried live source placement', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'source', key: 'live-current' }],
                ungrouped: []
            }
        });
        const normalized = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'source', key: 'candidate' }],
                ungrouped: []
            },
            groupsById: new Map(),
            liveSourceKeys: new Set(['candidate'])
        });
        expect(normalized.ok).toBe(true);
        normalized.state.root = [];
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupsMapRef = groupsById;

        const result = treePlacement.commitPlacementModel(normalized);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            changed: false,
            reason: 'invalid_model',
            validation: expect.objectContaining({
                ok: false,
                errors: expect.arrayContaining([
                    expect.objectContaining({
                        code: 'unknown_source',
                        item: {
                            kind: 'source',
                            key: 'candidate'
                        }
                    })
                ])
            })
        }));
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById).toBe(groupsMapRef);
        expect(state).toEqual({
            root: [{ type: 'source', key: 'live-current' }],
            ungrouped: []
        });
    });

    it('commitPlacementModel clones a valid normalized model into live state without aliases', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'source', key: 'old' }],
                ungrouped: []
            },
            groupsById: new Map()
        });
        const normalized = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: ['bin-source']
            },
            groupsById: new Map([[
                'g1',
                {
                    id: 'g1',
                    children: [{ type: 'source', key: 'group-source' }]
                }
            ]]),
            liveSourceKeys: new Set(['group-source', 'bin-source'])
        });

        const result = treePlacement.commitPlacementModel(normalized);

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: true,
            reason: 'committed'
        }));
        expect(state.root).toEqual([{ type: 'group', id: 'g1' }]);
        expect(state.ungrouped).toEqual(['bin-source']);
        expect(groupsById.get('g1').children).toEqual([
            { type: 'source', key: 'group-source' }
        ]);

        normalized.state.root.push({ type: 'source', key: 'candidate-only' });
        normalized.state.ungrouped.push('candidate-bin-only');
        normalized.groupsById.get('g1').children.push({
            type: 'source',
            key: 'candidate-group-only'
        });
        normalized.groupsById.set('candidate-group', {
            id: 'candidate-group',
            children: []
        });

        expect(state.root).toEqual([{ type: 'group', id: 'g1' }]);
        expect(state.ungrouped).toEqual(['bin-source']);
        expect(groupsById.has('candidate-group')).toBe(false);
        expect(groupsById.get('g1').children).toEqual([
            { type: 'source', key: 'group-source' }
        ]);

        state.root.push({ type: 'source', key: 'live-only' });
        state.ungrouped.push('live-bin-only');
        groupsById.get('g1').children.push({
            type: 'source',
            key: 'live-group-only'
        });

        expect(normalized.state.root).not.toContainEqual({
            type: 'source',
            key: 'live-only'
        });
        expect(normalized.state.ungrouped).not.toContain('live-bin-only');
        expect(normalized.groupsById.get('g1').children).not.toContainEqual({
            type: 'source',
            key: 'live-group-only'
        });
    });

    it('commitPlacementModel treats metadata property order as a semantic no-op', () => {
        const liveGroup = {
            id: 'g1',
            title: 'Folder',
            enabled: true,
            children: []
        };
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: []
            },
            groupsById: new Map([['g1', liveGroup]])
        });
        const normalized = treePlacement.normalizePlacementState({
            state: {
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: []
            },
            groupsById: new Map([[
                'g1',
                {
                    enabled: true,
                    title: 'Folder',
                    id: 'g1',
                    children: []
                }
            ]]),
            liveSourceKeys: new Set()
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const groupRef = groupsById.get('g1');

        const result = treePlacement.commitPlacementModel(normalized);

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            changed: false,
            reason: 'no_change'
        }));
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById.get('g1')).toBe(groupRef);
    });

    it('sweepPositionedRootSourcesToBin is stable and idempotent', () => {
        const { state, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'group-a' },
                    { type: 'source', key: 'source-a' },
                    { type: 'group', id: 'group-b' },
                    { type: 'source', key: 'source-b' }
                ],
                ungrouped: ['existing-bin']
            },
            groupsById: new Map([
                ['group-a', { id: 'group-a', children: [] }],
                ['group-b', { id: 'group-b', children: [] }]
            ])
        });

        expect(treePlacement.sweepPositionedRootSourcesToBin()).toBe(true);
        expect(state.root).toEqual([
            { type: 'group', id: 'group-a' },
            { type: 'group', id: 'group-b' }
        ]);
        expect(state.ungrouped).toEqual([
            'existing-bin',
            'source-a',
            'source-b'
        ]);

        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        const afterFirstSweep = cloneSerializable(state);

        expect(treePlacement.sweepPositionedRootSourcesToBin()).toBe(false);
        expect(state).toEqual(afterFirstSweep);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
    });

    it('sweepPositionedRootSourcesToBin restores source XOR in malformed root, group and bin duplicates', () => {
        const { state, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'g1' },
                    { type: 'source', key: 'A' },
                    { type: 'source', key: 'grouped' },
                    { type: 'source', key: 'B' },
                    { type: 'source', key: 'B' }
                ],
                ungrouped: ['A', 'A', 'B', 'grouped']
            },
            groupsById: new Map([[
                'g1',
                {
                    id: 'g1',
                    children: [{ type: 'source', key: 'grouped' }]
                }
            ]])
        });

        expect(treePlacement.sweepPositionedRootSourcesToBin()).toBe(true);
        expect(state.root).toEqual([{ type: 'group', id: 'g1' }]);
        expect(state.ungrouped).toEqual(['A', 'B']);
        expect(treePlacement.sweepPositionedRootSourcesToBin()).toBe(false);
        expect(state.ungrouped).toEqual(['A', 'B']);
    });

    it('sweepPositionedRootSourcesToBin repairs duplicate reachable groups and ignores unreachable precedence', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'g1' },
                    { type: 'group', id: 'g2' },
                    { type: 'source', key: 'root-only' }
                ],
                ungrouped: ['duplicate', 'root-only']
            },
            groupsById: new Map([
                ['g1', {
                    id: 'g1',
                    children: [{ type: 'source', key: 'duplicate' }]
                }],
                ['g2', {
                    id: 'g2',
                    children: [{ type: 'source', key: 'duplicate' }]
                }],
                ['unreachable', {
                    id: 'unreachable',
                    children: [{ type: 'source', key: 'root-only' }]
                }]
            ])
        });

        expect(treePlacement.sweepPositionedRootSourcesToBin()).toBe(true);
        expect(state.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'group', id: 'g2' }
        ]);
        expect(state.ungrouped).toEqual(['root-only']);
        expect(groupsById.get('g1').children).toEqual([
            { type: 'source', key: 'duplicate' }
        ]);
        expect(groupsById.get('g2').children).toEqual([]);
        expect(groupsById.has('unreachable')).toBe(false);
        expect(treePlacement.validatePlacementState({
            state,
            groupsById,
            liveSourceKeys: new Set(['duplicate', 'root-only'])
        })).toEqual({
            ok: true,
            errors: []
        });
    });

    it('sweepPositionedRootSourcesToBin rolls back when a live state assignment fails', () => {
        const { state, groupsById, treePlacement } = createHarness({
            state: {
                root: [{ type: 'source', key: 'A' }],
                ungrouped: []
            }
        });
        const rootRef = state.root;
        const ungroupedRef = state.ungrouped;
        let liveUngrouped = ungroupedRef;
        let writes = 0;
        Object.defineProperty(state, 'ungrouped', {
            configurable: true,
            enumerable: true,
            get: () => liveUngrouped,
            set: (value) => {
                writes += 1;
                if (writes === 1) throw new Error('synthetic write failure');
                liveUngrouped = value;
            }
        });

        let result;
        expect(() => {
            result = treePlacement.sweepPositionedRootSourcesToBin();
        }).not.toThrow();
        expect(result).toBe(false);
        expect(state.root).toBe(rootRef);
        expect(state.ungrouped).toBe(ungroupedRef);
        expect(groupsById.size).toBe(0);
        expect(state).toEqual({
            root: [{ type: 'source', key: 'A' }],
            ungrouped: []
        });
    });

    it('rebuildParentMap follows first reachable ownership and ignores duplicate or hidden edges', () => {
        const { treePlacement } = createHarness({
            state: {
                root: [
                    { type: 'group', id: 'parent-a' },
                    { type: 'group', id: 'parent-b' },
                    { type: 'group', id: 'child' }
                ],
                ungrouped: []
            },
            groupsById: new Map([
                ['parent-a', {
                    id: 'parent-a',
                    children: [
                        { type: 'group', id: 'child' },
                        { type: 'source', key: 'source-a' }
                    ]
                }],
                ['parent-b', {
                    id: 'parent-b',
                    children: [
                        { type: 'group', id: 'child' },
                        { type: 'source', key: 'source-a' }
                    ]
                }],
                ['child', { id: 'child', children: [] }],
                ['hidden', {
                    id: 'hidden',
                    children: [{ type: 'source', key: 'hidden-source' }]
                }]
            ])
        });
        const targetMap = new Map([['stale', 'value']]);

        expect(treePlacement.rebuildParentMap(targetMap)).toBe(targetMap);
        expect(targetMap).toEqual(new Map([
            ['child', 'parent-a'],
            ['source-a', 'parent-a']
        ]));
    });
});
