const createContentNativeLabelImport = require('../../src/content/content-native-label-import.js');

describe('native label import helpers', () => {
    const helpers = createContentNativeLabelImport({
        getComparableNativeImportLabelTitle: (value) => String(value || '').trim().toLowerCase()
    });

    it('checks whether preview contains expected label titles', () => {
        const preview = {
            ok: true,
            labels: [{ title: 'AI Risk' }, { title: 'Python' }]
        };

        expect(helpers.previewContainsTitles(preview, ['ai risk'])).toBe(true);
        expect(helpers.previewContainsTitles(preview, ['missing'])).toBe(false);
    });

    it('returns incomplete summaries for missing labels or source count mismatches', () => {
        const preview = {
            ok: true,
            labels: [{ title: 'AI Risk', sourceCount: 2 }]
        };
        const incomplete = helpers.getIncompleteSummaries(preview, [
            { title: 'AI Risk', expectedSourceCount: 3 },
            { title: 'Python', expectedSourceCount: 1 }
        ]);

        expect(incomplete).toEqual([
            { title: 'AI Risk', expectedSourceCount: 3, reason: 'source_count_mismatch' },
            { title: 'Python', expectedSourceCount: 1, reason: 'missing_label' }
        ]);
    });
});
