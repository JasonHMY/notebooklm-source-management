const createContentUndoHistory = require('../../src/content/content-undo-history.js');

function passThroughClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDeps(overrides = {}) {
    return {
        cloneSerializableData: jest.fn(passThroughClone),
        buildPersistableState: jest.fn(() => ({ version: 1, items: [] })),
        applyPersistableSnapshotToRuntime: jest.fn(() => true),
        showToast: jest.fn(),
        getMessage: jest.fn((key) => key),
        closeSourceActionMenu: jest.fn(),
        render: jest.fn(),
        runSaveAfterHistory: jest.fn(async () => ({ ok: true })),
        onHistoryStateChange: jest.fn(),
        ...overrides
    };
}

describe('content undo history helper', () => {
    it('throws when the required clone/build/apply deps are missing', () => {
        expect(() => createContentUndoHistory({})).toThrow(/createContentUndoHistory requires/);
    });

    it('captures the current state as the baseline when none is provided', () => {
        const deps = createDeps({ buildPersistableState: jest.fn(() => ({ a: 1 })) });
        const helper = createContentUndoHistory(deps);

        const ok = helper.setUndoBaselineSnapshot();

        expect(ok).toBe(true);
        expect(deps.buildPersistableState).toHaveBeenCalledTimes(1);
        expect(deps.cloneSerializableData).toHaveBeenCalled();
    });

    it('returns an empty signature when JSON.stringify throws', () => {
        const helper = createContentUndoHistory(createDeps());
        const cyclic = {};
        cyclic.self = cyclic;

        expect(helper.getUndoSnapshotSignature(cyclic)).toBe('');
    });

    it('records changed normal saves, ignores excluded or identical saves, and stays bounded', () => {
        const helper = createContentUndoHistory({ ...createDeps(), stackLimit: 3 });
        helper.setUndoBaselineSnapshot({ rev: 0 });

        helper.recordUndoBaselineForSave({ rev: 0 });
        helper.recordUndoBaselineForSave({ rev: 1 }, { recordUndo: false });
        expect(helper.getUndoStackLength()).toBe(0);

        for (let rev = 2; rev <= 6; rev += 1) {
            helper.recordUndoBaselineForSave({ rev });
        }

        expect(helper.getUndoStackLength()).toBe(3);
        expect(helper.getUndoStack().map((snapshot) => snapshot.rev)).toEqual([3, 4, 5]);
    });

    it('clears redo when a divergent normal save is recorded', async () => {
        let runtimeSnapshot = { rev: 2 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            })
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        await expect(helper.undoLastOperation()).resolves.toBe(true);
        expect(helper.getRedoStackLength()).toBe(1);

        runtimeSnapshot = { rev: 3 };
        helper.recordUndoBaselineForSave(runtimeSnapshot);

        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
    });

    it('resetUndoHistoryBaseline clears both stacks and re-baselines', async () => {
        let runtimeSnapshot = { rev: 2 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            })
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });
        await helper.undoLastOperation();
        expect(helper.getRedoStackLength()).toBe(1);

        helper.resetUndoHistoryBaseline({ rev: 99 });

        expect(helper.getUndoStackLength()).toBe(0);
        expect(helper.getRedoStackLength()).toBe(0);
    });

    it.each([
        ['undo', 'undoLastOperation', 'ui_undo_empty'],
        ['redo', 'redoLastOperation', 'ui_redo_empty']
    ])('%s reports an empty stack without applying runtime state', async (_action, method, messageKey) => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);

        await expect(helper[method]()).resolves.toBe(false);

        expect(deps.showToast).toHaveBeenCalledWith(messageKey, { variant: 'info' });
        expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
    });

    it('commits undo and redo only after critical save acknowledgements', async () => {
        let runtimeSnapshot = { rev: 2 };
        let resolveSave;
        const firstSave = new Promise((resolve) => {
            resolveSave = resolve;
        });
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            }),
            runSaveAfterHistory: jest.fn()
                .mockReturnValueOnce(firstSave)
                .mockResolvedValueOnce({ ok: true })
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        const undoPromise = helper.undoLastOperation();
        expect(runtimeSnapshot).toEqual({ rev: 1 });
        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
        expect(helper.isApplyingHistory()).toBe(true);
        expect(deps.runSaveAfterHistory).toHaveBeenCalledWith({
            immediate: true,
            critical: true,
            recordUndo: false
        });

        resolveSave({ ok: true });
        await expect(undoPromise).resolves.toBe(true);

        expect(helper.getUndoStackLength()).toBe(0);
        expect(helper.getRedoStackLength()).toBe(1);
        expect(helper.isApplyingHistory()).toBe(false);
        expect(deps.showToast).toHaveBeenCalledWith('ui_undo_toast', { variant: 'success' });

        await expect(helper.redoLastOperation()).resolves.toBe(true);

        expect(runtimeSnapshot).toEqual({ rev: 2 });
        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
        expect(deps.showToast).toHaveBeenCalledWith('ui_redo_toast', { variant: 'success' });
    });

    it('rolls runtime back and preserves both stacks when the critical save is rejected', async () => {
        let runtimeSnapshot = { rev: 2 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            }),
            runSaveAfterHistory: jest.fn(async () => ({ ok: false, reason: 'save_failed' }))
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        await expect(helper.undoLastOperation()).resolves.toBe(false);

        expect(runtimeSnapshot).toEqual({ rev: 2 });
        expect(deps.applyPersistableSnapshotToRuntime.mock.calls.map(([snapshot]) => snapshot.rev)).toEqual([1, 2]);
        expect(deps.render).toHaveBeenCalledTimes(2);
        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
        expect(deps.showToast).toHaveBeenLastCalledWith('ui_undo_failed', { variant: 'error' });
    });

    it('preserves populated undo and redo stacks when a redo save is rejected', async () => {
        let runtimeSnapshot = { rev: 3 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            }),
            runSaveAfterHistory: jest.fn()
                .mockResolvedValueOnce({ ok: true })
                .mockResolvedValueOnce({ ok: false, reason: 'save_failed' })
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });
        helper.recordUndoBaselineForSave({ rev: 3 });
        await helper.undoLastOperation();
        expect(helper.getUndoStack().map((snapshot) => snapshot.rev)).toEqual([1]);
        expect(helper.getRedoStack().map((snapshot) => snapshot.rev)).toEqual([3]);

        await expect(helper.redoLastOperation()).resolves.toBe(false);

        expect(runtimeSnapshot).toEqual({ rev: 2 });
        expect(helper.getUndoStack().map((snapshot) => snapshot.rev)).toEqual([1]);
        expect(helper.getRedoStack().map((snapshot) => snapshot.rev)).toEqual([3]);
        expect(deps.showToast).toHaveBeenLastCalledWith('ui_redo_failed', { variant: 'error' });
    });

    it('rolls runtime back and preserves history when saving throws', async () => {
        let runtimeSnapshot = { rev: 2 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            }),
            runSaveAfterHistory: jest.fn(async () => {
                throw new Error('context invalidated');
            })
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        await expect(helper.undoLastOperation()).resolves.toBe(false);

        expect(runtimeSnapshot).toEqual({ rev: 2 });
        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
    });

    it('rolls back a rejected runtime apply without attempting persistence', async () => {
        const deps = createDeps({
            buildPersistableState: jest.fn(() => ({ rev: 2 })),
            applyPersistableSnapshotToRuntime: jest.fn()
                .mockReturnValueOnce(false)
                .mockReturnValueOnce(true)
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        await expect(helper.undoLastOperation()).resolves.toBe(false);

        expect(deps.runSaveAfterHistory).not.toHaveBeenCalled();
        expect(deps.applyPersistableSnapshotToRuntime).toHaveBeenCalledTimes(2);
        expect(helper.getUndoStackLength()).toBe(1);
        expect(helper.getRedoStackLength()).toBe(0);
    });

    it('blocks overlapping history operations and publishes disabled-state transitions', async () => {
        let resolveSave;
        const savePromise = new Promise((resolve) => {
            resolveSave = resolve;
        });
        const deps = createDeps({
            buildPersistableState: jest.fn(() => ({ rev: 2 })),
            runSaveAfterHistory: jest.fn(() => savePromise)
        });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        const firstUndo = helper.undoLastOperation();
        await expect(helper.undoLastOperation()).resolves.toBe(false);

        expect(deps.onHistoryStateChange).toHaveBeenCalledWith(expect.objectContaining({
            canUndo: false,
            canRedo: false,
            isApplying: true,
            action: 'undo'
        }));

        resolveSave({ ok: true });
        await firstUndo;

        expect(deps.onHistoryStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
            canUndo: false,
            canRedo: true,
            isApplying: false
        }));
    });

    it('keeps the redo destination bounded while undoing repeatedly', async () => {
        let runtimeSnapshot = { rev: 5 };
        const deps = createDeps({
            buildPersistableState: jest.fn(() => runtimeSnapshot),
            applyPersistableSnapshotToRuntime: jest.fn((snapshot) => {
                runtimeSnapshot = passThroughClone(snapshot);
                return true;
            })
        });
        const helper = createContentUndoHistory({ ...deps, stackLimit: 3 });
        helper.setUndoBaselineSnapshot({ rev: 0 });
        for (let rev = 1; rev <= 5; rev += 1) {
            helper.recordUndoBaselineForSave({ rev });
        }

        await helper.undoLastOperation();
        await helper.undoLastOperation();
        await helper.undoLastOperation();

        expect(helper.getRedoStackLength()).toBe(3);
        expect(helper.getRedoStack().map((snapshot) => snapshot.rev)).toEqual([5, 4, 3]);
    });
});
