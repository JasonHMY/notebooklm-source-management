const createContentSnapshotSignature = require('../../src/content/content-snapshot-signature.js');

describe('content snapshot signature helper', () => {
    const helper = createContentSnapshotSignature();

    describe('isStorageQuotaError', () => {
        it('matches the common quota/exceed/max_bytes wording', () => {
            expect(helper.isStorageQuotaError(new Error('QUOTA_BYTES exceeded'))).toBe(true);
            expect(helper.isStorageQuotaError(new Error('Item exceeded maximum size'))).toBe(true);
            expect(helper.isStorageQuotaError({ message: 'MAX_BYTES_PER_ITEM hit' })).toBe(true);
            expect(helper.isStorageQuotaError('write rate exceed')).toBe(true);
        });

        it('returns false for unrelated errors and null/undefined inputs', () => {
            expect(helper.isStorageQuotaError(new Error('network timeout'))).toBe(false);
            expect(helper.isStorageQuotaError(null)).toBe(false);
            expect(helper.isStorageQuotaError(undefined)).toBe(false);
        });
    });

    describe('getStorageMetadataFromResponse', () => {
        it('coerces numbers, defaults missing fields and preserves booleans', () => {
            expect(helper.getStorageMetadataFromResponse({
                storageUsageBytes: '1024',
                storageQuotaBytes: 4096,
                storageUsageRatio: '0.25',
                storageWarning: true,
                historyEntryCount: '10',
                historyTrimmed: 1
            })).toEqual({
                storageUsageBytes: 1024,
                storageQuotaBytes: 4096,
                storageUsageRatio: 0.25,
                storageWarning: true,
                historyEntryCount: 10,
                historyTrimmed: true
            });
        });

        it('returns zeroed defaults when called without arguments', () => {
            expect(helper.getStorageMetadataFromResponse()).toEqual({
                storageUsageBytes: 0,
                storageQuotaBytes: 0,
                storageUsageRatio: 0,
                storageWarning: false,
                historyEntryCount: 0,
                historyTrimmed: false
            });
        });
    });

    describe('getStorageMetadataFromResult', () => {
        it('prefers the runtime metadata when storageQuotaBytes or storageUsageBytes are present', () => {
            const result = {
                runtimeResult: { storageUsageBytes: 256, storageQuotaBytes: 1024 },
                localResult: { storageUsageBytes: 999 }
            };
            expect(helper.getStorageMetadataFromResult(result).storageUsageBytes).toBe(256);
        });

        it('falls back to the local metadata when runtime metadata lacks size fields', () => {
            const result = {
                runtimeResult: { storageWarning: true },
                localResult: { storageUsageBytes: 512 }
            };
            expect(helper.getStorageMetadataFromResult(result).storageUsageBytes).toBe(512);
        });
    });

    describe('getSnapshotSaveRevision', () => {
        it('returns the numeric _saveRevision for valid snapshots', () => {
            expect(helper.getSnapshotSaveRevision({ _saveRevision: 7 })).toBe(7);
            expect(helper.getSnapshotSaveRevision({ _saveRevision: '12' })).toBe(12);
        });

        it('returns 0 for missing, NaN, zero, or negative revisions', () => {
            expect(helper.getSnapshotSaveRevision(null)).toBe(0);
            expect(helper.getSnapshotSaveRevision({})).toBe(0);
            expect(helper.getSnapshotSaveRevision({ _saveRevision: 'oops' })).toBe(0);
            expect(helper.getSnapshotSaveRevision({ _saveRevision: 0 })).toBe(0);
            expect(helper.getSnapshotSaveRevision({ _saveRevision: -5 })).toBe(0);
        });
    });

    describe('isStaleStateWrite', () => {
        it('flags writes whose revision is lower than the stored revision', () => {
            expect(helper.isStaleStateWrite({ _saveRevision: 3 }, { _saveRevision: 5 })).toBe(true);
        });

        it('returns false when either side has no revision', () => {
            expect(helper.isStaleStateWrite({ _saveRevision: 3 }, {})).toBe(false);
            expect(helper.isStaleStateWrite({}, { _saveRevision: 5 })).toBe(false);
        });

        it('returns false when revisions are equal or incoming is newer', () => {
            expect(helper.isStaleStateWrite({ _saveRevision: 5 }, { _saveRevision: 5 })).toBe(false);
            expect(helper.isStaleStateWrite({ _saveRevision: 7 }, { _saveRevision: 5 })).toBe(false);
        });
    });

    describe('getStableComparablePersistableValue', () => {
        it('strips the _saveRevision and _savedAt metadata keys', () => {
            const value = { a: 1, _saveRevision: 7, _savedAt: 'now', b: 2 };
            expect(helper.getStableComparablePersistableValue(value)).toEqual({ a: 1, b: 2 });
        });

        it('sorts object keys for stable JSON serialization', () => {
            const left = helper.getStableComparablePersistableValue({ b: 1, a: 2 });
            const right = helper.getStableComparablePersistableValue({ a: 2, b: 1 });
            expect(JSON.stringify(left)).toBe(JSON.stringify(right));
        });

        it('replaces cycles with null instead of throwing', () => {
            const value = { name: 'cycle' };
            value.self = value;
            const result = helper.getStableComparablePersistableValue(value);
            expect(result.name).toBe('cycle');
            expect(result.self).toBeNull();
        });

        it('passes primitives through unchanged', () => {
            expect(helper.getStableComparablePersistableValue(42)).toBe(42);
            expect(helper.getStableComparablePersistableValue('text')).toBe('text');
            expect(helper.getStableComparablePersistableValue(null)).toBeNull();
        });
    });

    describe('getPersistableSnapshotSignature', () => {
        it('produces equal signatures for equivalent snapshots regardless of key order or metadata', () => {
            const left = { groups: ['g1'], _saveRevision: 1, _savedAt: 'a' };
            const right = { _saveRevision: 99, _savedAt: 'z', groups: ['g1'] };
            expect(helper.getPersistableSnapshotSignature(left))
                .toBe(helper.getPersistableSnapshotSignature(right));
        });

        it('produces different signatures for snapshots with different payloads', () => {
            expect(helper.getPersistableSnapshotSignature({ groups: ['g1'] }))
                .not.toBe(helper.getPersistableSnapshotSignature({ groups: ['g2'] }));
        });
    });

    describe('arePersistableSnapshotsEquivalent', () => {
        it('returns true for snapshots that differ only in metadata or key order', () => {
            expect(helper.arePersistableSnapshotsEquivalent(
                { a: 1, b: 2, _saveRevision: 1 },
                { b: 2, a: 1, _saveRevision: 99 }
            )).toBe(true);
        });

        it('returns false for snapshots with different payloads', () => {
            expect(helper.arePersistableSnapshotsEquivalent(
                { groups: ['g1'] },
                { groups: [] }
            )).toBe(false);
        });

        it('treats two null snapshots as equivalent because both stringify to "null"', () => {
            expect(helper.arePersistableSnapshotsEquivalent(null, null)).toBe(true);
        });

        it('returns false when one side has data and the other is null', () => {
            expect(helper.arePersistableSnapshotsEquivalent({ groups: ['g1'] }, null)).toBe(false);
        });

        it('returns false when signatures fail to serialize (e.g. BigInt value)', () => {
            const bigintSnapshot = { value: BigInt(1) };
            const otherBigintSnapshot = { value: BigInt(1) };
            expect(helper.getPersistableSnapshotSignature(bigintSnapshot)).toBe('');
            expect(helper.arePersistableSnapshotsEquivalent(bigintSnapshot, otherBigintSnapshot)).toBe(false);
        });
    });
});
