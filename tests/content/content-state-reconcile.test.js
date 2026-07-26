const createContentStateReconcile = require('../../src/content/content-state-reconcile.js');

describe('content state reconciliation guards', () => {
    const normalizeSourceText = (value) => String(value || '').trim().toLowerCase();
    const normalizeTagLabel = (value) => String(value || '').trim();
    const normalizeTagColor = (value) => value || '#5B6CFF';

    function createReconcileModule(runtime) {
        return createContentStateReconcile({
            runtime,
            normalizeSourceText,
            normalizeTagLabel,
            normalizeTagColor
        });
    }

    it('remaps existing state while tolerating legacy groups and root lists with missing arrays', () => {
        const runtime = {
            groupsById: new Map([
                ['legacy-empty', { id: 'legacy-empty', title: 'Legacy Empty' }],
                ['legacy-source', {
                    id: 'legacy-source',
                    title: 'Legacy Source',
                    children: [{ type: 'source', key: 'old-source' }]
                }]
            ]),
            state: {}
        };
        const reconcile = createReconcileModule(runtime);
        const sourceLookup = reconcile.buildSourceLookup([
            {
                key: 'new-source',
                title: 'Saved Paper',
                normalizedTitle: 'saved paper',
                stableToken: '',
                fingerprint: ''
            }
        ]);
        const previousState = {
            sourceRecordsByKey: new Map([
                ['old-source', {
                    title: 'Saved Paper',
                    normalizedTitle: 'saved paper',
                    enabled: true,
                    stableToken: '',
                    fingerprint: ''
                }]
            ]),
            sourceTagsById: new Map([
                ['old-source', ['tag-1']]
            ])
        };

        const remapped = reconcile.remapExistingStateToCurrentSources(sourceLookup, previousState);

        expect(remapped.root).toEqual([]);
        expect(remapped.ungrouped).toEqual([]);
        expect(remapped.groupsById.get('legacy-empty').children).toEqual([]);
        expect(remapped.groupsById.get('legacy-source').children).toEqual([
            { type: 'source', key: 'new-source' }
        ]);
        expect(remapped.sourceTagsById.get('new-source')).toEqual(['tag-1']);
    });

    it('remaps a POSITIONED root source across a re-scan, preserving interleaved root order', () => {
        const runtime = {
            groupsById: new Map([
                ['g1', { id: 'g1', title: 'Folder', children: [] }]
            ]),
            state: { root: [{ type: 'group', id: 'g1' }, { type: 'source', key: 'old-pos' }], ungrouped: [] }
        };
        const reconcile = createReconcileModule(runtime);
        const sourceLookup = reconcile.buildSourceLookup([
            { key: 'new-pos', title: 'Positioned Paper', normalizedTitle: 'positioned paper', stableToken: '', fingerprint: '' }
        ]);
        const previousState = {
            sourceRecordsByKey: new Map([
                ['old-pos', {
                    title: 'Positioned Paper',
                    normalizedTitle: 'positioned paper',
                    enabled: true,
                    stableToken: '',
                    fingerprint: ''
                }]
            ]),
            sourceTagsById: new Map()
        };

        const remapped = reconcile.remapExistingStateToCurrentSources(sourceLookup, previousState);

        // The positioned root source survives the re-scan with its key re-resolved, and the
        // folder/source interleave order in state.root is preserved.
        expect(remapped.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'new-pos' }
        ]);
        expect(remapped.ungrouped).toEqual([]);
    });

    it('reconcilePersistedTree preserves a positioned root source from loadedState.root', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const sourceLookup = reconcile.buildSourceLookup([
            { key: 'cur-pos', title: 'Positioned Paper', normalizedTitle: 'positioned paper', stableToken: '', fingerprint: '' }
        ]);
        const loadedState = {
            schemaVersion: 5,
            root: [
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'stored-pos' }
            ],
            groupsById: { g1: { id: 'g1', title: 'Folder', children: [] } },
            ungrouped: [],
            sourceStateById: {
                'stored-pos': { title: 'Positioned Paper', normalizedTitle: 'positioned paper', enabled: true }
            }
        };

        const reconciled = reconcile.reconcilePersistedTree(loadedState, sourceLookup);

        // On first load (reload), the positioned root source is re-resolved to the current
        // row key and kept in root order — it does NOT fall into the ungrouped bin.
        expect(reconciled.root).toEqual([
            { type: 'group', id: 'g1' },
            { type: 'source', key: 'cur-pos' }
        ]);
        expect(reconciled.ungrouped).toEqual([]);
    });

    it('reconcilePersistedTree applies group, root and bin precedence with canonical entry shapes', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const sourceLookup = reconcile.buildSourceLookup([
            { key: 'dup', title: 'Duplicate', normalizedTitle: 'duplicate', stableToken: '', fingerprint: '' },
            { key: 'root-only', title: 'Root Only', normalizedTitle: 'root only', stableToken: '', fingerprint: '' },
            { key: 'bin-only', title: 'Bin Only', normalizedTitle: 'bin only', stableToken: '', fingerprint: '' }
        ]);
        const loadedState = {
            schemaVersion: 5,
            root: [
                { type: 'group', id: 'outer' },
                { type: 'source', key: 'dup' },
                { type: 'source', key: 'root-only' }
            ],
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
            ungrouped: ['dup', 'root-only', 'bin-only'],
            sourceStateById: {}
        };

        const reconciled = reconcile.reconcilePersistedTree(loadedState, sourceLookup);

        expect(reconciled.groupsById.get('outer').children).toEqual([
            { type: 'group', id: 'inner' }
        ]);
        expect(reconciled.groupsById.get('inner').children).toEqual([
            { type: 'source', key: 'dup' }
        ]);
        expect(reconciled.root).toEqual([
            { type: 'group', id: 'outer' },
            { type: 'source', key: 'root-only' }
        ]);
        expect(reconciled.ungrouped).toEqual(['bin-only']);
        expect(reconciled.seenSourceRefs).toEqual(new Set(['dup', 'root-only', 'bin-only']));
        expect(reconciled.root.every((entry) => (
            entry && typeof entry === 'object' && typeof entry.type === 'string'
        ))).toBe(true);
        expect(reconciled.ungrouped.every((entry) => typeof entry === 'string')).toBe(true);
    });
});
