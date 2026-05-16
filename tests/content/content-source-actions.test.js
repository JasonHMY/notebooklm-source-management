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

describe('executeBatchDelete', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = (cb, ms) => cb();
        global.queueMicrotask = (cb) => { process.nextTick(cb); };

        global.console.warn = jest.fn();
        global.console.error = jest.fn();

        mod = loadContentModule();
        if (mod._resetState) mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('returns early if pendingBatchKeys is empty', async () => {
        mod.pendingBatchKeys.clear();
        await mod.executeBatchDelete();
        expect(mod._getIsDeletingSources()).toBe(false);
    });

    it('returns early if already deleting', async () => {
        mod.pendingBatchKeys.add('key1');
        mod._setIsDeletingSources(true);
        await mod.executeBatchDelete();
        expect(mod.pendingBatchKeys.size).toBe(1);
    });

    it('processes keys, finds more options, clicks delete and confirm', async () => {
        mod.pendingBatchKeys.add('key1');
        mod.state.isBatchMode = true;

        let nativeMenuOpened = false;
        const mockMoreBtn = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const mockSourceElement = {
            querySelector: jest.fn(sel => {
                if (mod.DEPS.moreBtn.includes(sel)) return mockMoreBtn;
                return null;
            })
        };

        mod.sourcesByKey.set('key1', { key: 'key1', element: mockSourceElement, isDisabled: false });

        const mockDeleteIcon = { textContent: 'delete' };
        let deleteClicked = false;
        const mockDeleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => { deleteClicked = true; }),
            querySelector: jest.fn(sel => sel === 'mat-icon' ? mockDeleteIcon : null),
            getAttribute: jest.fn(() => null)
        };
        const mockConfirmBtn = { textContent: 'Delete', className: 'primary', click: jest.fn(), querySelector: jest.fn(), getAttribute: jest.fn() };
        const mockDialog = {
            textContent: 'Delete this?',
            querySelectorAll: jest.fn(sel => {
                if (sel === 'button') return [mockConfirmBtn];
                return [];
            })
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [mockDeleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [mockDialog] : [];
            return [];
        });

        await mod.executeBatchDelete();

        expect(mockMoreBtn.click).toHaveBeenCalled();
        expect(mockDeleteMenuItem.click).toHaveBeenCalled();
        expect(mockConfirmBtn.click).toHaveBeenCalled();

        expect(mod._getIsDeletingSources()).toBe(false);
        expect(mod.pendingBatchKeys.size).toBe(0);
        expect(mod.state.isBatchMode).toBe(false);
    });

    it('uses i18n for the batch delete progress toast', async () => {
        mod.pendingBatchKeys.add('key1');
        mod.state.isBatchMode = true;
        global.chrome.i18n.getMessage = jest.fn((key, substitutions) => {
            if (key === 'ui_deleting_count') return `localized deleting ${substitutions[0]}`;
            if (key === 'ui_deleted_toast') return `localized deleted ${substitutions[0]}`;
            return key;
        });

        let nativeMenuOpened = false;
        const mockMoreBtn = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const mockSourceElement = {
            querySelector: jest.fn(sel => {
                if (mod.DEPS.moreBtn.includes(sel)) return mockMoreBtn;
                return null;
            })
        };
        const mockDeleteIcon = { textContent: 'delete' };
        let deleteClicked = false;
        const mockDeleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => { deleteClicked = true; }),
            querySelector: jest.fn(sel => sel === 'mat-icon' ? mockDeleteIcon : null),
            getAttribute: jest.fn(() => null)
        };
        const mockConfirmBtn = { textContent: 'Delete', className: 'primary', click: jest.fn(), querySelector: jest.fn(), getAttribute: jest.fn() };
        const mockDialog = {
            textContent: 'Delete this?',
            querySelectorAll: jest.fn(sel => {
                if (sel === 'button') return [mockConfirmBtn];
                return [];
            })
        };

        mod.sourcesByKey.set('key1', { key: 'key1', element: mockSourceElement, isDisabled: false });
        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [mockDeleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [mockDialog] : [];
            return [];
        });

        await mod.executeBatchDelete();

        expect(global.chrome.i18n.getMessage).toHaveBeenCalledWith('ui_deleting_count', ['1']);
        expect(global.chrome.i18n.getMessage).toHaveBeenCalledWith('ui_deleted_toast', ['1']);
    });

    it('falls back to findFreshCheckbox if more button is not found initially', async () => {
        mod.pendingBatchKeys.add('key2');

        const mockMoreBtn = { click: jest.fn() };
        const mockFreshRow = {
            querySelector: jest.fn(sel => {
                if (mod.DEPS.moreBtn.includes(sel)) return mockMoreBtn;
                return null;
            }),
            matches: jest.fn((sel) => mod.DEPS.row.includes(sel)),
            closest: jest.fn((sel) => mod.DEPS.row.includes(sel) ? mockFreshRow : null),
        };
        const mockFreshCheckbox = {
            closest: jest.fn(() => mockFreshRow)
        };

        const mockTitleEl = { textContent: 'Test Source' };

        mockFreshRow.querySelector = jest.fn(s => {
            if (mod.DEPS.title.includes(s)) return mockTitleEl;
            if (mod.DEPS.checkbox.includes(s)) return mockFreshCheckbox;
            if (mod.DEPS.moreBtn.includes(s)) return mockMoreBtn;
            return null;
        });

        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) {
                return [mockFreshRow];
            }
            if (sel.includes('[role="menuitem"]')) return [];
            return [];
        });

        const disconnectedElement = {
            querySelector: jest.fn(() => null)
        };
        mod.sourcesByKey.set('key2', {
            key: 'key2',
            title: 'Test Source',
            fingerprint: 'test source||article',
            element: disconnectedElement,
            isDisabled: false
        });
        global.document.body.contains = jest.fn(() => false);

        await mod.executeBatchDelete();

        expect(mockMoreBtn.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('skips disabled sources', async () => {
        mod.pendingBatchKeys.add('disabledKey');
        mod.sourcesByKey.set('disabledKey', { key: 'disabledKey', element: {}, isDisabled: true });

        await mod.executeBatchDelete();

        expect(global.document.querySelectorAll).not.toHaveBeenCalled();
        expect(mod.pendingBatchKeys.size).toBe(0);
    });

    it('clicks document.body if delete menu item is not found', async () => {
        mod.pendingBatchKeys.add('key3');
        const mockMoreBtn = { click: jest.fn() };
        mod.sourcesByKey.set('key3', { key: 'key3', element: { querySelector: () => mockMoreBtn }, isDisabled: false });

        global.document.querySelectorAll = jest.fn(() => []);

        await mod.executeBatchDelete();

        expect(mockMoreBtn.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('clicks document.body if confirm button is not found', async () => {
        mod.pendingBatchKeys.add('key4');
        let nativeMenuOpened = false;
        const mockMoreBtn = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        mod.sourcesByKey.set('key4', { key: 'key4', element: { querySelector: () => mockMoreBtn }, isDisabled: false });

        const mockDeleteIcon = { textContent: 'delete' };
        let deleteClicked = false;
        const mockDeleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => { deleteClicked = true; }),
            querySelector: jest.fn(sel => sel === 'mat-icon' ? mockDeleteIcon : null),
            getAttribute: jest.fn(() => null)
        };
        const mockDialog = {
            textContent: 'Delete this?',
            querySelectorAll: jest.fn(() => [])
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [mockDeleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [mockDialog] : [];
            return [];
        });

        await mod.executeBatchDelete();

        expect(mockMoreBtn.click).toHaveBeenCalled();
        expect(mockDeleteMenuItem.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('stops the batch after a native confirmation failure instead of opening the next source menu', async () => {
        mod.pendingBatchKeys.add('key4');
        mod.pendingBatchKeys.add('key5');
        mod.state.isBatchMode = true;

        let activeMenuKey = '';
        let deleteClicked = false;
        const firstMoreBtn = {
            click: jest.fn(() => {
                activeMenuKey = 'key4';
            })
        };
        const secondMoreBtn = {
            click: jest.fn(() => {
                activeMenuKey = 'key5';
            })
        };
        mod.sourcesByKey.set('key4', {
            key: 'key4',
            element: { querySelector: () => firstMoreBtn },
            isDisabled: false
        });
        mod.sourcesByKey.set('key5', {
            key: 'key5',
            element: { querySelector: () => secondMoreBtn },
            isDisabled: false
        });

        const mockDeleteIcon = { textContent: 'delete' };
        const firstDeleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => { deleteClicked = true; }),
            querySelector: jest.fn(sel => sel === 'mat-icon' ? mockDeleteIcon : null),
            getAttribute: jest.fn(() => null)
        };
        const secondDeleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(),
            querySelector: jest.fn(sel => sel === 'mat-icon' ? mockDeleteIcon : null),
            getAttribute: jest.fn(() => null)
        };
        const dialogWithoutConfirmButton = {
            textContent: 'Delete this?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [] : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) {
                if (activeMenuKey === 'key4') return [firstDeleteMenuItem];
                if (activeMenuKey === 'key5') return [secondDeleteMenuItem];
                return [];
            }
            if (sel.includes('dialog')) return deleteClicked ? [dialogWithoutConfirmButton] : [];
            return [];
        });

        await mod.executeBatchDelete();

        expect(firstMoreBtn.click).toHaveBeenCalled();
        expect(firstDeleteMenuItem.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
        expect(secondMoreBtn.click).not.toHaveBeenCalled();
        expect(secondDeleteMenuItem.click).not.toHaveBeenCalled();
        expect(mod.pendingBatchKeys.size).toBe(0);
        expect(mod.state.isBatchMode).toBe(false);
    });

    it('continues after a source deletion throws and still clears batch state', async () => {
        mod.pendingBatchKeys.add('throwing');
        mod.pendingBatchKeys.add('key5');
        mod.state.isBatchMode = true;
        global.chrome.i18n.getMessage = jest.fn((key, substitutions) => {
            if (key === 'ui_deleted_toast') return `deleted ${substitutions[0]}`;
            if (key === 'ui_deleting_count') return `deleting ${substitutions[0]}`;
            return key;
        });

        mod.sourcesByKey.set('throwing', {
            key: 'throwing',
            element: {
                querySelector: jest.fn(() => {
                    throw new Error('native row failed');
                })
            },
            isDisabled: false
        });

        let nativeMenuOpened = false;
        let deleteClicked = false;
        const mockMoreBtn = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const sourceElement = {
            querySelector: jest.fn(sel => (mod.DEPS.moreBtn.includes(sel) ? mockMoreBtn : null))
        };
        const deleteMenuItem = {
            textContent: 'Delete',
            click: jest.fn(() => { deleteClicked = true; }),
            querySelector: jest.fn(sel => sel === 'mat-icon, .google-symbols' || sel === 'mat-icon' ? { textContent: 'delete' } : null),
            getAttribute: jest.fn(() => null)
        };
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = {
            textContent: 'Delete this source?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        mod.sourcesByKey.set('key5', { key: 'key5', element: sourceElement, isDisabled: false });
        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await mod.executeBatchDelete();

        expect(global.console.error).toHaveBeenCalledWith(
            'NotebookLM Source Management: Error during automated deletion step',
            expect.any(Error)
        );
        expect(confirmButton.click).toHaveBeenCalled();
        expect(global.chrome.i18n.getMessage).toHaveBeenCalledWith('ui_deleted_toast', ['1']);
        expect(mod._getIsDeletingSources()).toBe(false);
        expect(mod.pendingBatchKeys.size).toBe(0);
        expect(mod.state.isBatchMode).toBe(false);
    });
});

describe('toast feedback', () => {
    let mod;
    let scheduledTimeouts;
    let shadowRoot;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        scheduledTimeouts = [];
        global.setTimeout = jest.fn((callback) => {
            scheduledTimeouts.push(callback);
            return scheduledTimeouts.length;
        });
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();

        shadowRoot = {
            host: { isConnected: true },
            childNodes: [],
            appendChild(node) {
                this.childNodes.push(node);
                return node;
            },
            querySelector(selector) {
                if (selector === '.sp-toast') {
                    return this.childNodes.find((node) => String(node.className || '').includes('sp-toast')) || null;
                }
                return null;
            }
        };
        mod._setShadowRootForTest(shadowRoot);
    });

    afterEach(teardownGlobalMocks);

    it('supports variants, aria attributes, and the legacy showToast(message) call', () => {
        mod._showToastForTest('Saved');

        const toast = shadowRoot.querySelector('.sp-toast');
        expect(toast.className).toContain('sp-toast-info');
        expect(toast.attributes.role).toBe('status');
        expect(toast.attributes['aria-live']).toBe('polite');
        expect(toast.childNodes[0].textContent).toBe('Saved');
    });

    it('queues toasts and renders the next item after the active toast closes', () => {
        mod._showToastForTest('First');
        mod._showToastForTest('Second', { variant: 'error' });

        const toast = shadowRoot.querySelector('.sp-toast');
        expect(toast.childNodes[0].textContent).toBe('First');
        expect(mod._getToastQueueLengthForTest()).toBe(1);

        mod._hideActiveToastForTest(true);
        scheduledTimeouts.pop()();

        expect(toast.className).toContain('sp-toast-error');
        expect(toast.childNodes[0].textContent).toBe('Second');
        expect(mod._getToastQueueLengthForTest()).toBe(0);
    });

    it('runs an optional toast action and advances the queue', () => {
        const onAction = jest.fn();
        mod._showToastForTest('Retry available', {
            variant: 'error',
            actionLabel: 'Retry',
            onAction
        });

        const toast = shadowRoot.querySelector('.sp-toast');
        const actionButton = toast.childNodes[1];
        expect(actionButton.textContent).toBe('Retry');

        actionButton.dispatchEvent({ type: 'click' });

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(mod._getActiveToastItemForTest()).toBeNull();
    });
});

describe('deleteNativeSource', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = (cb, ms) => cb();
        global.queueMicrotask = (cb) => { process.nextTick(cb); };
        global.console.error = jest.fn();

        mod = loadContentModule();
        if (mod._resetState) mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    const createDeleteMenuItem = (overrides = {}) => ({
        textContent: overrides.textContent || 'Delete',
        click: jest.fn(() => {
            if (typeof overrides.onClick === 'function') {
                overrides.onClick();
            }
        }),
        querySelector: jest.fn(sel => sel === 'mat-icon, .google-symbols' || sel === 'mat-icon'
            ? { textContent: overrides.iconText || 'delete' }
            : null),
        getAttribute: jest.fn((name) => {
            if (name === 'aria-label') return overrides.ariaLabel || null;
            if (name === 'data-testid') return overrides.testId || null;
            return null;
        })
    });

    const createConfirmDialog = (buttons) => ({
        textContent: 'Delete this source?',
        getAttribute: jest.fn(() => null),
        querySelectorAll: jest.fn(sel => (sel === 'button' ? buttons : []))
    });

    const seedSourceWithMoreButton = (key = 'key1', sourceOverrides = {}) => {
        let nativeMenuOpened = false;
        const moreButton = {
            click: jest.fn(() => {
                nativeMenuOpened = true;
            })
        };
        const sourceTitle = sourceOverrides.title || '';
        const titleEl = sourceTitle ? { textContent: sourceTitle } : null;
        const checkbox = {
            getAttribute: jest.fn(() => null)
        };
        const sourceElement = {
            textContent: sourceTitle,
            getAttribute: jest.fn(() => null),
            querySelector: jest.fn(sel => {
                if (mod.DEPS.moreBtn.includes(sel)) return moreButton;
                if (mod.DEPS.title.includes(sel)) return titleEl;
                if (mod.DEPS.checkbox.includes(sel)) return checkbox;
                return null;
            }),
            querySelectorAll: jest.fn(() => [])
        };
        mod.sourcesByKey.set(key, {
            key,
            element: sourceElement,
            isDisabled: false,
            isLoading: false,
            ...sourceOverrides
        });

        return {
            moreButton,
            isNativeMenuOpened: () => nativeMenuOpened
        };
    };

    it('deletes through the native menu and confirmation dialog', async () => {
        const { moreButton, isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = createConfirmDialog([confirmButton]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(moreButton.click).toHaveBeenCalled();
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('allows failed sources to be deleted through the native menu', async () => {
        const { moreButton, isNativeMenuOpened } = seedSourceWithMoreButton('failed-source', {
            isDisabled: true,
            isFailed: true,
            title: 'Failed Source'
        });
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = createConfirmDialog([confirmButton]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('failed-source')).resolves.toEqual({ deleted: true });
        expect(moreButton.click).toHaveBeenCalled();
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('recognizes a Spanish native delete confirmation dialog', async () => {
        const { moreButton, isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            textContent: 'Eliminar fuente',
            iconText: '',
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Eliminar',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = {
            textContent: '¿Eliminar esta fuente?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(moreButton.click).toHaveBeenCalled();
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('treats a closed delete dialog as accepted even when NotebookLM keeps the source row until refresh', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        const sourceRow = mod.sourcesByKey.get('key1').element;
        let dialogOpen = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                dialogOpen = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'mat-mdc-button-primary',
            click: jest.fn(() => {
                dialogOpen = false;
            }),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = createConfirmDialog([confirmButton]);

        global.document.body.contains = jest.fn(() => true);
        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) return [sourceRow];
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return dialogOpen ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('treats a closed delete dialog as accepted when the row stays but native actions disappear', async () => {
        let nativeMenuOpened = false;
        let dialogOpen = false;
        let deletionAccepted = false;
        const moreButton = {
            click: jest.fn(() => {
                nativeMenuOpened = true;
            })
        };
        const sourceRow = {
            querySelector: jest.fn((sel) => {
                if (!deletionAccepted && mod.DEPS.moreBtn.includes(sel)) return moreButton;
                return null;
            }),
            querySelectorAll: jest.fn(() => [])
        };
        mod.sourcesByKey.set('key1', {
            key: 'key1',
            element: sourceRow,
            isDisabled: false,
            isLoading: false
        });

        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                dialogOpen = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'mat-mdc-button-primary',
            click: jest.fn(() => {
                deletionAccepted = true;
                dialogOpen = false;
            }),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = createConfirmDialog([confirmButton]);

        global.document.body.contains = jest.fn(() => true);
        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) return [sourceRow];
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return dialogOpen ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('finds the native more button on a fresh row even when the checkbox selector no longer matches', async () => {
        let nativeMenuOpened = false;
        let deleteClicked = false;
        const moreButton = {
            click: jest.fn(() => {
                nativeMenuOpened = true;
            })
        };
        const freshRow = createMockSourceRow({
            title: 'Fresh Source',
            stableToken: 'fresh-doc',
            hasCheckbox: false,
            nativeMoreButton: moreButton
        });
        const descriptor = mod.createSourceDescriptor(freshRow.row, new Map(), new Map());
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = createConfirmDialog([confirmButton]);

        mod.sourcesByKey.set('key1', {
            key: 'key1',
            title: 'Fresh Source',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: { querySelector: jest.fn(() => null) },
            isDisabled: false,
            isLoading: false
        });
        global.document.body.contains = jest.fn(() => false);
        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) return [freshRow.row];
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(moreButton.click).toHaveBeenCalled();
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('finds localized native more buttons by aria label and icon when exact selectors miss', async () => {
        let nativeMenuOpened = false;
        let deleteClicked = false;
        const moreButton = {
            tagName: 'BUTTON',
            className: 'mat-mdc-icon-button',
            textContent: '',
            click: jest.fn(() => {
                nativeMenuOpened = true;
            }),
            getAttribute: jest.fn((name) => {
                if (name === 'aria-label') return '更多选项';
                if (name === 'aria-haspopup') return 'menu';
                return null;
            }),
            querySelector: jest.fn((selector) => (
                selector === 'mat-icon, .google-symbols' ? { textContent: 'more_vert' } : null
            ))
        };
        const sourceRow = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn((selector) => (selector === 'button' ? [moreButton] : []))
        };
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: '删除',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialog = {
            textContent: '删除此来源？',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        mod.sourcesByKey.set('key1', {
            key: 'key1',
            element: sourceRow,
            isDisabled: false,
            isLoading: false
        });
        global.document.body.contains = jest.fn(() => true);
        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(moreButton.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('returns a safe reason when the native more button is missing', async () => {
        mod.sourcesByKey.set('key1', {
            key: 'key1',
            element: { querySelector: jest.fn(() => null) },
            isDisabled: false
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'menu_button_missing'
        });
    });

    it('refuses to delete when the current native row no longer matches the source identity', async () => {
        const wrongMoreButton = { click: jest.fn() };
        const wrongRow = createMockSourceRow({
            title: 'Wrong Source',
            stableToken: 'wrong-doc',
            nativeMoreButton: wrongMoreButton
        });

        mod.sourcesByKey.set('key1', {
            key: 'key1',
            title: 'Expected Source',
            normalizedTitle: 'expected source',
            stableToken: 'expected-doc',
            fingerprint: 'expected source||article',
            element: wrongRow.row,
            isDisabled: false,
            isLoading: false
        });
        global.document.body.contains = jest.fn((element) => element === wrongRow.row);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [wrongRow.row] : []
        ));

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'source_row_mismatch'
        });
        expect(wrongMoreButton.click).not.toHaveBeenCalled();
    });

    it('refuses to rename when the current native row no longer matches the source identity', async () => {
        const wrongMoreButton = { click: jest.fn() };
        const wrongRow = createMockSourceRow({
            title: 'Wrong Rename Source',
            stableToken: 'wrong-rename-doc',
            nativeMoreButton: wrongMoreButton
        });

        mod.sourcesByKey.set('key1', {
            key: 'key1',
            title: 'Expected Rename Source',
            normalizedTitle: 'expected rename source',
            stableToken: 'expected-rename-doc',
            fingerprint: 'expected rename source||article',
            element: wrongRow.row,
            isDisabled: false,
            isLoading: false
        });
        global.document.body.contains = jest.fn((element) => element === wrongRow.row);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [wrongRow.row] : []
        ));

        await expect(mod.triggerNativeSourceRenameWithResult('key1')).resolves.toEqual({
            ok: false,
            reason: 'source_row_mismatch'
        });
        expect(wrongMoreButton.click).not.toHaveBeenCalled();
    });

    it('closes native UI when the delete menu item is missing', async () => {
        const { moreButton } = seedSourceWithMoreButton();
        global.document.querySelectorAll = jest.fn(() => []);

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'delete_menu_missing'
        });
        expect(moreButton.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('closes native UI when the confirm button is missing', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const dialog = createConfirmDialog([]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'confirm_button_missing'
        });
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('uses the fresh delete dialog instead of an existing stale dialog', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const staleConfirmButton = {
            textContent: 'OK',
            className: 'primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const freshConfirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const staleDialog = {
            textContent: 'Unrelated settings',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [staleConfirmButton] : []))
        };
        const freshDialog = createConfirmDialog([freshConfirmButton]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [staleDialog, freshDialog] : [staleDialog];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(staleConfirmButton.click).not.toHaveBeenCalled();
        expect(freshConfirmButton.click).toHaveBeenCalled();
    });

    it('uses a reused native delete dialog after it becomes visible', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let dialogVisible = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                dialogVisible = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(() => {
                dialogVisible = false;
            }),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const reusedDialog = createConfirmDialog([confirmButton]);
        reusedDialog.getAttribute = jest.fn((name) => {
            if (name === 'aria-hidden') return dialogVisible ? 'false' : 'true';
            return null;
        });

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return [reusedDialog];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('uses a reused native delete dialog when its content changes after opening', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let dialogMode = 'idle';
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                dialogMode = 'delete';
            }
        });
        const idleButton = {
            textContent: 'OK',
            className: 'primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const confirmButton = {
            textContent: '删除',
            className: 'mat-mdc-button-primary',
            click: jest.fn(() => {
                dialogMode = 'idle';
            }),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const reusedDialog = {
            get textContent() {
                return dialogMode === 'delete'
                    ? '要删除“mid-sem-2024-S1.pdf”吗？此来源将从您的笔记本中永久移除，并且将无法恢复。'
                    : 'NotebookLM background status';
            },
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button'
                ? (dialogMode === 'delete' ? [confirmButton] : [idleButton])
                : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return [reusedDialog];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(idleButton.click).not.toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('finds native delete confirmation dialogs rendered as HTML dialog elements', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: '删除',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const htmlDialog = {
            textContent: '要删除“mid-sem-2024-S1.pdf”吗？此来源将从您的笔记本中永久移除，并且将无法恢复。',
            getAttribute: jest.fn((name) => (name === 'aria-modal' ? 'true' : null)),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            const selectors = String(sel || '').split(',').map((selector) => selector.trim());
            if (selectors.includes('dialog') || selectors.includes('[aria-modal="true"]')) {
                return deleteClicked ? [htmlDialog] : [];
            }
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('finds native delete confirmation dialogs rendered inside Material CDK overlay surfaces', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: '删除',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const dialogText = '要删除“L07B-exceptions(1).pdf”吗？此来源将从您的笔记本中永久移除，并且将无法恢复。';
        const dialogSurface = {
            textContent: dialogText,
            className: 'mat-mdc-dialog-surface',
            parentElement: null,
            contains: jest.fn(() => false),
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };
        const overlayPane = {
            textContent: dialogText,
            className: 'cdk-overlay-pane',
            parentElement: null,
            contains: jest.fn((element) => element === dialogSurface),
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };
        dialogSurface.parentElement = overlayPane;

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('.cdk-overlay-pane') || sel.includes('.mat-mdc-dialog-surface')) {
                return deleteClicked ? [overlayPane, dialogSurface] : [];
            }
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('uses role button controls in native delete confirmation dialogs', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmRoleButton = {
            textContent: '删除',
            className: 'mat-mdc-button-primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn((name) => (name === 'role' ? 'button' : null))
        };
        const dialog = {
            textContent: '要删除“L07B-exceptions(1).pdf”吗？此来源将从您的笔记本中永久移除，并且将无法恢复。',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === '[role="button"]' ? [confirmRoleButton] : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [dialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({ deleted: true });
        expect(confirmRoleButton.click).toHaveBeenCalled();
    });

    it('does not confirm when multiple fresh delete dialogs are plausible', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const firstConfirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const secondConfirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const firstDialog = createConfirmDialog([firstConfirmButton]);
        const secondDialog = createConfirmDialog([secondConfirmButton]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [firstDialog, secondDialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'confirm_dialog_ambiguous'
        });
        expect(firstConfirmButton.click).not.toHaveBeenCalled();
        expect(secondConfirmButton.click).not.toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('does not confirm a delete dialog that names a different source', async () => {
        let nativeMenuOpened = false;
        const moreButton = {
            click: jest.fn(() => {
                nativeMenuOpened = true;
            })
        };
        const row = createMockSourceRow({
            title: 'Target Source',
            stableToken: 'target-doc',
            nativeMoreButton: moreButton
        });
        const descriptor = mod.createSourceDescriptor(row.row, new Map(), new Map());
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const wrongDialog = {
            textContent: 'Delete Other Source?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        mod.sourcesByKey.set('key1', {
            key: 'key1',
            title: 'Target Source',
            normalizedTitle: 'target source',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: row.row,
            isDisabled: false,
            isLoading: false
        });
        mod.sourcesByKey.set('other-key', {
            key: 'other-key',
            title: 'Other Source',
            normalizedTitle: 'other source',
            fingerprint: 'other source||article',
            isDisabled: false,
            isLoading: false
        });
        global.document.body.contains = jest.fn((element) => element === row.row);
        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) return [row.row];
            if (sel.includes('[role="menuitem"]')) return nativeMenuOpened && !deleteClicked ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [wrongDialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'confirm_dialog_mismatched_source'
        });
        expect(confirmButton.click).not.toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('does not use a stale dialog when no fresh confirmation appears', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        const deleteMenuItem = createDeleteMenuItem();
        const staleConfirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const staleDialog = createConfirmDialog([staleConfirmButton]);

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return [staleDialog];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'confirm_dialog_missing'
        });
        expect(staleConfirmButton.click).not.toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('does not confirm a fresh dialog without delete semantics', async () => {
        const { isNativeMenuOpened } = seedSourceWithMoreButton();
        let deleteClicked = false;
        const deleteMenuItem = createDeleteMenuItem({
            onClick: () => {
                deleteClicked = true;
            }
        });
        const confirmButton = {
            textContent: 'Confirm',
            className: 'primary',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const unrelatedDialog = {
            textContent: 'Apply changes?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(sel => (sel === 'button' ? [confirmButton] : []))
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (sel.includes('[role="menuitem"]')) return isNativeMenuOpened() ? [deleteMenuItem] : [];
            if (sel.includes('dialog')) return deleteClicked ? [unrelatedDialog] : [];
            return [];
        });

        await expect(mod.deleteNativeSource('key1')).resolves.toEqual({
            deleted: false,
            reason: 'confirm_dialog_unmatched'
        });
        expect(confirmButton.click).not.toHaveBeenCalled();
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('skips disabled and loading sources before touching the DOM', async () => {
        mod.sourcesByKey.set('disabled', { key: 'disabled', isDisabled: true });
        mod.sourcesByKey.set('loading', { key: 'loading', isLoading: true });

        await expect(mod.deleteNativeSource('disabled')).resolves.toEqual({
            deleted: false,
            reason: 'source_unavailable'
        });
        await expect(mod.deleteNativeSource('loading')).resolves.toEqual({
            deleted: false,
            reason: 'source_unavailable'
        });
        expect(global.document.querySelectorAll).not.toHaveBeenCalled();
    });
});

describe('source action menu', () => {
    let mod;

    const createNativeMenuItem = ({
        text = '',
        icon = '',
        ariaLabel = '',
        testId = ''
    } = {}) => ({
        textContent: text,
        querySelector: jest.fn((selector) => (
            selector === 'mat-icon, .google-symbols' || selector === 'mat-icon'
                ? (icon ? { textContent: icon } : null)
                : null
        )),
        getAttribute: jest.fn((name) => {
            if (name === 'aria-label') return ariaLabel;
            if (name === 'data-testid') return testId;
            return null;
        })
    });

    const createKeyboardMenu = (actions, className = 'sp-source-actions-menu') => {
        const menu = {
            className,
            dataset: { menuKind: className.includes('submenu') ? 'submenu' : 'main' },
            classList: {
                contains: jest.fn((value) => className.split(/\s+/).includes(value))
            },
            querySelectorAll: jest.fn((selector) => (
                selector === '.sp-source-actions-menu-item' ? menu.items : []
            ))
        };
        menu.items = actions.map((action) => ({
            dataset: { sourceKey: 'source-1', action },
            className: 'sp-source-actions-menu-item',
            classList: {
                contains: jest.fn((value) => value === 'sp-source-actions-menu-item')
            },
            disabled: false,
            focus: jest.fn(),
            closest: jest.fn((selector) => (
                selector === '.sp-source-actions-menu' ? menu : null
            ))
        }));
        return menu;
    };

    const createKeyboardEvent = (key, target) => ({
        key,
        target,
        preventDefault: jest.fn()
    });

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('opens and closes the active source action menu from the single action button state', () => {
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        expect(mod.toggleSourceActionMenu('source-1')).toBe('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBe('source-1');

        expect(mod.toggleSourceActionMenu('source-1')).toBeNull();
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
    });

    it('routes tags and move actions through the new unified menu and closes the menu afterwards', () => {
        const openTags = jest.fn();
        const moveToFolder = jest.fn();
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setSourceActionInvokerForTest('openTags', openTags);
        mod._setSourceActionInvokerForTest('moveToFolder', moveToFolder);

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'tags')).toBe(true);
        expect(openTags).toHaveBeenCalledWith('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'move')).toBe(true);
        expect(moveToFolder).toHaveBeenCalledWith('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
    });

    it('deletes a source from the flattened action menu', () => {
        const deleteSource = jest.fn(() => true);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setSourceActionInvokerForTest('deleteSource', deleteSource);

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'delete-source')).toBe(true);
        expect(deleteSource).toHaveBeenCalledWith('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
    });

    it('renames a source from the flattened action menu', () => {
        const renameSource = jest.fn(() => true);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setSourceActionInvokerForTest('renameSource', renameSource);

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'rename-source')).toBe(true);
        expect(renameSource).toHaveBeenCalledWith('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
    });

    it('opens the native source details view directly from the flattened action menu', () => {
        const openNativeDetails = jest.fn(() => true);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setSourceActionInvokerForTest('openNativeDetails', openNativeDetails);

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'view-source-details')).toBe(true);
        expect(openNativeDetails).toHaveBeenCalledWith('source-1');
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
        expect(mod._getActiveSourceActionSubmenuAction()).toBeNull();
    });

    it('exposes the source action menu items in the expected order', () => {
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        expect(mod._getSourceActionMenuItemsForTest('source-1').map((item) => item.action)).toEqual([
            'view-source-details',
            'rename-source',
            'tags',
            'move',
            'move-ungrouped',
            'delete-source'
        ]);
        expect(mod._getSourceActionMenuItemsForTest('source-1').every((item) => item.kind === 'action')).toBe(true);
        expect(mod._getSourceActionSubmenuItemsForTest('source-1', 'view-source-details')).toEqual([]);
    });

    it('shows only the delete failed source action for failed sources', () => {
        const deleteSource = jest.fn(() => true);
        const renameSource = jest.fn(() => true);
        mod.sourcesByKey.set('failed-source', {
            key: 'failed-source',
            title: 'Failed Source',
            enabled: false,
            isLoading: false,
            isDisabled: true,
            isFailed: true
        });
        mod._setSourceActionInvokerForTest('deleteSource', deleteSource);
        mod._setSourceActionInvokerForTest('renameSource', renameSource);

        const menuItems = mod._getSourceActionMenuItemsForTest('failed-source');
        expect(menuItems).toHaveLength(1);
        expect(menuItems[0]).toEqual(expect.objectContaining({
            action: 'delete-source',
            kind: 'action',
            icon: 'delete',
            label: 'ui_delete_failed_source'
        }));

        expect(mod.toggleSourceActionMenu('failed-source')).toBe('failed-source');
        expect(mod.handleSourceActionSelection('failed-source', 'rename-source')).toBe(false);
        expect(renameSource).not.toHaveBeenCalled();

        mod._setActiveSourceActionSourceKey('failed-source');
        expect(mod.handleSourceActionSelection('failed-source', 'delete-source')).toBe(true);
        expect(deleteSource).toHaveBeenCalledWith('failed-source');
    });

    it('moves keyboard focus inside the source action menu', () => {
        const menu = createKeyboardMenu(['view-source-details', 'rename-source', 'tags', 'move', 'move-ungrouped', 'delete-source']);

        const downEvent = createKeyboardEvent('ArrowDown', menu.items[0]);
        expect(mod._handleSourceActionMenuKeydownForTest(downEvent)).toBe(true);
        expect(downEvent.preventDefault).toHaveBeenCalledTimes(1);
        expect(menu.items[1].focus).toHaveBeenCalledTimes(1);

        const upEvent = createKeyboardEvent('ArrowUp', menu.items[0]);
        expect(mod._handleSourceActionMenuKeydownForTest(upEvent)).toBe(true);
        expect(menu.items[5].focus).toHaveBeenCalledTimes(1);

        const endEvent = createKeyboardEvent('End', menu.items[0]);
        expect(mod._handleSourceActionMenuKeydownForTest(endEvent)).toBe(true);
        expect(menu.items[5].focus).toHaveBeenCalledTimes(2);

        const homeEvent = createKeyboardEvent('Home', menu.items[5]);
        expect(mod._handleSourceActionMenuKeydownForTest(homeEvent)).toBe(true);
        expect(menu.items[0].focus).toHaveBeenCalledTimes(1);
    });

    it('closes the source action menu on Escape and restores focus to the source action button', () => {
        const menu = createKeyboardMenu(['view-source-details', 'tags']);
        const actionButton = {
            dataset: { sourceKey: 'source-1' },
            focus: jest.fn()
        };
        const layer = {
            childNodes: [],
            appendChild: jest.fn(function appendChild(node) {
                this.childNodes.push(node);
                return node;
            }),
            removeChild: jest.fn(function removeChild(node) {
                this.childNodes = this.childNodes.filter((child) => child !== node);
                return node;
            }),
            querySelectorAll: jest.fn(() => [])
        };
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setActiveSourceActionSourceKey('source-1');
        mod._setShadowRootForTest({
            host: { isConnected: true },
            getElementById: jest.fn((id) => (id === 'sp-source-actions-layer' ? layer : null)),
            querySelectorAll: jest.fn((selector) => (
                selector === '.sp-source-actions-button' ? [actionButton] : []
            ))
        });

        const event = createKeyboardEvent('Escape', menu.items[0]);
        expect(mod._handleSourceActionMenuKeydownForTest(event)).toBe(true);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
        expect(actionButton.focus).toHaveBeenCalledTimes(1);
    });

    it('does not open a source action submenu because source actions are flattened', () => {
        const mainMenu = createKeyboardMenu(['view-source-details', 'tags']);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setActiveSourceActionSourceKey('source-1');

        const rightEvent = createKeyboardEvent('ArrowRight', mainMenu.items[0]);
        expect(mod._handleSourceActionMenuKeydownForTest(rightEvent)).toBe(false);
        expect(rightEvent.preventDefault).not.toHaveBeenCalled();
        expect(mod._getActiveSourceActionSubmenuAction()).toBeNull();
    });

    it('matches native delete menu items through the unified action scorer', () => {
        const iconItem = createNativeMenuItem({ icon: 'delete' });
        const ariaItem = createNativeMenuItem({ ariaLabel: 'Remove source' });
        const testIdItem = createNativeMenuItem({ testId: 'source-delete-action' });
        const textItem = createNativeMenuItem({ text: '移除' });

        [iconItem, ariaItem, testIdItem, textItem].forEach((item) => {
            expect(mod.findNativeActionMenuItem([item], 'delete')).toBe(item);
            expect(mod.findNativeDeleteMenuItem([item])).toBe(item);
            expect(mod.scoreNativeMenuItemAction('delete', item)).toBeGreaterThan(0);
        });
    });

    it('matches native rename menu items through the unified action scorer', () => {
        const iconItem = createNativeMenuItem({ icon: 'edit' });
        const ariaItem = createNativeMenuItem({ ariaLabel: 'Rename source' });
        const testIdItem = createNativeMenuItem({ testId: 'source-rename-action' });
        const textItem = createNativeMenuItem({ text: '重命名来源' });

        [iconItem, ariaItem, testIdItem, textItem].forEach((item) => {
            expect(mod.findNativeActionMenuItem([item], 'rename')).toBe(item);
            expect(mod.findNativeRenameMenuItem([item])).toBe(item);
            expect(mod.scoreNativeMenuItemAction('rename', item)).toBeGreaterThan(0);
        });
    });

    it('keeps source-details matching away from destructive native menu items', () => {
        const deleteItem = createNativeMenuItem({ text: 'Delete source', icon: 'delete' });
        const renameItem = createNativeMenuItem({ text: 'Rename source' });
        const downloadItem = createNativeMenuItem({ text: 'Download' });
        const shareItem = createNativeMenuItem({ text: 'Share' });
        const detailsItem = createNativeMenuItem({ text: 'Source details', icon: 'description' });

        [deleteItem, renameItem, downloadItem, shareItem].forEach((item) => {
            expect(mod.scoreNativeMenuItemAction('source-details', item)).toBe(Number.NEGATIVE_INFINITY);
        });
        expect(mod.findNativeSourceDetailsMenuItem([
            deleteItem,
            renameItem,
            downloadItem,
            shareItem,
            detailsItem
        ])).toBe(detailsItem);
    });

    it('keeps the single safe source-details fallback', () => {
        const onlyItem = createNativeMenuItem({ text: 'Open' });

        expect(mod.scoreNativeMenuItemAction('source-details', onlyItem)).toBeGreaterThanOrEqual(0);
        expect(mod.findNativeSourceDetailsMenuItem([onlyItem])).toBe(onlyItem);
    });

    it('chooses the highest scoring source-details menu item', () => {
        const weakItem = createNativeMenuItem({ text: 'Open' });
        const mediumItem = createNativeMenuItem({ text: 'View source' });
        const strongItem = createNativeMenuItem({ text: 'View source details', icon: 'description' });

        expect(mod.findNativeActionMenuItem([
            weakItem,
            strongItem,
            mediumItem
        ], 'source-details')).toBe(strongItem);
    });

    it('opens the native rename source action without exposing the native menu as a second menu', async () => {
        let nativeMenuOpened = false;
        const mockMoreBtn = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const mockSourceRow = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc',
            nativeMoreButton: mockMoreBtn
        });
        const descriptor = mod.createSourceDescriptor(mockSourceRow.row, new Map(), new Map());
        const renameMenuItem = createNativeMenuItem({ text: 'Rename source', icon: 'edit' });
        renameMenuItem.click = jest.fn();
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: mockSourceRow.row,
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        global.document.querySelectorAll = jest.fn((selector) => (
            selector.includes('[role="menuitem"]') && nativeMenuOpened ? [renameMenuItem] : []
        ));

        await expect(mod._triggerNativeSourceRenameForTest('source-1')).resolves.toBe(true);
        expect(mockMoreBtn.click).toHaveBeenCalledTimes(1);
        expect(renameMenuItem.click).toHaveBeenCalledTimes(1);
        expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 250);
    });

    it('shows a localized toast when source details cannot be opened', () => {
        const createdToastNodes = [];
        global.chrome.i18n.getMessage = jest.fn((key) => {
            if (key === 'ui_source_details_failed') return 'Localized source details failed';
            if (key === 'ui_retry') return 'Retry';
            if (key === 'ui_native_action_failed') return 'NotebookLM changed';
            return key;
        });

        const shadowRoot = {
            host: { isConnected: true },
            querySelector: jest.fn(() => null),
            appendChild: jest.fn((node) => {
                createdToastNodes.push(node);
                return node;
            })
        };

        mod._setShadowRootForTest(shadowRoot);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });
        mod._setSourceActionInvokerForTest('openNativeDetails', jest.fn(() => false));

        mod._setActiveSourceActionSourceKey('source-1');
        expect(mod.handleSourceActionSelection('source-1', 'view-source-details')).toBe(false);
        expect(createdToastNodes).toHaveLength(1);
        expect(createdToastNodes[0].className).toContain('sp-toast-error');
        expect(createdToastNodes[0].childNodes[0].textContent).toBe('Localized source details failed NotebookLM changed');
        expect(createdToastNodes[0].childNodes[1].textContent).toBe('Retry');
        expect(mod.getDiagnosticsInfo().lastNativeActionFailure).toMatchObject({
            action: 'details',
            sourceKey: 'source-1',
            reason: 'native_action_error',
            retryable: true
        });
        expect(mod.getDiagnosticsInfo().nativeActionFailureHistory).toHaveLength(1);
    });

    it('keeps only the five most recent native action failures in diagnostics', () => {
        mod._setSourceActionInvokerForTest('openNativeDetails', jest.fn(() => false));

        for (let index = 1; index <= 6; index++) {
            const sourceKey = `source-${index}`;
            mod.sourcesByKey.set(sourceKey, {
                key: sourceKey,
                title: `Source ${index}`,
                enabled: true,
                isLoading: false,
                isDisabled: false
            });
            mod._setActiveSourceActionSourceKey(sourceKey);
            expect(mod.handleSourceActionSelection(sourceKey, 'view-source-details')).toBe(false);
        }

        const diagnostics = mod.getDiagnosticsInfo();
        expect(diagnostics.nativeActionFailureHistory).toHaveLength(5);
        expect(diagnostics.nativeActionFailureHistory[0]).toMatchObject({
            action: 'details',
            sourceKey: 'source-6',
            reason: 'native_action_error',
            retryable: true
        });
        expect(diagnostics.nativeActionFailureHistory.map((failure) => failure.sourceKey)).not.toContain('source-1');
    });

    it('retries opening source details from the failure toast action', async () => {
        global.chrome.i18n.getMessage = jest.fn((key) => {
            if (key === 'ui_source_details_failed') return 'Details failed';
            if (key === 'ui_native_action_source_unavailable') return 'Source unavailable';
            if (key === 'ui_retry') return 'Retry';
            return key;
        });
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        mod.openNativeSourceDetails('source-1');
        await Promise.resolve();

        const toastItem = mod._getActiveToastItemForTest();
        expect(toastItem.message).toBe('Details failed Source unavailable');
        expect(toastItem.actionLabel).toBe('Retry');

        const row = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getAttribute: jest.fn(() => null),
            click: jest.fn()
        };
        mod.sourcesByKey.get('source-1').element = row;
        toastItem.onAction();
        await Promise.resolve();
        await Promise.resolve();

        expect(row.click).toHaveBeenCalled();
    });

    it('retries native rename from the failure toast action', async () => {
        global.chrome.i18n.getMessage = jest.fn((key) => {
            if (key === 'ui_rename_source_failed') return 'Rename failed';
            if (key === 'ui_native_action_menu_button_missing') return 'Menu missing';
            if (key === 'ui_retry') return 'Retry';
            return key;
        });
        const sourceElement = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc'
        });
        const descriptor = mod.createSourceDescriptor(sourceElement.row, new Map(), new Map());
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: sourceElement.row,
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        mod.handleSourceActionSelection('source-1', 'rename-source');
        await Promise.resolve();

        const toastItem = mod._getActiveToastItemForTest();
        expect(toastItem.message).toBe('Rename failed Menu missing');
        expect(toastItem.actionLabel).toBe('Retry');

        let nativeMenuOpened = false;
        const moreButton = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const renameMenuItem = createNativeMenuItem({ text: 'Rename source', icon: 'edit' });
        renameMenuItem.click = jest.fn();
        const retrySourceElement = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc',
            nativeMoreButton: moreButton
        });
        mod.sourcesByKey.get('source-1').element = retrySourceElement.row;
        global.document.querySelectorAll = jest.fn((selector) => (
            selector.includes('[role="menuitem"]') && nativeMenuOpened ? [renameMenuItem] : []
        ));

        toastItem.onAction();
        await Promise.resolve();
        await Promise.resolve();

        expect(moreButton.click).toHaveBeenCalled();
        expect(renameMenuItem.click).toHaveBeenCalled();
    });

    it('retries native delete through the native confirmation flow', async () => {
        global.chrome.i18n.getMessage = jest.fn((key) => {
            if (key === 'ui_delete_source_failed') return 'Delete failed';
            if (key === 'ui_native_action_menu_button_missing') return 'Menu missing';
            if (key === 'ui_deleted_toast') return 'Deleted one';
            if (key === 'ui_retry') return 'Retry';
            return key;
        });
        const sourceElement = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc'
        });
        const descriptor = mod.createSourceDescriptor(sourceElement.row, new Map(), new Map());
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: sourceElement.row,
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        mod.handleSourceActionSelection('source-1', 'delete-source');
        await Promise.resolve();

        const toastItem = mod._getActiveToastItemForTest();
        expect(toastItem.message).toBe('Delete failed Menu missing');
        expect(toastItem.actionLabel).toBe('Retry');

        let nativeMenuOpened = false;
        let deleteClicked = false;
        const moreButton = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const deleteMenuItem = createNativeMenuItem({ text: 'Delete', icon: 'delete' });
        deleteMenuItem.click = jest.fn(() => { deleteClicked = true; });
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const confirmDialog = {
            textContent: 'Delete this source?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn((selector) => (selector === 'button' ? [confirmButton] : []))
        };
        const retrySourceElement = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc',
            nativeMoreButton: moreButton
        });
        mod.sourcesByKey.get('source-1').element = retrySourceElement.row;
        global.document.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (selector.includes('dialog')) return deleteClicked ? [confirmDialog] : [];
            return [];
        });
        global.setTimeout = (callback) => {
            callback();
            return 1;
        };

        toastItem.onAction();
        await Promise.resolve();
        await Promise.resolve();

        expect(moreButton.click).toHaveBeenCalled();
        expect(deleteMenuItem.click).toHaveBeenCalled();
        expect(confirmButton.click).toHaveBeenCalled();
    });

    it('optimistically removes an accepted native delete from the manager state', async () => {
        global.chrome.i18n.getMessage = jest.fn((key, substitutions) => {
            if (key === 'ui_deleted_toast') return `Deleted ${substitutions[0]}`;
            return key;
        });
        let nativeMenuOpened = false;
        let deleteClicked = false;
        let dialogOpen = false;
        const moreButton = { click: jest.fn(() => { nativeMenuOpened = true; }) };
        const sourceElement = createMockSourceRow({
            title: 'Source One',
            stableToken: 'source-one-doc',
            nativeMoreButton: moreButton
        });
        const descriptor = mod.createSourceDescriptor(sourceElement.row, new Map(), new Map());
        mod.state.ungrouped = ['source-1'];
        mod.sourceTagsById.set('source-1', ['tag-1']);
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: descriptor.stableToken,
            fingerprint: descriptor.fingerprint,
            element: sourceElement.row,
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        const deleteMenuItem = createNativeMenuItem({ text: 'Delete', icon: 'delete' });
        deleteMenuItem.click = jest.fn(() => {
            deleteClicked = true;
            dialogOpen = true;
        });
        const confirmButton = {
            textContent: 'Delete',
            className: 'warn',
            click: jest.fn(() => {
                dialogOpen = false;
            }),
            querySelector: jest.fn(() => null),
            getAttribute: jest.fn(() => null)
        };
        const confirmDialog = {
            textContent: 'Delete this source?',
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn((selector) => (selector === 'button' ? [confirmButton] : []))
        };

        global.document.querySelectorAll = jest.fn((selector) => {
            if (mod.DEPS.row.includes(selector)) return [sourceElement.row];
            if (selector.includes('[role="menuitem"]')) return nativeMenuOpened ? [deleteMenuItem] : [];
            if (selector.includes('dialog')) return deleteClicked && dialogOpen ? [confirmDialog] : [];
            return [];
        });
        global.setTimeout = (callback) => {
            callback();
            return 1;
        };

        expect(mod.handleSourceActionSelection('source-1', 'delete-source')).toBe(true);
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }

        expect(confirmButton.click).toHaveBeenCalled();
        expect(mod.sourcesByKey.has('source-1')).toBe(false);
        expect(mod.sourceTagsById.has('source-1')).toBe(false);
        expect(mod.state.ungrouped).toEqual([]);

        mod.scanAndSyncSources(null, false);
        expect(mod.sourcesByKey.has('source-1')).toBe(false);
        expect(mod.state.ungrouped).toEqual([]);
    });

    it('closes the action menu on outside clicks without breaking search-rail clicks', () => {
        const { shadowRoot } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);
        mod._setActiveSourceActionSourceKey('source-1');
        mod._setIsSearchExpanded(true);

        expect(mod._handleSearchOutsideClick({
            target: {
                closest: jest.fn((selector) => (selector === '.sp-search-cluster' ? {} : null))
            }
        })).toBe(true);
        expect(mod._getActiveSourceActionSourceKey()).toBeNull();
        expect(mod._getIsSearchExpanded()).toBe(true);
    });

    it('does not toggle the source checkbox when clicking the new action button or menu item', () => {
        const source = {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        };
        const openTags = jest.fn();
        const checkbox = { checked: true };
        const sourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn(() => checkbox)
        };

        mod.sourcesByKey.set('source-1', source);
        mod._setSourceActionInvokerForTest('openTags', openTags);

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.sp-source-actions-button') {
                        return { dataset: { sourceKey: 'source-1' } };
                    }
                    return null;
                })
            }
        });

        expect(source.enabled).toBe(true);
        expect(mod._getActiveSourceActionSourceKey()).toBe('source-1');
        expect(sourceRow.querySelector).not.toHaveBeenCalled();

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.sp-source-actions-menu-item') {
                        return { dataset: { sourceKey: 'source-1', action: 'tags' } };
                    }
                    return null;
                })
            }
        });

        expect(source.enabled).toBe(true);
        expect(openTags).toHaveBeenCalledWith('source-1');
        expect(sourceRow.querySelector).not.toHaveBeenCalled();
    });

    it('does not toggle the source checkbox when clicking the new source-details submenu item', () => {
        const openNativeDetails = jest.fn(() => true);
        const source = {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        };
        const checkbox = { checked: true };
        const sourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn(() => checkbox)
        };

        mod.sourcesByKey.set('source-1', source);
        mod._setSourceActionInvokerForTest('openNativeDetails', openNativeDetails);

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.sp-source-actions-menu-item') {
                        return { dataset: { sourceKey: 'source-1', action: 'view-source-details' } };
                    }
                    return null;
                })
            }
        });

        expect(source.enabled).toBe(true);
        expect(openNativeDetails).toHaveBeenCalledWith('source-1');
        expect(sourceRow.querySelector).not.toHaveBeenCalled();
    });

    it('selects a batch checkbox without changing the source enabled state', () => {
        mod._setProjectId('project-batch-checkbox');
        mod.state.isBatchMode = true;
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            enabled: true,
            isLoading: false,
            isDisabled: false
        });

        const sourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn(() => ({ checked: true }))
        };
        const batchCheckbox = {
            checked: true,
            dataset: { sourceKey: 'source-1' }
        };

        mod._handleInteractionForTest({
            target: {
                checked: true,
                dataset: { sourceKey: 'source-1' },
                classList: {
                    contains: jest.fn((className) => className === 'sp-checkbox')
                },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.sp-batch-checkbox') return batchCheckbox;
                    return null;
                })
            }
        });

        expect(mod.pendingBatchKeys.has('source-1')).toBe(true);
        expect(mod.sourcesByKey.get('source-1').enabled).toBe(true);
        expect(sourceRow.querySelector).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

        batchCheckbox.checked = false;
        mod.pendingBatchKeys.add('source-1');

        mod._handleInteractionForTest({
            target: {
                checked: false,
                dataset: { sourceKey: 'source-1' },
                classList: {
                    contains: jest.fn((className) => className === 'sp-checkbox')
                },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.sp-batch-checkbox') return batchCheckbox;
                    return null;
                })
            }
        });

        expect(mod.pendingBatchKeys.has('source-1')).toBe(false);
        expect(mod.sourcesByKey.get('source-1').enabled).toBe(true);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('does not batch-select missing, failed, or loading sources from direct checkbox clicks', () => {
        mod.state.isBatchMode = true;
        mod.sourcesByKey.set('failed-source', {
            key: 'failed-source',
            title: 'Failed Source',
            enabled: true,
            isLoading: false,
            isDisabled: true
        });
        mod.sourcesByKey.set('loading-source', {
            key: 'loading-source',
            title: 'Loading Source',
            enabled: true,
            isLoading: true,
            isDisabled: false
        });

        const clickBatchCheckbox = (sourceKey) => {
            const batchCheckbox = {
                checked: true,
                dataset: { sourceKey }
            };
            mod._handleInteractionForTest({
                target: {
                    checked: true,
                    dataset: { sourceKey },
                    classList: {
                        contains: jest.fn((className) => className === 'sp-checkbox')
                    },
                    closest: jest.fn((selector) => {
                        if (selector === '.group-container') return null;
                        if (selector === '.source-item') {
                            return {
                                dataset: { sourceKey },
                                querySelector: jest.fn()
                            };
                        }
                        if (selector === '.sp-batch-checkbox') return batchCheckbox;
                        return null;
                    })
                }
            });
            return batchCheckbox;
        };

        expect(clickBatchCheckbox('missing-source').checked).toBe(false);
        expect(clickBatchCheckbox('failed-source').checked).toBe(false);
        expect(clickBatchCheckbox('loading-source').checked).toBe(false);
        expect(mod.pendingBatchKeys.has('missing-source')).toBe(false);
        expect(mod.pendingBatchKeys.has('failed-source')).toBe(false);
        expect(mod.pendingBatchKeys.has('loading-source')).toBe(false);
    });

    it('suspends the manager after opening native details from the source icon', async () => {
        const { panel: detailPanel } = createMockPanel({ visible: true, contentVisible: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const nativeTitleTarget = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'tabindex' ? '0' : null)),
            tagName: 'BUTTON',
            className: ''
        };
        const nativeSourceRow = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            querySelector: jest.fn((selector) => {
                if (mod.DEPS.title.includes(selector)) return nativeTitleTarget;
                return null;
            })
        };
        const virtualSourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn()
        };

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({
            extensionHost: detachHost,
            shadowRoot: detachShadowRoot
        });
        mod.state.ungrouped = ['source-1'];
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            normalizedTitle: 'source one',
            fingerprint: 'source one||article',
            enabled: true,
            isLoading: false,
            isDisabled: false,
            element: nativeSourceRow
        });
        global.document.querySelector = jest.fn(() => detailPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return virtualSourceRow;
                    if (selector === '.icon-container') return {};
                    return null;
                })
            }
        });

        await Promise.resolve();

        expect(nativeTitleTarget.click).toHaveBeenCalledTimes(1);
        expect(detachHost.remove).toHaveBeenCalledTimes(1);
        expect(mod._getPendingPanelReattachStateForTest()).toEqual(expect.objectContaining({
            ungrouped: ['source-1']
        }));
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith('sources-plus-manager-active');
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'source_detail_view'
        });
    });

    it('does not immediately reattach while NotebookLM is transitioning into native details', async () => {
        const { panel: listPanel, header } = createMockPanel({ visible: true, contentVisible: true });
        const nativeSource = createMockSourceRow({ title: 'Source One', stableToken: 'doc-1', checked: true });
        nativeSource.row.click = jest.fn();
        nativeSource.row.dispatchEvent = jest.fn();
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const virtualSourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn()
        };

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({
            extensionHost: detachHost,
            shadowRoot: detachShadowRoot
        });
        mod.state.ungrouped = ['source-1'];
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            normalizedTitle: 'source one',
            stableToken: 'doc-1',
            fingerprint: 'source one||article',
            identityType: 'stable-token',
            enabled: true,
            isLoading: false,
            isDisabled: false,
            element: nativeSource.row
        });
        global.document.querySelector = jest.fn(() => listPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [nativeSource.row] : []
        ));

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return virtualSourceRow;
                    if (selector === '.icon-container') return {};
                    return null;
                })
            }
        });

        await Promise.resolve();
        mod.syncManagerWithPanelLifecycle();

        expect(detachHost.remove).toHaveBeenCalledTimes(1);
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'source_detail_view'
        });
    });

    it('localizes the non-empty group delete confirmation message', () => {
        global.chrome.i18n.getMessage = jest.fn((key, substitutions) => {
            if (key === 'ui_ungrouped') return 'Ungrouped Localized';
            if (key === 'ui_delete_group_confirm_non_empty') {
                return `Folder ${substitutions[0]} -> ${substitutions[1]}`;
            }
            return key;
        });
        global.window.confirm = jest.fn(() => false);

        const groupContainer = {
            dataset: { groupId: 'group-1' }
        };

        mod.groupsById.set('group-1', {
            id: 'group-1',
            title: 'Archive',
            children: [{ type: 'source', key: 'source-1' }]
        });

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return groupContainer;
                    if (selector === '.sp-delete-button') return {};
                    return null;
                })
            }
        });

        expect(global.window.confirm).toHaveBeenCalledWith('Folder Archive -> Ungrouped Localized');
    });

    it('localizes the crash banner chrome', () => {
        const dismissButton = {
            addEventListener: jest.fn()
        };
        global.chrome.i18n.getMessage = jest.fn((key) => {
            if (key === 'ui_crash_banner_prefix') return 'Localized Error';
            if (key === 'ui_dismiss') return 'Localized Dismiss';
            return key;
        });
        global.el = createTreeEl;
        global.document.getElementById = jest.fn((id) => {
            if (id === 'sp-error-banner') return null;
            if (id === 'sp-dismiss-error') return dismissButton;
            return null;
        });

        mod._showCrashBannerForTest('Localized Body');

        const banner = global.document.body.prepend.mock.calls[0][0];
        expect(banner.children[0].children[0]).toBe('Localized Error ');
        expect(banner.children[1]).toBe('Localized Body ');
        expect(banner.children[2].children[0]).toBe('Localized Dismiss');
    });
});

describe('triggerNativeSourceDetails', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
        global.setTimeout = jest.fn((cb) => {
            if (typeof cb === 'function') cb();
            return 1;
        });
        global.clearTimeout = jest.fn();
    });

    afterEach(teardownGlobalMocks);

    it('clicks the matching native details menu item when it is available on the current row', async () => {
        const nativeMoreClick = jest.fn();
        const detailClick = jest.fn();
        const nativeMenuItem = {
            textContent: 'View source details',
            click: detailClick,
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'View source details' : null)),
            querySelector: jest.fn(() => ({ textContent: 'description' }))
        };
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: 'doc-1',
            element: {
                querySelector: jest.fn((selector) => (
                    mod.DEPS.moreBtn.includes(selector) ? { click: nativeMoreClick } : null
                ))
            }
        });
        let menuQueryCount = 0;
        global.document.querySelectorAll = jest.fn((selector) => {
            if (selector !== '.cdk-overlay-container [role="menuitem"]') return [];
            menuQueryCount += 1;
            return menuQueryCount === 1 ? [] : [nativeMenuItem];
        });

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest('source-1')).resolves.toBe(true);
        expect(nativeMoreClick).toHaveBeenCalledTimes(1);
        expect(detailClick).toHaveBeenCalledTimes(1);
    });

    it('falls back to a fresh row more button when the current row no longer has a usable one', async () => {
        const freshRow = createMockSourceRow({
            title: 'Source One',
            stableToken: 'doc-1',
            checked: true
        });
        const freshMoreButton = { click: jest.fn() };
        freshRow.row.querySelector = jest.fn((selector) => {
            if (mod.DEPS.title.includes(selector)) return freshRow.titleEl;
            if (mod.DEPS.checkbox.includes(selector)) return freshRow.checkbox;
            if (mod.DEPS.moreBtn.includes(selector)) return freshMoreButton;
            return null;
        });
        const detailClick = jest.fn();
        const descriptor = mod.createSourceDescriptor(freshRow.row, new Map(), new Map());

        mod.sourcesByKey.set(descriptor.key, {
            ...descriptor,
            element: {
                querySelector: jest.fn(() => null)
            }
        });

        let menuQueryCount = 0;
        global.document.querySelectorAll = jest.fn((selector) => {
            if (selector === '.cdk-overlay-container [role="menuitem"]') {
                menuQueryCount += 1;
                return menuQueryCount === 1
                    ? []
                    : [{
                        textContent: '来源详情',
                        click: detailClick,
                        getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '查看来源详情' : null)),
                        querySelector: jest.fn(() => ({ textContent: 'description' }))
                    }];
            }
            return mod.DEPS.row.includes(selector) ? [freshRow.row] : [];
        });

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest(descriptor.key)).resolves.toBe(true);
        expect(freshMoreButton.click).toHaveBeenCalledTimes(1);
        expect(detailClick).toHaveBeenCalledTimes(1);
    });

    it('closes the native menu and returns false when no details item is found', async () => {
        const nativeMoreClick = jest.fn();
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: 'doc-1',
            element: {
                querySelector: jest.fn((selector) => (
                    mod.DEPS.moreBtn.includes(selector) ? { click: nativeMoreClick } : null
                ))
            }
        });
        global.document.querySelectorAll = jest.fn((selector) => (
            selector === '.cdk-overlay-container [role="menuitem"]' ? [] : []
        ));

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest('source-1')).resolves.toBe(false);
        expect(nativeMoreClick).toHaveBeenCalledTimes(1);
        expect(global.document.body.click).toHaveBeenCalled();
    });

    it('waits for newly opened native menu items instead of matching a stale overlay menu', async () => {
        const nativeMoreClick = jest.fn();
        const staleMenuItem = {
            textContent: 'Delete',
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Delete' : null)),
            querySelector: jest.fn(() => ({ textContent: 'delete' }))
        };
        const detailClick = jest.fn();
        const detailMenuItem = {
            textContent: 'View source details',
            click: detailClick,
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'View source details' : null)),
            querySelector: jest.fn(() => ({ textContent: 'description' }))
        };
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: 'doc-1',
            element: {
                querySelector: jest.fn((selector) => (
                    mod.DEPS.moreBtn.includes(selector) ? { click: nativeMoreClick } : null
                ))
            }
        });

        let menuQueryCount = 0;
        global.document.querySelectorAll = jest.fn((selector) => {
            if (selector !== '.cdk-overlay-container [role="menuitem"]') return [];
            menuQueryCount += 1;
            if (menuQueryCount === 1) return [staleMenuItem];
            return [staleMenuItem, detailMenuItem];
        });

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest('source-1')).resolves.toBe(true);
        expect(nativeMoreClick).toHaveBeenCalledTimes(1);
        expect(detailClick).toHaveBeenCalledTimes(1);
        expect(global.document.body.click).not.toHaveBeenCalled();
    });

    it('matches NotebookLM view-source entries that use the eye icon and shorter label', async () => {
        const nativeMoreClick = jest.fn();
        const detailClick = jest.fn();
        const nativeMenuItem = {
            textContent: 'View source',
            click: detailClick,
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'View source' : null)),
            querySelector: jest.fn(() => ({ textContent: 'visibility' }))
        };
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: 'doc-1',
            element: {
                querySelector: jest.fn((selector) => (
                    mod.DEPS.moreBtn.includes(selector) ? { click: nativeMoreClick } : null
                ))
            }
        });
        let menuQueryCount = 0;
        global.document.querySelectorAll = jest.fn((selector) => {
            if (selector !== '.cdk-overlay-container [role="menuitem"]') return [];
            menuQueryCount += 1;
            return menuQueryCount === 1 ? [] : [nativeMenuItem];
        });

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest('source-1')).resolves.toBe(true);
        expect(nativeMoreClick).toHaveBeenCalledTimes(1);
        expect(detailClick).toHaveBeenCalledTimes(1);
    });

    it('falls back to the native title click when no details menu item can be matched', async () => {
        const nativeMoreClick = jest.fn();
        const titleClick = jest.fn();
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            stableToken: 'doc-1',
            element: {
                click: jest.fn(),
                querySelector: jest.fn((selector) => {
                    if (mod.DEPS.moreBtn.includes(selector)) return { click: nativeMoreClick };
                    if (mod.DEPS.title.includes(selector)) return { click: titleClick };
                    return null;
                })
            }
        });
        global.document.querySelectorAll = jest.fn((selector) => (
            selector === '.cdk-overlay-container [role="menuitem"]' ? [] : []
        ));

        await expect(mod._triggerNativeSourceDetailsViaNativeMenuForTest('source-1')).resolves.toBe(true);
        expect(nativeMoreClick).toHaveBeenCalledTimes(1);
        expect(titleClick).toHaveBeenCalledTimes(1);
        expect(global.document.body.click).toHaveBeenCalled();
    });
});

describe('triggerNativeSourceDetailsDirect', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('dispatches a native-style activation sequence to the source title first', () => {
        const titleTarget = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'tabindex' ? '0' : null)),
            tagName: 'BUTTON'
        };
        const row = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            querySelector: jest.fn((selector) => {
                if (mod.DEPS.title.includes(selector)) return titleTarget;
                return null;
            })
        };

        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            element: row
        });

        expect(mod._triggerNativeSourceDetailsDirectForTest('source-1')).toBe(true);
        expect(titleTarget.dispatchEvent).toHaveBeenCalled();
        expect(titleTarget.click).toHaveBeenCalledTimes(1);
        expect(row.click).not.toHaveBeenCalled();
    });

    it('prefers an actionable ancestor or link over an inert title span', () => {
        const titleTarget = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            getAttribute: jest.fn(() => null),
            tagName: 'SPAN',
            className: 'source-title',
            closest: jest.fn(() => null)
        };
        const anchorTarget = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'href' ? '/notebook/test/source/123' : null)),
            tagName: 'A',
            className: '',
            matches: jest.fn(() => false)
        };
        const row = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            querySelectorAll: jest.fn((selector) => (selector === 'a[href]' ? [anchorTarget] : [])),
            querySelector: jest.fn((selector) => {
                if (mod.DEPS.title.includes(selector)) return titleTarget;
                if (selector === 'a[href]') return anchorTarget;
                return null;
            })
        };

        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            element: row
        });

        expect(mod._triggerNativeSourceDetailsDirectForTest('source-1')).toBe(true);
        expect(anchorTarget.click).toHaveBeenCalledTimes(1);
        expect(titleTarget.click).not.toHaveBeenCalled();
    });

    it('falls back to clicking the row when no inner detail target is available', () => {
        const row = {
            dispatchEvent: jest.fn(),
            click: jest.fn(),
            getAttribute: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            querySelector: jest.fn(() => null)
        };

        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source One',
            element: row
        });

        expect(mod._triggerNativeSourceDetailsDirectForTest('source-1')).toBe(true);
        expect(row.dispatchEvent).toHaveBeenCalled();
        expect(row.click).toHaveBeenCalledTimes(1);
    });
});
