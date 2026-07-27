(function () {
    'use strict';

    /**
     * createContentModals(deps) — modal 总编排 + 共享 helper 层。
     * 把 6 个独立 modal sub-factory(Move / NativeLabelImport / CommandPalette /
     * QuickViewButtons / Welcome / WhatsNew / Settings / Tag / BatchTag / TagFilter)
     * 装配起来,统一 prepareModalOpen / closeManagedModal / focus-trap binding /
     * stagger style / import preview 渲染 / file IO / clipboard 等横切关注点。
     *
     * @param {Object} deps 60+ 项依赖,主要分五类(完整 deps 见 line 5+ destructuring 块):
     *   - state getter: getState, getGroupsById, getTagsById, getSourceTagsById,
     *     getSourcesByKey, getPendingBatchKeys, getShadowRoot, getDocument, getWindow
     *   - 行为 callback: render, saveState, treePlacement, getParentMap,
     *     closeSourceActionMenu, showToast, showUndoableToast
     *   - tag CRUD: createTag, updateTag, deleteTag, getTagUsageCounts,
     *     getSourceTagIds, setSourceTagIds
     *   - import/export/history: getExportConfigText, previewImportConfig, applyImportConfig,
     *     applyNativeLabelImport, getSourceRepairReport/Options, applySourceRepairRemaps,
     *     getStateHistoryEntries, restoreStateHistoryEntry
     *   - sub-factory 注入: createContentNativeLabelImportModal, createContentModalFocus
     *     (各自有独立 globalThis.NSM_CREATE_* 回退)
     * @returns {Object} 40+ 方法的扁平 surface。主入口分 10 组:
     *   - Move/Native-label-import (4): render/closeMoveToFolderModal + 同名 native-label 对
     *   - Command palette + QuickView (3): render/close + QuickViewButtons
     *   - Tag filter + Welcome + WhatsNew + Settings (8): 各自 render/close 对
     *   - Tag CRUD + Batch (7): renderTagModal / renderBatchTagModal / executeBatchTagUpdate +
     *     createTagEditor / createTagColorControl
     *   - 跨 modal helper (14+): getImportPreviewMessage, createImportPreviewDetailNodes,
     *     copy/download/read IO 三组(SettingsText / DeveloperLogsText / SettingsImportFile),
     *     focus-trap (getModalFocusableElements,
     *     bindModalKeyboardNavigation, rememberModalFocusRestoreTarget, restoreModalFocus),
     *     closeManagedModal, prepareModalOpen, createModalItemStaggerStyle, getTagColorPresets
     *   完整 return 块见 line 1159。
     */
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
        const getParentMap = typeof deps.getParentMap === 'function'
            ? deps.getParentMap
            : () => (deps.parentMap || new Map());
        const treePlacement = deps.treePlacement || null;
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
        const createContentNativeLabelImportModal = typeof deps.createContentNativeLabelImportModal === 'function'
            ? deps.createContentNativeLabelImportModal
            : (
                globalThis.NSM_CREATE_CONTENT_NATIVE_LABEL_IMPORT_MODAL ||
                (
                    typeof require === 'function'
                        ? require('./content-native-label-import-modal.js')
                        : null
                )
            );
        const createContentModalFocus = typeof deps.createContentModalFocus === 'function'
            ? deps.createContentModalFocus
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_FOCUS ||
                (
                    typeof require === 'function'
                        ? require('./content-modal-focus.js')
                        : null
                )
            );
        const closeSourceActionMenu = typeof deps.closeSourceActionMenu === 'function'
            ? deps.closeSourceActionMenu
            : () => {};
        const render = typeof deps.render === 'function'
            ? deps.render
            : () => {};
        const saveState = typeof deps.saveState === 'function'
            ? deps.saveState
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
        const getDeveloperModeEnabled = typeof deps.getDeveloperModeEnabled === 'function'
            ? deps.getDeveloperModeEnabled
            : () => false;
        const setDeveloperModeEnabled = typeof deps.setDeveloperModeEnabled === 'function'
            ? deps.setDeveloperModeEnabled
            : () => Promise.resolve(false);
        const getHoverSpotlightEnabled = typeof deps.getHoverSpotlightEnabled === 'function'
            ? deps.getHoverSpotlightEnabled
            : () => true;
        const setHoverSpotlightEnabled = typeof deps.setHoverSpotlightEnabled === 'function'
            ? deps.setHoverSpotlightEnabled
            : () => Promise.resolve(true);
        const getDragMode = typeof deps.getDragMode === 'function'
            ? deps.getDragMode
            : () => 'classic';
        const setDragMode = typeof deps.setDragMode === 'function'
            ? deps.setDragMode
            : () => Promise.resolve('classic');
        const markWelcomeOnboardingSeen = typeof deps.markWelcomeOnboardingSeen === 'function'
            ? deps.markWelcomeOnboardingSeen
            : () => Promise.resolve(false);
        const markWhatsNewSeen = typeof deps.markWhatsNewSeen === 'function'
            ? deps.markWhatsNewSeen
            : () => Promise.resolve(false);
        const getHistoryRetentionLimit = typeof deps.getHistoryRetentionLimit === 'function'
            ? deps.getHistoryRetentionLimit
            : () => 20;
        const setHistoryRetentionLimit = typeof deps.setHistoryRetentionLimit === 'function'
            ? deps.setHistoryRetentionLimit
            : () => Promise.resolve(20);
        const createManualRestorePoint = typeof deps.createManualRestorePoint === 'function'
            ? deps.createManualRestorePoint
            : () => Promise.resolve(false);
        const getLanguageOverride = typeof deps.getLanguageOverride === 'function'
            ? deps.getLanguageOverride
            : () => 'auto';
        const setLanguageOverride = typeof deps.setLanguageOverride === 'function'
            ? deps.setLanguageOverride
            : () => Promise.resolve('auto');
        const getDeveloperLogExportText = typeof deps.getDeveloperLogExportText === 'function'
            ? deps.getDeveloperLogExportText
            : () => JSON.stringify({ logs: [] }, null, 2);
        const clearDeveloperLogs = typeof deps.clearDeveloperLogs === 'function'
            ? deps.clearDeveloperLogs
            : () => Promise.resolve(false);
        const renderSaveStatus = typeof deps.renderSaveStatus === 'function'
            ? deps.renderSaveStatus
            : () => null;
        const QUICK_VIEW_BUTTON_OPTIONS = [
            ['all', 'ui_quick_view_all'],
            ['ungrouped', 'ui_quick_view_ungrouped'],
            ['disabled', 'ui_quick_view_disabled'],
            ['tag', 'ui_quick_view_tag'],
            ['recent', 'ui_quick_view_recent'],
            ['issues', 'ui_quick_view_issues']
        ];
        const getCommandPaletteCommands = typeof deps.getCommandPaletteCommands === 'function'
            ? deps.getCommandPaletteCommands
            : () => [];
        const executeCommandPaletteCommand = typeof deps.executeCommandPaletteCommand === 'function'
            ? deps.executeCommandPaletteCommand
            : () => false;
        const getCommandShortcut = typeof deps.getCommandShortcut === 'function'
            ? deps.getCommandShortcut
            : () => '';
        const setCommandShortcut = typeof deps.setCommandShortcut === 'function'
            ? deps.setCommandShortcut
            : () => Promise.resolve('');
        const getCommandShortcutComboFromEvent = typeof deps.getCommandShortcutComboFromEvent === 'function'
            ? deps.getCommandShortcutComboFromEvent
            : () => '';
        const formatCommandShortcut = typeof deps.formatCommandShortcut === 'function'
            ? deps.formatCommandShortcut
            : (shortcut) => String(shortcut || '');
        const getVisibleQuickViewKinds = typeof deps.getVisibleQuickViewKinds === 'function'
            ? deps.getVisibleQuickViewKinds
            : () => QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => kind);
        const setVisibleQuickViewKinds = typeof deps.setVisibleQuickViewKinds === 'function'
            ? deps.setVisibleQuickViewKinds
            : () => Promise.resolve(QUICK_VIEW_BUTTON_OPTIONS.map(([kind]) => kind));
        const applyTagQuickFilter = typeof deps.applyTagQuickFilter === 'function'
            ? deps.applyTagQuickFilter
            : (tagId) => {
                const state = getState() || {};
                state.activeQuickViewKind = null;
                state.activeTagId = tagId;
                render();
                return true;
            };
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
        const SETTINGS_DEVELOPER_PASSWORD = typeof deps.settingsDeveloperPassword === 'string'
            ? deps.settingsDeveloperPassword
            : 'developer_mode';
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

        const nativeLabelImportModal = typeof createContentNativeLabelImportModal === 'function'
            ? createContentNativeLabelImportModal({
                el,
                getMessage,
                createModalItemStaggerStyle
            })
            : null;
        const createNativeLabelImportPreviewNodes = nativeLabelImportModal?.createPreviewNodes || (() => []);

        function getTagColorPresets() {
            return [...TAG_COLOR_PRESETS];
        }

        const modalFocus = typeof createContentModalFocus === 'function'
            ? createContentModalFocus({ getDocument, getShadowRoot })
            : {};
        const bindModalKeyboardNavigation = modalFocus.bindModalKeyboardNavigation || (() => ({
            focusInitial: () => null,
            dispose: () => {}
        }));
        const getModalFocusableElements = modalFocus.getModalFocusableElements || (() => []);
        const focusModalInitialElement = modalFocus.focusModalInitialElement || (() => null);
        const handleModalKeyboardEvent = modalFocus.handleModalKeyboardEvent || (() => false);
        const rememberModalFocusRestoreTarget = modalFocus.rememberModalFocusRestoreTarget || (() => null);
        const restoreModalFocus = modalFocus.restoreModalFocus || (() => null);

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

        function closeNativeLabelImportModal(options = {}) {
            return closeManagedModal('sp-native-label-import-modal', 'sp-native-label-import-backdrop', options);
        }

        const welcomeModalFactory = typeof deps.createContentModalWelcome === 'function'
            ? deps.createContentModalWelcome
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_WELCOME
                || (typeof require === 'function' ? require('./content-modal-welcome.js') : null)
            );
        const welcomeModalModule = typeof welcomeModalFactory === 'function'
            ? welcomeModalFactory({
                el,
                getMessage,
                getShadowRoot,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                markWelcomeOnboardingSeen,
                openWebStoreFeedback: (...args) => openWebStoreFeedback(...args)
            })
            : null;
        const renderWelcomeModal = welcomeModalModule?.renderWelcomeModal || (() => false);
        const closeWelcomeModal = welcomeModalModule?.closeWelcomeModal
            || ((options = {}) => closeManagedModal('sp-welcome-modal', 'sp-welcome-backdrop', options));
        const createWelcomeFeatureRow = welcomeModalModule?.createWelcomeFeatureRow
            || ((iconName, titleKey, bodyKey) => el('div', { className: 'sp-welcome-feature-row' }, [
                el('span', { className: 'google-symbols sp-welcome-feature-icon', 'aria-hidden': 'true' }, [iconName]),
                el('div', { className: 'sp-welcome-feature-copy' }, [
                    el('h4', { className: 'sp-welcome-feature-title' }, [getMessage(titleKey)]),
                    el('p', { className: 'sp-welcome-feature-body' }, [getMessage(bodyKey)])
                ])
            ]));

        const whatsNewModalFactory = typeof deps.createContentModalWhatsNew === 'function'
            ? deps.createContentModalWhatsNew
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_WHATS_NEW
                || (typeof require === 'function' ? require('./content-modal-whats-new.js') : null)
            );
        const whatsNewModalModule = typeof whatsNewModalFactory === 'function'
            ? whatsNewModalFactory({
                el,
                getMessage,
                getShadowRoot,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                markWhatsNewSeen,
                createWelcomeFeatureRow,
                getDragMode,
                setDragMode,
                showToast
            })
            : null;
        const renderWhatsNewModal = whatsNewModalModule?.renderWhatsNewModal || (() => false);
        const closeWhatsNewModal = whatsNewModalModule?.closeWhatsNewModal
            || ((options = {}) => closeManagedModal('sp-whats-new-modal', 'sp-whats-new-backdrop', options));

        const tagFilterModalFactory = typeof deps.createContentModalTagFilter === 'function'
            ? deps.createContentModalTagFilter
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_TAG_FILTER
                || (typeof require === 'function' ? require('./content-modal-tag-filter.js') : null)
            );
        const tagFilterModalModule = typeof tagFilterModalFactory === 'function'
            ? tagFilterModalFactory({
                el,
                getMessage,
                getShadowRoot,
                getState,
                getTagsById,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                applyTagQuickFilter
            })
            : null;
        const renderTagFilterModal = tagFilterModalModule?.renderTagFilterModal || (() => false);
        const closeTagFilterModal = tagFilterModalModule?.closeTagFilterModal
            || ((options = {}) => closeManagedModal('sp-tag-filter-modal', 'sp-tag-filter-backdrop', options));

        const moveModalFactory = typeof deps.createContentModalMove === 'function'
            ? deps.createContentModalMove
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_MOVE
                || (typeof require === 'function' ? require('./content-modal-move.js') : null)
            );
        const moveModalModule = typeof moveModalFactory === 'function'
            ? moveModalFactory({
                el,
                getMessage,
                getShadowRoot,
                getState,
                getGroupsById,
                getSourcesByKey,
                getPendingBatchKeys,
                getParentMap,
                treePlacement,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                createModalItemStaggerStyle,
                closeSourceActionMenu,
                saveState,
                render
            })
            : null;
        const renderMoveToFolderModal = moveModalModule?.renderMoveToFolderModal || (() => {});
        const closeMoveToFolderModal = moveModalModule?.closeMoveToFolderModal
            || ((options = {}) => closeManagedModal('sp-move-modal', 'sp-move-backdrop', options));
        const collectMoveFolderOptions = moveModalModule?.collectMoveFolderOptions || (() => []);
        const executeMoveToFolder = moveModalModule?.executeMoveToFolder || (() => {});

        const commandPaletteModalFactory = typeof deps.createContentModalCommandPalette === 'function'
            ? deps.createContentModalCommandPalette
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_COMMAND_PALETTE
                || (typeof require === 'function' ? require('./content-modal-command-palette.js') : null)
            );
        const commandPaletteModalModule = typeof commandPaletteModalFactory === 'function'
            ? commandPaletteModalFactory({
                el,
                getMessage,
                getShadowRoot,
                getDocument,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                showToast,
                getCommandPaletteCommands,
                executeCommandPaletteCommand,
                getCommandShortcut,
                setCommandShortcut,
                getCommandShortcutComboFromEvent,
                formatCommandShortcut
            })
            : null;
        const renderCommandPaletteModal = commandPaletteModalModule?.renderCommandPaletteModal || (() => false);
        const closeCommandPaletteModal = commandPaletteModalModule?.closeCommandPaletteModal
            || ((options = {}) => closeManagedModal('sp-command-palette-modal', 'sp-command-palette-backdrop', options));

        const tagModalFactory = typeof deps.createContentModalTag === 'function'
            ? deps.createContentModalTag
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_TAG
                || (typeof require === 'function' ? require('./content-modal-tag.js') : null)
            );
        const tagModalModule = typeof tagModalFactory === 'function'
            ? tagModalFactory({
                el,
                getMessage,
                getShadowRoot,
                getWindow,
                getState,
                getTagsById,
                getSourceTagsById,
                getSourcesByKey,
                getPendingBatchKeys,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                createModalItemStaggerStyle,
                normalizeTagColor,
                normalizeTagColorInputValue,
                getDefaultTagColor,
                getTagColorPreviewStyle,
                tagColorPresets: TAG_COLOR_PRESETS,
                createTag,
                updateTag,
                deleteTag,
                getTagUsageCounts,
                getSourceTagIds,
                setSourceTagIds,
                saveState,
                render,
                showToast,
                showUndoableToast,
                closeSourceActionMenu
            })
            : null;
        const renderTagModal = tagModalModule?.renderTagModal || (() => {});
        const closeTagModal = tagModalModule?.closeTagModal
            || ((options = {}) => closeManagedModal('sp-tag-modal', 'sp-tag-backdrop', options));
        const renderBatchTagModal = tagModalModule?.renderBatchTagModal || (() => {});
        const closeBatchTagModal = tagModalModule?.closeBatchTagModal
            || ((options = {}) => closeManagedModal('sp-batch-tag-modal', 'sp-batch-tag-backdrop', options));
        const executeBatchTagUpdate = tagModalModule?.executeBatchTagUpdate || (() => false);
        const createTagEditor = tagModalModule?.createTagEditor || (() => ({ root: null, labelInput: null, colorControl: null }));
        const createTagColorControl = tagModalModule?.createTagColorControl
            || (() => ({ root: null, hexInput: null, colorInput: null, getValue: () => null }));

        const settingsModalFactory = typeof deps.createContentModalSettings === 'function'
            ? deps.createContentModalSettings
            : (
                globalThis.NSM_CREATE_CONTENT_MODAL_SETTINGS
                || (typeof require === 'function' ? require('./content-modal-settings.js') : null)
            );
        const settingsModalModule = typeof settingsModalFactory === 'function'
            ? settingsModalFactory({
                el,
                getMessage,
                getShadowRoot,
                getDocument,
                getWindow,
                prepareModalOpen,
                closeManagedModal,
                bindModalKeyboardNavigation,
                removeModalNode,
                getVisibleQuickViewKinds,
                setVisibleQuickViewKinds,
                getDeveloperModeEnabled,
                setDeveloperModeEnabled,
                getHoverSpotlightEnabled,
                setHoverSpotlightEnabled,
                getDragMode,
                setDragMode,
                clearDeveloperLogs,
                getStateHistoryEntries,
                restoreStateHistoryEntry: (...args) => restoreStateHistoryEntry(...args),
                getExportConfigText,
                previewImportConfig,
                applyImportConfig,
                openWebStoreFeedback: (...args) => openWebStoreFeedback(...args),
                renderCommandPaletteModal: (...args) => renderCommandPaletteModal(...args),
                renderWelcomeModal: (...args) => renderWelcomeModal(...args),
                renderWhatsNewModal: (...args) => renderWhatsNewModal(...args),
                render,
                showToast,
                renderSaveStatus,
                applySourceRepairRemaps,
                getSourceRepairReport,
                setHistoryRetentionLimit,
                createManualRestorePoint,
                setLanguageOverride,
                getImportPreviewMessage: (...args) => getImportPreviewMessage(...args),
                createImportPreviewDetailNodes: (...args) => createImportPreviewDetailNodes(...args),
                copySettingsTextToClipboard: (...args) => copySettingsTextToClipboard(...args),
                downloadSettingsExportText: (...args) => downloadSettingsExportText(...args),
                readSettingsImportFile: (...args) => readSettingsImportFile(...args),
                copyDeveloperLogsTextToClipboard: (...args) => copyDeveloperLogsTextToClipboard(...args),
                downloadDeveloperLogsText: (...args) => downloadDeveloperLogsText(...args),
                createDiagnosticsGrid: (...args) => createDiagnosticsGrid(...args),
                createSourceRepairNodes: (...args) => createSourceRepairNodes(...args),
                createHistoryPreferenceNodes: (...args) => createHistoryPreferenceNodes(...args),
                createLanguagePreferenceSection: (...args) => createLanguagePreferenceSection(...args),
                createHistoryNodes: (...args) => createHistoryNodes(...args),
                copyDiagnosticsTextToClipboard: (...args) => copyDiagnosticsTextToClipboard(...args),
                settingsDeveloperPassword: SETTINGS_DEVELOPER_PASSWORD
            })
            : null;
        const closeSettingsModal = settingsModalModule?.closeSettingsModal
            || ((options = {}) => closeManagedModal('sp-settings-modal', 'sp-settings-backdrop', options));
        const renderSettingsModal = settingsModalModule?.renderSettingsModal || (() => false);
        const renderQuickViewButtonsModal = settingsModalModule?.renderQuickViewButtonsModal || (() => false);

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

        function createImportPreviewDiffNodes(preview) {
            const diff = preview?.diff || null;
            if (!diff) return [];
            const settingsChanged = Boolean(
                diff.settings?.changesCustomHeight ||
                diff.settings?.changesSourceViewDisplayKind
            );
            return [
                el('div', { className: 'sp-settings-import-warning' }, [
                    getMessage('ui_settings_import_preview_replace_warning')
                ]),
                el('div', { className: 'sp-settings-preview-diff' }, [
                    el('div', { className: 'sp-settings-preview-detail-title' }, [
                        getMessage('ui_settings_import_diff_sources')
                    ]),
                    el('div', { className: 'sp-settings-preview-diff-row' }, [
                        getMessage('ui_settings_import_diff_source_state', [
                            String(diff.source?.enableCount || 0),
                            String(diff.source?.disableCount || 0),
                            String(diff.source?.unchangedCount || 0)
                        ])
                    ]),
                    el('div', { className: 'sp-settings-preview-detail-title' }, [
                        getMessage('ui_settings_import_diff_folders', [
                            String(diff.folders?.incomingCount || 0),
                            String(diff.folders?.sameNameCount || 0),
                            String(diff.folders?.removedCount || 0)
                        ])
                    ]),
                    el('div', { className: 'sp-settings-preview-detail-title' }, [
                        getMessage('ui_settings_import_diff_tags', [
                            String(diff.tags?.incomingCount || 0),
                            String(diff.tags?.sameNameCount || 0),
                            String(diff.tags?.removedCount || 0),
                            String(diff.tags?.normalizedIdCount || 0)
                        ])
                    ]),
                    el('div', { className: 'sp-settings-preview-diff-row' }, [
                        getMessage(settingsChanged
                            ? 'ui_settings_import_diff_settings_changed'
                            : 'ui_settings_import_diff_settings_unchanged')
                    ])
                ])
            ];
        }

        function createImportPreviewDetailNodes(preview) {
            if (!preview?.ok) return [];
            return [
                el('div', { className: 'sp-settings-preview-details' }, [
                    ...createImportPreviewDiffNodes(preview),
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

        function getSettingsExportFileName(kind = 'config') {
            const date = new Date();
            const dateText = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'export';
            const suffix = kind === 'developer-logs' ? 'developer-logs' : 'config';
            return `gemininotebook-source-management-${suffix}-${dateText}.json`;
        }

        function downloadSettingsExportText(text, kind = 'config') {
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
            anchor.download = getSettingsExportFileName(kind);
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
                ['ui_diagnostics_developer_log_count', String(diagnostics.developerLogCount ?? 0)],
                ['ui_diagnostics_latest_developer_log', diagnostics.latestDeveloperLogAt || '-'],
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
            if (entry?.label) {
                return getMessage('ui_history_restore_point_summary', [
                    String(entry.label),
                    entry?.createdAt ? String(entry.createdAt).replace('T', ' ').slice(0, 19) : '-',
                    String(entry?.sourceCount ?? 0),
                    String(entry?.groupCount ?? 0),
                    String(entry?.tagCount ?? 0)
                ]);
            }
            const createdAt = entry?.createdAt ? String(entry.createdAt).replace('T', ' ').slice(0, 19) : '-';
            return getMessage('ui_history_entry_summary', [
                createdAt,
                String(entry?.sourceCount ?? 0),
                String(entry?.groupCount ?? 0),
                String(entry?.tagCount ?? 0),
                entry?.reason || '-'
            ]);
        }

        function createHistoryPreferenceNodes() {
            const retentionSelect = el('select', {
                className: 'sp-settings-select sp-history-retention-select',
                'aria-label': getMessage('ui_history_retention_label')
            }, [
                ...[20, 50, 100].map((limit) => el('option', {
                    value: String(limit),
                    selected: getHistoryRetentionLimit() === limit
                }, [
                    getMessage('ui_history_retention_option', [String(limit)])
                ]))
            ]);
            return [
                el('div', { className: 'sp-settings-preference-row sp-history-retention-row' }, [
                    el('div', { className: 'sp-settings-preference-copy' }, [
                        el('div', { className: 'sp-settings-preference-title' }, [
                            getMessage('ui_history_retention_label')
                        ]),
                        el('p', { className: 'sp-settings-helper-text' }, [
                            getMessage('ui_history_retention_body')
                        ])
                    ]),
                    retentionSelect
                ]),
                el('div', { className: 'sp-settings-action-row sp-settings-collapsible-actions' }, [
                    el('button', {
                        type: 'button',
                        className: 'sp-button sp-history-create-restore-point-btn sp-glare-hover'
                    }, [
                        getMessage('ui_history_create_restore_point')
                    ])
                ])
            ];
        }

        function createLanguagePreferenceSection() {
            const languageOptions = [
                ['auto', 'ui_settings_language_auto'],
                ['en', 'ui_settings_language_english'],
                ['es', 'ui_settings_language_spanish'],
                ['zh_CN', 'ui_settings_language_chinese']
            ];
            const languageSelect = el('select', {
                className: 'sp-settings-select sp-settings-language-select',
                'aria-label': getMessage('ui_settings_language_title')
            }, languageOptions.map(([value, key]) => el('option', {
                value,
                selected: getLanguageOverride() === value
            }, [
                getMessage(key)
            ])));

            return el('section', { className: 'sp-settings-section sp-settings-preferences-section' }, [
                el('div', { className: 'sp-settings-section-header' }, [
                    el('h4', { className: 'sp-settings-section-title' }, [getMessage('ui_settings_preferences_title')])
                ]),
                el('div', { className: 'sp-settings-preference-row' }, [
                    el('div', { className: 'sp-settings-preference-copy' }, [
                        el('div', { className: 'sp-settings-preference-title' }, [
                            getMessage('ui_settings_language_title')
                        ]),
                        el('p', { className: 'sp-settings-helper-text' }, [
                            getMessage('ui_settings_language_body')
                        ])
                    ]),
                    languageSelect
                ]),
                el('div', { className: 'sp-settings-preference-row sp-command-palette-settings-row' }, [
                    el('div', { className: 'sp-settings-preference-copy' }, [
                        el('div', { className: 'sp-settings-preference-title' }, [
                            getMessage('ui_command_palette')
                        ]),
                        el('p', { className: 'sp-settings-helper-text' }, [
                            getMessage('ui_command_palette_settings_body')
                        ])
                    ]),
                    el('button', {
                        type: 'button',
                        className: 'sp-button sp-settings-open-command-palette-btn sp-glare-hover'
                    }, [
                        getMessage('ui_settings_open_command_palette')
                    ])
                ]),
                el('div', { className: 'sp-settings-preference-row sp-quick-view-buttons-settings-row' }, [
                    el('div', { className: 'sp-settings-preference-copy' }, [
                        el('div', { className: 'sp-settings-preference-title' }, [
                            getMessage('ui_settings_quick_view_buttons_title')
                        ]),
                        el('p', { className: 'sp-settings-helper-text' }, [
                            getMessage('ui_settings_quick_view_buttons_body')
                        ])
                    ]),
                    el('button', {
                        type: 'button',
                        className: 'sp-button sp-settings-manage-quick-view-buttons-btn sp-glare-hover'
                    }, [
                        getMessage('ui_settings_manage_quick_view_buttons')
                    ])
                ])
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

        function copyDeveloperLogsTextToClipboard() {
            return copySettingsTextToClipboard(
                getDeveloperLogExportText(),
                null,
                'ui_settings_developer_logs_copied',
                'ui_settings_developer_logs_copy_failed'
            );
        }

        function downloadDeveloperLogsText() {
            return downloadSettingsExportText(getDeveloperLogExportText(), 'developer-logs');
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

        return {
            renderMoveToFolderModal,
            closeMoveToFolderModal,
            closeNativeLabelImportModal,
            renderNativeLabelImportModal,
            closeCommandPaletteModal,
            renderCommandPaletteModal,
            renderQuickViewButtonsModal,
            closeTagFilterModal,
            renderTagFilterModal,
            closeWelcomeModal,
            renderWelcomeModal,
            closeWhatsNewModal,
            renderWhatsNewModal,
            closeSettingsModal,
            renderSettingsModal,
            getImportPreviewMessage,
            createNativeLabelImportPreviewNodes,
            createImportPreviewDetailNodes,
            copySettingsTextToClipboard,
            copyDeveloperLogsTextToClipboard,
            downloadSettingsExportText,
            downloadDeveloperLogsText,
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
