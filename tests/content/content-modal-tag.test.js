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
        createTag: jest.fn(() => ({
            ok: true,
            reason: 'created',
            tagId: 'new-tag',
            existingTagId: null
        })),
        updateTag: jest.fn((tagId) => ({
            ok: true,
            reason: 'updated',
            tagId,
            existingTagId: null
        })),
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

    describe('tag mutation feedback', () => {
        it('maps structured validation failures to localized inline messages', () => {
            const helper = createContentModalTag(createDeps());

            expect(helper.getTagMutationErrorMessage({ reason: 'name_required' })).toBe('ui_tag_name_required');
            expect(helper.getTagMutationErrorMessage({ reason: 'duplicate' })).toBe('ui_tag_create_duplicate');
            expect(helper.getTagMutationErrorMessage({ reason: 'not_found' })).toBe('ui_tag_not_found');
        });

        it('keeps the entered label and focuses the input when create returns a duplicate', () => {
            const deps = createDeps({
                getState: () => ({ tagOrder: [] }),
                createTag: jest.fn(() => ({
                    ok: false,
                    reason: 'duplicate',
                    tagId: null,
                    existingTagId: 'existing-tag'
                }))
            });
            const helper = createContentModalTag(deps);
            helper.renderTagModal();

            const modal = deps.getShadowRoot().querySelector('#sp-tag-modal');
            const input = modal.querySelector('#sp-tag-name-input');
            const submit = modal.querySelector('#sp-create-tag-btn');
            input.value = 'Existing label';
            submit.listeners.click[0]();

            const error = modal.querySelector('#sp-tag-name-input-error');
            expect(input.value).toBe('Existing label');
            expect(input.focus).toHaveBeenCalled();
            expect(input.setAttribute).toHaveBeenCalledWith('aria-invalid', 'true');
            expect(error.hidden).toBe(false);
            expect(error.textContent).toBe('ui_tag_create_duplicate');
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.render).not.toHaveBeenCalled();
        });

        it('clears inline validation feedback when the user edits the label', () => {
            const deps = createDeps();
            const helper = createContentModalTag(deps);
            const editor = helper.createTagEditor({
                inputId: 'tag-input',
                submitLabel: 'Create',
                onSubmit: jest.fn()
            });
            editor.labelInput.value = 'Draft';
            editor.setError('Problem');

            editor.labelInput.listeners.input[0]();

            expect(editor.labelInput.value).toBe('Draft');
            expect(editor.errorNode.hidden).toBe(true);
            expect(editor.errorNode.textContent).toBe('');
            expect(editor.labelInput.removeAttribute).toHaveBeenCalledWith('aria-invalid');
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

        it('returns a structured empty result and closes when there are no eligible sources', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            expect(helper.executeBatchTagUpdate('add', [], ['t1'])).toEqual({
                ok: false,
                changed: false,
                succeeded: [],
                failed: [],
                skipped: [],
                unattempted: [],
                reason: 'empty_selection'
            });
            expect(deps.closeManagedModal).toHaveBeenCalled();
            expect(deps.setSourceTagIds).not.toHaveBeenCalled();
        });

        it('returns structured unattempted items when none of the tagIds are valid', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            expect(helper.executeBatchTagUpdate('add', ['s1', 's2'], ['ghost'])).toEqual({
                ok: false,
                changed: false,
                succeeded: [],
                failed: [],
                skipped: [],
                unattempted: [
                    { key: 's1', reason: 'tag_not_found' },
                    { key: 's2', reason: 'tag_not_found' }
                ],
                reason: 'tag_not_found'
            });
            expect(deps.setSourceTagIds).not.toHaveBeenCalled();
        });

        it('adds tags (dedup union) to each non-disabled non-loading source', () => {
            const deps = setupBatchDeps();
            const helper = createContentModalTag(deps);

            const result = helper.executeBatchTagUpdate('add', ['s1', 's2', 's_loading', 's_disabled'], ['t1', 't2']);

            expect(result).toEqual({
                ok: false,
                changed: true,
                succeeded: ['s1', 's2'],
                failed: [],
                skipped: [
                    { key: 's_loading', reason: 'source_unavailable' },
                    { key: 's_disabled', reason: 'source_unavailable' }
                ],
                unattempted: [],
                reason: 'partial'
            });
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
            pending.clear();
            pending.add('s1');

            const result = helper.executeBatchTagUpdate('add', ['s1'], ['t1']);

            expect(result).toEqual(expect.objectContaining({
                ok: true,
                changed: true,
                succeeded: ['s1'],
                reason: 'completed'
            }));
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
