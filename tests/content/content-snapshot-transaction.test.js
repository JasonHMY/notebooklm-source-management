const createContentSnapshotTransaction = require('../../src/content/content-snapshot-transaction.js');

describe('content snapshot transaction', () => {
    function createHarness(overrides = {}) {
        let runtimeSnapshot = { value: 'before' };
        let contextCurrent = true;
        const saveState = jest.fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValue({ ok: true });
        const effectiveSaveState = overrides.saveState || saveState;
        const applyPersistableSnapshotToRuntime = jest.fn((snapshot) => {
            runtimeSnapshot = JSON.parse(JSON.stringify(snapshot));
            return true;
        });
        const onBusyChange = jest.fn();
        const onRollbackUnconfirmed = jest.fn();
        const onRecoveryRetained = jest.fn();
        const transaction = createContentSnapshotTransaction({
            cloneSerializableData: (value) => JSON.parse(JSON.stringify(value)),
            buildPersistableState: () => runtimeSnapshot,
            applyPersistableSnapshotToRuntime,
            saveState: effectiveSaveState,
            render: jest.fn(),
            closeSourceActionMenu: jest.fn(),
            getContextToken: () => 'notebook:instance',
            isContextCurrent: () => contextCurrent,
            onBusyChange,
            onRollbackUnconfirmed,
            onRecoveryRetained,
            ...overrides
        });
        return {
            transaction,
            saveState: effectiveSaveState,
            applyPersistableSnapshotToRuntime,
            onBusyChange,
            onRollbackUnconfirmed,
            onRecoveryRetained,
            getRuntimeSnapshot: () => runtimeSnapshot,
            setContextCurrent: (value) => {
                contextCurrent = Boolean(value);
            }
        };
    }

    it('reports success only after an explicit save acknowledgement', async () => {
        const harness = createHarness();

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            reason: 'history_restore'
        })).resolves.toMatchObject({
            ok: true,
            rolledBack: false
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'target' });
        expect(harness.onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false]);
        expect(harness.saveState).toHaveBeenCalledWith(expect.objectContaining({
            recoveryFallbackSnapshot: { value: 'before' }
        }));
    });

    it('rolls runtime and persistence back when the target save is rejected', async () => {
        const harness = createHarness({
            saveState: jest.fn()
                .mockResolvedValueOnce({ ok: false, reason: 'storage_quota_exceeded' })
                .mockResolvedValueOnce({ ok: true })
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            reason: 'recovery_restore'
        })).resolves.toMatchObject({
            ok: false,
            reason: 'storage_quota_exceeded',
            rolledBack: true,
            rollbackPersisted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
        expect(harness.saveState).toHaveBeenNthCalledWith(1, expect.objectContaining({
            recoveryFallbackSnapshot: { value: 'before' }
        }));
        expect(harness.saveState).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
            recoveryFallbackSnapshot: expect.anything()
        }));
    });

    it.each([
        ['undefined acknowledgement', () => undefined],
        ['thrown save', () => Promise.reject(new Error('runtime_failure'))]
    ])('treats %s as failure and rolls back', async (_label, saveResult) => {
        const harness = createHarness({
            saveState: jest.fn()
                .mockImplementationOnce(saveResult)
                .mockResolvedValueOnce({ ok: true })
        });

        const result = await harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        });

        expect(result.ok).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
    });

    it('serializes restore requests', async () => {
        let resolveSave;
        const harness = createHarness({
            saveState: jest.fn(() => new Promise((resolve) => {
                resolveSave = resolve;
            }))
        });
        const first = harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'first' }
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'second' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'snapshot_transaction_busy'
        });

        resolveSave({ ok: true });
        await expect(first).resolves.toMatchObject({ ok: true });
    });

    it('does not apply a target after its manager context becomes stale', async () => {
        const harness = createHarness({
            isContextCurrent: () => false
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'snapshot_context_stale',
            rolledBack: false
        });
        expect(harness.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
    });

    it('fails closed when the manager context changes after apply and preserves the recovery path', async () => {
        let resolveSave;
        const afterSuccess = jest.fn();
        const harness = createHarness({
            saveState: jest.fn(() => new Promise((resolve) => {
                resolveSave = resolve;
            }))
        });

        const pendingTransaction = harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            afterSuccess
        });
        await Promise.resolve();
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'target' });

        harness.setContextCurrent(false);
        resolveSave({ ok: true });

        await expect(pendingTransaction).resolves.toMatchObject({
            ok: false,
            reason: 'snapshot_context_stale',
            rolledBack: false,
            rollbackPersisted: false
        });
        expect(afterSuccess).not.toHaveBeenCalled();
        expect(harness.onRollbackUnconfirmed).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'snapshot_context_stale',
            rolledBack: false,
            rollbackPersisted: false
        }));
    });

    it.each([
        [
            'top-level stale acknowledgement',
            { ok: true, stale: true }
        ],
        [
            'nested runtime stale acknowledgement',
            { ok: true, runtimeResult: { ok: true, stale: true } }
        ],
        [
            'explicit stale revision rejection',
            { ok: false, reason: 'stale_revision' }
        ]
    ])('rejects a %s and rolls the snapshot back', async (_label, staleResult) => {
        const harness = createHarness({
            saveState: jest.fn()
                .mockResolvedValueOnce(staleResult)
                .mockResolvedValueOnce({ ok: true })
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'stale_revision',
            rolledBack: true,
            rollbackPersisted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
    });

    it('retains the recovery path when the rollback save also fails', async () => {
        const harness = createHarness({
            saveState: jest.fn()
                .mockResolvedValueOnce({ ok: false, reason: 'storage_quota_exceeded' })
                .mockResolvedValueOnce({ ok: false, reason: 'stale_revision' })
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'storage_quota_exceeded',
            rolledBack: true,
            rollbackPersisted: false
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
        expect(harness.onRollbackUnconfirmed).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'storage_quota_exceeded',
            rolledBack: true,
            rollbackPersisted: false
        }));
    });

    it('does not apply when the pre-restore checkpoint fails', async () => {
        const appendStateHistorySnapshot = jest.fn()
            .mockRejectedValue(new Error('snapshot_checkpoint_failed'));
        const harness = createHarness({ appendStateHistorySnapshot });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            checkpointReason: 'before_history_restore'
        })).resolves.toMatchObject({
            ok: false,
            reason: 'snapshot_checkpoint_failed',
            rolledBack: false
        });
        expect(harness.applyPersistableSnapshotToRuntime).not.toHaveBeenCalled();
        expect(harness.saveState).not.toHaveBeenCalled();
    });

    it.each([
        ['returns false', () => false],
        ['throws', () => {
            throw new Error('snapshot_apply_failed');
        }]
    ])('rolls back when snapshot apply %s', async (_label, failApply) => {
        const harness = createHarness();
        harness.applyPersistableSnapshotToRuntime
            .mockImplementationOnce(failApply);

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'snapshot_apply_failed',
            rolledBack: true,
            rollbackPersisted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
    });

    it.each([
        ['rejects', () => Promise.reject(new Error('cleanup_failed')), 'cleanup_failed'],
        ['returns false', () => false, 'snapshot_after_success_failed']
    ])('rolls back when afterSuccess %s', async (_label, afterSuccess, expectedReason) => {
        const harness = createHarness();

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            afterSuccess
        })).resolves.toMatchObject({
            ok: false,
            reason: expectedReason,
            rolledBack: true,
            rollbackPersisted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
        expect(harness.saveState).toHaveBeenCalledTimes(2);
    });

    it('propagates an explicit cleanup reason and preserves the recovery snapshot during rollback', async () => {
        const harness = createHarness();

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' },
            preserveRecoverySnapshot: true,
            afterSuccess: () => ({ ok: false, reason: 'recovery_cleanup_failed' })
        })).resolves.toMatchObject({
            ok: false,
            reason: 'recovery_cleanup_failed',
            rolledBack: true,
            rollbackPersisted: true,
            persistenceCommitted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
        expect(harness.saveState).toHaveBeenNthCalledWith(1, expect.objectContaining({
            preserveRecoverySnapshot: true,
            recoveryFallbackSnapshot: { value: 'before' }
        }));
        expect(harness.saveState).toHaveBeenNthCalledWith(2, expect.objectContaining({
            preserveRecoverySnapshot: true
        }));
    });

    it('treats a persisted cleanup failure as a failed transaction with a confirmed rollback', async () => {
        const harness = createHarness({
            saveState: jest.fn().mockResolvedValue({
                ok: false,
                reason: 'recovery_cleanup_failed',
                persistenceCommitted: true
            })
        });

        await expect(harness.transaction.runSnapshotTransaction({
            snapshot: { value: 'target' }
        })).resolves.toMatchObject({
            ok: false,
            reason: 'recovery_cleanup_failed',
            rolledBack: true,
            rollbackPersisted: true,
            persistenceCommitted: true
        });
        expect(harness.getRuntimeSnapshot()).toEqual({ value: 'before' });
        expect(harness.onRollbackUnconfirmed).not.toHaveBeenCalled();
        expect(harness.onRecoveryRetained).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'recovery_cleanup_failed',
            rollbackPersisted: true,
            persistenceCommitted: true
        }));
    });
});
