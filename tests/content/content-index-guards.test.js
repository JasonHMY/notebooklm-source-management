const {
    setupGlobalMocks,
    teardownGlobalMocks,
    loadContentModule,
    createMockPanel,
    createInitShadowRoot
} = require('../helpers/content-test-harness');

const ACTIVE_CLASS = 'sources-plus-manager-active';

async function flushPromises() {
    for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
    }
}

function createNativeButton({ attrs = {}, text = '', parent = null, hidden = false }) {
    return {
        tagName: 'BUTTON',
        textContent: text,
        disabled: false,
        parentElement: parent,
        parentNode: parent,
        style: hidden ? { visibility: 'hidden' } : {},
        __computedStyle: hidden ? { visibility: 'hidden' } : {},
        click: jest.fn(),
        getAttribute: jest.fn((attr) => (Object.prototype.hasOwnProperty.call(attrs, attr) ? attrs[attr] : null)),
        matches: jest.fn((selector) => selector === 'button'),
        closest: jest.fn(() => null),
        querySelectorAll: jest.fn(() => [])
    };
}

// Mirrors the 2026-10 live header: `.label-row` holding a direct-action auto-label
// button (no aria-haspopup, `layers` icon) next to the Sort menu trigger.
function installAutoLabelOnlyPanel({ hidden = false } = {}) {
    const { panel } = createMockPanel({ visible: true, contentVisible: true });
    const labelRow = {
        tagName: 'DIV',
        textContent: 'layers Select all',
        parentElement: panel,
        parentNode: panel,
        style: {},
        __computedStyle: {},
        getAttribute: jest.fn((attr) => (attr === 'class' ? 'label-row' : null)),
        matches: jest.fn(() => false),
        closest: jest.fn(() => null),
        querySelectorAll: jest.fn(() => [])
    };
    const autoLabelButton = createNativeButton({
        parent: labelRow,
        hidden,
        text: 'layers',
        attrs: {
            'aria-label': 'Auto-label your sources by topic',
            class: 'mdc-icon-button mat-mdc-icon-button source-item-more-button label-auto-button'
        }
    });
    const sortButton = createNativeButton({
        parent: labelRow,
        text: 'sort',
        attrs: {
            'aria-label': 'Sort sources',
            'aria-haspopup': 'menu',
            class: 'mat-mdc-menu-trigger source-sort-button'
        }
    });
    panel.querySelectorAll = jest.fn((selector) => {
        const value = String(selector);
        if (value.includes('button') || value.includes('[role="button"]')) {
            return [autoLabelButton, sortButton];
        }
        return [];
    });
    global.document.querySelector = jest.fn((selector) => (
        selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
    ));
    return { panel, autoLabelButton, sortButton };
}

function mountMockManager(mod) {
    const host = { isConnected: true, remove: jest.fn() };
    const shadowRoot = {
        host,
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
        getElementById: jest.fn(() => null)
    };
    mod._setProjectId('notebook-a');
    mod._setManagerRuntimeForTest({ extensionHost: host, shadowRoot });
    return host;
}

describe('direct-action auto-label guard', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn(() => 1);
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('never clicks the auto-label button when restoring a persisted label display kind', () => {
        const { autoLabelButton, sortButton } = installAutoLabelOnlyPanel();
        mountMockManager(mod);

        mod._restorePersistedSourceViewDisplayKindForTest({ sourceViewDisplayKind: 'label' });

        expect(autoLabelButton.click).not.toHaveBeenCalled();
        expect(sortButton.click).not.toHaveBeenCalled();
        expect(mod.getDiagnosticsInfo()).toMatchObject({ sourceViewDisplayKind: 'list' });
    });

    it('fails a popup label switch with an accurate reason instead of clicking auto-label', () => {
        const { autoLabelButton } = installAutoLabelOnlyPanel();
        mountMockManager(mod);
        const sendResponse = jest.fn();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(autoLabelButton.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            viewKind: 'label',
            nativeClicked: false,
            reason: 'source_view_switch_control_missing',
            errorMessageKey: 'popup_reason_label_view_unavailable',
            sourceViewDisplayKind: 'list'
        }));
    });

    it('does not use hidden-control fallbacks to reach a direct-action auto-label button', () => {
        const { autoLabelButton } = installAutoLabelOnlyPanel({ hidden: true });
        mountMockManager(mod);
        const sendResponse = jest.fn();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(autoLabelButton.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            nativeClicked: false,
            reason: 'source_view_switch_control_missing'
        }));
    });

    it('does not click a localized auto-label action even when it carries no label-auto-button class', () => {
        const { panel } = installAutoLabelOnlyPanel();
        const localized = createNativeButton({
            parent: panel,
            hidden: true,
            text: 'label_auto 标签视图',
            attrs: { 'aria-label': '按主题自动为来源加标签' }
        });
        panel.querySelectorAll = jest.fn((selector) => (
            String(selector).includes('button') ? [localized] : []
        ));
        mountMockManager(mod);
        const sendResponse = jest.fn();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(localized.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            reason: 'source_view_switch_control_missing'
        }));
    });

    it('does not click an auto-label button when switching to list view either', () => {
        const { autoLabelButton } = installAutoLabelOnlyPanel();
        mountMockManager(mod);
        mod._setViewSwitchInProgressForTest(false);
        const sendResponse = jest.fn();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(autoLabelButton.click).not.toHaveBeenCalled();
    });
});

describe('extension enabled flag across SPA entry and tabs', () => {
    afterEach(teardownGlobalMocks);

    function loadWithStoredEnabled(enabled, pathname) {
        jest.resetModules();
        setupGlobalMocks();
        global.window.location.pathname = pathname;
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb !== 'function') return;
            if (message?.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled });
                return;
            }
            cb({ success: true });
        });
        return loadContentModule();
    }

    it('keeps the manager unmounted when a disabled content script is entered from the home page', async () => {
        const mod = loadWithStoredEnabled(false, '/');
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(false);

        global.window.location.pathname = '/notebook/notebook-b';
        global.document.documentElement.classList.add.mockClear();
        mod.handleRouteChanged();
        await flushPromises();

        expect(mod.getManagerStatus()).toEqual({ ready: false, reason: 'extension_disabled' });
        expect(global.document.documentElement.classList.add).not.toHaveBeenCalledWith(ACTIVE_CLASS);
        expect(mod._getAttachedSourcePanelForTest()).toBeNull();
    });

    it('still mounts via route recovery when the stored flag is enabled', async () => {
        const mod = loadWithStoredEnabled(true, '/');
        await flushPromises();

        global.setTimeout = jest.fn(() => 1);
        global.window.location.pathname = '/notebook/notebook-b';
        mod.handleRouteChanged();

        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(mod.getManagerStatus().reason).not.toBe('extension_disabled');
    });

    it('registers one storage listener and converges on enabled=false then enabled=true', async () => {
        const mod = loadWithStoredEnabled(true, '/notebook/notebook-a');
        await flushPromises();
        const { addListener } = global.chrome.storage.onChanged;
        expect(addListener).toHaveBeenCalledTimes(1);
        const onStorageChanged = addListener.mock.calls[0][0];
        const host = mountMockManager(mod);
        global.document.documentElement.classList.remove.mockClear();

        onStorageChanged({ extensionEnabled: { oldValue: true, newValue: false } }, 'local');

        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(host.remove).toHaveBeenCalledTimes(1);
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith(ACTIVE_CLASS);
        expect(mod.getManagerStatus()).toEqual({ ready: false, reason: 'extension_disabled' });

        onStorageChanged({ extensionEnabled: { oldValue: false } }, 'local');

        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(mod.getManagerStatus().reason).not.toBe('extension_disabled');
    });

    it('ignores other storage areas and unrelated keys', async () => {
        const mod = loadWithStoredEnabled(true, '/notebook/notebook-a');
        await flushPromises();
        const onStorageChanged = global.chrome.storage.onChanged.addListener.mock.calls[0][0];

        onStorageChanged({ extensionEnabled: { newValue: false } }, 'sync');
        onStorageChanged({ sourcesPlusPreferences: { newValue: {} } }, 'local');
        onStorageChanged(undefined, 'local');

        expect(mod._getExtensionEnabledForTest()).toBe(true);
    });

    it('does not apply the same disable twice when the storage event and the popup message both arrive', async () => {
        const mod = loadWithStoredEnabled(true, '/notebook/notebook-a');
        await flushPromises();
        const onStorageChanged = global.chrome.storage.onChanged.addListener.mock.calls[0][0];
        const host = mountMockManager(mod);
        const sendResponse = jest.fn();

        onStorageChanged({ extensionEnabled: { newValue: false } }, 'local');
        onStorageChanged({ extensionEnabled: { newValue: false } }, 'local');
        mod.handleManagerMessage({ type: 'DISABLE_MANAGER' }, {}, sendResponse);

        expect(host.remove).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: true, disabled: true, saveStarted: false });
    });

    it('removes the storage listener when the content instance is destroyed', async () => {
        const mod = loadWithStoredEnabled(true, '/');
        await flushPromises();
        const onStorageChanged = global.chrome.storage.onChanged.addListener.mock.calls[0][0];

        mod._destroyContentInstanceForTest();

        expect(global.chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(onStorageChanged);
    });
});

describe('extension enabled flag while the startup read is pending', () => {
    afterEach(teardownGlobalMocks);

    function loadWithPendingStartupRead(pathname) {
        jest.resetModules();
        setupGlobalMocks();
        global.window.location.pathname = pathname;
        let respond = null;
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb !== 'function') return;
            if (message?.type === 'GET_EXTENSION_ENABLED') {
                respond = (enabled) => cb({ success: true, enabled });
                return;
            }
            cb({ success: true });
        });
        const mod = loadContentModule();
        return {
            mod,
            respond: (enabled) => respond(enabled),
            onStorageChanged: global.chrome.storage.onChanged.addListener.mock.calls[0][0]
        };
    }

    // A panel the manager can really mount into; mounting shows up as the header insert.
    function installMountablePanel() {
        const { panel, header } = createMockPanel({ visible: true, contentVisible: true });
        const initHarness = createInitShadowRoot();
        let firstDiv = true;
        panel.querySelectorAll = jest.fn(() => []);
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.querySelectorAll = jest.fn(() => []);
        global.document.createElement = jest.fn((tag) => {
            if (tag === 'div' && firstDiv) {
                firstDiv = false;
                return {
                    id: '',
                    attachShadow: jest.fn(() => initHarness.shadowRoot),
                    remove: jest.fn(),
                    isConnected: true
                };
            }
            return {
                textContent: '',
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                dataset: {},
                style: {},
                classList: { add: jest.fn(), remove: jest.fn() }
            };
        });
        return { panel, header };
    }

    it('keeps the extension disabled when a storage disable lands before the slow startup response', async () => {
        const { mod, respond, onStorageChanged } = loadWithPendingStartupRead('/notebook/notebook-a');
        const { header } = installMountablePanel();

        onStorageChanged({ extensionEnabled: { oldValue: true, newValue: false } }, 'local');
        expect(mod._getExtensionEnabledForTest()).toBe(false);

        respond(true);
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(mod.getManagerStatus()).toEqual({ ready: false, reason: 'extension_disabled' });
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
        expect(global.document.documentElement.classList.add).not.toHaveBeenCalledWith(ACTIVE_CLASS);
    });

    it('keeps the extension disabled when a forwarded DISABLE_MANAGER lands before the startup response', async () => {
        const { mod, respond } = loadWithPendingStartupRead('/notebook/notebook-a');
        const { header } = installMountablePanel();

        mod.handleManagerMessage({ type: 'DISABLE_MANAGER' }, {}, jest.fn());
        respond(true);
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
    });

    it('does not mount or hide the native list during an SPA entry while the stored disabled flag is unread', async () => {
        const { mod, respond } = loadWithPendingStartupRead('/');
        const { header } = installMountablePanel();
        await flushPromises();

        global.window.location.pathname = '/notebook/notebook-b';
        mod.handleRouteChanged();
        mod.syncManagerWithPanelLifecycle();
        await flushPromises();

        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
        expect(global.document.documentElement.classList.add).not.toHaveBeenCalledWith(ACTIVE_CLASS);

        respond(false);
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(mod.getManagerStatus()).toEqual({ ready: false, reason: 'extension_disabled' });
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
        expect(global.document.documentElement.classList.add).not.toHaveBeenCalledWith(ACTIVE_CLASS);
        expect(mod._getAttachedSourcePanelForTest()).toBeNull();
    });

    it('mounts a notebook entered during the pending read once the stored flag turns out enabled', async () => {
        const { mod, respond } = loadWithPendingStartupRead('/');
        const { header } = installMountablePanel();
        await flushPromises();

        global.window.location.pathname = '/notebook/notebook-b';
        mod.handleRouteChanged();
        await flushPromises();
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();

        respond(true);
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
    });

    it('still mounts on a normal enabled startup once the read resolves', async () => {
        const { respond, mod } = loadWithPendingStartupRead('/notebook/notebook-a');
        const { header } = installMountablePanel();
        await flushPromises();
        expect(header.insertAdjacentElement).not.toHaveBeenCalled();

        respond(true);
        await flushPromises();

        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
    });

    it('ignores a late startup response after the content instance was destroyed', async () => {
        const { mod, respond } = loadWithPendingStartupRead('/notebook/notebook-a');
        const { header } = installMountablePanel();

        mod._destroyContentInstanceForTest();
        respond(true);
        await flushPromises();

        expect(header.insertAdjacentElement).not.toHaveBeenCalled();
        expect(mod._getAttachedSourcePanelForTest()).toBeNull();
    });
});
