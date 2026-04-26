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

describe('manager launcher messaging', () => {
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

    it('reports source_panel_missing when the notebook UI is unavailable', () => {
        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => null);

        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'source_panel_missing'
        });
    });

    it('returns ready and focuses the manager when the injected panel exists', () => {
        const { panel } = createMockPanel({ visible: true });
        const mockContainer = {
            classList: {
                add: jest.fn(),
                remove: jest.fn()
            },
            offsetWidth: 120
        };
        const mockHost = {
            isConnected: true,
            scrollIntoView: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn((selector) => selector === '.sp-container' ? mockContainer : null)
        };

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(mockShadowRoot);
        mod._setAttachedSourcePanelForTest(panel);
        global.document.querySelector = jest.fn(() => panel);

        expect(mod.getManagerStatus()).toMatchObject({
            ready: true,
            reason: 'ready'
        });

        expect(mod.focusManagerPanel()).toEqual({ success: true });
        expect(mockHost.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(mockContainer.classList.add).toHaveBeenCalledWith('sp-focus-ring');
    });

    it('reports extension_disabled when the manager is globally disabled', () => {
        const sendResponse = jest.fn();

        mod._setProjectId('test-project');
        mod._setExtensionEnabledForTest(false);

        mod.handleManagerMessage({ type: 'GET_MANAGER_STATUS' }, {}, sendResponse);

        expect(sendResponse).toHaveBeenCalledWith({
            ready: false,
            reason: 'extension_disabled'
        });
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'extension_disabled'
        });
    });

    it('routes runtime messages for popup status and focus requests', () => {
        const sendResponse = jest.fn();
        mod._setProjectId('test-project');

        mod.handleManagerMessage({ type: 'GET_MANAGER_STATUS' }, {}, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({
            ready: false,
            reason: 'source_panel_missing'
        });

        sendResponse.mockClear();
        mod.handleManagerMessage({ type: 'FOCUS_MANAGER' }, {}, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            reason: 'source_panel_missing'
        });
    });

    it('routes popup source view switch requests to NotebookLM native controls', () => {
        const sendResponse = jest.fn();
        const labelButton = {
            textContent: 'Label view',
            disabled: false,
            style: {},
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Label view' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const listButton = {
            textContent: 'List view',
            disabled: false,
            style: {},
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'List view' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('button') || selector.includes('[role="button"]')) return [labelButton, listButton];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            clicked: true
        }));
    });

    it('clicks the hidden native label-view entry point before showing plugin label mode', () => {
        const sendResponse = jest.fn();
        const labelButton = {
            textContent: 'label_auto 标签视图',
            disabled: false,
            style: {
                visibility: 'hidden'
            },
            __computedStyle: {
                visibility: 'hidden'
            },
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '按主题自动为来源加标签' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('button') || selector.includes('[role="button"]')) return [labelButton];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            nativeClicked: true,
            nativeSwitchReason: 'clicked_hidden'
        }));
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('does not show plugin label mode when the native label-view control is unavailable', () => {
        const sendResponse = jest.fn();
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn(() => []);
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.documentElement.classList.remove.mockClear();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            viewKind: 'label',
            nativeClicked: false,
            nativeSwitchReason: 'source_view_switch_control_missing',
            sourceViewDisplayKind: 'list'
        }));
        expect(global.document.documentElement.classList.remove).not.toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('keeps the popup ready when the manager host is inside the current panel but the stored panel reference is stale', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const stalePanel = createMockPanel({ visible: true, contentVisible: true }).panel;
        const mockContainer = {
            classList: {
                add: jest.fn(),
                remove: jest.fn()
            },
            offsetWidth: 120
        };
        const mockHost = {
            isConnected: true,
            scrollIntoView: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn((selector) => selector === '.sp-container' ? mockContainer : null)
        };
        panel.contains = jest.fn((element) => element === mockHost);

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(mockShadowRoot);
        mod._setAttachedSourcePanelForTest(stalePanel);
        global.document.querySelector = jest.fn(() => panel);

        expect(mod.getManagerStatus()).toMatchObject({
            ready: true,
            reason: 'ready'
        });
        expect(mod._getAttachedSourcePanelForTest()).toBe(panel);
    });

    it('keeps the popup controls available when the mounted label-view manager is preserving sources during native loading', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelControl = {
            isConnected: true,
            hidden: false,
            textContent: 'label_auto 重新为来源加标签',
            style: {
                display: 'block',
                visibility: 'visible'
            },
            __computedStyle: {
                display: 'block',
                visibility: 'visible'
            },
            getBoundingClientRect: jest.fn(() => ({ width: 220, height: 40 })),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '重新为来源加标签' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const mockContainer = {
            classList: {
                add: jest.fn(),
                remove: jest.fn()
            },
            offsetWidth: 120
        };
        const mockHost = {
            isConnected: true,
            scrollIntoView: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn((selector) => selector === '.sp-container' ? mockContainer : null)
        };

        panel.contains = jest.fn((element) => element === mockHost);
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [labelControl];
            return [];
        });

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(mockShadowRoot);
        mod._setAttachedSourcePanelForTest(panel);
        mod.state.ungrouped = ['saved-source'];
        mod.sourcesByKey.set('saved-source', {
            key: 'saved-source',
            title: 'Saved Source',
            normalizedTitle: 'saved source',
            enabled: true
        });
        mod._setManagerStatusReason('manager_not_ready');
        global.document.querySelector = jest.fn(() => panel);

        expect(mod.getSourcePanelState(panel)).toMatchObject({
            state: 'loading',
            totalRows: 0
        });
        expect(mod.getManagerStatus()).toMatchObject({
            ready: true,
            reason: 'ready',
            sourceViewKind: 'list',
            detectedSourceViewKind: 'label'
        });
    });

    it('forces plugin list mode from the popup even when NotebookLM is still exposing label-view controls', () => {
        const sendResponse = jest.fn();
        const stale = createMockSourceRow({ title: 'Stale Source', stableToken: 'stale-doc', checked: true });
        const relabelControl = {
            textContent: 'label_auto',
            disabled: false,
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '撤销或重新为来源加标签' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [relabelControl];
            if (mod.DEPS.row.includes(selector)) return [stale.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            nativeClicked: false,
            nativeSwitchReason: 'source_view_switch_control_missing'
        }));
        expect(global.document.documentElement.classList.add).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('cleans up the previous content instance when the script is injected twice', () => {
        const firstMessageHandler = mod.handleManagerMessage;
        const firstPatchedPushState = global.history.pushState;

        jest.resetModules();
        const secondMod = require('../../src/content/index.js');

        expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(2);
        expect(global.chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(firstMessageHandler);
        expect(global.window.removeEventListener).toHaveBeenCalledWith('popstate', expect.any(Function));
        expect(global.window.removeEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
        expect(global.history.pushState).not.toBe(firstPatchedPushState);

        secondMod._destroyContentInstanceForTest();
    });

    it('tears down the manager when DISABLE_MANAGER is received', () => {
        const mockHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };
        const sendResponse = jest.fn();

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({
            extensionHost: mockHost,
            shadowRoot: mockShadowRoot
        });
        mod._setExtensionEnabledForTest(true);

        mod.handleManagerMessage({ type: 'DISABLE_MANAGER' }, {}, sendResponse);

        expect(mockHost.remove).toHaveBeenCalledTimes(1);
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith('sources-plus-manager-active');
        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            disabled: true
        });
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'extension_disabled'
        });
    });

    it('reenables the manager runtime when ENABLE_MANAGER is received', () => {
        const sendResponse = jest.fn();

        mod._setProjectId('test-project');
        mod._setExtensionEnabledForTest(false);
        global.document.querySelector = jest.fn(() => null);

        mod.handleManagerMessage({ type: 'ENABLE_MANAGER' }, {}, sendResponse);

        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            enabled: true,
            attempted: true
        });
    });

    it('treats a hidden native content area as a collapsed source panel', () => {
        const { panel, content } = createMockPanel({ visible: true, contentVisible: false });

        expect(mod.findSourcePanelContent(panel)).toBe(content);
        expect(mod.isSourcePanelCollapsed(panel)).toBe(true);
        expect(mod.isSourcePanelRenderable(panel)).toBe(false);
    });

    it('does not treat the manager hidden native list style as a collapsed source panel', () => {
        const { panel, content } = createMockPanel({ visible: true, contentVisible: true });

        content.style.visibility = 'hidden';
        content.__computedStyle.visibility = 'hidden';
        content.getBoundingClientRect.mockImplementation(() => ({ width: 320, height: 640 }));

        expect(mod.findSourcePanelContent(panel)).toBe(content);
        expect(mod.isSourcePanelCollapsed(panel)).toBe(false);
        expect(mod.isSourcePanelRenderable(panel)).toBe(true);
    });

    it('treats the native label view panel as renderable even without the legacy scroll area', () => {
        const { panel, header } = createMockPanel({ visible: true, contentVisible: true });
        const labelControl = {
            isConnected: true,
            hidden: false,
            textContent: 'label_auto 按主题自动为来源加标签',
            style: {
                display: 'block',
                visibility: 'visible'
            },
            __computedStyle: {
                display: 'block',
                visibility: 'visible'
            },
            getBoundingClientRect: jest.fn(() => ({ width: 240, height: 40 })),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '撤销或重新为来源加标签' : null)),
            matches: jest.fn(() => false)
        };

        panel.querySelector = jest.fn((selector) => (selector === '.panel-header' ? header : null));
        panel.querySelectorAll = jest.fn((selector) => (
            selector === 'button' || selector === '[role="button"]' ? [labelControl] : []
        ));

        expect(mod.findSourcePanelContent(panel)).toBe(null);
        expect(mod.isSourcePanelCollapsed(panel)).toBe(false);
        expect(mod.isSourcePanelRenderable(panel)).toBe(true);
    });

    it('soft-tears down the manager when the native source panel becomes non-renderable', () => {
        const { panel } = createMockPanel({ visible: false });
        const mockHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(mockShadowRoot);
        mod._setAttachedSourcePanelForTest(panel);
        global.document.querySelector = jest.fn(() => panel);

        mod.saveState();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

        mod.syncManagerWithPanelLifecycle();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                key: 'sourcesPlusState_test-project'
            }),
            expect.any(Function)
        );
        expect(mockHost.remove).toHaveBeenCalledTimes(1);
        expect(mod._getAttachedSourcePanelForTest()).toBeNull();
        expect(global.window.location.reload).not.toHaveBeenCalled();
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'manager_not_ready'
        });
    });

    it('reacts to resize observer updates when the native content area collapses without DOM mutations', () => {
        global.setTimeout = (cb) => {
            cb();
            return 1;
        };

        const { panel, content } = createMockPanel({ visible: true, contentVisible: true });
        const mockHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(mockShadowRoot);
        mod._setAttachedSourcePanelForTest(panel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: true
        });
        global.document.querySelector = jest.fn(() => panel);
        mod.bindPanelLifecycleHooks(panel);

        content.style.display = 'none';
        content.style.visibility = 'hidden';
        content.__computedStyle.display = 'none';
        content.__computedStyle.visibility = 'hidden';
        content.getBoundingClientRect.mockImplementation(() => ({ width: 0, height: 0 }));

        mod._getPanelResizeObserverForTest().callback([{ target: content }]);

        expect(mockHost.remove).toHaveBeenCalledTimes(1);
        expect(mod._getPendingPanelReattachStateForTest()).not.toBeNull();
    });

    it('schedules follow-up lifecycle checks from native header clicks', () => {
        const { panel, header } = createMockPanel({ visible: true });

        mod.bindPanelLifecycleHooks(panel);

        const listener = header.addEventListener.mock.calls.find(([type]) => type === 'click')[1];
        listener();

        expect(global.window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(global.setTimeout).toHaveBeenCalled();
    });

    it('reinitializes on the same notebook route when the native source panel returns', () => {
        const { panel, header } = createMockPanel({ visible: true });
        const initHarness = createInitShadowRoot();
        let firstDiv = true;

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            if (typeof cb === 'function') cb({});
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();

        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
        expect(mod._getAttachedSourcePanelForTest()).toBe(panel);
        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_test-project', 'sourcesPlusState_test-project__backup'],
            expect.any(Function)
        );
        expect(global.window.location.reload).not.toHaveBeenCalled();
    });

    it('initializes while source rows are only partially hydrated and keeps the restore snapshot pending', () => {
        const { panel, header } = createMockPanel({ visible: true, contentVisible: true });
        const initHarness = createInitShadowRoot();
        let firstDiv = true;
        const loadedState = {
            schemaVersion: 3,
            groups: ['group1'],
            groupsById: {
                group1: {
                    id: 'group1',
                    title: 'Pinned',
                    children: [{ type: 'source', key: 'source_id_doc-1' }]
                }
            },
            ungrouped: [],
            sourceStateById: {
                'source_id_doc-1': {
                    enabled: false,
                    title: 'Deferred Source',
                    normalizedTitle: 'deferred source',
                    stableToken: 'doc-1',
                    fingerprint: 'deferred source||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        const partialRow = {
            querySelector: jest.fn((selector) => {
                if (selector.includes('source-title')) return { textContent: 'Deferred Source' };
                if (selector.includes('checkbox')) return null;
                if (selector.includes('mat-icon')) return { textContent: 'description', classList: [] };
                if (selector.includes('More options')) return null;
                return null;
            }),
            querySelectorAll: jest.fn(() => []),
            getAttribute: jest.fn(() => null),
            children: []
        };
        const expectedLoadedState = {
            ...loadedState,
            customHeight: null
        };

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [partialRow] : []
        ));
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            if (typeof cb === 'function') {
                cb({
                    ['sourcesPlusState_test-project']: loadedState
                });
            }
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();

        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
        expect(mod._getAttachedSourcePanelForTest()).toBe(panel);
        expect(mod._getPendingInitialLoadedState()).toEqual(expectedLoadedState);
        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_test-project', 'sourcesPlusState_test-project__backup'],
            expect.any(Function)
        );
    });

    it('reopens from the in-memory panel snapshot before falling back to storage', () => {
        const { panel, header, content } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const initHarness = createInitShadowRoot();
        let firstDiv = true;

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(detachShadowRoot);
        mod._setAttachedSourcePanelForTest(panel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: false
        });
        global.document.querySelector = jest.fn(() => panel);

        content.style.display = 'none';
        content.style.visibility = 'hidden';
        content.__computedStyle.display = 'none';
        content.__computedStyle.visibility = 'hidden';
        content.getBoundingClientRect.mockImplementation(() => ({ width: 0, height: 0 }));

        mod.syncManagerWithPanelLifecycle();

        expect(mod._getPendingPanelReattachStateForTest()).toEqual(expect.objectContaining({
            groups: ['group1']
        }));
        expect(detachHost.remove).toHaveBeenCalledTimes(1);

        content.style.display = 'block';
        content.style.visibility = 'visible';
        content.__computedStyle.display = 'block';
        content.__computedStyle.visibility = 'visible';
        content.getBoundingClientRect.mockImplementation(() => ({ width: 320, height: 640 }));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();

        const runtimeMessages = global.chrome.runtime.sendMessage.mock.calls.map(([message]) => message);
        const restoredKey = Array.from(mod.sourcesByKey.keys())[0];
        expect(runtimeMessages.some((message) => message.type === 'LOAD_STATE')).toBe(false);
        expect(runtimeMessages.some((message) => (
            message.type === 'SAVE_STATE' && message.key === 'sourcesPlusState_test-project'
        ))).toBe(true);
        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
        expect(mod._getPendingPanelReattachStateForTest()).toBeNull();
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: restoredKey }]);
        expect(mod.sourcesByKey.get(restoredKey).enabled).toBe(false);
    });

    it('suspends the manager on source-detail views and blocks persistence while suspended', () => {
        const { panel: listPanel } = createMockPanel({ visible: true, contentVisible: true });
        const { panel: detailPanel } = createMockPanel({ visible: true, contentVisible: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const detailLikeRow = {
            querySelector: jest.fn((selector) => {
                if (selector.includes('source-title')) return { textContent: 'Source detail section' };
                if (selector.includes('checkbox')) return null;
                if (selector.includes('mat-icon')) return { textContent: 'description', classList: [] };
                if (selector.includes('More options')) return null;
                return null;
            }),
            querySelectorAll: jest.fn(() => []),
            getAttribute: jest.fn(() => null),
            children: []
        };

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(detachShadowRoot);
        mod._setAttachedSourcePanelForTest(listPanel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: true
        });
        global.document.querySelector = jest.fn(() => detailPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [detailLikeRow] : []
        ));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });

        mod.syncManagerWithPanelLifecycle();

        expect(detachHost.remove).toHaveBeenCalledTimes(1);
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'source_detail_view'
        });
        expect(mod._getPendingPanelReattachStateForTest()).toEqual(expect.objectContaining({
            groups: ['group1']
        }));

        global.chrome.runtime.sendMessage.mockClear();

        mod.saveState();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('treats native source guides as detail views even when regular source rows remain', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        const closeSourceGuideButton = {
            textContent: '',
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '关闭来源指南' : null))
        };

        panel.querySelectorAll = jest.fn((selector) => {
            if (mod.DEPS.row.includes(selector)) return [sourceRow.row];
            if (selector === 'button[aria-label], [role="button"][aria-label], [aria-label], button[title], [role="button"][title]') {
                return [closeSourceGuideButton];
            }
            return [];
        });

        expect(mod.getSourcePanelState(panel)).toEqual(expect.objectContaining({
            state: 'detail',
            totalRows: 1,
            manageableRows: 1
        }));
    });

    it('restores the pending snapshot after returning from a source-detail view without reloading storage', () => {
        const { panel: listPanel, content: listContent } = createMockPanel({ visible: true, contentVisible: true });
        const { panel: detailPanel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const initHarness = createInitShadowRoot();
        const detailLikeRow = {
            querySelector: jest.fn((selector) => {
                if (selector.includes('source-title')) return { textContent: 'Source detail section' };
                if (selector.includes('checkbox')) return null;
                if (selector.includes('mat-icon')) return { textContent: 'description', classList: [] };
                if (selector.includes('More options')) return null;
                return null;
            }),
            querySelectorAll: jest.fn(() => []),
            getAttribute: jest.fn(() => null),
            children: []
        };
        let firstDiv = true;

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(detachShadowRoot);
        mod._setAttachedSourcePanelForTest(listPanel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: false
        });
        global.document.querySelector = jest.fn(() => detailPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [detailLikeRow] : []
        ));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });

        mod.syncManagerWithPanelLifecycle();

        expect(mod._getPendingPanelReattachStateForTest()).toEqual(expect.objectContaining({
            groups: ['group1']
        }));

        listContent.style.display = 'block';
        listContent.style.visibility = 'visible';
        listContent.__computedStyle.display = 'block';
        listContent.__computedStyle.visibility = 'visible';
        listContent.getBoundingClientRect.mockImplementation(() => ({ width: 320, height: 640 }));
        global.document.querySelector = jest.fn(() => listPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        global.chrome.runtime.sendMessage.mockClear();
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();

        const runtimeMessages = global.chrome.runtime.sendMessage.mock.calls.map(([message]) => message);
        const restoredKey = Array.from(mod.sourcesByKey.keys())[0];
        expect(runtimeMessages.some((message) => message.type === 'LOAD_STATE')).toBe(false);
        expect(runtimeMessages.some((message) => (
            message.type === 'SAVE_STATE' && message.key === 'sourcesPlusState_test-project'
        ))).toBe(true);
        expect(mod.getManagerStatus()).toMatchObject({
            ready: true,
            reason: 'ready'
        });
        expect(mod._getPendingPanelReattachStateForTest()).toBeNull();
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: restoredKey }]);
        expect(mod.sourcesByKey.get(restoredKey).enabled).toBe(false);
    });

    it('treats a zero-row source-detail view as suspended and blocks persistence', () => {
        const { panel: listPanel } = createMockPanel({ visible: true, contentVisible: true });
        const { panel: detailPanel } = createMockPanel({ visible: true, contentVisible: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(detachShadowRoot);
        mod._setAttachedSourcePanelForTest(listPanel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: true
        });
        global.document.querySelector = jest.fn(() => detailPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        mod._setSourceDetailViewRequestedForTest(true);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });

        mod.syncManagerWithPanelLifecycle();

        expect(detachHost.remove).toHaveBeenCalledTimes(1);
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'source_detail_view'
        });

        global.chrome.runtime.sendMessage.mockClear();

        mod.saveState();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('restores from the pending snapshot after returning from a zero-row source-detail view', () => {
        const { panel: listPanel, content: listContent } = createMockPanel({ visible: true, contentVisible: true });
        const { panel: detailPanel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        const detachHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const detachShadowRoot = {
            host: detachHost,
            querySelector: jest.fn(() => null)
        };
        const initHarness = createInitShadowRoot();
        let firstDiv = true;

        mod._setProjectId('test-project');
        mod._setShadowRootForTest(detachShadowRoot);
        mod._setAttachedSourcePanelForTest(listPanel);
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: 'source_id_doc-1' }]
        });
        mod.sourcesByKey.set('source_id_doc-1', {
            key: 'source_id_doc-1',
            title: 'Pinned Source',
            normalizedTitle: 'pinned source',
            fingerprint: 'pinned source||article',
            identityType: 'stable-token',
            enabled: false
        });
        global.document.querySelector = jest.fn(() => detailPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        mod._setSourceDetailViewRequestedForTest(true);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });

        mod.syncManagerWithPanelLifecycle();

        expect(mod._getPendingPanelReattachStateForTest()).toEqual(expect.objectContaining({
            groups: ['group1']
        }));

        listContent.style.display = 'block';
        listContent.style.visibility = 'visible';
        listContent.__computedStyle.display = 'block';
        listContent.__computedStyle.visibility = 'visible';
        listContent.getBoundingClientRect.mockImplementation(() => ({ width: 320, height: 640 }));
        global.document.querySelector = jest.fn(() => listPanel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        global.chrome.runtime.sendMessage.mockClear();
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (typeof cb === 'function') cb({});
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();

        const runtimeMessages = global.chrome.runtime.sendMessage.mock.calls.map(([message]) => message);
        const restoredKey = Array.from(mod.sourcesByKey.keys())[0];
        expect(runtimeMessages.some((message) => message.type === 'LOAD_STATE')).toBe(false);
        expect(runtimeMessages.some((message) => (
            message.type === 'SAVE_STATE' && message.key === 'sourcesPlusState_test-project'
        ))).toBe(true);
        expect(mod.getManagerStatus()).toMatchObject({
            ready: true,
            reason: 'ready'
        });
        expect(mod._getPendingPanelReattachStateForTest()).toBeNull();
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: restoredKey }]);
        expect(mod.sourcesByKey.get(restoredKey).enabled).toBe(false);
    });

    it('reinitializes without immediate reload when the user enters a notebook route through SPA navigation', () => {
        mod._setProjectId(null);
        global.window.location.pathname = '/notebook/fresh-project';

        mod.handleRouteChanged();

        expect(global.window.location.reload).not.toHaveBeenCalled();
    });

    it('recovers when lifecycle sync sees a notebook URL after a missed SPA route event', async () => {
        const { panel, header } = createMockPanel({ visible: true });
        const initHarness = createInitShadowRoot();
        let firstDiv = true;

        mod._setProjectId(null);
        global.window.location.pathname = '/notebook/fresh-project';
        global.window.location.href = 'https://notebooklm.google.com/notebook/fresh-project';
        global.document.querySelector = jest.fn(() => panel);
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            if (typeof cb === 'function') cb({});
        });
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
                appendChild: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn() },
                dataset: {},
                matches: jest.fn(() => false),
                closest: jest.fn(() => null),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                textContent: '',
                style: {}
            };
        });

        mod.syncManagerWithPanelLifecycle();
        await Promise.resolve();

        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
        expect(mod._getAttachedSourcePanelForTest()).toBe(panel);
        expect(global.chrome.storage.local.get).toHaveBeenCalledWith(
            ['sourcesPlusState_fresh-project', 'sourcesPlusState_fresh-project__backup'],
            expect.any(Function)
        );
        expect(global.window.location.reload).not.toHaveBeenCalled();
    });

    it('reinitializes without immediate reload when the user switches between notebook routes', () => {
        mod._setProjectId('old-project');
        global.window.location.pathname = '/notebook/new-project';

        mod.handleRouteChanged();

        expect(global.window.location.reload).not.toHaveBeenCalled();
    });

    it('falls back to reload only after repeated route recovery failures', async () => {
        const timeoutDelays = [];
        global.setTimeout = jest.fn((cb, delay) => {
            timeoutDelays.push(delay);
            cb();
            return timeoutDelays.length;
        });
        mod._setProjectId('old-project');
        global.document.querySelector = jest.fn(() => null);
        global.window.location.pathname = '/notebook/new-project';
        global.document.visibilityState = 'visible';

        mod.handleRouteChanged();

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(global.window.location.reload).toHaveBeenCalledTimes(1);
        expect(timeoutDelays.length).toBeGreaterThan(0);
        expect(timeoutDelays.every((delay) => delay === 400)).toBe(true);
    });

    it('tears down without reloading when the user leaves a notebook route', () => {
        const mockHost = {
            isConnected: true,
            remove: jest.fn()
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };

        mod._setProjectId('old-project');
        mod._setShadowRootForTest(mockShadowRoot);
        global.window.location.pathname = '/home';

        mod.handleRouteChanged();

        expect(global.window.location.reload).not.toHaveBeenCalled();
        expect(mockHost.remove).toHaveBeenCalled();
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'not_on_notebook_page'
        });
    });
});
