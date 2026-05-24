const createContentImportExport = require('../../src/content/content-import-export.js');

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
        ...overrides
    };
}

function createDeps(overrides = {}) {
    return {
        runtime: createRuntime(),
        cloneSerializableData: jest.fn(passThroughClone),
        normalizeLoadedState: jest.fn((value) => value),
        hasPersistableManagerState: jest.fn((state) => Boolean(state)),
        buildPersistableState: jest.fn(() => ({ sourceStateById: {}, groupsById: {}, tagsById: {} })),
        applyPersistableSnapshotToRuntime: jest.fn(() => true),
        appendStateHistorySnapshot: jest.fn(async () => true),
        restoreInitialLoadedState: jest.fn(() => ({ deferred: false })),
        saveState: jest.fn(async () => ({ ok: true })),
        render: jest.fn(),
        showToast: jest.fn(),
        getMessage: jest.fn((key) => key),
        developerLog: jest.fn(),
        writeImportBackupSnapshot: jest.fn(),
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

        it('rejects payloads with a cycle in the group tree', () => {
            const groupsById = {
                a: { children: [{ type: 'group', id: 'b' }] },
                b: { children: [{ type: 'group', id: 'a' }] }
            };
            const { parseImportConfigText } = createContentImportExport(createDeps());
            expect(parseImportConfigText(JSON.stringify({ groupsById, sourceStateById: {} })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('rejects payloads exceeding the maxTreeDepth', () => {
            const deps = createDeps();
            const { parseImportConfigText } = createContentImportExport({ ...deps, limits: { maxTreeDepth: 2 } });
            const groupsById = {
                root: { children: [{ type: 'group', id: 'mid' }] },
                mid: { children: [{ type: 'group', id: 'leaf' }] },
                leaf: { children: [{ type: 'group', id: 'too_deep' }] },
                too_deep: { children: [] }
            };
            expect(parseImportConfigText(JSON.stringify({ groupsById, sourceStateById: {} })))
                .toEqual({ ok: false, reason: 'invalid' });
        });

        it('unwraps payloads wrapped by getExportConfigText and returns the inner state', () => {
            const innerState = { groupsById: {}, sourceStateById: { a: {} } };
            const wrapped = { format: IMPORT_EXPORT_FORMAT, formatVersion: 1, data: innerState };
            const { parseImportConfigText } = createContentImportExport(createDeps());

            const result = parseImportConfigText(JSON.stringify(wrapped));

            expect(result.ok).toBe(true);
            expect(result.state).toEqual(innerState);
        });

        it('accepts a bare state without the export envelope', () => {
            const bare = { groupsById: {}, sourceStateById: { a: {} } };
            const { parseImportConfigText } = createContentImportExport(createDeps());

            const result = parseImportConfigText(JSON.stringify(bare));

            expect(result.ok).toBe(true);
            expect(result.state).toEqual(bare);
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

        it('runs the full apply pipeline on a valid import: history, backup, restore, render and save', async () => {
            const deps = createDeps();
            const { applyImportConfig } = createContentImportExport(deps);
            const valid = JSON.stringify({ groupsById: {}, sourceStateById: { a: {} }, customHeight: 320 });

            const result = await applyImportConfig(valid);

            expect(result.ok).toBe(true);
            expect(deps.appendStateHistorySnapshot).toHaveBeenCalledTimes(1);
            expect(deps.writeImportBackupSnapshot).toHaveBeenCalledTimes(1);
            expect(deps.restoreInitialLoadedState).toHaveBeenCalledTimes(1);
            expect(deps.render).toHaveBeenCalledTimes(1);
            expect(deps.saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
            expect(deps.showToast).toHaveBeenCalledWith(
                'ui_settings_imported_toast',
                expect.objectContaining({
                    variant: 'success',
                    actionLabel: 'ui_settings_restore_import_backup',
                    onAction: deps.restoreImportBackupSnapshotFromUi
                })
            );
            expect(deps.runtime.customHeight).toBe(320);
        });

        it('returns deferred when restoreInitialLoadedState defers the apply', async () => {
            const deps = createDeps({
                restoreInitialLoadedState: jest.fn(() => ({ deferred: true }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({ groupsById: {}, sourceStateById: {} }));

            expect(result.ok).toBe(false);
            expect(result.reason).toBe('deferred');
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith('ui_settings_import_deferred', { variant: 'info' });
        });

        it('reports save failure when saveState rejects the save', async () => {
            const deps = createDeps({
                saveState: jest.fn(async () => ({ ok: false, reason: 'quota_exceeded' }))
            });
            const { applyImportConfig } = createContentImportExport(deps);

            const result = await applyImportConfig(JSON.stringify({ groupsById: {}, sourceStateById: {} }));

            expect(result.ok).toBe(false);
            expect(result.reason).toBe('quota_exceeded');
            expect(deps.developerLog).toHaveBeenCalledWith(
                'warn',
                'import_export',
                'config_import_apply_failed',
                expect.objectContaining({ reason: 'quota_exceeded' })
            );
        });
    });
});
