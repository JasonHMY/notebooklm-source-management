require('../../src/content/content-search-semantics.js');
const createContentViewState = require('../../src/content/content-view-state.js');

describe('content quick view filters', () => {
    const createStateModule = ({ state, sourcesByKey, groupsById = new Map(), parentMap = new Map(), sourceTagsById = new Map() }) => (
        createContentViewState({
            getState: () => state,
            getSourcesByKey: () => sourcesByKey,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getTagsById: () => new Map([
                ['tag-ai', { id: 'tag-ai', label: 'AI' }]
            ]),
            getSourceTagIds: (sourceKey) => sourceTagsById.get(sourceKey) || [],
            getNow: () => new Date('2026-05-18T00:00:00.000Z')
        })
    );

    it('filters ungrouped sources without clearing the search query', () => {
        const state = {
            filterQuery: 'report',
            ungrouped: ['ungrouped-source'],
            activeQuickViewKind: 'ungrouped',
            activeTagId: null
        };
        const sourcesByKey = new Map([
            ['ungrouped-source', { key: 'ungrouped-source', title: 'AI report', enabled: true }],
            ['grouped-source', { key: 'grouped-source', title: 'AI report', enabled: true }]
        ]);
        const module = createStateModule({ state, sourcesByKey });

        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('ungrouped-source'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('grouped-source'))).toBe(false);
        expect(state.filterQuery).toBe('report');
    });

    it('filters disabled sources from explicit source and ancestor state while excluding issues', () => {
        const state = {
            filterQuery: '',
            ungrouped: ['explicit-disabled', 'failed-source', 'loading-source'],
            activeQuickViewKind: 'disabled',
            activeTagId: null
        };
        const groupsById = new Map([
            ['disabled-group', { id: 'disabled-group', enabled: false, children: [{ type: 'source', key: 'ancestor-disabled' }] }]
        ]);
        const parentMap = new Map([
            ['ancestor-disabled', 'disabled-group']
        ]);
        const sourcesByKey = new Map([
            ['explicit-disabled', { key: 'explicit-disabled', title: 'Off', enabled: false }],
            ['ancestor-disabled', { key: 'ancestor-disabled', title: 'Parent off', enabled: true }],
            ['failed-source', { key: 'failed-source', title: 'Failed', enabled: false, isDisabled: true, isFailed: true }],
            ['loading-source', { key: 'loading-source', title: 'Loading', enabled: false, isLoading: true }]
        ]);
        const module = createStateModule({ state, sourcesByKey, groupsById, parentMap });

        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('explicit-disabled'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('ancestor-disabled'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('failed-source'))).toBe(false);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('loading-source'))).toBe(false);
    });

    it('filters recent and issue sources while keeping tag filters on activeTagId', () => {
        const state = {
            filterQuery: '',
            ungrouped: ['recent-source', 'old-source', 'failed-source', 'loading-source', 'tagged-source'],
            activeQuickViewKind: 'recent',
            activeTagId: null
        };
        const sourceTagsById = new Map([
            ['tagged-source', ['tag-ai']]
        ]);
        const sourcesByKey = new Map([
            ['recent-source', { key: 'recent-source', title: 'Recent', enabled: true, addedAt: '2026-05-16T00:00:00.000Z' }],
            ['old-source', { key: 'old-source', title: 'Old', enabled: true, addedAt: '2026-04-01T00:00:00.000Z' }],
            ['failed-source', { key: 'failed-source', title: 'Failed', enabled: false, isDisabled: true, isFailed: true }],
            ['loading-source', { key: 'loading-source', title: 'Loading', enabled: true, isLoading: true }],
            ['tagged-source', { key: 'tagged-source', title: 'Tagged', enabled: true }]
        ]);
        const module = createStateModule({ state, sourcesByKey, sourceTagsById });

        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('recent-source'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('old-source'))).toBe(false);

        state.activeQuickViewKind = 'issues';
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('failed-source'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('loading-source'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('recent-source'))).toBe(false);

        state.activeQuickViewKind = null;
        state.activeTagId = 'tag-ai';
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('tagged-source'))).toBe(true);
        expect(module.sourceMatchesCurrentFilters(sourcesByKey.get('recent-source'))).toBe(false);
    });
});

describe('content effective-enabled with state.root', () => {
    const make = ({ state, sourcesByKey, groupsById = new Map() }) => createContentViewState({
        getState: () => state,
        getSourcesByKey: () => sourcesByKey,
        getGroupsById: () => groupsById,
        getParentMap: () => new Map(),
        getTagsById: () => new Map(),
        getSourceTagIds: () => []
    });

    it('enables root groups and positioned root sources from state.root, plus the bin', () => {
        const state = {
            root: [
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'positioned' }
            ],
            ungrouped: ['bin']
        };
        const groupsById = new Map([
            ['g1', { id: 'g1', enabled: true, children: [{ type: 'source', key: 'inGroup' }] }]
        ]);
        const sourcesByKey = new Map([
            ['inGroup', { key: 'inGroup', enabled: true }],
            ['positioned', { key: 'positioned', enabled: true }],
            ['bin', { key: 'bin', enabled: true }]
        ]);
        const mod = make({ state, sourcesByKey, groupsById });
        const result = mod.getEffectivelyEnabledSources();
        expect(result.get('inGroup')).toBe(true);
        expect(result.get('positioned')).toBe(true);
        expect(result.get('bin')).toBe(true);
    });

    it('does not enable a positioned root source whose record is disabled', () => {
        const state = { root: [{ type: 'source', key: 'off' }], ungrouped: [] };
        const sourcesByKey = new Map([['off', { key: 'off', enabled: false }]]);
        const mod = make({ state, sourcesByKey });
        expect(mod.getEffectivelyEnabledSources().has('off')).toBe(false);
    });

    it('evaluates enabled state and renderability through a fifty-level tree iteratively', () => {
        const depth = 50;
        const groupsById = new Map();
        for (let level = 0; level < depth; level += 1) {
            groupsById.set(`g-${level}`, {
                id: `g-${level}`,
                title: `Group ${level}`,
                enabled: true,
                children: level < depth - 1
                    ? [{ type: 'group', id: `g-${level + 1}` }]
                    : [{ type: 'source', key: 'deep-source' }]
            });
        }
        const state = {
            root: [{ type: 'group', id: 'g-0' }],
            ungrouped: [],
            filterQuery: '',
            activeQuickViewKind: null,
            activeTagId: null
        };
        const sourcesByKey = new Map([[
            'deep-source',
            { key: 'deep-source', title: 'Deep source', enabled: true }
        ]]);
        const mod = make({ state, sourcesByKey, groupsById });

        expect([...mod.getEffectivelyEnabledSources().keys()]).toEqual(['deep-source']);
        expect(mod.groupHasRenderableDescendant(groupsById.get('g-0'))).toBe(true);
    });

    it('keeps the ungrouped quick-view filter scoped to the bin (not state.root)', () => {
        const state = {
            filterQuery: '',
            root: [{ type: 'source', key: 'positioned' }],
            ungrouped: ['bin'],
            activeQuickViewKind: 'ungrouped',
            activeTagId: null
        };
        const sourcesByKey = new Map([
            ['positioned', { key: 'positioned', title: 'Pos', enabled: true }],
            ['bin', { key: 'bin', title: 'Bin', enabled: true }]
        ]);
        const mod = make({ state, sourcesByKey });
        // 'ungrouped' filter = bin membership ONLY; positioned root source must NOT match.
        expect(mod.sourceMatchesCurrentFilters(sourcesByKey.get('bin'))).toBe(true);
        expect(mod.sourceMatchesCurrentFilters(sourcesByKey.get('positioned'))).toBe(false);
    });

    it('captures and synchronizes native state around an isolation transition', () => {
        const state = {
            root: [{ type: 'group', id: 'g1' }],
            ungrouped: ['outside']
        };
        const groupsById = new Map([
            ['g1', {
                id: 'g1',
                enabled: true,
                children: [{ type: 'source', key: 'inside' }]
            }]
        ]);
        const sourcesByKey = new Map([
            ['inside', { key: 'inside', enabled: true }],
            ['outside', { key: 'outside', enabled: true }]
        ]);
        const parentMap = new Map([['inside', 'g1']]);
        let isolationGroupId = 'g1';
        const syncSourceToPage = jest.fn();
        const mod = createContentViewState({
            getState: () => state,
            getSourcesByKey: () => sourcesByKey,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getTagsById: () => new Map(),
            getSourceTagIds: () => [],
            getActiveIsolationGroupId: () => isolationGroupId,
            isDescendant: (candidate, ancestor) => candidate.id === ancestor.id,
            syncSourceToPage
        });

        const result = mod.runEffectiveStateTransition(() => {
            isolationGroupId = null;
            return true;
        });

        expect(result).toMatchObject({
            ok: true,
            changedSourceKeys: ['outside']
        });
        expect(syncSourceToPage).toHaveBeenCalledTimes(1);
        expect(syncSourceToPage).toHaveBeenCalledWith(
            sourcesByKey.get('outside'),
            true
        );
    });

    it('captures ancestor and isolation state before a placement transition, then syncs only changed sources', async () => {
        const state = {
            root: [
                { type: 'group', id: 'isolated' },
                { type: 'group', id: 'outside-group' }
            ],
            ungrouped: []
        };
        const disabledAncestor = {
            id: 'disabled-ancestor',
            enabled: false,
            children: [{ type: 'source', key: 'inside' }]
        };
        const isolated = {
            id: 'isolated',
            enabled: true,
            children: [
                { type: 'group', id: 'disabled-ancestor' },
                { type: 'source', key: 'stable' }
            ]
        };
        const outsideGroup = {
            id: 'outside-group',
            enabled: true,
            children: [{ type: 'source', key: 'outside' }]
        };
        const groupsById = new Map([
            ['isolated', isolated],
            ['disabled-ancestor', disabledAncestor],
            ['outside-group', outsideGroup]
        ]);
        const sourcesByKey = new Map([
            ['inside', { key: 'inside', enabled: true }],
            ['stable', { key: 'stable', enabled: true }],
            ['outside', { key: 'outside', enabled: true }]
        ]);
        const parentMap = new Map([
            ['disabled-ancestor', 'isolated'],
            ['inside', 'disabled-ancestor'],
            ['stable', 'isolated'],
            ['outside', 'outside-group']
        ]);
        const syncSourceToPage = jest.fn();
        const mod = createContentViewState({
            getState: () => state,
            getSourcesByKey: () => sourcesByKey,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getTagsById: () => new Map(),
            getSourceTagIds: () => [],
            getActiveIsolationGroupId: () => 'isolated',
            syncSourceToPage
        });

        const transition = mod.runEffectiveStateTransition(() => {
            disabledAncestor.enabled = true;
            outsideGroup.children = [];
            isolated.children.push({ type: 'source', key: 'outside' });
            parentMap.set('outside', 'isolated');
            return true;
        });

        expect(transition.previousStates).toEqual(new Map([
            ['inside', false],
            ['stable', true],
            ['outside', false]
        ]));
        expect(transition.changedSourceKeys).toEqual(['inside', 'outside']);
        expect(syncSourceToPage).toHaveBeenNthCalledWith(
            1,
            sourcesByKey.get('inside'),
            true
        );
        expect(syncSourceToPage).toHaveBeenNthCalledWith(
            2,
            sourcesByKey.get('outside'),
            true
        );
        expect(syncSourceToPage).toHaveBeenCalledTimes(2);
        await expect(transition.confirmation).resolves.toEqual(expect.objectContaining({
            ok: true,
            changedSourceKeys: ['inside', 'outside']
        }));
    });

    it('exposes aggregate native confirmation failures without reverting the view transition', async () => {
        const state = {
            root: [],
            ungrouped: ['source-1'],
            activeQuickViewKind: null
        };
        const source = { key: 'source-1', enabled: true };
        const syncSourceToPageWithResult = jest.fn(() => Promise.resolve({
            ok: false,
            sourceKey: 'source-1',
            reason: 'native_checkbox_timeout'
        }));
        const mod = createContentViewState({
            getState: () => state,
            getSourcesByKey: () => new Map([['source-1', source]]),
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getTagsById: () => new Map(),
            getSourceTagIds: () => [],
            getActiveIsolationGroupId: () => (
                state.activeQuickViewKind === 'issues' ? 'hidden-context' : null
            ),
            isDescendant: () => false,
            syncSourceToPageWithResult,
            render: jest.fn()
        });

        const transition = mod.runEffectiveStateTransition(() => {
            state.activeQuickViewKind = 'issues';
            return true;
        });

        await expect(transition.confirmation).resolves.toEqual(
            expect.objectContaining({
                ok: false,
                changedSourceKeys: ['source-1'],
                failed: [expect.objectContaining({
                    sourceKey: 'source-1',
                    reason: 'native_checkbox_timeout'
                })]
            })
        );
        expect(state.activeQuickViewKind).toBe('issues');
    });
});
