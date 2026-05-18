const createContentNativeLabelImportController = require('../../src/content/content-native-label-import-controller.js');

describe('content native label import controller helper', () => {
    const createHelper = () => createContentNativeLabelImportController({
        normalizeSourceText: (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
    });

    it('finds reusable native label groups only by nativeLabelTitle metadata', () => {
        const helper = createHelper();
        const groupsById = new Map([
            ['ordinary', { id: 'ordinary', title: 'Clinical Papers' }],
            ['native', { id: 'native', title: 'Other', nativeLabelTitle: 'Clinical Papers' }]
        ]);

        expect(helper.findReusableNativeLabelImportGroup(' clinical   papers ', groupsById)).toMatchObject({ id: 'native' });
        expect(helper.findReusableNativeLabelImportGroup('missing', groupsById)).toBeNull();
    });

    it('resolves preview source keys by existing stable identity before fallback', () => {
        const helper = createHelper();
        const sourcesByKey = new Map([
            ['stable-key', { stableToken: 'token-1', title: 'A' }],
            ['title-key', { title: 'Only Title' }]
        ]);

        expect(helper.resolveNativeLabelPreviewSourceKey({ stableToken: 'token-1', key: 'new-key' }, sourcesByKey)).toBe('stable-key');
        expect(helper.resolveNativeLabelPreviewSourceKey({ title: 'Only   Title', key: 'new-key' }, sourcesByKey)).toBe('title-key');
        expect(helper.resolveNativeLabelPreviewSourceKey({ key: 'fallback-key' }, sourcesByKey)).toBe('fallback-key');
    });

    it('creates and inserts preview-only source records at confirmation time', () => {
        const helper = createHelper();
        const sourcesByKey = new Map();
        const sourceTagsById = new Map();
        const keyByElement = new WeakMap();
        const element = {};
        const record = helper.createNativeLabelPreviewSourceRecord({ title: 'Paper', element }, 'Native Label', 'source-key');

        expect(record).toMatchObject({
            key: 'source-key',
            sourceViewKind: 'label',
            nativeLabelTitle: 'Native Label',
            enabled: true
        });
        expect(helper.ensureNativeLabelPreviewSources({
            title: 'Native Label',
            sourceRecords: [record]
        }, { sourcesByKey, sourceTagsById, keyByElement })).toBe(1);
        expect(sourcesByKey.get('source-key')).toMatchObject({ nativeLabelTitle: 'Native Label' });
        expect(sourceTagsById.get('source-key')).toEqual([]);
        expect(helper.ensureNativeLabelPreviewSources({
            title: 'Native Label',
            sourceRecords: [record]
        }, { sourcesByKey, sourceTagsById, keyByElement })).toBe(0);
    });

    it('creates stable unique imported group ids', () => {
        const helper = createHelper();
        const usedIds = new Set(['native_label_clinical_papers']);

        expect(helper.createImportedNativeLabelGroupId('Clinical Papers', usedIds)).toBe('native_label_clinical_papers_2');
        expect(usedIds.has('native_label_clinical_papers_2')).toBe(true);
    });
});
