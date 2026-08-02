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

    it('preserves an equal-sized sliding window when a previous identity disappears', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}],
            ['three', {}]
        ]);

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync([
            { key: 'two' },
            { key: 'three' },
            { key: 'four' }
        ], {}, previous)).toBe(true);
    });

    it('allows an equal-sized replacement only when every missing identity is an authorized delete', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}],
            ['three', {}]
        ]);
        const recentNativeDeletedSourceKeys = new Set(['one']);

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync([
            { key: 'two' },
            { key: 'three' },
            { key: 'four' }
        ], {}, previous, {
            recentNativeDeletedSourceKeys
        })).toBe(false);
        expect(recentNativeDeletedSourceKeys.has('one')).toBe(false);
    });

    it('accepts a missing identity only after two stable complete inventory observations', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}],
            ['three', {}]
        ]);
        const nextSources = [
            { key: 'two' },
            { key: 'three' },
            { key: 'four' }
        ];
        const evidence = {
            completeness: 'complete',
            totalHint: 3
        };

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            nextSources,
            {},
            previous,
            evidence
        )).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            nextSources,
            {},
            previous,
            evidence
        )).toBe(false);
    });

    it('does not reuse complete-scan evidence across notebook manager contexts', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}]
        ]);
        const nextSources = [{ key: 'two' }];
        const evidence = {
            completeness: 'complete',
            identityKeys: ['stable:two'],
            totalHint: 1
        };

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            nextSources,
            {},
            previous,
            { ...evidence, contextToken: 'notebook-a:manager-1' }
        )).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            nextSources,
            {},
            previous,
            { ...evidence, contextToken: 'notebook-b:manager-1' }
        )).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            nextSources,
            {},
            previous,
            { ...evidence, contextToken: 'notebook-b:manager-1' }
        )).toBe(false);
    });

    it('uses the observed identity contract when proving two stable complete scans', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}]
        ]);
        const evidence = {
            completeness: 'complete',
            identityKeys: ['stable:two'],
            contextToken: 'notebook-a:manager-1',
            totalHint: 1
        };

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            [{ key: 'transient-row-key-a' }],
            {},
            previous,
            evidence
        )).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(
            [{ key: 'transient-row-key-b' }],
            {},
            previous,
            evidence
        )).toBe(false);
    });

    it('does not count a virtualized observation toward complete inventory stability', () => {
        const guard = createGuard();
        const previous = new Map([
            ['one', {}],
            ['two', {}]
        ]);
        const nextSources = [{ key: 'two' }];

        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(nextSources, {}, previous, {
            completeness: 'complete',
            totalHint: 1
        })).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(nextSources, {}, previous, {
            completeness: 'virtualized',
            totalHint: 2
        })).toBe(true);
        expect(guard.shouldPreserveExistingSourcesDuringPartialSync(nextSources, {}, previous, {
            completeness: 'complete',
            totalHint: 1
        })).toBe(true);
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
