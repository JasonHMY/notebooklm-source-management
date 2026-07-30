(function () {
    'use strict';

    /**
     * createContentUndoHistory(deps) — bounded transactional undo/redo history.
     * Normal saves push the previous baseline to undo and clear redo. History applies are
     * committed only after a critical save acknowledgement; failed applies restore the
     * pre-operation runtime snapshot without moving either stack.
     *
     * @param {Object} deps Required: cloneSerializableData, buildPersistableState, applyPersistableSnapshotToRuntime.
     *   Optional: showToast, getMessage, closeSourceActionMenu, render, runSaveAfterHistory,
     *   runSaveAfterUndo (legacy alias), onHistoryStateChange, stackLimit (default 20).
     * @returns {Object} Transactional undo/redo history helpers.
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
            runSaveAfterHistory,
            runSaveAfterUndo = () => {},
            onHistoryStateChange = () => {},
            stackLimit = 20
        } = deps;
        const saveHistorySnapshot = typeof runSaveAfterHistory === 'function'
            ? runSaveAfterHistory
            : runSaveAfterUndo;
        const boundedStackLimit = Math.max(1, Number(stackLimit) || 20);

        if (typeof cloneSerializableData !== 'function'
            || typeof buildPersistableState !== 'function'
            || typeof applyPersistableSnapshotToRuntime !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentUndoHistory requires cloneSerializableData, buildPersistableState and applyPersistableSnapshotToRuntime.');
        }

        let undoStack = [];
        let redoStack = [];
        let undoBaselineSnapshot = null;
        let undoBaselineSignature = '';
        let isApplyingHistorySnapshot = false;
        let activeHistoryAction = '';

        function notifyHistoryStateChange() {
            try {
                onHistoryStateChange({
                    canUndo: undoStack.length > 0 && !isApplyingHistorySnapshot,
                    canRedo: redoStack.length > 0 && !isApplyingHistorySnapshot,
                    isApplying: isApplyingHistorySnapshot,
                    action: activeHistoryAction
                });
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Could not update undo/redo controls.', error);
            }
        }

        function pushBounded(stack, snapshot) {
            stack.push(cloneSerializableData(snapshot));
            if (stack.length > boundedStackLimit) {
                stack.splice(0, stack.length - boundedStackLimit);
            }
        }

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
            redoStack = [];
            setUndoBaselineSnapshot(snapshot);
            notifyHistoryStateChange();
        }

        function recordUndoBaselineForSave(nextSnapshot, options = {}) {
            if (!nextSnapshot) return false;
            if (isApplyingHistorySnapshot && options.recordUndo === false) return false;

            const shouldRecordUndo = options.recordUndo !== false && !isApplyingHistorySnapshot;
            const nextSignature = getUndoSnapshotSignature(nextSnapshot);
            const hasChanged = Boolean(
                undoBaselineSnapshot
                && undoBaselineSignature
                && nextSignature
                && nextSignature !== undoBaselineSignature
            );

            if (shouldRecordUndo && hasChanged) {
                pushBounded(undoStack, undoBaselineSnapshot);
                redoStack = [];
            }

            undoBaselineSnapshot = cloneSerializableData(nextSnapshot);
            undoBaselineSignature = nextSignature;
            notifyHistoryStateChange();
            return hasChanged;
        }

        function getHistoryMessageKey(action, suffix) {
            return `ui_${action}_${suffix}`;
        }

        function restoreRuntimeSnapshot(snapshot) {
            try {
                const restored = applyPersistableSnapshotToRuntime(snapshot);
                if (restored) {
                    closeSourceActionMenu();
                    render();
                    setUndoBaselineSnapshot(snapshot);
                }
                return Boolean(restored);
            } catch (error) {
                console.warn('GeminiNotebook-Source-Management: Could not roll back history snapshot.', error);
                return false;
            }
        }

        async function applyHistoryOperation(action) {
            const isRedo = action === 'redo';
            const sourceStack = isRedo ? redoStack : undoStack;
            const destinationStack = isRedo ? undoStack : redoStack;
            const snapshot = sourceStack[sourceStack.length - 1];

            if (isApplyingHistorySnapshot) return false;
            if (!snapshot) {
                showToast(getMessage(getHistoryMessageKey(action, 'empty')), { variant: 'info' });
                return false;
            }

            const previousSnapshot = getCurrentUndoSnapshot();
            if (!previousSnapshot) {
                showToast(getMessage(getHistoryMessageKey(action, 'failed')), { variant: 'error' });
                return false;
            }

            isApplyingHistorySnapshot = true;
            activeHistoryAction = action;
            notifyHistoryStateChange();
            let applyAttempted = false;
            try {
                applyAttempted = true;
                if (!applyPersistableSnapshotToRuntime(snapshot)) {
                    throw new Error('history_snapshot_apply_failed');
                }

                closeSourceActionMenu();
                render();
                const saveResult = await Promise.resolve(saveHistorySnapshot({
                    immediate: true,
                    critical: true,
                    recordUndo: false
                }));
                if (!saveResult || saveResult.ok !== true) {
                    throw new Error(saveResult?.reason || 'history_snapshot_save_failed');
                }

                sourceStack.pop();
                pushBounded(destinationStack, previousSnapshot);
                setUndoBaselineSnapshot(snapshot);
                showToast(getMessage(getHistoryMessageKey(action, 'toast')), { variant: 'success' });
                return true;
            } catch (error) {
                if (applyAttempted) {
                    restoreRuntimeSnapshot(previousSnapshot);
                }
                showToast(getMessage(getHistoryMessageKey(action, 'failed')), { variant: 'error' });
                return false;
            } finally {
                isApplyingHistorySnapshot = false;
                activeHistoryAction = '';
                notifyHistoryStateChange();
            }
        }

        function undoLastOperation() {
            return applyHistoryOperation('undo');
        }

        function redoLastOperation() {
            return applyHistoryOperation('redo');
        }

        function getUndoStack() {
            return undoStack;
        }

        function getRedoStack() {
            return redoStack;
        }

        function getUndoStackLength() {
            return undoStack.length;
        }

        function getRedoStackLength() {
            return redoStack.length;
        }

        function canUndo() {
            return undoStack.length > 0 && !isApplyingHistorySnapshot;
        }

        function canRedo() {
            return redoStack.length > 0 && !isApplyingHistorySnapshot;
        }

        function isApplyingUndo() {
            return isApplyingHistorySnapshot;
        }

        function isApplyingHistory() {
            return isApplyingHistorySnapshot;
        }

        return {
            getUndoSnapshotSignature,
            getCurrentUndoSnapshot,
            setUndoBaselineSnapshot,
            resetUndoHistoryBaseline,
            recordUndoBaselineForSave,
            undoLastOperation,
            redoLastOperation,
            getUndoStack,
            getRedoStack,
            getUndoStackLength,
            getRedoStackLength,
            canUndo,
            canRedo,
            isApplyingUndo,
            isApplyingHistory
        };
    }

    globalThis.NSM_CREATE_CONTENT_UNDO_HISTORY = createContentUndoHistory;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentUndoHistory;
    }
})();
