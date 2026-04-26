(function () {
    'use strict';

    const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';
    const NOTEBOOKLM_NOTEBOOK_PREFIX = 'https://notebooklm.google.com/notebook/';
    const SOURCE_VIEW_LIST = 'list';
    const SOURCE_VIEW_LABEL = 'label';
    const ERROR_MESSAGE_KEYS = {
        invalid_storage_key: 'popup_error_invalid_storage_key',
        runtime_failure: 'popup_reason_generic',
        tabs_query_failed: 'popup_reason_tabs_query_failed',
        extension_disabled: 'popup_reason_extension_disabled',
        source_view_switch_failed: 'popup_source_view_switch_failed'
    };

    function getUiLanguage() {
        if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
            return chrome.i18n.getUILanguage() || 'en';
        }
        return 'en';
    }

    function applyDocumentLocalization(doc = document) {
        if (!doc) return;

        if (typeof doc.title === 'string') {
            doc.title = getMessage('extName');
        }

        const root = doc.documentElement || null;
        if (root) {
            root.lang = getUiLanguage();
        }
    }

    function getPageContext(url) {
        if (typeof url !== 'string' || !url) return 'external';
        if (url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX)) return 'notebook';
        if (url.startsWith(NOTEBOOKLM_HOME_URL)) return 'notebook-home';
        return 'external';
    }

    function isNotebookTab(tab) {
        return Boolean(tab && typeof tab.url === 'string' && tab.url.startsWith(NOTEBOOKLM_NOTEBOOK_PREFIX));
    }

    function deriveLaunchContext(activeTab, notebookLmTabs) {
        const pageContext = getPageContext(activeTab && activeTab.url);
        const hasOpenNotebook = notebookLmTabs.some(tab => isNotebookTab(tab) && tab.id !== (activeTab && activeTab.id));

        if (pageContext === 'notebook-home' && !hasOpenNotebook) {
            return 'current-home-only';
        }

        if (hasOpenNotebook) {
            return 'has-open-notebook';
        }

        return 'no-open-notebook';
    }

    function getReasonMessageKey(reason) {
        const reasonMap = {
            source_panel_missing: 'popup_reason_source_panel_missing',
            panel_header_missing: 'popup_reason_panel_header_missing',
            manager_not_ready: 'popup_reason_manager_not_ready',
            manager_unreachable: 'popup_reason_manager_unreachable',
            tab_message_failed: 'popup_reason_tab_message_failed',
            tabs_query_failed: 'popup_reason_tabs_query_failed',
            notebook_missing: 'popup_reason_notebook_missing',
            not_on_notebook_page: 'popup_reason_notebook_missing',
            extension_disabled: 'popup_reason_extension_disabled'
        };

        return reasonMap[reason] || 'popup_reason_generic';
    }

    function buildPopupState({ context, managerStatus, launchContext }) {
        if (context === 'notebook') {
            if (managerStatus && managerStatus.ready) {
                return {
                    badgeKey: 'popup_badge_ready',
                    titleKey: 'popup_title_ready',
                    bodyKey: 'popup_body_ready',
                    buttonKey: 'popup_cta_open_manager',
                    detailKey: null,
                    action: 'focus-manager',
                    sourceViewControls: true,
                    sourceViewKind: managerStatus.sourceViewKind || SOURCE_VIEW_LIST
                };
            }

            return {
                badgeKey: 'popup_badge_attention',
                titleKey: 'popup_title_refresh_needed',
                bodyKey: 'popup_body_refresh_needed',
                buttonKey: 'popup_cta_refresh_notebook',
                detailKey: getReasonMessageKey(managerStatus && managerStatus.reason),
                action: 'refresh-tab',
                sourceViewControls: false,
                sourceViewKind: SOURCE_VIEW_LIST
            };
        }

        if (context === 'notebook-home') {
            if (launchContext === 'has-open-notebook') {
                return {
                    badgeKey: 'popup_badge_launcher',
                    titleKey: 'popup_title_switch_notebook',
                    bodyKey: 'popup_body_switch_notebook',
                    buttonKey: 'popup_cta_go_to_open_notebook',
                    detailKey: null,
                    action: 'open-notebooklm',
                    sourceViewControls: false,
                    sourceViewKind: SOURCE_VIEW_LIST
                };
            }

            return {
                badgeKey: 'popup_badge_launcher',
                titleKey: 'popup_title_notebook_home_new_tab',
                bodyKey: 'popup_body_notebook_home_new_tab',
                buttonKey: 'popup_cta_open_notebooklm_new_tab',
                detailKey: null,
                action: 'open-notebooklm',
                sourceViewControls: false,
                sourceViewKind: SOURCE_VIEW_LIST
            };
        }

        if (launchContext === 'has-open-notebook') {
            return {
                badgeKey: 'popup_badge_launcher',
                titleKey: 'popup_title_switch_notebook',
                bodyKey: 'popup_body_switch_notebook',
                buttonKey: 'popup_cta_go_to_open_notebook',
                detailKey: null,
                action: 'open-notebooklm',
                sourceViewControls: false,
                sourceViewKind: SOURCE_VIEW_LIST
            };
        }

        return {
            badgeKey: 'popup_badge_launcher',
            titleKey: 'popup_title_external_page',
            bodyKey: 'popup_body_external_page',
            buttonKey: 'popup_cta_go_to_notebooklm',
            detailKey: null,
            action: 'open-notebooklm',
            sourceViewControls: false,
            sourceViewKind: SOURCE_VIEW_LIST
        };
    }

    function buildDisabledPopupState() {
        return {
            badgeKey: 'popup_badge_launcher',
            titleKey: 'popup_title_disabled',
            bodyKey: 'popup_body_disabled',
            buttonKey: 'popup_cta_enable_extension',
            detailKey: 'popup_reason_extension_disabled',
            action: 'enable-extension',
            sourceViewControls: false,
            sourceViewKind: SOURCE_VIEW_LIST
        };
    }

    function queryNotebookLmTabs() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ url: `${NOTEBOOKLM_HOME_URL}*` }, (tabs) => {
                if (chrome.runtime.lastError) {
                    const error = new Error(chrome.runtime.lastError.message || 'NotebookLM tabs query failed');
                    error.errorCode = 'tabs_query_failed';
                    reject(error);
                    return;
                }

                resolve(Array.isArray(tabs) ? tabs : []);
            });
        });
    }

    function queryActiveTab() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError) {
                    const error = new Error(chrome.runtime.lastError.message || 'Active tab query failed');
                    error.errorCode = 'tabs_query_failed';
                    reject(error);
                    return;
                }

                resolve((tabs && tabs[0]) || null);
            });
        });
    }

    function queryExtensionEnabled() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_EXTENSION_ENABLED' }, (response) => {
                if (chrome.runtime.lastError) {
                    const error = new Error(chrome.runtime.lastError.message || 'Extension enabled query failed');
                    error.errorCode = 'runtime_failure';
                    reject(error);
                    return;
                }

                if (response && response.success === false) {
                    resolve(true);
                    return;
                }

                resolve(response ? response.enabled !== false : true);
            });
        });
    }

    function setExtensionEnabled(enabled, tabId) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'SET_EXTENSION_ENABLED',
                enabled,
                tabId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve(response || { success: true, enabled });
            });
        });
    }

    function shouldReloadAfterToggle(tab) {
        const context = getPageContext(tab && tab.url);
        return context === 'notebook' || context === 'notebook-home';
    }

    function shouldReloadAfterSoftToggleFailure(tab, response) {
        if (!shouldReloadAfterToggle(tab)) return false;
        if (!response || response.success === false) return false;
        return response.forwarded === false || Boolean(response.forwardErrorCode);
    }

    function sendMessageToTab(tabId, message) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve(response || null);
            });
        });
    }

    function reloadTabAndWaitForCompletion(tabId, timeoutMs = 5000) {
        if (typeof tabId !== 'number') {
            return Promise.resolve({ success: true, reloaded: false });
        }

        if (
            !chrome.tabs ||
            !chrome.tabs.onUpdated ||
            typeof chrome.tabs.onUpdated.addListener !== 'function' ||
            typeof chrome.tabs.onUpdated.removeListener !== 'function'
        ) {
            return reloadTab(tabId);
        }

        return new Promise((resolve, reject) => {
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
                chrome.tabs.onUpdated.removeListener(handleUpdated);
            };

            const handleUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId !== tabId || !changeInfo || changeInfo.status !== 'complete') {
                    return;
                }

                cleanup();
                resolve({ success: true, reloaded: true });
            };

            timeoutId = setTimeout(() => {
                cleanup();
                const error = new Error('Tab reload timed out');
                error.errorCode = 'runtime_failure';
                reject(error);
            }, timeoutMs);

            chrome.tabs.onUpdated.addListener(handleUpdated);

            chrome.tabs.reload(tabId, {}, () => {
                if (chrome.runtime.lastError) {
                    const error = new Error(chrome.runtime.lastError.message);
                    cleanup();
                    reject(error);
                }
            });
        });
    }

    function isReceivingEndError(error) {
        const message = String(error && error.message ? error.message : '');
        return /Receiving end does not exist|Could not establish connection|message port closed before a response was received/i.test(message);
    }

    function classifyTabMessageError(error) {
        return isReceivingEndError(error) ? 'manager_unreachable' : 'tab_message_failed';
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve(response || null);
            });
        });
    }

    function reloadTab(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.reload(tabId, {}, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve({ success: true });
            });
        });
    }

    async function inspectManagerStatus(tab) {
        if (!tab || typeof tab.id !== 'number') {
            return { ready: false, reason: 'notebook_missing' };
        }

        try {
            const response = await sendMessageToTab(tab.id, { type: 'GET_MANAGER_STATUS' });
            return response || { ready: false, reason: 'manager_not_ready' };
        } catch (error) {
            return { ready: false, reason: classifyTabMessageError(error) };
        }
    }

    function normalizeSourceViewKind(viewKind) {
        return viewKind === SOURCE_VIEW_LABEL ? SOURCE_VIEW_LABEL : SOURCE_VIEW_LIST;
    }

    function getElements(doc) {
        return {
            toggleLabel: doc.getElementById('popup-toggle-label'),
            toggleState: doc.getElementById('popup-toggle-state'),
            toggleHelp: doc.getElementById('popup-toggle-help'),
            toggleInput: doc.getElementById('popup-toggle-input'),
            sourceViewSection: doc.getElementById('popup-source-view-section'),
            sourceViewLabel: doc.getElementById('popup-source-view-label'),
            sourceViewListButton: doc.getElementById('popup-source-view-list-btn'),
            sourceViewLabelButton: doc.getElementById('popup-source-view-label-btn'),
            sourceViewStatus: doc.getElementById('popup-source-view-status'),
            badge: doc.getElementById('popup-badge'),
            title: doc.getElementById('popup-title'),
            body: doc.getElementById('popup-body'),
            note: doc.getElementById('popup-note'),
            detail: doc.getElementById('popup-detail'),
            primaryButton: doc.getElementById('popup-primary-btn')
        };
    }

    function setSourceViewSelection(elements, viewKind) {
        const normalizedViewKind = normalizeSourceViewKind(viewKind);
        if (!elements.sourceViewListButton || !elements.sourceViewLabelButton) return;
        elements.sourceViewListButton.setAttribute('aria-pressed', normalizedViewKind === SOURCE_VIEW_LIST ? 'true' : 'false');
        elements.sourceViewLabelButton.setAttribute('aria-pressed', normalizedViewKind === SOURCE_VIEW_LABEL ? 'true' : 'false');
    }

    function setSourceViewButtonsDisabled(elements, disabled) {
        if (elements.sourceViewListButton) elements.sourceViewListButton.disabled = Boolean(disabled);
        if (elements.sourceViewLabelButton) elements.sourceViewLabelButton.disabled = Boolean(disabled);
    }

    function getSourceViewSwitchedMessageKey(viewKind) {
        return normalizeSourceViewKind(viewKind) === SOURCE_VIEW_LABEL
            ? 'popup_source_view_switched_label'
            : 'popup_source_view_switched_list';
    }

    function renderSourceViewControls(elements, state, extensionEnabled) {
        if (!elements.sourceViewSection) return;
        const isVisible = extensionEnabled !== false && Boolean(state.sourceViewControls);
        elements.sourceViewSection.hidden = !isVisible;
        if (elements.sourceViewLabel) elements.sourceViewLabel.textContent = getMessage('popup_source_view_label');
        if (elements.sourceViewListButton) elements.sourceViewListButton.textContent = getMessage('popup_source_view_list');
        if (elements.sourceViewLabelButton) elements.sourceViewLabelButton.textContent = getMessage('popup_source_view_label_view');
        if (elements.sourceViewStatus) elements.sourceViewStatus.textContent = getMessage('popup_source_view_status_list');
        setSourceViewButtonsDisabled(elements, !isVisible);
        setSourceViewSelection(elements, state.sourceViewKind || SOURCE_VIEW_LIST);
    }

    function renderPopup(doc, state, extensionEnabled) {
        const elements = getElements(doc);
        const isEnabled = extensionEnabled !== false;

        elements.toggleLabel.textContent = getMessage('popup_toggle_label');
        elements.toggleState.textContent = getMessage(isEnabled ? 'popup_toggle_state_enabled' : 'popup_toggle_state_disabled');
        elements.toggleHelp.textContent = getMessage('popup_toggle_help');
        elements.toggleInput.checked = isEnabled;
        elements.toggleInput.disabled = false;
        renderSourceViewControls(elements, state, isEnabled);
        elements.badge.textContent = getMessage(state.badgeKey);
        elements.title.textContent = getMessage(state.titleKey);
        elements.body.textContent = getMessage(state.bodyKey);
        elements.note.textContent = getMessage('popup_launcher_note');
        elements.primaryButton.textContent = getMessage(state.buttonKey);
        elements.primaryButton.disabled = false;

        if (state.detailKey) {
            elements.detail.hidden = false;
            elements.detail.textContent = getMessage(state.detailKey);
        } else {
            elements.detail.hidden = true;
            elements.detail.textContent = '';
        }

        return elements;
    }

    function resolveErrorMessage(result) {
        if (result && typeof result.errorMessageKey === 'string') {
            return getMessage(result.errorMessageKey);
        }

        if (result && typeof result.errorCode === 'string') {
            return getMessage(ERROR_MESSAGE_KEYS[result.errorCode] || 'popup_reason_generic');
        }

        return getMessage('popup_reason_generic');
    }

    function buildTabsQueryFailureState() {
        return {
            badgeKey: 'popup_badge_attention',
            titleKey: 'popup_title_external_page',
            bodyKey: 'popup_body_external_page',
            buttonKey: 'popup_cta_go_to_notebooklm',
            detailKey: 'popup_reason_tabs_query_failed',
            action: 'open-notebooklm'
        };
    }

    async function applyExtensionEnabledState(doc, tab, enabled) {
        const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
        const response = await setExtensionEnabled(enabled, tabId);
        let syncErrorCode = null;

        if (response && response.success === false) {
            return response;
        }

        if (shouldReloadAfterSoftToggleFailure(tab, response)) {
            try {
                await reloadTabAndWaitForCompletion(tabId);
            } catch (error) {
                syncErrorCode = error && error.errorCode ? error.errorCode : 'runtime_failure';
            }
        }

        await initializePopup(doc);
        return { success: true, refreshed: true, enabled, syncErrorCode };
    }

    async function performPrimaryAction(doc, state, tab, launchContext) {
        if (state.action === 'enable-extension') {
            return applyExtensionEnabledState(doc, tab, true);
        }

        if (state.action === 'focus-manager') {
            return sendMessageToTab(tab.id, { type: 'FOCUS_MANAGER' });
        }

        if (state.action === 'refresh-tab') {
            return reloadTab(tab.id);
        }

        return sendRuntimeMessage({
            type: 'OPEN_OR_FOCUS_NOTEBOOKLM',
            currentTabId: tab && typeof tab.id === 'number' ? tab.id : null,
            currentContext: getPageContext(tab && tab.url),
            launchContext
        });
    }

    function switchSourceView(tab, viewKind) {
        if (!tab || typeof tab.id !== 'number') {
            return Promise.resolve({
                success: false,
                errorMessageKey: 'popup_reason_notebook_missing'
            });
        }

        return sendMessageToTab(tab.id, {
            type: 'SWITCH_SOURCE_VIEW',
            viewKind: normalizeSourceViewKind(viewKind)
        });
    }

    function bindPopupInteractions(doc, activeTab, state, launchContext) {
        const elements = getElements(doc);
        const handleSourceViewClick = async (viewKind) => {
            setSourceViewButtonsDisabled(elements, true);
            elements.primaryButton.disabled = true;

            try {
                const result = await switchSourceView(activeTab, viewKind);
                if (result && result.success === false) {
                    elements.detail.hidden = false;
                    elements.detail.textContent = resolveErrorMessage(result);
                    setSourceViewButtonsDisabled(elements, false);
                    elements.primaryButton.disabled = false;
                    return;
                }

                setSourceViewSelection(elements, viewKind);
                if (elements.sourceViewStatus) {
                    elements.sourceViewStatus.textContent = getMessage(getSourceViewSwitchedMessageKey(viewKind));
                }
                setSourceViewButtonsDisabled(elements, false);
                elements.primaryButton.disabled = false;
            } catch (error) {
                elements.detail.hidden = false;
                elements.detail.textContent = resolveErrorMessage({
                    errorCode: error && error.errorCode ? error.errorCode : 'runtime_failure'
                });
                setSourceViewButtonsDisabled(elements, false);
                elements.primaryButton.disabled = false;
            }
        };

        if (elements.sourceViewListButton) {
            elements.sourceViewListButton.onclick = () => handleSourceViewClick(SOURCE_VIEW_LIST);
        }
        if (elements.sourceViewLabelButton) {
            elements.sourceViewLabelButton.onclick = () => handleSourceViewClick(SOURCE_VIEW_LABEL);
        }

        elements.toggleInput.onchange = async () => {
            const nextEnabled = Boolean(elements.toggleInput.checked);
            elements.toggleInput.disabled = true;
            elements.primaryButton.disabled = true;

            try {
                const result = await applyExtensionEnabledState(doc, activeTab, nextEnabled);
                if (result && result.success === false) {
                    elements.toggleInput.checked = !nextEnabled;
                    elements.toggleInput.disabled = false;
                    elements.primaryButton.disabled = false;
                    elements.detail.hidden = false;
                    elements.detail.textContent = resolveErrorMessage(result);
                    return;
                }

                if (result && result.syncErrorCode) {
                    elements.detail.hidden = false;
                    elements.detail.textContent = resolveErrorMessage({
                        errorCode: result.syncErrorCode
                    });
                }
            } catch (error) {
                elements.toggleInput.checked = !nextEnabled;
                elements.toggleInput.disabled = false;
                elements.primaryButton.disabled = false;
                elements.detail.hidden = false;
                elements.detail.textContent = resolveErrorMessage({
                    errorCode: error && error.errorCode ? error.errorCode : 'runtime_failure'
                });
            }
        };

        elements.primaryButton.onclick = async () => {
            elements.primaryButton.disabled = true;

            try {
                const result = await performPrimaryAction(doc, state, activeTab, launchContext);
                if (result && result.success === false) {
                    elements.detail.hidden = false;
                    elements.detail.textContent = resolveErrorMessage(result);
                    elements.primaryButton.disabled = false;
                    return;
                }

                if (result && result.refreshed) {
                    return;
                }

                if (typeof window !== 'undefined' && window && typeof window.close === 'function') {
                    window.close();
                }
            } catch (error) {
                elements.detail.hidden = false;
                elements.detail.textContent = resolveErrorMessage({
                    errorCode: error && error.errorCode ? error.errorCode : 'runtime_failure'
                });
                elements.primaryButton.disabled = false;
            }
        };
    }

    async function initializePopup(doc = document) {
        applyDocumentLocalization(doc);
        let activeTab = null;
        let activeTabQueryFailed = false;
        let notebookTabsQueryFailed = false;
        let extensionEnabled = true;

        try {
            activeTab = await queryActiveTab();
        } catch (error) {
            activeTabQueryFailed = true;
        }

        try {
            extensionEnabled = await queryExtensionEnabled();
        } catch (error) {
            extensionEnabled = true;
        }

        const context = getPageContext(activeTab && activeTab.url);
        const disabled = !extensionEnabled;
        let launchContext = null;
        let managerStatus = null;
        let state = disabled
            ? buildDisabledPopupState()
            : buildPopupState({ context, managerStatus: null, launchContext: null });

        if (!disabled) {
            let notebookLmTabs = [];

            if (context !== 'notebook') {
                try {
                    notebookLmTabs = await queryNotebookLmTabs();
                } catch (error) {
                    notebookTabsQueryFailed = true;
                }
            }

            launchContext = context === 'notebook' ? null : deriveLaunchContext(activeTab, notebookLmTabs);
            managerStatus = context === 'notebook' ? await inspectManagerStatus(activeTab) : null;
            state = (activeTabQueryFailed || notebookTabsQueryFailed)
                ? buildTabsQueryFailureState()
                : buildPopupState({ context, managerStatus, launchContext });
        }

        renderPopup(doc, state, extensionEnabled);
        bindPopupInteractions(doc, activeTab, state, launchContext);

        return { context, launchContext, managerStatus, state, extensionEnabled };
    }

    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', () => {
            initializePopup().catch((error) => {
                const detail = document.getElementById('popup-detail');
                if (detail) {
                    detail.hidden = false;
                    detail.textContent = getMessage('popup_reason_generic');
                }
            });
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildPopupState,
            buildTabsQueryFailureState,
            deriveLaunchContext,
            getPageContext,
            getReasonMessageKey,
            getUiLanguage,
            initializePopup,
            isNotebookTab,
            inspectManagerStatus,
            performPrimaryAction,
            queryNotebookLmTabs,
            renderPopup,
            applyDocumentLocalization,
            resolveErrorMessage,
            isReceivingEndError,
            classifyTabMessageError
        };
    }
})();
