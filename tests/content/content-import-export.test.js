const createContentImportExport = require('../../src/content/content-import-export.js');
const createContentTreePlacement = require('../../src/content/content-tree-placement.js');

const IMPORT_EXPORT_FORMAT = 'notebooklm-source-management-config';

function passThroughClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createRuntime(overrides = {}) {
    return {
        sourcesByKey: new Map(),
        groupsById: new Map(),
        tagsById: new Map(),
        shadowRoot: null,
        customHeight: null,
        sourceViewDisplayKind: '',
        projectId: 'notebook-a',
        activeManagerInstanceToken: 1,
        ...overrides
    };
}

function createDeps(overrides = {}) {
    const runtime = overrides.runtime || createRuntime();
    const treePlacement = createContentTreePlacement({
        getState: () => runtime.state || { root: [], ungrouped: [] },
        getGroupsById: () => runtime.groupsById
    });
    return {
        runtime,
        treePlacement,
        cloneSerializableData: jest.fn(passThroughClone),
        normalizeLoadedState: jest.fn((value) => value),
        hasPersistableManagerState: jest.fn((state) => Boolean(state)),
        buildPersistableState: jest.fn(() => ({ sourceStateById: {}, groupsById: {}, tagsById: {} })),
        applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
            runtime.customHeight = snapshot?.customHeight ?? null;
            return true;
        }),
        appendStateHistorySnapshot: jest.fn(async () => true),
        rollbackImportSnapshot: jest.fn(() => true),
        saveState: jest.fn(async () => ({ ok: true })),
        render: jest.fn(),
        showToast: jest.fn(),
        getMessage: jest.fn((key) => key),
        developerLog: jest.fn(),
        writeImportBackupSnapshot: jest.fn(() => ({})),
        restoreImportBackupSnapshotFromUi: jest.fn(() => true),
        ...overrides
    };
}

describe('content import/export helper', () => {
    describe('factory validation', () => {
        it('throws when the runtime is missing', () => {
            expect(() => createContentImportExport({ ...createDeps(), runtime: null }))
                .toThrow(/requires a runtime context/);
        });

        it('throws when any required persistence helper is missing', () => {
            const deps = createDeps();
            delete deps.buildPersistableState;
            expect(() => createContentImportExport(deps)).toThrow(/persistence helpers/);
        });

        it('throws when the required critical-save helper is missing', () => {
            const deps = createDeps();
            delete deps.saveState;
            expect(() => createContentImportExport(deps)).toThrow(/persistence helpers/);
        });
    });

    describe('getExportConfigText', () => {
        it('returns a JSON envelope with format, extensionVersion, exportedAt and data', () => {
            const previousChrome = globalThis.chrome;
            globalThis.chrome = { runtime: { getManifest: () => ({ version: '9.9.9' }) } };
            const deps = createDeps({
                buildPersistableState: jest.fn(() => ({ sourceStateById: { a: {} }, groupsById: { g: {} }, tagsById: {} }))
            });
            const { getExportConfigText } = createContentImportExport(deps);

            const text = getExportConfigText();
            const parsed = JSON.parse(text);

            expect(parsed.format).toBe(IMPORT_EXPORT_FORMAT);
            expect(parsed.formatVersion).toBe(1);
            expect(parsed.extensionVersion).toBe('9.9.9');
            expect(typeof parsed.exportedAt).toBe('string');
            expect(parsed.data.sourceStateById).toEqual({ a: {} });
            expect(deps.developerLog).toHaveBeenCalledWith(
                'info',
                'import_export',
                'config_export_created',
                expect.objectContaining({ sourceCount: 1, groupCount: 1, tagCount: 0 })
            );

            globalThis.chrome = previousChrome;
        });
    });

    describe('parseImportConfigText', () => {
        it('rejects empty input with reason empty', () => {
            const { parseImportConfigText } = createContentImportExport(createDeps());
            expect(parseImportConfigText('')).toEqual({ ok: false, reason: 'empty' });
            expect(parseImportConfigText('   ')).toEqual({ ok: false, reason: 'empty' });
        });

        it('rejects invalid JSON with reason invalid', () => {
            const { parseImportConfigText } = createContentImportExport(createDeps());
            expect(parseImportConfigText('{not json')).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects oversize payloads above maxFileBytes', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxFileBytes: 10 } });
            expect(parseImportConfigText(JSON.stringify({ groupsById: {}, sourceStateById: {} })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects payloads when hasPersistableManagerState returns false', () => {
            const deps = createDeps({ hasPersistableManagerState: jest.fn(() => false) });
            const { parseImportConfigText } = createContentImportExport(deps);
            expect(parseImportConfigText(JSON.stringify({}))).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects payloads with too many groups', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxGroups: 2 } });
            const groupsById = { g1: { children: [] }, g2: { children: [] }, g3: { children: [] } };
            expect(parseImportConfigText(JSON.stringify({ groupsById, sourceStateById: {} })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects payloads with too many sources', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxSources: 2 } });
            const sourceStateById = { a: {}, b: {}, c: {} };
            expect(parseImportConfigText(JSON.stringify({ groupsById: {}, sourceStateById })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('counts positioned state.root sources toward the maxSources cap', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxSources: 2 } });
            // 2 bin sources + 1 positioned root source = 3 > cap 2.
            const payload = JSON.stringify({
                groupsById: {},
                root: [{ type: 'source', key: 'r1' }],
                ungrouped: ['a', 'b'],
                sourceStateById: {}
            });
            expect(parseImportConfigText(payload)).toEqual({ ok: false, reason: 'invalid' });
        });

        it('counts sourceTagsById-only references toward the maxSources cap', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({
                ...deps,
                limits: { maxSources: 2 }
            });
            const payload = JSON.stringify({
                groupsById: {},
                sourceStateById: {},
                sourceTagsById: {
                    a: [],
                    b: [],
                    c: []
                }
            });

            expect(parseImportConfigText(payload)).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects payloads with a cycle in the group tree through placement validation', () => {
            const groupsById = {
                a: {
                    id: 'a',
                    children: [{ type: 'group', id: 'b' }]
                },
                b: {
                    id: 'b',
                    children: [
                        { type: 'group', id: 'a' },
                        { type: 'source', key: 'legal' }
                    ]
                }
            };
            const { parseImportConfigText } = createContentImportExport(createDeps());
            const result = parseImportConfigText(JSON.stringify({
                root: [{ type: 'group', id: 'a' }],
                groupsById,
                ungrouped: [],
                sourceStateById: { legal: {} }
            }));

            expect(result).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects imported groups whose children exist only on Object.prototype', () => {
            const priorChildrenDescriptor = Object.getOwnPropertyDescriptor(
                Object.prototype,
                'children'
            );
            Object.defineProperty(Object.prototype, 'children', {
                configurable: true,
                value: [{ type: 'group', id: 'inherited-child' }]
            });
            try {
                const { parseImportConfigText } = createContentImportExport(createDeps());
                const result = parseImportConfigText(JSON.stringify({
                    root: [{ type: 'group', id: 'group-a' }],
                    groupsById: {
                        'group-a': { id: 'group-a' },
                        'inherited-child': {
                            id: 'inherited-child',
                            children: []
                        }
                    },
                    ungrouped: [],
                    sourceStateById: {}
                }));

                expect(result).toEqual({ ok: false, reason: 'invalid' });
            } finally {
                if (priorChildrenDescriptor) {
                    Object.defineProperty(
                        Object.prototype,
                        'children',
                        priorChildrenDescriptor
                    );
                } else {
                    delete Object.prototype.children;
                }
            }
        });

        it.each([
            [
                'a group id that does not match its map key',
                {
                    root: [{ type: 'group', id: 'g1' }],
                    groupsById: {
                        g1: { id: 'different-id', children: [] }
                    }
                }
            ],
            [
                'an unsupported group child entry',
                {
                    root: [{ type: 'group', id: 'g1' }],
                    groupsById: {
                        g1: {
                            id: 'g1',
                            children: [{ type: 'bogus', key: 'source-a' }]
                        }
                    }
                }
            ],
            [
                'a root reference to a missing group',
                {
                    root: [{ type: 'group', id: 'missing' }],
                    groupsById: {}
                }
            ]
        ])('rejects payloads with %s', async (label, placement) => {
            const deps = createDeps();
            const { parseImportConfigText, applyImportConfig } = createContentImportExport(deps);
            const text = JSON.stringify({
                ...placement,
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            });

            expect(parseImportConfigText(text)).toEqual({ ok: false, reason: 'invalid' });
            await expect(applyImportConfig(text)).resolves.toEqual({ ok: false, reason: 'invalid' });
            expect(deps.appendStateHistorySnapshot).not.toHaveBeenCalled();
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('rejects payloads exceeding the maxTreeDepth', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxTreeDepth: 2 } });
            const groupsById = {
                root: { id: 'root', children: [{ type: 'group', id: 'mid' }] },
                mid: { id: 'mid', children: [{ type: 'group', id: 'leaf' }] },
                leaf: { id: 'leaf', children: [{ type: 'group', id: 'too_deep' }] },
                too_deep: { id: 'too_deep', children: [] }
            };
            expect(parseImportConfigText(JSON.stringify({ groupsById, sourceStateById: {} })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('enforces maxTreeDepth independently of group object insertion order', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({
                ...deps,
                limits: { maxTreeDepth: 2 }
            });
            const groupsById = {
                leaf: { id: 'leaf', children: [] },
                mid: { id: 'mid', children: [{ type: 'group', id: 'leaf' }] },
                parent: { id: 'parent', children: [{ type: 'group', id: 'mid' }] },
                root: { id: 'root', children: [{ type: 'group', id: 'parent' }] }
            };

            expect(parseImportConfigText(JSON.stringify({
                root: [{ type: 'group', id: 'root' }],
                groupsById,
                ungrouped: [],
                sourceStateById: {}
            }))).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects null source metadata before preview or apply can mutate runtime', async () => {
            const deps = createDeps();
            const { parseImportConfigText, applyImportConfig } = createContentImportExport(deps);
            const text = JSON.stringify({
                root: [],
                groupsById: {},
                ungrouped: ['live'],
                sourceStateById: { live: null }
            });

            expect(parseImportConfigText(text)).toEqual({ ok: false, reason: 'invalid' });
            await expect(applyImportConfig(text)).resolves.toEqual({ ok: false, reason: 'invalid' });
            expect(deps.appendStateHistorySnapshot).not.toHaveBeenCalled();
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
        });

        it('unwraps payloads wrapped by getExportConfigText and returns the inner state', () => {
            const innerState = { groupsById: {}, sourceStateById: { a: {} } };
            const wrapped = { format: IMPORT_EXPORT_FORMAT, formatVersion: 1, data: innerState };
            const { parseImportConfigText } = createContentImportExport(createDeps());

            const result = parseImportConfigText(JSON.stringify(wrapped));

            expect(result.ok).toBe(true);
            expect(result.state).toEqual({
                ...innerState,
                root: [],
                ungrouped: ['a']
            });
        });

        it('rejects a wrapped config with an unknown formatVersion', () => {
            const deps = createDeps();
            const { IMPORT_EXPORT_FORMAT: format, parseImportConfigText } = createContentImportExport(deps);
            expect(parseImportConfigText(JSON.stringify({
                format,
                formatVersion: 2,
                data: {
                    schemaVersion: 5,
                    root: [],
                    groupsById: {},
                    ungrouped: [],
                    sourceStateById: {}
                }
            }))).toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects an unknown envelope instead of treating data as a bare state', () => {
            const { parseImportConfigText } = createContentImportExport(createDeps());
            expect(parseImportConfigText(JSON.stringify({
                format: 'unknown-config',
                formatVersion: 1,
                data: {
                    schemaVersion: 5,
                    root: [],
                    groupsById: {},
                    ungrouped: [],
                    sourceStateById: {}
                }
            }))).toEqual({ ok: false, reason: 'invalid' });
        });

        it('accepts a bare state without the export envelope', () => {
            const bare = { groupsById: {}, sourceStateById: { a: {} } };
            const { parseImportConfigText } = createContentImportExport(createDeps());

            const result = parseImportConfigText(JSON.stringify(bare));

            expect(result.ok).toBe(true);
            expect(result.state).toEqual({
                ...bare,
                root: [],
                ungrouped: ['a']
            });
        });
    });

    describe('collectImportSourceRefs', () => {
        it('includes positioned state.root {type:"source"} entries alongside ungrouped + grouped + sourceStateById', () => {
            const { collectImportSourceRefs } = createContentImportExport(createDeps());
            const importState = {
                groupsById: { g1: { children: [{ type: 'source', key: 'grouped' }] } },
                root: [{ type: 'group', id: 'g1' }, { type: 'source', key: 'positioned' }],
                ungrouped: ['bin'],
                sourceStateById: { recordOnly: {} }
            };
            const refs = collectImportSourceRefs(importState);
            expect(refs.has('grouped')).toBe(true);
            expect(refs.has('positioned')).toBe(true);
            expect(refs.has('bin')).toBe(true);
            expect(refs.has('recordOnly')).toBe(true);
        });

        it('ignores root group entries (only source entries become refs)', () => {
            const { collectImportSourceRefs } = createContentImportExport(createDeps());
            const refs = collectImportSourceRefs({
                groupsById: {},
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: [],
                sourceStateById: {}
            });
            expect(refs.size).toBe(0);
        });

        it('collects a source reference through a fifty-level imported tree iteratively', () => {
            const groupsById = {};
            const depth = 50;
            for (let level = 0; level < depth; level += 1) {
                groupsById[`g-${level}`] = {
                    id: `g-${level}`,
                    children: level < depth - 1
                        ? [{ type: 'group', id: `g-${level + 1}` }]
                        : [{ type: 'source', key: 'deep-source' }]
                };
            }
            const { collectImportSourceRefs } = createContentImportExport(createDeps());

            expect([...collectImportSourceRefs({
                groupsById,
                root: [{ type: 'group', id: 'g-0' }],
                ungrouped: [],
                sourceStateById: {}
            })]).toEqual(['deep-source']);
        });

        it('ignores group children inherited through Object.prototype', () => {
            const priorChildrenDescriptor = Object.getOwnPropertyDescriptor(
                Object.prototype,
                'children'
            );
            Object.defineProperty(Object.prototype, 'children', {
                configurable: true,
                value: [{ type: 'source', key: 'inherited-source' }]
            });
            try {
                const { collectImportSourceRefs } = createContentImportExport(createDeps());
                const refs = collectImportSourceRefs({
                    groupsById: {
                        g1: { id: 'g1' }
                    },
                    root: [{ type: 'group', id: 'g1' }],
                    ungrouped: [],
                    sourceStateById: {}
                });

                expect(refs.has('inherited-source')).toBe(false);
                expect(refs.size).toBe(0);
            } finally {
                if (priorChildrenDescriptor) {
                    Object.defineProperty(
                        Object.prototype,
                        'children',
                        priorChildrenDescriptor
                    );
                } else {
                    delete Object.prototype.children;
                }
            }
        });

        it('ignores tree entry fields inherited through Object.prototype', () => {
            const { collectImportSourceRefs } = createContentImportExport(createDeps());
            const priorTypeDescriptor = Object.getOwnPropertyDescriptor(
                Object.prototype,
                'type'
            );
            const priorKeyDescriptor = Object.getOwnPropertyDescriptor(
                Object.prototype,
                'key'
            );
            let refs;
            Object.defineProperty(Object.prototype, 'type', {
                configurable: true,
                value: 'source'
            });
            Object.defineProperty(Object.prototype, 'key', {
                configurable: true,
                value: 'inherited-source'
            });
            try {
                refs = collectImportSourceRefs({
                    groupsById: {
                        g1: {
                            id: 'g1',
                            children: [{}]
                        }
                    },
                    root: [{ type: 'group', id: 'g1' }, {}],
                    ungrouped: [],
                    sourceStateById: {}
                });
            } finally {
                if (priorTypeDescriptor) {
                    Object.defineProperty(Object.prototype, 'type', priorTypeDescriptor);
                } else {
                    delete Object.prototype.type;
                }
                if (priorKeyDescriptor) {
                    Object.defineProperty(Object.prototype, 'key', priorKeyDescriptor);
                } else {
                    delete Object.prototype.key;
                }
            }

            expect(refs.has('inherited-source')).toBe(false);
            expect(refs.size).toBe(0);
        });
    });

    describe('previewImportConfig', () => {
        it('passes through parse failures and developer-logs the reason', () => {
            const deps = createDeps();
            const { previewImportConfig } = createContentImportExport(deps);

            const result = previewImportConfig('');

            expect(result).toEqual({ ok: false, reason: 'empty' });
            expect(deps.developerLog).toHaveBeenCalledWith(
                'warn',
                'import_export',
                'config_import_preview_failed',
                { reason: 'empty' }
            );
        });

        it('partitions sources into matched and unmatched and reports counts in the preview', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['existing', { key: 'existing', enabled: false }]
                ])
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({ byKey: new Map([['existing', {}]]) })),
                resolveStoredSourceKey: jest.fn((storedKey) => (storedKey === 'existing' ? 'existing' : ''))
            });
            const { previewImportConfig } = createContentImportExport(deps);
            const payload = JSON.stringify({
                groupsById: {},
                sourceStateById: { existing: { enabled: true, title: 'A' }, missing: { enabled: true, title: 'B' } }
            });

            const result = previewImportConfig(payload);

            expect(result.ok).toBe(true);
            expect(result.totalSources).toBe(2);
            expect(result.matchedSources).toBe(1);
            expect(result.unmatchedSourceDetails).toHaveLength(1);
            expect(result.unmatchedSourceDetails[0].storedKey).toBe('missing');
            expect(result.diff.source.enableCount).toBe(1);
            expect(result.diff.source.disableCount).toBe(0);
        });

        it('fails closed when multiple stored sources resolve to the same live source', async () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['live', { key: 'live', enabled: true }]
                ])
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey: jest.fn(() => 'live')
            });
            const { previewImportConfig, applyImportConfig } = createContentImportExport(deps);
            const text = JSON.stringify({
                root: [
                    { type: 'group', id: 'a' },
                    { type: 'group', id: 'b' }
                ],
                groupsById: {
                    a: {
                        id: 'a',
                        children: [{ type: 'source', key: 'stored-a' }]
                    },
                    b: {
                        id: 'b',
                        children: [{ type: 'source', key: 'stored-b' }]
                    }
                },
                ungrouped: [],
                sourceStateById: {
                    'stored-a': { enabled: true },
                    'stored-b': { enabled: false }
                }
            });

            expect(previewImportConfig(text)).toEqual(expect.objectContaining({
                ok: false,
                reason: 'invalid',
                conflictingSourceDetails: [
                    expect.objectContaining({ storedKey: 'stored-a', resolvedKey: 'live' }),
                    expect.objectContaining({ storedKey: 'stored-b', resolvedKey: 'live' })
                ]
            }));
            await expect(applyImportConfig(text)).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'invalid'
            }));
            expect(deps.appendStateHistorySnapshot).not.toHaveBeenCalled();
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
        });

        it('canonicalizes group and tag metadata and keeps only safe source fields', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['live', {
                        key: 'live',
                        enabled: true,
                        title: 'Live title',
                        stableToken: 'live-token'
                    }]
                ])
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey: jest.fn(() => 'live'),
                buildNormalizedTagState: jest.fn(() => ({
                    nextTagsById: new Map([[
                        'bad_id',
                        { id: 'bad_id', label: 'Tag', color: '#007AFF' }
                    ]]),
                    nextTagOrder: ['bad_id'],
                    rawToSafeTagId: new Map([['bad id', 'bad_id']])
                }))
            });
            const { previewImportConfig } = createContentImportExport(deps);
            const result = previewImportConfig(JSON.stringify({
                root: [{ type: 'group', id: 'g1' }],
                groupsById: {
                    g1: {
                        id: 'g1',
                        title: 'Folder',
                        collapsed: 'true',
                        children: [{ type: 'source', key: 'stored' }]
                    }
                },
                ungrouped: [],
                sourceStateById: {
                    stored: {
                        enabled: false,
                        title: 'Stored title',
                        normalizedTitle: 'stored title',
                        stableToken: 'stored-token',
                        fingerprint: 'stored-fingerprint',
                        identityType: 'fingerprint',
                        addedAt: '2026-01-02'
                    }
                },
                tagsById: {
                    'bad id': { id: 'bad id', label: ' Tag ', color: 'bad-color' }
                },
                tagOrder: ['bad id'],
                sourceTagsById: {
                    stored: ['bad id', 'missing-tag', 'bad id']
                }
            }));

            expect(result.ok).toBe(true);
            expect(result.state.groupsById.g1).toEqual(expect.objectContaining({
                id: 'g1',
                title: 'Folder',
                enabled: true,
                collapsed: false
            }));
            expect(result.state.tagsById).toEqual({
                bad_id: { id: 'bad_id', label: 'Tag', color: '#007AFF' }
            });
            expect(result.state.tagOrder).toEqual(['bad_id']);
            expect(result.state.sourceTagsById).toEqual({ live: ['bad_id'] });
            expect(result.state.sourceStateById).toEqual({
                live: { enabled: false, addedAt: '2026-01-02' }
            });
        });

        it('matches and remaps sourceTagsById-only references in the preview report and state', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([['live', { key: 'live', enabled: true }]])
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey: jest.fn((storedKey) => (
                    storedKey === 'stored' ? 'live' : ''
                ))
            });
            const { previewImportConfig } = createContentImportExport(deps);

            const result = previewImportConfig(JSON.stringify({
                root: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                tagsById: {
                    tag: { id: 'tag', label: 'Tag' }
                },
                tagOrder: ['tag'],
                sourceTagsById: {
                    stored: ['tag']
                }
            }));

            expect(result).toEqual(expect.objectContaining({
                ok: true,
                totalSources: 1,
                matchedSources: 1,
                unmatchedSourceDetails: []
            }));
            expect(result.state.sourceTagsById).toEqual({ live: ['tag'] });
            expect(result.diff.source).toEqual(expect.objectContaining({
                totalSources: 1,
                matchedSources: 1,
                unmatchedSources: 0
            }));
        });

        it('reports canonical tag counts and an explicit source-view change', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([['live', { key: 'live', enabled: true }]]),
                sourceViewDisplayKind: 'list'
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey: jest.fn(() => 'live'),
                buildNormalizedTagState: jest.fn(() => ({
                    nextTagsById: new Map([[
                        'safe_tag',
                        { id: 'safe_tag', label: 'Safe tag', color: '#007AFF' }
                    ]]),
                    nextTagOrder: ['safe_tag'],
                    rawToSafeTagId: new Map([['unsafe tag', 'safe_tag']])
                }))
            });
            const { previewImportConfig } = createContentImportExport(deps);

            const result = previewImportConfig(JSON.stringify({
                root: [{ type: 'group', id: 'folder' }],
                groupsById: {
                    folder: {
                        id: 'folder',
                        title: 'Folder',
                        children: [{ type: 'source', key: 'stored' }]
                    }
                },
                ungrouped: [],
                sourceStateById: {
                    stored: { enabled: true }
                },
                tagsById: {
                    'unsafe tag': { id: 'unsafe tag', label: 'Safe tag' },
                    invalid: { id: 'invalid', label: '' }
                },
                tagOrder: ['unsafe tag', 'invalid'],
                sourceViewDisplayKind: 'label'
            }));

            expect(result.ok).toBe(true);
            expect(result.groupCount).toBe(1);
            expect(result.tagCount).toBe(1);
            expect(result.diff.folders.incomingCount).toBe(1);
            expect(result.diff.tags).toEqual(expect.objectContaining({
                incomingCount: 1,
                normalizedIdCount: 1
            }));
            expect(result.state.sourceViewDisplayKind).toBe('label');
            expect(result.diff.settings.changesSourceViewDisplayKind).toBe(true);
        });

        it('preserves reserved source keys as own properties during remap', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['__proto__', { key: '__proto__', enabled: true }]
                ])
            });
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey: jest.fn(() => '__proto__'),
                buildNormalizedTagState: jest.fn(() => ({
                    nextTagsById: new Map([['safe', { id: 'safe', label: 'Safe' }]]),
                    nextTagOrder: ['safe'],
                    rawToSafeTagId: new Map([['safe', 'safe']])
                }))
            });
            const { previewImportConfig } = createContentImportExport(deps);
            const payload = JSON.parse(`{
                "root": [],
                "groupsById": {},
                "ungrouped": ["__proto__"],
                "sourceStateById": {
                    "__proto__": { "enabled": false }
                },
                "tagsById": {
                    "safe": { "id": "safe", "label": "Safe" }
                },
                "tagOrder": ["safe"],
                "sourceTagsById": {
                    "__proto__": ["safe"]
                }
            }`);

            const result = previewImportConfig(JSON.stringify(payload));

            expect(result.ok).toBe(true);
            expect(Object.prototype.hasOwnProperty.call(
                result.state.sourceStateById,
                '__proto__'
            )).toBe(true);
            expect(result.state.sourceStateById.__proto__).toEqual({ enabled: false });
            expect(Object.prototype.hasOwnProperty.call(
                result.state.sourceTagsById,
                '__proto__'
            )).toBe(true);
            expect(result.state.sourceTagsById.__proto__).toEqual(['safe']);
        });

        it('does not read an inherited __proto__ value as imported source metadata', () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['__proto__', { key: '__proto__', enabled: true }]
                ])
            });
            const resolveStoredSourceKey = jest.fn(() => '__proto__');
            const deps = createDeps({
                runtime,
                buildSourceLookup: jest.fn(() => ({})),
                resolveStoredSourceKey
            });
            const { previewImportConfig } = createContentImportExport(deps);

            const result = previewImportConfig(JSON.stringify({
                root: [],
                groupsById: {},
                ungrouped: ['__proto__'],
                sourceStateById: {}
            }));

            expect(result.ok).toBe(true);
            expect(resolveStoredSourceKey).toHaveBeenCalledWith(
                '__proto__',
                expect.anything(),
                null
            );
            expect(result.diff.source).toEqual(expect.objectContaining({
                enableCount: 0,
                disableCount: 0,
                unchangedCount: 0
            }));
        });

        it('does not read inherited fields from an own tag in fallback normalization', () => {
            const priorLabelDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'label');
            Object.defineProperty(Object.prototype, 'label', {
                configurable: true,
                value: 'Inherited tag'
            });
            try {
                const { previewImportConfig } = createContentImportExport(createDeps());
                const result = previewImportConfig(JSON.stringify({
                    root: [],
                    groupsById: {},
                    ungrouped: [],
                    sourceStateById: {},
                    tagsById: {
                        safe: {}
                    },
                    tagOrder: ['safe'],
                    sourceTagsById: {}
                }));

                expect(result.ok).toBe(true);
                expect(result.state.tagsById).toEqual({});
                expect(result.state.tagOrder).toEqual([]);
            } finally {
                if (priorLabelDescriptor) {
                    Object.defineProperty(Object.prototype, 'label', priorLabelDescriptor);
                } else {
                    delete Object.prototype.label;
                }
            }
        });
    });

    describe('applyImportConfig', () => {
        it('shows the empty toast and returns failure for empty input', async () => {
            const deps = createDeps();
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig('');

            expect(result.ok).toBe(false);
            expect(result.reason).toBe('empty');
            expect(deps.showToast).toHaveBeenCalledWith('ui_settings_import_empty', { variant: 'error' });
            expect(deps.appendStateHistorySnapshot).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('shows the invalid toast for malformed JSON', async () => {
            const deps = createDeps();
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig('{bad');

            expect(result.ok).toBe(false);
            expect(result.reason).toBe('invalid');
            expect(deps.showToast).toHaveBeenCalledWith('ui_settings_import_invalid', { variant: 'error' });
        });

        it('runs the full apply pipeline on a valid import: history, backup, state apply, render and save', async () => {
            const deps = createDeps();
            const { applyImportConfig } = createContentImportExport(deps);
            const valid = JSON.stringify({ groupsById: {}, sourceStateById: { a: {} }, customHeight: 320 });

            const result = await applyImportConfig(valid);

            expect(result.ok).toBe(true);
            expect(deps.appendStateHistorySnapshot).toHaveBeenCalledTimes(1);
            expect(deps.writeImportBackupSnapshot).toHaveBeenCalledTimes(1);
            expect(deps.applyPersistableSnapshotToRuntime).toHaveBeenCalledTimes(1);
            expect(deps.render).toHaveBeenCalledTimes(1);
            expect(deps.saveState).toHaveBeenCalledWith({
                immediate: true,
                critical: true,
                recoveryFallbackSnapshot: {
                    sourceStateById: {},
                    groupsById: {},
                    tagsById: {}
                },
                allowLocalFallback: false
            });
            expect(deps.showToast).toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.objectContaining({
                    variant: 'success',
                    actionLabel: 'ui_settings_restore_import_backup',
                    onAction: expect.any(Function)
                })
            );
            expect(deps.runtime.customHeight).toBe(320);
        });

        it('applies the exact placement-normalized state returned by preview', async () => {
            const runtime = createRuntime({
                sourcesByKey: new Map([
                    ['dup', { key: 'dup' }],
                    ['orphan', { key: 'orphan' }]
                ])
            });
            const deps = createDeps({ runtime });
            const { previewImportConfig, applyImportConfig } = createContentImportExport(deps);
            const text = JSON.stringify({
                root: [
                    { type: 'group', id: 'g1' },
                    { type: 'source', key: 'dup' }
                ],
                groupsById: {
                    g1: {
                        id: 'g1',
                        children: [{ type: 'source', key: 'dup' }]
                    }
                },
                ungrouped: ['dup'],
                sourceStateById: {
                    dup: {},
                    orphan: {}
                }
            });

            const preview = previewImportConfig(text);
            const result = await applyImportConfig(text);

            expect(preview.ok).toBe(true);
            expect(result.state).toEqual(preview.state);
            expect(deps.applyPersistableSnapshotToRuntime).toHaveBeenCalledWith(preview.state);
            expect(preview.state.groupsById.g1.children).toEqual([
                { type: 'source', key: 'dup' }
            ]);
            expect(preview.state.root).toEqual([{ type: 'group', id: 'g1' }]);
            expect(preview.state.ungrouped).toEqual(['orphan']);
        });

        it('rolls back when state apply rejects the prepared placement', async () => {
            const deps = createDeps({
                applyPersistableSnapshotToRuntime: jest.fn(() => false)
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({ groupsById: {}, sourceStateById: {} }));

            expect(result.ok).toBe(false);
            expect(result.reason).toBe('invalid');
            expect(result.rolledBack).toBe(true);
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledWith({
                sourceStateById: {},
                groupsById: {},
                tagsById: {}
            });
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith('ui_settings_import_invalid', { variant: 'error' });
        });

        it('rolls back when state apply throws after beginning the runtime transaction', async () => {
            let runtimeMarker = 'before';
            const deps = createDeps({
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtimeMarker = 'partially-applied';
                    throw new TypeError('malformed source state');
                }),
                rollbackImportSnapshot: jest.fn(() => {
                    runtimeMarker = 'before';
                    return true;
                })
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                groupsById: {},
                sourceStateById: { a: { enabled: true } }
            }));

            expect(result).toEqual(expect.objectContaining({
                ok: false,
                reason: 'invalid',
                rolledBack: true
            }));
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledTimes(1);
            expect(runtimeMarker).toBe('before');
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith(
                'ui_settings_import_invalid',
                { variant: 'error' }
            );
        });

        it('rolls back transient state and skips save when render throws after apply', async () => {
            const runtime = createRuntime({
                state: {
                    root: [],
                    ungrouped: [],
                    activeTagId: 'before-tag',
                    isBatchMode: true
                },
                pendingBatchKeys: new Set(['before-source'])
            });
            const deps = createDeps({
                runtime,
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtime.state.activeTagId = null;
                    runtime.state.isBatchMode = false;
                    runtime.pendingBatchKeys.clear();
                    return true;
                }),
                render: jest.fn(() => {
                    throw new Error('render failed');
                })
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'invalid',
                rolledBack: true
            });
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledTimes(1);
            expect(runtime.state.activeTagId).toBe('before-tag');
            expect(runtime.state.isBatchMode).toBe(true);
            expect(runtime.pendingBatchKeys).toEqual(new Set(['before-source']));
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('restores the pre-import runtime when the critical save fails', async () => {
            const before = {
                schemaVersion: 5,
                root: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                customHeight: null
            };
            const deps = createDeps({
                buildPersistableState: jest.fn(() => before),
                saveState: jest.fn(async () => ({
                    ok: false,
                    reason: 'storage_quota_exceeded'
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                root: [{ type: 'group', id: 'after' }],
                groupsById: {
                    after: { id: 'after', children: [] }
                },
                ungrouped: [],
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'storage_quota_exceeded',
                rolledBack: true
            });
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledWith(before);
            expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
                recoveryFallbackSnapshot: before,
                allowLocalFallback: false
            }));
            expect(deps.developerLog).toHaveBeenCalledWith(
                'warn',
                'import_export',
                'config_import_apply_failed',
                expect.objectContaining({ reason: 'storage_quota_exceeded' })
            );
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('rolls back and reports an ambiguous acknowledgement when the critical save throws', async () => {
            const before = {
                schemaVersion: 5,
                root: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                customHeight: null
            };
            const deps = createDeps({
                buildPersistableState: jest.fn(() => before),
                saveState: jest.fn(async () => {
                    throw new Error('context invalidated');
                })
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'import_ack_unknown',
                rolledBack: true
            });
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledWith(before);
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('treats a missing critical-save acknowledgement as failure and rolls back', async () => {
            const deps = createDeps({
                saveState: jest.fn(async () => undefined)
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'import_ack_unknown',
                rolledBack: true
            });
            expect(deps.rollbackImportSnapshot).toHaveBeenCalledTimes(1);
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('returns a structured failure without applying when history capture rejects', async () => {
            const deps = createDeps({
                appendStateHistorySnapshot: jest.fn(async () => {
                    throw new Error('history unavailable');
                })
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'save_failed',
                historyFailed: true
            });
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith('ui_save_failed', {
                variant: 'error'
            });
        });

        it('returns stale context without showing a history error after notebook navigation', async () => {
            let rejectHistory;
            const runtime = createRuntime({
                projectId: 'notebook-a',
                activeManagerInstanceToken: 31
            });
            const deps = createDeps({
                runtime,
                appendStateHistorySnapshot: jest.fn(() => new Promise((resolve, reject) => {
                    rejectHistory = reject;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 5 && typeof rejectHistory !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.projectId = 'notebook-b';
            runtime.activeManagerInstanceToken = 32;
            rejectHistory(new Error('history unavailable'));

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleContext: true
            }));
            expect(deps.showToast).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('restores transient selection state when a failed save rolls back', async () => {
            const runtime = createRuntime({
                state: {
                    root: [],
                    ungrouped: [],
                    activeTagId: 'before-tag',
                    isBatchMode: true
                },
                pendingBatchKeys: new Set(['before-source'])
            });
            const deps = createDeps({
                runtime,
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtime.state.activeTagId = null;
                    runtime.state.isBatchMode = false;
                    runtime.pendingBatchKeys.clear();
                    return true;
                }),
                rollbackImportSnapshot: jest.fn(() => true),
                saveState: jest.fn(async () => ({
                    ok: false,
                    reason: 'storage_quota_exceeded'
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'storage_quota_exceeded',
                rolledBack: true
            });
            expect(runtime.state.activeTagId).toBe('before-tag');
            expect(runtime.state.isBatchMode).toBe(true);
            expect(runtime.pendingBatchKeys).toEqual(new Set(['before-source']));
        });

        it('defers before applying when the live source set changes during history capture', async () => {
            let settleHistory;
            const runtime = createRuntime({
                sourcesByKey: new Map([['source-a', { key: 'source-a', enabled: true }]])
            });
            const deps = createDeps({
                runtime,
                appendStateHistorySnapshot: jest.fn(() => new Promise((resolve) => {
                    settleHistory = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                ungrouped: ['source-a'],
                sourceStateById: {
                    'source-a': { enabled: true }
                }
            }));
            for (let index = 0; index < 5 && typeof settleHistory !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.sourcesByKey.set('source-b', {
                key: 'source-b',
                enabled: true
            });
            settleHistory(true);

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleSources: true
            }));
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('defers before applying when runtime placement changes during history capture', async () => {
            let settleHistory;
            const runtime = createRuntime({
                state: {
                    root: [
                        { type: 'group', id: 'a' },
                        { type: 'group', id: 'b' }
                    ],
                    ungrouped: []
                },
                groupsById: new Map([
                    ['a', { id: 'a', title: 'A', children: [] }],
                    ['b', { id: 'b', title: 'B', children: [] }]
                ])
            });
            const buildPersistableState = jest.fn(() => ({
                schemaVersion: 5,
                root: runtime.state.root.map((entry) => ({ ...entry })),
                groupsById: Object.fromEntries(runtime.groupsById),
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }));
            const deps = createDeps({
                runtime,
                buildPersistableState,
                appendStateHistorySnapshot: jest.fn(() => new Promise((resolve) => {
                    settleHistory = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                root: [],
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 5 && typeof settleHistory !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.state.root = [
                { type: 'group', id: 'b' },
                { type: 'group', id: 'a' }
            ];
            settleHistory(true);

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleState: true
            }));
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('defers before applying when transient selection changes during history capture', async () => {
            let settleHistory;
            const runtime = createRuntime({
                state: {
                    root: [],
                    ungrouped: [],
                    activeTagId: 'before-tag',
                    isBatchMode: true
                },
                pendingBatchKeys: new Set(['before-source'])
            });
            const deps = createDeps({
                runtime,
                appendStateHistorySnapshot: jest.fn(() => new Promise((resolve) => {
                    settleHistory = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 5 && typeof settleHistory !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.state.activeTagId = 'concurrent-tag';
            runtime.state.isBatchMode = true;
            runtime.pendingBatchKeys.clear();
            runtime.pendingBatchKeys.add('concurrent-source');
            settleHistory(true);

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleState: true
            }));
            expect(runtime.state.activeTagId).toBe('concurrent-tag');
            expect(runtime.state.isBatchMode).toBe(true);
            expect(runtime.pendingBatchKeys).toEqual(new Set(['concurrent-source']));
            expect(deps.writeImportBackupSnapshot).not.toHaveBeenCalled();
            expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('does not overwrite a concurrent runtime change when critical save fails', async () => {
            let settleSave;
            const runtime = createRuntime({
                state: {
                    root: [{ type: 'group', id: 'before' }],
                    ungrouped: []
                },
                groupsById: new Map([[
                    'before',
                    { id: 'before', title: 'Before', children: [] }
                ]])
            });
            const buildPersistableState = jest.fn(() => ({
                schemaVersion: 5,
                root: runtime.state.root.map((entry) => ({ ...entry })),
                groupsById: Object.fromEntries(runtime.groupsById),
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }));
            const deps = createDeps({
                runtime,
                buildPersistableState,
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtime.state.root = [{ type: 'group', id: 'imported' }];
                    runtime.groupsById = new Map([[
                        'imported',
                        { id: 'imported', title: 'Imported', children: [] }
                    ]]);
                    return true;
                }),
                saveState: jest.fn(() => new Promise((resolve) => {
                    settleSave = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                root: [{ type: 'group', id: 'imported' }],
                groupsById: {
                    imported: { id: 'imported', title: 'Imported', children: [] }
                },
                sourceStateById: {}
            }));
            for (let index = 0; index < 10 && typeof settleSave !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.state.root = [{ type: 'group', id: 'concurrent' }];
            runtime.groupsById = new Map([[
                'concurrent',
                { id: 'concurrent', title: 'Concurrent', children: [] }
            ]]);
            settleSave({ ok: false, reason: 'runtime_failure' });

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleState: true,
                rolledBack: false
            }));
            expect(runtime.state.root).toEqual([{ type: 'group', id: 'concurrent' }]);
            expect(deps.rollbackImportSnapshot).not.toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('does not report success when runtime changes during a successful critical save', async () => {
            let settleSave;
            const runtime = createRuntime({
                state: {
                    root: [{ type: 'group', id: 'before' }],
                    ungrouped: []
                },
                groupsById: new Map([[
                    'before',
                    { id: 'before', title: 'Before', children: [] }
                ]])
            });
            const buildPersistableState = jest.fn(() => ({
                schemaVersion: 5,
                root: runtime.state.root.map((entry) => ({ ...entry })),
                groupsById: Object.fromEntries(runtime.groupsById),
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }));
            const deps = createDeps({
                runtime,
                buildPersistableState,
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtime.state.root = [{ type: 'group', id: 'imported' }];
                    runtime.groupsById = new Map([[
                        'imported',
                        { id: 'imported', title: 'Imported', children: [] }
                    ]]);
                    return true;
                }),
                saveState: jest.fn(() => new Promise((resolve) => {
                    settleSave = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                root: [{ type: 'group', id: 'imported' }],
                groupsById: {
                    imported: { id: 'imported', title: 'Imported', children: [] }
                },
                sourceStateById: {}
            }));
            for (let index = 0; index < 10 && typeof settleSave !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.state.root = [{ type: 'group', id: 'concurrent' }];
            runtime.groupsById = new Map([[
                'concurrent',
                { id: 'concurrent', title: 'Concurrent', children: [] }
            ]]);
            settleSave({ ok: true });

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleState: true,
                rolledBack: false
            }));
            expect(runtime.state.root).toEqual([{ type: 'group', id: 'concurrent' }]);
            expect(deps.rollbackImportSnapshot).not.toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('does not overwrite concurrent transient selection when critical save fails', async () => {
            let settleSave;
            const runtime = createRuntime({
                state: {
                    root: [],
                    ungrouped: [],
                    activeTagId: 'before-tag',
                    isBatchMode: true
                },
                pendingBatchKeys: new Set(['before-source'])
            });
            const deps = createDeps({
                runtime,
                applyPersistableSnapshotToRuntime: jest.fn(() => {
                    runtime.state.activeTagId = null;
                    runtime.state.isBatchMode = false;
                    runtime.pendingBatchKeys.clear();
                    return true;
                }),
                saveState: jest.fn(() => new Promise((resolve) => {
                    settleSave = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);
            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 10 && typeof settleSave !== 'function'; index += 1) {
                await Promise.resolve();
            }

            runtime.state.activeTagId = 'concurrent-tag';
            runtime.state.isBatchMode = true;
            runtime.pendingBatchKeys.add('concurrent-source');
            settleSave({ ok: false, reason: 'runtime_failure' });

            await expect(pendingImport).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: 'deferred',
                staleState: true,
                rolledBack: false
            }));
            expect(runtime.state.activeTagId).toBe('concurrent-tag');
            expect(runtime.state.isBatchMode).toBe(true);
            expect(runtime.pendingBatchKeys).toEqual(new Set(['concurrent-source']));
            expect(deps.rollbackImportSnapshot).not.toHaveBeenCalled();
        });

        it('omits the restore action when the session import backup is unavailable', async () => {
            const deps = createDeps({
                writeImportBackupSnapshot: jest.fn(() => null)
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result.ok).toBe(true);
            expect(deps.showToast).toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                { variant: 'success' }
            );
        });

        it.each([
            ['stale_revision', 'save_failed'],
            ['runtime_unavailable', 'save_failed'],
            ['runtime_failure', 'save_failed'],
            ['runtime_message_error', 'import_ack_unknown'],
            ['runtime_exception', 'import_ack_unknown'],
            ['empty_response', 'import_ack_unknown']
        ])('maps %s to the declared import failure reason %s', async (saveReason, expectedReason) => {
            const deps = createDeps({
                saveState: jest.fn(async () => ({ ok: false, reason: saveReason }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: expectedReason,
                rolledBack: true
            });
        });

        it('returns rollback_failed and never shows success when runtime rollback fails', async () => {
            const deps = createDeps({
                rollbackImportSnapshot: jest.fn(() => false),
                saveState: jest.fn(async () => ({ ok: false, reason: 'storage_quota_exceeded' }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));

            expect(result).toMatchObject({
                ok: false,
                reason: 'rollback_failed',
                rolledBack: false
            });
            expect(deps.showToast).not.toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.anything()
            );
        });

        it('does not show notebook A import success after navigation to notebook B', async () => {
            let settleSave;
            const runtime = createRuntime({
                projectId: 'notebook-a',
                activeManagerInstanceToken: 11
            });
            const deps = createDeps({
                runtime,
                saveState: jest.fn(() => new Promise((resolve) => {
                    settleSave = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 5 && typeof settleSave !== 'function'; index += 1) {
                await Promise.resolve();
            }
            const renderCountBeforeNavigation = deps.render.mock.calls.length;
            runtime.projectId = 'notebook-b';
            runtime.activeManagerInstanceToken = 12;
            settleSave({ ok: true });

            const result = await pendingImport;

            expect(result).toMatchObject({
                ok: false,
                reason: 'deferred',
                staleContext: true
            });
            expect(deps.render).toHaveBeenCalledTimes(renderCountBeforeNavigation);
            expect(deps.rollbackImportSnapshot).not.toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalled();
        });

        it('does not roll notebook B back when notebook A import fails after navigation', async () => {
            let settleSave;
            const runtime = createRuntime({
                projectId: 'notebook-a',
                activeManagerInstanceToken: 21
            });
            const deps = createDeps({
                runtime,
                saveState: jest.fn(() => new Promise((resolve) => {
                    settleSave = resolve;
                }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const pendingImport = applyImportConfig(JSON.stringify({
                schemaVersion: 5,
                groupsById: {},
                sourceStateById: {}
            }));
            for (let index = 0; index < 5 && typeof settleSave !== 'function'; index += 1) {
                await Promise.resolve();
            }
            const renderCountBeforeNavigation = deps.render.mock.calls.length;
            runtime.projectId = 'notebook-b';
            runtime.activeManagerInstanceToken = 22;
            settleSave({ ok: false, reason: 'runtime_message_error' });

            const result = await pendingImport;

            expect(result).toMatchObject({
                ok: false,
                reason: 'deferred',
                staleContext: true
            });
            expect(deps.rollbackImportSnapshot).not.toHaveBeenCalled();
            expect(deps.render).toHaveBeenCalledTimes(renderCountBeforeNavigation);
            expect(deps.showToast).not.toHaveBeenCalled();
        });
    });
});
