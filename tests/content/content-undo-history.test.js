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
        runSaveAfterUndo: jest.fn(),
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

    it('clones the explicit baseline so external mutation does not leak in', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        const external = { items: ['a'] };

        helper.setUndoBaselineSnapshot(external);
        external.items.push('b');

        const cloneCalls = deps.cloneSerializableData.mock.calls;
        expect(cloneCalls[0][0]).toBe(external);
        expect(cloneCalls[0][0].items.length).toBeGreaterThanOrEqual(1);
    });

    it('returns an empty signature when JSON.stringify throws', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        const cyclic = {};
        cyclic.self = cyclic;

        expect(helper.getUndoSnapshotSignature(cyclic)).toBe('');
    });

    it('pushes the previous baseline onto the undo stack when the signature changes', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });

        helper.recordUndoBaselineForSave({ rev: 2 });

        expect(helper.getUndoStackLength()).toBe(1);
    });

    it('does not push when recordUndo is explicitly false', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });

        helper.recordUndoBaselineForSave({ rev: 2 }, { recordUndo: false });

        expect(helper.getUndoStackLength()).toBe(0);
    });

    it('does not push when the next snapshot has the same signature', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });

        helper.recordUndoBaselineForSave({ rev: 1 });

        expect(helper.getUndoStackLength()).toBe(0);
    });

    it('trims the stack to the configured limit when pushes exceed it', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory({ ...deps, stackLimit: 3 });
        helper.setUndoBaselineSnapshot({ rev: 0 });

        for (let i = 1; i <= 5; i += 1) {
            helper.recordUndoBaselineForSave({ rev: i });
        }

        expect(helper.getUndoStackLength()).toBe(3);
    });

    it('resetUndoHistoryBaseline empties the stack and re-baselines', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });
        helper.recordUndoBaselineForSave({ rev: 3 });
        expect(helper.getUndoStackLength()).toBe(2);

        helper.resetUndoHistoryBaseline({ rev: 99 });

        expect(helper.getUndoStackLength()).toBe(0);
    });

    it('undoLastOperation shows an info toast and returns false when the stack is empty', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);

        const result = helper.undoLastOperation();

        expect(result).toBe(false);
        expect(deps.showToast).toHaveBeenCalledWith('ui_undo_empty', { variant: 'info' });
        expect(deps.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
    });

    it('undoLastOperation applies the popped snapshot, renders, saves, re-baselines and toasts', () => {
        const deps = createDeps();
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        const result = helper.undoLastOperation();

        expect(result).toBe(true);
        expect(deps.applyPersistableSnapshotToRuntime).toHaveBeenCalledTimes(1);
        expect(deps.closeSourceActionMenu).toHaveBeenCalledTimes(1);
        expect(deps.render).toHaveBeenCalledTimes(1);
        expect(deps.runSaveAfterUndo).toHaveBeenCalledWith({ immediate: true, critical: true, recordUndo: false });
        expect(deps.showToast).toHaveBeenCalledWith('ui_undo_toast', { variant: 'success' });
        expect(helper.getUndoStackLength()).toBe(0);
    });

    it('undoLastOperation returns false with info toast when apply rejects the snapshot', () => {
        const deps = createDeps({ applyPersistableSnapshotToRuntime: jest.fn(() => false) });
        const helper = createContentUndoHistory(deps);
        helper.setUndoBaselineSnapshot({ rev: 1 });
        helper.recordUndoBaselineForSave({ rev: 2 });

        const result = helper.undoLastOperation();

        expect(result).toBe(false);
        expect(deps.showToast).toHaveBeenLastCalledWith('ui_undo_empty', { variant: 'info' });
        expect(deps.render).not.toHaveBeenCalled();
    });

    it('records isApplyingUndo as true while an undo is in flight and clears it afterwards', () => {
        let snapshotDuringApply;
        const deps = createDeps({
            applyPersistableSnapshotToRuntime: jest.fn(() => {
                snapshotDuringApply = helperRef.isApplyingUndo();
                return true;
            })
        });
        const helperRef = createContentUndoHistory(deps);
        helperRef.setUndoBaselineSnapshot({ rev: 1 });
        helperRef.recordUndoBaselineForSave({ rev: 2 });

        helperRef.undoLastOperation();

        expect(snapshotDuringApply).toBe(true);
        expect(helperRef.isApplyingUndo()).toBe(false);
    });

    it('does not push to the undo stack when recordUndoBaselineForSave runs during an undo apply', () => {
        let helperRef;
        const deps = createDeps({
            applyPersistableSnapshotToRuntime: jest.fn(() => true),
            runSaveAfterUndo: jest.fn(() => {
                helperRef.recordUndoBaselineForSave({ rev: 999 });
            })
        });
        helperRef = createContentUndoHistory(deps);
        helperRef.setUndoBaselineSnapshot({ rev: 1 });
        helperRef.recordUndoBaselineForSave({ rev: 2 });

        helperRef.undoLastOperation();

        expect(helperRef.getUndoStackLength()).toBe(0);
    });
});
