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

describe('areAllAncestorsEnabled', () => {
    let areAllAncestorsEnabled, parentMap, groupsById;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        global.setTimeout = jest.fn();

        const mod = loadContentModule();
        areAllAncestorsEnabled = mod.areAllAncestorsEnabled;
        parentMap = mod.parentMap;
        groupsById = mod.groupsById;

        if (mod._resetState) mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('returns true if element has no parent', () => {
        expect(areAllAncestorsEnabled('child1')).toBe(true);
    });

    it('returns true if element parent is enabled', () => {
        parentMap.set('child1', 'parent1');
        groupsById.set('parent1', { id: 'parent1', enabled: true });
        expect(areAllAncestorsEnabled('child1')).toBe(true);
    });

    it('returns false if element parent is disabled', () => {
        parentMap.set('child1', 'parent1');
        groupsById.set('parent1', { id: 'parent1', enabled: false });
        expect(areAllAncestorsEnabled('child1')).toBe(false);
    });

    it('returns true if all ancestors are enabled in deep hierarchy', () => {
        parentMap.set('child1', 'parent1');
        parentMap.set('parent1', 'grandparent1');
        groupsById.set('parent1', { id: 'parent1', enabled: true });
        groupsById.set('grandparent1', { id: 'grandparent1', enabled: true });
        expect(areAllAncestorsEnabled('child1')).toBe(true);
    });

    it('returns false if any ancestor is disabled in deep hierarchy', () => {
        parentMap.set('child1', 'parent1');
        parentMap.set('parent1', 'grandparent1');
        groupsById.set('parent1', { id: 'parent1', enabled: true });
        groupsById.set('grandparent1', { id: 'grandparent1', enabled: false });
        expect(areAllAncestorsEnabled('child1')).toBe(false);
    });

    it('returns false if parent is not in groupsById (missing parent)', () => {
        parentMap.set('child1', 'parent1');
        expect(areAllAncestorsEnabled('child1')).toBe(false);
    });
});

describe('removeGroupFromTree', () => {
    let mod;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();

        mod = loadContentModule();
        mod._resetState();
    });

    afterEach(teardownGlobalMocks);

    it('removes a top-level group from state.groups', () => {
        mod.state.groups = ['group1', 'group2', 'group3'];
        mod.removeGroupFromTree('group2');
        expect(mod.state.groups).toEqual(['group1', 'group3']);
    });

    it('removes a nested group from its parent children array', () => {
        const parentGroup = { id: 'parent1', children: [{ id: 'child1' }, { id: 'child2' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('child1');

        expect(parentGroup.children).toEqual([{ id: 'child2' }]);
    });

    it('removes a group from both state.groups and parent children if present in both', () => {
        mod.state.groups = ['group1', 'orphanChild'];
        const parentGroup = { id: 'parent1', children: [{ id: 'orphanChild' }, { id: 'other' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('orphanChild');

        expect(mod.state.groups).toEqual(['group1']);
        expect(parentGroup.children).toEqual([{ id: 'other' }]);
    });

    it('does nothing if group id is not found', () => {
        mod.state.groups = ['group1'];
        const parentGroup = { id: 'parent1', children: [{ id: 'child1' }] };
        mod.groupsById.set('parent1', parentGroup);

        mod.removeGroupFromTree('nonExistent');

        expect(mod.state.groups).toEqual(['group1']);
        expect(parentGroup.children).toEqual([{ id: 'child1' }]);
    });

    it('tolerates persisted groups that are missing children arrays', () => {
        mod.state.groups = ['group1'];
        const parentGroup = { id: 'parent1' };
        mod.groupsById.set('parent1', parentGroup);

        expect(() => mod.removeGroupFromTree('group1')).not.toThrow();

        expect(mod.state.groups).toEqual([]);
        expect(parentGroup.children).toEqual([]);
    });
});

describe('drag and drop ordering guards', () => {
    let createContentTreeInteractions;

    const createClassList = (classes = []) => {
        const classSet = new Set(classes);
        return {
            contains: jest.fn((className) => classSet.has(className)),
            remove: jest.fn((...classNames) => {
                classNames.forEach((className) => classSet.delete(className));
            }),
            add: jest.fn((className) => {
                classSet.add(className);
            })
        };
    };

    const createDropEvent = ({ dropTarget, sourceKey = '', groupId = '' }) => ({
        preventDefault: jest.fn(),
        target: {
            closest: jest.fn(() => dropTarget)
        },
        dataTransfer: {
            getData: jest.fn((type) => {
                if (type === 'application/source-key') return sourceKey;
                if (type === 'application/group-id') return groupId;
                return '';
            })
        }
    });

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    it('creates unique group ids when multiple groups are added in the same millisecond', () => {
        const state = { groups: [], ungrouped: [] };
        const groupsById = new Map();
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            saveState,
            render,
            buildParentMap,
            getMessage: (key) => key
        });

        try {
            expect(interactions.handleAddNewGroup()).toBe(true);
            expect(interactions.handleAddNewGroup()).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }

        expect(state.groups).toEqual(['group_12345', 'group_12345_1']);
        expect(Array.from(groupsById.keys())).toEqual(['group_12345', 'group_12345_1']);
        expect(saveState).toHaveBeenCalledTimes(2);
        expect(render).toHaveBeenCalledTimes(2);
        expect(buildParentMap).toHaveBeenCalledTimes(2);
    });

    it('does not create an orphan subgroup when the parent group has gone stale', () => {
        const state = { groups: [], ungrouped: [] };
        const groupsById = new Map();
        const saveState = jest.fn();
        const render = jest.fn();
        const buildParentMap = jest.fn();
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            saveState,
            render,
            buildParentMap,
            getMessage: (key) => key
        });

        expect(interactions.handleAddNewGroup('missing-parent')).toBe(false);

        expect(groupsById.size).toBe(0);
        expect(state.groups).toEqual([]);
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(buildParentMap).not.toHaveBeenCalled();
    });

    it('ignores stale source row clicks when the source record no longer exists', () => {
        const state = { groups: [], ungrouped: [], isBatchMode: false };
        const sourceRow = {
            dataset: { sourceKey: 'missing-source' },
            querySelector: jest.fn(() => ({ checked: false }))
        };
        const openNativeDetails = jest.fn();
        const render = jest.fn();
        const saveState = jest.fn();
        const target = {
            classList: { contains: jest.fn(() => false) },
            closest: jest.fn((selector) => {
                if (selector === '.source-item') return sourceRow;
                if (selector === '.icon-container') return {};
                return null;
            })
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getSourcesByKey: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getSourceActionInvokers: () => ({ openNativeDetails }),
            saveState,
            render
        });

        expect(() => interactions.handleInteraction({ target })).not.toThrow();
        expect(openNativeDetails).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
    });

    it('tolerates stale parent maps that point to groups without children arrays', () => {
        const state = { groups: [], ungrouped: ['source-1'] };
        const groupsById = new Map([
            ['group-1', { id: 'group-1', title: 'Legacy Group' }]
        ]);
        const parentMap = new Map([
            ['source-1', 'group-1']
        ]);
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap
        });

        expect(() => interactions.removeSourceFromTree('source-1')).not.toThrow();

        expect(groupsById.get('group-1').children).toEqual([]);
    });

    it('does not save or render when a source is dropped back into the same position', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { sourceKey: 'source-1' },
            classList: createClassList(['source-item'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['source-1']),
                currentIntent: { kind: 'before-source' }
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));

        expect(state.ungrouped).toEqual(['source-1', 'source-2']);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('saves legal source moves after applying the final insertion index', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { sourceKey: 'source-2' },
            classList: createClassList(['source-item'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['source-1']),
                currentIntent: { kind: 'after-source' }
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));

        expect(state.ungrouped).toEqual(['source-2', 'source-1']);
        expect(render).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
    });

    it('prevents moving a group into itself or its own subtree', () => {
        const state = { groups: ['root'], ungrouped: [] };
        const groupsById = new Map([
            ['root', {
                id: 'root',
                children: [{ type: 'group', id: 'child' }]
            }],
            ['child', {
                id: 'child',
                children: []
            }]
        ]);
        const parentMap = new Map([['child', 'root']]);
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'child' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            isDescendant: global.isDescendant,
            saveState,
            render
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'root' }));

        expect(state.groups).toEqual(['root']);
        expect(groupsById.get('root').children).toEqual([{ type: 'group', id: 'child' }]);
        expect(render).not.toHaveBeenCalled();
        expect(saveState).not.toHaveBeenCalled();
    });

    it('clears dragging and drop marker classes on drag end', () => {
        const markedNodes = [
            { classList: createClassList(['dragging']) },
            { classList: createClassList(['drag-into']) }
        ];
        const interactions = createContentTreeInteractions({
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => markedNodes) })
        });

        expect(interactions.clearDragFeedback()).toBe(2);
        markedNodes.forEach((node) => {
            expect(node.classList.remove).toHaveBeenCalledWith('dragging', 'drag-into', 'drag-invalid');
        });
    });

    it('opens batch tag modals from the batch action bar', () => {
        const state = { isBatchMode: true };
        const pendingBatchKeys = new Set(['source-1']);
        const renderBatchTagModal = jest.fn();
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getSourcesByKey: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            renderBatchTagModal
        });
        const createEvent = (buttonClass) => ({
            target: {
                classList: { contains: jest.fn(() => false) },
                closest: jest.fn((selector) => {
                    if (selector === '.group-container') return null;
                    if (selector === '.source-item') return null;
                    if (selector === buttonClass) return {};
                    return null;
                })
            }
        });

        interactions.handleInteraction(createEvent('.sp-batch-add-tags-btn'));
        interactions.handleInteraction(createEvent('.sp-batch-remove-tags-btn'));

        expect(renderBatchTagModal).toHaveBeenNthCalledWith(1, 'add', pendingBatchKeys);
        expect(renderBatchTagModal).toHaveBeenNthCalledWith(2, 'remove', pendingBatchKeys);
    });

    it('moves selected grouped sources to ungrouped in visible tree order', () => {
        const state = { groups: ['root'], ungrouped: ['source-3'], isBatchMode: true };
        const root = {
            id: 'root',
            children: [
                { type: 'source', key: 'source-1' },
                { type: 'group', id: 'child' }
            ]
        };
        const child = {
            id: 'child',
            children: [{ type: 'source', key: 'source-2' }]
        };
        const groupsById = new Map([
            ['root', root],
            ['child', child]
        ]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', enabled: true }],
            ['source-2', { key: 'source-2', enabled: true }],
            ['source-3', { key: 'source-3', enabled: true }]
        ]);
        const parentMap = new Map([
            ['source-1', 'root'],
            ['child', 'root'],
            ['source-2', 'child']
        ]);
        const pendingBatchKeys = new Set(['source-2', 'source-1', 'source-3']);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => parentMap,
            getPendingBatchKeys: () => pendingBatchKeys,
            saveState,
            render,
            showToast,
            buildParentMap,
            closeSourceActionMenu: jest.fn(),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        expect(interactions.executeBatchMoveToUngrouped()).toBe(true);

        expect(root.children).toEqual([{ type: 'group', id: 'child' }]);
        expect(child.children).toEqual([]);
        expect(state.ungrouped).toEqual(['source-3', 'source-1', 'source-2']);
        expect(buildParentMap).toHaveBeenCalled();
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(pendingBatchKeys.size).toBe(0);
        expect(state.isBatchMode).toBe(false);
        expect(showToast).toHaveBeenCalledWith('ui_batch_ungrouped_toast:2', { variant: 'success' });
    });

    it('moves grouped sources to ungrouped through source menu helpers', () => {
        const state = { groups: ['root'], ungrouped: ['source-2'] };
        const root = {
            id: 'root',
            children: [{ type: 'source', key: 'source-1' }]
        };
        const groupsById = new Map([['root', root]]);
        const sourcesByKey = new Map([
            ['source-1', { key: 'source-1', enabled: true }],
            ['source-2', { key: 'source-2', enabled: true }]
        ]);
        const parentMap = new Map([['source-1', 'root']]);
        const saveState = jest.fn();
        const render = jest.fn();
        const showUndoableToast = jest.fn();
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getSourcesByKey: () => sourcesByKey,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            saveState,
            render,
            showUndoableToast,
            buildParentMap: jest.fn(),
            closeSourceActionMenu: jest.fn(),
            getMessage: (key) => key
        });

        expect(interactions.canMoveSourceToUngrouped('source-1')).toBe(true);
        expect(interactions.moveSourceToUngrouped('source-1')).toBe(true);

        expect(root.children).toEqual([]);
        expect(state.ungrouped).toEqual(['source-2', 'source-1']);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalled();
        expect(showUndoableToast).toHaveBeenCalledWith('ui_keyboard_moved_ungrouped_toast', { variant: 'success' });
    });

});

describe('handleDragStart multi-source branch', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createTargetClosestStub = (sourceRow, { inCheckbox = false } = {}) => jest.fn((selector) => {
        if (selector === '.source-item') return sourceRow;
        if (selector === '.group-header') return null;
        if (selector === 'input[type="checkbox"], .sp-batch-checkbox') return inCheckbox ? {} : null;
        return null;
    });

    const createDataTransfer = () => ({
        setData: jest.fn(),
        setDragImage: jest.fn(),
        effectAllowed: ''
    });

    const createSourceRow = (key) => ({
        dataset: { sourceKey: key },
        classList: { add: jest.fn(), remove: jest.fn() }
    });

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('writes only application/source-key when batch mode is off', () => {
        const state = { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const setTimeoutCalls = [];

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => null,
            getSetTimeout: () => (fn) => { setTimeoutCalls.push(fn); },
            dragMulti: createContentDragMulti({})
        });

        const event = {
            target: { closest: createTargetClosestStub(sourceRow) },
            dataTransfer
        };
        interactions.handleDragStart(event);

        expect(dataTransfer.setData).toHaveBeenCalledWith('application/source-key', 'A');
        const sourceKeysCall = dataTransfer.setData.mock.calls.find((args) => args[0] === 'application/source-keys');
        expect(sourceKeysCall).toBeUndefined();
        expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
    });

    it('writes application/source-keys (ordered) and sets a custom drag image when batch mode is on and origin is selected', () => {
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: [] };
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const setTimeoutCalls = [];
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const fakeDoc = { body: fakeBody };
        const otherRows = new Map([
            ['B', createSourceRow('B')],
            ['C', createSourceRow('C')]
        ]);
        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                const match = selector.match(/\[data-source-key="([^"]+)"\]/);
                if (!match) return null;
                if (match[1] === 'A') return sourceRow;
                return otherRows.get(match[1]) || null;
            }),
            querySelectorAll: jest.fn(() => [])
        };
        const dragMulti = {
            resolveDragSelection: jest.fn(({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder }) =>
                createContentDragMulti({}).resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder })),
            createMultiDragGhost: jest.fn(() => ghostNode),
            destroyMultiDragGhost: jest.fn()
        };

        const runtime = {};
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => fakeDoc,
            getSetTimeout: () => (fn) => { setTimeoutCalls.push(fn); },
            dragMulti
        });

        const event = {
            target: { closest: createTargetClosestStub(sourceRow) },
            dataTransfer
        };
        interactions.handleDragStart(event);

        expect(dragMulti.resolveDragSelection).toHaveBeenCalledTimes(1);
        const callArgs = dragMulti.resolveDragSelection.mock.calls[0][0];
        expect(callArgs.originKey).toBe('A');
        expect(callArgs.isBatchMode).toBe(true);
        expect(callArgs.pendingBatchKeys).toBe(pendingBatchKeys);
        expect(callArgs.sourceOrder).toEqual(['A', 'B', 'C']);

        expect(dataTransfer.setData).toHaveBeenCalledWith('application/source-key', 'A');
        expect(dataTransfer.setData).toHaveBeenCalledWith('application/source-keys', JSON.stringify(['A', 'B', 'C']));
        expect(dragMulti.createMultiDragGhost).toHaveBeenCalledWith(expect.objectContaining({ count: 3, root: fakeBody }));
        expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
        expect(runtime.activeDragGhost).toBe(ghostNode);

        // Flush the queued setTimeout(0) — every selected row should get `.dragging`.
        setTimeoutCalls.forEach((fn) => fn());
        expect(sourceRow.classList.add).toHaveBeenCalledWith('dragging');
        expect(otherRows.get('B').classList.add).toHaveBeenCalledWith('dragging');
        expect(otherRows.get('C').classList.add).toHaveBeenCalledWith('dragging');
    });

    it('falls back to single-source drag when batch mode is on but origin is not in the selection', () => {
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'X'], groups: [] };
        const pendingBatchKeys = new Set(['A', 'B']);
        const sourceRow = createSourceRow('X');
        const dataTransfer = createDataTransfer();
        const setTimeoutCalls = [];

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => null,
            getSetTimeout: () => (fn) => { setTimeoutCalls.push(fn); },
            dragMulti: createContentDragMulti({})
        });

        const event = {
            target: { closest: createTargetClosestStub(sourceRow) },
            dataTransfer
        };
        interactions.handleDragStart(event);

        expect(dataTransfer.setData).toHaveBeenCalledWith('application/source-key', 'X');
        const sourceKeysCall = dataTransfer.setData.mock.calls.find((args) => args[0] === 'application/source-keys');
        expect(sourceKeysCall).toBeUndefined();
        expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
    });
});

describe('drop routes multi vs single source', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createClassList = (classes = []) => {
        const classSet = new Set(classes);
        return {
            contains: jest.fn((className) => classSet.has(className)),
            remove: jest.fn((...classNames) => {
                classNames.forEach((className) => classSet.delete(className));
            }),
            add: jest.fn((className) => {
                classSet.add(className);
            })
        };
    };

    const createDropEvent = ({ dropTarget, sourceKey = '', sourceKeysJson = '', groupId = '' }) => ({
        preventDefault: jest.fn(),
        target: {
            closest: jest.fn(() => dropTarget)
        },
        dataTransfer: {
            getData: jest.fn((type) => {
                if (type === 'application/source-key') return sourceKey;
                if (type === 'application/source-keys') return sourceKeysJson;
                if (type === 'application/group-id') return groupId;
                return '';
            })
        }
    });

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('routes multi-key drops through applyMultiSourceDrop, exits batch mode, saves, renders, and toasts', () => {
        const group = { id: 'g1', children: [] };
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C', 'D'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }],
            ['D', { key: 'D' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            showToast,
            buildParentMap,
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B', 'C'])
        }));

        expect(saveState).toHaveBeenCalledTimes(1);
        expect(saveState).toHaveBeenCalledWith({ immediate: true, critical: true });
        expect(render).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast.mock.calls[0][0]).toEqual(expect.stringContaining('3'));
        expect(state.isBatchMode).toBe(false);
        expect(pendingBatchKeys.size).toBe(0);
        expect(group.children).toEqual([
            { type: 'source', key: 'A' },
            { type: 'source', key: 'B' },
            { type: 'source', key: 'C' }
        ]);
        expect(state.ungrouped).toEqual(['D']);
    });

    it('does not exit batch mode or toast on a no-op multi-drop', () => {
        const state = { isBatchMode: true, ungrouped: ['A', 'B'], groups: [] };
        const groupsById = new Map();
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B']);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const dropTarget = {
            dataset: { sourceKey: 'A' },
            classList: createClassList(['source-item'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: { kind: 'before-source' }
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            showToast,
            buildParentMap,
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B'])
        }));

        expect(showToast).not.toHaveBeenCalled();
        expect(state.isBatchMode).toBe(true);
        expect(pendingBatchKeys.size).toBe(2);
        expect(developerLog).not.toHaveBeenCalled();
    });

    it('falls back to single-source path when application/source-keys is absent', () => {
        const group = { id: 'g1', children: [] };
        const state = { isBatchMode: false, ungrouped: ['A', 'B'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }]
        ]);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            showToast,
            buildParentMap,
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A'
        }));

        expect(group.children).toEqual([{ type: 'source', key: 'A' }]);
        expect(state.ungrouped).toEqual(['B']);
        expect(showToast).not.toHaveBeenCalled();
        expect(developerLog).not.toHaveBeenCalled();
    });

    it('logs batch_drag_move with count and intent.kind on successful multi-drop', () => {
        const group = { id: 'g1', children: [] };
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C', 'D'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }],
            ['D', { key: 'D' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const developerLog = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState: jest.fn(),
            render: jest.fn(),
            showToast: jest.fn(),
            buildParentMap: jest.fn(),
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B', 'C'])
        }));

        expect(developerLog).toHaveBeenCalledWith(
            'info',
            'source_action',
            'batch_drag_move',
            expect.objectContaining({
                count: 3,
                intent: 'into-group'
            })
        );
    });

    it('does not corrupt state.groups when intent is before-group at top level', () => {
        const group = { id: 'g1', children: [] };
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B']);
        const saveState = jest.fn();
        const render = jest.fn();
        const showToast = jest.fn();
        const buildParentMap = jest.fn();
        const developerLog = jest.fn();
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container'])
        };
        const runtime = {
            dragReflowSession: {
                draggedKeys: new Set(['A', 'B']),
                currentIntent: { kind: 'before-group' }
            }
        };
        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState,
            render,
            showToast,
            buildParentMap,
            developerLog,
            dragMulti: createContentDragMulti({}),
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B'])
        }));

        expect(state.groups).toEqual(['g1']);
        expect(state.ungrouped).toEqual(['A', 'B', 'C']);
        expect(group.children).toEqual([]);
        expect(state.isBatchMode).toBe(true);
        expect(pendingBatchKeys.size).toBe(2);
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
        expect(developerLog).not.toHaveBeenCalled();
    });
});

describe('drag auto-scroll integration', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function makeRaf() {
        let nextId = 1;
        const callbacks = new Map();
        return {
            requestAnimationFrame: jest.fn((cb) => {
                const id = nextId++;
                callbacks.set(id, cb);
                return id;
            }),
            cancelAnimationFrame: jest.fn((id) => {
                callbacks.delete(id);
            })
        };
    }

    function makeListEl({ top, bottom }) {
        return {
            id: 'sources-list',
            scrollTop: 0,
            scrollBy: jest.fn(),
            getBoundingClientRect: jest.fn(() => ({ top, bottom, left: 0, right: 200, height: bottom - top, width: 200 }))
        };
    }

    function makeShadowRoot(listEl) {
        return {
            getElementById: jest.fn((id) => (id === 'sources-list' ? listEl : null)),
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => [])
        };
    }

    function makeDragOverEvent({ clientY, dropTarget }) {
        return {
            preventDefault: jest.fn(),
            clientY,
            target: {
                closest: jest.fn(() => dropTarget)
            }
        };
    }

    function makeDropTarget() {
        const classes = new Set(['source-item']);
        return {
            dataset: { sourceKey: 'A' },
            classList: {
                contains: (c) => classes.has(c),
                add: (c) => classes.add(c),
                remove: (...cs) => cs.forEach((c) => classes.delete(c))
            },
            getBoundingClientRect: () => ({ top: 200, bottom: 240, left: 0, right: 200, height: 40, width: 200 })
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('starts scrolling when pointer hovers near the top edge of #sources-list', () => {
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const listEl = makeListEl({ top: 100, bottom: 500 });
        const shadowRoot = makeShadowRoot(listEl);
        const raf = makeRaf();
        const dragMulti = createContentDragMulti({
            requestAnimationFrame: raf.requestAnimationFrame,
            cancelAnimationFrame: raf.cancelAnimationFrame
        });

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti
        });

        const event = makeDragOverEvent({ clientY: 110, dropTarget: makeDropTarget() });
        interactions.handleDragOver(event);

        expect(raf.requestAnimationFrame).toHaveBeenCalled();
    });

    it('does not start scrolling when pointer is in the middle of #sources-list', () => {
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const listEl = makeListEl({ top: 100, bottom: 500 });
        const shadowRoot = makeShadowRoot(listEl);
        const raf = makeRaf();
        const dragMulti = createContentDragMulti({
            requestAnimationFrame: raf.requestAnimationFrame,
            cancelAnimationFrame: raf.cancelAnimationFrame
        });

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti
        });

        const event = makeDragOverEvent({ clientY: 300, dropTarget: makeDropTarget() });
        interactions.handleDragOver(event);

        expect(raf.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it('cancels the pending RAF on handleDragEnd', () => {
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const listEl = makeListEl({ top: 100, bottom: 500 });
        const shadowRoot = makeShadowRoot(listEl);
        const raf = makeRaf();
        const dragMulti = createContentDragMulti({
            requestAnimationFrame: raf.requestAnimationFrame,
            cancelAnimationFrame: raf.cancelAnimationFrame
        });

        const interactions = createContentTreeInteractions({
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti
        });

        // Trigger scrolling first
        interactions.handleDragOver(makeDragOverEvent({ clientY: 110, dropTarget: makeDropTarget() }));
        expect(raf.requestAnimationFrame).toHaveBeenCalled();

        // dragend should cancel pending RAF
        interactions.handleDragEnd({});
        expect(raf.cancelAnimationFrame).toHaveBeenCalled();
    });
});

describe('activeDragContext runtime state', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createSourceRowTargetStub = (sourceRow) => ({
        closest: jest.fn((selector) => {
            if (selector === '.source-item') return sourceRow;
            if (selector === '.group-header') return null;
            if (selector === 'input[type="checkbox"], .sp-batch-checkbox') return null;
            return null;
        })
    });

    const createGroupHeaderTargetStub = (groupHeader) => ({
        closest: jest.fn((selector) => {
            if (selector === '.source-item') return null;
            if (selector === '.group-header') return groupHeader;
            return null;
        })
    });

    const createSourceRow = (key) => ({
        dataset: { sourceKey: key },
        classList: { add: jest.fn(), remove: jest.fn() }
    });

    const createGroupHeader = (groupId) => ({
        dataset: { groupId },
        classList: { add: jest.fn(), remove: jest.fn() }
    });

    const createDataTransfer = () => ({
        setData: jest.fn(),
        setDragImage: jest.fn(),
        effectAllowed: ''
    });

    function makeInteractions({ state, pendingBatchKeys, runtime, shadowRoot = null, document = null }) {
        return createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => document,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({})
        });
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('sets source-single context on dragstart over a non-batch source row', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] };
        const pendingBatchKeys = new Set();
        const interactions = makeInteractions({ state, pendingBatchKeys, runtime });
        const sourceRow = createSourceRow('A');

        const event = {
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        };
        interactions.handleDragStart(event);

        expect(runtime.activeDragContext).toEqual({ kind: 'source-single', keys: ['A'] });
    });

    it('sets source-multi context on dragstart in batch mode with multi-selection', () => {
        const runtime = {};
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: [] };
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const sourceRow = createSourceRow('A');
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const fakeDoc = { body: fakeBody };
        const interactions = makeInteractions({
            state,
            pendingBatchKeys,
            runtime,
            shadowRoot: { querySelector: jest.fn(() => null), querySelectorAll: jest.fn(() => []) },
            document: fakeDoc
        });

        const event = {
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        };
        interactions.handleDragStart(event);

        expect(runtime.activeDragContext).toEqual({ kind: 'source-multi', keys: ['A', 'B', 'C'] });
    });

    it('sets group context on dragstart over a group header', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: [], groups: ['g1'] };
        const pendingBatchKeys = new Set();
        const interactions = makeInteractions({ state, pendingBatchKeys, runtime });
        const groupHeader = createGroupHeader('g1');

        const event = {
            target: createGroupHeaderTargetStub(groupHeader),
            dataTransfer: createDataTransfer()
        };
        interactions.handleDragStart(event);

        expect(runtime.activeDragContext).toEqual({ kind: 'group', draggedGroupId: 'g1' });
    });

    it('clears activeDragContext on handleDragEnd', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const interactions = makeInteractions({ state, pendingBatchKeys, runtime });
        runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };

        interactions.handleDragEnd({ target: createSourceRowTargetStub(createSourceRow('A')) });

        expect(runtime.activeDragContext).toBe(null);
    });

    it('clears activeDragContext on clearDragFeedback', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const interactions = makeInteractions({ state, pendingBatchKeys, runtime });
        runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };

        interactions.clearDragFeedback();

        expect(runtime.activeDragContext).toBe(null);
    });
});

describe('handleDragStart reflow session + unified ghost', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createSourceRowTargetStub = (sourceRow) => ({
        closest: jest.fn((selector) => {
            if (selector === '.source-item') return sourceRow;
            if (selector === '.group-header') return null;
            if (selector === 'input[type="checkbox"], .sp-batch-checkbox') return null;
            return null;
        })
    });

    const createSourceRow = (key) => ({
        dataset: { sourceKey: key },
        classList: { add: jest.fn(), remove: jest.fn() }
    });

    const createDataTransfer = () => ({
        setData: jest.fn(),
        setDragImage: jest.fn(),
        effectAllowed: ''
    });

    const createDragReflowMock = () => ({
        prepareDragSession: jest.fn(({ draggedKeys }) => ({
            draggedKeys: new Set(Array.isArray(draggedKeys) ? draggedKeys : []),
            itemHeights: new Map(),
            totalDraggedHeight: 0,
            currentIntent: null,
            shiftedItems: new Map()
        })),
        foldDraggedItems: jest.fn()
    });

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
        global.__rafCallbacks = [];
        global.requestAnimationFrame = (cb) => {
            global.__rafCallbacks.push(cb);
            return global.__rafCallbacks.length;
        };
    });

    afterEach(() => {
        teardownGlobalMocks();
        delete global.requestAnimationFrame;
    });

    it('prepares a reflow session on dragstart with selection.keys and stores it on runtime', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dragReflow = createDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => null,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        const event = {
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        };
        interactions.handleDragStart(event);

        expect(dragReflow.prepareDragSession).toHaveBeenCalledTimes(1);
        const prepCallArgs = dragReflow.prepareDragSession.mock.calls[0][0];
        expect(prepCallArgs.draggedKeys).toEqual(['A']);
        expect(prepCallArgs.rootElement).toBe(sourcesListEl);
        expect(runtime.dragReflowSession).toBeDefined();
        expect(runtime.dragReflowSession.draggedKeys.has('A')).toBe(true);
    });

    it('schedules foldDraggedItems via requestAnimationFrame after prepare', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dragReflow = createDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => null,
            getSetTimeout: () => () => {},
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer: createDataTransfer()
        });

        // foldDraggedItems should not be called synchronously
        expect(dragReflow.foldDraggedItems).not.toHaveBeenCalled();
        expect(global.__rafCallbacks.length).toBeGreaterThan(0);

        // Flush the queued RAF — foldDraggedItems should fire
        global.__rafCallbacks.forEach((cb) => cb && cb());
        expect(dragReflow.foldDraggedItems).toHaveBeenCalledTimes(1);
        const foldArgs = dragReflow.foldDraggedItems.mock.calls[0][0];
        expect(foldArgs.session).toBe(runtime.dragReflowSession);
        expect(foldArgs.rootElement).toBe(sourcesListEl);
    });

    it('creates a custom ghost with count=1 on single-source dragstart and calls setDragImage', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const transparentCanvas = { tagName: 'CANVAS', width: 0, height: 0 };
        const fakeDoc = {
            body: fakeBody,
            createElement: jest.fn((tag) => (tag === 'canvas' ? transparentCanvas : null))
        };
        const dragMulti = {
            resolveDragSelection: jest.fn(({ originKey }) => ({ keys: [originKey], isMulti: false })),
            createMultiDragGhost: jest.fn(() => ghostNode),
            destroyMultiDragGhost: jest.fn(),
            cloneSourceItem: jest.fn()
        };

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => null,
            getDocument: () => fakeDoc,
            getSetTimeout: () => () => {},
            dragMulti,
            dragReflow: null
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer
        });

        expect(dragMulti.createMultiDragGhost).toHaveBeenCalledWith(expect.objectContaining({
            count: 1,
            root: fakeBody,
            sourceClones: expect.any(Array)
        }));
        expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
        // Browser natively captures + follows the ghost as drag image; offset falls back to (12, 12).
        expect(dataTransfer.setDragImage).toHaveBeenCalledWith(ghostNode, 12, 12);
        expect(runtime.activeDragGhost).toBe(ghostNode);
    });

    it('creates a custom ghost with count=N on multi-source dragstart and calls setDragImage with the ghost', () => {
        const runtime = {};
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: [] };
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const transparentCanvas = { tagName: 'CANVAS', width: 0, height: 0 };
        const fakeDoc = {
            body: fakeBody,
            createElement: jest.fn((tag) => (tag === 'canvas' ? transparentCanvas : null))
        };
        const otherRows = new Map([
            ['B', createSourceRow('B')],
            ['C', createSourceRow('C')]
        ]);
        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                const match = selector.match(/\[data-source-key="([^"]+)"\]/);
                if (!match) return null;
                if (match[1] === 'A') return sourceRow;
                return otherRows.get(match[1]) || null;
            }),
            querySelectorAll: jest.fn(() => [])
        };
        const dragMulti = {
            resolveDragSelection: jest.fn(({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder }) =>
                createContentDragMulti({}).resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder })),
            createMultiDragGhost: jest.fn(() => ghostNode),
            destroyMultiDragGhost: jest.fn(),
            cloneSourceItem: jest.fn()
        };

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => fakeDoc,
            getSetTimeout: () => () => {},
            dragMulti,
            dragReflow: null
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer
        });

        expect(dragMulti.createMultiDragGhost).toHaveBeenCalledWith(expect.objectContaining({
            count: 3,
            root: fakeBody,
            sourceClones: expect.any(Array)
        }));
        expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
        expect(dataTransfer.setDragImage).toHaveBeenCalledWith(ghostNode, 12, 12);
        expect(runtime.activeDragGhost).toBe(ghostNode);
    });

    it('clones up to 3 source-items and computes setDragImage offset from pointer-in-row on multi-source dragstart', () => {
        const runtime = {};
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C', 'D'], groups: [] };
        const pendingBatchKeys = new Set(['A', 'B', 'C', 'D']);
        const originalA = {
            dataset: { sourceKey: 'A' },
            classList: { add: jest.fn(), remove: jest.fn() },
            getBoundingClientRect: jest.fn(() => ({ left: 50, top: 100, width: 300, height: 60 }))
        };
        const originalB = { dataset: { sourceKey: 'B' }, classList: { add: jest.fn(), remove: jest.fn() } };
        const originalC = { dataset: { sourceKey: 'C' }, classList: { add: jest.fn(), remove: jest.fn() } };
        const originalD = { dataset: { sourceKey: 'D' }, classList: { add: jest.fn(), remove: jest.fn() } };
        const sourcesListEl = {
            querySelector: jest.fn((selector) => {
                const match = selector.match(/\[data-source-key="([^"]+)"\]/);
                if (!match) return null;
                if (match[1] === 'A') return originalA;
                if (match[1] === 'B') return originalB;
                if (match[1] === 'C') return originalC;
                if (match[1] === 'D') return originalD;
                return null;
            })
        };
        const shadowRoot = {
            querySelector: jest.fn((selector) => {
                const match = selector.match(/\[data-source-key="([^"]+)"\]/);
                if (!match) return null;
                if (match[1] === 'A') return originalA;
                if (match[1] === 'B') return originalB;
                if (match[1] === 'C') return originalC;
                if (match[1] === 'D') return originalD;
                return null;
            }),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };

        const dataTransfer = createDataTransfer();
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const fakeDoc = { body: fakeBody };

        const clonedNodes = [];
        const dragMulti = {
            resolveDragSelection: jest.fn(({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder }) =>
                createContentDragMulti({}).resolveDragSelection({ originKey, isBatchMode, pendingBatchKeys: keys, sourceOrder })),
            createMultiDragGhost: jest.fn(() => ghostNode),
            destroyMultiDragGhost: jest.fn(),
            cloneSourceItem: jest.fn((node) => {
                const clone = { _clonedFrom: node && node.dataset && node.dataset.sourceKey };
                clonedNodes.push(clone);
                return clone;
            })
        };

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getDocument: () => fakeDoc,
            getSetTimeout: () => () => {},
            dragMulti,
            dragReflow: null
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(originalA),
            dataTransfer,
            clientX: 120,
            clientY: 130
        });

        // Cap at 3 clones even though selection is 4.
        expect(dragMulti.cloneSourceItem).toHaveBeenCalledTimes(3);
        expect(dragMulti.createMultiDragGhost).toHaveBeenCalledTimes(1);
        const ghostArgs = dragMulti.createMultiDragGhost.mock.calls[0][0];
        expect(ghostArgs.count).toBe(4);
        expect(ghostArgs.sourceClones).toHaveLength(3);
        expect(ghostArgs.sourceClones[0]._clonedFrom).toBe('A');
        expect(ghostArgs.sourceClones[1]._clonedFrom).toBe('B');
        expect(ghostArgs.sourceClones[2]._clonedFrom).toBe('C');

        // Offset is clientX - rect.left, clientY - rect.top → (70, 30).
        expect(dataTransfer.setDragImage).toHaveBeenCalledWith(ghostNode, 70, 30);
        expect(runtime.activeDragGhost).toBe(ghostNode);
    });

    it('falls back to (12, 12) drag-image offset when sources-list lookup fails', () => {
        const runtime = {};
        const state = { isBatchMode: false, ungrouped: ['A'], groups: [] };
        const pendingBatchKeys = new Set();
        const sourceRow = createSourceRow('A');
        const dataTransfer = createDataTransfer();
        const ghostNode = { tagName: 'DIV' };
        const fakeBody = { appendChild: jest.fn(() => ghostNode) };
        const fakeDoc = { body: fakeBody };
        const dragMulti = {
            resolveDragSelection: jest.fn(({ originKey }) => ({ keys: [originKey], isMulti: false })),
            createMultiDragGhost: jest.fn(() => ghostNode),
            destroyMultiDragGhost: jest.fn(),
            cloneSourceItem: jest.fn()
        };

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => null,
            getDocument: () => fakeDoc,
            getSetTimeout: () => () => {},
            dragMulti,
            dragReflow: null
        });

        interactions.handleDragStart({
            target: createSourceRowTargetStub(sourceRow),
            dataTransfer,
            clientX: 200,
            clientY: 200
        });

        expect(dragMulti.cloneSourceItem).not.toHaveBeenCalled();
        expect(dragMulti.createMultiDragGhost).toHaveBeenCalledWith(expect.objectContaining({
            sourceClones: []
        }));
        expect(dataTransfer.setDragImage).toHaveBeenCalledWith(ghostNode, 12, 12);
    });
});

describe('handleDragOver invalid-drop feedback', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function makeClassList(initial = []) {
        const classes = new Set(initial);
        const api = {
            add: (...cs) => cs.forEach((c) => classes.add(c)),
            remove: (...cs) => cs.forEach((c) => classes.delete(c)),
            contains: (c) => classes.has(c),
            has: (c) => classes.has(c)
        };
        return api;
    }

    function setupTreeInteractionsTestContext({ state, pendingBatchKeys, groups }) {
        const runtime = {};
        const groupsById = new Map();
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const sourceItemElements = new Map();
        function getOrCreateSlotEl(sourceKey) {
            if (!sourceItemElements.has(sourceKey)) {
                sourceItemElements.set(sourceKey, {
                    dataset: { sourceKey },
                    classList: makeClassList(['source-item'])
                });
            }
            return sourceItemElements.get(sourceKey);
        }
        const sourcesListEl = {
            id: 'sources-list',
            querySelector: (selector) => {
                const match = selector.match(/\[data-source-key="([^"]+)"\]/);
                if (!match) return null;
                return sourceItemElements.has(match[1]) ? sourceItemElements.get(match[1]) : null;
            },
            querySelectorAll: () => {
                const matches = [];
                sourceItemElements.forEach((el) => {
                    if (el.classList.has('drag-invalid')) matches.push(el);
                });
                return matches;
            }
        };
        const shadowRoot = {
            getElementById: (id) => (id === 'sources-list' ? sourcesListEl : null),
            querySelectorAll: () => []
        };
        const dragMulti = createContentDragMulti({});
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getParentMap: () => new Map(),
            isDescendant: globalThis.isDescendant,
            dragMulti
        });

        function makeSourceItemTarget(key, { intent } = {}) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const slotEl = getOrCreateSlotEl(key);
            const classList = slotEl.classList;
            if (intent) classList.add(intent);
            const target = {
                dataset: { sourceKey: key },
                classList,
                rect,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.source-item') return target;
                if (selector === '.group-container') return null;
                return null;
            };
            return target;
        }

        function makeGroupContainerTarget(groupId, { intent } = {}) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const initial = ['group-container'];
            const classList = makeClassList(initial);
            if (intent) classList.add(intent);
            const target = {
                dataset: { groupId },
                classList,
                rect,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.group-container') return target;
                if (selector === '.source-item') return null;
                return null;
            };
            return target;
        }

        return {
            runtime,
            tree,
            helpers: { makeSourceItemTarget, makeGroupContainerTarget, getOrCreateSlotEl },
            groupsById,
            sourcesListEl
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('marks drop target invalid when dragging a single source over itself', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set()
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        const target = ctx.helpers.makeSourceItemTarget('A');
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer
        });
        expect(target.classList.has('drag-invalid')).toBe(true);
        expect(target.classList.has('drag-over-top')).toBe(false);
        expect(target.classList.has('drag-over-bottom')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('marks drop target invalid when dragging a group over its own descendant', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'group', id: 'g2' }] },
                g2: { id: 'g2', children: [] }
            }
        });
        ctx.runtime.activeDragContext = { kind: 'group', draggedGroupId: 'g1' };
        const target = ctx.helpers.makeGroupContainerTarget('g2');
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer
        });
        expect(target.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('marks drop target invalid when multi-source drag hovers over a member of the dragged set', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: true, ungrouped: ['A', 'B', 'C'], groups: [] },
            pendingBatchKeys: new Set(['A', 'B', 'C'])
        });
        ctx.runtime.activeDragContext = { kind: 'source-multi', keys: ['A', 'B', 'C'] };
        const target = ctx.helpers.makeSourceItemTarget('B');
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer
        });
        expect(target.classList.has('drag-invalid')).toBe(true);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('sets dropEffect to none for multi-source drag with top-level before-group invalid intent', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: true, ungrouped: ['A', 'B'], groups: ['g1'] },
            pendingBatchKeys: new Set(['A', 'B']),
            groups: { g1: { id: 'g1', children: [] } }
        });
        ctx.runtime.activeDragContext = { kind: 'source-multi', keys: ['A', 'B'] };
        const target = ctx.helpers.makeGroupContainerTarget('g1');
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer
        });
        // The slot top is a group entry, not a source item — no [data-source-key] match → no red highlight applied.
        // Group-container itself is not highlighted because intentKind is before-group, not into-group.
        expect(target.classList.has('drag-invalid')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('does not mark drop target invalid when single source drags over a different source', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set()
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        const target = ctx.helpers.makeSourceItemTarget('B');
        const dataTransfer = { dropEffect: 'move' };
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer
        });
        expect(target.classList.has('drag-invalid')).toBe(false);
        expect(target.classList.has('drag-over-top')).toBe(false);
        expect(target.classList.has('drag-over-bottom')).toBe(false);
        expect(dataTransfer.dropEffect).toBe('move');
    });
});

describe('handleDragOver physical reflow', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function makeClassList(initial = []) {
        const classes = new Set(initial);
        return {
            add: jest.fn((...cs) => cs.forEach((c) => classes.add(c))),
            remove: jest.fn((...cs) => cs.forEach((c) => classes.delete(c))),
            contains: (c) => classes.has(c),
            has: (c) => classes.has(c)
        };
    }

    function setupCtx({ state, pendingBatchKeys, groups, dragReflow }) {
        const groupsById = new Map();
        const runtime = {};
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => (id === 'sources-list' ? sourcesListEl : null)
        };
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getParentMap: () => new Map(),
            isDescendant: globalThis.isDescendant,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        function makeSourceItemTarget(key) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const classList = makeClassList(['source-item']);
            const target = {
                dataset: { sourceKey: key },
                classList,
                rect,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.source-item') return target;
                if (selector === '.group-container') return null;
                return null;
            };
            return target;
        }

        function makeGroupContainerTarget(groupId) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const classList = makeClassList(['group-container']);
            const target = {
                dataset: { groupId },
                classList,
                rect,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.group-container') return target;
                if (selector === '.source-item') return null;
                return null;
            };
            return target;
        }

        return {
            runtime,
            tree,
            sourcesListEl,
            helpers: { makeSourceItemTarget, makeGroupContainerTarget }
        };
    }

    function makeDragReflowMock() {
        return {
            computeReflow: jest.fn(() => new Map([['B', 40]])),
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            unfoldDraggedItems: jest.fn()
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('calls applyReflow with shifts when dragging over a source-item (no blue bar classes added)', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        const target = ctx.helpers.makeSourceItemTarget('B');
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(dragReflow.computeReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.applyReflow).toHaveBeenCalledTimes(1);
        const computeArgs = dragReflow.computeReflow.mock.calls[0][0];
        expect(computeArgs.session).toBe(ctx.runtime.dragReflowSession);
        // Hover over upper half of 'B' (index 1) → before-source → insertIndex = 1
        expect(computeArgs.insertIndex).toBe(1);
        // siblingKeys should reflect the targetList resolved from getDropIntent — here ungrouped is ['A', 'B'].
        expect(computeArgs.siblingKeys).toEqual(['A', 'B']);
        expect(computeArgs.rootElement).toBe(ctx.sourcesListEl);
        const applyArgs = dragReflow.applyReflow.mock.calls[0][0];
        expect(applyArgs.session).toBe(ctx.runtime.dragReflowSession);
        expect(applyArgs.shifts).toBeInstanceOf(Map);
        expect(applyArgs.rootElement).toBe(ctx.sourcesListEl);

        // No blue-bar classes should be added
        expect(target.classList.add).not.toHaveBeenCalledWith('drag-over-top');
        expect(target.classList.add).not.toHaveBeenCalledWith('drag-over-bottom');
        expect(target.classList.has('drag-over-top')).toBe(false);
        expect(target.classList.has('drag-over-bottom')).toBe(false);
    });

    it('updates session.currentIntent with intent kind on dragover', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        const target = ctx.helpers.makeSourceItemTarget('B');
        ctx.tree.handleDragOver({
            target,
            // upper half → before-source
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(ctx.runtime.dragReflowSession.currentIntent).toBeTruthy();
        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('before-source');
    });

    it('records after-source kind when pointer is on the lower half of a source-item', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        const target = ctx.helpers.makeSourceItemTarget('B');
        ctx.tree.handleDragOver({
            target,
            // lower half → after-source
            clientY: target.rect.top + 35,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('after-source');
    });

    it('records into-group kind and adds drag-into class when pointer is in middle of group-container', () => {
        const dragReflow = makeDragReflowMock();
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [] } },
            dragReflow
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };
        ctx.runtime.dragReflowSession = {
            draggedKeys: new Set(['A']),
            itemHeights: new Map([['A', 40]]),
            totalDraggedHeight: 40,
            currentIntent: null,
            shiftedItems: new Map()
        };

        const target = ctx.helpers.makeGroupContainerTarget('g1');
        ctx.tree.handleDragOver({
            target,
            // middle of group → into-group
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });

        expect(target.classList.has('drag-into')).toBe(true);
        expect(target.classList.has('drag-over-top')).toBe(false);
        expect(target.classList.has('drag-over-bottom')).toBe(false);
        expect(ctx.runtime.dragReflowSession.currentIntent.kind).toBe('into-group');
    });

    it('skips reflow when dragReflow dep is missing', () => {
        const ctx = setupCtx({
            state: { isBatchMode: false, ungrouped: ['A', 'B'], groups: [] },
            pendingBatchKeys: new Set(),
            dragReflow: null
        });
        ctx.runtime.activeDragContext = { kind: 'source-single', keys: ['A'] };

        const target = ctx.helpers.makeSourceItemTarget('B');
        expect(() => ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + 5,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        })).not.toThrow();
        // No blue-bar classes even without dragReflow
        expect(target.classList.has('drag-over-top')).toBe(false);
        expect(target.classList.has('drag-over-bottom')).toBe(false);
    });
});

describe('resolveSiblingKeys helper', () => {
    let createContentTreeInteractions;

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    it('returns empty array for null intent', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys(null)).toEqual([]);
    });

    it('returns empty array when targetList is not an array', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys({ targetList: null })).toEqual([]);
    });

    it('returns string entries directly (state.ungrouped or state.groups)', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys({ targetList: ['A', 'B', 'C'] })).toEqual(['A', 'B', 'C']);
    });

    it('returns source keys from object entries with type=source', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys({
            targetList: [
                { type: 'source', key: 'k1' },
                { type: 'source', key: 'k2' }
            ]
        })).toEqual(['k1', 'k2']);
    });

    it('returns group ids from object entries with type=group', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys({
            targetList: [
                { type: 'source', key: 'k1' },
                { type: 'group', id: 'g1' },
                { type: 'source', key: 'k2' }
            ]
        })).toEqual(['k1', 'g1', 'k2']);
    });

    it('filters out malformed entries', () => {
        const tree = createContentTreeInteractions({});
        expect(tree.resolveSiblingKeys({
            targetList: [
                { type: 'source', key: 'k1' },
                { type: 'other' },
                null,
                'plainKey'
            ]
        })).toEqual(['k1', 'plainKey']);
    });
});

describe('handleDragOver hover-expand', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    function makeClassList(initial = []) {
        const classes = new Set(initial);
        const api = {
            add: (...cs) => cs.forEach((c) => classes.add(c)),
            remove: (...cs) => cs.forEach((c) => classes.delete(c)),
            contains: (c) => classes.has(c),
            has: (c) => classes.has(c)
        };
        return api;
    }

    function setupTreeInteractionsTestContext({ state, pendingBatchKeys, groups, parentMap }) {
        const groupsById = new Map();
        const runtime = { groupsById };
        const containersByGroupId = new Map();
        if (groups && typeof groups === 'object') {
            Object.keys(groups).forEach((id) => {
                const group = groups[id];
                groupsById.set(id, { id, children: [], ...group });
            });
        }
        const resolvedParentMap = parentMap instanceof Map ? parentMap : new Map();
        const shadowRoot = {
            querySelector: (selector) => {
                const match = /^\.group-container\[data-group-id="([^"]+)"\]$/.exec(selector);
                if (match) return containersByGroupId.get(match[1]) || null;
                return null;
            },
            querySelectorAll: () => []
        };
        const dragMulti = createContentDragMulti({});
        const tree = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            getParentMap: () => resolvedParentMap,
            getSetTimeout: () => globalThis.setTimeout,
            isDescendant: globalThis.isDescendant,
            dragMulti
        });

        function makeGroupContainerTarget(groupId, { intent } = {}) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const initial = ['group-container'];
            const classList = makeClassList(initial);
            if (intent) classList.add(intent);
            const target = {
                dataset: { groupId },
                classList,
                rect,
                querySelector: () => null,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.group-container') return target;
                if (selector === '.source-item') return null;
                return null;
            };
            containersByGroupId.set(groupId, target);
            return target;
        }

        function makeDropEvent({ data, target }) {
            return {
                target,
                preventDefault: jest.fn(),
                dataTransfer: {
                    getData: (key) => (data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : ''),
                    dropEffect: 'move'
                }
            };
        }

        function makeSourceRowTarget(sourceKey) {
            const rect = { top: 200, bottom: 240, height: 40 };
            const classList = makeClassList(['source-item']);
            const target = {
                dataset: { sourceKey },
                classList,
                rect,
                getBoundingClientRect: () => ({ top: rect.top, bottom: rect.bottom, height: rect.height, left: 0, right: 200, width: 200 })
            };
            target.closest = (selector) => {
                if (selector === '.group-container, .source-item') return target;
                if (selector === '.source-item') return target;
                if (selector === '.group-container') return null;
                return null;
            };
            return target;
        }

        return {
            runtime,
            tree,
            helpers: { makeGroupContainerTarget, makeDropEvent, makeSourceRowTarget },
            groupsById
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        teardownGlobalMocks();
    });

    it('expands a collapsed group after 600ms of continuous hover', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        const event = {
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        };
        ctx.tree.handleDragOver(event);
        jest.advanceTimersByTime(600);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('cancels the timer when the drop target changes before 600ms', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1', 'g2'] },
            pendingBatchKeys: new Set(),
            groups: {
                g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true },
                g2: { id: 'g2', children: [{ type: 'source', key: 'Y' }], collapsed: true }
            }
        });
        const target1 = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        const target2 = ctx.helpers.makeGroupContainerTarget('g2', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target: target1,
            clientY: target1.rect.top + target1.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(300);
        ctx.tree.handleDragOver({
            target: target2,
            clientY: target2.rect.top + target2.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(600);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('does not arm a timer on an already-expanded group', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(false);
    });

    it('does not arm a timer on a collapsed but empty group', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [], collapsed: true } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(1000);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on dragleave from #sources-list', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(300);
        ctx.tree.handleDragLeave({ target: { id: 'sources-list', closest: () => null } });
        jest.advanceTimersByTime(600);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on dragend', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(300);
        ctx.tree.handleDragEnd({ target });
        jest.advanceTimersByTime(600);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    it('cancels the timer on drop', () => {
        const ctx = setupTreeInteractionsTestContext({
            state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] },
            pendingBatchKeys: new Set(),
            groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } }
        });
        const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
        ctx.tree.handleDragOver({
            target,
            clientY: target.rect.top + target.rect.height / 2,
            preventDefault: jest.fn(),
            dataTransfer: { dropEffect: 'move' }
        });
        jest.advanceTimersByTime(300);
        const dropEvent = ctx.helpers.makeDropEvent({
            data: { 'application/source-key': 'A' },
            target
        });
        ctx.tree.handleDrop(dropEvent);
        jest.advanceTimersByTime(600);
        expect(ctx.groupsById.get('g1').collapsed).toBe(true);
    });

    describe('state shape refactor (Set + Map)', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        it('initializes hoverExpandedGroupIds as an empty Set and hoverExpandTimers as an empty Map', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: [] },
                pendingBatchKeys: new Set()
            });
            expect(ctx.runtime.hoverExpandedGroupIds).toBeInstanceOf(Set);
            expect(ctx.runtime.hoverExpandedGroupIds.size).toBe(0);
            expect(ctx.runtime.hoverExpandTimers).toBeInstanceOf(Map);
            expect(ctx.runtime.hoverExpandTimers.size).toBe(0);
        });

        it('records the group id in hoverExpandedGroupIds after a successful hover-expand', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['g1'] },
                pendingBatchKeys: new Set(),
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: true } }
            });
            const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target,
                clientY: target.rect.top + target.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });
            jest.advanceTimersByTime(600);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(true);
            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(false);
        });
    });

    describe('getGroupAncestorChain helper', () => {
        it('returns the chain from a deep group up to root', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'group', id: 'B' }], collapsed: false },
                    B: { id: 'B', children: [{ type: 'group', id: 'C' }], collapsed: false },
                    C: { id: 'C', children: [], collapsed: false }
                },
                parentMap: new Map([['C', 'B'], ['B', 'A']])
            });
            expect(ctx.tree.getGroupAncestorChain('C')).toEqual(['C', 'B', 'A']);
            expect(ctx.tree.getGroupAncestorChain('A')).toEqual(['A']);
            expect(ctx.tree.getGroupAncestorChain(null)).toEqual([]);
            expect(ctx.tree.getGroupAncestorChain('unknown')).toEqual(['unknown']);
        });
    });

    describe('handleDragOver auto-collapse', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        it('collapses a hover-opened group 600ms after the pointer leaves its subtree', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A', 'B'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'source', key: 'X' }], collapsed: true },
                    B: { id: 'B', children: [{ type: 'source', key: 'Y' }], collapsed: true }
                }
            });

            const targetA = ctx.helpers.makeGroupContainerTarget('A', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target: targetA,
                clientY: targetA.rect.top + targetA.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });
            jest.advanceTimersByTime(600);
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(true);

            // Now move pointer to a sibling B (not in A's chain).
            const targetB = ctx.helpers.makeGroupContainerTarget('B', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target: targetB,
                clientY: targetB.rect.top + targetB.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });

            // A should now have a pending collapse timer.
            expect(ctx.runtime.hoverExpandTimers.get('A')).toMatchObject({ kind: 'collapse' });

            // 600ms later, A collapses.
            jest.advanceTimersByTime(600);
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(false);
        });

        it('cancels the collapse timer when pointer returns within 600ms', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A', 'B'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'source', key: 'X' }], collapsed: false },
                    B: { id: 'B', children: [{ type: 'source', key: 'Y' }], collapsed: false }
                }
            });
            ctx.runtime.hoverExpandedGroupIds.add('A');

            // Pointer on B (not in A's chain) → arm collapse timer for A.
            const targetB = ctx.helpers.makeGroupContainerTarget('B', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target: targetB,
                clientY: targetB.rect.top + targetB.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });
            expect(ctx.runtime.hoverExpandTimers.get('A')).toMatchObject({ kind: 'collapse' });
            jest.advanceTimersByTime(300);

            // Pointer returns to A → cancel collapse timer.
            const targetA = ctx.helpers.makeGroupContainerTarget('A', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target: targetA,
                clientY: targetA.rect.top + targetA.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });
            expect(ctx.runtime.hoverExpandTimers.get('A')).toBeUndefined();

            jest.advanceTimersByTime(600);
            // A is still expanded.
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(true);
        });

        it('keeps an ancestor open while pointer is on its descendant', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['A'] },
                pendingBatchKeys: new Set(),
                groups: {
                    A: { id: 'A', children: [{ type: 'group', id: 'B' }], collapsed: false },
                    B: { id: 'B', children: [{ type: 'source', key: 'X' }], collapsed: false }
                },
                parentMap: new Map([['B', 'A']])
            });
            ctx.runtime.hoverExpandedGroupIds.add('A');

            // Pointer enters B (descendant of A).
            const targetB = ctx.helpers.makeGroupContainerTarget('B', { intent: 'drag-into' });
            ctx.tree.handleDragOver({
                target: targetB,
                clientY: targetB.rect.top + targetB.rect.height / 2,
                preventDefault: jest.fn(),
                dataTransfer: { dropEffect: 'move' }
            });

            // A should NOT have a collapse timer.
            expect(ctx.runtime.hoverExpandTimers.get('A')).toBeUndefined();
            jest.advanceTimersByTime(600);
            expect(ctx.runtime.groupsById.get('A').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('A')).toBe(true);
        });
    });

    describe('drop disposition for hover-opened groups', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        it('keeps the hover-opened group open when drop lands inside its subtree', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] },
                pendingBatchKeys: new Set(),
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } }
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            const target = ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });
            const dropEvent = ctx.helpers.makeDropEvent({
                data: { 'application/source-key': 'A' },
                target
            });
            ctx.tree.handleDrop(dropEvent);

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(false);
        });

        it('collapses the hover-opened group when drop lands outside its subtree', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1', 'g2'] },
                pendingBatchKeys: new Set(),
                groups: {
                    g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false },
                    g2: { id: 'g2', children: [], collapsed: false }
                }
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            // Pre-register g1's container so executeHoverCollapse can locate it.
            ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });

            // Drop into g2 (sibling, not in g1's chain).
            const target = ctx.helpers.makeGroupContainerTarget('g2', { intent: 'drag-into' });
            const dropEvent = ctx.helpers.makeDropEvent({
                data: { 'application/source-key': 'A' },
                target
            });
            ctx.tree.handleDrop(dropEvent);

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(false);
        });

        it('collapses hover-opened groups on handleDragEnd if drop never landed inside', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: ['A'], groups: ['g1'] },
                pendingBatchKeys: new Set(),
                groups: { g1: { id: 'g1', children: [{ type: 'source', key: 'X' }], collapsed: false } }
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            // Pre-register g1's container so executeHoverCollapse can locate it.
            ctx.helpers.makeGroupContainerTarget('g1', { intent: 'drag-into' });

            ctx.tree.handleDragEnd({ target: ctx.helpers.makeSourceRowTarget('A') });

            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(true);
            expect(ctx.runtime.hoverExpandedGroupIds.size).toBe(0);
        });

        it('keeps an ancestor open when dropping a group above a sibling inside it', () => {
            const ctx = setupTreeInteractionsTestContext({
                state: { isBatchMode: false, ungrouped: [], groups: ['g1', 'gD'] },
                pendingBatchKeys: new Set(),
                groups: {
                    g1: { id: 'g1', children: [{ type: 'group', id: 'g3' }], collapsed: false },
                    g3: { id: 'g3', children: [], collapsed: false },
                    gD: { id: 'gD', children: [], collapsed: false }
                },
                parentMap: new Map([['g3', 'g1']])
            });
            ctx.runtime.hoverExpandedGroupIds.add('g1');

            // Simulate dropping gD above g3 (which is inside g1).
            // intent.targetGroup = g1 (the parent of g3), intent.kind = 'before-group'.
            const target = ctx.helpers.makeGroupContainerTarget('g3');
            ctx.runtime.dragReflowSession = {
                draggedKeys: new Set(['gD']),
                currentIntent: { kind: 'before-group' }
            };
            const dropEvent = ctx.helpers.makeDropEvent({
                data: { 'application/group-id': 'gD' },
                target
            });
            ctx.tree.handleDrop(dropEvent);

            // g1 should stay open because the drop landed inside g1's subtree.
            expect(ctx.runtime.groupsById.get('g1').collapsed).toBe(false);
            expect(ctx.runtime.hoverExpandedGroupIds.has('g1')).toBe(false);
        });
    });
});

describe('handleDrop reflow cleanup', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createClassList = (classes = []) => {
        const classSet = new Set(classes);
        return {
            contains: jest.fn((className) => classSet.has(className)),
            remove: jest.fn((...classNames) => {
                classNames.forEach((className) => classSet.delete(className));
            }),
            add: jest.fn((className) => {
                classSet.add(className);
            })
        };
    };

    const createDropEvent = ({ dropTarget, sourceKey = '', sourceKeysJson = '', groupId = '' }) => ({
        preventDefault: jest.fn(),
        target: {
            closest: jest.fn(() => dropTarget)
        },
        dataTransfer: {
            getData: jest.fn((type) => {
                if (type === 'application/source-key') return sourceKey;
                if (type === 'application/source-keys') return sourceKeysJson;
                if (type === 'application/group-id') return groupId;
                return '';
            })
        }
    });

    function makeDragReflowMock() {
        return {
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            computeReflow: jest.fn(() => new Map()),
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            unfoldDraggedItems: jest.fn()
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('clears reflow before DOM mutation and unfolds dragged items after a successful single-source drop', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { sourceKey: 'source-2' },
            classList: createClassList(['source-item'])
        };
        const session = {
            draggedKeys: new Set(['source-1']),
            currentIntent: { kind: 'after-source' },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        // Track ordering: clearReflow MUST be called before saveState (the DOM mutation point).
        const callOrder = [];
        dragReflow.clearReflow.mockImplementation(() => { callOrder.push('clearReflow'); });
        dragReflow.unfoldDraggedItems.mockImplementation(() => { callOrder.push('unfoldDraggedItems'); });
        saveState.mockImplementation(() => { callOrder.push('saveState'); });
        render.mockImplementation(() => { callOrder.push('render'); });

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            saveState,
            render,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));

        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        const clearArgs = dragReflow.clearReflow.mock.calls[0][0];
        expect(clearArgs.session).toBe(session);
        expect(clearArgs.rootElement).toBe(sourcesListEl);
        const unfoldArgs = dragReflow.unfoldDraggedItems.mock.calls[0][0];
        expect(unfoldArgs.session).toBe(session);
        expect(unfoldArgs.rootElement).toBe(sourcesListEl);

        // clearReflow must come BEFORE any DOM mutation step (saveState / render).
        expect(callOrder.indexOf('clearReflow')).toBeLessThan(callOrder.indexOf('saveState'));
        expect(callOrder.indexOf('clearReflow')).toBeLessThan(callOrder.indexOf('render'));
        // unfoldDraggedItems must come AFTER the DOM mutation step.
        expect(callOrder.indexOf('unfoldDraggedItems')).toBeGreaterThan(callOrder.indexOf('render'));

        // runtime.dragReflowSession nulled out at the end.
        expect(runtime.dragReflowSession).toBeNull();
    });

    it('clears reflow and unfolds dragged items on an invalid drop (no DOM mutation)', () => {
        // Invalid: dropping a group into its own descendant — handleDrop returns early without mutation.
        const state = { groups: ['root'], ungrouped: [] };
        const groupsById = new Map([
            ['root', { id: 'root', children: [{ type: 'group', id: 'child' }] }],
            ['child', { id: 'child', children: [] }]
        ]);
        const parentMap = new Map([['child', 'root']]);
        const saveState = jest.fn();
        const render = jest.fn();
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { groupId: 'child' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const session = {
            draggedKeys: new Set(['root']),
            currentIntent: { kind: 'into-group' },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getParentMap: () => parentMap,
            getShadowRoot: () => shadowRoot,
            isDescendant: global.isDescendant,
            saveState,
            render,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDrop(createDropEvent({ dropTarget, groupId: 'root' }));

        // Move was rejected — no save / no render.
        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();

        // Cleanup still runs.
        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        expect(runtime.dragReflowSession).toBeNull();
    });

    it('clears reflow and unfolds dragged items when handleDrop returns early on a no-op move', () => {
        // Source-1 dropped back into its current position — early return without mutation.
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { sourceKey: 'source-1' },
            classList: createClassList(['source-item'])
        };
        const session = {
            draggedKeys: new Set(['source-1']),
            currentIntent: { kind: 'before-source' },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => shadowRoot,
            saveState,
            render,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));

        expect(saveState).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        expect(runtime.dragReflowSession).toBeNull();
    });

    it('clears reflow and unfolds dragged items after a successful multi-source drop', () => {
        const group = { id: 'g1', children: [] };
        const state = { isBatchMode: true, ungrouped: ['A', 'B', 'C', 'D'], groups: ['g1'] };
        const groupsById = new Map([['g1', group]]);
        const sourcesByKey = new Map([
            ['A', { key: 'A' }],
            ['B', { key: 'B' }],
            ['C', { key: 'C' }],
            ['D', { key: 'D' }]
        ]);
        const pendingBatchKeys = new Set(['A', 'B', 'C']);
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { groupId: 'g1' },
            classList: createClassList(['group-container', 'drag-into'])
        };
        const session = {
            draggedKeys: new Set(['A', 'B', 'C']),
            currentIntent: { kind: 'into-group' },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => groupsById,
            getSourcesByKey: () => sourcesByKey,
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => pendingBatchKeys,
            getShadowRoot: () => shadowRoot,
            saveState: jest.fn(),
            render: jest.fn(),
            showToast: jest.fn(),
            buildParentMap: jest.fn(),
            developerLog: jest.fn(),
            dragMulti: createContentDragMulti({}),
            dragReflow,
            getMessage: (key, args = []) => `${key}:${args.join(',')}`
        });

        interactions.handleDrop(createDropEvent({
            dropTarget,
            sourceKey: 'A',
            sourceKeysJson: JSON.stringify(['A', 'B', 'C'])
        }));

        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        expect(runtime.dragReflowSession).toBeNull();
    });

    it('is a no-op when dragReflowSession is missing', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const dropTarget = {
            dataset: { sourceKey: 'source-2' },
            classList: createClassList(['source-item'])
        };
        const runtime = { dragReflowSession: null };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => []) }),
            saveState: jest.fn(),
            render: jest.fn(),
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        expect(() => {
            interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));
        }).not.toThrow();

        expect(dragReflow.clearReflow).not.toHaveBeenCalled();
        expect(dragReflow.unfoldDraggedItems).not.toHaveBeenCalled();
    });
});

describe('handleDragEnd reflow restore', () => {
    let createContentTreeInteractions;
    let createContentDragMulti;

    const createClassList = (classes = []) => {
        const classSet = new Set(classes);
        return {
            contains: jest.fn((className) => classSet.has(className)),
            remove: jest.fn((...classNames) => {
                classNames.forEach((className) => classSet.delete(className));
            }),
            add: jest.fn((className) => {
                classSet.add(className);
            })
        };
    };

    const createDropEvent = ({ dropTarget, sourceKey = '', sourceKeysJson = '', groupId = '' }) => ({
        preventDefault: jest.fn(),
        target: {
            closest: jest.fn(() => dropTarget)
        },
        dataTransfer: {
            getData: jest.fn((type) => {
                if (type === 'application/source-key') return sourceKey;
                if (type === 'application/source-keys') return sourceKeysJson;
                if (type === 'application/group-id') return groupId;
                return '';
            })
        }
    });

    function makeDragReflowMock() {
        return {
            prepareDragSession: jest.fn(),
            foldDraggedItems: jest.fn(),
            computeReflow: jest.fn(() => new Map()),
            applyReflow: jest.fn(),
            clearReflow: jest.fn(),
            unfoldDraggedItems: jest.fn()
        };
    }

    beforeEach(() => {
        jest.resetModules();
        setupGlobalMocks();
        require('../../src/content/content-native-checkbox-sync.js');
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
        createContentDragMulti = require('../../src/content/content-drag-multi.js');
    });

    afterEach(teardownGlobalMocks);

    it('clears reflow and unfolds dragged items when dragend fires without a prior drop (esc cancel)', () => {
        const state = { groups: [], ungrouped: ['A', 'B'] };
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const session = {
            draggedKeys: new Set(['A']),
            currentIntent: null,
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        interactions.handleDragEnd({ target: { closest: jest.fn(() => null) } });

        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        const clearArgs = dragReflow.clearReflow.mock.calls[0][0];
        expect(clearArgs.session).toBe(session);
        expect(clearArgs.rootElement).toBe(sourcesListEl);
        expect(runtime.dragReflowSession).toBeNull();
    });

    it('is a no-op for reflow after a successful drop already nulled the session', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const sourcesListEl = { id: 'sources-list' };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn((id) => (id === 'sources-list' ? sourcesListEl : null))
        };
        const dropTarget = {
            dataset: { sourceKey: 'source-2' },
            classList: createClassList(['source-item'])
        };
        const session = {
            draggedKeys: new Set(['source-1']),
            currentIntent: { kind: 'after-source' },
            shiftedItems: new Map()
        };
        const runtime = { dragReflowSession: session };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getParentMap: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            saveState: jest.fn(),
            render: jest.fn(),
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        // Drop first — should clear + unfold once and null the session.
        interactions.handleDrop(createDropEvent({ dropTarget, sourceKey: 'source-1' }));
        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
        expect(runtime.dragReflowSession).toBeNull();

        // dragend afterwards — must not double-call.
        interactions.handleDragEnd({ target: { closest: jest.fn(() => null) } });
        expect(dragReflow.clearReflow).toHaveBeenCalledTimes(1);
        expect(dragReflow.unfoldDraggedItems).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when dragReflowSession is missing on dragend', () => {
        const state = { groups: [], ungrouped: ['A'] };
        const shadowRoot = {
            querySelector: jest.fn(() => null),
            querySelectorAll: jest.fn(() => []),
            getElementById: jest.fn(() => null)
        };
        const runtime = { dragReflowSession: null };
        const dragReflow = makeDragReflowMock();

        const interactions = createContentTreeInteractions({
            runtime,
            getState: () => state,
            getGroupsById: () => new Map(),
            getPendingBatchKeys: () => new Set(),
            getShadowRoot: () => shadowRoot,
            dragMulti: createContentDragMulti({}),
            dragReflow
        });

        expect(() => {
            interactions.handleDragEnd({ target: { closest: jest.fn(() => null) } });
        }).not.toThrow();

        expect(dragReflow.clearReflow).not.toHaveBeenCalled();
        expect(dragReflow.unfoldDraggedItems).not.toHaveBeenCalled();
    });
});
