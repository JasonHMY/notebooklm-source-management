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
            clearDeveloperLogs = () => Promise.resolve(false),
            getStateHistoryEntries = () => [],
            restoreStateHistoryEntry = () => Promise.resolve(false),
            getExportConfigText = () => '{}',
            previewImportConfig = () => null,
            applyImportConfig = () => Promise.resolve({ ok: false }),
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
            throw new Error('NotebookLM Source Management: createContentModalSettings requires el, getMessage and getShadowRoot.');
        }

        function closeSettingsModal(options = {}) {
            return closeManagedModal('sp-settings-modal', 'sp-settings-backdrop', options);
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

        function createDeveloperSettingsSection() {
            const developerModeToggle = el('input', {
                type: 'checkbox',
                className: 'sp-settings-developer-mode-toggle',
                checked: getDeveloperModeEnabled(),
                'aria-label': getMessage('ui_settings_developer_mode_title')
            });

            return el('section', { className: 'sp-settings-section sp-settings-developer-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_developer_features')]),
                    el('label', { className: 'sp-settings-action-row sp-settings-developer-toggle-row' }, [
                        developerModeToggle,
                        el('span', { className: 'sp-settings-helper-text' }, [getMessage('ui_settings_developer_mode_toggle')])
                    ])
                ]),
                el('p', { className: 'sp-settings-helper-text sp-settings-developer-body' }, [
                    getMessage('ui_settings_developer_mode_body')
                ]),
                el('div', { className: 'sp-settings-action-row sp-settings-developer-actions' }, [
                    el('button', { type: 'button', className: 'sp-button sp-settings-copy-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_copy_developer_logs')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-download-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_download_developer_logs')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-clear-developer-logs-btn sp-glare-hover' }, [
                        getMessage('ui_settings_clear_developer_logs')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-test-welcome-btn sp-glare-hover' }, [
                        getMessage('ui_settings_test_welcome_modal')
                    ]),
                    el('button', { type: 'button', className: 'sp-button sp-settings-test-whats-new-btn sp-glare-hover' }, [
                        getMessage('ui_settings_test_whats_new_modal')
                    ])
                ])
            ]);
        }

        function createAppearanceSettingsSection() {
            const hoverSpotlightToggle = el('input', {
                type: 'checkbox',
                className: 'sp-settings-appearance-hover-spotlight-toggle',
                checked: getHoverSpotlightEnabled(),
                'aria-label': getMessage('ui_settings_appearance_hover_spotlight_title')
            });

            const hoverSpotlightRow = el('label', { className: 'sp-settings-action-row sp-settings-appearance-toggle-row' }, [
                hoverSpotlightToggle,
                el('span', { className: 'sp-settings-helper-text' }, [getMessage('ui_settings_appearance_hover_spotlight_title')])
            ]);

            return el('section', { className: 'sp-settings-section sp-settings-appearance-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_appearance_title')]),
                    hoverSpotlightRow
                ]),
                el('p', { className: 'sp-settings-helper-text sp-settings-appearance-body' }, [
                    getMessage('ui_settings_appearance_hover_spotlight_body')
                ])
            ]);
        }

        function bindAppearanceSettingsActions(container) {
            const toggle = container.querySelector('.sp-settings-appearance-hover-spotlight-toggle');
            if (!toggle) return;
            toggle.addEventListener('change', (event) => {
                const next = Boolean(event?.target?.checked ?? toggle.checked);
                Promise.resolve(setHoverSpotlightEnabled(next))
                    .then(() => {
                        showToast(getMessage(next ? 'ui_settings_appearance_hover_spotlight_enabled' : 'ui_settings_appearance_hover_spotlight_disabled'), { variant: 'success' });
                    })
                    .catch(() => {
                        toggle.checked = !next;
                        if (toggle.attrs) toggle.attrs.checked = !next;
                        showToast(getMessage('ui_settings_appearance_hover_spotlight_failed'), { variant: 'error' });
                    });
            });
        }

        function bindDeveloperSettingsActions(container) {
            container.querySelector('.sp-settings-developer-mode-toggle')?.addEventListener('change', (event) => {
                const enabled = Boolean(event?.target?.checked ?? container.querySelector('.sp-settings-developer-mode-toggle')?.checked);
                Promise.resolve(setDeveloperModeEnabled(enabled))
                    .then(() => {
                        showToast(getMessage(enabled ? 'ui_settings_developer_mode_enabled' : 'ui_settings_developer_mode_disabled'), { variant: 'success' });
                    })
                    .catch(() => {
                        showToast(getMessage('ui_settings_developer_mode_failed'), { variant: 'error' });
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
                        showToast(getMessage(ok ? 'ui_settings_developer_logs_cleared' : 'ui_settings_developer_logs_clear_failed'), {
                            variant: ok ? 'success' : 'error'
                        });
                    })
                    .catch(() => {
                        showToast(getMessage('ui_settings_developer_logs_clear_failed'), { variant: 'error' });
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
                const body = el('div', {
                    id: contentId,
                    className: 'sp-settings-collapsible-body',
                    'aria-hidden': initiallyExpanded ? 'false' : 'true'
                }, [
                    el('div', { className: 'sp-settings-collapsible-inner' }, children)
                ]);
                body.inert = !initiallyExpanded;

                const toggle = el('button', {
                    type: 'button',
                    className: 'sp-settings-collapsible-toggle',
                    'aria-expanded': initiallyExpanded ? 'true' : 'false',
                    'aria-controls': contentId,
                    title: getMessage(initiallyExpanded ? 'ui_collapse' : 'ui_expand')
                }, [
                    el('span', { className: 'sp-settings-section-title' }, [getMessage(titleKey)]),
                    el('span', { className: 'google-symbols sp-settings-collapsible-chevron', 'aria-hidden': 'true' }, ['expand_more'])
                ]);

                const sectionClassName = [
                    'sp-settings-section',
                    'sp-settings-collapsible-section',
                    className,
                    initiallyExpanded ? 'is-expanded' : 'is-collapsed'
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

            const createSettingsSubsection = (className, titleKey, children = []) => (
                el('div', { className: ['sp-settings-subsection', className].filter(Boolean).join(' ') }, [
                    el('h5', { className: 'sp-settings-subsection-title' }, [getMessage(titleKey)]),
                    ...children
                ])
            );

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

            const historySubsection = createSettingsSubsection('sp-settings-history-section', 'ui_history_title', [
                ...createHistoryPreferenceNodes(),
                ...createHistoryNodes(getStateHistoryEntries())
            ]);
            const backupSection = createCollapsibleSettingsSection({
                className: 'sp-settings-backup-section sp-settings-import-section',
                titleKey: 'ui_settings_backup_restore_title',
                contentId: 'sp-settings-backup-content',
                initiallyExpanded: Boolean(importText.trim() || preview),
                children: [exportSubsection, importSubsection, historySubsection]
            });
            content.appendChild(backupSection.section);
            content.appendChild(createLanguagePreferenceSection());
            const appearanceSection = createAppearanceSettingsSection();
            content.appendChild(appearanceSection);
            bindAppearanceSettingsActions(appearanceSection);

            const sourceRepairReport = getSourceRepairReport();
            const sourceRepairIssueCount = (sourceRepairReport?.unmatchedSources || 0) + (sourceRepairReport?.ambiguousSources || 0);

            const diagnosticsCopyButton = el('button', {
                type: 'button',
                className: 'sp-button sp-settings-copy-diagnostics-btn sp-glare-hover'
            }, [
                getMessage('ui_settings_copy_diagnostics')
            ]);
            const helpChildren = [
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
                copySettingsTextToClipboard(exportText, exportTextarea);
            });
            content.querySelector('.sp-settings-download-export-btn')?.addEventListener('click', () => {
                downloadSettingsExportText(exportText);
            });
            Array.from(content.querySelectorAll?.('.sp-settings-copy-diagnostics-btn') || []).forEach((button) => {
                button.addEventListener('click', () => {
                    copyDiagnosticsTextToClipboard();
                });
            });
            content.querySelector('.sp-settings-open-web-store-feedback-btn')?.addEventListener('click', () => {
                openWebStoreFeedback();
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
                Promise.resolve(setLanguageOverride(nextLanguage)).then(() => {
                    renderSettingsModal(normalizedModalState);
                });
            });
            content.querySelector('.sp-history-retention-select')?.addEventListener('change', (event) => {
                const nextLimit = Number(event?.target?.value) || 20;
                Promise.resolve(setHistoryRetentionLimit(nextLimit))
                    .then(() => {
                        showToast(getMessage('ui_history_retention_updated'), { variant: 'success' });
                        renderSettingsModal(normalizedModalState);
                    })
                    .catch(() => {
                        showToast(getMessage('ui_history_retention_update_failed'), { variant: 'error' });
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
                readSettingsImportFile(file, (fileText) => {
                    renderSettingsModal({
                        importText: fileText,
                        preview: previewImportConfig(fileText)
                    });
                });
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
                        console.warn('NotebookLM Source Management: Import failed.', error);
                        renderSettingsModal({
                            importText: importTextInner,
                            preview: previewImportConfig(importTextInner)
                        });
                    });
            });
            backdrop.addEventListener('click', closeSettingsModal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeSettingsModal,
                initialFocusTarget: () => modal.querySelector('.sp-settings-backup-section .sp-settings-collapsible-toggle') || modal.querySelector('.sp-modal-cancel')
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

        return {
            closeSettingsModal,
            renderSettingsModal,
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
