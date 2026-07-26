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

    function resolveNativeLabelSwitchResponseDelayTimer() {
        let timerId = 0;
        const timer = jest.fn((callback, delayMs) => {
            timerId += 1;
            if (delayMs === 180 && typeof callback === 'function') {
                callback();
            }
            return timerId;
        });
        global.setTimeout = timer;
        if (global.window) {
            global.window.setTimeout = timer;
        }
    }

    async function flushAsyncMessageResponse() {
        await Promise.resolve();
        await Promise.resolve();
    }

    async function flushUntil(predicate, limit = 40) {
        for (let index = 0; index < limit && !predicate(); index += 1) {
            await Promise.resolve();
        }
    }

    function createCompletePreferences(dragMode = 'classic') {
        return {
            developerModeEnabled: false,
            welcomeOnboardingSeenVersion: 0,
            whatsNewSeenVersion: '',
            historyRetentionLimit: 20,
            languageOverride: 'auto',
            dragMode,
            commandShortcuts: {},
            visibleQuickViewKinds: ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'],
            appearance: { hoverSpotlightEnabled: true }
        };
    }

    function seedPositionedSource(targetMod, sourceKey = 'source-a') {
        targetMod.state.root = [{ type: 'source', key: sourceKey }];
        targetMod.state.ungrouped = [];
        targetMod.sourcesByKey.set(sourceKey, {
            key: sourceKey,
            enabled: true,
            title: sourceKey,
            normalizedTitle: sourceKey,
            fingerprint: `${sourceKey}||article`,
            identityType: 'fingerprint'
        });
    }

    function createOnboardingShadowRoot() {
        const appendedNodes = [];
        const shadowRoot = {
            host: { isConnected: true, remove: jest.fn() },
            activeElement: null,
            appendChild: jest.fn((node) => {
                appendedNodes.push(node);
                node.parentNode = {
                    removeChild: jest.fn((child) => {
                        const index = appendedNodes.indexOf(child);
                        if (index >= 0) appendedNodes.splice(index, 1);
                        return child;
                    })
                };
                return node;
            }),
            getElementById: jest.fn((id) => appendedNodes.find((node) => node?.id === id) || null),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        return { appendedNodes, shadowRoot };
    }

    it('reports source_panel_missing when the notebook UI is unavailable', () => {
        mod._setProjectId('testproject');
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

        mod._setProjectId('testproject');
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

    it('renders the first-run welcome onboarding when the stored version is unseen', async () => {
        const originalRequestAnimationFrame = global.requestAnimationFrame;
        const { shadowRoot } = createOnboardingShadowRoot();

        global.requestAnimationFrame = jest.fn((callback) => {
            callback?.();
            return 1;
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES' && typeof cb === 'function') {
                cb({
                    success: true,
                    preferences: {
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 0
                    },
                    usageState: {
                        hasExistingPluginData: false,
                        hasStoredPreferences: false
                    }
                });
            }
        });

        try {
            mod._setShadowRootForTest(shadowRoot);

            await expect(mod.maybeRenderWelcomeOnboarding()).resolves.toBe(true);

            expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
                { type: 'LOAD_PREFERENCES' },
                expect.any(Function)
            );
            expect(shadowRoot.getElementById('sp-welcome-backdrop')).toBeTruthy();
            expect(shadowRoot.getElementById('sp-welcome-modal')).toBeTruthy();

            const appendCount = shadowRoot.appendChild.mock.calls.length;
            await expect(mod.maybeRenderWelcomeOnboarding()).resolves.toBe(false);
            expect(shadowRoot.appendChild).toHaveBeenCalledTimes(appendCount);
        } finally {
            if (originalRequestAnimationFrame) {
                global.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }
        }
    });

    it('shows only the welcome modal for a brand-new user and marks the current whats new version as seen', async () => {
        const originalRequestAnimationFrame = global.requestAnimationFrame;
        const { shadowRoot } = createOnboardingShadowRoot();
        const savedPreferences = [];
        global.requestAnimationFrame = jest.fn((callback) => {
            callback?.();
            return 1;
        });
        global.chrome.runtime.getManifest = jest.fn(() => ({ version: '2.7.4' }));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES' && typeof cb === 'function') {
                cb({
                    success: true,
                    preferences: {
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 0,
                        whatsNewSeenVersion: ''
                    },
                    usageState: {
                        hasExistingPluginData: false,
                        hasStoredPreferences: false
                    }
                });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES' && typeof cb === 'function') {
                savedPreferences.push(message.preferences);
                cb({
                    success: true,
                    preferences: Object.assign({
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 0,
                        whatsNewSeenVersion: ''
                    }, message.preferences)
                });
            }
        });

        try {
            mod._setShadowRootForTest(shadowRoot);

            await expect(mod.maybeRenderOnboardingModals()).resolves.toBe(true);

            expect(shadowRoot.getElementById('sp-welcome-modal')).toBeTruthy();
            expect(shadowRoot.getElementById('sp-whats-new-modal')).toBeFalsy();

            await mod.markWelcomeOnboardingSeen();

            expect(savedPreferences).toContainEqual({
                welcomeOnboardingSeenVersion: 1,
                whatsNewSeenVersion: '2.7.4'
            });
        } finally {
            if (originalRequestAnimationFrame) {
                global.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }
        }
    });

    it('skips welcome and shows whats new for an existing user with legacy unseen versions', async () => {
        const originalRequestAnimationFrame = global.requestAnimationFrame;
        const { shadowRoot } = createOnboardingShadowRoot();
        global.requestAnimationFrame = jest.fn((callback) => {
            callback?.();
            return 1;
        });
        global.chrome.runtime.getManifest = jest.fn(() => ({ version: '2.7.4' }));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES' && typeof cb === 'function') {
                cb({
                    success: true,
                    preferences: {
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 0,
                        whatsNewSeenVersion: 1
                    },
                    usageState: {
                        hasExistingPluginData: true,
                        hasStoredPreferences: false
                    }
                });
            }
        });

        try {
            mod._setShadowRootForTest(shadowRoot);

            await expect(mod.maybeRenderOnboardingModals()).resolves.toBe(true);

            expect(shadowRoot.getElementById('sp-welcome-modal')).toBeFalsy();
            expect(shadowRoot.getElementById('sp-whats-new-modal')).toBeTruthy();
        } finally {
            if (originalRequestAnimationFrame) {
                global.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }
        }
    });

    it('does not show whats new after the current manifest version has already been seen', async () => {
        const originalRequestAnimationFrame = global.requestAnimationFrame;
        const { shadowRoot } = createOnboardingShadowRoot();
        global.requestAnimationFrame = jest.fn((callback) => {
            callback?.();
            return 1;
        });
        global.chrome.runtime.getManifest = jest.fn(() => ({ version: '2.7.4' }));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES' && typeof cb === 'function') {
                cb({
                    success: true,
                    preferences: {
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 1,
                        whatsNewSeenVersion: '2.7.4'
                    },
                    usageState: {
                        hasExistingPluginData: true,
                        hasStoredPreferences: true
                    }
                });
            }
        });

        try {
            mod._setShadowRootForTest(shadowRoot);

            await expect(mod.maybeRenderOnboardingModals()).resolves.toBe(false);

            expect(shadowRoot.getElementById('sp-welcome-modal')).toBeFalsy();
            expect(shadowRoot.getElementById('sp-whats-new-modal')).toBeFalsy();
        } finally {
            if (originalRequestAnimationFrame) {
                global.requestAnimationFrame = originalRequestAnimationFrame;
            } else {
                delete global.requestAnimationFrame;
            }
        }
    });

    it('routes popup source view switch requests to NotebookLM native controls', async () => {
        const sendResponse = jest.fn();
        resolveNativeLabelSwitchResponseDelayTimer();
        let phase = 'list';
        const listSource = createMockSourceRow({
            title: 'Native List Source',
            stableToken: 'native-list-source',
            checked: true
        });
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelButton = {
            textContent: 'Label view',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                phase = 'label';
            }),
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
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [labelButton, listButton];
            if (phase === 'label' && (value.includes('source-label') || value.includes('label-group'))) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);
        await flushAsyncMessageResponse();

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            clicked: true
        }));
    });

    it('restores the persisted source view display kind after initial state load', () => {
        let phase = 'list';
        const { panel, header } = createMockPanel({ visible: true, contentVisible: true });
        const initHarness = createInitShadowRoot();
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelButton = {
            textContent: 'Label view',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                phase = 'label';
            }),
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
        const loadedState = {
            schemaVersion: 3,
            groups: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {},
            customHeight: null,
            sourceViewDisplayKind: 'label',
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        let firstDiv = true;

        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [labelButton, listButton];
            if (phase === 'label' && (value.includes('source-label') || value.includes('label-group'))) return [labelGroup];
            return [];
        });
        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.querySelectorAll = jest.fn((selector) => panel.querySelectorAll(selector));
        global.chrome.storage.local.get.mockImplementation((keys, cb) => {
            if (typeof cb === 'function') {
                cb({ ['sourcesPlusState_test-project']: loadedState });
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

        mod.syncManagerWithPanelLifecycle();

        expect(header.insertAdjacentElement).toHaveBeenCalledTimes(1);
        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(mod.getManagerStatus()).toMatchObject({
            sourceViewKind: 'label',
            sourceViewDisplayKind: 'label'
        });
    });

    it('clicks NotebookLM icon-only label view controls from popup requests', async () => {
        const sendResponse = jest.fn();
        resolveNativeLabelSwitchResponseDelayTimer();
        let phase = 'list';
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelIcon = {
            textContent: '',
            getAttribute: jest.fn((attr) => {
                if (attr === 'data-mat-icon-name') return 'label_auto';
                if (attr === 'class') return 'mat-icon material-symbols-rounded';
                return null;
            })
        };
        const labelButton = {
            textContent: '',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                phase = 'label';
            }),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '整理来源' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [labelIcon])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [labelButton];
            if (phase === 'label' && (value.includes('source-label') || value.includes('label-group'))) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);
        await flushAsyncMessageResponse();

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            nativeClicked: true
        }));
    });

    it('clicks the hidden native label-view entry point before showing plugin label mode', async () => {
        const sendResponse = jest.fn();
        resolveNativeLabelSwitchResponseDelayTimer();
        let phase = 'list';
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelButton = {
            textContent: 'label_auto 标签视图',
            disabled: false,
            style: {
                visibility: 'hidden'
            },
            __computedStyle: {
                visibility: 'hidden'
            },
            click: jest.fn(() => {
                phase = 'label';
            }),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '按主题自动为来源加标签' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [labelButton];
            if (phase === 'label' && (value.includes('source-label') || value.includes('label-group'))) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);
        await flushAsyncMessageResponse();

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            nativeClicked: true,
            nativeSwitchReason: 'clicked_hidden'
        }));
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('clicks the native label_auto header entry point when switching from plugin list display to label view', async () => {
        const sendResponse = jest.fn();
        resolveNativeLabelSwitchResponseDelayTimer();
        let phase = 'list';
        const listSource = createMockSourceRow({
            title: 'Native List Source',
            stableToken: 'native-list-source',
            checked: true
        });
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelRow = {
            tagName: 'DIV',
            textContent: 'label_auto Select all',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => (attr === 'class' ? 'row label-row' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelButton = {
            tagName: 'BUTTON',
            textContent: 'label_auto',
            disabled: false,
            parentElement: labelRow,
            parentNode: labelRow,
            style: {
                visibility: 'hidden'
            },
            __computedStyle: {
                visibility: 'hidden'
            },
            click: jest.fn(() => {
                phase = 'label';
            }),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'Auto-label your sources by topic';
                if (attr === 'aria-haspopup') return 'menu';
                if (attr === 'class') return 'mat-mdc-menu-trigger label-auto-button source-item-more-button';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn((selector) => (String(selector).includes('#sources-plus-root') ? null : null)),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        labelRow.parentElement = panel;
        labelRow.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) {
                return [labelButton];
            }
            if (phase === 'label' && (value.includes('source-label') || value.includes('label-group'))) {
                return [labelGroup];
            }
            if (mod.DEPS.row.includes(selector) || value.includes('source-row') || value.includes('source-item')) {
                return phase === 'list' ? [listSource.row] : [];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);
        await flushAsyncMessageResponse();

        expect(labelButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'label',
            nativeClicked: true,
            nativeSwitchReason: 'clicked_hidden',
            sourceViewDisplayKind: 'label'
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

    it('does not click source title rows that contain label-view keywords when switching to label view', () => {
        const sendResponse = jest.fn();
        const listSource = createMockSourceRow({
            title: 'AI theme report',
            stableToken: 'ai-theme-report',
            checked: true
        });
        const sourceTitleButton = {
            tagName: 'BUTTON',
            textContent: '',
            disabled: false,
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            click: jest.fn(),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI theme report';
                if (attr === 'class') return 'source-stretched-button ng-star-inserted';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        sourceTitleButton.parentElement = panel;
        sourceTitleButton.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [sourceTitleButton];
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return [listSource.row];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' }, {}, sendResponse);

        expect(sourceTitleButton.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            viewKind: 'label',
            nativeClicked: false,
            nativeSwitchReason: 'source_view_switch_control_missing',
            sourceViewDisplayKind: 'list'
        }));
    });

    it('falls back to plugin list display when the native label DOM does not expose a reliable list switch', async () => {
        const sendResponse = jest.fn();
        global.setTimeout = jest.fn((callback) => {
            callback();
            return 1;
        });
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
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
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [listButton];
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);
        await Promise.resolve();

        expect(listButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            nativeClicked: true,
            nativeSwitchReason: 'native_view_switch_not_confirmed',
            detectedSourceViewKind: 'label',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));
        expect(global.document.documentElement.classList.add).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('uses plugin list display when NotebookLM label view has no list-view button', () => {
        const sendResponse = jest.fn();
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelActionButton = {
            textContent: '撤销或重新为来源加标签',
            disabled: false,
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '撤销或重新为来源加标签' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [labelActionButton];
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
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
            nativeSwitchReason: 'source_view_switch_control_missing',
            detectedSourceViewKind: 'label',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));
        expect(global.document.documentElement.classList.add).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('does not click native label menu items when switching to plugin list display', () => {
        const sendResponse = jest.fn();
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const menuPanel = {
            tagName: 'DIV',
            textContent: 'Add new label Re-organise Return to list view',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'role') return 'menu';
                if (attr === 'class') return 'mat-mdc-menu-panel cdk-overlay-pane';
                return null;
            }),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const returnToListMenuItem = {
            tagName: 'BUTTON',
            textContent: 'Return to list view',
            disabled: false,
            parentElement: menuPanel,
            parentNode: menuPanel,
            style: {},
            __computedStyle: {},
            click: jest.fn(),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Return to list view' : null)),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        menuPanel.parentElement = panel;
        menuPanel.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [returnToListMenuItem];
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(returnToListMenuItem.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            nativeClicked: false,
            nativeSwitchReason: 'source_view_switch_control_missing',
            detectedSourceViewKind: 'label',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));
    });

    it('does not click native label menu launchers when switching to plugin list display', () => {
        const sendResponse = jest.fn();
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const menuLauncher = {
            tagName: 'BUTTON',
            textContent: 'Add new label Re-organise Return to list view',
            disabled: false,
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            click: jest.fn(),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'Source label actions';
                if (attr === 'aria-haspopup') return 'menu';
                if (attr === 'class') return 'mat-mdc-menu-trigger';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        menuLauncher.parentElement = panel;
        menuLauncher.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [menuLauncher];
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(menuLauncher.click).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            nativeClicked: false,
            nativeSwitchReason: 'source_view_switch_control_missing',
            detectedSourceViewKind: 'label',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));
    });

    it('uses the native label action menu return item when NotebookLM exposes list switch inside that menu', async () => {
        const sendResponse = jest.fn();
        const timers = [];
        global.setTimeout = jest.fn((callback) => {
            timers.push(callback);
            return timers.length;
        });
        if (global.window) {
            global.window.setTimeout = global.setTimeout;
        }

        let phase = 'label';
        let menuOpen = false;
        const listSource = createMockSourceRow({
            title: 'Returned List Source',
            stableToken: 'returned-list-doc',
            checked: true
        });
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelRow = {
            tagName: 'DIV',
            textContent: 'label_auto',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => (attr === 'class' ? 'row label-row' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const labelActionButton = {
            tagName: 'BUTTON',
            textContent: 'label_auto',
            disabled: false,
            parentElement: labelRow,
            parentNode: labelRow,
            style: {},
            __computedStyle: {},
            click: jest.fn(() => {
                menuOpen = true;
            }),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'Auto-label your sources by topic';
                if (attr === 'aria-haspopup') return 'menu';
                if (attr === 'class') return 'mat-mdc-menu-trigger label-auto-button source-item-more-button';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const menuPanel = {
            tagName: 'DIV',
            textContent: 'Add new label Re-organise Return to list view',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'role') return 'menu';
                if (attr === 'class') return 'mat-mdc-menu-panel cdk-overlay-pane';
                return null;
            }),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const returnToListMenuItem = {
            tagName: 'BUTTON',
            textContent: 'Return to list view',
            disabled: false,
            parentElement: menuPanel,
            parentNode: menuPanel,
            style: {},
            __computedStyle: {},
            click: jest.fn(() => {
                phase = 'list';
            }),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'Return to list view';
                if (attr === 'role') return 'menuitem';
                if (attr === 'class') return 'mat-mdc-menu-item';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button' || selector.includes('menuitem')),
            closest: jest.fn((selector) => (
                String(selector).includes('#sources-plus-root') ? null : menuPanel
            )),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        labelRow.parentElement = panel;
        labelRow.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]') || value.includes('[aria-label]')) {
                return phase === 'label' ? [labelActionButton] : [];
            }
            if (value.includes('source-label') || value.includes('label-group')) {
                return phase === 'label' ? [labelGroup] : [];
            }
            if (mod.DEPS.row.includes(selector) || value.includes('source')) {
                return phase === 'list' ? [listSource.row] : [];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.querySelectorAll = jest.fn(() => (menuOpen ? [returnToListMenuItem] : []));

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);
        await flushAsyncMessageResponse();

        expect(labelActionButton.click).toHaveBeenCalledTimes(1);
        expect(returnToListMenuItem.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            nativeClicked: true,
            nativeSwitchReason: 'clicked_label_menu_return_to_list',
            detectedSourceViewKind: 'list',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list'
        }));
    });

    it('waits for NotebookLM async DOM changes before confirming a popup list-view switch', async () => {
        const sendResponse = jest.fn();
        const timers = [];
        global.setTimeout = jest.fn((callback) => {
            timers.push(callback);
            return timers.length;
        });

        let phase = 'label';
        const listSource = createMockSourceRow({
            title: 'Async List Source',
            stableToken: 'async-list-doc',
            checked: true
        });
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const listButton = {
            textContent: 'List view',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                global.setTimeout(() => {
                    phase = 'list';
                }, 25);
            }),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'List view' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [listButton];
            if (value.includes('source-label') || value.includes('label-group')) {
                return phase === 'label' ? [labelGroup] : [];
            }
            if (mod.DEPS.row.includes(selector) || value.includes('source')) {
                return phase === 'list' ? [listSource.row] : [];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        const result = mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(result).toBe(true);
        expect(sendResponse).not.toHaveBeenCalled();

        for (let i = 0; i < 10 && !sendResponse.mock.calls.length; i++) {
            const nextTimer = timers.shift();
            if (nextTimer) nextTimer();
            await Promise.resolve();
        }

        expect(listButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            sourceViewDisplayKind: 'list',
            confirmedSourceViewKind: 'list'
        }));
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

    it('uses plugin list display when NotebookLM is still exposing label-view controls', () => {
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
            nativeSwitchReason: 'source_view_switch_control_missing',
            detectedSourceViewKind: 'label',
            confirmedSourceViewKind: 'list',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));
        expect(global.document.documentElement.classList.add).toHaveBeenCalledWith('sources-plus-manager-active');
    });

    it('syncs plugin source checkbox changes while list display is covering native label DOM', () => {
        const sendResponse = jest.fn();
        const nativeSource = createMockSourceRow({ title: 'Hidden Label Source', stableToken: 'hidden-label-doc', checked: true });
        nativeSource.row.__nativeLabelTitle = 'AI Group';
        const labelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        nativeSource.row.parentElement = labelGroup;
        nativeSource.row.parentNode = labelGroup;
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
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) return [relabelControl];
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return [nativeSource.row];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.body.contains = jest.fn(() => true);

        mod.scanAndSyncSources({}, true);
        const [sourceKey] = Array.from(mod.sourcesByKey.keys());
        expect(sourceKey).toBeTruthy();

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list',
            detectedSourceViewKind: 'label',
            sourceViewDisplayKind: 'list',
            displayOverride: true
        }));

        const source = mod.sourcesByKey.get(sourceKey);
        source.enabled = false;
        expect(mod.syncSourceToPage(source, false)).toBe(true);

        expect(nativeSource.checkbox.click).toHaveBeenCalledTimes(1);
        expect(mod.getDiagnosticsInfo().lastNativeSelectionSyncFailure).toBe(null);
    });

    it('captures collapsed label group selection before switching the native view back to list', () => {
        const sendResponse = jest.fn();
        let phase = 'initial-label';
        const initialFirst = createMockSourceRow({ title: 'First Paper', stableToken: 'doc-1', checked: true });
        const initialSecond = createMockSourceRow({ title: 'Second Paper', stableToken: 'doc-2', checked: true });
        initialFirst.row.__nativeLabelTitle = 'AI Group';
        initialSecond.row.__nativeLabelTitle = 'AI Group';
        const expandedLabelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        initialFirst.row.parentElement = expandedLabelGroup;
        initialFirst.row.parentNode = expandedLabelGroup;
        initialSecond.row.parentElement = expandedLabelGroup;
        initialSecond.row.parentNode = expandedLabelGroup;

        const groupCheckbox = {
            checked: false,
            parentElement: null,
            parentNode: null,
            style: {},
            getAttribute: jest.fn(() => null),
            matches: jest.fn(() => false)
        };
        const collapsedLabelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn((selector) => (String(selector).includes('checkbox') ? groupCheckbox : null)),
            querySelectorAll: jest.fn((selector) => (String(selector).includes('checkbox') ? [groupCheckbox] : []))
        };
        groupCheckbox.parentElement = collapsedLabelGroup;
        groupCheckbox.parentNode = collapsedLabelGroup;

        const listFirst = createMockSourceRow({ title: 'First Paper', stableToken: 'doc-1', checked: true });
        const listSecond = createMockSourceRow({ title: 'Second Paper', stableToken: 'doc-2', checked: true });
        const listButton = {
            textContent: 'List view',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                phase = 'list';
            }),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'List view' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        expandedLabelGroup.parentElement = panel;
        expandedLabelGroup.parentNode = panel;
        collapsedLabelGroup.parentElement = panel;
        collapsedLabelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) {
                return phase === 'collapsed-label' ? [listButton] : [];
            }
            if (value.includes('source-label') || value.includes('label-group')) {
                if (phase === 'initial-label') return [expandedLabelGroup];
                if (phase === 'collapsed-label') return [collapsedLabelGroup];
                return [];
            }
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                if (phase === 'initial-label') return [initialFirst.row, initialSecond.row];
                if (phase === 'list') return [listFirst.row, listSecond.row];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);
        const sourceKeys = Array.from(mod.sourcesByKey.keys());
        expect(sourceKeys).toHaveLength(2);
        mod.groupsById.set('ai-group', {
            id: 'ai-group',
            title: 'AI Group',
            nativeLabelTitle: 'AI Group',
            children: sourceKeys.map((key) => ({ type: 'source', key })),
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['ai-group'];
        mod.state.ungrouped = [];
        phase = 'collapsed-label';

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);

        expect(listButton.click).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            viewKind: 'list'
        }));
        sourceKeys.forEach((sourceKey) => {
            expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        });
        expect(listFirst.checkbox.click).toHaveBeenCalledTimes(1);
    });

    it('captures collapsed label group selection before direct native list clicks while a view switch is in progress', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const first = createMockSourceRow({ title: 'First Paper', stableToken: 'doc-1', checked: false });
        const second = createMockSourceRow({ title: 'Second Paper', stableToken: 'doc-2', checked: false });
        first.row.__nativeLabelTitle = 'AI Group';
        second.row.__nativeLabelTitle = 'AI Group';
        const expandedLabelGroup = {
            textContent: 'AI Group',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        first.row.parentElement = expandedLabelGroup;
        first.row.parentNode = expandedLabelGroup;
        second.row.parentElement = expandedLabelGroup;
        second.row.parentNode = expandedLabelGroup;

        const groupCheckbox = {
            tagName: 'INPUT',
            type: 'checkbox',
            checked: true,
            parentElement: null,
            parentNode: null,
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'type' ? 'checkbox' : null)),
            matches: jest.fn((selector) => String(selector).includes('checkbox')),
            closest: jest.fn(() => null)
        };
        const collapsedLabelGroup = {
            textContent: 'AI Group',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn((selector) => (String(selector).includes('checkbox') ? groupCheckbox : null)),
            querySelectorAll: jest.fn((selector) => (String(selector).includes('checkbox') ? [groupCheckbox] : []))
        };
        groupCheckbox.parentElement = collapsedLabelGroup;
        groupCheckbox.parentNode = collapsedLabelGroup;

        const listButton = {
            tagName: 'BUTTON',
            textContent: 'view_list',
            disabled: false,
            parentElement: panel,
            parentNode: panel,
            style: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'List view';
                if (attr === 'data-testid') return 'source-view-list-button';
                return null;
            }),
            matches: jest.fn((selector) => selector === 'button'),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };

        let phase = 'expanded-label';
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) {
                return phase === 'expanded-label' ? [expandedLabelGroup] : [collapsedLabelGroup];
            }
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return phase === 'expanded-label' ? [first.row, second.row] : [];
            }
            return [];
        });

        mod.scanAndSyncSources({}, true);
        const sourceKeys = Array.from(mod.sourcesByKey.keys());
        sourceKeys.forEach((sourceKey) => {
            expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        });

        phase = 'collapsed-label';
        mod._setViewSwitchInProgressForTest(true);
        mod._handleNativeSourceViewSwitchClickForTest({ target: listButton });

        sourceKeys.forEach((sourceKey) => {
            expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(true);
        });
    });

    it('keeps collapsed label group changes made while initial restore is deferred', () => {
        const sendResponse = jest.fn();
        let phase = 'empty';
        const sourceKey = 'source_id_doc-1';
        const loadedState = {
            schemaVersion: 3,
            groups: ['native-label-group'],
            groupsById: {
                'native-label-group': {
                    id: 'native-label-group',
                    title: 'Imported Label Folder',
                    nativeLabelTitle: 'AI Group',
                    children: [{ type: 'source', key: sourceKey }],
                    enabled: true,
                    collapsed: false
                }
            },
            ungrouped: [],
            sourceStateById: {
                [sourceKey]: {
                    enabled: true,
                    title: 'Deferred Label Source',
                    normalizedTitle: 'deferred label source',
                    stableToken: 'doc-1',
                    nativeLabelTitle: 'AI Group',
                    fingerprint: 'deferred label source||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        const groupCheckbox = {
            tagName: 'INPUT',
            type: 'checkbox',
            checked: false,
            parentElement: null,
            parentNode: null,
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'type' ? 'checkbox' : null)),
            matches: jest.fn((selector) => String(selector).includes('checkbox')),
            closest: jest.fn(() => null)
        };
        const collapsedLabelGroup = {
            textContent: 'AI Group',
            parentElement: null,
            parentNode: null,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn((selector) => (String(selector).includes('checkbox') ? groupCheckbox : null)),
            querySelectorAll: jest.fn((selector) => (String(selector).includes('checkbox') ? [groupCheckbox] : []))
        };
        groupCheckbox.parentElement = collapsedLabelGroup;
        groupCheckbox.parentNode = collapsedLabelGroup;

        const listSource = createMockSourceRow({ title: 'Deferred Label Source', stableToken: 'doc-1', checked: true });
        const listButton = {
            textContent: 'List view',
            disabled: false,
            style: {},
            click: jest.fn(() => {
                phase = 'list';
            }),
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'List view' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        collapsedLabelGroup.parentElement = panel;
        collapsedLabelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('button') || value.includes('[role="button"]')) {
                return phase === 'collapsed-label' ? [listButton] : [];
            }
            if (value.includes('source-label') || value.includes('label-group')) {
                return phase === 'collapsed-label' ? [collapsedLabelGroup] : [];
            }
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return phase === 'list' ? [listSource.row] : [];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.querySelectorAll = jest.fn((selector) => panel.querySelectorAll(selector));

        expect(mod.restoreInitialLoadedState(loadedState)).toEqual({
            deferred: true,
            shouldUpgradeStorage: false
        });
        mod._setAwaitingInitialStateLoadForTest(true);
        phase = 'collapsed-label';

        mod._handleNativeCheckboxChangeForTest({ target: groupCheckbox });

        expect(mod._getPendingInitialLoadedState().sourceStateById[sourceKey].enabled).toBe(false);

        mod.handleManagerMessage({ type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' }, {}, sendResponse);
        mod._completeInitialStateLoadForTest();

        expect(listButton.click).toHaveBeenCalledTimes(1);
        expect(mod._getPendingInitialLoadedState()).toBe(null);
        const restoredSource = Array.from(mod.sourcesByKey.values())
            .find((source) => source.title === 'Deferred Label Source');
        expect(restoredSource?.enabled).toBe(false);
        expect(listSource.checkbox.click).toHaveBeenCalledTimes(1);
    });

    it('observes native checkbox state attributes inside the source panel', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const initHarness = createInitShadowRoot();
        let firstDiv = true;

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({ extensionHost: null, shadowRoot: null });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
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
                replaceChildren: jest.fn(),
                cloneNode: jest.fn(function cloneNode() { return this; }),
                setAttribute: jest.fn(),
                getAttribute: jest.fn(() => null),
                addEventListener: jest.fn(),
                remove: jest.fn(),
                classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
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

        const sourceObserver = global.__mutationObserverInstances.find((observer) => (
            observer.observe.mock.calls.some(([target]) => target === panel || target === mod._getObservedNativeScrollAreaForTest())
        ));
        const observeOptions = sourceObserver?.observe.mock.calls.find(([target]) => (
            target === panel || target === mod._getObservedNativeScrollAreaForTest()
        ))?.[1];

        expect(observeOptions?.attributeFilter).toEqual(expect.arrayContaining(['aria-checked', 'checked']));
    });

    it('syncs collapsed native label group checkbox changes from native change events', async () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const first = createMockSourceRow({ title: 'First Paper', stableToken: 'doc-1', checked: true });
        const second = createMockSourceRow({ title: 'Second Paper', stableToken: 'doc-2', checked: true });
        first.row.__nativeLabelTitle = 'AI Group';
        second.row.__nativeLabelTitle = 'AI Group';
        const expandedLabelGroup = {
            textContent: 'AI Group',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        first.row.parentElement = expandedLabelGroup;
        first.row.parentNode = expandedLabelGroup;
        second.row.parentElement = expandedLabelGroup;
        second.row.parentNode = expandedLabelGroup;

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [expandedLabelGroup];
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return [first.row, second.row];
            }
            return [];
        });

        mod.scanAndSyncSources({}, true);
        const sourceKeys = Array.from(mod.sourcesByKey.keys());
        mod.groupsById.set('ai-group', {
            id: 'ai-group',
            title: 'AI Group',
            nativeLabelTitle: 'AI Group',
            children: sourceKeys.map((key) => ({ type: 'source', key })),
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['ai-group'];
        mod.state.ungrouped = [];
        global.chrome.runtime.sendMessage.mockClear();

        const groupCheckbox = {
            tagName: 'INPUT',
            type: 'checkbox',
            checked: false,
            parentElement: null,
            parentNode: null,
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'type' ? 'checkbox' : null)),
            matches: jest.fn((selector) => String(selector).includes('checkbox')),
            closest: jest.fn(() => null)
        };
        const collapsedLabelGroup = {
            textContent: 'AI Group',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'AI Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn((selector) => (String(selector).includes('checkbox') ? groupCheckbox : null)),
            querySelectorAll: jest.fn((selector) => (String(selector).includes('checkbox') ? [groupCheckbox] : []))
        };
        groupCheckbox.parentElement = collapsedLabelGroup;
        groupCheckbox.parentNode = collapsedLabelGroup;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [collapsedLabelGroup];
            return [];
        });

        mod._handleNativeCheckboxChangeForTest({ target: groupCheckbox });
        await mod.waitForPendingStateSave();

        sourceKeys.forEach((sourceKey) => {
            expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        });
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                key: 'sourcesPlusState_test-project'
            }),
            expect.any(Function)
        );
    });

    it('syncs list row native checkbox changes from ARIA checkbox state', async () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const source = createMockSourceRow({ title: 'ARIA Native Source', stableToken: 'aria-native-doc', checked: true });
        source.row.nodeType = 1;
        source.row.matches = jest.fn((selector) => mod.DEPS.row.includes(selector));
        source.row.closest = jest.fn(() => null);
        source.checkbox.tagName = 'DIV';
        source.checkbox.matches = jest.fn((selector) => String(selector).includes('checkbox'));
        source.checkbox.closest = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? source.row : null
        ));
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [source.row] : []
        ));
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod._setProjectId('test-project');
        mod.scanAndSyncSources({}, true);
        const [sourceKey] = Array.from(mod.sourcesByKey.keys());
        const virtualCheckbox = { checked: true };
        mod._setShadowRootForTest({
            querySelector: jest.fn((selector) => (
                String(selector).includes(sourceKey) ? virtualCheckbox : null
            ))
        });
        global.chrome.runtime.sendMessage.mockClear();

        source.checkbox.checked = undefined;
        source.checkbox.getAttribute = jest.fn((attr) => {
            if (attr === 'role') return 'checkbox';
            if (attr === 'aria-checked') return 'false';
            if (attr === 'aria-label') return 'ARIA Native Source';
            return null;
        });

        mod._handleNativeCheckboxChangeForTest({ target: source.checkbox });
        await mod.waitForPendingStateSave();

        expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        expect(virtualCheckbox.checked).toBe(false);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                key: 'sourcesPlusState_test-project'
            }),
            expect.any(Function)
        );
    });

    it('does not run label-group sync for list-view native checkbox changes', async () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const source = createMockSourceRow({ title: 'List Source', stableToken: 'doc-1', checked: true });
        source.row.nodeType = 1;
        source.row.matches = jest.fn((selector) => mod.DEPS.row.includes(selector));
        source.row.closest = jest.fn(() => null);
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [source.row] : []
        ));
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod._setProjectId('test-project');
        mod.scanAndSyncSources({}, true);
        global.chrome.runtime.sendMessage.mockClear();

        const nativeCheckbox = {
            tagName: 'INPUT',
            type: 'checkbox',
            checked: false,
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => (attr === 'type' ? 'checkbox' : null)),
            matches: jest.fn((selector) => String(selector).includes('checkbox')),
            closest: jest.fn(() => null)
        };

        mod._handleNativeCheckboxChangeForTest({ target: nativeCheckbox });
        await mod.waitForPendingStateSave();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SAVE_STATE',
                key: 'sourcesPlusState_test-project'
            }),
            expect.any(Function)
        );
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

    it('resets isDeletingSources when the content instance is torn down', () => {
        mod._setIsDeletingSources(true);
        expect(mod._getIsDeletingSources()).toBe(true);

        mod._destroyContentInstanceForTest();

        expect(mod._getIsDeletingSources()).toBe(false);
    });

    it('steps the panel height for keyboard resize, clamped to the view minimum', () => {
        expect(mod._resolveKeyboardResizeHeightForTest(300, 'ArrowDown', 150)).toBe(316);
        expect(mod._resolveKeyboardResizeHeightForTest(300, 'ArrowUp', 150)).toBe(284);
        expect(mod._resolveKeyboardResizeHeightForTest(150, 'ArrowUp', 150)).toBe(150);
        expect(mod._resolveKeyboardResizeHeightForTest(160, 'ArrowUp', 150)).toBe(150);
        expect(mod._resolveKeyboardResizeHeightForTest(NaN, 'ArrowDown', 150)).toBe(166);
        expect(mod._resolveKeyboardResizeHeightForTest(300, 'Enter', 150)).toBeNull();
    });

    it('flushes a pending save before DISABLE_MANAGER removes the host and responds immediately', () => {
        const events = [];
        const mockHost = {
            isConnected: true,
            remove: jest.fn(() => events.push('host_removed'))
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };
        const sendResponse = jest.fn();
        let settleSave;

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({
            extensionHost: mockHost,
            shadowRoot: mockShadowRoot
        });
        mod._setExtensionEnabledForTest(true);
        mod.state.ungrouped = ['source-1'];
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source 1',
            enabled: true
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'SAVE_STATE') {
                events.push('save_dispatched');
                settleSave = cb;
            }
        });
        mod.saveState();

        mod.handleManagerMessage({ type: 'DISABLE_MANAGER' }, {}, sendResponse);

        expect(events).toEqual(['save_dispatched', 'host_removed']);
        expect(typeof settleSave).toBe('function');
        expect(mockHost.remove).toHaveBeenCalledTimes(1);
        expect(global.document.documentElement.classList.remove).toHaveBeenCalledWith('sources-plus-manager-active');
        expect(mod._getExtensionEnabledForTest()).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            disabled: true,
            saveStarted: true
        });
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        mod._handleInteractionForTest({
            target: {
                checked: false,
                dataset: { sourceKey: 'source-1' },
                classList: {
                    contains: jest.fn((className) => className === 'sp-checkbox')
                },
                closest: jest.fn(() => null)
            }
        });

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(mod.getManagerStatus()).toEqual({
            ready: false,
            reason: 'extension_disabled'
        });
    });

    it('flushes a pending save before test destroy removes the host', () => {
        const events = [];
        const mockHost = {
            isConnected: true,
            remove: jest.fn(() => events.push('host_removed'))
        };
        const mockShadowRoot = {
            host: mockHost,
            querySelector: jest.fn(() => null)
        };

        mod._setProjectId('test-project');
        mod._setManagerRuntimeForTest({
            extensionHost: mockHost,
            shadowRoot: mockShadowRoot
        });
        mod.state.ungrouped = ['source-1'];
        mod.sourcesByKey.set('source-1', {
            key: 'source-1',
            title: 'Source 1',
            enabled: true
        });
        global.chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message?.type === 'SAVE_STATE') {
                events.push('save_dispatched');
            }
        });
        mod.saveState();

        mod._destroyContentInstanceForTest();

        expect(events).toEqual(['save_dispatched', 'host_removed']);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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
            [
                'sourcesPlusState_test-project',
                'sourcesPlusState_test-project__backup',
                'sourcesPlusHistory_test-project'
            ],
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
        // v5: loadState normalizes the stored v3 shape — groups -> root, schemaVersion -> 5.
        const expectedLoadedState = {
            ...loadedState,
            schemaVersion: 5,
            root: [{ type: 'group', id: 'group1' }],
            customHeight: null
        };
        delete expectedLoadedState.groups;

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
            [
                'sourcesPlusState_test-project',
                'sourcesPlusState_test-project__backup',
                'sourcesPlusHistory_test-project'
            ],
            expect.any(Function)
        );
    });

    it('reopens from the in-memory panel snapshot before falling back to storage', async () => {
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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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
            root: [{ type: 'group', id: 'group1' }]
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
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
                return;
            }
            cb?.({});
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
        await flushUntil(() => global.chrome.runtime.sendMessage.mock.calls
            .some(([message]) => message?.type === 'SAVE_STATE'));

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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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
            root: [{ type: 'group', id: 'group1' }]
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

    it('restores the pending snapshot after returning from a source-detail view without reloading storage', async () => {
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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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
            root: [{ type: 'group', id: 'group1' }]
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
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
                return;
            }
            cb?.({});
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
        await flushUntil(() => global.chrome.runtime.sendMessage.mock.calls
            .some(([message]) => message?.type === 'SAVE_STATE'));

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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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

    it('restores from the pending snapshot after returning from a zero-row source-detail view', async () => {
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
        mod.state.root = [{ type: 'group', id: 'group1' }];
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
            root: [{ type: 'group', id: 'group1' }]
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
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
                return;
            }
            cb?.({});
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
        await flushUntil(() => global.chrome.runtime.sendMessage.mock.calls
            .some(([message]) => message?.type === 'SAVE_STATE'));

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
            [
                'sourcesPlusState_fresh-project',
                'sourcesPlusState_fresh-project__backup',
                'sourcesPlusHistory_fresh-project'
            ],
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

    it('checkpoints and critically saves a positioned root source through the shared Classic invariant', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [
            { type: 'group', id: 'group-a' },
            { type: 'source', key: 'source-a' }
        ];
        mod.state.ungrouped = [];
        mod.groupsById.set('group-a', { id: 'group-a', title: 'A', children: [] });
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            stableToken: 'source-a-token',
            fingerprint: 'source a||article',
            identityType: 'stable-token'
        });
        global.chrome.runtime.sendMessage.mockClear();

        const result = await mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });

        expect(result).toEqual({ changed: true, saved: true });
        expect(mod.state.root).toEqual([{ type: 'group', id: 'group-a' }]);
        expect(mod.state.ungrouped).toEqual(['source-a']);
        const runtimeMessages = global.chrome.runtime.sendMessage.mock.calls.map(([message]) => message);
        const checkpointIndex = runtimeMessages.findIndex((message) => message.type === 'APPEND_STATE_HISTORY');
        const saveIndex = runtimeMessages.findIndex((message) => message.type === 'SAVE_STATE');
        expect(checkpointIndex).toBeGreaterThanOrEqual(0);
        expect(saveIndex).toBeGreaterThan(checkpointIndex);
        expect(runtimeMessages[checkpointIndex]).toMatchObject({
            type: 'APPEND_STATE_HISTORY',
            entry: {
                reason: 'before_classic_mode_sweep',
                snapshot: {
                    root: [
                        { type: 'group', id: 'group-a' },
                        { type: 'source', key: 'source-a' }
                    ]
                }
            }
        });
        expect(runtimeMessages[saveIndex]).toMatchObject({
            type: 'SAVE_STATE',
            critical: true
        });
        expect(global.sessionStorage.setItem).toHaveBeenCalledWith(
            'sourcesPlusRecovery_notebook-a',
            expect.stringContaining('"reason":"classic_mode_root_sweep"')
        );
    });

    it('does not mutate or save when the notebook changes while the Classic checkpoint is pending', async () => {
        let settleCheckpoint;
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            stableToken: 'source-a-token',
            fingerprint: 'source a||article',
            identityType: 'stable-token'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: {
                        developerModeEnabled: false,
                        welcomeOnboardingSeenVersion: 0,
                        whatsNewSeenVersion: '',
                        historyRetentionLimit: 20,
                        languageOverride: 'auto',
                        dragMode: 'classic',
                        commandShortcuts: {},
                        visibleQuickViewKinds: ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues'],
                        appearance: { hoverSpotlightEnabled: true }
                    }
                });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                settleCheckpoint = cb;
            }
        });
        const beforeState = JSON.stringify({
            root: mod.state.root,
            ungrouped: mod.state.ungrouped
        });

        const pendingInvariant = mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });
        for (let index = 0; index < 30 && !settleCheckpoint; index += 1) {
            await Promise.resolve();
        }
        expect(settleCheckpoint).toEqual(expect.any(Function));

        mod._setProjectId('notebook-b');
        settleCheckpoint({ success: true, history: [] });

        await expect(pendingInvariant).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'stale_instance'
        });
        expect(JSON.stringify({
            root: mod.state.root,
            ungrouped: mod.state.ungrouped
        })).toBe(beforeState);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('routes normal load, deferred flush, panel reattach, and mode change through one invariant', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '../../src/content/index.js'),
            'utf8'
        );

        [
            'normal_load',
            'deferred_flush',
            'panel_reattach',
            'mode_change'
        ].forEach((trigger) => {
            expect(source).toContain(`trigger: '${trigger}'`);
        });
        expect(source.match(/treeInteractionsModule\.sweepPositionedRootSourcesToBin\(/g)).toHaveLength(1);
    });

    it('waits for verified reflow preferences and leaves positioned root sources unchanged', async () => {
        let settlePreferences;
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settlePreferences = cb;
            }
        });

        const pendingInvariant = mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });
        await flushUntil(() => Boolean(settlePreferences));

        expect(mod.state.root).toEqual([{ type: 'source', key: 'source-a' }]);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'APPEND_STATE_HISTORY' }),
            expect.any(Function)
        );

        settlePreferences({
            success: true,
            preferences: createCompletePreferences('reflow')
        });
        await expect(pendingInvariant).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'not_classic'
        });
        expect(mod.state.root).toEqual([{ type: 'source', key: 'source-a' }]);
    });

    it('fails closed when Classic is only an unverified in-memory default', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
            }
        });

        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'preferences_unverified'
        });
        expect(mod.state.root).toEqual([{ type: 'source', key: 'source-a' }]);
        expect(mod.state.ungrouped).toEqual([]);
    });

    it('sweeps each notebook independently and repeated finalization is idempotent', async () => {
        const seedPositionedSource = (sourceKey) => {
            mod.state.root = [{ type: 'source', key: sourceKey }];
            mod.state.ungrouped = [];
            mod.sourcesByKey.clear();
            mod.sourcesByKey.set(sourceKey, {
                key: sourceKey,
                enabled: true,
                title: sourceKey,
                normalizedTitle: sourceKey,
                fingerprint: `${sourceKey}||article`,
                identityType: 'fingerprint'
            });
        };
        mod._setProjectId('notebook-a');
        seedPositionedSource('source-a');
        global.chrome.runtime.sendMessage.mockClear();

        const token = mod._getActiveManagerInstanceTokenForTest();
        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: token
        })).resolves.toEqual({ changed: true, saved: true });
        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: token
        })).resolves.toEqual({ changed: false, saved: false });

        mod._setProjectId('notebook-b');
        seedPositionedSource('source-b');
        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-b',
            instanceToken: token
        })).resolves.toEqual({ changed: true, saved: true });

        const saveMessages = global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE');
        expect(saveMessages).toHaveLength(2);
        expect(saveMessages.map((message) => message.key)).toEqual([
            'sourcesPlusState_notebook-a',
            'sourcesPlusState_notebook-b'
        ]);
        expect(mod.state.root).toEqual([]);
        expect(mod.state.ungrouped).toEqual(['source-b']);
    });

    it('keeps state byte-for-byte unchanged when the pre-sweep checkpoint fails', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences() });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: false, errorCode: 'history_write_failed' });
            }
        });
        const beforeSnapshot = JSON.stringify(mod.buildPersistableState());

        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'checkpoint_failed'
        });

        expect(JSON.stringify(mod.buildPersistableState())).toBe(beforeSnapshot);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('keeps failed critical-save recovery and clears it after a later successful sweep', async () => {
        let rejectSave = true;
        const seedPositionedSource = (sourceKey) => {
            mod.state.root = [{ type: 'source', key: sourceKey }];
            mod.state.ungrouped = [];
            mod.sourcesByKey.clear();
            mod.sourcesByKey.set(sourceKey, {
                key: sourceKey,
                enabled: true,
                title: sourceKey,
                normalizedTitle: sourceKey,
                fingerprint: `${sourceKey}||article`,
                identityType: 'fingerprint'
            });
        };
        mod._setProjectId('notebook-a');
        seedPositionedSource('source-a');
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences() });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.(rejectSave
                    ? { success: false, errorCode: 'runtime_failure' }
                    : { success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
            }
        });

        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: true,
            saved: false,
            reason: 'runtime_failure'
        });
        expect(JSON.parse(global.sessionStorage.getItem('sourcesPlusRecovery_notebook-a'))).toMatchObject({
            failed: true,
            reason: 'runtime_failure'
        });

        rejectSave = false;
        seedPositionedSource('source-b');
        await expect(mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({ changed: true, saved: true });
        expect(global.sessionStorage.getItem('sourcesPlusRecovery_notebook-a')).toBeNull();
    });

    it('uses a complete successful preference SAVE as proof after the initial LOAD failed', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
            }
        });

        await mod._ensureDeveloperPreferencesLoadedForTest();
        await expect(mod._applyDragModeChangeForTest('classic')).resolves.toBe('classic');

        expect(mod.state.root).toEqual([]);
        expect(mod.state.ungrouped).toEqual(['source-a']);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE', critical: true }),
            expect.any(Function)
        );
    });

    it('does not let an older preference LOAD overwrite a completed Classic SAVE', async () => {
        let settlePreferenceLoad;
        mod._setProjectId('notebook-a');
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                settlePreferenceLoad = cb;
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: createCompletePreferences('classic')
                });
            }
        });

        const pendingLoad = mod._ensureDeveloperPreferencesLoadedForTest();
        await flushUntil(() => Boolean(settlePreferenceLoad));
        const pendingChange = mod._applyDragModeChangeForTest('classic');
        await flushUntil(() => global.chrome.runtime.sendMessage.mock.calls
            .some(([message]) => message?.type === 'SAVE_PREFERENCES'));

        settlePreferenceLoad({
            success: true,
            preferences: createCompletePreferences('reflow')
        });

        await expect(pendingChange).resolves.toBe('classic');
        await pendingLoad;
        expect(mod._getDragModeForTest()).toBe('classic');
    });

    it('rejects a Classic mode change and restores reflow when the invariant checkpoint fails', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: createCompletePreferences(message.preferences?.dragMode)
                });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: false, errorCode: 'history_write_failed' });
            }
        });

        await mod._ensureDeveloperPreferencesLoadedForTest();

        await expect(mod._applyDragModeChangeForTest('classic'))
            .rejects.toThrow('checkpoint_failed');
        expect(mod._getDragModeForTest()).toBe('reflow');
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_PREFERENCES'))
            .toHaveLength(2);
    });

    it('rejects a Classic mode change when preferences remain unverified', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({ success: true });
                return;
            }
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
            }
        });

        await expect(mod._applyDragModeChangeForTest('classic'))
            .rejects.toThrow('preferences_unverified');
    });

    it('rejects a Classic mode change bound to a notebook that becomes stale during preference save', async () => {
        let settleClassicPreferenceSave;
        let preferenceSaveCount = 0;
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                preferenceSaveCount += 1;
                if (preferenceSaveCount === 1) {
                    settleClassicPreferenceSave = cb;
                } else {
                    cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                }
            }
        });
        await mod._ensureDeveloperPreferencesLoadedForTest();

        const pendingChange = mod._applyDragModeChangeForTest('classic');
        await flushUntil(() => Boolean(settleClassicPreferenceSave));
        mod._setProjectId('notebook-b');
        settleClassicPreferenceSave({
            success: true,
            preferences: createCompletePreferences('classic')
        });

        await expect(pendingChange).rejects.toThrow('stale_instance');
        expect(mod._getDragModeForTest()).toBe('reflow');
    });

    it('rejects and rolls back a Classic mode change when the sweep fails', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        mod._setClassicSweepForTest(() => false);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: createCompletePreferences(message.preferences?.dragMode)
                });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
            }
        });
        await mod._ensureDeveloperPreferencesLoadedForTest();

        await expect(mod._applyDragModeChangeForTest('classic'))
            .rejects.toThrow('sweep_failed');
        expect(mod._getDragModeForTest()).toBe('reflow');
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(0);
    });

    it('rejects and rolls back a Classic mode change when the migration save fails', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: createCompletePreferences(message.preferences?.dragMode)
                });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
            }
        });
        await mod._ensureDeveloperPreferencesLoadedForTest();

        await expect(mod._applyDragModeChangeForTest('classic'))
            .rejects.toThrow('runtime_failure');
        expect(mod._getDragModeForTest()).toBe('reflow');
    });

    it('reports rollback failure and keeps the actual Classic mode after invariant rejection', async () => {
        let preferenceSaveCount = 0;
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                preferenceSaveCount += 1;
                cb?.(preferenceSaveCount === 1
                    ? {
                        success: true,
                        preferences: createCompletePreferences('classic')
                    }
                    : { success: false, errorCode: 'runtime_failure' });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: false, errorCode: 'history_write_failed' });
            }
        });
        await mod._ensureDeveloperPreferencesLoadedForTest();

        let failure;
        try {
            await mod._applyDragModeChangeForTest('classic');
        } catch (error) {
            failure = error;
        }

        expect(failure).toMatchObject({
            code: 'checkpoint_failed',
            rollbackFailed: true,
            dragMode: 'classic'
        });
        expect(mod._getDragModeForTest()).toBe('classic');
    });

    it.each([
        ['classic', 'reflow', []],
        ['reflow', 'classic', [{ type: 'source', key: 'source-a' }]]
    ])('keeps %s mode changes successful when no Classic migration is required', async (
        nextMode,
        initialMode,
        root
    ) => {
        mod._setProjectId('notebook-a');
        mod.state.root = root;
        mod.state.ungrouped = [];
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences(initialMode) });
                return;
            }
            if (message?.type === 'SAVE_PREFERENCES') {
                cb?.({
                    success: true,
                    preferences: createCompletePreferences(message.preferences?.dragMode)
                });
            }
        });
        await mod._ensureDeveloperPreferencesLoadedForTest();

        await expect(mod._applyDragModeChangeForTest(nextMode)).resolves.toBe(nextMode);
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(0);
    });

    it('does not save a panel reattach when the Classic checkpoint is rejected', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: false, errorCode: 'history_write_failed' });
            }
        });

        await expect(mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'checkpoint_failed'
        });
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(0);
    });

    it('does not save a panel reattach when preferences are unverified or the instance is stale', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
            }
        });

        await expect(mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'preferences_unverified'
        });
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(0);
    });

    it('does not let a stale reattach continuation save into a newly selected notebook', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('reflow') });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
            }
        });

        const pendingReattach = mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest(),
            _beforeAdditionalSaveForTest: () => {
                mod._setProjectId('notebook-b');
            }
        });

        await expect(pendingReattach).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'stale_instance'
        });
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(0);
    });

    it('does not add a second reattach save after a failed Classic migration save', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: false, errorCode: 'runtime_failure' });
            }
        });

        await expect(mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({
            changed: true,
            saved: false,
            reason: 'runtime_failure'
        });
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(1);
    });

    it('uses exactly one migration save for a Classic panel reattach', async () => {
        mod._setProjectId('notebook-a');
        seedPositionedSource(mod);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                cb?.({ success: true, history: [message.entry] });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
            }
        });

        await expect(mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        })).resolves.toEqual({ changed: true, saved: true });
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(1);
    });

    it.each([
        ['reflow', [{ type: 'source', key: 'source-a' }], 'not_classic'],
        ['classic', [], undefined]
    ])('keeps one necessary reattach save for %s with no migration', async (
        dragMode,
        root,
        expectedReason
    ) => {
        mod._setProjectId('notebook-a');
        mod.state.root = root;
        mod.state.ungrouped = root.length > 0 ? [] : ['source-a'];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences(dragMode) });
                return;
            }
            if (message?.type === 'SAVE_STATE') {
                cb?.({ success: true, saveRevision: 1, savedAt: '2026-07-26T00:00:00.000Z' });
            }
        });

        const result = await mod._finalizePanelReattachPersistenceForTest({
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });

        expect(result).toEqual(expect.objectContaining({
            changed: false,
            saved: true
        }));
        expect(result.reason).toBe(expectedReason);
        expect(global.chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.type === 'SAVE_STATE'))
            .toHaveLength(1);
    });

    it('resolves an invariant waiter when import rollback clears the pending initial state', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [];
        mod.state.ungrouped = ['source-a'];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        mod._setAwaitingInitialStateLoadForTest(true);
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences('classic') });
            }
        });
        const pendingInvariant = mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });
        await flushUntil(() => (
            mod._getPendingInitialStateApplyWaiterCountForTest() === 1
        ));

        expect(mod._rollbackImportSnapshotForTest(mod.buildPersistableState())).toBe(true);
        await expect(pendingInvariant).resolves.toEqual({
            changed: false,
            saved: false
        });
    });

    it('abandons a deferred-apply continuation after SPA navigation changes notebook', async () => {
        mod._setProjectId('notebook-a');
        mod.state.root = [{ type: 'source', key: 'source-a' }];
        mod.state.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        mod._setAwaitingInitialStateLoadForTest(true);
        global.chrome.runtime.sendMessage.mockClear();
        const beforeSnapshot = JSON.stringify(mod.buildPersistableState());
        const pendingInvariant = mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });
        await flushAsyncMessageResponse();

        mod._setProjectId('notebook-b');
        mod._setAwaitingInitialStateLoadForTest(false);
        mod._resolvePendingInitialStateApplyWaitersForTest();

        await expect(pendingInvariant).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'stale_instance'
        });
        expect(JSON.stringify(mod.buildPersistableState())).toBe(beforeSnapshot);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('does not sweep a replaced state reference after the checkpoint resolves', async () => {
        let settleCheckpoint;
        mod._setProjectId('notebook-a');
        const originalState = mod.state;
        originalState.root = [{ type: 'source', key: 'source-a' }];
        originalState.ungrouped = [];
        mod.sourcesByKey.set('source-a', {
            key: 'source-a',
            enabled: true,
            title: 'Source A',
            normalizedTitle: 'source a',
            fingerprint: 'source a||article',
            identityType: 'fingerprint'
        });
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'LOAD_PREFERENCES') {
                cb?.({ success: true, preferences: createCompletePreferences() });
                return;
            }
            if (message?.type === 'APPEND_STATE_HISTORY') {
                settleCheckpoint = cb;
            }
        });
        const pendingInvariant = mod._enforceClassicPlacementInvariantForTest({
            trigger: 'normal_load',
            expectedProjectId: 'notebook-a',
            instanceToken: mod._getActiveManagerInstanceTokenForTest()
        });
        await flushUntil(() => Boolean(settleCheckpoint));
        const replacementState = {
            root: [{ type: 'source', key: 'source-b' }],
            ungrouped: [],
            filterQuery: '',
            isBatchMode: false,
            tagOrder: [],
            activeTagId: null,
            activeQuickViewKind: null
        };
        mod._replaceStateReferenceForTest(replacementState);
        settleCheckpoint({ success: true, history: [] });

        await expect(pendingInvariant).resolves.toEqual({
            changed: false,
            saved: false,
            reason: 'stale_instance'
        });
        expect(originalState.root).toEqual([{ type: 'source', key: 'source-a' }]);
        expect(replacementState.root).toEqual([{ type: 'source', key: 'source-b' }]);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });
});
