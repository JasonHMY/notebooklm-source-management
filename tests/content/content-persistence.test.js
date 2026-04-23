const fs = require('fs');
const path = require('path');
const {
    CONTENT_HELPER_GLOBALS,
    setupGlobalMocks,
    teardownGlobalMocks,
    loadContentModule,
    loadFreshContentModule,
    createMockSourceRow,
    createMockImageCandidate,
    createSearchUiMock,
    createMockPanel,
    createInitShadowRoot,
    createTreeEl
} = require('../helpers/content-test-harness');

describe('saveState', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });
    let mod;
    let expectedPersistableState;

    const seedPersistedState = () => {
        const projectId = 'test_project_id';
        if (mod._setProjectId) mod._setProjectId(projectId); else mod.projectId = projectId;

        mod.state.groups = ['group1', 'group2'];
        mod.state.ungrouped = ['source3'];

        mod.groupsById.set('group1', { id: 'group1', title: 'Group 1', children: [{ type: 'source', key: 'source1' }] });
        mod.groupsById.set('group2', { id: 'group2', title: 'Group 2', children: [{ type: 'source', key: 'source2' }] });

        mod.sourcesByKey.set('source1', { enabled: true, title: 'Source 1', normalizedTitle: 'source 1', stableToken: 'doc-1', fingerprint: 'source 1||article', identityType: 'stable-token' });
        mod.sourcesByKey.set('source2', { enabled: false, title: 'Source 2', normalizedTitle: 'source 2', stableToken: 'doc-2', fingerprint: 'source 2||article', identityType: 'stable-token' });
        mod.sourcesByKey.set('source3', { enabled: true, title: 'Source 3', normalizedTitle: 'source 3', stableToken: '', fingerprint: 'source 3||article', identityType: 'fingerprint' });

        mod._setCustomHeight(500);

        expectedPersistableState = {
            schemaVersion: 3,
            groups: ['group1', 'group2'],
            groupsById: {
                group1: { id: 'group1', title: 'Group 1', children: [{ type: 'source', key: 'source1' }] },
                group2: { id: 'group2', title: 'Group 2', children: [{ type: 'source', key: 'source2' }] }
            },
            ungrouped: ['source3'],
            sourceStateById: {
                source1: {
                    enabled: true,
                    title: 'Source 1',
                    normalizedTitle: 'source 1',
                    stableToken: 'doc-1',
                    fingerprint: 'source 1||article',
                    identityType: 'stable-token'
                },
                source2: {
                    enabled: false,
                    title: 'Source 2',
                    normalizedTitle: 'source 2',
                    stableToken: 'doc-2',
                    fingerprint: 'source 2||article',
                    identityType: 'stable-token'
                },
                source3: {
                    enabled: true,
                    title: 'Source 3',
                    normalizedTitle: 'source 3',
                    stableToken: '',
                    fingerprint: 'source 3||article',
                    identityType: 'fingerprint'
                }
            },
            customHeight: 500,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };

        return projectId;
    };

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();

        // Microtask queue processing control
        let queuedTask = null;
        global.queueMicrotask = jest.fn((cb) => {
            queuedTask = cb;
        });

        global.processMicrotasks = () => {
            if (queuedTask) {
                queuedTask();
                queuedTask = null;
            }
        };

        mod = loadContentModule();
        if (mod._resetState) mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('returns early if projectId is missing', () => {
        if (mod._setProjectId) mod._setProjectId(null); else mod.projectId = null;
        mod.saveState();
        jest.runAllTimers();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('debounces saves by default and persists the expected state', () => {
        const projectId = seedPersistedState();
        mod.saveState();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

        const expectedKey = `sourcesPlusState_${projectId}`;
        jest.advanceTimersByTime(1500);

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                key: expectedKey,
                baseRevision: 0,
                critical: false,
                clientSaveId: expect.any(String),
                data: expect.objectContaining(expectedPersistableState)
            }),
            expect.any(Function)
        );
        const savedData = global.chrome.runtime.sendMessage.mock.calls[0][0].data;
        expect(savedData._saveRevision).toBeUndefined();
        expect(savedData._savedAt).toBeUndefined();
    });

    it('serializes immediate saves and assigns increasing revisions', async () => {
        const projectId = seedPersistedState();
        const pendingRuntimeCallbacks = [];
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            pendingRuntimeCallbacks.push({ message, cb });
        });

        const firstSave = mod.saveState({ immediate: true, critical: true });
        mod.state.ungrouped.push('source4');
        mod.sourcesByKey.set('source4', {
            enabled: true,
            title: 'Source 4',
            normalizedTitle: 'source 4',
            stableToken: 'doc-4',
            fingerprint: 'source 4||article',
            identityType: 'stable-token'
        });
        const secondSave = mod.saveState({ immediate: true, critical: true });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(pendingRuntimeCallbacks[0].message.key).toBe(`sourcesPlusState_${projectId}`);
        expect(pendingRuntimeCallbacks[0].message.baseRevision).toBe(0);
        expect(pendingRuntimeCallbacks[0].message.critical).toBe(true);
        expect(pendingRuntimeCallbacks[0].message.data._saveRevision).toBeUndefined();

        pendingRuntimeCallbacks[0].cb({ success: true, saveRevision: 1, savedAt: '2026-04-22T00:00:01.000Z' });
        await firstSave;
        await Promise.resolve();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(pendingRuntimeCallbacks[1].message.key).toBe(`sourcesPlusState_${projectId}`);
        expect(pendingRuntimeCallbacks[1].message.baseRevision).toBe(1);
        expect(pendingRuntimeCallbacks[1].message.data._saveRevision).toBeUndefined();
        expect(pendingRuntimeCallbacks[1].message.data.ungrouped).toContain('source4');
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();

        pendingRuntimeCallbacks[1].cb({ success: true, saveRevision: 2, savedAt: '2026-04-22T00:00:02.000Z' });
        await secondSave;
    });

    it('deep clones queued snapshots before async storage callbacks can mutate runtime state', () => {
        seedPersistedState();
        let capturedData = null;
        global.chrome.runtime.sendMessage.mockImplementationOnce((message) => {
            capturedData = message.data;
        });

        mod.saveState({ immediate: true, critical: true });
        mod.groupsById.get('group1').title = 'Changed after save started';
        mod.state.groups.push('late-group');

        expect(capturedData.groups).toEqual(['group1', 'group2']);
        expect(capturedData.groupsById.group1.title).toBe('Group 1');
    });

    it('shows an error toast when a critical save fails in both local and runtime storage', async () => {
        seedPersistedState();
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            appendChild: jest.fn()
        });
        global.chrome.storage.local.set.mockImplementationOnce((payload, cb) => {
            global.chrome.runtime.lastError = { message: 'local failed' };
            cb();
            global.chrome.runtime.lastError = null;
        });
        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            cb({ success: false, errorCode: 'runtime_failure' });
        });

        const result = await mod.saveState({ immediate: true, critical: true });

        expect(result.ok).toBe(false);
        expect(mod._getActiveToastItemForTest()).toMatchObject({
            message: 'ui_save_failed',
            variant: 'error'
        });
        mod._hideActiveToastForTest(false);
    });

    it('does not let a local fallback write overwrite a newer saved revision', async () => {
        const projectId = seedPersistedState();
        const newerState = {
            _saveRevision: 5,
            groups: ['newer'],
            groupsById: { newer: { id: 'newer', title: 'Newer', children: [] } },
            ungrouped: [],
            sourceStateById: {}
        };

        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            cb({ success: false, errorCode: 'runtime_failure' });
        });
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({ [`sourcesPlusState_${projectId}`]: newerState });
        });

        const result = await mod.saveState({ immediate: true, critical: true });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('stale_revision');
        expect(result.localResult).toMatchObject({ ok: true, stale: true });
        expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('writes a recovery snapshot before critical saves and clears it after success', async () => {
        const projectId = seedPersistedState();

        const result = await mod.saveState({ immediate: true, critical: true });

        expect(result.ok).toBe(true);
        expect(global.sessionStorage.setItem).toHaveBeenCalledWith(
            `sourcesPlusRecovery_${projectId}`,
            expect.any(String)
        );
        const recoveryPayload = JSON.parse(global.sessionStorage.setItem.mock.calls[0][1]);
        expect(recoveryPayload).toMatchObject({
            snapshot: expectedPersistableState,
            baseRevision: 0,
            reason: 'critical_save',
            clientSaveId: expect.any(String)
        });
        expect(recoveryPayload.snapshot._saveRevision).toBeUndefined();
        expect(recoveryPayload.snapshot._savedAt).toBeUndefined();
        expect(global.sessionStorage.removeItem).toHaveBeenCalledWith(`sourcesPlusRecovery_${projectId}`);
        expect(mod.getSaveStatus()).toMatchObject({
            state: 'saved',
            lastSaveRevision: 1,
            recoveryAvailable: false
        });
    });

    it('keeps recovery and marks stale when background rejects a critical save', async () => {
        const projectId = seedPersistedState();
        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            cb({ success: false, errorCode: 'stale_revision', currentRevision: 7 });
        });

        const result = await mod.saveState({ immediate: true, critical: true });

        expect(result).toMatchObject({
            ok: false,
            reason: 'stale_revision',
            runtimeResult: {
                stale: true,
                currentRevision: 7
            }
        });
        expect(global.sessionStorage.removeItem).not.toHaveBeenCalledWith(`sourcesPlusRecovery_${projectId}`);
        expect(global.sessionStorage.setItem).toHaveBeenCalledTimes(2);
        const failedRecoveryPayload = JSON.parse(global.sessionStorage.setItem.mock.calls[1][1]);
        expect(failedRecoveryPayload).toMatchObject({
            reason: 'stale_revision',
            failed: true
        });
        expect(mod.getSaveStatus()).toMatchObject({
            state: 'stale',
            lastError: 'stale_revision',
            currentRevision: 7,
            recoveryAvailable: true
        });
        expect(mod._getActiveToastItemForTest()).toMatchObject({
            message: 'ui_save_stale_failed',
            variant: 'error'
        });
        mod._hideActiveToastForTest(false);
    });

    it('detects newer recovery snapshots and exposes recovery status', () => {
        const projectId = seedPersistedState();
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: expectedPersistableState,
            baseRevision: 5,
            createdAt: '2026-04-22T00:01:00.000Z',
            reason: 'critical_save',
            clientSaveId: 'test-save'
        }));

        expect(mod.detectRecoverySnapshotAvailability({
            _saveRevision: 4,
            schemaVersion: 3
        })).toBe(true);
        expect(mod.getSaveStatus()).toMatchObject({
            state: 'recovery_available',
            recoveryAvailable: true,
            recoveryCreatedAt: '2026-04-22T00:01:00.000Z',
            lastError: 'recovery_available'
        });
    });

    it('clears stale recovery snapshots when saved state already contains the same data', () => {
        const projectId = seedPersistedState();
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: expectedPersistableState,
            baseRevision: 5,
            createdAt: '2026-04-22T00:01:00.000Z',
            reason: 'page_lifecycle',
            clientSaveId: 'test-save'
        }));

        expect(mod.detectRecoverySnapshotAvailability(Object.assign({}, expectedPersistableState, {
            _saveRevision: 5,
            _savedAt: '2026-04-22T00:01:01.000Z'
        }))).toBe(false);

        expect(global.sessionStorage.removeItem).toHaveBeenCalledWith(`sourcesPlusRecovery_${projectId}`);
        expect(mod.getSaveStatus()).toMatchObject({
            recoveryAvailable: false,
            recoveryCreatedAt: ''
        });
    });

    it('clears recovery snapshots that are older than saved storage state', () => {
        const projectId = seedPersistedState();
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: Object.assign({}, expectedPersistableState, {
                groups: ['older-local-change']
            }),
            baseRevision: 5,
            createdAt: '2026-04-22T00:01:00.000Z',
            reason: 'critical_save',
            clientSaveId: 'test-save'
        }));

        expect(mod.detectRecoverySnapshotAvailability(Object.assign({}, expectedPersistableState, {
            _saveRevision: 6,
            _savedAt: '2026-04-22T00:01:01.000Z'
        }))).toBe(false);

        expect(global.sessionStorage.removeItem).toHaveBeenCalledWith(`sourcesPlusRecovery_${projectId}`);
    });

    it('renders failed save status with a retry action', () => {
        seedPersistedState();
        const statusContainer = global.document.createElement('div');
        const statusSection = global.document.createElement('section');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            getElementById: jest.fn((id) => {
                if (id === 'sp-settings-save-status') return statusContainer;
                if (id === 'sp-settings-save-status-section') return statusSection;
                return null;
            }),
            querySelector: jest.fn(() => null)
        });

        mod.renderSaveStatus({ state: 'failed' });

        expect(statusContainer.hidden).toBe(false);
        expect(statusSection.hidden).toBe(false);
        expect(statusContainer.className).toBe('sp-save-status sp-save-status-failed');
        expect(statusContainer.setAttribute).toHaveBeenCalledWith('role', 'alert');
        expect(statusContainer.setAttribute).toHaveBeenCalledWith('aria-live', 'assertive');
        expect(statusContainer.childNodes[0].textContent).toBe('ui_save_status_failed');
        expect(statusContainer.childNodes[1].textContent).toBe('ui_save_status_retry');

        statusContainer.childNodes[1].dispatchEvent({
            type: 'click',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                critical: true
            }),
            expect.any(Function)
        );
    });

    it('renders recovery actions and can dismiss a recovery snapshot', () => {
        const projectId = seedPersistedState();
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: expectedPersistableState,
            baseRevision: 1,
            createdAt: '2026-04-22T00:02:00.000Z',
            reason: 'critical_save',
            clientSaveId: 'test-save'
        }));
        const statusContainer = global.document.createElement('div');
        const statusSection = global.document.createElement('section');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            getElementById: jest.fn((id) => {
                if (id === 'sp-settings-save-status') return statusContainer;
                if (id === 'sp-settings-save-status-section') return statusSection;
                return null;
            }),
            querySelector: jest.fn(() => null)
        });

        mod.renderSaveStatus({ state: 'recovery_available' });

        expect(statusContainer.hidden).toBe(false);
        expect(statusSection.hidden).toBe(false);
        expect(statusContainer.className).toBe('sp-save-status sp-save-status-recovery_available');
        expect(statusContainer.childNodes.map((node) => node.textContent)).toEqual([
            'ui_save_status_recovery',
            'ui_recovery_restore',
            'ui_recovery_dismiss'
        ]);

        statusContainer.childNodes[2].dispatchEvent({
            type: 'click',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });

        expect(global.sessionStorage.removeItem).toHaveBeenCalledWith(`sourcesPlusRecovery_${projectId}`);
        expect(mod.getSaveStatus()).toMatchObject({
            state: 'idle',
            recoveryAvailable: false
        });
    });

    it('restores a recovery snapshot from the save status UI and saves it critically', () => {
        const projectId = seedPersistedState();
        const recoveredSnapshot = {
            ...expectedPersistableState,
            groups: ['recovered'],
            groupsById: {
                recovered: { id: 'recovered', title: 'Recovered', children: [] }
            },
            ungrouped: []
        };
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: recoveredSnapshot,
            baseRevision: 1,
            createdAt: '2026-04-22T00:03:00.000Z',
            reason: 'critical_save',
            clientSaveId: 'test-save'
        }));
        mod._setShadowRootForTest({
            host: { isConnected: true },
            getElementById: jest.fn(() => null),
            querySelector: jest.fn(() => null),
            appendChild: jest.fn()
        });

        expect(mod.restoreRecoverySnapshotFromUi()).toBe(true);

        expect(mod.state.groups).toEqual(['recovered']);
        expect(mod.groupsById.get('recovered')).toMatchObject({
            id: 'recovered',
            title: 'Recovered'
        });
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                critical: true,
                data: expect.objectContaining({
                    groups: ['recovered']
                })
            }),
            expect.any(Function)
        );
        expect(mod._getActiveToastItemForTest()).toMatchObject({
            message: 'ui_recovery_restored',
            variant: 'success'
        });
        mod._hideActiveToastForTest(false);
    });

    it('builds diagnostics without exposing source titles or content', () => {
        const projectId = seedPersistedState();
        mod.sourcesByKey.set('secret-source', {
            key: 'secret-source',
            enabled: true,
            title: 'Sensitive Source Title',
            textContent: 'Sensitive source body'
        });
        global.sessionStorage.setItem(`sourcesPlusRecovery_${projectId}`, JSON.stringify({
            snapshot: expectedPersistableState,
            baseRevision: 1,
            createdAt: '2026-04-22T00:04:00.000Z',
            reason: 'critical_save',
            clientSaveId: 'test-save'
        }));
        global.sessionStorage.setItem(`sourcesPlusImportBackup_${projectId}`, JSON.stringify({
            snapshot: Object.assign({}, expectedPersistableState, {
                sourceStateById: {
                    secret: {
                        title: 'Sensitive Import Title',
                        textContent: 'Sensitive import body'
                    }
                }
            }),
            createdAt: '2026-04-22T00:05:00.000Z',
            sourceCount: 1,
            groupCount: 2,
            tagCount: 3
        }));

        const diagnostics = JSON.parse(mod.getDiagnosticsText());

        expect(diagnostics).toMatchObject({
            notebookId: projectId,
            sourceCount: 4,
            groupCount: 2,
            tagCount: 0,
            recoveryAvailable: true,
            importBackupAvailable: true,
            importBackupCreatedAt: '2026-04-22T00:05:00.000Z',
            importBackupCounts: {
                sourceCount: 1,
                groupCount: 2,
                tagCount: 3
            }
        });
        expect(mod.getDiagnosticsText()).not.toContain('Sensitive Source Title');
        expect(mod.getDiagnosticsText()).not.toContain('Sensitive source body');
        expect(mod.getDiagnosticsText()).not.toContain('Sensitive Import Title');
        expect(mod.getDiagnosticsText()).not.toContain('Sensitive import body');
    });

    it('logs structured background save failures without throwing', () => {
        seedPersistedState();
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            cb({ success: false, errorCode: 'runtime_failure' });
        });

        expect(() => mod.saveState()).not.toThrow();
        jest.advanceTimersByTime(1500);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'NotebookLM Source Management: SAVE_STATE rejected by background:',
            'runtime_failure'
        );

        consoleWarnSpy.mockRestore();
    });

    it('handles potential errors during debouncedStorageSet', () => {
        seedPersistedState();

        // Simulate chrome.runtime.sendMessage throwing an error (e.g., context invalidated)
        global.chrome.runtime.sendMessage.mockImplementationOnce(() => {
            throw new Error('Extension context invalidated.');
        });

        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(() => mod.saveState()).not.toThrow();
        jest.advanceTimersByTime(1500);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            "NotebookLM Source Management: Context invalidated. Please refresh the page.",
            expect.any(Error)
        );

        consoleWarnSpy.mockRestore();
    });

    it('immediately persists move-to-folder changes without waiting for timers', () => {
        mod._setProjectId('project-move');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            getElementById: jest.fn(() => null),
            appendChild: jest.fn()
        });
        mod.state.ungrouped = ['source1'];
        mod.groupsById.set('group1', { id: 'group1', title: 'Pinned', children: [] });
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            enabled: true,
            title: 'Source 1',
            normalizedTitle: 'source 1',
            fingerprint: 'source 1||article',
            identityType: 'stable-token'
        });

        mod.executeMoveToFolder('source1', 'group1');

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: 'source1' }]);
    });

    it('moves a single source into a nested folder', () => {
        mod._setProjectId('project-move-nested');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            getElementById: jest.fn(() => null),
            appendChild: jest.fn()
        });
        mod.state.groups = ['root'];
        mod.state.ungrouped = ['source1'];
        mod.groupsById.set('root', {
            id: 'root',
            title: 'Root',
            children: [{ type: 'group', id: 'child' }]
        });
        mod.groupsById.set('child', {
            id: 'child',
            title: 'Child',
            children: []
        });
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            enabled: true,
            title: 'Source 1',
            normalizedTitle: 'source 1',
            fingerprint: 'source 1||article',
            identityType: 'stable-token'
        });

        mod.executeMoveToFolder('source1', 'child');

        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.groupsById.get('root').children).toEqual([{ type: 'group', id: 'child' }]);
        expect(mod.groupsById.get('child').children).toEqual([{ type: 'source', key: 'source1' }]);
    });

    it('moves batch sources into a nested folder and exits batch mode', () => {
        mod._setProjectId('project-move-batch-nested');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            getElementById: jest.fn(() => null)
        });
        mod.state.groups = ['root'];
        mod.state.ungrouped = ['source1', 'source2'];
        mod.state.isBatchMode = true;
        mod.pendingBatchKeys.add('source1');
        mod.pendingBatchKeys.add('source2');
        mod.groupsById.set('root', {
            id: 'root',
            title: 'Root',
            children: [{ type: 'group', id: 'child' }]
        });
        mod.groupsById.set('child', {
            id: 'child',
            title: 'Child',
            children: []
        });
        ['source1', 'source2'].forEach((sourceKey) => {
            mod.sourcesByKey.set(sourceKey, {
                key: sourceKey,
                enabled: true,
                title: sourceKey,
                normalizedTitle: sourceKey,
                fingerprint: `${sourceKey}||article`,
                identityType: 'stable-token'
            });
        });

        mod.executeMoveToFolder(['source1', 'source2'], 'child');

        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.groupsById.get('child').children).toEqual([
            { type: 'source', key: 'source1' },
            { type: 'source', key: 'source2' }
        ]);
        expect(mod.state.isBatchMode).toBe(false);
        expect(mod.pendingBatchKeys.size).toBe(0);
    });

    it('immediately persists new folders without waiting for timers', () => {
        mod._setProjectId('project-group');

        mod.handleAddNewGroup();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(mod.state.groups).toHaveLength(1);
        expect(mod.groupsById.get(mod.state.groups[0])).toMatchObject({
            title: 'ui_new_group',
            enabled: true,
            collapsed: false
        });
    });

    it('immediately persists source checkbox toggles without waiting for timers', () => {
        mod._setProjectId('project-source-toggle');
        mod.state.ungrouped = ['source1'];
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            enabled: true,
            isDisabled: false,
            title: 'Source 1',
            normalizedTitle: 'source 1',
            fingerprint: 'source 1||article',
            identityType: 'stable-token'
        });

        mod._handleInteractionForTest({
            target: {
                checked: false,
                dataset: { sourceKey: 'source1' },
                classList: {
                    contains: jest.fn((className) => className === 'sp-checkbox')
                },
                closest: jest.fn((selector) => {
                    if (selector === '.source-item') {
                        return {
                            dataset: { sourceKey: 'source1' },
                            querySelector: jest.fn(() => ({ checked: true }))
                        };
                    }
                    return null;
                })
            }
        });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(mod.sourcesByKey.get('source1').enabled).toBe(false);
    });

    it('immediately persists folder toggle changes without waiting for timers', () => {
        mod._setProjectId('project-folder-toggle');
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [],
            enabled: true,
            collapsed: false
        });

        mod._handleInteractionForTest({
            target: {
                checked: false,
                dataset: { groupId: 'group1' },
                classList: {
                    contains: jest.fn((className) => className === 'sp-group-toggle-checkbox')
                },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') {
                        return { dataset: { groupId: 'group1' } };
                    }
                    return null;
                })
            }
        });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(mod.groupsById.get('group1').enabled).toBe(false);
    });

    it('flushes a pending save when the page becomes hidden', () => {
        seedPersistedState();

        mod.saveState();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

        mod.handlePageLifecyclePersistence({ type: 'visibilitychange' });
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

        global.document.visibilityState = 'hidden';
        mod.handlePageLifecyclePersistence({ type: 'visibilitychange' });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('writes the latest state directly to local storage when the page becomes hidden', () => {
        const projectId = seedPersistedState();

        global.document.visibilityState = 'hidden';
        mod.handlePageLifecyclePersistence({ type: 'visibilitychange' });

        const payload = global.chrome.storage.local.set.mock.calls[0][0];
        expect(payload[`sourcesPlusState_${projectId}`]).toMatchObject(expectedPersistableState);
        expect(payload[`sourcesPlusState_${projectId}`]._saveRevision).toBe(1);
        expect(typeof payload[`sourcesPlusState_${projectId}`]._savedAt).toBe('string');
        expect(payload[`sourcesPlusState_${projectId}__backup`]).toEqual(payload[`sourcesPlusState_${projectId}`]);
    });

    it('writes the best preserved snapshot when the page hides during a loading refresh window', () => {
        const projectId = seedPersistedState();
        const { panel } = createMockPanel({ visible: true, contentVisible: true });

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));

        expect(mod.restoreInitialLoadedState(expectedPersistableState)).toEqual({
            deferred: true,
            shouldUpgradeStorage: false
        });

        mod.state.groups = [];
        mod.state.ungrouped = [];
        mod.groupsById.clear();
        mod.sourcesByKey.clear();

        global.document.visibilityState = 'hidden';
        mod.handlePageLifecyclePersistence({ type: 'visibilitychange' });

        const payload = global.chrome.storage.local.set.mock.calls[0][0];
        expect(payload[`sourcesPlusState_${projectId}`]).toMatchObject(expectedPersistableState);
        expect(payload[`sourcesPlusState_${projectId}`]._saveRevision).toBe(1);
        expect(typeof payload[`sourcesPlusState_${projectId}`]._savedAt).toBe('string');
        expect(payload[`sourcesPlusState_${projectId}__backup`]).toEqual(payload[`sourcesPlusState_${projectId}`]);
    });
});

describe('settings import/export configuration', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(() => {
        if (mod?._hideActiveToastForTest) mod._hideActiveToastForTest(false);
        teardownGlobalMocks();
    });

    it('exports the current persistable state inside a versioned config payload', () => {
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            enabled: true,
            title: 'Source 1',
            normalizedTitle: 'source 1',
            stableToken: 'doc-1',
            fingerprint: 'source 1||article',
            identityType: 'stable-token'
        });
        mod.state.ungrouped = ['source1'];

        const payload = JSON.parse(mod.getExportConfigText());

        expect(payload).toMatchObject({
            format: 'notebooklm-source-management-config',
            formatVersion: 1
        });
        expect(payload.data.ungrouped).toEqual(['source1']);
        expect(payload.data.sourceStateById.source1.title).toBe('Source 1');
    });

    it('previews imported config source matches against current source identities', () => {
        mod.sourcesByKey.set('source_id_data-source-id-doc-1', {
            key: 'source_id_data-source-id-doc-1',
            enabled: true,
            title: 'Current Source',
            normalizedTitle: 'current source',
            stableToken: 'data-source-id-doc-1',
            fingerprint: 'current source||article',
            identityType: 'stable-token'
        });

        const preview = mod.previewImportConfig(JSON.stringify({
            format: 'notebooklm-source-management-config',
            data: {
                schemaVersion: 3,
                groups: ['group1'],
                groupsById: {
                    group1: {
                        id: 'group1',
                        title: 'Imported',
                        children: [{ type: 'source', key: 'old-source-key' }]
                    }
                },
                ungrouped: [],
                sourceStateById: {
                    'old-source-key': {
                        enabled: false,
                        title: 'Old Source',
                        normalizedTitle: 'old source',
                        stableToken: 'data-source-id-doc-1',
                        fingerprint: 'old source||article',
                        identityType: 'stable-token'
                    }
                },
                tagsById: { tag1: { id: 'tag1', label: 'Tag' } },
                tagOrder: ['tag1'],
                sourceTagsById: {}
            }
        }));

        expect(preview).toMatchObject({
            ok: true,
            totalSources: 1,
            matchedSources: 1,
            groupCount: 1,
            tagCount: 1,
            matchedSourceDetails: [
                {
                    storedKey: 'old-source-key',
                    resolvedKey: 'source_id_data-source-id-doc-1',
                    title: 'Old Source'
                }
            ],
            unmatchedSourceDetails: []
        });
    });

    it('rejects empty or invalid import text', () => {
        expect(mod.previewImportConfig('')).toMatchObject({ ok: false, reason: 'empty' });
        expect(mod.previewImportConfig('{bad json')).toMatchObject({ ok: false, reason: 'invalid' });
    });

    it('rejects imported group trees that contain cycles', () => {
        const preview = mod.previewImportConfig(JSON.stringify({
            format: 'notebooklm-source-management-config',
            data: {
                schemaVersion: 3,
                groups: ['group-a'],
                groupsById: {
                    'group-a': { id: 'group-a', title: 'A', children: [{ type: 'group', id: 'group-b' }] },
                    'group-b': { id: 'group-b', title: 'B', children: [{ type: 'group', id: 'group-a' }] }
                },
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }
        }));

        expect(preview).toMatchObject({ ok: false, reason: 'invalid' });
    });

    it('rejects imported configs that exceed complexity limits', () => {
        const groupsById = {};
        for (let index = 0; index < globalThis.NSM_CONTENT_CONFIG.IMPORT_CONFIG_MAX_GROUPS + 1; index += 1) {
            groupsById[`group-${index}`] = { id: `group-${index}`, title: `Group ${index}`, children: [] };
        }

        const preview = mod.previewImportConfig(JSON.stringify({
            schemaVersion: 3,
            groups: Object.keys(groupsById),
            groupsById,
            ungrouped: [],
            sourceStateById: {},
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        }));

        expect(preview).toMatchObject({ ok: false, reason: 'invalid' });
    });

    it('writes an import backup before applying configuration and exposes a restore action', () => {
        mod._setProjectId('project-import');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            appendChild: jest.fn()
        });
        mod.state.groups = ['before'];
        mod.groupsById.set('before', { id: 'before', title: 'Before', children: [] });

        const result = mod.applyImportConfig(JSON.stringify({
            format: 'notebooklm-source-management-config',
            data: {
                schemaVersion: 3,
                groups: ['after'],
                groupsById: {
                    after: { id: 'after', title: 'After', children: [] }
                },
                ungrouped: [],
                sourceStateById: {},
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }
        }));

        expect(result.ok).toBe(true);
        expect(mod.readImportBackupSnapshot()).toMatchObject({
            sourceCount: 0,
            groupCount: 1,
            tagCount: 0,
            snapshot: {
                groups: ['before']
            }
        });
        expect(mod._getActiveToastItemForTest()).toMatchObject({
            message: 'ui_settings_imported_toast',
            variant: 'success',
            actionLabel: 'ui_settings_restore_import_backup'
        });
    });

    it('restores the import backup, saves it critically, and clears the backup', async () => {
        mod._setProjectId('project-import-restore');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            appendChild: jest.fn()
        });
        mod.state.groups = ['before'];
        mod.groupsById.set('before', { id: 'before', title: 'Before', children: [] });
        const backup = mod.writeImportBackupSnapshot();
        expect(backup).toBeTruthy();

        mod.state.groups = ['after'];
        mod.groupsById.clear();
        mod.groupsById.set('after', { id: 'after', title: 'After', children: [] });

        await expect(mod.restoreImportBackupSnapshotFromUi()).resolves.toBe(true);

        expect(mod.state.groups).toEqual(['before']);
        expect(mod.groupsById.get('before')).toMatchObject({ title: 'Before' });
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                critical: true,
                data: expect.objectContaining({
                    groups: ['before']
                })
            }),
            expect.any(Function)
        );
        expect(mod.readImportBackupSnapshot()).toBeNull();
        expect(mod._getActiveToastItemForTest()).toMatchObject({
            message: 'ui_settings_import_backup_restored',
            variant: 'success'
        });
    });
});

describe('undo recent operations', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
        mod._setProjectId('project-undo');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            getElementById: jest.fn(() => null),
            appendChild: jest.fn()
        });
    });

    afterEach(teardownGlobalMocks);

    const addUndoSource = () => {
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            enabled: true,
            title: 'Source 1',
            normalizedTitle: 'source 1',
            fingerprint: 'source 1||article',
            identityType: 'fingerprint'
        });
    };

    it('restores the previous persisted snapshot when Command+Z is pressed', () => {
        addUndoSource();
        mod.state.ungrouped = ['source1'];
        mod.groupsById.set('group1', { id: 'group1', title: 'Pinned', children: [] });
        mod._resetUndoHistoryBaselineForTest();

        mod.executeMoveToFolder('source1', 'group1');
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: 'source1' }]);
        expect(mod._getUndoStackLengthForTest()).toBe(1);

        const event = {
            key: 'z',
            metaKey: true,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            target: { tagName: 'DIV' },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };
        mod._handleUndoKeydownForTest(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(mod.state.ungrouped).toEqual(['source1']);
        expect(mod.groupsById.get('group1').children).toEqual([]);
        expect(mod._getUndoStackLengthForTest()).toBe(0);
        mod._hideActiveToastForTest(false);
    });

    it('does not record non-user saves in the undo stack', () => {
        addUndoSource();
        mod.state.ungrouped = ['source1'];
        mod._resetUndoHistoryBaselineForTest();

        mod.state.ungrouped = [];
        mod.saveState({ immediate: true, recordUndo: false });

        expect(mod._getUndoStackLengthForTest()).toBe(0);
    });

    it('adds an Undo action to undoable success toasts', () => {
        addUndoSource();
        mod.state.ungrouped = ['source1'];
        mod._resetUndoHistoryBaselineForTest();

        mod.state.ungrouped = [];
        mod.saveState({ immediate: true });

        mod._showUndoableToastForTest('Moved source', { variant: 'success' });
        const toastItem = mod._getActiveToastItemForTest();

        expect(toastItem).toMatchObject({
            message: 'Moved source',
            variant: 'success',
            actionLabel: 'ui_undo_action'
        });
        expect(typeof toastItem.onAction).toBe('function');
        toastItem.onAction();
        expect(mod.state.ungrouped).toEqual(['source1']);
        mod._hideActiveToastForTest(false);
    });

    it('leaves editable fields to the browser text undo behavior', () => {
        const event = {
            key: 'z',
            metaKey: true,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            target: { tagName: 'INPUT' },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };

        mod._handleUndoKeydownForTest(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });
});

describe('loadState', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = (cb) => {
            cb();
            return 1;
        };
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('returns null when projectId is missing', () => {
        const callback = jest.fn();
        mod._setProjectId(null);

        mod.loadState(callback);

        expect(callback).toHaveBeenCalledWith(null);
    });

    it('reads state directly from local storage before falling back to runtime messaging', () => {
        const callback = jest.fn();
        const storedState = {
            schemaVersion: 3,
            groups: ['group1'],
            groupsById: {
                group1: { id: 'group1', title: 'Pinned', children: [] }
            },
            ungrouped: [],
            sourceStateById: {},
            customHeight: 420,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };

        mod._setProjectId('test-project');
        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                'sourcesPlusState_test-project': storedState,
                'sourcesPlusState_test-project__backup': null
            });
        });

        mod.loadState(callback);

        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_test-project', 'sourcesPlusState_test-project__backup'],
            expect.any(Function)
        );
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledWith(storedState);
    });

    it('restores v2 state and custom height', () => {
        const callback = jest.fn();
        const container = { style: {} };
        mod._setProjectId('test-project');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn((selector) => (selector === '.sp-container' ? container : null))
        });

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                'sourcesPlusState_test-project': {
                    schemaVersion: 2,
                    groups: ['group1'],
                    groupsById: {
                        group1: { id: 'group1', title: 'Group', children: [] }
                    },
                    ungrouped: ['source1'],
                    sourceStateById: {
                        source1: {
                            enabled: true,
                            title: 'Source 1',
                            normalizedTitle: 'source 1',
                            fingerprint: 'source 1||article',
                            identityType: 'stable-token'
                        }
                    },
                    customHeight: 420
                },
                'sourcesPlusState_test-project__backup': null
            });
        });

        mod.loadState(callback);

        expect(callback).toHaveBeenCalledWith({
            schemaVersion: 2,
            groups: ['group1'],
            groupsById: {
                group1: { id: 'group1', title: 'Group', children: [] }
            },
            ungrouped: ['source1'],
            sourceStateById: {
                source1: {
                    enabled: true,
                    title: 'Source 1',
                    normalizedTitle: 'source 1',
                    fingerprint: 'source 1||article',
                    identityType: 'stable-token'
                }
            },
            customHeight: 420,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        });
        expect(container.style.height).toBe('420px');
        expect(mod._getPendingStorageUpgrade()).toBe(true);
    });

    it('normalizes legacy state and marks it for migration', () => {
        const callback = jest.fn();
        mod._setProjectId('test-project');

        global.chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
            cb({
                'sourcesPlusState_test-project': {
                    groups: ['group1'],
                    groupsById: {
                        group1: { id: 'group1', title: 'Group', children: [{ type: 'source', key: 'source_legacy' }] }
                    },
                    ungrouped: ['source_legacy_2'],
                    enabledMap: {
                        source_legacy: false
                    },
                    customHeight: 300
                },
                'sourcesPlusState_test-project__backup': null
            });
        });

        mod.loadState(callback);

        expect(callback).toHaveBeenCalledWith({
            schemaVersion: 1,
            groups: ['group1'],
            groupsById: {
                group1: { id: 'group1', title: 'Group', children: [{ type: 'source', key: 'source_legacy' }] }
            },
            ungrouped: ['source_legacy_2'],
            legacyEnabledMap: {
                source_legacy: false
            },
            customHeight: 300,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        });
        expect(mod._getPendingStorageUpgrade()).toBe(true);
    });

    it('falls back to null when runtime messaging fails', () => {
        const callback = jest.fn();
        mod._setProjectId('test-project');

        global.chrome.storage.local.get.mockImplementationOnce(() => {
            throw new Error('Local storage unavailable');
        });
        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            global.chrome.runtime.lastError = { message: 'Extension unavailable' };
            cb({});
        });

        mod.loadState(callback);

        expect(callback).toHaveBeenCalledWith(null);
        global.chrome.runtime.lastError = null;
    });

    it('treats structured background failures as null state', () => {
        const callback = jest.fn();
        mod._setProjectId('test-project');

        global.chrome.storage.local.get.mockImplementationOnce(() => {
            throw new Error('Local storage unavailable');
        });
        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            cb({ success: false, errorCode: 'runtime_failure' });
        });

        mod.loadState(callback);

        expect(callback).toHaveBeenCalledWith(null);
        expect(mod._getPendingStorageUpgrade()).toBe(false);
    });

    it('ignores late responses after the manager instance is torn down', () => {
        const callback = jest.fn();
        const container = { style: {} };
        let responseCallback = null;

        mod._setProjectId('test-project');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            querySelector: jest.fn((selector) => (selector === '.sp-container' ? container : null))
        });

        global.chrome.storage.local.get.mockImplementationOnce(() => {
            throw new Error('Local storage unavailable');
        });
        global.chrome.runtime.sendMessage.mockImplementationOnce((message, cb) => {
            responseCallback = cb;
        });

        mod.loadState(callback);
        mod._resetState();

        responseCallback({
            data: {
                schemaVersion: 3,
                groups: [],
                groupsById: {},
                ungrouped: [],
                sourceStateById: {},
                customHeight: 420,
                tagsById: {},
                tagOrder: [],
                sourceTagsById: {}
            }
        });

        expect(callback).not.toHaveBeenCalled();
        expect(container.style.height).toBeUndefined();
    });
});
