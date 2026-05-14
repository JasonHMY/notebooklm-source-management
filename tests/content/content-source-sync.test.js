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

function configureAriaCheckbox(mockSourceRow, ariaChecked = 'true') {
    mockSourceRow.checkbox.tagName = 'DIV';
    mockSourceRow.checkbox.checked = undefined;
    mockSourceRow.checkbox.getAttribute = jest.fn((attr) => {
        if (attr === 'role') return 'checkbox';
        if (attr === 'aria-checked') return ariaChecked;
        if (attr === 'aria-label') return mockSourceRow.title || '';
        return null;
    });
    mockSourceRow.checkbox.matches = jest.fn((selector) => String(selector).includes('checkbox'));
    mockSourceRow.checkbox.closest = jest.fn(() => mockSourceRow.row);
    return mockSourceRow;
}

describe('scanAndSyncSources', () => {
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

    it('scans rows from the current source panel instead of hidden stale panels', () => {
        const stale = createMockSourceRow({ title: 'Hidden Old Source', stableToken: 'old-doc', checked: true });
        const current = createMockSourceRow({ title: 'Current Source', stableToken: 'current-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [current.row] : []
        ));

        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [stale.row, current.row] : []
        ));

        mod.scanAndSyncSources({}, true);

        expect(panel.querySelectorAll).toHaveBeenCalled();
        expect(Array.from(mod.sourcesByKey.values()).map((source) => source.title)).toEqual(['Current Source']);
    });

    it('detects the traditional list source view from source rows', () => {
        const source = createMockSourceRow({ title: 'List Source', stableToken: 'list-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [source.row] : []
        ));
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            labelRows: 0
        });
    });

    it('reads ARIA checkbox state when scanning list source rows', () => {
        const source = configureAriaCheckbox(createMockSourceRow({
            title: 'ARIA List Source',
            stableToken: 'aria-list-doc',
            checked: false
        }), 'true');
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [source.row] : []
        ));
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);

        const [sourceRecord] = Array.from(mod.sourcesByKey.values());
        expect(sourceRecord).toMatchObject({
            title: 'ARIA List Source',
            enabled: true
        });
    });

    it('keeps source row buttons in the traditional list source view', () => {
        const source = createMockSourceRow({ title: 'List Source Button', stableToken: 'list-button-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === '[role="button"]') return [source.row];
            if (mod.DEPS.row.includes(selector)) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            labelRows: 0,
            activeLabelControls: 0
        });
    });

    it('detects active NotebookLM label view controls before stale list rows', () => {
        const stale = createMockSourceRow({ title: 'Stale List Source', stableToken: 'stale-doc', checked: true });
        const relabelControl = {
            textContent: 'label_auto',
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '撤销或重新为来源加标签' : null)),
            matches: jest.fn(() => false)
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

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'label',
            listRows: 1,
            labelRows: 0,
            activeLabelControls: 1
        });
    });

    it('does not let manager-suppressed label controls override the active list view', () => {
        global.document.documentElement.className = 'sources-plus-manager-active';
        global.document.documentElement.classList.contains = jest.fn((className) => (
            className === 'sources-plus-manager-active'
        ));

        const stale = createMockSourceRow({ title: 'Stale List Source', stableToken: 'stale-doc', checked: true });
        const { panel, content } = createMockPanel({ visible: true, contentVisible: true });
        content.style.visibility = 'hidden';
        content.__computedStyle.visibility = 'hidden';
        content.matches = jest.fn((selector) => (
            selector === '.scroll-area' ||
            selector === '.scroll-area-desktop' ||
            selector === '.sources-list-container' ||
            selector === '[data-testid="scroll-area"]'
        ));
        content.parentElement = panel;
        content.parentNode = panel;

        const relabelControl = {
            textContent: 'label_auto',
            style: {},
            __computedStyle: { visibility: 'hidden' },
            parentElement: content,
            parentNode: content,
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '撤销或重新为来源加标签' : null)),
            matches: jest.fn(() => false)
        };
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [relabelControl];
            if (mod.DEPS.row.includes(selector)) return [stale.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            labelRows: 0,
            activeLabelControls: 0
        });
    });

    it('does not treat hidden native label groups as the active view when list-mode suppression is active', () => {
        global.document.documentElement.className = 'sources-plus-manager-active';
        global.document.documentElement.classList.contains = jest.fn((className) => (
            className === 'sources-plus-manager-active'
        ));

        const source = createMockSourceRow({ title: 'Hidden Label Source', stableToken: 'hidden-label-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelGroup = {
            textContent: 'Suppressed NotebookLM Group',
            parentElement: panel,
            parentNode: panel,
            style: { visibility: 'hidden' },
            __computedStyle: { visibility: 'hidden' },
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return 'Suppressed NotebookLM Group label';
                if (attr === 'data-testid') return 'source-label-group';
                return null;
            }),
            matches: jest.fn((selector) => (
                selector.includes('source-label') ||
                selector.includes('label-group') ||
                selector.includes('data-testid*="source-label"')
            ))
        };
        source.row.parentElement = labelGroup;
        source.row.parentNode = labelGroup;
        source.row.__computedStyle = { visibility: 'hidden' };

        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('source-label') || selector.includes('label-group')) return [labelGroup];
            if (selector.includes('source')) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'unknown',
            labelRows: 0
        });
    });

    it('adopts native label view checkbox changes instead of reselecting stale plugin state', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const listSource = createMockSourceRow({ title: 'Notebook Source', stableToken: 'doc-1', checked: true });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [listSource.row] : []
        ));

        mod.scanAndSyncSources({}, true);
        const sourceKey = Array.from(mod.sourcesByKey.keys())[0];
        expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(true);

        const labelSource = createMockSourceRow({ title: 'Notebook Source', stableToken: 'doc-1', checked: false });
        labelSource.row.__nativeLabelTitle = 'AI Group';
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
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group'))
        };
        labelSource.row.parentElement = labelGroup;
        labelSource.row.parentNode = labelGroup;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            if (
                mod.DEPS.row.includes(selector) ||
                value === '[data-testid="source-item"]' ||
                value === '.single-source-container' ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return [labelSource.row];
            }
            return [];
        });

        mod.scanAndSyncSources({}, false);

        expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        expect(labelSource.checkbox.click).not.toHaveBeenCalled();
    });

    it('reads ARIA checkbox state when scanning label source rows', () => {
        const labelSource = configureAriaCheckbox(createMockSourceRow({
            title: 'ARIA Label Source',
            stableToken: 'aria-label-doc',
            checked: true
        }), 'false');
        labelSource.row.__nativeLabelTitle = 'AI Group';
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
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
        labelSource.row.parentElement = labelGroup;
        labelSource.row.parentNode = labelGroup;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            if (
                mod.DEPS.row.includes(selector) ||
                value.includes('source-row') ||
                value.includes('source-item') ||
                value.includes('data-source-id')
            ) {
                return [labelSource.row];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);

        const [sourceRecord] = Array.from(mod.sourcesByKey.values());
        expect(sourceRecord).toMatchObject({
            title: 'ARIA Label Source',
            enabled: false,
            nativeLabelTitle: 'AI Group'
        });
    });

    it('adopts collapsed native label group checkbox changes before switching back to list view', () => {
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

        expect(mod.getSourceViewInfo(panel).kind).toBe('label');
        mod.scanAndSyncSources({}, false);

        sourceKeys.forEach((sourceKey) => {
            expect(mod.sourcesByKey.get(sourceKey).enabled).toBe(false);
        });
    });

    it('applies collapsed native label selections through imported group metadata', () => {
        const existing = createMockSourceRow({ title: 'Imported Source', stableToken: 'imported-doc', checked: true });
        const descriptor = mod.createSourceDescriptor(existing.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, { ...descriptor, enabled: true, nativeLabelTitle: '' });
        mod.groupsById.set('imported-folder', {
            id: 'imported-folder',
            title: 'Renamed Imported Folder',
            nativeLabelTitle: 'AI Group',
            children: [{ type: 'source', key: descriptor.key }],
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['imported-folder'];
        mod.state.ungrouped = [];

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
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        collapsedLabelGroup.parentElement = panel;
        collapsedLabelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [collapsedLabelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, false);

        expect(mod.sourcesByKey.get(descriptor.key).enabled).toBe(false);
    });

    it('does not apply collapsed native label selections to ordinary same-title plugin groups', () => {
        const existing = createMockSourceRow({ title: 'Ordinary Group Source', stableToken: 'ordinary-doc', checked: true });
        const descriptor = mod.createSourceDescriptor(existing.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, { ...descriptor, enabled: true, nativeLabelTitle: '' });
        mod.groupsById.set('ordinary-folder', {
            id: 'ordinary-folder',
            title: 'AI Group',
            children: [{ type: 'source', key: descriptor.key }],
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['ordinary-folder'];
        mod.state.ungrouped = [];

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
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        collapsedLabelGroup.parentElement = panel;
        collapsedLabelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [collapsedLabelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, false);

        expect(mod.sourcesByKey.get(descriptor.key).enabled).toBe(true);
    });

    it('keeps the pre-labeling entry point in the traditional list source view', () => {
        const source = createMockSourceRow({ title: 'List Source', stableToken: 'list-doc', checked: true });
        const labelEntryPoint = {
            textContent: 'label_auto',
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? '按主题自动为来源加标签' : null)),
            matches: jest.fn(() => false)
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [labelEntryPoint];
            if (mod.DEPS.row.includes(selector)) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            activeLabelControls: 0
        });
    });

    it('keeps list view when the native source view switcher exposes a label view button', () => {
        const source = createMockSourceRow({ title: 'Current List Source', stableToken: 'list-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelViewButton = {
            tagName: 'BUTTON',
            textContent: 'label_auto 标签视图',
            style: {},
            parentElement: null,
            parentNode: null,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return '标签视图';
                if (attr === 'aria-pressed') return 'false';
                if (attr === 'data-testid') return 'source-view-label-button';
                return null;
            }),
            matches: jest.fn((selector) => (
                selector.includes('aria-label') ||
                selector.includes('data-testid') ||
                selector.includes('label')
            )),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        labelViewButton.parentElement = panel;
        labelViewButton.parentNode = panel;
        source.row.parentElement = panel;
        source.row.parentNode = panel;
        source.row.previousElementSibling = labelViewButton;
        source.row.previousSibling = labelViewButton;
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [labelViewButton];
            if (selector.includes('source-label') || selector.includes('label-group') || selector.includes('aria-label') || selector.includes('category')) return [labelViewButton];
            if (selector === '[data-testid="source-item"]' || selector.includes('source-item') || mod.DEPS.row.includes(selector)) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            labelRows: 0,
            activeLabelControls: 0
        });
    });

    it('keeps list view when the native source view switcher uses tab or radio semantics', () => {
        const source = createMockSourceRow({ title: 'Current List Source', stableToken: 'list-doc', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelViewTab = {
            tagName: 'DIV',
            textContent: 'label_auto 标签视图',
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return '标签视图';
                if (attr === 'aria-selected') return 'false';
                if (attr === 'role') return 'radio';
                if (attr === 'data-testid') return 'source-view-label-toggle';
                return null;
            }),
            matches: jest.fn((selector) => (
                selector.includes('aria-label') ||
                selector.includes('aria-selected') ||
                selector.includes('role') ||
                selector.includes('data-testid') ||
                selector.includes('label')
            )),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        source.row.parentElement = panel;
        source.row.parentNode = panel;
        source.row.previousElementSibling = labelViewTab;
        source.row.previousSibling = labelViewTab;
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [];
            if (selector.includes('source-label') || selector.includes('label-group') || selector.includes('aria-label') || selector.includes('category')) return [labelViewTab];
            if (selector === '[data-testid="source-item"]' || selector.includes('source-item') || mod.DEPS.row.includes(selector)) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            labelRows: 0,
            activeLabelControls: 0
        });
    });

    it('does not treat the generic Sources panel toggle as a native label group', () => {
        const source = createMockSourceRow({ title: 'List Source', stableToken: 'list-doc', checked: true });
        const panelToggle = {
            tagName: 'BUTTON',
            textContent: 'Sources',
            style: {},
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [panelToggle];
            if (mod.DEPS.row.includes(selector)) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'list',
            listRows: 1,
            activeLabelControls: 0
        });
    });

    it('detects NotebookLM label view and annotates sources with native labels', () => {
        const first = createMockSourceRow({ title: 'Paper One', stableToken: 'paper-1', checked: true });
        const second = createMockSourceRow({ title: 'Paper Two', stableToken: 'paper-2', checked: true });
        first.row.__nativeLabelTitle = 'Clinical Papers';
        second.row.__nativeLabelTitle = 'Clinical Papers';
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelGroup = {
            textContent: 'Clinical Papers',
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Clinical Papers label' : null)),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label'))
        };
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('source-label') || selector.includes('label-group')) return [labelGroup];
            if (selector.includes('source')) return [first.row, second.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'label',
            labelRows: 2
        });

        mod.scanAndSyncSources({}, true);
        expect(Array.from(mod.sourcesByKey.values()).map((source) => source.nativeLabelTitle)).toEqual([
            'Clinical Papers',
            'Clinical Papers'
        ]);
    });

    it('persists source native label titles for collapsed native label sync', () => {
        const source = createMockSourceRow({ title: 'Paper One', stableToken: 'paper-1', checked: true });
        source.row.__nativeLabelTitle = 'Clinical Papers';
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelGroup = {
            textContent: 'Clinical Papers',
            parentElement: panel,
            parentNode: panel,
            style: {},
            __computedStyle: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Clinical Papers label' : null)),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label-group')),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        source.row.parentElement = labelGroup;
        source.row.parentNode = labelGroup;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            if (value.includes('source')) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);
        const [sourceKey] = Array.from(mod.sourcesByKey.keys());

        expect(mod.buildPersistableState().sourceStateById[sourceKey]).toMatchObject({
            title: 'Paper One',
            nativeLabelTitle: 'Clinical Papers'
        });
    });

    it('infers NotebookLM label titles from expanded native label headers without test ids', () => {
        const first = createMockSourceRow({ title: 'Chrono Trigger Notes', stableToken: 'chrono-notes', checked: true });
        const second = createMockSourceRow({ title: 'Final Fantasy Remake', stableToken: 'ff-remake', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const group = {
            textContent: '复古游戏重制 Chrono Trigger Notes Final Fantasy Remake',
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn(() => null),
            matches: jest.fn(() => false),
            querySelectorAll: jest.fn((selector) => (
                selector.includes('aria-expanded') ? [header] : []
            ))
        };
        const header = {
            tagName: 'BUTTON',
            textContent: 'keyboard_arrow_down 复古游戏重制',
            style: {},
            parentElement: group,
            parentNode: group,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn((selector) => (selector.includes('checkbox') ? { checked: true } : null)),
            querySelectorAll: jest.fn(() => [])
        };
        first.row.parentElement = group;
        first.row.parentNode = group;
        second.row.parentElement = group;
        second.row.parentNode = group;
        first.row.style = {};
        second.row.style = {};
        group.querySelectorAll = jest.fn((selector) => (
            selector.includes('aria-expanded') ? [header] : []
        ));
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') return [header];
            if (selector === '[role="listitem"]' || selector === 'mat-list-item' || selector === '.mat-mdc-list-item') {
                return [first.row, second.row];
            }
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'label',
            labelRows: 2
        });

        mod.scanAndSyncSources({}, true);
        expect(Array.from(mod.sourcesByKey.values()).map((source) => source.nativeLabelTitle)).toEqual([
            '复古游戏重制',
            '复古游戏重制'
        ]);
        expect(mod.getNativeLabelImportPreview()).toMatchObject({
            ok: true,
            labelCount: 1,
            sourceCount: 2
        });
    });

    it('does not use source row more buttons as NotebookLM label titles', () => {
        const first = createMockSourceRow({ title: 'Paper One', stableToken: 'paper-1', checked: true });
        const second = createMockSourceRow({ title: 'Paper Two', stableToken: 'paper-2', checked: true });
        const third = createMockSourceRow({ title: 'Reference One', stableToken: 'reference-1', checked: true });
        const fourth = createMockSourceRow({ title: 'Reference Two', stableToken: 'reference-2', checked: true });
        const rows = [first.row, second.row, third.row, fourth.row];
        const { panel } = createMockPanel({ visible: true, contentVisible: true });

        const createHeader = (title) => ({
            tagName: 'BUTTON',
            textContent: `keyboard_arrow_down ${title}`,
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return title;
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn((selector) => (selector.includes('checkbox') ? { checked: true } : null)),
            querySelectorAll: jest.fn(() => [])
        });
        const clinicalHeader = createHeader('Clinical Papers');
        const referenceHeader = createHeader('Reference Material');
        const moreButtons = rows.map((row) => ({
            tagName: 'BUTTON',
            textContent: 'more_vert',
            parentElement: row,
            parentNode: row,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-label') return '更多';
                if (attr === 'aria-expanded') return 'false';
                if (attr === 'role') return 'button';
                if (attr === 'class') return 'source-row-more-button';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelectorAll: jest.fn(() => [])
        }));

        rows.forEach((row, index) => {
            row.parentElement = panel;
            row.parentNode = panel;
            row.style = {};
            row.matches = jest.fn((selector) => selector === '[role="listitem"]');
            const originalQuerySelectorAll = row.querySelectorAll;
            row.querySelectorAll = jest.fn((selector) => {
                if (String(selector).includes('aria-expanded')) return [moreButtons[index]];
                return originalQuerySelectorAll(selector);
            });
        });
        clinicalHeader.previousElementSibling = null;
        clinicalHeader.previousSibling = null;
        first.row.previousElementSibling = clinicalHeader;
        first.row.previousSibling = clinicalHeader;
        second.row.previousElementSibling = first.row;
        second.row.previousSibling = first.row;
        referenceHeader.previousElementSibling = second.row;
        referenceHeader.previousSibling = second.row;
        third.row.previousElementSibling = referenceHeader;
        third.row.previousSibling = referenceHeader;
        fourth.row.previousElementSibling = third.row;
        fourth.row.previousSibling = third.row;

        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]') {
                return [clinicalHeader, referenceHeader, ...moreButtons];
            }
            if (selector === '[role="listitem"]') return rows;
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);

        expect(Array.from(mod.sourcesByKey.values()).map((source) => source.nativeLabelTitle)).toEqual([
            'Clinical Papers',
            'Clinical Papers',
            'Reference Material',
            'Reference Material'
        ]);
        expect(mod.getNativeLabelImportPreview()).toMatchObject({
            ok: true,
            labelCount: 2,
            sourceCount: 4
        });
        expect(mod.getNativeLabelImportPreview().labels.map((label) => label.title)).toEqual([
            'Clinical Papers',
            'Reference Material'
        ]);
    });

    it('uses nearest real NotebookLM label headers instead of toolbar and panel icon text', () => {
        const game = createMockSourceRow({ title: 'Retro Game Source', stableToken: 'retro-game', checked: true });
        const remake = createMockSourceRow({ title: 'Remake Source', stableToken: 'remake-source', checked: true });
        const ethics = createMockSourceRow({ title: 'Ethics Source', stableToken: 'ethics-source', checked: true });
        const rows = [game.row, remake.row, ethics.row];
        const { panel } = createMockPanel({ visible: true, contentVisible: true });

        const toolbarControl = {
            tagName: 'BUTTON',
            textContent: 'languageWebkeyboard_arrow_down',
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return 'languageWebkeyboard_arrow_down';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const sourcePanelHeader = {
            tagName: 'BUTTON',
            textContent: '来源dock_to_right',
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return '来源';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const createHeader = (title) => ({
            tagName: 'BUTTON',
            textContent: `keyboard_arrow_down ${title}`,
            style: {},
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return title;
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn((selector) => (selector.includes('checkbox') ? { checked: true } : null)),
            querySelectorAll: jest.fn(() => [])
        });
        const gameHeader = createHeader('复古游戏重制');
        const ethicsHeader = createHeader('工程与伦理规范');
        const ordered = [sourcePanelHeader, toolbarControl, gameHeader, game.row, remake.row, ethicsHeader, ethics.row];
        const orderByElement = new Map(ordered.map((element, index) => [element, index]));
        ordered.forEach((element) => {
            element.compareDocumentPosition = jest.fn((other) => {
                const left = orderByElement.get(element);
                const right = orderByElement.get(other);
                if (left == null || right == null || left === right) return 0;
                return left < right ? 4 : 2;
            });
        });
        rows.forEach((row) => {
            row.parentElement = panel;
            row.parentNode = panel;
            row.style = {};
            row.matches = jest.fn((selector) => selector === '[role="listitem"]');
        });

        panel.querySelectorAll = jest.fn((selector) => {
            if (selector === 'button' || selector === '[role="button"]' || String(selector).includes('aria-expanded')) {
                return [sourcePanelHeader, toolbarControl, gameHeader, ethicsHeader];
            }
            if (selector === '[role="listitem"]') return rows;
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, true);

        expect(Array.from(mod.sourcesByKey.values()).map((source) => source.nativeLabelTitle)).toEqual([
            '复古游戏重制',
            '复古游戏重制',
            '工程与伦理规范'
        ]);
        const preview = mod.getNativeLabelImportPreview();
        expect(preview).toMatchObject({
            ok: true,
            labelCount: 2,
            sourceCount: 3
        });
        expect(preview.labels.map((label) => label.title)).toEqual([
            '复古游戏重制',
            '工程与伦理规范'
        ]);
    });

    it('expands collapsed NotebookLM label groups before import preview scans', () => {
        const source = createMockSourceRow({ title: 'Paper One', stableToken: 'paper-1', checked: true });
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        source.row.parentElement = panel;
        source.row.parentNode = panel;
        source.row.matches = jest.fn((selector) => selector === '[role="listitem"]');

        const expandedHeader = {
            tagName: 'BUTTON',
            textContent: 'keyboard_arrow_down Expanded Group',
            style: {},
            parentElement: panel,
            parentNode: panel,
            click: jest.fn(),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'true';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return 'Expanded Group';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn((selector) => (selector.includes('checkbox') ? { checked: true } : null)),
            querySelectorAll: jest.fn(() => [])
        };
        const collapsedHeader = {
            tagName: 'BUTTON',
            textContent: 'keyboard_arrow_right Collapsed Group',
            style: {},
            parentElement: panel,
            parentNode: panel,
            click: jest.fn(),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'false';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return 'Collapsed Group';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelector: jest.fn((selector) => (selector.includes('checkbox') ? { checked: true } : null)),
            querySelectorAll: jest.fn(() => [])
        };
        const rowMoreButton = {
            tagName: 'BUTTON',
            textContent: 'more_vert',
            parentElement: source.row,
            parentNode: source.row,
            click: jest.fn(),
            getAttribute: jest.fn((attr) => {
                if (attr === 'aria-expanded') return 'false';
                if (attr === 'role') return 'button';
                if (attr === 'aria-label') return '更多';
                return null;
            }),
            matches: jest.fn(() => false),
            querySelectorAll: jest.fn(() => [])
        };

        panel.querySelectorAll = jest.fn((selector) => (
            String(selector).includes('aria-expanded') ? [expandedHeader, collapsedHeader, rowMoreButton] : []
        ));

        expect(mod.expandCollapsedNativeLabelGroups(panel)).toEqual({
            clickedCount: 1,
            titles: ['Collapsed Group']
        });
        expect(collapsedHeader.click).toHaveBeenCalledTimes(1);
        expect(expandedHeader.click).not.toHaveBeenCalled();
        expect(rowMoreButton.click).not.toHaveBeenCalled();
    });

    it('ignores suppressed label rows when detecting the active source view', () => {
        global.document.documentElement.className = 'sources-plus-manager-active';
        global.document.documentElement.classList.contains = jest.fn((className) => (
            className === 'sources-plus-manager-active'
        ));

        const source = createMockSourceRow({ title: 'AI Label Source', stableToken: 'ai-label-doc', checked: true });
        const { panel, content } = createMockPanel({ visible: true, contentVisible: true });
        content.__computedStyle.visibility = 'hidden';
        content.style.visibility = 'hidden';
        content.matches = jest.fn((selector) => (
            selector.includes('scroll-area') || selector.includes('data-testid="scroll-area"')
        ));
        source.row.__computedStyle = { visibility: 'hidden' };

        const labelGroup = {
            textContent: 'AI Generated Group',
            parentElement: content,
            parentNode: content,
            style: {},
            __computedStyle: { visibility: 'hidden' },
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'AI Generated Group label' : null)),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label'))
        };
        source.row.parentElement = labelGroup;
        source.row.parentNode = labelGroup;
        content.parentElement = panel;
        content.parentNode = panel;

        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('source-label') || selector.includes('label-group')) return [labelGroup];
            if (selector.includes('source')) return [source.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        expect(mod.getSourceViewInfo(panel)).toMatchObject({
            kind: 'unknown',
            labelRows: 0
        });
    });

    it('previews and imports NotebookLM labels as plugin folders without overwriting existing folders', () => {
        const first = createMockSourceRow({ title: 'Paper One', stableToken: 'paper-1', checked: true });
        const second = createMockSourceRow({ title: 'Paper Two', stableToken: 'paper-2', checked: true });
        first.row.__nativeLabelTitle = 'Clinical Papers';
        second.row.__nativeLabelTitle = 'Policy Notes';
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('source-label') || selector.includes('label-group')) return [];
            if (selector.includes('source')) return [first.row, second.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.groupsById.set('existing-clinical', {
            id: 'existing-clinical',
            title: 'Clinical Papers',
            children: [],
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['existing-clinical'];
        mod.scanAndSyncSources({}, false);

        expect(mod.getNativeLabelImportPreview()).toMatchObject({
            ok: true,
            labelCount: 2,
            sourceCount: 2
        });

        expect(mod.applyNativeLabelImport()).toBe(true);
        expect(mod.groupsById.get('existing-clinical').children).toHaveLength(1);
        expect(mod.groupsById.get('existing-clinical').nativeLabelTitle).toBe('Clinical Papers');
        expect(Array.from(mod.groupsById.values()).map((group) => group.title).sort()).toEqual([
            'Clinical Papers',
            'Policy Notes'
        ]);
        expect(Array.from(mod.groupsById.values()).map((group) => group.nativeLabelTitle).sort()).toEqual([
            'Clinical Papers',
            'Policy Notes'
        ]);
        expect(mod.state.ungrouped).toEqual([]);
    });

    it('does not move sources out of existing user folders when importing native labels', () => {
        const grouped = createMockSourceRow({ title: 'Saved Paper', stableToken: 'saved-paper', checked: true });
        const ungrouped = createMockSourceRow({ title: 'New Paper', stableToken: 'new-paper', checked: true });
        grouped.row.__nativeLabelTitle = 'NotebookLM Label';
        ungrouped.row.__nativeLabelTitle = 'NotebookLM Label';
        const groupedDescriptor = mod.createSourceDescriptor(grouped.row, new Map(), new Map());
        const ungroupedDescriptor = mod.createSourceDescriptor(ungrouped.row, new Map(), new Map());
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        panel.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('source-label') || selector.includes('label-group')) return [];
            if (selector.includes('source')) return [grouped.row, ungrouped.row];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.groupsById.set('user-folder', {
            id: 'user-folder',
            title: 'User Folder',
            children: [{ type: 'source', key: groupedDescriptor.key }],
            enabled: true,
            collapsed: false
        });
        mod.state.groups = ['user-folder'];
        mod.state.ungrouped = [ungroupedDescriptor.key];
        mod.sourcesByKey.set(groupedDescriptor.key, groupedDescriptor);
        mod.sourcesByKey.set(ungroupedDescriptor.key, ungroupedDescriptor);
        mod.scanAndSyncSources({}, false);

        expect(mod.applyNativeLabelImport()).toBe(true);

        expect(mod.groupsById.get('user-folder').children).toEqual([
            { type: 'source', key: groupedDescriptor.key }
        ]);
        const importedGroup = Array.from(mod.groupsById.values()).find((group) => group.title === 'NotebookLM Label');
        expect(importedGroup.nativeLabelTitle).toBe('NotebookLM Label');
        expect(importedGroup.children).toEqual([
            { type: 'source', key: ungroupedDescriptor.key }
        ]);
        expect(mod.state.ungrouped).toEqual([]);
    });

    it('keeps saved sources when a label view exposes no source rows during loading', () => {
        const existing = createMockSourceRow({ title: 'Existing Source', stableToken: 'existing-doc', checked: true });
        const descriptor = mod.createSourceDescriptor(existing.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, { ...descriptor, enabled: true });
        mod.state.ungrouped = [descriptor.key];

        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const labelGroup = {
            textContent: 'Loading Labels',
            style: {},
            getAttribute: jest.fn((attr) => (attr === 'aria-label' ? 'Source label loading' : null)),
            matches: jest.fn((selector) => selector.includes('source-label') || selector.includes('label'))
        };
        panel.querySelectorAll = jest.fn((selector) => (
            selector.includes('source-label') || selector.includes('label-group') ? [labelGroup] : []
        ));
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        mod.scanAndSyncSources({}, false);

        expect(Array.from(mod.sourcesByKey.keys())).toEqual([descriptor.key]);
        expect(mod.state.ungrouped).toEqual([descriptor.key]);
    });

    it('preserves current notebook state when the current panel virtualizes to a partial row set', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const firstRow = createMockSourceRow({ title: 'Virtual Source A', stableToken: 'virtual-a', checked: true });
        const secondRow = createMockSourceRow({ title: 'Virtual Source B', stableToken: 'virtual-b', checked: true });
        const thirdRow = createMockSourceRow({ title: 'Virtual Source C', stableToken: 'virtual-c', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(firstRow.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondRow.row, new Map(), new Map());
        const thirdDescriptor = mod.createSourceDescriptor(thirdRow.row, new Map(), new Map());

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row, thirdRow.row] : []
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row, thirdRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);
        global.chrome.runtime.sendMessage.mockClear();

        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [secondRow.row] : []
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row, thirdRow.row] : []
        ));
        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(mod.state.ungrouped).toEqual([
            firstDescriptor.key,
            secondDescriptor.key,
            thirdDescriptor.key
        ]);
        expect(Array.from(mod.sourcesByKey.keys()).sort()).toEqual([
            firstDescriptor.key,
            secondDescriptor.key,
            thirdDescriptor.key
        ].sort());
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('does not empty grouped folders when a partial rescan is missing older grouped source records', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const firstRow = createMockSourceRow({ title: 'Folder Source A', stableToken: 'folder-a', checked: true });
        const secondRow = createMockSourceRow({ title: 'Folder Source B', stableToken: 'folder-b', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(firstRow.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondRow.row, new Map(), new Map());

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row] : []
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);

        const originalChildren = [
            { type: 'source', key: firstDescriptor.key },
            { type: 'source', key: secondDescriptor.key }
        ];
        mod.state.groups = ['folder'];
        mod.state.ungrouped = [];
        mod.groupsById.set('folder', {
            id: 'folder',
            title: 'Important Folder',
            children: originalChildren.map((child) => Object.assign({}, child))
        });
        mod.sourcesByKey.delete(secondDescriptor.key);
        global.chrome.runtime.sendMessage.mockClear();

        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row] : []
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row] : []
        ));

        const changed = mod.scanAndSyncSources(null, false);
        mod.flushPendingStateSave();

        expect(changed).toBe(false);
        expect(mod.groupsById.get('folder').children).toEqual(originalChildren);
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.getDiagnosticsInfo().lastSkippedStructuralSourceSync).toEqual(expect.objectContaining({
            reason: 'would_drop_grouped_sources',
            lostGroupedSourceWithoutRecordCount: 1
        }));
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('hydrates v2 state, appends new sources, and preserves loading metadata', () => {
        const first = createMockSourceRow({ title: 'First Source', stableToken: 'doc-1', checked: true });
        const second = createMockSourceRow({ title: 'First Source', stableToken: null, iconName: 'video_youtube', loading: true });
        const descriptorA = mod.createSourceDescriptor(first.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [first.row, second.row] : []
        ));

        const shouldUpgrade = mod.scanAndSyncSources({
            schemaVersion: 2,
            groups: ['group1'],
            groupsById: {
                group1: { id: 'group1', title: 'Pinned', children: [{ type: 'source', key: descriptorA.key }] }
            },
            ungrouped: [],
            sourceStateById: {
                [descriptorA.key]: {
                    enabled: false,
                    title: 'First Source',
                    normalizedTitle: 'first source',
                    fingerprint: descriptorA.fingerprint,
                    identityType: descriptorA.identityType
                }
            }
        }, true);

        const secondKey = mod.state.ungrouped[0];
        expect(shouldUpgrade).toBe(false);
        expect(mod.sourcesByKey.get(descriptorA.key).enabled).toBe(false);
        expect(mod.groupsById.get('group1').children[0].key).toBe(descriptorA.key);
        expect(secondKey).toBeDefined();
        expect(mod.sourcesByKey.get(secondKey).iconName).toBe('smart_display');
        expect(mod.sourcesByKey.get(secondKey).isDisabled).toBe(true);
        expect(mod.sourcesByKey.get(secondKey).isLoading).toBe(true);
    });

    it('migrates legacy source keys to v2 ids and marks storage for rewrite', () => {
        const legacyRow = createMockSourceRow({ title: 'Legacy Source', ariaLabel: 'Legacy Source', stableToken: 'legacy-doc', checked: true });
        const descriptor = mod.createSourceDescriptor(legacyRow.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [legacyRow.row] : []
        ));

        const shouldUpgrade = mod.scanAndSyncSources(mod.normalizeLoadedState({
            groups: ['group1'],
            groupsById: {
                group1: { id: 'group1', title: 'Migrated', children: [{ type: 'source', key: descriptor.legacyKey }] }
            },
            ungrouped: [],
            enabledMap: {
                [descriptor.legacyKey]: false
            }
        }), true);

        expect(shouldUpgrade).toBe(true);
        expect(mod.groupsById.get('group1').children[0].key).toBe(descriptor.key);
        expect(mod.sourcesByKey.get(descriptor.key).enabled).toBe(false);
    });

    it('remaps persisted grouped sources on first load by stable token when the stored key changes', () => {
        const currentRow = createMockSourceRow({ title: 'Stable Source', stableToken: 'stable-doc', checked: true });
        const currentDescriptor = mod.createSourceDescriptor(currentRow.row, new Map(), new Map());
        const outdatedStoredKey = 'source_fp_outdated';

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [currentRow.row] : []
        ));

        mod.scanAndSyncSources({
            schemaVersion: 3,
            groups: ['group1'],
            groupsById: {
                group1: {
                    id: 'group1',
                    title: 'Pinned',
                    children: [{ type: 'source', key: outdatedStoredKey }]
                }
            },
            ungrouped: [],
            sourceStateById: {
                [outdatedStoredKey]: {
                    enabled: false,
                    title: 'Stable Source',
                    normalizedTitle: 'stable source',
                    stableToken: 'stable-doc',
                    fingerprint: currentDescriptor.fingerprint,
                    identityType: 'stable-token'
                }
            }
        }, true);

        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: currentDescriptor.key }]);
        expect(mod.sourcesByKey.get(currentDescriptor.key).enabled).toBe(false);
    });

    it('does not remap persisted grouped sources by title when stable token drift suggests a new source', () => {
        const currentRow = createMockSourceRow({
            title: 'Title Fallback Source',
            ariaLabel: 'Title Fallback Source',
            stableToken: 'stable-doc-new',
            iconName: 'video_youtube',
            checked: true
        });
        const currentDescriptor = mod.createSourceDescriptor(currentRow.row, new Map(), new Map());
        const outdatedStoredKey = 'source_fp_title_only';

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [currentRow.row] : []
        ));

        mod.scanAndSyncSources({
            schemaVersion: 3,
            groups: ['group1'],
            groupsById: {
                group1: {
                    id: 'group1',
                    title: 'Pinned',
                    children: [{ type: 'source', key: outdatedStoredKey }]
                }
            },
            ungrouped: [],
            sourceStateById: {
                [outdatedStoredKey]: {
                    enabled: false,
                    title: 'Title Fallback Source',
                    normalizedTitle: 'title fallback source',
                    stableToken: 'stable-doc-old',
                    fingerprint: 'title fallback source|title fallback source|article',
                    identityType: 'stable-token'
                }
            }
        }, true);

        expect(mod.groupsById.get('group1').children).toEqual([]);
        expect(mod.sourcesByKey.get(currentDescriptor.key).enabled).toBe(true);
    });

    it('keeps local enabled state across DOM re-renders', () => {
        const firstPass = createMockSourceRow({ title: 'Persistent Source', stableToken: 'stable-doc', checked: false });
        const secondPass = createMockSourceRow({ title: 'Persistent Source', stableToken: 'stable-doc', checked: false });
        const descriptor = mod.createSourceDescriptor(firstPass.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstPass.row] : []
        ));
        mod.scanAndSyncSources(null, true);
        mod.sourcesByKey.get(descriptor.key).enabled = true;

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [secondPass.row] : []
        ));
        mod.scanAndSyncSources(null, false);

        expect(mod.sourcesByKey.get(descriptor.key).enabled).toBe(true);
    });

    it('ignores aria-controls when deriving stable source ids', () => {
        const firstPass = createMockSourceRow({ title: 'Menu Source', ariaControls: 'mat-menu-panel-3', checked: true });
        const secondPass = createMockSourceRow({ title: 'Menu Source', ariaControls: 'mat-menu-panel-19', checked: true });

        const firstDescriptor = mod.createSourceDescriptor(firstPass.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondPass.row, new Map(), new Map());

        expect(firstDescriptor.identityType).toBe('fingerprint');
        expect(secondDescriptor.identityType).toBe('fingerprint');
        expect(firstDescriptor.key).toBe(secondDescriptor.key);
    });

    it('uses Drive and file data attributes as stable source ids', () => {
        const mock = createMockSourceRow({ title: 'Drive Source', stableToken: null, checked: true });
        mock.row.getAttribute = jest.fn((attr) => {
            if (attr === 'data-drive-file-id') return 'drive-file-123456789';
            return null;
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor.identityType).toBe('stable-token');
        expect(descriptor.stableToken).toBe('data-drive-file-id-drive-file-123456789');
    });

    it('uses stable Drive URL path tokens when source links are present', () => {
        const mock = createMockSourceRow({
            title: 'Linked Source',
            stableToken: null,
            href: 'https://drive.google.com/file/d/1abcDEFghiJKLmnop/view',
            checked: true
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor.identityType).toBe('stable-token');
        expect(descriptor.stableToken).toBe('d-1abcdefghijklmnop');
    });

    it('uses stable source URL data attributes as source ids', () => {
        const mock = createMockSourceRow({ title: 'URL Data Source', stableToken: null, checked: true });
        mock.row.getAttribute = jest.fn((attr) => {
            if (attr === 'data-source-url') {
                return 'https://drive.google.com/file/d/1DataAttrToken987654321/view';
            }
            return null;
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor.identityType).toBe('stable-token');
        expect(descriptor.stableToken).toBe('data-source-url-d-1dataattrtoken987654321');
    });

    it('uses stable aria description ids without treating generic controls as source ids', () => {
        const mock = createMockSourceRow({ title: 'Described Source', stableToken: null, checked: true });
        mock.row.getAttribute = jest.fn((attr) => {
            if (attr === 'aria-describedby') return 'source-card drive-file-ABC123456789';
            return null;
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor.identityType).toBe('stable-token');
        expect(descriptor.stableToken).toBe('aria-describedby-drive-file-abc123456789');
    });

    it('uses checkbox aria label as a title fallback when NotebookLM title selectors change', () => {
        const mock = createMockSourceRow({
            title: 'Hidden DOM Title',
            ariaLabel: 'Visible aria source',
            stableToken: 'doc-aria-title',
            checked: true
        });
        mock.row.querySelector = jest.fn((selector) => {
            if (selector.includes('source-title')) return null;
            if (selector.includes('checkbox')) return mock.checkbox;
            if (selector.includes('mat-icon')) return mock.iconEl;
            return null;
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor).toBeTruthy();
        expect(descriptor.title).toBe('Visible aria source');
        expect(descriptor.normalizedTitle).toBe('visible aria source');
    });

    it('keeps sources visible when NotebookLM checkbox selectors change but source rows still have actions', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const nativeMoreButton = { click: jest.fn(), getAttribute: jest.fn(() => 'More options') };
        const mock = createMockSourceRow({
            title: 'Checkboxless Source',
            stableToken: 'doc-checkboxless',
            checked: true,
            nativeMoreButton
        });
        mock.row.querySelector = jest.fn((selector) => {
            if (selector.includes('source-title')) return mock.titleEl;
            if (selector.includes('checkbox')) return null;
            if (selector.includes('mat-icon')) return mock.iconEl;
            if (selector.includes('More options')) return nativeMoreButton;
            return null;
        });

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [mock.row] : []
        ));

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());
        expect(descriptor).toMatchObject({
            title: 'Checkboxless Source',
            hasNativeCheckbox: false,
            isDisabled: false
        });

        mod.scanAndSyncSources(null, true);

        expect(mod.hasRenderableSourceRows()).toBe(true);
        expect(mod.getSourcePanelState(panel)).toEqual(expect.objectContaining({
            state: 'ready',
            manageableRows: 1
        }));
        expect(mod.state.ungrouped).toEqual([descriptor.key]);
        expect(mod.sourcesByKey.get(descriptor.key)).toMatchObject({
            enabled: true,
            hasNativeCheckbox: false,
            isDisabled: false
        });
    });

    it('renders loading source rows without native checkbox controls as disabled sources', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const mock = createMockSourceRow({
            title: 'Analyzing Source',
            hasCheckbox: false,
            stableToken: null,
            nativeMoreButton: null,
            loading: true
        });

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [mock.row] : []
        ));

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());
        const shouldUpgrade = mod.scanAndSyncSources(null, true);

        expect(descriptor).toMatchObject({
            title: 'Analyzing Source',
            hasNativeCheckbox: false,
            isLoading: true,
            isDisabled: true
        });
        expect(shouldUpgrade).toBe(false);
        expect(mod.hasRenderableSourceRows()).toBe(true);
        expect(mod.getSourcePanelState(panel)).toEqual(expect.objectContaining({
            state: 'ready',
            manageableRows: 1,
            loadingRows: 1
        }));
        expect(mod.sourcesByKey.get(descriptor.key)).toMatchObject({
            isLoading: true,
            isDisabled: true
        });
    });

    it('does not keep a ready source loading from title text or hidden stale progress nodes', () => {
        const hiddenProgress = {
            hidden: true,
            textContent: '',
            style: { display: 'none' },
            getAttribute: jest.fn((attr) => (attr === 'role' ? 'progressbar' : null)),
            matches: jest.fn((selector) => selector.includes('[role="progressbar"]'))
        };
        const mock = createMockSourceRow({
            title: '加载完成后的分析报告',
            stableToken: 'ready-doc',
            checked: true
        });
        const originalQuerySelector = mock.row.querySelector;
        const originalQuerySelectorAll = mock.row.querySelectorAll;
        mock.row.querySelector = jest.fn((selector) => {
            if (selector.includes('[role="progressbar"]')) return hiddenProgress;
            return originalQuerySelector(selector);
        });
        mock.row.querySelectorAll = jest.fn((selector) => {
            if (selector.includes('[role="progressbar"]')) return [hiddenProgress];
            return originalQuerySelectorAll(selector);
        });

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());

        expect(descriptor).toMatchObject({
            title: '加载完成后的分析报告',
            isLoading: false,
            isDisabled: false
        });
    });

    it('does not treat failed source rows as source detail views', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const mock = createMockSourceRow({
            title: 'Failed Source',
            hasCheckbox: false,
            stableToken: null,
            nativeMoreButton: null,
            status: 'failed',
            statusText: 'Upload failed'
        });

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [mock.row] : []
        ));

        const descriptor = mod.createSourceDescriptor(mock.row, new Map(), new Map());
        mod.scanAndSyncSources(null, true);

        expect(descriptor).toMatchObject({
            title: 'Failed Source',
            hasNativeCheckbox: false,
            isLoading: false,
            isFailed: true,
            isDisabled: true
        });
        expect(mod.getSourcePanelState(panel)).toEqual(expect.objectContaining({
            state: 'ready',
            manageableRows: 1,
            failedRows: 1
        }));
        expect(mod.sourcesByKey.get(descriptor.key)).toMatchObject({
            isFailed: true,
            isDisabled: true
        });
    });

    it('does not keep grouped sources mapped during non-initial rescans when a new stable token appears', () => {
        const firstPass = createMockSourceRow({ title: 'Mapped Source', stableToken: 'doc-old', checked: true });
        const secondPass = createMockSourceRow({ title: 'Mapped Source', stableToken: 'doc-new', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(firstPass.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondPass.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstPass.row] : []
        ));
        mod.scanAndSyncSources(null, true);

        mod.state.groups = ['group1'];
        mod.state.ungrouped = [];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: firstDescriptor.key }]
        });
        mod.sourcesByKey.get(firstDescriptor.key).enabled = false;
        const tagId = mod.createTag('Pinned');
        mod.setSourceTagIds(firstDescriptor.key, [tagId]);

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [secondPass.row] : []
        ));
        mod.scanAndSyncSources(null, false);

        expect(firstDescriptor.key).not.toBe(secondDescriptor.key);
        expect(mod.groupsById.get('group1').children).toEqual([]);
        expect(mod.state.ungrouped).toEqual([secondDescriptor.key]);
        expect(mod.sourcesByKey.get(secondDescriptor.key).enabled).toBe(true);
        expect(mod.getSourceTagIds(secondDescriptor.key)).toEqual([]);
    });

    it('skips destructive mutation sync when a newly added source is the only visible DOM row', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const firstRow = createMockSourceRow({ title: 'Existing Source A', stableToken: 'doc-a', checked: true });
        const secondRow = createMockSourceRow({ title: 'Existing Source B', stableToken: 'doc-b', checked: true });
        const newRow = createMockSourceRow({ title: 'New Source C', stableToken: 'doc-c', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(firstRow.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondRow.row, new Map(), new Map());
        const newDescriptor = mod.createSourceDescriptor(newRow.row, new Map(), new Map());

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);
        global.chrome.runtime.sendMessage.mockClear();

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [newRow.row] : []
        ));
        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(mod.state.ungrouped).toEqual([firstDescriptor.key, secondDescriptor.key]);
        expect(Array.from(mod.sourcesByKey.keys()).sort()).toEqual([
            firstDescriptor.key,
            secondDescriptor.key
        ].sort());
        expect(mod.sourcesByKey.has(newDescriptor.key)).toBe(false);
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row, newRow.row] : []
        ));
        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(mod.state.ungrouped).toEqual([firstDescriptor.key, secondDescriptor.key, newDescriptor.key]);
        expect(mod.sourcesByKey.has(newDescriptor.key)).toBe(true);
        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('skips destructive mutation sync when NotebookLM temporarily renders no source rows', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const firstRow = createMockSourceRow({ title: 'Existing Source A', stableToken: 'doc-a', checked: true });
        const secondRow = createMockSourceRow({ title: 'Existing Source B', stableToken: 'doc-b', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(firstRow.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondRow.row, new Map(), new Map());

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [firstRow.row, secondRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);
        global.chrome.runtime.sendMessage.mockClear();

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(mod.state.ungrouped).toEqual([firstDescriptor.key, secondDescriptor.key]);
        expect(Array.from(mod.sourcesByKey.keys()).sort()).toEqual([
            firstDescriptor.key,
            secondDescriptor.key
        ].sort());
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('keeps a renamed fingerprint source in its ungrouped position when the native row is updated in place', () => {
        const renamedRow = createMockSourceRow({ title: 'Original Source', stableToken: null, checked: true });
        const otherRow = createMockSourceRow({ title: 'Other Source', stableToken: null, checked: true });
        const firstDescriptor = mod.createSourceDescriptor(renamedRow.row, new Map(), new Map());
        const otherDescriptor = mod.createSourceDescriptor(otherRow.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [renamedRow.row, otherRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);
        mod.sourcesByKey.get(firstDescriptor.key).enabled = false;
        const tagId = mod.createTag('Pinned');
        mod.setSourceTagIds(firstDescriptor.key, [tagId]);

        renamedRow.titleEl.textContent = 'Renamed Source';
        const renamedDescriptor = mod.createSourceDescriptor(renamedRow.row, new Map(), new Map());
        mod.scanAndSyncSources(null, false);

        expect(firstDescriptor.key).not.toBe(renamedDescriptor.key);
        expect(mod.state.ungrouped).toEqual([renamedDescriptor.key, otherDescriptor.key]);
        expect(mod.sourcesByKey.get(renamedDescriptor.key).title).toBe('Renamed Source');
        expect(mod.sourcesByKey.get(renamedDescriptor.key).enabled).toBe(false);
        expect(mod.getSourceTagIds(renamedDescriptor.key)).toEqual([tagId]);
    });

    it('keeps a renamed grouped fingerprint source in place when NotebookLM replaces the row node', () => {
        const oldRenamedRow = createMockSourceRow({ title: 'Original Source', stableToken: null, checked: true });
        const oldAnchorRow = createMockSourceRow({ title: 'Anchor Source', stableToken: 'anchor-doc', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(oldRenamedRow.row, new Map(), new Map());
        const oldAnchorDescriptor = mod.createSourceDescriptor(oldAnchorRow.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [oldRenamedRow.row, oldAnchorRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);

        mod.state.groups = ['group1'];
        mod.state.ungrouped = [oldAnchorDescriptor.key];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: firstDescriptor.key }]
        });
        mod.sourcesByKey.get(firstDescriptor.key).enabled = false;

        const newRenamedRow = createMockSourceRow({ title: 'Renamed Source', stableToken: null, checked: true });
        const newAnchorRow = createMockSourceRow({ title: 'Anchor Source', stableToken: 'anchor-doc', checked: true });
        const renamedDescriptor = mod.createSourceDescriptor(newRenamedRow.row, new Map(), new Map());
        const newAnchorDescriptor = mod.createSourceDescriptor(newAnchorRow.row, new Map(), new Map());
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [newRenamedRow.row, newAnchorRow.row] : []
        ));

        mod.scanAndSyncSources(null, false);

        expect(firstDescriptor.key).not.toBe(renamedDescriptor.key);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: renamedDescriptor.key }]);
        expect(mod.state.ungrouped).toEqual([newAnchorDescriptor.key]);
        expect(mod.sourcesByKey.get(renamedDescriptor.key).enabled).toBe(false);
    });

    it('does not positionally inherit state when the candidate has a new stable token', () => {
        const oldRenamedRow = createMockSourceRow({ title: 'Original Source', stableToken: null, checked: true });
        const oldAnchorRow = createMockSourceRow({ title: 'Anchor Source', stableToken: 'anchor-doc', checked: true });
        const firstDescriptor = mod.createSourceDescriptor(oldRenamedRow.row, new Map(), new Map());
        const oldAnchorDescriptor = mod.createSourceDescriptor(oldAnchorRow.row, new Map(), new Map());

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [oldRenamedRow.row, oldAnchorRow.row] : []
        ));
        mod.scanAndSyncSources(null, true);

        mod.state.groups = ['group1'];
        mod.state.ungrouped = [oldAnchorDescriptor.key];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: firstDescriptor.key }]
        });
        mod.sourcesByKey.get(firstDescriptor.key).enabled = false;
        const tagId = mod.createTag('Pinned');
        mod.setSourceTagIds(firstDescriptor.key, [tagId]);

        const newRenamedRow = createMockSourceRow({ title: 'Renamed Source', stableToken: 'new-doc', checked: true });
        const newAnchorRow = createMockSourceRow({ title: 'Anchor Source', stableToken: 'anchor-doc', checked: true });
        const renamedDescriptor = mod.createSourceDescriptor(newRenamedRow.row, new Map(), new Map());
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [newRenamedRow.row, newAnchorRow.row] : []
        ));

        mod.scanAndSyncSources(null, false);

        expect(mod.groupsById.get('group1').children).toEqual([]);
        expect(mod.sourcesByKey.get(renamedDescriptor.key).enabled).toBe(true);
        expect(mod.getSourceTagIds(renamedDescriptor.key)).toEqual([]);
    });

    it('leaves ambiguous remaps ungrouped instead of guessing', () => {
        const oldRows = [
            createMockSourceRow({ title: 'Duplicate Source', stableToken: 'doc-a', checked: true }),
            createMockSourceRow({ title: 'Duplicate Source', stableToken: 'doc-b', checked: true })
        ];
        const newRows = [
            createMockSourceRow({ title: 'Duplicate Source', stableToken: null, checked: true }),
            createMockSourceRow({ title: 'Duplicate Source', stableToken: null, checked: true })
        ];

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? oldRows.map(({ row }) => row) : []
        ));
        mod.scanAndSyncSources(null, true);

        const oldKeys = Array.from(mod.sourcesByKey.keys());
        mod.state.groups = ['group1'];
        mod.state.ungrouped = [];
        mod.groupsById.set('group1', {
            id: 'group1',
            title: 'Pinned',
            children: [{ type: 'source', key: oldKeys[0] }]
        });

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? newRows.map(({ row }) => row) : []
        ));
        mod.scanAndSyncSources(null, false);

        expect(mod.groupsById.get('group1').children).toEqual([]);
        expect(mod.state.ungrouped).toHaveLength(2);
    });

    it('detects persisted source refs even when the DOM is not ready yet', () => {
        expect(mod.hasPersistedSourceRefs({
            groupsById: {
                group1: {
                    id: 'group1',
                    children: [{ type: 'source', key: 'source1' }]
                }
            }
        })).toBe(true);

        expect(mod.hasPersistedSourceRefs({
            groupsById: {},
            ungrouped: [],
            sourceStateById: {}
        })).toBe(false);
    });

    it('renders the persisted source snapshot until source rows exist on the first restore', () => {
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
                    nativeLabelTitle: 'AI Group',
                    fingerprint: 'deferred source||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));

        expect(mod.hasRenderableSourceRows()).toBe(false);
        expect(mod.hasPersistedSourceRefs(loadedState)).toBe(true);
        expect(mod._getPendingInitialLoadedState()).toBe(null);

        const result = mod.restoreInitialLoadedState(loadedState);

        expect(result).toEqual({ deferred: true, shouldUpgradeStorage: false });
        expect(mod._getPendingInitialLoadedState()).toEqual(loadedState);
        expect(mod.state.groups).toEqual(['group1']);
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: 'source_id_doc-1' }]);
        expect(mod.sourcesByKey.get('source_id_doc-1')).toMatchObject({
            title: 'Deferred Source',
            enabled: false,
            nativeLabelTitle: 'AI Group',
            hasNativeCheckbox: false,
            isPendingNativeHydration: true
        });
    });

    it('keeps the persisted snapshot when initial DOM only exposes a loading source row', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const loadingRow = createMockSourceRow({
            title: 'New Loading Source',
            hasCheckbox: false,
            loading: true
        });
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
            ungrouped: ['source_id_doc-2'],
            sourceStateById: {
                'source_id_doc-1': {
                    enabled: true,
                    title: 'Existing Source A',
                    normalizedTitle: 'existing source a',
                    stableToken: 'doc-1',
                    fingerprint: 'existing source a||article',
                    identityType: 'stable-token'
                },
                'source_id_doc-2': {
                    enabled: true,
                    title: 'Existing Source B',
                    normalizedTitle: 'existing source b',
                    stableToken: 'doc-2',
                    fingerprint: 'existing source b||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [loadingRow.row] : []
        ));

        expect(mod.restoreInitialLoadedState(loadedState)).toEqual({
            deferred: true,
            shouldUpgradeStorage: false
        });

        expect(mod._getPendingInitialLoadedState()).toEqual(loadedState);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: 'source_id_doc-1' }]);
        expect(mod.state.ungrouped).toEqual(['source_id_doc-2']);
        expect(Array.from(mod.sourcesByKey.keys()).sort()).toEqual([
            'source_id_doc-1',
            'source_id_doc-2'
        ].sort());
        expect(Array.from(mod.sourcesByKey.keys()).some((key) => key.includes('new_loading_source'))).toBe(false);
    });

    it('restores deferred initial source refs once source rows become available', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
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
                    fingerprint: 'deferred source||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        const row = createMockSourceRow({ title: 'Deferred Source', stableToken: 'doc-1', checked: true });

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        mod.restoreInitialLoadedState(loadedState);

        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [row.row] : []
        ));
        const result = mod._flushPendingInitialLoadedStateForTest();
        const restoredKey = Array.from(mod.sourcesByKey.keys())[0];

        expect(result).toEqual({ restored: true, deferred: false, shouldUpgradeStorage: false });
        expect(mod._getPendingInitialLoadedState()).toBe(null);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: restoredKey }]);
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.sourcesByKey.get(restoredKey).enabled).toBe(false);
    });

    it('flushes deferred initial state once the initial load gate opens and rows already exist', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
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
                    fingerprint: 'deferred source||article',
                    identityType: 'stable-token'
                }
            },
            tagsById: {},
            tagOrder: [],
            sourceTagsById: {}
        };
        const row = createMockSourceRow({ title: 'Deferred Source', stableToken: 'doc-1', checked: true });

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        expect(mod.restoreInitialLoadedState(loadedState)).toEqual({
            deferred: true,
            shouldUpgradeStorage: false
        });

        mod._setAwaitingInitialStateLoadForTest(true);
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [row.row] : []
        ));

        mod._debouncedScanAndSyncForTest();
        expect(mod.state.groups).toEqual(['group1']);
        expect(mod._getPendingInitialLoadedState()).toEqual(loadedState);

        expect(() => mod._completeInitialStateLoadForTest()).not.toThrow();

        const restoredKey = Array.from(mod.sourcesByKey.keys())[0];
        expect(mod._getAwaitingInitialStateLoadForTest()).toBe(false);
        expect(mod._getPendingInitialLoadedState()).toBe(null);
        expect(mod.groupsById.get('group1').children).toEqual([{ type: 'source', key: restoredKey }]);
        expect(mod.state.ungrouped).toEqual([]);
        expect(mod.sourcesByKey.get(restoredKey).enabled).toBe(false);
    });
});

describe('syncSourceToPage', () => {
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

    it('recovers detached checkboxes via findFreshCheckbox and drains the queue', () => {
        const staleCheckbox = { checked: false, click: jest.fn() };
        const staleRow = {
            querySelector: jest.fn(() => staleCheckbox)
        };
        const freshRow = createMockSourceRow({
            title: 'Synced Source',
            stableToken: 'doc-sync',
            checked: false
        });
        const descriptor = mod.createSourceDescriptor(freshRow.row, new Map(), new Map());
        const source = {
            ...descriptor,
            element: staleRow
        };

        mod.sourcesByKey.set(descriptor.key, source);
        global.document.body.contains = jest.fn((node) => node !== staleCheckbox);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [freshRow.row] : []
        ));

        mod.syncSourceToPage(source, true);

        expect(freshRow.checkbox.click).toHaveBeenCalledTimes(1);
        expect(staleCheckbox.click).not.toHaveBeenCalled();
        expect(mod._getClickQueueLength()).toBe(0);
        expect(mod._getIsSyncingState()).toBe(false);
    });

    it('prefers the current fresh list row over a stale stored source element', () => {
        const staleCheckbox = { checked: true, click: jest.fn() };
        const staleRow = {
            querySelector: jest.fn(() => staleCheckbox)
        };
        const freshRow = createMockSourceRow({
            title: 'Synced Source',
            stableToken: 'doc-sync',
            checked: true
        });
        const descriptor = mod.createSourceDescriptor(freshRow.row, new Map(), new Map());
        const source = {
            ...descriptor,
            element: staleRow
        };

        mod.sourcesByKey.set(descriptor.key, source);
        global.document.body.contains = jest.fn(() => true);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [freshRow.row] : []
        ));

        mod.syncSourceToPage(source, false);

        expect(freshRow.checkbox.click).toHaveBeenCalledTimes(1);
        expect(staleCheckbox.click).not.toHaveBeenCalled();
        expect(source.element).toBe(freshRow.row);
        expect(mod._getClickQueueLength()).toBe(0);
    });

    it('does not sync an individual plugin source checkbox while the native panel is still label view', () => {
        const staleCheckbox = { checked: true, click: jest.fn() };
        const staleRow = {
            querySelector: jest.fn(() => staleCheckbox)
        };
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
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        labelGroup.parentElement = panel;
        labelGroup.parentNode = panel;
        panel.querySelectorAll = jest.fn((selector) => {
            const value = String(selector);
            if (value.includes('source-label') || value.includes('label-group')) return [labelGroup];
            return [];
        });
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));

        const source = {
            key: 'source-1',
            title: 'Synced Source',
            enabled: false,
            element: staleRow
        };

        expect(mod.syncSourceToPage(source, false)).toBe(false);

        expect(staleCheckbox.click).not.toHaveBeenCalled();
        expect(mod.getDiagnosticsInfo().lastNativeSelectionSyncFailure).toEqual(expect.objectContaining({
            sourceKey: 'source-1',
            reason: 'not_list_view',
            detectedSourceViewKind: 'label'
        }));
    });

    it('syncs current list rows that expose ARIA checkbox state instead of input.checked', () => {
        const ariaCheckbox = {
            nodeType: 1,
            tagName: 'DIV',
            checked: undefined,
            textContent: '',
            click: jest.fn(() => {
                ariaCheckbox.getAttribute = jest.fn((attr) => {
                    if (attr === 'role') return 'checkbox';
                    if (attr === 'aria-checked') return 'false';
                    return null;
                });
            }),
            getAttribute: jest.fn((attr) => {
                if (attr === 'role') return 'checkbox';
                if (attr === 'aria-checked') return 'true';
                return null;
            }),
            matches: jest.fn((selector) => String(selector).includes('[role="checkbox"]')),
            closest: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
        const row = createMockSourceRow({
            title: 'ARIA Synced Source',
            stableToken: 'aria-sync',
            checked: true
        });
        row.row.querySelector = jest.fn((selector) => (
            String(selector).includes('[role="checkbox"]') ? ariaCheckbox : null
        ));
        const descriptor = mod.createSourceDescriptor(row.row, new Map(), new Map());
        const source = {
            ...descriptor,
            checkbox: ariaCheckbox,
            hasNativeCheckbox: true,
            element: row.row
        };
        mod.sourcesByKey.set(descriptor.key, source);

        global.document.body.contains = jest.fn(() => true);
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? row.row.parentElement : null
        ));
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [row.row] : []
        ));

        expect(mod.syncSourceToPage(source, false)).toBe(true);

        expect(ariaCheckbox.click).toHaveBeenCalledTimes(1);
        expect(mod.getDiagnosticsInfo().lastNativeSelectionSyncFailure).toBe(null);
    });
});

describe('findFreshCheckbox', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();

        global.queueMicrotasks = [];
        global.queueMicrotask = jest.fn((cb) => {
            global.queueMicrotasks.push(cb);
        });
        global.processMicrotasks = () => {
            const tasks = [...global.queueMicrotasks];
            global.queueMicrotasks = [];
            tasks.forEach(cb => cb());
        };

        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('returns null if sourceKey is not found in sourcesByKey', () => {
        expect(mod.findFreshCheckbox('invalidKey')).toBeNull();
    });

    it('populates freshRowCache and finds the correct checkbox', () => {
        const mockRow = createMockSourceRow({
            title: 'Test Document',
            stableToken: 'doc-1',
            checked: true
        });
        const descriptor = mod.createSourceDescriptor(mockRow.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, descriptor);

        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) {
                return [mockRow.row];
            }
            return [];
        });

        const result = mod.findFreshCheckbox(descriptor.key);

        expect(result).toBe(mockRow.checkbox);
        expect(mod._getFreshRowCache()).toBeInstanceOf(Map);
        expect(mod._getFreshRowCache().get(descriptor.key)).toEqual(expect.objectContaining({
            row: mockRow.row,
            checkbox: mockRow.checkbox,
            identity: expect.objectContaining({
                stableToken: descriptor.stableToken
            })
        }));
        expect(global.queueMicrotask).not.toHaveBeenCalled();
    });

    it('returns null if no unique identity match exists', () => {
        const mockRowA = createMockSourceRow({
            title: 'Looking For This',
            stableToken: null,
            checked: true
        });
        const mockRowB = createMockSourceRow({
            title: 'Looking For This',
            stableToken: null,
            checked: false
        });
        const descriptor = mod.createSourceDescriptor(mockRowA.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, descriptor);

        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) {
                return [mockRowA.row, mockRowB.row];
            }
            return [];
        });

        const result = mod.findFreshCheckbox(descriptor.key);

        expect(result).toBeNull();
    });

    it('does not reuse ambiguous fingerprint matches', () => {
        const mockRowA = createMockSourceRow({
            title: 'Duplicate Source',
            stableToken: null,
            checked: true
        });
        const mockRowB = createMockSourceRow({
            title: 'Duplicate Source',
            stableToken: null,
            checked: false
        });
        const descriptor = mod.createSourceDescriptor(mockRowA.row, new Map(), new Map());
        mod.sourcesByKey.set(descriptor.key, descriptor);

        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) {
                return [mockRowA.row, mockRowB.row];
            }
            return [];
        });

        expect(mod.findFreshCheckbox(descriptor.key)).toBeNull();
    });

    it('clears freshRowCache when mutation observer triggers', () => {
        const sourceTitle = 'Temp Title';
        mod.sourcesByKey.set('source3', { key: 'source3', title: sourceTitle });

        const mockTitleEl = { textContent: sourceTitle };
        const mockRow = {
            querySelector: jest.fn(sel => {
                if (mod.DEPS.title.includes(sel)) return mockTitleEl;
                return null; // Don't even need a checkbox to test cache clearing
            })
        };

        global.document.querySelectorAll = jest.fn(sel => {
            if (mod.DEPS.row.includes(sel)) {
                return [mockRow];
            }
            return [];
        });

        // First call populates cache and queues microtask
        mod.findFreshCheckbox('source3');
        expect(mod._getFreshRowCache()).toBeInstanceOf(Map);

        // Simulate microtask execution
        mod._resetState();

        // Cache should be cleared
        expect(mod._getFreshRowCache()).toBeNull();
    });
});

describe('mutation-driven persistence', () => {
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

    it('skips mutation-driven persistence until the initial storage load finishes', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });

        mod._setProjectId('test-project');
        mod._setAwaitingInitialStateLoadForTest(true);
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));

        mod._debouncedScanAndSyncForTest();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
        expect(mod.state.groups).toEqual([]);
        expect(mod.state.ungrouped).toEqual([]);
    });

    it('skips mutation-driven save when the persistable state is unchanged', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        mod.scanAndSyncSources({}, true);
        global.chrome.runtime.sendMessage.mockClear();

        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('persists mutation-driven sync when the persistable state changes', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'New Source', stableToken: 'doc-2', checked: true });

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [] : []
        ));
        mod.scanAndSyncSources({}, true);
        global.chrome.runtime.sendMessage.mockClear();

        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        mod._debouncedScanAndSyncForTest();
        mod.flushPendingStateSave();

        expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('classifies source text and title attribute mutations as critical sync changes', () => {
        const sourceRow = createMockSourceRow({ title: 'Original Source', stableToken: 'doc-1', checked: true });
        sourceRow.row.nodeType = 1;
        sourceRow.titleEl.nodeType = 1;
        sourceRow.titleEl.matches = jest.fn(() => false);
        sourceRow.titleEl.closest = jest.fn((selector) => (
            selector === '#sources-plus-root' ? null : sourceRow.row
        ));

        expect(mod._getMutationRelevanceForTest({
            type: 'characterData',
            target: { nodeType: 3, parentElement: sourceRow.titleEl }
        })).toEqual({ relevant: true, critical: true });
        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'title',
            target: sourceRow.titleEl
        })).toEqual({ relevant: true, critical: true });
    });

    it('classifies native label view toggle mutations as relevant non-critical sync changes', () => {
        const toggle = {
            nodeType: 1,
            textContent: '复古游戏重制',
            getAttribute: jest.fn((attr) => (attr === 'aria-expanded' ? 'true' : null)),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null)
        };

        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'aria-expanded',
            target: toggle
        })).toEqual({ relevant: true, critical: false });
        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'aria-checked',
            target: toggle
        })).toEqual({ relevant: false, critical: false });

        const labelCheckbox = {
            nodeType: 1,
            tagName: 'INPUT',
            type: 'checkbox',
            textContent: '',
            getAttribute: jest.fn((attr) => (attr === 'type' ? 'checkbox' : null)),
            matches: jest.fn((selector) => String(selector).includes('checkbox')),
            closest: jest.fn(() => null)
        };

        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'aria-checked',
            target: labelCheckbox
        })).toEqual({ relevant: true, critical: false });
    });

    it('ignores ordinary list-view class and style mutations outside source rows', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        sourceRow.row.nodeType = 1;
        sourceRow.row.matches = jest.fn((selector) => mod.DEPS.row.includes(selector));
        sourceRow.row.closest = jest.fn(() => null);
        global.document.querySelector = jest.fn(() => panel);
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        expect(mod.getSourceViewInfo(panel).kind).toBe('list');

        const ordinaryContainer = {
            nodeType: 1,
            textContent: '',
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn(() => null),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelector: jest.fn(() => null)
        };

        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'class',
            target: ordinaryContainer
        })).toEqual({ relevant: false, critical: false });
        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'style',
            target: ordinaryContainer
        })).toEqual({ relevant: false, critical: false });
    });

    it('keeps list-view source row attribute mutations relevant', () => {
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        sourceRow.row.nodeType = 1;
        sourceRow.row.matches = jest.fn((selector) => mod.DEPS.row.includes(selector));
        sourceRow.row.closest = jest.fn(() => null);

        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'class',
            target: sourceRow.row
        })).toEqual({ relevant: true, critical: false });
        expect(mod._getMutationRelevanceForTest({
            type: 'attributes',
            attributeName: 'data-source-id',
            target: sourceRow.row
        })).toEqual({ relevant: true, critical: true });
    });

    it('does not resync for repeated irrelevant list-view class and style mutations', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Pinned Source', stableToken: 'doc-1', checked: true });
        sourceRow.row.nodeType = 1;
        sourceRow.row.matches = jest.fn((selector) => mod.DEPS.row.includes(selector));
        sourceRow.row.closest = jest.fn(() => null);
        global.document.querySelector = jest.fn(() => panel);
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        mod.scanAndSyncSources({}, true);
        panel.querySelectorAll.mockClear();
        global.chrome.runtime.sendMessage.mockClear();

        const ordinaryContainer = {
            nodeType: 1,
            textContent: '',
            parentElement: panel,
            parentNode: panel,
            getAttribute: jest.fn(() => null),
            matches: jest.fn(() => false),
            closest: jest.fn(() => null),
            querySelector: jest.fn(() => null)
        };
        const mutations = Array.from({ length: 50 }, (_, index) => ({
            type: 'attributes',
            attributeName: index % 2 === 0 ? 'class' : 'style',
            target: ordinaryContainer
        }));

        mod._handleDomChangesForTest(mutations);

        expect(panel.querySelectorAll).not.toHaveBeenCalled();
        expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SAVE_STATE' }),
            expect.any(Function)
        );
    });

    it('does not redetect the native source view once per source during list scans', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const rows = Array.from({ length: 35 }, (_, index) => (
            createMockSourceRow({
                title: `Source ${index + 1}`,
                stableToken: `doc-${index + 1}`,
                checked: true
            }).row
        ));

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn((selector) => (
            selector === '[data-testid="source-panel"]' || selector === '.source-panel' ? panel : null
        ));
        panel.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? rows : []
        ));
        global.document.querySelectorAll = jest.fn(() => []);
        global.document.body.contains = jest.fn(() => true);

        mod.scanAndSyncSources({}, true);

        expect(panel.querySelectorAll.mock.calls.length).toBeLessThanOrEqual(80);
    });

    it('critically saves source title changes detected by mutation-driven sync', () => {
        const { panel } = createMockPanel({ visible: true, contentVisible: true });
        const sourceRow = createMockSourceRow({ title: 'Original Source', stableToken: 'doc-1', checked: true });

        mod._setProjectId('test-project');
        global.document.querySelector = jest.fn(() => panel);
        global.document.querySelectorAll = jest.fn((selector) => (
            mod.DEPS.row.includes(selector) ? [sourceRow.row] : []
        ));
        mod.scanAndSyncSources({}, true);
        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());
        global.chrome.runtime.sendMessage.mockClear();

        sourceRow.titleEl.textContent = 'Renamed Source';
        mod._debouncedScanAndSyncForTest({ critical: true });

        const saveMessage = global.chrome.runtime.sendMessage.mock.calls.find(([message]) => (
            message.type === 'SAVE_STATE'
        ))?.[0];
        expect(saveMessage).toBeTruthy();
        expect(saveMessage).toMatchObject({
            baseRevision: 0,
            critical: true,
            clientSaveId: expect.any(String)
        });
        expect(saveMessage.data._saveRevision).toBeUndefined();
        expect(saveMessage.data._savedAt).toBeUndefined();
        expect(saveMessage.data.sourceStateById[descriptor.key].title).toBe('Renamed Source');
    });

    it('treats missing persistable signatures as a save-required fallback', () => {
        const syncModule = globalThis.NSM_CREATE_CONTENT_SOURCE_SYNC({
            runtime: {
                state: { groups: [], ungrouped: [], tagOrder: [], activeTagId: null },
                sourcesByKey: new Map(),
                sourceTagsById: new Map(),
                groupsById: new Map(),
                parentMap: new Map(),
                keyByElement: new WeakMap()
            },
            debounce: (fn) => Object.assign(fn, {
                flush: () => false,
                cancel: () => {},
                isPending: () => false
            })
        });

        expect(syncModule.getPersistableStateSignature()).toBeNull();
        expect(syncModule.shouldSaveAfterMutationSync(null, null)).toBe(true);
    });
});
