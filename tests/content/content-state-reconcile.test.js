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

        expect(remapped.groups).toEqual([]);
        expect(remapped.ungrouped).toEqual([]);
        expect(remapped.groupsById.get('legacy-empty').children).toEqual([]);
        expect(remapped.groupsById.get('legacy-source').children).toEqual([
            { type: 'source', key: 'new-source' }
        ]);
        expect(remapped.sourceTagsById.get('new-source')).toEqual(['tag-1']);
    });
});
