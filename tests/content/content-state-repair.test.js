const createContentStateRepair = require('../../src/content/content-state-repair.js');

function createDeps(overrides = {}) {
    return {
        cloneSerializableData: (value) => (value == null ? value : JSON.parse(JSON.stringify(value))),
        hasRestorableStateSnapshot: (snapshot) => Boolean(snapshot && snapshot.groupsById && Object.keys(snapshot.groupsById).length > 0),
        getMapLikeEntries: (value) => {
            if (value instanceof Map) return Array.from(value.entries());
            if (value && typeof value === 'object') return Object.entries(value);
            return [];
        },
        normalizeStateHistoryEntries: (entries) => (Array.isArray(entries) ? entries : []),
        getSnapshotSaveRevision: (snapshot) => Number(snapshot?._saveRevision) || 0,
        ...overrides
    };
}

describe('content state repair', () => {
    describe('collectSnapshotGroupedSourceKeys', () => {
        const repair = createContentStateRepair(createDeps());

        it('collects source keys reachable from root groups', () => {
            const snapshot = {
                groups: ['g1', 'g2'],
                groupsById: {
                    g1: { children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] },
                    g2: { children: [{ type: 'source', key: 's3' }] }
                }
            };
            const keys = repair.collectSnapshotGroupedSourceKeys(snapshot);
            expect([...keys].sort()).toEqual(['s1', 's2', 's3']);
        });

        it('recurses into nested group children', () => {
            const snapshot = {
                groups: ['root'],
                groupsById: {
                    root: { children: [{ type: 'group', id: 'nested' }] },
                    nested: { children: [{ type: 'source', key: 'deep' }] }
                }
            };
            expect([...repair.collectSnapshotGroupedSourceKeys(snapshot)]).toEqual(['deep']);
        });

        it('collects a grouped source through a fifty-level snapshot iteratively', () => {
            const groupsById = {};
            const depth = 50;
            for (let level = 0; level < depth; level += 1) {
                groupsById[`g-${level}`] = {
                    children: level < depth - 1
                        ? [{ type: 'group', id: `g-${level + 1}` }]
                        : [{ type: 'source', key: 'deep-source' }]
                };
            }
            const snapshot = {
                root: [{ type: 'group', id: 'g-0' }],
                groupsById
            };

            expect([...repair.collectSnapshotGroupedSourceKeys(snapshot)])
                .toEqual(['deep-source']);
        });

        it('does not loop on cyclic group references', () => {
            const snapshot = {
                groups: ['a'],
                groupsById: {
                    a: { children: [{ type: 'group', id: 'b' }, { type: 'source', key: 's-a' }] },
                    b: { children: [{ type: 'group', id: 'a' }, { type: 'source', key: 's-b' }] }
                }
            };
            const keys = repair.collectSnapshotGroupedSourceKeys(snapshot);
            expect([...keys].sort()).toEqual(['s-a', 's-b']);
        });

        it('returns an empty set for snapshots without groups', () => {
            expect(repair.collectSnapshotGroupedSourceKeys(null).size).toBe(0);
            expect(repair.collectSnapshotGroupedSourceKeys({}).size).toBe(0);
        });
    });

    describe('getSnapshotGroupInfo', () => {
        const repair = createContentStateRepair(createDeps());

        it('returns groupIds, titleCounts and groupedSourceKeys aligned with the snapshot', () => {
            const snapshot = {
                groups: ['a'],
                groupsById: {
                    a: { title: 'Work', children: [{ type: 'source', key: 's1' }] },
                    b: { title: 'Work', children: [] },
                    c: { title: 'Personal', children: [] }
                }
            };
            const info = repair.getSnapshotGroupInfo(snapshot);
            expect(info.groupIds.has('a')).toBe(true);
            expect(info.groupIds.has('b')).toBe(true);
            expect(info.titleCounts.get('Work')).toBe(2);
            expect(info.titleCounts.get('Personal')).toBe(1);
            expect([...info.groupedSourceKeys]).toEqual(['s1']);
        });
    });

    describe('isCompatibleStructuralRepairCandidate', () => {
        const repair = createContentStateRepair(createDeps());

        it('returns false when either snapshot lacks restorable state', () => {
            const candidate = { groupsById: { a: { children: [{ type: 'source', key: 's1' }] } }, groups: ['a'] };
            expect(repair.isCompatibleStructuralRepairCandidate({}, candidate)).toBe(false);
            expect(repair.isCompatibleStructuralRepairCandidate(candidate, {})).toBe(false);
        });

        it('returns false when the candidate has fewer grouped sources than current', () => {
            const current = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] } },
                groups: ['a']
            };
            const candidate = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                groups: ['a']
            };
            expect(repair.isCompatibleStructuralRepairCandidate(current, candidate)).toBe(false);
        });

        it('returns true when candidate has more sources, matching group ids and source membership', () => {
            const current = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                groups: ['a'],
                sourceStateById: { s1: {}, s2: {} }
            };
            const candidate = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] } },
                groups: ['a'],
                sourceStateById: { s1: {}, s2: {} }
            };
            expect(repair.isCompatibleStructuralRepairCandidate(current, candidate)).toBe(true);
        });

        it('falls back to title-overlap check when candidate has unknown group ids', () => {
            const current = {
                groupsById: { x: { title: 'Work', children: [{ type: 'source', key: 's1' }] } },
                groups: ['x'],
                sourceStateById: { s1: {}, s2: {} }
            };
            const candidate = {
                groupsById: { y: { title: 'Work', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] } },
                groups: ['y'],
                sourceStateById: { s1: {}, s2: {} }
            };
            expect(repair.isCompatibleStructuralRepairCandidate(current, candidate)).toBe(true);
        });

        it('returns false when a candidate source is unknown in both states', () => {
            const current = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                groups: ['a'],
                sourceStateById: { s1: {} }
            };
            const candidate = {
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 'ghost' }] } },
                groups: ['a'],
                sourceStateById: { s1: {} }
            };
            expect(repair.isCompatibleStructuralRepairCandidate(current, candidate)).toBe(false);
        });
    });

    describe('createStructurallyRepairedState', () => {
        const repair = createContentStateRepair(createDeps());

        it('overlays candidate group tree onto current state and merges source maps with current winning', () => {
            const current = {
                groups: [],
                groupsById: {},
                ungrouped: ['legacy'],
                sourceStateById: { s1: { title: 'current-s1' }, legacy: { title: 'legacy-current' } },
                customHeight: 320,
                _saveRevision: 5,
                _savedAt: '2026-01-02'
            };
            const candidate = {
                groups: ['a'],
                groupsById: { a: { children: [{ type: 'source', key: 's1' }] } },
                ungrouped: [],
                sourceStateById: { s1: { title: 'candidate-s1' } }
            };

            const repaired = repair.createStructurallyRepairedState(current, candidate);

            expect(repaired.root).toEqual([{ type: 'group', id: 'a' }]);
            expect(repaired.groupsById).toEqual({ a: { children: [{ type: 'source', key: 's1' }] } });
            expect(repaired.sourceStateById.s1.title).toBe('current-s1');
            expect(repaired.ungrouped).toContain('legacy');
            expect(repaired.ungrouped).not.toContain('s1');
            expect(repaired.customHeight).toBe(320);
            expect(repaired._saveRevision).toBe(5);
            expect(repaired._savedAt).toBe('2026-01-02');
        });

        it('does not duplicate ungrouped entries already present in the group tree', () => {
            const current = { ungrouped: ['s1', 's1'], sourceStateById: { s1: {} } };
            const candidate = {
                groups: ['a'],
                groupsById: { a: { children: [{ type: 'source', key: 's1' }] } },
                ungrouped: []
            };
            const repaired = repair.createStructurallyRepairedState(current, candidate);
            expect(repaired.ungrouped).toEqual([]);
        });
    });

    describe('findStructuralRepairCandidate', () => {
        const repair = createContentStateRepair(createDeps());

        it('returns null when current state is not restorable', () => {
            const result = repair.findStructuralRepairCandidate({}, { groupsById: { a: {} } }, []);
            expect(result).toBeNull();
        });

        it('picks the backup snapshot when it is compatible and richer', () => {
            const current = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                sourceStateById: { s1: {}, s2: {} }
            };
            const backup = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] } },
                sourceStateById: { s1: {}, s2: {} }
            };
            expect(repair.findStructuralRepairCandidate(current, backup, [])).toBe(backup);
        });

        it('falls through to history when backup is missing or incompatible', () => {
            const current = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                sourceStateById: { s1: {}, s2: {}, s3: {} }
            };
            const richHistorySnapshot = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }, { type: 'source', key: 's3' }] } },
                sourceStateById: { s1: {}, s2: {}, s3: {} },
                _saveRevision: 99
            };
            const result = repair.findStructuralRepairCandidate(current, null, [{ snapshot: richHistorySnapshot }]);
            expect(result).toBe(richHistorySnapshot);
        });

        it('prefers the candidate with the most grouped sources, breaking ties by save revision', () => {
            const current = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }] } },
                sourceStateById: { s1: {}, s2: {} }
            };
            const olderRich = {
                groups: ['a'],
                groupsById: { a: { title: 'A', children: [{ type: 'source', key: 's1' }, { type: 'source', key: 's2' }] } },
                sourceStateById: { s1: {}, s2: {} },
                _saveRevision: 1
            };
            const newerRich = {
                ...olderRich,
                _saveRevision: 9
            };
            const result = repair.findStructuralRepairCandidate(
                current,
                olderRich,
                [{ snapshot: newerRich }]
            );
            expect(result).toBe(newerRich);
        });
    });
});
