const createContentSourcePartialSyncGuard = require('../../src/content/content-source-partial-sync-guard.js');

describe('content source partial sync guard', () => {
    const createGuard = () => createContentSourcePartialSyncGuard({
        resolveStoredSourceKeyWithReason: (storedKey, sourceLookup, sourceRecord) => {
            if (sourceRecord?.remapTo) return { key: sourceRecord.remapTo, reason: 'stable_token' };
            return { key: storedKey, reason: 'exact' };
        }
    });

    it('preserves previous sources during partial scans but not known native deletes', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}]
        ]);

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync([{ key: 'one' }], {}, previous)).toBe(true);

        const recentNativeDeletedSourceKeys = new Set(['two']);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync([{ key: 'one' }], {}, previous, {
            recentNativeDeletedSourceKeys
        })).toBe(false);
        expect(recentNativeDeletedSourceKeys.has('two')).toBe(false);
    });

    it('detects previous records by remapped source key', () => {
        const guard = createGuard();
        const previous = new Map([
            ['old-key', { remapTo: 'new-key' }]
        ]);

        expect(guard.hasPreviousRecordForCurrentSource({ key: 'new-key' }, {}, previous)).toBe(true);
        expect(guard.hasPreviousRecordForCurrentSource({ key: 'other' }, {}, previous)).toBe(false);
    });

    it('marks new raw URL rows as transient loading sources', () => {
        const guard = createGuard();
        const previous = new Map([['existing', {}]]);
        const currentSources = [
            { key: 'existing', title: 'Existing' },
            { key: 'url-source', title: 'https://example.com/doc.pdf' },
            { key: 'not-url', title: 'Example Doc' }
        ];

        expect(guard.markTransientRawUrlImportSources(currentSources, {}, previous)).toBe(1);
        expect(currentSources[1]).toMatchObject({
            isLoading: true,
            isDisabled: true,
            isFailed: false
        });
        expect(currentSources[2].isLoading).toBeUndefined();
    });

    it('rejects non-URL or spaced URL titles', () => {
        const guard = createGuard();

        expect(guard.isLikelyRawImportUrlTitle('https://example.com/a.pdf')).toBe(true);
        expect(guard.isLikelyRawImportUrlTitle('ftp://example.com/a.pdf')).toBe(false);
        expect(guard.isLikelyRawImportUrlTitle('https://example.com/a pdf')).toBe(false);
        expect(guard.isLikelyRawImportUrlTitle('not a url')).toBe(false);
    });
});
