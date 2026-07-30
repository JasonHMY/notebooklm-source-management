const createContentModalTagFilter = require('../../src/content/content-modal-tag-filter.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        hidden: Boolean(attrs.hidden),
        value: attrs.value || '',
        textContent: '',
        children: [],
        listeners: {},
        addEventListener(event, handler) {
            (this.listeners[event] || (this.listeners[event] = [])).push(handler);
        },
        appendChild(child) {
            this.children.push(child);
            if (child && typeof child === 'object') child.parentNode = this;
        },
        classList: { add: jest.fn() },
        focus: jest.fn(),
        querySelector(selector) {
            return collectDescendants(this).find((node) => matchesSelector(node, selector)) || null;
        },
        querySelectorAll(selector) {
            return collectDescendants(this).filter((node) => matchesSelector(node, selector));
        }
    };
    (children || []).forEach((child) => {
        if (!child) return;
        if (typeof child === 'object') child.parentNode = node;
        node.children.push(child);
    });
    node.textContent = (children || []).filter((child) => typeof child === 'string').join('');
    return node;
}

function collectDescendants(root) {
    const out = [];
    const queue = root.children.slice();
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        out.push(node);
        if (Array.isArray(node.children)) {
            queue.push(...node.children);
        }
    }
    return out;
}

function matchesSelector(node, selector) {
    if (!node || typeof node !== 'object') return false;
    if (selector.startsWith('.')) {
        return String(node.className || '').split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
        return node.id === selector.slice(1);
    }
    return node.tagName === selector.toUpperCase();
}

function createDeps(overrides = {}) {
    const shadowRoot = createElement('div');
    return {
        el: jest.fn(createElement),
        getMessage: jest.fn((key) => key),
        getShadowRoot: jest.fn(() => shadowRoot),
        getState: jest.fn(() => ({ tagOrder: [] })),
        getTagsById: jest.fn(() => new Map()),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        applyTagQuickFilter: jest.fn(() => true),
        requestAnimationFrame: null,
        ...overrides
    };
}

describe('content modal tag filter', () => {
    it('throws when el/getMessage/getShadowRoot are missing', () => {
        expect(() => createContentModalTagFilter({})).toThrow(/requires el, getMessage and getShadowRoot/);
    });

    it('closeTagFilterModal forwards modal and backdrop ids to closeManagedModal', () => {
        const deps = createDeps();
        const helper = createContentModalTagFilter(deps);

        const result = helper.closeTagFilterModal({ restoreFocus: true });

        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-tag-filter-modal', 'sp-tag-filter-backdrop', { restoreFocus: true });
        expect(result).toBe(true);
    });

    it('renderTagFilterModal returns false when the shadowRoot is missing', () => {
        const deps = createDeps({ getShadowRoot: () => null });
        const helper = createContentModalTagFilter(deps);

        expect(helper.renderTagFilterModal()).toBe(false);
        expect(deps.prepareModalOpen).not.toHaveBeenCalled();
    });

    it('renders an empty-state node when no tags exist', () => {
        const deps = createDeps();
        const helper = createContentModalTagFilter(deps);

        expect(helper.renderTagFilterModal()).toBe(true);
        const emptyStateCall = deps.el.mock.calls.find(
            ([, attrs]) => attrs?.className === 'sp-settings-empty-state'
        );
        expect(emptyStateCall).toBeDefined();
        expect(deps.getMessage).toHaveBeenCalledWith('ui_no_tags');
    });

    it('orders tags by tagOrder first, then any remaining tags from the map', () => {
        const tagsById = new Map([
            ['t1', { id: 't1', label: 'One' }],
            ['t2', { id: 't2', label: 'Two' }],
            ['t3', { id: 't3', label: 'Three' }]
        ]);
        const deps = createDeps({
            getState: () => ({ tagOrder: ['t2', 't1'] }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);

        helper.renderTagFilterModal();

        const buttonCalls = deps.el.mock.calls.filter(([, attrs]) => attrs?.className === 'sp-tag-filter-option sp-glare-hover');
        expect(buttonCalls.map(([, attrs]) => attrs.dataset.tagId)).toEqual(['t2', 't1', 't3']);
    });

    it('marks only the active tag option as pressed', () => {
        const tagsById = new Map([
            ['t1', { id: 't1', label: 'One' }],
            ['t2', { id: 't2', label: 'Two' }]
        ]);
        const deps = createDeps({
            getState: () => ({ tagOrder: ['t1', 't2'], activeTagId: 't2' }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);

        helper.renderTagFilterModal();

        const options = deps.getShadowRoot().querySelectorAll('.sp-tag-filter-option');
        expect(options.map((option) => option.attrs['aria-pressed'])).toEqual(['false', 'true']);
        expect(options[0].className).not.toContain('is-active');
        expect(options[1].className).toContain('is-active');
    });

    it('filters tags with a trimmed case-insensitive query and updates the result count', () => {
        const tagsById = new Map([
            ['t1', { id: 't1', label: 'Alpha' }],
            ['t2', { id: 't2', label: 'Beta' }],
            ['t3', { id: 't3', label: 'Alphabet' }]
        ]);
        const deps = createDeps({
            getMessage: jest.fn((key, substitutions = []) => (
                key === 'ui_search_results_count' ? `${substitutions[0]} results` : key
            )),
            getState: () => ({ tagOrder: ['t1', 't2', 't3'] }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const search = deps.getShadowRoot().querySelector('.sp-tag-filter-search');
        search.value = '  ALP  ';
        search.listeners.input[0]();

        const options = deps.getShadowRoot().querySelectorAll('.sp-tag-filter-option');
        expect(options.map((option) => option.hidden)).toEqual([false, true, false]);
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-results-count').textContent).toBe('2 results');
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-list').hidden).toBe(false);
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-no-results').hidden).toBe(true);

        search.value = '';
        search.listeners.input[0]();

        expect(options.map((option) => option.hidden)).toEqual([false, false, false]);
        expect(options.map((option) => option.dataset.tagId)).toEqual(['t1', 't2', 't3']);
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-results-count').textContent).toBe('3 results');
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-list').hidden).toBe(false);
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-no-results').hidden).toBe(true);
    });

    it('shows a no-match state and zero result count when search finds no tags', () => {
        const tagsById = new Map([['t1', { id: 't1', label: 'Alpha' }]]);
        const deps = createDeps({
            getMessage: jest.fn((key, substitutions = []) => (
                key === 'ui_search_results_count' ? `${substitutions[0]} results` : key
            )),
            getState: () => ({ tagOrder: ['t1'] }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const search = deps.getShadowRoot().querySelector('.sp-tag-filter-search');
        search.value = 'missing';
        search.listeners.input[0]();

        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-results-count').textContent).toBe('0 results');
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-list').hidden).toBe(true);
        expect(deps.getShadowRoot().querySelector('.sp-tag-filter-no-results').hidden).toBe(false);
        expect(deps.getMessage).toHaveBeenCalledWith('ui_no_matching_tags');
    });

    it('clicking a tag option triggers applyTagQuickFilter and closes the modal on success', () => {
        const tagsById = new Map([['t1', { id: 't1', label: 'One' }]]);
        const deps = createDeps({
            getState: () => ({ tagOrder: ['t1'] }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const tagButton = deps.getShadowRoot().querySelectorAll('.sp-tag-filter-option')[0];
        tagButton.listeners.click[0]();

        expect(deps.applyTagQuickFilter).toHaveBeenCalledWith('t1');
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('clicking a tag option does NOT close the modal when applyTagQuickFilter returns falsy', () => {
        const tagsById = new Map([['t1', { id: 't1', label: 'One' }]]);
        const deps = createDeps({
            getState: () => ({ tagOrder: ['t1'] }),
            getTagsById: () => tagsById,
            applyTagQuickFilter: jest.fn(() => false)
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const tagButton = deps.getShadowRoot().querySelectorAll('.sp-tag-filter-option')[0];
        tagButton.listeners.click[0]();

        expect(deps.applyTagQuickFilter).toHaveBeenCalled();
        expect(deps.closeManagedModal).not.toHaveBeenCalled();
    });

    it('clicking the cancel button and the backdrop both close the modal', () => {
        const deps = createDeps();
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const cancelButton = deps.getShadowRoot().querySelector('.sp-modal-cancel');
        cancelButton.listeners.click[0]();
        const backdrop = deps.getShadowRoot().querySelector('.sp-overlay-backdrop');
        backdrop.listeners.click[0]();

        expect(deps.closeManagedModal).toHaveBeenCalledTimes(2);
    });

    it('uses requestAnimationFrame to defer visibility when provided', () => {
        const rafCallbacks = [];
        const deps = createDeps({
            requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; }
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const modal = deps.getShadowRoot().querySelector('.sp-tag-filter-modal');
        expect(modal.classList.add).not.toHaveBeenCalled();

        rafCallbacks[0]();
        expect(modal.classList.add).toHaveBeenCalledWith('visible');
    });

    it('falls back to synchronous visibility when requestAnimationFrame is unavailable', () => {
        const deps = createDeps({ requestAnimationFrame: undefined });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const modal = deps.getShadowRoot().querySelector('.sp-tag-filter-modal');
        expect(modal.classList.add).toHaveBeenCalledWith('visible');
    });

    it('binds modal keyboard navigation with closeTagFilterModal as the close handler', () => {
        const deps = createDeps();
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        expect(deps.bindModalKeyboardNavigation).toHaveBeenCalledTimes(1);
        const [, options] = deps.bindModalKeyboardNavigation.mock.calls[0];
        expect(typeof options.closeModal).toBe('function');
        options.closeModal();
        expect(deps.closeManagedModal).toHaveBeenCalled();
    });

    it('focuses the search input first when tags exist', () => {
        const tagsById = new Map([['t1', { id: 't1', label: 'One' }]]);
        const deps = createDeps({
            getState: () => ({ tagOrder: ['t1'] }),
            getTagsById: () => tagsById
        });
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const [, options] = deps.bindModalKeyboardNavigation.mock.calls[0];
        const search = deps.getShadowRoot().querySelector('.sp-tag-filter-search');
        expect(options.initialFocusTarget()).toBe(search);
        expect(search.attrs['aria-controls']).toBe('sp-tag-filter-list');
        expect(search.attrs['aria-describedby']).toBe('sp-tag-filter-results-count');
    });

    it('focuses Cancel first when no tags exist', () => {
        const deps = createDeps();
        const helper = createContentModalTagFilter(deps);
        helper.renderTagFilterModal();

        const [, options] = deps.bindModalKeyboardNavigation.mock.calls[0];
        const cancel = deps.getShadowRoot().querySelector('.sp-modal-cancel');
        expect(options.initialFocusTarget()).toBe(cancel);
    });
});
