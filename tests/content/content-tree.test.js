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
        createContentTreeInteractions = require('../../src/content/content-tree-interactions.js');
    });

    afterEach(teardownGlobalMocks);

    it('does not save or render when a source is dropped back into the same position', () => {
        const state = { groups: [], ungrouped: ['source-1', 'source-2'] };
        const saveState = jest.fn();
        const render = jest.fn();
        const dropTarget = {
            dataset: { sourceKey: 'source-1' },
            classList: createClassList(['source-item', 'drag-over-top'])
        };
        const interactions = createContentTreeInteractions({
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
            classList: createClassList(['source-item', 'drag-over-bottom'])
        };
        const interactions = createContentTreeInteractions({
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
            { classList: createClassList(['drag-over-bottom']) }
        ];
        const interactions = createContentTreeInteractions({
            getShadowRoot: () => ({ querySelectorAll: jest.fn(() => markedNodes) })
        });

        expect(interactions.clearDragFeedback()).toBe(2);
        markedNodes.forEach((node) => {
            expect(node.classList.remove).toHaveBeenCalledWith('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-into');
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
