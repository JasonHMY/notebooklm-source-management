const createContentStateApply = require('../../src/content/content-state-apply.js');

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

describe('content state apply helper', () => {
    it('throws when the required clone/normalize/hasPersistable deps are missing', () => {
        const runtime = createRuntime();
        expect(() => createContentStateApply({ runtime })).toThrow(/createContentStateApply requires/);
    });

    it('returns false and skips mutation when the snapshot has no persistable manager state', () => {
        const runtime = createRuntime();
        const deps = createDeps({ hasPersistableManagerState: jest.fn(() => false) });
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

        const result = applyPersistableSnapshotToRuntime({ groups: ['g1'], ungrouped: ['s1'] });

        expect(result).toBe(false);
        expect(deps.buildParentMap).not.toHaveBeenCalled();
        expect(deps.syncSourceToPage).not.toHaveBeenCalled();
        expect(runtime.state.root).toEqual([]);
    });

    it('keeps a positioned root source out of the bin (orphan sweep leaves it put) and de-dups a key present in both root and ungrouped', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([
                ['positioned', { key: 'positioned' }],
                ['dup', { key: 'dup' }],
                ['orphan', { key: 'orphan' }]
            ])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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
        // 'dup' is removed from the bin (root placement wins); only the genuine orphan is swept in.
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
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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

    it('clears prior collections and writes snapshot groups, ungrouped and tag order', () => {
        const runtime = createRuntime({
            state: { root: [{ type: 'group', id: 'old' }], ungrouped: ['old-source'], tagOrder: ['old-tag'], activeTagId: 't1', isBatchMode: true },
            groupsById: new Map([['old', { id: 'old', children: [] }]]),
            tagsById: new Map([['old-tag', { id: 'old-tag', label: 'X' }]]),
            sourceTagsById: new Map([['old-source', ['old-tag']]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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

    it('updates existing source fields from sourceStateById without overwriting unset values', () => {
        const sourceA = { key: 'a', enabled: false, title: 'Old', stableToken: 'tok', addedAt: '2026-01-01' };
        const runtime = createRuntime({
            sourcesByKey: new Map([['a', sourceA]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

        applyPersistableSnapshotToRuntime({
            groups: [],
            ungrouped: [],
            tagOrder: [],
            sourceStateById: {
                a: { enabled: true, title: 'New', normalizedTitle: 'new' }
            }
        });

        expect(sourceA.enabled).toBe(true);
        expect(sourceA.title).toBe('New');
        expect(sourceA.normalizedTitle).toBe('new');
        expect(sourceA.stableToken).toBe('tok');
        expect(sourceA.addedAt).toBe('2026-01-01');
    });

    it('appends sources missing from the snapshot tree into ungrouped', () => {
        const known = { key: 'known' };
        const orphan = { key: 'orphan' };
        const runtime = createRuntime({
            sourcesByKey: new Map([['known', known], ['orphan', orphan]])
        });
        const deps = createDeps();
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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

    it('invokes buildParentMap once and syncSourceToPage for each tracked source', () => {
        const runtime = createRuntime({
            sourcesByKey: new Map([['a', { key: 'a' }], ['b', { key: 'b' }]])
        });
        const deps = createDeps({ isSourceEffectivelyEnabled: jest.fn((source) => source.key === 'a') });
        const { applyPersistableSnapshotToRuntime } = createContentStateApply({ runtime, ...deps });

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
    });
});
