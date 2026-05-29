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

const createRenderTestElement = (tag, attrs = {}, children = []) => {
    const className = attrs.className || attrs.class || '';
    const node = {
        tag,
        attrs,
        nodeType: 1,
        nodeName: String(tag).toUpperCase(),
        tagName: String(tag).toUpperCase(),
        className,
        dataset: Object.assign({}, attrs.dataset || {}),
        childNodes: [],
        children: [],
        disabled: Boolean(attrs.disabled),
        parentNode: null,
        focus: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        classList: {
            contains: jest.fn((value) => String(className).split(/\s+/).includes(value))
        },
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
        cloneNode() {
            return this;
        },
        getAttribute(name) {
            if (name === 'class') return this.className || null;
            if (name === 'style') return this.attrs.style || null;
            if (name === 'data-count-id') return this.dataset.countId || null;
            if (name === 'data-count-value') return this.dataset.countValue || null;
            return this.attrs[name] ?? null;
        },
        setAttribute(name, value) {
            this.attrs[name] = value;
            if (name === 'class') this.className = value;
            if (name === 'style') this.attrs.style = value;
        },
        hasAttribute(name) {
            if (name === 'class') return Boolean(this.className);
            if (name === 'style') return Object.prototype.hasOwnProperty.call(this.attrs, 'style');
            if (name === 'data-count-id') return Boolean(this.dataset.countId);
            if (name === 'data-count-value') return Boolean(this.dataset.countValue);
            return Object.prototype.hasOwnProperty.call(this.attrs, name);
        },
        removeAttribute(name) {
            delete this.attrs[name];
        },
        querySelectorAll(selector) {
            const results = [];
            const matches = (candidate) => {
                if (!candidate || typeof candidate !== 'object') return false;
                const classes = String(candidate.className || '').split(/\s+/);
                if (selector === '.sp-source-actions-menu') return classes.includes('sp-source-actions-menu');
                if (selector === '.sp-source-actions-menu-item') return classes.includes('sp-source-actions-menu-item');
                if (selector === '.sp-count-up-number[data-count-id]') {
                    return classes.includes('sp-count-up-number') && Boolean(candidate.dataset?.countId);
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

    Object.defineProperty(node, 'textContent', {
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

    children.forEach((child) => node.appendChild(child));
    return node;
};

const createRenderTestFragment = () => ({
    childNodes: [],
    appendChild(node) {
        this.childNodes.push(node);
        return node;
    }
});

const findRenderTestNodesByClass = (root, className) => {
    const matches = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (String(node.className || '').split(/\s+/).includes(className)) {
            matches.push(node);
        }
        (node.childNodes || []).forEach(visit);
    };
    visit(root);
    return matches;
};

describe('toolbar search UI', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('stays collapsed by default and expands into the morph search rail on the first magnifier click', () => {
        const {
            shadowRoot,
            controls,
            searchCluster,
            searchContainer,
            searchInput,
            searchButton,
            searchCloseButton
        } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);

        mod._syncSearchUi();
        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', false);
        expect(searchCluster.classList.toggle).toHaveBeenCalledWith('is-search-expanded', false);
        expect(searchContainer.classList.toggle).toHaveBeenCalledWith('is-expanded', false);
        expect(searchInput.tabIndex).toBe(-1);
        expect(searchButton.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
        expect(searchCloseButton.classList.toggle).toHaveBeenCalledWith('is-visible', false);

        controls.classList.toggle.mockClear();
        searchCluster.classList.toggle.mockClear();
        searchContainer.classList.toggle.mockClear();
        searchCloseButton.classList.toggle.mockClear();
        const result = mod._handleSearchButtonClick(jest.fn());

        expect(result).toBe('expanded');
        expect(mod._getIsSearchExpanded()).toBe(true);
        expect(searchInput.focus).toHaveBeenCalled();
        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', true);
        expect(searchCluster.classList.toggle).toHaveBeenCalledWith('is-search-expanded', true);
        expect(searchContainer.classList.toggle).toHaveBeenCalledWith('is-expanded', true);
        expect(searchCloseButton.classList.toggle).toHaveBeenCalledWith('is-visible', true);
    });

    it('collapses on a second magnifier click when the query is empty', () => {
        const { shadowRoot, controls, searchInput } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);
        mod._setIsSearchExpanded(true);
        searchInput.value = '';

        const result = mod._handleSearchButtonClick(jest.fn());

        expect(result).toBe('collapsed');
        expect(mod._getIsSearchExpanded()).toBe(false);
        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', false);
    });

    it('keeps the search expanded and triggers filtering when the query has content', () => {
        const { shadowRoot, controls, searchInput } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);
        mod._setIsSearchExpanded(true);
        mod.state.filterQuery = 'report';
        searchInput.value = 'report';

        const triggerSearch = jest.fn(() => {
            mod._syncSearchUi();
        });
        const result = mod._handleSearchButtonClick(triggerSearch);

        expect(result).toBe('searched');
        expect(triggerSearch).toHaveBeenCalledTimes(1);
        expect(mod._getIsSearchExpanded()).toBe(true);
        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', true);
    });

    it('keeps the morph search rail expanded when a persisted query is still active', () => {
        const { shadowRoot, controls, searchContainer, searchInput } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);
        mod._setIsSearchExpanded(false);
        mod.state.filterQuery = 'alpha';
        searchInput.value = 'alpha';

        mod._syncSearchUi();

        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', true);
        expect(searchContainer.classList.toggle).toHaveBeenCalledWith('is-expanded', true);
    });

    it('collapses on outside clicks only when the query is empty', () => {
        const { shadowRoot, controls, searchInput } = createSearchUiMock();
        mod._setShadowRootForTest(shadowRoot);
        mod._setIsSearchExpanded(true);

        expect(mod._handleSearchOutsideClick({
            target: { closest: jest.fn(() => null) }
        })).toBe(true);
        expect(mod._getIsSearchExpanded()).toBe(false);
        expect(controls.classList.toggle).toHaveBeenCalledWith('is-search-expanded', false);

        mod._setIsSearchExpanded(true);
        mod.state.filterQuery = 'alpha';
        searchInput.value = 'alpha';
        expect(mod._handleSearchOutsideClick({
            target: { closest: jest.fn(() => null) }
        })).toBe(false);
        expect(mod._getIsSearchExpanded()).toBe(true);
    });

    it('resets expanded search state during notebook route changes', () => {
        const { shadowRoot } = createSearchUiMock();
        mod._setProjectId('old-project');
        mod._setShadowRootForTest(shadowRoot);
        mod._setIsSearchExpanded(true);
        global.window.location.pathname = '/notebook/new-project';

        mod.handleRouteChanged();

        expect(mod._getIsSearchExpanded()).toBe(false);
    });
});

describe('source panel surface color', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('prefers the native panel header background color', () => {
        const { panel, header } = createMockPanel();
        header.__computedStyle = {
            backgroundColor: 'rgb(35, 40, 48)'
        };
        panel.__computedStyle = {
            ...panel.__computedStyle,
            backgroundColor: 'rgb(39, 44, 51)'
        };

        expect(mod.resolveSourcePanelSurfaceColor(panel)).toBe('rgb(35, 40, 48)');
    });

    it('falls back to the panel background when the header is transparent', () => {
        const { panel, header } = createMockPanel();
        header.__computedStyle = {
            backgroundColor: 'transparent'
        };
        panel.__computedStyle = {
            ...panel.__computedStyle,
            backgroundColor: 'rgb(39, 44, 51)'
        };

        expect(mod.resolveSourcePanelSurfaceColor(panel)).toBe('rgb(39, 44, 51)');
    });

    it('applies the resolved surface color to the extension host variable', () => {
        const { panel, header } = createMockPanel();
        const host = {
            style: {
                setProperty: jest.fn(),
                removeProperty: jest.fn()
            }
        };

        header.__computedStyle = {
            backgroundColor: 'rgb(35, 40, 48)'
        };

        expect(mod._applySourcePanelSurfaceColorForTest(host, panel)).toBe('rgb(35, 40, 48)');
        expect(host.style.setProperty).toHaveBeenCalledWith('--sp-panel-bg', 'rgb(35, 40, 48)');
        expect(host.style.removeProperty).not.toHaveBeenCalled();
    });
});

describe('manager shell structure', () => {
    afterEach(() => {
        jest.resetModules();
        delete global.chrome;
        delete global.NSM_CONTENT_STYLE_TEXT;
    });

    it('keeps the top controls split into toolbar actions and a morph search rail', () => {
        const createManagerShell = require('../../src/content/content-template.js');
        const shell = createManagerShell(createTreeEl, {
            i18n: {
                getMessage: (key) => key
            }
        });

        const controls = shell.children[0];
        const actionsGroup = controls.children[0];
        const searchRail = controls.children[1];
        const searchTrigger = searchRail.children[0];
        const searchSurface = searchRail.children[1];
        const searchClose = searchRail.children[2];

        expect(controls.attrs.className).toBe('sp-controls');
        expect(actionsGroup.attrs.className).toBe('sp-toolbar-actions');
        expect(actionsGroup.children).toHaveLength(4);
        expect(actionsGroup.children.map((child) => child.attrs.id)).toEqual([
            'sp-settings-btn',
            'sp-new-group-btn',
            'sp-manage-tags-btn',
            'sp-batch-action-btn'
        ]);
        expect(searchRail.attrs.className).toBe('sp-search-cluster');
        expect(searchTrigger.attrs.id).toBe('sp-search-btn');
        expect(searchSurface.attrs.className).toBe('sp-search-container');
        expect(searchSurface.children[0].attrs.id).toBe('sp-search');
        expect(searchSurface.children[1].attrs.id).toBe('sp-search-count');
        expect(searchClose.attrs.id).toBe('sp-search-close-btn');
        expect(shell.children[1].attrs.id).toBe('sp-quick-view-rail');
        expect(shell.children[1].attrs.className).toBe('sp-quick-view-rail');
    });

    it('exposes the search-results count as a polite live region for screen readers', () => {
        const createManagerShell = require('../../src/content/content-template.js');
        const shell = createManagerShell(createTreeEl, {
            i18n: {
                getMessage: (key) => key
            }
        });

        const searchSurface = shell.children[0].children[1].children[1];
        const searchCount = searchSurface.children[1];

        expect(searchCount.attrs.id).toBe('sp-search-count');
        expect(searchCount.attrs['aria-live']).toBe('polite');
        expect(searchCount.attrs['aria-atomic']).toBe('true');
    });

    it('keeps the toolbar controls defined as a single-row flex layout', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-controls {');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('display: flex;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('flex-wrap: nowrap;');
    });

    it('collapses the leading toolbar buttons when the search rail expands', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-controls.is-search-expanded .sp-toolbar-actions {');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('max-width: 0;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('pointer-events: none;');
    });

    it('keeps the search trigger and rail on the same shared surface palette', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-search-trigger.sp-icon-button,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('background: var(--sp-bg-button);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('border: 1px solid var(--sp-border-light);');
    });

    it('keeps the search rail fully hidden while collapsed so only the round trigger remains', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-search-container {');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('width: 0;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('opacity: 0;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('pointer-events: none;');
    });

    it('gives the batch toolbar toggle an accent-tinted active state like the other toggles', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const block = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-button.sp-toolbar-action.is-active');
        expect(block).toContain('color: var(--sp-accent);');
        expect(block).toContain('background: var(--sp-tag-active-bg);');
    });

    it('loads Google Symbols from the extension asset instead of the remote font host', () => {
        jest.resetModules();
        global.chrome = {
            runtime: {
                getURL: jest.fn((assetPath) => `chrome-extension://test/${assetPath}`)
            }
        };

        require('../../src/content/content-style-text.js');

        expect(global.chrome.runtime.getURL).toHaveBeenCalledWith('src/assets/fonts/google-symbols.woff2');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('fonts.gstatic.com');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('chrome-extension://test/src/assets/fonts/google-symbols.woff2');
    });

    it('reveals hidden group actions on keyboard focus and gives icon buttons visible focus rings', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.group-header:focus-within .sp-add-subgroup-button,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.group-header:focus-within .sp-isolate-button,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.group-header:focus-within .sp-edit-button,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.group-header:focus-within .sp-delete-button');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-source-actions-menu-item:focus-visible,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-caret:focus-visible');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('box-shadow: var(--sp-focus-ring);');
    });

    it('renders folder icon-only controls with button semantics and labels', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/content/content-render.js'), 'utf8');

        expect(source).toContain("className: 'sp-caret'");
        expect(source).toContain("'aria-label': isCollapsed ? getMessage('ui_expand') : getMessage('ui_collapse')");
        expect(source).not.toContain('sp-move-group-up-button');
        expect(source).not.toContain('sp-move-group-down-button');
        expect(source).toContain("className: 'sp-add-subgroup-button sp-glare-hover'");
        expect(source).toContain("'aria-label': getMessage('ui_add_subgroup')");
        expect(source).toContain("className: 'sp-isolate-button sp-glare-hover'");
        expect(source).toContain("'aria-label': getMessage('ui_isolate_group')");
        expect(source).toContain("'aria-pressed': activeIsolationGroupId === group.id ? 'true' : 'false'");
        expect(source).toContain("className: 'sp-edit-button sp-glare-hover'");
        expect(source).toContain("'aria-label': getMessage('ui_rename')");
        expect(source).toContain("className: 'sp-delete-button sp-glare-hover'");
        expect(source).toContain("'aria-label': getMessage('ui_delete_group')");
    });

    it('defines unified content motion tokens and reduced motion handling', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-motion-fast: 120ms;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-motion-base: 180ms;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-motion-medium: 240ms;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-motion-slow: 320ms;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-ease-emphasized: cubic-bezier(0.2, 0.9, 0.25, 1);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('--sp-ease-press: cubic-bezier(0.25, 1, 0.5, 1);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@media (prefers-reduced-motion: reduce)');
        // Reduced-motion must also zero out staggered delays — clamping duration to 1ms
        // alone still leaves toolbar/search/import-item items appearing on an index-based delay.
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('animation-delay: 0ms !important;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('transition-delay: 0ms !important;');
    });

    it('gives source menus and batch surfaces explicit motion', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const sourceActionsMenu = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-source-actions-menu {');
        const sourceActionsMenuItem = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-source-actions-menu-item {');
        const listItemEnter = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.source-item.sp-list-item-enter,');
        const selectedSource = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.source-item.selected-for-batch {');
        const batchActionBar = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-batch-action-bar {');

        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@keyframes sp-menu-surface-enter');
        expect(sourceActionsMenu).toContain('animation: sp-menu-surface-enter var(--sp-motion-medium) var(--sp-ease-emphasized) both;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@keyframes sp-menu-item-enter');
        expect(sourceActionsMenuItem).toContain('animation: sp-menu-item-enter var(--sp-motion-fast) var(--sp-ease-emphasized) backwards;');
        expect(sourceActionsMenuItem).toContain('animation-delay: calc(var(--sp-menu-item-index, 0) * 24ms);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@keyframes sp-list-item-enter');
        expect(listItemEnter).toContain('animation: sp-list-item-enter var(--sp-motion-medium) var(--sp-ease-emphasized) backwards;');
        expect(listItemEnter).toContain('animation-delay: calc(var(--sp-list-item-index, 0) * 18ms);');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('@keyframes sp-batch-selected-pop');
        expect(selectedSource).not.toContain('animation:');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@keyframes sp-batch-bar-enter');
        expect(selectedSource).toContain('transition:');
        expect(batchActionBar).toContain('animation: sp-batch-bar-enter var(--sp-motion-medium) var(--sp-ease-emphasized) both;');
        expect(batchActionBar).toContain('transition:');
    });

    it('scopes the newly-created folder pop so it can win the cascade over list-item-enter', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');
        const css = global.NSM_CONTENT_STYLE_TEXT;

        // A new folder gets BOTH `sp-list-item-enter` and `sp-folder-enter` on a
        // `.group-container`. The pop rule must match the same `.group-container.X`
        // specificity (and come later) as `.group-container.sp-list-item-enter`, or the
        // list-item-enter animation overrides it and `sp-folder-pop` never plays.
        const block = extractCssBlock(css, '.group-container.sp-folder-enter {');
        expect(block).toContain('animation: sp-folder-pop');
        expect(css).toContain('@keyframes sp-folder-pop');
        // The bare low-specificity selector that lost the cascade must be gone.
        expect(css).not.toMatch(/\n\s*\.sp-folder-enter\s*\{/);
    });

    it('defines modal option stagger motion and reduced-motion fallbacks', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const modalItemEnter = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-folder-option,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('@keyframes sp-modal-item-enter');
        expect(modalItemEnter).toContain('animation: sp-modal-item-enter var(--sp-motion-medium) var(--sp-ease-emphasized) backwards;');
        expect(modalItemEnter).toContain('animation-delay: calc(var(--sp-modal-item-index, 0) * 24ms);');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.source-item.sp-list-item-enter,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.group-container.sp-list-item-enter,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-tag-manage-item,');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.source-item.selected-for-batch,');
    });

    it('defines spotlight and glow motion without decorative hover glare or vertical lift', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const spotlight = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.source-item.sp-spotlight-surface::before,');
        const batchActionBar = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-batch-action-bar {');
        const dangerDelete = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-delete-button:hover {');
        const dangerConfirm = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-confirm-delete-btn:hover {');

        expect(spotlight).toContain('radial-gradient(');
        expect(spotlight).toContain('circle at var(--sp-spotlight-x, 50%) var(--sp-spotlight-y, 50%)');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-glare-hover::after {')).toBe('');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('.sp-glare-hover:hover::after');
        expect(batchActionBar).toContain('0 0 18px var(--sp-batch-glow)');
        expect(dangerDelete).toContain('var(--sp-danger-glow)');
        expect(dangerConfirm).toContain('var(--sp-danger-glow)');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('translateY(-1px)');
    });

    it('defines count-up number styling and keeps the batch cancel button unsqueezed', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const countUpNumber = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-count-up-number {');
        const cancelBatchButton = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-cancel-batch-btn {');
        expect(countUpNumber).toContain('display: inline-block;');
        expect(countUpNumber).toContain('font-variant-numeric: tabular-nums;');
        expect(countUpNumber).toContain('min-width: 1ch;');
        expect(cancelBatchButton).toContain('flex: 0 0 auto;');
        expect(cancelBatchButton).toContain('min-width: 72px;');
    });

    it('uses property-level transitions for core interactive content controls', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        [
            '.sp-icon-button {',
            '.sp-button {',
            '.source-item, .group-header {',
            '.sp-source-actions-menu-item {',
            '.sp-folder-option {',
            '.sp-tag-option,',
            '.sp-tag-row-button {',
            '.sp-toast {',
            '.sp-folder-modal {'
        ].forEach((selector) => {
            const block = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, selector);
            expect(block).toBeTruthy();
            expect(block).not.toContain('transition: all');
        });
    });

    it('keeps modal typography on the content panel system font stack', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const modalBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-folder-modal {');
        expect(modalBlock).toContain('font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;');
    });

    it('styles welcome onboarding with shared tokens instead of fixed theme colors', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const modalBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-welcome-modal {');
        const feedbackBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-welcome-feedback-inline {');
        const feedbackNoteBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-welcome-feedback-copy {');
        const feedbackLinkBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-welcome-feedback-link {');
        const primaryBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-welcome-primary-btn {');
        expect(modalBlock).toContain('width: min(520px, calc(100vw - 32px));');
        expect(modalBlock).not.toContain('#');
        expect(feedbackBlock).toContain('display: flex;');
        expect(feedbackBlock).not.toContain('background');
        expect(feedbackBlock).not.toContain('border:');
        expect(feedbackNoteBlock).toContain('font-size: 11px;');
        expect(feedbackNoteBlock).toContain('var(--sp-text-tertiary)');
        expect(feedbackLinkBlock).toContain('font-size: 11px;');
        expect(feedbackLinkBlock).toContain('color: var(--sp-accent)');
        expect(feedbackLinkBlock).not.toContain('border: 1px');
        expect(feedbackBlock).not.toContain('#');
        expect(primaryBlock).toContain('background-color: var(--sp-accent)');
        expect(primaryBlock).toContain('color: var(--sp-text-toast)');
        expect(primaryBlock).not.toContain('#');
        expect(primaryBlock).not.toContain('white');
    });

    it('places settings save status in the modal header', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const headerBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-settings-modal-header {');
        const statusWrapperBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-settings-save-status-header {');
        const statusBlock = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-settings-save-status-header .sp-save-status {');

        expect(headerBlock).toContain('display: flex;');
        expect(headerBlock).toContain('align-items: center;');
        expect(headerBlock).toContain('justify-content: space-between;');
        expect(statusWrapperBlock).toContain('margin-left: auto;');
        expect(statusBlock).toContain('max-width: 240px;');
    });

    it('keeps hover feedback as subtle scale without vertical lift', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-button:hover {')).toContain('transform: scale(1.02);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.source-item:hover, .group-header:hover {')).toContain('transform: scale(1.01);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-source-actions-menu-item:hover {')).toContain('transform: scale(1.02);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-folder-option:hover,')).toContain('transform: scale(1.02);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-tag-option:hover,')).toContain('transform: scale(1.01);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-modal-cancel:hover {')).toContain('transform: scale(1.02);');
        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-button::after {')).toBe('');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('.sp-button:hover::after');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('translateY(-1px)');
    });

    it('includes compact native label view styles', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        expect(extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-container.is-native-label-view {')).toContain('min-height: 0;');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-container.is-native-label-view #sources-list');
        expect(global.NSM_CONTENT_STYLE_TEXT).toContain('.sp-container.is-native-label-view .sp-resizer');
        expect(global.NSM_CONTENT_STYLE_TEXT).not.toContain('.sp-container.is-native-label-view .sp-resizer {\n                display: none;');
    });

    it('keeps quick view pills and the final source row away from panel clipping edges', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const quickViewRail = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-quick-view-rail {');
        const quickViewButton = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-quick-view-btn {');
        const sourceList = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '\n            #sources-list {');

        expect(quickViewRail).toContain('min-height: 44px;');
        expect(quickViewRail).toContain('padding: 8px 8px 6px;');
        expect(quickViewRail).toContain('scroll-padding-inline: 8px;');
        expect(quickViewButton).toContain('appearance: none;');
        expect(quickViewButton).toContain('-webkit-appearance: none;');
        expect(quickViewButton).toContain('display: inline-flex;');
        expect(quickViewButton).toContain('height: 30px;');
        expect(quickViewButton).toContain('padding: 0 12px;');
        expect(sourceList).toContain('--sp-source-list-bottom-safe-area: 28px;');
        expect(sourceList).toContain('padding-bottom: var(--sp-source-list-bottom-safe-area);');
        expect(sourceList).toContain('scroll-padding-bottom: var(--sp-source-list-bottom-safe-area);');
    });

    it('removes quick view rail layout space when every quick view button is hidden', () => {
        jest.resetModules();
        require('../../src/content/content-style-text.js');

        const hiddenQuickViewRail = extractCssBlock(global.NSM_CONTENT_STYLE_TEXT, '.sp-quick-view-rail[hidden] {');

        expect(hiddenQuickViewRail).toContain('display: none;');
    });
});

describe('batch count and source menu motion rendering', () => {
    let createContentRender;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        createContentRender = require('../../src/content/content-render.js');
    });

    afterEach(teardownGlobalMocks);

    it('renders quick view buttons with active state before source rows', () => {
        const quickRail = createRenderTestElement('div', { id: 'sp-quick-view-rail' });
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                appendChild: jest.fn(),
                querySelector: jest.fn((selector) => {
                    if (selector === '#sources-list') return listContainer;
                    if (selector === '.sp-container') return createRenderTestElement('div', { className: 'sp-container' });
                    return null;
                }),
                getElementById: jest.fn((id) => {
                    if (id === 'sources-list') return listContainer;
                    if (id === 'sp-quick-view-rail') return quickRail;
                    return null;
                })
            }),
            getState: () => ({
                groups: [],
                ungrouped: [],
                isBatchMode: false,
                activeQuickViewKind: 'recent',
                activeTagId: null
            }),
            getMessage: (key) => key
        });

        renderModule.render();

        const buttons = findRenderTestNodesByClass(quickRail, 'sp-quick-view-btn');
        expect(buttons.map((button) => button.dataset.quickViewKind)).toEqual([
            'all',
            'ungrouped',
            'disabled',
            'tag',
            'recent',
            'issues'
        ]);
        expect(buttons.find((button) => button.dataset.quickViewKind === 'recent').attrs['aria-pressed']).toBe('true');
        expect(buttons.find((button) => button.dataset.quickViewKind === 'all').attrs['aria-pressed']).toBe('false');
    });

    it('reflects batch mode on the persistent batch toggle button via aria-pressed and is-active', () => {
        // The batch toggle persists in the static toolbar shell, so each render()
        // must sync its pressed/active state. Render each state into its own fresh
        // (empty) list container so patchChildren stays on the append path.
        const renderOnceWithBatchMode = (isBatchMode) => {
            const listContainer = createRenderTestElement('div', { id: 'sources-list' });
            const batchClasses = new Set(['sp-button', 'sp-toolbar-action']);
            const batchToggleBtn = {
                attrs: {},
                classList: {
                    toggle: (cls, force) => { if (force) batchClasses.add(cls); else batchClasses.delete(cls); },
                    contains: (cls) => batchClasses.has(cls)
                },
                setAttribute(name, value) { this.attrs[name] = value; }
            };
            const renderModule = createContentRender({
                el: createRenderTestElement,
                getDocument: () => ({
                    createDocumentFragment: createRenderTestFragment,
                    createElement: (tag) => createRenderTestElement(tag)
                }),
                getShadowRoot: () => ({
                    appendChild: jest.fn(),
                    querySelector: jest.fn((selector) => {
                        if (selector === '#sources-list') return listContainer;
                        if (selector === '.sp-container') return createRenderTestElement('div', { className: 'sp-container' });
                        return null;
                    }),
                    getElementById: jest.fn((id) => {
                        if (id === 'sources-list') return listContainer;
                        if (id === 'sp-batch-action-btn') return batchToggleBtn;
                        return null;
                    })
                }),
                getState: () => ({ groups: [], ungrouped: [], isBatchMode, activeTagId: null }),
                getMessage: (key) => key
            });
            renderModule.render();
            return batchToggleBtn;
        };

        const active = renderOnceWithBatchMode(true);
        expect(active.attrs['aria-pressed']).toBe('true');
        expect(active.classList.contains('is-active')).toBe(true);

        const inactive = renderOnceWithBatchMode(false);
        expect(inactive.attrs['aria-pressed']).toBe('false');
        expect(inactive.classList.contains('is-active')).toBe(false);
    });

    it('renders only the configured quick view buttons and hides the rail when none are visible', () => {
        const quickRail = createRenderTestElement('div', { id: 'sp-quick-view-rail' });
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        let visibleQuickViewKinds = ['all', 'issues'];
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                appendChild: jest.fn(),
                querySelector: jest.fn((selector) => {
                    if (selector === '#sources-list') return listContainer;
                    if (selector === '.sp-container') return createRenderTestElement('div', { className: 'sp-container' });
                    return null;
                }),
                getElementById: jest.fn((id) => {
                    if (id === 'sources-list') return listContainer;
                    if (id === 'sp-quick-view-rail') return quickRail;
                    return null;
                })
            }),
            getState: () => ({
                groups: [],
                ungrouped: [],
                isBatchMode: false,
                activeQuickViewKind: 'issues',
                activeTagId: null
            }),
            getVisibleQuickViewKinds: () => visibleQuickViewKinds,
            getMessage: (key) => key
        });

        renderModule.render();

        expect(findRenderTestNodesByClass(quickRail, 'sp-quick-view-btn').map((button) => button.dataset.quickViewKind)).toEqual([
            'all',
            'issues'
        ]);
        expect(quickRail.hidden).toBe(false);

        visibleQuickViewKinds = [];
        renderModule.renderQuickViewRail();

        expect(findRenderTestNodesByClass(quickRail, 'sp-quick-view-btn')).toHaveLength(0);
        expect(quickRail.hidden).toBe(true);
    });

    it('wraps localized batch counts without changing button text', () => {
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getMessage: (key, substitutions = []) => {
                if (key === 'ui_batch_add_count') return `Add (${substitutions[0]})`;
                if (key === 'ui_delete_count') return `Delete (${substitutions[0]})`;
                return key;
            }
        });

        const addChildren = renderModule.createBatchCountMessageChildren('ui_batch_add_count', 2, 'batch-add');
        const deleteChildren = renderModule.createBatchCountMessageChildren('ui_delete_count', 2, 'batch-delete');
        const addLabel = addChildren.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
        const deleteLabel = deleteChildren.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
        const addCount = addChildren.find((child) => child?.className === 'sp-count-up-number');
        const deleteCount = deleteChildren.find((child) => child?.className === 'sp-count-up-number');

        expect(addLabel).toBe('Add (2)');
        expect(deleteLabel).toBe('Delete (2)');
        expect(addCount.dataset).toEqual({ countId: 'batch-add', countValue: '2' });
        expect(deleteCount.dataset).toEqual({ countId: 'batch-delete', countValue: '2' });
    });

    it('falls back to the plain localized label when a locale does not include the count marker', () => {
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getMessage: (key, substitutions = []) => {
                if (substitutions[0] === '__COUNT__') return 'Add selected';
                return `Add (${substitutions[0]})`;
            }
        });

        expect(renderModule.createBatchCountMessageChildren('ui_batch_add_count', 3, 'batch-add')).toEqual(['Add (3)']);
    });

    it('parses scoped search queries and highlights matching text', () => {
        const renderModule = createContentRender({ el: createRenderTestElement });

        expect(renderModule.parseSearchQuery('alpha tag:paper folder:"Chapter One"')).toMatchObject({
            textTerms: ['alpha'],
            tagTerms: ['paper'],
            folderTerms: ['chapter one'],
            hasQuery: true
        });

        const highlighted = renderModule.createHighlightedTextChildren('Alpha Paper', ['paper']);
        expect(highlighted.map((child) => (typeof child === 'string' ? child : child.textContent))).toEqual([
            'Alpha ',
            'Paper'
        ]);
        expect(highlighted[1].className).toBe('sp-search-highlight');
    });

    it('matches source search against tag labels and folder ancestors', () => {
        const paperTag = { id: 'tag-paper', label: 'Paper' };
        const tagsById = new Map([[paperTag.id, paperTag]]);
        const groupsById = new Map([
            ['folder1', { id: 'folder1', title: 'Chapter One' }]
        ]);
        const parentMap = new Map([['source-1', 'folder1']]);
        const renderModule = createContentRender({
            getTagsById: () => tagsById,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getSourceTagIds: () => [paperTag.id]
        });
        const source = { key: 'source-1', title: 'Notes', lowercaseTitle: 'notes' };

        expect(renderModule.sourceMatchesSearchQuery(source, 'tag:paper')).toBe(true);
        expect(renderModule.sourceMatchesSearchQuery(source, 'folder:chapter')).toBe(true);
        expect(renderModule.sourceMatchesSearchQuery(source, 'missing')).toBe(false);
    });

    it('animates changed batch counts and skips unchanged counts', () => {
        const renderModule = createContentRender({ el: createRenderTestElement });
        const countNode = createRenderTestElement('span', {
            className: 'sp-count-up-number',
            dataset: {
                countId: 'batch-add',
                countValue: '3'
            }
        }, ['3']);
        const container = {
            querySelectorAll: jest.fn(() => [countNode])
        };

        expect(renderModule.animateBatchCountChanges(container, new Map([['batch-add', 1]]))).toBe(1);
        expect(countNode.textContent).toBe('1');
        expect(global.window.requestAnimationFrame).toHaveBeenCalledTimes(1);

        const firstFrame = global.__rafCallbacks.shift();
        firstFrame(0);
        expect(countNode.textContent).toBe('1');

        const finalFrame = global.__rafCallbacks.shift();
        finalFrame(320);
        expect(countNode.textContent).toBe('3');

        global.window.requestAnimationFrame.mockClear();
        expect(renderModule.animateBatchCountChanges(container, new Map([['batch-add', 3]]))).toBe(0);
        expect(global.window.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('collects existing batch count values by stable count id', () => {
        const renderModule = createContentRender({ el: createRenderTestElement });
        const addCount = createRenderTestElement('span', {
            className: 'sp-count-up-number',
            dataset: { countId: 'batch-add', countValue: '4' }
        }, ['4']);
        const deleteCount = createRenderTestElement('span', {
            className: 'sp-count-up-number',
            dataset: { countId: 'batch-delete', countValue: '4' }
        }, ['4']);

        const snapshot = renderModule.collectBatchCountSnapshot({
            querySelectorAll: jest.fn(() => [addCount, deleteCount])
        });

        expect(snapshot).toEqual(new Map([
            ['batch-add', 4],
            ['batch-delete', 4]
        ]));
    });

    it('renders batch action labels without repeated counts and keeps delete count stable', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const pendingBatchKeys = new Set(['source-1', 'source-2']);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: [],
                ungrouped: [],
                isBatchMode: true,
                activeTagId: null
            }),
            getPendingBatchKeys: () => pendingBatchKeys,
            getMessage: (key, substitutions = []) => {
                if (key === 'ui_batch_add') return 'Add';
                if (key === 'ui_batch_add_tags_title') return 'Add Tags';
                if (key === 'ui_batch_remove_tags_title') return 'Remove Tags';
                if (key === 'ui_move_to_ungrouped') return 'Ungroup';
                if (key === 'ui_batch_add_tags_count') return `Add Tags (${substitutions[0]})`;
                if (key === 'ui_batch_remove_tags_count') return `Remove Tags (${substitutions[0]})`;
                if (key === 'ui_batch_ungroup_count') return `Ungroup (${substitutions[0]})`;
                if (key === 'ui_batch_add_count') return `Add (${substitutions[0]})`;
                if (key === 'ui_delete_count') return `Delete (${substitutions[0]})`;
                return key;
            }
        });

        renderModule.render();

        const addFolderButton = findRenderTestNodesByClass(listContainer, 'sp-batch-add-folder-btn')[0];
        const addTagsButton = findRenderTestNodesByClass(listContainer, 'sp-batch-add-tags-btn')[0];
        const removeTagsButton = findRenderTestNodesByClass(listContainer, 'sp-batch-remove-tags-btn')[0];
        const ungroupButton = findRenderTestNodesByClass(listContainer, 'sp-batch-ungroup-btn')[0];
        const deleteButton = findRenderTestNodesByClass(listContainer, 'sp-confirm-delete-btn')[0];
        expect(addFolderButton.textContent).toBe('Add');
        expect(addTagsButton.textContent).toBe('Add Tags');
        expect(removeTagsButton.textContent).toBe('Remove Tags');
        expect(ungroupButton.textContent).toBe('Ungroup');
        expect(deleteButton.textContent).toBe('Delete (2)');
        expect(findRenderTestNodesByClass(addFolderButton, 'sp-count-up-number')).toHaveLength(0);
        expect(findRenderTestNodesByClass(addTagsButton, 'sp-count-up-number')).toHaveLength(0);
        expect(findRenderTestNodesByClass(removeTagsButton, 'sp-count-up-number')).toHaveLength(0);
        expect(findRenderTestNodesByClass(ungroupButton, 'sp-count-up-number')).toHaveLength(0);
        expect(findRenderTestNodesByClass(deleteButton, 'sp-count-up-number')[0].dataset).toEqual({
            countId: 'batch-delete',
            countValue: '2'
        });
    });

    it('keeps the source title in the title grid column while batch mode hides action buttons', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const sourcesByKey = new Map([
            ['source-1', {
                key: 'source-1',
                title: 'https://hai.stanford.edu/assets/files/ai_index_report_2026.pdf',
                enabled: true
            }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: [],
                ungrouped: ['source-1'],
                isBatchMode: true,
                activeTagId: null
            }),
            getSourcesByKey: () => sourcesByKey,
            getMessage: (key) => key
        });

        renderModule.render();

        const source = findRenderTestNodesByClass(listContainer, 'source-item')[0];
        expect(source.childNodes.map((child) => child?.className || child)).toEqual([
            'icon-container',
            'sp-source-actions-anchor sp-source-actions-placeholder',
            'title-container',
            'checkbox-container'
        ]);
        expect(findRenderTestNodesByClass(source, 'sp-source-actions-button')).toHaveLength(0);
        expect(findRenderTestNodesByClass(source, 'source-title-text')[0].textContent).toBe(
            'https://hai.stanford.edu/assets/files/ai_index_report_2026.pdf'
        );
    });

    it('renders visible loading status text for importing sources', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const sourcesByKey = new Map([
            ['loading-source', {
                key: 'loading-source',
                title: 'Temporary upload',
                lowercaseTitle: 'temporary upload',
                enabled: true,
                isLoading: true,
                isDisabled: false,
                hasNativeCheckbox: false
            }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: [],
                ungrouped: ['loading-source'],
                filterQuery: '',
                isBatchMode: false,
                activeTagId: null
            }),
            getSourcesByKey: () => sourcesByKey,
            getMessage: (key) => (
                key === 'ui_source_parsing' ? '正在解析来源...' : key
            )
        });

        renderModule.render();

        const source = findRenderTestNodesByClass(listContainer, 'source-item')[0];
        expect(source.className).toContain('loading-source');
        expect(source.attrs.title).toBe('正在解析来源...');
        expect(findRenderTestNodesByClass(source, 'source-loading-status')[0].textContent).toBe('正在解析来源...');
    });

    it('renders explicit failed sources with failed styling and disabled controls', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const sourcesByKey = new Map([
            ['failed-source', {
                key: 'failed-source',
                title: 'Failed Source',
                lowercaseTitle: 'failed source',
                enabled: true,
                isLoading: false,
                isFailed: true,
                isDisabled: false,
                hasNativeCheckbox: true
            }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: [],
                ungrouped: ['failed-source'],
                filterQuery: '',
                isBatchMode: false,
                activeTagId: null
            }),
            getSourcesByKey: () => sourcesByKey,
            getMessage: (key) => (
                key === 'ui_source_import_failed' ? '来源导入失败' : key
            )
        });

        renderModule.render();

        const source = findRenderTestNodesByClass(listContainer, 'source-item')[0];
        const checkbox = findRenderTestNodesByClass(source, 'sp-checkbox')[0];
        expect(source.className).toContain('failed-source');
        expect(source.attrs.title).toBe('来源导入失败');
        expect(checkbox.disabled).toBe(true);
    });

    it('renders a compact compatibility panel in NotebookLM native label view', () => {
        const container = createRenderTestElement('div', { className: 'sp-container' });
        const viewState = createRenderTestElement('div', { id: 'sp-view-state' });
        viewState.hidden = true;
        const staleGroup = createRenderTestElement('div', { className: 'group-container' }, ['Old plugin folder']);
        const listContainer = createRenderTestElement('div', { id: 'sources-list' }, [staleGroup]);
        const actionLayer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });

        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                if (selector === '#sources-list') return listContainer;
                if (selector === '.sp-container') return container;
                return null;
            }),
            getElementById: jest.fn((id) => {
                if (id === 'sources-list') return listContainer;
                if (id === 'sp-view-state') return viewState;
                if (id === 'sp-source-actions-layer') return actionLayer;
                return null;
            }),
            appendChild: jest.fn()
        };

        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => shadowRoot,
            getSourceViewInfo: () => ({ kind: 'label', confidence: 0.78 }),
            getNativeLabelImportPreview: () => ({ ok: true, labelCount: 2, sourceCount: 4 }),
            getMessage: (key) => {
                if (key === 'ui_native_label_view_active') return 'NotebookLM label view is active';
                if (key === 'ui_import_native_labels') return 'Import NotebookLM groups';
                return key;
            }
        });

        renderModule.render();

        expect(container.className).toContain('is-native-label-view');
        expect(viewState.hidden).toBe(false);
        expect(viewState.textContent).toContain('NotebookLM label view is active');
        expect(viewState.textContent).toContain('Import NotebookLM groups');
        expect(findRenderTestNodesByClass(viewState, 'sp-view-banner-btn')[0].disabled).toBe(false);
        expect(listContainer.childNodes).toHaveLength(0);
    });

    it('keeps native label import button clickable when preview is unavailable', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const viewState = createRenderTestElement('div', { id: 'sp-view-state' });
        const container = createRenderTestElement('div', { className: 'sp-container' });
        const actionLayer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });

        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                if (selector === '#sources-list') return listContainer;
                if (selector === '.sp-container') return container;
                return null;
            }),
            getElementById: jest.fn((id) => {
                if (id === 'sources-list') return listContainer;
                if (id === 'sp-view-state') return viewState;
                if (id === 'sp-source-actions-layer') return actionLayer;
                return null;
            }),
            appendChild: jest.fn()
        };

        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => shadowRoot,
            getSourceViewInfo: () => ({ kind: 'label', confidence: 0.78 }),
            getNativeLabelImportPreview: () => ({ ok: false, reason: 'no_native_labels', labelCount: 0, sourceCount: 0 }),
            getMessage: (key) => {
                if (key === 'ui_native_label_view_active') return 'NotebookLM label view is active';
                if (key === 'ui_import_native_labels') return 'Import NotebookLM groups';
                if (key === 'ui_import_native_labels_unavailable') return 'No groups available';
                return key;
            }
        });

        renderModule.render();

        const importButton = findRenderTestNodesByClass(viewState, 'sp-view-banner-btn')[0];
        expect(importButton.textContent).toBe('Import NotebookLM groups');
        expect(importButton.disabled).toBe(false);
        expect(importButton.attrs.disabled).toBeUndefined();
        expect(importButton.attrs.title).toBe('No groups available');
    });

    it('shows the latest native label import summary in label view', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const viewState = createRenderTestElement('div', { id: 'sp-view-state' });
        const container = createRenderTestElement('div', { className: 'sp-container' });
        const actionLayer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });
        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                if (selector === '#sources-list') return listContainer;
                if (selector === '.sp-container') return container;
                return null;
            }),
            getElementById: jest.fn((id) => {
                if (id === 'sources-list') return listContainer;
                if (id === 'sp-view-state') return viewState;
                if (id === 'sp-source-actions-layer') return actionLayer;
                return null;
            }),
            appendChild: jest.fn()
        };

        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => shadowRoot,
            getSourceViewInfo: () => ({ kind: 'label', confidence: 0.78 }),
            getNativeLabelImportPreview: () => ({ ok: true, labelCount: 1, sourceCount: 2 }),
            getLastNativeLabelImportSummary: () => ({ labelCount: 1, sourceCount: 2 }),
            getMessage: (key, substitutions = []) => {
                if (key === 'ui_native_label_view_active') return 'NotebookLM label view is active';
                if (key === 'ui_import_native_labels') return 'Import NotebookLM groups';
                if (key === 'ui_import_native_labels_imported_status') return `Imported ${substitutions.join('/')}`;
                return key;
            }
        });

        renderModule.render();

        expect(viewState.textContent).toContain('Imported 1/2');
    });

    it('clears saved list height while rendering native label view and restores it after leaving', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const viewState = createRenderTestElement('div', { id: 'sp-view-state' });
        const container = createRenderTestElement('div', { className: 'sp-container' });
        container.style = { height: '820px' };
        const actionLayer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });
        let viewKind = 'label';

        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                if (selector === '#sources-list') return listContainer;
                if (selector === '.sp-container') return container;
                return null;
            }),
            getElementById: jest.fn((id) => {
                if (id === 'sources-list') return listContainer;
                if (id === 'sp-view-state') return viewState;
                if (id === 'sp-source-actions-layer') return actionLayer;
                return null;
            }),
            appendChild: jest.fn()
        };

        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => shadowRoot,
            getSourceViewInfo: () => ({ kind: viewKind, confidence: 0.78 }),
            getNativeLabelImportPreview: () => ({ ok: false }),
            getMessage: (key) => key
        });

        renderModule.render();

        expect(container.className).toContain('is-native-label-view');
        expect(container.style.height).toBe('');
        expect(container.dataset.nativeLabelPreviousHeight).toBe('820px');

        viewKind = 'list';
        renderModule.render();

        expect(container.className).not.toContain('is-native-label-view');
        expect(container.style.height).toBe('820px');
        expect(container.dataset.nativeLabelPreviousHeight).toBeUndefined();
    });

    it('renders plugin folders again after switching from native label view back to list view', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const viewState = createRenderTestElement('div', { id: 'sp-view-state' });
        const container = createRenderTestElement('div', { className: 'sp-container is-native-label-view' });
        container.style = { height: '' };
        container.dataset.nativeLabelPreviousHeight = '360px';
        const actionLayer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });
        const state = {
            groups: ['imported'],
            ungrouped: [],
            filterQuery: '',
            isBatchMode: false,
            activeTagId: null
        };
        const groupsById = new Map([
            ['imported', {
                id: 'imported',
                title: '复古游戏重制',
                enabled: true,
                collapsed: false,
                children: [{ type: 'source', key: 'source-1' }]
            }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', {
                key: 'source-1',
                title: 'Chrono Trigger Notes',
                lowercaseTitle: 'chrono trigger notes',
                enabled: true,
                hasNativeCheckbox: true
            }]
        ]);
        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                if (selector === '#sources-list') return listContainer;
                if (selector === '.sp-container') return container;
                return null;
            }),
            getElementById: jest.fn((id) => {
                if (id === 'sources-list') return listContainer;
                if (id === 'sp-view-state') return viewState;
                if (id === 'sp-source-actions-layer') return actionLayer;
                return null;
            }),
            appendChild: jest.fn()
        };

        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => shadowRoot,
            getSourceViewInfo: () => ({ kind: 'list', confidence: 0.9 }),
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            sourceMatchesCurrentFilters: () => true,
            shouldRenderGroup: () => true,
            getMessage: (key) => key
        });

        renderModule.render();

        expect(container.className).not.toContain('is-native-label-view');
        expect(container.style.height).toBe('360px');
        expect(listContainer.textContent).toContain('复古游戏重制');
        expect(listContainer.textContent).toContain('Chrono Trigger Notes');
    });

    it('auto-expands matching search ancestors without mutating collapsed state', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const state = {
            groups: ['root'],
            ungrouped: [],
            filterQuery: 'alpha',
            isBatchMode: false,
            activeTagId: null
        };
        const rootGroup = {
            id: 'root',
            title: 'Root',
            enabled: true,
            collapsed: true,
            children: [{ type: 'group', id: 'child' }]
        };
        const childGroup = {
            id: 'child',
            title: 'Child',
            enabled: true,
            collapsed: true,
            children: [{ type: 'source', key: 'source-1' }]
        };
        const groupsById = new Map([
            ['root', rootGroup],
            ['child', childGroup]
        ]);
        const sourcesByKey = new Map([
            ['source-1', {
                key: 'source-1',
                title: 'Alpha source',
                lowercaseTitle: 'alpha source',
                enabled: true
            }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            sourceMatchesCurrentFilters: (source) => source.lowercaseTitle.includes(state.filterQuery),
            shouldRenderGroup: () => true,
            getMessage: (key) => key
        });

        expect(renderModule.collectSearchExpandedGroupIds(['root'], 'alpha')).toEqual(new Set(['child', 'root']));
        renderModule.render();

        const childContainers = findRenderTestNodesByClass(listContainer, 'group-children');
        expect(childContainers.every((container) => !String(container.className).includes('collapsed'))).toBe(true);
        expect(rootGroup.collapsed).toBe(true);
        expect(childGroup.collapsed).toBe(true);

        state.filterQuery = '';
        listContainer.childNodes = [];
        listContainer.children = [];
        renderModule.render();
        const restoredChildren = findRenderTestNodesByClass(listContainer, 'group-children');
        expect(restoredChildren.every((container) => String(container.className).includes('collapsed'))).toBe(true);
    });

    it('renders source action menu item stagger indexes for main menu and submenu separately', () => {
        let menuPositionState = { top: 20, left: 10, placement: 'bottom' };
        const layer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });
        const sourcesByKey = new Map([['source-1', {
            key: 'source-1',
            title: 'Source One',
            isLoading: false,
            isDisabled: false
        }]]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment
            }),
            getShadowRoot: () => ({
                getElementById: jest.fn((id) => (id === 'sp-source-actions-layer' ? layer : null))
            }),
            getSourcesByKey: () => sourcesByKey,
            canOpenSourceActionMenu: () => true,
            findSourceActionButton: () => ({}),
            getActiveSourceActionSourceKey: () => 'source-1',
            getActiveSourceActionSubmenuAction: () => 'view-source',
            getSourceActionMenuPosition: () => menuPositionState,
            getSourceActionMenuPositionState: () => menuPositionState,
            setSourceActionMenuPosition: (position) => { menuPositionState = position; },
            getSourceActionSubmenuPosition: () => ({ top: 30, left: 180, horizontalPlacement: 'right' }),
            getMessage: (key) => key,
            getSourceActionMenuItems: () => [
                { action: 'view-source', kind: 'submenu', icon: 'visibility', label: 'View source' },
                { action: 'tags', icon: 'label', label: 'Tags' },
                { action: 'move', icon: 'drive_file_move', label: 'Move' }
            ],
            getSourceActionSubmenuItems: () => [
                { action: 'view-source-details', icon: 'description', label: 'Source details' }
            ]
        });

        renderModule.renderSourceActionMenuLayer();

        const menus = layer.querySelectorAll('.sp-source-actions-menu');
        expect(menus).toHaveLength(2);
        expect(menus[0].querySelectorAll('.sp-source-actions-menu-item').map((item) => item.attrs.style)).toEqual([
            '--sp-menu-item-index:0;',
            '--sp-menu-item-index:1;',
            '--sp-menu-item-index:2;'
        ]);
        expect(menus[1].querySelectorAll('.sp-source-actions-menu-item').map((item) => item.attrs.style)).toEqual([
            '--sp-menu-item-index:0;'
        ]);
    });

    it('renders disabled source action menu items with aria-disabled state', () => {
        const layer = createRenderTestElement('div', { id: 'sp-source-actions-layer' });
        const sourcesByKey = new Map([['source-1', {
            key: 'source-1',
            title: 'Source One',
            isLoading: false,
            isDisabled: false
        }]]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment
            }),
            getShadowRoot: () => ({
                getElementById: jest.fn((id) => (id === 'sp-source-actions-layer' ? layer : null))
            }),
            getSourcesByKey: () => sourcesByKey,
            canOpenSourceActionMenu: () => true,
            findSourceActionButton: () => ({}),
            getActiveSourceActionSourceKey: () => 'source-1',
            getActiveSourceActionSubmenuAction: () => null,
            getSourceActionMenuPosition: () => ({ top: 20, left: 10, placement: 'bottom' }),
            getSourceActionMenuPositionState: () => ({ top: 20, left: 10, placement: 'bottom' }),
            setSourceActionMenuPosition: jest.fn(),
            getMessage: (key) => key,
            getSourceActionMenuItems: () => [
                { action: 'move-ungrouped', icon: 'drive_file_move_rtl', label: 'Move to Ungrouped', disabled: true },
                { action: 'delete-source', icon: 'delete', label: 'Delete', disabled: false }
            ],
            getSourceActionSubmenuItems: () => []
        });

        renderModule.renderSourceActionMenuLayer();

        const items = layer.querySelectorAll('.sp-source-actions-menu-item');
        expect(items[0].disabled).toBe(true);
        expect(items[0].attrs.disabled).toBe(true);
        expect(items[0].attrs['aria-disabled']).toBe('true');
        expect(items[1].disabled).toBe(false);
        expect(items[1].attrs['aria-disabled']).toBeNull();
    });

    it('keeps deleting state as plain text instead of rendering a count span', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/content/content-render.js'), 'utf8');

        expect(source).toContain("? [getMessage('ui_deleting')]");
        expect(source).toContain(": createBatchCountMessageChildren('ui_delete_count', pendingBatchKeys.size, 'batch-delete')");
        expect(source).not.toContain("createBatchCountMessageChildren('ui_batch_add_tags_count'");
        expect(source).not.toContain("createBatchCountMessageChildren('ui_batch_remove_tags_count'");
        expect(source).not.toContain("createBatchCountMessageChildren('ui_batch_ungroup_count'");
    });

    it('tracks spotlight pointer coordinates and clears the active surface on leave', () => {
        const renderModule = createContentRender();
        const styleValues = {};
        const surface = {
            style: {
                setProperty: jest.fn((name, value) => {
                    styleValues[name] = value;
                }),
                removeProperty: jest.fn((name) => {
                    delete styleValues[name];
                })
            },
            classList: {
                add: jest.fn(),
                remove: jest.fn()
            },
            closest: jest.fn(() => surface),
            getBoundingClientRect: jest.fn(() => ({
                left: 10,
                top: 20,
                width: 100,
                height: 50
            }))
        };
        const listContainer = {};

        expect(renderModule.handleSpotlightPointerMove({
            target: surface,
            clientX: 42,
            clientY: 96
        }, listContainer)).toBe(surface);

        expect(styleValues).toEqual({
            '--sp-spotlight-x': '32px',
            '--sp-spotlight-y': '50px'
        });
        expect(surface.classList.add).toHaveBeenCalledWith('is-spotlight-active');
        expect(listContainer.__spActiveSpotlightSurface).toBe(surface);

        expect(renderModule.handleSpotlightPointerLeave({}, listContainer)).toBe(surface);
        expect(surface.classList.remove).toHaveBeenCalledWith('is-spotlight-active');
        expect(surface.style.removeProperty).toHaveBeenCalledWith('--sp-spotlight-x');
        expect(surface.style.removeProperty).toHaveBeenCalledWith('--sp-spotlight-y');
        expect(listContainer.__spActiveSpotlightSurface).toBeNull();
    });

    it('binds spotlight pointer tracking once on the list container', () => {
        const renderModule = createContentRender();
        const listContainer = {
            addEventListener: jest.fn()
        };

        renderModule.bindSpotlightPointerTracking(listContainer);
        renderModule.bindSpotlightPointerTracking(listContainer);

        expect(listContainer.addEventListener).toHaveBeenCalledTimes(2);
        expect(listContainer.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
        expect(listContainer.addEventListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
        expect(listContainer.__spSpotlightTrackingBound).toBe(true);
    });

    it('renders list reveal indexes in visible tree order and caps long-list delay indexes', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const groupsById = new Map([
            ['root', {
                id: 'root',
                title: 'Root',
                enabled: true,
                collapsed: false,
                children: [
                    { type: 'source', key: 'source-1' },
                    { type: 'group', id: 'child' }
                ]
            }],
            ['child', {
                id: 'child',
                title: 'Child',
                enabled: true,
                collapsed: false,
                children: [{ type: 'source', key: 'source-2' }]
            }]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', title: 'Source 1', enabled: true }],
            ['source-2', { key: 'source-2', title: 'Source 2', enabled: true }],
            ['loose', { key: 'loose', title: 'Loose', enabled: true }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: ['root'],
                ungrouped: ['loose'],
                isBatchMode: false,
                activeTagId: null
            }),
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            canOpenSourceActionMenu: () => true,
            getMessage: (key) => key
        });

        renderModule.render();

        const groups = findRenderTestNodesByClass(listContainer, 'group-container');
        const groupHeaders = findRenderTestNodesByClass(listContainer, 'group-header');
        const sources = findRenderTestNodesByClass(listContainer, 'source-item');
        const sourceActionButtons = findRenderTestNodesByClass(listContainer, 'sp-source-actions-button');
        const moveGroupUpButtons = findRenderTestNodesByClass(listContainer, 'sp-move-group-up-button');
        const moveGroupDownButtons = findRenderTestNodesByClass(listContainer, 'sp-move-group-down-button');
        const glareButtons = findRenderTestNodesByClass(listContainer, 'sp-glare-hover');
        expect(groups.map((group) => [group.dataset.groupId, group.attrs.style])).toEqual([
            ['root', 'padding-left: 0px;--sp-list-item-index:0;'],
            ['child', 'padding-left: 20px;--sp-list-item-index:2;']
        ]);
        expect(sources.map((source) => [source.dataset.sourceKey, source.attrs.style])).toEqual([
            ['source-1', '--sp-list-item-index:1;'],
            ['source-2', '--sp-list-item-index:3;'],
            ['loose', '--sp-list-item-index:4;']
        ]);
        expect(sources.every((source) => source.className.includes('sp-spotlight-surface'))).toBe(true);
        expect(groupHeaders.every((header) => header.className.includes('sp-spotlight-surface'))).toBe(true);
        expect(sourceActionButtons.every((button) => button.className.includes('sp-glare-hover'))).toBe(true);
        expect(moveGroupUpButtons).toHaveLength(0);
        expect(moveGroupDownButtons).toHaveLength(0);
        expect(glareButtons.length).toBeGreaterThan(sourceActionButtons.length);

        listContainer.childNodes = [];
        listContainer.children = [];
        const longSourcesByKey = new Map();
        const longUngrouped = Array.from({ length: 12 }, (_, index) => {
            const key = `source-${index}`;
            longSourcesByKey.set(key, { key, title: key, enabled: true });
            return key;
        });
        const longRenderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: [],
                ungrouped: longUngrouped,
                isBatchMode: false,
                activeTagId: null
            }),
            getSourcesByKey: () => longSourcesByKey,
            getMessage: (key) => key
        });

        longRenderModule.render();

        const longSources = findRenderTestNodesByClass(listContainer, 'source-item');
        expect(longSources[10].attrs.style).toBe('--sp-list-item-index:10;');
        expect(longSources[11].attrs.style).toBe('--sp-list-item-index:10;');
    });

    it('renders persisted groups that are missing children arrays without crashing', () => {
        const listContainer = createRenderTestElement('div', { id: 'sources-list' });
        const groupsById = new Map([
            ['broken', {
                id: 'broken',
                title: 'Broken',
                enabled: true,
                collapsed: false
            }]
        ]);
        const renderModule = createContentRender({
            el: createRenderTestElement,
            getDocument: () => ({
                createDocumentFragment: createRenderTestFragment,
                createElement: (tag) => createRenderTestElement(tag)
            }),
            getShadowRoot: () => ({
                querySelector: jest.fn((selector) => (selector === '#sources-list' ? listContainer : null)),
                getElementById: jest.fn((id) => (id === 'sources-list' ? listContainer : null)),
                appendChild: jest.fn()
            }),
            getState: () => ({
                groups: ['broken'],
                ungrouped: [],
                isBatchMode: false,
                activeTagId: null
            }),
            getGroupsById: () => groupsById,
            getSourcesByKey: () => new Map(),
            getMessage: (key) => key
        });

        expect(() => renderModule.render()).not.toThrow();
        expect(findRenderTestNodesByClass(listContainer, 'group-container')).toHaveLength(1);
        expect(findRenderTestNodesByClass(listContainer, 'sp-empty-state')).toHaveLength(1);
    });
});

describe('source icon handling', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('extracts trusted native image urls without changing existing icon mapping', () => {
        const sourceRow = createMockSourceRow({
            title: 'Image Source',
            iconName: 'video_youtube',
            imageCandidates: [
                createMockImageCandidate({ src: 'https://lh3.googleusercontent.com/favicon.ico' })
            ]
        });

        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());

        expect(descriptor.iconImageUrl).toBe('https://lh3.googleusercontent.com/favicon.ico');
        expect(descriptor.iconName).toBe('smart_display');
    });

    it('rejects untrusted source image urls from DOM candidates', () => {
        const sourceRow = createMockSourceRow({
            title: 'Untrusted Image Source',
            imageCandidates: [
                createMockImageCandidate({ src: 'https://evil.example/icon.png' })
            ]
        });

        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());

        expect(descriptor.iconImageUrl).toBeNull();
    });

    it('rejects unsafe image URL schemes and SVG data URLs', () => {
        const unsafeUrls = [
            'javascript:alert(1)',
            'file:///Users/hmy/private.png',
            'http://notebooklm.google.com/insecure.png',
            'data:image/svg+xml,<svg onload=alert(1)>'
        ];

        unsafeUrls.forEach((src) => {
            const sourceRow = createMockSourceRow({
                title: `Unsafe ${src}`,
                imageCandidates: [
                    createMockImageCandidate({ src })
                ]
            });

            expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBeNull();
        });
    });

    it('allows small raster data URLs and current extension image URLs', () => {
        global.chrome.runtime.id = 'extension-under-test';
        const dataImage = 'data:image/png;base64,iVBORw0KGgo=';
        expect(mod.extractSourceIconImageUrl(createMockSourceRow({
            title: 'Raster Data Image',
            imageCandidates: [
                createMockImageCandidate({ src: dataImage })
            ]
        }).row)).toBe(dataImage);

        const extensionUrl = 'chrome-extension://extension-under-test/src/assets/icons/icon16.png';
        expect(mod.extractSourceIconImageUrl(createMockSourceRow({
            title: 'Extension Image',
            imageCandidates: [
                createMockImageCandidate({ src: extensionUrl })
            ]
        }).row)).toBe(extensionUrl);
    });

    it('does not discard a source icon when the source row itself is clickable', () => {
        const sourceCandidate = createMockImageCandidate({
            src: 'https://lh3.googleusercontent.com/source.png',
            interactiveAncestor: null
        });
        const sourceRow = createMockSourceRow({
            title: 'Clickable Source',
            imageCandidates: [sourceCandidate]
        });
        sourceCandidate.closest = jest.fn(() => sourceRow.row);

        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());
        expect(descriptor.iconImageUrl).toBe('https://lh3.googleusercontent.com/source.png');
    });

    it('extracts background image urls and resolves relative paths against the page', () => {
        const sourceRow = createMockSourceRow({
            title: 'Background Source',
            imageCandidates: [
                createMockImageCandidate({ backgroundImage: 'url("/thumbs/source.png")' })
            ]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBe('https://notebooklm.google.com/thumbs/source.png');
    });

    it('extracts inline background shorthand urls through the configured fast path', () => {
        const sourceRow = createMockSourceRow({
            title: 'Background Shorthand Source',
            imageCandidates: [
                createMockImageCandidate({ background: 'center / cover url("/thumbs/background-source.png")' })
            ]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBe('https://notebooklm.google.com/thumbs/background-source.png');
    });

    it('extracts mask image urls through the configured fast path', () => {
        const sourceRow = createMockSourceRow({
            title: 'Mask Source',
            imageCandidates: [
                createMockImageCandidate({ maskImage: 'url("https://example.com/mask-source.svg")' })
            ]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBeNull();
    });

    it('extracts webkit mask image urls through the configured fast path', () => {
        const sourceRow = createMockSourceRow({
            title: 'Webkit Mask Source',
            imageCandidates: [
                createMockImageCandidate({ webkitMaskImage: 'url("https://example.com/webkit-mask-source.svg")' })
            ]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBeNull();
    });

    it('falls back to descendant scanning for computed background images', () => {
        const sourceRow = createMockSourceRow({
            title: 'Computed Background Source',
            descendantCandidates: [
                createMockImageCandidate({ backgroundImage: 'url("https://www.gstatic.com/computed.png")' })
            ]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBe('https://www.gstatic.com/computed.png');
    });

    it('finds image candidates inside open shadow roots', () => {
        const shadowImage = createMockImageCandidate({ src: 'https://lh3.googleusercontent.com/shadow.png' });
        const shadowHost = createMockImageCandidate({ shadowChildren: [shadowImage] });
        const sourceRow = createMockSourceRow({
            title: 'Shadow Source',
            descendantCandidates: [shadowHost]
        });

        expect(mod.extractSourceIconImageUrl(sourceRow.row)).toBe('https://lh3.googleusercontent.com/shadow.png');
    });

    it('ignores decorative images inside interactive controls', () => {
        const nativeMoreButton = {
            contains: jest.fn(() => true)
        };
        const sourceRow = createMockSourceRow({
            title: 'Decorative Source',
            nativeMoreButton,
            imageCandidates: [
                createMockImageCandidate({
                    src: 'https://lh3.googleusercontent.com/ignore.png'
                })
            ]
        });

        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());

        expect(descriptor.iconImageUrl).toBeNull();
        expect(descriptor.iconName).toBe('article');
    });

    it('keeps fingerprint-based ids stable when the source image changes', () => {
        const firstPass = createMockSourceRow({
            title: 'Persistent Source',
            iconName: 'article',
            imageCandidates: [
                createMockImageCandidate({ src: 'https://lh3.googleusercontent.com/a.png' })
            ]
        });
        const secondPass = createMockSourceRow({
            title: 'Persistent Source',
            iconName: 'article',
            imageCandidates: [
                createMockImageCandidate({ src: 'https://lh3.googleusercontent.com/b.png' })
            ]
        });

        const firstDescriptor = mod.createSourceDescriptor(firstPass.row, new Map(), new Map());
        const secondDescriptor = mod.createSourceDescriptor(secondPass.row, new Map(), new Map());

        expect(firstDescriptor.identityType).toBe('fingerprint');
        expect(secondDescriptor.identityType).toBe('fingerprint');
        expect(firstDescriptor.key).toBe(secondDescriptor.key);
        expect(firstDescriptor.fingerprint).toBe(secondDescriptor.fingerprint);
        expect(firstDescriptor.iconImageUrl).not.toBe(secondDescriptor.iconImageUrl);
    });

    it('renders image icons and falls back to glyphs when the image fails', () => {
        const source = {
            key: 'source-image',
            iconImageUrl: 'https://example.com/icon.png',
            iconName: 'article',
            iconColorClass: '',
            isLoading: false
        };

        const imageEl = mod.createSourceIconElement(source, false);
        const container = global.document.createElement('div');
        container.appendChild(imageEl);

        expect(imageEl.tagName).toBe('IMG');
        imageEl.dispatchEvent({ type: 'error' });

        expect(container.childNodes[0].tagName).toBe('MAT-ICON');
    });

    it('falls back for cloned image icons through delegated error handling', () => {
        const source = {
            key: 'source-cloned-image',
            iconImageUrl: 'https://example.com/icon.png',
            iconName: 'description',
            iconColorClass: 'pdf-icon-color',
            isLoading: false
        };
        mod.sourcesByKey.set(source.key, source);

        const clonedImageEl = global.document.createElement('img');
        clonedImageEl.className = 'source-icon-image';
        clonedImageEl.dataset = {
            sourceKey: source.key,
            fallbackIconName: 'article',
            fallbackIconColorClass: ''
        };
        const container = global.document.createElement('div');
        container.appendChild(clonedImageEl);

        let delegatedErrorHandler = null;
        const listContainer = {
            addEventListener: jest.fn((eventName, handler, useCapture) => {
                if (eventName === 'error' && useCapture === true) {
                    delegatedErrorHandler = handler;
                }
            })
        };

        mod.bindSourceIconFallbackDelegation(listContainer);
        expect(delegatedErrorHandler).toEqual(expect.any(Function));

        delegatedErrorHandler({ target: clonedImageEl });

        expect(container.childNodes[0].tagName).toBe('MAT-ICON');
        expect(container.childNodes[0].className).toContain('pdf-icon-color');
    });

    it('falls back to glyphs when no source image is available', () => {
        const source = {
            iconImageUrl: null,
            iconName: 'description',
            iconColorClass: '',
            isLoading: false
        };

        const fallbackIcon = mod.createSourceIconElement(source, false);
        expect(fallbackIcon.tagName).toBe('MAT-ICON');
    });

    it('uses the localized untitled-source fallback when the native title is empty', () => {
        global.chrome.i18n.getMessage = jest.fn((key) => (
            key === 'ui_source_untitled' ? 'Localized Untitled Source' : key
        ));

        const sourceRow = createMockSourceRow({
            title: '   ',
            iconName: 'article'
        });

        const descriptor = mod.createSourceDescriptor(sourceRow.row, new Map(), new Map());

        expect(descriptor.title).toBe('Localized Untitled Source');
    });

    it('prefers loading and failed states over source images', () => {
        const loadingIcon = mod.createSourceIconElement({
            iconImageUrl: 'https://example.com/icon.png',
            iconName: 'article',
            iconColorClass: '',
            isLoading: true
        }, false);
        const failedIcon = mod.createSourceIconElement({
            iconImageUrl: 'https://example.com/icon.png',
            iconName: 'article',
            iconColorClass: '',
            isLoading: false
        }, true);

        expect(loadingIcon.className).toBe('sp-spinner');
        expect(failedIcon.tagName).toBe('MAT-ICON');
    });

    it('routes icon clicks through the native details bridge when using image icons', () => {
        const openNativeDetails = jest.fn(() => true);
        const source = {
            key: 'source-1',
            title: 'Image Source',
            enabled: true,
            isLoading: false,
            isDisabled: false,
            element: null
        };
        const checkbox = { checked: true };
        const sourceRow = {
            dataset: { sourceKey: 'source-1' },
            querySelector: jest.fn(() => checkbox)
        };

        mod.sourcesByKey.set('source-1', source);
        mod._setSourceActionInvokerForTest('openNativeDetails', openNativeDetails);

        mod._handleInteractionForTest({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return sourceRow;
                    if (selector === '.icon-container') return {};
                    return null;
                })
            }
        });

        expect(openNativeDetails).toHaveBeenCalledWith('source-1');
        expect(sourceRow.querySelector).not.toHaveBeenCalled();
    });
});

describe('group title icon handling', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();
        global.clearTimeout = jest.fn();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('renders the folder title affordance through the icon system', () => {
        global.el = createTreeEl;

        const icon = mod.createGroupTitleIconElement();

        expect(icon).toEqual({
            tag: 'span',
            attrs: {
                className: 'sp-group-title-icon',
                'aria-hidden': 'true'
            },
            children: [
                {
                    tag: 'span',
                    attrs: { className: 'google-symbols' },
                    children: ['folder']
                }
            ]
        });
    });
});

describe('group rendering rules', () => {
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

    it('keeps a new top-level empty group renderable when no filters are active', () => {
        const emptyGroup = { id: 'group1', title: 'Empty', enabled: true, children: [] };
        mod.state.groups = ['group1'];
        mod.groupsById.set('group1', emptyGroup);

        expect(mod.hasActiveRenderFilters()).toBe(false);
        expect(mod.shouldRenderGroup(emptyGroup)).toBe(true);
    });

    it('keeps parent and child groups renderable when they are both empty and no filters are active', () => {
        const childGroup = { id: 'group1a', title: 'Child', enabled: true, children: [] };
        const parentGroup = {
            id: 'group1',
            title: 'Parent',
            enabled: true,
            children: [{ type: 'group', id: 'group1a' }]
        };
        mod.groupsById.set('group1', parentGroup);
        mod.groupsById.set('group1a', childGroup);

        expect(mod.shouldRenderGroup(parentGroup)).toBe(true);
        expect(mod.shouldRenderGroup(childGroup)).toBe(true);
    });

    it('hides an empty group when a text filter is active and nothing matches', () => {
        const emptyGroup = { id: 'group1', title: 'Empty', enabled: true, children: [] };
        mod.groupsById.set('group1', emptyGroup);
        mod.state.filterQuery = 'alpha';

        expect(mod.hasActiveRenderFilters()).toBe(true);
        expect(mod.shouldRenderGroup(emptyGroup)).toBe(false);
    });

    it('keeps an isolated empty group renderable when no filters are active', () => {
        const emptyGroup = { id: 'group1', title: 'Empty', enabled: true, children: [] };
        mod.groupsById.set('group1', emptyGroup);
        mod._setActiveIsolationGroupId('group1');

        expect(mod.hasActiveRenderFilters()).toBe(false);
        expect(mod.shouldRenderGroup(emptyGroup)).toBe(true);
    });

    it('keeps the ancestor chain renderable when a deep descendant source matches filters', () => {
        const leafSource = { key: 'source1', title: 'Alpha source', lowercaseTitle: 'alpha source', enabled: true };
        const childGroup = {
            id: 'group1a',
            title: 'Child',
            enabled: true,
            children: [{ type: 'source', key: 'source1' }]
        };
        const parentGroup = {
            id: 'group1',
            title: 'Parent',
            enabled: true,
            children: [{ type: 'group', id: 'group1a' }]
        };

        mod.sourcesByKey.set('source1', leafSource);
        mod.groupsById.set('group1', parentGroup);
        mod.groupsById.set('group1a', childGroup);
        mod.state.filterQuery = 'alpha';

        expect(mod.groupHasRenderableDescendant(childGroup)).toBe(true);
        expect(mod.groupHasRenderableDescendant(parentGroup)).toBe(true);
        expect(mod.shouldRenderGroup(parentGroup)).toBe(true);
        expect(mod.shouldRenderGroup(childGroup)).toBe(true);
    });

    it('hides an empty group when a tag filter is active and nothing matches', () => {
        const emptyGroup = { id: 'group1', title: 'Empty', enabled: true, children: [] };
        mod.groupsById.set('group1', emptyGroup);
        mod.state.activeTagId = 'tag_alpha';

        expect(mod.hasActiveRenderFilters()).toBe(true);
        expect(mod.shouldRenderGroup(emptyGroup)).toBe(false);
    });
});

describe('isolate runtime state', () => {
    let mod;

    const seedIsolationState = () => {
        mod.state.groups = ['group1', 'group2'];
        mod.state.ungrouped = ['sourceU'];

        mod.groupsById.set('group1', {
            id: 'group1',
            enabled: true,
            children: [
                { type: 'source', key: 'sourceA' },
                { type: 'group', id: 'group1a' }
            ]
        });
        mod.groupsById.set('group1a', {
            id: 'group1a',
            enabled: true,
            children: [{ type: 'source', key: 'sourceNested' }]
        });
        mod.groupsById.set('group2', {
            id: 'group2',
            enabled: true,
            children: [{ type: 'source', key: 'sourceB' }]
        });

        mod.parentMap.set('sourceA', 'group1');
        mod.parentMap.set('group1a', 'group1');
        mod.parentMap.set('sourceNested', 'group1a');
        mod.parentMap.set('sourceB', 'group2');

        mod.sourcesByKey.set('sourceA', { key: 'sourceA', title: 'Source A', lowercaseTitle: 'source a', enabled: true });
        mod.sourcesByKey.set('sourceNested', { key: 'sourceNested', title: 'Source Nested', lowercaseTitle: 'source nested', enabled: true });
        mod.sourcesByKey.set('sourceB', { key: 'sourceB', title: 'Source B', lowercaseTitle: 'source b', enabled: true });
        mod.sourcesByKey.set('sourceU', { key: 'sourceU', title: 'Ungrouped Source', lowercaseTitle: 'ungrouped source', enabled: true });
    };

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
        seedIsolationState();
    });

    afterEach(teardownGlobalMocks);

    it('isolates a top-level group and excludes ungrouped sources', () => {
        mod._setActiveIsolationGroupId('group1');

        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceA'))).toBe(true);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceNested'))).toBe(true);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceB'))).toBe(false);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceU'))).toBe(false);
    });

    it('isolates a nested group subtree only', () => {
        mod._setActiveIsolationGroupId('group1a');

        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceA'))).toBe(false);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceNested'))).toBe(true);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceB'))).toBe(false);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceU'))).toBe(false);
    });

    it('does not persist active isolation runtime state', () => {
        mod._setActiveIsolationGroupId('group1');

        expect(mod.buildPersistableState()).not.toHaveProperty('activeIsolationGroupId');
    });

    it('clears isolation state when switching notebook routes', () => {
        mod._setProjectId('old-project');
        mod._setActiveIsolationGroupId('group1');
        global.window.location.pathname = '/notebook/new-project';

        mod.handleRouteChanged();

        expect(mod._getActiveIsolationGroupId()).toBeNull();
    });

    it('restores non-isolated sources when exiting isolation', () => {
        mod._setActiveIsolationGroupId('group1');
        mod.sourcesByKey.get('sourceA').enabled = false;
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceU'))).toBe(false);

        mod._setActiveIsolationGroupId(null);

        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceA'))).toBe(false);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceB'))).toBe(true);
        expect(mod.isSourceEffectivelyEnabled(mod.sourcesByKey.get('sourceU'))).toBe(true);
    });
});

describe('command palette commands', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('offers search, quick view, view switch, management, and gated batch commands', () => {
        mod.state.isBatchMode = true;
        mod.pendingBatchKeys.add('source-1');

        const commands = mod._getCommandPaletteCommandsForTest('');

        expect(commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'search-sources', payload: { query: '' } }),
            expect.objectContaining({ action: 'quick-view', payload: { kind: 'recent' } }),
            expect.objectContaining({ action: 'switch-source-view', payload: { kind: 'label' } }),
            expect.objectContaining({ action: 'open-settings' }),
            expect.objectContaining({ action: 'manage-tags' }),
            expect.objectContaining({ action: 'batch-add-tags', disabled: false }),
            expect.objectContaining({ action: 'batch-move-ungrouped', disabled: false })
        ]));

        mod.pendingBatchKeys.clear();
        const disabledBatchCommands = mod._getCommandPaletteCommandsForTest('')
            .filter((command) => String(command.action || '').startsWith('batch-'));
        expect(disabledBatchCommands.every((command) => command.disabled === true)).toBe(true);
    });

    it('keeps quick view commands available when all quick view rail buttons are hidden', async () => {
        await mod._setVisibleQuickViewKindsForTest([]);

        const commands = mod._getCommandPaletteCommandsForTest('');

        expect(commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'quick-view-all', action: 'quick-view', payload: { kind: 'all' } }),
            expect.objectContaining({ id: 'quick-view-recent', action: 'quick-view', payload: { kind: 'recent' } }),
            expect.objectContaining({ id: 'quick-view-issues', action: 'quick-view', payload: { kind: 'issues' } })
        ]));
    });

    it('filters command palette actions by title, subtitle, and keywords', () => {
        const recentCommands = mod._getCommandPaletteCommandsForTest('recent');
        expect(recentCommands).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'search-sources', payload: { query: 'recent' } }),
            expect.objectContaining({ action: 'quick-view', payload: { kind: 'recent' } })
        ]));
        expect(recentCommands).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'quick-view', payload: { kind: 'disabled' } })
        ]));

        const unmatchedCommands = mod._getCommandPaletteCommandsForTest('zzzz-no-command');
        expect(unmatchedCommands).toEqual([
            expect.objectContaining({ action: 'search-sources', payload: { query: 'zzzz-no-command' } })
        ]);
    });

    it('executes search and quick view commands without persisting the active view', () => {
        mod._setActiveIsolationGroupId('group1');

        expect(mod._executeCommandPaletteCommandForTest('search-sources', { payload: { query: 'report' } })).toBe(true);
        expect(mod.state.filterQuery).toBe('report');

        expect(mod._executeCommandPaletteCommandForTest('quick-view', { payload: { kind: 'issues' } })).toBe(true);
        expect(mod.state.activeQuickViewKind).toBe('issues');
        expect(mod.state.activeTagId).toBeNull();
        expect(mod._getActiveIsolationGroupId()).toBeNull();
        expect(mod.buildPersistableState()).not.toHaveProperty('activeQuickViewKind');
    });

    it('toggles search and quick view shortcuts on repeated presses and ignores editable targets', async () => {
        await mod._setCommandShortcutForTest('search-sources', 'Meta+Shift+F');
        const searchShortcutEvent = {
            key: 'f',
            metaKey: true,
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            target: { tagName: 'DIV' },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };

        expect(mod._handleCommandShortcutKeydownForTest(searchShortcutEvent)).toBe(true);
        expect(mod._getIsSearchExpanded()).toBe(true);

        mod.state.filterQuery = 'report';
        const closeSearchShortcutEvent = Object.assign({}, searchShortcutEvent, {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });
        expect(mod._handleCommandShortcutKeydownForTest(closeSearchShortcutEvent)).toBe(true);
        expect(mod._getIsSearchExpanded()).toBe(false);
        expect(mod.state.filterQuery).toBe('');

        await mod._setCommandShortcutForTest('quick-view-recent', 'Meta+Shift+R');
        expect(mod._getCommandShortcutsForTest()).toMatchObject({
            'quick-view-recent': 'Meta+Shift+R'
        });

        const shortcutEvent = {
            key: 'r',
            metaKey: true,
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            target: { tagName: 'DIV' },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };
        expect(mod._getCommandShortcutComboFromEventForTest(shortcutEvent)).toBe('Meta+Shift+R');
        expect(mod._getCommandPaletteCommandForShortcutForTest('Meta+Shift+R')).toEqual(expect.objectContaining({
            id: 'quick-view-recent'
        }));
        expect(mod._getExtensionEnabledForTest()).toBe(true);
        expect(mod._hasCommandPaletteModalForTest()).toBe(false);
        expect(mod._getCommandPaletteCommandsForTest('')).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'quick-view-recent', action: 'quick-view', payload: { kind: 'recent' } })
        ]));

        expect(mod._handleCommandShortcutKeydownForTest(shortcutEvent)).toBe(true);
        expect(shortcutEvent.preventDefault).toHaveBeenCalled();
        expect(mod.state.activeQuickViewKind).toBe('recent');

        const repeatedShortcutEvent = Object.assign({}, shortcutEvent, {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        });
        expect(mod._handleCommandShortcutKeydownForTest(repeatedShortcutEvent)).toBe(true);
        expect(mod.state.activeQuickViewKind).toBeNull();

        const editableEvent = {
            key: 'r',
            metaKey: true,
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            target: { tagName: 'INPUT' },
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };

        expect(mod._handleCommandShortcutKeydownForTest(editableEvent)).toBe(false);
        expect(mod.state.activeQuickViewKind).toBeNull();
    });

    it('closes an already-open modal command when its shortcut runs again', () => {
        const removedNodeIds = [];
        const modalParent = {
            removeChild: jest.fn((node) => {
                removedNodeIds.push(node.id);
                return node;
            })
        };
        const nodes = {
            'sp-settings-modal': {
                id: 'sp-settings-modal',
                parentNode: modalParent,
                getAttribute: (name) => (name === 'id' ? 'sp-settings-modal' : null),
                classList: { add: jest.fn(), remove: jest.fn() }
            },
            'sp-settings-backdrop': {
                id: 'sp-settings-backdrop',
                parentNode: modalParent,
                getAttribute: (name) => (name === 'id' ? 'sp-settings-backdrop' : null),
                classList: { add: jest.fn(), remove: jest.fn() }
            }
        };
        mod._setShadowRootForTest({
            host: { isConnected: true },
            getElementById: (id) => nodes[id] || null,
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        });

        expect(mod._executeCommandPaletteCommandForTest('open-settings', {
            action: 'open-settings',
            triggeredByShortcut: true
        })).toBe(true);

        expect(removedNodeIds).toEqual(expect.arrayContaining([
            'sp-settings-backdrop',
            'sp-settings-modal'
        ]));
    });
});
