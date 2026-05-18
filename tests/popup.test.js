const fs = require('fs');
const path = require('path');

const extractCssBlock = (css, selector) => {
    const selectorIndex = css.indexOf(selector);
    if (selectorIndex === -1) return '';

    const openIndex = css.indexOf('{', selectorIndex);
    if (openIndex === -1) return '';

    let depth = 0;
    for (let index = openIndex; index < css.length; index += 1) {
        const char = css[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return css.slice(openIndex + 1, index);
            }
        }
    }

    return '';
};

const createPopupDocument = () => {
    const elements = {
        'popup-toggle-label': { textContent: '', hidden: false },
        'popup-toggle-state': { textContent: '', hidden: false },
        'popup-toggle-help': { textContent: '', hidden: false },
        'popup-toggle-input': { checked: false, disabled: false, onchange: null },
        'popup-source-view-section': { hidden: false },
        'popup-source-view-label': { textContent: '', hidden: false },
        'popup-source-view-list-btn': { textContent: '', disabled: false, onclick: null, setAttribute: jest.fn() },
        'popup-source-view-label-btn': { textContent: '', disabled: false, onclick: null, setAttribute: jest.fn() },
        'popup-source-view-status': { textContent: '', hidden: false },
        'popup-badge': { textContent: '', hidden: false },
        'popup-title': { textContent: '', hidden: false },
        'popup-body': { textContent: '', hidden: false },
        'popup-note': { textContent: '', hidden: false },
        'popup-detail': { textContent: '', hidden: true },
        'popup-primary-btn': { textContent: '', disabled: false, onclick: null }
    };

    return {
        elements,
        title: '',
        documentElement: { lang: '' },
        getElementById: jest.fn((id) => elements[id]),
        addEventListener: jest.fn()
    };
};

describe('popup motion styles', () => {
    it('uses unified popup motion tokens and reduced motion handling', () => {
        const css = fs.readFileSync(path.join(__dirname, '../src/popup/styles.css'), 'utf8');

        expect(css).toContain('--popup-motion-fast: 120ms;');
        expect(css).toContain('--popup-motion-base: 180ms;');
        expect(css).toContain('--popup-motion-medium: 240ms;');
        expect(css).toContain('--popup-motion-slow: 320ms;');
        expect(css).toContain('--popup-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);');
        expect(css).toContain('--popup-ease-emphasized: cubic-bezier(0.2, 0.9, 0.25, 1);');
        expect(css).toContain('--popup-ease-press: cubic-bezier(0.25, 1, 0.5, 1);');
        expect(css).not.toContain('--popup-ease:');
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('keeps popup control transitions explicit', () => {
        const css = fs.readFileSync(path.join(__dirname, '../src/popup/styles.css'), 'utf8');
        const switchTrack = extractCssBlock(css, '.popup-switch-track {');
        const popupButton = extractCssBlock(css, '.popup-button {');

        expect(switchTrack).toContain('var(--popup-motion-base)');
        expect(switchTrack).not.toContain('transition: all');
        expect(popupButton).toContain('var(--popup-motion-fast)');
        expect(popupButton).not.toContain('transition: all');
    });

    it('keeps popup hover feedback as subtle scale without vertical lift', () => {
        const css = fs.readFileSync(path.join(__dirname, '../src/popup/styles.css'), 'utf8');
        const popupButtonHover = extractCssBlock(css, '.popup-button:hover:not(:disabled) {');

        expect(popupButtonHover).toContain('transform: scale(1.02);');
        expect(css).not.toContain('translateY(-1px)');
    });
});

describe('popup launcher', () => {
    let popup;
    let popupDocument;
    let activeTab;
    let notebookLmTabs;
    let tabUpdatedListeners;

    beforeEach(() => {
        jest.resetModules();
        popupDocument = createPopupDocument();
        activeTab = { id: 7, url: 'https://notebooklm.google.com/notebook/abc' };
        notebookLmTabs = [activeTab];
        tabUpdatedListeners = [];

        global.document = popupDocument;
        global.window = { close: jest.fn() };
        global.getMessage = (key) => key;
        global.chrome = {
            i18n: {
                getMessage: (key) => key,
                getUILanguage: () => 'zh-CN'
            },
            runtime: {
                lastError: null,
                sendMessage: jest.fn((message, cb) => {
                    if (message.type === 'GET_EXTENSION_ENABLED') {
                        cb({ success: true, enabled: true });
                        return;
                    }

                    if (message.type === 'SET_EXTENSION_ENABLED') {
                        cb({ success: true, enabled: message.enabled, tabId: message.tabId, forwarded: true });
                        return;
                    }

                    cb({ success: true, action: 'focused-existing-notebook' });
                })
            },
            tabs: {
                query: jest.fn((queryInfo, cb) => {
                    if (queryInfo.active) {
                        cb([activeTab]);
                        return;
                    }

                    cb(notebookLmTabs);
                }),
                sendMessage: jest.fn((tabId, message, cb) => cb({ ready: true })),
                reload: jest.fn((tabId, options, cb) => {
                    if (cb) cb();
                    tabUpdatedListeners.slice().forEach((listener) => {
                        listener(tabId, { status: 'complete' }, { id: tabId, url: activeTab && activeTab.url });
                    });
                }),
                onUpdated: {
                    addListener: jest.fn((listener) => {
                        tabUpdatedListeners.push(listener);
                    }),
                    removeListener: jest.fn((listener) => {
                        tabUpdatedListeners = tabUpdatedListeners.filter((candidate) => candidate !== listener);
                    })
                }
            }
        };

        popup = require('../src/popup/index.js');
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
        delete global.chrome;
        delete global.getMessage;
        delete global.NSM_SET_MESSAGE_LOCALE_OVERRIDE;
        delete global.NSM_GET_EFFECTIVE_MESSAGE_LOCALE;
    });

    it('keeps the popup html ids that popup/index.js binds to', () => {
        const popupHtml = fs.readFileSync(
            path.join(__dirname, '../src/popup/popup.html'),
            'utf8'
        );

        expect(popupHtml).toContain('id="popup-badge"');
        expect(popupHtml).toContain('id="popup-title"');
        expect(popupHtml).toContain('id="popup-body"');
        expect(popupHtml).toContain('id="popup-note"');
        expect(popupHtml).toContain('id="popup-detail"');
        expect(popupHtml).toContain('id="popup-toggle-label"');
        expect(popupHtml).toContain('id="popup-toggle-state"');
        expect(popupHtml).toContain('id="popup-toggle-help"');
        expect(popupHtml).toContain('id="popup-toggle-input"');
        expect(popupHtml).toContain('id="popup-source-view-section"');
        expect(popupHtml).toContain('id="popup-source-view-list-btn"');
        expect(popupHtml).toContain('id="popup-source-view-label-btn"');
        expect(popupHtml).toContain('id="popup-primary-btn"');
    });

    it('detects page context correctly', () => {
        expect(popup.getPageContext('https://notebooklm.google.com/notebook/123')).toBe('notebook');
        expect(popup.getPageContext('https://notebooklm.google.com/')).toBe('notebook-home');
        expect(popup.getPageContext('https://example.com')).toBe('external');
    });

    it('builds launcher states for notebook, notebook-home, and external pages', () => {
        expect(popup.buildPopupState({
            context: 'notebook',
            managerStatus: { ready: true },
            launchContext: null
        })).toMatchObject({
            buttonKey: 'popup_cta_open_manager',
            action: 'focus-manager'
        });

        expect(popup.buildPopupState({
            context: 'notebook-home',
            managerStatus: null,
            launchContext: 'current-home-only'
        })).toMatchObject({
            buttonKey: 'popup_cta_open_notebooklm_new_tab',
            action: 'open-notebooklm'
        });

        expect(popup.buildPopupState({
            context: 'external',
            managerStatus: null,
            launchContext: 'has-open-notebook'
        })).toMatchObject({
            buttonKey: 'popup_cta_go_to_open_notebook',
            action: 'open-notebooklm'
        });
    });

    it('derives launcher contexts for open notebook, current home, and no open notebook', () => {
        expect(popup.deriveLaunchContext(
            { id: 1, url: 'https://example.com' },
            [{ id: 9, url: 'https://notebooklm.google.com/notebook/xyz' }]
        )).toBe('has-open-notebook');

        expect(popup.deriveLaunchContext(
            { id: 2, url: 'https://notebooklm.google.com/' },
            [{ id: 2, url: 'https://notebooklm.google.com/' }]
        )).toBe('current-home-only');

        expect(popup.deriveLaunchContext(
            { id: 3, url: 'https://example.com' },
            []
        )).toBe('no-open-notebook');
    });

    it('renders a ready notebook state and focuses the in-page manager', async () => {
        const result = await popup.initializePopup(popupDocument);

        expect(result.context).toBe('notebook');
        expect(result.extensionEnabled).toBe(true);
        expect(popupDocument.title).toBe('extName');
        expect(popupDocument.documentElement.lang).toBe('zh-CN');
        expect(popupDocument.elements['popup-toggle-label'].textContent).toBe('popup_toggle_label');
        expect(popupDocument.elements['popup-toggle-state'].textContent).toBe('popup_toggle_state_enabled');
        expect(popupDocument.elements['popup-toggle-help'].textContent).toBe('popup_toggle_help');
        expect(popupDocument.elements['popup-toggle-input'].checked).toBe(true);
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_ready');
        expect(popupDocument.elements['popup-primary-btn'].textContent).toBe('popup_cta_open_manager');

        await popupDocument.elements['popup-primary-btn'].onclick();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'GET_EXTENSION_ENABLED' },
            expect.any(Function)
        );
        expect(global.chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
            1,
            7,
            { type: 'GET_MANAGER_STATUS' },
            expect.any(Function)
        );
        expect(global.chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
            2,
            7,
            { type: 'FOCUS_MANAGER' },
            expect.any(Function)
        );
        expect(global.window.close).toHaveBeenCalled();
    });

    it('renders source view switcher and sends view switch messages to the notebook tab', async () => {
        await popup.initializePopup(popupDocument);

        expect(popupDocument.elements['popup-source-view-section'].hidden).toBe(false);
        expect(popupDocument.elements['popup-source-view-label'].textContent).toBe('popup_source_view_label');
        expect(popupDocument.elements['popup-source-view-list-btn'].textContent).toBe('popup_source_view_list');
        expect(popupDocument.elements['popup-source-view-label-btn'].textContent).toBe('popup_source_view_label_view');
        expect(popupDocument.elements['popup-source-view-list-btn'].setAttribute).toHaveBeenCalledWith('aria-pressed', 'true');
        expect(popupDocument.elements['popup-source-view-label-btn'].setAttribute).toHaveBeenCalledWith('aria-pressed', 'false');

        global.chrome.tabs.sendMessage.mockClear();
        await popupDocument.elements['popup-source-view-label-btn'].onclick();

        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: 'SWITCH_SOURCE_VIEW', viewKind: 'label' },
            expect.any(Function)
        );
        expect(popupDocument.elements['popup-source-view-status'].textContent).toBe('popup_source_view_switched_label');
        expect(popupDocument.elements['popup-source-view-label-btn'].setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'true');

        global.chrome.tabs.sendMessage.mockClear();
        await popupDocument.elements['popup-source-view-list-btn'].onclick();

        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: 'SWITCH_SOURCE_VIEW', viewKind: 'list' },
            expect.any(Function)
        );
        expect(popupDocument.elements['popup-source-view-status'].textContent).toBe('popup_source_view_switched_list');
        expect(popupDocument.elements['popup-source-view-list-btn'].setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'true');
    });

    it('renders a disabled state without inspecting the notebook manager', async () => {
        let isEnabled = false;
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: isEnabled });
                return;
            }

            if (message.type === 'SET_EXTENSION_ENABLED') {
                isEnabled = message.enabled;
                cb({ success: true, enabled: message.enabled, tabId: message.tabId, forwarded: true });
                return;
            }

            cb({ success: true });
        });

        const result = await popup.initializePopup(popupDocument);

        expect(result.extensionEnabled).toBe(false);
        expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(popupDocument.elements['popup-toggle-input'].checked).toBe(false);
        expect(popupDocument.elements['popup-toggle-state'].textContent).toBe('popup_toggle_state_disabled');
        expect(popupDocument.elements['popup-source-view-section'].hidden).toBe(true);
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_disabled');
        expect(popupDocument.elements['popup-body'].textContent).toBe('popup_body_disabled');
        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_extension_disabled');
        expect(popupDocument.elements['popup-primary-btn'].textContent).toBe('popup_cta_enable_extension');

        await popupDocument.elements['popup-primary-btn'].onclick();

        expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            {
                type: 'SET_EXTENSION_ENABLED',
                enabled: true,
                tabId: 7
            },
            expect.any(Function)
        );
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: 'GET_MANAGER_STATUS' },
            expect.any(Function)
        );
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_ready');
    });

    it.each(['es', 'es-ES'])('applies the Chrome UI language %s to the popup document', async (uiLanguage) => {
        global.chrome.i18n.getUILanguage = () => uiLanguage;

        await popup.initializePopup(popupDocument);

        expect(popupDocument.title).toBe('extName');
        expect(popupDocument.documentElement.lang).toBe(uiLanguage);
    });

    it('applies the saved manual extension language before rendering the popup', async () => {
        global.NSM_SET_MESSAGE_LOCALE_OVERRIDE = jest.fn(() => Promise.resolve('zh_CN'));
        global.NSM_GET_EFFECTIVE_MESSAGE_LOCALE = jest.fn(() => 'zh-CN');
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'LOAD_PREFERENCES') {
                cb({ success: true, preferences: { languageOverride: 'zh_CN' } });
                return;
            }
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: true });
                return;
            }
            cb({ success: true });
        });

        await popup.initializePopup(popupDocument);

        expect(global.NSM_SET_MESSAGE_LOCALE_OVERRIDE).toHaveBeenCalledWith('zh_CN');
        expect(popupDocument.documentElement.lang).toBe('zh-CN');

        delete global.NSM_SET_MESSAGE_LOCALE_OVERRIDE;
        delete global.NSM_GET_EFFECTIVE_MESSAGE_LOCALE;
    });

    it('renders a refresh action when the manager is unavailable in a notebook', async () => {
        global.chrome.tabs.sendMessage.mockImplementationOnce((tabId, message, cb) => cb({ ready: false, reason: 'source_panel_missing' }));

        const result = await popup.initializePopup(popupDocument);

        expect(result.state.action).toBe('refresh-tab');
        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_source_panel_missing');

        await popupDocument.elements['popup-primary-btn'].onclick();
        expect(global.chrome.tabs.reload).toHaveBeenCalledWith(7, {}, expect.any(Function));
    });

    it('renders a manager unreachable message when notebook status cannot be read', async () => {
        global.chrome.tabs.sendMessage.mockImplementationOnce((tabId, message, cb) => {
            global.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
            cb();
            global.chrome.runtime.lastError = null;
        });

        const result = await popup.initializePopup(popupDocument);

        expect(result.state.action).toBe('refresh-tab');
        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_manager_unreachable');
    });

    it('renders a tab message failed message when notebook status returns an unexpected messaging error', async () => {
        global.chrome.tabs.sendMessage.mockImplementationOnce((tabId, message, cb) => {
            global.chrome.runtime.lastError = { message: 'Unexpected tab messaging failure' };
            cb();
            global.chrome.runtime.lastError = null;
        });

        const result = await popup.initializePopup(popupDocument);

        expect(result.state.action).toBe('refresh-tab');
        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_tab_message_failed');
    });

    it('wires the toggle switch to extension enablement and rerenders on change', async () => {
        let isEnabled = true;
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: isEnabled });
                return;
            }

            if (message.type === 'SET_EXTENSION_ENABLED') {
                isEnabled = message.enabled;
                cb({ success: true, enabled: message.enabled, tabId: message.tabId, forwarded: true });
                return;
            }

            cb({ success: true, action: 'focused-existing-notebook' });
        });

        await popup.initializePopup(popupDocument);

        global.chrome.tabs.reload.mockClear();
        global.chrome.tabs.sendMessage.mockClear();
        popupDocument.elements['popup-toggle-input'].checked = false;
        await popupDocument.elements['popup-toggle-input'].onchange();

        expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            {
                type: 'SET_EXTENSION_ENABLED',
                enabled: false,
                tabId: 7
            },
            expect.any(Function)
        );
        expect(popupDocument.elements['popup-toggle-state'].textContent).toBe('popup_toggle_state_disabled');
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_disabled');
        expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('does not reload the current NotebookLM home tab when soft toggling succeeds', async () => {
        let isEnabled = true;
        activeTab = { id: 14, url: 'https://notebooklm.google.com/' };
        notebookLmTabs = [activeTab];

        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: isEnabled });
                return;
            }

            if (message.type === 'SET_EXTENSION_ENABLED') {
                isEnabled = message.enabled;
                cb({ success: true, enabled: message.enabled, tabId: message.tabId, forwarded: true });
                return;
            }

            cb({ success: true, action: 'focused-existing-notebook' });
        });

        await popup.initializePopup(popupDocument);

        global.chrome.tabs.reload.mockClear();
        popupDocument.elements['popup-toggle-input'].checked = false;
        await popupDocument.elements['popup-toggle-input'].onchange();

        expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_disabled');
    });

    it('falls back to reloading the current NotebookLM tab when soft toggling cannot reach content', async () => {
        let isEnabled = true;
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: isEnabled });
                return;
            }

            if (message.type === 'SET_EXTENSION_ENABLED') {
                isEnabled = message.enabled;
                cb({
                    success: true,
                    enabled: message.enabled,
                    tabId: message.tabId,
                    forwarded: false,
                    forwardErrorCode: 'tab_message_failed'
                });
                return;
            }

            cb({ success: true, action: 'focused-existing-notebook' });
        });

        await popup.initializePopup(popupDocument);

        global.chrome.tabs.reload.mockClear();
        popupDocument.elements['popup-toggle-input'].checked = false;
        await popupDocument.elements['popup-toggle-input'].onchange();

        expect(global.chrome.tabs.reload).toHaveBeenCalledWith(7, {}, expect.any(Function));
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_disabled');
    });

    it('does not reload external pages after toggling the extension', async () => {
        let isEnabled = true;
        activeTab = { id: 4, url: 'https://example.com' };
        notebookLmTabs = [];

        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: isEnabled });
                return;
            }

            if (message.type === 'SET_EXTENSION_ENABLED') {
                isEnabled = message.enabled;
                cb({ success: true, enabled: message.enabled, tabId: message.tabId });
                return;
            }

            cb({ success: true, action: 'focused-existing-notebook' });
        });

        await popup.initializePopup(popupDocument);

        global.chrome.tabs.reload.mockClear();
        popupDocument.elements['popup-toggle-input'].checked = false;
        await popupDocument.elements['popup-toggle-input'].onchange();

        expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
        expect(popupDocument.elements['popup-title'].textContent).toBe('popup_title_disabled');
    });

    it('opens NotebookLM from non-notebook pages', async () => {
        activeTab = { id: 4, url: 'https://example.com' };
        notebookLmTabs = [{ id: 11, url: 'https://notebooklm.google.com/notebook/xyz' }];

        const result = await popup.initializePopup(popupDocument);

        expect(result.context).toBe('external');
        expect(result.launchContext).toBe('has-open-notebook');
        expect(popupDocument.elements['popup-primary-btn'].textContent).toBe('popup_cta_go_to_open_notebook');

        await popupDocument.elements['popup-primary-btn'].onclick();
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            {
                type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
                currentTabId: 4,
                currentContext: 'external',
                launchContext: 'has-open-notebook'
            },
            expect.any(Function)
        );
    });

    it('opens NotebookLM in a new tab when the current tab is the only home tab', async () => {
        activeTab = { id: 14, url: 'https://notebooklm.google.com/' };
        notebookLmTabs = [{ id: 14, url: 'https://notebooklm.google.com/' }];

        const result = await popup.initializePopup(popupDocument);

        expect(result.context).toBe('notebook-home');
        expect(result.launchContext).toBe('current-home-only');
        expect(popupDocument.elements['popup-primary-btn'].textContent).toBe('popup_cta_open_notebooklm_new_tab');

        await popupDocument.elements['popup-primary-btn'].onclick();
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            {
                type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
                currentTabId: 14,
                currentContext: 'notebook-home',
                launchContext: 'current-home-only'
            },
            expect.any(Function)
        );
    });

    it('renders a tabs query failure state when the launcher cannot read tabs', async () => {
        activeTab = { id: 4, url: 'https://example.com' };
        global.chrome.tabs.query.mockImplementationOnce((queryInfo, cb) => {
            global.chrome.runtime.lastError = { message: 'Query failed' };
            cb([]);
            global.chrome.runtime.lastError = null;
        });

        await popup.initializePopup(popupDocument);

        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_tabs_query_failed');
        expect(popupDocument.elements['popup-primary-btn'].textContent).toBe('popup_cta_go_to_notebooklm');
    });

    it('maps background error codes to localized popup messages', async () => {
        activeTab = { id: 4, url: 'https://example.com' };
        notebookLmTabs = [];
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: true });
                return;
            }

            cb({
                success: false,
                errorCode: 'tabs_query_failed'
            });
        });

        await popup.initializePopup(popupDocument);
        await popupDocument.elements['popup-primary-btn'].onclick();

        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_tabs_query_failed');
    });

    it('maps invalid storage key errors to localized popup messages', async () => {
        activeTab = { id: 4, url: 'https://example.com' };
        notebookLmTabs = [];
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: true });
                return;
            }

            cb({
                success: false,
                errorCode: 'invalid_storage_key'
            });
        });

        await popup.initializePopup(popupDocument);
        await popupDocument.elements['popup-primary-btn'].onclick();

        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_error_invalid_storage_key');
    });

    it('falls back to a localized generic message for thrown runtime errors', async () => {
        activeTab = { id: 4, url: 'https://example.com' };
        notebookLmTabs = [];
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.type === 'GET_EXTENSION_ENABLED') {
                cb({ success: true, enabled: true });
                return;
            }

            global.chrome.runtime.lastError = { message: 'English runtime failure' };
            cb();
            global.chrome.runtime.lastError = null;
        });

        await popup.initializePopup(popupDocument);
        await popupDocument.elements['popup-primary-btn'].onclick();

        expect(popupDocument.elements['popup-detail'].hidden).toBe(false);
        expect(popupDocument.elements['popup-detail'].textContent).toBe('popup_reason_generic');
    });
});
