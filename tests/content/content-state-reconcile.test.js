const createContentStateReconcile = require('../../src/content/content-state-reconcile.js');
const createContentTreePlacement = require('../../src/content/content-tree-placement.js');

describe('content state reconciliation guards', () => {
    const normalizeSourceText = (value) => String(value || '').trim().toLowerCase();
    const normalizeTagLabel = (value) => String(value || '').trim();
    const normalizeTagColor = (value) => value || '#5B6CFF';

    function createReconcileModule(runtime) {
        const treePlacement = createContentTreePlacement({
            getState: () => runtime.state || { root: [], ungrouped: [] },
            getGroupsById: () => runtime.groupsById || new Map()
        });
        return createContentStateReconcile({
            runtime,
            normalizeSourceText,
            normalizeTagLabel,
            normalizeTagColor,
            treePlacement
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

    it('reconcilePersistedTree delegates the remapped model to placement normalization', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const sourceLookup = reconcile.buildSourceLookup([
            { key: 'dup', title: 'Duplicate', normalizedTitle: 'duplicate', stableToken: '', fingerprint: '' },
            { key: 'legal', title: 'Legal', normalizedTitle: 'legal', stableToken: '', fingerprint: '' },
            { key: 'orphan', title: 'Orphan', normalizedTitle: 'orphan', stableToken: '', fingerprint: '' }
        ]);
        const loadedState = {
            schemaVersion: 5,
            root: [
                { type: 'group', id: 'a' },
                { type: 'source', key: 'dup' }
            ],
            groupsById: {
                a: {
                    id: 'a',
                    children: [
                        { type: 'group', id: 'b' },
                        { type: 'source', key: 'dup' }
                    ]
                },
                b: {
                    id: 'b',
                    children: [
                        { type: 'group', id: 'a' },
                        { type: 'source', key: 'legal' }
                    ]
                }
            },
            ungrouped: ['dup'],
            sourceStateById: {}
        };

        const reconciled = reconcile.reconcilePersistedTree(loadedState, sourceLookup);

        expect(reconciled.groupsById.get('a').children).toEqual([
            { type: 'group', id: 'b' },
            { type: 'source', key: 'dup' }
        ]);
        expect(reconciled.groupsById.get('b').children).toEqual([
            { type: 'source', key: 'legal' }
        ]);
        expect(reconciled.root).toEqual([{ type: 'group', id: 'a' }]);
        expect(reconciled.ungrouped).toEqual(['orphan']);
        expect(reconciled.seenSourceRefs).toEqual(new Set(['dup', 'legal', 'orphan']));
    });

    it('keeps first-load and later-sync precedence identical when an unreachable group is visited first', () => {
        const runtime = {
            groupsById: new Map([
                ['hidden', {
                    id: 'hidden',
                    enabled: true,
                    collapsed: false,
                    children: [{ type: 'source', key: 'stored-source' }]
                }],
                ['reachable', {
                    id: 'reachable',
                    enabled: true,
                    collapsed: false,
                    children: [{ type: 'source', key: 'stored-source' }]
                }]
            ]),
            state: {
                root: [{ type: 'group', id: 'reachable' }],
                ungrouped: []
            }
        };
        const reconcile = createReconcileModule(runtime);
        const sourceLookup = reconcile.buildSourceLookup([
            {
                key: 'current-source',
                title: 'Shared source',
                normalizedTitle: 'shared source',
                stableToken: '',
                fingerprint: ''
            }
        ]);
        const sourceRecord = {
            title: 'Shared source',
            normalizedTitle: 'shared source',
            enabled: true,
            stableToken: '',
            fingerprint: ''
        };
        const loadedState = {
            root: [{ type: 'group', id: 'reachable' }],
            groupsById: Object.fromEntries(runtime.groupsById),
            ungrouped: [],
            sourceStateById: {
                'stored-source': sourceRecord
            }
        };
        const firstLoad = reconcile.reconcilePersistedTree(loadedState, sourceLookup);
        const laterCandidate = reconcile.remapExistingStateToCurrentSources(sourceLookup, {
            sourceRecordsByKey: new Map([['stored-source', sourceRecord]]),
            sourceTagsById: new Map()
        });
        const treePlacement = createContentTreePlacement({
            getState: () => runtime.state,
            getGroupsById: () => runtime.groupsById
        });
        const laterSync = treePlacement.normalizePlacementState({
            state: {
                ...runtime.state,
                root: laterCandidate.root,
                ungrouped: laterCandidate.ungrouped
            },
            groupsById: laterCandidate.groupsById,
            liveSourceKeys: new Set(['current-source'])
        });

        expect(firstLoad.ok).toBe(true);
        expect(laterSync.ok).toBe(true);
        expect(laterSync.state.root).toEqual(firstLoad.root);
        expect(laterSync.state.ungrouped).toEqual(firstLoad.ungrouped);
        expect(Object.fromEntries(laterSync.groupsById)).toEqual(
            Object.fromEntries(firstLoad.groupsById)
        );
        expect(firstLoad.groupsById.get('reachable').children).toEqual([
            { type: 'source', key: 'current-source' }
        ]);
        expect(firstLoad.groupsById.has('hidden')).toBe(false);
    });

    it('keeps duplicate remap candidates until reachable placement precedence is known', () => {
        const runtime = {
            state: {
                root: [{ type: 'group', id: 'reachable' }],
                ungrouped: []
            },
            groupsById: new Map()
        };
        const reconcile = createReconcileModule(runtime);
        const remapped = reconcile.applySourceRemapsToSnapshot({
            root: [{ type: 'group', id: 'reachable' }],
            groupsById: {
                hidden: {
                    id: 'hidden',
                    children: [{ type: 'source', key: 'stored-hidden' }]
                },
                reachable: {
                    id: 'reachable',
                    children: [{ type: 'source', key: 'stored-reachable' }]
                }
            },
            ungrouped: [],
            sourceStateById: {
                'stored-hidden': { enabled: true },
                'stored-reachable': { enabled: true }
            }
        }, new Map([
            ['stored-hidden', 'live-source'],
            ['stored-reachable', 'live-source']
        ]));

        expect(remapped.groupsById.hidden.children).toEqual([
            { type: 'source', key: 'live-source' }
        ]);
        expect(remapped.groupsById.reachable.children).toEqual([
            { type: 'source', key: 'live-source' }
        ]);

        const treePlacement = createContentTreePlacement({
            getState: () => runtime.state,
            getGroupsById: () => runtime.groupsById
        });
        const normalized = treePlacement.normalizePlacementState({
            state: remapped,
            groupsById: remapped.groupsById,
            liveSourceKeys: new Set(['live-source'])
        });

        expect(normalized.ok).toBe(true);
        expect(normalized.groupsById.has('hidden')).toBe(false);
        expect(normalized.groupsById.get('reachable').children).toEqual([
            { type: 'source', key: 'live-source' }
        ]);
        expect(normalized.state.ungrouped).toEqual([]);
    });

    it('does not remap group children inherited through Object.prototype', () => {
        const priorChildrenDescriptor = Object.getOwnPropertyDescriptor(
            Object.prototype,
            'children'
        );
        Object.defineProperty(Object.prototype, 'children', {
            configurable: true,
            value: [{ type: 'source', key: 'stored-source' }]
        });
        try {
            const reconcile = createReconcileModule({
                state: { root: [], ungrouped: [] },
                groupsById: new Map()
            });
            const remapped = reconcile.applySourceRemapsToSnapshot({
                root: [{ type: 'group', id: 'group-a' }],
                groupsById: {
                    'group-a': { id: 'group-a' }
                },
                ungrouped: [],
                sourceStateById: {
                    'stored-source': { enabled: true }
                },
                sourceTagsById: {}
            }, new Map([
                ['stored-source', 'live-source']
            ]));

            expect(Object.prototype.hasOwnProperty.call(
                remapped.groupsById['group-a'],
                'children'
            )).toBe(false);
            expect(remapped.sourceStateById).toEqual({
                'live-source': { enabled: true }
            });
        } finally {
            if (priorChildrenDescriptor) {
                Object.defineProperty(
                    Object.prototype,
                    'children',
                    priorChildrenDescriptor
                );
            } else {
                delete Object.prototype.children;
            }
        }
    });

    it('uses reachable placement order when remap candidates collide on metadata', () => {
        const runtime = {
            groupsById: new Map([
                ['hidden', {
                    id: 'hidden',
                    children: [{ type: 'source', key: 'stored-hidden' }]
                }],
                ['reachable', {
                    id: 'reachable',
                    children: [{ type: 'source', key: 'stored-reachable' }]
                }]
            ]),
            state: {
                root: [{ type: 'group', id: 'reachable' }],
                ungrouped: []
            }
        };
        const reconcile = createReconcileModule(runtime);
        const sourceLookup = reconcile.buildSourceLookup([{
            key: 'live-source',
            title: 'Shared source',
            normalizedTitle: 'shared source',
            stableToken: '',
            fingerprint: ''
        }]);
        const hiddenRecord = {
            title: 'Shared source',
            normalizedTitle: 'shared source',
            enabled: false
        };
        const reachableRecord = {
            title: 'Shared source',
            normalizedTitle: 'shared source',
            enabled: true
        };
        const remapped = reconcile.remapExistingStateToCurrentSources(sourceLookup, {
            sourceRecordsByKey: new Map([
                ['stored-hidden', hiddenRecord],
                ['stored-reachable', reachableRecord]
            ]),
            sourceTagsById: new Map([
                ['stored-hidden', ['hidden-tag']],
                ['stored-reachable', ['reachable-tag']]
            ])
        });

        expect(remapped.sourceStateById.get('live-source')).toBe(reachableRecord);
        expect(remapped.sourceTagsById.get('live-source')).toEqual(['reachable-tag']);
    });

    it('uses canonical placement order for first-load source state and tags', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const sourceLookup = reconcile.buildSourceLookup([{
            key: 'live-source',
            title: 'Shared source',
            normalizedTitle: 'shared source',
            stableToken: '',
            fingerprint: ''
        }]);
        const loadedState = {
            root: [{ type: 'group', id: 'reachable' }],
            groupsById: {
                hidden: {
                    id: 'hidden',
                    children: [{ type: 'source', key: 'stored-hidden' }]
                },
                reachable: {
                    id: 'reachable',
                    children: [{ type: 'source', key: 'stored-reachable' }]
                }
            },
            ungrouped: [],
            sourceStateById: {
                'stored-hidden': {
                    title: 'Shared source',
                    normalizedTitle: 'shared source',
                    enabled: false
                },
                'stored-reachable': {
                    title: 'Shared source',
                    normalizedTitle: 'shared source',
                    enabled: true
                }
            },
            sourceTagsById: {
                'stored-hidden': ['hidden-tag'],
                'stored-reachable': ['reachable-tag']
            }
        };

        expect(reconcile.buildResolvedSourceStateById(sourceLookup, loadedState).get('live-source'))
            .toMatchObject({ enabled: true });
        expect(reconcile.buildResolvedSourceTagsById(sourceLookup, loadedState).get('live-source'))
            .toEqual(['reachable-tag']);
    });

    it('ignores malformed source records and inherited tag ids during first-load normalization', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const sourceLookup = reconcile.buildSourceLookup([{
            key: 'live-source',
            title: 'Live source',
            normalizedTitle: 'live source',
            stableToken: '',
            fingerprint: ''
        }]);

        const resolvedSourceState = reconcile.buildResolvedSourceStateById(sourceLookup, {
            sourceStateById: {
                'live-source': null
            }
        });
        const normalizedTags = reconcile.buildNormalizedTagState({
            tagsById: {},
            tagOrder: ['constructor', 'toString']
        });

        expect(resolvedSourceState.has('live-source')).toBe(false);
        expect(normalizedTags.nextTagsById.size).toBe(0);
        expect(normalizedTags.nextTagOrder).toEqual([]);
        expect(normalizedTags.rawToSafeTagId.size).toBe(0);
    });

    it('does not read inherited tag fields from an own imported tag record', () => {
        const priorLabelDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'label');
        Object.defineProperty(Object.prototype, 'label', {
            configurable: true,
            value: 'Inherited tag'
        });
        try {
            const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
            const normalizedTags = reconcile.buildNormalizedTagState({
                tagsById: {
                    safe: {}
                },
                tagOrder: ['safe']
            });

            expect(normalizedTags.nextTagsById.size).toBe(0);
            expect(normalizedTags.nextTagOrder).toEqual([]);
        } finally {
            if (priorLabelDescriptor) {
                Object.defineProperty(Object.prototype, 'label', priorLabelDescriptor);
            } else {
                delete Object.prototype.label;
            }
        }
    });

    it('does not collect group children inherited through Object.prototype', () => {
        const priorChildrenDescriptor = Object.getOwnPropertyDescriptor(
            Object.prototype,
            'children'
        );
        Object.defineProperty(Object.prototype, 'children', {
            configurable: true,
            value: [{ type: 'source', key: 'inherited-source' }]
        });
        try {
            const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
            const refs = reconcile.collectPersistedSourceRefs({
                root: [{ type: 'group', id: 'g1' }],
                groupsById: {
                    g1: { id: 'g1' }
                },
                ungrouped: [],
                sourceStateById: {},
                sourceTagsById: {}
            });

            expect(refs.has('inherited-source')).toBe(false);
            expect(refs.size).toBe(0);
        } finally {
            if (priorChildrenDescriptor) {
                Object.defineProperty(
                    Object.prototype,
                    'children',
                    priorChildrenDescriptor
                );
            } else {
                delete Object.prototype.children;
            }
        }
    });

    it('does not collect tree entry fields inherited through Object.prototype', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const priorTypeDescriptor = Object.getOwnPropertyDescriptor(
            Object.prototype,
            'type'
        );
        const priorKeyDescriptor = Object.getOwnPropertyDescriptor(
            Object.prototype,
            'key'
        );
        let refs;
        Object.defineProperty(Object.prototype, 'type', {
            configurable: true,
            value: 'source'
        });
        Object.defineProperty(Object.prototype, 'key', {
            configurable: true,
            value: 'inherited-source'
        });
        try {
            refs = reconcile.collectPersistedSourceRefs({
                root: [{ type: 'group', id: 'g1' }, {}],
                groupsById: {
                    g1: {
                        id: 'g1',
                        children: [{}]
                    }
                },
                ungrouped: [],
                sourceStateById: {},
                sourceTagsById: {}
            });
        } finally {
            if (priorTypeDescriptor) {
                Object.defineProperty(Object.prototype, 'type', priorTypeDescriptor);
            } else {
                delete Object.prototype.type;
            }
            if (priorKeyDescriptor) {
                Object.defineProperty(Object.prototype, 'key', priorKeyDescriptor);
            } else {
                delete Object.prototype.key;
            }
        }

        expect(refs.has('inherited-source')).toBe(false);
        expect(refs.size).toBe(0);
    });

    it('treats prototype-named source refs as ordinary unmatched keys', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const report = reconcile.buildSourceMatchReport({
            root: [{ type: 'source', key: 'constructor' }],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {}
        }, reconcile.buildSourceLookup([]));

        expect(report.matched).toEqual([]);
        expect(report.ambiguous).toEqual([]);
        expect(report.unmatched).toEqual([
            expect.objectContaining({
                storedKey: 'constructor',
                title: 'constructor',
                reason: 'unresolved'
            })
        ]);
    });

    it('collects positioned root sources and traverses deeply nested persisted groups iteratively', () => {
        const reconcile = createReconcileModule({ groupsById: new Map(), state: {} });
        const groupsById = {};
        const depth = 12_000;
        for (let index = 0; index < depth; index += 1) {
            const groupId = `group-${index}`;
            groupsById[groupId] = {
                id: groupId,
                children: index === depth - 1
                    ? [{ type: 'source', key: 'deep-source' }]
                    : [{ type: 'group', id: `group-${index + 1}` }]
            };
        }
        const snapshot = {
            root: [
                { type: 'group', id: 'group-0' },
                { type: 'source', key: 'root-source' }
            ],
            groupsById,
            ungrouped: [],
            sourceStateById: {},
            sourceTagsById: {
                'tag-only-source': ['tag-1']
            }
        };
        const sourceLookup = reconcile.buildSourceLookup([
            {
                key: 'deep-source',
                title: 'Deep source',
                normalizedTitle: 'deep source',
                stableToken: '',
                fingerprint: ''
            },
            {
                key: 'root-source',
                title: 'Root source',
                normalizedTitle: 'root source',
                stableToken: '',
                fingerprint: ''
            }
        ]);

        expect(() => reconcile.collectPersistedSourceRefs(snapshot)).not.toThrow();
        expect(reconcile.collectPersistedSourceRefs(snapshot)).toEqual(new Set([
            'deep-source',
            'root-source',
            'tag-only-source'
        ]));
        expect(() => reconcile.buildResolvedSourceStateById(sourceLookup, {
            ...snapshot,
            sourceStateById: {
                'deep-source': { enabled: true },
                'root-source': { enabled: false }
            }
        })).not.toThrow();
    });
});
