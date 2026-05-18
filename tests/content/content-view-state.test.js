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
