const createContentModalTag = require('../../src/content/content-modal-tag.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        style: attrs.style || '',
        children: [],
        childNodes: [],
        value: attrs.type ? '' : undefined,
        listeners: {},
        addEventListener(event, handler) {
            (this.listeners[event] || (this.listeners[event] = [])).push(handler);
        },
        appendChild(child) {
            this.children.push(child);
            this.childNodes.push(child);
            if (child && typeof child === 'object') child.parentNode = this;
        },
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            this.childNodes = this.childNodes.filter((c) => c !== child);
        },
        classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
        focus: jest.fn(),
        setAttribute: jest.fn(),
        getAttribute: jest.fn(() => null),
        removeAttribute: jest.fn(),
        querySelector(selector) {
            return collectDescendants(this).find((node) => matchesSelector(node, selector)) || null;
        },
        querySelectorAll(selector) {
            return collectDescendants(this).filter((node) => matchesSelector(node, selector));
        }
    };
    (children || []).forEach((child) => {
        if (!child) return;
        if (typeof child === 'object') {
            child.parentNode = node;
            node.children.push(child);
            node.childNodes.push(child);
        }
    });
    return node;
}

function collectDescendants(root) {
    const out = [];
    const queue = root.children.slice();
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        out.push(node);
        if (Array.isArray(node.children)) queue.push(...node.children);
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
        getMessage: jest.fn((key, args = []) => (args.length ? `${key}:${args.join(',')}` : key)),
        getShadowRoot: jest.fn(() => shadowRoot),
        getWindow: jest.fn(() => globalThis),
        getState: jest.fn(() => ({ isBatchMode: true })),
        getTagsById: jest.fn(() => new Map()),
        getSourcesByKey: jest.fn(() => new Map()),
        getPendingBatchKeys: jest.fn(() => new Set()),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        createModalItemStaggerStyle: jest.fn((index, base = '') => `${base}--idx:${index};`),
        normalizeTagColor: (v) => v || null,
        normalizeTagColorInputValue: (v) => String(v || ''),
        getDefaultTagColor: () => '#007AFF',
        getTagColorPreviewStyle: () => '',
        tagColorPresets: ['#007AFF', '#FF3B30'],
        createTag: jest.fn(() => ({ id: 'new-tag', label: 'New', color: '#007AFF' })),
        updateTag: jest.fn(() => true),
        deleteTag: jest.fn(),
        getTagUsageCounts: jest.fn(() => new Map()),
        getSourceTagIds: jest.fn(() => []),
        setSourceTagIds: jest.fn(),
        saveState: jest.fn(),
        render: jest.fn(),
        showToast: jest.fn(),
        showUndoableToast: jest.fn(),
        closeSourceActionMenu: jest.fn(),
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal tag', () => {
    describe('factory validation', () => {
        it('throws when el/getMessage/getShadowRoot are missing', () => {
            expect(() => createContentModalTag({})).toThrow(/requires el, getMessage and getShadowRoot/);
        });
    });

    describe('close helpers', () => {
        it('closeTagModal forwards modal and backdrop ids', () => {
            const deps = createDeps();
            const helper = createContentModalTag(deps);
            helper.closeTagModal({ restoreFocus: true });
            expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-tag-modal', 'sp-tag-backdrop', { restoreFocus: true });
        });

        it('closeBatchTagModal forwards modal and backdrop ids', () => {
            const deps = createDeps();
            const helper = createContentModalTag(deps);
            helper.closeBatchTagModal();
            expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-batch-tag-modal', 'sp-batch-tag-backdrop', {});
        });
    });

    describe('getEditTagInputId', () => {
        it('produces a stable id prefixed with sp-edit-tag-', () => {
            const helper = createContentModalTag(createDeps());
            expect(helper.getEditTagInputId('t1')).toBe('sp-edit-tag-t1');
        });

        it('sanitizes non-alphanumeric characters into underscores', () => {
            const helper = createContentModalTag(createDeps());
            expect(helper.getEditTagInputId('a b/c.d')).toBe('sp-edit-tag-a_b_c_d');
        });

        it('handles missing/null tagIds without crashing', () => {
            const helper = createContentModalTag(createDeps());
            expect(helper.getEditTagInputId(null)).toBe('sp-edit-tag-');
        });
    });

    describe('getCssEscapedId', () => {
        it('uses window.CSS.escape when available', () => {
            const deps = createDeps({ getWindow: () => ({ CSS: { escape: jest.fn((id) => `ESCAPED:${id}`) } }) });
            const helper = createContentModalTag(deps);
            expect(helper.getCssEscapedId('weird id')).toBe('ESCAPED:weird id');
        });

        it('falls back to a regex-escape when CSS.escape is missing', () => {
            const deps = createDeps({ getWindow: () => ({}) });
            const helper = createContentModalTag(deps);
            expect(helper.getCssEscapedId('foo.bar')).toBe('foo\\.bar');
        });
    });

    describe('executeBatchTagUpdate', () => {
        function setupBatchDeps(extras = {}) {
            const sourcesByKey = new Map([
                ['s1', { key: 's1' }],
                ['s2', { key: 's2' }],
                ['s_loading', { key: 's_loading', isLoading: true }],
                ['s_disabled', { key: 's_disabled', isDisabled: true }]
            ]);
            const tagsById = new Map([
                ['t1', { id: 't1', label: 'one' }],
                ['t2', { id: 't2', label: 'two' }]
            ]);
            const tagIdsBySource = new Map([['s1', ['t2']], ['s2', []]]);
            const sharedState = { isBatchMode: true };
            const pendingBatchKeys = new Set(['s1', 's2']);
            return createDeps({
                getState: () => sharedState,
                getSourcesByKey: () => sourcesByKey,
                getTagsById: () => tagsById,
                getPendingBatchKeys: () => pendingBatchKeys,
                getSourceTagIds: jest.fn((key) => tagIdsBySource.get(key) || []),
                setSourceTagIds: jest.fn((key, ids) => tagIdsBySource.set(key, ids)),
                ...extras
            });
        }

        it('returns false and closes when there are no eligible sources or tags', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            expect(helper.executeBatchTagUpdate('add', [], ['t1'])).toBe(false);
            expect(deps.closeManagedModal).toHaveBeenCalled();
            expect(deps.setSourceTagIds).not.toHaveBeenCalled();
        });

        it('returns false when none of the tagIds are valid', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            expect(helper.executeBatchTagUpdate('add', ['s1', 's2'], ['ghost'])).toBe(false);
            expect(deps.setSourceTagIds).not.toHaveBeenCalled();
        });

        it('adds tags (dedup union) to each non-disabled non-loading source', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            const result = helper.executeBatchTagUpdate('add', ['s1', 's2', 's_loading', 's_disabled'], ['t1', 't2']);

            expect(result).toBe(true);
            expect(deps.setSourceTagIds).toHaveBeenCalledTimes(2);
            const setKeys = deps.setSourceTagIds.mock.calls.map(([key]) => key);
            expect(setKeys).toEqual(['s1', 's2']);
        });

        it('remove mode subtracts the given tagIds from each source', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);
            helper.executeBatchTagUpdate('remove', ['s1'], ['t2']);
            expect(deps.setSourceTagIds).toHaveBeenCalledWith('s1', []);
        });

        it('clears batch mode and pending keys, then renders / saves / toasts on success', () => {
            const deps = setupBatchDeps();
            const state = deps.getState();
            const pending = deps.getPendingBatchKeys();
            const helper = createContentModalTag(deps);

            helper.executeBatchTagUpdate('add', ['s1'], ['t1']);

            expect(state.isBatchMode).toBe(false);
            expect(pending.size).toBe(0);
            expect(deps.saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
            expect(deps.render).toHaveBeenCalled();
            expect(deps.closeSourceActionMenu).toHaveBeenCalled();
            expect(deps.showUndoableToast).toHaveBeenCalledWith('ui_batch_tags_added_toast:1', { variant: 'success' });
        });
    });

    describe('render smoke', () => {
        it('renderTagModal bails when shadowRoot is missing', () => {
            const deps = createDeps({ getShadowRoot: () => null });
            const helper = createContentModalTag(deps);
            expect(() => helper.renderTagModal('s1')).not.toThrow();
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('renderBatchTagModal bails when source keys list is empty', () => {
            const deps = createDeps();
            const helper = createContentModalTag(deps);
            helper.renderBatchTagModal('add', []);
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('renderTagModal mounts a tag modal element on the shadowRoot', () => {
            const deps = createDeps({
                getSourcesByKey: () => new Map([['s1', { key: 's1', title: 'Source One' }]])
            });
            const helper = createContentModalTag(deps);
            helper.renderTagModal('s1');
            expect(deps.prepareModalOpen).toHaveBeenCalledWith('sp-tag-modal', 'sp-tag-backdrop');
            expect(deps.getShadowRoot().querySelector('#sp-tag-modal')).toBeTruthy();
        });

        it('renderBatchTagModal mounts a batch tag modal element on the shadowRoot', () => {
            const deps = createDeps({
                getTagsById: () => new Map([['t1', { id: 't1', label: 'One' }]])
            });
            const helper = createContentModalTag(deps);
            helper.renderBatchTagModal('add', ['s1']);
            expect(deps.prepareModalOpen).toHaveBeenCalledWith('sp-batch-tag-modal', 'sp-batch-tag-backdrop');
            expect(deps.getShadowRoot().querySelector('#sp-batch-tag-modal')).toBeTruthy();
        });
    });
});
