(function () {
    'use strict';

    function createContentModals(deps = {}) {
        const getDocument = typeof deps.getDocument === 'function'
            ? deps.getDocument
            : () => (typeof document !== 'undefined' ? document : null);
        const getWindow = typeof deps.getWindow === 'function'
            ? deps.getWindow
            : () => (typeof window !== 'undefined' ? window : null);
        const getShadowRoot = typeof deps.getShadowRoot === 'function'
            ? deps.getShadowRoot
            : () => (deps.shadowRoot || null);
        const getState = typeof deps.getState === 'function'
            ? deps.getState
            : () => (deps.state || {});
        const getGroupsById = typeof deps.getGroupsById === 'function'
            ? deps.getGroupsById
            : () => (deps.groupsById || new Map());
        const getTagsById = typeof deps.getTagsById === 'function'
            ? deps.getTagsById
            : () => (deps.tagsById || new Map());
        const getSourceTagsById = typeof deps.getSourceTagsById === 'function'
            ? deps.getSourceTagsById
            : () => (deps.sourceTagsById || new Map());
        const getSourcesByKey = typeof deps.getSourcesByKey === 'function'
            ? deps.getSourcesByKey
            : () => (deps.sourcesByKey || new Map());
        const getPendingBatchKeys = typeof deps.getPendingBatchKeys === 'function'
            ? deps.getPendingBatchKeys
            : () => (deps.pendingBatchKeys || new Set());
        const getMessage = typeof deps.getMessage === 'function'
            ? deps.getMessage
            : (key) => key;
        const showToast = typeof deps.showToast === 'function'
            ? deps.showToast
            : () => {};
        const showUndoableToast = typeof deps.showUndoableToast === 'function'
            ? deps.showUndoableToast
            : showToast;
        const el = typeof deps.el === 'function'
            ? deps.el
            : (typeof globalThis.el === 'function' ? globalThis.el : null);
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : () => {};
        const render = typeof deps.render === 'function'
            ? deps.render
            : () => {};
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
            : () => {};
        const buildParentMap = typeof deps.buildParentMap === 'function'
            ? deps.buildParentMap
            : () => {};
        const removeSourceFromTree = typeof deps.removeSourceFromTree === 'function'
            ? deps.removeSourceFromTree
            : () => {};
        const createTag = typeof deps.createTag === 'function'
            ? deps.createTag
            : () => null;
        const updateTag = typeof deps.updateTag === 'function'
            ? deps.updateTag
            : () => null;
        const deleteTag = typeof deps.deleteTag === 'function'
            ? deps.deleteTag
            : () => {};
        const getTagUsageCounts = typeof deps.getTagUsageCounts === 'function'
            ? deps.getTagUsageCounts
            : () => new Map();
        const getSourceTagIds = typeof deps.getSourceTagIds === 'function'
            ? deps.getSourceTagIds
            : () => [];
        const setSourceTagIds = typeof deps.setSourceTagIds === 'function'
            ? deps.setSourceTagIds
            : () => {};
        const getExportConfigText = typeof deps.getExportConfigText === 'function'
            ? deps.getExportConfigText
            : () => '{}';
        const previewImportConfig = typeof deps.previewImportConfig === 'function'
            ? deps.previewImportConfig
            : () => ({ ok: false, reason: 'unavailable' });
        const applyImportConfig = typeof deps.applyImportConfig === 'function'
            ? deps.applyImportConfig
            : () => ({ ok: false, reason: 'unavailable' });
        const applyNativeLabelImport = typeof deps.applyNativeLabelImport === 'function'
            ? deps.applyNativeLabelImport
            : () => false;
        const getSourceRepairReport = typeof deps.getSourceRepairReport === 'function'
            ? deps.getSourceRepairReport
            : () => ({ totalSources: 0, matchedSources: 0, unmatchedSources: 0, ambiguousSources: 0, matched: [], unmatched: [], ambiguous: [] });
        const getSourceRepairOptions = typeof deps.getSourceRepairOptions === 'function'
            ? deps.getSourceRepairOptions
            : () => [];
        const applySourceRepairRemaps = typeof deps.applySourceRepairRemaps === 'function'
            ? deps.applySourceRepairRemaps
            : () => Promise.resolve(false);
        const getStateHistoryEntries = typeof deps.getStateHistoryEntries === 'function'
            ? deps.getStateHistoryEntries
            : () => [];
        const restoreStateHistoryEntry = typeof deps.restoreStateHistoryEntry === 'function'
            ? deps.restoreStateHistoryEntry
            : () => Promise.resolve(false);
        const getDiagnosticsInfo = typeof deps.getDiagnosticsInfo === 'function'
            ? deps.getDiagnosticsInfo
            : () => ({});
        const getDiagnosticsText = typeof deps.getDiagnosticsText === 'function'
            ? deps.getDiagnosticsText
            : () => JSON.stringify(getDiagnosticsInfo(), null, 2);
        const renderSaveStatus = typeof deps.renderSaveStatus === 'function'
            ? deps.renderSaveStatus
            : () => null;
        const normalizeTagColor = typeof deps.normalizeTagColor === 'function'
            ? deps.normalizeTagColor
            : (value) => value || null;
        const normalizeTagColorInputValue = typeof deps.normalizeTagColorInputValue === 'function'
            ? deps.normalizeTagColorInputValue
            : (value) => String(value || '');
        const getDefaultTagColor = typeof deps.getDefaultTagColor === 'function'
            ? deps.getDefaultTagColor
            : () => '#007AFF';
        const getTagColorPreviewStyle = typeof deps.getTagColorPreviewStyle === 'function'
            ? deps.getTagColorPreviewStyle
            : () => '';
        const contentConfig = globalThis.NSM_CONTENT_CONFIG || {};

        const TAG_COLOR_PRESETS = Array.isArray(contentConfig.TAG_COLOR_PRESETS)
            ? contentConfig.TAG_COLOR_PRESETS
            : ['#007AFF'];
        const MODAL_ITEM_STAGGER_MAX_INDEX = 10;
        const IMPORT_CONFIG_MAX_FILE_BYTES = Number.isFinite(Number(contentConfig.IMPORT_CONFIG_MAX_FILE_BYTES))
            ? Number(contentConfig.IMPORT_CONFIG_MAX_FILE_BYTES)
            : 2 * 1024 * 1024;

        function getCappedModalMotionIndex(index) {
            const normalizedIndex = Number.isFinite(index) ? Math.max(0, index) : 0;
            return Math.min(normalizedIndex, MODAL_ITEM_STAGGER_MAX_INDEX);
        }

        function createModalItemStaggerStyle(index, baseStyle = '') {
            const motionStyle = `--sp-modal-item-index:${getCappedModalMotionIndex(index)};`;
            return [baseStyle, motionStyle].filter(Boolean).join('');
        }

        function getTagColorRgb(color) {
            const normalizedColor = normalizeTagColor(color);
            if (!normalizedColor) return null;

            return {
                r: parseInt(normalizedColor.slice(1, 3), 16),
                g: parseInt(normalizedColor.slice(3, 5), 16),
                b: parseInt(normalizedColor.slice(5, 7), 16)
            };
        }

        function getTagColorRgba(color, alpha) {
            const rgb = getTagColorRgb(color);
            if (!rgb) return '';
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }

        function getTagColorPresets() {
            return [...TAG_COLOR_PRESETS];
        }

        const MODAL_FOCUSABLE_SELECTOR = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        function getModalFocusableElements(modal) {
            if (!modal || typeof modal.querySelectorAll !== 'function') return [];

            return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR))
                .filter((element) => {
                    if (!element || typeof element.focus !== 'function') return false;
                    if (element.disabled || element.getAttribute?.('aria-hidden') === 'true') return false;
                    if (String(element.getAttribute?.('tabindex') || '') === '-1') return false;
                    return true;
                });
        }

        function getModalActiveElement(modal) {
            const root = typeof modal?.getRootNode === 'function' ? modal.getRootNode() : null;
            return root?.activeElement || getDocument()?.activeElement || null;
        }

        function focusModalInitialElement(modal, preferredTarget = null) {
            const target = typeof preferredTarget === 'function'
                ? preferredTarget()
                : preferredTarget;
            if (target && typeof target.focus === 'function') {
                target.focus();
                return target;
            }

            const focusableElements = getModalFocusableElements(modal);
            const fallbackTarget = focusableElements[0] || modal;
            if (fallbackTarget && typeof fallbackTarget.focus === 'function') {
                fallbackTarget.focus();
                return fallbackTarget;
            }

            return null;
        }

        function handleModalKeyboardEvent(event, modal, closeModal) {
            if (!event || !modal) return false;

            if (event.key === 'Escape') {
                event.preventDefault?.();
                if (typeof closeModal === 'function') {
                    closeModal();
                }
                return true;
            }

            if (event.key !== 'Tab') return false;

            const focusableElements = getModalFocusableElements(modal);
            if (focusableElements.length === 0) {
                event.preventDefault?.();
                if (typeof modal.focus === 'function') modal.focus();
                return true;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = getModalActiveElement(modal);

            if (event.shiftKey && (!activeElement || activeElement === firstElement)) {
                event.preventDefault?.();
                lastElement.focus();
                return true;
            }

            if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault?.();
                firstElement.focus();
                return true;
            }

            return false;
        }

        function bindModalKeyboardNavigation(modal, options = {}) {
            if (!modal || typeof modal.addEventListener !== 'function') {
                return {
                    focusInitial: () => focusModalInitialElement(modal, options.initialFocusTarget),
                    dispose: () => {}
                };
            }

            if (typeof modal.setAttribute === 'function') {
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.setAttribute('tabindex', '-1');
            }

            const closeModal = typeof options.closeModal === 'function' ? options.closeModal : () => {};
            const handleKeydown = (event) => handleModalKeyboardEvent(event, modal, closeModal);
            modal.addEventListener('keydown', handleKeydown);

            return {
                focusInitial: () => focusModalInitialElement(modal, options.initialFocusTarget),
                dispose: () => {
                    if (typeof modal.removeEventListener === 'function') {
                        modal.removeEventListener('keydown', handleKeydown);
                    }
                }
            };
        }

        const modalFocusRestoreTargets = new Map();

        function getCurrentFocusElement() {
            const shadowRoot = getShadowRoot();
            if (shadowRoot?.activeElement) return shadowRoot.activeElement;
            return getDocument()?.activeElement || null;
        }

        function resolveModalFocusRestoreTarget(activeElement) {
            const shadowRoot = getShadowRoot();
            if (!activeElement || !shadowRoot) return activeElement || null;

            const menuItem = activeElement.closest?.('.sp-source-actions-menu-item');
            const sourceKey = menuItem?.dataset?.sourceKey;
            if (!sourceKey || typeof shadowRoot.querySelectorAll !== 'function') return activeElement;

            return Array.from(shadowRoot.querySelectorAll('.sp-source-actions-button'))
                .find((button) => button?.dataset?.sourceKey === sourceKey) || activeElement;
        }

        function rememberModalFocusRestoreTarget(modalId) {
            if (!modalId || modalFocusRestoreTargets.has(modalId)) {
                return modalFocusRestoreTargets.get(modalId) || null;
            }

            const activeElement = getCurrentFocusElement();
            const restoreTarget = resolveModalFocusRestoreTarget(activeElement);
            if (restoreTarget && typeof restoreTarget.focus === 'function') {
                modalFocusRestoreTargets.set(modalId, restoreTarget);
            }
            return restoreTarget || null;
        }

        function restoreModalFocus(modalId) {
            const restoreTarget = modalFocusRestoreTargets.get(modalId);
            modalFocusRestoreTargets.delete(modalId);
            if (
                restoreTarget &&
                restoreTarget.isConnected !== false &&
                typeof restoreTarget.focus === 'function'
            ) {
                restoreTarget.focus();
                return restoreTarget;
            }
            return null;
        }

        function removeModalNode(node) {
            if (!node) return;
            if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
                node.parentNode.removeChild(node);
                return;
            }
            if (typeof node.remove === 'function') {
                node.remove();
            }
        }

        function closeManagedModal(modalId, backdropId, options = {}) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return null;
            const backdrop = shadowRoot.getElementById(backdropId);
            const modal = shadowRoot.getElementById(modalId);
            const {
                immediate = false,
                restoreFocus = true
            } = options;

            const finalizeClose = () => {
                removeModalNode(backdrop);
                removeModalNode(modal);
                return restoreFocus ? restoreModalFocus(modalId) : null;
            };

            if (!immediate && modal && backdrop) {
                modal.classList.remove('visible');
                modal.classList.add('closing');
                backdrop.classList.remove('visible');

                setTimeout(() => {
                    finalizeClose();
                }, 300);
                return null;
            }

            return finalizeClose();
        }

        function prepareModalOpen(modalId, backdropId) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot) return;
            const existingModal = shadowRoot.getElementById(modalId);
            if (!existingModal) {
                rememberModalFocusRestoreTarget(modalId);
            }
            closeManagedModal(modalId, backdropId, {
                immediate: true,
                restoreFocus: false
            });
        }

        function closeMoveToFolderModal(options = {}) {
            return closeManagedModal('sp-move-modal', 'sp-move-backdrop', options);
        }

        function closeTagModal(options = {}) {
            return closeManagedModal('sp-tag-modal', 'sp-tag-backdrop', options);
        }

        function closeBatchTagModal(options = {}) {
            return closeManagedModal('sp-batch-tag-modal', 'sp-batch-tag-backdrop', options);
        }

        function closeSettingsModal(options = {}) {
            return closeManagedModal('sp-settings-modal', 'sp-settings-backdrop', options);
        }

        function closeNativeLabelImportModal(options = {}) {
            return closeManagedModal('sp-native-label-import-modal', 'sp-native-label-import-backdrop', options);
        }

        function getImportPreviewMessage(preview) {
            if (!preview) return '';
            if (!preview.ok) {
                return getMessage(preview.reason === 'empty'
                    ? 'ui_settings_import_empty'
                    : 'ui_settings_import_invalid');
            }
            return getMessage('ui_settings_import_preview_summary', [
                String(preview.matchedSources || 0),
                String(preview.totalSources || 0),
                String(preview.groupCount || 0),
                String(preview.tagCount || 0)
            ]);
        }

        function getPreviewSourceLabel(detail) {
            if (!detail || typeof detail !== 'object') return '';
            return String(detail.title || detail.storedKey || detail.resolvedKey || '').trim();
        }

        function createPreviewSourceList(titleKey, details, emptyKey = '') {
            const normalizedDetails = Array.isArray(details) ? details : [];
            const nodes = [
                el('div', { className: 'sp-settings-preview-detail-title' }, [
                    getMessage(titleKey, [String(normalizedDetails.length)])
                ])
            ];

            if (normalizedDetails.length === 0 && emptyKey) {
                nodes.push(el('div', { className: 'sp-settings-preview-empty' }, [getMessage(emptyKey)]));
                return nodes;
            }

            const visibleDetails = normalizedDetails.slice(0, 5);
            if (visibleDetails.length > 0) {
                nodes.push(el('ul', { className: 'sp-settings-preview-list' }, visibleDetails.map((detail) => {
                    const label = getPreviewSourceLabel(detail) || getMessage('ui_source_untitled');
                    return el('li', { className: 'sp-settings-preview-item' }, [label]);
                })));
            }

            const remainingCount = normalizedDetails.length - visibleDetails.length;
            if (remainingCount > 0) {
                nodes.push(el('div', { className: 'sp-settings-preview-more' }, [
                    getMessage('ui_settings_import_preview_more', [String(remainingCount)])
                ]));
            }

            return nodes;
        }

        function createImportPreviewDetailNodes(preview) {
            if (!preview?.ok) return [];
            return [
                el('div', { className: 'sp-settings-preview-details' }, [
                    ...createPreviewSourceList(
                        'ui_settings_import_preview_matched',
                        preview.matchedSourceDetails || []
                    ),
                    ...createPreviewSourceList(
                        'ui_settings_import_preview_unmatched',
                        preview.unmatchedSourceDetails || [],
                        'ui_settings_import_preview_no_unmatched'
                    )
                ])
            ];
        }

        function copySettingsTextToClipboard(text, textarea, successKey = 'ui_settings_export_copied', failureKey = 'ui_settings_export_copy_failed') {
            const navigatorObj = getWindow()?.navigator || globalThis.navigator;
            if (navigatorObj?.clipboard?.writeText) {
                Promise.resolve(navigatorObj.clipboard.writeText(text))
                    .then(() => showToast(getMessage(successKey), { variant: 'success' }))
                    .catch(() => showToast(getMessage(failureKey), { variant: 'error' }));
                return true;
            }

            if (textarea && typeof textarea.select === 'function') {
                textarea.select();
            }
            showToast(getMessage(failureKey), { variant: 'error' });
            return false;
        }

        function getSettingsExportFileName() {
            const date = new Date();
            const dateText = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'export';
            return `notebooklm-source-management-config-${dateText}.json`;
        }

        function downloadSettingsExportText(text) {
            const documentObj = getDocument();
            const windowObj = getWindow() || globalThis;
            const BlobCtor = windowObj.Blob || globalThis.Blob;
            const URLObj = windowObj.URL || globalThis.URL;
            if (!documentObj || typeof BlobCtor !== 'function' || !URLObj?.createObjectURL) {
                showToast(getMessage('ui_settings_export_download_failed'), { variant: 'error' });
                return false;
            }

            const blob = new BlobCtor([String(text || '')], { type: 'application/json' });
            const url = URLObj.createObjectURL(blob);
            const anchor = documentObj.createElement('a');
            anchor.href = url;
            anchor.download = getSettingsExportFileName();
            anchor.style.display = 'none';
            documentObj.body?.appendChild?.(anchor);
            anchor.click?.();
            anchor.remove?.();
            windowObj.setTimeout?.(() => URLObj.revokeObjectURL?.(url), 0);
            showToast(getMessage('ui_settings_export_downloaded'), { variant: 'success' });
            return true;
        }

        function readSettingsImportFile(file, onText) {
            const windowObj = getWindow() || globalThis;
            const FileReaderCtor = windowObj.FileReader || globalThis.FileReader;
            if (!file || typeof FileReaderCtor !== 'function') {
                showToast(getMessage('ui_settings_import_file_invalid'), { variant: 'error' });
                return false;
            }
            if (Number.isFinite(Number(file.size)) && Number(file.size) > IMPORT_CONFIG_MAX_FILE_BYTES) {
                showToast(getMessage('ui_settings_import_file_invalid'), { variant: 'error' });
                return false;
            }

            const reader = new FileReaderCtor();
            reader.onload = () => {
                if (typeof onText === 'function') {
                    onText(String(reader.result || ''));
                }
            };
            reader.onerror = () => {
                showToast(getMessage('ui_settings_import_file_invalid'), { variant: 'error' });
            };
            reader.readAsText(file);
            return true;
        }

        function getDiagnosticsDisplayRows() {
            const diagnostics = getDiagnosticsInfo() || {};
            const failureCount = Array.isArray(diagnostics.nativeActionFailureHistory)
                ? diagnostics.nativeActionFailureHistory.length
                : (diagnostics.lastNativeActionFailure ? 1 : 0);
            const latestNativeFailureReason = diagnostics.lastNativeActionFailure?.reason || '-';
            const nativeFailureSummary = failureCount > 1
                ? `${latestNativeFailureReason} (+${failureCount - 1})`
                : latestNativeFailureReason;
            const formatBytes = (bytes) => {
                const value = Number(bytes) || 0;
                if (value <= 0) return '0 B';
                const units = ['B', 'KB', 'MB'];
                let unitIndex = 0;
                let nextValue = value;
                while (nextValue >= 1024 && unitIndex < units.length - 1) {
                    nextValue /= 1024;
                    unitIndex += 1;
                }
                return `${nextValue >= 10 || unitIndex === 0 ? Math.round(nextValue) : nextValue.toFixed(1)} ${units[unitIndex]}`;
            };
            const storageUsage = Number(diagnostics.storageQuotaBytes) > 0
                ? `${formatBytes(diagnostics.storageUsageBytes)} / ${formatBytes(diagnostics.storageQuotaBytes)} (${Math.round((Number(diagnostics.storageUsageRatio) || 0) * 100)}%)`
                : '-';
            return [
                ['ui_diagnostics_notebook_id', diagnostics.notebookId || '-'],
                ['ui_diagnostics_sources', String(diagnostics.sourceCount ?? 0)],
                ['ui_diagnostics_groups', String(diagnostics.groupCount ?? 0)],
                ['ui_diagnostics_tags', String(diagnostics.tagCount ?? 0)],
                ['ui_diagnostics_source_view', diagnostics.sourceViewKind || '-'],
                ['ui_diagnostics_source_view_confidence', String(diagnostics.sourceViewConfidence ?? 0)],
                ['ui_diagnostics_source_view_changed_at', diagnostics.lastSourceViewChangedAt || '-'],
                ['ui_diagnostics_save_revision', String(diagnostics.saveRevision ?? 0)],
                ['ui_diagnostics_saved_at', diagnostics.savedAt || '-'],
                ['ui_diagnostics_save_status', diagnostics.saveStatus || 'idle'],
                ['ui_diagnostics_last_save_error', diagnostics.lastSaveError || '-'],
                ['ui_diagnostics_stale_local_revision', String(diagnostics.lastStaleLocalRevision ?? 0)],
                ['ui_diagnostics_stale_remote_revision', String(diagnostics.lastStaleRemoteRevision ?? 0)],
                ['ui_diagnostics_stale_detected_at', diagnostics.lastStaleDetectedAt || '-'],
                ['ui_diagnostics_storage_usage', storageUsage],
                ['ui_diagnostics_storage_warning', diagnostics.storageWarning ? getMessage('ui_yes') : getMessage('ui_no')],
                ['ui_diagnostics_last_storage_error', diagnostics.lastStorageError || '-'],
                ['ui_diagnostics_history_entries', String(diagnostics.historyEntryCount ?? 0)],
                ['ui_diagnostics_recovery', diagnostics.recoveryAvailable ? getMessage('ui_yes') : getMessage('ui_no')],
                ['ui_diagnostics_import_backup', diagnostics.importBackupAvailable ? getMessage('ui_yes') : getMessage('ui_no')],
                ['ui_diagnostics_native_failure_history', nativeFailureSummary]
            ];
        }

        function createDiagnosticsGrid() {
            const nodes = [];
            getDiagnosticsDisplayRows().forEach(([labelKey, value]) => {
                nodes.push(el('div', { className: 'sp-settings-diagnostics-key' }, [getMessage(labelKey)]));
                nodes.push(el('div', { className: 'sp-settings-diagnostics-value', title: String(value) }, [String(value)]));
            });
            return el('div', { className: 'sp-settings-diagnostics-grid' }, nodes);
        }

        function createSourceRepairNodes(report = getSourceRepairReport()) {
            const normalizedReport = report || {};
            const repairItems = [
                ...(Array.isArray(normalizedReport.unmatched) ? normalizedReport.unmatched : []),
                ...(Array.isArray(normalizedReport.ambiguous) ? normalizedReport.ambiguous : [])
            ];
            const sourceOptions = Array.isArray(getSourceRepairOptions()) ? getSourceRepairOptions() : [];
            const nodes = [
                el('p', { className: 'sp-settings-helper-text sp-source-repair-summary' }, [
                    getMessage('ui_source_repair_summary', [
                        String(normalizedReport.matchedSources || 0),
                        String(normalizedReport.totalSources || 0),
                        String(normalizedReport.unmatchedSources || 0),
                        String(normalizedReport.ambiguousSources || 0)
                    ])
                ])
            ];

            if (repairItems.length === 0) {
                nodes.push(el('div', { className: 'sp-settings-empty-state sp-source-repair-empty' }, [
                    getMessage('ui_source_repair_healthy')
                ]));
                return nodes;
            }

            nodes.push(el('div', { className: 'sp-source-repair-list' }, repairItems.map((item) => (
                el('div', { className: 'sp-source-repair-item' }, [
                    el('div', { className: 'sp-source-repair-copy' }, [
                        el('div', { className: 'sp-source-repair-title' }, [
                            item.title || item.storedKey || getMessage('ui_source_untitled')
                        ]),
                        el('div', { className: 'sp-source-repair-meta' }, [
                            getMessage('ui_source_repair_reason', [item.reason || 'unresolved'])
                        ])
                    ]),
                    el('select', {
                        className: 'sp-source-repair-select',
                        dataset: { storedKey: item.storedKey || '' },
                        'aria-label': getMessage('ui_source_repair_select_source', [item.title || item.storedKey || ''])
                    }, [
                        el('option', { value: '' }, [getMessage('ui_source_repair_skip')]),
                        ...sourceOptions.map((source) => el('option', { value: source.key }, [
                            source.title || source.key
                        ]))
                    ])
                ])
            ))));

            nodes.push(el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                el('button', {
                    type: 'button',
                    className: 'sp-button sp-source-repair-apply-btn sp-glare-hover',
                    disabled: true
                }, [getMessage('ui_source_repair_apply')])
            ]));
            return nodes;
        }

        function formatHistoryEntryLabel(entry) {
            const createdAt = entry?.createdAt ? String(entry.createdAt).replace('T', ' ').slice(0, 19) : '-';
            return getMessage('ui_history_entry_summary', [
                createdAt,
                String(entry?.sourceCount ?? 0),
                String(entry?.groupCount ?? 0),
                String(entry?.tagCount ?? 0),
                entry?.reason || '-'
            ]);
        }

        function createHistoryNodes(entries = getStateHistoryEntries()) {
            const historyEntries = Array.isArray(entries) ? entries : [];
            if (historyEntries.length === 0) {
                return [
                    el('div', { className: 'sp-settings-empty-state sp-history-empty' }, [
                        getMessage('ui_history_empty')
                    ])
                ];
            }

            return [
                el('div', { className: 'sp-history-list' }, historyEntries.map((entry) => (
                    el('div', { className: 'sp-history-item' }, [
                        el('div', { className: 'sp-history-copy' }, [
                            el('div', { className: 'sp-history-title' }, [
                                formatHistoryEntryLabel(entry)
                            ]),
                            el('div', { className: 'sp-history-meta' }, [
                                getMessage('ui_diagnostics_save_revision'),
                                ': ',
                                String(entry.saveRevision || 0)
                            ])
                        ]),
                        el('button', {
                            type: 'button',
                            className: 'sp-button sp-history-restore-btn sp-glare-hover',
                            dataset: { historyId: entry.id }
                        }, [getMessage('ui_history_restore')])
                    ])
                )))
            ];
        }

        function copyDiagnosticsTextToClipboard() {
            return copySettingsTextToClipboard(
                getDiagnosticsText(),
                null,
                'ui_settings_diagnostics_copied',
                'ui_settings_diagnostics_copy_failed'
            );
        }

        function openWebStoreFeedback() {
            const runtime = globalThis.chrome?.runtime || null;
            if (!runtime || typeof runtime.sendMessage !== 'function') {
                showToast(getMessage('ui_settings_feedback_open_failed'), { variant: 'error' });
                return Promise.resolve(false);
            }

            return new Promise((resolve) => {
                try {
                    runtime.sendMessage({ type: 'OPEN_WEB_STORE_FEEDBACK' }, (response) => {
                        if (runtime.lastError || !response || response.success === false) {
                            showToast(getMessage('ui_settings_feedback_open_failed'), { variant: 'error' });
                            resolve(false);
                            return;
                        }

                        resolve(true);
                    });
                } catch (error) {
                    showToast(getMessage('ui_settings_feedback_open_failed'), { variant: 'error' });
                    resolve(false);
                }
            });
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
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-settings-modal-title' }, [getMessage('ui_settings')])
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

            content.appendChild(el('section', { className: 'sp-settings-section sp-settings-feedback-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_feedback_title')]),
                    el('div', { className: 'sp-settings-action-row' }, [
                        el('button', { type: 'button', className: 'sp-button sp-settings-open-web-store-feedback-btn sp-glare-hover' }, [
                            getMessage('ui_settings_open_web_store_feedback')
                        ])
                    ])
                ]),
                el('p', { className: 'sp-settings-feedback-body' }, [
                    getMessage('ui_settings_feedback_body')
                ])
            ]));

            const exportSection = createCollapsibleSettingsSection({
                className: 'sp-settings-export-section',
                titleKey: 'ui_settings_export_title',
                contentId: 'sp-settings-export-content',
                children: [
                    el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                        el('button', { type: 'button', className: 'sp-button sp-settings-copy-export-btn sp-glare-hover' }, [
                            getMessage('ui_settings_copy_json')
                        ]),
                        el('button', { type: 'button', className: 'sp-button sp-settings-download-export-btn sp-glare-hover' }, [
                            getMessage('ui_settings_download_json')
                        ])
                    ]),
                    exportTextarea
                ]
            });
            content.appendChild(exportSection.section);

            const importSection = createCollapsibleSettingsSection({
                className: 'sp-settings-import-section',
                titleKey: 'ui_settings_import_title',
                contentId: 'sp-settings-import-content',
                initiallyExpanded: Boolean(importText.trim() || preview),
                children: [
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
                ]
            });
            content.appendChild(importSection.section);

            const sourceRepairReport = getSourceRepairReport();
            const repairSection = createCollapsibleSettingsSection({
                className: 'sp-settings-source-repair-section',
                titleKey: 'ui_source_repair_title',
                contentId: 'sp-settings-source-repair-content',
                initiallyExpanded: Boolean((sourceRepairReport?.unmatchedSources || 0) + (sourceRepairReport?.ambiguousSources || 0)),
                children: createSourceRepairNodes(sourceRepairReport)
            });
            content.appendChild(repairSection.section);

            const historySection = createCollapsibleSettingsSection({
                className: 'sp-settings-history-section',
                titleKey: 'ui_history_title',
                contentId: 'sp-settings-history-content',
                children: createHistoryNodes(getStateHistoryEntries())
            });
            content.appendChild(historySection.section);

            const diagnosticsCopyButton = el('button', {
                type: 'button',
                className: 'sp-button sp-settings-copy-diagnostics-btn sp-glare-hover'
            }, [
                getMessage('ui_settings_copy_diagnostics')
            ]);
            const diagnosticsSection = createCollapsibleSettingsSection({
                className: 'sp-settings-diagnostics-section',
                titleKey: 'ui_settings_diagnostics_title',
                contentId: 'sp-settings-diagnostics-content',
                children: [
                    el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                        diagnosticsCopyButton
                    ]),
                    createDiagnosticsGrid()
                ]
            });

            content.appendChild(diagnosticsSection.section);

            content.appendChild(el('section', {
                id: 'sp-settings-save-status-section',
                className: 'sp-settings-section sp-settings-save-status-section',
                hidden: true
            }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_save_status_title')])
                ]),
                el('div', {
                    id: 'sp-settings-save-status',
                    className: 'sp-save-status sp-save-status-idle',
                    role: 'status',
                    'aria-live': 'polite',
                    hidden: true
                })
            ]));

            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')]),
                el('button', {
                    type: 'button',
                    className: 'sp-button sp-settings-apply-import-btn sp-glare-hover',
                    disabled: !(preview && preview.ok)
                }, [getMessage('ui_settings_apply_import')])
            ]);

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
                const importText = importTextarea.value;
                applyImportButton.disabled = true;
                applyImportButton.setAttribute('aria-busy', 'true');
                Promise.resolve(applyImportConfig(importText))
                    .then((result) => {
                        if (result && result.ok) {
                            closeSettingsModal();
                            return;
                        }
                        renderSettingsModal({
                            importText,
                            preview: result || previewImportConfig(importText)
                        });
                    })
                    .catch((error) => {
                        console.warn('NotebookLM Source Management: Import failed.', error);
                        renderSettingsModal({
                            importText,
                            preview: previewImportConfig(importText)
                        });
                    });
            });
            backdrop.addEventListener('click', closeSettingsModal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeSettingsModal,
                initialFocusTarget: () => modal.querySelector('.sp-settings-copy-export-btn') || modal.querySelector('.sp-modal-cancel')
            });
            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            });

            return true;
        }

        function normalizeSourceKeyList(sourceKeys) {
            const rawKeys = Array.isArray(sourceKeys)
                ? sourceKeys
                : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys || []));
            const seen = new Set();
            return rawKeys.reduce((acc, key) => {
                if (typeof key !== 'string' || !key || seen.has(key)) return acc;
                seen.add(key);
                acc.push(key);
                return acc;
            }, []);
        }

        function getNativeLabelImportActionKey(label) {
            return label?.action === 'reuse'
                ? 'ui_import_native_labels_preview_reuse'
                : 'ui_import_native_labels_preview_create';
        }

        function createNativeLabelImportPreviewNodes(preview = {}) {
            if (!preview.ok) {
                return [
                    el('div', { className: 'sp-native-label-import-empty' }, [
                        getMessage('ui_import_native_labels_preview_empty')
                    ])
                ];
            }

            const labels = Array.isArray(preview.labels) ? preview.labels : [];
            const nodes = [
                el('p', { className: 'sp-native-label-import-summary' }, [
                    getMessage('ui_import_native_labels_preview_summary', [
                        String(preview.labelCount || labels.length || 0),
                        String(preview.sourceCount || 0)
                    ])
                ])
            ];

            labels.forEach((label, index) => {
                const sourceTitles = Array.isArray(label.sourceTitles) ? label.sourceTitles : [];
                const visibleSourceTitles = sourceTitles.slice(0, 4);
                const remainingCount = Math.max(0, sourceTitles.length - visibleSourceTitles.length);
                nodes.push(el('div', {
                    className: 'sp-native-label-import-item',
                    style: createModalItemStaggerStyle(index)
                }, [
                    el('div', { className: 'sp-native-label-import-item-header' }, [
                        el('span', { className: 'google-symbols' }, [
                            label.action === 'reuse' ? 'folder_open' : 'create_new_folder'
                        ]),
                        el('span', { className: 'sp-native-label-import-title' }, [
                            label.title || getMessage('ui_group_untitled')
                        ]),
                        el('span', { className: 'sp-native-label-import-count' }, [
                            getMessage('ui_import_native_labels_preview_source_count', [
                                String(label.sourceCount || sourceTitles.length || 0)
                            ])
                        ])
                    ]),
                    el('div', { className: 'sp-native-label-import-action' }, [
                        getMessage(getNativeLabelImportActionKey(label))
                    ]),
                    visibleSourceTitles.length > 0
                        ? el('ul', { className: 'sp-native-label-import-source-list' }, [
                            ...visibleSourceTitles.map((title) => el('li', {}, [
                                title || getMessage('ui_source_untitled')
                            ])),
                            ...(remainingCount > 0
                                ? [el('li', { className: 'sp-native-label-import-more' }, [
                                    getMessage('ui_import_native_labels_preview_more', [String(remainingCount)])
                                ])]
                                : [])
                        ])
                        : el('div', { className: 'sp-native-label-import-source-list sp-native-label-import-source-list-empty' }, [
                            getMessage('ui_import_native_labels_preview_no_sources')
                        ])
                ]));
            });

            return nodes;
        }

        function renderNativeLabelImportModal(preview = {}) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return false;

            const normalizedPreview = preview && typeof preview === 'object'
                ? preview
                : { ok: false, reason: 'unavailable', labelCount: 0, sourceCount: 0, labels: [] };

            prepareModalOpen('sp-native-label-import-modal', 'sp-native-label-import-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-native-label-import-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-native-label-import-modal',
                id: 'sp-native-label-import-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-native-label-import-modal-title',
                tabindex: '-1'
            });
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', {
                    className: 'sp-folder-modal-title',
                    id: 'sp-native-label-import-modal-title'
                }, [getMessage('ui_import_native_labels_preview_title')])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-native-label-import-content' }, [
                ...createNativeLabelImportPreviewNodes(normalizedPreview)
            ]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')]),
                el('button', {
                    type: 'button',
                    className: 'sp-button sp-native-label-import-confirm-btn sp-glare-hover',
                    disabled: !normalizedPreview.ok
                }, [getMessage('ui_import_native_labels_apply')])
            ]);

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            footer.querySelector('.sp-modal-cancel')?.addEventListener('click', closeNativeLabelImportModal);
            footer.querySelector('.sp-native-label-import-confirm-btn')?.addEventListener('click', () => {
                if (!normalizedPreview.ok) return;
                const applied = applyNativeLabelImport(normalizedPreview);
                if (applied) {
                    closeNativeLabelImportModal({ immediate: true });
                }
            });
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) closeNativeLabelImportModal();
            });

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeNativeLabelImportModal,
                initialFocusTarget: () => {
                    const confirmButton = modal.querySelector('.sp-native-label-import-confirm-btn');
                    return confirmButton && !confirmButton.disabled
                        ? confirmButton
                        : modal.querySelector('.sp-modal-cancel');
                }
            });
            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            });

            return true;
        }

        function collectMoveFolderOptions(groupIds, level = 0, visitedGroupIds = new Set()) {
            const groupsById = getGroupsById();
            const options = [];

            (Array.isArray(groupIds) ? groupIds : []).forEach((groupId) => {
                if (!groupId || visitedGroupIds.has(groupId)) return;

                const group = groupsById.get(groupId);
                if (!group) return;

                visitedGroupIds.add(groupId);
                options.push({ group, level });

                const childGroupIds = (Array.isArray(group.children) ? group.children : [])
                    .filter((child) => child && child.type === 'group')
                    .map((child) => child.id);
                options.push(...collectMoveFolderOptions(childGroupIds, level + 1, visitedGroupIds));
            });

            return options;
        }

        function renderMoveToFolderModal(sourceKeys) {
            const shadowRoot = getShadowRoot();
            if (!shadowRoot || !el) return;

            const keys = Array.isArray(sourceKeys) ? sourceKeys : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys));
            if (keys.length === 0) return;

            prepareModalOpen('sp-move-modal', 'sp-move-backdrop');

            const state = getState() || {};
            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-move-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal',
                id: 'sp-move-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-move-modal-title',
                tabindex: '-1'
            });

            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-move-modal-title' }, [getMessage('ui_move_to_folder')])
            ]);

            const content = el('div', { className: 'sp-folder-modal-content' });

            let folderFound = false;
            let modalItemIndex = 0;
            const groupIds = Array.isArray(state.groups) ? state.groups : [];
            collectMoveFolderOptions(groupIds).forEach(({ group, level }) => {
                if (group) {
                    folderFound = true;
                    const indentStyle = level > 0 ? `padding-left:${12 + (level * 18)}px;` : '';
                    const folderBtn = el('button', {
                        type: 'button',
                        className: 'sp-folder-option',
                        dataset: {
                            groupId: group.id,
                            level: String(level)
                        },
                        style: createModalItemStaggerStyle(modalItemIndex, indentStyle)
                    }, [
                        el('span', { className: 'google-symbols' }, ['folder']),
                        el('span', { className: 'sp-folder-option-title' }, [group.title || getMessage('ui_group_untitled')])
                    ]);
                    modalItemIndex += 1;

                    folderBtn.addEventListener('click', () => {
                        executeMoveToFolder(keys, group.id);
                    });
                    content.appendChild(folderBtn);
                }
            });

            if (!folderFound) {
                const emptyText = getMessage('ui_empty_folders');
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [emptyText]));
            }

            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ]);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeMoveToFolderModal);
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) closeMoveToFolderModal();
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);

            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeMoveToFolderModal,
                initialFocusTarget: () => modal.querySelector('.sp-folder-option') || modal.querySelector('.sp-modal-cancel')
            });

            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            });
        }

        function executeMoveToFolder(sourceKeys, targetGroupId) {
            const state = getState() || {};
            const groupsById = getGroupsById();
            const pendingBatchKeys = getPendingBatchKeys();
            const sourcesByKey = getSourcesByKey();
            const targetGroup = groupsById.get(targetGroupId);
            if (!targetGroup) {
                closeMoveToFolderModal();
                return;
            }

            const keys = Array.isArray(sourceKeys) ? sourceKeys : (typeof sourceKeys === 'string' ? [sourceKeys] : Array.from(sourceKeys));

            keys.forEach((sourceKey) => {
                const sourceData = sourcesByKey.get(sourceKey);
                if (sourceData) {
                    removeSourceFromTree(sourceKey);
                    targetGroup.children.push({
                        type: 'source',
                        key: sourceKey
                    });
                }
            });

            if (state.isBatchMode && pendingBatchKeys.size > 0) {
                state.isBatchMode = false;
                pendingBatchKeys.clear();
            }

            closeSourceActionMenu();
            buildParentMap();
            saveState({ immediate: true, critical: true });
            render();
            closeMoveToFolderModal();
        }

        function createTagColorControl(initialColor, options = {}) {
            const {
                allowUnset = false,
                inputIdPrefix = 'sp-tag-color'
            } = options;

            let currentColor = normalizeTagColor(initialColor);
            let fallbackColor = currentColor || getDefaultTagColor();
            if (!currentColor && !allowUnset) {
                currentColor = fallbackColor;
            }

            const presetButtons = [];
            const presetChildren = [];

            if (allowUnset) {
                const neutralButton = el('button', {
                    type: 'button',
                    className: 'sp-tag-color-swatch sp-tag-color-swatch-none',
                    title: getMessage('ui_tag_color_none')
                }, [el('span', { className: 'google-symbols' }, ['block'])]);
                neutralButton.addEventListener('click', () => {
                    currentColor = null;
                    syncColorUi();
                });
                presetButtons.push({ button: neutralButton, color: null });
                presetChildren.push(neutralButton);
            }

            TAG_COLOR_PRESETS.forEach((presetColor) => {
                const presetButton = el('button', {
                    type: 'button',
                    className: 'sp-tag-color-swatch',
                    title: presetColor,
                    style: getTagColorPreviewStyle(presetColor)
                });
                presetButton.addEventListener('click', () => {
                    currentColor = presetColor;
                    fallbackColor = presetColor;
                    syncColorUi();
                });
                presetButtons.push({ button: presetButton, color: presetColor });
                presetChildren.push(presetButton);
            });

            const presetContainer = el('div', {
                className: 'sp-tag-color-presets',
                role: 'list'
            }, presetChildren);
            const colorInput = el('input', {
                id: `${inputIdPrefix}-native`,
                className: 'sp-tag-color-native-input',
                type: 'color',
                value: currentColor || fallbackColor,
                'aria-label': getMessage('ui_tag_color_custom')
            });
            const colorTriggerSwatch = el('span', {
                className: 'sp-tag-color-trigger-swatch',
                style: getTagColorPreviewStyle(currentColor || fallbackColor)
            });
            const colorTrigger = el('button', {
                type: 'button',
                className: 'sp-button sp-tag-color-trigger',
                title: getMessage('ui_tag_color_custom')
            }, [
                colorTriggerSwatch,
                el('span', {}, [getMessage('ui_tag_color_custom')])
            ]);
            const hexInput = el('input', {
                id: `${inputIdPrefix}-hex`,
                className: 'sp-tag-input sp-tag-color-hex',
                type: 'text',
                value: currentColor || '',
                placeholder: getMessage('ui_tag_color_hex'),
                'aria-label': getMessage('ui_tag_color_hex'),
                maxlength: '7',
                autocapitalize: 'characters',
                spellcheck: 'false'
            });

            colorTrigger.addEventListener('click', () => {
                if (typeof colorInput.click === 'function') {
                    colorInput.click();
                }
            });

            colorInput.addEventListener('input', () => {
                const nextColor = normalizeTagColor(colorInput.value);
                if (!nextColor) return;
                currentColor = nextColor;
                fallbackColor = nextColor;
                syncColorUi();
            });

            hexInput.addEventListener('input', () => {
                const nextValue = normalizeTagColorInputValue(hexInput.value);
                if (hexInput.value !== nextValue) {
                    hexInput.value = nextValue;
                }

                const nextColor = normalizeTagColor(nextValue);
                if (nextColor) {
                    currentColor = nextColor;
                    fallbackColor = nextColor;
                    syncColorUi();
                    return;
                }

                if (!nextValue && allowUnset) {
                    currentColor = null;
                    syncColorUi();
                }
            });

            hexInput.addEventListener('blur', () => {
                syncColorUi();
            });

            const root = el('div', { className: 'sp-tag-color-group' }, [
                el('div', { className: 'sp-tag-color-heading' }, [getMessage('ui_tag_color')]),
                presetContainer,
                el('div', { className: 'sp-tag-color-input-row' }, [
                    colorTrigger,
                    colorInput,
                    hexInput
                ])
            ]);

            function syncColorUi() {
                presetButtons.forEach(({ button, color }) => {
                    const isActive = color === currentColor || (!color && !currentColor);
                    button.classList.toggle('is-active', isActive);
                    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                });

                const displayColor = currentColor || fallbackColor || getDefaultTagColor();
                colorInput.value = displayColor;
                colorTriggerSwatch.setAttribute('style', getTagColorPreviewStyle(displayColor));
                hexInput.value = currentColor || '';
            }

            syncColorUi();

            return {
                root,
                hexInput,
                colorInput,
                getValue: () => currentColor
            };
        }

        function createTagEditor(options = {}) {
            const {
                className = '',
                initialLabel = '',
                initialColor = null,
                submitLabel,
                submitButtonId = '',
                submitButtonClassName = 'sp-button',
                inputId = '',
                allowUnsetColor = false,
                onSubmit,
                onCancel = null
            } = options;

            const labelInput = el('input', {
                id: inputId || null,
                className: 'sp-tag-input',
                placeholder: getMessage('ui_create_tag_placeholder'),
                value: initialLabel
            });
            const colorControl = createTagColorControl(initialColor, {
                allowUnset: allowUnsetColor,
                inputIdPrefix: inputId || 'sp-tag-color'
            });
            const actionChildren = [];

            if (typeof onCancel === 'function') {
                const cancelButton = el('button', {
                    type: 'button',
                    className: 'sp-modal-cancel'
                }, [getMessage('ui_cancel')]);
                cancelButton.addEventListener('click', onCancel);
                actionChildren.push(cancelButton);
            }

            const submitButton = el('button', {
                type: 'button',
                id: submitButtonId || null,
                className: submitButtonClassName
            }, [submitLabel]);
            actionChildren.push(submitButton);

            const root = el('div', {
                className: ['sp-tag-editor', className].filter(Boolean).join(' ')
            }, [
                labelInput,
                colorControl.root,
                el('div', { className: 'sp-tag-editor-actions' }, actionChildren)
            ]);

            const handleSubmit = () => {
                if (typeof onSubmit === 'function') {
                    onSubmit({
                        label: labelInput.value,
                        color: colorControl.getValue()
                    });
                }
            };
            const handleEditorKeydown = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSubmit();
                    return;
                }

                if (event.key === 'Escape' && typeof onCancel === 'function') {
                    event.preventDefault();
                    onCancel();
                }
            };

            submitButton.addEventListener('click', handleSubmit);
            labelInput.addEventListener('keydown', handleEditorKeydown);
            colorControl.hexInput.addEventListener('keydown', handleEditorKeydown);

            return {
                root,
                labelInput,
                colorControl
            };
        }

        function executeBatchTagUpdate(mode, sourceKeys, tagIds) {
            const normalizedMode = mode === 'remove' ? 'remove' : 'add';
            const state = getState() || {};
            const pendingBatchKeys = getPendingBatchKeys();
            const sourcesByKey = getSourcesByKey();
            const tagsById = getTagsById();
            const selectedTagIds = Array.from(tagIds || []).filter((tagId) => tagsById.has(tagId));
            const keys = normalizeSourceKeyList(sourceKeys).filter((sourceKey) => {
                const source = sourcesByKey.get(sourceKey);
                return source && !source.isDisabled && !source.isLoading;
            });

            if (keys.length === 0 || selectedTagIds.length === 0) {
                closeBatchTagModal();
                return false;
            }

            const selectedTagIdSet = new Set(selectedTagIds);
            keys.forEach((sourceKey) => {
                const currentTagIds = getSourceTagIds(sourceKey);
                const nextTagIds = normalizedMode === 'remove'
                    ? currentTagIds.filter((tagId) => !selectedTagIdSet.has(tagId))
                    : Array.from(new Set([...currentTagIds, ...selectedTagIds]));
                setSourceTagIds(sourceKey, nextTagIds);
            });

            state.isBatchMode = false;
            pendingBatchKeys.clear();
            closeSourceActionMenu();
            saveState({ immediate: true, critical: true });
            render();
            closeBatchTagModal();
            showUndoableToast(getMessage(
                normalizedMode === 'remove' ? 'ui_batch_tags_removed_toast' : 'ui_batch_tags_added_toast',
                [String(keys.length)]
            ), { variant: 'success' });
            return true;
        }

        function renderBatchTagModal(mode, sourceKeys, modalState = null) {
            const shadowRoot = getShadowRoot();
            const state = getState() || {};
            const tagsById = getTagsById();
            if (!shadowRoot || !el) return;

            const normalizedMode = mode === 'remove' ? 'remove' : 'add';
            const keys = normalizeSourceKeyList(sourceKeys);
            if (keys.length === 0) return;

            const normalizedModalState = modalState && typeof modalState === 'object' ? modalState : {};
            const selectedTagIds = new Set(normalizedModalState.draftTagIds || []);

            prepareModalOpen('sp-batch-tag-modal', 'sp-batch-tag-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-batch-tag-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-tag-modal sp-batch-tag-modal',
                id: 'sp-batch-tag-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-batch-tag-modal-title',
                tabindex: '-1'
            });
            const titleKey = normalizedMode === 'remove' ? 'ui_batch_remove_tags_title' : 'ui_batch_add_tags_title';
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-batch-tag-modal-title' }, [getMessage(titleKey)])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-modal-content' });

            if (normalizedMode === 'add') {
                const createEditor = createTagEditor({
                    className: 'sp-tag-create-row',
                    submitLabel: getMessage('ui_create_tag'),
                    submitButtonId: 'sp-create-batch-tag-btn',
                    inputId: 'sp-batch-tag-name-input',
                    initialColor: getDefaultTagColor(),
                    onSubmit: ({ label, color }) => {
                        const newTagId = createTag(label, { color });
                        if (!newTagId) return;

                        selectedTagIds.add(newTagId);
                        saveState({ immediate: true, critical: true });
                        render();
                        renderBatchTagModal(normalizedMode, keys, { draftTagIds: Array.from(selectedTagIds) });
                    }
                });
                content.appendChild(createEditor.root);
            }

            const tagOrder = Array.isArray(state.tagOrder) ? state.tagOrder : [];
            if (tagOrder.length === 0) {
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [
                    normalizedMode === 'remove' ? getMessage('ui_no_tags_to_remove') : getMessage('ui_no_tags')
                ]));
            } else {
                let modalItemIndex = 0;
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    content.appendChild(el('label', {
                        className: 'sp-tag-option sp-batch-tag-option',
                        style: createModalItemStaggerStyle(modalItemIndex)
                    }, [
                        el('input', {
                            type: 'checkbox',
                            className: 'sp-tag-option-checkbox sp-batch-tag-option-checkbox',
                            dataset: { tagId },
                            checked: selectedTagIds.has(tagId)
                        }),
                        el('span', {
                            className: 'sp-tag-row-color' + (tag.color ? '' : ' is-neutral'),
                            style: getTagColorPreviewStyle(tag.color)
                        }),
                        el('span', { className: 'sp-tag-option-label' }, [tag.label])
                    ]));
                    modalItemIndex += 1;
                });
            }

            const applyButton = el('button', {
                type: 'button',
                className: 'sp-button',
                id: 'sp-apply-batch-tags-btn',
                disabled: selectedTagIds.size === 0
            }, [getMessage('ui_apply_tags')]);
            const footer = el('div', { className: 'sp-folder-modal-footer' }, [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')]),
                applyButton
            ]);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeBatchTagModal);
            applyButton.addEventListener('click', () => {
                executeBatchTagUpdate(normalizedMode, keys, selectedTagIds);
            });
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    closeBatchTagModal();
                }
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            modal.querySelectorAll('.sp-batch-tag-option-checkbox').forEach((checkbox) => {
                checkbox.addEventListener('change', () => {
                    const tagId = checkbox.dataset.tagId;
                    if (!tagId) return;
                    if (checkbox.checked) selectedTagIds.add(tagId);
                    else selectedTagIds.delete(tagId);
                    applyButton.disabled = selectedTagIds.size === 0;
                });
            });

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeBatchTagModal,
                initialFocusTarget: () => (
                    normalizedMode === 'add'
                        ? modal.querySelector('#sp-batch-tag-name-input')
                        : modal.querySelector('.sp-batch-tag-option-checkbox')
                ) || modal.querySelector('.sp-modal-cancel')
            });

            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            });
        }

        function renderTagModal(sourceKey = null, modalState = null) {
            const shadowRoot = getShadowRoot();
            const state = getState() || {};
            const tagsById = getTagsById();
            const sourceTagsById = getSourceTagsById();
            const sourcesByKey = getSourcesByKey();
            if (!shadowRoot || !el) return;

            const normalizedModalState = Array.isArray(modalState)
                ? { draftTagIds: modalState }
                : (modalState && typeof modalState === 'object' ? modalState : {});
            const source = sourceKey ? sourcesByKey.get(sourceKey) : null;
            const selectedTagIds = new Set(sourceKey
                ? (normalizedModalState.draftTagIds || getSourceTagIds(sourceKey))
                : []);
            const usageCounts = getTagUsageCounts();
            const editingTagId = !source ? normalizedModalState.editingTagId || null : null;

            prepareModalOpen('sp-tag-modal', 'sp-tag-backdrop');

            const backdrop = el('div', { className: 'sp-overlay-backdrop', id: 'sp-tag-backdrop' });
            const modal = el('div', {
                className: 'sp-folder-modal sp-tag-modal',
                id: 'sp-tag-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'sp-tag-modal-title',
                tabindex: '-1'
            });
            const title = source ? getMessage('ui_edit_tags') : getMessage('ui_manage_tags');
            const header = el('div', { className: 'sp-folder-modal-header' }, [
                el('h3', { className: 'sp-folder-modal-title', id: 'sp-tag-modal-title' }, [title])
            ]);
            const content = el('div', { className: 'sp-folder-modal-content sp-tag-modal-content' });

            const createEditor = createTagEditor({
                className: 'sp-tag-create-row',
                submitLabel: getMessage('ui_create_tag'),
                submitButtonId: 'sp-create-tag-btn',
                inputId: 'sp-tag-name-input',
                initialColor: getDefaultTagColor(),
                onSubmit: ({ label, color }) => {
                    const newTagId = createTag(label, { color });
                    if (!newTagId) return;

                    createEditor.labelInput.value = '';
                    if (source) {
                        selectedTagIds.add(newTagId);
                        render();
                        saveState({ immediate: true, critical: true });
                        renderTagModal(sourceKey, { draftTagIds: Array.from(selectedTagIds) });
                        return;
                    }

                    saveState({ immediate: true, critical: true });
                    render();
                    renderTagModal();
                }
            });
            content.appendChild(createEditor.root);

            const tagOrder = Array.isArray(state.tagOrder) ? state.tagOrder : [];
            if (tagOrder.length === 0) {
                content.appendChild(el('div', { className: 'sp-folder-empty' }, [
                    source ? getMessage('ui_no_tags_for_source') : getMessage('ui_no_tags')
                ]));
            } else if (source) {
                let modalItemIndex = 0;
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    content.appendChild(el('label', {
                        className: 'sp-tag-option',
                        style: createModalItemStaggerStyle(modalItemIndex)
                    }, [
                        el('input', {
                            type: 'checkbox',
                            className: 'sp-tag-option-checkbox',
                            dataset: { tagId },
                            checked: selectedTagIds.has(tagId)
                        }),
                        el('span', { className: 'sp-tag-option-label' }, [tag.label])
                    ]));
                    modalItemIndex += 1;
                });
            } else {
                let modalItemIndex = 0;
                tagOrder.forEach((tagId) => {
                    const tag = tagsById.get(tagId);
                    if (!tag) return;

                    const editButton = el('button', {
                        type: 'button',
                        className: 'sp-tag-row-button sp-edit-tag-btn',
                        dataset: { tagId },
                        title: getMessage('ui_tag_edit_title')
                    }, [el('span', { className: 'google-symbols' }, ['edit'])]);
                    editButton.addEventListener('click', () => {
                        renderTagModal(null, { editingTagId: tagId });
                    });

                    const deleteButton = el('button', {
                        type: 'button',
                        className: 'sp-tag-row-button sp-delete-tag-btn',
                        dataset: { tagId },
                        title: getMessage('ui_tag_delete')
                    }, [el('span', { className: 'google-symbols' }, ['delete'])]);
                    deleteButton.addEventListener('click', () => {
                        const shouldDelete = typeof window === 'undefined' || typeof window.confirm !== 'function'
                            ? true
                            : window.confirm(getMessage('ui_tag_delete_confirm', [tag.label]));
                        if (!shouldDelete) return;

                        deleteTag(tagId);
                        saveState({ immediate: true, critical: true });
                        render();
                        renderTagModal();
                    });

                    const item = el('div', {
                        className: 'sp-tag-manage-item' + (editingTagId === tagId ? ' is-editing' : ''),
                        style: createModalItemStaggerStyle(modalItemIndex)
                    }, [
                        el('div', { className: 'sp-tag-row' }, [
                            el('span', {
                                className: 'sp-tag-row-color' + (tag.color ? '' : ' is-neutral'),
                                title: tag.color || getMessage('ui_tag_color_none'),
                                style: getTagColorPreviewStyle(tag.color)
                            }),
                            el('span', { className: 'sp-tag-row-label' }, [tag.label]),
                            el('span', { className: 'sp-tag-row-count' }, [String(usageCounts.get(tagId) || 0)]),
                            editButton,
                            deleteButton
                        ])
                    ]);

                    if (editingTagId === tagId) {
                        const editEditor = createTagEditor({
                            className: 'sp-tag-edit-row',
                            initialLabel: tag.label,
                            initialColor: tag.color,
                            submitLabel: getMessage('ui_tag_update'),
                            submitButtonClassName: 'sp-button',
                            inputId: getEditTagInputId(tagId),
                            allowUnsetColor: true,
                            onCancel: () => renderTagModal(),
                            onSubmit: ({ label, color }) => {
                                const result = updateTag(tagId, { label, color });
                                if (!result || result !== tagId) return;

                                saveState({ immediate: true, critical: true });
                                render();
                                renderTagModal();
                            }
                        });
                        item.appendChild(editEditor.root);
                    }

                    content.appendChild(item);
                    modalItemIndex += 1;
                });
            }

            const footerChildren = [
                el('button', { type: 'button', className: 'sp-modal-cancel' }, [getMessage('ui_cancel')])
            ];
            if (source) {
                footerChildren.push(el('button', { type: 'button', className: 'sp-button', id: 'sp-save-tags-btn' }, [getMessage('ui_save')]));
            }
            const footer = el('div', { className: 'sp-folder-modal-footer' }, footerChildren);

            footer.querySelector('.sp-modal-cancel').addEventListener('click', closeTagModal);
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop) {
                    closeTagModal();
                }
            });

            modal.appendChild(header);
            modal.appendChild(content);
            modal.appendChild(footer);
            shadowRoot.appendChild(backdrop);
            shadowRoot.appendChild(modal);

            if (source) {
                modal.querySelector('#sp-save-tags-btn').addEventListener('click', () => {
                    const nextTagIds = Array.from(modal.querySelectorAll('.sp-tag-option-checkbox:checked'))
                        .reduce((acc, input) => {
                            const tagId = input.dataset.tagId;
                            if (tagId) acc.push(tagId);
                            return acc;
                        }, []);
                    setSourceTagIds(sourceKey, nextTagIds);
                    saveState({ immediate: true, critical: true });
                    render();
                    closeTagModal();
                });
            }

            const modalKeyboard = bindModalKeyboardNavigation(modal, {
                closeModal: closeTagModal,
                initialFocusTarget: () => (
                    editingTagId
                        ? modal.querySelector(`#${getCssEscapedId(getEditTagInputId(editingTagId))}`)
                        : modal.querySelector('#sp-tag-name-input')
                ) || modal.querySelector('.sp-modal-cancel')
            });

            requestAnimationFrame(() => {
                backdrop.classList.add('visible');
                modal.classList.add('visible');
                modalKeyboard.focusInitial();
            });
        }

        function getEditTagInputId(tagId) {
            return `sp-edit-tag-${String(tagId || '').replace(/[^A-Za-z0-9_-]+/g, '_')}`;
        }

        function getCssEscapedId(id) {
            const windowObj = getWindow() || globalThis;
            if (windowObj.CSS && typeof windowObj.CSS.escape === 'function') {
                return windowObj.CSS.escape(id);
            }
            return String(id || '').replace(/[^A-Za-z0-9_-]/g, '\\$&');
        }

        return {
            renderMoveToFolderModal,
            closeMoveToFolderModal,
            closeNativeLabelImportModal,
            renderNativeLabelImportModal,
            closeSettingsModal,
            renderSettingsModal,
            getImportPreviewMessage,
            createNativeLabelImportPreviewNodes,
            createImportPreviewDetailNodes,
            copySettingsTextToClipboard,
            downloadSettingsExportText,
            readSettingsImportFile,
            executeMoveToFolder,
            collectMoveFolderOptions,
            closeTagModal,
            closeBatchTagModal,
            executeBatchTagUpdate,
            renderBatchTagModal,
            createTagColorControl,
            createTagEditor,
            getModalFocusableElements,
            focusModalInitialElement,
            handleModalKeyboardEvent,
            bindModalKeyboardNavigation,
            rememberModalFocusRestoreTarget,
            restoreModalFocus,
            closeManagedModal,
            prepareModalOpen,
            createModalItemStaggerStyle,
            getTagColorPresets,
            renderTagModal
        };
    }

    globalThis.NSM_CREATE_CONTENT_MODALS = createContentModals;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = createContentModals;
    }
})();
