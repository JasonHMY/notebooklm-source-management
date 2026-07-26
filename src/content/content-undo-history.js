(function () {
    'use strict';

    /**
     * createContentUndoHistory(deps) — single-step undo 栈(默认上限 20)。
     * 每次 saveState 完成时调用 `recordUndoBaselineForSave(nextSnapshot)`:若新 snapshot
     * 与已知 baseline 签名不同,baseline 推入栈;调用 `undoLastOperation()` 弹出栈顶 + 经
     * `applyPersistableSnapshotToRuntime` 灌回 runtime,然后 `render` + 立刻 `runSaveAfterUndo`
     * 把 undo 结果持久化(critical, recordUndo:false 避免再入栈)。
     *
     * @param {Object} deps Required: cloneSerializableData, buildPersistableState, applyPersistableSnapshotToRuntime.
     *   Optional: showToast, getMessage, closeSourceActionMenu, render, runSaveAfterUndo, stackLimit (default 20).
     * @returns {{ getUndoSnapshotSignature, getCurrentUndoSnapshot, setUndoBaselineSnapshot, resetUndoHistoryBaseline, recordUndoBaselineForSave, undoLastOperation, getUndoStack, getUndoStackLength, isApplyingUndo }}
     */
    function createContentUndoHistory(deps = {}) {
        const {
            cloneSerializableData,
            buildPersistableState,
            applyPersistableSnapshotToRuntime,
            showToast = () => {},
            getMessage = (key) => key,
            closeSourceActionMenu = () => {},
            render = () => {},
            runSaveAfterUndo = () => {},
            stackLimit = 20
        } = deps;

        if (typeof cloneSerializableData !== 'function'
            || typeof buildPersistableState !== 'function'
            || typeof applyPersistableSnapshotToRuntime !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentUndoHistory requires cloneSerializableData, buildPersistableState and applyPersistableSnapshotToRuntime.');
        }

        let undoStack = [];
        let undoBaselineSnapshot = null;
        let undoBaselineSignature = '';
        let isApplyingUndoSnapshot = false;

        function getUndoSnapshotSignature(snapshot) {
            try {
                return JSON.stringify(snapshot || null);
            } catch (error) {
                return '';
            }
        }

        function getCurrentUndoSnapshot() {
            try {
                return cloneSerializableData(buildPersistableState());
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Could not capture undo snapshot.', error);
                return null;
            }
        }

        function setUndoBaselineSnapshot(snapshot = null) {
            const nextSnapshot = snapshot ? cloneSerializableData(snapshot) : getCurrentUndoSnapshot();
            undoBaselineSnapshot = nextSnapshot;
            undoBaselineSignature = getUndoSnapshotSignature(nextSnapshot);
            return Boolean(nextSnapshot);
        }

        function resetUndoHistoryBaseline(snapshot = null) {
            undoStack = [];
            setUndoBaselineSnapshot(snapshot);
        }

        function recordUndoBaselineForSave(nextSnapshot, options = {}) {
            const shouldRecordUndo = options.recordUndo !== false && !isApplyingUndoSnapshot;
            const nextSignature = getUndoSnapshotSignature(nextSnapshot);

            if (
                shouldRecordUndo &&
                undoBaselineSnapshot &&
                undoBaselineSignature &&
                nextSignature &&
                nextSignature !== undoBaselineSignature
            ) {
                undoStack.push(cloneSerializableData(undoBaselineSnapshot));
                if (undoStack.length > stackLimit) {
                    undoStack.splice(0, undoStack.length - stackLimit);
                }
            }

            undoBaselineSnapshot = cloneSerializableData(nextSnapshot);
            undoBaselineSignature = nextSignature;
        }

        function undoLastOperation() {
            const snapshot = undoStack.pop();
            if (!snapshot) {
                showToast(getMessage('ui_undo_empty'), { variant: 'info' });
                return false;
            }

            isApplyingUndoSnapshot = true;
            try {
                if (!applyPersistableSnapshotToRuntime(snapshot)) {
                    showToast(getMessage('ui_undo_empty'), { variant: 'info' });
                    return false;
                }

                closeSourceActionMenu();
                render();
                runSaveAfterUndo({ immediate: true, critical: true, recordUndo: false });
                setUndoBaselineSnapshot(snapshot);
                showToast(getMessage('ui_undo_toast'), { variant: 'success' });
                return true;
            } finally {
                isApplyingUndoSnapshot = false;
            }
        }

        function getUndoStack() {
            return undoStack;
        }

        function getUndoStackLength() {
            return undoStack.length;
        }

        function isApplyingUndo() {
            return isApplyingUndoSnapshot;
        }

        return {
            getUndoSnapshotSignature,
            getCurrentUndoSnapshot,
            setUndoBaselineSnapshot,
            resetUndoHistoryBaseline,
            recordUndoBaselineForSave,
            undoLastOperation,
            getUndoStack,
            getUndoStackLength,
            isApplyingUndo
        };
    }

    globalThis.NSM_CREATE_CONTENT_UNDO_HISTORY = createContentUndoHistory;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentUndoHistory;
    }
})();
