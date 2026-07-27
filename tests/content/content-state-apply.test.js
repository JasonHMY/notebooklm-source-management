const createContentStateApply = require('../../src/content/content-state-apply.js');
const createContentTreePlacement = require('../../src/content/content-tree-placement.js');

function createRuntime(overrides = {}) {
    return {
        state: { root: [], ungrouped: [], tagOrder: [], activeTagId: null, isBatchMode: true },
        pendingBatchKeys: new Set(['stale']),
        groupsById: new Map(),
        tagsById: new Map(),
        sourceTagsById: new Map(),
        sourcesByKey: new Map(),
        shadowRoot: null,
        customHeight: undefined,
        ...overrides
    };
}

function createDeps(overrides = {}) {
    const passThroughClone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
    return {
        cloneSerializableData: jest.fn(passThroughClone),
        normalizeLoadedState: jest.fn((value) => value),
        hasPersistableManagerState: jest.fn(() => true),
        normalizeSourceText: jest.fn((value) => String(value || '').trim().toLowerCase()),
        buildParentMap: jest.fn(),
        syncSourceToPage: jest.fn(),
        isSourceEffectivelyEnabled: jest.fn(() => true),
        ...overrides
    };
}

function createStateApply(runtime, deps) {
    const treePlacement = deps.treePlacement || createContentTreePlacement({
        getState: () => runtime.state,
        getGroupsById: () => runtime.groupsById
    });
    return createContentStateApply({ runtime, ...deps, treePlacement });
}

describe('content state apply helper', () => {
    it('throws when the required clone/normalize/hasPersistable deps are missing', () => {
        const runtime = createRuntime();
        expect(() => createContentStateApply({ runtime })).toThrow(/createContentStateApply requires/);
    });

    it('returns false and skips mutation when the snapshot has no persistable manager state', () => {
        const runtime = createRuntime();
        const deps = createDeps({ hasPersistableManagerState: jest.fn(() => false) });
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({ groups: ['g1'], ungrouped: ['s1'] });

        expect(result).toBe(false);
        expect(deps.buildParentMap).not.toHaveBeenCalled();
        expect(deps.syncSourceToPage).not.toHaveBeenCalled();
        expect(runtime.state.root).toEqual([]);
    });

    it('fails closed before any runtime mutation when placement normalization rejects the snapshot', () => {
        const runtime = createRuntime({
            state: {
                root: [{ type: 'source', key: 'keep' }],
                ungrouped: [],
                tagOrder: ['keep-tag'],
                activeTagId: null,
                isBatchMode: true
            },
            pendingBatchKeys: new Set(['keep']),
            groupsById: new Map(),
            sourcesByKey: new Map([['keep', { key: 'keep' }]])
        });
        const treePlacement = {
            normalizePlacementState: jest.fn(() => ({
                ok: false,
                changed: false,
                reason: 'invalid_model'
            })),
            commitPlacementModel: jest.fn()
        };
        const deps = createDeps({ treePlacement });
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [{ type: 'group', id: 'cycle' }],
            ungrouped: [],
            groupsById: {
                cycle: {
                    id: 'cycle',
                    children: [{ type: 'group', id: 'cycle' }]
                }
            },
            sourceStateById: {}
        });

        expect(result).toBe(false);
        expect(treePlacement.normalizePlacementState).toHaveBeenCalledTimes(1);
        expect(treePlacement.commitPlacementModel).not.toHaveBeenCalled();
        expect(runtime.state).toEqual({
            root: [{ type: 'source', key: 'keep' }],
            ungrouped: [],
            tagOrder: ['keep-tag'],
            activeTagId: null,
            isBatchMode: true
        });
        expect(runtime.pendingBatchKeys).toEqual(new Set(['keep']));
        expect(deps.buildParentMap).not.toHaveBeenCalled();
        expect(deps.syncSourceToPage).not.toHaveBeenCalled();
    });

    it('rejects malformed source metadata before committing placement or tag changes', () => {
        const runtime = createRuntime({
            state: {
                root: [{ type: 'source', key: 'keep' }],
                ungrouped: [],
                tagOrder: ['keep-tag'],
                activeTagId: null,
                isBatchMode: true
            },
            groupsById: new Map(),
            tagsById: new Map([['keep-tag', { id: 'keep-tag', label: 'Keep' }]]),
            sourcesByKey: new Map([['keep', { key: 'keep', enabled: true }]])
        });
        const treePlacement = {
            normalizePlacementState: jest.fn(),
            commitPlacementModel: jest.fn()
        };
        const deps = createDeps({ treePlacement });
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [{ type: 'group', id: 'new-group' }],
            ungrouped: [],
            groupsById: {
                'new-group': { id: 'new-group', children: [] }
            },
            tagsById: {
                'new-tag': { id: 'new-tag', label: 'New' }
            },
            tagOrder: ['new-tag'],
            sourceStateById: { keep: null }
        });

        expect(result).toBe(false);
        expect(treePlacement.normalizePlacementState).not.toHaveBeenCalled();
        expect(treePlacement.commitPlacementModel).not.toHaveBeenCalled();
        expect(runtime.state.root).toEqual([{ type: 'source', key: 'keep' }]);
        expect(runtime.state.tagOrder).toEqual(['keep-tag']);
        expect(runtime.tagsById.has('keep-tag')).toBe(true);
        expect(runtime.tagsById.has('new-tag')).toBe(false);
        expect(deps.buildParentMap).not.toHaveBeenCalled();
        expect(deps.syncSourceToPage).not.toHaveBeenCalled();
    });

    it('keeps a positioned root source out of the bin and de-dups a key present in both root and ungrouped', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([
                ['positioned', { key: 'positioned' }],
                ['dup', { key: 'dup' }],
                ['orphan', { key: 'orphan' }]
            ])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        // 'dup' appears in BOTH state.root (positioned) and the bin — a malformed snapshot.
        const result = applyPersistableSnapshotToRuntime({
            root: [
                { type: 'source', key: 'positioned' },
                { type: 'source', key: 'dup' }
            ],
            ungrouped: ['dup'],
            groupsById: {},
            sourceStateById: {}
        });

        expect(result).toBe(true);
        // Positioned sources stay in state.root, order preserved.
        expect(runtime.state.root).toEqual([
            { type: 'source', key: 'positioned' },
            { type: 'source', key: 'dup' }
        ]);
        // Tree Placement removes 'dup' from the bin (root wins) and places the live orphan there.
        expect(runtime.state.ungrouped).toEqual(['orphan']);
    });

    it('applies reachable group, positioned root and bin precedence with canonical entry shapes', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([
                ['dup', { key: 'dup' }],
                ['root-only', { key: 'root-only' }],
                ['bin-only', { key: 'bin-only' }],
                ['orphan', { key: 'orphan' }]
            ])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [
                { type: 'group', id: 'outer' },
                { type: 'source', key: 'dup' },
                { type: 'source', key: 'root-only' }
            ],
            ungrouped: ['dup', 'root-only', 'bin-only'],
            groupsById: {
                outer: {
                    id: 'outer',
                    children: [{ type: 'group', id: 'inner' }]
                },
                inner: {
                    id: 'inner',
                    children: [{ type: 'source', key: 'dup' }]
                }
            },
            sourceStateById: {}
        });

        expect(result).toBe(true);
        expect(runtime.groupsById.get('outer').children).toEqual([
            { type: 'group', id: 'inner' }
        ]);
        expect(runtime.groupsById.get('inner').children).toEqual([
            { type: 'source', key: 'dup' }
        ]);
        expect(runtime.state.root).toEqual([
            { type: 'group', id: 'outer' },
            { type: 'source', key: 'root-only' }
        ]);
        expect(runtime.state.ungrouped).toEqual(['bin-only', 'orphan']);
        expect(runtime.state.root.every((entry) => (
            entry && typeof entry === 'object' && typeof entry.type === 'string'
        ))).toBe(true);
        expect(runtime.state.ungrouped.every((entry) => typeof entry === 'string')).toBe(true);
    });

    it('removes a closing group cycle while preserving legal children before applying', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([
                ['legal', { key: 'legal' }],
                ['orphan', { key: 'orphan' }]
            ])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [{ type: 'group', id: 'a' }],
            groupsById: {
                a: {
                    id: 'a',
                    children: [{ type: 'group', id: 'b' }]
                },
                b: {
                    id: 'b',
                    children: [
                        { type: 'group', id: 'a' },
                        { type: 'source', key: 'legal' }
                    ]
                }
            },
            ungrouped: [],
            tagOrder: [],
            sourceStateById: {}
        });

        expect(result).toBe(true);
        expect(runtime.groupsById.get('a').children).toEqual([
            { type: 'group', id: 'b' }
        ]);
        expect(runtime.groupsById.get('b').children).toEqual([
            { type: 'source', key: 'legal' }
        ]);
        expect(runtime.state.ungrouped).toEqual(['orphan']);
    });

    it('clears prior collections and writes snapshot groups, ungrouped and tag order', () => {
        const runtime = createRuntime({
            state: { root: [{ type: 'group', id: 'old' }], ungrouped: ['old-source'], tagOrder: ['old-tag'], activeTagId: 't1', isBatchMode: true },
            groupsById: new Map([['old', { id: 'old', children: [] }]]),
            tagsById: new Map([['old-tag', { id: 'old-tag', label: 'X' }]]),
            sourceTagsById: new Map([['old-source', ['old-tag']]]),
            sourcesByKey: new Map([['s1', { key: 's1' }]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const snapshot = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['s1'],
            tagOrder: ['t1'],
            groupsById: { g1: { id: 'g1', name: 'Folder', children: [] } },
            tagsById: { t1: { id: 't1', label: 'Tag' } },
            sourceTagsById: { s1: ['t1'] },
            sourceStateById: {}
        };

        const result = applyPersistableSnapshotToRuntime(snapshot);

        expect(result).toBe(true);
        expect(runtime.state.root).toEqual([{ type: 'group', id: 'g1' }]);
        expect(runtime.state.ungrouped).toEqual(['s1']);
        expect(runtime.state.tagOrder).toEqual(['t1']);
        expect(runtime.state.isBatchMode).toBe(false);
        expect(runtime.pendingBatchKeys.size).toBe(0);
        expect(runtime.groupsById.has('g1')).toBe(true);
        expect(runtime.groupsById.has('old')).toBe(false);
        expect(runtime.tagsById.has('t1')).toBe(true);
        expect(runtime.tagsById.has('old-tag')).toBe(false);
        expect(runtime.sourceTagsById.get('s1')).toEqual(['t1']);
        expect(runtime.sourceTagsById.has('old-source')).toBe(false);
    });

    it('restores only safe source fields without overwriting live identity metadata', () => {
        const sourceA = {
            key: 'a',
            enabled: false,
            title: 'Live title',
            normalizedTitle: 'live title',
            stableToken: 'live-token',
            fingerprint: 'live-fingerprint',
            identityType: 'stable-token',
            addedAt: '2026-01-01'
        };
        const runtime = createRuntime({
            sourcesByKey: new Map([['a', sourceA]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            sourceStateById: {
                a: {
                    enabled: true,
                    title: 'Stored title',
                    normalizedTitle: 'stored title',
                    stableToken: 'stored-token',
                    fingerprint: 'stored-fingerprint',
                    identityType: 'fingerprint',
                    addedAt: '2026-01-02'
                }
            }
        });

        expect(sourceA.enabled).toBe(true);
        expect(sourceA.title).toBe('Live title');
        expect(sourceA.normalizedTitle).toBe('live title');
        expect(sourceA.stableToken).toBe('live-token');
        expect(sourceA.fingerprint).toBe('live-fingerprint');
        expect(sourceA.identityType).toBe('stable-token');
        expect(sourceA.addedAt).toBe('2026-01-02');
    });

    it('appends sources missing from the snapshot tree into ungrouped', () => {
        const known = { key: 'known' };
        const orphan = { key: 'orphan' };
        const runtime = createRuntime({
            sourcesByKey: new Map([['known', known], ['orphan', orphan]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: [],
            tagOrder: [],
            groupsById: { g1: { id: 'g1', children: [{ type: 'source', key: 'known' }] } },
            sourceStateById: {}
        });

        expect(runtime.state.ungrouped).toEqual(['orphan']);
    });

    it('clears activeTagId when the tag is no longer present after apply', () => {
        const runtime = createRuntime({
            state: { groups: [], ungrouped: [], tagOrder: [], activeTagId: 'gone', isBatchMode: false }
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            tagsById: {},
            sourceStateById: {}
        });

        expect(runtime.state.activeTagId).toBeNull();
    });

    it('writes customHeight to runtime and the .sp-container style when provided', () => {
        const container = { style: {} };
        const shadowRoot = { querySelector: jest.fn((selector) => (selector === '.sp-container' ? container : null)) };
        const runtime = createRuntime({ shadowRoot });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            customHeight: 420,
            sourceStateById: {}
        });

        expect(runtime.customHeight).toBe(420);
        expect(container.style.height).toBe('420px');
    });

    it('clears an imported inline height when the restored snapshot customHeight is null', () => {
        const container = { style: { height: '640px' } };
        const shadowRoot = { querySelector: jest.fn((selector) => (selector === '.sp-container' ? container : null)) };
        const runtime = createRuntime({ shadowRoot, customHeight: 640 });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            customHeight: null,
            sourceStateById: {}
        });

        expect(runtime.customHeight).toBeNull();
        expect(container.style.height).toBe('');
    });

    it('applies a canonical source view display preference', () => {
        const runtime = createRuntime({ sourceViewDisplayKind: 'list' });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {},
            sourceViewDisplayKind: 'label'
        });

        expect(result).toBe(true);
        expect(runtime.sourceViewDisplayKind).toBe('label');
    });

    it('rolls back tree, metadata and transient state when post-commit sync throws', () => {
        const container = { style: { height: '300px' } };
        const source = { key: 'source', enabled: false, addedAt: 'before' };
        const runtime = createRuntime({
            state: {
                root: [{ type: 'group', id: 'before-group' }],
                ungrouped: [],
                tagOrder: ['before-tag'],
                activeTagId: 'before-tag',
                isBatchMode: true
            },
            pendingBatchKeys: new Set(['source']),
            groupsById: new Map([[
                'before-group',
                {
                    id: 'before-group',
                    children: [{ type: 'source', key: 'source' }]
                }
            ]]),
            tagsById: new Map([['before-tag', { id: 'before-tag', label: 'Before' }]]),
            sourceTagsById: new Map([['source', ['before-tag']]]),
            sourcesByKey: new Map([['source', source]]),
            shadowRoot: {
                querySelector: jest.fn((selector) => (
                    selector === '.sp-container' ? container : null
                ))
            },
            customHeight: 300,
            sourceViewDisplayKind: 'list'
        });
        const deps = createDeps({
            syncSourceToPage: jest.fn(() => {
                throw new Error('native sync failed');
            })
        });
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        const result = applyPersistableSnapshotToRuntime({
            root: [{ type: 'group', id: 'after-group' }],
            groupsById: {
                'after-group': {
                    id: 'after-group',
                    children: [{ type: 'source', key: 'source' }]
                }
            },
            ungrouped: [],
            tagsById: {
                'after-tag': { id: 'after-tag', label: 'After' }
            },
            tagOrder: ['after-tag'],
            sourceTagsById: {
                source: ['after-tag']
            },
            sourceStateById: {
                source: { enabled: true, addedAt: 'after' }
            },
            customHeight: 420,
            sourceViewDisplayKind: 'label'
        });

        expect(result).toBe(false);
        expect(runtime.state).toEqual({
            root: [{ type: 'group', id: 'before-group' }],
            ungrouped: [],
            tagOrder: ['before-tag'],
            activeTagId: 'before-tag',
            isBatchMode: true
        });
        expect(runtime.groupsById.get('before-group').children).toEqual([
            { type: 'source', key: 'source' }
        ]);
        expect(runtime.groupsById.has('after-group')).toBe(false);
        expect(runtime.tagsById).toEqual(new Map([[
            'before-tag',
            { id: 'before-tag', label: 'Before' }
        ]]));
        expect(runtime.sourceTagsById).toEqual(new Map([['source', ['before-tag']]]));
        expect(source).toMatchObject({ enabled: false, addedAt: 'before' });
        expect(runtime.pendingBatchKeys).toEqual(new Set(['source']));
        expect(runtime.customHeight).toBe(300);
        expect(runtime.sourceViewDisplayKind).toBe('list');
        expect(container.style.height).toBe('300px');
    });

    it('invokes buildParentMap once and syncSourceToPage for each tracked source', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([['a', { key: 'a' }], ['b', { key: 'b' }]])
        });
        const deps = createDeps({ isSourceEffectivelyEnabled: jest.fn((source) => source.key === 'a') });
        const { applyPersistableSnapshotToRuntime } = createStateApply(runtime, deps);

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            sourceStateById: {}
        });

        expect(deps.buildParentMap).toHaveBeenCalledTimes(1);
        expect(deps.syncSourceToPage).toHaveBeenCalledTimes(2);
        expect(deps.syncSourceToPage).toHaveBeenCalledWith({ key: 'a' }, true);
        expect(deps.syncSourceToPage).toHaveBeenCalledWith({ key: 'b' }, false);
        expect(deps.buildParentMap.mock.invocationCallOrder[0]).toBeLessThan(
            Math.min(...deps.syncSourceToPage.mock.invocationCallOrder)
        );
    });
});
