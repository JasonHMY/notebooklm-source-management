(function () {
    'use strict';

    const QUICK_VIEW_BUTTON_OPTIONS = [
        ['all', 'ui_quick_view_all'],
        ['ungrouped', 'ui_quick_view_ungrouped'],
        ['disabled', 'ui_quick_view_disabled'],
        ['tag', 'ui_quick_view_tag'],
        ['recent', 'ui_quick_view_recent'],
        ['issues', 'ui_quick_view_issues']
    ];

    /**
     * createContentModalSettings(deps) — Settings modal + Quick-View 可见性子 modal +
     * Developer settings 子面板。承载 30+ 偏好开关、导入导出 / 备份历史 / 源指纹修复 /
     * 反馈链接 / 命令面板入口 / 欢迎 + What's New 入口 / 历史保留上限 / 语言覆盖 / 诊断网格。
     *
     * @param {Object} deps Required: el, getMessage, getShadowRoot (缺一抛错).
     *   主要分四类(完整 deps 见 line 14 destructuring 块):
     *   - state getter / setter 对: getVisibleQuickViewKinds/setVisibleQuickViewKinds,
     *     getDeveloperModeEnabled/setDeveloperModeEnabled, getHoverSpotlightEnabled/setHoverSpotlightEnabled,
     *     setLanguageOverride, setHistoryRetentionLimit
     *   - history / 导入导出: getStateHistoryEntries, restoreStateHistoryEntry, getExportConfigText,
     *     deleteStateHistoryEntry, clearStateHistory, previewImportConfig, applyImportConfig,
     *     createManualRestorePoint, createHistoryNodes
     *   - 源指纹修复: applySourceRepairRemaps, getSourceRepairReport, createSourceRepairNodes
     *   - UI 子组件 + 跨 modal 联动: renderCommandPaletteModal, renderWelcomeModal,
     *     renderWhatsNewModal, createDiagnosticsGrid, createLanguagePreferenceSection,
     *     createHistoryPreferenceNodes, createImportPreviewDetailNodes, render, showToast
     * @returns {{ closeSettingsModal, renderSettingsModal, renderQuickViewButtonsModal,
     *   createDeveloperSettingsSection, bindDeveloperSettingsActions, unlockDeveloperSettings,
     *   normalizeVisibleQuickViewKinds }}
     *   renderSettingsModal 是主入口;Developer 子面板有独立 create/bind/unlock 三件套
     *   供 password gate 后激活。完整 return 块见 line 718。
     */
    function createContentModalSettings(deps = {}) {
        const {
            el,
            getMessage,
            getShadowRoot,
            getDocument = () => (typeof document !== 'undefined' ? document : null),
            getWindow = () => (typeof window !== 'undefined' ? window : null),
            prepareModalOpen,
            closeManagedModal,
            bindModalKeyboardNavigation,
            removeModalNode = () => {},
            getVisibleQuickViewKinds = () => QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => kind),
            setVisibleQuickViewKinds = () => Promise.resolve(),
            getDeveloperModeEnabled = () => false,
            setDeveloperModeEnabled = () => Promise.resolve(false),
            getHoverSpotlightEnabled = () => true,
            setHoverSpotlightEnabled = () => Promise.resolve(true),
            getDragMode = () => 'classic',
            setDragMode = () => Promise.resolve('classic'),
            clearDeveloperLogs = () => Promise.resolve(false),
            getStateHistoryEntries = () => [],
            restoreStateHistoryEntry = () => Promise.resolve(false),
            deleteStateHistoryEntry = () => Promise.resolve({ ok: false, reason: 'unavailable' }),
            clearStateHistory = () => Promise.resolve({ ok: false, reason: 'unavailable' }),
            getExportConfigText = () => '{}',
            previewImportConfig = () => null,
            applyImportConfig = () => Promise.resolve({ ok: false }),
            getImportBackupInfo = () => null,
            restoreImportBackup = () => Promise.resolve({ ok: false }),
            discardImportBackup = () => Promise.resolve({ ok: false }),
            openWebStoreFeedback = () => Promise.resolve(false),
            renderCommandPaletteModal = () => false,
            renderWelcomeModal = () => false,
            renderWhatsNewModal = () => false,
            render = () => {},
            showToast = () => {},
            renderSaveStatus = () => null,
            applySourceRepairRemaps = () => Promise.resolve(false),
            getSourceRepairReport = () => ({ totalSources: 0, matchedSources: 0, unmatchedSources: 0, ambiguousSources: 0, matched: [], unmatched: [], ambiguous: [] }),
            setHistoryRetentionLimit = () => Promise.resolve(20),
            createManualRestorePoint = () => Promise.resolve(false),
            setLanguageOverride = () => Promise.resolve('auto'),
            // helper callbacks supplied by content-modals.js
            getImportPreviewMessage = () => '',
            createImportPreviewDetailNodes = () => [],
            copySettingsTextToClipboard = () => Promise.resolve(false),
            downloadSettingsExportText = () => false,
            readSettingsImportFile = () => false,
            copyDeveloperLogsTextToClipboard = () => Promise.resolve(false),
            downloadDeveloperLogsText = () => false,
            createDiagnosticsGrid = () => null,
            createSourceRepairNodes = () => [],
            createHistoryPreferenceNodes = () => [],
            createLanguagePreferenceSection = () => null,
            createHistoryNodes = () => [],
            copyDiagnosticsTextToClipboard = () => Promise.resolve(false),
            settingsDeveloperPassword = 'developer_mode',
            requestAnimationFrame: rafFn = globalThis.requestAnimationFrame
        } = deps;

        if (typeof el !== 'function' || typeof getMessage !== 'function' || typeof getShadowRoot !== 'function') {
            throw new Error('GeminiNotebook-Source-Management: createContentModalSettings requires el, getMessage and getShadowRoot.');
        }

        function getSettingsFocusKey(node) {
            if (!node || typeof node !== 'object') return '';
            if (node.dataset?.settingsFocusKey) return `data:${node.dataset.settingsFocusKey}`;
            if (node.id) return `id:${node.id}`;
            for (const datasetKey of ['historyId', 'sourceKey', 'tagId', 'quickViewKind']) {
                const datasetValue = String(node.dataset?.[datasetKey] || '');
                if (datasetValue) return `dataset:${datasetKey}:${datasetValue}`;
            }
            const className = String(node.className || '').split(/\s+/).find(Boolean);
            return className ? `class:${className}` : '';
        }

        function findSettingsFocusTarget(modal, focusKey) {
            const focusKeyParts = String(focusKey || '').split(':');
            const [kind, rawValue] = focusKeyParts;
            const rawDatasetValue = focusKeyParts.slice(2).join(':');
            const value = String(rawValue || '').replace(/[^a-zA-Z0-9_-]/g, '');
            if (!modal || !value) return null;
            if (kind === 'id') return modal.querySelector?.(`#${value}`) || null;
            if (kind === 'class') return modal.querySelector?.(`.${value}`) || null;
            if (kind === 'data') {
                return Array.from(modal.querySelectorAll?.('[data-settings-focus-key]') || [])
                    .find((node) => node?.dataset?.settingsFocusKey === value) || null;
            }
            if (kind === 'dataset') {
                const datasetValue = String(rawDatasetValue || '');
                return Array.from(modal.querySelectorAll?.('[data-history-id], [data-source-key], [data-tag-id], [data-quick-view-kind]') || [])
                    .find((node) => String(node?.dataset?.[value] || '') === datasetValue) || null;
            }
            return null;
        }

        function captureSettingsTransientViewState() {
            const shadowRoot = getShadowRoot();
            const modal = shadowRoot?.querySelector?.('#sp-settings-modal');
            const content = modal?.querySelector?.('.sp-settings-modal-content');
            if (!modal || !content) return null;

            const expandedByContentId = {};
            Array.from(modal.querySelectorAll?.('.sp-settings-collapsible-toggle') || [])
                .forEach((toggle) => {
                    const contentId = toggle.getAttribute?.('aria-controls') || toggle.attrs?.['aria-controls'];
                    if (!contentId) return;
                    const expanded = toggle.getAttribute?.('aria-expanded') || toggle.attrs?.['aria-expanded'];
                    expandedByContentId[contentId] = expanded === 'true';
                });
            const documentObj = getDocument();
            const activeElement = documentObj?.activeElement;
            return {
                scrollTop: Number(content.scrollTop) || 0,
                expandedByContentId,
                focusKey: modal.contains?.(activeElement) === false
                    ? ''
                    : getSettingsFocusKey(activeElement)
            };
        }

        function closeSettingsModal(options = {}) {
            return closeManagedModal('sp-settings-modal', 'sp-settings-backdrop', options);
        }

        function isSettingsModalOpen() {
            const root = getShadowRoot();
            return Boolean(root && typeof root.querySelector === 'function' && root.querySelector('#sp-settings-modal'));
        }

        // Settings results: the modal's frosted backdrop sits above the toast layer, so a
        // success confirmation shown while the modal is open is just blurred noise — suppress it.
        // Failures always surface, and while the modal is open they are lifted above the
        // backdrop (sp-toast-elevated) so they stay readable.
        function announceSettingsResult(messageKey, variant) {
            const settingsOpen = isSettingsModalOpen();
            if (settingsOpen) {
                const root = getShadowRoot();
                const status = root?.querySelector?.('.sp-settings-action-status');
                if (status) {
                    status.textContent = getMessage(messageKey);
                    status.hidden = false;
                    status.setAttribute?.('aria-live', variant === 'error' ? 'assertive' : 'polite');
                    status.classList?.toggle?.('is-error', variant === 'error');
                    status.classList?.toggle?.('is-success', variant !== 'error');
                    return;
                }
            }
            if (variant === 'success') {
                showToast(getMessage(messageKey), { variant: 'success' });
                return;
            }
            showToast(getMessage(messageKey), { variant: 'error', elevated: settingsOpen });
        }

        function isSuccessfulHistoryMutation(result) {
            return result === true || result?.ok === true || result?.success === true;
        }

        function setButtonBusy(button, busy) {
            if (!button) return;
            button.disabled = Boolean(busy);
            if (busy) {
                button.setAttribute?.('aria-busy', 'true');
                return;
            }
            button.removeAttribute?.('aria-busy');
        }

        function normalizeVisibleQuickViewKinds(value) {
            if (!Array.isArray(value)) return QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => kind);
            const requestedKinds = new Set(value.map((kind) => String(kind || '').trim().toLowerCase()));
            return QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => kind).filter((kind) => requestedKinds.has(kind));
        }

        function renderQuickViewButtonsModal() {
            const shadowRoot = getShadowRoot();
            const documentObj = getDocument();
            if (!shadowRoot || !documentObj || !el) return false;

            prepareModalOpen('sp-quick-view-buttons-modal', 'sp-quick-view-buttons-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-quick-view-buttons-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-quick-view-buttons-modal',
                id: 'sp-quick-view-buttons-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-quick-view-buttons-title',
                tabindex: '-1'
            });
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-quick-view-buttons-title' }, [
                    getMessage('ui_settings_quick_view_buttons_title')
                ])
            ]);
            const currentVisibleKinds = new Set(normalizeVisibleQuickViewKinds(getVisibleQuickViewKinds()));
            const list = el('div', { className: 'sp-quick-view-visibility-list' }, QUICK_VIEW_BUTTON_OPTIONS.map(([kind, labelKey]) => (
                el('label', { className: 'sp-quick-view-visibility-row' }, [
                    el('input', {
                        type: 'checkbox',
                        className: 'sp-quick-view-visibility-checkbox',
                        checked: currentVisibleKinds.has(kind),
                        dataset: { quickViewKind: kind }
                    }),
                    el('span', { className: 'sp-quick-view-visibility-label' }, [getMessage(labelKey)])
                ])
            )));
            const content = el('div', { className: 'sp-folder-modal-content sp-quick-view-buttons-content' }, [
                el('p', { className: 'sp-settings-helper-text sp-quick-view-buttons-body' }, [
                    getMessage('ui_settings_quick_view_buttons_body')
                ]),
                list
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel sp-quick-view-buttons-done-btn' }, [
                    getMessage('ui_done')
                ])
            ]);

            const collectSelectedKinds = () => (
                QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => {
                    const checkbox = Array.from(list.querySelectorAll?.('.sp-quick-view-visibility-checkbox') || [])
                        .find((input) => input?.dataset?.quickViewKind === kind);
                    return checkbox?.checked ? kind : null;
                }).filter(Boolean)
            );

            Array.from(list.querySelectorAll?.('.sp-quick-view-visibility-checkbox') || []).forEach((checkbox) => {
                checkbox.addEventListener('change', () => {
                    const previousKinds = normalizeVisibleQuickViewKinds(getVisibleQuickViewKinds());
                    const nextKinds = collectSelectedKinds();
                    Promise.resolve(setVisibleQuickViewKinds(nextKinds))
                        .then(() => {
                            render();
                        })
                        .catch(() => {
                            const previousSet = new Set(previousKinds);
                            Array.from(list.querySelectorAll?.('.sp-quick-view-visibility-checkbox') || []).forEach((input) => {
                                input.checked = previousSet.has(input?.dataset?.quickViewKind);
                            });
                            showToast(getMessage('ui_settings_quick_view_buttons_save_failed'), { variant: 'error' });
                        });
                });
            });
            backdrop.addEventListener('click', () => closeManagedModal('sp-quick-view-buttons-modal', 'sp-quick-view-buttons-backdrop'));
            footer.querySelector?.('.sp-quick-view-buttons-done-btn')?.addEventListener('click', () => {
                closeManagedModal('sp-quick-view-buttons-modal', 'sp-quick-view-buttons-backdrop');
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: (options) => closeManagedModal('sp-quick-view-buttons-modal', 'sp-quick-view-buttons-backdrop', options),
                initialFocusTarget: () => modal.querySelector('.sp-quick-view-visibility-checkbox') || modal.querySelector('.sp-quick-view-buttons-done-btn')
            });
            const showWindow = () => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            };
            if (typeof rafFn === 'function') rafFn(showWindow);
            else showWindow();
            return true;
        }

        function createSettingsSubsection(className, titleKey, children = []) {
            return el('div', { className: ['sp-settings-subsection', className].filter(Boolean).join(' ') }, [
                el('h5', { className: 'sp-settings-subsection-title' }, [getMessage(titleKey)]),
                ...children
            ]);
        }

        function createDeveloperSettingsSection() {
            const developerModeToggle = el('input', {
                type: 'checkbox',
                className: 'sp-group-toggle-checkbox sp-settings-developer-mode-toggle',
                checked: getDeveloperModeEnabled(),
                'aria-label': getMessage('ui_settings_developer_mode_title')
            });

            const developerModeRow = el('div', { className: 'sp-settings-preference-row' }, [
                el('div', { className: 'sp-settings-preference-copy' }, [
                    el('div', { className: 'sp-settings-preference-title' }, [getMessage('ui_settings_developer_mode_toggle')]),
                    el('p', { className: 'sp-settings-helper-text' }, [getMessage('ui_settings_developer_mode_body')])
                ]),
                el('label', { className: 'sp-toggle-switch' }, [
                    developerModeToggle,
                    el('span', { className: 'sp-toggle-slider' })
                ])
            ]);

            const logsSubsection = createSettingsSubsection('sp-settings-developer-logs-section', 'ui_settings_developer_logs_title', [
                el('div', { className: 'sp-settings-action-row sp-settings-developer-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-copy-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_copy_developer_logs')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-download-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_download_developer_logs')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-clear-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_clear_developer_logs')
                    ])
                ])
            ]);

            const testToolsSubsection = createSettingsSubsection('sp-settings-developer-test-section', 'ui_settings_developer_test_tools_title', [
                el('div', { className: 'sp-settings-action-row sp-settings-developer-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-test-welcome-btn sp-glare-hover' }, [
                        getMessage('ui_settings_test_welcome_modal')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-test-whats-new-btn sp-glare-hover' }, [
                        getMessage('ui_settings_test_whats_new_modal')
                    ])
                ])
            ]);

            return el('section', { className: 'sp-settings-section sp-settings-developer-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_developer_features')])
                ]),
                developerModeRow,
                logsSubsection,
                testToolsSubsection
            ]);
        }

        function createAppearanceSettingsSection() {
            const hoverSpotlightToggle = el('input', {
                type: 'checkbox',
                className: 'sp-group-toggle-checkbox sp-settings-appearance-hover-spotlight-toggle',
                checked: getHoverSpotlightEnabled(),
                'aria-label': getMessage('ui_settings_appearance_hover_spotlight_title')
            });
            const hoverSpotlightRow = el('div', { className: 'sp-settings-preference-row' }, [
                el('div', { className: 'sp-settings-preference-copy' }, [
                    el('div', { className: 'sp-settings-preference-title' }, [getMessage('ui_settings_appearance_hover_spotlight_title')]),
                    el('p', { className: 'sp-settings-helper-text' }, [getMessage('ui_settings_appearance_hover_spotlight_body')])
                ]),
                el('label', { className: 'sp-toggle-switch' }, [
                    hoverSpotlightToggle,
                    el('span', { className: 'sp-toggle-slider' })
                ])
            ]);

            const dragModeToggle = el('input', {
                type: 'checkbox',
                className: 'sp-group-toggle-checkbox sp-settings-drag-mode-toggle',
                checked: getDragMode() === 'reflow',
                'aria-label': getMessage('ui_settings_drag_mode_title')
            });
            const dragModeRow = el('div', { className: 'sp-settings-preference-row' }, [
                el('div', { className: 'sp-settings-preference-copy' }, [
                    el('div', { className: 'sp-settings-preference-title' }, [getMessage('ui_settings_drag_mode_title')]),
                    el('p', { className: 'sp-settings-helper-text' }, [getMessage('ui_settings_drag_mode_body')])
                ]),
                el('label', { className: 'sp-toggle-switch' }, [
                    dragModeToggle,
                    el('span', { className: 'sp-toggle-slider' })
                ])
            ]);

            return el('section', { className: 'sp-settings-section sp-settings-appearance-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_appearance_title')])
                ]),
                hoverSpotlightRow,
                dragModeRow
            ]);
        }

        function bindAppearanceSettingsActions(container) {
            const toggle = container.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            if (toggle) {
                toggle.addEventListener('change', (event) => {
                    const next = Boolean(event?.target?.checked ?? toggle.checked);
                    Promise.resolve(setHoverSpotlightEnabled(next))
                        .then(() => {
                            announceSettingsResult(next ? 'ui_settings_appearance_hover_spotlight_enabled' : 'ui_settings_appearance_hover_spotlight_disabled', 'success');
                        })
                        .catch(() => {
                            toggle.checked = !next;
                            if (toggle.attrs) toggle.attrs.checked = !next;
                            announceSettingsResult('ui_settings_appearance_hover_spotlight_failed', 'error');
                        });
                });
            }
            const dragToggle = container.querySelector('.sp-settings-drag-mode-toggle');
            if (dragToggle) {
                dragToggle.addEventListener('change', (event) => {
                    const enabled = Boolean(event?.target?.checked ?? dragToggle.checked);
                    const nextMode = enabled ? 'reflow' : 'classic';
                    Promise.resolve(setDragMode(nextMode))
                        .then(() => {
                            announceSettingsResult(enabled ? 'ui_settings_drag_mode_enabled' : 'ui_settings_drag_mode_disabled', 'success');
                        })
                        .catch(() => {
                            const actualEnabled = getDragMode() === 'reflow';
                            dragToggle.checked = actualEnabled;
                            if (dragToggle.attrs) dragToggle.attrs.checked = actualEnabled;
                            announceSettingsResult('ui_settings_drag_mode_failed', 'error');
                        });
                });
            }
        }

        function bindDeveloperSettingsActions(container) {
            container.querySelector('.sp-settings-developer-mode-toggle')?.addEventListener('change', (event) => {
                const enabled = Boolean(event?.target?.checked ?? container.querySelector('.sp-settings-developer-mode-toggle')?.checked);
                Promise.resolve(setDeveloperModeEnabled(enabled))
                    .then(() => {
                        announceSettingsResult(enabled ? 'ui_settings_developer_mode_enabled' : 'ui_settings_developer_mode_disabled', 'success');
                    })
                    .catch(() => {
                        announceSettingsResult('ui_settings_developer_mode_failed', 'error');
                    });
            });
            container.querySelector('.sp-settings-copy-developer-logs-btn')?.addEventListener('click', () => {
                copyDeveloperLogsTextToClipboard();
            });
            container.querySelector('.sp-settings-download-developer-logs-btn')?.addEventListener('click', () => {
                downloadDeveloperLogsText();
            });
            container.querySelector('.sp-settings-test-welcome-btn')?.addEventListener('click', () => {
                closeSettingsModal({ immediate: true, restoreFocus: false });
                renderWelcomeModal();
            });
            container.querySelector('.sp-settings-test-whats-new-btn')?.addEventListener('click', () => {
                closeSettingsModal({ immediate: true, restoreFocus: false });
                renderWhatsNewModal({ markSeenOnClose: false });
            });
            container.querySelector('.sp-settings-clear-developer-logs-btn')?.addEventListener('click', () => {
                Promise.resolve(clearDeveloperLogs())
                    .then((ok) => {
                        announceSettingsResult(ok ? 'ui_settings_developer_logs_cleared' : 'ui_settings_developer_logs_clear_failed', ok ? 'success' : 'error');
                    })
                    .catch(() => {
                        announceSettingsResult('ui_settings_developer_logs_clear_failed', 'error');
                    });
            });
        }

        function unlockDeveloperSettings(content, unlockRow) {
            const win = getWindow();
            if (!win || typeof win.prompt !== 'function') {
                showToast(getMessage('ui_settings_developer_password_failed'), { variant: 'error' });
                return false;
            }

            const enteredPassword = win.prompt(getMessage('ui_settings_developer_password_prompt'));
            if (enteredPassword === null || enteredPassword === undefined) {
                return false;
            }
            if (enteredPassword !== settingsDeveloperPassword) {
                showToast(getMessage('ui_settings_developer_password_failed'), { variant: 'error' });
                return false;
            }

            const developerSection = createDeveloperSettingsSection();
            removeModalNode(unlockRow);
            content.appendChild(developerSection);
            bindDeveloperSettingsActions(developerSection);
            return true;
        }

        function renderSettingsModal(modalState = {}) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;

            const normalizedModalState = modalState && typeof modalState === 'object' ? modalState : {};
            const transientViewState = normalizedModalState.transientViewState
                || captureSettingsTransientViewState()
                || {};
            const importText = String(normalizedModalState.importText || '');
            const preview = Object.prototype.hasOwnProperty.call(normalizedModalState, 'preview')
                ? normalizedModalState.preview
                : (importText.trim() ? previewImportConfig(importText) : null);
            const exportText = getExportConfigText();

            prepareModalOpen('sp-settings-modal', 'sp-settings-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-settings-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-settings-modal',
                id: 'sp-settings-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-settings-modal-title',
                tabindex: '-1'
            });
            const header = el('div', { className: 'sp-folder-modal-header sp-settings-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-settings-modal-title' }, [getMessage('ui_settings')]),
                el('div', {
                    id: 'sp-settings-save-status-section',
                    className: 'sp-settings-save-status-header',
                    hidden: true
                }, [
                    el('div', {
                        id: 'sp-settings-save-status',
                        className: 'sp-save-status sp-save-status-idle',
                        role: 'status',
                        'aria-live': 'polite',
                        hidden: true
                    })
                ])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-settings-modal-content' });
            const settingsStatusKey = String(normalizedModalState.settingsStatusKey || '');
            const settingsStatusVariant = normalizedModalState.settingsStatusVariant === 'error'
                ? 'is-error'
                : 'is-success';
            const settingsActionStatus = el('div', {
                className: `sp-settings-helper-text sp-settings-action-status ${settingsStatusVariant}`,
                role: 'status',
                'aria-live': settingsStatusVariant === 'is-error' ? 'assertive' : 'polite',
                hidden: !settingsStatusKey
            }, [
                settingsStatusKey ? getMessage(settingsStatusKey) : ''
            ]);
            const exportTextarea = el('textarea', {
                className: 'sp-settings-textarea sp-settings-export-textarea',
                readonly: true,
                spellcheck: 'false',
                'aria-label': getMessage('ui_settings_export_title')
            });
            exportTextarea.value = exportText;
            const importTextarea = el('textarea', {
                className: 'sp-settings-textarea sp-settings-import-textarea',
                spellcheck: 'false',
                placeholder: getMessage('ui_settings_import_placeholder'),
                'aria-label': getMessage('ui_settings_import_title')
            });
            importTextarea.value = importText;

            const previewMessage = getImportPreviewMessage(preview);
            const previewClassName = 'sp-settings-import-preview' + (preview?.ok ? ' is-valid' : (preview ? ' is-invalid' : ''));
            const importFileInput = el('input', {
                type: 'file',
                accept: 'application/json,.json',
                className: 'sp-settings-file-input',
                tabindex: '-1',
                'aria-hidden': 'true'
            });

            const createCollapsibleSettingsSection = ({
                className = '',
                titleKey,
                contentId,
                initiallyExpanded = false,
                children = []
            }) => {
                const rememberedExpanded = transientViewState.expandedByContentId?.[contentId];
                const resolvedInitiallyExpanded = typeof rememberedExpanded === 'boolean'
                    ? rememberedExpanded
                    : initiallyExpanded;
                const body = el('div', {
                    id: contentId,
                    className: 'sp-settings-collapsible-body',
                    'aria-hidden': resolvedInitiallyExpanded ? 'false' : 'true'
                }, [
                    el('div', { className: 'sp-settings-collapsible-inner' }, children)
                ]);
                body.inert = !resolvedInitiallyExpanded;

                const toggle = el('button', {
                    type: 'button',
                    className: 'sp-settings-collapsible-toggle',
                    'aria-expanded': resolvedInitiallyExpanded ? 'true' : 'false',
                    'aria-controls': contentId,
                    title: getMessage(resolvedInitiallyExpanded ? 'ui_collapse' : 'ui_expand')
                }, [
                    el('span', { className: 'sp-settings-section-title' }, [getMessage(titleKey)]),
                    el('span', { className: 'google-symbols sp-settings-collapsible-chevron', 'aria-hidden': 'true' }, ['expand_more'])
                ]);

                const sectionClassName = [
                    'sp-settings-section',
                    'sp-settings-collapsible-section',
                    className,
                    resolvedInitiallyExpanded ? 'is-expanded' : 'is-collapsed'
                ].filter(Boolean).join(' ');
                const section = el('section', { className: sectionClassName }, [
                    el('div', { className: 'sp-settings-section-header sp-settings-collapsible-header' }, [
                        toggle
                    ]),
                    body
                ]);

                const setExpanded = (expanded) => {
                    section.classList.toggle('is-expanded', expanded);
                    section.classList.toggle('is-collapsed', !expanded);
                    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    toggle.setAttribute('title', getMessage(expanded ? 'ui_collapse' : 'ui_expand'));
                    body.setAttribute('aria-hidden', expanded ? 'false' : 'true');
                    body.inert = !expanded;
                };
                toggle.addEventListener('click', () => {
                    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
                });

                return { body, section, setExpanded, toggle };
            };

            const exportSubsection = createSettingsSubsection('sp-settings-export-section', 'ui_settings_export_title', [
                el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-copy-export-btn sp-glare-hover' }, [
                        getMessage('ui_settings_copy_json')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-download-export-btn sp-glare-hover' }, [
                        getMessage('ui_settings_download_json')
                    ])
                ]),
                exportTextarea
            ]);

            const importSubsection = createSettingsSubsection('sp-settings-import-section', 'ui_settings_import_title', [
                el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-choose-import-btn sp-glare-hover' }, [
                        getMessage('ui_settings_choose_json')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-preview-import-btn sp-glare-hover' }, [
                        getMessage('ui_settings_preview_import')
                    ])
                ]),
                importFileInput,
                importTextarea,
                el('div', { className: previewClassName, 'aria-live': 'polite' }, [
                    previewMessage,
                    ...createImportPreviewDetailNodes(preview)
                ])
            ]);

            const historyEntries = getStateHistoryEntries();
            const historyStatusKey = String(normalizedModalState.historyStatusKey || '');
            const historyStatusArgs = Array.isArray(normalizedModalState.historyStatusArgs)
                ? normalizedModalState.historyStatusArgs.map((value) => String(value))
                : [];
            const historyStatusVariant = normalizedModalState.historyStatusVariant === 'error'
                ? 'is-error'
                : 'is-success';
            const historyActionStatus = el('div', {
                className: `sp-settings-helper-text sp-history-action-status ${historyStatusVariant}`,
                role: 'status',
                'aria-live': 'polite',
                hidden: !historyStatusKey
            }, [
                historyStatusKey ? getMessage(historyStatusKey, historyStatusArgs) : ''
            ]);
            const historySubsection = createSettingsSubsection('sp-settings-history-section', 'ui_history_title', [
                ...createHistoryPreferenceNodes(historyEntries),
                historyActionStatus,
                ...createHistoryNodes(historyEntries)
            ]);
            const importBackupInfo = getImportBackupInfo();
            const importBackupStatusKey = String(normalizedModalState.importBackupStatusKey || '');
            const importBackupStatusVariant = normalizedModalState.importBackupStatusVariant === 'error'
                ? 'is-error'
                : 'is-success';
            const importBackupStatus = el('div', {
                className: `sp-settings-helper-text sp-import-backup-status ${importBackupStatusVariant}`,
                role: 'status',
                'aria-live': importBackupStatusVariant === 'is-error' ? 'assertive' : 'polite',
                hidden: !importBackupStatusKey
            }, [
                importBackupStatusKey ? getMessage(importBackupStatusKey) : ''
            ]);
            const importBackupNodes = [importBackupStatus];
            if (importBackupInfo) {
                const createdAt = importBackupInfo.createdAt
                    ? new Date(importBackupInfo.createdAt).toLocaleString()
                    : getMessage('ui_import_backup_created_unknown');
                const sourceCount = Number(importBackupInfo.sourceCount) || 0;
                const groupCount = Number(importBackupInfo.groupCount) || 0;
                importBackupNodes.unshift(createSettingsSubsection(
                    'sp-settings-import-backup-section',
                    'ui_import_backup_title',
                    [
                        el('p', { className: 'sp-settings-helper-text sp-import-backup-created-at' }, [
                            getMessage('ui_import_backup_created_at', [createdAt])
                        ]),
                        el('p', { className: 'sp-settings-helper-text sp-import-backup-counts' }, [
                            getMessage('ui_import_backup_counts', [
                                String(sourceCount),
                                String(groupCount)
                            ])
                        ]),
                        el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                            el('button', {
                                type: 'button',
                                className: 'sp-button sp-import-backup-restore-btn sp-glare-hover',
                                dataset: { settingsFocusKey: 'import-backup-restore' }
                            }, [getMessage('ui_import_backup_restore')]),
                            el('button', {
                                type: 'button',
                                className: 'sp-button sp-import-backup-discard-btn',
                                dataset: { settingsFocusKey: 'import-backup-discard' }
                            }, [getMessage('ui_import_backup_discard')])
                        ])
                    ]
                ));
            }
            const backupSection = createCollapsibleSettingsSection({
                className: 'sp-settings-backup-section sp-settings-import-section',
                titleKey: 'ui_settings_backup_restore_title',
                contentId: 'sp-settings-backup-content',
                initiallyExpanded: Boolean(
                    importText.trim()
                    || preview
                    || normalizedModalState.manageStorage
                    || importBackupInfo
                    || importBackupStatusKey
                ),
                children: [exportSubsection, importSubsection, ...importBackupNodes, historySubsection]
            });
            content.appendChild(createLanguagePreferenceSection());
            content.appendChild(settingsActionStatus);
            const appearanceSection = createAppearanceSettingsSection();
            content.appendChild(appearanceSection);
            bindAppearanceSettingsActions(appearanceSection);
            content.appendChild(backupSection.section);

            const sourceRepairReport = getSourceRepairReport();
            const sourceRepairIssueCount = (sourceRepairReport?.unmatchedSources || 0) + (sourceRepairReport?.ambiguousSources || 0);

            const diagnosticsCopyButton = el('button', {
                type: 'button',
                className: 'sp-button sp-settings-copy-diagnostics-btn sp-glare-hover'
            }, [
                getMessage('ui_settings_copy_diagnostics')
            ]);
            const helpChildren = [
                createSettingsSubsection('sp-settings-onboarding-help', 'ui_onboarding_checklist_title', [
                    el('button', {
                        type: 'button',
                        className: 'sp-button sp-settings-replay-onboarding-btn sp-glare-hover',
                        dataset: { settingsFocusKey: 'replay-onboarding' }
                    }, [getMessage('ui_settings_replay_onboarding')])
                ]),
                createSettingsSubsection('sp-settings-shortcuts-guide', 'ui_settings_shortcuts_guide_title', [
                    el('p', { className: 'sp-settings-helper-text' }, [
                        getMessage('ui_settings_shortcuts_guide_body')
                    ])
                ]),
                createSettingsSubsection('sp-settings-import-guide', 'ui_settings_import_guide_title', [
                    el('p', { className: 'sp-settings-helper-text' }, [
                        getMessage('ui_settings_import_guide_body')
                    ])
                ]),
                el('p', { className: 'sp-settings-helper-text sp-settings-feedback-body' }, [
                    getMessage('ui_settings_feedback_body')
                ]),
                el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-open-web-store-feedback-btn sp-glare-hover' }, [
                        getMessage('ui_settings_open_web_store_feedback')
                    ]),
                    diagnosticsCopyButton
                ]),
                createSettingsSubsection('sp-settings-diagnostics-section', 'ui_settings_diagnostics_title', [
                    createDiagnosticsGrid()
                ])
            ];
            if (!sourceRepairIssueCount) {
                helpChildren.push(createSettingsSubsection('sp-settings-source-repair-inline', 'ui_settings_troubleshooting_title', createSourceRepairNodes(sourceRepairReport)));
            }
            const helpSection = createCollapsibleSettingsSection({
                className: 'sp-settings-help-section',
                titleKey: 'ui_settings_help_feedback_title',
                contentId: 'sp-settings-help-content',
                children: helpChildren
            });
            content.appendChild(helpSection.section);

            if (sourceRepairIssueCount) {
                const repairSection = createCollapsibleSettingsSection({
                    className: 'sp-settings-source-repair-section',
                    titleKey: 'ui_source_repair_title',
                    contentId: 'sp-settings-source-repair-content',
                    initiallyExpanded: true,
                    children: createSourceRepairNodes(sourceRepairReport)
                });
                content.appendChild(repairSection.section);
            }
            let developerUnlockRow = null;
            let developerSection = null;
            if (getDeveloperModeEnabled()) {
                developerSection = createDeveloperSettingsSection();
                content.appendChild(developerSection);
            } else {
                developerUnlockRow = el('div', { className: 'sp-settings-developer-unlock-row' }, [
                    el('button', {
                        type: 'button',
                        className: 'sp-settings-developer-unlock-btn',
                        title: getMessage('ui_settings_developer_features')
                    }, [getMessage('ui_settings_developer_features')])
                ]);
                content.appendChild(developerUnlockRow);
            }

            const footerButtons = [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ];
            if (preview && preview.ok) {
                footerButtons.push(el('button', {
                    type: 'button',
                    className: 'sp-button sp-settings-apply-import-btn sp-glare-hover'
                }, [getMessage('ui_settings_apply_import')]));
            }
            const footer = el('div', { className: 'sp-folder-modal-footer' }, footerButtons);

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);
            renderSaveStatus();

            content.querySelector('.sp-settings-copy-export-btn')?.addEventListener('click', () => {
                Promise.resolve(copySettingsTextToClipboard(exportText, exportTextarea))
                    .then((ok) => announceSettingsResult(
                        ok ? 'ui_settings_export_copied' : 'ui_settings_export_copy_failed',
                        ok ? 'success' : 'error'
                    ));
            });
            content.querySelector('.sp-settings-download-export-btn')?.addEventListener('click', () => {
                const ok = downloadSettingsExportText(exportText);
                announceSettingsResult(
                    ok ? 'ui_settings_export_downloaded' : 'ui_settings_export_download_failed',
                    ok ? 'success' : 'error'
                );
            });
            Array.from(content.querySelectorAll?.('.sp-settings-copy-diagnostics-btn') || []).forEach((button) => {
                button.addEventListener('click', () => {
                    Promise.resolve(copyDiagnosticsTextToClipboard())
                        .then((ok) => announceSettingsResult(
                            ok ? 'ui_settings_diagnostics_copied' : 'ui_settings_diagnostics_copy_failed',
                            ok ? 'success' : 'error'
                        ));
                });
            });
            content.querySelector('.sp-settings-open-web-store-feedback-btn')?.addEventListener('click', () => {
                openWebStoreFeedback();
            });
            content.querySelector('.sp-settings-replay-onboarding-btn')?.addEventListener('click', () => {
                closeSettingsModal({ immediate: true, restoreFocus: false });
                renderWelcomeModal({ markSeenOnClose: false });
            });
            const updateImportBackupStatus = (messageKey, variant = 'error') => {
                importBackupStatus.textContent = getMessage(messageKey);
                importBackupStatus.hidden = false;
                importBackupStatus.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
                importBackupStatus.classList.toggle('is-error', variant === 'error');
                importBackupStatus.classList.toggle('is-success', variant !== 'error');
            };
            const runImportBackupAction = (button, operation, successKey, failureKey) => {
                setButtonBusy(button, true);
                Promise.resolve()
                    .then(operation)
                    .then((result) => {
                        if (!isSuccessfulHistoryMutation(result)) {
                            updateImportBackupStatus(failureKey, 'error');
                            setButtonBusy(button, false);
                            return;
                        }
                        renderSettingsModal({
                            ...normalizedModalState,
                            importBackupStatusKey: successKey,
                            importBackupStatusVariant: 'success'
                        });
                    })
                    .catch(() => {
                        updateImportBackupStatus(failureKey, 'error');
                        setButtonBusy(button, false);
                    });
            };
            content.querySelector('.sp-import-backup-restore-btn')?.addEventListener('click', () => {
                const button = content.querySelector('.sp-import-backup-restore-btn');
                runImportBackupAction(
                    button,
                    restoreImportBackup,
                    'ui_import_backup_restore_success',
                    'ui_import_backup_restore_failed'
                );
            });
            content.querySelector('.sp-import-backup-discard-btn')?.addEventListener('click', () => {
                const win = getWindow();
                if (
                    !win
                    || typeof win.confirm !== 'function'
                    || !win.confirm(getMessage('ui_import_backup_discard_confirm'))
                ) {
                    return;
                }
                const button = content.querySelector('.sp-import-backup-discard-btn');
                runImportBackupAction(
                    button,
                    discardImportBackup,
                    'ui_import_backup_discard_success',
                    'ui_import_backup_discard_failed'
                );
            });
            content.querySelector('.sp-settings-open-command-palette-btn')?.addEventListener('click', () => {
                closeSettingsModal({ immediate: true, restoreFocus: false });
                renderCommandPaletteModal();
            });
            content.querySelector('.sp-settings-manage-quick-view-buttons-btn')?.addEventListener('click', () => {
                closeSettingsModal({ immediate: true, restoreFocus: false });
                renderQuickViewButtonsModal();
            });
            content.querySelector('.sp-settings-language-select')?.addEventListener('change', (event) => {
                const nextLanguage = event?.target?.value || 'auto';
                Promise.resolve(setLanguageOverride(nextLanguage))
                    .then(() => {
                        renderSettingsModal({
                            ...normalizedModalState,
                            settingsStatusKey: 'ui_settings_language_updated',
                            settingsStatusVariant: 'success'
                        });
                    })
                    .catch(() => {
                        announceSettingsResult('ui_settings_language_update_failed', 'error');
                    });
            });
            content.querySelector('.sp-history-retention-select')?.addEventListener('change', (event) => {
                const nextLimit = Number(event?.target?.value) || 20;
                Promise.resolve(setHistoryRetentionLimit(nextLimit))
                    .then(() => {
                        announceSettingsResult('ui_history_retention_updated', 'success');
                        renderSettingsModal(normalizedModalState);
                    })
                    .catch(() => {
                        announceSettingsResult('ui_history_retention_update_failed', 'error');
                    });
            });
            content.querySelector('.sp-history-create-restore-point-btn')?.addEventListener('click', () => {
                const win = getWindow();
                const defaultLabel = new Date().toLocaleString();
                const label = win && typeof win.prompt === 'function'
                    ? win.prompt(getMessage('ui_history_restore_point_prompt'), defaultLabel)
                    : defaultLabel;
                if (label === null || label === undefined) return;
                Promise.resolve(createManualRestorePoint(String(label || '').trim()))
                    .then((ok) => {
                        if (ok) {
                            renderSettingsModal(normalizedModalState);
                        }
                    });
            });
            const updateHistoryStatus = (messageKey, variant = 'error', substitutions = []) => {
                historyActionStatus.textContent = getMessage(messageKey, substitutions.map((value) => String(value)));
                historyActionStatus.hidden = false;
                historyActionStatus.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
                historyActionStatus.classList.toggle('is-error', variant === 'error');
                historyActionStatus.classList.toggle('is-success', variant !== 'error');
            };
            const runHistoryMutation = (button, operation, successKey, failureKey) => {
                setButtonBusy(button, true);
                Promise.resolve()
                    .then(operation)
                    .then((result) => {
                        if (!isSuccessfulHistoryMutation(result)) {
                            updateHistoryStatus(failureKey, 'error');
                            setButtonBusy(button, false);
                            return;
                        }
                        renderSettingsModal({
                            ...normalizedModalState,
                            manageStorage: true,
                            historyStatusKey: successKey,
                            historyStatusVariant: 'success',
                            historyStatusArgs: [String(result?.deletedCount ?? 0)]
                        });
                    })
                    .catch(() => {
                        updateHistoryStatus(failureKey, 'error');
                        setButtonBusy(button, false);
                    });
            };
            Array.from(content.querySelectorAll?.('.sp-history-delete-btn') || []).forEach((button) => {
                button.addEventListener('click', () => {
                    const historyId = button.dataset?.historyId || '';
                    runHistoryMutation(
                        button,
                        () => deleteStateHistoryEntry(historyId),
                        'ui_history_delete_success',
                        'ui_history_delete_failed'
                    );
                });
            });
            content.querySelector('.sp-history-clear-automatic-btn')?.addEventListener('click', () => {
                const win = getWindow();
                if (
                    !win ||
                    typeof win.confirm !== 'function' ||
                    !win.confirm(getMessage('ui_history_clear_automatic_confirm'))
                ) {
                    return;
                }
                const button = content.querySelector('.sp-history-clear-automatic-btn');
                runHistoryMutation(
                    button,
                    () => clearStateHistory('automatic'),
                    'ui_history_clear_automatic_success',
                    'ui_history_clear_automatic_failed'
                );
            });
            content.querySelector('.sp-history-clear-all-btn')?.addEventListener('click', () => {
                const win = getWindow();
                if (
                    !win ||
                    typeof win.confirm !== 'function' ||
                    !win.confirm(getMessage('ui_history_clear_all_confirm'))
                ) {
                    return;
                }
                const button = content.querySelector('.sp-history-clear-all-btn');
                runHistoryMutation(
                    button,
                    () => clearStateHistory('all'),
                    'ui_history_clear_all_success',
                    'ui_history_clear_all_failed'
                );
            });
            if (developerSection) {
                bindDeveloperSettingsActions(developerSection);
            }
            developerUnlockRow?.querySelector('.sp-settings-developer-unlock-btn')?.addEventListener('click', () => {
                unlockDeveloperSettings(content, developerUnlockRow);
            });
            content.querySelector('.sp-settings-choose-import-btn')?.addEventListener('click', () => {
                importFileInput.click?.();
            });
            importFileInput.addEventListener('change', () => {
                const file = importFileInput.files?.[0];
                const didStartRead = readSettingsImportFile(file, (fileText) => {
                    renderSettingsModal({
                        importText: fileText,
                        preview: previewImportConfig(fileText)
                    });
                }, () => {
                    announceSettingsResult('ui_settings_import_file_invalid', 'error');
                });
                if (!didStartRead) {
                    announceSettingsResult('ui_settings_import_file_invalid', 'error');
                }
            });
            content.querySelector('.sp-settings-preview-import-btn')?.addEventListener('click', () => {
                renderSettingsModal({
                    importText: importTextarea.value,
                    preview: previewImportConfig(importTextarea.value)
                });
            });
            importTextarea.addEventListener('input', () => {
                const applyButton = modal.querySelector('.sp-settings-apply-import-btn');
                if (applyButton) applyButton.disabled = true;
            });
            Array.from(content.querySelectorAll?.('.sp-source-repair-select') || []).forEach((select) => {
                select.addEventListener('change', () => {
                    const applyButton = modal.querySelector('.sp-source-repair-apply-btn');
                    if (!applyButton) return;
                    const hasSelection = Array.from(modal.querySelectorAll('.sp-source-repair-select'))
                        .some((item) => Boolean(item.value));
                    applyButton.disabled = !hasSelection;
                });
            });
            content.querySelector('.sp-source-repair-apply-btn')?.addEventListener('click', () => {
                const remaps = {};
                Array.from(modal.querySelectorAll('.sp-source-repair-select')).forEach((select) => {
                    const storedKey = select.dataset?.storedKey || '';
                    if (storedKey && select.value) {
                        remaps[storedKey] = select.value;
                    }
                });
                applySourceRepairRemaps(remaps).then((ok) => {
                    if (ok) closeSettingsModal();
                });
            });
            Array.from(content.querySelectorAll?.('.sp-history-restore-btn') || []).forEach((button) => {
                button.addEventListener('click', () => {
                    const historyId = button.dataset?.historyId || '';
                    restoreStateHistoryEntry(historyId).then((ok) => {
                        if (ok) closeSettingsModal();
                    });
                });
            });
            footer.querySelector('.sp-modal-cancel')?.addEventListener('click', closeSettingsModal);
            const applyImportButton = footer.querySelector('.sp-settings-apply-import-btn');
            applyImportButton?.addEventListener('click', () => {
                const importTextInner = importTextarea.value;
                applyImportButton.disabled = true;
                applyImportButton.setAttribute('aria-busy', 'true');
                Promise.resolve(applyImportConfig(importTextInner))
                    .then((result) => {
                        if (result && result.ok) {
                            closeSettingsModal();
                            return;
                        }
                        renderSettingsModal({
                            importText: importTextInner,
                            preview: result || previewImportConfig(importTextInner)
                        });
                    })
                    .catch((error) => {
                        console.warn('GeminiNotebook-Source-Management: Import failed.', error);
                        renderSettingsModal({
                            importText: importTextInner,
                            preview: previewImportConfig(importTextInner)
                        });
                    });
            });
            backdrop.addEventListener('click', closeSettingsModal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeSettingsModal,
                initialFocusTarget: () => (
                    normalizedModalState.manageStorage
                        ? modal.querySelector('.sp-history-storage-summary')
                        : null
                ) || modal.querySelector('.sp-settings-backup-section .sp-settings-collapsible-toggle') || modal.querySelector('.sp-modal-cancel')
            });
            const showWindow = () => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                content.scrollTop = Number(transientViewState.scrollTop) || 0;
                const restoredFocusTarget = findSettingsFocusTarget(
                    modal,
                    transientViewState.focusKey
                );
                if (restoredFocusTarget?.focus) {
                    restoredFocusTarget.focus();
                } else {
                    modalKeyboard.focusInitial();
                }
            };
            if (typeof rafFn === 'function') rafFn(showWindow);
            else showWindow();

            return true;
        }

        function renderManageStorage() {
            return renderSettingsModal({ manageStorage: true });
        }

        return {
            closeSettingsModal,
            renderSettingsModal,
            renderManageStorage,
            renderQuickViewButtonsModal,
            createDeveloperSettingsSection,
            bindDeveloperSettingsActions,
            unlockDeveloperSettings,
            normalizeVisibleQuickViewKinds
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODAL_SETTINGS = createContentModalSettings;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModalSettings;
    }
})();
