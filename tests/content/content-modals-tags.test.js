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

const createModalRenderElement = (tag, attrs = {}, children = []) => {
    const listeners = new Map();
    const element = {
        tag,
        tagName: String(tag).toUpperCase(),
        attrs,
        id: attrs.id || '',
        className: attrs.className || attrs.class || '',
        dataset: Object.assign({}, attrs.dataset || {}),
        childNodes: [],
        children: [],
        parentNode: null,
        disabled: Boolean(attrs.disabled),
        value: attrs.value || '',
        checked: Boolean(attrs.checked),
        focus: jest.fn(),
        addEventListener: jest.fn((type, handler) => {
            const handlers = listeners.get(type) || [];
            handlers.push(handler);
            listeners.set(type, handlers);
        }),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn((event) => {
            const handlers = listeners.get(event?.type || event) || [];
            handlers.forEach((handler) => handler.call(element, event));
            return true;
        }),
        appendChild(child) {
            this.childNodes.push(child);
            if (child && typeof child === 'object') {
                child.parentNode = this;
                this.children.push(child);
            }
            return child;
        },
        removeChild(child) {
            this.childNodes = this.childNodes.filter((candidate) => candidate !== child);
            this.children = this.children.filter((candidate) => candidate !== child);
            return child;
        },
        setAttribute(name, value) {
            this.attrs[name] = value;
            if (name === 'id') this.id = value;
            if (name === 'class') this.className = value;
        },
        getAttribute(name) {
            if (name === 'id') return this.id || null;
            if (name === 'class') return this.className || null;
            if (name === 'style') return this.attrs.style || null;
            return this.attrs[name] ?? null;
        },
        classList: {
            add: jest.fn((className) => {
                const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
                classes.add(className);
                element.className = Array.from(classes).join(' ');
            }),
            remove: jest.fn((className) => {
                const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
                classes.delete(className);
                element.className = Array.from(classes).join(' ');
            }),
            toggle: jest.fn((className, force) => {
                const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
                const shouldAdd = typeof force === 'boolean' ? force : !classes.has(className);
                if (shouldAdd) classes.add(className);
                else classes.delete(className);
                element.className = Array.from(classes).join(' ');
                return shouldAdd;
            }),
            contains: jest.fn((className) => String(element.className || '').split(/\s+/).includes(className))
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const results = [];
            const matches = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return false;
                if (selector.startsWith('#')) return candidate.id === selector.slice(1);
                if (selector.startsWith('.')) {
                    const className = selector.slice(1).split(/[:\s.\[]/)[0];
                    return String(candidate.className || '').split(/\s+/).includes(className);
                }
                return false;
            };
            const visit = (candidate) => {
                if (matches(candidate)) results.push(candidate);
                (candidate?.childNodes || []).forEach(visit);
            };
            this.childNodes.forEach(visit);
            return results;
        }
    };

    Object.defineProperty(element, 'textContent', {
        get() {
            return this.childNodes.map((child) => (
                typeof child === 'string' ? child : (child?.textContent || '')
            )).join('');
        },
        set(value) {
            this.childNodes = [String(value)];
            this.children = [];
        }
    });

    children.forEach((child) => element.appendChild(child));
    return element;
};

const createModalTestShadowRoot = () => {
    const shadowRoot = {
        childNodes: [],
        children: [],
        activeElement: null,
        host: { isConnected: true },
        appendChild(node) {
            this.childNodes.push(node);
            this.children.push(node);
            if (node && typeof node === 'object') node.parentNode = this;
            return node;
        },
        removeChild(node) {
            this.childNodes = this.childNodes.filter((child) => child !== node);
            this.children = this.children.filter((child) => child !== node);
            return node;
        },
        getElementById(id) {
            return this.querySelector(`#${id}`);
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const results = [];
            const matches = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return false;
                if (selector.startsWith('#')) return candidate.id === selector.slice(1);
                if (selector.startsWith('.')) {
                    const className = selector.slice(1).split(/[:\s.\[]/)[0];
                    return String(candidate.className || '').split(/\s+/).includes(className);
                }
                return false;
            };
            const visit = (candidate) => {
                if (matches(candidate)) results.push(candidate);
                (candidate?.childNodes || []).forEach(visit);
            };
            this.childNodes.forEach(visit);
            return results;
        }
    };
    return shadowRoot;
};

const createModalMotionTestRuntime = ({
    state = {},
    groupsById = new Map(),
    tagsById = new Map(),
    sourcesByKey = new Map(),
    sourceTagsById = new Map(),
    pendingBatchKeys = new Set(),
    getSourceTagIds = () => [],
    setSourceTagIds = jest.fn(),
    saveState = jest.fn(),
    render = jest.fn(),
    buildParentMap = jest.fn(),
    removeSourceFromTree = jest.fn(),
    closeSourceActionMenu = jest.fn(),
    createTag = jest.fn(() => null),
    showToast = jest.fn(),
    showUndoableToast = showToast,
    getExportConfigText = jest.fn(() => '{"data":{}}'),
    previewImportConfig = jest.fn(() => ({ ok: false, reason: 'empty' })),
    applyImportConfig = jest.fn(() => ({ ok: false, reason: 'invalid' })),
    getSourceRepairReport = jest.fn(() => ({
        totalSources: 0,
        matchedSources: 0,
        unmatchedSources: 0,
        ambiguousSources: 0,
        matched: [],
        unmatched: [],
        ambiguous: []
    })),
    getSourceRepairOptions = jest.fn(() => []),
    applySourceRepairRemaps = jest.fn(() => Promise.resolve(true)),
    getStateHistoryEntries = jest.fn(() => []),
    restoreStateHistoryEntry = jest.fn(() => Promise.resolve(true)),
    applyNativeLabelImport = jest.fn(() => true),
    getDiagnosticsInfo = jest.fn(() => ({
        notebookId: 'notebook-test',
        sourceCount: 2,
        groupCount: 1,
        tagCount: 1,
        saveRevision: 3,
        savedAt: '2026-04-22T00:00:00.000Z',
        saveStatus: 'saved',
        lastSaveError: '',
        recoveryAvailable: false,
        lastNativeActionFailure: null
    })),
    getDiagnosticsText = jest.fn(() => '{"notebookId":"notebook-test"}'),
    getDeveloperModeEnabled = jest.fn(() => false),
    setDeveloperModeEnabled = jest.fn(() => Promise.resolve(false)),
    markWelcomeOnboardingSeen = jest.fn(() => Promise.resolve(true)),
    markWhatsNewSeen = jest.fn(() => Promise.resolve(true)),
    getHistoryRetentionLimit = jest.fn(() => 20),
    setHistoryRetentionLimit = jest.fn(() => Promise.resolve(20)),
    createManualRestorePoint = jest.fn(() => Promise.resolve(true)),
    getLanguageOverride = jest.fn(() => 'auto'),
    setLanguageOverride = jest.fn(() => Promise.resolve('auto')),
    getDeveloperLogExportText = jest.fn(() => '{"logs":[]}'),
    clearDeveloperLogs = jest.fn(() => Promise.resolve(true)),
    renderSaveStatus = jest.fn(),
    getCommandPaletteCommands = jest.fn(() => []),
    executeCommandPaletteCommand = jest.fn(() => false),
    getCommandShortcut = jest.fn(() => ''),
    setCommandShortcut = jest.fn(() => Promise.resolve('')),
    getCommandShortcutComboFromEvent = jest.fn(() => ''),
    formatCommandShortcut = jest.fn((shortcut) => shortcut),
    getVisibleQuickViewKinds = jest.fn(() => ['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']),
    setVisibleQuickViewKinds = jest.fn(() => Promise.resolve(['all', 'ungrouped', 'disabled', 'tag', 'recent', 'issues']))
} = {}) => {
    const createContentModals = require('../../src/content/content-modals.js');
    const shadowRoot = createModalTestShadowRoot();
    const modals = createContentModals({
        el: createModalRenderElement,
        getShadowRoot: () => shadowRoot,
        getState: () => state,
        getGroupsById: () => groupsById,
        getTagsById: () => tagsById,
        getSourceTagsById: () => sourceTagsById,
        getSourcesByKey: () => sourcesByKey,
        getPendingBatchKeys: () => pendingBatchKeys,
        getMessage: (key, substitutions = []) => (
            substitutions.length > 0 ? `${key}:${substitutions.join(',')}` : key
        ),
        closeSourceActionMenu,
        getTagUsageCounts: () => new Map(),
        getSourceTagIds,
        setSourceTagIds,
        saveState,
        render,
        buildParentMap,
        removeSourceFromTree,
        createTag,
        getExportConfigText,
        previewImportConfig,
        applyImportConfig,
        getSourceRepairReport,
        getSourceRepairOptions,
        applySourceRepairRemaps,
        getStateHistoryEntries,
        restoreStateHistoryEntry,
        applyNativeLabelImport,
        getDiagnosticsInfo,
        getDiagnosticsText,
        getDeveloperModeEnabled,
        setDeveloperModeEnabled,
        markWelcomeOnboardingSeen,
        markWhatsNewSeen,
        getHistoryRetentionLimit,
        setHistoryRetentionLimit,
        createManualRestorePoint,
        getLanguageOverride,
        setLanguageOverride,
        getDeveloperLogExportText,
        clearDeveloperLogs,
        renderSaveStatus,
        getCommandPaletteCommands,
        executeCommandPaletteCommand,
        getCommandShortcut,
        setCommandShortcut,
        getCommandShortcutComboFromEvent,
        formatCommandShortcut,
        getVisibleQuickViewKinds,
        setVisibleQuickViewKinds,
        updateTag: jest.fn(() => null),
        deleteTag: jest.fn(),
        showToast,
        showUndoableToast,
        normalizeTagColor: (value) => value || null,
        normalizeTagColorInputValue: (value) => String(value || ''),
        getDefaultTagColor: () => '#007AFF',
        getTagColorPreviewStyle: (color) => (color ? `--tag-color:${color};` : '')
    });

    return {
        modals,
        shadowRoot,
        renderSaveStatus,
        markWelcomeOnboardingSeen,
        markWhatsNewSeen,
        setHistoryRetentionLimit,
        createManualRestorePoint,
        setLanguageOverride
    };
};

describe('move-to-folder options', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        if (mod._resetState) mod._resetState();
    });

    afterEach(() => {
        delete global.requestAnimationFrame;
        teardownGlobalMocks();
    });

    it('collects top-level, second-level, and third-level folders in tree order', () => {
        mod.state.groups = ['root', 'sibling'];
        mod.groupsById.set('root', {
            id: 'root',
            title: 'Root',
            children: [
                { type: 'source', key: 'source1' },
                { type: 'group', id: 'child' }
            ]
        });
        mod.groupsById.set('child', {
            id: 'child',
            title: 'Child',
            children: [{ type: 'group', id: 'grandchild' }]
        });
        mod.groupsById.set('grandchild', {
            id: 'grandchild',
            title: 'Grandchild',
            children: []
        });
        mod.groupsById.set('sibling', {
            id: 'sibling',
            title: 'Sibling',
            children: []
        });

        expect(mod.collectMoveFolderOptions(mod.state.groups).map(({ group, level }) => ({
            id: group.id,
            level
        }))).toEqual([
            { id: 'root', level: 0 },
            { id: 'child', level: 1 },
            { id: 'grandchild', level: 2 },
            { id: 'sibling', level: 0 }
        ]);
    });

    it('renders move folder options with modal item stagger indexes in tree order', () => {
        global.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };

        const state = { groups: ['root', 'sibling'] };
        const groupsById = new Map([
            ['root', {
                id: 'root',
                title: 'Root',
                children: [{ type: 'group', id: 'child' }]
            }],
            ['child', {
                id: 'child',
                title: 'Child',
                children: [{ type: 'group', id: 'grandchild' }]
            }],
            ['grandchild', {
                id: 'grandchild',
                title: 'Grandchild',
                children: []
            }],
            ['sibling', {
                id: 'sibling',
                title: 'Sibling',
                children: []
            }]
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ state, groupsById });

        modals.renderMoveToFolderModal(['source-1']);

        expect(shadowRoot.querySelectorAll('.sp-folder-option').map((option) => option.attrs.style)).toEqual([
            '--sp-modal-item-index:0;',
            'padding-left:30px;--sp-modal-item-index:1;',
            'padding-left:48px;--sp-modal-item-index:2;',
            '--sp-modal-item-index:3;'
        ]);
    });

    it('ignores empty move-to-folder requests without crashing', () => {
        const { modals, shadowRoot } = createModalMotionTestRuntime();

        expect(() => modals.renderMoveToFolderModal(null)).not.toThrow();

        expect(shadowRoot.querySelector('#sp-move-modal')).toBeNull();
    });

    it('moves sources into folders whose children array is missing', () => {
        const state = { groups: ['target'], ungrouped: ['source-1'] };
        const groupsById = new Map([
            ['target', { id: 'target', title: 'Target' }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', title: 'Source 1' }]
        ]);
        const removeSourceFromTree = jest.fn();
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const closeSourceActionMenu = jest.fn();
        const { modals } = createModalMotionTestRuntime({
            state,
            groupsById,
            sourcesByKey,
            removeSourceFromTree,
            saveState,
            render,
            buildParentMap,
            closeSourceActionMenu
        });

        expect(() => modals.executeMoveToFolder(['source-1'], 'target')).not.toThrow();

        expect(groupsById.get('target').children).toEqual([{ type: 'source', key: 'source-1' }]);
        expect(removeSourceFromTree).toHaveBeenCalledWith('source-1');
        expect(buildParentMap).toHaveBeenCalled();
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(closeSourceActionMenu).toHaveBeenCalled();
    });
});

describe('modal option motion', () => {
    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };
    });

    afterEach(() => {
        delete global.requestAnimationFrame;
        teardownGlobalMocks();
    });

    it('renders source tag options with modal item stagger indexes', () => {
        const state = { tagOrder: ['alpha', 'beta'] };
        const tagsById = new Map([
            ['alpha', { id: 'alpha', label: 'Alpha', color: '#007AFF' }],
            ['beta', { id: 'beta', label: 'Beta', color: '#34C759' }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', title: 'Source 1' }]
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ state, tagsById, sourcesByKey });

        modals.renderTagModal('source-1');

        expect(shadowRoot.querySelectorAll('.sp-tag-option').map((option) => option.attrs.style)).toEqual([
            '--sp-modal-item-index:0;',
            '--sp-modal-item-index:1;'
        ]);
        expect(shadowRoot.querySelector('#sp-tag-name-input').focus).toHaveBeenCalled();
    });

    it('renders manage tag rows with modal item stagger indexes', () => {
        const state = { tagOrder: ['alpha', 'beta'] };
        const tagsById = new Map([
            ['alpha', { id: 'alpha', label: 'Alpha', color: '#007AFF' }],
            ['beta', { id: 'beta', label: 'Beta', color: '#34C759' }]
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ state, tagsById });

        modals.renderTagModal();

        expect(shadowRoot.querySelectorAll('.sp-tag-manage-item').map((item) => item.attrs.style)).toEqual([
            '--sp-modal-item-index:0;',
            '--sp-modal-item-index:1;'
        ]);
        expect(shadowRoot.querySelector('#sp-tag-name-input').focus).toHaveBeenCalled();
    });

    it('renders batch tag options with modal item stagger indexes', () => {
        const state = { tagOrder: ['alpha', 'beta'] };
        const pendingBatchKeys = new Set(['source-1']);
        const tagsById = new Map([
            ['alpha', { id: 'alpha', label: 'Alpha', color: '#007AFF' }],
            ['beta', { id: 'beta', label: 'Beta', color: '#34C759' }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', title: 'Source 1' }]
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            state,
            tagsById,
            sourcesByKey,
            pendingBatchKeys
        });

        modals.renderBatchTagModal('add', pendingBatchKeys);

        expect(shadowRoot.querySelectorAll('.sp-batch-tag-option').map((option) => option.attrs.style)).toEqual([
            '--sp-modal-item-index:0;',
            '--sp-modal-item-index:1;'
        ]);
        expect(shadowRoot.querySelector('#sp-batch-tag-name-input').focus).toHaveBeenCalled();
        expect(shadowRoot.querySelector('#sp-apply-batch-tags-btn').disabled).toBe(true);
    });

    it('applies batch add and remove tag updates without changing tag storage shape', () => {
        const state = {
            isBatchMode: true,
            tagOrder: ['alpha', 'beta']
        };
        const pendingBatchKeys = new Set(['source-1', 'source-2']);
        const currentTags = new Map([
            ['source-1', ['alpha']],
            ['source-2', []]
        ]);
        const nextTags = new Map();
        const tagsById = new Map([
            ['alpha', { id: 'alpha', label: 'Alpha' }],
            ['beta', { id: 'beta', label: 'Beta' }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', title: 'Source 1' }],
            ['source-2', { key: 'source-2', title: 'Source 2' }]
        ]);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const setSourceTagIds = jest.fn((sourceKey, tagIds) => {
            nextTags.set(sourceKey, tagIds);
            currentTags.set(sourceKey, tagIds);
        });
        const { modals } = createModalMotionTestRuntime({
            state,
            tagsById,
            sourcesByKey,
            pendingBatchKeys,
            getSourceTagIds: (sourceKey) => currentTags.get(sourceKey) || [],
            setSourceTagIds,
            saveState,
            render,
            showToast
        });

        expect(modals.executeBatchTagUpdate('add', pendingBatchKeys, ['beta'])).toBe(true);
        expect(nextTags.get('source-1')).toEqual(['alpha', 'beta']);
        expect(nextTags.get('source-2')).toEqual(['beta']);
        expect(state.isBatchMode).toBe(false);
        expect(pendingBatchKeys.size).toBe(0);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('ui_batch_tags_added_toast:2', { variant: 'success' });

        state.isBatchMode = true;
        pendingBatchKeys.add('source-1');
        pendingBatchKeys.add('source-2');
        nextTags.clear();

        expect(modals.executeBatchTagUpdate('remove', pendingBatchKeys, ['alpha'])).toBe(true);
        expect(nextTags.get('source-1')).toEqual(['beta']);
        expect(nextTags.get('source-2')).toEqual(['beta']);
        expect(pendingBatchKeys.size).toBe(0);
        expect(showToast).toHaveBeenLastCalledWith('ui_batch_tags_removed_toast:2', { variant: 'success' });
    });

    it('caps modal stagger indexes while preserving any base style', () => {
        const { modals } = createModalMotionTestRuntime();

        expect(modals.createModalItemStaggerStyle(12, 'padding-left:48px;')).toBe('padding-left:48px;--sp-modal-item-index:10;');
    });

    it('renders NotebookLM native label import preview details before applying', () => {
        const preview = {
            ok: true,
            labelCount: 2,
            sourceCount: 3,
            labels: [
                {
                    title: 'Research papers',
                    sourceCount: 2,
                    sourceTitles: ['Paper One', 'Paper Two'],
                    action: 'create',
                    existingGroupId: null
                },
                {
                    title: 'Reference material',
                    sourceCount: 1,
                    sourceTitles: ['Reference One'],
                    action: 'reuse',
                    existingGroupId: 'existing-reference'
                }
            ]
        };
        const applyNativeLabelImport = jest.fn(() => true);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ applyNativeLabelImport });

        expect(modals.renderNativeLabelImportModal(preview)).toBe(true);

        const modal = shadowRoot.getElementById('sp-native-label-import-modal');
        expect(modal).toBeTruthy();
        expect(modal.textContent).toContain('ui_import_native_labels_preview_summary:2,3');
        expect(modal.textContent).toContain('Research papers');
        expect(modal.textContent).toContain('Paper One');
        expect(modal.textContent).toContain('ui_import_native_labels_preview_create');
        expect(modal.textContent).toContain('Reference material');
        expect(modal.textContent).toContain('ui_import_native_labels_preview_reuse');

        shadowRoot.querySelector('.sp-native-label-import-confirm-btn').dispatchEvent({ type: 'click' });

        expect(applyNativeLabelImport).toHaveBeenCalledWith(preview);
        expect(shadowRoot.getElementById('sp-native-label-import-modal')).toBeNull();
    });

    it('renders an empty NotebookLM native label import preview without applying', () => {
        const preview = {
            ok: false,
            reason: 'no_native_labels',
            labelCount: 0,
            sourceCount: 0,
            labels: []
        };
        const applyNativeLabelImport = jest.fn(() => true);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ applyNativeLabelImport });

        expect(modals.renderNativeLabelImportModal(preview)).toBe(true);

        const modal = shadowRoot.getElementById('sp-native-label-import-modal');
        expect(modal).toBeTruthy();
        expect(modal.textContent).toContain('ui_import_native_labels_preview_empty');
        expect(shadowRoot.querySelector('.sp-native-label-import-confirm-btn').disabled).toBe(true);

        shadowRoot.querySelector('.sp-native-label-import-confirm-btn').dispatchEvent({ type: 'click' });

        expect(applyNativeLabelImport).not.toHaveBeenCalled();
    });

    it('rejects oversized import files before reading them', () => {
        global.NSM_CONTENT_CONFIG = {
            TAG_COLOR_PRESETS: ['#007AFF'],
            IMPORT_CONFIG_MAX_FILE_BYTES: 4
        };
        const showToast = jest.fn();
        global.window.FileReader = jest.fn();
        const { modals } = createModalMotionTestRuntime({ showToast });

        expect(modals.readSettingsImportFile({ size: 5 }, jest.fn())).toBe(false);
        expect(global.window.FileReader).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('ui_settings_import_file_invalid', { variant: 'error' });
    });

    it('focuses tag edit inputs with selector-unsafe ids without throwing', () => {
        const unsafeTagId = 'bad"] id';
        const state = { tagOrder: [unsafeTagId] };
        const tagsById = new Map([
            [unsafeTagId, { id: unsafeTagId, label: 'Unsafe Id', color: '#007AFF' }]
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({ state, tagsById });

        expect(() => modals.renderTagModal(null, { editingTagId: unsafeTagId })).not.toThrow();
        expect(shadowRoot.querySelector('#sp-edit-tag-bad_id')).toBeTruthy();
    });

    it('renders settings import/export UI and enables apply after a valid preview', () => {
        const previewImportConfig = jest.fn(() => ({
            ok: true,
            matchedSources: 2,
            totalSources: 3,
            groupCount: 1,
            tagCount: 4,
            diff: {
                source: {
                    enableCount: 1,
                    disableCount: 1,
                    unchangedCount: 1
                },
                folders: {
                    incomingCount: 1,
                    sameNameCount: 1,
                    removedCount: 0
                },
                tags: {
                    incomingCount: 4,
                    sameNameCount: 2,
                    removedCount: 1,
                    normalizedIdCount: 1
                },
                settings: {
                    changesCustomHeight: true,
                    changesSourceViewDisplayKind: true
                }
            },
            matchedSourceDetails: [
                { storedKey: 'source-1', resolvedKey: 'source-1', title: 'Matched Source' }
            ],
            unmatchedSourceDetails: [
                { storedKey: 'source-2', title: 'Missing Source' }
            ]
        }));
        const applyImportConfig = jest.fn(() => ({ ok: true }));
        const writeText = jest.fn(() => Promise.resolve());
        const getDiagnosticsText = jest.fn(() => '{"notebookId":"diagnostic-test","sourceCount":2}');
        global.window.navigator = { clipboard: { writeText } };
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'OPEN_WEB_STORE_FEEDBACK' && typeof cb === 'function') {
                cb({ success: true, url: 'https://chrome.google.com/webstore/detail/test-extension-id/reviews' });
            }
        });
        const renderSaveStatus = jest.fn();
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getExportConfigText: () => '{"format":"notebooklm-source-management-config"}',
            previewImportConfig,
            applyImportConfig,
            getDiagnosticsInfo: () => ({
                notebookId: 'diagnostic-test',
                sourceCount: 2,
                groupCount: 1,
                tagCount: 4,
                saveRevision: 6,
                savedAt: '2026-04-22T00:00:00.000Z',
                saveStatus: 'saved',
                lastSaveError: '',
                storageUsageBytes: 8 * 1024 * 1024,
                storageQuotaBytes: 10 * 1024 * 1024,
                storageUsageRatio: 0.8,
                storageWarning: true,
                lastStorageError: 'storage_quota_exceeded',
                lastStaleLocalRevision: 4,
                lastStaleRemoteRevision: 7,
                lastStaleDetectedAt: '2026-04-22T00:02:00.000Z',
                historyEntryCount: 3,
                recoveryAvailable: true,
                importBackupAvailable: true,
                lastNativeActionFailure: { reason: 'menu_item_missing' },
                nativeActionFailureHistory: [
                    { reason: 'menu_item_missing' },
                    { reason: 'confirm_dialog_missing' }
                ]
            }),
            getDiagnosticsText,
            renderSaveStatus
        });

        expect(modals.renderSettingsModal({ importText: '{"data":{}}' })).toBe(true);

        const modal = shadowRoot.getElementById('sp-settings-modal');
        expect(modal).toBeTruthy();
        const settingsContent = shadowRoot.querySelector('.sp-settings-modal-content');
        expect(settingsContent.children[0].classList.contains('sp-settings-backup-section')).toBe(true);
        expect(shadowRoot.querySelector('.sp-settings-export-textarea').value).toContain('notebooklm-source-management-config');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_preview_summary:2,3,1,4');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_preview_matched:1');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('Matched Source');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_preview_unmatched:1');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('Missing Source');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_preview_replace_warning');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_diff_sources');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_diff_source_state:1,1,1');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_diff_folders:1,1,0');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_diff_tags:4,2,1,1');
        expect(shadowRoot.querySelector('.sp-settings-import-preview').textContent).toContain('ui_settings_import_diff_settings_changed');
        expect(shadowRoot.querySelector('.sp-settings-apply-import-btn').disabled).toBe(false);
        expect(shadowRoot.querySelector('.sp-settings-download-export-btn')).toBeTruthy();
        expect(shadowRoot.querySelector('.sp-settings-choose-import-btn')).toBeTruthy();
        const backupSection = shadowRoot.querySelector('.sp-settings-backup-section');
        const backupToggle = backupSection.querySelector('.sp-settings-collapsible-toggle');
        const backupBody = backupSection.querySelector('.sp-settings-collapsible-body');
        expect(backupSection.classList.contains('is-expanded')).toBe(true);
        expect(backupToggle.textContent).toContain('ui_settings_backup_restore_title');
        expect(backupToggle.getAttribute('aria-expanded')).toBe('true');
        expect(backupBody.getAttribute('aria-hidden')).toBe('false');
        expect(backupBody.inert).toBe(false);
        expect(shadowRoot.querySelector('.sp-settings-export-section .sp-settings-subsection-title').textContent).toContain('ui_settings_export_title');
        expect(shadowRoot.querySelector('.sp-settings-import-section .sp-settings-subsection-title').textContent).toContain('ui_settings_import_title');
        expect(shadowRoot.querySelector('.sp-settings-source-repair-section')).toBeFalsy();
        expect(shadowRoot.querySelector('.sp-settings-source-repair-inline')).toBeTruthy();
        expect(shadowRoot.querySelector('.sp-settings-source-repair-inline .sp-source-repair-empty').textContent).toContain('ui_source_repair_healthy');
        expect(shadowRoot.querySelector('.sp-settings-history-section')).toBeTruthy();
        expect(shadowRoot.querySelector('.sp-history-empty').textContent).toContain('ui_history_empty');
        expect(shadowRoot.querySelector('.sp-settings-save-status-header')).toBeTruthy();
        expect(shadowRoot.getElementById('sp-settings-save-status')).toBeTruthy();
        expect(renderSaveStatus).toHaveBeenCalled();
        const helpSection = shadowRoot.querySelector('.sp-settings-help-section');
        expect(helpSection).toBeTruthy();
        expect(helpSection.textContent).toContain('ui_settings_help_feedback_title');
        expect(helpSection.textContent).toContain('ui_settings_feedback_body');
        expect(helpSection.querySelector('.sp-settings-feedback-body')).toBeTruthy();
        expect(shadowRoot.querySelector('.sp-settings-open-web-store-feedback-btn')).toBeTruthy();
        const diagnosticsSection = shadowRoot.querySelector('.sp-settings-diagnostics-section');
        const helpToggle = helpSection.querySelector('.sp-settings-collapsible-toggle');
        const helpBody = helpSection.querySelector('.sp-settings-collapsible-body');
        const diagnosticsCopyButton = shadowRoot.querySelector('.sp-settings-copy-diagnostics-btn');
        expect(diagnosticsSection).toBeTruthy();
        expect(helpToggle).toBeTruthy();
        expect(helpBody).toBeTruthy();
        expect(helpSection.classList.contains('is-collapsed')).toBe(true);
        expect(helpToggle.getAttribute('aria-expanded')).toBe('false');
        expect(helpBody.getAttribute('aria-hidden')).toBe('true');
        expect(helpBody.inert).toBe(true);
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_notebook_id');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('diagnostic-test');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_import_backup');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_storage_usage');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('8.0 MB / 10 MB (80%)');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_storage_warning');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_last_storage_error');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('storage_quota_exceeded');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_stale_local_revision');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_stale_remote_revision');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_stale_detected_at');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('2026-04-22T00:02:00.000Z');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_history_entries');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('ui_diagnostics_native_failure_history');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('menu_item_missing');
        expect(shadowRoot.querySelector('.sp-settings-diagnostics-grid').textContent).toContain('(+1)');
        expect(diagnosticsCopyButton).toBeTruthy();

        helpToggle.dispatchEvent({ type: 'click' });
        expect(helpSection.classList.contains('is-expanded')).toBe(true);
        expect(helpToggle.getAttribute('aria-expanded')).toBe('true');
        expect(helpBody.getAttribute('aria-hidden')).toBe('false');
        expect(helpBody.inert).toBe(false);

        shadowRoot.querySelector('.sp-settings-apply-import-btn').dispatchEvent({ type: 'click' });
        expect(applyImportConfig).toHaveBeenCalledWith('{"data":{}}');

        diagnosticsCopyButton.dispatchEvent({ type: 'click' });
        expect(getDiagnosticsText).toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith('{"notebookId":"diagnostic-test","sourceCount":2}');

        shadowRoot.querySelector('.sp-settings-open-web-store-feedback-btn').dispatchEvent({ type: 'click' });
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'OPEN_WEB_STORE_FEEDBACK' },
            expect.any(Function)
        );
    });

    it('renders a keyboard-driven command palette and executes the focused command', () => {
        const executeCommandPaletteCommand = jest.fn(() => true);
        const getCommandPaletteCommands = jest.fn((query) => [
            {
                id: 'search',
                title: query ? `Search ${query}` : 'Search sources',
                subtitle: 'Search source titles',
                keywords: ['search', 'source'],
                action: 'search-sources',
                payload: { query }
            },
            {
                id: 'quick-recent',
                title: 'Recent',
                subtitle: 'Show recent sources',
                keywords: ['recent'],
                action: 'quick-view',
                payload: { kind: 'recent' }
            }
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getCommandPaletteCommands,
            executeCommandPaletteCommand
        });

        expect(modals.renderCommandPaletteModal()).toBe(true);

        const modal = shadowRoot.getElementById('sp-command-palette-modal');
        const input = shadowRoot.querySelector('.sp-command-palette-input');
        expect(modal).toBeTruthy();
        expect(input).toBeTruthy();
        expect(shadowRoot.querySelectorAll('.sp-command-palette-item')).toHaveLength(2);

        input.value = 'ai';
        input.dispatchEvent({ type: 'input', target: input });
        expect(getCommandPaletteCommands).toHaveBeenLastCalledWith('ai');
        expect(shadowRoot.querySelector('.sp-command-palette-list').textContent).toContain('Search ai');

        input.dispatchEvent({
            type: 'keydown',
            key: 'ArrowDown',
            preventDefault: jest.fn()
        });
        input.dispatchEvent({
            type: 'keydown',
            key: 'Enter',
            preventDefault: jest.fn()
        });

        expect(executeCommandPaletteCommand).toHaveBeenCalledWith('quick-view', expect.objectContaining({
            id: 'quick-recent',
            payload: { kind: 'recent' }
        }));
        expect(shadowRoot.getElementById('sp-command-palette-modal')).toBeNull();
    });

    it('opens the command palette from settings instead of the main toolbar', () => {
        const getCommandPaletteCommands = jest.fn(() => [
            {
                id: 'quick-all',
                title: 'All',
                subtitle: 'Switch quick view',
                action: 'quick-view',
                payload: { kind: null }
            }
        ]);
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getCommandPaletteCommands
        });

        expect(modals.renderSettingsModal()).toBe(true);

        const commandPaletteButton = shadowRoot.querySelector('.sp-settings-open-command-palette-btn');
        expect(commandPaletteButton).toBeTruthy();
        expect(commandPaletteButton.textContent).toContain('ui_settings_open_command_palette');

        commandPaletteButton.dispatchEvent({ type: 'click' });

        expect(shadowRoot.getElementById('sp-settings-modal')).toBeNull();
        expect(shadowRoot.getElementById('sp-command-palette-modal')).toBeTruthy();
        expect(getCommandPaletteCommands).toHaveBeenCalledWith('');
    });

    it('opens quick view button management from settings and saves hidden buttons', async () => {
        let visibleQuickViewKinds = ['all', 'recent'];
        const setVisibleQuickViewKinds = jest.fn((nextKinds) => {
            visibleQuickViewKinds = nextKinds;
            return Promise.resolve(nextKinds);
        });
        const render = jest.fn();
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getVisibleQuickViewKinds: () => visibleQuickViewKinds,
            setVisibleQuickViewKinds,
            render
        });

        expect(modals.renderSettingsModal()).toBe(true);

        const manageButton = shadowRoot.querySelector('.sp-settings-manage-quick-view-buttons-btn');
        expect(manageButton).toBeTruthy();
        expect(manageButton.textContent).toContain('ui_settings_manage_quick_view_buttons');

        manageButton.dispatchEvent({ type: 'click' });

        expect(shadowRoot.getElementById('sp-settings-modal')).toBeNull();
        expect(shadowRoot.getElementById('sp-quick-view-buttons-modal')).toBeTruthy();
        const checkboxes = shadowRoot.querySelectorAll('.sp-quick-view-visibility-checkbox');
        expect(checkboxes.map((checkbox) => checkbox.dataset.quickViewKind)).toEqual([
            'all',
            'ungrouped',
            'disabled',
            'tag',
            'recent',
            'issues'
        ]);
        expect(checkboxes.find((checkbox) => checkbox.dataset.quickViewKind === 'all').checked).toBe(true);
        expect(checkboxes.find((checkbox) => checkbox.dataset.quickViewKind === 'ungrouped').checked).toBe(false);

        const recentCheckbox = checkboxes.find((checkbox) => checkbox.dataset.quickViewKind === 'recent');
        recentCheckbox.checked = false;
        recentCheckbox.dispatchEvent({ type: 'change', target: recentCheckbox });
        await Promise.resolve();

        expect(setVisibleQuickViewKinds).toHaveBeenCalledWith(['all']);
        expect(render).toHaveBeenCalled();

        const allCheckbox = shadowRoot.querySelectorAll('.sp-quick-view-visibility-checkbox')
            .find((checkbox) => checkbox.dataset.quickViewKind === 'all');
        allCheckbox.checked = false;
        allCheckbox.dispatchEvent({ type: 'change', target: allCheckbox });
        await Promise.resolve();

        expect(setVisibleQuickViewKinds).toHaveBeenLastCalledWith([]);
    });

    it('lets users assign a shortcut from each command row without executing the command', async () => {
        const executeCommandPaletteCommand = jest.fn(() => true);
        let storedShortcut = '';
        const setCommandShortcut = jest.fn((commandId, shortcut) => {
            storedShortcut = shortcut;
            return Promise.resolve(shortcut);
        });
        const getCommandShortcutComboFromEvent = jest.fn(() => 'Meta+Shift+R');
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getCommandPaletteCommands: jest.fn(() => [
                {
                    id: 'quick-view-recent',
                    title: 'Recent',
                    subtitle: 'Show recent sources',
                    action: 'quick-view',
                    payload: { kind: 'recent' }
                }
            ]),
            executeCommandPaletteCommand,
            getCommandShortcut: jest.fn(() => storedShortcut),
            setCommandShortcut,
            getCommandShortcutComboFromEvent,
            formatCommandShortcut: (shortcut) => shortcut.replace(/\+/g, ' ')
        });

        expect(modals.renderCommandPaletteModal()).toBe(true);

        const shortcutButton = shadowRoot.querySelector('.sp-command-shortcut-btn');
        expect(shortcutButton).toBeTruthy();
        expect(shortcutButton.textContent).toContain('ui_command_shortcut_set');

        shortcutButton.dispatchEvent({
            type: 'click',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });
        expect(executeCommandPaletteCommand).not.toHaveBeenCalled();

        const modal = shadowRoot.getElementById('sp-command-palette-modal');
        modal.dispatchEvent({
            type: 'keydown',
            key: 'r',
            metaKey: true,
            shiftKey: true,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });
        await Promise.resolve();

        expect(getCommandShortcutComboFromEvent).toHaveBeenCalled();
        expect(setCommandShortcut).toHaveBeenCalledWith('quick-view-recent', 'Meta+Shift+R');
        expect(shadowRoot.querySelector('.sp-command-shortcut-btn').textContent).toContain('Meta Shift R');
    });

    it('renders source repair and history actions in settings', async () => {
        const applySourceRepairRemaps = jest.fn(() => Promise.resolve(true));
        const restoreStateHistoryEntry = jest.fn(() => Promise.resolve(true));
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getSourceRepairReport: () => ({
                totalSources: 2,
                matchedSources: 1,
                unmatchedSources: 1,
                ambiguousSources: 0,
                matched: [],
                unmatched: [{ storedKey: 'old-source', title: 'Old Source', reason: 'unresolved' }],
                ambiguous: []
            }),
            getSourceRepairOptions: () => [
                { key: 'current-source', title: 'Current Source' }
            ],
            applySourceRepairRemaps,
            getStateHistoryEntries: () => [{
                id: 'history-1',
                createdAt: '2026-04-22T00:00:00.000Z',
                reason: 'save',
                sourceCount: 2,
                groupCount: 1,
                tagCount: 0,
                saveRevision: 3,
                snapshot: { groups: ['group1'] }
            }],
            restoreStateHistoryEntry
        });

        expect(modals.renderSettingsModal()).toBe(true);

        const repairSelect = shadowRoot.querySelector('.sp-source-repair-select');
        const repairButton = shadowRoot.querySelector('.sp-source-repair-apply-btn');
        expect(repairSelect).toBeTruthy();
        expect(repairButton.disabled).toBe(true);

        repairSelect.value = 'current-source';
        repairSelect.dispatchEvent({ type: 'change' });
        expect(repairButton.disabled).toBe(false);

        repairButton.dispatchEvent({ type: 'click' });
        await Promise.resolve();
        expect(applySourceRepairRemaps).toHaveBeenCalledWith({
            'old-source': 'current-source'
        });

        shadowRoot.querySelector('.sp-history-restore-btn').dispatchEvent({ type: 'click' });
        await Promise.resolve();
        expect(restoreStateHistoryEntry).toHaveBeenCalledWith('history-1');
    });

    it('hides developer controls behind a password-protected settings entry', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        global.window.navigator = { clipboard: { writeText } };
        global.window.prompt = jest.fn(() => 'wrong-password');
        const setDeveloperModeEnabled = jest.fn(() => Promise.resolve(true));
        const getDeveloperLogExportText = jest.fn(() => '{"developerModeEnabled":true,"logs":[]}');
        const clearDeveloperLogs = jest.fn(() => Promise.resolve(true));
        const showToast = jest.fn();
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getDeveloperModeEnabled: () => false,
            setDeveloperModeEnabled,
            getDeveloperLogExportText,
            clearDeveloperLogs,
            showToast
        });

        expect(modals.renderSettingsModal()).toBe(true);

        expect(shadowRoot.querySelector('.sp-settings-developer-section')).toBeFalsy();
        expect(shadowRoot.querySelector('.sp-settings-apply-import-btn')).toBeFalsy();
        const unlockButton = shadowRoot.querySelector('.sp-settings-developer-unlock-btn');
        expect(unlockButton).toBeTruthy();
        expect(unlockButton.textContent).toContain('ui_settings_developer_features');

        unlockButton.dispatchEvent({ type: 'click' });
        expect(global.window.prompt).toHaveBeenCalledWith('ui_settings_developer_password_prompt');
        expect(shadowRoot.querySelector('.sp-settings-developer-section')).toBeFalsy();
        expect(showToast).toHaveBeenCalledWith('ui_settings_developer_password_failed', { variant: 'error' });

        global.window.prompt.mockReturnValue('developer_mode');
        unlockButton.dispatchEvent({ type: 'click' });

        const developerSection = shadowRoot.querySelector('.sp-settings-developer-section');
        expect(developerSection).toBeTruthy();
        expect(developerSection.textContent).toContain('ui_settings_developer_features');
        expect(developerSection.textContent).toContain('ui_settings_developer_mode_body');
        expect(shadowRoot.querySelector('.sp-settings-developer-unlock-btn')).toBeFalsy();

        const toggle = shadowRoot.querySelector('.sp-settings-developer-mode-toggle');
        expect(toggle).toBeTruthy();
        expect(toggle.checked).toBe(false);

        toggle.checked = true;
        toggle.dispatchEvent({ type: 'change' });
        expect(setDeveloperModeEnabled).toHaveBeenCalledWith(true);

        shadowRoot.querySelector('.sp-settings-copy-developer-logs-btn').dispatchEvent({ type: 'click' });
        expect(getDeveloperLogExportText).toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith('{"developerModeEnabled":true,"logs":[]}');

        shadowRoot.querySelector('.sp-settings-clear-developer-logs-btn').dispatchEvent({ type: 'click' });
        await Promise.resolve();
        expect(clearDeveloperLogs).toHaveBeenCalled();

        const testWelcomeButton = shadowRoot.querySelector('.sp-settings-test-welcome-btn');
        expect(testWelcomeButton).toBeTruthy();
        expect(developerSection.textContent).toContain('ui_settings_test_welcome_modal');

        testWelcomeButton.dispatchEvent({ type: 'click' });
        expect(shadowRoot.getElementById('sp-settings-modal')).toBeFalsy();
        expect(shadowRoot.getElementById('sp-welcome-modal')).toBeTruthy();
    });

    it('keeps developer controls unlocked when developer mode is already enabled', () => {
        global.window.prompt = jest.fn();
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getDeveloperModeEnabled: () => true
        });

        expect(modals.renderSettingsModal()).toBe(true);

        const developerSection = shadowRoot.querySelector('.sp-settings-developer-section');
        expect(developerSection).toBeTruthy();
        expect(developerSection.textContent).toContain('ui_settings_developer_features');
        expect(shadowRoot.querySelector('.sp-settings-developer-unlock-btn')).toBeFalsy();
        expect(global.window.prompt).not.toHaveBeenCalled();

        const toggle = shadowRoot.querySelector('.sp-settings-developer-mode-toggle');
        expect(toggle).toBeTruthy();
        expect(toggle.checked).toBe(true);
    });

    it('shows a localized toast when Chrome Web Store feedback cannot open', () => {
        const showToast = jest.fn();
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'OPEN_WEB_STORE_FEEDBACK' && typeof cb === 'function') {
                cb({ success: false, errorCode: 'tab_create_failed' });
            }
        });
        const { modals, shadowRoot } = createModalMotionTestRuntime({ showToast });

        expect(modals.renderSettingsModal()).toBe(true);
        shadowRoot.querySelector('.sp-settings-open-web-store-feedback-btn').dispatchEvent({ type: 'click' });

        expect(showToast).toHaveBeenCalledWith('ui_settings_feedback_open_failed', { variant: 'error' });
    });

    it('renders the welcome onboarding modal with accessible close and feedback actions', () => {
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'OPEN_WEB_STORE_FEEDBACK' && typeof cb === 'function') {
                cb({ success: true });
            }
        });
        const markWelcomeOnboardingSeen = jest.fn(() => Promise.resolve(true));
        const { modals, shadowRoot } = createModalMotionTestRuntime({ markWelcomeOnboardingSeen });

        expect(modals.renderWelcomeModal()).toBe(true);

        const modal = shadowRoot.getElementById('sp-welcome-modal');
        expect(modal).toBeTruthy();
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
        expect(modal.getAttribute('aria-labelledby')).toBe('sp-welcome-modal-title');
        expect(modal.textContent).toContain('ui_welcome_title');
        expect(modal.textContent).toContain('ui_welcome_feature_organize_title');
        expect(modal.textContent).toContain('ui_welcome_feature_find_title');
        expect(modal.textContent).toContain('ui_welcome_feature_backup_title');
        expect(modal.querySelector('.sp-welcome-feedback-strip')).toBeFalsy();
        const feedbackInline = modal.querySelector('.sp-welcome-feedback-inline');
        expect(feedbackInline).toBeTruthy();
        expect(feedbackInline.textContent).toContain('ui_welcome_feedback_body');
        const feedbackLink = modal.querySelector('.sp-welcome-feedback-link');
        expect(feedbackLink).toBeTruthy();
        expect(feedbackLink.className).not.toContain('sp-button');
        expect(feedbackLink.textContent).toContain('ui_welcome_feedback');

        const closeButton = shadowRoot.querySelector('.sp-welcome-close-btn');
        expect(closeButton).toBeTruthy();
        expect(closeButton.getAttribute('aria-label')).toBe('ui_welcome_close');

        shadowRoot.querySelector('.sp-welcome-primary-btn').dispatchEvent({ type: 'click' });
        expect(markWelcomeOnboardingSeen).toHaveBeenCalledTimes(1);
    });

    it('marks welcome onboarding as seen before opening feedback', () => {
        const markWelcomeOnboardingSeen = jest.fn(() => Promise.resolve(true));
        global.chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message?.type === 'OPEN_WEB_STORE_FEEDBACK' && typeof cb === 'function') {
                cb({ success: true });
            }
        });
        const { modals, shadowRoot } = createModalMotionTestRuntime({ markWelcomeOnboardingSeen });

        expect(modals.renderWelcomeModal()).toBe(true);
        shadowRoot.querySelector('.sp-welcome-feedback-link').dispatchEvent({ type: 'click' });

        expect(markWelcomeOnboardingSeen).toHaveBeenCalledTimes(1);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'OPEN_WEB_STORE_FEEDBACK' },
            expect.any(Function)
        );
    });

    it('renders the whats new modal and can preview it without marking it seen', () => {
        const markWhatsNewSeen = jest.fn(() => Promise.resolve(true));
        const { modals, shadowRoot } = createModalMotionTestRuntime({ markWhatsNewSeen });

        expect(modals.renderWhatsNewModal({ markSeenOnClose: false })).toBe(true);

        const modal = shadowRoot.getElementById('sp-whats-new-modal');
        expect(modal).toBeTruthy();
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
        expect(modal.getAttribute('aria-labelledby')).toBe('sp-whats-new-modal-title');
        expect(modal.textContent).toContain('ui_whats_new_title');
        expect(modal.textContent).toContain('ui_whats_new_quick_views_title');
        expect(modal.textContent).toContain('ui_whats_new_restore_points_title');
        expect(modal.textContent).toContain('ui_whats_new_language_title');

        shadowRoot.querySelector('.sp-whats-new-primary-btn').dispatchEvent({ type: 'click' });
        expect(markWhatsNewSeen).not.toHaveBeenCalled();
    });

    it('renders and saves history retention, restore point, and language preferences in settings', async () => {
        const setHistoryRetentionLimit = jest.fn(() => Promise.resolve(50));
        const createManualRestorePoint = jest.fn(() => Promise.resolve(true));
        const setLanguageOverride = jest.fn(() => Promise.resolve('zh_CN'));
        const { modals, shadowRoot } = createModalMotionTestRuntime({
            getStateHistoryEntries: () => [],
            getHistoryRetentionLimit: () => 20,
            setHistoryRetentionLimit,
            createManualRestorePoint,
            getLanguageOverride: () => 'auto',
            setLanguageOverride
        });
        global.window.prompt = jest.fn(() => 'Before import');

        expect(modals.renderSettingsModal()).toBe(true);

        const retentionSelect = shadowRoot.querySelector('.sp-history-retention-select');
        retentionSelect.value = '50';
        retentionSelect.dispatchEvent({ type: 'change', target: retentionSelect });
        await Promise.resolve();
        expect(setHistoryRetentionLimit).toHaveBeenCalledWith(50);

        shadowRoot.querySelector('.sp-history-create-restore-point-btn').dispatchEvent({ type: 'click' });
        await Promise.resolve();
        expect(createManualRestorePoint).toHaveBeenCalledWith('Before import');

        const languageSelect = shadowRoot.querySelector('.sp-settings-language-select');
        languageSelect.value = 'zh_CN';
        languageSelect.dispatchEvent({ type: 'change', target: languageSelect });
        await Promise.resolve();
        expect(setLanguageOverride).toHaveBeenCalledWith('zh_CN');
    });

    it('uses the undoable toast hook for batch tag success messages', () => {
        const state = { isBatchMode: true };
        const tagsById = new Map([['beta', { id: 'beta', label: 'Beta' }]]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1' }]
        ]);
        const pendingBatchKeys = new Set(['source-1']);
        const currentTags = new Map([['source-1', []]]);
        const showToast = jest.fn();
        const showUndoableToast = jest.fn();
        const { modals } = createModalMotionTestRuntime({
            state,
            tagsById,
            sourcesByKey,
            pendingBatchKeys,
            getSourceTagIds: (sourceKey) => currentTags.get(sourceKey) || [],
            setSourceTagIds: (sourceKey, tagIds) => currentTags.set(sourceKey, tagIds),
            showToast,
            showUndoableToast
        });

        expect(modals.executeBatchTagUpdate('add', pendingBatchKeys, ['beta'])).toBe(true);
        expect(showToast).not.toHaveBeenCalled();
        expect(showUndoableToast).toHaveBeenCalledWith('ui_batch_tags_added_toast:1', { variant: 'success' });
    });
});

describe('modal keyboard helpers', () => {
    let mod;

    const createKeyboardModal = (focusableElements = []) => {
        const root = { activeElement: null };
        const modal = {
            focus: jest.fn(() => {
                root.activeElement = modal;
            }),
            querySelectorAll: jest.fn(() => focusableElements),
            setAttribute: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            getRootNode: jest.fn(() => root)
        };
        focusableElements.forEach((element) => {
            element.focus = jest.fn(() => {
                root.activeElement = element;
            });
            element.getAttribute = element.getAttribute || jest.fn(() => null);
            element.getRootNode = jest.fn(() => root);
            element.disabled = Boolean(element.disabled);
        });
        return { modal, root };
    };

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('focuses the preferred move folder option when one exists', () => {
        const folderButton = {};
        const cancelButton = {};
        const { modal } = createKeyboardModal([folderButton, cancelButton]);

        expect(mod._focusModalInitialElementForTest(modal, folderButton)).toBe(folderButton);
        expect(folderButton.focus).toHaveBeenCalledTimes(1);
        expect(cancelButton.focus).not.toHaveBeenCalled();
    });

    it('focuses the cancel button when a move folder modal has no folder option', () => {
        const cancelButton = {};
        const { modal } = createKeyboardModal([cancelButton]);

        expect(mod._focusModalInitialElementForTest(modal, cancelButton)).toBe(cancelButton);
        expect(cancelButton.focus).toHaveBeenCalledTimes(1);
    });

    it('closes a modal on Escape', () => {
        const closeModal = jest.fn();
        const { modal } = createKeyboardModal([]);
        const event = {
            key: 'Escape',
            preventDefault: jest.fn()
        };

        expect(mod._handleModalKeyboardEventForTest(event, modal, closeModal)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(closeModal).toHaveBeenCalledTimes(1);
    });

    it('cycles focus from the last element to the first on Tab', () => {
        const firstInput = {};
        const lastButton = {};
        const { modal, root } = createKeyboardModal([firstInput, lastButton]);
        root.activeElement = lastButton;
        const event = {
            key: 'Tab',
            shiftKey: false,
            preventDefault: jest.fn()
        };

        expect(mod._handleModalKeyboardEventForTest(event, modal, jest.fn())).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(firstInput.focus).toHaveBeenCalledTimes(1);
    });

    it('cycles focus from the first element to the last on Shift+Tab', () => {
        const firstInput = {};
        const lastButton = {};
        const { modal, root } = createKeyboardModal([firstInput, lastButton]);
        root.activeElement = firstInput;
        const event = {
            key: 'Tab',
            shiftKey: true,
            preventDefault: jest.fn()
        };

        expect(mod._handleModalKeyboardEventForTest(event, modal, jest.fn())).toBe(true);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(lastButton.focus).toHaveBeenCalledTimes(1);
    });

    it('focuses create and edit tag inputs through the same initial focus helper', () => {
        const createInput = {};
        const editInput = {};
        const { modal: createModal } = createKeyboardModal([createInput]);
        const { modal: editModal } = createKeyboardModal([editInput]);

        expect(mod._focusModalInitialElementForTest(createModal, createInput)).toBe(createInput);
        expect(mod._focusModalInitialElementForTest(editModal, editInput)).toBe(editInput);
        expect(createInput.focus).toHaveBeenCalledTimes(1);
        expect(editInput.focus).toHaveBeenCalledTimes(1);
    });

    it('does not intercept Enter used by tag editors', () => {
        const input = {};
        const { modal } = createKeyboardModal([input]);
        const event = {
            key: 'Enter',
            preventDefault: jest.fn()
        };

        expect(mod._handleModalKeyboardEventForTest(event, modal, jest.fn())).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('binds modal keyboard handling to the modal element itself', () => {
        const input = {};
        const { modal } = createKeyboardModal([input]);
        const closeModal = jest.fn();

        const binding = mod._bindModalKeyboardNavigationForTest(modal, {
            closeModal,
            initialFocusTarget: input
        });

        expect(modal.setAttribute).toHaveBeenCalledWith('role', 'dialog');
        expect(modal.setAttribute).toHaveBeenCalledWith('aria-modal', 'true');
        expect(modal.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
        expect(modal.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        binding.focusInitial();
        expect(input.focus).toHaveBeenCalledTimes(1);

        const keydownHandler = modal.addEventListener.mock.calls[0][1];
        keydownHandler({ key: 'Escape', preventDefault: jest.fn() });
        expect(closeModal).toHaveBeenCalledTimes(1);
        binding.dispose();
        expect(modal.removeEventListener).toHaveBeenCalledWith('keydown', keydownHandler);
    });

    it('removes an existing modal immediately before rerendering', () => {
        const parentNode = { removeChild: jest.fn() };
        const modal = {
            parentNode,
            classList: {
                remove: jest.fn(),
                add: jest.fn()
            }
        };
        const backdrop = {
            parentNode,
            classList: {
                remove: jest.fn(),
                add: jest.fn()
            }
        };
        mod._setShadowRootForTest({
            host: { isConnected: true },
            activeElement: null,
            getElementById: jest.fn((id) => {
                if (id === 'sp-tag-modal') return modal;
                if (id === 'sp-tag-backdrop') return backdrop;
                return null;
            }),
            querySelectorAll: jest.fn(() => [])
        });

        mod._prepareModalOpenForTest('sp-tag-modal', 'sp-tag-backdrop');

        expect(parentNode.removeChild).toHaveBeenCalledWith(backdrop);
        expect(parentNode.removeChild).toHaveBeenCalledWith(modal);
        expect(modal.classList.add).not.toHaveBeenCalledWith('closing');
    });

    it('restores focus after a normal animated modal close', () => {
        const parentNode = { removeChild: jest.fn() };
        const opener = {
            isConnected: true,
            focus: jest.fn(),
            closest: jest.fn(() => null)
        };
        const modal = {
            parentNode,
            classList: {
                remove: jest.fn(),
                add: jest.fn()
            }
        };
        const backdrop = {
            parentNode,
            classList: {
                remove: jest.fn(),
                add: jest.fn()
            }
        };
        global.setTimeout = jest.fn((cb) => {
            cb();
            return 1;
        });
        global.document.activeElement = opener;
        mod._setShadowRootForTest({
            host: { isConnected: true },
            activeElement: null,
            getElementById: jest.fn((id) => {
                if (id === 'sp-move-modal') return modal;
                if (id === 'sp-move-backdrop') return backdrop;
                return null;
            }),
            querySelectorAll: jest.fn(() => [])
        });

        mod._rememberModalFocusRestoreTargetForTest('sp-move-modal');
        mod._closeManagedModalForTest('sp-move-modal', 'sp-move-backdrop');

        expect(modal.classList.remove).toHaveBeenCalledWith('visible');
        expect(modal.classList.add).toHaveBeenCalledWith('closing');
        expect(parentNode.removeChild).toHaveBeenCalledWith(backdrop);
        expect(parentNode.removeChild).toHaveBeenCalledWith(modal);
        expect(opener.focus).toHaveBeenCalledTimes(1);
    });

    it('declares dialog titles through aria-labelledby', () => {
        const moveSource = fs.readFileSync(path.join(__dirname, '../../src/content/content-modal-move.js'), 'utf8');
        const tagSource = fs.readFileSync(path.join(__dirname, '../../src/content/content-modal-tag.js'), 'utf8');

        expect(moveSource).toContain("'aria-labelledby': 'sp-move-modal-title'");
        expect(moveSource).toContain("id: 'sp-move-modal-title'");
        expect(tagSource).toContain("'aria-labelledby': 'sp-tag-modal-title'");
        expect(tagSource).toContain("id: 'sp-tag-modal-title'");
    });
});

describe('tag persistence and filtering', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = (cb) => {
            cb();
            return 1;
        };
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('persists multiple tags for a single source', () => {
        mod.sourcesByKey.set('source1', {
            key: 'source1',
            title: 'Source 1',
            normalizedTitle: 'source 1',
            fingerprint: 'source 1||article',
            identityType: 'stable-token',
            enabled: true
        });
        mod.state.ungrouped = ['source1'];

        const researchTagId = mod.createTag('Research', { color: 'ff9500' });
        const priorityTagId = mod.createTag('Priority');
        mod.setSourceTagIds('source1', [researchTagId, priorityTagId]);

        expect(mod.buildPersistableState()).toMatchObject({
            schemaVersion: 4,
            tagOrder: [researchTagId, priorityTagId],
            sourceTagsById: {
                source1: [researchTagId, priorityTagId]
            },
            tagsById: {
                [researchTagId]: { id: researchTagId, label: 'Research', color: '#FF9500' },
                [priorityTagId]: { id: priorityTagId, label: 'Priority' }
            }
        });
    });

    it('normalizes custom tag colors to uppercase six-digit hex', () => {
        expect(mod.normalizeTagColor('34c759')).toBe('#34C759');
        expect(mod.normalizeTagColor('#007aff')).toBe('#007AFF');
        expect(mod.normalizeTagColor('#ABC')).toBe(null);
        expect(mod.normalizeTagColor('not-a-color')).toBe(null);
    });

    it('uses the shared content config for tag color presets', () => {
        expect(mod.getTagColorPresets()).toEqual(globalThis.NSM_CONTENT_CONFIG.TAG_COLOR_PRESETS);
        expect(mod._getModalTagColorPresetsForTest()).toEqual(globalThis.NSM_CONTENT_CONFIG.TAG_COLOR_PRESETS);
        expect(mod.getTagColorPresets()).not.toBe(globalThis.NSM_CONTENT_CONFIG.TAG_COLOR_PRESETS);
    });

    it('normalizes v2 state into v3-compatible empty tag structures', () => {
        expect(mod.normalizeLoadedState({
            schemaVersion: 2,
            groups: ['group1'],
            groupsById: { group1: { id: 'group1', title: 'Group', children: [] } },
            ungrouped: []
        })).toEqual({
            schemaVersion: 2,
            groups: ['group1'],
            groupsById: { group1: { id: 'group1', title: 'Group', children: [] } },
            ungrouped: [],
            sourceStateById: {},
            customHeight: null,
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        });
    });

    it('migrates persisted tag assignments from legacy source keys to v3 ids', () => {
        const taggedRow = createMockSourceRow({ title: 'Tagged Source', ariaLabel: 'Tagged Source', stableToken: 'doc-tagged', checked: true });
        const descriptor = mod.createSourceDescriptor(taggedRow.row, new Map(), new Map());
        const tagId = 'tag_research';

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [taggedRow.row] : []
        ));

        mod.scanAndSyncSources({
            schemaVersion: 3,
            groups: [],
            groupsById: {},
            ungrouped: [descriptor.legacyKey],
            sourceStateById: {
                [descriptor.legacyKey]: {
                    enabled: true,
                    title: 'Tagged Source',
                    normalizedTitle: 'tagged source',
                    fingerprint: descriptor.fingerprint,
                    identityType: descriptor.identityType
                }
            },
            tagsById: {
                [tagId]: { id: tagId, label: 'Research' }
            },
            tagOrder: [tagId],
            sourceTagsById: {
                [descriptor.legacyKey]: [tagId]
            }
        }, true);

        expect(mod.getSourceTagIds(descriptor.key)).toEqual([tagId]);
    });

    it('remaps imported selector-unsafe tag ids and keeps source assignments', () => {
        const taggedRow = createMockSourceRow({ title: 'Tagged Source', ariaLabel: 'Tagged Source', stableToken: 'doc-tagged', checked: true });
        const descriptor = mod.createSourceDescriptor(taggedRow.row, new Map(), new Map());
        const rawTagId = 'bad"] tag';

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [taggedRow.row] : []
        ));

        mod.scanAndSyncSources({
            schemaVersion: 3,
            groups: [],
            groupsById: {},
            ungrouped: [descriptor.legacyKey],
            sourceStateById: {
                [descriptor.legacyKey]: {
                    enabled: true,
                    title: 'Tagged Source',
                    normalizedTitle: 'tagged source',
                    fingerprint: descriptor.fingerprint,
                    identityType: descriptor.identityType
                }
            },
            tagsById: {
                [rawTagId]: { id: rawTagId, label: 'Unsafe' }
            },
            tagOrder: [rawTagId],
            sourceTagsById: {
                [descriptor.legacyKey]: [rawTagId]
            }
        }, true);

        const [safeTagId] = Array.from(mod.tagsById.keys());
        expect(safeTagId).toBe('bad_tag');
        expect(mod.tagsById.get(safeTagId)).toMatchObject({ id: safeTagId, label: 'Unsafe' });
        expect(mod.getSourceTagIds(descriptor.key)).toEqual([safeTagId]);
    });

    it('loads stored tag colors while tolerating legacy tags without color', () => {
        global.document.querySelectorAll = jest.fn(() => []);

        mod.scanAndSyncSources({
            schemaVersion: 3,
            groups: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {},
            tagsById: {
                tag_green: { id: 'tag_green', label: 'Green', color: '#34c759' },
                tag_legacy: { id: 'tag_legacy', label: 'Legacy' }
            },
            tagOrder: ['tag_green', 'tag_legacy'],
            sourceTagsById: {}
        }, true);

        expect(mod.tagsById.get('tag_green')).toMatchObject({
            id: 'tag_green',
            label: 'Green',
            color: '#34C759'
        });
        expect(mod.tagsById.get('tag_legacy')).toMatchObject({
            id: 'tag_legacy',
            label: 'Legacy',
            color: null
        });
    });

    it('combines active tag filtering with text search', () => {
        const alphaTagId = mod.createTag('Alpha');
        const betaTagId = mod.createTag('Beta');

        mod.sourcesByKey.set('source1', { key: 'source1', title: 'Alpha notes', lowercaseTitle: 'alpha notes', enabled: true });
        mod.sourcesByKey.set('source2', { key: 'source2', title: 'Alpha draft', lowercaseTitle: 'alpha draft', enabled: true });
        mod.sourcesByKey.set('source3', { key: 'source3', title: 'Beta summary', lowercaseTitle: 'beta summary', enabled: true });

        mod.setSourceTagIds('source1', [alphaTagId]);
        mod.setSourceTagIds('source2', [betaTagId]);
        mod.setSourceTagIds('source3', [alphaTagId]);
        mod.state.activeTagId = alphaTagId;
        mod.state.filterQuery = 'alpha';

        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source1'))).toBe(true);
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source2'))).toBe(false);
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source3'))).toBe(true);
    });

    it('searches tag names and folder names with scoped query syntax', () => {
        const paperTagId = mod.createTag('Paper');
        const draftTagId = mod.createTag('Draft');

        mod.sourcesByKey.set('source1', { key: 'source1', title: 'Notes', lowercaseTitle: 'notes', enabled: true });
        mod.sourcesByKey.set('source2', { key: 'source2', title: 'Notes', lowercaseTitle: 'notes', enabled: true });
        mod.sourcesByKey.set('source3', { key: 'source3', title: 'Appendix', lowercaseTitle: 'appendix', enabled: true });
        mod.setSourceTagIds('source1', [paperTagId]);
        mod.setSourceTagIds('source2', [draftTagId]);
        mod.groupsById.set('folder1', {
            id: 'folder1',
            title: 'Chapter One',
            enabled: true,
            children: [{ type: 'source', key: 'source3' }]
        });
        mod.parentMap.set('source3', 'folder1');

        mod.state.filterQuery = 'tag:paper';
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source1'))).toBe(true);
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source2'))).toBe(false);

        mod.state.filterQuery = 'folder:chapter';
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source3'))).toBe(true);
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source1'))).toBe(false);

        mod.state.filterQuery = 'paper';
        expect(mod.sourceMatchesCurrentFilters(mod.sourcesByKey.get('source1'))).toBe(true);
    });

    it('removes deleted tags from every source assignment', () => {
        const tagId = mod.createTag('Delete Me');
        mod.setSourceTagIds('source1', [tagId]);
        mod.setSourceTagIds('source2', [tagId]);

        mod.deleteTag(tagId);

        expect(mod.getSourceTagIds('source1')).toEqual([]);
        expect(mod.getSourceTagIds('source2')).toEqual([]);
        expect(mod.tagsById.has(tagId)).toBe(false);
    });

    it('preserves duplicate-name validation while allowing color-only edits', () => {
        const alphaTagId = mod.createTag('Alpha', { color: '#007AFF' });
        const betaTagId = mod.createTag('Beta');

        expect(mod.updateTag(betaTagId, { label: 'Alpha', color: '#FF9500' })).toBe(alphaTagId);
        expect(mod.tagsById.get(betaTagId)).toMatchObject({
            id: betaTagId,
            label: 'Beta',
            color: null
        });

        expect(mod.updateTag(betaTagId, { label: 'Beta', color: '#FF9500' })).toBe(betaTagId);
        expect(mod.tagsById.get(betaTagId)).toMatchObject({
            id: betaTagId,
            label: 'Beta',
            color: '#FF9500'
        });
    });

    it('preserves an existing tag color when a label-only update is applied', () => {
        const tagId = mod.createTag('Research', { color: '#34C759' });

        expect(mod.updateTag(tagId, { label: 'Reviewed' })).toBe(tagId);

        expect(mod.tagsById.get(tagId)).toMatchObject({
            id: tagId,
            label: 'Reviewed',
            color: '#34C759'
        });
    });

    it('initializes a missing tag order before creating or sorting tags', () => {
        delete mod.state.tagOrder;

        const tagId = mod.createTag('Inbox');

        expect(mod.state.tagOrder).toEqual([tagId]);
        expect(mod.getSourceTagIds('source-1')).toEqual([]);
        mod.setSourceTagIds('source-1', [tagId]);
        expect(mod.getSourceTagIds('source-1')).toEqual([tagId]);
    });

    it('generates style variables only for colored tags', () => {
        expect(mod.getTagStyleVars({ color: '#007AFF' }, true)).toContain('--sp-tag-active-text:#007AFF');
        expect(mod.getTagStyleVars({ color: '#007AFF' }, false)).toContain('--sp-tag-bg:rgba(0, 122, 255, 0.1)');
        expect(mod.getTagStyleVars({ color: null }, false)).toBe('');
    });
});
