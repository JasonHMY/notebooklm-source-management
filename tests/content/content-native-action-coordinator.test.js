const createContentNativeActionCoordinator = require(
    '../../src/content/content-native-action-coordinator.js'
);
const createContentSourceActions = require('../../src/content/content-source-actions.js');

function createHost() {
    const classes = new Set();
    const attributes = new Map();
    return {
        classList: {
            add: jest.fn((value) => classes.add(value)),
            remove: jest.fn((value) => classes.delete(value)),
            contains: (value) => classes.has(value)
        },
        setAttribute: jest.fn((name, value) => attributes.set(name, value)),
        removeAttribute: jest.fn((name) => attributes.delete(name)),
        getAttribute: (name) => attributes.get(name) || null
    };
}

function createRuntime(overrides = {}) {
    const host = createHost();
    const context = {
        projectId: 'project-1',
        managerInstanceToken: 7
    };
    const developerLog = jest.fn();
    const coordinator = createContentNativeActionCoordinator({
        getContext: () => context,
        getHostElement: () => host,
        developerLog,
        ...overrides
    });
    return { coordinator, context, host, developerLog };
}

describe('content native action coordinator', () => {
    it('rejects invalid metadata without adding the host scope', () => {
        const { coordinator, host } = createRuntime();

        expect(coordinator.beginOperation({ action: 'delete' })).toEqual({
            ok: false,
            reason: 'native_action_invalid',
            operation: null
        });
        expect(coordinator.beginOperation({
            action: 'delete',
            sourceKey: 'source-1'
        })).toEqual({
            ok: false,
            reason: 'native_action_invalid',
            operation: null
        });
        expect(host.classList.add).not.toHaveBeenCalled();
    });

    it('serializes operations and removes the scoped host marker only for the owner', () => {
        const { coordinator, host } = createRuntime();

        const first = coordinator.beginOperation({
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'stable-1' }
        });
        expect(first.ok).toBe(true);
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(true);
        expect(host.getAttribute('data-nsm-native-action-active')).toBe('true');

        expect(coordinator.beginOperation({
            action: 'rename',
            sourceKey: 'source-2'
        })).toEqual({
            ok: false,
            reason: 'native_action_busy',
            operation: null
        });
        expect(coordinator.endOperation({ operationId: 'stale' })).toBe(false);
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(true);

        expect(coordinator.endOperation(first.operation)).toBe(true);
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(false);
        expect(host.getAttribute('data-nsm-native-action-active')).toBeNull();
    });

    it('fails closed when the project or manager instance changes', () => {
        const { coordinator, context, host } = createRuntime();
        const started = coordinator.beginOperation({
            action: 'rename',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'stable-1' }
        });

        context.managerInstanceToken = 8;

        expect(coordinator.validateOperation(started.operation)).toEqual({
            ok: false,
            reason: 'native_action_context_changed'
        });
        expect(coordinator.cancelActiveOperation('route_switch')).toBe(true);
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(false);
    });

    it('validates the bound source identity without exposing its title to logs', () => {
        const { coordinator, developerLog } = createRuntime();
        const started = coordinator.beginOperation({
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: {
                stableToken: 'stable-1',
                normalizedTitle: 'private source title'
            }
        });

        expect(coordinator.validateOperation(started.operation, {
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: {
                stableToken: 'stable-2',
                normalizedTitle: 'private source title'
            }
        })).toEqual({
            ok: false,
            reason: 'native_action_source_changed'
        });
        expect(JSON.stringify(developerLog.mock.calls)).not.toContain('private source title');
    });

    it('binds each batch step to one source identity until the step is released', () => {
        const { coordinator } = createRuntime();
        const session = coordinator.beginOperation({
            action: 'batch-delete',
            sourceKey: 'batch'
        });
        expect(coordinator.bindOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-missing-identity'
        })).toEqual({
            ok: false,
            reason: 'native_action_invalid',
            step: null
        });
        const firstStep = coordinator.bindOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'stable-1' }
        });

        expect(firstStep.ok).toBe(true);
        expect(coordinator.validateOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'stable-1' }
        })).toEqual({ ok: true, reason: '' });
        expect(coordinator.bindOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-2'
        })).toEqual({
            ok: false,
            reason: 'native_action_busy',
            step: null
        });
        expect(coordinator.validateOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'replacement' }
        })).toEqual({
            ok: false,
            reason: 'native_action_source_changed'
        });

        expect(coordinator.clearOperationStep(
            session.operation,
            firstStep.step
        )).toBe(true);
        expect(coordinator.bindOperationStep(session.operation, {
            action: 'delete',
            sourceKey: 'source-2',
            sourceIdentity: { stableToken: 'stable-2' }
        }).ok).toBe(true);
        expect(coordinator.endOperation(session.operation)).toBe(true);
    });

    it('always releases runExclusive operations when the worker throws', async () => {
        const { coordinator, host } = createRuntime();

        await expect(coordinator.runExclusive({
            action: 'details',
            sourceKey: 'source-1',
            sourceIdentity: { stableToken: 'stable-1' }
        }, async () => {
            throw new Error('test failure');
        })).rejects.toThrow('test failure');

        expect(coordinator.isOperationActive()).toBe(false);
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(false);
    });

    it('keeps a rename exclusive until its watcher settles', async () => {
        const { coordinator, host } = createRuntime();
        let menuOpen = false;
        let resolveRenameWatcher;
        const renameWatcher = new Promise((resolve) => {
            resolveRenameWatcher = resolve;
        });
        const moreButton = {
            click: jest.fn(() => {
                menuOpen = true;
            })
        };
        const rowIdentity = {
            stableToken: 'stable-1',
            fingerprint: 'fingerprint-1',
            normalizedTitle: 'source one'
        };
        const row = {
            querySelector: jest.fn((selector) => (selector === '.more' ? moreButton : null)),
            querySelectorAll: jest.fn(() => [])
        };
        const renameItem = {
            textContent: 'Rename source',
            click: jest.fn(),
            getAttribute: jest.fn(() => null),
            querySelector: jest.fn(() => ({ textContent: 'edit' }))
        };
        const documentMock = {
            body: {
                contains: jest.fn(() => true),
                click: jest.fn()
            },
            querySelectorAll: jest.fn((selector) => (
                selector.includes('menuitem') && menuOpen ? [renameItem] : []
            ))
        };
        const sourcesByKey = new Map([[
            'source-1',
            {
                key: 'source-1',
                title: 'Source One',
                stableToken: 'stable-1',
                fingerprint: 'fingerprint-1',
                element: row,
                isDisabled: false,
                isLoading: false
            }
        ]]);
        const actions = createContentSourceActions({
            getDocument: () => documentMock,
            getWindow: () => null,
            getSourcesByKey: () => sourcesByKey,
            getDEPS: () => ({ moreBtn: ['.more'], row: ['.row'], title: ['.title'] }),
            resolveFreshRowEntry: () => ({ row, identity: rowIdentity }),
            extractSourceIdentitySnapshot: () => rowIdentity,
            nativeActionCoordinator: coordinator,
            onNativeSourceRenameStarted: () => renameWatcher
        });

        const firstRename = actions.triggerNativeSourceRenameWithResult('source-1');
        await Promise.resolve();
        await Promise.resolve();

        expect(actions.getActiveNativeActionOperation()).toMatchObject({
            action: 'rename',
            sourceKey: 'source-1'
        });
        await expect(actions.deleteNativeSource('source-1')).resolves.toEqual({
            deleted: false,
            reason: 'native_action_busy'
        });
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(true);

        resolveRenameWatcher(true);
        await expect(firstRename).resolves.toEqual({ ok: true });
        expect(actions.getActiveNativeActionOperation()).toBeNull();
        expect(host.classList.contains('sources-plus-native-action-active')).toBe(false);
    });

    it('confirms a real delete when a virtualized list backfills without shrinking its materialized rows', async () => {
        const { coordinator } = createRuntime();
        let menuOpen = false;
        let dialogOpen = false;
        let deletionAccepted = false;
        const moreButton = {
            click: jest.fn(() => {
                menuOpen = true;
            })
        };
        const targetIdentity = {
            stableToken: 'target-token',
            fingerprint: 'target-fingerprint',
            normalizedTitle: 'target source'
        };
        const survivorIdentity = {
            stableToken: 'survivor-token',
            fingerprint: 'survivor-fingerprint',
            normalizedTitle: 'survivor source'
        };
        const backfillIdentity = {
            stableToken: 'backfill-token',
            fingerprint: 'backfill-fingerprint',
            normalizedTitle: 'backfill source'
        };
        const createRow = (identity, nativeMoreButton = null) => ({
            textContent: identity.normalizedTitle,
            getAttribute: jest.fn((name) => (
                name === 'data-source-id' ? identity.stableToken : null
            )),
            querySelector: jest.fn((selector) => {
                if (selector === '.more') return nativeMoreButton;
                if (selector === '.title') {
                    return { textContent: identity.normalizedTitle };
                }
                return null;
            }),
            querySelectorAll: jest.fn(() => [])
        });
        const targetRow = createRow(targetIdentity, moreButton);
        const survivorRow = createRow(survivorIdentity);
        const backfillRow = createRow(backfillIdentity);
        const currentRows = () => (
            deletionAccepted
                ? [survivorRow, backfillRow]
                : [targetRow, survivorRow]
        );
        const deleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => {
                dialogOpen = true;
            }),
            getAttribute: jest.fn(() => null),
            querySelector: jest.fn(() => ({ textContent: 'delete' }))
        };
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(() => {
                deletionAccepted = true;
                dialogOpen = false;
            }),
            getAttribute: jest.fn(() => null),
            querySelector: jest.fn(() => null)
        };
        const dialog = {
            hidden: false,
            textContent: 'Delete Target Source?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn((selector) => (
                selector === 'button' ? [confirmButton] : []
            ))
        };
        confirmButton.click.mockImplementation(() => {
            deletionAccepted = true;
            dialogOpen = false;
            dialog.hidden = true;
        });
        const panel = {
            hidden: false,
            contains: jest.fn((element) => currentRows().includes(element)),
            getAttribute: jest.fn(() => null),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => currentRows())
        };
        const documentMock = {
            body: {
                contains: jest.fn((element) => (
                    element === panel || currentRows().includes(element)
                )),
                click: jest.fn()
            },
            querySelector: jest.fn((selector) => (
                selector === '.panel' ? panel : null
            )),
            querySelectorAll: jest.fn((selector) => {
                if (selector === '.row') return currentRows();
                if (selector.includes('menuitem')) return menuOpen ? [deleteMenuItem] : [];
                if (selector.includes('dialog')) return dialogOpen ? [dialog] : [];
                return [];
            })
        };
        const sourcesByKey = new Map([[
            'target-source',
            {
                key: 'target-source',
                title: 'Target Source',
                ...targetIdentity,
                element: targetRow,
                isDisabled: false,
                isLoading: false
            }
        ]]);
        const getNativeSourceInventory = jest.fn(() => (
            deletionAccepted
                ? {
                    completeness: 'complete',
                    observedIdentityKeys: [
                        'stable:survivor-token',
                        'stable:backfill-token'
                    ],
                    totalHint: 2,
                    rowCount: 2
                }
                : {
                    completeness: 'complete',
                    observedIdentityKeys: [
                        'stable:target-token',
                        'stable:survivor-token',
                        'stable:backfill-token'
                    ],
                    totalHint: 3,
                    rowCount: 2
                }
        ));
        const actions = createContentSourceActions({
            getDocument: () => documentMock,
            getWindow: () => null,
            getSourcesByKey: () => sourcesByKey,
            getDEPS: () => ({
                panel: ['.panel'],
                row: ['.row'],
                title: ['.title'],
                moreBtn: ['.more']
            }),
            resolveFreshRowEntry: () => (
                deletionAccepted
                    ? null
                    : { row: targetRow, identity: targetIdentity }
            ),
            extractSourceIdentitySnapshot: (row) => {
                if (row === targetRow) return targetIdentity;
                if (row === survivorRow) return survivorIdentity;
                if (row === backfillRow) return backfillIdentity;
                return null;
            },
            nativeActionCoordinator: coordinator,
            getNativeSourceInventory,
            onNativeSourceDeleteAccepted: () => true
        });

        await expect(actions.deleteNativeSource('target-source')).resolves.toEqual({
            deleted: true
        });
        expect(moreButton.click).toHaveBeenCalledTimes(1);
        expect(confirmButton.click).toHaveBeenCalledTimes(1);
        expect(getNativeSourceInventory).toHaveBeenCalled();
        expect(currentRows()).toHaveLength(2);
    });
});
