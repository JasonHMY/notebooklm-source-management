(function () {
    'use strict';

    /**
     * Serializes user-requested snapshot restores and makes persistence acknowledgement
     * part of the transaction. A failed or ambiguous save restores the pre-operation
     * runtime snapshot and attempts to persist that rollback before returning.
     */
    function createContentSnapshotTransaction(deps = {}) {
        const {
            cloneSerializableData,
            buildPersistableState,
            applyPersistableSnapshotToRuntime,
            saveState,
            appendStateHistorySnapshot = null,
            closeSourceActionMenu = () => {},
            render = () => {},
            getContextToken = () => null,
            isContextCurrent = () => true,
            onBusyChange = () => {},
            onRollbackUnconfirmed = () => {},
            onRecoveryRetained = () => {}
        } = deps;

        if (
            typeof cloneSerializableData !== 'function'
            || typeof buildPersistableState !== 'function'
            || typeof applyPersistableSnapshotToRuntime !== 'function'
            || typeof saveState !== 'function'
        ) {
            throw new Error(
                'GeminiNotebook-Source-Management: createContentSnapshotTransaction requires snapshot and persistence helpers.'
            );
        }

        let activeTransaction = null;
        let nextTransactionId = 1;

        function isBusy() {
            return Boolean(activeTransaction);
        }

        function normalizeFailureReason(error, fallback = 'snapshot_transaction_failed') {
            const reason = typeof error === 'string'
                ? error
                : (error?.reason || error?.errorCode || error?.message || fallback);
            return String(reason || fallback);
        }

        function isExplicitSuccess(result) {
            return Boolean(
                result
                && result.ok === true
                && result.stale !== true
                && result.reason !== 'stale_revision'
                && result.errorCode !== 'stale_revision'
                && result.runtimeResult?.stale !== true
                && result.runtimeResult?.reason !== 'stale_revision'
                && result.runtimeResult?.errorCode !== 'stale_revision'
            );
        }

        function isStaleSaveResult(result) {
            return Boolean(
                result?.stale === true
                || result?.reason === 'stale_revision'
                || result?.errorCode === 'stale_revision'
                || result?.runtimeResult?.stale === true
                || result?.runtimeResult?.reason === 'stale_revision'
                || result?.runtimeResult?.errorCode === 'stale_revision'
            );
        }

        async function persistSnapshot(
            reason,
            recoveryFallbackSnapshot = null,
            persistOptions = {}
        ) {
            let result;
            try {
                const saveOptions = {
                    immediate: true,
                    critical: true,
                    recordUndo: false,
                    allowLocalFallback: false,
                    reason
                };
                if (recoveryFallbackSnapshot && typeof recoveryFallbackSnapshot === 'object') {
                    saveOptions.recoveryFallbackSnapshot = cloneSerializableData(
                        recoveryFallbackSnapshot
                    );
                }
                if (persistOptions.preserveRecoverySnapshot === true) {
                    saveOptions.preserveRecoverySnapshot = true;
                }
                result = await Promise.resolve(saveState(saveOptions));
            } catch (error) {
                return {
                    ok: false,
                    reason: normalizeFailureReason(error, 'snapshot_save_failed')
                };
            }
            if (isExplicitSuccess(result)) return result;
            const failedResult = {
                ok: false,
                reason: isStaleSaveResult(result)
                    ? 'stale_revision'
                    : normalizeFailureReason(result, 'snapshot_save_ack_missing')
            };
            if (result?.persistenceCommitted === true) {
                failedResult.persistenceCommitted = true;
            }
            return failedResult;
        }

        async function runSnapshotTransaction(options = {}) {
            if (activeTransaction) {
                return {
                    ok: false,
                    reason: 'snapshot_transaction_busy',
                    rolledBack: false
                };
            }

            const targetSnapshot = options.snapshot;
            if (!targetSnapshot || typeof targetSnapshot !== 'object') {
                return {
                    ok: false,
                    reason: 'snapshot_unavailable',
                    rolledBack: false
                };
            }

            let beforeSnapshot;
            try {
                beforeSnapshot = cloneSerializableData(buildPersistableState());
            } catch (error) {
                return {
                    ok: false,
                    reason: 'snapshot_capture_failed',
                    rolledBack: false
                };
            }

            const contextToken = getContextToken();
            const reason = String(options.reason || 'snapshot_restore');
            const transaction = {
                id: nextTransactionId++,
                reason,
                contextToken
            };
            activeTransaction = transaction;
            onBusyChange(true, transaction);

            let applyAttempted = false;
            let rolledBack = false;
            let rollbackPersisted = false;
            let failureReason = 'snapshot_transaction_failed';
            let persistenceCommitted = false;
            const persistOptions = {
                preserveRecoverySnapshot: options.preserveRecoverySnapshot === true
            };

            try {
                if (
                    options.checkpointReason
                    && typeof appendStateHistorySnapshot === 'function'
                ) {
                    const checkpointResult = await Promise.resolve(
                        appendStateHistorySnapshot(
                            cloneSerializableData(beforeSnapshot),
                            String(options.checkpointReason)
                        )
                    );
                    if (
                        checkpointResult === false
                        || checkpointResult?.ok === false
                        || checkpointResult?.success === false
                    ) {
                        throw new Error('snapshot_checkpoint_failed');
                    }
                }

                if (!isContextCurrent(contextToken)) {
                    throw new Error('snapshot_context_stale');
                }

                applyAttempted = true;
                if (!applyPersistableSnapshotToRuntime(cloneSerializableData(targetSnapshot))) {
                    throw new Error('snapshot_apply_failed');
                }
                closeSourceActionMenu();
                render();

                const saveResult = await persistSnapshot(
                    reason,
                    beforeSnapshot,
                    persistOptions
                );
                persistenceCommitted = Boolean(
                    saveResult?.ok === true || saveResult?.persistenceCommitted === true
                );
                if (!saveResult.ok) {
                    throw new Error(saveResult.reason || 'snapshot_save_failed');
                }
                if (!isContextCurrent(contextToken)) {
                    throw new Error('snapshot_context_stale');
                }

                if (typeof options.afterSuccess === 'function') {
                    const afterSuccessResult = await Promise.resolve(options.afterSuccess(saveResult));
                    if (
                        afterSuccessResult === false
                        || afterSuccessResult?.ok === false
                        || afterSuccessResult?.success === false
                    ) {
                        throw new Error(
                            normalizeFailureReason(
                                afterSuccessResult,
                                'snapshot_after_success_failed'
                            )
                        );
                    }
                }
                return {
                    ok: true,
                    reason: 'snapshot_transaction_committed',
                    rolledBack: false,
                    saveResult
                };
            } catch (error) {
                failureReason = normalizeFailureReason(error);
                const recoveryRetained = Boolean(
                    persistenceCommitted
                    && failureReason === 'recovery_cleanup_failed'
                );
                const rollbackPersistOptions = Object.assign({}, persistOptions, {
                    preserveRecoverySnapshot: Boolean(
                        persistOptions.preserveRecoverySnapshot || recoveryRetained
                    )
                });
                if (applyAttempted && isContextCurrent(contextToken)) {
                    try {
                        rolledBack = Boolean(
                            applyPersistableSnapshotToRuntime(
                                cloneSerializableData(beforeSnapshot)
                            )
                        );
                    } catch (rollbackError) {
                        rolledBack = false;
                    }
                    if (rolledBack) {
                        closeSourceActionMenu();
                        render();
                        const rollbackResult = await persistSnapshot(
                            `${reason}_rollback`,
                            null,
                            rollbackPersistOptions
                        );
                        rollbackPersisted = Boolean(
                            rollbackResult?.ok === true
                            || rollbackResult?.persistenceCommitted === true
                        );
                    }
                }

                if (recoveryRetained) {
                    try {
                        onRecoveryRetained({
                            reason: failureReason,
                            rolledBack,
                            rollbackPersisted,
                            persistenceCommitted,
                            transaction
                        });
                    } catch (callbackError) {
                        // The retained recovery snapshot remains the durable fallback.
                    }
                }
                if (!rolledBack || !rollbackPersisted) {
                    try {
                        onRollbackUnconfirmed({
                            reason: failureReason,
                            rolledBack,
                            rollbackPersisted,
                            transaction
                        });
                    } catch (callbackError) {
                        // The recovery snapshot remains the durable fallback.
                    }
                }
                if (typeof options.afterFailure === 'function') {
                    await Promise.resolve(options.afterFailure({
                        reason: failureReason,
                        rolledBack,
                        rollbackPersisted,
                        persistenceCommitted,
                        transaction
                    }));
                }
                return {
                    ok: false,
                    reason: failureReason,
                    rolledBack,
                    rollbackPersisted,
                    persistenceCommitted
                };
            } finally {
                if (activeTransaction?.id === transaction.id) {
                    activeTransaction = null;
                    onBusyChange(false, transaction);
                }
            }
        }

        return {
            runSnapshotTransaction,
            isBusy
        };
    }

    globalThis.NSM_CREATE_CONTENT_SNAPSHOT_TRANSACTION = createContentSnapshotTransaction;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentSnapshotTransaction;
    }
})();
