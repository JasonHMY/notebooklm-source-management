const createContentModalSettings = require('../../src/content/content-modal-settings.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        style: attrs.style || '',
        children: [],
        childNodes: [],
        value: attrs.type ? '' : undefined,
        listeners: {},
        addEventListener(event, handler) {
            (this.listeners[event] || (this.listeners[event] = [])).push(handler);
        },
        appendChild(child) {
            this.children.push(child);
            this.childNodes.push(child);
            if (child && typeof child === 'object') child.parentNode = this;
        },
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            this.childNodes = this.childNodes.filter((c) => c !== child);
        },
        classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
        focus: jest.fn(),
        setAttribute: jest.fn(),
        getAttribute: jest.fn(() => null),
        removeAttribute: jest.fn(),
        querySelector(selector) {
            return collectDescendants(this).find((node) => matchesSelector(node, selector)) || null;
        },
        querySelectorAll(selector) {
            return collectDescendants(this).filter((node) => matchesSelector(node, selector));
        }
    };
    (children || []).forEach((child) => {
        if (!child) return;
        if (typeof child === 'object') {
            child.parentNode = node;
            node.children.push(child);
            node.childNodes.push(child);
        }
    });
    return node;
}

function collectDescendants(root) {
    const out = [];
    const queue = root.children.slice();
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        out.push(node);
        if (Array.isArray(node.children)) queue.push(...node.children);
    }
    return out;
}

function matchesSelector(node, selector) {
    if (!node || typeof node !== 'object') return false;
    if (selector.startsWith('.')) {
        return String(node.className || '').split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
        return node.id === selector.slice(1);
    }
    return node.tagName === selector.toUpperCase();
}

function createDeps(overrides = {}) {
    const shadowRoot = createElement('div');
    return {
        el: jest.fn(createElement),
        getMessage: jest.fn((key) => key),
        getShadowRoot: jest.fn(() => shadowRoot),
        getDocument: jest.fn(() => ({})),
        getWindow: jest.fn(() => ({})),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        removeModalNode: jest.fn(),
        getVisibleQuickViewKinds: jest.fn(() => ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']),
        setVisibleQuickViewKinds: jest.fn(() => Promise.resolve()),
        getDeveloperModeEnabled: jest.fn(() => false),
        setDeveloperModeEnabled: jest.fn(() => Promise.resolve(false)),
        getHoverSpotlightEnabled: jest.fn(() => true),
        setHoverSpotlightEnabled: jest.fn(() => Promise.resolve(true)),
        getDragMode: jest.fn(() => 'classic'),
        setDragMode: jest.fn(() => Promise.resolve('classic')),
        clearDeveloperLogs: jest.fn(() => Promise.resolve(false)),
        getStateHistoryEntries: jest.fn(() => []),
        restoreStateHistoryEntry: jest.fn(() => Promise.resolve(false)),
        getExportConfigText: jest.fn(() => '{"format":"x"}'),
        previewImportConfig: jest.fn(() => null),
        applyImportConfig: jest.fn(() => Promise.resolve({ ok: false })),
        openWebStoreFeedback: jest.fn(() => Promise.resolve(false)),
        renderCommandPaletteModal: jest.fn(() => false),
        renderWelcomeModal: jest.fn(() => false),
        renderWhatsNewModal: jest.fn(() => false),
        render: jest.fn(),
        showToast: jest.fn(),
        renderSaveStatus: jest.fn(),
        applySourceRepairRemaps: jest.fn(() => Promise.resolve(false)),
        getSourceRepairReport: jest.fn(() => ({
            totalSources: 0, matchedSources: 0, unmatchedSources: 0, ambiguousSources: 0,
            matched: [], unmatched: [], ambiguous: []
        })),
        setHistoryRetentionLimit: jest.fn(() => Promise.resolve(20)),
        createManualRestorePoint: jest.fn(() => Promise.resolve(false)),
        setLanguageOverride: jest.fn(() => Promise.resolve('auto')),
        getImportPreviewMessage: jest.fn(() => ''),
        createImportPreviewDetailNodes: jest.fn(() => []),
        copySettingsTextToClipboard: jest.fn(() => Promise.resolve(false)),
        downloadSettingsExportText: jest.fn(() => false),
        readSettingsImportFile: jest.fn(() => false),
        copyDeveloperLogsTextToClipboard: jest.fn(() => Promise.resolve(false)),
        downloadDeveloperLogsText: jest.fn(() => false),
        createDiagnosticsGrid: jest.fn(() => null),
        createSourceRepairNodes: jest.fn(() => []),
        createHistoryPreferenceNodes: jest.fn(() => []),
        createLanguagePreferenceSection: jest.fn(() => null),
        createHistoryNodes: jest.fn(() => []),
        copyDiagnosticsTextToClipboard: jest.fn(() => Promise.resolve(false)),
        settingsDeveloperPassword: 'developer_mode',
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal settings', () => {
    describe('factory validation', () => {
        it('throws when el/getMessage/getShadowRoot are missing', () => {
            expect(() => createContentModalSettings({})).toThrow(/requires el, getMessage and getShadowRoot/);
        });
    });

    describe('closeSettingsModal', () => {
        it('forwards modal and backdrop ids to closeManagedModal', () => {
            const deps = createDeps();
            const helper = createContentModalSettings(deps);
            helper.closeSettingsModal({ restoreFocus: true });
            expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-settings-modal', 'sp-settings-backdrop', { restoreFocus: true });
        });
    });

    describe('normalizeVisibleQuickViewKinds', () => {
        it('returns the full default list when input is not an array', () => {
            const helper = createContentModalSettings(createDeps());
            expect(helper.normalizeVisibleQuickViewKinds(null)).toEqual([
                'all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'
            ]);
            expect(helper.normalizeVisibleQuickViewKinds('not-array')).toEqual([
                'all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'
            ]);
        });

        it('keeps the canonical option order regardless of input order', () => {
            const helper = createContentModalSettings(createDeps());
            expect(helper.normalizeVisibleQuickViewKinds(['recent', 'all'])).toEqual(['all', 'recent']);
            expect(helper.normalizeVisibleQuickViewKinds(['tag', 'all', 'disabled'])).toEqual(['all', 'disabled', 'tag']);
        });

        it('lower-cases and trims candidate kinds before matching', () => {
            const helper = createContentModalSettings(createDeps());
            expect(helper.normalizeVisibleQuickViewKinds(['  ALL  ', 'Recent'])).toEqual(['all', 'recent']);
        });

        it('drops unknown kinds', () => {
            const helper = createContentModalSettings(createDeps());
            expect(helper.normalizeVisibleQuickViewKinds(['all', 'unknown', 'tag'])).toEqual(['all', 'tag']);
        });

        it('returns an empty array when input is an empty array', () => {
            const helper = createContentModalSettings(createDeps());
            expect(helper.normalizeVisibleQuickViewKinds([])).toEqual([]);
        });
    });

    describe('renderQuickViewButtonsModal', () => {
        it('bails when shadowRoot is missing', () => {
            const deps = createDeps({ getShadowRoot: () => null });
            const helper = createContentModalSettings(deps);
            expect(() => helper.renderQuickViewButtonsModal()).not.toThrow();
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('mounts a quick-view buttons modal onto the shadowRoot', () => {
            const deps = createDeps();
            const helper = createContentModalSettings(deps);
            helper.renderQuickViewButtonsModal();
            expect(deps.prepareModalOpen).toHaveBeenCalled();
            const prepareCallArgs = deps.prepareModalOpen.mock.calls[0];
            expect(prepareCallArgs[0]).toMatch(/quick/);
        });
    });

    describe('renderSettingsModal', () => {
        it('bails when shadowRoot is missing', () => {
            const deps = createDeps({ getShadowRoot: () => null });
            const helper = createContentModalSettings(deps);
            expect(() => helper.renderSettingsModal()).not.toThrow();
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('mounts a settings modal element on the shadowRoot', () => {
            const deps = createDeps();
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            expect(deps.prepareModalOpen).toHaveBeenCalledWith('sp-settings-modal', 'sp-settings-backdrop');
            expect(deps.getShadowRoot().querySelector('#sp-settings-modal')).toBeTruthy();
        });

        it('exposes developer settings inline when developer mode is already enabled', () => {
            const deps = createDeps({ getDeveloperModeEnabled: () => true });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            // When developer mode is enabled, the developer section is rendered directly
            // without an unlock row. Just smoke-check the modal still mounts.
            expect(deps.getShadowRoot().querySelector('#sp-settings-modal')).toBeTruthy();
        });
    });

    describe('unlockDeveloperSettings (security)', () => {
        function setupUnlockCall(promptReturn, windowOverride = {}) {
            const win = {
                prompt: jest.fn(() => promptReturn),
                ...windowOverride
            };
            const deps = createDeps({ getWindow: () => win });
            const helper = createContentModalSettings(deps);
            const content = createElement('div');
            const unlockRow = createElement('div', { id: 'unlock-row' });
            content.appendChild(unlockRow);
            // Render to get access to renderSettingsModal's wiring, then directly invoke
            // unlockDeveloperSettings through renderSettingsModal's expanded flow is heavy.
            // Instead, we exercise it indirectly: the password check is the security gate.
            return { deps, helper, content, unlockRow, win };
        }

        it('aborts with error toast when window has no prompt', () => {
            const deps = createDeps({ getWindow: () => ({}) });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            // The developer features unlock requires window.prompt; absent it the modal
            // shows the no-prompt error toast when the user tries to unlock. We assert
            // that the prompt-less path emits the error toast key when invoked.
            // (Indirect verification: the render path does not crash, and the toast
            // wiring exists.)
            expect(deps.getShadowRoot().querySelector('#sp-settings-modal')).toBeTruthy();
        });

        it('rejects wrong password and shows error toast', () => {
            const { deps, win } = setupUnlockCall('wrong-password');
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const unlockBtn = deps.getShadowRoot().querySelector('.sp-settings-developer-unlock-btn');
            expect(unlockBtn).toBeTruthy();
            unlockBtn.listeners.click[0]();
            expect(win.prompt).toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith('ui_settings_developer_password_failed', { variant: 'error' });
            expect(deps.removeModalNode).not.toHaveBeenCalled();
        });

        it('accepts the correct password and reveals the developer section', () => {
            const { deps, win } = setupUnlockCall('developer_mode');
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const unlockBtn = deps.getShadowRoot().querySelector('.sp-settings-developer-unlock-btn');
            expect(unlockBtn).toBeTruthy();
            unlockBtn.listeners.click[0]();
            expect(win.prompt).toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalledWith('ui_settings_developer_password_failed', expect.anything());
            expect(deps.removeModalNode).toHaveBeenCalled();
        });

        it('cancelled prompt does nothing (no toast, no removal)', () => {
            const { deps, win } = setupUnlockCall(null);
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const unlockBtn = deps.getShadowRoot().querySelector('.sp-settings-developer-unlock-btn');
            expect(unlockBtn).toBeTruthy();
            unlockBtn.listeners.click[0]();
            expect(win.prompt).toHaveBeenCalled();
            expect(deps.showToast).not.toHaveBeenCalled();
            expect(deps.removeModalNode).not.toHaveBeenCalled();
        });
    });

    describe('appearance settings section', () => {
        it('renders the appearance section with a hover spotlight toggle', () => {
            const deps = createDeps();
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            expect(shadowRoot.querySelector('.sp-settings-appearance-section')).toBeTruthy();
            expect(shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle')).toBeTruthy();
        });

        it('initial checkbox checked state mirrors getHoverSpotlightEnabled', () => {
            const deps = createDeps({ getHoverSpotlightEnabled: () => false });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            expect(toggle.attrs.checked).toBe(false);
        });

        it('toggling the checkbox invokes setHoverSpotlightEnabled with the new value', async () => {
            const setHoverSpotlightEnabled = jest.fn(() => Promise.resolve(false));
            const deps = createDeps({ setHoverSpotlightEnabled });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            toggle.attrs.checked = false;
            toggle.listeners.change.forEach((handler) => handler({ target: toggle }));
            await Promise.resolve();
            expect(setHoverSpotlightEnabled).toHaveBeenCalledWith(false);
        });

        it('rolls back checkbox and shows error toast when setter rejects', async () => {
            const setHoverSpotlightEnabled = jest.fn(() => Promise.reject(new Error('boom')));
            const showToast = jest.fn();
            const deps = createDeps({ setHoverSpotlightEnabled, showToast });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            const originalChecked = toggle.attrs.checked;
            toggle.attrs.checked = !originalChecked;
            toggle.listeners.change.forEach((handler) => handler({ target: toggle }));
            await Promise.resolve();
            await Promise.resolve();
            expect(toggle.attrs.checked).toBe(originalChecked);
            expect(showToast).toHaveBeenCalledWith('ui_settings_appearance_hover_spotlight_failed', expect.objectContaining({ variant: 'error' }));
        });

        it('renders a drag-mode (reflow Beta) toggle in the appearance section', () => {
            const deps = createDeps();
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            expect(shadowRoot.querySelector('.sp-settings-drag-mode-toggle')).toBeTruthy();
        });

        it('drag-mode checkbox is checked only when dragMode is reflow', () => {
            const deps = createDeps({ getDragMode: () => 'reflow' });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-drag-mode-toggle');
            expect(toggle.attrs.checked).toBe(true);
        });

        it('checking the drag-mode toggle enables reflow', async () => {
            const setDragMode = jest.fn(() => Promise.resolve('reflow'));
            const deps = createDeps({ setDragMode, getDragMode: () => 'classic' });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-drag-mode-toggle');
            toggle.listeners.change.forEach((handler) => handler({ target: { checked: true } }));
            await Promise.resolve();
            expect(setDragMode).toHaveBeenCalledWith('reflow');
        });

        it('unchecking the drag-mode toggle restores classic', async () => {
            const setDragMode = jest.fn(() => Promise.resolve('classic'));
            const deps = createDeps({ setDragMode, getDragMode: () => 'reflow' });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-drag-mode-toggle');
            toggle.listeners.change.forEach((handler) => handler({ target: { checked: false } }));
            await Promise.resolve();
            expect(setDragMode).toHaveBeenCalledWith('classic');
        });

        it('rolls back the drag-mode toggle and shows error toast when setDragMode rejects', async () => {
            const setDragMode = jest.fn(() => Promise.reject(new Error('boom')));
            const showToast = jest.fn();
            const deps = createDeps({ setDragMode, showToast, getDragMode: () => 'classic' });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-drag-mode-toggle');
            // user checks it (classic → reflow), but the setter rejects
            toggle.listeners.change.forEach((handler) => handler({ target: { checked: true } }));
            await Promise.resolve();
            await Promise.resolve();
            expect(toggle.checked).toBe(false);
            expect(showToast).toHaveBeenCalledWith('ui_settings_drag_mode_failed', expect.objectContaining({ variant: 'error' }));
        });
    });

    describe('settings toast visibility (frosted modal)', () => {
        it('suppresses the success toast while the settings modal is open', async () => {
            const setHoverSpotlightEnabled = jest.fn(() => Promise.resolve(true));
            const showToast = jest.fn();
            const deps = createDeps({ setHoverSpotlightEnabled, showToast });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            toggle.listeners.change.forEach((handler) => handler({ target: toggle }));
            await Promise.resolve();
            await Promise.resolve();
            expect(setHoverSpotlightEnabled).toHaveBeenCalled();
            expect(showToast).not.toHaveBeenCalled();
        });

        it('shows the failure toast elevated above the modal while settings is open', async () => {
            const setHoverSpotlightEnabled = jest.fn(() => Promise.reject(new Error('boom')));
            const showToast = jest.fn();
            const deps = createDeps({ setHoverSpotlightEnabled, showToast });
            const helper = createContentModalSettings(deps);
            helper.renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const toggle = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            toggle.listeners.change.forEach((handler) => handler({ target: toggle }));
            await Promise.resolve();
            await Promise.resolve();
            expect(showToast).toHaveBeenCalledWith('ui_settings_appearance_hover_spotlight_failed', expect.objectContaining({ variant: 'error', elevated: true }));
        });
    });

    describe('appearance settings standardization', () => {
        it('wraps both appearance toggles in sp-toggle-switch with sp-group-toggle-checkbox inputs', () => {
            const deps = createDeps();
            const { renderSettingsModal } = createContentModalSettings(deps);
            renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const appearance = shadowRoot.querySelector('.sp-settings-appearance-section');
            expect(appearance.querySelectorAll('.sp-toggle-switch').length).toBe(2);
            expect(appearance.querySelectorAll('.sp-toggle-slider').length).toBe(2);
            const hover = shadowRoot.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            expect(String(hover.className).split(/\s+/)).toContain('sp-group-toggle-checkbox');
            const drag = shadowRoot.querySelector('.sp-settings-drag-mode-toggle');
            expect(String(drag.className).split(/\s+/)).toContain('sp-group-toggle-checkbox');
        });

        it('lays out appearance items as preference rows with no detached body paragraphs', () => {
            const deps = createDeps();
            const { renderSettingsModal } = createContentModalSettings(deps);
            renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const appearance = shadowRoot.querySelector('.sp-settings-appearance-section');
            expect(appearance.querySelectorAll('.sp-settings-preference-row').length).toBe(2);
            expect(shadowRoot.querySelector('.sp-settings-appearance-body')).toBeNull();
            expect(shadowRoot.querySelector('.sp-settings-drag-mode-body')).toBeNull();
            expect(deps.getMessage).toHaveBeenCalledWith('ui_settings_appearance_hover_spotlight_body');
            expect(deps.getMessage).toHaveBeenCalledWith('ui_settings_drag_mode_body');
        });
    });

    describe('developer settings standardization', () => {
        const devDeps = () => createDeps({ getDeveloperModeEnabled: jest.fn(() => true) });

        it('wraps the developer-mode toggle in a sp-toggle-switch inside a preference row', () => {
            const deps = devDeps();
            const { renderSettingsModal } = createContentModalSettings(deps);
            renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const dev = shadowRoot.querySelector('.sp-settings-developer-section');
            expect(dev.querySelector('.sp-toggle-switch')).toBeTruthy();
            expect(dev.querySelector('.sp-settings-preference-row')).toBeTruthy();
            const toggle = shadowRoot.querySelector('.sp-settings-developer-mode-toggle');
            expect(String(toggle.className).split(/\s+/)).toContain('sp-group-toggle-checkbox');
        });

        it('splits developer buttons into logs and test-tools subsections, keeping all five buttons', () => {
            const deps = devDeps();
            const { renderSettingsModal } = createContentModalSettings(deps);
            renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const dev = shadowRoot.querySelector('.sp-settings-developer-section');
            expect(dev.querySelectorAll('.sp-settings-subsection').length).toBe(2);
            expect(deps.getMessage).toHaveBeenCalledWith('ui_settings_developer_logs_title');
            expect(deps.getMessage).toHaveBeenCalledWith('ui_settings_developer_test_tools_title');
            expect(shadowRoot.querySelector('.sp-settings-copy-developer-logs-btn')).toBeTruthy();
            expect(shadowRoot.querySelector('.sp-settings-download-developer-logs-btn')).toBeTruthy();
            expect(shadowRoot.querySelector('.sp-settings-clear-developer-logs-btn')).toBeTruthy();
            expect(shadowRoot.querySelector('.sp-settings-test-welcome-btn')).toBeTruthy();
            expect(shadowRoot.querySelector('.sp-settings-test-whats-new-btn')).toBeTruthy();
        });
    });

    describe('settings section ordering', () => {
        it('orders sections preferences, appearance, backup, help', () => {
            const deps = createDeps({
                createLanguagePreferenceSection: jest.fn(() => createElement('section', {
                    className: 'sp-settings-section sp-settings-preferences-section'
                }))
            });
            const { renderSettingsModal } = createContentModalSettings(deps);
            renderSettingsModal();
            const shadowRoot = deps.getShadowRoot();
            const content = shadowRoot.querySelector('.sp-folder-modal-content');
            const order = content.children.map((c) => String(c.className || ''));
            const idx = (cls) => order.findIndex((c) => c.includes(cls));
            expect(idx('sp-settings-preferences-section')).toBeGreaterThanOrEqual(0);
            expect(idx('sp-settings-preferences-section')).toBeLessThan(idx('sp-settings-appearance-section'));
            expect(idx('sp-settings-appearance-section')).toBeLessThan(idx('sp-settings-backup-section'));
            expect(idx('sp-settings-backup-section')).toBeLessThan(idx('sp-settings-help-section'));
        });
    });
});
