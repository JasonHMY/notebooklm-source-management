const createContentModalMove = require('../../src/content/content-modal-move.js');

function createElement(tag, attrs = {}, children = []) {
    const node = {
        tagName: String(tag).toUpperCase(),
        className: attrs.className || '',
        id: attrs.id || '',
        attrs,
        dataset: attrs.dataset || {},
        style: attrs.style || '',
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
        getMessage: jest.fn((key) => key),
        getShadowRoot: jest.fn(() => shadowRoot),
        getState: jest.fn(() => ({ groups: [], isBatchMode: false })),
        getGroupsById: jest.fn(() => new Map()),
        getPendingBatchKeys: jest.fn(() => new Set()),
        getSourcesByKey: jest.fn(() => new Map([
            ['s1', { key: 's1' }],
            ['s2', { key: 's2' }],
            ['missing', { key: 'missing' }]
        ])),
        prepareModalOpen: jest.fn(),
        closeManagedModal: jest.fn(() => true),
        bindModalKeyboardNavigation: jest.fn(() => ({ focusInitial: jest.fn(), dispose: jest.fn() })),
        createModalItemStaggerStyle: jest.fn((index, base = '') => `${base}--idx:${index};`),
        closeSourceActionMenu: jest.fn(),
        buildParentMap: jest.fn(),
        saveState: jest.fn(),
        render: jest.fn(),
        removeSourceFromTree: jest.fn(),
        getParentMap: jest.fn(() => new Map()),
        treePlacement: {
            applyBatchPlacement: jest.fn(() => ({
                ok: false,
                changed: false,
                reason: 'invalid_target',
                moved: [],
                skipped: []
            })),
            rebuildParentMap: jest.fn()
        },
        requestAnimationFrame: undefined,
        ...overrides
    };
}

describe('content modal move-to-folder', () => {
    it('throws when el/getMessage/getShadowRoot are missing', () => {
        expect(() => createContentModalMove({})).toThrow(/requires el, getMessage and getShadowRoot/);
    });

    it('closeMoveToFolderModal forwards modal and backdrop ids', () => {
        const deps = createDeps();
        const helper = createContentModalMove(deps);
        helper.closeMoveToFolderModal({ restoreFocus: false });
        expect(deps.closeManagedModal).toHaveBeenCalledWith('sp-move-modal', 'sp-move-backdrop', { restoreFocus: false });
    });

    describe('collectMoveFolderOptions', () => {
        it('returns DFS-ordered flat list with level info', () => {
            const groupsById = new Map([
                ['a', { id: 'a', title: 'A', children: [{ type: 'group', id: 'b' }] }],
                ['b', { id: 'b', title: 'B', children: [{ type: 'source', key: 's1' }] }],
                ['c', { id: 'c', title: 'C', children: [] }]
            ]);
            const deps = createDeps({ getGroupsById: () => groupsById });
            const helper = createContentModalMove(deps);

            const options = helper.collectMoveFolderOptions(['a', 'c']);

            expect(options.map((o) => [o.group.id, o.level])).toEqual([
                ['a', 0],
                ['b', 1],
                ['c', 0]
            ]);
        });

        it('does not revisit groups (cycle protection)', () => {
            const groupsById = new Map([
                ['a', { id: 'a', children: [{ type: 'group', id: 'b' }] }],
                ['b', { id: 'b', children: [{ type: 'group', id: 'a' }] }]
            ]);
            const deps = createDeps({ getGroupsById: () => groupsById });
            const helper = createContentModalMove(deps);

            const options = helper.collectMoveFolderOptions(['a']);

            expect(options.map((o) => o.group.id)).toEqual(['a', 'b']);
        });

        it('skips missing groupIds without throwing', () => {
            const deps = createDeps({ getGroupsById: () => new Map() });
            const helper = createContentModalMove(deps);
            expect(helper.collectMoveFolderOptions(['missing'])).toEqual([]);
        });
    });

    describe('executeMoveToFolder', () => {
        it('returns a stable failure without closing when the target group is missing', () => {
            const deps = createDeps();
            const helper = createContentModalMove(deps);
            const result = helper.executeMoveToFolder(['s1'], 'unknown');
            expect(result).toEqual({
                ok: false,
                changed: false,
                reason: 'invalid_target',
                moved: [],
                skipped: [{
                    item: { kind: 'source', key: 's1' },
                    reason: 'invalid_target'
                }]
            });
            expect(deps.closeManagedModal).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
        });

        it('routes caller order to the target group tail, then saves, renders and closes', () => {
            const targetGroup = {
                id: 't',
                children: [{ type: 'source', key: 'existing' }]
            };
            const groupsById = new Map([['t', targetGroup]]);
            const items = [
                { kind: 'source', key: 's2' },
                { kind: 'source', key: 's1' }
            ];
            const parentMap = new Map();
            const treePlacement = {
                applyBatchPlacement: jest.fn(() => ({
                    ok: true,
                    changed: true,
                    reason: 'moved',
                    moved: items,
                    skipped: []
                })),
                rebuildParentMap: jest.fn()
            };
            const deps = createDeps({
                getGroupsById: () => groupsById,
                getParentMap: () => parentMap,
                treePlacement
            });
            const helper = createContentModalMove(deps);

            const result = helper.executeMoveToFolder(['s2', 's1'], 't');

            expect(result).toEqual(expect.objectContaining({
                ok: true,
                changed: true,
                moved: items,
                skipped: []
            }));
            expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
                items,
                target: {
                    container: 'group',
                    groupId: 't',
                    index: 1
                }
            });
            expect(deps.removeSourceFromTree).not.toHaveBeenCalled();
            expect(deps.buildParentMap).not.toHaveBeenCalled();
            expect(treePlacement.rebuildParentMap).toHaveBeenCalledWith(parentMap);
            expect(deps.saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
            expect(deps.render).toHaveBeenCalledTimes(1);
            expect(deps.closeManagedModal).toHaveBeenCalled();
        });

        it('exits batch mode after moving when there were pending batch keys', () => {
            const targetGroup = { id: 't', children: [] };
            const state = { isBatchMode: true };
            const pendingBatchKeys = new Set(['s1']);
            const deps = createDeps({
                getState: () => state,
                getGroupsById: () => new Map([['t', targetGroup]]),
                getPendingBatchKeys: () => pendingBatchKeys,
                treePlacement: {
                    applyBatchPlacement: jest.fn(() => ({
                        ok: true,
                        changed: true,
                        reason: 'moved',
                        moved: [{ kind: 'source', key: 's1' }],
                        skipped: []
                    })),
                    rebuildParentMap: jest.fn()
                }
            });
            const helper = createContentModalMove(deps);

            helper.executeMoveToFolder(['s1'], 't');

            expect(state.isBatchMode).toBe(false);
            expect(pendingBatchKeys.size).toBe(0);
        });

        it('accepts a single sourceKey string or an iterable, not only arrays', () => {
            const targetGroup = { id: 't', children: [] };
            const treePlacement = {
                applyBatchPlacement: jest.fn(() => ({
                    ok: true,
                    changed: true,
                    reason: 'moved',
                    moved: [{ kind: 'source', key: 's1' }],
                    skipped: []
                })),
                rebuildParentMap: jest.fn()
            };
            const deps = createDeps({
                getGroupsById: () => new Map([['t', targetGroup]]),
                treePlacement
            });
            const helper = createContentModalMove(deps);

            helper.executeMoveToFolder('s1', 't');

            expect(treePlacement.applyBatchPlacement).toHaveBeenCalledWith({
                items: [{ kind: 'source', key: 's1' }],
                target: {
                    container: 'group',
                    groupId: 't',
                    index: 0
                }
            });
        });

        it('keeps modal, batch state and effects unchanged for a semantic no-op', () => {
            const targetGroup = {
                id: 't',
                children: [{ type: 'source', key: 's1' }]
            };
            const state = { isBatchMode: true };
            const pendingBatchKeys = new Set(['s1']);
            const item = { kind: 'source', key: 's1' };
            const treePlacement = {
                applyBatchPlacement: jest.fn(() => ({
                    ok: true,
                    changed: false,
                    reason: 'no_change',
                    moved: [],
                    skipped: [{ item, reason: 'no_change' }]
                })),
                rebuildParentMap: jest.fn()
            };
            const deps = createDeps({
                getState: () => state,
                getGroupsById: () => new Map([['t', targetGroup]]),
                getPendingBatchKeys: () => pendingBatchKeys,
                treePlacement
            });
            const helper = createContentModalMove(deps);

            const result = helper.executeMoveToFolder(['s1'], 't');

            expect(result).toEqual(expect.objectContaining({
                ok: true,
                changed: false,
                reason: 'no_change'
            }));
            expect(state.isBatchMode).toBe(true);
            expect(Array.from(pendingBatchKeys)).toEqual(['s1']);
            expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
            expect(deps.closeSourceActionMenu).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.render).not.toHaveBeenCalled();
            expect(deps.closeManagedModal).not.toHaveBeenCalled();
        });

        it('returns an invalid placement result without closing or producing effects', () => {
            const targetGroup = { id: 't', children: [] };
            const item = { kind: 'source', key: 'missing' };
            const placementResult = {
                ok: false,
                changed: false,
                reason: 'not_found',
                moved: [],
                skipped: [{ item, reason: 'not_found' }]
            };
            const treePlacement = {
                applyBatchPlacement: jest.fn(() => placementResult),
                rebuildParentMap: jest.fn()
            };
            const deps = createDeps({
                getGroupsById: () => new Map([['t', targetGroup]]),
                treePlacement
            });
            const helper = createContentModalMove(deps);

            expect(helper.executeMoveToFolder(['missing'], 't')).toBe(placementResult);
            expect(treePlacement.rebuildParentMap).not.toHaveBeenCalled();
            expect(deps.closeSourceActionMenu).not.toHaveBeenCalled();
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.render).not.toHaveBeenCalled();
            expect(deps.closeManagedModal).not.toHaveBeenCalled();
        });

        it('converts placement exceptions into a stable failure without effects', () => {
            const targetGroup = { id: 't', children: [] };
            const deps = createDeps({
                getGroupsById: () => new Map([['t', targetGroup]]),
                treePlacement: {
                    applyBatchPlacement: jest.fn(() => {
                        throw new Error('stale target');
                    }),
                    rebuildParentMap: jest.fn()
                }
            });
            const helper = createContentModalMove(deps);

            expect(helper.executeMoveToFolder(['s1'], 't')).toEqual({
                ok: false,
                changed: false,
                reason: 'invalid_target',
                moved: [],
                skipped: [{
                    item: { kind: 'source', key: 's1' },
                    reason: 'invalid_target'
                }]
            });
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.render).not.toHaveBeenCalled();
            expect(deps.closeManagedModal).not.toHaveBeenCalled();
        });

        it('rejects a source that remains in the tree but is absent from the live source index', () => {
            const state = {
                root: [
                    { type: 'source', key: 'stale' },
                    { type: 'group', id: 'target' }
                ],
                ungrouped: []
            };
            const targetGroup = { id: 'target', children: [] };
            const groupsById = new Map([['target', targetGroup]]);
            const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
            const treePlacement = createContentTreePlacement({
                getState: () => state,
                getGroupsById: () => groupsById
            });
            const deps = createDeps({
                getState: () => state,
                getGroupsById: () => groupsById,
                getSourcesByKey: () => new Map(),
                treePlacement
            });
            const helper = createContentModalMove(deps);

            expect(helper.executeMoveToFolder(['stale'], 'target')).toEqual({
                ok: false,
                changed: false,
                reason: 'not_found',
                moved: [],
                skipped: [{
                    item: { kind: 'source', key: 'stale' },
                    reason: 'not_found'
                }]
            });
            expect(state.root).toEqual([
                { type: 'source', key: 'stale' },
                { type: 'group', id: 'target' }
            ]);
            expect(targetGroup.children).toEqual([]);
            expect(deps.saveState).not.toHaveBeenCalled();
            expect(deps.render).not.toHaveBeenCalled();
            expect(deps.closeManagedModal).not.toHaveBeenCalled();
        });

        it('moves live sources and reports stale tree keys as a partial result', () => {
            const state = {
                root: [
                    { type: 'source', key: 'live' },
                    { type: 'source', key: 'stale' },
                    { type: 'group', id: 'target' }
                ],
                ungrouped: [],
                isBatchMode: true
            };
            const targetGroup = { id: 'target', children: [] };
            const groupsById = new Map([['target', targetGroup]]);
            const pendingBatchKeys = new Set(['live', 'stale']);
            const parentMap = new Map();
            const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
            const treePlacement = createContentTreePlacement({
                getState: () => state,
                getGroupsById: () => groupsById
            });
            const deps = createDeps({
                getState: () => state,
                getGroupsById: () => groupsById,
                getSourcesByKey: () => new Map([['live', { key: 'live' }]]),
                getPendingBatchKeys: () => pendingBatchKeys,
                getParentMap: () => parentMap,
                treePlacement
            });
            const helper = createContentModalMove(deps);

            expect(helper.executeMoveToFolder(['live', 'stale'], 'target')).toEqual({
                ok: true,
                changed: true,
                reason: 'partial',
                moved: [{ kind: 'source', key: 'live' }],
                skipped: [{
                    item: { kind: 'source', key: 'stale' },
                    reason: 'not_found'
                }]
            });
            expect(state.root).toEqual([
                { type: 'source', key: 'stale' },
                { type: 'group', id: 'target' }
            ]);
            expect(targetGroup.children).toEqual([
                { type: 'source', key: 'live' }
            ]);
            expect(state.isBatchMode).toBe(false);
            expect(pendingBatchKeys.size).toBe(0);
            expect(deps.saveState).toHaveBeenCalledWith({
                immediate: true,
                critical: true
            });
        });
    });

    describe('renderMoveToFolderModal', () => {
        it('bails when shadowRoot is missing', () => {
            const deps = createDeps({ getShadowRoot: () => null });
            const helper = createContentModalMove(deps);
            helper.renderMoveToFolderModal(['s1']);
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('bails when no source keys are provided', () => {
            const deps = createDeps();
            const helper = createContentModalMove(deps);
            helper.renderMoveToFolderModal([]);
            expect(deps.prepareModalOpen).not.toHaveBeenCalled();
        });

        it('renders the empty-folders state when no groups exist', () => {
            const deps = createDeps();
            const helper = createContentModalMove(deps);
            helper.renderMoveToFolderModal(['s1']);

            expect(deps.prepareModalOpen).toHaveBeenCalledWith('sp-move-modal', 'sp-move-backdrop');
            const emptyMessageCall = deps.el.mock.calls.find(([, attrs]) => attrs?.className === 'sp-folder-empty');
            expect(emptyMessageCall).toBeDefined();
            expect(deps.getMessage).toHaveBeenCalledWith('ui_empty_folders');
        });

        it('renders a folder button per group; clicking it executes the move', () => {
            const state = {
                root: [{ type: 'group', id: 'g1' }],
                ungrouped: ['s1'],
                isBatchMode: false
            };
            const targetGroup = { id: 'g1', title: 'My Folder', children: [] };
            const groupsById = new Map([['g1', targetGroup]]);
            const parentMap = new Map();
            const createContentTreePlacement = require('../../src/content/content-tree-placement.js');
            const treePlacement = createContentTreePlacement({
                getState: () => state,
                getGroupsById: () => groupsById
            });
            const deps = createDeps({
                getState: () => state,
                getGroupsById: () => groupsById,
                getParentMap: () => parentMap,
                treePlacement
            });
            const helper = createContentModalMove(deps);

            helper.renderMoveToFolderModal(['s1']);

            const shadow = deps.getShadowRoot();
            const folderBtn = shadow.querySelector('.sp-folder-option');
            expect(folderBtn).toBeDefined();
            expect(folderBtn.dataset.groupId).toBe('g1');

            folderBtn.listeners.click[0]();
            expect(targetGroup.children).toEqual([{ type: 'source', key: 's1' }]);
            expect(deps.saveState).toHaveBeenCalled();
        });

        it('falls back to ui_group_untitled when a folder has no title', () => {
            const groupsById = new Map([['g1', { id: 'g1', children: [] }]]);
            const deps = createDeps({
                getState: () => ({ root: [{ type: 'group', id: 'g1' }], isBatchMode: false }),
                getGroupsById: () => groupsById
            });
            const helper = createContentModalMove(deps);

            helper.renderMoveToFolderModal(['s1']);

            expect(deps.getMessage).toHaveBeenCalledWith('ui_group_untitled');
        });

        it('backdrop click only closes when the click target IS the backdrop', () => {
            const deps = createDeps();
            const helper = createContentModalMove(deps);
            helper.renderMoveToFolderModal(['s1']);

            const backdrop = deps.getShadowRoot().querySelector('.sp-overlay-backdrop');
            backdrop.listeners.click[0]({ target: { id: 'something-else' } });
            expect(deps.closeManagedModal).not.toHaveBeenCalled();

            backdrop.listeners.click[0]({ target: backdrop });
            expect(deps.closeManagedModal).toHaveBeenCalled();
        });

        it('uses requestAnimationFrame to defer visibility when provided', () => {
            const rafCallbacks = [];
            const deps = createDeps({
                requestAnimationFrame: (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; }
            });
            const helper = createContentModalMove(deps);
            helper.renderMoveToFolderModal(['s1']);

            const modal = deps.getShadowRoot().querySelector('.sp-folder-modal');
            expect(modal.classList.add).not.toHaveBeenCalled();
            rafCallbacks[0]();
            expect(modal.classList.add).toHaveBeenCalledWith('visible');
        });

        it('applies modal item stagger style indexed per folder', () => {
            const groupsById = new Map([
                ['g1', { id: 'g1', title: 'A', children: [] }],
                ['g2', { id: 'g2', title: 'B', children: [] }]
            ]);
            const deps = createDeps({
                getState: () => ({ root: [{ type: 'group', id: 'g1' }, { type: 'group', id: 'g2' }], isBatchMode: false }),
                getGroupsById: () => groupsById
            });
            const helper = createContentModalMove(deps);

            helper.renderMoveToFolderModal(['s1']);

            expect(deps.createModalItemStaggerStyle).toHaveBeenNthCalledWith(1, 0, '');
            expect(deps.createModalItemStaggerStyle).toHaveBeenNthCalledWith(2, 1, '');
        });
    });
});
