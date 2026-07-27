const createContentSearchSemantics = require('../../src/content/content-search-semantics.js');

describe('content search semantics', () => {
    const createModule = () => {
        const groupsById = new Map([
            ['folder-child', { id: 'folder-child', title: 'Chapter One' }],
            ['folder-parent', { id: 'folder-parent', title: 'Research Archive' }]
        ]);
        const tagsById = new Map([
            ['tag-paper', { id: 'tag-paper', label: 'Research Paper' }],
            ['tag-notes', { id: 'tag-notes', label: 'Research Notes' }]
        ]);
        const parentMap = new Map([
            ['source-1', 'folder-child'],
            ['folder-child', 'folder-parent']
        ]);
        const sourceTagIdsByKey = new Map([
            ['source-1', ['tag-paper', 'tag-notes']]
        ]);

        return createContentSearchSemantics({
            getGroupsById: () => groupsById,
            getTagsById: () => tagsById,
            getParentMap: () => parentMap,
            getSourceTagIds: (sourceKey) => sourceTagIdsByKey.get(sourceKey) || []
        });
    };

    it('requires the four live-data accessors', () => {
        expect(() => createContentSearchSemantics()).toThrow(
            'createContentSearchSemantics requires getGroupsById, getTagsById, getParentMap and getSourceTagIds'
        );
    });

    it('parses quoted scoped terms while keeping unscoped text terms', () => {
        const search = createModule();

        expect(search.parseQuery('tag:"Research Notes" folder:\'Alpha Team\' draft')).toEqual({
            raw: 'tag:"Research Notes" folder:\'Alpha Team\' draft',
            textTerms: ['draft'],
            tagTerms: ['research notes'],
            folderTerms: ['alpha team'],
            hasQuery: true
        });
    });

    it('normalizes case, deduplicates terms and applies AND matching', () => {
        const search = createModule();
        const source = {
            key: 'source-1',
            title: 'Alpha Draft',
            normalizedTitle: 'alpha draft'
        };

        expect(search.parseQuery(
            'ALPHA alpha tag:"RESEARCH PAPER" tag:"research paper" folder:ARCHIVE folder:archive'
        )).toMatchObject({
            textTerms: ['alpha'],
            tagTerms: ['research paper'],
            folderTerms: ['archive']
        });
        expect(search.matchesSource(source, 'alpha paper archive')).toBe(true);
        expect(search.matchesSource(source, 'alpha paper missing')).toBe(false);
    });

    it('matches plain terms against titles, tag labels and every ancestor folder', () => {
        const search = createModule();
        const source = { key: 'source-1', title: 'Alpha Draft' };

        expect(search.matchesSource(source, 'alpha')).toBe(true);
        expect(search.matchesSource(source, 'paper')).toBe(true);
        expect(search.matchesSource(source, 'archive')).toBe(true);
        expect(search.buildSourceContext(source)).toEqual({
            titles: ['Alpha Draft'],
            tagLabels: ['Research Paper', 'Research Notes'],
            folderLabels: ['Chapter One', 'Research Archive']
        });
    });

    it('keeps tag and folder scopes limited to their corresponding fields', () => {
        const search = createModule();
        const source = { key: 'source-1', title: 'Chapter Paper' };

        expect(search.matchesSource(source, 'tag:chapter')).toBe(false);
        expect(search.matchesSource(source, 'folder:paper')).toBe(false);
        expect(search.matchesSource(source, 'tag:paper')).toBe(true);
        expect(search.matchesSource(source, 'folder:chapter')).toBe(true);
    });

    it('never treats a group title as a tag match', () => {
        const search = createModule();
        const group = { id: 'group-1', title: 'Research Paper' };

        expect(search.matchesGroup(group, 'research')).toBe(true);
        expect(search.matchesGroup(group, 'folder:paper')).toBe(true);
        expect(search.matchesGroup(group, 'tag:paper')).toBe(false);
        expect(search.matchesGroup(group, 'research tag:paper')).toBe(false);
    });

    it('uses the longest term when highlights begin at the same position', () => {
        const search = createModule();

        expect(search.segmentText('Alpha Paper Draft', [
            'paper',
            'alpha',
            'alpha paper'
        ])).toEqual([
            { text: 'Alpha Paper', matched: true },
            { text: ' Draft', matched: false }
        ]);
    });

    it('preserves original offsets when Unicode lowercase conversion expands', () => {
        const search = createModule();

        expect(search.segmentText('İstanbul', ['stan'])).toEqual([
            { text: 'İ', matched: false },
            { text: 'stan', matched: true },
            { text: 'bul', matched: false }
        ]);
        expect(search.segmentText('İx', ['x'])).toEqual([
            { text: 'İ', matched: false },
            { text: 'x', matched: true }
        ]);
        expect(search.matchesSource({ key: 'unicode-source', title: 'İstanbul' }, 'stan'))
            .toBe(true);
    });

    it('treats an empty query as a match for a valid source but not for a group', () => {
        const search = createModule();

        expect(search.matchesSource({ key: 'source-1', title: 'Draft' }, '')).toBe(true);
        expect(search.matchesSource(null, '')).toBe(false);
        expect(search.matchesGroup({ id: 'group-1', title: 'Drafts' }, '')).toBe(false);
    });

    it('stops ancestor traversal when the parent map contains a cycle', () => {
        const groupsById = new Map([
            ['folder-a', { id: 'folder-a', title: 'Alpha' }],
            ['folder-b', { id: 'folder-b', title: 'Beta' }]
        ]);
        const search = createContentSearchSemantics({
            getGroupsById: () => groupsById,
            getTagsById: () => new Map(),
            getParentMap: () => new Map([
                ['source-cycle', 'folder-a'],
                ['folder-a', 'folder-b'],
                ['folder-b', 'folder-a']
            ]),
            getSourceTagIds: () => []
        });

        expect(search.buildSourceContext({ key: 'source-cycle', title: 'Cycle' }).folderLabels)
            .toEqual(['Alpha', 'Beta']);
        expect(search.matchesSource({ key: 'source-cycle', title: 'Cycle' }, 'alpha beta'))
            .toBe(true);
    });

    it('keeps matcher fields and highlight scopes consistent', () => {
        const search = createModule();
        const source = { key: 'source-1', title: 'Draft Summary' };
        const criteria = search.parseQuery(
            'draft tag:"Research Notes" folder:"Chapter One"'
        );

        expect(search.matchesSource(source, criteria)).toBe(true);
        expect(search.getHighlightTerms(criteria, 'text')).toEqual(['draft']);
        expect(search.getHighlightTerms(criteria, 'tag')).toEqual([
            'draft',
            'research notes'
        ]);
        expect(search.getHighlightTerms(criteria, 'folder')).toEqual([
            'draft',
            'chapter one'
        ]);
        expect(search.segmentText(
            source.title,
            search.getHighlightTerms(criteria, 'text')
        )).toEqual([
            { text: 'Draft', matched: true },
            { text: ' Summary', matched: false }
        ]);
        expect(search.segmentText(
            'Research Notes',
            search.getHighlightTerms(criteria, 'tag')
        )).toEqual([
            { text: 'Research Notes', matched: true }
        ]);
        expect(search.segmentText(
            'Chapter One',
            search.getHighlightTerms(criteria, 'folder')
        )).toEqual([
            { text: 'Chapter One', matched: true }
        ]);
    });
});
